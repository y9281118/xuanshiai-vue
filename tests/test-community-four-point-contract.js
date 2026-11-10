const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => {
  const file = path.join(root, relativePath)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}
const api = read('api/community.uts')
const compose = read('pagesSub/community/dating-plane-compose.uvue')
const anonymousConversation = read('pagesSub/community/paper-plane-chat.uvue')
const postDetail = read('pagesSub/community/post-detail.uvue')
const messagesPage = read('pagesSub/community/paper-plane-messages.uvue')
const pagesConfig = read('pages.json')
const failures = []
const includes = (source, value, label) => { if (!source.includes(value)) failures.push(`${label}: ${value}`) }
const excludes = (source, value, label) => { if (source.includes(value)) failures.push(`${label}: must not contain ${value}`) }

// 1. Anonymous paper-plane chat stays separate and exposes only controlled tools.
includes(anonymousConversation, 'sendPaperPlaneMessage', 'anonymous conversation send API')
includes(anonymousConversation, 'choosePaperPlanePhoto', 'anonymous conversation photo tool')
includes(anonymousConversation, 'requestWechatExchange', 'bilateral WeChat exchange tool')
includes(anonymousConversation, 'requestPhoneExchange', 'bilateral phone exchange tool')
includes(anonymousConversation, 'reportPaperPlaneConversation', 'anonymous conversation report tool')
includes(anonymousConversation, 'getPaperPlaneMessages', 'anonymous conversation message loader')
includes(anonymousConversation, 'readPaperPlaneConversation', 'anonymous conversation read marker')
includes(anonymousConversation, 'getPaperPlaneProfileUnlock', 'anonymous conversation unlock status')
includes(api, 'export async function unlockPaperPlaneProfile', 'server-authoritative profile unlock API')
includes(api, 'PAPER_PLANE_PROFILE_UNLOCK_COST = 50', '50-point target profile unlock cost')
includes(anonymousConversation, '需要 50 积分解锁对方资料后才可使用', 'locked contact hint')
includes(anonymousConversation, '照片', 'top action photo label')
includes(anonymousConversation, '交换微信', 'top action wechat label')
includes(anonymousConversation, '交换电话', 'top action phone label')
includes(anonymousConversation, '举报', 'top action report label')
assert.ok(
  anonymousConversation.indexOf('照片') < anonymousConversation.indexOf('交换微信') &&
  anonymousConversation.indexOf('交换微信') < anonymousConversation.indexOf('交换电话') &&
  anonymousConversation.indexOf('交换电话') < anonymousConversation.indexOf('举报'),
  'top actions should stay in the fixed order 照片、交换微信、交换电话、举报'
)
includes(anonymousConversation, 'uni.chooseImage', 'anonymous conversation photo picker')
includes(anonymousConversation, 'sendPaperPlaneMessage()', 'anonymous conversation message send call')
includes(anonymousConversation, 'unlockPaperPlaneProfile(', 'anonymous conversation unlock call')
includes(anonymousConversation, 'const unlockPaperPlaneProfile =', 'anonymous conversation unlock button handler')
includes(anonymousConversation, 'unlockPaperPlaneProfileApi(', 'anonymous conversation server unlock invocation')
includes(api, 'ownerId: row.owner_id != null ? row.owner_id : row.ownerId', 'paper-plane conversation owner mapping')
includes(api, 'replierId: row.replier_id != null ? row.replier_id : row.replierId', 'paper-plane conversation replier mapping')
includes(api, 'resolvePaperPlaneTargetUserId', 'paper-plane conversation target resolver')
includes(messagesPage, '&targetUserId=', 'paper-plane list target user deep-link')
includes(anonymousConversation, 'options.targetUserId', 'paper-plane chat target user option')
includes(anonymousConversation, 'reportContent(', 'anonymous conversation report API call')
excludes(anonymousConversation, 'getChatMessages', 'anonymous conversation should not use ordinary chat loader')
excludes(anonymousConversation, 'sendMessageApi', 'anonymous conversation should not use ordinary chat sender')
excludes(anonymousConversation, 'matchmaker', 'anonymous conversation should not use matchmaker APIs')

// 2. Messages page should route into the dedicated anonymous chat page.
includes(messagesPage, "/pagesSub/community/paper-plane-chat?conversationId=' + item.id", 'paper-plane list navigation')
excludes(messagesPage, '/pagesSub/chat/detail?paperPlaneConversationId=', 'paper-plane list should not route to ordinary chat detail')

// 3. The dedicated page must be registered in pages.json.
includes(pagesConfig, '"path": "paper-plane-chat"', 'paper-plane chat page registration')
includes(postDetail, 'commentIdTarget', 'comment deep-link target state')
includes(postDetail, 'scroll-into-view', 'comment deep-link scroll')
includes(postDetail, '该评论已不可查看', 'comment unavailable fallback')

assert.deepStrictEqual(failures, [], `community + paper-plane four-point contract failures:\n- ${failures.join('\n- ')}`)
