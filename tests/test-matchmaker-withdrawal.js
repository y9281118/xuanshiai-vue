const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const babel = require('@babel/core')
const source = fs.readFileSync('pagesSub/matchmaker/components/MatchmakerWithdrawal.uvue', 'utf8').match(/<script[^>]*>([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '')
const code = babel.transformSync(source, { filename: 'withdraw.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
let toast = '', callCount = 0
const context = { ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }), onMounted() {},
  uni: { showToast: options => { toast = options.title } }, getRemoteFinanceBalance: async () => { callCount++; return { success: true, data: { available_amount: '25.50' } } } }
const ui = vm.runInNewContext(code + '\n;({method,amount,account,payee,balance,balanceText,selectMethod,loadBalance,submit})', context)
async function main() {
  await ui.loadBalance(); assert.equal(ui.balanceText.value, '25.50'); assert.equal(callCount, 1)
  ui.amount.value = '26'; ui.submit(); assert.match(toast, /不能超过余额/)
  ui.amount.value = '10'; ui.account.value = 'test'; ui.payee.value = 'test'; ui.submit(); assert.match(toast, /暂未开放/)
  ui.selectMethod('bank'); assert.equal(ui.method.value, 'bank'); assert.equal(ui.account.value, ''); assert.equal(ui.payee.value, '')
  ui.selectMethod('alipay'); assert.equal(ui.method.value, 'alipay')
  console.log('withdrawal checks passed: remote balance, amount limit, disabled submission, payment method switch')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
