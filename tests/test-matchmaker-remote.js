const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const babel = require('@babel/core')
const source = fs.readFileSync(require('node:path').join(__dirname, '../api/matchmaker-remote.uts'), 'utf8')
const compiled = babel.transformSync(source.replace(/^import .*$/gm, '').replace(/^export /gm, ''), {
 filename: 'remote.ts', configFile: false, babelrc: false, plugins: ['@babel/plugin-transform-typescript']
}).code
let token = 'remote-user', response = {success:true,data:[]}, calls = []
const names = [...source.matchAll(/export (?:async )?function (\w+)/g)].map(m => m[1])
const api = vm.runInNewContext(compiled + '\n;({' + names.join(',') + '})', {
 API_BASE_URL:'https://xhztest.xyz', IS_LOCAL_BACKEND:false, USE_MOCK:false, getAccessToken:()=>token,
 sharedRequest:async options => { calls.push(options); return response }
})
async function run() {
 assert.equal(api.hasRemoteMatchmakerEndpoint('PATCH','/matchmaker/workbench/leads/12'),true)
 assert.equal(api.hasRemoteMatchmakerEndpoint('POST','/matchmaker/workbench/leads/12/assign'),true)
 assert.equal(api.hasRemoteMatchmakerEndpoint('POST','/matchmaker/workbench/members/28/abandonment'),true)
 assert.equal(api.hasRemoteMatchmakerEndpoint('POST','/matchmaker/workbench/members/28/abandonment/pickup'),true)
 for (const [method, suffix] of [['GET','profile'],['PATCH','profile'],['GET','preferences'],['PUT','preferences'],['GET','completion'],['PATCH','nickname'],['POST','avatar'],['POST','background'],['POST','photos'],['DELETE','photos/9']]) {
  assert.equal(api.hasRemoteMatchmakerEndpoint(method, '/matchmaker/workbench/members/36/' + suffix), true)
 }
 assert.equal(api.hasRemoteMatchmakerEndpoint('GET','/matchmaker/workbench/unsupported-feature'),false)
 assert.equal((await api.request({url:'/matchmaker/workbench/unsupported-feature'})).code,'REMOTE_FEATURE_UNAVAILABLE')
 assert.equal(calls.length,0)
 assert.equal(api.hasRemoteMatchmakerEndpoint('GET','/matchmaker/workbench/commission-standards'),true)
 assert.equal(api.hasRemoteMatchmakerEndpoint('POST','/matchmaker/workbench/commission-standards'),false)
 await api.request({url:'/matchmaker/workbench/commission-standards',method:'GET'})
 assert.equal(calls.at(-1).url,'/matchmaker/workbench/commission-standards')
 calls = []
 token=''; assert.equal((await api.getRemoteFinanceBalance()).code,401); assert.equal(calls.length,0)
 await api.getRemoteServiceProducts(); assert.equal(calls.at(-1).skipAuth,true)
 token='remote-user'; await api.getRemoteServiceRequests(true,2)
 assert.equal(calls.at(-1).url,'/matchmaker/service-requests/assigned'); assert.equal(calls.at(-1).data.page,2)
 for(const [amount,payee] of [['-1','张**'],['0','张**'],['1.001','张**'],['1000001','张**'],['10','']]) assert.equal((await api.createRemoteWithdrawal(amount,payee)).success,false)
 await api.createRemoteWithdrawal('12.50','张** / 尾号1234')
 assert.equal(calls.at(-1).data.payee_masked,'张** / 尾号1234'); assert.equal(calls.at(-1).data.amount,'12.50')
 assert.equal((await api.updateRemoteServiceRequest(1,99)).success,false)
 await api.updateRemoteServiceRequest(1,1,'开始'); assert.equal(calls.at(-1).method,'PATCH')
 await api.createRemoteMeetingFromService(1,2,'预约说明'); assert.equal(calls.at(-1).data.target_user_id,2)
 await api.deliverRemoteMatchmakerContact(1,'wx_contact'); assert.equal(calls.at(-1).data.wechat_contact,'wx_contact')
 response={success:true,data:{status:'PENDING'}}
 let before=calls.length; assert.equal((await api.getRemoteServiceContactExchangeContacts(8)).success,false); assert.equal(calls.length,before+1)
 response={success:true,data:{status:'APPROVED'}}; await api.getRemoteServiceContactExchangeContacts(8)
 assert.equal(calls.at(-1).url,'/matchmaker/service-requests/contact-exchanges/8/contacts')
 response={success:false,code:403,message:'无权操作'}; assert.equal((await api.getRemoteFinanceBalance()).message,'无权操作')
 console.log('matchmaker remote transport checks passed')
}
run().catch(error=>{console.error(error);process.exitCode=1})
