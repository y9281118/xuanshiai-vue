const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { readBackend } = require('./helpers/cross-repo.cjs')

const root = path.resolve(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const api = read('api/community.uts')
const page = read('pagesSub/community/notifications.uvue')
const index = read('api/index.uts')

// 按顶层花括号配对截出单个函数体：community.uts 里 `page_size: 50` 在评论/话题/
// 纸飞机等无关接口上也存在，必须精确到通知列表函数再断言。
const sliceFn = (src, signature) => {
  const start = src.indexOf(signature)
  if (start < 0) return ''
  const open = src.indexOf('{', start)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return src.slice(start)
}

const listFn = sliceFn(api, 'export async function getCommunityNotifications(')
const countFn = sliceFn(api, 'export async function getUnreadNotificationCount(')

// —— 缺陷背景（2026-11-11）——
// 通知页固定拉 page=1&page_size=50 后在本地按 type 筛选：超过 50 条的账号，
// 较旧的匹配通知永远进不了那一页；未读数也走列表接口取总 unread_count，
// 拿不到分类未读，于是「已匹配但列表里看不到 / 角标对不上」无从核对。

// 1) 列表接口必须把分类与分页交给服务端。
assert.ok(
  /export async function getCommunityNotifications\([\s\S]{0,220}?category: string = ''/.test(api),
  'getCommunityNotifications 必须接受 category，否则筛选只能留在本地',
)
assert.ok(listFn.length > 0, '没找到 getCommunityNotifications 函数体')
assert.ok(
  listFn.includes("if (category != '') query.category = category"),
  '分类条件必须拼进 /notifications 的查询串',
)
assert.ok(
  listFn.includes('page_size: pageSize'),
  '每页条数必须由入参决定',
)
assert.ok(
  !listFn.includes('page_size: 50'),
  '通知列表不得再固定拉 50 条——这正是较旧匹配通知被挤掉的原因',
)
assert.ok(
  !listFn.includes('page: 1, page_size'),
  '通知列表不得再把页码写死为 1',
)
assert.ok(countFn.length > 0, '没找到 getUnreadNotificationCount 函数体')
const summaryIndex = countFn.indexOf('getUnreadNotificationSummary()')
const legacyIndex = countFn.indexOf("url: '/notifications'")
assert.ok(summaryIndex >= 0, '总未读数应优先由分类汇总接口派生')
assert.ok(
  legacyIndex < 0 || summaryIndex < legacyIndex,
  '列表接口只能作为「后端尚未部署 unread-summary」的兜底，不能排在汇总之前',
)

assert.ok(
  /const cat = notificationCategoryOf\(item\)/.test(api),
  'mock 数据只有 type 没有 category，分类过滤必须走同一个兜底，否则 mock 模式下列表恒空',
)

// 2) 未读汇总必须走服务端分类接口，且与列表筛选同源。
assert.ok(
  api.includes('export async function getUnreadNotificationSummary('),
  '缺少分类未读汇总封装，前端无法显示或校验分类角标',
)
assert.ok(
  api.includes("url: '/notifications/unread-summary'"),
  '汇总接口路径必须是 /notifications/unread-summary',
)
assert.ok(
  /export async function getUnreadNotificationCount\(\)[\s\S]{0,260}?getUnreadNotificationSummary\(\)/.test(api),
  '总未读数应由汇总接口派生，保证与分类角标同源',
)
assert.ok(
  index.includes('getUnreadNotificationSummary,'),
  '新接口需要从 api/index.uts 导出，页面才能 import',
)

// 3) 分页响应要归一成页对象（items/page/pageSize/total/unreadCount/hasMore）。
assert.ok(
  api.includes('function normalizeNotificationPage(raw: any, page: number, pageSize: number): any {'),
  '分页响应需要统一归一，避免页面里手抄字段名',
)
assert.ok(
  api.includes('hasMore: current * size < total'),
  'hasMore 必须由 total 推出，否则滚动到底无法判断是否还有下一页',
)

// 4) 通知页：按 Tab 传分类、滚动到底续拉、不再本地过滤已分页数据。
assert.ok(
  page.includes('getCommunityNotifications(1, PAGE_SIZE, currentCategory())'),
  '首屏必须带分类请求',
)
assert.ok(
  page.includes('getCommunityNotifications(next, PAGE_SIZE, currentCategory())'),
  '翻页同样要带分类，否则第二页会混进其它分类',
)
assert.ok(
  /const switchTab = \(tab: string\)[\s\S]{0,320}?load\(\)/.test(page),
  '切换 Tab 必须重新向服务端取该分类的首页',
)
assert.ok(
  page.includes('@scrolltolower="loadMore"'),
  '列表需要滚动到底续拉，50 条之后的旧通知才有入口',
)
assert.ok(
  page.includes('const loadMore = async () =>'),
  '缺少 loadMore 实现',
)
assert.ok(
  !page.includes('filteredList'),
  '不得再对已分页的列表做本地 type 过滤（会漏掉未进入当前页的通知）',
)
assert.ok(
  /const currentCategory = \(\): string => \{[\s\S]{0,160}?if \(currentTab\.value == 'all'\) return ''/.test(page),
  '「全部」Tab 必须不带 category，其余 Tab 名即分类名',
)
assert.ok(
  /if \(currentTab\.value == 'all'\) return ''\s*return currentTab\.value/.test(page),
  '分类映射应退化为「Tab 名 == 分类名」，避免每加一个分类就要改一处 if',
)
assert.ok(
  api.includes("(row.category != null && '' + row.category == 'match')"),
  '归一化要认服务端 category，否则 match_application 不会落进匹配 Tab',
)

// 社区可见分类 Tab 全覆盖（+ 全部）：后端仍是七桶，但私信 / 匹配由「消息」页
// 承接，社区页只建 5 类入口，列表与「全部」角标同步排除这两类，
// 否则社区入口角标会包含本页看不到的提醒（清不掉的根因）。
const TABS = ['all', 'comment', 'like', 'follow', 'activity', 'system']
for (const tab of TABS) {
  assert.ok(page.includes(`switchTab('${tab}')`), `缺少 ${tab} Tab 入口`)
  assert.ok(page.includes(`unreadOf('${tab}')`), `${tab} Tab 缺少未读角标`)
}
assert.ok(
  page.includes('if (key == \'all\') return unreadTotal.value'),
  '「全部」角标必须用汇总里的社区口径总数，才能与社区入口角标同源',
)
assert.ok(
  /const payload = res\.data as any[\s\S]{0,260}?unreadTotal\.value = payload\.visibleTotal/.test(page),
  'loadUnread 必须把 summary.visibleTotal 落进 unreadTotal',
)
assert.ok(
  api.includes('function visibleUnreadTotal'),
  '汇总必须扣掉消息页承接的两类未读',
)
assert.ok(
  /getUnreadNotificationCount\(\)[\s\S]{0,600}?data\.visibleTotal/.test(api),
  '社区入口角标必须与通知页共用社区口径总数',
)
assert.ok(
  !/tab == 'activity' && n\.isOfficialActivity != true/.test(page),
  '活动 Tab 不得再只留官方活动——否则角标是整分类、列表是子集',
)

// 5) Tab 角标来自分类未读汇总。
assert.ok(
  page.includes('getUnreadNotificationSummary'),
  '页面需要读取分类未读汇总来渲染角标',
)
assert.ok(
  !page.includes("unreadOf('match')") && !page.includes("unreadOf('message')"),
  '私信 / 匹配 Tab 已移除，不得再渲染对应角标',
)
assert.ok(
  page.includes('isCommunityNotificationVisible(n)'),
  '页面必须对消息页承接的两类做兜底过滤',
)
assert.ok(
  page.includes('const unreadOf = (key: string): number =>'),
  '分类角标取值应集中一处，避免每个 Tab 各写一遍',
)
assert.ok(/\.tab-badge\s*\{/.test(page), '角标样式缺失')

// 6) 已读操作后必须刷新角标，否则点了还在亮。
assert.ok(
  /const markAll = async \(\)[\s\S]{0,700}?loadUnread\(\)/.test(page),
  '全部已读之后要刷新分类未读',
)
assert.ok(
  /const open = async \(n: any\)[\s\S]{0,600}?loadUnread\(\)/.test(page),
  '单条已读之后要刷新分类未读',
)

// 7) 分类桶与兜底映射必须与后端同源（跨仓对等）。
const notifPy = readBackend('app/services/notifications.py')
if (notifPy == null) {
  console.log('WARN 后端源码不可达，跳过 NOTIFICATION_CATEGORIES 跨仓对等校验')
} else {
  const tupleStart = notifPy.indexOf('NOTIFICATION_CATEGORIES')
  assert.ok(tupleStart >= 0, '后端缺少 NOTIFICATION_CATEGORIES')
  const tupleBlock = notifPy.slice(tupleStart, notifPy.indexOf('\n)', tupleStart))
  const backendCategories = [...tupleBlock.matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort()
  assert.deepStrictEqual(
    backendCategories,
    ['activity', 'comment', 'follow', 'like', 'match', 'message', 'system'],
    '后端七桶与本用例假设不一致，需同步前端 Tab',
  )
  // 后端七桶保持不变，但社区页只承接其中 5 类；message/match 必须没有 Tab。
  const communityTabs = ['comment', 'like', 'follow', 'activity', 'system']
  for (const category of communityTabs) {
    assert.ok(page.includes(`switchTab('${category}')`), `社区可见分类 ${category} 没有对应 Tab`)
  }
  for (const hidden of ['message', 'match']) {
    assert.ok(!page.includes(`switchTab('${hidden}')`), `${hidden} 由消息页承接，社区页不得建 Tab`)
  }

  const mapStart = notifPy.indexOf('NOTIFICATION_CATEGORY_BY_TYPE')
  const mapBlock = notifPy.slice(mapStart, notifPy.indexOf('\n}', mapStart))
  const backendPairs = [...mapBlock.matchAll(/"([a-z_0-9]+)"\s*:\s*"([a-z]+)"/g)]
    .map((m) => ({ type: m[1], category: m[2] }))
  assert.ok(backendPairs.length >= 15, `后端类型映射解析过少（${backendPairs.length}）`)
  // 前端 categoryOfType 的默认分支就是 system，所以 system 类类型不要求显式列出；
  // 其余分类必须逐个写明，否则旧后端/mock 下会被误落 system。
  const missingTypes = backendPairs
    .filter((pair) => pair.category != 'system')
    .map((pair) => pair.type)
    .filter((type) => !api.includes(`'${type}'`))
  assert.deepStrictEqual(
    missingTypes,
    [],
    `前端 notificationCategoryOfType 漏了这些类型，旧后端/mock 下会误落 system：${missingTypes.join(', ')}`,
  )
}

// 8) 分类兜底只能有一份实现：页面不得自己再维护一张 type→category 表。
assert.ok(
  api.includes('export function notificationCategoryOfType('),
  '分类兜底映射应集中在 api 层，供 mock 与页面共用',
)
assert.ok(
  index.includes('notificationCategoryOf,'),
  'notificationCategoryOf 需要从 api/index.uts 导出',
)
assert.ok(
  page.includes('return notificationCategoryOf(n) == tab'),
  '页面的分类判断必须复用 api 层的口径，避免两套映射漂移',
)

console.log('通知分类分页契约（6 个 Tab / 社区可见分类 / 服务端 category / 滚动续拉 / 分类未读角标）测试通过')
