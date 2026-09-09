// Runs only against an isolated synthetic database. Credentials stay in the process environment.
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {resolve,basename} from 'node:path';
import {writeFileSync,readFileSync,chmodSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const root=resolve(process.argv[2]??'');
if(!root.startsWith('/tmp/wenmi-r192-probe'))throw Error('Probe requires isolated /tmp workspace');
const moduleAt=path=>import(pathToFileURL(resolve(root,path)).href);
const {runMigrations}=await moduleAt('api/infrastructure/db/migrations.js');
const {loadModelRuntimeConfig}=await moduleAt('api/infrastructure/models/model-runtime-config.js');
const {ModelAdapterFactory}=await moduleAt('api/infrastructure/models/model-adapter-factory.js');
const {TimeMachineModelGateway}=await moduleAt('api/infrastructure/models/time-machine-model-gateway.js');
const {TimeMachineDesignService}=await moduleAt('api/application/books/time-machine-design-service.js');
const {BookRepository}=await moduleAt('api/infrastructure/db/repositories/book-repository.js');
const {accountUsageTotals}=await moduleAt('api/infrastructure/security/account-usage-service.js');
const {SqlPlanRepository,volumePlanningContext}=await moduleAt('node_modules/@wenmi/time-machine-core/dist/index.js');
const resume=process.argv.includes('--resume');
const prior=resume?JSON.parse(readFileSync(resolve(root,'result.json'),'utf8')):null;
const databaseFile=resume?prior.databaseFile:`probe-${randomUUID()}.sqlite`;
if(typeof databaseFile!=='string'||!/^probe-[\w-]+\.sqlite$/u.test(databaseFile)||basename(databaseFile)!==databaseFile)throw Error('Probe database unavailable for resume');
if(resume&&!existsSync(resolve(root,databaseFile)))throw Error('Saved probe database is missing');
const db=new DatabaseSync(resolve(root,databaseFile));chmodSync(resolve(root,databaseFile),0o600);db.exec('PRAGMA foreign_keys=ON');runMigrations(db,resolve(root,'migrations'));
const {AUDITED_RUNTIME_POLICY}=await moduleAt('node_modules/@wenmi/v7-backend/dist/index.js');
if(!resume&&AUDITED_RUNTIME_POLICY)db.prepare('INSERT INTO v7_rhythm_policy_versions VALUES(1,?,?,?)').run(JSON.stringify(AUDITED_RUNTIME_POLICY),'probe',new Date().toISOString());
const scope={ownerId:'tm2-probe-owner',bookId:'tm2-probe-book'},now=new Date().toISOString();
if(!resume){db.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'隔离测试',now,now);new BookRepository(db).create(scope,'机甲修理工·隔离测试',now,'active');}
const source={protagonists:[{name:'林舟',description:'没有灵根的修理工，善于机械改造'}],storyDirection:'林舟靠会修仙的机甲获得立足之地，结识有自主意识的机甲伙伴',openingStart:'工坊即将被收走，必须完成一份危险订单',storyEnding:'机甲和没有灵根的人获得公平生存机会',mustFollow:['机甲不能无代价升级','主角不能突然获得灵根'],expectedTotalWords:2000000};
if(!resume)db.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active',?)").run(scope.ownerId,scope.bookId,JSON.stringify(source),'a'.repeat(64),now);
const factory=new ModelAdapterFactory(loadModelRuntimeConfig());let count=0,total=0;
const gateway=new TimeMachineModelGateway(db,(provider,modelId)=>{const adapter=factory.resolve(provider,modelId,'structured_planning');return {provider,modelId,async generate(request){if(++count>24||total>120000)throw Error('Probe budget reached');const result=await adapter.generate(request);total+=result.inputTokens+result.outputTokens;console.log(JSON.stringify({event:'model_complete',call:count,model:result.modelId,input:result.inputTokens,output:result.outputTokens}));return result;}};});
const service=new TimeMachineDesignService(db,gateway,64000);
try{
 if(!resume){const recommendation=service.start(scope,'recommend','','probe-recommend');await service.process(recommendation);}
 const previousDesign=resume?service.state(scope).find(r=>r.kind==='design'):null;
 const design=previousDesign?service.retry(scope,String(previousDesign.id)):service.start(scope,'design','单主线；成长线、机甲伙伴线；兼顾伙伴自身选择','probe-design');await service.process(design);
 const runs=service.state(scope),usage=accountUsageTotals(db,{ownerId:scope.ownerId});
 let handoff=null;
 const designed=runs.find(r=>r.id===design);
 if(designed?.state==='succeeded'&&designed.result?.review?.pass===true){
  const plans=new SqlPlanRepository(db),adoption=plans.adopt(scope,design,designed.result.revision,0,'probe-adopt');
  const active=plans.activePlan(scope);
  const packet=volumePlanningContext(active.candidate,adoption,active.candidate.plan.volumes[0].id,{id:'utf8-upper-bound',mode:'conservative',count:s=>Buffer.byteLength(s)},16000);
  handoff={adoptionRevision:adoption.revision,volumeId:packet.volumeId,tokens:packet.tokens,volumeCount:active.candidate.plan.volumes.length,lineCount:active.candidate.plan.lines.length};
 }
 const diagnostic=db.prepare('SELECT kind,state,error_code,error_message FROM tm2_design_runs').all();
 const calls=db.prepare('SELECT member_id,model_id,state,output_text,error_class FROM tm2_model_calls').all();
 writeFileSync(resolve(root,'result.json'),JSON.stringify({databaseFile,runs,usage,diagnostic,calls,handoff},null,2),{mode:0o600});
 console.log(JSON.stringify({event:'probe_complete',runs:runs.map(r=>({id:r.id,kind:r.kind,state:r.state})),calls:count,usage,handoff}));
 if(designed?.state!=='succeeded'||runs.find(r=>r.kind==='recommend')?.state!=='succeeded'||!handoff)process.exitCode=2;
}finally{db.close();}
