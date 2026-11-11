// FE-33-01a / Q15：他人详情页「Ta的动态」的加载正确性。
//
// 后端暂无 mode=user 动态接口，前端只能在广场流里按作者筛。原实现首屏串行扫 5 页
// 并把扫到的条数说成「查看全部 N 条」，既拖慢首屏又对扫描范围撒谎。
// 契约：首屏只发 1 次请求；展开才续拉；触顶且服务端仍有更多时明确告知可能不完整；
// 切换用户/离开页面后迟到的响应整段丢弃。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pagesSub/userExtra/user/detail.uvue'), 'utf8')
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

function sliceUntil(src, marker, endMarker) {
  const start = src.indexOf(marker)
  const end = src.indexOf(endMarker, start + marker.length)
  assert.ok(start >= 0 && end > start, '源码缺少区间：' + marker + ' → ' + endMarker)
  return src.slice(start, end)
}

const stateBlock = sliceUntil(source, 'const dynamics = ref(', '// 瞬间：与动态同款')
const scanBlock = sliceUntil(
  source,
  'const scanUserDynamicsPage = async (targetUserId: number)',
  'const refreshLockedView = () =>'
)

const compiled = babel.transformSync(
  '(function () {\n' + stateBlock + '\n' + scanBlock
    + '\nreturn { dynamics, dynamicsExpanded, dynamicsLoading, dynamicsError, dynamicsHasMore, dynamicsTruncated,'
    + ' visibleDynamics, canScanMoreDynamics, showDynamicsSection, dynamicsEmptyText,'
    + ' loadUserDynamics, onDynamicsToggle, onDynamicsScanMore, DYNAMICS_TRUNCATED_NOTE, DYNAMICS_SCAN_PAGE_SIZE, DYNAMICS_MAX_SCAN_PAGES };'
    + '\n})()',
  { filename: 'fragment.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }
).code

// pages 是「广场页码 → 该页数据」的脚本；calls 记录真实发出的请求。
function sandbox(pages, options = {}) {
  const calls = []
  const ctx = {
    ref: (v) => ({ value: v }),
    computed: (fn) => ({ get value() { return fn() } }),
    resolveMediaUrl: (v) => (v == null ? '' : '' + v),
    getDynamicList: async (params) => {
      calls.push(params)
      if (options.failAt != null && calls.length === options.failAt) return { success: false, message: '动态服务异常' }
      const page = pages[params.page]
      if (page == null) return { success: true, data: { list: [], hasMore: false } }
      return { success: true, data: page }
    }
  }
  const api = vm.runInNewContext(compiled, ctx)
  return { api, calls, ctx }
}

const row = (id, authorId) => ({
  id, user: { id: authorId }, timeText: '刚刚', content: '内容' + id,
  photos: [], tags: [], likeCount: 0, commentCount: 0
})
const page = (rows, hasMore) => ({ list: rows, hasMore })

async function main() {
  // ── 1. 首屏只发 1 次请求，且只按目标作者筛 ──────────────────────────
  {
    const t = sandbox({
      1: page([row(1, 7), row(2, 9), row(3, 7)], true),
      2: page([row(4, 7), row(5, 7), row(6, 7), row(7, 7)], true)
    })
    await t.api.loadUserDynamics(7)
    assert.equal(t.calls.length, 1, '首屏只能发 1 次动态请求，不得串行预扫多页')
    assert.equal(t.calls[0].page, 1, '首屏从第 1 页开始')
    assert.equal(t.calls[0].pageSize, t.api.DYNAMICS_SCAN_PAGE_SIZE, '扫描页大小须用统一常量')
    assert.equal(t.api.dynamics.value.length, 2, '只收目标作者的动态')
    assert.equal(t.api.visibleDynamics.value.length, 2, '未展开时最多露 3 条')
    assert.equal(t.api.dynamicsExpanded.value, false, '首屏不展开')
    assert.equal(t.api.canScanMoreDynamics.value, true, '服务端仍有更多时允许续拉')

    // ── 2. 点展开才续拉，且预览截断到 3 条 ────────────────────────────
    t.api.onDynamicsToggle()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    assert.equal(t.calls.length, 2, '展开时才续拉第 2 页')
    assert.equal(t.calls[1].page, 2, '续拉必须是下一页而不是重扫第 1 页')
    assert.equal(t.api.dynamics.value.length, 6, '续拉结果累加而不覆盖')
    assert.equal(t.api.dynamicsExpanded.value, true, '展开态生效')
    assert.equal(t.api.visibleDynamics.value.length, 6, '展开后露出全部已加载动态')
    t.api.onDynamicsToggle()
    assert.equal(t.api.visibleDynamics.value.length, 3, '收起后回到 3 条预览')
  }

  // ── 3. 触顶且服务端仍有更多 → 明确告知可能不完整 ─────────────────────
  {
    const many = {}
    for (let p = 1; p <= 8; p++) many[p] = page([row(p, 99)], true)
    const t = sandbox(many)
    await t.api.loadUserDynamics(7)
    for (let i = 0; i < 10 && t.api.canScanMoreDynamics.value; i++) {
      t.api.onDynamicsScanMore()
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))
    }
    assert.equal(t.calls.length, t.api.DYNAMICS_MAX_SCAN_PAGES, '扫描页数不得无上限增长')
    assert.equal(t.api.dynamicsTruncated.value, true, '触顶且 hasMore 仍为真时必须标记截断')
    assert.equal(t.api.canScanMoreDynamics.value, false, '截断后不再提供无限续拉')
    assert.equal(t.api.dynamics.value.length, 0, '这些页里没有目标作者的动态')
    assert.equal(
      t.api.dynamicsEmptyText.value,
      '已加载的广场动态里没有 Ta 的内容，更早的动态暂时查不到',
      '截断空态必须区别于「还没有动态」'
    )
    assert.ok(t.api.DYNAMICS_TRUNCATED_NOTE.includes('可能不包含 Ta 更早的内容'), '截断提示须诚实说明范围')
    assert.ok(template.includes('DYNAMICS_TRUNCATED_NOTE'), '模板必须渲染截断提示')
  }

  // ── 4. 空态与截断态互斥；加载中不得同时显示错误 ──────────────────────
  {
    const t = sandbox({ 1: page([], false) })
    await t.api.loadUserDynamics(7)
    assert.equal(t.api.dynamicsHasMore.value, false, '服务端说没有更多就是没有更多')
    assert.equal(t.api.dynamicsTruncated.value, false, '没有更多时不算截断')
    assert.equal(t.api.dynamicsEmptyText.value, '', '真的没有动态时不编造「可能不完整」')
    assert.equal(t.api.showDynamicsSection.value, false, '整块无内容时隐藏区块，不留空壳')
  }

  // ── 5. 断网/接口失败 → 错误态 + 重试，不伪装成空态 ────────────────────
  {
    const t = sandbox({ 1: page([row(1, 7)], true) }, { failAt: 1 })
    await t.api.loadUserDynamics(7)
    assert.equal(t.api.dynamicsError.value, '动态服务异常', '失败须给出服务端原因')
    assert.equal(t.api.dynamicsLoading.value, false, '失败后必须解除加载中')
    assert.equal(t.api.showDynamicsSection.value, true, '错误态不得整块消失，否则没有重试入口')
    assert.ok(template.includes('重新加载'), '模板必须提供重新加载入口')
    t.api.onDynamicsScanMore()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    assert.equal(t.calls.length, 2, '重试须真的再发一次请求')
    assert.equal(t.api.dynamicsError.value, '', '重试成功后清除错误')
    assert.equal(t.api.dynamics.value.length, 1, '重试成功后拿到数据')
  }

  // ── 6. 切换用户：旧上下文清空，迟到响应整段丢弃 ──────────────────────
  {
    const t = sandbox({ 1: page([row(1, 7), row(2, 7), row(3, 7), row(4, 7)], true) })
    await t.api.loadUserDynamics(7)
    t.api.onDynamicsToggle() // 展开并发起第 2 页续拉（在途）
    await t.api.loadUserDynamics(8) // 途中换人
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    assert.ok(
      t.api.dynamics.value.every((d) => d.id !== 4) || t.api.dynamics.value.length === 0,
      '上一位用户在途响应不得写进当前用户的动态列表'
    )
    assert.equal(t.api.dynamicsExpanded.value, false, '换人必须收起展开态')
    assert.equal(t.api.dynamicsError.value, '', '换人必须清掉上一位的错误')
  }

  // ── 7. 结构性契约：不再写死 5 页串行扫描，不再谎报总条数 ──────────────
  assert.doesNotMatch(source, /page <= 5/, '不得保留固定 5 页串行扫描')
  assert.doesNotMatch(template, /查看全部 \{\{ dynamics\.length \}\}/, '不得把客户端扫描到的条数说成全量')
  assert.match(source, /let dynamicsRunId = 0/, '必须有代际标记用于丢弃迟到响应')
  assert.match(source, /onUnload\(\(\) => \{ dynamicsRunId\+\+ \}\)/, '离开页面必须作废在途扫描')
  assert.match(source, /if \(runId != dynamicsRunId\) return/, '响应回写前必须校验代际')
  // 动态不阻塞资料首屏
  assert.match(source, /loadUserDynamics\(user\.value\.id\)/, '资料加载链里必须调用动态加载')
  assert.doesNotMatch(source, /await loadUserDynamics\(/, '动态加载不得 await 阻塞资料首屏')

  console.log('PASS 用户动态契约：首屏 1 页、按需续拉、截断诚实、失败可重试、迟到响应丢弃')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})