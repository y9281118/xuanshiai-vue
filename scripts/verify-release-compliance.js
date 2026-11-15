/**
 * 提审合规预检（只读源码断言，不依赖构建产物）。
 * 运行：node scripts/verify-release-compliance.js
 * 覆盖：生产/体验域名映射、登录页测试入口隔离、游客态不强制登录、401 不踢游客。
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

let failed = 0
function check(name, ok, detail) {
  if (ok) {
    console.log('  PASS  ' + name)
  } else {
    failed += 1
    console.error('  FAIL  ' + name + (detail ? ' -> ' + detail : ''))
  }
}

const config = read('api/config.uts')
check('release 指向生产域名', /envVersion == 'release'\) return PROD_API_BASE_URL/.test(config))
check('trial 指向生产域名', /envVersion == 'trial'\) return TRIAL_API_BASE_URL/.test(config) && /const TRIAL_API_BASE_URL = 'https:\/\/api\.xuanshiai\.com'/.test(config))
check('develop 才用测试域名', /const DEV_API_BASE_URL = 'https:\/\/xhztest\.xyz'/.test(config))

const login = read('pages/auth/login.uvue')
check('登录按钮不再称“一键登录”', login.indexOf('微信一键登录') < 0)
check('登录页注明不读取手机号/头像/昵称', login.indexOf('不读取手机号') >= 0)
check('测试账号块仅开发版可见', /<view v-if="isDevBuild" class="secondary-actions">/.test(login))
check('演示登录仅开发版可见', /<button v-if="isDevBuild" class="demo-login-button"/.test(login))
check('提供“先逛逛”游客入口', login.indexOf('goBrowseGuest') >= 0)

const index = read('pages/index/index.uvue')
check('欢迎页同意后不再直跳登录', /isGuest\.value = true[\s\S]{0,80}loadGuestHome\(\)/.test(index))
check('存在游客首页区块', index.indexOf('guest-scroll') >= 0)

const request = read('api/request.uts')
check('401 仅已登录失效才跳登录', /hadToken && options\.suppressAuthRedirect != true/.test(request))
check('网络 errMsg 归一友好中文', request.indexOf('friendlyNetworkMessage') >= 0)
check('domain-list 特判提示', request.indexOf('url not in domain list') >= 0)

const search = read('pagesSub/profileExtra/search.uvue')
check('游客不请求 /ai/capabilities', /getAccessToken\(\) == ''[\s\S]{0,120}aiCapabilityState\.value = 'guest'/.test(search))

if (failed > 0) {
  console.error('\n提审合规预检失败：' + failed + ' 项')
  process.exit(2)
}
console.log('\n提审合规预检通过')