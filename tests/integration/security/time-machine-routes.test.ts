import {describe,it,expect} from 'vitest';
import {createTestContext} from '../../helpers/test-context.js';
import {createV7Server} from '../../../apps/api/src/http/v7-server.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import {SqlPlanRepository} from '@wenmi/time-machine-core';
describe('new time machine session boundary',()=>{
 it('authenticates new prefix, isolates books and enforces browser write origin',async()=>{
  const c=createTestContext();const app=await createV7Server(c.config,c.database);
  try{
   const headers={host:'127.0.0.1:43111',origin:c.config.webOrigin,'sec-fetch-site':'same-origin','content-type':'application/json'};
   const register=async(email:string)=>{const response=await app.inject({method:'POST',url:'/api/v1/auth/register',headers,payload:{email,displayName:'测试',password:'Strong-test-pass-123!'}});expect(response.statusCode).toBe(200);return String(response.headers['set-cookie']).split(';')[0]!;};
   const cookie=await register('tm-a@example.com'),other=await register('tm-b@example.com');const owner=c.database.prepare('SELECT owner_id FROM user_accounts WHERE email_normalized=?').get('tm-a@example.com') as {owner_id:string};new BookRepository(c.database).create({ownerId:owner.owner_id,bookId:'tm-book'},'测试书',new Date().toISOString(),'active');
   expect((await app.inject({url:'/api/time-machine/books/tm-book/state',headers})).statusCode).toBe(401);
   const response=await app.inject({url:'/api/time-machine/books/tm-book/state',headers:{...headers,cookie}});expect(response.statusCode).toBe(200);expect(response.json().data).toEqual({enabled:false,runs:[]});
   expect((await app.inject({url:'/api/time-machine/books/tm-book/state',headers:{...headers,cookie:other}})).statusCode).toBe(404);
   expect((await app.inject({method:'POST',url:'/api/time-machine/books/tm-book/design-runs',headers:{...headers,cookie,origin:'https://evil.example'},payload:{idempotencyKey:'id',intent:''}})).statusCode).toBe(403);
   expect((await app.inject({method:'POST',url:'/api/time-machine/books/tm-book/design-runs',headers:{...headers,cookie},payload:{idempotencyKey:123}})).statusCode).toBe(400);
  }finally{await app.close();c.close();}
 });
 it('saves manual candidate revisions with expectedRevision and keeps old ones',async()=>{
  const c=createTestContext();const app=await createV7Server(c.config,c.database);
  try{
   const headers={host:'127.0.0.1:43111',origin:c.config.webOrigin,'sec-fetch-site':'same-origin','content-type':'application/json'};
   const register=async(email:string)=>{const response=await app.inject({method:'POST',url:'/api/v1/auth/register',headers,payload:{email,displayName:'测试',password:'Strong-test-pass-123!'}});expect(response.statusCode).toBe(200);return String(response.headers['set-cookie']).split(';')[0]!;};
   const cookie=await register('tm-rev@example.com');const owner=c.database.prepare('SELECT owner_id FROM user_accounts WHERE email_normalized=?').get('tm-rev@example.com') as {owner_id:string};
   const scope={ownerId:owner.owner_id,bookId:'tm-rev-book'};new BookRepository(c.database).create(scope,'修订测试书',new Date().toISOString(),'active');
   const now=new Date().toISOString();c.database.prepare('INSERT INTO tm2_books(owner,book,manifest) VALUES(?,?,?)').run(scope.ownerId,scope.bookId,JSON.stringify(sampleV2().manifest));
   const snapshot={members:{writer:{memberKey:'writer-a',displayName:'红玉',model:{modelId:'model-x'},governanceRevision:3}},manifest:sampleV2().manifest,intent:'成长线'};
   c.database.prepare("INSERT INTO tm2_design_runs(id,owner_id,book_id,kind,request_key,input_hash,snapshot_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('cand-1',scope.ownerId,scope.bookId,'design','k','h',JSON.stringify(snapshot),'succeeded',now,now);
   const plan=sampleV2().plan;const repo=new SqlPlanRepository(c.database);
   repo.saveCandidate(scope,'cand-1',0,{schemaVersion:2,manifest:sampleV2().manifest,member:{id:'writer-a',name:'红玉',model:'model-x',routeRevision:'3'},plan});
   const url='/api/time-machine/books/tm-rev-book/candidates/cand-1/revisions';
   const edited=structuredClone(plan);edited.baseline='作者改过的基线';
   const saved=await app.inject({method:'POST',url,headers:{...headers,cookie},payload:{plan:edited,expectedRevision:1}});
   expect(saved.statusCode).toBe(200);expect(saved.json().data).toEqual({revision:2});
   expect((repo.readCandidate(scope,'cand-1',1) as {plan:{baseline:string}}).plan.baseline).not.toBe('作者改过的基线');
   expect((repo.readCandidate(scope,'cand-1',2) as {plan:{baseline:string}}).plan.baseline).toBe('作者改过的基线');
   const stale=await app.inject({method:'POST',url,headers:{...headers,cookie},payload:{plan:edited,expectedRevision:1}});
   expect(stale.statusCode).toBe(409);
   expect((await app.inject({method:'POST',url,headers:{...headers,cookie},payload:{plan:{...edited,volumes:[]},expectedRevision:2}})).statusCode).toBe(409);
   expect((await app.inject({method:'POST',url:'/api/time-machine/books/tm-rev-book/candidates/missing/revisions',headers:{...headers,cookie},payload:{plan:edited,expectedRevision:1}})).statusCode).toBe(404);
   expect((await app.inject({method:'POST',url,headers:{...headers,cookie:await register('tm-rev-2@example.com')},payload:{plan:edited,expectedRevision:1}})).statusCode).toBe(404);
  }finally{await app.close();c.close();}
 });
});
function sampleV2(){return {manifest:{sources:[{kind:'opening',id:'opening',revision:'v1',hash:'a'.repeat(64)},{kind:'intent',id:'intent',revision:'v1',hash:'b'.repeat(64)}],templateRevision:'v1',redactionRevision:'v1'},plan:{baseline:'原基线',ending:'建立工坊',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},lines:[{id:'main',role:'main',title:'工坊',goal:'立足',answer:'建立工坊',process:'从修理到建坊',parentIds:[],milestones:[]}],expectations:[{id:'promise',opening:'无灵根能否立足',answer:'以机甲立足',lineIds:['main']}],relations:[],anchors:[{id:'v1-in',ownerEntityId:'v1',kind:'entry',summary:'店铺濒临倒闭',span:'本卷开篇',conditions:[{summary:'订单危机已经成立',subjectIds:['main']}],logic:'all',importance:'required',fallback:'未达成需修订开场',keywords:[],aliases:[]},{id:'v1-out',ownerEntityId:'v1',kind:'exit',summary:'订单交付工坊立足',span:'本卷收束',conditions:[{summary:'订单交付完成',subjectIds:['main']}],logic:'all',importance:'required',fallback:'全书结束',keywords:[],aliases:[]}],volumes:[{id:'v1',title:'开张',start:'濒临倒闭',goal:'完成订单',conflict:'封锁',turningPoint:'机甲完成',gain:'伙伴',loss:null,arc:null,payoff:null,ending:'工坊建立',handoff:'',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},duties:[{lineId:'main',action:'close',result:'工坊建立',anchorIds:['v1-out'],strength:'required',reason:'主线起点'}]}]}};}
