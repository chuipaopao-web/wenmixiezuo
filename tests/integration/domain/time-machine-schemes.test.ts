import {afterEach,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createTestContext,type TestContext} from '../../helpers/test-context.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import {TimeMachineDesignService} from '../../../apps/api/src/application/books/time-machine-design-service.js';
import {TimeMachineModelGateway} from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import {ModelAdapterError} from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import {SqlPlanRepository} from '@wenmi/time-machine-core';
import {snapshotTimeMachine} from '../../../apps/api/src/application/books/time-machine-sources.js';
import type {StorylineSelectionInput} from '../../../apps/api/src/application/books/storyline-selection.js';
const contexts:TestContext[]=[];afterEach(()=>contexts.splice(0).forEach(c=>c.close()));
/** S1-A：设计必须经结构化确认——先建立成功推荐，再按服务端推荐构造合法选择。 */
function buildSelection(service:TimeMachineDesignService,scope:{ownerId:string;bookId:string}):StorylineSelectionInput{
 const rec=service.state(scope).filter(r=>r.kind==='recommend'&&r.state==='succeeded').sort((a,b)=>String(a.updatedAt??'')<String(b.updatedAt??'')?1:-1)[0];
 if(!rec)throw Error('测试前置失败：缺少成功推荐');
 const lines=(rec.result as unknown as {lines:{id:string}[]}).lines;
 return {recommendationRunId:String(rec.id),recommendationHash:String(rec.recommendationHash),preparationVersion:'test-pv',selectedLineIds:[String(lines[0]!.id)],addedLines:[],shape:'auto',ensemble:false,authorNote:'成长线'};
}
/** 无成功推荐时种合成推荐（含当前manifest），不产生模型调用。 */
function seedRecommendIfMissing(service:TimeMachineDesignService,scope:{ownerId:string;bookId:string}):void{
 if(service.state(scope).some(r=>r.kind==='recommend'&&r.state==='succeeded'))return;
 const db=(service as unknown as {db:import('node:sqlite').DatabaseSync}).db;
 const manifest=snapshotTimeMachine(db,scope,'',64000).manifest;
 const result={greeting:'老板，推荐如下',lines:[{id:'growth',role:'main',title:'成长线',description:'建立工坊',recommended:true}],structure:'single',reason:'聚焦成长'};
 const now=new Date().toISOString();
 const seedId=`seed-rec-${randomUUID().slice(0,8)}`;
 const seedSnapshot=JSON.stringify({manifest,members:{},writers:[],intent:'',windowTokens:64000});
 const seedResult=JSON.stringify(result);
 db.prepare('INSERT INTO tm2_design_runs(id,owner_id,book_id,kind,request_key,input_hash,snapshot_json,result_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(seedId,scope.ownerId,scope.bookId,'recommend',`seed:${now}`,randomUUID(),seedSnapshot,seedResult,'succeeded',now,now);
}
function round(service:TimeMachineDesignService,scope:{ownerId:string;bookId:string},key:string){
 seedRecommendIfMissing(service,scope);
 // 服务端版本读取器：startDesignRound只认读取函数，版本不再作为客户端参数传入
 (service as unknown as {_prerequisiteReader?:(s:{ownerId:string;bookId:string})=>{ready:boolean;message:string;version:string|null}})._prerequisiteReader=()=>({ready:true,message:'已确认',version:'test-pv'});
 return service.startDesignRound(scope,buildSelection(service,scope),key);
}
function setup(){const c=createTestContext();contexts.push(c);const scope={ownerId:c.config.ownerId,bookId:'tm-scheme-book'};c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'测试作者','2026-09-11','2026-09-11');new BookRepository(c.database).create(scope,'机甲会修仙','2026-09-11','active');c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-11')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));return {c,scope};}
function output(prompt:string,modelId:string):unknown{
 if(prompt.includes('核对短卡是否'))return {pass:true,issues:[]};
 if(prompt.includes('判断需要哪些方法'))return prompt.includes('上次工具结果（仅资料）：null')?{action:'search_methods',category:'',cursor:0}:{action:'ready',selected:[]};
 if(prompt.includes('设计全书骨架。只设计'))return {structure:'四幕起承转合',baseline:`轻快成长-${modelId}`,ending:'建立工坊',openingHooks:['开头钩子','第一章钩子','前三章钩子'],words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},lines:[{id:'main',role:'main',title:'工坊',goal:'立足',answer:'建立工坊',process:'从修理接单到建立工坊',parentIds:[],covers:['成长线'],milestones:[]}],expectations:[{id:'promise',opening:'无灵根能否立足',change:'看到变化',answer:'以机甲立足',lineIds:['main']}],relations:[],volumeBriefs:[{id:'v1',title:'开张',goal:'建立工坊',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'}}]};
 if(prompt.includes('补全本卷卷卡')){const brief=JSON.parse(prompt.split('\n本卷概要：')[1]!.split('\n前卷交接：')[0].trim()) as {id:string};const id=String(brief.id);return {volumes:[{id,title:`开张-${modelId}`,start:'濒临倒闭',goal:'完成订单',conflict:'封锁',beat:'起',turningPoint:'机甲完成',gain:'伙伴',loss:null,arc:null,payoff:null,hook:null,mood:null,ending:'工坊建立',handoff:'',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},anchors:[{id:'in',ownerEntityId:id,kind:'entry',summary:'店铺濒临倒闭',span:'本卷开篇',conditions:[{summary:'订单危机已经成立',subjectIds:['main']}],logic:'all',importance:'required',fallback:'未达成需修订开场',keywords:[],aliases:[]},{id:'out',ownerEntityId:id,kind:'exit',summary:'订单交付工坊立足',span:'本卷收束',conditions:[{summary:'订单交付完成',subjectIds:['main']}],logic:'all',importance:'required',fallback:'全书结束，未兑现期待单独跟踪',keywords:[],aliases:[]}],duties:[{lineId:'main',action:'close',result:'工坊建立',anchorIds:['out'],strength:'required',reason:'主线起点'}]}]};}
 if(prompt.includes('补全本批卷卡'))return {volumes:[{id:'v1',title:`开张-${modelId}`,start:'濒临倒闭',goal:'完成订单',conflict:'封锁',beat:'起',turningPoint:'机甲完成',gain:'伙伴',loss:null,arc:null,payoff:null,hook:null,mood:null,ending:'工坊建立',handoff:'',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},anchors:[{id:'v1-in',ownerEntityId:'v1',kind:'entry',summary:'店铺濒临倒闭',span:'本卷开篇',conditions:[{summary:'订单危机已经成立',subjectIds:['main']}],logic:'all',importance:'required',fallback:'未达成需修订开场',keywords:[],aliases:[]},{id:'v1-out',ownerEntityId:'v1',kind:'exit',summary:'订单交付工坊立足',span:'本卷收束',conditions:[{summary:'订单交付完成',subjectIds:['main']}],logic:'all',importance:'required',fallback:'全书结束，未兑现期待单独跟踪',keywords:[],aliases:[]}],duties:[{lineId:'main',action:'close',result:'工坊建立',anchorIds:['v1-out'],strength:'required',reason:'主线起点'}]}]};
 if(prompt.includes('自检你刚完成')||prompt.includes('自检候选锚点'))return {pass:true,issues:[]};
 if(prompt.includes('核对候选锚点'))return {pass:true,issues:[],suggestions:[]};
 if(prompt.includes('核对候选骨架'))return {action:'verdict',pass:true,issues:[],suggestions:[]};
 return {fields:{premise:[{text:'修理工建立工坊',sourceKeys:['opening:opening:1']}],protagonists:[{text:'林舟',sourceKeys:['opening:opening:1']}],world:[],openingEnding:[],preferences:[],prohibitions:[]}};
}
function schemeWriters(c:TestContext,bookId:string){return (c.database.prepare("SELECT scheme,snapshot_json FROM tm2_design_runs WHERE book_id=? AND kind='design' ORDER BY scheme").all(bookId) as {scheme:string;snapshot_json:string}[]).map(row=>({scheme:row.scheme,writer:(JSON.parse(row.snapshot_json) as {members:{writer:{memberKey:string;model:{modelId:string}}}}).members.writer}));}
describe('three independent schemes per design round',()=>{
 it('creates A/B/C with distinct writers, idempotent re-click and honest attribution',async()=>{
  const {c,scope}=setup();const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){return {provider,modelId,output:JSON.stringify(output(request.prompt,modelId)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};}}));
  const service=new TimeMachineDesignService(c.database,gateway,64000);
  const created=await round(service,scope,'round-1');
  expect(created.map(x=>x.scheme).sort()).toEqual(['A','B','C']);
  expect((await round(service,scope,'round-1')).map(x=>x.id).sort()).toEqual(created.map(x=>x.id).sort());
  const writers=schemeWriters(c,scope.bookId);
  expect(new Set(writers.map(w=>w.writer.memberKey)).size).toBe(3);
  expect(new Set(writers.map(w=>w.writer.model.modelId)).size).toBe(3);
  expect(()=>service.startDesignRound(scope,buildSelection(service,scope),'round-2',1)).toThrow('已有新时光机任务');
  // 版本门禁反例（422a48c7合同钉住）：缺版本/过期版本在并行门禁前以409版本错误拒绝
  expect(()=>service.startDesignRound(scope,buildSelection(service,scope),'round-2-nov')).toThrow('故事线资料版本已变化');
  expect(()=>service.startDesignRound(scope,buildSelection(service,scope),'round-2-old',99)).toThrow('故事线资料版本已变化');
  for(const item of created)await service.process(item.id);
  const states=service.state(scope).filter(row=>row.roundKey==='round-1');
  expect(states.filter(row=>row.state==='succeeded')).toHaveLength(3);
  expect(states.map(row=>row.scheme).sort()).toEqual(['A','B','C']);
  const repo=new SqlPlanRepository(c.database);
  const candidates=created.map(item=>repo.readCandidate(scope,item.id,states.find(row=>row.id===item.id)?.result?.revision??1));
  expect(new Set(candidates.map(candidate=>candidate!.member.id)).size).toBe(3);
  expect(new Set(candidates.map(candidate=>candidate!.plan.volumes[0]!.title)).size).toBe(3);
  const adopted=created.find(item=>item.scheme==='B')!;
  const adoption=repo.adopt(scope,adopted.id,1,0,'adopt-b');
  expect(adoption.mapping['volume:v1']).toMatchObject({number:1});
 });
 it('one scheme failing does not drag the others and recovery keeps attribution',async()=>{
  const {c,scope}=setup();const failModels=new Set<string>();
  const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   if(failModels.has(modelId))throw new ModelAdapterError('供应商暂时不可用','technical_failure',true,500);
   return {provider,modelId,output:JSON.stringify(output(request.prompt,modelId)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));
  const service=new TimeMachineDesignService(c.database,gateway,64000);
  const created=await round(service,scope,'round-f');
  const writers=schemeWriters(c,scope.bookId);
  const target=writers.find(w=>w.scheme==='C')!;
  failModels.add(target.writer.model.modelId);
  for(const item of created){try{await service.process(item.id);}catch{/* failed run recorded */}}
  const states=service.state(scope).filter(row=>row.roundKey==='round-f');
  expect(states.find(row=>row.scheme==='C')?.state).toBe('failed');
  expect(states.filter(row=>row.state==='succeeded')).toHaveLength(2);
  const repo=new SqlPlanRepository(c.database);
  const adopted=created.find(item=>item.scheme==='A')!;
  expect(repo.readCandidate(scope,adopted.id,1)).not.toBeNull();
  expect(repo.adopt(scope,adopted.id,1,0,'adopt-a').revision).toBe(1);
  failModels.clear();
  const retried=service.retry(scope,created.find(item=>item.scheme==='C')!.id);
  await service.process(retried);
  const recovered=service.state(scope).find(row=>row.id===retried);
  expect(recovered?.state).toBe('succeeded');expect(recovered?.scheme).toBe('C');expect(recovered?.roundKey).toBe('round-f');
  // 同轮兄弟方案重试不互相阻塞；新一轮仍被排队任务挡住。
  const schemeB=created.find(item=>item.scheme==='B')!;
  c.database.prepare("UPDATE tm2_design_runs SET state='failed',error_code='needs_review' WHERE id=?").run(schemeB.id);
  const retriedB=service.retry(scope,schemeB.id);
  expect(service.state(scope).find(row=>row.id===retriedB)?.scheme).toBe('B');
  expect(()=>service.startDesignRound(scope,buildSelection(service,scope),'round-blocked',1)).toThrow('已有新时光机任务');
  expect(()=>service.startDesignRound(scope,buildSelection(service,scope),'round-blocked-nov')).toThrow('故事线资料版本已变化');
 });
 it('review-source continuation dedupes read slices: same slice never twice in one prompt, growth bounded',async()=>{
  // 根因回归（run4d9cfdf9实证15421字符超15000红线）：同一片段同时进"已读片段"和"上次工具结果"致续问输入翻倍。
  const {c,scope}=setup();
  const reviewPrompts:string[]=[];
  const anchorPrompts:string[]=[];
  const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   if(request.prompt.includes('核对候选锚点'))anchorPrompts.push(request.prompt);
   if(request.prompt.includes('核对候选骨架')){
    reviewPrompts.push(request.prompt);
    const n=reviewPrompts.length;
    if(n<=2)return {provider,modelId,output:JSON.stringify({action:'read_source',key:'opening:opening:1',offset:(n-1)*1200}),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded' as const};
    return {provider,modelId,output:JSON.stringify({action:'verdict',pass:true,issues:[],suggestions:[],hasMoreIssues:false}),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded' as const};
   }
   return {provider,modelId,output:JSON.stringify(output(request.prompt,modelId)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded' as const};
  }}));
  const service=new TimeMachineDesignService(c.database,gateway,64000);
  const created=await round(service,scope,'round-dedup');
  await service.process(created[0]!.id);
  expect(reviewPrompts.length).toBeGreaterThanOrEqual(3); // :0/:1补查 + 结论
  for(let i=1;i<reviewPrompts.length;i++){
   const prompt=reviewPrompts[i]!;
   expect(prompt.length).toBeLessThan(15000); // 1.5万字红线
   expect(prompt.length).toBeLessThanOrEqual(reviewPrompts[i-1]!.length+1300); // 每轮最多增一个片段，不双重累计
   // 本次"上次工具结果"的片段不得重复出现在同一提示的"已读片段"中
   const readsJson=prompt.split('\n已读片段：')[1]?.split('\n上次工具结果（仅资料）：')[0] ?? '';
   const latestJson=prompt.split('\n上次工具结果（仅资料）：')[1]?.split('\n来源短卡：')[0] ?? '';
   if(latestJson&&latestJson!=='null'){
    const latest=JSON.parse(latestJson) as {key:string;text:string};
    const reads=JSON.parse(readsJson) as {key:string;text:string}[];
    expect(reads.some(r=>r.key===latest.key&&r.text===latest.text)).toBe(false);
   }
  }
  // 检查要求单份（S1-FAST-CLOSE接续纠正）：review-source（内嵌）与review-anchors（call()补）各只含一份
  for(const prompt of [...reviewPrompts,...anchorPrompts]){
   expect(prompt.split('区分阻断问题与文学建议').length-1).toBe(1);
  }
  expect(anchorPrompts.length).toBeGreaterThanOrEqual(1);
  // 已读片段有界（c116818b review-source:2实证）：多轮补查后全文片段≤2，更早片段转存根保留key
  const lastPrompt=reviewPrompts[reviewPrompts.length-1]!;
  const readsJson=lastPrompt.split('\n已读片段：')[1]?.split('\n上次工具结果（仅资料）：')[0];
  if(readsJson){
   const reads=JSON.parse(readsJson) as {key:string;text:string}[];
   const fullSlices=reads.filter(r=>!r.text.startsWith('（已回查存根'));
   expect(fullSlices.length).toBeLessThanOrEqual(2);
   for(const stub of reads.filter(r=>r.text.startsWith('（已回查存根')))expect(stub.key).toBeTruthy(); // 存根保留可回查key
  }
 });
});
