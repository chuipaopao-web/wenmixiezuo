import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const stable=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export function applyRefinement(plan,p,{apply=false,now=new Date().toISOString()}={}){
 if(plan.batch!=='r209-c3'||plan.entries.length!==349||plan.additions.length!==12)throw Error('内容合同不符');
 const preview=Symbol('preview');let result;
 try{p.repository.runInTransaction(()=>{
  const codes=new Map(),cards=new Map();
  if(plan.codeSources?.length!==354)throw Error('编号来源缺失');
  for(const e of plan.codeSources){const c=p.repository.findByIdempotencyKey('method',e.identity);if(!c)throw Error('编号来源不存在');codes.set(`法${String(e.number).padStart(3,'0')}`,c.displayCode);}
  for(const e of plan.entries){if(cards.has(e.identity))throw Error('重复来源');const c=p.repository.findByIdempotencyKey('method',e.identity);if(!c)throw Error('缺少来源 '+e.identity);cards.set(e.identity,c);codes.set(`法${String(e.number).padStart(3,'0')}`,c.displayCode);}
  // 已合并来源号只作为别名，不重新分配；主目标已在上面映射。
  const remap=v=>typeof v==='string'?v.replace(/法\d{3,}/gu,s=>codes.get(s)??s):Array.isArray(v)?v.map(remap):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,remap(x)])):v;
  let changed=0,replayed=0,added=0;
  for(const e of plan.entries){const c=cards.get(e.identity),r=p.repository.getRevision(c.internalId,c.currentRevision),payload=remap(e.payload);p.validatePayload(payload);
   if(stable(r.payload)===stable(payload)){replayed++;continue;}
   if(c.availability!=='draft'||r.revision!==e.expectedRevision||stable(r.payload)!==stable(remap(e.expectedPayload)))throw Error('已人工编辑，拒绝覆盖 '+c.displayCode);
   p.adminService.updateCardWithAudit({internalId:c.internalId,expectedRevision:r.revision,payload},p.actor,now);changed++;
  }
  for(const a of plan.additions){p.validatePayload(a.payload);const r=p.adminService.createCardWithAudit({payload:a.payload,idempotencyKey:a.identity,legacy:{namespace:'r209-c3',key:a.identity.split('/')[1],version:1}},p.actor,now);if(!r.replayed)added++;}
  result={apply,changed,replayed,added};if(!apply)throw preview;
 });}catch(e){if(e!==preview)throw e;}return result;
}
async function main(){const [root,path,file,hash,mode]=process.argv.slice(2);if(!root||!path||!file||!hash||!['preview','apply'].includes(mode))throw Error('需要root db plan hash preview|apply');const raw=readFileSync(file);if(createHash('sha256').update(raw).digest('hex')!==hash||!statSync(path).isFile())throw Error('输入校验失败');const load=s=>import(pathToFileURL(resolve(root,'apps/api/dist',s)).href);
 const [{SqliteCreativeReferenceRepository},{CreativeReferenceAdminRepository},{CreativeReferenceAdminService},{validatePayload}]=await Promise.all([load('infrastructure/db/repositories/creative-reference-repository.js'),load('infrastructure/db/repositories/creative-reference-admin-repository.js'),load('application/creative-reference/admin-service.js'),load('application/creative-reference/validation.js')]);
 const db=new DatabaseSync(path);try{db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');const repository=new SqliteCreativeReferenceRepository(db),actor={role:'manager',actorId:'codex-r209-c3'},adminService=new CreativeReferenceAdminService(repository,new CreativeReferenceAdminRepository(db),{canManage:a=>a.actorId===actor.actorId});console.log(JSON.stringify(applyRefinement(JSON.parse(raw.toString()),{repository,adminService,validatePayload,actor},{apply:mode==='apply'})));}finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
