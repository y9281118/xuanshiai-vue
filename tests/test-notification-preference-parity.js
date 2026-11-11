const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { readBackend, backendRoot } = require('./helpers/cross-repo.cjs')

// —— 缺陷背景（2026-11-11）——
// 设置页「接收匹配通知」的描述写的是「有人申请认识你时通知」，实际读写的是
// notify_match；而后端把 match_application / match_application_accepted /
// match_application_rejected / apply 全部归到 notify_apply 名下。前端从未读写
// notify_apply，于是「认识申请」这类通知根本没有关闭入口，开关点了也没用。
// 这里把「后端事件→偏好」与「设置页是否有该偏好的读写」锁成一条不变量，避免
// 以后新增事件类型又静默落进一个用户看不到的偏好里。

const root = path.resolve(__dirname, '..')
const settings = fs.readFileSync(path.join(root, 'pagesSub/profileExtra/settings.uvue'), 'utf8')

const backend = readBackend('app/services/notifications.py')
if (backend == null) {
  console.log('SKIP test-notification-preference-parity.js 未找到后端源码（设置 XSA_BACKEND_ROOT 后重跑）')
  process.exit(0)
}

// 1) 解析后端的事件→偏好映射。
const mapStart = backend.indexOf('_PREFERENCE_BY_EVENT')
assert.ok(mapStart >= 0, '后端缺少 _PREFERENCE_BY_EVENT 映射')
const mapEnd = backend.indexOf('\n}', mapStart)
assert.ok(mapEnd > mapStart, '_PREFERENCE_BY_EVENT 结构无法解析')
const mapBlock = backend.slice(mapStart, mapEnd)
const eventToPreference = new Map()
for (const m of mapBlock.matchAll(/"([a-z_0-9]+)"\s*:\s*"(notify_[a-z_]+)"/g)) {
  eventToPreference.set(m[1], m[2])
}
assert.ok(eventToPreference.size >= 10, `偏好映射解析过少（${eventToPreference.size}），疑似格式变更`)

// 2) 双开关的前提：match 与申请类事件必须分属两个偏好。
assert.strictEqual(eventToPreference.get('match'), 'notify_match', 'match 事件应归 notify_match')
for (const type of ['match_application', 'match_application_accepted', 'match_application_rejected', 'apply']) {
  assert.strictEqual(
    eventToPreference.get(type),
    'notify_apply',
    `${type} 必须归 notify_apply，否则「匹配成功」与「认识申请」无法分开控制`,
  )
}

// 3) 每个偏好键都必须落在 PrivacyResponse 上：否则前端 savePrivacy 写进去的字段
//    后端不建模，会出现「保存成功、刷新又变回默认」的假成功。
const schemas = readBackend('app/schemas/social.py')
assert.ok(schemas != null, '后端缺少 app/schemas/social.py')
const respStart = schemas.indexOf('class PrivacyResponse(BaseModel):')
assert.ok(respStart >= 0, '未找到 PrivacyResponse')
const respEnd = schemas.indexOf('\nclass ', respStart + 10)
const respBlock = schemas.slice(respStart, respEnd < 0 ? schemas.length : respEnd)
const responseFields = new Set(
  [...respBlock.matchAll(/^\s{4}([a-z_0-9]+)\s*:/gm)].map((m) => m[1]),
)

// 4) 设置页必须能读回并保存每个偏好。
//    不允许出现「后端能关、前端关不掉」的偏好——这类缺口用户无法自查。
//    确需豁免时必须在此写明理由，并会被打 WARN 强制人工确认。
const EXEMPT = {}

const preferences = [...new Set(eventToPreference.values())].sort()
const missingRead = []
const missingSave = []
for (const pref of preferences) {
  if (EXEMPT[pref] != null) continue
  assert.ok(
    responseFields.has(pref),
    `偏好 ${pref} 未在 PrivacyResponse 上建模，前端保存会静默失效`,
  )
  if (!new RegExp(`\\bp\\.${pref}\\b`).test(settings)) missingRead.push(pref)
  if (!settings.includes(`savePrivacy('${pref}'`)) missingSave.push(pref)
}

assert.deepStrictEqual(
  missingRead,
  [],
  `设置页从未读回这些偏好，开关状态将与服务端不符：${missingRead.join(', ')}`,
)
assert.deepStrictEqual(
  missingSave,
  [],
  `设置页没有为这些偏好提供保存路径，用户无法关闭：${missingSave.join(', ')}`,
)

// 5) 文案与绑定必须一致：说「申请认识」的那一行不能绑 notify_match。
assert.ok(settings.includes('接收认识申请通知'), '缺少「接收认识申请通知」开关')
assert.ok(
  /接收认识申请通知[\s\S]{0,160}?receiveApply/.test(settings),
  '「接收认识申请通知」必须绑定 receiveApply',
)
assert.ok(
  !/接收匹配通知[\s\S]{0,120}?有人申请认识你时通知/.test(settings),
  '「接收匹配通知」的描述不得再宣称覆盖认识申请——它只管 notify_match',
)
assert.ok(
  /savePrivacy\('notify_apply'/.test(settings),
  '认识申请开关必须真的写 notify_apply',
)

// 6) mock 模式要给出两个偏好，否则本地跑不出开关差异。
const api = fs.readFileSync(path.join(root, 'api/community.uts'), 'utf8')
assert.ok(api.includes('notify_apply: true'), 'mock 的隐私默认值缺少 notify_apply')
assert.ok(api.includes('notify_system: true'), 'mock 的隐私默认值缺少 notify_system')

// 7) 系统通知开关必须把「哪些关不掉」写清楚：后端对
//    _MANDATORY_EVENT_TYPES（举报结果/申诉结果/社区审核结论）不查偏好，
//    关掉开关也会送达；不说明会让用户以为处置结果被吞。
assert.ok(
  /接收系统通知[\s\S]{0,220}?始终送达/.test(settings),
  '系统通知开关的描述必须说明举报/审核结果不受该开关影响',
)

for (const [pref, reason] of Object.entries(EXEMPT)) {
  console.log(`WARN 偏好 ${pref} 无设置入口：${reason}（后端仍按默认 true 生效）`)
}
console.log(
  `通知偏好对等测试通过：后端 ${eventToPreference.size} 个事件类型 → ${preferences.length} 个偏好，`
  + `设置页 ${preferences.length - Object.keys(EXEMPT).length} 个可关，${Object.keys(EXEMPT).length} 个豁免`,
)
console.log(`  INFO 后端根目录：${backendRoot()}`)
