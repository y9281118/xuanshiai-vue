const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const parser = require('@babel/parser')
const babel = require('@babel/core')
const page = fs.readFileSync('pagesSub/userExtra/user/edit.uvue', 'utf8')
const source = page.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const names = ['occupationOptions', 'occupationOtherSelected', 'occupationText', 'occupationPickerIndex', 'onOccupationChange']
const ast = parser.parse(source, { sourceType: 'module', plugins: ['typescript'] })
const nodes = ast.program.body.filter(node => node.declarations && names.includes(node.declarations[0].id.name))
const extracted = nodes.map(node => source.slice(node.start, node.end)).join('\n')
const js = babel.transformSync(extracted, { filename: 'occupation.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
const state = { formData: { value: { occupation: '' } }, textValue: value => value == null ? '' : String(value), ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }) }
const api = vm.runInNewContext(js + '\n;({occupationOptions,occupationOtherSelected,occupationPickerIndex,onOccupationChange})', state)
const other = api.occupationOptions.length - 1
api.onOccupationChange({ detail: { value: other } })
assert.equal(api.occupationPickerIndex.value, other, '选择其他后应保留选择并显示输入框')
state.formData.value.occupation = '自定义职业'
assert.equal(api.occupationPickerIndex.value, other, '输入后保持其他')
api.occupationOtherSelected.value = false
assert.equal(api.occupationPickerIndex.value, other, '重新读取自定义职业后回显其他')
api.onOccupationChange({ detail: { value: 1 } })
assert.equal(state.formData.value.occupation, api.occupationOptions[1])
assert.equal(api.occupationPickerIndex.value, 1, '切换标准职业后取消其他')
api.onOccupationChange({ detail: { value: 0 } })
assert.equal(api.occupationPickerIndex.value, 0)
assert.equal(state.formData.value.occupation, '')
assert.ok(page.includes("occupationPickerIndex == occupationOptions.length - 1 ? '其他'"))
console.log('occupation checks passed: select other, input, reload and switch options')
