import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
const [root,path,planPath,reviewPath,mode]=process.argv.slice(2);if(!['preview','apply'].includes(mode))throw Error('需要preview或apply');
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const plan=JSON.parse(readFileSync(planPath,'utf8')),report=JSON.parse(readFileSync(reviewPath,'utf8'));
if(plan.batch!=='r209-c5'||plan.entries.length!==33||plan.additions.length||report.model!=='glm-5.3')throw Error('修订合同不符');
const evidence=[...(report.reused??[]),...report.batches.flatMap(b=>b.state==='done'?b.items:[])];
if(evidence.length!==562||new Set(evidence.map(e=>e.identity)).size!==562||evidence.some(e=>!e.pass||e.issues.length))throw Error('独立审核未全部通过');
const load=p=>import(pathToFileURL(root+'/apps/api/dist/'+p).href);
const [{SqliteCreativeReferenceRepository},{CreativeReferenceAdminRepository},{CreativeReferenceAdminService},{validatePayload}]=await Promise.all([load('infrastructure/db/repositories/creative-reference-repository.js'),load('infrastructure/db/repositories/creative-reference-admin-repository.js'),load('application/creative-reference/admin-service.js'),load('application/creative-reference/validation.js')]);
const db=new DatabaseSync(path),repo=new SqliteCreativeReferenceRepository(db),audit=new CreativeReferenceAdminRepository(db),actor={role:'manager',actorId:'codex-r209-c5'},service=new CreativeReferenceAdminService(repo,audit,{canManage:a=>['codex-r209-c5','glm-5.3:r209-c5'].includes(a.actorId)}),key='r209-c5-'+sha(plan),preview=Symbol();let result;
try{repo.runInTransaction(()=>{
 const active=repo.getActiveRelease();if(!active)throw Error('缺少活动版本');
 const prior=audit.findReleaseRequest(key);
 if(active.releaseId!==plan.expectedReleaseId){if(prior?.releaseId===active.releaseId){result={changed:0,replayed:true,releaseId:active.releaseId};return;}throw Error('活动版本已变化，拒绝覆盖');}
 if(repo.listRelationsInRelease(active.releaseId).length)throw Error('存在关系需同步审核，不能静默丢失');
 for(const edit of plan.entries){const row=db.prepare('SELECT internal_id FROM creative_reference_cards WHERE idempotency_key=?').get(edit.identity);if(!row)throw Error('原卡缺失');const c=repo.findCardByInternalId(row.internal_id),r=repo.getRevision(c.internalId,c.currentRevision);if(c.availability==='retired'||r.revision!==edit.expectedRevision||sha(r.payload)!==sha(edit.expectedPayload))throw Error('原卡已编辑 '+edit.code);validatePayload(edit.payload);service.updateCardWithAudit({internalId:c.internalId,expectedRevision:r.revision,payload:edit.payload},actor,new Date().toISOString());}
 const entries=[];for(const row of db.prepare("SELECT internal_id,idempotency_key identity FROM creative_reference_cards WHERE status<>'retired'").all()){
  const c=repo.findCardByInternalId(row.internal_id),r=repo.getRevision(c.internalId,c.currentRevision),v=evidence.find(e=>e.identity===row.identity);if(!v||v.payloadHash!==sha(r.payload))throw Error('审核内容不符');
  if(r.status==='draft')service.reviewWithOpinion(c.internalId,r.revision,'C5链检查范围审核通过；内容哈希 '+v.payloadHash,{role:'manager',actorId:'glm-5.3:r209-c5'},new Date().toISOString());entries.push({internalId:c.internalId,revision:r.revision});
 }
 if(entries.length!==562)throw Error('全库数量已变化');
 const published=service.publishWithRequestAndAudit({entries,relations:[],expectedActiveReleaseId:active.releaseId,idempotencyKey:key},actor,new Date().toISOString()).release;
 result={changed:33,total:562,releaseId:published.releaseId,mode};if(mode==='preview')throw preview;
});}catch(e){if(e!==preview)throw e;}finally{db.close();}console.log(JSON.stringify(result));
