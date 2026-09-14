import {describe,it,expect,afterEach} from 'vitest';
import {createTestContext,type TestContext} from '../../helpers/test-context.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import {TimeMachineDesignService} from '../../../apps/api/src/application/books/time-machine-design-service.js';
import {TimeMachineModelGateway} from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import {canonicalRecommendationHash,parseStorylineSelectionInput,selectionRequestHash,validateStorylineSelection,type StorylineSelectionInput} from '../../../apps/api/src/application/books/storyline-selection.js';
import {StorylineSelectionRepository} from '../../../apps/api/src/infrastructure/db/repositories/storyline-selection-repository.js';
import {snapshotTimeMachine,manifestSourcesSignature} from '../../../apps/api/src/application/books/time-machine-sources.js';
// S1-A：结构化故事线确认——来源校验、防重、同轮三方案共享selection、事务原子性。
// 与s1-setting-baseline-gate（HTTP门禁）互补；设定状态机由部门套件覆盖。
const contexts:TestContext[]=[];
afterEach(()=>contexts.splice(0).forEach(c=>c.close()));
function output(prompt:string):unknown{
 if(prompt.includes('核对短卡是否'))return {pass:true,issues:[]};
 if(prompt.includes('判断需要哪些方法'))return {action:'ready',selected:[]};
 if(prompt.includes('你是主编，推荐'))return {greeting:'老板，推荐如下',lines:[{id:'growth',role:'main',title:'成长线',description:'建立工坊',recommended:true},{id:'ally',role:'through',title:'伙伴线',description:'结识同伴',recommended:false}],structure:'single',reason:'聚焦成长'};
 if(prompt.includes('设计全书骨架。只设计'))return {structure:'四幕起承转合',baseline:'轻快成长',ending:'建立工坊',openingHooks:['开头钩子','第一章钩子','前三章钩子'],words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},lines:[{id:'main',role:'main',title:'工坊',goal:'立足',answer:'建立工坊',process:'从修理到建坊',parentIds:[],milestones:[]}],expectations:[{id:'promise',opening:'无灵根能否立足',change:'看到变化',answer:'以机甲立足',lineIds:['main']}],relations:[],volumeBriefs:[{id:'v1',title:'开张',goal:'建立工坊',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'}}]};
 if(prompt.includes('补全本批卷卡'))return {volumes:[{id:'v1',title:'开张',start:'濒临倒闭',goal:'完成订单',conflict:'封锁',beat:'起',turningPoint:'机甲完成',gain:'伙伴',loss:null,arc:null,payoff:null,hook:null,mood:null,ending:'工坊建立',handoff:'',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},anchors:[],duties:[{lineId:'main',action:'close',result:'工坊建立',anchorIds:[],strength:'required',reason:'主线起点'}]}]};
 if(prompt.includes('自检你刚完成')||prompt.includes('自检候选锚点'))return {pass:true,issues:[]};
 if(prompt.includes('核对候选锚点'))return {pass:true,issues:[],suggestions:[]};
 if(prompt.includes('核对候选骨架'))return {action:'verdict',pass:true,issues:[],suggestions:[]};
 return {fields:{premise:[{text:'修理工建立工坊',sourceKeys:['opening:opening:1']}],protagonists:[{text:'林舟',sourceKeys:['opening:opening:1']}],world:[],openingEnding:[],preferences:[],prohibitions:[]}};
}
function makeGateway(c:TestContext){return new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){return {provider,modelId,output:JSON.stringify(output(request.prompt)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};}}));}
function setup(){
 const c=createTestContext();contexts.push(c);const scope={ownerId:c.config.ownerId,bookId:'s1a-book'};
 c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'S1A作者','2026-09-15','2026-09-15');
 new BookRepository(c.database).create(scope,'S1A机甲书','2026-09-15','active');
 c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-15')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));
 const service=new TimeMachineDesignService(c.database,makeGateway(c),64000);
 // 服务端版本读取器（startDesignRound只认读取函数，不接受客户端版本）；versions.value模拟服务端版本
 const versions={value:'pv-1'};
 (service as unknown as {_prerequisiteReader?:(s:{ownerId:string;bookId:string})=>{ready:boolean;message:string;version:string|null}})._prerequisiteReader=()=>({ready:true,message:'已确认',version:versions.value});
 return {c,scope,service,versions};
}
type RecRun={id:string;recommendationHash?:string|null};
async function succeededRecommend(service:TimeMachineDesignService,scope:{ownerId:string;bookId:string},key:string):Promise<RecRun>{
 const id=service.start(scope,'recommend','',key);await service.process(id);
 const run=service.state(scope).find(r=>r.id===id);
 expect(run?.state).toBe('succeeded');
 return {id:String(run!.id),recommendationHash:run!.recommendationHash ?? null};
}
function selectionFor(run:RecRun,preparationVersion:string,overrides:Partial<StorylineSelectionInput>={}):StorylineSelectionInput{
 return {recommendationRunId:run.id,recommendationHash:String(run.recommendationHash),preparationVersion,selectedLineIds:['growth'],addedLines:[],shape:'auto',ensemble:true,authorNote:'',...overrides};
}
describe('S1-A structured storyline selection',()=>{
 it('parse: rejects legacy/missing selection, dedupes ids, enforces limits with precise messages',()=>{
   const base={idempotencyKey:'k',selection:{recommendationRunId:'r1',recommendationHash:'h',preparationVersion:'v1',selectedLineIds:['a'],addedLines:[],shape:'auto' as const,ensemble:false,authorNote:''}};
   expect(()=>parseStorylineSelectionInput({idempotencyKey:'k',intent:'旧式'})).toThrow('刷新');
   expect(()=>parseStorylineSelectionInput({idempotencyKey:'k'})).toThrow('刷新');
   expect(parseStorylineSelectionInput(base).selection.selectedLineIds).toEqual(['a']);
   expect(parseStorylineSelectionInput({...base,selection:{...base.selection,selectedLineIds:['a','a','b']}}).selection.selectedLineIds).toEqual(['a','b']);
   expect(()=>parseStorylineSelectionInput({...base,selection:{...base.selection,selectedLineIds:Array.from({length:31},(_,i)=>`l${i}`)}})).toThrow('30');
   expect(()=>parseStorylineSelectionInput({...base,selection:{...base.selection,addedLines:Array.from({length:21},()=>({title:'t',description:'d'}))}})).toThrow('20');
   expect(()=>parseStorylineSelectionInput({...base,selection:{...base.selection,addedLines:[{title:'x'.repeat(81),description:'d'}]}})).toThrow('80');
   expect(()=>parseStorylineSelectionInput({...base,selection:{...base.selection,addedLines:[{title:'t',description:'d'.repeat(501)}]}})).toThrow('500');
   expect(()=>parseStorylineSelectionInput({...base,selection:{...base.selection,authorNote:'n'.repeat(1001)}})).toThrow('1000');
   expect(()=>parseStorylineSelectionInput({...base,selection:{...base.selection,selectedLineIds:[],addedLines:[]}})).toThrow('至少');
 });
 it('validate: owner/book/hash/version/manifest checks with precise messages; unknown line id rejected; intent built from server-side line content',async()=>{
   const {c,scope,service}=setup();
   const rec=await succeededRecommend(service,scope,'rec-1');
   const sig=manifestSourcesSignature(snapshotTimeMachine(c.database,scope,'',64000).manifest);
   const sel=selectionFor(rec,'pv-1');
   const {intent,selectionSnapshot}=validateStorylineSelection(new StorylineSelectionRepository(c.database),scope,sel,'pv-1',sig);
   expect(intent).toContain('主线·成长线（建立工坊）');
   expect(selectionSnapshot.requestHash).toBe(selectionRequestHash(sel));
   expect(()=>validateStorylineSelection(new StorylineSelectionRepository(c.database),scope,selectionFor(rec,'pv-1',{selectedLineIds:['nope']}),'pv-1',sig)).toThrow('不在本次推荐');
   expect(()=>validateStorylineSelection(new StorylineSelectionRepository(c.database),scope,selectionFor(rec,'pv-1',{recommendationHash:'bad'}),'pv-1',sig)).toThrow('已更新');
   expect(()=>validateStorylineSelection(new StorylineSelectionRepository(c.database),scope,selectionFor(rec,'pv-1'),'pv-2',sig)).toThrow('设定资料已变化');
   expect(()=>validateStorylineSelection(new StorylineSelectionRepository(c.database),scope,selectionFor(rec,'pv-1'),'pv-1','different-signature')).toThrow('资料已变化');
   c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run('other-owner','他人','2026-09-15','2026-09-15');
   expect(()=>validateStorylineSelection(new StorylineSelectionRepository(c.database),{ownerId:'other-owner',bookId:'s1a-book'},sel,'pv-1',sig)).toThrow('推荐不存在');
 });
 it('startDesignRound: one round shared across A/B/C with same selection; same key+selection idempotent; same key different selection rejected; upstream change rejected for old request',async()=>{
   const {c,scope,service,versions}=setup();
   const rec=await succeededRecommend(service,scope,'rec-2');
   const sig=manifestSourcesSignature(snapshotTimeMachine(c.database,scope,'',64000).manifest);
   versions.value='pv-2';
   const sel=selectionFor(rec,'pv-2',{authorNote:'想多一点群像',selectedLineIds:['growth','ally']});
   const created=service.startDesignRound(scope,sel,'round-1');
   expect(created.length).toBe(3);
   const snapshots=created.map(item=>JSON.parse(String((c.database.prepare('SELECT snapshot_json FROM tm2_design_runs WHERE id=?').get(item.id) as {snapshot_json:string}).snapshot_json)) as {selection?:{requestHash:string;authorNote:string};members:{writer:{memberKey:string}}});
   for(const snap of snapshots){expect(snap.selection?.requestHash).toBe(selectionRequestHash(sel));expect(snap.selection?.authorNote).toBe('想多一点群像');}
   expect(new Set(snapshots.map(s=>s.members.writer.memberKey)).size).toBeGreaterThan(1);
   const again=service.startDesignRound(scope,sel,'round-1');
   expect(again.map(x=>x.id).sort()).toEqual(created.map(x=>x.id).sort());
   expect((c.database.prepare('SELECT COUNT(*) AS n FROM tm2_design_runs WHERE book_id=? AND kind=\'design\'').get(scope.bookId) as {n:number}).n).toBe(3);
   expect(()=>service.startDesignRound(scope,selectionFor(rec,'pv-2',{authorNote:'改了'}),'round-1')).toThrow('其他故事线选择');
   // 同键同选择：上游版本变化后仍返回原轮（响应丢失不因后来配置变化新开任务；回放不重新就绪）
   versions.value='pv-3';
   expect(service.startDesignRound(scope,sel,'round-1').map(x=>x.id).sort()).toEqual(created.map(x=>x.id).sort());
   // 新键+过期版本（选择携带旧pv-2，服务端当前已是pv-3）：拒绝创建
   expect(()=>service.startDesignRound(scope,selectionFor(rec,'pv-2'),'round-1b')).toThrow('设定资料已变化');
   // intent-only设计入口被拒（不留第二条绕过确认的路径）
   expect(()=>service.start(scope,'design' as never,'自由文字','k')).toThrow('结构化故事线确认');
 });
 it('replay of a round whose stored snapshot lacks selection metadata is rejected, not guessed; new key still works',async()=>{
   const {c,scope,service,versions}=setup();
   const rec=await succeededRecommend(service,scope,'rec-3');
   versions.value='pv-3';
   const round2=service.startDesignRound(scope,selectionFor(rec,'pv-3'),'round-2');
   for(const item of round2)await service.process(item.id);
   const firstId=(c.database.prepare('SELECT id FROM tm2_design_runs WHERE book_id=? AND round_key=? LIMIT 1').get(scope.bookId,'round-2') as {id:string}).id;
   c.database.prepare('UPDATE tm2_design_runs SET snapshot_json=\'{"members":{}}\' WHERE id=?').run(firstId);
   expect(()=>service.startDesignRound(scope,selectionFor(rec,'pv-3'),'round-2')).toThrow('无法核对');
   expect(service.startDesignRound(scope,selectionFor(rec,'pv-3'),'round-3').length).toBe(3);
 });
 it('app restart idempotency: new service instance, same key same selection returns original round',async()=>{
   const {c,scope,service,versions}=setup();
   const rec=await succeededRecommend(service,scope,'rec-4');
   versions.value='pv-4';
   const created=service.startDesignRound(scope,selectionFor(rec,'pv-4'),'round-4');
   const service2=new TimeMachineDesignService(c.database,makeGateway(c),64000);
   (service2 as unknown as {_prerequisiteReader?:(s:{ownerId:string;bookId:string})=>{ready:boolean;message:string;version:string|null}})._prerequisiteReader=()=>({ready:true,message:'已确认',version:'pv-4'});
   const again=service2.startDesignRound(scope,selectionFor(rec,'pv-4'),'round-4');
   expect(again.map(x=>x.id).sort()).toEqual(created.map(x=>x.id).sort());
 });
 it('state projects recommendationHash and minimal selection for refresh recovery',async()=>{
   const {c,scope,service,versions}=setup();
   const rec=await succeededRecommend(service,scope,'rec-5');
   expect(rec.recommendationHash).toBe(canonicalRecommendationHash(String((c.database.prepare('SELECT result_json FROM tm2_design_runs WHERE id=?').get(rec.id) as {result_json:string}).result_json)));
   versions.value='pv-5';
   service.startDesignRound(scope,selectionFor(rec,'pv-5',{selectedLineIds:['growth','ally'],addedLines:[{title:'宿敌线',description:'对手改变彼此'}],authorNote:'补充'}),'round-5');
   const design=service.state(scope).find(r=>r.kind==='design');
   expect(design?.selection).toMatchObject({selectedLineIds:['growth','ally'],addedLines:[{title:'宿敌线',description:'对手改变彼此'}],authorNote:'补充',shape:'auto',ensemble:true});
 });
});
