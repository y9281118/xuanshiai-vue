const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert')

const root = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const page = read('pagesSub/profileExtra/my-portrait-master.uvue')
const sheet = read('pagesSub/profileExtra/components/moxiang/MoxiangRoleplaySheet.uvue')
const api = read('api/ai-roleplay.uts')
const backendRoot = 'E:/houduan/xuanshiai'

// ---- 后端契约：本地后端仓存在时实检，不存在时明确记录 SKIP ----
const backendRoutePath = path.join(backendRoot, 'app/api/routes/ai_roleplay.py')
if (fs.existsSync(backendRoutePath)) {
  const backendRoute = fs.readFileSync(backendRoutePath, 'utf8')
  const backendScenes = fs.readFileSync(path.join(backendRoot, 'app/services/ai/roleplay_scene.py'), 'utf8')
  const backendSchema = fs.readFileSync(path.join(backendRoot, 'app/db/ai_schema.py'), 'utf8')
  const backendMetrics = fs.readFileSync(path.join(backendRoot, 'app/api/routes/ai_profile_metrics.py'), 'utf8')

  for (const text of ['/roleplay/scenes', '/roleplay/turns', '/roleplay/submit', '/roleplay/interests/confirm', 'Idempotency-Key', 'response_model=']) {
    assert.ok(backendRoute.includes(text), 'backend route missing: ' + text)
  }
  assert.ok(backendRoute.includes('source_type'), 'roleplay turns must be tagged with existing source_type')
  assert.ok(backendRoute.includes('await db.commit()'), 'roleplay turns must be committed')
  assert.ok(backendRoute.includes('current_user.id'), 'roleplay must use CurrentUser.id')
  assert.ok(backendRoute.includes('AiFeatureDisabledError'), 'AI feature gate must map to 503')
  assert.ok(!backendRoute.includes('ai_roleplay_session'), 'must not create new roleplay tables')
  assert.ok(!backendRoute.includes('moxiang_ip'), 'must not reuse the Zhiyu persona prompt')
  assert.ok(backendScenes.includes('opening_line') && backendScenes.includes('avatar_token'), 'characters need independent image and proactive opening')
  assert.ok(backendScenes.includes('ROLEPLAY_SHARED_RULES'), 'independent safety rules required')
  assert.ok(!backendScenes.includes('MOXIANG_ROLE_NAME'), 'characters must not reference Zhiyu')
  assert.ok(!backendSchema.includes("enum('freechat','roleplay')") && !backendSchema.includes('metrics_snapshot_json'), 'no new columns allowed')
  assert.ok(!backendMetrics.includes('metrics_snapshot_json'), 'metrics history must aggregate existing tables')
} else {
  console.log('SKIP test-roleplay-entry-contract.js backend repo not present at ' + backendRoot)
}

// ---- 前端：入口存在，且原知遇链路不受影响 ----
for (const text of ['openRoleplay', 'roleplayVisible', 'MoxiangRoleplaySheet']) assert.ok(page.includes(text), 'page missing: ' + text)
assert.ok(!page.includes('if (roleplayVisible.value || !masterPageVisible'), 'roleplay must not gate the Zhiyu WS')
assert.ok(!page.includes('roleplayVisible.value = true\n\tcontinuousLoadSeq++'), 'roleplay must not tear down Zhiyu polling')

// ---- 前端：完全独立、主动问话、独立形象、兴趣需确认 ----
assert.ok(!sheet.includes('知遇'), 'roleplay sheet must not mention Zhiyu')
assert.ok(!sheet.includes('XsaZhiyuMark') && !sheet.includes('ai-cat.webp'), 'must not reuse Zhiyu cat IP')
for (const text of ['opening_line', 'avatar_token', 'avatar_glyph', 'confirmRoleplayInterest', 'AI 角色扮演']) {
  assert.ok(sheet.includes(text), 'sheet missing: ' + text)
}
for (const text of ['好感度', 'affinity', '剧情', 'chapter', '解锁私密']) {
  assert.ok(!sheet.includes(text), 'sheet must not contain: ' + text)
}
assert.ok(!api.includes('mockData') && !api.includes('turn_placeholder'), 'no fake AI replies')

// ---- 真跑 API 适配器 ----
let js = api.replace(/^import .*$/gm, '')
  .replace(/^export interface .*$/gm, '')
  .replace(/export /g, '')
  .replace(/: Promise<RoleplayScene\[\]>|: Promise<RoleplayTurn\[\]>|: Promise<RoleplaySubmitResult>|: Promise<any>|: never|: RoleplaySubmit|: RoleplayInterestConfirm|: string|: any/g, '')
  .replace(/: RoleplayScene\[\]|: RoleplayTurn\[\]|: RoleplaySubmitResult/g, '')
  .replace(/ as RoleplayScene\[\]| as RoleplayTurn\[\]| as RoleplaySubmitResult/g, '')
js += '\nthis.adapter = { getRoleplayScenes, getRoleplayTurns, submitRoleplayTurn, confirmRoleplayInterest, ROLEPLAY_PRESET_SCENES }'
let calls = []
let response = { success: true, data: { scenes: [{ key: 'coffee_chat', label: '咖啡馆闲聊' }] } }
const context = { USE_MOCK: false, AI_LLM_TIMEOUT: 45000, request: async opts => { calls.push(opts); return response }, Error, encodeURIComponent, Array }
vm.runInNewContext(js, context)

;(async () => {
  const { getRoleplayScenes, getRoleplayTurns, submitRoleplayTurn, confirmRoleplayInterest, ROLEPLAY_PRESET_SCENES } = context.adapter
  assert.equal((await getRoleplayScenes())[0].key, 'coffee_chat')
  assert.equal(ROLEPLAY_PRESET_SCENES.length, 4, 'frontend must ship 3-5 preset characters')

  response = { success: true, data: { turns: [{ turn_id: '1', role: 'user', answer_text: '你好' }] } }
  assert.equal((await getRoleplayTurns('a b'))[0].answer_text, '你好')
  assert.ok(calls[1].url.includes('scene_key=a%20b&limit=50'))

  const payload = { scene_key: 'coffee_chat', user_message: '你好', client_turn_id: 'idem-key-01' }
  response = { success: true, data: { session_id: 's', turn_id: '1', assistant_reply: '你好', notice: 'AI 角色扮演' } }
  const reply = await submitRoleplayTurn(payload, 'idem-key-01')
  assert.equal(reply.assistant_reply, '你好')
  assert.equal(calls[2].headers['Idempotency-Key'], 'idem-key-01')
  // 一轮回复由后端同步调模型生成，必须走长超时，否则 15 秒先于后端 30 秒放弃。
  assert.equal(calls[2].timeout, 45000, 'submit must use the long model timeout')

  response = { success: true, data: { accepted: true, notice: '已记录' } }
  const confirmed = await confirmRoleplayInterest({ turn_id: '1', tag: '阅读', confirm: true }, 'idem-key-02')
  assert.equal(confirmed.accepted, true)
  assert.ok(calls[3].url.includes('/ai/roleplay/interests/confirm'))

  response = { success: false, code: 503, businessCode: 'AI_TEMPORARILY_UNAVAILABLE', message: '不可用' }
  await assert.rejects(() => submitRoleplayTurn(payload, 'idem-key-03'), e => e.code === 503 && e.businessCode === 'AI_TEMPORARILY_UNAVAILABLE')

  context.USE_MOCK = true
  assert.equal((await getRoleplayScenes()).length, 4, 'mock mode only exposes static preset cards')
  await assert.rejects(() => submitRoleplayTurn(payload, 'idem-key-04'), e => e.code === 503)
  console.log('角色扮演入口、独立性与 API 契约测试通过')
})().catch(e => { console.error(e); process.exitCode = 1 })
