import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {loadRuntimeConfig} from '../../apps/api/dist/infrastructure/runtime-config.js';
import {openDatabase} from '../../apps/api/dist/infrastructure/db/database.js';
import {bootstrapDatabase} from '../../apps/api/dist/infrastructure/db/bootstrap.js';
import {createAppServer} from '../../apps/api/dist/http/app-server.js';
import {ModelAdapterFactory} from '../../apps/api/dist/infrastructure/models/model-adapter-factory.js';
import {OPENING_RUNTIME_RELEASE,OpeningAgentEngine,OpeningAgentStoppedError} from '@wenmi/opening-runtime';
import * as adapterCore from '@wenmi/v7-backend';
const real=process.argv.includes('--real'),synthetic=process.argv.includes('--synthetic');
assert(real!==synthetic,'Choose --real or --synthetic');
assert.equal(adapterCore.OpeningAgentEngine,OpeningAgentEngine);
assert.equal(adapterCore.OpeningAgentStoppedError,OpeningAgentStoppedError);
const root=process.cwd(),dataDir=resolve(root,'.local','probe128-'+randomUUID());
mkdirSync(dataDir,{recursive:true});
const config=loadRuntimeConfig({...process.env,WENMI_PROJECT_ROOT:root,WENMI_DATA_DIR:dataDir,WENMI_API_PORT:'43112',WENMI_WEB_ORIGIN:'http://127.0.0.1:43112',WENMI_PUBLIC_ORIGIN:'',WENMI_ADMIN_ORIGIN:''});
if(real)assert.equal(config.modelRuntime.activeMode,'subscription-plan');
const db=openDatabase(config.databasePath);bootstrapDatabase(db,config);
const fixture={
  title: '三国：从流民开始',
  positioning: {
    publishingPlatform: 'fanqie',
    channel: 'male', category: '历史脑洞', genres: ['历史脑洞', '秦汉三国', '穿越'],
    tags: ['成长', '权谋', '智商在线', '群像'],
    coreAppeal: '现代普通人从乱世底层起步，靠判断、协作和承担责任逐步改变命运。',
    expectedTotalWords: 3_000_000
  },
  backgrounds: {
    eraAndWorld: '东汉末年，黄巾余波未平，地方秩序松动。'
  },
  protagonists: [{
    name: '张三', age: '23岁', identity: '男主',
    background: '熟悉基础历史脉络，但没有万能技术手册。',
    familyBackground: '现代普通家庭出身，穿越后没有可依靠的宗族。',
    careerBackground: '穿越前是普通职员，擅长整理信息和协调同伴。',
    goldenFinger: '无额外系统，主要依靠现代常识、观察力和复盘能力。',
    visualIdentity: {
      appearance: '五官端正、目光沉静',
      build: '身形精干、耐力较好',
      signatureFeature: '左眉浅痕、旧布护腕'
    },
    personality: ['谨慎', '有同理心']
  }],
  longTermDirection: {
    centralConflict: '个人求生与乱世权力扩张持续冲突。',
    progression: '先带同伴活下来，再取得立足之地，最终有能力保护更多普通人。',
    relationshipDirection: '在共同求生和立场冲突中建立可信赖的伙伴关系。',
    storyPotential: '身份上升、阵营选择与百姓生存可以持续形成跨卷矛盾。'
  },
  possibleEnding: {
    direction: '最终建立能保护普通人的稳定秩序。',
    price: '必须在个人安稳与承担更大责任之间作出取舍。',
    openness: '主冲突收束，同时保留新秩序继续经受考验的空间。'
  },
  mustFollow: ['不能准确记住所有历史细节'],
  authorInstructions: []
};
const calls=[],factory=new ModelAdapterFactory(config.modelRuntime);
const adapters={resolve(provider,modelId,purpose){return {provider,modelId,async generate(request){
  assert(calls.length<6,'Bounded probe model call limit');const call={provider,modelId,milliseconds:0};calls.push(call);const start=Date.now();
  try{
    if(real)return await factory.resolve(provider,modelId,purpose).generate(request);
    const compiled=JSON.parse(request.prompt),raw=compiled.contextPack?.content?.stageTaskPayload??compiled;
    const payload=typeof raw==='string'?JSON.parse(raw):raw;
    const result=payload.operation==='v7_opening_package_review_v1'
      ?{verdict:'pass',summary:'保留作者目标，字段一致。',issues:[],requiredChanges:[],authorDecisions:[]}
      :payload.operation==='v7_opening_package_revision_v1' ? payload.currentCandidates?.openingPackage??fixture : fixture;
    return {provider,modelId,output:JSON.stringify(result),inputTokens:120,outputTokens:240,cashCostCny:0,state:'succeeded'};
  }finally{call.milliseconds=Date.now()-start;console.log(JSON.stringify({step:'model-finished',...call}));}
}}}};
const app=await createAppServer(config,db,{v7OpeningModelAdapters:adapters});
const headers={host:'127.0.0.1:43112',origin:'http://127.0.0.1:43112','sec-fetch-site':'same-origin','content-type':'application/json'};
async function register(label){const response=await app.inject({method:'POST',url:'/api/v1/auth/register',headers,payload:{email:label+'-'+randomUUID()+'@example.test',password:'Probe-'+randomUUID(),displayName:'隔离发布验收'}});
assert.equal(response.statusCode,200);return String(response.headers['set-cookie']).split(';')[0];}
let cookie;
async function request(method,url,payload){const response=await app.inject({method,url,headers:{...headers,cookie},...(payload===undefined?{}:{payload})});assert.equal(response.statusCode,200,method+' '+url+' '+response.body);return response.json().data;}
async function poll(taskId){const deadline=Date.now()+8*60*1000;while(Date.now()<deadline){const view=await request('GET','/api/v1/v7/opening-agent/tasks/'+taskId);if(!['queued','working','interrupted'].includes(view.status))return view;await new Promise(r=>setTimeout(r,500));}throw Error('Bounded probe deadline');}
const startedAt=Date.now();
try {
  await register('admin');cookie=await register('author');
  const opening=await request('POST','/api/v1/v7/opening-agent/tasks',{idea:'张三穿越到东汉末年，从流民开始求生，逐步组织同伴保护百姓。男频历史脑洞，预计二百万字，无系统，主角不是万能天才。',idempotencyKey:'probe128-'+randomUUID()});
  const view=await poll(opening.taskId);assert.equal(view.status,'awaiting_author_confirmation',JSON.stringify({status:view.status,error:view.errorMessage,review:view.candidates.filter(x=>x.kind==='opening_review').map(x=>x.content)}));
  let candidate=view.candidates.filter(x=>x.kind==='opening_package').at(-1);
  if(synthetic){
    const revised=await request('POST','/api/v1/v7/opening-agent/tasks/'+opening.taskId+'/revisions',{baseCandidateId:candidate.candidateId,openingPackage:{...candidate.content,title:'乱世同行'},adjustmentNote:'只调整书名，保留其他内容。',idempotencyKey:'revision-'+randomUUID()});
    const reviewed=await poll(opening.taskId);assert.equal(reviewed.status,'awaiting_author_confirmation',reviewed.errorMessage);candidate=reviewed.candidates.filter(x=>x.kind==='opening_package').at(-1);
  }
  const confirm={taskId:opening.taskId,candidateId:candidate.candidateId,openingPackage:candidate.content,idempotencyKey:'confirm-'+randomUUID()};
  const book=await request('POST','/api/v1/v7/opening-books',confirm);
  assert.equal((await request('POST','/api/v1/v7/opening-books',confirm)).bookId,book.bookId);
  assert((await request('GET','/api/v1/v7/books')).some(x=>x.bookId===book.bookId));
  const profile=await request('GET','/api/v1/v7/books/'+book.bookId+'/book-profile');assert.equal(profile.title,book.title);
  const membership=await request('GET','/api/v1/membership/me');
  const receipt=db.prepare('SELECT SUM(input_tokens+output_tokens) AS tokens,COUNT(*) AS calls FROM v7_opening_agent_model_calls').get();
  assert.equal(receipt.calls,calls.length);assert.equal(membership.membership.computeConsumed,receipt.tokens*2);
  const result={ok:true,real,runtime:OPENING_RUNTIME_RELEASE,elapsedMs:Date.now()-startedAt,bookCount:db.prepare('SELECT COUNT(*) AS n FROM books').get().n,calls,confirmedOnce:true,profileReadable:true,usageMatches:true};
  writeFileSync(resolve(dataDir,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await app.close();db.close();}
