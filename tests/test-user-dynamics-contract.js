// S2 / Q15：他人详情页「Ta的动态」改接后端 mode=user 服务端分页。
//
// 旧实现在广场流里「扫最近 5 页再按作者筛」，不活跃用户的历史动态会整段漏掉，
// 还得靠「可能不完整」的提示兜底。后端 mode=user 上线后改为服务端按人分页：
// 契约分三层——API 请求参数、页面分页状态机、后端路由确实支持该 mode。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pagesSub/userExtra/user/detail.uvue'), 'utf8')
const apiSource = fs.readFileSync(path.join(root, 'api/community.uts'), 'utf8')
const barrelSource = fs.readFileSync(path.join(root, 'api/index.uts'), 'utf8')
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

const tsPlugin = { filename: 'fragment.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }

// ── 页面层片段 ────────────────────────────────────────────────────────
const stateBlock = sliceUntil(source, 'const dynamics = ref(', '// 瞬间：与动态同款')
const pageBlock = sliceUntil(
  source,
  'const loadUserDynamicsPage = async (targetUserId: number)',
  'const refreshLockedView = () =>'
)
const pageCompiled = babel.transformSync(
  '(function () {\n' + stateBlock + '\n' + pageBlock
    + '\nreturn { dynamics, dynamicsExpanded, dynamicsLoading, dynamicsError, dynamicsHasMore,'
    + ' visibleDynamics, canLoadMoreDynamics, showDynamicsSection, dynamicsEmptyText,'
    + ' loadUserDynamics, onDynamicsToggle, onDynamicsLoadMore, DYNAMICS_PAGE_SIZE, DYNAMICS_PREVIEW_COUNT };'
    + '\n})()',
  tsPlugin
).code

// ── API 层片段 ────────────────────────────────────────────────────────
const apiFn = sliceBalanced(apiSource, 'export async function getUserDynamicList')
const apiCompiled = babel.transformSync(
  '(function () {\n' + apiFn.replace('export async function', 'async function')
    + '\nreturn getUserDynamicList;\n})()',
  tsPlugin
).code

const tick = async () => {
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
}

// vm 里造出来的对象/数组带的是另一个 realm 的原型，deepEqual 会误判，先转成宿主对象。
const plain = (v) => JSON.parse(JSON.stringify(v))

// pages 是「页码 → 该页数据」的脚本；calls 记录真实发出的请求。
function pageSandbox(pages, options = {}) {
  const calls = []
  const ctx = {
    ref: (v) => ({ value: v }),
    computed: (fn) => ({ get value() { return fn() } }),
    resolveMediaUrl: (v) => (v == null ? '' : '' + v),
    getUserDynamicList: async (targetUserId, page, pageSize) => {
      calls.push({ targetUserId, page, pageSize })
      if (options.failAt != null && calls.length === options.failAt) return { success: false, message: '动态服务异常' }
      const data = pages[page]
      if (data == null) return { success: true, data: { list: [], hasMore: false, total: 0 } }
      return { success: true, data }
    }
  }
  return { api: vm.runInNewContext(pageCompiled, ctx), calls, ctx }
}

function apiSandbox(responder, overrides = {}) {
  const calls = []
  const ctx = Object.assign({
    USE_MOCK: false,
    okRes: (data) => ({ success: true, data }),
    fetchPostPage: async (params) => {
      calls.push(params)
      return responder(params)
    },
    mockDynamicList: [],
    notBlockedDynamic: () => true,
    cloneList: (list) => list.slice()
  }, overrides)
  return { fn: vm.runInNewContext(apiCompiled, ctx), calls, ctx }
}

const row = (id) => ({
  id, user: { id: 7 }, timeText: '刚刚', content: '内容' + id,
  photos: [], tags: [], topicTitle: '话题' + id, likeCount: 0, commentCount: 0
})
const page = (rows, hasMore, total) => ({ list: rows, hasMore, total: total == null ? rows.length : total })

async function main() {
  // ── A1. API 请求参数必须是 mode=user + target_user_id 服务端分页 ──────
  {
    const t = apiSandbox(() => ({ success: true, data: { list: [row(1)], page: 2, pageSize: 20, total: 45 } }))
    const res = await t.fn(7, 2, 20)
    assert.equal(t.calls.length, 1, '一次调用只发一次请求')
    assert.deepEqual(plain(t.calls[0]), { mode: 'user', target_user_id: 7, page: 2, page_size: 20, sort: 'latest' },
      '必须走后端按人查动态，不能再扫广场流')
    assert.equal(res.success, true)
    assert.equal(res.data.hasMore, true, 'hasMore 由服务端 total 推导：2*20 < 45')
    assert.equal(res.data.total, 45)
    assert.equal(res.data.page, 2)
    assert.equal(res.data.pageSize, 20)
  }

  // ── A2. 末页 hasMore=false；失败原样透传；非法页码收敛 ────────────────
  {
    const t = apiSandbox(() => ({ success: true, data: { list: [row(9)], total: 40 } }))
    const res = await t.fn(7, 2, 20)
    assert.equal(res.data.hasMore, false, '2*20 == 40 时不得谎报还有更多')
  }
  {
    const t = apiSandbox(() => ({ success: false, code: 500, message: '动态服务异常' }))
    const res = await t.fn(7, 1, 20)
    assert.equal(res.success, false, '失败必须透传，不能伪装成空列表')
    assert.equal(res.message, '动态服务异常')
  }
  {
    const t = apiSandbox(() => ({ success: true, data: { list: [], total: 0 } }))
    await t.fn(7, 0, 0)
    assert.equal(t.calls[0].page, 1, '非法页码收敛到第 1 页')
    assert.equal(t.calls[0].page_size, 20, '非法页大小收敛到默认 20（后端上限 50）')
  }
  {
    const t = apiSandbox(() => ({ success: true, data: null }))
    const res = await t.fn(7, 1, 20)
    assert.equal(res.data.list.length, 0, 'data 为空时给空列表而不是抛错')
    assert.equal(res.data.hasMore, false)
  }

  // ── A3. Mock 模式同样按作者分页，不打真实网络 ─────────────────────────
  {
    const mockRows = [
      { id: 1, user: { id: 7 }, time: 30 },
      { id: 2, user: { id: 9 }, time: 20 },
      { id: 3, user: { id: 7 }, time: 10 }
    ]
    const t = apiSandbox(() => { throw new Error('Mock 模式不得请求后端') }, { USE_MOCK: true, mockDynamicList: mockRows })
    const res = await t.fn(7, 1, 2)
    assert.equal(t.calls.length, 0, 'Mock 模式不得发真实请求')
    assert.deepEqual(plain(res.data.list.map((r) => r.id)), [1, 3], 'Mock 也按作者筛并按时间倒序')
    assert.equal(res.data.total, 2)
    assert.equal(res.data.hasMore, false)
  }

  // ── B1. 首屏只发 1 次请求，参数带上目标用户 ───────────────────────────
  {
    const t = pageSandbox({
      1: page([row(1), row(2), row(3)], true, 7),
      2: page([row(4), row(5), row(6), row(7)], false, 7)
    })
    await t.api.loadUserDynamics(7)
    assert.equal(t.calls.length, 1, '首屏只能发 1 次动态请求，不得串行预扫多页')
    assert.deepEqual(plain(t.calls[0]), { targetUserId: 7, page: 1, pageSize: t.api.DYNAMICS_PAGE_SIZE },
      '首屏必须按目标用户查第 1 页')
    assert.equal(t.api.dynamics.value.length, 3, '服务端已按人筛，前端不再二次过滤丢条')
    assert.equal(t.api.dynamics.value[0].topic, '话题1', '话题取后端 topicTitle，不再依赖恒空的 tags')
    assert.equal(t.api.visibleDynamics.value.length, 3, '未展开时最多露 3 条')
    assert.equal(t.api.dynamicsExpanded.value, false, '首屏不展开')
    assert.equal(t.api.canLoadMoreDynamics.value, true, '服务端仍有更多时允许续拉')

    // ── B2. 点展开才续拉，累加不覆盖，收起回到预览 ──────────────────────
    t.api.onDynamicsToggle()
    await tick()
    assert.equal(t.calls.length, 2, '展开时才续拉第 2 页')
    assert.equal(t.calls[1].page, 2, '续拉必须是下一页而不是重扫第 1 页')
    assert.equal(t.calls[1].targetUserId, 7, '续拉仍锁定同一位用户')
    assert.equal(t.api.dynamics.value.length, 7, '续拉结果累加而不覆盖')
    assert.equal(t.api.dynamicsExpanded.value, true, '展开态生效')
    assert.equal(t.api.visibleDynamics.value.length, 7, '展开后露出全部已加载动态')
    assert.equal(t.api.canLoadMoreDynamics.value, false, '服务端说没有更多就是没有更多')
    t.api.onDynamicsToggle()
    assert.equal(t.api.visibleDynamics.value.length, 3, '收起后回到 3 条预览')
    assert.ok(template.includes('没有更多了'), '到底后必须给出明确的结束态')
  }

  // ── B3. 不再写死 5 页上限：服务端说还有就能一直翻 ─────────────────────
  {
    const many = {}
    for (let p = 1; p <= 8; p++) many[p] = page([row(p)], p < 8, 8)
    const t = pageSandbox(many)
    await t.api.loadUserDynamics(7)
    t.api.onDynamicsToggle()
    await tick()
    for (let i = 0; i < 10 && t.api.canLoadMoreDynamics.value; i++) {
      t.api.onDynamicsLoadMore()
      await tick()
    }
    assert.equal(t.calls.length, 8, '翻页上限由服务端 total 决定，不再有客户端 5 页硬顶')
    assert.equal(t.calls[7].page, 8, '页码必须真实递增')
    assert.equal(t.api.dynamics.value.length, 8, '8 页动态全部保留，不丢历史内容')
    assert.equal(t.api.canLoadMoreDynamics.value, false)
    assert.doesNotMatch(source, /DYNAMICS_MAX_SCAN_PAGES|dynamicsTruncated/, '不得保留客户端截断状态')
    assert.doesNotMatch(template, /可能不包含 Ta 更早的内容|继续向后查找/, '服务端分页后不得再挂「扫描范围可能不完整」的兜底文案')
  }

  // ── B4. 真的没有动态 → 整块隐藏，不编造提示 ───────────────────────────
  {
    const t = pageSandbox({ 1: page([], false, 0) })
    await t.api.loadUserDynamics(7)
    assert.equal(t.api.dynamicsHasMore.value, false)
    assert.equal(t.api.dynamicsEmptyText.value, '', '真的没有动态时不编造「可能不完整」')
    assert.equal(t.api.showDynamicsSection.value, false, '整块无内容时隐藏区块，不留空壳')
  }

  // ── B5. 首屏失败 → 错误态 + 重试，不伪装成空态 ────────────────────────
  {
    const t = pageSandbox({ 1: page([row(1)], true, 2) }, { failAt: 1 })
    await t.api.loadUserDynamics(7)
    assert.equal(t.api.dynamicsError.value, '动态服务异常', '失败须给出服务端原因')
    assert.equal(t.api.dynamicsLoading.value, false, '失败后必须解除加载中')
    assert.equal(t.api.showDynamicsSection.value, true, '错误态不得整块消失，否则没有重试入口')
    assert.ok(template.includes('重新加载'), '模板必须提供重新加载入口')
    t.api.onDynamicsLoadMore()
    await tick()
    assert.equal(t.calls.length, 2, '重试须真的再发一次请求')
    assert.equal(t.calls[1].page, 1, '首屏失败后重试仍是第 1 页')
    assert.equal(t.api.dynamicsError.value, '', '重试成功后清除错误')
    assert.equal(t.api.dynamics.value.length, 1, '重试成功后拿到数据')
  }

  // ── B6. 续拉失败：页码不前进，重试补同一页且不重复累加 ────────────────
  {
    const t = pageSandbox({
      1: page([row(1)], true, 2),
      2: page([row(2)], false, 2)
    }, { failAt: 2 })
    await t.api.loadUserDynamics(7)
    t.api.onDynamicsToggle()
    await tick()
    assert.equal(t.api.dynamicsError.value, '动态服务异常', '续拉失败必须可见')
    assert.equal(t.api.dynamics.value.length, 1, '失败不得污染已加载列表')
    assert.equal(t.api.canLoadMoreDynamics.value, true, '失败后仍保留续拉能力')
    t.api.onDynamicsLoadMore()
    await tick()
    assert.equal(t.calls.length, 3)
    assert.equal(t.calls[2].page, 2, '失败页不得被跳过，重试必须补第 2 页')
    assert.deepEqual(plain(t.api.dynamics.value.map((d) => d.id)), [1, 2], '重试成功后按序补齐且不重复')
    assert.equal(t.api.dynamicsError.value, '')
  }

  // ── B7. 切换用户：旧上下文清空，迟到响应整段丢弃 ──────────────────────
  {
    const t = pageSandbox({
      1: page([row(1), row(2), row(3), row(4)], true, 8),
      2: page([row(5)], false, 8)
    })
    await t.api.loadUserDynamics(7)
    t.api.onDynamicsToggle() // 展开并发起第 2 页续拉（在途）
    await t.api.loadUserDynamics(8) // 途中换人
    await tick()
    assert.ok(
      t.api.dynamics.value.every((d) => d.id !== 5),
      '上一位用户在途响应不得写进当前用户的动态列表'
    )
    assert.equal(t.api.dynamicsExpanded.value, false, '换人必须收起展开态')
    assert.equal(t.api.dynamicsError.value, '', '换人必须清掉上一位的错误')
    assert.equal(t.calls[t.calls.length - 1].targetUserId, 8, '换人后必须查新用户')
    assert.equal(t.calls.filter((c) => c.targetUserId === 8).length, 1,
      '在途请求未结束时换人，新用户的首屏请求不得被 loading 守卫吞掉')
    assert.equal(t.api.dynamicsLoading.value, false, '迟到响应不得把新用户卡在加载中')
  }

  // ── C. 结构性契约 ────────────────────────────────────────────────────
  assert.doesNotMatch(source, /getDynamicList\(/, '详情页动态不得再走广场流接口')
  assert.match(source, /import \{[^}]*getUserDynamicList[^}]*\} from '@\/api'/, '必须从 api 桶导入按人查动态')
  assert.match(barrelSource, /^\s*getUserDynamicList,$/m, 'api/index.uts 必须导出 getUserDynamicList')
  assert.doesNotMatch(source, /if \(authorId != targetUserId\) continue/, '作者过滤交给后端，前端不再客户端筛')
  assert.doesNotMatch(source, /page <= 5/, '不得保留固定 5 页串行扫描')
  assert.doesNotMatch(template, /查看全部 \{\{ dynamics\.length \}\}/, '不得把已加载条数说成全量')
  assert.match(source, /let dynamicsRunId = 0/, '必须有代际标记用于丢弃迟到响应')
  assert.match(source, /onUnload\(\(\) => \{ dynamicsRunId\+\+ \}\)/, '离开页面必须作废在途请求')
  assert.match(source, /if \(runId != dynamicsRunId\) return/, '响应回写前必须校验代际')
  assert.match(template, /onDynamicsLoadMore/, '模板续拉入口必须接新的处理函数')
  assert.match(template, /canLoadMoreDynamics/, '模板续拉条件必须接新的计算属性')
  assert.match(source, /\.dynamics-more-footer \{/, '样式类名须与模板一致')
  assert.doesNotMatch(source, /dynamics-scan-footer/, '不得留下失效的扫描样式类')
  // 动态不阻塞资料首屏
  assert.match(source, /loadUserDynamics\(user\.value\.id\)/, '资料加载链里必须调用动态加载')
  assert.doesNotMatch(source, /await loadUserDynamics\(/, '动态加载不得 await 阻塞资料首屏')

  // ── D. 跨仓：后端路由确实支持 mode=user（后端不可达时显式声明缺口）────
  const { readBackend } = require('./helpers/cross-repo.cjs')
  const routes = readBackend('app/api/routes/community.py')
  const service = readBackend('app/services/community.py')
  if (routes == null || service == null) {
    console.log('NOTE 后端源码不可达，跳过 mode=user 跨仓断言（设置 XSA_BACKEND_ROOT 可启用）')
  } else {
    assert.match(routes, /"following_and_liked", "mine", "user"/, '后端 feed 必须接受 mode=user')
    assert.match(routes, /target_user_id: int \| None = Query\(/, '后端必须接受 target_user_id 查询参数')
    assert.match(routes, /if mode == "user" and target_user_id is None:/, 'mode=user 缺作者必须 422，前端不能漏传')
    assert.match(routes, /page_size: int = Query\(20, ge=1, le=50\)/, '前端页大小 20 必须落在后端上限内')
    assert.match(service, /clauses\.append\(" AND p\.user_id = :target_user_id"\)/, '按人查必须在服务端过滤作者')
    assert.match(service, /\{extra_where\}"""/, 'total 必须与列表同一套过滤条件，否则 hasMore 会算错')
  }

  console.log('PASS 用户动态契约：mode=user 服务端分页、首屏 1 页、按需续拉、失败补同页、迟到响应丢弃')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})