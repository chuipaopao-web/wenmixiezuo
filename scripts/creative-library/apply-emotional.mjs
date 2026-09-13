import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const sha=s=>createHash('sha256').update(s).digest('hex');
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
/** All edits, reviews and release pointer commit together, or none do. */
export function applyEmotional(plan,report,p,{apply=false,now=new Date().toISOString()}={}){
 if(plan.batch!=='r209-c4'||plan.entries.length!==29||plan.additions.length!==5||report.model!=='glm-5.3')throw Error('内容或审核合同不符');
 const evidence=[...(report.reused??[]),...report.batches.flatMap(b=>b.state==='done'?b.items:[])];
 if(evidence.length!==562||new Set(evidence.map(e=>e.identity)).size!==562||evidence.some(e=>!e.pass||e.issues.length))throw Error('独立审核尚未完整通过');
 const preview=Symbol('preview');let result;
 try{p.repository.runInTransaction(()=>{
  const active=p.repository.getActiveRelease();const identityRows=p.db.prepare("SELECT idempotency_key identity,internal_id FROM creative_reference_cards WHERE status<>'retired'").all();
  const edits=new Map(plan.entries.map(e=>[e.identity,e]));let changed=0,added=0;
  for(const row of identityRows){const edit=edits.get(row.identity);if(!edit)continue;const c=p.repository.findCardByInternalId(row.internal_id),r=p.repository.getRevision(row.internal_id,c.currentRevision);
   if(stable(r.payload)===stable(edit.payload))continue;
   if(c.availability!=='draft'||r.revision!==edit.expectedRevision||stable(r.payload)!==stable(edit.expectedPayload))throw Error('来源已变化，拒绝覆盖 '+c.displayCode);
   p.validatePayload(edit.payload);p.adminService.updateCardWithAudit({internalId:c.internalId,expectedRevision:r.revision,payload:edit.payload},p.actor,now);changed++;
  }
  if(plan.entries.some(e=>!identityRows.some(r=>r.identity===e.identity)))throw Error('缺少修改来源');
  for(const e of plan.additions){p.validatePayload(e.payload);const prior=p.repository.findByIdempotencyKey('method',e.identity);if(prior&&stable(p.repository.getRevision(prior.internalId,prior.currentRevision).payload)!==stable(e.payload))throw Error('新增编号已有其他内容');const out=p.adminService.createCardWithAudit({payload:e.payload,idempotencyKey:e.identity,legacy:{namespace:'r209-c4',key:e.identity.split('/')[1],version:1}},p.actor,now);if(!out.replayed)added++;}
  const rows=p.db.prepare("SELECT idempotency_key identity,internal_id FROM creative_reference_cards WHERE status<>'retired'").all();if(rows.length!==562)throw Error('库条数与审核不符');
  const entries=[];let reviewed=0;
  for(const row of rows){const c=p.repository.findCardByInternalId(row.internal_id),r=p.repository.getRevision(c.internalId,c.currentRevision),v=evidence.find(e=>e.identity===row.identity);
   if(!v||sha(JSON.stringify(r.payload))!==v.payloadHash)throw Error('审核内容哈希不符 '+c.displayCode);
   if(r.status==='draft'){p.adminService.reviewWithOpinion(c.internalId,r.revision,'逐项通过；证据源 '+report.sourceHash+'；内容 '+v.payloadHash,{role:'manager',actorId:'glm-5.3:r209-c4-independent'},now);reviewed++;}
   entries.push({internalId:c.internalId,revision:r.revision});
  }
  let release=active;
  const matches=active&&entries.every(e=>p.repository.getRevisionInRelease(active.releaseId,e.internalId)?.revision===e.revision);
  if(active&&!matches)throw Error('已有其他正式发布版本，拒绝覆盖其条目或关系，请重新核对发布合同');
  if(!matches)release=p.adminService.publishWithRequestAndAudit({entries,relations:[],expectedActiveReleaseId:active?.releaseId??null,idempotencyKey:'r209-c4-'+report.sourceHash},p.actor,now).release;
  result={apply,changed,added,reviewed,total:entries.length,releaseId:release.releaseId};if(!apply)throw preview;
 });}catch(e){if(e!==preview)throw e;}return result;
}
async function main(){const [root,path,file,hash,review,mode]=process.argv.slice(2);if(!root||!path||!file||!hash||!review||!['preview','apply'].includes(mode))throw Error('需要root db plan sha review preview|apply');const raw=readFileSync(file);if(sha(raw)!==hash||!statSync(path).isFile())throw Error('输入校验失败');const load=s=>import(pathToFileURL(resolve(root,'apps/api/dist',s)).href);
 const [{SqliteCreativeReferenceRepository},{CreativeReferenceAdminRepository},{CreativeReferenceAdminService},{validatePayload}]=await Promise.all([load('infrastructure/db/repositories/creative-reference-repository.js'),load('infrastructure/db/repositories/creative-reference-admin-repository.js'),load('application/creative-reference/admin-service.js'),load('application/creative-reference/validation.js')]);
 const db=new DatabaseSync(path);try{db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');const repository=new SqliteCreativeReferenceRepository(db),actor={role:'manager',actorId:'codex-r209-c4'},adminService=new CreativeReferenceAdminService(repository,new CreativeReferenceAdminRepository(db),{canManage:a=>[actor.actorId,'glm-5.3:r209-c4-independent'].includes(a.actorId)});console.log(JSON.stringify(applyEmotional(JSON.parse(raw.toString()),JSON.parse(readFileSync(review,'utf8')),{db,repository,adminService,validatePayload,actor},{apply:mode==='apply'})));}finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
