// 同步等模型的 AI 接口必须有独立的长超时。
//
// 背景（2026-11-11 测试服联调）：`POST /ai/profile/thoughtfulness` 在客户端报
// `request:fail timeout`，而服务端日志里这次请求正常返回了（实测 10.3~14.3s）。
// 根因不在模型，而在两端的超时不对齐：后端 ai_timeout_seconds 默认 30 秒，
// 客户端 API_CONFIG.timeout 默认 15 秒，客户端先放弃。用户看到超时、额度已扣、
// 模型结果白生成。
//
// 本测试锁两件事：
// 1. 「返回体就是模型产物」的接口必须用 AI_LLM_TIMEOUT（唯一来源，不由各文件
//    各写一个 45000）；新增同类接口时漏写超时会在这里失败。
// 2. 只读 DB 的接口不能套用长超时（否则真网络故障时白等 45 秒）。

const fs = require('fs')
const assert = require('assert')

const config = fs.readFileSync('api/config.uts', 'utf8')
const aiProfile = fs.readFileSync('api/ai-profile.uts', 'utf8')
const aiAdvisor = fs.readFileSync('api/ai-advisor.uts', 'utf8')
const aiRoleplay = fs.readFileSync('api/ai-roleplay.uts', 'utf8')

/** 取出锚点之后的一段源码，用来看这个 request 调用带了哪些选项。 */
function sliceAt(source, anchor, span = 400) {
  const at = source.indexOf(anchor)
  assert(at >= 0, `锚点 ${anchor} 未命中，测试已失效`)
  return source.slice(at, at + span)
}

/** 同一接口可能有多处调用（GET 读库 + POST 触发模型），收集全部片段。 */
function sliceAll(source, anchor, span = 400) {
  const out = []
  let from = 0
  for (;;) {
    const at = source.indexOf(anchor, from)
    if (at < 0) break
    out.push(source.slice(at, at + span))
    from = at + anchor.length
  }
  assert(out.length > 0, `锚点 ${anchor} 未命中，测试已失效`)
  return out
}

// ---- 常量本身 ----
assert(config.includes('export const AI_LLM_TIMEOUT'), '长超时必须由 config.uts 单点导出')
const llmTimeout = Number((config.match(/AI_LLM_TIMEOUT\s*=\s*(\d+)/) || [])[1])
const defaultTimeout = Number((config.match(/API_CONFIG\s*=\s*\{[\s\S]*?timeout:\s*(\d+)/) || [])[1])
assert(!isNaN(llmTimeout) && llmTimeout > 0, 'AI_LLM_TIMEOUT 必须是具体毫秒数')
assert(!isNaN(defaultTimeout) && defaultTimeout > 0, 'API_CONFIG.timeout 必须存在')
assert(
  llmTimeout > defaultTimeout,
  `长超时 ${llmTimeout}ms 必须大于默认 ${defaultTimeout}ms，否则等于没改`
)
// 后端 ai_timeout_seconds 默认 30 秒；客户端必须留出余量，不能等于或小于 30 秒。
assert(llmTimeout >= 30000, '长超时必须覆盖后端 30 秒的模型等待上限')

// ---- 同步等模型的调用点 ----
// [源码, 接口锚点, 名称]；thoughtfulness 有 GET/POST 两处，只要 POST 那处命中即可。
const llmCallSites = [
  [aiProfile, "'/ai/profile/polish'", 'AI 润色'],
  [aiProfile, "'/ai/profile/thoughtfulness'", 'AI 用心度分析'],
  [aiAdvisor, "'/ai/advisor/sessions/' + sessionId + '/advice'", 'AI 顾问建议'],
  [aiRoleplay, "'/ai/roleplay/submit'", 'AI 角色扮演一轮']
]

for (const [source, anchor, label] of llmCallSites) {
  const blocks = sliceAll(source, anchor)
  const covered = blocks.some((block) => block.includes('timeout: AI_LLM_TIMEOUT'))
  assert(
    covered,
    `${label} 必须显式使用 AI_LLM_TIMEOUT；漏写就会回落到 ${defaultTimeout}ms 并先于后端超时`
  )
}

// ---- 只读接口反向约束：不能套用长超时 ----
const narrativeBlock = sliceAt(aiProfile, "'/ai/profiles/' + subject + '/narrative'", 500)
assert(
  !narrativeBlock.includes('AI_LLM_TIMEOUT'),
  '画像叙事层是读取预生成成稿（实测 32~51ms），不能套用 45 秒长超时'
)
const narrativeTimeout = Number((narrativeBlock.match(/timeout:\s*(\d+)/) || [])[1])
assert(!isNaN(narrativeTimeout), '画像叙事层必须显式设置超时')
assert(
  narrativeTimeout < defaultTimeout,
  `画像叙事层超时 ${narrativeTimeout}ms 必须小于默认 ${defaultTimeout}ms：` +
    '它被用户详情页串行 await，超时多久整页 loading 就多停多久'
)

// ---- 各文件不得各写一个裸 45000，避免常量改了漏改 ----
for (const [name, source] of [
  ['ai-profile.uts', aiProfile],
  ['ai-advisor.uts', aiAdvisor],
  ['ai-roleplay.uts', aiRoleplay]
]) {
  assert(
    !/timeout:\s*45000/.test(source),
    `${name} 里不应再出现裸 45000，统一引用 AI_LLM_TIMEOUT`
  )
}

console.log(
  `AI 长超时测试通过：AI_LLM_TIMEOUT=${llmTimeout}ms > 默认 ${defaultTimeout}ms，` +
    `${llmCallSites.length} 个同步接口全部覆盖，叙事层 ${narrativeTimeout}ms`
)
