const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const babel = require('@babel/core')

const page = fs.readFileSync('pagesSub/matchmaker/commission-level.uvue', 'utf8')
const script = page.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
const js = babel.transformSync(script, { filename: 'commission.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
let show, hide, tick, cleared = false
let name = '初级分成'
const context = {
  ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }),
  onShow: fn => { show = fn }, onHide: fn => { hide = fn }, onUnload() {},
  setInterval: fn => { tick = fn; return 123 }, clearInterval: () => { cleared = true },
  getMatchmakerCommissionStandards: async () => ({ success: true, data: { levels: [], events: [], currentLevelName: name } }),
}
const state = vm.runInNewContext(js + '\n;({currentLevelName,currentLevelTitle,levels,events,loading})', context)
const flush = () => new Promise(resolve => setImmediate(resolve))

async function main() {
  show(); await flush()
  assert.equal(state.currentLevelName.value, '初级分成')
  name = '高级分成'; tick(); await flush()
  assert.equal(state.currentLevelName.value, '高级分成')
  assert.equal(state.currentLevelTitle, '您当前的分成标准(中级分成)')
  assert.equal(state.levels.value.length, 4)
  assert.equal(state.events.value.length, 14)
  assert.equal(state.events.value.find(item => item.key === 'top6').amount, '120元')
  name = null; tick(); await flush()
  assert.equal(state.currentLevelName.value, '初级分成')
  hide(); assert.equal(cleared, true)
  console.log('commission level refresh: initial load, changed level and timer cleanup passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
