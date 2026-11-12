const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const babel = require('@babel/core')
const parser = require('@babel/parser')
const root = path.join(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
function extract(source, names, context) {
 const body = parser.parse(source, {sourceType:'module', plugins:['typescript']}).program.body
 const code = body.map(n=>n.declaration || n).filter(n=>names.includes(n.id?.name || n.declarations?.[0]?.id?.name)).map(n=>source.slice(n.start,n.end)).join('\n')
 const js = babel.transformSync(code, {filename:'workflow.ts',configFile:false,babelrc:false,plugins:['@babel/plugin-transform-typescript']}).code
 return vm.runInNewContext(js + '\n;({' + names.join(',') + '})', context)
}
let calls=[], response={success:true,data:{}}, responses=[]
const api = extract(read('api/matchmaker.uts'), ['normalizeWorkspaceIntroductionStatus','normalizeWorkspaceIntroductionPerson','getMatchmakerWorkspaceIntroductions','viewMatchmakerIntroductionContact','updateMatchmakerIntroductionStatus','createMatchmakerIntroduction'], {
 USE_MOCK:false, formatWorkspaceTime:value=>value || '',
 request:async options=>{calls.push(options);return responses.length ? responses.shift() : response}
})
const page = read('pagesSub/matchmaker/become-matchmaker.uvue')
const source = page.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]
const ref = value=>({value})
let contactModal = null
const context = {
 uni:{showModal:options=>{contactModal=options}},
 workspaceIntroductionWorkflowVersion:ref(2), matchStatusSheetVisible:ref(false), matchStatusRow:ref(null),
 matchStatusChoice:ref('SUCCEEDED'), matchContactConfirmed:ref(false), matchFailureReason:ref(''),matchStatusSubmitting:ref(false),
 showToast:()=>{}, reloadManagementCenterSnapshot:async()=>{}, loadWorkspaceMatches:async()=>{},
 updateMatchmakerIntroductionStatus:api.updateMatchmakerIntroductionStatus,
 viewMatchmakerIntroductionContact:api.viewMatchmakerIntroductionContact,
}
const ui = extract(source,['parseMemberId','revealMatchContact','confirmMatchContactsObtained','openMatchStatusSheet','submitMatchStatus'],context)
const slot=()=>({loading:false,error:'',revealed:false,phone:'',wechat:''})
const row=()=>({id:'12',status:'PENDING',fromUser:{id:'1'},toUser:{id:'2'},fromContact:slot(),toContact:slot(),fromPhoneViewed:false,toPhoneViewed:false})
async function run() {
 await api.updateMatchmakerIntroductionStatus('12','FAILED','不合适',true)
 assert.equal(calls.at(-1).data.contact_confirmed,true)
 assert.equal(calls.at(-1).data.failure_reason,'不合适')
 await api.createMatchmakerIntroduction({fromUserId:1,toUserId:2,result:'SUCCEEDED',finishedAt:'2026-11-02'})
 assert.equal(calls.at(-1).data.result,'PENDING'); assert.equal(calls.at(-1).data.finished_at,undefined)
 let before=calls.length; assert.equal((await api.viewMatchmakerIntroductionContact('12','invalid')).success,false); assert.equal(calls.length,before)
 let item=row(); context.workspaceIntroductionWorkflowVersion.value=0
 await ui.revealMatchContact(item,'from'); assert.equal(calls.length,before,'old remote must not use unsafe fallback')
 context.workspaceIntroductionWorkflowVersion.value=2
 response={success:true,data:{introduction_id:12,status:'PENDING',from_phone_viewed:true,to_phone_viewed:false,contact:{phone:'13800000001'}}}
 await ui.revealMatchContact(item,'from')
 assert.equal(item.status,'PENDING'); assert.equal(item.fromPhoneViewed,true); assert.equal(item.toPhoneViewed,false)
 assert.equal(calls.at(-1).url,'/matchmaker/workbench/introductions/12/contact-views')
 response={success:false,message:'拒绝访问'}; await ui.revealMatchContact(item,'to')
 assert.equal(item.status,'PENDING'); assert.equal(item.toContact.revealed,false)
 response={success:true,data:{introduction_id:12,status:'PENDING',from_phone_viewed:true,to_phone_viewed:true,contact:{phone:'13800000002'}}}
 await ui.revealMatchContact(item,'to'); assert.equal(item.status,'PENDING')
 assert.equal(contactModal.title,'确认已获得双方联系方式')
 before=calls.length; await contactModal.success({confirm:false}); assert.equal(calls.length,before)
 assert.equal(item.status,'PENDING'); assert.equal(item.contactsConfirming,false)
 ui.confirmMatchContactsObtained(item)
 await contactModal.success({confirm:true})
 assert.equal(calls.at(-1).data.contacts_obtained,true)
 item.status='IN_PROGRESS'
 ui.openMatchStatusSheet(item); assert.equal(context.matchStatusSheetVisible.value,true); assert.equal(context.matchContactConfirmed.value,false)
 before=calls.length; await ui.submitMatchStatus(); assert.equal(calls.length,before,'must explicitly confirm contact')
 context.matchContactConfirmed.value=true; context.matchStatusChoice.value='SUCCEEDED'; context.matchFailureReason.value='旧的失败原因'
 response={success:true,data:null}; await ui.submitMatchStatus()
 assert.equal(calls.at(-1).data.contact_confirmed,true); assert.equal(calls.at(-1).data.failure_reason,undefined)
 context.matchStatusSheetVisible.value=false; ui.openMatchStatusSheet(row()); assert.equal(context.matchStatusSheetVisible.value,false)
 response={success:true,data:{workflow_version:2,items:[{id:12,status:'PENDING',application_response:'REJECTED',response_reason:'暂不考虑',from_user:{user_id:1},to_user:{user_id:2}}],total:1}}
 const mapped=(await api.getMatchmakerWorkspaceIntroductions()).data
 assert.equal(mapped.workflowVersion,2); assert.equal(mapped.items[0].applicationResponse,'REJECTED')
 assert.equal(mapped.items[0].responseReason,'暂不考虑')
 responses=[
  {success:true,data:{workflow_version:2,items:[{id:1,status:'PENDING',from_user:{user_id:1},to_user:{user_id:2}}],total:2,has_more:true}},
  {success:true,data:{items:[{id:2,status:'CLOSED',from_user:{user_id:1},to_user:{user_id:2}}],total:2,has_more:false}}
 ]
 const paged=(await api.getMatchmakerWorkspaceIntroductions()).data
 assert.equal(paged.items.length,2)
 assert.equal(paged.items[1].status,'CLOSED')
 assert.equal(calls.at(-1).data.page,2)
 assert.match(page,/row\.status == 'PENDING'[\s\S]*?对方拒绝[\s\S]*?未回应/)
 assert.doesNotMatch(page,/markIntroductionContacted/)
 console.log('introduction workflow UI and API behavior checks passed')
}
run().catch(error=>{console.error(error);process.exitCode=1})
