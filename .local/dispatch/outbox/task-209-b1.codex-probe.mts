import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const root = 'file:///D:/wenmixiezuo/.local/dispatch/worktrees/task-209-b1/';
const { SqliteCreativeReferenceRepository: Repo } = await import(root+'apps/api/src/infrastructure/db/repositories/creative-reference-repository.ts');
const { CreativeReferenceService: Service } = await import(root+'apps/api/src/application/creative-reference/service.ts');
const { methodPayload } = await import(root+'tests/fixtures/creative-reference/samples.ts');
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL(root+'apps/api/src/infrastructure/db/migrations/0122_creative_reference.sql'),'utf8'));
const service = new Service(new Repo(db), {canManage:()=>true,canReadAsMember:()=>true});
const manager = {role:'manager',actorId:'audit'}, member={role:'member',actorId:'reader'}, now='2026-09-13T00:00:00Z';
const a=await service.createCard({payload:methodPayload(),legacy:null,idempotencyKey:'a'},manager,now);
for(const filter of [{layers:['volume']},{usageTree:'结构与节奏'}]) {
  try {console.log('filter',JSON.stringify(filter),await service.listAdmin(filter,manager));}
  catch(e){console.log('filter-error',JSON.stringify(filter),e.message);}
}
await service.setStatus(a.internalId,'published',manager,now);
const rel=await service.publish([{internalId:a.internalId,revision:1}],[],manager,now);
console.log('before-retire',(await service.memberReadExact({by:'internalId',internalId:a.internalId},rel.releaseId,member)).outcome);
await service.setStatus(a.internalId,'retired',manager,now);
console.log('after-retire',await service.memberReadExact({by:'internalId',internalId:a.internalId},rel.releaseId,member));
const b=await service.createCard({payload:methodPayload(),legacy:null,idempotencyKey:'b'},manager,now);
await service.setStatus(b.internalId,'published',manager,now);
const next=await service.updateCard({internalId:b.internalId,expectedRevision:1,payload:methodPayload({name:'未经审查新版'})},manager,now);
console.log('updated-status',next.status);
console.log('unreviewed-release',(await service.publish([{internalId:b.internalId,revision:2}],[],manager,now)).releaseId);
const aliases=await service.importLegacyMapping([{legacy:{namespace:'audited-v4',key:'four-act'},payload:methodPayload(),sourceView:'audited-v4'},{legacy:{namespace:'complete-v3',key:'four-act'},payload:methodPayload(),sourceView:'complete-v3'}],'mapped',manager,now);
console.log('same-entity-two-codes',aliases.map(x=>x.displayCode));
await service.updateCard({internalId:b.internalId,expectedRevision:2,payload:methodPayload({name:'第三版'})},manager,now);
try { await service.createCard({payload:methodPayload(),legacy:null,idempotencyKey:'b'},manager,now); console.log('create-replay','ok'); }
catch(e){console.log('create-replay-error',e.message);}
db.close();
