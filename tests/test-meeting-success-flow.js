const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

const modal = read('components/XsaMeetingSuccessModal.uvue')
const chatPage = read('pagesSub/chat/detail.uvue')
const applications = read('pagesSub/profileExtra/applications.uvue')
const pagesJson = read('pages.json')

function includes(source, value, label) {
  assert.ok(source.includes(value), `${label} should include ${value}`)
}

// 成功弹窗：参考稿的三步进度 + 服务老师微信 + 知道了 + 我的约会入口。
includes(modal, '百聊不如一见', 'modal headline')
includes(modal, '已成功提交约见申请', 'step 1')
includes(modal, '等待红娘联系沟通', 'step 2')
includes(modal, '撮合安排双方线下见面', 'step 3')
includes(modal, '主动联系您的服务老师', 'service teacher hint')
includes(modal, '知道了', 'primary dismiss button')
includes(modal, '我的约会 ›', 'my dates entry')
includes(modal, "url: '/pagesSub/profileExtra/my-date-service'", 'my dates navigation target')
includes(modal, "emit('close')", 'modal close event')
includes(modal, '服务老师微信待配置', 'honest fallback when no wechat is configured')
includes(modal, 'var(--plane-purple)', 'reuse existing purple token instead of a new hard-coded palette')
assert.ok(pagesJson.includes('"path": "my-date-service"'), 'my-date-service route must be registered')

// 聊天页：约见申请成功后改为弹引导，而不是一句 Toast 就结束。
includes(chatPage, "import XsaMeetingSuccessModal from '@/components/XsaMeetingSuccessModal.uvue'", 'chat page imports success modal')
includes(chatPage, '<XsaMeetingSuccessModal', 'chat page renders success modal')
includes(chatPage, 'meetingSuccessVisible.value = true', 'successful apply opens the modal')

// 我的申请页：已同意的认识申请卡片，主按钮改「撮合见面」并走约见申请。
includes(applications, "import XsaMeetingSuccessModal from '@/components/XsaMeetingSuccessModal.uvue'", 'applications page imports success modal')
includes(applications, 'createMeetingApply', 'applications page uses the meeting apply API')
includes(applications, 'const requestMeeting = async', 'meeting request handler')
includes(applications, '<XsaMeetingSuccessModal', 'applications page renders success modal')
includes(applications, 'meetingSuccessVisible.value = true', 'successful request opens the modal')
const meetingButtons = (applications.match(/@tap="requestMeeting\(item\)"/g) || []).length
assert.strictEqual(meetingButtons, 2, 'both outgoing and incoming accepted cards should offer 撮合见面')
assert.ok(applications.includes('<text>撮合见面</text>'), 'button copy should be 撮合见面')
assert.ok(!applications.includes('<text>开始聊天</text>'), 'the old 开始聊天 button copy should be gone')
// 同意认识后的自动跳聊天是另一个动作，保留 startChat 不被误删。
includes(applications, 'const startChat = async', 'agree-then-chat behaviour stays intact')

console.log('约见成功引导与撮合见面流程契约测试通过')
