const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { parse, compileTemplate } = require('@vue/compiler-sfc')

const file = path.join(__dirname, '../pagesSub/matchmaker/become-matchmaker.uvue')
const source = fs.readFileSync(file, 'utf8')
const { descriptor, errors } = parse(source, { filename: file })

assert.deepEqual(errors, [], '红娘工作台页面应保持可解析')
const compiled = compileTemplate({ source: descriptor.template.content, filename: file, id: 'workspace-contact-dialog' })
assert.deepEqual(compiled.errors, [], '联系方式弹窗模板应保持可编译')

for (const text of ['已授权查看的联系方式', '手机号', '微信号', 'workspaceContactPhone', 'workspaceContactWechat']) {
  assert.ok(source.includes(text), `联系方式弹窗缺少 ${text}`)
}

assert.match(source, /copyWorkspaceContact\(workspaceContactPhone\)/, '手机号复制操作必须保留')
assert.match(source, /callWorkspaceContact/, '手机号拨打操作必须保留')
assert.match(source, /copyWorkspaceContact\(workspaceContactWechat\)/, '微信号复制操作必须保留')
assert.match(source, /workspaceContactPhone\.length == 0/, '未绑定手机号状态必须保留')
assert.match(source, /workspaceContactWechat\.length == 0/, '未绑定微信号状态必须保留')

for (const selector of ['.cc-kind', '.cc-contact-field', '.cc-btn.copy', '.xsa-contact-row.unavailable']) {
  assert.ok(source.includes(selector), `联系方式列表缺少样式 ${selector}`)
}

for (const token of ['var(--match-mist)', 'var(--accent)', 'var(--accent2)']) {
  assert.ok(source.includes(token), `联系方式弹窗必须使用红娘端色彩 Token：${token}`)
}
assert.match(source, /\.cc-badge\.phone,\r?\n\.cc-badge\.wechat/, '电话与微信图标必须使用统一的简约图标块')
for (const excluded of ['var(--review-lilac)', 'var(--review-purple)', 'var(--review-deep)', 'var(--sage)']) {
  const contactStyles = source.slice(source.indexOf('/* ===== 查看联系方式弹窗'), source.indexOf('/* ===== 录入客源线索'))
  assert.ok(!contactStyles.includes(excluded), `联系方式弹窗不应使用 ${excluded}`)
}

console.log('workspace contact dialog layout checks passed')
