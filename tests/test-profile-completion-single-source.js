const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const editPage = fs.readFileSync(path.join(root, 'pagesSub/userExtra/user/edit.uvue'), 'utf8')
const profilePage = fs.readFileSync(path.join(root, 'pages/profile/profile.uvue'), 'utf8')
const authApi = fs.readFileSync(path.join(root, 'api/auth.uts'), 'utf8')

// 完整度只能有一个数据源：/users/me/completion。
assert.ok(editPage.includes('getProfileCompletion()'), 'edit page must read /completion')
assert.ok(profilePage.includes('getProfileCompletion()'), 'profile page must read /completion')
assert.ok(
  editPage.includes(":style=\"{ width: (completionLoaded ? completeness : 0) + '%' }\"") &&
  profilePage.includes(":style=\"{ width: (completionLoaded ? profileCompletion : 0) + '%' }\""),
  'both progress bars must bind the score returned by /completion',
)
assert.ok(editPage.includes('const completeness = computed(() => completionScore.value)'), 'edit page must reuse the server score')
assert.ok(profilePage.includes('profileCompletion.value = Math.round(Number(score))'), 'profile page must reuse the server score')

// 前端不得本地累加，也不得保留硬编码权重表或旧文案。
assert.ok(!/completionScore\.value\s*\+=/.test(editPage), 'edit page must not accumulate completion locally')
assert.ok(!/score\s*\+=/.test(editPage), 'edit page must not sum weights locally')
assert.ok(!/avatar\s*:\s*1[0-9]\b/.test(editPage), 'edit page must not carry a hard-coded avatar weight')
assert.ok(!editPage.includes('+4%'), 'company hint must come from the API, not a hard-coded +4%')
assert.ok(!editPage.includes('补充后获得更多曝光'), 'legacy exposure copy must stay removed')
assert.ok(editPage.includes('填写后 +'), 'unfilled items must render 填写后 +X%')

// +X% 只能来自 items[].weight；缺 key 时不补默认权重。
assert.ok(editPage.includes('const weight = Number(item.weight)'), 'weight must be read from the completion item')
assert.ok(editPage.includes('if (item == null) return 0'), 'missing key must not fall back to a local weight')

// 9 项详细资料必须全部走接口 weight 提示。
;['company', 'household', 'house', 'car', 'school', 'ethnicity', 'smoking', 'drinking', 'religion'].forEach((key) => {
  assert.ok(
    editPage.includes(`detailPlaceholder('${key}'`) || editPage.includes(`completionText('${key}'`),
    `detail field ${key} must render its +X% hint from the completion API`,
  )
})

// 四重认证只有实名与单身承诺计分，文案必须标明。
assert.ok(editPage.includes('仅实名、单身承诺计分'), 'certification caption must state only two items score')

// Mock 必须自洽：score 由 items 推导，且不再返回第二份 completion_score。
assert.ok(authApi.includes('if (items[i].completed == true) score += items[i].weight'), 'mock score must derive from item weights')
assert.ok(!authApi.includes('completion_score'), 'completion mock must expose a single score field')

console.log('资料完整度单一数据源契约测试通过')
