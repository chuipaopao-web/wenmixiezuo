import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export function applyMethodReview(plan,p,{apply=false,now=new Date().toISOString()}={}){
 if(plan.batch!=='r209-c2-methods'||plan.entries.length!==346||plan.additions.length!==8)throw Error('复核合同不符');
 const preview=Symbol('preview');let result;
 try{p.repository.runInTransaction(()=>{
  const cards=new Map();const codes=new Map();
  for(const [i,e] of plan.entries.entries()){
   if(cards.has(e.seedKey))throw Error('重复来源');
   const card=p.repository.findByIdempotencyKey('method',`r209-c1/${e.seedKey}`);if(!card)throw Error('缺少C1来源 '+e.seedKey);
   cards.set(e.seedKey,card);codes.set(`法${String(i+1).padStart(3,'0')}`,card.displayCode);
  }
  const remap=v=>typeof v==='string'?v.replace(/法\d{3,}/gu,s=>codes.get(s)??s):Array.isArray(v)?v.map(remap):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,remap(x)])):v;
  let changed=0,replayed=0,merged=0,added=0;const mappings=[];
  for(const e of plan.entries){
   const card=cards.get(e.seedKey),current=p.repository.getRevision(card.internalId,card.currentRevision),payload=remap(e.payload);
   p.validatePayload(payload);
   if(!payload.method.applicableLayers.length||!payload.method.boundary.includes('使用条件：'))throw Error('缺少阶段或用法');
   if(e.decision==='merge'&&(!cards.has(e.mergeTargetSeedKey)||plan.entries.find(x=>x.seedKey===e.mergeTargetSeedKey).decision==='merge'))throw Error('合并目标无效');
   if(stable(current.payload)===stable(payload)){
    if(e.decision==='merge'&&card.availability!=='retired')throw Error('合并条目状态已人工修改，拒绝覆盖 '+card.displayCode);
    replayed++;
   }
   else{
    if(card.availability!=='draft'||current.revision!==e.expectedRevision||stable(current.payload)!==stable(e.expectedPayload))throw Error('后台已编辑，拒绝覆盖 '+card.displayCode);
    p.adminService.updateCardWithAudit({internalId:card.internalId,expectedRevision:current.revision,payload},p.actor,now);changed++;
   }
   const latest=p.repository.findCardByInternalId(card.internalId);
   if(e.decision==='merge'&&latest.availability!=='retired'){
    p.adminService.setAvailabilityWithAudit({internalId:card.internalId,action:'retire',seenAvailability:latest.availability,seenRevision:latest.currentRevision,reason:e.reason},p.actor,now);merged++;
   }
   mappings.push({key:e.seedKey,code:card.displayCode,mergedInto:e.mergeTargetSeedKey?cards.get(e.mergeTargetSeedKey).displayCode:null});
  }
  for(const a of plan.additions){p.validatePayload(a.payload);const r=p.adminService.createCardWithAudit({payload:a.payload,legacy:{namespace:'r209-c2',key:a.key,version:1},idempotencyKey:`r209-c2/${a.key}`},p.actor,now);if(!r.replayed)added++;mappings.push({key:a.key,code:r.card.displayCode,mergedInto:null});}
  result={apply,changed,replayed,merged,added,mappings};if(!apply)throw preview;
 });}catch(e){if(e!==preview)throw e;}
 return result;
}
async function main(){
 const [root,path,file,hash,mode]=process.argv.slice(2);if(!root||!path||!file||!hash||!['preview','apply'].includes(mode))throw Error('需要root db plan hash preview|apply');
 const raw=readFileSync(file);if(createHash('sha256').update(raw).digest('hex')!==hash)throw Error('hash不符');if(!statSync(path).isFile())throw Error('数据库不存在');
 const load=s=>import(pathToFileURL(resolve(root,'apps/api/dist',s)).href);
 const [{SqliteCreativeReferenceRepository},{CreativeReferenceAdminRepository},{CreativeReferenceAdminService},{validatePayload}]=await Promise.all([load('infrastructure/db/repositories/creative-reference-repository.js'),load('infrastructure/db/repositories/creative-reference-admin-repository.js'),load('application/creative-reference/admin-service.js'),load('application/creative-reference/validation.js')]);
 const db=new DatabaseSync(path);try{db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');const repository=new SqliteCreativeReferenceRepository(db),actor={role:'manager',actorId:'codex-r209-c2-method-review'},adminService=new CreativeReferenceAdminService(repository,new CreativeReferenceAdminRepository(db),{canManage:a=>a.actorId===actor.actorId&&a.role==='manager'});console.log(JSON.stringify(applyMethodReview(JSON.parse(raw.toString()),{repository,adminService,validatePayload,actor},{apply:mode==='apply'}),null,2));}finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
