const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')

const source = fs.readFileSync('api/matchmaker.uts', 'utf8')
const program = parser.parse(source, { sourceType: 'module', plugins: ['typescript'] }).program
const names = ['formatWorkspaceMoney', 'signedWorkspaceMoney', 'sumDemoAmounts', 'getMatchmakerWorkspaceCommissionEntries']
const selected = program.body.map(n => n.type === 'ExportNamedDeclaration' ? n.declaration : n)
  .filter(n => n && n.type === 'FunctionDeclaration' && names.includes(n.id.name))
  .map(n => source.slice(n.start, n.end)).join('\n')
const code = babel.transformSync(selected, { filename: 'commission.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
let requested
const context = {
  USE_MOCK: false, mockMatchmakerCommissionEntries: [],
  request: async options => { requested = options; return { success: true, data: { items: [{ id: 17, consumer_name: '会员', event_name: '服务奖励', amount: '30.00', status: 'AVAILABLE' }], total: 1, page: 1, page_size: 20, total_amount: '30.00' } } },
  formatWorkspaceTime: () => '', resolveMediaUrl: x => x, Number, String, Math, Array, isNaN,
}
const load = vm.runInNewContext(code + '\n;getMatchmakerWorkspaceCommissionEntries', context)
load(1, 20).then(result => {
  assert.equal(requested.url, '/matchmaker/workbench/commission-entries')
  assert.equal(result.data.items[0].name, '会员')
  assert.equal(result.data.items[0].item, '服务奖励')
  assert.equal(result.data.items[0].amount, '+￥30.00')
  assert.equal(result.data.totalAmount, '￥30.00')
  assert.ok(fs.readFileSync('api/matchmaker-remote.uts', 'utf8').includes('GET /matchmaker/workbench/commission-entries'))
  console.log('Workspace commission source checks passed')
}).catch(error => { console.error(error); process.exitCode = 1 })
