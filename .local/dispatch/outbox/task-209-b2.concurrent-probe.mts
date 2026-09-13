import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const imp=(p:string)=>import(pathToFileURL(resolve(process.cwd(),p)).href);
const {createTestContext}=await imp('tests/helpers/test-context.ts');
const {SqliteCreativeReferenceRepository}=await imp('apps/api/src/infrastructure/db/repositories/creative-reference-repository.ts');
const {CreativeReferenceAdminRepository}=await imp('apps/api/src/infrastructure/db/repositories/creative-reference-admin-repository.ts');
const {CreativeReferenceAdminService}=await imp('apps/api/src/application/creative-reference/admin-service.ts');
const c=createTestContext('b2-concurrent-');
try {
 const repo=new SqliteCreativeReferenceRepository(c.database);
 const service=new CreativeReferenceAdminService(repo,new CreativeReferenceAdminRepository(c.database));
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 let entered!:()=>void;const ready=new Promise<void>(r=>entered=r);
 const first=repo.runInImmediateTransaction(async()=>{entered();await gate;throw Error('request A fails');}).catch(()=>{});
 await ready;
 const payload={assetKind:'method',name:'并发测试',shortPhrase:'独立提交',summary:'合成并发请求',aliases:[],method:{title:'并发测试',instruction:'目标过程',boundary:'测试',usageTree:'故事与因果',applicableLayers:['volume'],aliases:[]}};
 const second=await service.createCardWithAudit({payload,legacy:null,idempotencyKey:'request-b'},{actorId:'synthetic-admin'},new Date().toISOString());
 const before=await repo.findCardByInternalId(second.card.internalId);
 release();await first;
 const after=await repo.findCardByInternalId(second.card.internalId);
 console.log(JSON.stringify({secondReturnedSuccess:!!second.card,existsBeforeOtherRollback:!!before,existsAfterOtherRollback:!!after}));
}finally{c.close();}
