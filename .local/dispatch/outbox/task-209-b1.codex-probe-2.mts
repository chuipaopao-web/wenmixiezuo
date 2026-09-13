import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const root='file:///D:/wenmixiezuo/.local/dispatch/worktrees/task-209-b1/';
const {SqliteCreativeReferenceRepository:Repo}=await import(root+'apps/api/src/infrastructure/db/repositories/creative-reference-repository.ts');
const {CreativeReferenceService:Service}=await import(root+'apps/api/src/application/creative-reference/service.ts');
const {methodPayload}=await import(root+'tests/fixtures/creative-reference/samples.ts');
const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL(root+'apps/api/src/infrastructure/db/migrations/0122_creative_reference.sql'),'utf8'));
const repo=new Repo(db), svc=new Service(repo,{canManage:()=>true,canReadAsMember:()=>true});
const mgr={role:'manager',actorId:'audit'},now='2026-09-13T00:00:00Z';
async function card(key){const c=await svc.createCard({payload:methodPayload(),legacy:null,idempotencyKey:key},mgr,now);await svc.reviewRevision(c.internalId,1,{role:'manager',actorId:'reviewer'},now);return c;}
const a=await card('a'),b=await card('b'),c=await card('c');
const en=x=>({internalId:x.internalId,revision:1});
const rel={fromId:a.internalId,fromRevision:1,toId:b.internalId,toRevision:1,relationType:'supplement'};
const r1=await svc.publish([en(a),en(b)],[rel],mgr,now);
try{await svc.publish([en(a),en(b),en(c)],[rel],mgr,now);console.log('reuse-relation','accepted');}catch(e){console.log('reuse-relation-error',e.message);}
try{await svc.publish([en(a),en(b),en(c)],[{...rel,fromRevision:999}],mgr,now);console.log('nonexistent-revision-relation','ACCEPTED');}catch(e){console.log('nonexistent-revision-relation','rejected',e.message);}
await svc.setAvailability(a.internalId,'retired',mgr,now);
try{await svc.publish([en(a)],[],mgr,now);console.log('retired-republish','ACCEPTED',(await repo.findCardByInternalId(a.internalId)).availability);}catch(e){console.log('retired-republish','rejected',e.message);}
const denied=new Service(repo,{canManage:()=>false,canReadAsMember:()=>false});
try{const active=await repo.getActiveRelease();await denied.publishWithStaleActive([en(c)],[],now,active?.releaseId??null);console.log('unauthorized-helper-publish','ACCEPTED');}catch(e){console.log('unauthorized-helper-publish','rejected',e.message);}
const legacy={namespace:'test-view',key:'same'};
await svc.importLegacyMapping([{canonicalInternalId:b.internalId,legacy,payload:methodPayload(),sourceView:'test'}],'map',mgr,now);
const reported=await svc.importLegacyMapping([{canonicalInternalId:c.internalId,legacy,payload:methodPayload(),sourceView:'test'}],'map',mgr,now);
const actual=await svc.adminReadExact({by:'legacy',legacy},{},mgr);
console.log('alias-rebind-reported',reported[0].displayCode,'actual',actual.outcome==='found'?actual.card.displayCode:actual.outcome);
db.close();
