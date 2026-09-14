import {describe,it,expect,afterEach,vi} from 'vitest';
import {createTestContext,type TestContext} from '../../helpers/test-context.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import {TimeMachineDesignService} from '../../../apps/api/src/application/books/time-machine-design-service.js';
import {TimeMachineModelGateway} from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import {parseStorylineSelectionInput,type StorylineSelectionInput} from '../../../apps/api/src/application/books/storyline-selection.js';
import {createAppServer} from '../../../apps/api/src/http/app-server.js';
import {V7SettingEditorialService} from '../../../apps/api/src/application/books/v7-setting-editorial-service.js';
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
 if(prompt.includes('补全本批卷卡'))return {volumes:[{id:'v1',title:'开张',start:'濒临倒闭',goal:'完成订单',conflict:'封锁',beat:'起',turningPoint:'机甲完成',gain:'伙伴',loss:null,arc:null,payoff:null,hook:null,mood:null,ending:'工坊建立',handoff:'',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},anchors:[{id:'v1-in',ownerEntityId:'v1',kind:'entry',summary:'店铺濒临倒闭',span:'本卷开篇',conditions:[{summary:'订单危机已经成立',subjectIds:['main']}],logic:'all',importance:'required',fallback:'未达成需修订开场',keywords:[],aliases:[]},{id:'v1-out',ownerEntityId:'v1',kind:'exit',summary:'订单交付工坊立足',span:'本卷收束',conditions:[{summary:'订单交付完成',subjectIds:['main']}],logic:'all',importance:'required',fallback:'全书结束',keywords:[],aliases:[]}],duties:[{lineId:'main',action:'close',result:'工坊建立',anchorIds:['v1-out'],strength:'required',reason:'主线起点'}]}]};
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
 const service=new TimeMachineDesignService(c.database,makeGateway(c),64000);
 // 服务端版本读取器（startDesignRound只认读取函数，不接受客户端版本）；测试通过versions.value模拟服务端版本变化
 const versions={value:'pv'};
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
interface SnapshotJson{intent:string;manifest:{sources:{kind:string;id:string;revision:string;hash:string}[]};documents:{key:string;text:string}[];selection?:{requestHash:string;authorNote:string};members:{writer:{memberKey:string}}}
function snapshotsOf(c:TestContext,bookId:string):SnapshotJson[]{
 return (c.database.prepare("SELECT snapshot_json FROM tm2_design_runs WHERE book_id=? AND kind='design' ORDER BY scheme").all(bookId) as {snapshot_json:string}[]).map(r=>JSON.parse(String(r.snapshot_json)) as SnapshotJson);
}
describe('S1-A revision six fixes',()=>{
 it('F1: design round snapshot is fully rebuilt with final intent (manifest intent hash, intent document, and text all consistent with selection)',async()=>{
   const {c,scope,service}=setup();
   const rec=await succeededRecommend(service,scope,'f1-rec');
   const sel=selectionFor(rec,'pv',{authorNote:'想多写伙伴的成长',selectedLineIds:['growth'],addedLines:[{title:'宿敌线',description:'对手改变彼此'}]});
   const created=service.startDesignRound(scope,sel,'f1-round');
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
   expect(()=>injectable.startDesignRound(scope,sel,'f2-round')).toThrow('reader-injected-stop');
   expect(observedInTx).toBe(true);
   expect(c.database.prepare('SELECT COUNT(*) n FROM tm2_design_runs WHERE book_id=? AND kind=\'design\'').get(scope.bookId)).toMatchObject({n:0});
   // 无读取器注入时，客户端版本提示被用作回退（测试环境无设定服务），正常创建
   expect(service.startDesignRound(scope,sel,'f2-round').length).toBe(3);
 });
 it('F2b: replay of an existing round does not require readiness (version changed upstream still returns original round)',async()=>{
   const {c,scope,service}=setup();
   const rec=await succeededRecommend(service,scope,'f2b-rec');
   const sel=selectionFor(rec,'pv');
   service.startDesignRound(scope,sel,'f2b-round');
   // 模拟"开始校验后状态改变"：就绪读取返回not-ready（null），同键同选择回放仍返回原轮
   const replayed=new TimeMachineDesignService(c.database,makeGateway(c),64000);
   (replayed as unknown as {_prerequisiteReader?:unknown})._prerequisiteReader=()=>null;
   const again=replayed.startDesignRound(scope,sel,'f2b-round');
   expect(again.length).toBe(3);
   expect((c.database.prepare('SELECT COUNT(*) n FROM tm2_design_runs WHERE book_id=? AND kind=\'design\'').get(scope.bookId) as {n:number}).n).toBe(3);
 });
 it('F2c: second-scheme creation failure rolls back the whole round (no half round)',async()=>{
   const {c,scope,service}=setup();
   const rec=await succeededRecommend(service,scope,'f2c-rec');
   // 预占新轮B方案的request_key制造唯一冲突→第二个createRun失败→整个轮回滚
   c.database.prepare("INSERT INTO tm2_design_runs(id,owner_id,book_id,kind,request_key,input_hash,snapshot_json,state,created_at,updated_at) VALUES('blocked-b',?,?,  'design',?,  'x','{}','failed',?,?)").run(scope.ownerId,scope.bookId,'f2c-round#B','2026-09-15','2026-09-15');
   expect(()=>service.startDesignRound(scope,selectionFor(rec,'pv'),'f2c-round')).toThrow();
   // A也未写入：整个轮回滚
   expect(c.database.prepare('SELECT COUNT(*) n FROM tm2_design_runs WHERE book_id=? AND kind=\'design\' AND round_key=?').get(scope.bookId,'f2c-round')).toMatchObject({n:0});
   c.database.prepare("DELETE FROM tm2_design_runs WHERE id='blocked-b'").run();
   // 清障后同键创建成功
   expect(service.startDesignRound(scope,selectionFor(rec,'pv'),'f2c-round').length).toBe(3);
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
 // F1真实HTTP链：推荐→结构化design-runs→生成/审查→HTTP采用全部走实际路由与路由自带执行器（tick）；
 // 采用路由用保存的intent重建manifest，快照intent/manifest/documents不一致时无法通过。
 // 就绪读取mock仅替换版本值（真实持久状态组合在s1-setting-baseline-gate与部门套件覆盖）；模型为确定性夹具。
 it('F1-http: recommend→structured design-runs→generate/review→HTTP adoption rebuilds the manifest from the saved intent and succeeds',async()=>{
  const c=createTestContext();contexts.push(c);
  c.config.modelRuntime.endpoints.coding.apiKey='fixture-only-no-network';
  c.config.modelRuntime.endpoints.agent.apiKey='fixture-only-no-network';
  const app=await createAppServer(c.config,c.database,{timeMachineWindowTokens:64000,v7OpeningModelAdapters:{resolve:(provider:string,modelId:string)=>({provider,modelId,async generate(request:{prompt:string}){return {provider,modelId,output:JSON.stringify(output(request.prompt)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded' as const};}})}});
  try{
   const headers={host:'127.0.0.1:43111',origin:c.config.webOrigin,'sec-fetch-site':'same-origin','content-type':'application/json'};
   const register=async(email:string)=>{const r=await app.inject({method:'POST',url:'/api/v1/auth/register',headers,payload:{email,displayName:'测试',password:'Strong-test-pass-123!'}});expect(r.statusCode,r.body).toBe(200);return String(r.headers['set-cookie']).split(';')[0]!;};
   const cookie=await register('f1-http@example.com');
   const ownerId=String((c.database.prepare('SELECT owner_id FROM user_accounts WHERE email_normalized=?').get('f1-http@example.com') as {owner_id:string}).owner_id);
   const scope={ownerId,bookId:'f1-http-book'};
   new BookRepository(c.database).create(scope,'F1链路书','2026-09-15','active');
   c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-15')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));
   const spy=vi.spyOn(V7SettingEditorialService.prototype,'timeMachinePrerequisite').mockReturnValue({ready:true,message:'已确认',version:'v-f1'});
   const getState=async()=>(await app.inject({url:'/api/time-machine/books/f1-http-book/state',headers:{...headers,cookie}})).json().data as {runs:{id:string;kind:string;state:string;roundKey:string|null;recommendationHash?:string|null;preparationVersion?:string|null;result:{revision:number;review:{pass:boolean}}|null}[];adopted:{member:{id:string}}|null};
   const waitFor=async(check:()=>Promise<boolean>|boolean,what:string)=>{const start=Date.now();while(Date.now()-start<20000){if(await check())return;await new Promise(r=>setTimeout(r,250));}const rows=c.database.prepare("SELECT id,scheme,state,error_code,error_message,phase FROM tm2_design_runs WHERE book_id='f1-http-book'").all();throw Error(`等待超时：${what}；runs=${JSON.stringify(rows)}`);};   const recStart=await app.inject({method:'POST',url:'/api/time-machine/books/f1-http-book/recommendation-runs',headers:{...headers,cookie},payload:{intent:'',idempotencyKey:'f1-http-rec'}});
   expect(recStart.statusCode,recStart.body).toBe(202);
   await waitFor(()=>getState().then(d=>d.runs.some(r=>r.kind==='recommend'&&r.state==='succeeded')),'推荐完成');
   const recRun=(await getState()).runs.find(r=>r.kind==='recommend'&&r.state==='succeeded')!;
   expect(recRun.recommendationHash).toBeTruthy();expect(recRun.preparationVersion).toBe('v-f1');
   const selection={recommendationRunId:recRun.id,recommendationHash:String(recRun.recommendationHash),preparationVersion:String(recRun.preparationVersion),selectedLineIds:['growth'],addedLines:[{title:'宿敌线',description:'对手改变彼此'}],shape:'auto' as const,ensemble:true,authorNote:'想多写伙伴的成长'};
   const designStart=await app.inject({method:'POST',url:'/api/time-machine/books/f1-http-book/design-runs',headers:{...headers,cookie},payload:{idempotencyKey:'f1-http-round',selection}});
   expect(designStart.statusCode,designStart.body).toBe(202);
   const created=(designStart.json().data.runs as {id:string;scheme:string}[]);
   expect(created.map(r=>r.scheme).sort()).toEqual(['A','B','C']);
   await waitFor(()=>getState().then(d=>{const run=d.runs.find(r=>r.id===created[0]!.id);return run?.state==='succeeded'&&run.result!==null;}),'方案A生成与审查完成');
   const done=(await getState()).runs.find(r=>r.id===created[0]!.id)!;
   expect(done.result!.review.pass).toBe(true);
   // 快照一致性（真实保存的snapshot_json）：intent正文/manifest哈希/documents互相印证
   const snapshots=snapshotsOf(c,scope.bookId);
   const intentHash=digest(snapshots[0]!.intent);
   for(const snap of snapshots){
    expect(snap.intent).toContain('宿敌线（对手改变彼此）');expect(snap.intent).toContain('想多写伙伴的成长');
    const intentSource=snap.manifest.sources.find(s=>s.id==='intent');
    expect(intentSource?.hash).toBe(intentHash);
    expect(snap.documents.some(d=>d.key===`intent:intent:${intentHash}`&&d.text===snap.intent)).toBe(true);
   }
   // 实际HTTP采用：路由以保存的intent重建当前manifest并校验来源；不一致无法通过
   const adopt=await app.inject({method:'POST',url:'/api/time-machine/books/f1-http-book/adoptions',headers:{...headers,cookie},payload:{candidateId:created[0]!.id,revision:done.result!.revision,expectedRevision:0,idempotencyKey:'f1-http-adopt'}});
   expect(adopt.statusCode,adopt.body).toBe(200);
   const bookManifest=JSON.parse(String((c.database.prepare('SELECT manifest FROM tm2_books WHERE owner=? AND book=?').get(scope.ownerId,scope.bookId) as {manifest:string}).manifest)) as {sources:{id:string;hash:string}[]};
   const adoptedIntent=bookManifest.sources.find(s=>s.id==='intent');
   expect(adoptedIntent?.hash).toBe(intentHash);
   expect((await getState()).adopted).not.toBeNull();
   spy.mockRestore();
  }finally{vi.restoreAllMocks();await app.close();}
 });
});
