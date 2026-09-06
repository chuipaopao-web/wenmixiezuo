import { expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/v7-server.js';
import { createTestContext } from '../../helpers/test-context.js';
import { DEFAULT_RHYTHM_POLICY } from '@wenmi/v7-backend';
it('共用节奏配置只允许管理员查看、预览和发布，重启后保留版本', async()=>{
 const context=createTestContext('wenmi-rhythm-140-'); const app=await createServer(context.config,context.database);
 const headers={host:'127.0.0.1:43111',origin:'http://127.0.0.1:43110','sec-fetch-site':'same-site'};
 try{
  expect((await app.inject({method:'GET',url:'/api/v1/admin/v7/rhythm-policy',headers})).statusCode).toBe(401);
  const account=await app.inject({method:'POST',url:'/api/v1/auth/register',headers,payload:{email:'rhythm-test@example.com',password:'test-rhythm-140-password',displayName:'测试管理员'}});
  expect(account.statusCode).toBe(200); const cookie=String(account.headers['set-cookie']).split(';')[0]!;
  context.database.prepare("UPDATE user_accounts SET role='user' WHERE email_normalized=?").run('rhythm-test@example.com');
  for(const [method,url] of [['GET',''],['POST','/preview'],['PUT','']] as const){
   const response=await app.inject({method,url:'/api/v1/admin/v7/rhythm-policy'+url,headers:{...headers,cookie},...(method==='GET'?{}:{payload:{policy:DEFAULT_RHYTHM_POLICY,expectedVersion:1}})});
   expect(response.statusCode).toBe(403);
  }
  context.database.prepare("UPDATE user_accounts SET role='admin' WHERE email_normalized=?").run('rhythm-test@example.com');
  const before=await app.inject({method:'GET',url:'/api/v1/admin/v7/rhythm-policy',headers:{...headers,cookie}}); expect(before.statusCode).toBe(200);
  const changed=structuredClone(DEFAULT_RHYTHM_POLICY); changed.cards[0]!.instruction='长期目标贯穿全书，支线通过因果与主线交汇。';
  const result=await app.inject({method:'PUT',url:'/api/v1/admin/v7/rhythm-policy',headers:{...headers,cookie},payload:{policy:changed,expectedVersion:1}});
  expect(result.statusCode).toBe(200); expect(result.json().data.version).toBe(2);
  const conflict=await app.inject({method:'PUT',url:'/api/v1/admin/v7/rhythm-policy',headers:{...headers,cookie},payload:{policy:DEFAULT_RHYTHM_POLICY,expectedVersion:1}}); expect(conflict.statusCode).toBe(409);
  expect(context.database.prepare('SELECT COUNT(*) AS n FROM v7_rhythm_policy_versions').get()?.n).toBe(2);
 }finally{await app.close();context.close();}
});
