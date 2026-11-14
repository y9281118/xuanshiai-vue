const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const chatPage = fs.readFileSync(path.join(root, 'pagesSub/chat/detail.uvue'), 'utf8')
const apiIndex = fs.readFileSync(path.join(root, 'api/index.uts'), 'utf8')

function includes(source, value, label) {
  assert.ok(source.includes(value), `${label} should include ${value}`)
}

includes(chatPage, 'input-bar', 'chat input bar')
includes(chatPage, 'showMore ? \'×\' : \'+\'', 'plus button should toggle into close icon')
includes(chatPage, 'toggleMoreMenu', 'plus button toggle action')
includes(chatPage, 'more-actions', 'expanded actions should render below input row')
includes(chatPage, 'openPeerProfile', 'peer avatar navigation action')
includes(chatPage, 'XsaReportSheet', 'detailed report sheet')
includes(chatPage, ':large-text="isParentMode"', 'parent chat report sheet uses the large-text variant')
includes(chatPage, 'openChatReport', 'report menu action')
includes(chatPage, '举报', 'report menu label')
includes(chatPage, 'onShow(() =>', 'chat permission should be rechecked when returning to the page')
includes(chatPage, 'permissionRequestSequence', 'new permission rechecks should supersede older responses')
includes(chatPage, 'isPermissionRequestCurrent', 'permission responses should be subject and generation guarded')
assert.ok(!chatPage.includes('permissionRequestInFlight'), 'onShow permission checks should not be discarded')
includes(chatPage, 'unsentLocal', 'failed local messages should survive a permission refresh')
includes(chatPage, "res.code == 'CHAT_NOT_ALLOWED'", 'permission failures should close the chat gate')
includes(chatPage, 'result.success != true', 'send success should require the business success flag')
includes(chatPage, 'uploadChatMedia', 'media should be uploaded before sending a media message')
includes(chatPage, 'revokeMessage', 'sent messages should support a server-side revoke')

// 撤回表现对齐微信：原气泡与头像都不再出现，只留一行居中灰字提示。
// 对方侧不得再看到「消息已撤回」这种气泡占位。
includes(chatPage, 'class="recall-divider"', 'revoked messages should render as a centered hint row')
includes(chatPage, "message.isMine ? '你撤回了一条消息' : '对方撤回了一条消息'", 'recall hint copy should follow the viewer side')
assert.ok(!chatPage.includes('revoked-content'), 'the old revoked placeholder bubble should be gone')
assert.ok(!chatPage.includes("message.content = '消息已撤回'"), 'revoking must not keep the old placeholder text locally')
includes(chatPage, '.recall-divider-text', 'recall hint should use its own muted style')
includes(
  chatPage,
  'class="recall-divider" v-else-if="message.revoked == true" @longpress="openMessageMenu(message, $event)"',
  'recall hint should stay long-pressable so "delete for me" remains reachable'
)

// F-M1 长按菜单：微信式深色网格浮层，转发/删除/多选/引用/复制/撤回/重新编辑。
includes(chatPage, '@longpress="openMessageMenu(message, $event)"', 'message bubbles should open a long-press menu with position')
includes(chatPage, 'const openMessageMenu = (message: any, event: any)', 'long-press menu builder')
includes(chatPage, 'message-menu-grid', 'WeChat-style grid menu')
includes(chatPage, 'message-menu-arrow', 'menu arrow pointing at the bubble')
includes(chatPage, 'message-bubble-active', 'long-pressed bubble should keep a selected highlight')
assert.ok(!chatPage.includes('itemList: items,'), 'the old system action sheet menu should be gone')
for (const label of ['复制', '转发', '删除', '多选', '引用', '重新编辑', '撤回']) {
  includes(chatPage, `label: '${label}'`, `${label} action in long-press menu`)
}
includes(chatPage, 'forwardTextMessage(', 'forward should send the text to another conversation')
includes(chatPage, '删除后仅从你的聊天记录中移除，对方仍可看到。', 'delete must explain it is local-only')
includes(chatPage, "message.type === 'system'", 'system messages should not expose a message menu')
assert.ok(!chatPage.includes('class="revoke-action"'), 'revoke should not stay as a permanent control under the bubble')
assert.ok(!chatPage.includes('.revoke-action'), 'styles of the removed permanent revoke control should be gone')
includes(chatPage, 'messageMenuOpenedAt', 'a long press should suppress the tap that follows it')

// F-M6 AI 军师入口先校验会员态，读取失败退回本地缓存而不是误判非会员。
includes(chatPage, 'await getMembershipStatus()', 'advisor entry should check the real membership state')
includes(chatPage, 'AI 军师仅对有效会员开放', 'non members should get the membership guidance')
includes(chatPage, 'getCurrentUserVipStatus()', 'advisor gate should fall back to the cached membership state')

// F-M10 聊天页导航栏显示对方昵称。
includes(chatPage, 'applyPeerTitle()', 'peer title should be applied once the chat is allowed')
includes(chatPage, 'uni.setNavigationBarTitle', 'navigation title should carry the peer nickname')

includes(chatPage, 'getContactExchanges', 'contact exchange state should be loaded from the API')
includes(chatPage, 'createContactExchange', 'contact exchange should be explicitly requested')
includes(chatPage, 'respondContactExchange', 'contact exchange should require a receiver response')
includes(chatPage, 'contactLoading', 'contact exchange should expose a loading state')
includes(chatPage, '请重新选择媒体', 'failed uploads should not expose an invalid retry action')
includes(chatPage, 'onUnmounted(() =>', 'recording should be cleaned up when the page unmounts')
includes(chatPage, 'discardVoiceRecording', 'unmounting should discard a partial voice recording')
includes(chatPage, "{ 'parent-mode': isParentMode }", 'parent chat accessibility root variant')
includes(chatPage, 'isProtectedMediaMessage', 'parent chat media defense in depth')
includes(chatPage, "content: protectedContent ? '' : message.content", 'parent chat does not retain protected media URLs')
includes(chatPage, "avatar: isParentMode.value ? ''", 'parent chat does not retain clear avatar URLs')
includes(chatPage, '内容已保护', 'parent chat protected media placeholder')
assert.ok(
  (chatPage.match(/:large-text="isParentMode"/g) || []).length >= 2,
  'parent permission and history retry controls should use the large-text button variant',
)
assert.ok(
  /\.chat-page\.parent-mode \.state-desc,[\s\S]{0,400}font-size:\s*14px;/.test(chatPage),
  'parent support text should be at least 14px',
)
assert.ok(
  /\.chat-page\.parent-mode \.chat-loading > text,[\s\S]{0,300}font-size:\s*16px;/.test(chatPage),
  'parent body text should be at least 16px',
)
assert.ok(
  /\.chat-page\.parent-mode \.avatar,[\s\S]{0,300}min-height:\s*48px;/.test(chatPage),
  'parent avatar and icon controls should expose 48px targets',
)
assert.ok(
  /\.chat-page\.parent-mode \.input,[\s\S]{0,300}min-height:\s*48px;/.test(chatPage),
  'parent input and command controls should expose 48px targets',
)
assert.ok(!chatPage.includes('const peerAvatar ='), 'chat detail should not cache a peer clear avatar outside message rendering')
assert.ok(!chatPage.includes('@click="chooseImage"'), 'album should not be offered without an upload-and-send flow')
assert.ok(!chatPage.includes('@click="takePhoto"'), 'camera should not be offered without an upload-and-send flow')
assert.ok(!chatPage.includes('@click="sendVoice"'), 'voice should not be offered without a send flow')
assert.ok(!chatPage.includes('@click="sendGift"'), 'gifts should not be offered without a send flow')
assert.ok(!chatPage.includes('发送服务暂未开放'), 'removed send actions should not lead to a dead-end toast')
assert.ok(!chatPage.includes('>资料</text>'), 'profile menu item should be replaced by report')
assert.ok(!chatPage.includes('ensureChatFeatureUnlocked'), 'chat should not include the removed points unlock gate')
assert.ok(
  /\.message-wrapper\.mine\s*\{\s*justify-content:\s*flex-end;\s*\}/.test(chatPage),
  'own messages should align the bubble and avatar to the right'
)
assert.ok(
  /\.message-wrapper\.mine\s*\{[^}]*flex-direction:\s*row-reverse;/.test(chatPage) === false,
  'own messages should keep bubble before avatar in normal row order'
)

const inputIndex = chatPage.indexOf('class="input"')
const sendIndex = chatPage.indexOf('@click="sendMessage"')
const toggleIndex = chatPage.indexOf('toggleMoreMenu')
assert.ok(inputIndex >= 0 && sendIndex >= 0 && toggleIndex >= 0, 'chat controls should exist')
assert.ok(inputIndex < sendIndex && sendIndex < toggleIndex, 'input, send, and plus controls should be ordered left to right')

includes(apiIndex, 'uploadChatMedia', 'chat media upload API export')
includes(apiIndex, 'revokeMessage', 'chat revoke API export')
includes(apiIndex, 'getContactExchanges', 'contact exchange read API export')
includes(apiIndex, 'createContactExchange', 'contact exchange create API export')
includes(apiIndex, 'respondContactExchange', 'contact exchange response API export')
includes(apiIndex, 'forwardTextMessage', 'forward API export')
includes(apiIndex, 'getConversationPage', 'conversation list API for choosing a forward target')

const messageApi = fs.readFileSync(path.join(root, 'api/message.uts'), 'utf8')
assert.match(messageApi, /export async function forwardTextMessage\b/, 'forwardTextMessage must be implemented')
assert.match(
  messageApi,
  /return await sendMessage\(targetUserId, text, 'text', clientMessageId, subject\)/,
  'forward must reuse the real send-message path instead of a parallel API'
)
assert.ok(!messageApi.includes('url: \'/chat/messages/forward\''), 'no non-existent forward endpoint')

console.log('聊天详情页交互契约测试通过')
