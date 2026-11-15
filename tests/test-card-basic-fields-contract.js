// FE-33-03 / Q4：首页卡片与详情页的基础 9 格必须语义一致。
//
// 背景：后端卡片 zodiac = 属相（app/schemas/discovery.py）；2026-11-14 起要求首页
// 第 4 格展示**星座**，后端 DiscoveryCard 同步下发 constellation（user_profile.constellation
// → 生日推导兜底）。因此首页必须标「星座」且取 constellation，不得回退 zodiac，
// 否则同一人在首页显示属相、在详情页显示真星座。
// 第二个 bug：mapCard 把缺值年龄压成 Number(0)，首页用 != null 判空恒真 → 渲染「0岁」。
// 本测试沙箱执行真实的 basicInfoRows，不用正则猜行为。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const home = read('pages/index/index.uvue')
const detail = read('pagesSub/userExtra/user/detail.uvue')
const fieldDisplay = read('utils/profile-field-display.uts')
const discoveryApi = read('api/discovery.uts')

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
  ['星座', '学历', '职业'],
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
    'constellationText',
    'return ' + homeRowsExpr + ';'
  )(
    { value: card },
    (value, unit) => (Number(value) > 0 ? '' + value + unit : '未填写'),
    (value) => (value != null && value !== '' ? '' + value : '未填写'),
    (value) => (value != null && value !== '' ? '' + value : '未填写'),
    () => '',
    (value) => {
      if (value == null) return '未填写'
      const text = ('' + value).trim()
      return text == '' ? '未填写' : text
    }
  )
}

{
  const rows = homeRows({
    age: 28, height: 178, weight: 70, zodiac: '虎', constellation: '天秤座', education: '本科',
    job: '工程师', residenceDisplay: '浙江 杭州市', hometown: '江苏 南京市', income: '20-30万'
  })
  assert.equal(rows.length, 3, '首页基础信息必须是 3 行')
  rows.forEach((row) => assert.equal(row.length, 3, '首页基础信息每行必须是 3 列'))
  assert.deepEqual(labelsOf(rows), LABELS, '首页 9 格标签顺序须与详情页一致（第 4 格为星座）')
  assert.equal(rows[1][0].value, '天秤座', '第 4 格取卡片 constellation，不得取 zodiac')
  assert.equal(rows[0][0].value, '28岁', '有值年龄正常渲染')
}

// ── 2. 缺值不得渲染成「0岁」「0cm」 ────────────────────────────────────
{
  // mapCard 缺值把 age/height/weight 压成 0，不是 null
  const rows = homeRows({ age: 0, height: 0, weight: 0, zodiac: '虎', constellation: '', education: '', job: '', city: '', hometown: '', income: '' })
  assert.equal(rows[0][0].value, '未填写', '年龄为 0（缺值）必须显示未填写，不得渲染「0岁」')
  assert.equal(rows[0][1].value, '未填写', '身高缺值显示未填写')
  assert.equal(rows[0][2].value, '未填写', '体重缺值显示未填写')
  assert.equal(rows[1][0].value, '未填写', '星座缺值显示未填写（只有 zodiac 也不得顶替星座）')
  assert.equal(rows[1][2].value, '未填写', '职业缺值显示未填写')
  assert.equal(rows[2][1].value, '未填写', '家乡缺值显示未填写')
}
assert.doesNotMatch(
  homeRowsExpr,
  /currentRecommendUser\.value\.age != null/,
  '年龄判空不得使用 != null：mapCard 缺值是 0 而不是 null，必须与 dimensionText 同为 > 0 口径'
)
assert.match(homeRowsExpr, /Number\(currentRecommendUser\.value\.age\) > 0/, '年龄须按 > 0 判空')

// ── 3. 首页第 4 格必须是星座；详情页星座仍取 constellation ──────────────
assert.match(homeRowsExpr, /label: '星座', value: constellationText\(currentRecommendUser\.value\.constellation\)/, '首页第 4 格必须是星座 + constellation')
assert.doesNotMatch(homeRowsExpr, /label: '属相'/, '首页卡片不得再出现「属相」格')
assert.doesNotMatch(homeRowsExpr, /currentRecommendUser\.value\.zodiac/, '首页第 4 格不得回退到属相 zodiac')
assert.match(discoveryApi, /constellation: card\.constellation != null/, 'mapCard 须透传 constellation')
assert.match(discoveryApi, /constellation: card\.constellation != null \? '' \+ card\.constellation : ''/, 'mapCard 的 constellation 缺值须为空串，由页面显示未填写')

const detailRows = sliceArray(detail, 'const mappedInfo = [')
assert.match(detailRows, /\{ label: '星座', value: constellation \}/, '详情页第 4 格仍是真星座 constellation')
assert.match(detailRows, /\{ label: '年龄', value: age == missing \? missing : age \+ '岁' \}/, '详情页年龄缺值同样显示未填写')
// 属相在详情页属「详细资料」，独立取 zodiac，不与星座混格
assert.match(detail, /\{ label: '属相', value: pickDetail\(\['zodiac'\]\)/, '详情页详细资料里的属相独立取 zodiac')

// 星座切换日必须是标准表：4 月 20、10 月 24、11 月 23（原表各偏一天）。
// 后端 app/services/discovery.py:_constellation_from_birthday 用同一张表，
// tests/test_discovery_constellation.py 逐月锁边界；这里锁前端这一份。
assert.match(
  detail,
  /const cutoffs = \[20, 19, 21, 20, 21, 22, 23, 23, 23, 24, 23, 22\]/,
  '详情页星座切换日须为标准表（4月20/10月24/11月23），否则与后端卡片推出的星座不一致'
)

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

// ── 7. 姓名行紧跟性别符号（2026-11-14） ────────────────────────────────
// 需求：在「昵称，年龄」旁边（头像右侧）展示性别。卡片 gender 是 1/2 数值编码，
// 必须由页面转成 ♂/♀，且色值沿用 components/XsaDynamicCard.uvue 既有规范。
{
  const lineStart = home.indexOf('<view class="user-name-line">')
  assert.ok(lineStart >= 0, '首页缺少 user-name-line 姓名行')
  const nameLine = home.slice(lineStart, home.indexOf('</view>', home.indexOf('currentGenderSymbol')))

  const nameIdx = nameLine.indexOf('currentRecommendUser.name')
  const genderIdx = nameLine.indexOf('currentGenderSymbol')
  assert.ok(nameIdx >= 0, '姓名行须先渲染昵称与年龄')
  assert.ok(genderIdx > nameIdx, '性别符号须排在姓名年龄之后，紧跟同一行')

  assert.match(nameLine, /v-if="currentGenderSymbol != ''"/, '性别缺值须整体隐藏，不留空占位')
  assert.match(nameLine, /:aria-label="currentGenderAriaLabel"/, '性别符号须带无障碍文案')

  // 编码兼容：后端是 1/2，其他来源可能是「男/女」，两种都要认；
  // 不认就退化成空串隐藏，绝不允许兜底成「未知/保密」这类占位文案。
  assert.match(home, /const currentGenderValue = \(\): number =>/, '性别取值须收口到单一函数')
  for (const token of ["'1'", "'男'", "'male'", "'2'", "'女'", "'female'"]) {
    assert.ok(home.includes(token), '性别取值须兼容编码 ' + token)
  }
  assert.match(home, /if \(g == 1\) return '♂'/, '男须渲染 ♂')
  assert.match(home, /if \(g == 2\) return '♀'/, '女须渲染 ♀')
  assert.doesNotMatch(
    home.slice(home.indexOf('const currentGenderValue'), home.indexOf('const recommendationReasonText')),
    /未知|保密/,
    '性别不得有「未知/保密」之类兜底文案'
  )

  // 色值必须与项目既有性别图标规范一致，否则同一个人在两处颜色不同
  const maleColor = /\.gender-symbol\.male \{ color: (#[0-9A-Fa-f]{6})/.exec(home)
  const femaleColor = /\.gender-symbol\.female \{ color: (#[0-9A-Fa-f]{6})/.exec(home)
  assert.ok(maleColor != null, '首页须定义 .gender-symbol.male 颜色')
  assert.ok(femaleColor != null, '首页须定义 .gender-symbol.female 颜色')
  const dynamicCard = read('components/XsaDynamicCard.uvue')
  assert.ok(dynamicCard.includes(maleColor[1]), '男性色值须与 XsaDynamicCard 规范一致（' + maleColor[1] + '）')
  assert.ok(dynamicCard.includes(femaleColor[1]), '女性色值须与 XsaDynamicCard 规范一致（' + femaleColor[1] + '）')

  // 数据来源：mapCard 必须透传 gender，否则模板永远拿不到值
  assert.match(discoveryApi, /gender: card\.gender != null \? '' \+ card\.gender : ''/, 'mapCard 须透传 gender')
}

// ── 8. 模板调用的辅助函数必须定义在 <script setup> 顶层（ADDR-WRAP 回归） ──
// 2026-11-14 把 segsOf 写进了 mapDetailUser 内部，模板里的 segsOf(...) 被编译成
// _ctx.segsOf，实例上没有该方法 → 渲染期 TypeError → 详情页永远停在「正在加载资料」。
// 顶层语句在本文件行首无缩进，函数体内的语句有一层 tab，据此静态兜底。
{
  assert.match(detail, /in segsOf\(item\.value\)/, '详情页模板仍按 segsOf 分段渲染现居/家乡')
  const head = detail.slice(0, detail.indexOf('</script>'))
  const lines = head.split('\n')
  const defIdx = lines.findIndex((line) => /^const segsOf\b/.test(line))
  const mapIdx = lines.findIndex((line) => /^const mapDetailUser\b/.test(line))
  assert.ok(defIdx >= 0, 'segsOf 必须定义在 <script setup> 顶层（行首无缩进）；定义在函数内部会导致 _ctx.segsOf is not a function')
  assert.ok(mapIdx >= 0, '未找到 mapDetailUser 定义')
  assert.ok(defIdx < mapIdx, 'segsOf 须定义在 mapDetailUser 之前，确保它是 setup 顶层绑定而非局部闭包')
  assert.equal((detail.match(/const segsOf = /g) || []).length, 1, 'segsOf 只允许存在一份定义')
}

console.log('PASS 卡片基础字段契约：9 格语义一致、缺值不渲染 0、折叠阈值单一来源、姓名行带性别')