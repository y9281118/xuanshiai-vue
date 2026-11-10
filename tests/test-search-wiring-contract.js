/**
 * 普通结构化搜索接线契约测试（第二批 B）。
 *
 * 锁定搜索页 → GET /discovery/recommendations 的接线语义：
 * - 参数映射只能来自带证据注释的 searchFilterMapping 模块；
 * - 分页 cursor 随筛选重置、load-more 只传 cursor、响应竞态有 runId 防护；
 * - 旧断链接口保持关闭；AI 入口按 /ai/capabilities 能力位放行或禁用；
 * - 后端未交付的筛选（家乡/认证/小学初中技校）保持禁用或隐藏。
 */

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

let passed = 0
const check = (name, fn) => {
  fn()
  passed += 1
  console.log('PASS ' + name)
}

const page = read('pagesSub/profileExtra/search.uvue')
const mapping = read('utils/searchFilterMapping.uts')
const userApi = read('api/user.uts')
const discoveryApi = read('api/discovery.uts')
const apiIndex = read('api/index.uts')
const aiCapabilities = read('api/ai-capabilities.uts')
const locationTree = read('pagesSub/profileExtra/data/location.uts')
const runTests = read('tests/run-tests.cjs')

check('搜索页数据源已接 /discovery/recommendations', () => {
  assert.ok(page.includes('getDiscoveryRecommendations(params)'), 'structured search must call recommendations API')
  assert.ok(page.includes('buildStructuredSearchParams'), 'params must go through the mapping module')
})

check('断链旧接口封装已清理且不再被引用', () => {
  assert.ok(!page.includes('getRecommendUsers'), 'search page must not reference getRecommendUsers')
  assert.ok(!userApi.includes("url: '/user/recommend/list'"), 'broken endpoint wrapper must be removed')
})

check('筛选变化重置旧结果与旧 cursor', () => {
  assert.ok(page.includes("nextCursor.value = ''") && page.includes('hasMore.value = false'), 'cursor/hasMore reset on new search')
  assert.ok(page.includes('resultCandidates.value = []'), 'old results cleared on new search')
})

check('加载更多只传 cursor，不与 page 混用', () => {
  const loadMore = page.slice(page.indexOf('const loadMoreResults'))
  assert.ok(loadMore.includes('params.cursor = nextCursor.value'), 'load-more must pass cursor')
  assert.ok(!/params\.page\s*=/.test(loadMore), 'load-more must not set page together with cursor')
})

check('并发竞态防护：响应到达时校验 runId', () => {
  const loadMore = page.slice(page.indexOf('const loadMoreResults'))
  assert.ok(page.includes('if (runId != searchRunId) return'), 'stale responses must be discarded')
  assert.ok(loadMore.includes('if (runId != searchRunId) return'), 'load-more discards stale responses')
})

check('M03 AI 搜索按解析-确认-执行接线', () => {
  assert.ok(page.includes('createSearchDraft('), 'AI tab must create a server search draft')
  assert.ok(page.includes('waitForSearchTask('), 'draft and snapshot tasks must be polled')
  assert.ok(page.includes('patchSearchDraft(') && page.includes('searchDraftRevision('), 'condition edits must use the latest revision')
  assert.ok(page.includes('confirmSearchDraft(') && page.includes('getSearchSnapshotResults('), 'results must be read only after confirmation')
  assert.ok(!page.includes('AI 猜你喜欢暂未开放'), 'suggestions must no longer be permanently disabled')
})

check('AI 能力位：master+search 才放行，关闭时全入口拦截', () => {
  assert.ok(aiCapabilities.includes("url: '/ai/capabilities'"), 'capabilities endpoint must be wired')
  assert.ok(aiCapabilities.includes('body.master == true && body.search == true'), 'master+search must both be true')
  assert.ok(apiIndex.includes('getAiCapabilities') && apiIndex.includes('isAiSearchEnabled'), 'capabilities helpers must be exported')
  assert.ok(page.includes('loadAiCapabilities') && page.includes('isAiSearchEnabled'), 'search page must consume capabilities')
  assert.ok(page.includes(':disabled="!aiEnabled"'), 'AI input must be disabled when capability is off')
  assert.ok(page.includes("if (!aiEnabled.value)"), 'AI entries must be guarded')
  assert.ok(page.includes('aiFailureNotice'), 'AI failures must reuse the shared classifier')
})

check('能力位判定：master 与 search 同时为真才放行', () => {
  let src = aiCapabilities.slice(aiCapabilities.indexOf('export function isAiSearchEnabled'))
  src = src.replace('export function isAiSearchEnabled(res: any): boolean', 'function isAiSearchEnabled(res)')
  const fn = new Function(src + '\nreturn isAiSearchEnabled;')()
  assert.equal(fn({ data: { master: true, search: true } }), true)
  assert.equal(fn({ data: { master: true, search: false } }), false)
  assert.equal(fn({ data: { master: false, search: true } }), false)
  assert.equal(fn(null), false)
})

check('MBTI 接线：数组映射、空选择拦截、产品上限 5', () => {
  assert.ok(!page.includes('MBTI 筛选暂未开放'), 'MBTI hard block must be removed')
  assert.ok(mapping.includes('params.mbti = input.mbti.slice()'), 'mbti array must be mapped')
  assert.ok(page.includes('buildStructuredSearchParams({ mbti: targetMbtis.value })'), 'tab 1 must build mbti params')
  assert.ok(page.includes('请先选择人格类型'), 'empty selection must be blocked')
  assert.ok(page.includes('最多选择 5 个'), 'product limit of 5 must stay')
  assert.ok(discoveryApi.includes("url: '/discovery/filter-options'"), 'mbti options must come from filter-options')
})

check('婚况补丧偶并映射到 3', () => {
  assert.ok(page.includes("'丧偶'"), 'marriage options must include 丧偶')
  assert.ok(mapping.includes("if (label == '丧偶') return 3"), '丧偶 must map to marriage_status=3')
})

check('居住地使用 6 位码并支持两级选择', () => {
  assert.ok(mapping.includes('input.residenceCityCode'), 'residence city code must be passed directly')
  assert.ok(mapping.includes('input.residenceProvinceCode'), 'province-only selection must pass province_code')
  assert.ok(page.includes('mode="multiSelector"') && page.includes('residenceColumns'), 'residence picker must be two-level')
  assert.ok(page.includes('applyResidenceByCode'), 'history must restore by 6-digit code')
  assert.ok(locationTree.includes('320100 南京市'), 'profileExtra location tree must be generated')
})

check('新增测试已纳入 npm test 运行器', () => {
  assert.ok(runTests.includes('test-search-wiring-contract.js'), 'search wiring contract must run in core')
})

check('Q20 认证与家乡筛选已接通', () => {
  assert.ok(page.includes('仅展示实名认证通过的用户'), 'certification toggle is enabled with clear copy')
  assert.ok(page.includes('hometownColumns') && page.includes('hometownCityCode'), 'hometown filter uses the 6-digit code tree')
  assert.ok(mapping.includes('params.certified_only = true'), 'certified_only must be sent to discovery')
  assert.ok(mapping.includes("params.hometown_city_code = '' + input.hometownCityCode"), 'hometown city code must be sent to discovery')
  assert.ok(!page.includes("'小学'"), '小学 not representable in storage domain')
  assert.ok(!page.includes("'技校'"), '技校 not representable in storage domain')
  assert.ok(page.includes('按所选学历及以上筛选'), 'education semantics stated in UI')
})

check('映射模块：学历/婚况/地区/收入均有代码证据来源', () => {
  assert.ok(mapping.includes('educationOptions 数组下标即编号'), 'education domain evidence')
  assert.ok(mapping.includes('marriage_statuses'), 'marriage dictionary evidence')
  assert.ok(mapping.includes('data/location.json'), 'city code source evidence')
  assert.ok(mapping.includes('stopWan * 10000'), 'income unit conversion evidence')
  assert.ok(mapping.includes('respect_preferences'), 'combination semantics documented')
})

check('mapPage 透传 next_cursor 供游标分页', () => {
  assert.ok(discoveryApi.includes('nextCursor: body.next_cursor'), 'cursor passthrough required')
})

// ===== R6/D11 行为回归：真实函数沙箱执行，不只检查源码字符串 =====

// 从页面源码截取一段顶层声明（start 起到 endMarker 止）。
const sliceDecl = (src, startMarker, endMarker) => {
  const start = src.indexOf(startMarker)
  assert.ok(start >= 0, 'source must contain: ' + startMarker)
  const end = endMarker != null ? src.indexOf(endMarker, start + startMarker.length) : -1
  assert.ok(end > start, 'source must contain end marker: ' + endMarker)
  return src.slice(start, end)
}

check('条件输入事件先回写新值再校验（执行 onAiConditionValueInput）', () => {
  let fnSrc = sliceDecl(page, 'const onAiConditionValueInput', 'const setAiConditionAction')
  fnSrc = fnSrc
    .replace('const onAiConditionValueInput = (index: number, event: any)', 'const onAiConditionValueInput = (index, event)')
    .replace(/: any/g, '')
  const condition = {
    localValueType: 'number',
    localValueText: '25',
    localValueInvalid: false,
    localAction: 'pending',
    value: 25,
    actionConditionNo: 0
  }
  const aiConditions = { value: [condition] }
  const aiPatchIdempotencyKey = { value: '' }
  const onAiConditionValueInput = new Function(
    'aiConditions',
    'aiPatchIdempotencyKey',
    fnSrc + '\nreturn onAiConditionValueInput;'
  )(aiConditions, aiPatchIdempotencyKey)
  // 用户把 25 改成 32：本地状态必须真的变成 32。
  onAiConditionValueInput(0, { detail: { value: '32' } })
  assert.equal(condition.localValueText, '32', 'input event must write back the typed value')
  assert.equal(condition.localValueInvalid, false, '32 is a valid number')
  assert.equal(condition.localAction, 'confirmed', 'editing implies confirm intent')
  assert.ok(aiPatchIdempotencyKey.value == '', 'edit must drop the stale patch idempotency key')
  // 非法输入仍被拦截
  onAiConditionValueInput(0, { detail: { value: 'abc' } })
  assert.equal(condition.localValueInvalid, true, 'non-numeric must be marked invalid')
})

check('确认动作请求体携带编辑后的新值（执行 buildAiConditionActions）', () => {
  const condValueText = sliceDecl(page, 'const conditionValueText', 'const setAiDraftResponse')
    .replace('const conditionValueText = (value: any): string =>', 'const conditionValueText = (value) =>')
  const aiCondValue = sliceDecl(page, 'const aiConditionValue', 'const onAiConditionValueInput')
    .replace('const aiConditionValue = (condition: any): any =>', 'const aiConditionValue = (condition) =>')
  let buildActions = sliceDecl(page, 'const buildAiConditionActions', 'const patchAiConditions')
    .replace('const buildAiConditionActions = (): any[] =>', 'const buildAiConditionActions = () =>')
  buildActions = buildActions.replace(/: any\[\]/g, '').replace(/: any/g, '')
  const sandbox = condValueText + '\n' + aiCondValue + '\n' + buildActions + '\nreturn buildAiConditionActions;'
  const condition = {
    localValueType: 'number',
    localValueText: '32',
    localValueInvalid: false,
    localAction: 'confirmed',
    value: 25,
    actionConditionNo: 3
  }
  const removedCondition = {
    localValueType: 'number',
    localValueText: '',
    localValueInvalid: true,
    localAction: 'removed',
    value: null,
    actionConditionNo: 4
  }
  const aiConditions = { value: [condition, removedCondition] }
  const aiDraftError = { value: '' }
  const buildAiConditionActions = new Function('aiConditions', 'aiDraftError', sandbox)(aiConditions, aiDraftError)
  const actions = buildAiConditionActions()
  // 请求体必须携带新值 32（修复前永远发旧值 25）；已移除条件只发 remove，不被旧非法值阻断。
  assert.deepEqual(actions, [
    { condition_no: 3, action: 'edit', value: 32 },
    { condition_no: 4, action: 'remove' }
  ])
})

check('非法保留条件阻断确认并给出可修正提示（执行 buildAiConditionActions）', () => {
  const condValueText = sliceDecl(page, 'const conditionValueText', 'const setAiDraftResponse')
    .replace('const conditionValueText = (value: any): string =>', 'const conditionValueText = (value) =>')
  const aiCondValue = sliceDecl(page, 'const aiConditionValue', 'const onAiConditionValueInput')
    .replace('const aiConditionValue = (condition: any): any =>', 'const aiConditionValue = (condition) =>')
  let buildActions = sliceDecl(page, 'const buildAiConditionActions', 'const patchAiConditions')
    .replace('const buildAiConditionActions = (): any[] =>', 'const buildAiConditionActions = () =>')
  buildActions = buildActions.replace(/: any\[\]/g, '').replace(/: any/g, '')
  const sandbox = condValueText + '\n' + aiCondValue + '\n' + buildActions + '\nreturn buildAiConditionActions;'
  const invalidCondition = {
    localValueType: 'number',
    localValueText: 'abc',
    localValueInvalid: true,
    localAction: 'confirmed',
    value: 25,
    actionConditionNo: 0
  }
  const aiConditions = { value: [invalidCondition] }
  const aiDraftError = { value: '' }
  const buildAiConditionActions = new Function('aiConditions', 'aiDraftError', sandbox)(aiConditions, aiDraftError)
  const actions = buildAiConditionActions()
  assert.deepEqual(actions, [], 'invalid kept condition must block the whole submit')
  assert.notEqual(aiDraftError.value, '', 'user must see the fix-it message')
})

console.log('====================================')
console.log('搜索接线契约测试：' + passed + ' 项全部通过')
