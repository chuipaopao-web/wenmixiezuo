import {describe,it,expect,afterEach} from 'vitest';
import {createTestContext,type TestContext} from '../../helpers/test-context.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import {TimeMachineDesignService} from '../../../apps/api/src/application/books/time-machine-design-service.js';
import {TimeMachineModelGateway} from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import {parseStorylineSelectionInput,type StorylineSelectionInput} from '../../../apps/api/src/application/books/storyline-selection.js';
import {digest} from '@wenmi/time-machine-core';
// S1-A返修（6ad621dd六项）：先建立失败反例再修。
// 反例F1快照一致性；F2事务门禁+回放；F5 authorNote严格字符串。F3/F4为页面行为在页面测试覆盖；F6由边界门禁对比覆盖。
const contexts:TestContext[]=[];
afterEach(()=>contexts.splice(0).forEach(c=>c.close()));
function output(prompt:string):unknown{
 if(prompt.includes('核对短卡是否'))return {pass:true,issues:[]};
 if(prompt.includes('判断需要哪些方法'))return {action:'ready',selected:[]};
 if(prompt.includes('你是主编，推荐'))return {greeting:'老板，推荐如下',lines:[{id:'growth',role:'main',title:'成长线',description:'建立工坊',recommended:true}],structure:'single',reason:'聚焦成长'};
 if(prompt.includes('设计全书骨架。只设计'))return {structure:'四幕起承转合',baseline:'轻快成长',ending:'建立工坊',openingHooks:['开头钩子','第一章钩子','前三章钩子'],words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},lines:[{id:'main',role:'main',title:'工坊',goal:'立足',answer:'建立工坊',process:'从修理到建坊',parentIds:[],milestones:[]}],expectations:[{id:'promise',opening:'无灵根能否立足',change:'看到变化',answer:'以机甲立足',lineIds:['main']}],relations:[],volumeBriefs:[{id:'v1',title:'开张',goal:'建立工坊',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'}}]};
 if(prompt.includes('补全本批卷卡'))return {volumes:[{id:'v1',title:'开张',start:'濒临倒闭',goal:'完成订单',conflict:'封锁',beat:'起',turningPoint:'机甲完成',gain:'伙伴',loss:null,arc:null,payoff:null,hook:null,mood:null,ending:'工坊建立',handoff:'',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},anchors:[],duties:[{lineId:'main',action:'close',result:'工坊建立',anchorIds:[],strength:'required',reason:'主线起点'}]}]};
 if(prompt.includes('自检你刚完成')||prompt.includes('自检候选锚点'))return {pass:true,issues:[]};
 if(prompt.includes('核对候选锚点'))return {pass:true,issues:[],suggestions:[]};
 if(prompt.includes('核对候选骨架'))return {action:'verdict',pass:true,issues:[],suggestions:[]};
 return {fields:{premise:[{text:'修理工建立工坊',sourceKeys:['opening:opening:1']}],protagonists:[{text:'林舟',sourceKeys:['opening:opening:1']}],world:[],openingEnding:[],preferences:[],prohibitions:[]}};
}
function makeGateway(c:TestContext){return new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){return {provider,modelId,output:JSON.stringify(output(request.prompt)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};}}));}
function setup(){
 const c=createTestContext();contexts.push(c);const scope={ownerId:c.config.ownerId,bookId:'s1af-book'};
 c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'返修作者','2026-09-15','2026-09-15');
 new BookRepository(c.database).create(scope,'返修书','2026-09-15','active');
 c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-15')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));
 return {c,scope,service:new TimeMachineDesignService(c.database,makeGateway(c),64000)};
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
interface SnapshotJson{intent:string;manifest:{sources:{kind:string;id:string;revision:string;hash:string}[]};documents:{key:string;text:string}[];selection?:{requestHash:string;authorNote:string};members:{writer:{memberKey:string}}}
function snapshotsOf(c:TestContext,bookId:string):SnapshotJson[]{
 return (c.database.prepare("SELECT snapshot_json FROM tm2_design_runs WHERE book_id=? AND kind='design' ORDER BY scheme").all(bookId) as {snapshot_json:string}[]).map(r=>JSON.parse(String(r.snapshot_json)) as SnapshotJson);
}
describe('S1-A revision six fixes',()=>{
 it('F1: design round snapshot is fully rebuilt with final intent (manifest intent hash, intent document, and text all consistent with selection)',async()=>{
   const {c,scope,service}=setup();
   const rec=await succeededRecommend(service,scope,'f1-rec');
   const sel=selectionFor(rec,'pv',{authorNote:'想多写伙伴的成长',selectedLineIds:['growth'],addedLines:[{title:'宿敌线',description:'对手改变彼此'}]});
   const created=service.startDesignRound(scope,sel,'f1-round','pv');
   expect(created.length).toBe(3);
   const snapshots=snapshotsOf(c,scope.bookId);
   const intentHash=digest(snapshots[0]!.intent);
   for(const snap of snapshots){
     // intent正文一致且非空；manifest的intent来源哈希=正文的哈希；documents含该intent文档
     expect(snap.intent).toContain('宿敌线（对手改变彼此）');
     expect(snap.intent).toContain('想多写伙伴的成长');
     const intentSource=snap.manifest.sources.find(s=>s.id==='intent');
     expect(intentSource?.revision).toBe(intentHash);
     expect(intentSource?.hash).toBe(intentHash);
     expect(snap.documents.some(d=>d.key===`intent:intent:${intentHash}`&&d.text===snap.intent)).toBe(true);
     expect(snap.selection?.requestHash.length).toBeGreaterThan(0);
   }
 });
 it('F2a: version/preparation read happens inside the round transaction — a readiness reader observing mid-transaction state cannot predate the row',async()=>{
   const {c,scope,service}=setup();
   const rec=await succeededRecommend(service,scope,'f2-rec');
   const sel=selectionFor(rec,'pv');
   // 注入读取器：记录调用时点并抛出可识别错误，验证读取发生在事务边界内
   let observedInTx=false;
   const injectable=new TimeMachineDesignService(c.database,makeGateway(c),64000);
   (injectable as unknown as {_prerequisiteReader?:(s:{ownerId:string;bookId:string})=>{ready:boolean;message:string;version:string|null}})._prerequisiteReader=()=>{
     observedInTx=(injectable as unknown as {db:{isTransaction:boolean}}).db.isTransaction;
     throw new Error('reader-injected-stop');
   };
   expect(()=>injectable.startDesignRound(scope,sel,'f2-round','pv')).toThrow('reader-injected-stop');
   expect(observedInTx).toBe(true);
   expect(c.database.prepare('SELECT COUNT(*) n FROM tm2_design_runs WHERE book_id=? AND kind=\'design\'').get(scope.bookId)).toMatchObject({n:0});
   // 无读取器注入时，客户端版本提示被用作回退（测试环境无设定服务），正常创建
   expect(service.startDesignRound(scope,sel,'f2-round','pv').length).toBe(3);
 });
 it('F2b: replay of an existing round does not require readiness (version changed upstream still returns original round)',async()=>{
   const {c,scope,service}=setup();
   const rec=await succeededRecommend(service,scope,'f2b-rec');
   const sel=selectionFor(rec,'pv');
   service.startDesignRound(scope,sel,'f2b-round','pv');
   // 模拟"开始校验后状态改变"：就绪读取返回not-ready（null），同键同选择回放仍返回原轮
   const replayed=new TimeMachineDesignService(c.database,makeGateway(c),64000);
   (replayed as unknown as {_prerequisiteReader?:unknown})._prerequisiteReader=()=>null;
   const again=replayed.startDesignRound(scope,sel,'f2b-round','ignored-client-version');
   expect(again.length).toBe(3);
   expect((c.database.prepare('SELECT COUNT(*) n FROM tm2_design_runs WHERE book_id=? AND kind=\'design\'').get(scope.bookId) as {n:number}).n).toBe(3);
 });
 it('F2c: second-scheme creation failure rolls back the whole round (no half round)',async()=>{
   const {c,scope,service}=setup();
   const rec=await succeededRecommend(service,scope,'f2c-rec');
   // 预占新轮B方案的request_key制造唯一冲突→第二个createRun失败→整个轮回滚
   c.database.prepare("INSERT INTO tm2_design_runs(id,owner_id,book_id,kind,request_key,input_hash,snapshot_json,state,created_at,updated_at) VALUES('blocked-b',?,?,  'design',?,  'x','{}','failed',?,?)").run(scope.ownerId,scope.bookId,'f2c-round#B','2026-09-15','2026-09-15');
   expect(()=>service.startDesignRound(scope,selectionFor(rec,'pv'),'f2c-round','pv')).toThrow();
   // A也未写入：整个轮回滚
   expect(c.database.prepare('SELECT COUNT(*) n FROM tm2_design_runs WHERE book_id=? AND kind=\'design\' AND round_key=?').get(scope.bookId,'f2c-round')).toMatchObject({n:0});
   c.database.prepare("DELETE FROM tm2_design_runs WHERE id='blocked-b'").run();
   // 清障后同键创建成功
   expect(service.startDesignRound(scope,selectionFor(rec,'pv'),'f2c-round','pv').length).toBe(3);
 });
 it('F5: authorNote of non-string type is rejected, not silently coerced',()=>{
   const base={idempotencyKey:'k',selection:{recommendationRunId:'r1',recommendationHash:'h',preparationVersion:'v1',selectedLineIds:['a'],addedLines:[],shape:'auto' as const,ensemble:false,authorNote:''}};
   expect(()=>parseStorylineSelectionInput({...base,selection:{...base.selection,authorNote:123 as unknown as string}})).toThrow();
   expect(()=>parseStorylineSelectionInput({...base,selection:{...base.selection,authorNote:{x:1} as unknown as string}})).toThrow();
   expect(()=>parseStorylineSelectionInput({...base,selection:{...base.selection,authorNote:null as unknown as string}})).toThrow();
   expect(()=>parseStorylineSelectionInput({...base,selection:{...base.selection,authorNote:undefined as unknown as string}})).toThrow();
   // 合法字符串仍通过
   expect(parseStorylineSelectionInput({...base,selection:{...base.selection,authorNote:'正常补充'}}).selection.authorNote).toBe('正常补充');
 });
});
