const assert = require('node:assert/strict')
const fs = require('node:fs')

const page = fs.readFileSync('pagesSub/matchmaker/become-matchmaker.uvue', 'utf8')
const sheet = fs.readFileSync('pagesSub/matchmaker/components/MatchmakerServiceNavSheet.uvue', 'utf8')

assert.ok(sheet.includes("@click=\"pick('activity')\""), '服务导航须保留相亲活动入口')
assert.ok(page.includes('getActivities'), '入口须读取真实活动，不能跳转虚构详情')
assert.ok(page.includes("getActivities('recruiting')"), '入口应优先选择可报名活动')
assert.ok(page.includes("openPage('/pagesSub/community/activity-detail?id=' + String(activityId))"), '入口须直接打开活动详情')
assert.ok(page.includes("if (key == 'activity') { openServiceActivityDetail(); return }"), '相亲活动菜单项须走详情跳转')
assert.ok(page.includes("openPage('/pagesSub/community/activity-list')"), '无可报名活动时须可回退到活动列表')

console.log('Matchmaker service navigation activity checks passed')
