import { describe,it,expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteCreativeReferenceRepository } from '../../apps/api/src/infrastructure/db/repositories/creative-reference-repository.js';
import { CreativeReferenceAdminRepository } from '../../apps/api/src/infrastructure/db/repositories/creative-reference-admin-repository.js';
import { CreativeReferenceAdminService } from '../../apps/api/src/application/creative-reference/admin-service.js';
import { validatePayload } from '../../apps/api/src/application/creative-reference/validation.js';
import { editorialSeeds,genreRows } from '../../scripts/creative-library/editorial-seeds.js';
// @ts-expect-error standalone operational JS is exercised against the real repository below
import { importSeed } from '../../scripts/creative-library/import-seed.mjs';

function fixture(run:(ports:any,db:DatabaseSync)=>void){
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=ON;');
  for(const f of ['0122_creative_reference.sql','0123_creative_reference_admin_audit.sql'])db.exec(readFileSync(resolve('apps/api/src/infrastructure/db/migrations',f),'utf8'));
  const repository=new SqliteCreativeReferenceRepository(db),audit=new CreativeReferenceAdminRepository(db),actor={role:'manager' as const,actorId:'test-operator'};
  const adminService=new CreativeReferenceAdminService(repository,audit,{canManage:a=>a.actorId===actor.actorId});
  run({repository,audit,adminService,validatePayload,actor},db);
 }finally{db.close();}
}
const batch=(entries=editorialSeeds)=>({schemaVersion:1,batch:'r209-c1',entries});
const count=(db:DatabaseSync,t:string)=>(db.prepare(`SELECT count(*) n FROM ${t}`).get() as {n:number}).n;
describe('R209-C1 asset import',()=>{
 it('imports the built 542-entry batch and leaves unrelated records untouched',()=>fixture((p,db)=>{
  const all=JSON.parse(readFileSync(resolve('scripts/creative-library/generated/seed.json'),'utf8'));
  expect(all.entries).toHaveLength(542);
  db.exec("CREATE TABLE author_sentinel(id TEXT, body TEXT); INSERT INTO author_sentinel VALUES('new-book','正文不变');");
  const result=importSeed(all,p,{apply:true});expect(result.created).toBe(542);
  expect(count(db,'creative_reference_cards')).toBe(542);
  expect(db.prepare('SELECT * FROM author_sentinel').all()).toEqual([{id:'new-book',body:'正文不变'}]);
  expect(importSeed(all,p,{apply:true}).created).toBe(0);
  const groups=p.repository.listAdmin({assetKind:'reference',usageTree:'题材与融合',limit:100});
  expect(groups.items.length).toBeGreaterThan(0);
 }));
 it('covers 38 distinct genre entry points with actual questions examples and boundaries',()=>{
  expect(genreRows).toHaveLength(38);expect(new Set(genreRows.map(x=>x[1])).size).toBe(38);
  for(const e of editorialSeeds){validatePayload(e.payload);if(e.payload.assetKind==='reference'){
   expect(e.payload.reference.questions.length).toBeGreaterThan(0);
   expect(e.payload.reference.imbalanceChecks.length).toBeGreaterThan(0);
   if(e.payload.reference.kind==='genre')expect(e.payload.reference.examples[0]?.premise.length).toBeGreaterThan(10);
  }}
 });
 it('preview rolls back cards, counters and audits',()=>fixture((p,db)=>{
  expect(importSeed(batch(),p).created).toBe(68);
  expect(count(db,'creative_reference_cards')).toBe(0);
  expect(count(db,'creative_reference_admin_audit')).toBe(0);
  const result=importSeed(batch(),p,{apply:true});expect(result.mappings[0].code).toBe('参001');
 }));
 it('repeat apply keeps numbers and audit count; does not review or publish',()=>fixture((p,db)=>{
  const first=importSeed(batch(),p,{apply:true});const n=count(db,'creative_reference_admin_audit');
  const again=importSeed(batch(),p,{apply:true});expect(again.created).toBe(0);expect(again.replayed).toBe(68);
  expect(again.mappings).toEqual(first.mappings);expect(count(db,'creative_reference_admin_audit')).toBe(n);
  expect(db.prepare("SELECT count(*) n FROM creative_reference_cards WHERE status != 'draft'").get()).toEqual({n:0});
  expect(count(db,'creative_reference_releases')).toBe(0);
 }));
 it('conflicting seed identity rejects whole batch',()=>fixture((p,db)=>{
  importSeed(batch([editorialSeeds[0]!]),p,{apply:true});
  const edited=structuredClone(editorialSeeds[0]!);edited.payload.summary='改变导入内容';
  expect(()=>importSeed(batch([editorialSeeds[1]!,edited]),p,{apply:true})).toThrow();
  expect(count(db,'creative_reference_cards')).toBe(1);
 }));
 it('mid-batch audit failure leaves no cards or audit events',()=>fixture((p,db)=>{
  const record=p.audit.recordAudit.bind(p.audit);let n=0;
  p.audit.recordAudit=(...args:any[])=>{if(++n===4)throw Error('audit failed');return record(...args);};
  expect(()=>importSeed(batch(),p,{apply:true})).toThrow('audit failed');
  expect(count(db,'creative_reference_cards')).toBe(0);expect(count(db,'creative_reference_admin_audit')).toBe(0);
 }));
 it('replay cannot overwrite subsequent editor changes',()=>fixture((p,db)=>{
  const first=importSeed(batch([editorialSeeds[0]!]),p,{apply:true});
  const payload=structuredClone(editorialSeeds[0]!.payload);payload.summary='管理员修改后的内容';
  p.adminService.updateCardWithAudit({internalId:first.mappings[0].id,expectedRevision:1,payload},p.actor,new Date().toISOString());
  importSeed(batch([editorialSeeds[0]!]),p,{apply:true});
  const row=p.repository.getRevision(first.mappings[0].id,2);expect(row.payload.summary).toBe(payload.summary);
  expect(count(db,'creative_reference_revisions')).toBe(2);
 }));
 it('denied operator and duplicate identity cannot write',()=>fixture((p,db)=>{
  expect(()=>importSeed(batch([editorialSeeds[0]!,editorialSeeds[0]!]),p,{apply:true})).toThrow();
  expect(()=>importSeed(batch(),{...p,actor:{role:'manager',actorId:'unauthorized'}},{apply:true})).toThrow();
  expect(count(db,'creative_reference_cards')).toBe(0);
 }));
});
