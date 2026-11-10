const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const page = fs.readFileSync(path.join(root, 'pagesSub/community/notifications.uvue'), 'utf8')
const api = fs.readFileSync(path.join(root, 'api/community.uts'), 'utf8')
const apiIndex = fs.readFileSync(path.join(root, 'api/index.uts'), 'utf8')

// 列表必须走服务端分类 + 分页，而不是拉第一页后在本地过过滤。
assert.ok(api.includes('export async function getCommunityNotificationPage'), 'notifications must expose a paged API')
assert.ok(api.includes('if (category != \'\') data.category = category'), 'category must be sent to /notifications')
assert.ok(api.includes("url: '/notifications'"), 'notifications endpoint must stay wired')
assert.ok(page.includes('getCommunityNotificationPage('), 'page must load notifications through the paged API')
assert.ok(!page.includes('getCommunityNotifications('), 'page must not fall back to the single-page loader')
assert.ok(!page.includes('filteredList'), 'page must not filter a single page locally by type')

// 未读角标必须来自服务端分类汇总。
assert.ok(api.includes("url: '/notifications/unread-summary'"), 'unread summary endpoint must be wired')
assert.ok(apiIndex.includes('getNotificationUnreadSummary'), 'summary helper must be exported from @/api')
assert.ok(page.includes('getNotificationUnreadSummary('), 'page must read the unread summary')
assert.ok(page.includes('byCategory'), 'tab badges must come from by_category')
assert.ok(page.includes('tabBadge('), 'tabs must render unread badges')

// 分页与加载态。
assert.ok(page.includes('@scrolltolower="loadMore"'), 'list must paginate on scroll')
assert.ok(page.includes('const hasMore = computed(() => (list.value as any[]).length < total.value)'), 'hasMore must compare against server total')
assert.ok(page.includes('loadingMore'), 'load-more state must be rendered')

// 活动 Tab 仍只展示官方活动通知。
assert.ok(page.includes('n.isOfficialActivity == true'), 'activity tab must keep the official-only product rule')

console.log('通知分类与未读契约测试通过')
