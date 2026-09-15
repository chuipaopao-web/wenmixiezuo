import {afterEach,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createTestContext,type TestContext} from '../../helpers/test-context.js';
import {seedCreativeLibrary} from '../../helpers/creative-library.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import {TimeMachineDesignService} from '../../../apps/api/src/application/books/time-machine-design-service.js';
import {TimeMachineModelGateway} from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import {SqlPlanRepository} from '@wenmi/time-machine-core';
import {snapshotTimeMachine} from '../../../apps/api/src/application/books/time-machine-sources.js';
import type {StorylineSelectionInput} from '../../../apps/api/src/application/books/storyline-selection.js';
/** S1-A：设计必须经结构化确认——先建立成功推荐，再按服务端推荐构造合法选择（intent文本经authorNote保留语义）。 */
function buildSelection(service:TimeMachineDesignService,scope:{ownerId:string;bookId:string},authorNote=''):StorylineSelectionInput{
 const rec=service.state(scope).filter(r=>r.kind==='recommend'&&r.state==='succeeded').sort((a,b)=>String(a.updatedAt??'')<String(b.updatedAt??'')?1:-1)[0];
 if(!rec)throw Error('测试前置失败：缺少成功推荐');
 const lines=(rec.result as unknown as {lines:{id:string}[]}).lines;
 return {recommendationRunId:String(rec.id),recommendationHash:String(rec.recommendationHash),preparationVersion:'test-pv',selectedLineIds:[String(lines[0]!.id)],addedLines:[],shape:'auto',ensemble:false,authorNote};
}
/** S1-A：设计必须经结构化确认——先保证有成功推荐（无则直接种一条含当前manifest的合成成功推荐，
 * 不产生模型调用、不干扰各测试自己的调用计数），再按服务端推荐构造合法选择。 */
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
async function designRun(service:TimeMachineDesignService,scope:{ownerId:string;bookId:string},intent:string,key:string):Promise<string>{
 seedRecommendIfMissing(service,scope);
 // 服务端版本读取器：startDesignRound只认读取函数，版本不再作为客户端参数传入
 (service as unknown as {_prerequisiteReader?:(s:{ownerId:string;bookId:string})=>{ready:boolean;message:string;version:string|null}})._prerequisiteReader=()=>({ready:true,message:'已确认',version:'test-pv'});
 const created=service.startDesignRound(scope,buildSelection(service,scope,intent),key);
 return created[0]!.id;
}
import {BookSynopsisService} from '../../../apps/api/src/application/books/book-synopsis-service.js';
import {listTimeMachineTasks} from '../../../apps/api/src/application/books/time-machine-task-list.js';
const contexts:TestContext[]=[];afterEach(()=>contexts.splice(0).forEach(c=>c.close()));
function setup(){const c=createTestContext();contexts.push(c);const scope={ownerId:c.config.ownerId,bookId:'tm-book'};c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'测试作者','2026-09-10','2026-09-10');new BookRepository(c.database).create(scope,'机甲会修仙','2026-09-10','active');c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-10')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));return {c,scope};}
function output(prompt:string):unknown{
 const record0=(v:unknown)=>v!==null&&typeof v==='object'?v as Record<string,unknown>:{};
 if(prompt.includes('核对短卡是否'))return {pass:true,issues:[]};
 if(prompt.includes('判断需要哪些方法'))return prompt.includes('上次工具结果（仅资料）：null')?{action:'search_methods',category:'',cursor:0}:{action:'ready',selected:[]};
 if(prompt.includes('你是主编，推荐'))return {greeting:'老板，我们现在设计全书骨架',lines:[{id:'growth',role:'main',title:'成长线',description:'林舟建立工坊',recommended:true}],structure:'single',reason:'聚焦修理工成长'};
 if(prompt.includes('设计全书骨架。只设计'))return {structure:'四幕起承转合：起于危机、承于扩张、转于公开冲突、合于公平生存',baseline:'轻快成长',ending:'建立工坊',openingHooks:['开头钩子','第一章钩子','前三章钩子'],words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},lines:[{id:'main',role:'main',title:'工坊',goal:'立足',answer:'建立工坊',process:'从修理接单到建立工坊',parentIds:[],milestones:[{id:'ms1',summary:'第一台自装机甲完成',suggestedVolumes:['v1'],importance:'flexible'}]}],expectations:[{id:'promise',opening:'无灵根能否立足',change:'看到变化',answer:'以机甲立足',lineIds:['main']}],relations:[],volumeBriefs:[{id:'v1',title:'开张',goal:'建立工坊',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'}}]};
 if(prompt.includes('补全本卷卷卡')){const brief=JSON.parse(prompt.split('\n本卷概要：')[1]!.split('\n前卷交接：')[0].trim()) as {id:string;words?:{target?:unknown}};const id=String(brief.id);const target=Number(record0(brief.words).target??200000);return {volumes:[{id,title:'开张',start:'濒临倒闭',goal:'完成订单',conflict:'封锁',beat:'起',turningPoint:'机甲完成',gain:'伙伴',loss:null,arc:null,payoff:null,hook:null,mood:null,ending:'工坊建立',handoff:'',words:{target,min:null,max:null,hard:false,policy:'chars-v1'},anchors:[{id:'in',ownerEntityId:id,kind:'entry',summary:'店铺濒临倒闭',span:'本卷开篇',conditions:[{summary:'订单危机已经成立',subjectIds:['main']}],logic:'all',importance:'required',fallback:'未达成需修订开场',keywords:[],aliases:[]},{id:'out',ownerEntityId:id,kind:'exit',summary:'订单交付工坊立足',span:'本卷收束',conditions:[{summary:'订单交付完成',subjectIds:['main']}],logic:'all',importance:'required',fallback:'全书结束，未兑现期待单独跟踪',keywords:[],aliases:[]}],duties:[{lineId:'main',action:'close',result:'工坊建立',anchorIds:['out'],strength:'required',reason:'主线起点'}]}]};}
 if(prompt.includes('补全本批卷卡'))return {volumes:[{id:'v1',title:'开张',start:'濒临倒闭',goal:'完成订单',conflict:'封锁',beat:'起',turningPoint:'机甲完成',gain:'伙伴',loss:null,arc:null,payoff:null,hook:null,mood:null,ending:'工坊建立',handoff:'',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},anchors:[{id:'v1-in',ownerEntityId:'v1',kind:'entry',summary:'店铺濒临倒闭',span:'本卷开篇',conditions:[{summary:'订单危机已经成立',subjectIds:['main']}],logic:'all',importance:'required',fallback:'未达成需修订开场',keywords:[],aliases:[]},{id:'v1-out',ownerEntityId:'v1',kind:'exit',summary:'订单交付工坊立足',span:'本卷收束',conditions:[{summary:'订单交付完成',subjectIds:['main']}],logic:'all',importance:'required',fallback:'全书结束，未兑现期待单独跟踪',keywords:[],aliases:[]}],duties:[{lineId:'main',action:'close',result:'工坊建立',anchorIds:['v1-out'],strength:'required',reason:'主线起点'}]}]};
 if(prompt.includes('自检你刚完成')||prompt.includes('自检候选锚点'))return {pass:true,issues:[]};
 if(prompt.includes('核对候选锚点'))return {pass:true,issues:[],suggestions:[]};
 if(prompt.includes('核对候选骨架'))return {action:'verdict',pass:true,issues:[],suggestions:[]};
 return {fields:{premise:[{text:'修理工建立工坊',sourceKeys:['opening:opening:1']}],protagonists:[{text:'林舟',sourceKeys:['opening:opening:1']}],world:[],openingEnding:[],preferences:[],prohibitions:[]}};
}
describe('new time machine orchestration with real persistence and simulated model',()=>{
 it('merges multiple pages with scoped aliases, restores stored sources and reuses successful steps',async()=>{
  const {c,scope}=setup();
  c.database.prepare('UPDATE book_opening_blueprints SET blueprint_json=? WHERE owner_id=? AND book_id=?').run(JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊',background:'世'.repeat(9000)}),scope.ownerId,scope.bookId);
  let merges=0,calls=0;
  const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   calls++;let value=output(request.prompt);
   if(request.prompt.includes('这是全书方向资料的归纳合并')){
    merges++;expect(request.prompt).not.toContain('opening:opening:1');
    expect(JSON.parse(request.prompt).operation).toBe('summarize_book_material');
    expect(request.maxOutputTokens).toBe(5000);
    value=JSON.parse(JSON.stringify(value).replaceAll('opening:opening:1','s1'));
   }
   return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));
  const service=new TimeMachineDesignService(c.database,gateway,64000);
  const id=service.start(scope,'recommend','','multi-page-merge');await service.process(id);
  expect(service.state(scope).find(r=>r.id===id)?.state).toBe('succeeded');expect(merges).toBeGreaterThan(0);
  const saved=String(c.database.prepare('SELECT fields_json FROM tm2_context_cards').get()!.fields_json);
  expect(saved).toContain('opening:opening:1');expect(saved).not.toContain('"s1"');
  const count=calls;await service.process(id);expect(calls).toBe(count);
 });
 it('projects scoped tasks, real phases, decisions and archived-book exclusion',async()=>{
  const {c,scope}=setup();
  const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){return {provider,modelId,output:JSON.stringify(output(request.prompt)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};}}));
  const service=new TimeMachineDesignService(c.database,gateway,64000);
  const id=service.start(scope,'recommend','','task-projection');
  expect(listTimeMachineTasks(c.database,scope.ownerId,scope.bookId)[0]).toMatchObject({taskId:id,status:'waiting',canStop:false,progressKnown:false});
  c.database.prepare("UPDATE tm2_design_runs SET state='working',phase='card:0' WHERE id=?").run(id);
  expect(listTimeMachineTasks(c.database,scope.ownerId)[0]).toMatchObject({status:'working',message:'正在整理资料'});
  expect(listTimeMachineTasks(c.database,'other')).toEqual([]);expect(listTimeMachineTasks(c.database,scope.ownerId,'other-book')).toEqual([]);
  c.database.prepare("UPDATE tm2_design_runs SET state='queued' WHERE id=?").run(id);await service.process(id);
  expect(listTimeMachineTasks(c.database,scope.ownerId)[0]).toMatchObject({status:'waiting_for_you',taskKind:'time_machine_recommend'});
  const design=await designRun(service,scope,'','task-projection-design');await service.process(design);
  expect(listTimeMachineTasks(c.database,scope.ownerId).find(t=>t.taskId===id)?.status).toBe('completed');
  expect(listTimeMachineTasks(c.database,scope.ownerId).find(t=>t.taskId===design)?.status).toBe('waiting_for_you');
  new SqlPlanRepository(c.database).adopt(scope,design,1,0,'task-adopt');
  expect(listTimeMachineTasks(c.database,scope.ownerId).find(t=>t.taskId===design)?.status).toBe('completed');
  c.database.prepare("UPDATE books SET status='archived' WHERE owner_id=? AND book_id=?").run(scope.ownerId,scope.bookId);
  expect(listTimeMachineTasks(c.database,scope.ownerId)).toEqual([]);
 });
 it('uses one preparation and one audit for modest material, then reuses it for recommendation and baseline',async()=>{
  const {c,scope}=setup();
  c.database.prepare('UPDATE book_opening_blueprints SET blueprint_json=? WHERE owner_id=? AND book_id=?').run(JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊',background:'世'.repeat(3500)}),scope.ownerId,scope.bookId);
  const prompts:string[]=[];const outputBudgets:number[]=[];
  const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   prompts.push(request.prompt);outputBudgets.push(request.maxOutputTokens);
   return {provider,modelId,output:JSON.stringify(output(request.prompt)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));
  const service=new TimeMachineDesignService(c.database,gateway,64000);
  const first=service.start(scope,'recommend','','compact-first');await service.process(first);
  expect(service.state(scope).find(r=>r.id===first)?.state).toBe('succeeded');
  expect(prompts).toHaveLength(3);expect(prompts[0]).toContain('输出前自行核对');expect(prompts[1]).toContain('核对短卡是否');expect(prompts[2]).not.toContain('sourceKeys');
  expect(outputBudgets[0]).toBe(5000);
  const saved=c.database.prepare('SELECT fields_json FROM tm2_context_cards').get()!;expect(String(saved.fields_json)).toContain('opening:opening:1');
  prompts.length=0;await service.process(service.start(scope,'recommend','增加伙伴关系','compact-repeat'));
  expect(prompts).toHaveLength(1);
  prompts.length=0;const design=await designRun(service,scope,'成长线与伙伴关系','compact-design');await service.process(design);
  expect(service.state(scope).find(r=>r.id===design)?.state).toBe('succeeded');
  expect(prompts.some(p=>p.includes('核对短卡是否')||p.includes('这可能是一部分资料'))).toBe(false);
  const skeleton=prompts.find(p=>p.includes('设计全书骨架。只设计'))!;
  expect(skeleton).toContain('修理工建立工坊');expect(skeleton).not.toContain('sourceKeys');
 });
 it('gates synopsis on adoption, keeps generated drafts separate, and rejects stale saves',async()=>{
  const {c,scope}=setup();let synopsisCalls=0;
  const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   const synopsis=request.prompt.includes('请设计面向读者的中文作品简介');if(synopsis){synopsisCalls++;expect(request.prompt).toContain('番茄');}
   return {provider,modelId,output:JSON.stringify(synopsis?{text:'没有灵根的修理工带着机甲进入修仙世界。当别人争抢传承时，他只想接下第一张订单，却发现这台被称作死物的机甲藏着自己的秘密。'}:output(request.prompt)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));
  const service=new BookSynopsisService(c.database,gateway,64000);
  await expect(service.generate(scope,'synopsis-before')).rejects.toThrow('全书基线');expect(synopsisCalls).toBe(0);
  const design=new TimeMachineDesignService(c.database,gateway,64000),id=await designRun(design,scope,'','synopsis-plan');await design.process(id);
  const plans=new SqlPlanRepository(c.database);plans.adopt(scope,id,1,0,'synopsis-adopt');
  const candidate=await service.generate(scope,'synopsis-generate');expect(candidate.state).toBe('candidate');expect(service.state(scope).saved).toBeNull();
  await service.generate(scope,'synopsis-generate');expect(synopsisCalls).toBe(1);
  c.database.prepare("UPDATE book_synopsis_versions SET state='working',text='' WHERE id=?").run(candidate.id);
  service.recover();expect(service.state(scope).latest?.state).toBe('candidate');expect(synopsisCalls).toBe(1);
  const input={text:candidate.text,adoptionId:candidate.adoptionId,profileVersion:candidate.profileVersion,expectedSavedId:null,requestKey:'synopsis-save'};
  expect(service.save(scope,input).saved?.text).toBe(candidate.text);expect(service.save(scope,input).saved?.text).toBe(candidate.text);
  expect(()=>service.save(scope,{...input,requestKey:'synopsis-stale'})).toThrow('其他页面');
  c.database.prepare('UPDATE book_opening_blueprints SET version=2 WHERE owner_id=? AND book_id=?').run(scope.ownerId,scope.bookId);
  expect(service.state(scope).eligible).toBe(false);expect(service.state(scope).saved?.stale).toBe(true);
 });
 it('passes author adjustments to the chief when recommending again',async()=>{
  const {c,scope}=setup();let checked=false;
  const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   if(request.prompt.includes('你是主编，推荐')){expect(request.prompt).toContain('增加重建家园，减少宿敌对抗');checked=true;}
   return {provider,modelId,output:JSON.stringify(output(request.prompt)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));
  const service=new TimeMachineDesignService(c.database,gateway,64000);await service.process(service.start(scope,'recommend','增加重建家园，减少宿敌对抗','re-recommend-intent'));expect(checked).toBe(true);
 });
 it('corrects one short-card claim without replacing the protagonist and direction',async()=>{
  const {c,scope}=setup();let reviews=0;let correctionSeen=false;
  const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   let value=output(request.prompt);
   if(request.prompt.includes('核对短卡是否'))value=reviews++===0?{pass:false,issues:['世界限制遗漏']}:{pass:true,issues:[]};
   if(request.prompt.includes('只提交确有依据的条目修正')){
    correctionSeen=true;
    value={edits:[{field:'world',action:'add',claim:{text:'机甲需要修理',sourceKeys:['opening:opening:1']}}]};
   }
   return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));
  const service=new TimeMachineDesignService(c.database,gateway,64000),id=service.start(scope,'recommend','','card-edit');await service.process(id);
  expect(correctionSeen).toBe(true);expect(service.state(scope)[0]).toMatchObject({state:'succeeded'});
  const saved=c.database.prepare('SELECT fields_json FROM tm2_context_cards WHERE owner=? AND book=?').get(scope.ownerId,scope.bookId)!;
  const fields=JSON.parse(String(saved.fields_json));
  expect(fields.premise[0].text).toBe('修理工建立工坊');expect(fields.protagonists[0].text).toBe('林舟');expect(fields.world[0].text).toBe('机甲需要修理');
 });
 it('reviews a saved author revision without regenerating its design and keeps earlier evidence',async()=>{
  const {c,scope}=setup();const prompts:string[]=[];
  const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){prompts.push(request.prompt);return {provider,modelId,output:JSON.stringify(output(request.prompt)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};}}));
  const service=new TimeMachineDesignService(c.database,gateway,64000);const id=await designRun(service,scope,'成长线','author-review');await service.process(id);
  const repo=new SqlPlanRepository(c.database),original=repo.readCandidate(scope,id,1)!;
  const edited={...original,plan:{...original.plan,baseline:'作者修订：共同成长'}};
  const revision=repo.saveCandidate(scope,id,1,edited);
  const result={...service.state(scope).find(run=>run.id===id)!.result,revision,plan:edited.plan,editedBy:'author',review:{pass:false,pending:true,issues:[],suggestions:[]}};
  c.database.prepare("UPDATE tm2_design_runs SET state='queued',result_json=? WHERE id=?").run(JSON.stringify(result),id);
  expect(()=>repo.adopt(scope,id,revision,0,'early')).toThrow('核查');
  prompts.length=0;await service.process(id);
  expect(prompts.some(prompt=>prompt.includes('设计全书骨架。只设计'))).toBe(false);
  expect(prompts.some(prompt=>prompt.includes('核对候选骨架')&&prompt.includes('作者修订：共同成长'))).toBe(true);
  expect(service.state(scope).find(run=>run.id===id)).toMatchObject({state:'succeeded',result:{revision:2,review:{pass:true}}});
  expect(repo.readCandidate(scope,id,1)).toEqual(original);expect(repo.adopt(scope,id,revision,0,'reviewed').revision).toBe(1);
 });
 it('delivers stored anchor conditions to self-check and chief review, and retains detected failures',async()=>{
  const {c,scope}=setup();const prompts:string[]=[];
  const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   let value=output(request.prompt);
   if(request.prompt.includes('自检候选锚点')||request.prompt.includes('核对候选锚点')){
    prompts.push(request.prompt);
    const found=request.prompt.includes('订单交付完成');
    value={pass:!found,issues:found?['订单交付的证据条件需要明确']:[],suggestions:[]};
   }
   return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));
  const service=new TimeMachineDesignService(c.database,gateway,64000);const id=await designRun(service,scope,'成长线','anchor-evidence');await service.process(id);
  expect(prompts.length).toBeGreaterThan(1);
  for(const prompt of prompts){expect(prompt).toContain('订单交付完成');expect(prompt).toContain('subjectIds');expect(prompt).toContain('logic');expect(prompt).toContain('未达成需修订开场');}
  expect(service.state(scope).find(r=>r.id===id)).toMatchObject({result:{review:{pass:false,issues:['订单交付的证据条件需要明确']}}});
 });
 it('keeps literary suggestions separate from source violations and does not block adoption for taste alone',async()=>{
  const {c,scope}=setup();let reviews=0;const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   const value=request.prompt.includes('核对候选骨架')?(reviews++,{action:'verdict',pass:true,issues:[],suggestions:['可以减少相似损失，增加轻快的变化']}):output(request.prompt);
   return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));const service=new TimeMachineDesignService(c.database,gateway,64000);const id=await designRun(service,scope,'成长线','suggestions');await service.process(id);
  expect(reviews).toBe(1);expect(service.state(scope).find(r=>r.id===id)).toMatchObject({progress:'已完成',result:{revision:1,review:{pass:true,suggestions:['可以减少相似损失，增加轻快的变化']}}});expect(new SqlPlanRepository(c.database).adopt(scope,id,1,0,'adopt').revision).toBe(1);
 });
 it('corrects source-card omissions once and restarts a known invalid run without erasing it',async()=>{
  const {c,scope}=setup();let audits=0,corrections=0;const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   let value=output(request.prompt);if(request.prompt.includes('核对短卡是否'))value=++audits===1?{pass:false,issues:['缺少主角无灵根限制']}:{pass:true,issues:[]};
   if(request.prompt.includes('只提交确有依据的条目修正')){corrections++;value={edits:[{field:'protagonists',action:'replace',index:0,expectedText:'林舟',claim:{text:'无灵根的林舟',sourceKeys:['opening:opening:1']}}]};}
   return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));const service=new TimeMachineDesignService(c.database,gateway,64000);const id=service.start(scope,'recommend','','source-review');await service.process(id);expect(corrections).toBe(1);expect(audits).toBe(2);expect(service.state(scope)[0]).toMatchObject({state:'succeeded'});
  c.database.prepare("UPDATE tm2_design_runs SET state='failed',error_code='needs_review' WHERE id=?").run(id);
  const retried=service.retry(scope,id);expect(retried).not.toBe(id);expect(service.retry(scope,id)).toBe(retried);expect(service.state(scope).find(r=>r.id===id)?.state).toBe('failed');
  c.database.prepare("UPDATE tm2_design_runs SET state='failed',error_code='unknown' WHERE id=?").run(retried);expect(()=>service.retry(scope,retried)).toThrow('不能重复');
 });
 it('preserves rejected revisions, performs only one semantic correction and blocks adoption if issues remain',async()=>{
  const {c,scope}=setup();let reviews=0;const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   const value=request.prompt.includes('核对候选骨架')?(reviews++,{action:'verdict',pass:true,issues:['v1转折仍然过于空泛'],suggestions:[]}):output(request.prompt);
   return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));const service=new TimeMachineDesignService(c.database,gateway,64000);const id=await designRun(service,scope,'成长线','review');await service.process(id);
  expect(reviews).toBe(2);expect(service.state(scope).find(r=>r.id===id)).toMatchObject({state:'succeeded',result:{revision:2,review:{pass:false}}});
  const repo=new SqlPlanRepository(c.database);expect(repo.readCandidate(scope,id,1)).not.toBeNull();expect(repo.readCandidate(scope,id,2)).not.toBeNull();expect(()=>repo.adopt(scope,id,2,0,'adopt')).toThrow('核查');
  await service.process(id);expect(reviews).toBe(2);
 });
 it('queries the published library, corrects invalid tools and injects selected details',async()=>{
  const {c,scope}=setup();const {id:methodId}=seedCreativeLibrary(c.database);
  let round=0;const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   let value=output(request.prompt);
   if(request.prompt.includes('当前仅选取创作参考')){
    expect(request.prompt).toContain('坚持单主线');
    value=[{action:'read',ids:['missing']},{action:'search',purpose:'阶段回报',query:'',conditional:false,cursor:0},{action:'read',ids:[methodId]},{action:'ready',selected:[{id:methodId,application:'用订单危机推进成长'}]}][round++];
    if(round===2)expect(request.prompt).toContain('只能读取');
   }
   if(request.prompt.includes('设计全书骨架')){expect(request.prompt).toContain(methodId);expect(request.prompt).toContain('不反复复述结果');}
   return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));const service=new TimeMachineDesignService(c.database,gateway,64000);const id=await designRun(service,scope,'坚持单主线','methods');await service.process(id);
  expect(round).toBe(4);expect(service.state(scope).find(r=>r.id===id)).toMatchObject({state:'succeeded'});
 });
 it('reads formal sources, recommends and designs, saves review and adopts without old engine',async()=>{const {c,scope}=setup();let calls=0;const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){calls++;return {provider,modelId,output:JSON.stringify(output(request.prompt)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};}}));const service=new TimeMachineDesignService(c.database,gateway,128000);
  const recommendation=service.start(scope,'recommend','','recommend-1');expect(service.start(scope,'recommend','','recommend-1')).toBe(recommendation);await service.process(recommendation);expect(service.state(scope)[0]).toMatchObject({state:'succeeded'});
  const design=await designRun(service,scope,'成长线','design-1');await service.process(design);const row=service.state(scope).find(r=>r.id===design)!;expect(row).toMatchObject({state:'succeeded',result:{review:{pass:true}}});const before=calls;await service.process(design);expect(calls).toBe(before);const adoption=new SqlPlanRepository(c.database).adopt(scope,design,1,0,'adopt-1');expect(adoption.mapping['main-line:main']!.number).toBe(1);expect(adoption.mapping['volume:v1']!.number).toBe(1);
 });
 it('rejects missing formal sources and overlong author selections',()=>{const {c,scope}=setup();const gateway=new TimeMachineModelGateway(c.database,()=>{throw Error('must not dispatch');});const service=new TimeMachineDesignService(c.database,gateway,128000);expect(()=>service.start(scope,'recommend','x'.repeat(4001),'key')).toThrow('过长');c.database.prepare("UPDATE book_opening_blueprints SET status='superseded'").run();expect(()=>service.start(scope,'recommend','','key')).toThrow('开书');});
 it('continues with original creation when the member never finishes method rounds',async()=>{
  const {c,scope}=setup();seedCreativeLibrary(c.database);let rounds=0;const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   let value=output(request.prompt);
   if(request.prompt.includes('当前仅选取创作参考')){value={action:'search',purpose:'阶段回报',query:'',conditional:false,cursor:rounds++};}
   return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));const service=new TimeMachineDesignService(c.database,gateway,64000);const id=await designRun(service,scope,'成长线','no-ready');await service.process(id);
  expect(rounds).toBe(6);
  expect(service.state(scope).find(r=>r.id===id)).toMatchObject({state:'succeeded',result:{review:{pass:true}}});
 });
 it('self-check issues trigger one revision round and both revisions stay readable',async()=>{
  const {c,scope}=setup();let checks=0;const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   let value=output(request.prompt);
   if(request.prompt.includes('自检你刚完成'))value=++checks===1?{pass:false,issues:['分卷字数合计与全书预算不一致']}:{pass:true,issues:[]};
   if(request.prompt.includes('设计全书骨架')&&request.prompt.includes('上轮意见'))expect(request.prompt).toContain('分卷字数合计');
   return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));const service=new TimeMachineDesignService(c.database,gateway,64000);const id=await designRun(service,scope,'成长线','self-check');await service.process(id);
  expect(checks).toBe(2);expect(service.state(scope).find(r=>r.id===id)).toMatchObject({state:'succeeded',result:{revision:2,review:{pass:true}}});
  const repo=new SqlPlanRepository(c.database);expect(repo.readCandidate(scope,id,1)).not.toBeNull();expect(repo.readCandidate(scope,id,2)).not.toBeNull();
  const parsed=repo.readCandidate(scope,id,2);expect(parsed?.schemaVersion).toBe(2);
 });
 it('chief reviewer may re-read a source excerpt before the verdict',async()=>{
  const {c,scope}=setup();const seen:string[]=[];const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   let value=output(request.prompt);
   if(request.prompt.includes('核对候选骨架')){
    if(request.prompt.includes('已读片段：[]')){
     expect(request.prompt).toContain('资料索引');value={action:'read_source',key:'opening:opening:1',offset:0};
    }else value={action:'verdict',pass:true,issues:[],suggestions:[]};
    seen.push(request.prompt);
   }
   return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));const service=new TimeMachineDesignService(c.database,gateway,64000);const id=await designRun(service,scope,'成长线','chief-read');await service.process(id);
  expect(seen).toHaveLength(2);expect(seen[1]).toContain('已读片段');expect(seen[1]).toContain('key');
  expect(service.state(scope).find(r=>r.id===id)).toMatchObject({state:'succeeded',result:{review:{pass:true}}});
 });
 it('keeps every design call within the 15000-char context red line for a ten-volume epic',async()=>{
  const c2=createTestContext();contexts.push(c2);
  c2.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run('owner-red-line','测试作者','2026-09-10','2026-09-10');
  new BookRepository(c2.database).create({ownerId:'owner-red-line',bookId:'tm-book-big'},'十卷大部头','2026-09-10','active');
  c2.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening2',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-10')").run('owner-red-line','tm-book-big',JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'b'.repeat(64));
  const bigScope={ownerId:'owner-red-line',bookId:'tm-book-big'};
  const prose='低语在铁轨尽头铺开，每一个字都带着锈与尘的重量，仿佛整座城的命运压在少年肩上，而他不肯低头。'.repeat(4);
  const volumeCard=(n:number)=>({id:`v${n}`,title:`第${n}卷·试炼`,beat:`第${Math.ceil(n/3)}幕·位置${n}`,start:prose,goal:prose,conflict:prose,turningPoint:prose,gain:'工坊壮大',loss:'伙伴负伤',arc:prose,payoff:prose,hook:prose,mood:prose,ending:'封锁破开一道缝',handoff:n<10?`第${n+1}卷的敌人是谁？`:'',words:{target:100000,min:null,max:null,hard:false,policy:'chars-v1'},
   anchors:['in','out'].map(kind=>({id:`v${n}-${kind}`,ownerEntityId:`v${n}`,kind:kind==='in'?'entry':'exit',summary:`第${n}卷${kind==='in'?'开场危机':'收束兑现'}`,span:kind==='in'?'本卷开篇':'本卷收束',conditions:[{summary:`第${n}卷${kind}条件已按正文成立`,subjectIds:['main']}],logic:'all',importance:'required',fallback:'未达成则以一场过渡戏补齐后再进下一卷',keywords:['机甲','工坊'],aliases:[]})),
   duties:[{lineId:'main',action:'advance',result:prose,anchorIds:[`v${n}-out`],strength:'required',reason:'主线推进'}]});
  const dispatched:string[]=[];const svcGateway=new TimeMachineModelGateway(c2.database,(provider,modelId)=>({provider,modelId,async generate(request){
   dispatched.push(request.prompt);
   let value=output(request.prompt);
   if(request.prompt.includes('设计全书骨架。只设计')){
    const base=output(request.prompt) as Record<string,unknown>;
    value={...base,words:{target:1000000,min:null,max:null,hard:false,policy:'chars-v1'},
     volumeBriefs:Array.from({length:10},(_,i)=>({id:`v${i+1}`,title:`第${i+1}卷·试炼`,beat:`第${Math.ceil((i+1)/3)}幕·位置${i+1}`,goal:prose,words:{target:100000,min:null,max:null,hard:false,policy:'chars-v1'}})),
     lines:[{id:'main',role:'main',title:'工坊',goal:prose,answer:prose,process:prose,parentIds:[],milestones:[{id:'ms1',summary:prose,suggestedVolumes:['v1','v2','v3','v4','v5','v6','v7','v8','v9','v10'],importance:'flexible'}]}],
     expectations:[{id:'promise',opening:prose,change:prose,answer:prose,lineIds:['main']}],relations:[]};
   }
   if(request.prompt.includes('补全本卷卷卡')){
    // 30a6f053逐卷生成：每次请求只含一个卷概要，按其id产出单卷卡。
    const brief=JSON.parse(request.prompt.split('\n本卷概要：')[1]!.split('\n前卷交接：')[0].trim()) as {id:string};
    value={volumes:[volumeCard(Number(String(brief.id).slice(1)))]};
   }
   else if(request.prompt.includes('补全本批卷卡')){
    const ids=(JSON.parse(request.prompt.split('\n本批：')[1]!.split('\n')[0]!) as {id:string}[]).map(x=>x.id);
    value={volumes:ids.map(id=>volumeCard(Number(id.slice(1))))};
   }
   return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));
  const service=new TimeMachineDesignService(c2.database,svcGateway,64000);const id=await designRun(service,bigScope,'成长线','red-line');await service.process(id);
  expect(service.state(bigScope).find(r=>r.id===id)).toMatchObject({state:'succeeded'});
  expect(dispatched.length).toBeGreaterThan(5);
  const reviews=dispatched.filter(prompt=>prompt.includes('核对候选锚点'));
  expect(reviews).toHaveLength(5);
  for(const [index,prompt] of reviews.entries()){
   const batch=JSON.parse(prompt.split('\n本批：')[1]!.split('\n作者：')[0]!) as {volumes:{id:string;anchors:{ownerEntityId:string;conditions:{summary:string;subjectIds:string[]}[];logic:string;fallback:string}[]}[]};
   expect(batch.volumes.map(v=>v.id)).toEqual([`v${index*2+1}`,`v${index*2+2}`]);
   for(const v of batch.volumes){expect(v.anchors).toHaveLength(2);for(const a of v.anchors){expect(a.ownerEntityId).toBe(v.id);expect(a.conditions[0]?.subjectIds).toEqual(['main']);expect(a.logic).toBe('all');expect(a.fallback).toContain('过渡戏');}}
   expect(prompt).toContain('正式资料短卡');
  }
  const oversize=dispatched.map((p,i)=>({i,chars:p.length})).filter(x=>x.chars>15000);
  expect(oversize).toEqual([]);
  const recorded=c2.database.prepare('SELECT MAX(prompt_chars) AS m, COUNT(*) AS n FROM tm2_model_calls WHERE prompt_chars IS NOT NULL').get() as {m:number;n:number};
  expect(recorded.n).toBe(dispatched.length);expect(recorded.m).toBeLessThanOrEqual(15000);
 });
 it('normalizes invalid model identifiers instead of failing assembly',async()=>{
  const {c,scope}=setup();const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   let value=output(request.prompt);
   if(request.prompt.includes('设计全书骨架。只设计')){
    const base=output(request.prompt) as {lines:Record<string,unknown>[];expectations:Record<string,unknown>[];volumeBriefs:Record<string,unknown>[]};
    value={...base,
     lines:[{...base.lines[0]!,id:'主线'}],
     expectations:[{...base.expectations[0]!,id:'期待',lineIds:['主线']}],
     volumeBriefs:[{...base.volumeBriefs[0]!,id:'第一卷'}]};
   }
   if(request.prompt.includes('补全本卷卷卡')||request.prompt.includes('补全本批卷卡')){
    expect(request.prompt).toContain('"id":"line"');
    const card=output(request.prompt) as {volumes:Record<string,unknown>[]};
    const briefId=(JSON.parse(request.prompt.split('\n本卷概要：')[1]!.split('\n前卷交接：')[0].trim()) as {id:string}).id;
    value={volumes:card.volumes.map(v=>({...(v as Record<string,unknown>),anchors:[{id:'开场-危机',ownerEntityId:briefId,kind:'entry',summary:'危机',span:'本卷开篇',conditions:[{summary:'危机成立',subjectIds:['line']}],logic:'all',importance:'required',fallback:'补开场',keywords:[],aliases:[]},{id:'收束-交付',ownerEntityId:briefId,kind:'exit',summary:'交付',span:'本卷收束',conditions:[{summary:'交付完成',subjectIds:['line']}],logic:'all',importance:'required',fallback:'补收束',keywords:[],aliases:[]}],duties:[{lineId:'line',action:'close',result:'工坊建立',anchorIds:['开场-危机','收束-交付'],strength:'required',reason:'主线'}]}))};
   }
   return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));const service=new TimeMachineDesignService(c.database,gateway,64000);const id=await designRun(service,scope,'成长线','bad-ids');await service.process(id);
  expect(service.state(scope).find(r=>r.id===id)).toMatchObject({state:'succeeded'});
  const adoption=new SqlPlanRepository(c.database).adopt(scope,id,1,0,'bad-ids');
  expect(adoption.mapping['volume:v1']!.number).toBe(1);expect(adoption.mapping['main-line:line']!.number).toBe(1);
 });
 it('card-5 snapshots keep the original card and review prompts, and resume reuses succeeded steps without new calls',async()=>{
  const {c,scope}=setup();const prompts:string[]=[];let calls=0;
  const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   calls++;prompts.push(request.prompt);
   return {provider,modelId,output:JSON.stringify(output(request.prompt)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));
  const service=new TimeMachineDesignService(c.database,gateway,64000);
  const id=service.start(scope,'recommend','','card5-resume');
  c.database.prepare("UPDATE tm2_design_runs SET snapshot_json=REPLACE(snapshot_json,'\"templateRevision\":\"tm2-card-6\"','\"templateRevision\":\"tm2-card-5\"') WHERE id=?").run(id);
  await service.process(id);
  expect(service.state(scope).find(r=>r.id===id)?.state).toBe('succeeded');
  const cardPrompts=prompts.filter(pp=>pp.includes('这可能是一部分资料')||pp.includes('这是最终短卡'));
  expect(cardPrompts.length).toBeGreaterThan(0);
  for(const pp of cardPrompts){expect(pp).not.toContain('coreAppeal核心卖点');expect(pp).not.toContain('readingTone阅读味道');expect(pp).not.toContain('资料含coreAppeal或readingTone');}
  const reviewPrompts=prompts.filter(pp=>pp.includes('核对短卡是否'));
  expect(reviewPrompts.length).toBeGreaterThan(0);
  for(const pp of reviewPrompts){expect(pp).not.toContain('核心卖点（coreAppeal归premise）');}
  expect(prompts.some(pp=>pp.includes('资料含coreAppeal或readingTone'))).toBe(false);
  c.database.prepare('DELETE FROM tm2_context_cards WHERE owner=? AND book=?').run(scope.ownerId,scope.bookId);
  c.database.prepare("UPDATE tm2_design_runs SET state='queued',result_json=NULL,error_code=NULL WHERE id=?").run(id);
  const callsBefore=calls;
  await service.process(id);
  expect(calls).toBe(callsBefore);
  expect(service.state(scope).find(r=>r.id===id)?.state).toBe('succeeded');
 });
 it('new card-6 snapshots carry the two-field responsibilities in card and review prompts',async()=>{
  const {c,scope}=setup();const prompts:string[]=[];
  const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   prompts.push(request.prompt);
   return {provider,modelId,output:JSON.stringify(output(request.prompt)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));
  const service=new TimeMachineDesignService(c.database,gateway,64000);
  const id=service.start(scope,'recommend','','card6-fresh');
  await service.process(id);
  expect(service.state(scope).find(r=>r.id===id)?.state).toBe('succeeded');
  expect(prompts.some(pp=>pp.includes('coreAppeal核心卖点')&&pp.includes('readingTone阅读味道'))).toBe(true);
  expect(prompts.some(pp=>pp.includes('核对短卡是否')&&pp.includes('核心卖点（coreAppeal归premise）'))).toBe(true);
 });
});
