// 通知列表必须走「服务端分类 + 服务端分页 + 服务端分类未读」的单一实现。
//
// 本文件来自 origin/main 的并行实现（`f88fd59 feat(通知)`）。合并时本地已有的
// 实现（`getCommunityNotifications(page,pageSize,category)` +
// `getUnreadNotificationSummary()` + `notificationCategoryOf()`）胜出，两套 API
// 已在 `api/community.uts` 收敛成一套（并行的 `getCommunityNotificationPage` /
// `getNotificationUnreadSummary` 已删除：除本测试外没有调用方）。断言按本地口径
// 重写，但**契约意图不变**：不许退回「拉第一页再本地过滤」。
//
// 两处有意偏离远端旧断言：
// 1. 活动 Tab 不再只展示官方活动。原口径下角标按整分类计数、列表只留官方活动，
//    会自相矛盾（角标非 0 而列表为空）；产品已定「7 类全建 Tab + 全部」，
//    角标与列表同源（都按 category）。
// 2. Tab 数量：7 个分类 + 「全部」共 8 个。只建 4 个会让关注/私信/系统三类通知
//    在页面上不可见（实测 user 21：total=13 而页面只能看到 6 条）。

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const page = fs.readFileSync(path.join(root, 'pagesSub/community/notifications.uvue'), 'utf8')
const api = fs.readFileSync(path.join(root, 'api/community.uts'), 'utf8')
const apiIndex = fs.readFileSync(path.join(root, 'api/index.uts'), 'utf8')

// ---- 列表：服务端分类 + 服务端分页 ----
assert.ok(
  api.includes('export async function getCommunityNotifications('),
  'notifications must expose a paged API'
)
assert.ok(
  api.includes('if (category != \'\') query.category = category'),
  'category must be sent to /notifications'
)
assert.ok(api.includes("url: '/notifications'"), 'notifications endpoint must stay wired')
assert.ok(page.includes('getCommunityNotifications('), 'page must load notifications through the paged API')
assert.ok(
  !page.includes('getCommunityNotificationPage('),
  'page must not depend on the removed parallel implementation'
)
assert.ok(!page.includes('filteredList'), 'page must not filter a single page locally by type')
assert.ok(
  api.includes('export function notificationCategoryOf('),
  '分类兜底必须收敛到 api/community.uts 的唯一实现'
)

// ---- 未读角标：服务端分类汇总 ----
assert.ok(api.includes("url: '/notifications/unread-summary'"), 'unread summary endpoint must be wired')
assert.ok(apiIndex.includes('getUnreadNotificationSummary,'), 'summary helper must be exported from @/api')
assert.ok(page.includes('getUnreadNotificationSummary('), 'page must read the unread summary')
assert.ok(page.includes('unreadByCategory'), 'tab badges must come from by_category')
assert.ok(page.includes('unreadOf('), 'tabs must render unread badges')
// 「全部」角标取服务端 total，不是把七分类相加（相加会漏掉未登记类型）。
assert.ok(page.includes('unreadTotal'), 'all-tab badge must use the server total')

// ---- 分页与加载态 ----
assert.ok(page.includes('@scrolltolower="loadMore"'), 'list must paginate on scroll')
assert.ok(page.includes('hasMore'), 'hasMore must drive the load-more guard')
assert.ok(page.includes('loadingMore'), 'load-more state must be rendered')

// ---- 7 个分类 Tab 全覆盖（+ 全部） ----
for (const category of ['comment', 'like', 'follow', 'message', 'match', 'activity', 'system']) {
  assert.ok(
    page.includes(`switchTab('${category}')`),
    `missing tab for backend category: ${category}`
  )
}
assert.ok(!api.includes('export async function getCommunityNotificationPage'), 'parallel API must stay removed')
// 活动 Tab 保留分类口径（角标与列表同源），不再只留官方活动。
assert.ok(
  !page.includes("tab == 'activity' && n.isOfficialActivity != true"),
  'activity tab must not drop non-official rows; badge and list must share one filter'
)

// 撤回通知（message_recalled）与会话请求的 target_type 是 chat_session / chat_session_request，
// 只带 session_id 不带对方 userId。以前没有对应分支，点进去必然落到「该通知关联内容已不可查看」。
assert.ok(
  page.includes("item.targetType == 'chat_session'"),
  'chat_session notifications (message_recalled) must route to the message list'
)
assert.ok(
  page.includes("item.targetType == 'chat_session_request'"),
  'chat_session_request notifications must route to the message list'
)

console.log('通知分类与未读契约测试通过')
