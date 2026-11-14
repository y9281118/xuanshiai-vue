const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')

const page = fs.readFileSync('pagesSub/matchmaker/components/MatchmakerPendingReview.uvue', 'utf8')
const script = page.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const program = parser.parse(script, { sourceType: 'module', plugins: ['typescript'] }).program
const declaration = program.body.find(node => node.type === 'VariableDeclaration' && node.declarations[0]?.id?.name === 'openMemberProfile')
const code = babel.transformSync(script.slice(declaration.start, declaration.end), { filename: 'member-home.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
let target = '', message = ''
const open = vm.runInNewContext(code + '\n;openMemberProfile', { closeMenu() {}, notify: value => { message = value }, uni: { navigateTo: value => { target = value.url } }, Number, isNaN })
open({ user_id: 40 })
assert.equal(target, '/pagesSub/userExtra/user/detail?userId=40&guest=1&matchmakerActions=1')
open({ user_id: 'invalid' })
assert.equal(message, '会员编号无效')
const detail = fs.readFileSync('pagesSub/userExtra/user/detail.uvue', 'utf8')
assert.ok(detail.includes("options.guest === '1'"))
assert.ok(detail.includes("options.matchmakerActions === '1'"))
assert.ok(detail.includes('!fromMatchmaker && !matchmakerActions && !detailLoading'))
assert.ok(detail.includes('(fromMatchmaker || matchmakerActions) && !isPreview'))
assert.ok(detail.includes('/pagesSub/matchmaker/become-matchmaker?workspace=center'))
console.log('Matchmaker member homepage route checks passed')
