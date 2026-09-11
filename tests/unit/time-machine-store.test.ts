import {afterEach,describe,expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {parseCandidate,type CandidateV1} from '../../rebuild/packages/time-machine-core/src/contracts.js';
import {schema,SqlPlanRepository} from '../../rebuild/packages/time-machine-core/src/store.js';
import {volumePlanningContext} from '../../rebuild/packages/time-machine-core/src/volume-context.js';
const scope={ownerId:'alice',bookId:'book'};
function sample():CandidateV1 {return {schemaVersion:1,manifest:{sources:[{kind:'opening',id:'opening',revision:'v1',hash:'a'.repeat(64)},{kind:'intent',id:'intent',revision:'v1',hash:'b'.repeat(64)}],templateRevision:'v1',redactionRevision:'v1'},member:{id:'writer',name:'编剧',model:'model',routeRevision:'route1'},plan:{baseline:'无灵根修理工争取立足',ending:'工坊建立',lines:[{id:'main',role:'main',title:'工坊',goal:'立足',answer:'能否建立工坊',parentIds:[]}],expectations:[{id:'promise',opening:'没有灵根能否立足',answer:'以机甲建立工坊',lineIds:['main']}],relations:[],volumes:[{id:'v1',title:'开张',start:'店铺将倒闭',goal:'完成订单',conflict:'封锁',turningPoint:'新机甲成功',gain:'伙伴',loss:'独占技术',ending:'订单交付',handoff:'',duties:[{lineId:'main',action:'close',result:'工坊成立'}]}]}};}
const databases:DatabaseSync[]=[];
afterEach(()=>{databases.splice(0).forEach(d=>d.close());});
function setup(){const db=new DatabaseSync(':memory:');databases.push(db);db.exec('PRAGMA foreign_keys=ON');db.exec(schema);const repo=new SqlPlanRepository(db);repo.syncManifest(scope,sample().manifest);return {db,repo};}
function ready(repo:SqlPlanRepository){const revision=repo.saveCandidate(scope,'candidate',0,sample());repo.review(scope,'candidate',revision,'reviewer','pass');}
describe('time machine P0 storage contracts',()=>{
 it('supplies only an adopted, fresh volume plan and rejects stale sources or oversize input',()=>{
  const {repo}=setup();expect(repo.activePlan(scope)).toBeNull();ready(repo);repo.adopt(scope,'candidate',1,0,'supply');const active=repo.activePlan(scope)!;
  const counter={id:'utf8',mode:'conservative' as const,count:(s:string)=>Buffer.byteLength(s)};
  const packet=volumePlanningContext(active.candidate,active.adoption,'v1',counter,16000);const body=JSON.parse(packet.input);
  expect(body.sourceRole).toBe('adopted-plan-not-manuscript-fact');expect(body.next).toBeNull();expect(body.lines[0].number).toBe(1);
  expect(()=>volumePlanningContext(active.candidate,active.adoption,'missing',counter,16000)).toThrow('不属于');expect(()=>volumePlanningContext(active.candidate,active.adoption,'v1',counter,10)).toThrow('超预算');
  const changed=sample().manifest;changed.sources[0]!.revision='v2';repo.syncManifest(scope,changed);expect(()=>repo.activePlan(scope)).toThrow('上游');
 });
 it('host migration matches the independently tested schema',()=>{const migration=readFileSync('apps/api/src/infrastructure/db/migrations/0114_time_machine_core.sql','utf8').replace(/^--.*$/gmu,'').trim();expect(migration).toBe(schema.trim());});
 it('rejects unknown enums, fields, missing references, parent cycles and unfinished final volume',()=>{
   const a=sample();expect(()=>parseCandidate({...a,secret:'x'})).toThrow();
   a.plan.lines[0]!.role='alien' as never;expect(()=>parseCandidate(a)).toThrow('枚举');
   const b=sample();b.plan.volumes[0]!.duties[0]!.lineId='missing';expect(()=>parseCandidate(b)).toThrow('引用');
   const c=sample();c.plan.lines[0]!.parentIds=['main'];expect(()=>parseCandidate(c)).toThrow('循环');
   const d=sample();d.plan.volumes[0]!.handoff='接下一卷';expect(()=>parseCandidate(d)).toThrow('最终卷');
 });
 it('allows reciprocal influence without confusing it with containment',()=>{const a=sample();a.plan.lines.push({id:'friend',role:'through',title:'伙伴',goal:'信任',answer:'互相信任',parentIds:[]});a.plan.volumes[0]!.duties.push({lineId:'friend',action:'close',result:'信任'});a.plan.relations=[{from:'main',to:'friend',kind:'push',effect:'共同行动'},{from:'friend',to:'main',kind:'push',effect:'帮助工坊'}];expect(parseCandidate(a).plan.relations).toHaveLength(2);});
 it('keeps revisions immutable and scoped; requires server review',()=>{const {repo}=setup();repo.saveCandidate(scope,'a',0,sample());expect(()=>repo.saveCandidate(scope,'a',0,sample())).toThrow('已被修改');expect(()=>repo.adopt(scope,'a',1,0,'k')).toThrow('核查');const other={...scope,ownerId:'bob'};repo.syncManifest(other,sample().manifest);expect(repo.readCandidate(other,'a',1)).toBeNull();expect(()=>repo.adopt(other,'a',1,0,'k')).toThrow('不存在');});
 it('adopts once, persists numbers and emits exactly one event on replay',()=>{const {db,repo}=setup();ready(repo);const a=repo.adopt(scope,'candidate',1,0,'click');expect(repo.adopt(scope,'candidate',1,0,'click')).toEqual(a);expect(repo.events(scope)).toHaveLength(1);const second=repo.saveCandidate(scope,'candidate',1,sample());repo.review(scope,'candidate',second,'reviewer','pass');const b=repo.adopt(scope,'candidate',2,1,'second');expect(b.mapping).toEqual(a.mapping);expect(()=>repo.adopt(scope,'candidate',2,1,'click')).toThrow('幂等键');repo.acknowledge(scope,repo.events(scope)[0]!.id,'consumer');repo.acknowledge(scope,repo.events(scope)[0]!.id,'consumer');expect(db.prepare('SELECT COUNT(*) n FROM tm2_consumptions').get()).toMatchObject({n:1});});
 it('rejects stale sources but accepts manifest source reordering',()=>{const {repo}=setup();ready(repo);const m=sample().manifest;m.sources.reverse();repo.syncManifest(scope,m);repo.adopt(scope,'candidate',1,0,'one');m.sources[0]!.revision='v2';repo.syncManifest(scope,m);expect(()=>repo.adopt(scope,'candidate',1,1,'two')).toThrow('来源');expect(repo.events(scope)).toHaveLength(1);});
 it('rolls back all writes when outbox insert fails',()=>{const {db,repo}=setup();ready(repo);db.exec("CREATE TRIGGER failure BEFORE INSERT ON tm2_outbox BEGIN SELECT RAISE(ABORT,'injected'); END;");expect(()=>repo.adopt(scope,'candidate',1,0,'click')).toThrow('injected');expect(repo.state(scope)).toEqual({revision:0,adoption:null});for(const t of ['tm2_numbers','tm2_adoptions','tm2_operations'])expect(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toMatchObject({n:0});});
 it('uses book-local namespaces and prevents cross-book consumption',()=>{const {repo}=setup();ready(repo);repo.adopt(scope,'candidate',1,0,'one');const other={...scope,bookId:'other'};repo.syncManifest(other,sample().manifest);expect(repo.events(other)).toEqual([]);expect(()=>repo.acknowledge(other,repo.events(scope)[0]!.id,'consumer')).toThrow('不属于');});
 it('rejects a competing stale adoption',()=>{const {repo}=setup();ready(repo);repo.adopt(scope,'candidate',1,0,'one');expect(()=>repo.adopt(scope,'candidate',1,0,'two')).toThrow('版本');expect(repo.events(scope)).toHaveLength(1);});
});
