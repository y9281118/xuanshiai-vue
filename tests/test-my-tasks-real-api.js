const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const page = fs.readFileSync(path.join(root, 'pagesSub/profileExtra/my-tasks.uvue'), 'utf8')
const apiIndex = fs.readFileSync(path.join(root, 'api', 'index.uts'), 'utf8')

// F-M4：页面是「额度用完 → 去兑换」的落点，必须真调接口，且不能再有假成功。
assert.ok(
  page.includes("from '@/api'") && page.includes('getPointProducts') && page.includes('getPointsSummary') && page.includes('redeemPointProduct'),
  'my-tasks should read points products, balance and redeem through the shared api barrel',
)
assert.ok(!page.includes("from '@/api/"), 'pages must not import api modules directly')
assert.ok(apiIndex.includes('getPointProducts, getPointsSummary, getMyQuotas, redeemPointProduct'), 'points helpers should stay exported from @/api')

assert.ok(page.includes('const points = ref(0)'), 'balance should start empty instead of a demo number')
assert.ok(!page.includes('ref(1280)'), 'the hard-coded demo balance must be gone')
assert.ok(/onShow\(\(\) => \{\s*loadPoints\(\)\s*loadExchangeItems\(\)/.test(page), 'balance and exchange list should refresh on every visit')

assert.ok(
  /const confirmExchange[\s\S]{0,1200}await redeemPointProduct\(item\.key\)/.test(page),
  'exchange should call the redeem endpoint per unit',
)
assert.ok(!page.includes('points.value -=') && !page.includes('points.value +='), 'balance must only change from server responses')
assert.ok(page.includes('if (points.value < item.cost)'), 'insufficient balance should be reported before spending a request')
assert.ok(page.includes("'积分不足，当前 '"), 'insufficient balance should tell the user the real balance')
// 后端 redeem 一次只加一次额度（无数量参数），前端不能留多量兑换的假入口。
assert.ok(!page.includes('exchangeQuantity'), 'quantity should be fixed at one until the backend supports bulk redeem')
assert.ok(page.includes('单次兑换'), 'the sheet should say the exchange is single-unit')
assert.ok(
  /const confirmExchange[\s\S]{0,900}await loadPoints\(\)[\s\S]{0,300}if \(res == null \|\| res\.success != true\)/.test(page),
  'the balance must be re-read from the server and a failed redeem must not report success',
)

// 只展示后端确实存在的商品码（database_setup_marriage 种子）。
;['extra_apply', 'browse_unlock', 'paper_plane_unlock', 'profile_detail_unlock'].forEach((code) => {
  assert.ok(page.includes(`'${code}'`), `the exchange whitelist should include ${code}`)
})

// 假充值 / 假签到 / 假邀请必须整体退场，而不是点开一个付不了款的货架。
assert.ok(!page.includes('purchasePackages'), 'the fake recharge package list should be deleted')
assert.ok(!page.includes('确认充值'), 'no confirm button may promise a recharge')
assert.ok(!page.includes('invite-share-sheet'), 'the fake invite reward sheet should be deleted')
assert.ok(!page.includes('双方各得50积分'), 'invite copy must not promise rewards that cannot be earned')
assert.ok(!page.includes('已连续签到'), 'check-in copy must not imply a real streak')
assert.ok(page.includes('积分充值暂未开放'), 'unavailable recharge should say 积分充值暂未开放')
assert.ok(!page.includes('每日抽签暂未开放'), 'daily check-in must not stay disabled')
assert.ok(!page.includes('邀请好友暂未开放'), 'invite list must not stay disabled')
assert.ok(page.includes('dailyCheckin') && page.includes('getMyInvites'), 'check-in and invites must call the shared API barrel')

console.log('我的任务页接真接口契约测试通过')
