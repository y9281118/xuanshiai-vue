const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')

const page = fs.readFileSync(path.join(__dirname, '../pagesSub/matchmaker/components/MatchmakerPendingReview.uvue'), 'utf8')
const source = page.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const names = ['nonEmptyFilterValues', 'memberFromWorkbench', 'loadWorkbenchMembers', 'loadMoreMembers', 'loadMembers']
const body = parser.parse(source, { sourceType: 'module', plugins: ['typescript'] }).program.body
const selected = body.filter(node => names.includes(node.declarations?.[0]?.id?.name)).map(node => source.slice(node.start, node.end)).join('\n')
const compiled = babel.transformSync(selected, { filename: 'vip.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
const ref = value => ({ value })
const state = {
  memberPage: ref(1), hasMoreMembers: ref(false), loading: ref(false), loadingMoreMembers: ref(false),
  keyword: ref(''), appliedMemberFilter: ref({}), rawMembers: ref([]), members: ref([]),
  activeTab: ref('vip_online'), errorMessage: ref(''), emitServedCount() {},
}
let response, calls = []
const api = vm.runInNewContext(compiled + '\n;({loadMembers,loadMoreMembers})', {
  ...state, getMatchmakerReviewMembers: async params => { calls.push(params); return response },
})
const result = (id, page = 1, hasMore = false, version = 3) => ({ success: true, data: {
  items: [{ user_id: id, nickname: '会员' + id }], page, has_more: hasMore,
  member_pool_version: 1, filter_version: version,
} })

async function run() {
  assert.ok(!source.includes('getDiscoveryPlaza') && !source.includes('memberFromPlaza'))
  for (const [tab, filter] of [['vip_online', 'online_vip'], ['vip_offline', 'offline_vip']]) {
    calls = []
    state.activeTab.value = tab
    state.keyword.value = ' 测试姓名 '
    state.appliedMemberFilter.value = { gender: 'female' }
    response = result(12, 1, true)
    await api.loadMembers()
    assert.equal(calls[0].member_pool, 'all')
    assert.equal(calls[0].search, '测试姓名')
    assert.deepEqual(JSON.parse(calls[0].filters), { gender: 'female', [filter]: '1' })
    assert.equal(state.members.value[0].user_id, 12)
    assert.equal(state.members.value[0].is_vip, true)
    response = result(10, 2)
    await api.loadMoreMembers()
    assert.equal(calls[1].page, 2)
    assert.equal(calls[1].filters, calls[0].filters)
    assert.equal(state.members.value.map(item => item.user_id).join(','), '12,10')
    assert.equal(state.hasMoreMembers.value, false)
    await api.loadMoreMembers()
    assert.equal(calls.length, 2)
    response = { success: false, code: 403, message: '无工作台权限' }
    await api.loadMembers()
    assert.equal(state.errorMessage.value, '无工作台权限')
    assert.equal(state.members.value.length, 0)
    response = result(20, 1, false, tab === 'vip_online' ? 1 : 2)
    await api.loadMembers()
    assert.equal(state.members.value.length, 0)
    assert.match(state.errorMessage.value, /更新后端/)
    response = { success: true, data: { ...result(1).data, items: [] } }
    await api.loadMembers()
    assert.equal(state.members.value.length, 0)
    assert.equal(state.errorMessage.value, '')
  }
  console.log('VIP tab checks passed: online/offline source, search, filters, pagination, permissions, old server, empty state')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
