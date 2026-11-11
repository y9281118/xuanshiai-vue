// FE-33-02 P0 / Q18：AI 觅遇「说已搜索、其实没搜」的状态诚实性。
//
// 后端 evaluate_auto_confirm 判定不安全时抛 SearchConfirmationRequired
// （HTTP 422 / businessCode=AI_CONFIRMATION_REQUIRED / detail.blockers），
// 服务端根本不出快照。原实现只写 aiDraftError，结果区仍以「已按可执行条件搜索」
// 为标题渲染冲突块 —— 用户被告知搜过了，实际一条候选都没有。
//
// 本文件只覆盖 P0（不依赖 D2 决策）。A 方案（auto_confirm_pending / 确认卡）
// 落地后再在此追加对应断言。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pagesSub/profileExtra/search.uvue'), 'utf8')
const template = source.slice(0, source.indexOf('</template>'))

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

// ── 1. 冲突标题必须随「是否真的执行过」变化 ────────────────────────────
assert.match(
  template,
  /aiSearchExecuted \? '已按可执行条件搜索，以下内容需要你后续确认' : '搜索未执行：以下条件需要你先确认'/,
  '冲突标题不得写死「已按可执行条件搜索」'
)
assert.doesNotMatch(
  template,
  /class="ai-result-notice-title">已按可执行条件搜索/,
  '冲突标题不得是静态文本'
)
assert.match(
  source,
  /const aiSearchExecuted = computed\(\(\): boolean => resultState\.value == 'success' \|\| resultState\.value == 'empty'\)/,
  'success 与 empty 都拿到了服务端快照，都算执行过；idle/error 不算'
)

// ── 2. blockers 映射 + 错误态：沙箱执行真实 setAiFailure ────────────────
const blockerBlock = source.slice(
  source.indexOf('const AI_CONFIRM_BLOCKER_TEXT'),
  source.indexOf('// confirm 已知成功后的任务/快照引用')
)
const compiled = babel.transformSync(
  '(function () {\n' + blockerBlock
    + '\nreturn { setAiFailure, aiConfirmationBlockerText };'
    + '\n})()',
  { filename: 'fragment.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }
).code

function failureSandbox() {
  const ctx = {
    aiDraftError: { value: '' },
    resultError: { value: '请检查网络后再试一次' },
    resultState: { value: 'idle' },
    aiEnabled: { value: true },
    aiCapabilityState: { value: 'enabled' },
    confirmPhaseInvalidated: 0,
    invalidateAiConfirmPhase: () => { ctx.confirmPhaseInvalidated++ },
    aiFailureNotice: () => ({ title: 'AI 觅遇暂时不可用', hint: '请稍后重试', retryable: true, disabled: false })
  }
  const api = vm.runInNewContext(compiled, ctx)
  return { ctx, api }
}

const rejection = (blockers) => ({
  success: false,
  code: 422,
  businessCode: 'AI_CONFIRMATION_REQUIRED',
  message: '搜索条件需要用户确认',
  data: { detail: { code: 'AI_CONFIRMATION_REQUIRED', blockers } }
})

{
  const t = failureSandbox()
  t.api.setAiFailure(rejection(['conflict', 'no_hard_condition']))
  assert.equal(t.ctx.resultState.value, 'error', '确认被拒绝必须成错误态，不得停在 idle/成功空列表')
  assert.equal(t.ctx.resultError.value, '条件区间互相冲突；还缺一个明确的硬性条件，比如年龄段或现居城市', 'blockers 须逐条翻成人话并进入结果区')
  assert.equal(t.ctx.aiDraftError.value, t.ctx.resultError.value, '编辑区与结果区口径一致')
  assert.equal(t.ctx.confirmPhaseInvalidated, 1, '被拒绝的 confirm 必须作废幂等键与阶段标记')
  assert.equal(t.ctx.aiEnabled.value, true, '条件需要确认不是能力关闭，不得误禁用 AI 入口')
}

{
  const t = failureSandbox()
  t.api.setAiFailure(rejection(['low_confidence:income_band', 'unknown:hobby', 'invalid_condition']))
  assert.equal(
    t.ctx.resultError.value,
    '「income_band」是我推断的，需要你确认；「hobby」没能识别，请换个说法；有条件的取值不合法',
    '带字段名的 blockers 须保留字段并说明处理方式'
  )
}

{
  const t = failureSandbox()
  t.api.setAiFailure(rejection([]))
  assert.equal(t.ctx.resultError.value, '搜索条件需要你先确认', 'blockers 为空时给兜底文案，不得空白')
  assert.equal(t.ctx.resultState.value, 'error', '空 blockers 同样成错误态')
}

{
  // 非确认类失败仍走既有三档分诊，不被新分支吞掉
  const t = failureSandbox()
  t.api.setAiFailure({ success: false, code: 503, businessCode: 'AI_TEMPORARILY_UNAVAILABLE' })
  assert.equal(t.ctx.aiDraftError.value, 'AI 觅遇暂时不可用 · 请稍后重试', '503 仍按运营态展示')
  assert.equal(t.ctx.confirmPhaseInvalidated, 0, '非确认类失败不动 confirm 阶段标记')
}

// ── 3. confirm 失败不得留在 loading/success ────────────────────────────
{
  const confirmBlock = sliceBalanced(source, 'const confirmAiSearch = async () =>')
  assert.match(
    confirmBlock,
    /setAiFailure\(accepted\)[\s\S]{0,220}resultState\.value = 'error'[\s\S]{0,80}resultError\.value = aiDraftError\.value/,
    'confirm 失败必须落错误态并带出原因'
  )
  assert.match(
    confirmBlock,
    /搜索服务未返回有效执行任务'[\s\S]{0,160}resultState\.value = 'error'/,
    'confirm 成功但没有任务号同样成错误态'
  )
  // 重试仍走既有幂等链路，不重跑整链
  const retryBlock = sliceBalanced(source, 'const retrySearch = () =>')
  assert.match(retryBlock, /confirmAiSearch\(\)/, '重试走既有 confirm 幂等链路')
  assert.match(retryBlock, /loadSnapshotResults\(searchRunId, aiDraftId\.value\)/, '已有快照时只重读结果')
}

// ── 4. 改条件必须作废两阶段（否则改完重试仍拿旧 revision 重放） ─────────
{
  assert.match(source, /const invalidateAiConditionPhases = \(\) => \{/, '须有两阶段统一作废入口')
  const editValue = sliceBalanced(source, 'const onAiConditionValueInput = (index: number')
  const editAction = sliceBalanced(source, 'const setAiConditionAction = (index: number')
  assert.match(editValue, /invalidateAiConditionPhases\(\)/, '改条件值必须作废两阶段')
  assert.match(editAction, /invalidateAiConditionPhases\(\)/, '改条件动作必须作废两阶段')
}

// ── 5. C3：条件编辑函数禁止删除 ────────────────────────────────────────
for (const marker of [
  'const onAiConditionValueInput = (index: number',
  'const setAiConditionAction = (index: number',
  'const buildAiConditionActions = (): any[]'
]) {
  assert.ok(source.includes(marker), 'C3：不得删除条件编辑链路 ' + marker)
}

// ── 6. 主路径不回退：解析成功仍直接搜索，默认不渲染确认区 ────────────────
assert.match(source, /await confirmAiSearch\(\)/, '解析成功后仍自动执行搜索')
assert.match(source, /没有识别到可执行的搜索条件，请换个说法再试/, '零条件停在输入区报错，不发起空搜索')

console.log('PASS AI 搜索 P0 契约：冲突标题随执行态、blockers 人话化、拒绝即错误态、两阶段键生命周期')