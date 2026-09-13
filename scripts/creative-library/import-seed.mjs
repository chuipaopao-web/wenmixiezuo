import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

/** No model, HTTP auth bypass, book access, review or publish. Offline operator writes only draft assets. */
export function importSeed(seed, {repository,adminService,validatePayload,actor}, {apply=false,now=new Date().toISOString()}={}) {
 if(seed.schemaVersion!==1 || seed.batch!=='r209-c1' || !Array.isArray(seed.entries) || !seed.entries.length)throw Error('无效种子合同');
 const keys=new Set();
 for(const e of seed.entries){
  if(typeof e.key!=='string'||!/^[a-zA-Z0-9-]+$/.test(e.key)||keys.has(e.key))throw Error('重复或无效种子键');
  keys.add(e.key);
  if(!['editorial-candidate','legacy-unreviewed'].includes(e.review)||typeof e.source!=='string'||!e.source.trim())throw Error('缺少内容来源/待审标记');
  validatePayload(e.payload);
 }
 // One synchronous UoW; dry-run intentionally rolls back creations, counters and audit too.
 const dryRun=Symbol('preview');let result;
 try {repository.runInTransaction(()=>{
  let created=0,replayed=0;const mappings=[];
  for(const e of seed.entries){
   const outcome=adminService.createCardWithAudit({payload:e.payload,legacy:{namespace:'r209-c1',key:e.key,version:1},idempotencyKey:`r209-c1/${e.key}`},actor,now);
   if(outcome.replayed)replayed++;else created++;
   mappings.push({key:e.key,code:outcome.card.displayCode,id:outcome.card.internalId,status:outcome.card.availability});
  }
  result={batch:seed.batch,apply,total:seed.entries.length,created,replayed,mappings};
  if(!apply)throw dryRun;
 });}catch(e){if(e!==dryRun)throw e;}
 return result;
}

async function main(){
 const [rootArg,dbArg,seedArg,expectedHash,mode]=process.argv.slice(2);
 if(!rootArg||!dbArg||!seedArg||!expectedHash||!['preview','apply'].includes(mode))throw Error('用法: node import-seed.mjs <release-source> <db> <seed.json> <sha256> preview|apply');
 const raw=readFileSync(seedArg);if(createHash('sha256').update(raw).digest('hex')!==expectedHash)throw Error('种子哈希不符');
 const root=resolve(rootArg),base=resolve(root,'apps/api/dist');
 const load=p=>import(pathToFileURL(resolve(base,p)).href);
 const [{SqliteCreativeReferenceRepository},{CreativeReferenceAdminRepository},{CreativeReferenceAdminService},{validatePayload}]=await Promise.all([
  load('infrastructure/db/repositories/creative-reference-repository.js'),load('infrastructure/db/repositories/creative-reference-admin-repository.js'),load('application/creative-reference/admin-service.js'),load('application/creative-reference/validation.js')]);
 if(!statSync(resolve(dbArg)).isFile())throw Error('数据库文件不存在');
 const db=new DatabaseSync(resolve(dbArg),{open:true});
 try{
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  // Refuse an uninitialized DB. This command does not run migrations.
  for(const v of ['0122_creative_reference.sql','0123_creative_reference_admin_audit.sql']){
   if(!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(v))throw Error(`缺迁移${v}`);
  }
  const repository=new SqliteCreativeReferenceRepository(db),audit=new CreativeReferenceAdminRepository(db);
  const actor={role:'manager',actorId:'codex-r209-c1-import'};
  const adminService=new CreativeReferenceAdminService(repository,audit,{canManage:a=>a.role==='manager'&&a.actorId===actor.actorId});
  console.log(JSON.stringify(importSeed(JSON.parse(raw.toString('utf8')),{repository,adminService,validatePayload,actor},{apply:mode==='apply'}),null,2));
 }finally{db.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
