// 注册身份 → 推荐性别口径（RECO-MEETING-INTENT-GENDER-20261114）
//
// 需求：注册时选「自己找对象 / 我是父母」只推异性；选「找搭子」同性异性都推。
// 服务端靠 user_registration_intent.intent_type 判断，前端必须在选身份时把它写进去，
// 否则后端永远按默认「找对象」处理，找搭子的用户一个同性都看不到。
//
// 本测试锁三件事：
// 1) 接口契约（PUT /auth/registration-intent，枚举与后端 Literal 完全一致）；
// 2) 四个角色卡到 intent_type 的映射，尤其「当红娘」不得误提交；
// 3) 写身份发生在 parent 分支 return 之前，且失败不打断注册。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { readBackend } = require('./helpers/cross-repo.cjs')

const root = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const authApi = read('api/auth.uts')
const apiIndex = read('api/index.uts')
const onboarding = read('pagesSub/userExtra/onboarding/profile.uvue')

// ── 1. 接口契约 ────────────────────────────────────────────────────────────
assert.match(
  authApi,
  /export async function setRegistrationIntent\(intentType: string, source: string = 'register'\)/,
  'api/auth.uts 必须导出 setRegistrationIntent'
)
assert.match(authApi, /url: '\/auth\/registration-intent'/, '提交入口必须是 /auth/registration-intent')
assert.match(
  authApi,
  /data: \{ intent_type: intentType, source: source \}/,
  '请求体字段必须是 intent_type / source（后端 RegistrationIntentUpdate 只认这两个）'
)
const setIntentBlock = authApi.slice(
  authApi.indexOf('export async function setRegistrationIntent'),
  authApi.indexOf('export async function getRegistrationIntent')
)
assert.match(setIntentBlock, /method: 'PUT'/, '提交注册身份必须是 PUT')
assert.ok(setIntentBlock.includes('mockData'), '离线/演示模式要有 mockData，否则 H5 预览会报错')

for (const name of ['setRegistrationIntent', 'getRegistrationIntent']) {
  assert.ok(apiIndex.includes(name), `api/index.uts 必须导出 ${name}`)
}

// ── 2. 角色卡 → intent_type 映射 ──────────────────────────────────────────
const mappingStart = onboarding.indexOf('const roleIntentType = (key: string): string =>')
assert.ok(mappingStart >= 0, 'onboarding 必须有 roleIntentType 映射函数')
const mapping = onboarding.slice(mappingStart, onboarding.indexOf('const chooseRole', mappingStart))

const EXPECTED = [
  ['self', 'self_match'],
  ['parent', 'parent_match'],
  ['buddy', 'companion'],
]
for (const [key, intent] of EXPECTED) {
  assert.ok(
    mapping.includes(`if (key == '${key}') return '${intent}'`),
    `角色 ${key} 必须映射到 ${intent}`
  )
}
// 「当红娘」走 user_role 申请，不是注册意图；误提交会让后端把红娘当找对象用户
assert.doesNotMatch(mapping, /'matchmaker'\)\s*return\s*'/, '当红娘不得映射到任何 intent_type')
assert.match(mapping, /return ''/, '未映射的角色必须返回空串而不是默认值')

// ── 3. 写入时机与失败降级 ─────────────────────────────────────────────────
const chooseRoleStart = onboarding.indexOf('const chooseRole = (key: string) =>')
const chooseRoleEnd = onboarding.indexOf('const ', onboarding.indexOf('mode.value = key', chooseRoleStart))
const chooseRoleBody = onboarding.slice(chooseRoleStart, chooseRoleEnd)

const setIntentAt = chooseRoleBody.indexOf('setRegistrationIntent(')
const parentReturnAt = chooseRoleBody.indexOf("if (key === 'parent')")
assert.ok(setIntentAt >= 0, 'chooseRole 必须提交注册身份')
assert.ok(
  setIntentAt < parentReturnAt,
  '提交注册身份必须在 parent 分支 return 之前，否则父母身份永远写不进服务端'
)
assert.match(chooseRoleBody, /\.catch\(/, '提交失败不得抛出中断注册流程（本地已记录 mode）')
assert.match(
  chooseRoleBody,
  /if \(intentType != ''\)/,
  '只有映射到 intent 的角色才提交，未开通身份不得发空值请求'
)

// ── 4. 枚举必须与后端一致（后端源码可达时才断言） ─────────────────────────
const authSchemas = readBackend('app/schemas/auth.py')
const discoveryService = readBackend('app/services/discovery.py')
if (authSchemas == null || discoveryService == null) {
  console.log(
    'WARN test-intent-gender-map.js 后端源码不可达，跳过前后端枚举一致性断言（设置 XSA_BACKEND_ROOT 可启用）'
  )
} else {
  for (const intent of ['self_match', 'parent_match', 'companion']) {
    assert.ok(
      authSchemas.includes(`"${intent}"`),
      `后端 RegistrationIntentUpdate 必须声明 ${intent}，前端映射不得自造枚举`
    )
    assert.ok(
      mapping.includes(`'${intent}'`),
      `前端缺少后端已声明的枚举 ${intent}`
    )
  }
  // 后端放开同性的身份，必须就是前端映射到「找搭子」的那一个
  assert.match(
    discoveryService,
    /SAME_GENDER_OPEN_INTENTS = frozenset\(\{"companion"\}\)/,
    '后端只对 companion 放开同性，前后端口径必须同源'
  )
  assert.match(discoveryService, /ri\.intent_type/, '推荐查询必须读注册身份')
}

console.log('PASS 注册身份推荐口径契约：角色映射、写入时机与前后端枚举一致')
