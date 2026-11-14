const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const chatPage = fs.readFileSync(path.join(root, 'pagesSub/chat/detail.uvue'), 'utf8')
const messageApi = fs.readFileSync(path.join(root, 'api/message.uts'), 'utf8')
const apiIndex = fs.readFileSync(path.join(root, 'api/index.uts'), 'utf8')

function includes(source, value, label) {
  assert.ok(source.includes(value), `${label} should include ${value}`)
}

// 入口：+ 面板 4 列宫格，紧跟「联系方式」之后；父母端隐藏。
includes(chatPage, '@click="openMeetingApply"', 'meeting apply grid entry')
includes(chatPage, '♡', 'meeting apply grid icon glyph')
includes(chatPage, '约见申请', 'meeting apply label')
includes(chatPage, 'meetingApplyDisabled', 'entry disabled state')
includes(chatPage, 'meetingApplyLabel', 'agreed read-only label')
assert.ok(
  chatPage.indexOf('@click="openContactExchange"') < chatPage.indexOf('@click="openMeetingApply"'),
  'meeting apply should sit right after the contact exchange entry'
)

// 二次确认：取消不产生请求；主按钮 500ms 内防重复提交。
includes(chatPage, 'title="约见申请"', 'confirm modal title')
includes(chatPage, 'confirm-text="申请约见"', 'confirm button copy')
includes(chatPage, 'cancel-text="取消"', 'cancel button copy')
includes(chatPage, '若在平台点击「申请约见」，红娘会为你们安排见面。', 'confirm body copy')
includes(chatPage, '提交后红娘将收到你们的申请，请留意红娘来电。', 'confirm helper copy')
includes(chatPage, 'now - meetingApplyLastSubmitAt < 500', '500ms debounce on submit')
includes(chatPage, ':confirm-loading="meetingApplySubmitting"', 'loading state on confirm')

// 会话内卡片：双方视角、状态标签、同意/拒绝/撤回、终态只读、状态兜底。
includes(chatPage, "message.type === 'meeting-apply'", 'meeting card render branch')
includes(chatPage, 'class="meeting-card"', 'meeting card container')
includes(chatPage, 'meetingApplyStatusLabel', 'status label mapping')
includes(chatPage, 'meetingApplyTargetLabel', 'sender/receiver perspective copy')
includes(chatPage, 'meetingApplyBody', 'card body copy')
includes(chatPage, 'meetingApplySubtitle', 'result subtitle copy')
includes(chatPage, 'meetingApplyActions', 'card action list')
includes(chatPage, "'撤回申请'", 'sender cancel action')
includes(chatPage, "'联系红娘'", 'sender matchmaker action')
includes(chatPage, "'拒绝'", 'receiver refuse action')
includes(chatPage, "'同意'", 'receiver agree action')
includes(chatPage, '@click.stop="onMeetingApplyAction', 'card actions must not trigger card refresh')
includes(chatPage, '@click="refreshMeetingApplies"', 'card exposure fallback refresh')
includes(chatPage, 'syncMeetingApplyMessage(cachedMeeting != null ? cachedMeeting.active : null)', 'card re-attached after history reload')
includes(chatPage, '.meeting-card-action-primary', 'primary action style')
includes(chatPage, 'var(--accent)', 'inherits chat page accent token')
assert.ok(!chatPage.includes('#FF5A8C'), 'no off-domain hardcoded pink from the date-service page')

// 复用一期线下约见契约：不另建 /meet/apply 申请单与状态机。
includes(messageApi, "url: '/matchmaker/meetings/requests'", 'create uses existing meeting request endpoint')
includes(messageApi, "url: '/matchmaker/meetings/requests/mine'", 'state lookup uses existing mine endpoint')
includes(messageApi, "'/matchmaker/meetings/requests/' + applyId", 'handle uses existing patch endpoint')
assert.ok(!messageApi.includes('/meet/apply'), 'must not introduce a parallel meeting apply API')
for (const name of ['createMeetingApply', 'getMeetingApplies', 'handleMeetingApply', 'getMeetingApplyState']) {
  assert.match(messageApi, new RegExp(`export async function ${name}\\b`), `${name} must be implemented`)
  assert.ok(apiIndex.includes(name), `${name} must be exported from api/index.uts`)
}
for (const status of ['SUBMITTED', 'CONTACTED', 'ACCEPTED', 'DECLINED', 'CLOSED']) {
  includes(messageApi, `'${status}'`, `meeting request status ${status}`)
}

// 后端 update_meeting_request 对 DECLINED / CLOSED 强制 reason 非空（否则 422）。
// 「撤回申请」和「拒绝时不填原因」都必须由客户端补齐，不能发空 body。
includes(
  messageApi,
  "data.reason = status == 'CLOSED' ? '发起方主动撤回申请' : '对方未填写原因'",
  'empty reason must be backfilled for cancel and refuse'
)
assert.match(
  messageApi,
  /else if \(status == 'DECLINED' \|\| status == 'CLOSED'\)/,
  'reason backfill must cover both decline and cancel'
)

console.log('约见申请契约测试通过')
