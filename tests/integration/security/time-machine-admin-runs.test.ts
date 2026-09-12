import {describe,it,expect} from 'vitest';
import {createTestContext} from '../../helpers/test-context.js';
import {createV7Server} from '../../../apps/api/src/http/v7-server.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';

describe('admin time machine runs endpoint',()=>{
 function seed(c:ReturnType<typeof createTestContext>){
  const ownerId=c.config.ownerId;const scope={ownerId,bookId:'tm-admin-book'};
  c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(ownerId,'测试作者','2026-09-11','2026-09-11');
  new BookRepository(c.database).create(scope,'机甲会修仙','2026-09-11','active');
  const now=new Date().toISOString();
  c.database.prepare('INSERT INTO tm2_books(owner,book,manifest) VALUES(?,?,?)').run(ownerId,scope.bookId,JSON.stringify({sources:[],templateRevision:'t',redactionRevision:'r'}));
  const snapshot={members:{writer:{memberKey:'writer-a',displayName:'红玉',model:{modelId:'deepseek-v4-pro'},governanceRevision:3}},manifest:{},intent:''};
  c.database.prepare("INSERT INTO tm2_design_runs(id,owner_id,book_id,kind,request_key,input_hash,snapshot_json,state,scheme,round_key,phase,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
   .run('run-a',ownerId,scope.bookId,'design','k1','h1',JSON.stringify(snapshot),'succeeded','A','round-1','review-source:0',JSON.stringify({candidateId:'run-a',revision:2,review:{pass:true},editedBy:'author'}),now,now);
  c.database.prepare("INSERT INTO tm2_design_runs(id,owner_id,book_id,kind,request_key,input_hash,snapshot_json,state,scheme,round_key,error_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
   .run('run-b',ownerId,scope.bookId,'design','k2','h2',JSON.stringify(snapshot),'failed','B','round-1','temporary',now,now);
  c.database.prepare("INSERT INTO tm2_steps(owner,book,id,input_hash,member,state) VALUES(?,?,?,?,?,'succeeded')").run(ownerId,scope.bookId,'run-a:review-source:0','x','writer-a');
  c.database.prepare("INSERT INTO tm2_attempts(id,owner,book,step,state,started_at) VALUES(?,?,?,?,'succeeded',?)").run('att-1',ownerId,scope.bookId,'run-a:review-source:0',Date.now());
  c.database.prepare("INSERT INTO tm2_model_calls(id,owner_id,book_id,member_id,provider,model_id,request_hash,state,reserved_tokens,prompt_chars,input_tokens,output_tokens,started_at) VALUES(?,?,?,?,?,?,?,'succeeded',100,12000,60,40,'2026-09-11')")
   .run('att-1',ownerId,scope.bookId,'writer-a','volcengine-ark-coding-plan','deepseek-v4-pro','abc');
  c.database.prepare("INSERT INTO tm2_steps(owner,book,id,input_hash,member,state,error_code) VALUES(?,?,?,?,?,'failed','temporary')").run(ownerId,scope.bookId,'run-b:volumes:0','y','writer-b');
  c.database.prepare("INSERT INTO tm2_attempts(id,owner,book,step,state,started_at) VALUES(?,?,?,?,'failed',?)").run('att-2',ownerId,scope.bookId,'run-b:volumes:0',Date.now());
  c.database.prepare("INSERT INTO tm2_model_calls(id,owner_id,book_id,member_id,provider,model_id,request_hash,state,reserved_tokens,started_at,error_class) VALUES(?,?,?,?,?,?,?,'failed',100,'2026-09-11','technical_failure')")
   .run('att-2',ownerId,scope.bookId,'writer-b','volcengine-ark-coding-plan','glm-5.3','rh2');
  return scope;
 }
 it('requires an administrator and returns redacted run status with usage aggregation',async()=>{
  const c=createTestContext();const app=await createV7Server(c.config,c.database);
  try{
   const headers={host:'127.0.0.1:43111',origin:c.config.webOrigin,'sec-fetch-site':'same-origin','content-type':'application/json'};
   const register=async(email:string)=>{const response=await app.inject({method:'POST',url:'/api/v1/auth/register',headers,payload:{email,displayName:'测试',password:'Strong-test-pass-123!'}});expect(response.statusCode).toBe(200);return String(response.headers['set-cookie']).split(';')[0]!;};
   const adminCookie=await register('tm-admin-1@example.com');
   const userCookie=await register('tm-admin-2@example.com');
   seed(c);
   expect((await app.inject({url:'/api/v1/admin/time-machine/runs',headers})).statusCode).toBe(401);
   expect((await app.inject({url:'/api/v1/admin/time-machine/runs',headers:{...headers,cookie:userCookie}})).statusCode).toBe(403);
   const response=await app.inject({url:'/api/v1/admin/time-machine/runs',headers:{...headers,cookie:adminCookie}});
   expect(response.statusCode).toBe(200);
   const data=response.json().data as {runs:{id:string;state:string;scheme:string|null;roundKey:string|null;writer:string|null;revision:number|null;reviewPass:boolean|null;editedBy:string|null;errorCode:string|null;calls:number;tokens:number;failedCalls:number;maxPromptChars:number|null;bookTitle:string|null;createdAt:string;updatedAt:string}[];totals:{calls:number}};
   const runA=data.runs.find(run=>run.id==='run-a')!;
   expect(runA).toMatchObject({state:'succeeded',scheme:'A',roundKey:'round-1',writer:'红玉',revision:2,reviewPass:true,editedBy:'author',calls:1,tokens:100,failedCalls:0,maxPromptChars:12000,bookTitle:'机甲会修仙'});
   const runB=data.runs.find(run=>run.id==='run-b')!;
   expect(runB).toMatchObject({state:'failed',errorCode:'temporary',calls:1,tokens:0,failedCalls:1});
   expect(data.totals.calls).toBe(2);
   const serialized=JSON.stringify(data);
   expect(serialized).not.toContain('output_text');expect(serialized).not.toContain('prompt');expect(serialized).not.toContain('snapshot');
   const filtered=await app.inject({url:'/api/v1/admin/time-machine/runs?state=failed',headers:{...headers,cookie:adminCookie}});
   const filteredData=filtered.json().data as {runs:{id:string}[]};
   expect(filteredData.runs.map(run=>run.id)).toEqual(['run-b']);
  }finally{await app.close();c.close();}
 });
});
