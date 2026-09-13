import {describe,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {SqliteCreativeReferenceRepository} from '../../apps/api/src/infrastructure/db/repositories/creative-reference-repository.js';
import {CreativeReferenceAdminRepository} from '../../apps/api/src/infrastructure/db/repositories/creative-reference-admin-repository.js';
import {CreativeReferenceAdminService} from '../../apps/api/src/application/creative-reference/admin-service.js';
import {validatePayload} from '../../apps/api/src/application/creative-reference/validation.js';
import {CREATIVE_USAGE_NAV} from '../../coauthoring-v7/admin-console/src/creative-usage-navigation.js';
// @ts-expect-error standalone JS exercised against real repositories
import {importSeed} from '../../scripts/creative-library/import-seed.mjs';
// @ts-expect-error standalone JS exercised against real repositories
import {applyMethodReview} from '../../scripts/creative-library/apply-method-review.mjs';
// @ts-expect-error standalone JS exercised against real repositories
import {applyRefinement} from '../../scripts/creative-library/apply-refinement.mjs';
const read=(name:string)=>JSON.parse(readFileSync('scripts/creative-library/generated/'+name+'.json','utf8'));
const plan=read('refinement');
function fixture(run:(p:any,db:DatabaseSync)=>void,offset=false){const db=new DatabaseSync(':memory:');try{
 db.exec('PRAGMA foreign_keys=ON');for(const f of ['0122_creative_reference.sql','0123_creative_reference_admin_audit.sql'])db.exec(readFileSync('apps/api/src/infrastructure/db/migrations/'+f,'utf8'));
 const repository=new SqliteCreativeReferenceRepository(db),audit=new CreativeReferenceAdminRepository(db),actor={role:'manager',actorId:'test'},adminService=new CreativeReferenceAdminService(repository,audit,{canManage:()=>true}),p={repository,audit,adminService,validatePayload,actor};
 if(offset)adminService.createCardWithAudit({payload:read('seed').entries[0].payload,legacy:null,idempotencyKey:'extra'},actor,new Date().toISOString());
 importSeed(read('seed'),p,{apply:true});applyMethodReview(read('method-review'),p,{apply:true});run(p,db);
}finally{db.close();}}
const count=(db:DatabaseSync,t:string)=>Number(db.prepare('SELECT count(*) n FROM '+t).get()!.n);
describe('C3方法用途与阶段',()=>{
 it('覆盖全部既有方法，每条重点和条件分开，细分类都有实际内容',()=>{
  expect(plan.entries).toHaveLength(349);expect(plan.additions).toHaveLength(12);
  for(const e of [...plan.entries,...plan.additions]){validatePayload(e.payload);expect(e.payload.method.applicableLayers.length).toBeGreaterThan(0);for(const c of e.payload.method.conditionalUses)expect(e.payload.method.applicableLayers).not.toContain(c.stage);}
  for(const g of CREATIVE_USAGE_NAV)for(const child of g.children)expect(plan.coverage[child],child).toBeGreaterThan(0);
 });
 it('两个查询仓储都能按关联用途和重点阶段筛选，同号不重复',()=>fixture((p,db)=>{
  applyRefinement(plan,p,{apply:true});const filter={assetKind:'method',usageTree:'阅读期待',availabilities:['draft'],limit:100};
  const a=p.audit.listSummaries(filter),b=p.repository.listAdmin(filter);expect(a.items.length).toBe(12);expect(b.items.length).toBe(12);expect(new Set(a.items.map((x:any)=>x.internalId)).size).toBe(12);
  expect(p.audit.listSummaries({...filter,layers:['setting']}).items).toHaveLength(0);
  expect(p.audit.listSummaries({...filter,layers:['book']}).items.length).toBeGreaterThan(0);
  expect(p.audit.listSummaries({...filter,usageTree:'事实连续'}).items).toHaveLength(4);
 }));
 it('预览不写，重复执行不写，参考和合并来源不改',()=>fixture((p,db)=>{
  const before=count(db,'creative_reference_revisions');applyRefinement(plan,p);expect(count(db,'creative_reference_revisions')).toBe(before);
  expect(applyRefinement(plan,p,{apply:true})).toMatchObject({changed:349,added:12});const after=count(db,'creative_reference_admin_audit');
  expect(applyRefinement(plan,p,{apply:true})).toMatchObject({changed:0,added:0,replayed:349});expect(count(db,'creative_reference_admin_audit')).toBe(after);
  expect(db.prepare("SELECT count(*) n FROM creative_reference_cards WHERE asset_kind='reference' AND current_revision=1").get()).toEqual({n:196});
  expect(db.prepare("SELECT count(*) n FROM creative_reference_cards WHERE status='retired' AND current_revision=2").get()).toEqual({n:5});
 }));
 it('内容被人工修改后全批回滚',()=>fixture((p,db)=>{
  const e=plan.entries[200],c=p.repository.findByIdempotencyKey('method',e.identity),payload=structuredClone(e.expectedPayload);payload.summary='人工保留修改';p.adminService.updateCardWithAudit({internalId:c.internalId,expectedRevision:c.currentRevision,payload},p.actor,new Date().toISOString());const before=count(db,'creative_reference_revisions');
  expect(()=>applyRefinement(plan,p,{apply:true})).toThrow('拒绝覆盖');expect(count(db,'creative_reference_revisions')).toBe(before);
 }));
 it('非空库合并旧号别名仍正确映射',()=>fixture((p,db)=>{
  applyRefinement(plan,p,{apply:true});const r=p.audit.listSummaries({assetKind:'method',keyword:'法220',availabilities:['draft'],limit:100});expect(r.items.some((x:any)=>x.displayCode==='法052')).toBe(true);
 },true));
 it('拒绝重复阶段、与重点重叠、空条件和未知类型',()=>{
  for(const mutate of [(p:any)=>p.method.conditionalUses.push(p.method.conditionalUses[0]),(p:any)=>p.method.conditionalUses[0].stage=p.method.applicableLayers[0],(p:any)=>p.method.conditionalUses[0].condition='',(p:any)=>p.method.methodKind='unknown']){const p=structuredClone(plan.entries[0].payload);mutate(p);expect(()=>validatePayload(p)).toThrow();}
 });
});
