const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const { parse, compileTemplate } = require('@vue/compiler-sfc')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pagesSub/userExtra/mytags/edit.uvue'), 'utf8')
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'mock/profile-tags.uts'), 'utf8').split('export const mockProfileTagOptions = ')[1])

function editor(options = {}) {
  const messages = [], writes = [], events = []
  let profile = options.profile || { personal_tags: ['科幻小说', '有幽默感'], custom_tags: [], custom_tag_categories: {} }
  const context = {
    ref: value => ({ value }),
    computed: fn => ({ get value() { return fn() } }),
    onLoad() {},
    setTimeout() {},
    uni: { getSystemInfoSync: () => ({}), showToast: v => messages.push(v.title), navigateBack() {}, showModal() {} },
    getOpenerEventChannel: () => ({ emit: (...args) => events.push(args) }),
    getProfileTagOptions: async () => ({ success: true, data: catalog }),
    getOwnProfile: async () => options.loadFailure ? { success: false } : { success: true, data: profile },
    updateOwnProfile: async data => {
      writes.push(data)
      if (options.saveFailure) throw Error('offline')
      if (options.pending) await options.pending
      profile = {
        personal_tags: options.mismatch ? ['科幻小说'] : [...data.personal_tags].reverse(),
        custom_tags: Object.keys(data.custom_tag_categories || {}),
        custom_tag_categories: data.custom_tag_categories || {}
      }
      return { success: true, data: profile }
    }
  }
  const script = source.split('<script setup lang="uts">')[1].split('</script>')[0].replace(/^import .*$/gm, '')
  const code = babel.transformSync(script + '\nglobalThis.editor = { load, clearTags, toggleTag, openCustomEditor, closeCustomModal, saveCustomTag, deleteEditingCustomTag, onCustomCategoryChange, saveAndBack, selectedItems, selectedLabels, customLabels, customDraft, customEnabled, maxCustomTags, customCategoryByLabel, customCategoryId, customModalVisible, customEditingLabel, canSave, loaded, profileReady, loadError, searchQuery, searchActive, displayTags, selectCategory, activeCategoryId, categoryNameForTag, categorySelectedCount, isCustomLabel };', {
    filename: 'tags.ts', configFile: false, babelrc: false,
    plugins: ['@babel/plugin-transform-typescript']
  }).code
  vm.runInNewContext(code, context)
  return { ...context.editor, messages, writes, events }
}

async function testPreferences() {
  const prefSource = fs.readFileSync(path.join(root, 'pagesSub/userExtra/user/preference.uvue'), 'utf8')
  const script = prefSource.split('<script setup lang="uts">')[1].split('</script>')[0].replace(/^import .*$/gm, '')
  let response = { success: true, data: {} }
  const writes = []
  const context = {
    ref: value => ({ value }), computed: fn => ({ get value() { return fn() } }),
    onMounted() {}, setTimeout() {}, locationJson: [],
    uni: { getSystemInfoSync: () => ({}), showToast() {}, navigateBack() {} },
    getOwnPreferences: async () => response,
    updateOwnPreferences: async data => { writes.push(data); return { success: true, data } }
  }
  const code = babel.transformSync(script + '\nglobalThis.pref = { load, save, setEduIndex, setMarriageTimeline, onOccupationChange, onExtraNoteInput, eduMin, eduIndex, marriageTimelineIndex, occupationIndex, extraNote, loaded };', { filename: 'preference.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] }).code
  vm.runInNewContext(code, context)
  const p = context.pref
  await p.load()
  assert.equal(p.marriageTimelineIndex.value, 0)
  assert.equal(p.occupationIndex.value, 0)
  assert.equal(p.extraNote.value, '')
  assert.equal(p.eduIndex.value, 0)

  response = { success: true, data: { marriage_timeline: '两年内结婚', preferred_occupation: '教师', extra_requirement: '希望对方喜欢运动', education_min: 5 } }
  await p.load()
  assert.equal(p.marriageTimelineIndex.value, 2)
  assert.equal(p.occupationIndex.value, 6)
  assert.equal(p.extraNote.value, '希望对方喜欢运动')
  assert.equal(p.eduIndex.value, 5)

  p.setMarriageTimeline(4)
  p.onOccupationChange({ detail: { value: 6 } })
  p.onExtraNoteInput({ detail: { value: '  新补充  ' } })
  p.setEduIndex(2)
  await p.save()
  assert.equal(writes[0].marriage_timeline, '时机成熟时结婚')
  assert.equal(writes[0].preferred_occupation, '教师')
  assert.equal(writes[0].extra_requirement, '新补充')
  assert.equal(writes[0].education_min, 2)

  // 旧“期待”的 1/2/3 标签串要翻成补充说明；旧的 6-8 学历要归零，不能再写回越界值。
  response = { success: true, data: { extra_requirement: '1,2,3', education_min: 7 } }
  await p.load()
  assert.equal(p.extraNote.value, '有稳定工作、重视家庭、愿意认真沟通')
  assert.equal(p.eduMin.value, null)
  assert.equal(p.eduIndex.value, 0)

  response = { success: false }
  await p.load()
  await p.save()
  assert.equal(p.loaded.value, false)
  assert.equal(writes.length, 1)
}

async function main() {
  await testPreferences()
  assert.doesNotMatch(source, /个人标签/, 'tag editor must use the user-facing name 兴趣标签')
  assert.match(source, /编辑兴趣标签/)
  assert.match(source, /搜索兴趣标签/)
  const userApi = fs.readFileSync(path.join(root, 'api/user.uts'), 'utf8')
  const tagOptionsApi = userApi.split('export async function getProfileTagOptions()')[1].split('export async function updateOwnProfile')[0]
  assert.match(tagOptionsApi, /okRes\(mockProfileTagOptions\)/, 'the editor catalog must be bundled with the frontend')
  assert.doesNotMatch(tagOptionsApi, /request\(/, 'opening the editor must not fetch its catalog from the backend')
  // 跨仓路径统一走 tests/helpers/cross-repo.cjs；后端不可达时显式 SKIP，
  // 不静默假装通过（CI 只检出前端仓库）。
  const { backendRoot: resolveBackendRoot } = require('./helpers/cross-repo.cjs')
  const backendRoot = resolveBackendRoot()
  if (backendRoot == null) {
    console.log('SKIP test-personal-tags.js 后端目录不可访问（设置 XSA_BACKEND_ROOT 可启用同步校验）')
    process.exit(0)
  }
  // 解释器解析：本机 `python` 可能指向 Windows Store 存根（执行返回 9009），
  // `py` 也可能「找不到默认 Python」，直接写死 'python' 会让这条用例在没装
  // Store 版解释器的机器上恒失败。优先用后端仓库自己的 venv——同步脚本读的
  // 就是后端常量，用它的解释器最贴近；其余候选兜底；都不可用时显式 SKIP，
  // 但脚本自身校验失败仍然抛错（不能把「目录不一致」当成「解释器缺失」）。
  const venvPython = process.platform === 'win32'
    ? path.join(backendRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(backendRoot, '.venv', 'bin', 'python')
  const pythonCandidates = [
    process.env.XSA_PYTHON,
    fs.existsSync(venvPython) ? venvPython : null,
    'python',
    'python3',
    'py'
  ].filter(Boolean)
  let catalogChecked = false
  for (const python of pythonCandidates) {
    try {
      require('node:child_process').execFileSync(
        python,
        [path.join(root, 'scripts/sync-profile-tags.py'), '--check', '--backend-root', backendRoot],
        { stdio: 'inherit' }
      )
      catalogChecked = true
      break
    } catch (error) {
      // 9009 = 该候选不可用（Store 存根）；ENOENT = 命令不存在。换下一个候选。
      if (error.code === 'ENOENT' || error.status === 9009) continue
      throw error
    }
  }
  if (!catalogChecked) {
    console.log('SKIP test-personal-tags.js 未找到可用的 Python 解释器（设置 XSA_PYTHON=<解释器路径> 可启用同步校验）')
    process.exit(0)
  }
  assert.equal(catalog.categories.length, 17)
  assert.deepEqual(catalog.categories.map(category => category.label), ['性格特质', '运动', '阅读', '影视综', '音乐', '文艺创作', '二次元', '旅行户外', '美食', '咖啡茶酒', '游戏', '休闲娱乐', '宠物', '植物园艺', '汽车文化', '生活习惯', '知识成长'])
  assert.equal(catalog.categories.reduce((count, category) => count + category.options.length, 0), 323)
  assert.deepEqual(catalog.custom, { enabled: true, max_tags: 3, min_length: 2, max_length: 10, category_required: true })
  for (const category of catalog.categories) {
    assert.ok(category.options.length >= 12 && category.options.length <= 30)
    assert.equal(category.options.includes(category.label), false, category.label + ' must not repeat as its own child option')
  }
  for (const broad of ['旅行', '音乐', '阅读', '电影', '游戏', '汽车文化', '健身', '喜欢宠物', '园艺', '自我提升', '看现场演出']) {
    assert.equal(catalog.categories.some(category => category.options.includes(broad)), false, broad)
  }
  assert.match(source, /class="tag-item custom-entry"/, 'every active category ends with the custom entry')
  assert.match(source, /<XsaModal/, 'custom tag editing uses the shared modal')
  assert.match(source, /mode="selector"[^>]*:range="categoryNames"/, 'custom modal allows category selection')

  for (const file of ['pagesSub/userExtra/mytags/edit.uvue', 'pagesSub/userExtra/user/edit.uvue', 'pagesSub/userExtra/user/detail.uvue', 'pagesSub/userExtra/user/preference.uvue']) {
    const result = parse(fs.readFileSync(path.join(root, file), 'utf8'))
    assert.deepEqual(result.errors, [], file)
    const template = compileTemplate({ source: result.descriptor.template.content, filename: file, id: file })
    assert.deepEqual(template.errors, [], file)
    babel.transformSync(result.descriptor.scriptSetup.content, { filename: 'page.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript'] })
  }
  let e = editor()
  await e.load()
  e.selectCategory('sports')
  e.searchQuery.value = '  liveHOUSE  '
  assert.equal(e.searchActive.value, true)
  assert.deepEqual(Array.from(e.displayTags.value, tag => tag.label), ['去看Livehouse'])
  assert.equal(e.categoryNameForTag('去看Livehouse'), '音乐')
  e.toggleTag('music', '去看Livehouse')
  e.searchQuery.value = '猫'
  assert.deepEqual(Array.from(e.displayTags.value, tag => tag.label), ['养猫', '云吸猫', '研究猫咪行为'])
  e.toggleTag('pets', '云吸猫')
  e.searchQuery.value = '不存在的标签'
  assert.equal(e.displayTags.value.length, 0)
  assert.equal(e.selectedItems.value.length, 4, 'search cannot erase selected tags')
  e.searchQuery.value = '  '
  assert.equal(e.searchActive.value, false)
  assert.equal(e.activeCategoryId.value, 'sports')
  assert.equal(e.displayTags.value.length, 28)
  e.searchQuery.value = '猫'
  e.selectCategory('personality')
  assert.equal(e.searchQuery.value, '')
  await e.saveAndBack()
  assert.deepEqual(Array.from(e.writes[0].personal_tags), ['科幻小说', '有幽默感', '去看Livehouse', '云吸猫'])
  assert.equal(JSON.stringify(e.writes[0].custom_tag_categories), '{}')

  e = editor()
  await e.load()
  assert.equal(e.customEnabled.value, true)
  e.selectCategory('music')
  e.openCustomEditor('')
  assert.equal(e.customModalVisible.value, true)
  assert.equal(e.customCategoryId.value, 'music')
  e.customDraft.value = '  手碟  '
  e.saveCustomTag()
  assert.deepEqual(Array.from(e.customLabels.value), ['手碟'])
  assert.equal(e.customCategoryByLabel.value['手碟'], 'music')
  e.selectCategory('sports')
  e.openCustomEditor('')
  e.customDraft.value = '城市骑行'
  e.saveCustomTag()
  e.openCustomEditor('')
  e.customDraft.value = '木刻'
  e.onCustomCategoryChange({ detail: { value: 5 } })
  e.saveCustomTag()
  e.openCustomEditor('')
  e.customDraft.value = '皮划艇'
  e.saveCustomTag()
  assert.equal(e.customLabels.value.length, 3)
  assert.match(e.messages.at(-1), /最多添加3个/)
  e.openCustomEditor('手碟')
  e.customDraft.value = '手鼓'
  e.onCustomCategoryChange({ detail: { value: 11 } })
  e.saveCustomTag()
  assert.equal(e.customLabels.value.includes('手鼓'), true)
  assert.equal(e.customCategoryByLabel.value['手鼓'], 'leisure')
  e.openCustomEditor('手鼓')
  e.customDraft.value = '去看livehouse'
  e.saveCustomTag()
  assert.equal(e.selectedLabels.value.includes('去看Livehouse'), true)
  assert.match(e.messages.at(-1), /位于音乐/)
  await e.saveAndBack()
  assert.deepEqual(Array.from(e.writes[0].personal_tags), ['科幻小说', '有幽默感', '城市骑行', '木刻', '去看Livehouse'])
  assert.equal(JSON.stringify(e.writes[0].custom_tag_categories), JSON.stringify({ 城市骑行: 'sports', 木刻: 'arts' }))

  e = editor({ profile: { personal_tags: ['手碟'], custom_tags: ['手碟'], custom_tag_categories: { 手碟: 'music' } } })
  await e.load()
  assert.equal(e.categorySelectedCount('music'), 1)
  assert.equal(e.categoryNameForTag('手碟'), '音乐')
  e.openCustomEditor('手碟')
  e.deleteEditingCustomTag()
  assert.deepEqual(Array.from(e.customLabels.value), [])
  assert.equal(e.selectedLabels.value.includes('手碟'), false)
  assert.equal(e.customCategoryByLabel.value['手碟'], undefined)
  assert.equal(e.customModalVisible.value, false)

  e = editor()
  await e.load()
  assert.equal(e.selectedItems.value.length, 2)
  assert.equal(e.canSave.value, true)
  e.clearTags()
  await e.saveAndBack()
  assert.equal(e.writes[0].personal_tags.length, 0)
  // 保存成功不再依赖未被消费的 tagsSaved eventChannel（edit.uvue 已移除）。
  assert.equal(e.events.length, 0, 'success must not emit an unconsumed tagsSaved event')
  assert.equal(e.canSave.value, false, 'success cannot be submitted twice')

  e = editor({ loadFailure: true })
  await e.load()
  await e.saveAndBack()
  assert.equal(e.loaded.value, true, 'the bundled catalog remains visible when the profile request fails')
  assert.equal(e.profileReady.value, false)
  assert.equal(e.canSave.value, false)
  assert.equal(e.writes.length, 0, 'failed load must never overwrite a profile')

  e = editor({ profile: { interest_tags: ['科幻小说'], personality_tags: ['有幽默感'] } })
  await e.load()
  assert.deepEqual(Array.from(e.selectedLabels.value), [], 'legacy profile fields are dropped during development')

  e = editor({ saveFailure: true })
  await e.load()
  e.toggleTag('sports', '力量训练')
  await e.saveAndBack()
  assert.equal(e.selectedItems.value.length, 3)
  assert.equal(e.events.length, 0)
  assert.equal(e.canSave.value, true)

  e = editor({ mismatch: true })
  await e.load()
  await e.saveAndBack()
  assert.equal(e.events.length, 0, 'do not report success for mismatching persisted values')

  e = editor()
  await e.load()
  e.clearTags()
  for (const label of catalog.categories[1].options.slice(0, 11)) e.toggleTag('sports', label)
  assert.equal(e.selectedItems.value.length, 10)
  assert.match(e.messages.at(-1), /最多选择10个/)

  let release
  e = editor({ pending: new Promise(resolve => { release = resolve }) })
  await e.load()
  const first = e.saveAndBack()
  await e.saveAndBack()
  assert.equal(e.writes.length, 1)
  release()
  await first
  // 保存成功不再依赖未被消费的 tagsSaved eventChannel（edit.uvue 已移除）。
  assert.equal(e.events.length, 0)

  const edit = fs.readFileSync(path.join(root, 'pagesSub/userExtra/user/edit.uvue'), 'utf8')
  assert.doesNotMatch(edit, /个人标签/, 'profile editor must use the user-facing name 兴趣标签')
  const payload = edit.split('const buildProfilePayload = ')[1].split('return payload')[0]
  assert.doesNotMatch(payload, /interest_tags:|personality_tags:|tag_selections\s*=/, 'basic edits must not overwrite independently saved tags')
  console.log('personal tags: catalog parity, search, template parsing, load/save/clear, limits, failure retention and duplicate submission passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
