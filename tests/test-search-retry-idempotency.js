// audit-item-5: 搜索输入生效 + 失败重试不死回放（第 7 项接线，判据来自第 5 项）
//
// 审计问题：① AI 条件输入框改了值但 PATCH 仍带旧值；② 任务失败后重试只回放死任务。
// 契约（沙箱执行真实 onAiConditionValueInput / aiConditionValue / patchAiConditions）：
//   1. 输入事件必须先把真实输入回写 localValueText，再做校验、再进 PATCH；
//   2. 每次输入都作废 PATCH 幂等键，下一批修改必然产生新 Idempotency-Key；
//   3. 同一批未变修改连续 PATCH 复用同一把键（重试不重复计操作）；
//   4. 任务明确失败（task.done 且非 succeeded）时解除 confirm 幂等键；
//      「重新搜索」按钮按状态回落到 confirmAiSearch / beginSearch，不回放死任务；
//   5. 断网/离开页面：searchPageAlive 关掉后所有异步回调不得继续写页面状态。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pagesSub', 'profileExtra', 'search.uvue'), 'utf8')

function sliceBalanced(src, startIndex) {
  if (startIndex < 0) throw new Error('未找到片段起点')
  const open = src.indexOf('{', startIndex)
  if (open < 0) throw new Error('未找到起始花括号')
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(startIndex, i + 1)
    }
  }
  throw new Error('花括号未配平')
}

function compileFragment(code, extra = '') {
  const wrapped = ['(function () {', code, extra, '})()'].join(String.fromCharCode(10))
  return babel.transformSync(wrapped, {
    filename: 'fragment.ts',
    configFile: false,
    babelrc: false,
    plugins: ['@babel/plugin-transform-typescript']
  }).code
}

// ── A. 输入回写 + 校验 + 作废 PATCH 幂等键 ─────────────────────────────
const inputFns = compileFragment(
  [
    sliceBalanced(source, source.indexOf('const aiConditionValue = (condition: any)')),
    sliceBalanced(source, source.indexOf('const invalidateAiConfirmPhase = () =>')),
    sliceBalanced(source, source.indexOf('const invalidateAiConditionPhases = () =>')),
    sliceBalanced(source, source.indexOf('const onAiConditionValueInput = (index: number'))
  ].join(String.fromCharCode(10)),
  'return { aiConditionValue, onAiConditionValueInput };'
)

function inputSandbox(conditions) {
  const ctx = {
    aiConditions: { value: conditions },
    aiPatchIdempotencyKey: { value: 'search-patch-stale' },
    aiConfirmIdempotencyKey: { value: 'search-confirm-stale' },
    aiConfirmSucceeded: { value: true },
    aiPatchPhaseSucceeded: true,
    aiConfirmTaskId: 'task-stale'
  }
  const fns = vm.runInNewContext(inputFns, ctx)
  return { ctx, fns }
}

{
  const t = inputSandbox([
    { localValueType: 'number', localValueText: '22', localValueInvalid: false, localAction: 'pending' },
    { localValueType: 'boolean', localValueText: 'true', localValueInvalid: false, localAction: 'pending' },
    { localValueType: 'array', localValueText: '[1,2]', localValueInvalid: false, localAction: 'removed' }
  ])
  // 用户把年龄从 22 改成 25：输入必须真实写回，供校验与 PATCH 使用
  t.fns.onAiConditionValueInput(0, { detail: { value: '25' } })
  assert.equal(t.ctx.aiConditions.value[0].localValueText, '25', '输入必须先回写 localValueText，PATCH 才拿得到新值')
  assert.equal(t.fns.aiConditionValue(t.ctx.aiConditions.value[0]), 25, '回写后的条件值必须是新输入')
  assert.equal(t.ctx.aiConditions.value[0].localValueInvalid, false, '合法数字不得标记无效')
  assert.equal(t.ctx.aiConditions.value[0].localAction, 'confirmed', '主动输入即视为确认该条件')
  assert.equal(t.ctx.aiPatchIdempotencyKey.value, '', '每次输入必须作废 PATCH 幂等键')
  // 改条件后两阶段必须一起作废：否则重试会跳过 PATCH，拿旧 revision 的 confirm 键重放新内容
  assert.equal(t.ctx.aiPatchPhaseSucceeded, false, '改条件必须作废 PATCH 阶段成功标记')
  assert.equal(t.ctx.aiConfirmIdempotencyKey.value, '', '改条件必须作废 confirm 幂等键')
  assert.equal(t.ctx.aiConfirmSucceeded.value, false, '改条件必须作废 confirm 阶段成功标记')
  assert.equal(t.ctx.aiConfirmTaskId, '', '改条件必须清除上一轮任务引用')
  // 越界 index 不得产生副作用
  const before = JSON.stringify(t.ctx.aiConditions.value)
  t.fns.onAiConditionValueInput(99, { detail: { value: 'x' } })
  assert.equal(JSON.stringify(t.ctx.aiConditions.value), before, '越界 index 不得改动条件')
  // 非法数字：标记无效且值归 null（不得把脏值带进 PATCH）
  t.fns.onAiConditionValueInput(0, { detail: { value: 'abc' } })
  assert.equal(t.ctx.aiConditions.value[0].localValueInvalid, true, '非法数字须标记无效')
  assert.equal(t.fns.aiConditionValue(t.ctx.aiConditions.value[0]), null, '非法值不得进入 PATCH')
  // 布尔与数组 JSON 校验
  t.fns.onAiConditionValueInput(1, { detail: { value: 'false' } })
  assert.equal(t.fns.aiConditionValue(t.ctx.aiConditions.value[1]), false, '布尔输入解析正确')
  t.fns.onAiConditionValueInput(1, { detail: { value: 'maybe' } })
  assert.equal(t.ctx.aiConditions.value[1].localValueInvalid, true, '非 true/false 布尔输入须标记无效')
  t.fns.onAiConditionValueInput(2, { detail: { value: '[3,4]' } })
  assert.deepEqual(Array.from(t.fns.aiConditionValue(t.ctx.aiConditions.value[2])), [3, 4], '数组 JSON 解析正确')
  t.fns.onAiConditionValueInput(2, { detail: { value: 'not-json' } })
  assert.equal(t.ctx.aiConditions.value[2].localValueInvalid, true, '坏 JSON 须标记无效')
  // 已移除的条件输入不复活为 confirmed（用户显式移除的语义要保留）
  const removedCtx = inputSandbox([{ localValueType: 'string', localValueText: '', localValueInvalid: false, localAction: 'removed' }])
  removedCtx.fns.onAiConditionValueInput(0, { detail: { value: '保留词' } })
  assert.equal(removedCtx.ctx.aiConditions.value[0].localAction, 'removed', '已移除的条件输入不复活为 confirmed（search.uvue:321 保留 removed，须显式重新确认）')
}

// ── B. PATCH 幂等键：同批复用、改动作废后换新 ──────────────────────────
const patchFns = compileFragment(
  sliceBalanced(source, source.indexOf('const patchAiConditions = async (runId: number')),
  'return patchAiConditions;'
)

function patchSandbox(script) {
  const sent = []
  const ctx = {
    searchRunId: 1,
    aiDraftId: { value: 'd1' },
    aiDraft: { value: { revision: 7 } },
    aiEnabled: { value: true },
    aiCapabilityState: { value: 'enabled' },
    aiPatchIdempotencyKey: { value: '' },
    aiDraftError: { value: '' },
    buildAiConditionActions: () => [{ condition_no: 1, action: 'edit', value: 25 }],
    searchDraftRevision: () => 7,
    setAiDraftResponse: () => {},
    setAiFailure: (res) => { ctx.aiDraftError.value = res != null && res.message != null ? String(res.message) : 'failed' },
    getSearchDraft: async () => ({ success: true, data: {} }),
    patchSearchDraft: async (draftId, actions, revision, key) => {
      sent.push({ draftId, key })
      return script(sent.length)
    }
  }
  const patch = vm.runInNewContext(patchFns, ctx)
  return { ctx, sent, patch }
}

async function main() {
  {
    const t = patchSandbox(() => ({ success: true, data: { ok: 1 } }))
    assert.equal(await t.patch(1, 'd1'), true, '正常路径 PATCH 成功')
    const firstKey = t.sent[0].key
    assert.ok(firstKey.startsWith('search-patch-'), '首次 PATCH 须惰性生成幂等键')
    assert.equal(await t.patch(1, 'd1'), true, '第二次 PATCH 成功')
    assert.equal(t.sent[1].key, firstKey, '同一批未变修改重试必须复用同一把键（不重复计操作）')
    // 模拟用户再次编辑（onAiConditionValueInput 把键置空）→ 必须换新键
    t.ctx.aiPatchIdempotencyKey.value = ''
    assert.equal(await t.patch(1, 'd1'), true)
    assert.notEqual(t.sent[2].key, firstKey, '用户改动后必须产生新的 Idempotency-Key')
    // 409 冲突：拉取最新草稿并报错，不改键（同键重试由后端幂等保证安全）
    const c = patchSandbox((n) => (n === 1 ? { success: false, code: 409, message: '版本冲突' } : { success: true, data: {} }))
    assert.equal(await c.patch(1, 'd1'), false, '409 时 PATCH 返回失败')
    assert.ok(String(c.ctx.aiDraftError.value).includes('版本冲突') || String(c.ctx.aiDraftError.value).length > 0, '409 须给出可见错误')
    // runId 过期（用户已重开搜索）：结果不得回写
    const e = patchSandbox(() => ({ success: true, data: {} }))
    assert.equal(await e.patch(2, 'd1'), false, '过期 runId 的 PATCH 结果必须丢弃')
    assert.equal(e.sent.length, 0, '过期 runId 不得发出 PATCH 请求')
  }

  // ── C. 失败重试不死回放 + 断网守卫（结构契约） ────────────────────────
  // 任务明确失败 → 解除 confirm 幂等键，用户重试时惰性生成新键 = 新操作
  assert.match(
    source,
    /if \(task\.done\) \{[\s\S]{0,160}aiConfirmIdempotencyKey\.value = ''/,
    '任务明确失败必须解除 confirm 幂等键，重试不得回放死任务'
  )
  // confirm 键仅在为空时惰性生成，保证「同一次确认」内重试复用
  assert.match(
    source,
    /if \(aiConfirmIdempotencyKey\.value\.length == 0\) aiConfirmIdempotencyKey\.value = 'search-confirm-'/,
    'confirm 幂等键必须惰性生成'
  )
  // 重新搜索按钮：已有草稿未出结果 → 重新走确认；否则整体重开
  const retryBlock = sliceBalanced(source, source.indexOf('const retrySearch = () =>'))
  assert.match(retryBlock, /confirmAiSearch\(\)/, '已有草稿未出结果时重试走 confirmAiSearch')
  assert.match(retryBlock, /beginSearch\(\)/, '其余情况重试整体重开搜索')
  assert.match(source, /@tap="retrySearch"/, '错误态必须暴露「重新搜索」入口')
  // 断网恢复/离开页面守卫：searchPageAlive 关掉后异步链必须停写
  assert.match(source, /let searchPageAlive = true/, '须有页面存活标志')
  assert.match(source, /searchPageAlive = false/, 'onUnload 必须置 false')
  const aliveGuards = (source.match(/if \(!searchPageAlive\) return/g) || []).length
  assert.ok(aliveGuards >= 3, '异步链各回写点须有存活守卫（当前 ' + aliveGuards + ' 处）')
  assert.match(source, /waitForSearchTask\(taskId, \(\) => searchPageAlive\)/, '轮询任务须随页面存活中止')

  // ── S1：解析中改输入必须恢复 busy，旧任务不得清新请求状态 ────────────────
  const invalidateBlock = sliceBalanced(source, source.indexOf('const invalidateAiRun = () =>'))
  assert.match(invalidateBlock, /searchRunId \+= 1/, '作废旧任务必须推进 runId')
  assert.match(invalidateBlock, /aiGenerating\.value = false/, 'S1：作废必须显式恢复 busy')
  assert.match(invalidateBlock, /aiConfirming\.value = false/, 'S1：作废必须同时恢复确认中状态')
  const inputBlock = sliceBalanced(source, source.indexOf('const onAiInput = (event: any) =>'))
  assert.match(inputBlock, /invalidateAiRun\(\)/, 'S1：输入变化必须走统一作废入口')
  assert.doesNotMatch(inputBlock, /searchRunId \+= 1/, 'S1：输入变化不得只推进 runId 而不恢复 busy')
  const suggestBlock = sliceBalanced(source, source.indexOf('const typeAiText = (value: string) =>'))
  assert.match(suggestBlock, /invalidateAiRun\(\)/, 'S1：点建议同样必须恢复 busy')

  // ── S2：PATCH 成功后的确认重试不得重放 PATCH ─────────────────────────────
  assert.match(source, /let aiPatchPhaseSucceeded = false/, 'S2：必须有 PATCH 阶段成功标记')
  assert.match(source, /aiConfirmSucceeded/, 'S2：必须有 confirm 阶段成功标记')
  const confirmBlock = sliceBalanced(source, source.indexOf('const confirmAiSearch = async () =>'))
  assert.match(confirmBlock, /if \(!aiPatchPhaseSucceeded\) \{/, 'S2：PATCH 已知成功时不得再次 PATCH')
  assert.match(confirmBlock, /if \(aiConfirmSucceeded\.value\) \{/, 'S2：confirm 已知成功时不得重新确认')
  const resetBlock = sliceBalanced(source, source.indexOf('const resetAiDraftState = ('))
  assert.match(resetBlock, /aiPatchPhaseSucceeded = false/, 'S2：改条件/换草稿必须同时作废 PATCH 阶段')
  assert.match(resetBlock, /aiConfirmSucceeded\.value = false/, 'S2：改条件/换草稿必须同时作废 confirm 阶段')
  assert.match(resetBlock, /aiConfirmTaskId = ''/, 'S2：作废必须清除上一轮任务引用')

  // ── S3：读结果失败只重读既有快照；调整条件保留草稿 ───────────────────────
  const snapshotBlock = sliceBalanced(source, source.indexOf('const loadSnapshotResults = async ('))
  assert.match(snapshotBlock, /getSearchSnapshotResults\(aiSnapshotId\.value, '', 20\)/, 'S3：结果重试只读既有快照')
  assert.doesNotMatch(
    snapshotBlock,
    /createSearchDraft\(|patchSearchDraft\(|confirmSearchDraft\(/,
    'S3：读结果失败不得重跑 create/patch/confirm 整链'
  )
  const retryBlock2 = sliceBalanced(source, source.indexOf('const retrySearch = () =>'))
  assert.match(retryBlock2, /loadSnapshotResults\(searchRunId, aiDraftId\.value\)/, 'S3：已有快照时只重读结果')
  const editorBlock = sliceBalanced(source, source.indexOf('const openSearchEditor = () =>'))
  assert.doesNotMatch(editorBlock, /resetAiDraftState\(\)/, 'S3：「调整条件」必须保留当前条件草稿')
  const newSearchBlock = sliceBalanced(source, source.indexOf('const startNewSearch = () =>'))
  assert.match(newSearchBlock, /resetAiDraftState\(\)/, 'S3：「开始新的搜索」才清空上下文')
  assert.match(source, /@tap="startNewSearch"/, 'S3：新搜索入口必须绑定独立处理函数')

  console.log('PASS search retry idempotency: 输入回写、键生命周期、失败重试与断网守卫全部通过')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
