// 爆灯流程契约（2026-11-14 起：双通道——免费额度用完转付费）
//
// 背景沿革：
//   2026-10-26 改为「免费额度爆灯」后，详情页把付费入口整个摘掉了，
//   但付费接口一直在（POST /spotlights/payments），只是全仓无人调用 —— 付费通道等于空转。
//   2026-11-14 决定接回：额度内走免费（POST /discovery/superlikes/{id}），
//   额度用完走付费（建单 → 预支付 → 调起微信 → 轮询订单 status==1）。
//
// 本文件守住三条容易回退的边界：
//   ① 单价必须同源：展示读 GET /spotlights/price，扣款取订单返回的 amount，前端常量只作兜底；
//   ② 支付成功 ≠ 已履约：必须轮询订单，超时按「开通中」返回，不能谎称已送达；
//   ③ 额度耗尽不能把按钮置灰：那是唯一的付费入口，置灰等于付费通道再次消失。

const fs = require('fs')
const root = __dirname + '/..'
function read(file) { return fs.readFileSync(root + '/' + file, 'utf8') }
function expect(content, fragment, label) { if (!content.includes(fragment)) throw new Error(`${label}: missing ${fragment}`); console.log(`PASS ${label}`) }
function reject(content, fragment, label) { if (content.includes(fragment)) throw new Error(`${label}: unexpected ${fragment}`); console.log(`PASS ${label}`) }
function expectCount(content, fragment, min, label) {
  const count = content.split(fragment).length - 1
  if (count < min) throw new Error(`${label}: expected >= ${min} occurrences of ${fragment}, got ${count}`)
  console.log(`PASS ${label} (${count})`)
}

console.log('Spotlight flow checks')

const index = read('pages/index/index.uvue')
const detail = read('pagesSub/userExtra/user/detail.uvue')
const api = read('api/spotlight.uts')
const apiIndex = read('api/index.uts')
const mock = read('mock/spotlight.uts')
const success = read('pagesSub/userExtra/components/XsaSpotlightSuccessSheet.uvue')

// —— 首页：爆灯不得成为主路径，首页不应有任何爆灯入口或状态
reject(index, 'vip-card-spotlight', 'homepage has no spotlight button')
reject(index, 'spotlightPaymentVisible', 'homepage has no spotlight payment state')
reject(index, 'XsaPaymentSheet', 'homepage has no payment sheet')
reject(index, 'XsaSpotlightSuccessSheet', 'homepage has no success sheet')
reject(index, 'onSpotlight', 'homepage must not trigger spotlight')
reject(index, 'sendSuperlike', 'homepage must not call the superlike API')

// —— 详情页：两种状态各一张卡片，免费与付费入口都在
expectCount(detail, 'spotlight-card', 2, 'detail renders the card in both locked and unlocked views')
expect(detail, 'sendSuperlike(', 'detail calls the free superlike API')
expect(detail, 'createSpotlightOrder(', 'detail creates a paid order when the free quota is gone')
expect(detail, 'paySpotlightOrder(', 'detail pays the paid order and waits for fulfillment')
expect(detail, 'spotlightRemaining', 'detail tracks remaining quota')
expect(detail, 'spotlightButtonText', 'detail derives the CTA copy from state')
expect(detail, 'XsaSpotlightSuccessSheet', 'detail has success sheet')

// 额度耗尽必须能继续点：置灰就等于把付费入口关掉
reject(detail, 'if (spotlightRemaining.value == 0) return false', 'exhausted quota must not disable the CTA')
expect(detail, '立即爆灯', 'exhausted quota turns the CTA into the paid entry')

// 价格展示：只认服务端价格变量，旧的未定义变量 spotlightAmount 不能在模板里复活
expectCount(detail, '¥{{ spotlightPrice }}', 2, 'detail renders the server-side price')
reject(detail, 'spotlightAmount', 'detail must not reference the removed spotlightAmount binding')
reject(detail, '当前免费体验', 'detail must not claim the entry is free when it can charge')
expect(detail, 'getSpotlightPrice(', 'detail refreshes the price from the server')

// 支付面板：金额取订单返回值，不用前端常量
expect(detail, ':amount="spotlightPayAmount"', 'payment sheet is bound to the order amount')
expect(detail, 'spotlightPayAmount.value = order.amount', 'payment sheet amount comes from the created order')
expect(detail, 'onSpotlightPayConfirm', 'payment sheet has a confirm handler')

// —— API 层：免费通道
expect(api, "url: '/discovery/superlikes/'", 'superlike API targets the discovery endpoint')
expect(api, "'Idempotency-Key'", 'superlike request sends an idempotency key')
expect(api, 'remaining_today', 'superlike documents the remaining quota field')

// —— API 层：付费通道（四个端点必须与后端一致）
expect(api, "url: '/spotlights/price'", 'price endpoint matches the backend route')
expect(api, "url: '/spotlights/payments'", 'create-order endpoint matches the backend route')
expect(api, "url: '/spotlights/payments/' + encodeURIComponent(orderNo)", 'order-query endpoint matches the backend route')
expect(api, "product_code: 'superlike'", 'paid spotlight uses the superlike product code')
expect(api, "'spotlight-' + Date.now()", 'create-order sends an idempotency key')

// —— API 层：支付成功 ≠ 已履约
expect(api, 'pollUntil(', 'payment must poll the order instead of trusting requestPayment')
expect(api, 'Number(o.status) == 1', 'polling waits for the server-side paid status')
expect(api, '开通中', 'timeout falls back to a pending hint, never a fake success')
reject(api, 'export async function paySpotlight(', 'legacy paySpotlight must stay removed')

// —— API 层：单价兜底常量只做展示，不允许参与定价
expect(api, 'SPOTLIGHT_AMOUNT = 9.9', 'fallback amount is kept for display only')
expect(api, 'amount: SPOTLIGHT_AMOUNT', 'fallback amount is only used as a display/mock default')

// —— 导出面：api/index.uts 必须补齐新符号，否则页面 import 编译不过
expect(apiIndex, "// 爆灯相关", 'api index groups the spotlight exports')
expect(apiIndex, 'createSpotlightOrder', 'api index exports createSpotlightOrder')
expect(apiIndex, 'getSpotlightPrice', 'api index exports getSpotlightPrice')
expect(apiIndex, 'paySpotlightOrder', 'api index exports paySpotlightOrder')

// —— Mock 与成功态组件保持不变
expect(mock, 'mockSpotlightPaymentOrders', 'spotlight mock order store')
expect(success, '爆灯已送达', 'success sheet title')
expect(success, '继续浏览', 'success sheet action')
reject(success, 'import type', 'UTS-safe local success target type')

console.log('Spotlight flow checks passed')
