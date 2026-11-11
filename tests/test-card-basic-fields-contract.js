// FE-33-03 / Q4：首页卡片与详情页的基础 9 格必须语义一致。
//
// 可复现根因：后端卡片 zodiac = 属相（app/schemas/discovery.py:91），卡片不下发
// constellation / birthday；首页却把这一格标成「星座」，于是同一个人在首页显示
// 属相、在详情页显示真星座。第二个 bug：mapCard 把缺值年龄压成 Number(0)，
// 首页用 != null 判空恒真 → 渲染「0岁」。
// 本测试沙箱执行真实的 basicInfoRows，不用正则猜行为。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const home = read('pages/index/index.uvue')
const detail = read('pagesSub/userExtra/user/detail.uvue')
const fieldDisplay = read('utils/profile-field-display.uts')

// 从 marker 起按方括号配平截出数组字面量
function sliceArray(src, marker) {
  const start = src.indexOf(marker)
  assert.ok(start >= 0, '源码缺少片段：' + marker)
  const open = src.indexOf('[', start)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++
    else if (src[i] === ']') {
      depth--
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  throw new Error('方括号未配平：' + marker)
}

const LABELS = [
  ['年龄', '身高', '体重'],
  ['属相', '学历', '职业'],
  ['现居', '家乡', '收入']
]

function labelsOf(rows) {
  return rows.map((row) => row.map((cell) => cell.label))
}

// ── 1. 首页 9 格：沙箱执行 ─────────────────────────────────────────────
const homeRowsExpr = sliceArray(home, 'const basicInfoRows = computed(() =>')
function homeRows(card) {
  return new Function(
    'currentRecommendUser',
    'dimensionText',
    'educationText',
    'formatIncomeDisplay',
    'locationTextByCityCode',
    'return ' + homeRowsExpr + ';'
  )(
    { value: card },
    (value, unit) => (Number(value) > 0 ? '' + value + unit : '未填写'),
    (value) => (value != null && value !== '' ? '' + value : '未填写'),
    (value) => (value != null && value !== '' ? '' + value : '未填写'),
    () => ''
  )
}

{
  const rows = homeRows({
    age: 28, height: 178, weight: 70, zodiac: '虎', education: '本科',
    job: '工程师', residenceDisplay: '浙江 杭州市', hometown: '江苏 南京市', income: '20-30万'
  })
  assert.equal(rows.length, 3, '首页基础信息必须是 3 行')
  rows.forEach((row) => assert.equal(row.length, 3, '首页基础信息每行必须是 3 列'))
  assert.deepEqual(labelsOf(rows), LABELS, '首页 9 格标签顺序须与详情页一致（第 4 格为属相）')
  assert.equal(rows[1][0].value, '虎', '第 4 格取卡片 zodiac')
  assert.equal(rows[0][0].value, '28岁', '有值年龄正常渲染')
}

// ── 2. 缺值不得渲染成「0岁」「0cm」 ────────────────────────────────────
{
  // mapCard 缺值把 age/height/weight 压成 0，不是 null
  const rows = homeRows({ age: 0, height: 0, weight: 0, zodiac: '', education: '', job: '', city: '', hometown: '', income: '' })
  assert.equal(rows[0][0].value, '未填写', '年龄为 0（缺值）必须显示未填写，不得渲染「0岁」')
  assert.equal(rows[0][1].value, '未填写', '身高缺值显示未填写')
  assert.equal(rows[0][2].value, '未填写', '体重缺值显示未填写')
  assert.equal(rows[1][0].value, '未填写', '属相缺值显示未填写')
  assert.equal(rows[1][2].value, '未填写', '职业缺值显示未填写')
  assert.equal(rows[2][1].value, '未填写', '家乡缺值显示未填写')
}
assert.doesNotMatch(
  homeRowsExpr,
  /currentRecommendUser\.value\.age != null/,
  '年龄判空不得使用 != null：mapCard 缺值是 0 而不是 null，必须与 dimensionText 同为 > 0 口径'
)
assert.match(homeRowsExpr, /Number\(currentRecommendUser\.value\.age\) > 0/, '年龄须按 > 0 判空')

// ── 3. 首页不得把 zodiac 标成星座；详情页星座仍取 constellation ─────────
assert.doesNotMatch(home, /label: '星座'/, '首页卡片没有 constellation 字段，不得出现「星座」格')
assert.match(homeRowsExpr, /label: '属相', value: currentRecommendUser\.value\.zodiac/, '首页第 4 格必须是属相 + zodiac')
assert.match(home, /zodiac = 属相/, '首页注释须写明卡片 zodiac 的真实语义，避免后人又改回星座')

const detailRows = sliceArray(detail, 'const mappedInfo = [')
assert.match(detailRows, /\{ label: '星座', value: constellation \}/, '详情页第 4 格仍是真星座 constellation')
assert.match(detailRows, /\{ label: '年龄', value: age == missing \? missing : age \+ '岁' \}/, '详情页年龄缺值同样显示未填写')
// 属相在详情页属「详细资料」，独立取 zodiac，不与星座混格
assert.match(detail, /\{ label: '属相', value: pickDetail\(\['zodiac'\]\)/, '详情页详细资料里的属相独立取 zodiac')

// ── 4. 折叠阈值单一来源 ────────────────────────────────────────────────
assert.match(
  fieldDisplay,
  /export const CERT_TAGS_COLLAPSED_COUNT = 3/,
  '认证折叠阈值必须收口到 utils/profile-field-display.uts'
)
for (const [name, src] of [['首页', home], ['详情页', detail]]) {
  assert.match(src, /import \{[^}]*CERT_TAGS_COLLAPSED_COUNT[^}]*\} from '@\/utils\/profile-field-display\.uts'/, name + '须引用共享折叠阈值')
}
assert.match(home, /currentCertTags\.value\.slice\(0, CERT_TAGS_COLLAPSED_COUNT\)/, '首页折叠须用共享常量')
assert.match(home, /currentCertTags\.value\.length - CERT_TAGS_COLLAPSED_COUNT/, '首页 +N 计数须用共享常量')
assert.doesNotMatch(detail, /certs\.value\.slice\(0, 3\)/, '详情页不得再写死折叠阈值 3')
assert.match(detail, /certs\.value\.slice\(0, certCollapsedCount\)/, '详情页折叠须用共享常量派生的本地绑定')
assert.match(detail, /const certCollapsedCount = CERT_TAGS_COLLAPSED_COUNT/, '详情页模板绑定须来自共享常量')
assert.match(detail, /v-if="certs\.length > certCollapsedCount"/, '详情页展开入口阈值须同源')

// ── 5. 人脸认证有专属条目，不落通用兜底 ─────────────────────────────────
assert.match(detail, /'人脸认证': \{ icon: '[^']+', desc: '[^']+' \}/, 'CERT_META 须含人脸认证条目')
assert.match(detail, /'人脸': \{ icon: '[^']+', desc: '[^']+' \}/, 'CERT_META 须兼容后端不带「认证」后缀的标签')

// ── 6. 切换推荐用户必须重置展开态 ──────────────────────────────────────
{
  const resets = (home.match(/certTagsExpanded\.value = false/g) || []).length
  assert.ok(resets >= 2, '刷新列表与切换用户两处都要重置 certTagsExpanded（当前 ' + resets + ' 处）')
  const switchBlock = home.slice(home.indexOf('const switchToNextRecommend = () =>'))
  assert.match(
    switchBlock.slice(0, switchBlock.indexOf('const blockVisible')),
    /certTagsExpanded\.value = false/,
    '切换推荐用户必须重置认证展开态，否则 A 展开后 B 默认全展开'
  )
}

console.log('PASS 卡片基础字段契约：9 格语义一致、缺值不渲染 0、折叠阈值单一来源')