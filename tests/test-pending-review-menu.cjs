const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')

const source = fs.readFileSync(path.join(__dirname, '../pagesSub/matchmaker/components/MatchmakerPendingReview.uvue'), 'utf8')
const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const nodes = parser.parse(script, { sourceType: 'module', plugins: ['typescript'] }).program.body
const declaration = nodes.find(node => node.type === 'VariableDeclaration' && node.declarations[0]?.id?.name === 'toggleMenu')
const code = babel.transformSync(script.slice(declaration.start, declaration.end), { filename: 'menu.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
const menuForId = { value: 0 }, menuLeft = { value: 0 }, menuTop = { value: 0 }
let calls = 0
const context = { menuForId, menuLeft, menuTop, activeTab: { value: 'PENDING' }, uni: { getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667 }) }, closeMenu: () => { menuForId.value = 0 }, loadIntroCount: () => { calls++ }, Number, Math }
const toggle = vm.runInNewContext(code + '\n;toggleMenu', context)
toggle({ user_id: 11, introCount: 0 }, { detail: { x: 50, y: 1500 }, changedTouches: [{ clientX: 50, clientY: 600 }] })
assert.equal(menuForId.value, 11)
assert.ok(menuTop.value >= 8 && menuTop.value < 600, '底部点击应在按钮上方显示菜单')
assert.equal(calls, 1)
toggle({ user_id: 11 }, {})
assert.equal(menuForId.value, 0)
toggle({ user_id: 12, introCount: 1 }, { detail: { x: 45, y: 40 } })
assert.equal(menuForId.value, 12)
assert.ok(menuTop.value >= 8 && menuTop.value <= 667 - 210 - 8)
console.log('Pending review menu checks passed')
