// FE-33-06 A/C / Q58：置顶页的状态补齐与文案合规。
//
// A（状态）：原 loadStatus 的 catch 只重置 activeStatus，plans 保持 []，
// 底部支付栏又被 plans.length > 0 隐藏 —— 用户看到只有 Banner 的空白页且无重试。
// C（文案）：「提升脱单成功率」「喜欢翻倍」「优质用户」承诺关系结果，违反 AGENTS §3。
//
// B（Token 回归，62 处硬编码色值 → uni.scss Token）会改变页面观感，
// 按方案 §11.10 非代码步骤 1 需用户/设计确认后再合入，本文件暂不断言。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pagesSub/userExtra/index/top-placement.uvue'), 'utf8')
const template = source.slice(0, source.indexOf('</template>'))

// ── C. 文案合规 ────────────────────────────────────────────────────────
for (const banned of ['脱单', '喜欢翻倍', '优质用户', '精准触达']) {
  assert.ok(!source.includes(banned), '置顶页不得出现承诺关系结果或评判用户的文案：' + banned)
}
assert.match(template, /优先曝光 · 让更多人看到你的资料/, 'Banner 文案只描述曝光机制')
assert.match(template, /置顶期间，你的资料会在广场靠前展示/, '未置顶态文案只描述展示位次')
assert.match(source, /title: '同城曝光', desc: '同城用户优先看到'/, '权益 2 去掉「优质」评判')
assert.match(source, /title: '更多曝光', desc: '展示位次靠前'/, '权益 3 去掉「喜欢翻倍」')
assert.match(source, /title: '优先展示', desc: '首页靠前'/, '权益 1 描述机制，保留')
assert.match(template, /置顶服务为虚拟商品，购买成功后不支持退款/, '退款口径保留，待 D4 统一')

// ── A. 状态：模板 ──────────────────────────────────────────────────────
assert.match(template, /v-if="loadError != ''" class="state-panel"/, '必须有错误态卡片')
assert.match(template, /v-else-if="plans\.length == 0" class="state-panel"/, '必须有空态卡片')
assert.match(template, /置顶套餐暂未上架，请稍后再来/, '空态文案')
assert.equal((template.match(/@tap="loadStatus"><text>重新加载<\/text>/g) || []).length, 2, '错误态与空态都要有重试入口')
assert.match(
  template,
  /v-if="!loading && !paymentSuccess && loadError == '' && plans\.length > 0" class="footer-safe"/,
  '错误态与空目录都不得渲染支付栏'
)
assert.match(template, /class="active-status" v-if="loadError == ''"/, '读取失败时不得宣称「您当前还未置顶」')
assert.match(template, /v-if="paymentPending" class="panel-action" @tap="refreshPlacementStatus"/, '到账中态必须有就地刷新入口')
assert.match(template, /@error="onRecommendImageError\(index\)"/, '推荐头像加载失败须移除，避免破图')

// ── A. 状态：loadStatus 行为沙箱 ───────────────────────────────────────
// loadStatus → closePayment 之间已包含 selectPlan / openPayment /
// onRecommendImageError / refreshPlacementStatus，整段进沙箱。
const scriptBlock = source.slice(
  source.indexOf('const loadStatus = async () =>'),
  source.indexOf('const closePayment = () =>')
)
const compiled = babel.transformSync(
  '(function () {\n' + scriptBlock
    + '\nreturn { loadStatus, openPayment, onRecommendImageError, refreshPlacementStatus };'
    + '\n})()',
  { filename: 'fragment.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }
).code

const PLAN = { id: 'boost_7', name: '7 天置顶', days: 7, price: 5, tag: '', recommended: true }

function sandbox(opts = {}) {
  const toasts = []
  const ctx = {
    plans: { value: [] },
    selectedPlanIndex: { value: 0 },
    activeStatus: { value: { active: false, remainingDays: 0, expiresAt: 0 } },
    loading: { value: true },
    loadError: { value: '' },
    refreshingStatus: { value: false },
    paymentVisible: { value: false },
    paying: { value: false },
    paymentPending: { value: true },
    successNotice: { value: '' },
    successOrder: { value: { orderNo: 'B1', planName: '7 天置顶', amount: 5, remainingDays: 0, expiresAt: 0 } },
    recommendImages: { value: ['a.webp', 'b.webp'] },
    selectedPlan: { get value() { return ctx.plans.value.length > ctx.selectedPlanIndex.value ? ctx.plans.value[ctx.selectedPlanIndex.value] : { id: '', price: 0 } } },
    getTopPlacementStatus: async () => (opts.status != null ? opts.status : { success: true, data: { active: false, remainingDays: 0, expiresAt: 0 } }),
    getTopPlacementPackages: async () => (opts.packages != null ? opts.packages : { success: true, data: [PLAN] }),
    getDiscoveryPlaza: async () => (opts.plaza != null ? opts.plaza : { success: true, data: { items: [{ avatar: 'a.webp' }, { avatar: 'b.webp' }] } }),
    resolveMediaUrl: (v) => (v == null ? '' : '' + v),
    uni: { showToast: (o) => { toasts.push(o) } }
  }
  const api = vm.runInNewContext(compiled, ctx)
  return { ctx, api, toasts }
}

async function main() {
  // 正常：无错误、有套餐
  {
    const t = sandbox()
    await t.api.loadStatus()
    assert.equal(t.ctx.loadError.value, '', '正常路径不报错')
    assert.equal(t.ctx.plans.value.length, 1, '套餐正常加载')
    assert.equal(t.ctx.loading.value, false, '结束加载态')
    assert.equal(t.ctx.recommendImages.value.length, 2, '推荐头像最多取 2 张')
  }

  // 接口失败：成错误态并清空套餐，不留下「只有 Banner」的页面
  {
    const t = sandbox({ packages: { success: false, message: '置顶服务异常' } })
    await t.api.loadStatus()
    assert.equal(t.ctx.loadError.value, '置顶服务异常', '失败须给出具体原因')
    assert.equal(t.ctx.plans.value.length, 0, '失败不得残留上一轮套餐')
    assert.equal(t.ctx.loading.value, false, '失败必须解除加载态')
    // 重试恢复：服务恢复后点「重新加载」必须回到正常态
    t.ctx.getTopPlacementPackages = async () => ({ success: true, data: [PLAN] })
    await t.api.loadStatus()
    assert.equal(t.ctx.loadError.value, '', '重试成功后清除错误')
    assert.equal(t.ctx.plans.value.length, 1, '重试成功后拿到套餐')
  }

  // 抛异常（断网）：同样成错误态
  {
    const t = sandbox({ packages: null })
    t.ctx.getTopPlacementPackages = async () => { throw new Error('offline') }
    await t.api.loadStatus()
    assert.equal(t.ctx.loadError.value, '网络异常，置顶状态加载失败，请重新加载', '断网须成错误态而不是静默空白')
    assert.equal(t.ctx.loading.value, false, '断网必须解除加载态')
  }

  // 空目录：不报错但 plans 为空 → 模板走空态，无支付按钮
  {
    const t = sandbox({ packages: { success: true, data: [] } })
    await t.api.loadStatus()
    assert.equal(t.ctx.loadError.value, '', '空目录不是错误')
    assert.equal(t.ctx.plans.value.length, 0, '空目录保持空')
    t.api.openPayment()
    assert.equal(t.ctx.paymentVisible.value, false, '空目录不得打开支付面板')
    assert.equal(t.toasts.length, 1, '空目录点击须有明确反馈，不得静默 return')
    assert.equal(t.toasts[0].title, '置顶套餐暂未上架，请稍后再来', '空目录 toast 文案')
  }

  // 有套餐：openPayment 正常打开
  {
    const t = sandbox()
    await t.api.loadStatus()
    t.api.openPayment()
    assert.equal(t.ctx.paymentVisible.value, true, '有套餐时正常打开支付面板')
    assert.equal(t.toasts.length, 0, '正常路径不弹 toast')
  }

  // 头像加载失败：只移除坏图，不影响其它
  {
    const t = sandbox()
    t.api.onRecommendImageError(0)
    assert.deepEqual(Array.from(t.ctx.recommendImages.value), ['b.webp'], '坏图按下标移除')
    t.api.onRecommendImageError(9)
    assert.deepEqual(Array.from(t.ctx.recommendImages.value), ['b.webp'], '越界下标不得改动列表')
  }

  // 到账中刷新：生效则切态并回填剩余天数
  {
    const t = sandbox({ status: { success: true, data: { active: true, remainingDays: 7, expiresAt: 1800000000000 } } })
    await t.api.refreshPlacementStatus()
    assert.equal(t.ctx.paymentPending.value, false, '权益生效后退出到账中态')
    assert.equal(t.ctx.successOrder.value.remainingDays, 7, '回填服务端剩余天数')
    assert.equal(t.ctx.successOrder.value.expiresAt, 1800000000000, '回填服务端到期时间')
    assert.equal(t.ctx.refreshingStatus.value, false, '结束刷新态')
    assert.match(t.ctx.successNotice.value, /置顶已生效/, '生效文案')
  }

  // 到账中刷新：仍未生效 → 保持 pending 并提示
  {
    const t = sandbox({ status: { success: true, data: { active: false } } })
    await t.api.refreshPlacementStatus()
    assert.equal(t.ctx.paymentPending.value, true, '未生效不得谎称已开通')
    assert.equal(t.toasts[0].title, '权益还在开通中，请稍后再刷新', '未生效提示')
  }

  // 刷新失败：保持 pending，不吞错
  {
    const t = sandbox({ status: { success: false, message: '服务不可用' } })
    await t.api.refreshPlacementStatus()
    assert.equal(t.ctx.paymentPending.value, true, '读取失败不得改状态')
    assert.equal(t.toasts[0].title, '服务不可用', '失败须带原因')
    assert.equal(t.ctx.refreshingStatus.value, false, '失败必须解除刷新态')
  }

  console.log('PASS 置顶页状态与文案契约：错误/空/到账中三态可达可重试，文案不承诺关系结果')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})