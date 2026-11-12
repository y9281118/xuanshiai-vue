const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const parser = require('@babel/parser')
const babel = require('@babel/core')
const page = fs.readFileSync(require('node:path').join(__dirname, '../pagesSub/matchmaker/become-matchmaker.uvue'), 'utf8')
const source = page.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const body = parser.parse(source, { sourceType: 'module', plugins: ['typescript'] }).program.body
const node = body.find(x => x.declarations?.[0]?.id?.name === 'workspaceVisibleLeads')
const js = babel.transformSync(source.slice(node.start, node.end), { filename: 'lead-filter.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
const data = { status: '', creator: '', source: '', ageMin: '', ageMax: '', owner: '', stored: '', intention: '' }
const rows = [
 { id: 1, status: 'NEW', creator: '甲', source: '微信', age: 25, matchmakerId: 1, convertedUserId: '', intentionValue: 1, name: '小王', phone: '', wechat: '', abandonedAt: '' },
 { id: 2, status: 'CONTACTED', creator: '乙', source: '朋友', age: 35, matchmakerId: 0, convertedUserId: '9', intentionValue: 2, name: '小李', phone: '', wechat: '', abandonedAt: '' },
 { id: 3, status: 'LOST', creator: '甲', source: '微信', age: 0, matchmakerId: 1, convertedUserId: '', intentionValue: 1, name: '其他', phone: '', wechat: '', abandonedAt: '' },
]
const tab = { value: '客源线索' }, applied = { value: { ...data } }
const get = vm.runInNewContext(js + '\n;workspaceVisibleLeads', { computed: fn => fn, workspaceLeads: { value: rows }, workspaceActiveTab: tab, leadFilterApplied: applied, workspaceKeyword: { value: '' } })
const ids = () => Array.from(get(), x => x.id).join(',')
assert.equal(ids(), '1,2')
for (const [key, value, expected] of [['status','NEW','1'],['creator','乙','2'],['source','微信','1'],['owner','1','1'],['owner','__unassigned__','2'],['stored','yes','2'],['stored','no','1'],['intention','2','2'],['ageMin','26','2'],['ageMax','30','1']]) {
 applied.value = { ...data, [key]: value }; assert.equal(ids(), expected, key)
}
applied.value = { ...data, ageMin:'25', ageMax:'25', source:'微信', creator:'甲', owner:'1', stored:'no' }
assert.equal(ids(), '1')
tab.value = '弃海客源'; applied.value = { ...data }; assert.equal(ids(), '3')
applied.value.ageMin = '18'; assert.equal(ids(), '')
for (const label of ['客源状态','录入人','客户来源','客户年龄','分派跟进','入库情况']) assert.ok(source.includes(label))
console.log('workspace lead filter checks passed')
