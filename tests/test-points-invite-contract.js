// FE-33-04 / Q57：邀请入口不得承诺没有兑现能力的奖励。
//
// 后端 app/services/points.py 只有对 invite_record 的只读 SELECT，
// app/ 内 INSERT INTO invite_record 零匹配 —— 没有任何写入与发奖路径。
// 「邀请好友赚积分」「奖励状态以服务端记录为准」是无兑现能力的承诺（AGENTS §3）。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pagesSub/profileExtra/my-tasks.uvue'), 'utf8')

function sliceBalanced(src, marker) {
  const start = src.indexOf(marker)
  assert.ok(start >= 0, '源码缺少片段：' + marker)
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error('花括号未配平：' + marker)
}

// ── 1. 文案：不得出现无兑现能力的承诺 ──────────────────────────────────
assert.doesNotMatch(source, /赚积分/, '邀请入口不得宣称「赚积分」：后端没有发奖路径')
assert.doesNotMatch(source, /奖励状态以服务端记录为准/, '不得暗示存在服务端奖励状态')
assert.match(source, /<text class="earn-title">我的邀请<\/text>/, '标题改为中性的「我的邀请」')
assert.match(source, /<text class="earn-desc">查看已邀请人数<\/text>/, '描述只说查看人数')

// ── 2. openInvite 行为：沙箱执行 ───────────────────────────────────────
const compiled = babel.transformSync(
  '(function () {\n' + sliceBalanced(source, 'const openInvite = async () =>')
    + '\nreturn openInvite;\n})()',
  { filename: 'fragment.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }
).code

function sandbox(responses) {
  const calls = []
  const modals = []
  const toasts = []
  const ctx = {
    inviteLoading: { value: false },
    getMyInvites: async (page, pageSize) => {
      calls.push({ page, pageSize })
      const next = responses[Math.min(calls.length, responses.length) - 1]
      return typeof next === 'function' ? next() : next
    },
    uni: {
      showModal: (opt) => { modals.push(opt) },
      showToast: (opt) => { toasts.push(opt) }
    }
  }
  const openInvite = vm.runInNewContext(compiled, ctx)
  return { ctx, calls, modals, toasts, openInvite }
}

async function main() {
  // 有记录：真实人数 + 明确说明奖励未开放
  {
    const t = sandbox([{ success: true, data: { total: 3 } }])
    await t.openInvite()
    assert.equal(t.modals.length, 1, '成功时弹一次说明')
    assert.equal(t.modals[0].content, '已邀请 3 位好友。邀请奖励尚未开放，记录仅供查看。', '有记录须同时说明奖励未开放')
    assert.equal(t.ctx.inviteLoading.value, false, '结束后必须解除 loading')
  }

  // 无记录：不弹「已邀请 0 位」
  {
    const t = sandbox([{ success: true, data: { total: 0 } }])
    await t.openInvite()
    assert.equal(t.modals[0].content, '还没有邀请记录。', '零记录用空态文案')
  }

  // 失败：只 toast，绝不弹「已邀请 0 位」
  {
    const t = sandbox([{ success: false, message: '网络异常' }])
    await t.openInvite()
    assert.equal(t.modals.length, 0, '失败不得弹窗，否则会把网络故障说成「已邀请 0 位」')
    assert.equal(t.toasts.length, 1, '失败须 toast 报错')
    assert.equal(t.toasts[0].title, '网络异常', 'toast 带服务端原因')
    assert.equal(t.ctx.inviteLoading.value, false, '失败后必须解除 loading，否则永久卡死')
  }

  // 接口抛异常同样要解除 loading
  {
    const t = sandbox([() => { throw new Error('boom') }])
    await t.openInvite().then(() => assert.fail('异常应向上抛出'), () => {})
    assert.equal(t.ctx.inviteLoading.value, false, '异常路径必须在 finally 里解除 loading')
  }

  // 连点 5 次只发 1 次请求
  {
    let release = null
    const gate = new Promise((r) => { release = r })
    const t = sandbox([async () => { await gate; return { success: true, data: { total: 2 } } }])
    const runs = []
    for (let i = 0; i < 5; i++) runs.push(t.openInvite())
    assert.equal(t.calls.length, 1, '并发防护：连点 5 次只发 1 次请求')
    release()
    await Promise.all(runs)
    assert.equal(t.modals.length, 1, '只弹一次')
    // 上一轮结束后可以再次查看
    await t.openInvite()
    assert.equal(t.calls.length, 2, 'loading 解除后允许再次查看')
  }

  assert.match(source, /const inviteLoading = ref\(false\)/, '须有并发防护标记')
  assert.match(source, /\{\{ inviteLoading \? '加载中' : '查看邀请' \}\}/, '按钮须反映加载中状态')

  console.log('PASS 邀请入口契约：无奖励承诺、空态与失败态分离、连点只发一次请求')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})