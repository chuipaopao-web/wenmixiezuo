import {describe,it,expect,afterEach} from 'vitest';
import {createTestContext,type TestContext} from '../../helpers/test-context.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import {TimeMachineDesignService} from '../../../apps/api/src/application/books/time-machine-design-service.js';
import {TimeMachineModelGateway} from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import {ModelAdapterError} from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import {snapshotTimeMachine} from '../../../apps/api/src/application/books/time-machine-sources.js';
import {StorylineSelectionInput} from '../../../apps/api/src/application/books/storyline-selection.js';
// 30a6f053复核定点修复的反例与回归：长度截断分类、逐卷生成与截断恢复、suggestedVolumes归一化、
// 卷卡预检局部修复、K3名册排除与异模型审查。全部离线（模型为可控夹具），不调用真实模型。
const contexts:TestContext[]=[];
afterEach(()=>contexts.splice(0).forEach(c=>c.close()));
function setup(){
 const c=createTestContext();contexts.push(c);const scope={ownerId:c.config.ownerId,bookId:'s1a30-book'};
 c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'返修作者','2026-09-15','2026-09-15');
 new BookRepository(c.database).create(scope,'30a6返修书','2026-09-15','active');
 c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-15')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));
 const versions={value:'pv-30a'};
 const service=new TimeMachineDesignService(c.database,makeGateway(c),64000);
 (service as unknown as {_prerequisiteReader?:(s:{ownerId:string;bookId:string})=>{ready:boolean;message:string;version:string|null}})._prerequisiteReader=()=>({ready:true,message:'已确认',version:versions.value});
 return {c,scope,service,versions};
}
type AdapterFactory=(provider:string,modelId:string)=>{provider:string;modelId:string;generate:(request:{prompt:string},signal?:AbortSignal)=>Promise<{provider:string;modelId:string;output:string;inputTokens:number;outputTokens:number;cashCostCny:number;state:'succeeded'}>};
function skeletonTwo(){return {structure:'四幕起承转合：起承转合各司其职',baseline:'轻快成长',ending:'建立工坊',openingHooks:['开头钩子','第一章钩子','前三章钩子'],words:{target:400000,min:null,max:null,hard:false,policy:'chars-v1'},lines:[{id:'main',role:'main',title:'工坊',goal:'立足',answer:'建立工坊',process:'从修理到建坊',parentIds:[],milestones:[{id:'ms1',summary:'第一台自装机甲',suggestedVolumes:['v1'],importance:'flexible'}]}],expectations:[{id:'promise',opening:'无灵根能否立足',change:'看到变化',answer:'以机甲立足',lineIds:['main']}],relations:[],volumeBriefs:[{id:'v1',title:'开张',goal:'建立工坊',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'}},{id:'v2',title:'扩张',goal:'打开市场',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'}}]};}
function volumeCardFor(id:string){return {id,title:id==='v1'?'开张':'扩张',start:'濒临倒闭',goal:'完成订单',conflict:'封锁',beat:'起',turningPoint:'机甲完成',gain:'伙伴',loss:null,arc:null,payoff:null,hook:null,mood:null,ending:'工坊建立',handoff:id==='v1'?'引出扩张':'',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},anchors:[{id:'in',ownerEntityId:id,kind:'entry',summary:'危机成立',span:'本卷开篇',conditions:[{summary:'订单危机已经成立',subjectIds:['main']}],logic:'all',importance:'required',fallback:'补开场',keywords:[],aliases:[]},{id:'out',ownerEntityId:id,kind:'exit',summary:'交付完成',span:'本卷收束',conditions:[{summary:'订单交付完成',subjectIds:['main']}],logic:'all',importance:'required',fallback:'补收束',keywords:[],aliases:[]}],duties:[{lineId:'main',action:'close',result:'工坊建立',anchorIds:['out'],strength:'required',reason:'主线起点'}]};}
function makeGateway(c:TestContext,overrides:{skeleton?:(prompt:string,attempt:number)=>unknown;volume?:(briefId:string,prompt:string,attempt:number)=>unknown|'__TRUNCATE__'}={},counters:{volumeAttempts:Record<string,number>,skeletonAttempts:number,seenPrompts:string[]}={volumeAttempts:{},skeletonAttempts:0,seenPrompts:[]}):AdapterFactory{
 const base=(provider:string,modelId:string)=>({
  provider,modelId,
  async generate(request:{prompt:string}){
   counters.seenPrompts.push(request.prompt);
   if(request.prompt.includes('核对短卡是否'))return result(provider,modelId,{pass:true,issues:[]});
   if(request.prompt.includes('判断需要哪些方法'))return result(provider,modelId,{action:'ready',selected:[]});
   if(request.prompt.includes('你是主编，推荐'))return result(provider,modelId,{greeting:'老板，推荐如下',lines:[{id:'growth',role:'main',title:'成长线',description:'建立工坊',recommended:true}],structure:'single',reason:'聚焦成长'});
   if(request.prompt.includes('设计全书骨架。只设计')){counters.skeletonAttempts++;const value=overrides.skeleton?.(request.prompt,counters.skeletonAttempts)??skeletonTwo();return result(provider,modelId,value);}
   if(request.prompt.includes('补全本卷卷卡')){
    const brief=JSON.parse(request.prompt.split('\n本卷概要：')[1]!.split('\n前卷交接：')[0].trim()) as {id:string};
    counters.volumeAttempts[brief.id]=(counters.volumeAttempts[brief.id]??0)+1;
    const custom=overrides.volume?.(brief.id,request.prompt,counters.volumeAttempts[brief.id]!);
    if(custom==='__TRUNCATE__')throw new ModelAdapterError('套餐端点输出达到长度上限，内容未完整交付（max_tokens）','technical_failure',true,200,false,{inputTokens:2000,outputTokens:12000,cashCostCny:0},'output_length_limit');
    return result(provider,modelId,{volumes:[custom??volumeCardFor(brief.id)]});
   }
   if(request.prompt.includes('自检你刚完成')||request.prompt.includes('自检候选锚点'))return result(provider,modelId,{pass:true,issues:[]});
   if(request.prompt.includes('核对候选锚点'))return result(provider,modelId,{pass:true,issues:[],suggestions:[]});
   if(request.prompt.includes('核对候选骨架'))return result(provider,modelId,{action:'verdict',pass:true,issues:[],suggestions:[]});
   return result(provider,modelId,{fields:{premise:[{text:'修理工建立工坊',sourceKeys:['opening:opening:1']}],protagonists:[{text:'林舟',sourceKeys:['opening:opening:1']}],world:[],openingEnding:[],preferences:[],prohibitions:[]}});
  }});
 return (provider,modelId)=>base(provider,modelId);
}
function result(provider:string,modelId:string,value:unknown){return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded' as const};}
async function recommend(service:TimeMachineDesignService,scope:{ownerId:string;bookId:string}){const id=service.start(scope,'recommend','','rec-30a');await service.process(id);const run=service.state(scope).find(r=>r.id===id);expect(run?.state).toBe('succeeded');return {id:String(run!.id),recommendationHash:run!.recommendationHash??null};}
function selectionFor(run:{id:string;recommendationHash?:string|null},version:string):StorylineSelectionInput{return {recommendationRunId:run.id,recommendationHash:String(run.recommendationHash),preparationVersion:version,selectedLineIds:['growth'],addedLines:[],shape:'auto',ensemble:true,authorNote:''};}
describe('30a6f053 targeted fixes',()=>{
 it('gateway maps output_length_limit causeCode to truncated (machine-readable), keeps http-400 invalid separate, unknown stays unknown',async()=>{
  const c=createTestContext();contexts.push(c);const scope={ownerId:c.config.ownerId,bookId:'gw-book'};
  c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'网关作者','2026-09-15','2026-09-15');
  new BookRepository(c.database).create(scope,'网关书','2026-09-15','active');
  const call=(kind:'truncated'|'invalid'|'unknown')=>{const adapter={provider:'volcengine-ark-coding-plan',modelId:'deepseek-v4-pro',async generate(){throw kind==='truncated'?new ModelAdapterError('输出达到长度上限，内容未完整交付（max_tokens）','technical_failure',true,200,false,{inputTokens:100,outputTokens:12000,cashCostCny:0},'output_length_limit'):kind==='invalid'?new ModelAdapterError('套餐端点返回400：InvalidParameter','request_failure',false,400):new ModelAdapterError('请求中断，供应商结果状态未知','technical_failure',false,undefined,true);}};return new TimeMachineModelGateway(c.database,()=>adapter).generate({scope,id:`call-${kind}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,memberId:'planner-deepseek-v4-pro',provider:'volcengine-ark-coding-plan',modelId:'deepseek-v4-pro',prompt:'你好',maxOutputTokens:100,windowTokens:64000,temperature:0.6});};
  const truncated=await call('truncated').catch(error=>error as {kind:string;diagnosticCode?:string});
  expect(truncated.kind).toBe('truncated');
  const invalid=await call('invalid').catch(error=>error as {kind:string;diagnosticCode?:string});
  expect(invalid.kind).toBe('invalid');expect(String(invalid.diagnosticCode)).toContain('http-400');
  const unknown=await call('unknown').catch(error=>error as {kind:string});
  expect(unknown.kind).toBe('unknown');
  const rows=c.database.prepare("SELECT error_class,input_tokens,output_tokens FROM tm2_model_calls WHERE error_class='truncated'").all() as {error_class:string;input_tokens:number;output_tokens:number}[];
  expect(rows).toHaveLength(1);expect(rows[0]!.output_tokens).toBe(12000);
 });
 it('per-volume generation: second volume truncation fails the run as truncated; retry reuses volume 1 (no new call) and completes',async()=>{
  const counters={volumeAttempts:{},skeletonAttempts:0,seenPrompts:[]};
  const c=createTestContext();contexts.push(c);const scope={ownerId:c.config.ownerId,bookId:'pv-book'};
  c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'逐卷作者','2026-09-15','2026-09-15');
  new BookRepository(c.database).create(scope,'逐卷书','2026-09-15','active');
  c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-15')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));
  const service=new TimeMachineDesignService(c.database,new TimeMachineModelGateway(c.database,makeGateway(c,{volume:(briefId,_prompt,attempt)=>briefId==='v2'&&attempt===1?'__TRUNCATE__':undefined},counters)),64000);
  (service as unknown as {_prerequisiteReader?:(s:{ownerId:string;bookId:string})=>{ready:boolean;message:string;version:string|null}})._prerequisiteReader=()=>({ready:true,message:'已确认',version:'pv'});
  const rec=await recommend(service,scope);
  const created=service.startDesignRound(scope,selectionFor(rec,'pv'),'pv-round');
  const runA=created.find(x=>x.scheme==='A')!;
  await service.process(runA.id);
  const failed=service.state(scope).find(r=>r.id===runA.id)!;
  expect(failed.state).toBe('failed');
  expect(c.database.prepare('SELECT error_code FROM tm2_design_runs WHERE id=?').get(runA.id)).toMatchObject({error_code:'truncated'});
  expect(counters.volumeAttempts.v1).toBe(1);expect(counters.volumeAttempts.v2).toBe(1);
  const retried=service.retry(scope,runA.id);
  expect(retried).toBe(runA.id);
  await service.process(retried);
  const done=service.state(scope).find(r=>r.id===runA.id)!;
  expect(done.state).toBe('succeeded');
  expect(counters.volumeAttempts.v1).toBe(1); // 已完成卷未重做（步骤缓存复用）
  expect(counters.volumeAttempts.v2).toBe(2);
  const volumes=(done.result as {plan:{volumes:{id:string}[]}}).plan.volumes.map(v=>v.id);
  expect(volumes).toEqual(['v1','v2']);
 });
 it('suggestedVolumes written as display names are mapped by the system without a model round-trip',async()=>{
  const counters={volumeAttempts:{},skeletonAttempts:0,seenPrompts:[]};
  const c=createTestContext();contexts.push(c);const scope={ownerId:c.config.ownerId,bookId:'sv-book'};
  c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'归一化作者','2026-09-15','2026-09-15');
  new BookRepository(c.database).create(scope,'归一化书','2026-09-15','active');
  c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-15')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));
  const service=new TimeMachineDesignService(c.database,new TimeMachineModelGateway(c.database,makeGateway(c,{
   skeleton:(_prompt,attempt)=>{
    const base=skeletonTwo();
    if(attempt===1)((base.lines[0] as unknown as {milestones:{suggestedVolumes:string[]}[]}).milestones[0]!.suggestedVolumes=['第一卷','第二卷']);
    return base;
   }
  },counters)),64000);
  (service as unknown as {_prerequisiteReader?:(s:{ownerId:string;bookId:string})=>{ready:boolean;message:string;version:string|null}})._prerequisiteReader=()=>({ready:true,message:'已确认',version:'sv'});
  const rec=await recommend(service,scope);
  const created=service.startDesignRound(scope,selectionFor(rec,'sv'),'sv-round');
  const runA=created.find(x=>x.scheme==='A')!;
  await service.process(runA.id);
  const done=service.state(scope).find(r=>r.id===runA.id)!;
  expect(done.state).toBe('succeeded');
  expect(counters.skeletonAttempts).toBe(1); // 显示名由系统映射，不退回模型
  const resultRecord=done.result as {plan:{lines:Array<{milestones:Array<{suggestedVolumes:string[]}>}>}};
  expect(resultRecord.plan.lines[0]!.milestones[0]!.suggestedVolumes).toEqual(['v1','v2']);
 });
 it('unmappable suggestedVolumes get one precise-feedback repair, not a silent guess',async()=>{
  const counters={volumeAttempts:{},skeletonAttempts:0,seenPrompts:[]};
  const c=createTestContext();contexts.push(c);const scope={ownerId:c.config.ownerId,bookId:'sv2-book'};
  c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'归一化作者2','2026-09-15','2026-09-15');
  new BookRepository(c.database).create(scope,'归一化书2','2026-09-15','active');
  c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-15')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));
  const service=new TimeMachineDesignService(c.database,new TimeMachineModelGateway(c.database,makeGateway(c,{
   skeleton:(_prompt,attempt)=>{
    const base=skeletonTwo();
    if(attempt===1)((base.lines[0] as unknown as {milestones:{suggestedVolumes:string[]}[]}).milestones[0]!.suggestedVolumes=['第九卷']);
    if(attempt>=2)((base.lines[0] as unknown as {milestones:{suggestedVolumes:string[]}[]}).milestones[0]!.suggestedVolumes=['v1','v2']);
    return base;
   }
  },counters)),64000);
  (service as unknown as {_prerequisiteReader?:(s:{ownerId:string;bookId:string})=>{ready:boolean;message:string;version:string|null}})._prerequisiteReader=()=>({ready:true,message:'已确认',version:'sv2'});
  const rec=await recommend(service,scope);
  const created=service.startDesignRound(scope,selectionFor(rec,'sv2'),'sv2-round');
  const runA=created.find(x=>x.scheme==='A')!;
  await service.process(runA.id);
  const done=service.state(scope).find(r=>r.id===runA.id)!;
  expect(done.state).toBe('succeeded');
  expect(counters.skeletonAttempts).toBe(2);
  expect(counters.seenPrompts.some(p=>p.includes('suggestedVolumes')&&p.includes('第九卷')&&p.includes('上次输出未通过校验'))).toBe(true);
 });
 it('volume card pre-validation rejects bad ownerEntityId with a precise path and one repair fixes it',async()=>{
  const counters={volumeAttempts:{},skeletonAttempts:0,seenPrompts:[]};
  const c=createTestContext();contexts.push(c);const scope={ownerId:c.config.ownerId,bookId:'vc-book'};
  c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'预检作者','2026-09-15','2026-09-15');
  new BookRepository(c.database).create(scope,'预检书','2026-09-15','active');
  c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-15')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));
  const service=new TimeMachineDesignService(c.database,new TimeMachineModelGateway(c.database,makeGateway(c,{
   volume:(briefId,_prompt,attempt)=>{
    if(briefId==='v1'&&attempt===1){const card=volumeCardFor(briefId) as unknown as {anchors:{ownerEntityId:string}[]};card.anchors[0]!.ownerEntityId='wrong-owner';return card;}
    return undefined;
   }
  },counters)),64000);
  (service as unknown as {_prerequisiteReader?:(s:{ownerId:string;bookId:string})=>{ready:boolean;message:string;version:string|null}})._prerequisiteReader=()=>({ready:true,message:'已确认',version:'vc'});
  const rec=await recommend(service,scope);
  const created=service.startDesignRound(scope,selectionFor(rec,'vc'),'vc-round');
  const runA=created.find(x=>x.scheme==='A')!;
  await service.process(runA.id);
  expect(service.state(scope).find(r=>r.id===runA.id)).toMatchObject({state:'succeeded'});
  expect(counters.seenPrompts.some(p=>p.includes('ownerEntityId')&&p.includes('上次输出未通过校验'))).toBe(true);
 });
 it('roster: kimi-k3 excluded from all time-machine roles; per-scheme reviewer differs from the writer model',async()=>{
  const {c,scope}=setup();
  const snapshot=snapshotTimeMachine(c.database,scope,'',64000);
  const modelIds=[snapshot.members.researcher.model.modelId,snapshot.members.chief.model.modelId,...snapshot.writers.map(w=>w.model.modelId),...(snapshot.reviewers??[]).map(r=>r.model.modelId)];
  expect(modelIds).not.toContain('kimi-k3');
  expect(new Set(snapshot.writers.map(w=>w.model.modelId)).size).toBe(snapshot.writers.length);
  expect(snapshot.volumeStrategy).toBe('per-volume-v1');
  for(const [index,writer] of snapshot.writers.entries()){
   const reviewer=snapshot.reviewers?.[index];
   expect(reviewer).toBeTruthy();
   expect(reviewer!.model.modelId).not.toBe(writer.model.modelId);
   expect(reviewer!.model.modelId).not.toBe('kimi-k3');
  }
 });
});
