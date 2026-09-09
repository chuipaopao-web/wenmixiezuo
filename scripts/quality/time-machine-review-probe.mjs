// One real semantic review of an existing synthetic probe output; never reads the product database.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]??'');if(!root.startsWith('/tmp/wenmi-r192-probe'))throw Error('Isolated probe directory required');
const moduleAt=p=>import(pathToFileURL(resolve(root,p)).href);
const prior=JSON.parse(readFileSync(resolve(root,'result.json'),'utf8'));
const candidate=prior.runs.find(r=>r.kind==='design')?.result?.plan;if(!candidate)throw Error('No synthetic candidate');
const {runMigrations}=await moduleAt('api/infrastructure/db/migrations.js');
const {BookRepository}=await moduleAt('api/infrastructure/db/repositories/book-repository.js');
const {V7AgentGovernanceRepository}=await moduleAt('api/infrastructure/db/repositories/v7-agent-governance-repository.js');
const {ModelAdapterFactory}=await moduleAt('api/infrastructure/models/model-adapter-factory.js');
const {loadModelRuntimeConfig}=await moduleAt('api/infrastructure/models/model-runtime-config.js');
const {TimeMachineModelGateway}=await moduleAt('api/infrastructure/models/time-machine-model-gateway.js');
const {timeMachineReviewChecks}=await moduleAt('api/application/books/time-machine-review.js');
const db=new DatabaseSync(':memory:');runMigrations(db,resolve(root,'migrations'));
const scope={ownerId:'review-probe',bookId:'review-probe'},now=new Date().toISOString();
db.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'隔离测试',now,now);new BookRepository(db).create(scope,'合成评审测试',now,'active');
const registry=new V7AgentGovernanceRepository(db);registry.ensureSeeded(now);const chief=registry.snapshot().members.find(m=>m.enabled&&m.defaultForRole&&m.fixedRoleKey==='chief_editor');if(!chief)throw Error('Chief missing');
const factory=new ModelAdapterFactory(loadModelRuntimeConfig());const gateway=new TimeMachineModelGateway(db,(p,m)=>factory.resolve(p,m,'structured_planning'));
const source='林舟没有灵根，是机械修理工；靠会修仙的自主意识机甲立足。开局工坊将被收走，须完成危险订单；结局机甲和无灵根者获得公平生存机会。机甲不能无代价升级；林舟不能突然获得灵根。作者选择单主线、成长线、机甲伙伴线，兼顾伙伴选择。其余剧情是待审候选。';
try{
 const output=await gateway.generate({scope,id:'semantic-review',memberId:chief.memberKey,provider:chief.model.provider,modelId:chief.model.modelId,windowTokens:64000,maxOutputTokens:6000,temperature:0.6,prompt:`你是主编，核对来源与候选，不将原创情节本身判成幻觉。返回JSON {"pass":true或false,"issues":["具体问题"]}。${timeMachineReviewChecks}\n来源：${source}\n候选：${JSON.stringify(candidate)}`});
 const review=JSON.parse(output.trim().replace(/^```(?:json)?\s*/u,'').replace(/\s*```$/u,''));
 const usage=db.prepare('SELECT model_id,input_tokens,output_tokens,cash_micros FROM tm2_model_calls').get();
 writeFileSync(resolve(root,'review-result.json'),JSON.stringify({review,usage},null,2),{mode:0o600});console.log(JSON.stringify({review,usage}));
 if(review.pass!==false||!Array.isArray(review.issues)||review.issues.length<1)process.exitCode=2;
}finally{db.close();}
