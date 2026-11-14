const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')

const page = fs.readFileSync('pages/matchmaker/matchmaker.uvue', 'utf8')
const script = page.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const names = ['matchmakerEntryStatus', 'matchmakerEntryLabel', 'matchmakerAccessRequest', 'refreshMatchmakerAccess', 'handleBecomeMatchmaker']
const ast = parser.parse(script, { sourceType: 'module', plugins: ['typescript'] }).program
const selected = ast.body.filter(node => node.type === 'VariableDeclaration' && names.includes(node.declarations[0]?.id?.name)).map(node => script.slice(node.start, node.end)).join('\n')
const code = babel.transformSync(selected, { filename: 'entry.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
let token = 'session', response, url = ''
const context = { ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }), getAccessToken: () => token, getMatchmakerManagementCenterAccess: async () => response, uni: { navigateTo: value => { url = value.url } } }
const state = vm.runInNewContext(code + '\n;({ matchmakerEntryStatus, matchmakerEntryLabel, refreshMatchmakerAccess, handleBecomeMatchmaker })', context)
async function run() {
  response = { success: true, data: { canAccess: true } }
  await state.refreshMatchmakerAccess()
  assert.equal(state.matchmakerEntryLabel.value, '红娘管理中心')
  state.handleBecomeMatchmaker()
  assert.equal(url, '/pagesSub/matchmaker/become-matchmaker?workspace=center')
  response = { success: true, data: { canAccess: false } }
  await state.refreshMatchmakerAccess()
  state.handleBecomeMatchmaker()
  assert.equal(url, '/pagesSub/matchmaker/become-matchmaker')
  response = { success: false }
  await state.refreshMatchmakerAccess()
  assert.equal(state.matchmakerEntryLabel.value, '重新核验')
  token = ''
  await state.refreshMatchmakerAccess()
  assert.equal(state.matchmakerEntryLabel.value, '我要做红娘')
  const center = fs.readFileSync('pagesSub/matchmaker/become-matchmaker.uvue', 'utf8')
  assert.ok(center.includes("directCenterMode.value = autoOpenWorkspace.value == 'center'"))
  assert.ok(center.includes('managementCenterLoading || directCenterMode'))
  console.log('Matchmaker entry access checks passed')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
