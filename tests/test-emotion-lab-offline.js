/**
 * 情感实验室离线门禁。
 *
 * 背景：后端 /emotion-lab/* 已就绪，前端已切换真实接口，失败时保留端侧降级。
 * 本测试守住三件事：
 *   1. 开关必须保持 false，且只能有一处声明；
 *   2. 所有 /emotion-lab 真实请求都必须处在 mock 短路之后（不可达）；
 *   3. 页面不得回退到「单个 errorMessage 决定整页生死」的旧结构，且必须有端侧兜底。
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

const configSource = read('api/config.uts')
const apiSource = read('api/emotionLab.uts')
const indexSource = read('api/index.uts')
const pageSource = read('pagesSub/emotionLab/emotion-lab.uvue')

// 1. 开关集中在 config.uts，且为 false（走真实接口）
assert.match(
  configSource,
  /export\s+const\s+EMOTION_LAB_USE_MOCK\s*=\s*false/,
  'api/config.uts must declare EMOTION_LAB_USE_MOCK = false（后端 /emotion-lab 已就绪）'
)
assert.ok(
  !/export\s+const\s+EMOTION_LAB_USE_MOCK/.test(apiSource),
  'api/emotionLab.uts must not declare its own EMOTION_LAB_USE_MOCK（开关只允许一处）'
)
assert.match(
  apiSource,
  /import\s*\{[^}]*EMOTION_LAB_USE_MOCK[^}]*\}\s*from\s*['\"]\.\/config\.uts['\"]/,
  'api/emotionLab.uts must import EMOTION_LAB_USE_MOCK from ./config.uts'
)

// 2. 每个真实 /emotion-lab 请求都要在 mock 短路之后
const realUrlPattern = /url:\s*['"]\/emotion-lab[^'"]*['"]/g
let match = null
let realCalls = 0
while ((match = realUrlPattern.exec(apiSource)) !== null) {
  realCalls += 1
  const functionStart = apiSource.lastIndexOf('export ', match.index)
  assert.ok(functionStart >= 0, `/emotion-lab request at index ${match.index} must live inside an exported function`)
  const enclosing = apiSource.slice(functionStart, match.index)
  assert.ok(
    /EMOTION_LAB_USE_MOCK/.test(enclosing),
    `every /emotion-lab request must be guarded by EMOTION_LAB_USE_MOCK (offender near index ${match.index})`
  )
}
assert.ok(realCalls >= 6, `expected at least 6 /emotion-lab request declarations, found ${realCalls}`)

// 3. 未登录不得整页崩：subject 解析必须降级为本地访客主体
assert.ok(
  !/throw new Error\('EMOTION_LAB_SUBJECT_REQUIRED/.test(apiSource),
  'resolveEmotionLabSubject must not throw（未登录也要能进页面）'
)
assert.match(apiSource, /resolveGuestSubject/, 'resolveEmotionLabSubject must fall back to a local guest subject')
assert.ok(
  !/return 'guest:local'/.test(apiSource),
  'guest subject must be per-device random, not a shared constant'
)

// 4. 页面结构：致命错误与可恢复提示分离，且有端侧兜底
assert.ok(
  !/\berrorMessage\b/.test(pageSource),
  'emotion-lab.uvue must not keep the old single errorMessage state'
)
assert.match(pageSource, /\bfatalError\b/, 'emotion-lab.uvue must keep a fatalError state')
assert.match(pageSource, /\bnoticeMessage\b/, 'emotion-lab.uvue must keep a noticeMessage banner state')
assert.match(
  pageSource,
  /getEmotionLabOfflineSummary/,
  'emotion-lab.uvue must fall back to the offline summary before giving up'
)

// 5. 兜底能力必须能被页面拿到（api/index.uts 导出）
assert.match(indexSource, /\bgetEmotionLabOfflineSummary\b/, 'api/index.uts must re-export getEmotionLabOfflineSummary')
assert.match(apiSource, /export function getEmotionLabOfflineSummary/, 'api/emotionLab.uts must implement getEmotionLabOfflineSummary')

// 6. 页面不再把后端 detail 原样上屏
assert.ok(
  !/state-message">\{\{\s*errorMessage\s*\}\}/.test(pageSource),
  'emotion-lab.uvue must not render a raw backend detail string as the page subtitle'
)

console.log('test-emotion-lab-offline: PASS')
