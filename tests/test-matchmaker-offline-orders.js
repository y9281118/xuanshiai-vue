const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')

const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const component = read('pagesSub/matchmaker/components/MatchmakerOfflineOrders.uvue')
const page = read('pagesSub/matchmaker/become-matchmaker.uvue')
const center = read('pagesSub/matchmaker/components/MatchmakerManagementCenter.uvue')
const api = read('api/matchmaker.uts')
const mock = read('mock/matchmaker.uts')

const compile = (source, names, file) => {
  const body = parser.parse(source, { sourceType: 'module', plugins: ['typescript'] }).program.body
  const declarations = body.map(node => node.type == 'ExportNamedDeclaration' ? node.declaration : node).filter(node => node != null && node.declarations != null)
  const selected = declarations.filter(node => names.includes(node.declarations[0]?.id?.name)).map(node => source.slice(node.start, node.end)).join('\n')
  assert.ok(selected.length > 0, '未提取到 ' + names.join(',') + '（' + file + '）')
  return babel.transformSync(selected, { filename: file, configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
}

const script = component.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const ref = value => ({ value })
const state = { rows: ref([]), loading: ref(false), errorMessage: ref(''), usingDemoData: ref(false) }
let response
const sandbox = {
  ...state,
  getMatchmakerOfflineOrders: async () => { if (response instanceof Error) throw response; return response },
  isNaN, Number, String, Math, Array, JSON,
}
const code = compile(script, ['amountText', 'loadRows'], 'offline-orders.ts')
const ui = vm.runInNewContext(code + '\n;({amountText,loadRows})', sandbox)

const mockCode = compile(mock, ['demoWomen', 'demoMen', 'matchmakingAnimeAvatar', 'mockMatchmakerOfflineOrders'], 'mock-matchmaker.ts')
const mockData = vm.runInNewContext(mockCode + '\n;mockMatchmakerOfflineOrders', { String, Number })

async function run() {
  // 版式：设计图的须知卡 + 开单卡四段信息 + 到底提示，一段都不能少。
  for (const copy of ['须知', '以下是您名下客源成功签单成为我们平台线下VIP服务客户的记录', '开单时间：', '签单会员', '销售红娘：', '签单金额：', '没有更多了']) {
    assert.ok(component.includes(copy), '缺少设计图文案：' + copy)
  }
  // 色调继承：只复用工作台既有 Token，导图的紫色不得落成色值。
  const style = component.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1]
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(style), '组件散落新色值')
  for (const token of ['var(--canvas)', 'var(--surface)', 'var(--accent2)', 'var(--accent-bg)', 'var(--match-coral)', 'var(--shadow-sm)']) {
    assert.ok(style.includes(token), '未继承 Token：' + token)
  }
  // 外壳给 scroll-view 一个有高度的父盒（pr-shell 配方）；下拉刷新会在须知卡上方留 55px 空带，设计图没有，故不挂。
  assert.ok(/^<template>\s*<view class="oo-shell">/.test(component), '组件根不是 oo-shell 外壳')
  assert.ok(style.includes('.oo-shell { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column;'), '外壳未按 pr-shell 配方撑满')
  assert.ok(component.includes('class="oo-scroller"') && style.includes('.oo-scroller { flex: 1; height: 0;'), '滚动区未撑满父级 flex')
  assert.ok(!component.includes('refresher-') && !component.includes('onRefresh'), '不要在该页挂下拉刷新')

  // 独立页：管理中心「线下业绩」按 key 路由到线下开单明细，不再进财务明细工作区。
  assert.ok(center.includes("action: '线下开单明细'") && center.includes("item.key == 'offline_performance'"))
  assert.ok(page.includes("name == 'metric:offline_performance' || name == '线下开单明细'") && page.includes('openOfflineOrders()'))
  assert.ok(page.includes('<MatchmakerOfflineOrders v-else-if="offlineOrdersVisible" />'))
  assert.ok(page.includes("offlineOrdersVisible ? '线下开单明细'"))
  assert.ok(/if \(offlineOrdersVisible\.value\) \{\s*closeOfflineOrders\(\)/.test(page), '返回键未先关线下开单明细')
  // 与财务明细彻底解耦：旧的共用列表、状态与加载器都不应留在页面里。
  for (const dead of ['workspaceFinanceRows', 'workspaceFinanceLoading', 'loadWorkspaceOfflineIncome', 'getMatchmakerWorkspaceOfflineIncome']) {
    assert.ok(!page.includes(dead), '仍与财务明细共用：' + dead)
  }
  assert.ok(!api.includes('getMatchmakerWorkspaceOfflineIncome') && !mock.includes('mockMatchmakerFinanceEntries'))
  // 财务明细入口本身保留。
  assert.ok(page.includes("openWorkspace('财务明细', 'income-placeholder')"))

  // 数据源：本期演示数据，接口层与 mock 索引都要能取到。
  assert.ok(api.includes('export async function getMatchmakerOfflineOrders') && api.includes('isDemo: true'))
  assert.ok(read('api/index.uts').includes('getMatchmakerOfflineOrders') && read('mock/index.uts').includes('mockMatchmakerOfflineOrders'))
  assert.equal(mockData.length, 6)
  const first = mockData[0]
  assert.equal(first.date, '2026-11-11')
  assert.equal(first.name, '456')
  assert.equal(first.salesMatchmaker, '芸希老师')
  assert.equal(first.amount, 1)
  assert.equal(first.avatar, '')
  const dates = Array.from(mockData).map(row => String(row.date))
  assert.deepEqual(dates, [...dates].sort().reverse(), '开单记录未按时间倒序')
  assert.ok(dates.length == 6 && Array.from(mockData).some(row => String(row.avatar).length > 0) && Array.from(mockData).some(row => String(row.avatar).length == 0), '头像需覆盖有图与占位两种')

  // 金额：整元不带小数，角分保留两位，千位分组。
  assert.equal(ui.amountText(1), '1元')
  assert.equal(ui.amountText(2980), '2,980元')
  assert.equal(ui.amountText(1280.5), '1,280.50元')
  assert.equal(ui.amountText(0), '0元')
  assert.equal(ui.amountText('abc'), '--')

  response = { success: true, data: { items: mockData, total: mockData.length, isDemo: true } }
  await ui.loadRows()
  assert.equal(state.rows.value.length, 6)
  assert.equal(state.usingDemoData.value, true)
  assert.equal(state.loading.value, false)
  assert.equal(state.errorMessage.value, '')

  response = { success: true, data: { items: [], total: 0, isDemo: true } }
  await ui.loadRows()
  assert.equal(state.rows.value.length, 0)
  assert.equal(state.errorMessage.value, '')

  response = { success: false, code: 403, message: '无工作台权限' }
  await ui.loadRows()
  assert.equal(state.errorMessage.value, '无工作台权限')
  assert.equal(state.usingDemoData.value, false)
  assert.equal(state.rows.value.length, 0)

  response = new Error('socket hang up')
  await ui.loadRows()
  assert.equal(state.errorMessage.value, '网络数据加载失败，请稍后重试')
  assert.equal(state.loading.value, false)

  console.log('Offline order checks passed: layout copy, token inheritance, standalone routing, decoupled finance, mock source, amount formatting, load/empty/error, shell-root layout')
}
run().catch(error => { console.error(error); process.exitCode = 1 })