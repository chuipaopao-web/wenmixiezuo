import {describe,it,expect} from 'vitest';
import {createTestContext} from '../../helpers/test-context.js';
import {createV7Server} from '../../../apps/api/src/http/v7-server.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
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
});
