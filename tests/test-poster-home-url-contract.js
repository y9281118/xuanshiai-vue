// 海报二维码首页地址契约：官网首页在 www、API 在 api 子域名，两者不同源。
// P1 域名补丁把 PROD_API_BASE_URL 从 www 改成 api 后，原先「API_BASE_URL == 首页地址」
// 的判断恒假，release 海报会画成测试服二维码。此处按 envVersion 三档锁死。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')

const root = path.join(__dirname, '..')
const compile = (rel) => babel.transformSync(
  fs.readFileSync(path.join(root, rel), 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''),
  { filename: 'contract.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }
).code

const configCode = compile('api/config.uts')
const posterCode = compile('utils/matchmaker-promo-poster.uts')

function loadFor(envVersion) {
  const ctx = { uni: { getAccountInfoSync: () => ({ miniProgram: { envVersion } }) }, console }
  const cfg = vm.runInNewContext(configCode + '\n;({ API_BASE_URL, IS_PROD_BACKEND, IS_LOCAL_BACKEND })', ctx)
  const poster = vm.runInNewContext(
    posterCode + '\n;({ PLATFORM_HOME_URL, rows: homeQrRows(), QR_MODULE_COUNT })',
    { IS_PROD_BACKEND: cfg.IS_PROD_BACKEND, resolveMediaUrl: (v) => v, console }
  )
  return { cfg, poster }
}

const PROD_HOME = 'https://www.xuanshiai.com'
const TEST_HOME = 'https://xhztest.xyz'

// release / trial 都打生产后端，海报必须指向官网首页；develop 与 H5 回退测试域名。
const release = loadFor('release')
assert.equal(release.cfg.API_BASE_URL, 'https://api.xuanshiai.com')
assert.equal(release.cfg.IS_PROD_BACKEND, true)
assert.equal(release.poster.PLATFORM_HOME_URL, PROD_HOME)

const trial = loadFor('trial')
assert.equal(trial.cfg.API_BASE_URL, 'https://api.xuanshiai.com')
assert.equal(trial.poster.PLATFORM_HOME_URL, PROD_HOME)

const develop = loadFor('develop')
assert.equal(develop.cfg.API_BASE_URL, TEST_HOME)
assert.equal(develop.cfg.IS_PROD_BACKEND, false)
assert.equal(develop.poster.PLATFORM_HOME_URL, TEST_HOME)

// 点阵必须跟着首页地址走：选错矩阵 = 二维码扫出来是另一个域名。
const qrOf = (rel) => {
  const src = fs.readFileSync(path.join(root, rel), 'utf8')
  const grab = (name) => src.match(new RegExp('const ' + name + " =\\s*'([01|]+)'"))[1]
  return { test: grab('HOME_QR_TEST'), prod: grab('HOME_QR_PROD') }
}
const qr = qrOf('utils/matchmaker-promo-poster.uts')
assert.equal(release.poster.rows.join('|'), qr.prod)
assert.equal(develop.poster.rows.join('|'), qr.test)
assert.notEqual(qr.prod, qr.test)

// 首页 URL 未变，点阵不得重生成：仍是 25x25 字节模式 / ECC M 的那两串。
for (const rows of [release.poster.rows, develop.poster.rows]) {
  assert.equal(rows.length, 25)
  for (const row of rows) assert.equal(row.length, 25)
}

// 源码级：禁止再拿 API_BASE_URL 直接比首页地址。
const posterSource = fs.readFileSync(path.join(root, 'utils/matchmaker-promo-poster.uts'), 'utf8')
assert.doesNotMatch(posterSource, /API_BASE_URL\s*==\s*PROD_HOME_URL/)
assert.match(posterSource, /PLATFORM_HOME_URL = IS_PROD_BACKEND \? PROD_HOME_URL : TEST_HOME_URL/)

console.log('poster home url contract checks passed')