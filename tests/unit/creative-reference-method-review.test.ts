import {describe,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {SqliteCreativeReferenceRepository} from '../../apps/api/src/infrastructure/db/repositories/creative-reference-repository.js';
import {CreativeReferenceAdminRepository} from '../../apps/api/src/infrastructure/db/repositories/creative-reference-admin-repository.js';
import {CreativeReferenceAdminService} from '../../apps/api/src/application/creative-reference/admin-service.js';
import {validatePayload} from '../../apps/api/src/application/creative-reference/validation.js';
// @ts-expect-error operational JS tested with real SQLite
import {importSeed} from '../../scripts/creative-library/import-seed.mjs';
// @ts-expect-error operational JS tested with real SQLite
import {applyMethodReview} from '../../scripts/creative-library/apply-method-review.mjs';
const seed=JSON.parse(readFileSync('scripts/creative-library/generated/seed.json','utf8'));
const plan=JSON.parse(readFileSync('scripts/creative-library/generated/method-review.json','utf8'));
function fixture(run:(p:any,db:DatabaseSync)=>void){const db=new DatabaseSync(':memory:');try{
 db.exec('PRAGMA foreign_keys=ON');for(const f of ['0122_creative_reference.sql','0123_creative_reference_admin_audit.sql'])db.exec(readFileSync('apps/api/src/infrastructure/db/migrations/'+f,'utf8'));
 const repository=new SqliteCreativeReferenceRepository(db),audit=new CreativeReferenceAdminRepository(db),actor={role:'manager',actorId:'test'},adminService=new CreativeReferenceAdminService(repository,audit,{canManage:()=>true});
 run({repository,audit,adminService,validatePayload,actor},db);
}finally{db.close();}}
const n=(db:DatabaseSync,t:string)=>Number(db.prepare('SELECT count(*) n FROM '+t).get()!.n);
describe('方法统一整理',()=>{
 it('346来源都有阶段、条件和用法，5组同义合并，新增8条',()=>{
  expect(plan.entries).toHaveLength(346);expect(plan.additions).toHaveLength(8);
  expect(plan.entries.filter((e:any)=>e.decision==='merge')).toHaveLength(5);
  for(const e of [...plan.entries,...plan.additions]){validatePayload(e.payload);expect(e.payload.method.applicableLayers.length).toBeGreaterThan(0);expect(e.payload.method.boundary).toContain('使用条件：');}
  expect(plan.entries[342].payload.method.applicableLayers).toEqual(['prose']);
  expect(plan.entries[5].payload.method.usageTree).toBe('群像');
 });
 it('预览全回滚，正式更新保持编号、旧别名、参考卡，重复执行无写入',()=>fixture((p,db)=>{
  importSeed(seed,p,{apply:true});const revisions=n(db,'creative_reference_revisions'),audits=n(db,'creative_reference_admin_audit');
  expect(applyMethodReview(plan,p).added).toBe(8);expect(n(db,'creative_reference_revisions')).toBe(revisions);expect(n(db,'creative_reference_admin_audit')).toBe(audits);
  const first=applyMethodReview(plan,p,{apply:true});expect(first.changed).toBe(346);expect(first.merged).toBe(5);expect(first.added).toBe(8);
  expect(n(db,'creative_reference_cards')).toBe(550);
  expect(db.prepare("SELECT count(*) n FROM creative_reference_cards WHERE asset_kind='method' AND status!='retired'").get()).toEqual({n:349});
  const a=n(db,'creative_reference_admin_audit');const again=applyMethodReview(plan,p,{apply:true});expect(again.changed).toBe(0);expect(again.added).toBe(0);expect(again.merged).toBe(0);expect(n(db,'creative_reference_admin_audit')).toBe(a);
  const target=p.repository.findByIdempotencyKey('method','r209-c1/'+plan.entries[50].seedKey);
  expect(JSON.stringify(p.repository.getRevision(target.internalId,2).payload)).toContain('法219');
  for(const e of seed.entries.filter((x:any)=>x.payload.assetKind==='reference')){const c=p.repository.findByIdempotencyKey('reference','r209-c1/'+e.key);expect(c.currentRevision).toBe(1);expect(p.repository.getRevision(c.internalId,1).payload).toEqual(e.payload);}
 }));
 it('已有管理员修改时整批回滚，不覆盖',()=>fixture((p,db)=>{
  importSeed(seed,p,{apply:true});const e=plan.entries[300],c=p.repository.findByIdempotencyKey('method','r209-c1/'+e.seedKey),payload=structuredClone(e.expectedPayload);payload.summary='管理员最新修订';
  p.adminService.updateCardWithAudit({internalId:c.internalId,expectedRevision:1,payload},p.actor,new Date().toISOString());const before=n(db,'creative_reference_revisions');
  expect(()=>applyMethodReview(plan,p,{apply:true})).toThrow('拒绝覆盖');expect(n(db,'creative_reference_revisions')).toBe(before);
 }));
 it('审计中途失败连同编号和修订回滚',()=>fixture((p,db)=>{
  importSeed(seed,p,{apply:true});const before=n(db,'creative_reference_admin_audit'),record=p.audit.recordAudit.bind(p.audit);let calls=0;
  p.audit.recordAudit=(...args:any[])=>{if(++calls===12)throw Error('audit unavailable');return record(...args);};
  expect(()=>applyMethodReview(plan,p,{apply:true})).toThrow('audit unavailable');expect(n(db,'creative_reference_admin_audit')).toBe(before);expect(n(db,'creative_reference_revisions')).toBe(542);
 }));
 it('非空库按照实际分配编号改写合并引用，不假定法001起始',()=>fixture((p,db)=>{
  p.adminService.createCardWithAudit({payload:seed.entries.find((x:any)=>x.payload.assetKind==='method').payload,legacy:null,idempotencyKey:'other'},p.actor,new Date().toISOString());
  importSeed(seed,p,{apply:true});const result=applyMethodReview(plan,p,{apply:true});expect(result.mappings[0].code).toBe('法002');
  const c=p.repository.findByIdempotencyKey('method','r209-c1/'+plan.entries[218].seedKey);expect(JSON.stringify(p.repository.getRevision(c.internalId,2).payload)).toContain('法052');
 }));
});
