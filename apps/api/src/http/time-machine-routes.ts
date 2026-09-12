import type {FastifyInstance} from 'fastify';
import type {DatabaseSync} from 'node:sqlite';
import {Conflict,SqlPlanRepository,volumePlanningContext,parseCandidate,volumeDisplayCode,lineDisplayCode,digest} from '@wenmi/time-machine-core';
import type {V7EffectiveMember} from '@wenmi/v7-backend';
import {TimeMachineDesignService} from '../application/books/time-machine-design-service.js';
import {snapshotTimeMachine} from '../application/books/time-machine-sources.js';
import {TimeMachineModelGateway} from '../infrastructure/models/time-machine-model-gateway.js';
import type {ModelAdapter} from '../infrastructure/models/model-adapter.js';
import {BookRepository} from '../infrastructure/db/repositories/book-repository.js';
import {requireAuthenticatedOwner} from '../infrastructure/security/auth-context.js';
import {success} from '../contracts/api.js';
import {DomainError,errorCodes} from '../domain/errors.js';
import {BookSynopsisService} from '../application/books/book-synopsis-service.js';
import {V7SettingEditorialService} from '../application/books/v7-setting-editorial-service.js';
import {SystemClock,UuidGenerator} from '../domain/ids.js';
import {V7SettingEditorialRepository} from '../infrastructure/db/repositories/v7-setting-editorial-repository.js';
export async function registerTimeMachineRoutes(app:FastifyInstance,db:DatabaseSync,resolve:(provider:string,model:string)=>ModelAdapter,windowTokens:number):Promise<void>{
 const service=new TimeMachineDesignService(db,new TimeMachineModelGateway(db,resolve),windowTokens);
 const settings=new V7SettingEditorialService(db,{resolve},new UuidGenerator(),new SystemClock(),{codingPlan:false,agentPlan:false});
 const prerequisite=(s:{ownerId:string;bookId:string})=>settings.timeMachinePrerequisite(s.ownerId,s.bookId);
 const requirePrepared=(s:{ownerId:string;bookId:string})=>{const p=prerequisite(s);if(!p.ready)throw new DomainError(errorCodes.validation,p.message,{},false,409);};
 const currentRuns=(s:{ownerId:string;bookId:string})=>{
  const opening=db.prepare("SELECT version,blueprint_json FROM book_opening_blueprints WHERE owner_id=? AND book_id=? AND status='active' ORDER BY version DESC LIMIT 1").get(s.ownerId,s.bookId);
  const sources=[...(opening?[{kind:'opening',id:'opening',revision:String(opening.version),hash:digest(JSON.parse(String(opening.blueprint_json)))}]:[]),...new V7SettingEditorialRepository(db).confirmedVersions(s.ownerId,s.bookId).map(x=>({kind:'setting',id:x.item_key,revision:x.version_id,hash:digest(JSON.parse(x.content_json))}))];
  const signature=(xs:typeof sources)=>digest(xs.filter(x=>x.kind==='opening'||x.kind==='setting').sort((a,b)=>a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id)));
  const expected=signature(sources);
  return service.state(s).filter(run=>{const r=db.prepare('SELECT snapshot_json FROM tm2_design_runs WHERE owner_id=? AND book_id=? AND id=?').get(s.ownerId,s.bookId,String(run.id));return r&&signature(JSON.parse(String(r.snapshot_json)).manifest.sources)===expected;});
 };
 const synopses=new BookSynopsisService(db,new TimeMachineModelGateway(db,resolve),windowTokens);
 synopses.recover();
 const scope=(request:Parameters<typeof requireAuthenticatedOwner>[0],bookId:string)=>{const owner=requireAuthenticatedOwner(request),s={ownerId:owner.ownerId,bookId};const book=new BookRepository(db).require(s);if(book.status==='archived')throw new DomainError(errorCodes.validation,'书籍已归档',{},false,409);return s;};
 const guard=<T>(fn:()=>T):T=>{try{return fn();}catch(e){if(e instanceof DomainError)throw e;throw new DomainError(errorCodes.validation,e instanceof Conflict?e.message:'当前操作未能完成，请核对资料或稍后重试',{},false,409);}};
 let active:Promise<void>|null=null,activeId:string|null=null,closed=false;
 const tick=()=>{if(closed||windowTokens<16000)return;
  // 孤儿运行清理不能被在飞运行阻塞：进程重启会让working行永远滞留（R192浏览器验证实测）。
  // 按id排除当前在飞运行——单步骤含自动重试可静默超过20分钟，不能按新鲜度误杀活运行。
  db.prepare("UPDATE tm2_design_runs SET state='failed',error_code='interrupted' WHERE state='working' AND updated_at<? AND id<>coalesce(?, '')").run(new Date(Date.now()-20*60*1000).toISOString(),activeId);
  if(active)return;
  const row=db.prepare("SELECT id FROM tm2_design_runs WHERE state='queued' ORDER BY created_at LIMIT 1").get() as {id:string}|undefined;
  if(row){activeId=row.id;active=service.process(row.id).catch(()=>{app.log.error('time-machine executor failed; durable run retained');}).finally(()=>{active=null;activeId=null;});}
 };
 const timer=setInterval(tick,2000);timer.unref();app.addHook('onClose',async()=>{closed=true;clearInterval(timer);if(active)await active;});
 app.get<{Params:{bookId:string}}>('/api/time-machine/books/:bookId/synopsis',async request=>success(synopses.state(scope(request,request.params.bookId)),request.id));
 app.post<{Params:{bookId:string};Body:{requestKey:string}}>('/api/time-machine/books/:bookId/synopsis/generate',async request=>{
  if(typeof request.body?.requestKey!=='string')throw new DomainError(errorCodes.validation,'操作编号无效');
  return success(await synopses.generate(scope(request,request.params.bookId),request.body.requestKey),request.id);
 });
 app.put<{Params:{bookId:string};Body:Parameters<BookSynopsisService['save']>[1]}>('/api/time-machine/books/:bookId/synopsis',async request=>success(synopses.save(scope(request,request.params.bookId),request.body??{}),request.id));
 app.get<{Params:{bookId:string}}>('/api/time-machine/books/:bookId/state',async request=>{
  const s=scope(request,request.params.bookId);
  const adopted=(()=>{
   try{
    const plans=new SqlPlanRepository(db);const manifest=plans.state(s);
    if(!manifest.adoption)return null;
    const active=plans.activePlan(s);if(!active)return null;
    const mapping=active.adoption.mapping;
    if(active.candidate.schemaVersion!==2)return {revision:active.adoption.revision,member:{id:active.candidate.member.id,name:active.candidate.member.name},plan:active.candidate.plan,numbering:null};
    return {revision:active.adoption.revision,member:{id:active.candidate.member.id,name:active.candidate.member.name},plan:active.candidate.plan,numbering:{volumes:active.candidate.plan.volumes.map(v=>({localId:v.id,code:volumeDisplayCode(mapping[`volume:${v.id}`]!.number)})),mainLines:active.candidate.plan.lines.filter(l=>l.role==='main').map(l=>lineDisplayCode('main',mapping[`main-line:${l.id}`]!.number)),branchLines:active.candidate.plan.lines.filter(l=>l.role!=='main').map(l=>lineDisplayCode('branch',mapping[`branch-line:${l.id}`]!.number))}};
   }catch{return null;}
  })();
  let planRevision=0;
  try{planRevision=new SqlPlanRepository(db).state(s).revision;}catch{planRevision=0;}
  const preparation=prerequisite(s);
  return success({enabled:windowTokens>=16000,preparation,runs:preparation.ready?currentRuns(s):[],adopted,planRevision},request.id);
 });
 app.get<{Params:{bookId:string;volumeId:string}}>('/api/time-machine/books/:bookId/volumes/:volumeId/planning-context',async request=>{
  const s=scope(request,request.params.bookId);
  return success(guard(()=>{
   const row=db.prepare('SELECT r.snapshot_json FROM tm2_books b JOIN tm2_adoptions a ON a.owner=b.owner AND a.book=b.book AND a.id=b.adoption JOIN tm2_design_runs r ON r.owner_id=a.owner AND r.book_id=a.book AND r.id=a.candidate WHERE b.owner=? AND b.book=?').get(s.ownerId,s.bookId) as {snapshot_json:string}|undefined;
   if(!row)throw new Conflict('请先采用全书方案');
   const snapshot=JSON.parse(row.snapshot_json) as {intent:string};const plans=new SqlPlanRepository(db);
   plans.syncManifest(s,snapshotTimeMachine(db,s,snapshot.intent,windowTokens).manifest);
   const active=plans.activePlan(s);if(!active)throw new Conflict('请先采用全书方案');
   return volumePlanningContext(active.candidate,active.adoption,request.params.volumeId,{id:'utf8-upper-bound',mode:'conservative',count:text=>Buffer.byteLength(text,'utf8')},Math.min(16000,Math.floor(windowTokens/2)));
  }),request.id);
 });
 app.post<{Params:{bookId:string};Body:{intent?:unknown;idempotencyKey?:unknown}}>('/api/time-machine/books/:bookId/recommendation-runs',async(request,reply)=>{
  const s=scope(request,request.params.bookId);const body=request.body??{};
  requirePrepared(s);
  if(typeof body.idempotencyKey!=='string'||(body.intent!==undefined&&typeof body.intent!=='string'))throw new DomainError(errorCodes.validation,'提交格式不正确',{},false,400);
  const id=guard(()=>service.start(s,'recommend',String(body.intent??''),body.idempotencyKey as string));
  const run=service.state(s).find(item=>item.id===id);reply.code(run?.state==='queued'||run?.state==='working'?202:200);return success({id,state:run?.state??'unknown'},request.id);
 });
 // 一轮设计同时建立A/B/C三套方案：独立编剧、独立状态与失败恢复（第23.12节阶段二）。
 app.post<{Params:{bookId:string};Body:{intent?:unknown;idempotencyKey?:unknown}}>('/api/time-machine/books/:bookId/design-runs',async(request,reply)=>{
  const s=scope(request,request.params.bookId);const body=request.body??{};
  requirePrepared(s);
  if(typeof body.idempotencyKey!=='string'||(body.intent!==undefined&&typeof body.intent!=='string'))throw new DomainError(errorCodes.validation,'提交格式不正确',{},false,400);
  const created=guard(()=>service.startDesignRound(s,String(body.intent??''),body.idempotencyKey as string));
  const states=service.state(s);const runs=created.map(item=>({id:item.id,scheme:item.scheme,state:states.find(row=>row.id===item.id)?.state??'unknown'}));
  reply.code(runs.some(run=>run.state==='queued'||run.state==='working')?202:200);return success({runs},request.id);
 });
 app.post<{Params:{bookId:string;id:string}}>('/api/time-machine/books/:bookId/runs/:id/retry',async request=>{const s=scope(request,request.params.bookId);requirePrepared(s);const id=guard(()=>service.retry(s,request.params.id));return success({id},request.id);});
 // 作者人工修改：原候选修订保留，人工修订成为新修订；不自动覆盖、不改变审查结论归属（第22.7节）。
 app.post<{Params:{bookId:string;candidateId:string};Body:{plan?:unknown;expectedRevision?:unknown}}>('/api/time-machine/books/:bookId/candidates/:candidateId/revisions',async request=>{
  const s=scope(request,request.params.bookId),body=request.body??{};
  requirePrepared(s);
  const expectedRevision=body?.expectedRevision;
  if(!body||typeof body.plan!=='object'||body.plan===null||typeof expectedRevision!=='number'||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new DomainError(errorCodes.validation,'修订参数不正确',{},false,400);
  const row=db.prepare("SELECT snapshot_json,result_json FROM tm2_design_runs WHERE id=? AND owner_id=? AND book_id=? AND state='succeeded'").get(request.params.candidateId,s.ownerId,s.bookId) as {snapshot_json:string;result_json:string|null}|undefined;
  if(!row)throw new DomainError(errorCodes.validation,'候选不存在',{},false,404);
  return success(guard(()=>{const snapshot=JSON.parse(row.snapshot_json) as {manifest:unknown;members:{writer:V7EffectiveMember}};const prior=row.result_json!==null?JSON.parse(row.result_json) as {member?:{id:string;name:string};review?:{suggestions?:string[]};selfCheck?:unknown}:null;const candidate=parseCandidate({schemaVersion:2,manifest:snapshot.manifest,member:{id:snapshot.members.writer.memberKey,name:snapshot.members.writer.displayName,model:snapshot.members.writer.model.modelId,routeRevision:String(snapshot.members.writer.governanceRevision)},plan:body.plan});const plans=new SqlPlanRepository(db);const revision=plans.saveCandidate(s,request.params.candidateId,expectedRevision,candidate);
   // 保存不等于审查通过：复用持久化执行器核对这一修订，旧审查仍归属旧修订。
   const result={candidateId:request.params.candidateId,revision,member:prior?.member??{id:snapshot.members.writer.memberKey,name:snapshot.members.writer.displayName},plan:candidate.plan,review:{pass:false,pending:true,issues:[],suggestions:[]},selfCheck:null,editedBy:'author'};
   db.prepare("UPDATE tm2_design_runs SET result_json=?,state='queued',phase='review-author',error_code=NULL,error_message=NULL,updated_at=? WHERE id=? AND owner_id=? AND book_id=?").run(JSON.stringify(result),new Date().toISOString(),request.params.candidateId,s.ownerId,s.bookId);
   return {revision};}),request.id);
 });
 app.post<{Params:{bookId:string};Body:{candidateId:string;revision:number;expectedRevision:number;idempotencyKey:string}}>('/api/time-machine/books/:bookId/adoptions',async request=>{
  const s=scope(request,request.params.bookId),body=request.body;
  requirePrepared(s);
  if(!body||typeof body.candidateId!=='string'||!Number.isSafeInteger(body.revision)||!Number.isSafeInteger(body.expectedRevision)||typeof body.idempotencyKey!=='string')throw new DomainError(errorCodes.validation,'采用参数不正确',{},false,400);
  const row=db.prepare("SELECT snapshot_json FROM tm2_design_runs WHERE id=? AND owner_id=? AND book_id=? AND state='succeeded'").get(body.candidateId,s.ownerId,s.bookId) as {snapshot_json:string}|undefined;
  if(!row)throw new DomainError(errorCodes.validation,'候选尚未完成',{},false,409);
  return success(guard(()=>{const snapshot=JSON.parse(row.snapshot_json) as {intent:string};const current=snapshotTimeMachine(db,s,snapshot.intent,windowTokens);const plans=new SqlPlanRepository(db);plans.syncManifest(s,current.manifest);return plans.adopt(s,body.candidateId,body.revision,body.expectedRevision,body.idempotencyKey);}),request.id);
 });
}
