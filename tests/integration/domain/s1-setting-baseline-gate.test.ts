import {describe,it,expect,vi} from 'vitest';
import {createTestContext} from '../../helpers/test-context.js';
import {createAppServer} from '../../../apps/api/src/http/app-server.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import {V7SettingEditorialService} from '../../../apps/api/src/application/books/v7-setting-editorial-service.js';
// S1（REBUILD-CLOSEOUT-01）：设定确认→主编总清单→资料/故事线入口的HTTP边界权威性。
// 后端持久化前置条件是权威（非仅前端隐藏按钮）：设定未确认/总清单未完成时
// recommendation-runs 与 design-runs 返回409且携带设定链原因；
// 就绪后同一请求进入参数校验层（400），证明409确来自前置门禁本身。
// 设定确认/总清单/统一整理的状态机已有 v7-setting-editorial-department.test.ts 50项覆盖，
// 本文件只补HTTP边界的显式断言与S1-A结构化确认的入口合同。
describe('S1 persisted setting gate at HTTP boundary',()=>{
  it('recommendation/design entry points reject with setting-chain reason before prerequisite, payload validation only after ready',async()=>{
    const c=createTestContext();const app=await createAppServer(c.config,c.database);
    try{
      const headers={host:'127.0.0.1:43111',origin:c.config.webOrigin,'sec-fetch-site':'same-origin','content-type':'application/json'};
      const register=async(email:string)=>{const response=await app.inject({method:'POST',url:'/api/v1/auth/register',headers,payload:{email,displayName:'测试',password:'Strong-test-pass-123!'}});expect(response.statusCode).toBe(200);return String(response.headers['set-cookie']).split(';')[0]!;};
      const cookie=await register('s1-gate@example.com');
      const owner=c.database.prepare('SELECT owner_id FROM user_accounts WHERE email_normalized=?').get('s1-gate@example.com') as {owner_id:string};
      new BookRepository(c.database).create({ownerId:owner.owner_id,bookId:'s1-book'},'S1链路书',new Date().toISOString(),'active');

      // 状态端点如实暴露 preparation 未就绪
      const state=await app.inject({url:'/api/time-machine/books/s1-book/state',headers:{...headers,cookie}});
      expect(state.statusCode).toBe(200);
      expect((state.json().data as {preparation:{ready:boolean}}).preparation.ready).toBe(false);

      // 未确认：两个入口均被持久化前置条件拒绝（409），消息指向设定链
      for(const url of ['/api/time-machine/books/s1-book/recommendation-runs','/api/time-machine/books/s1-book/design-runs']){
        const rejected=await app.inject({method:'POST',url,headers:{...headers,cookie},payload:{idempotencyKey:'s1-key'}});
        expect(rejected.statusCode).toBe(409);
        const message=String((rejected.json().error as {message?:unknown}).message ?? '');
        expect(message.length).toBeGreaterThan(0);
        expect(['设定','主编','统一整理'].some(word=>message.includes(word))).toBe(true);
      }

      // 对照：前置条件就绪后，同一非法payload进入参数校验（400），证明此前409来自门禁
      const spy=vi.spyOn(V7SettingEditorialService.prototype,'timeMachinePrerequisite').mockReturnValue({ready:true,message:'已确认',version:'v-test'});
      const after=await app.inject({method:'POST',url:'/api/time-machine/books/s1-book/recommendation-runs',headers:{...headers,cookie},payload:{idempotencyKey:123}});
      expect(after.statusCode).toBe(400);
      spy.mockRestore();
    }finally{vi.restoreAllMocks();await app.close();c.close();}
  });

  // S1-A：就绪后design-runs必须携带结构化selection；旧intent-only请求400提示刷新，
  // 不得创建任何任务（合同第1条：不给旧请求继续启动的后门）。
  it('ready design-runs rejects legacy intent-only body with refresh hint and creates zero runs',async()=>{
    const c=createTestContext();const app=await createAppServer(c.config,c.database);
    try{
      const headers={host:'127.0.0.1:43111',origin:c.config.webOrigin,'sec-fetch-site':'same-origin','content-type':'application/json'};
      const register=async(email:string)=>{const response=await app.inject({method:'POST',url:'/api/v1/auth/register',headers,payload:{email,displayName:'测试',password:'Strong-test-pass-123!'}});expect(response.statusCode).toBe(200);return String(response.headers['set-cookie']).split(';')[0]!;};
      const cookie=await register('s1a-legacy@example.com');
      const owner=c.database.prepare('SELECT owner_id FROM user_accounts WHERE email_normalized=?').get('s1a-legacy@example.com') as {owner_id:string};
      new BookRepository(c.database).create({ownerId:owner.owner_id,bookId:'s1a-book'},'S1A书',new Date().toISOString(),'active');
      const spy=vi.spyOn(V7SettingEditorialService.prototype,'timeMachinePrerequisite').mockReturnValue({ready:true,message:'已确认',version:'v-test'});
      // 对照payload相同原则：同一body在门禁就绪后应被请求合同拒绝（400刷新提示），且零任务
      const legacy=await app.inject({method:'POST',url:'/api/time-machine/books/s1a-book/design-runs',headers:{...headers,cookie},payload:{intent:'选择的故事线：主线·成长',idempotencyKey:'legacy-1'}});
      expect(legacy.statusCode).toBe(400);
      expect(String((legacy.json().error as {message?:unknown}).message)).toContain('刷新');
      // 无selection的新式body同样400
      const missing=await app.inject({method:'POST',url:'/api/time-machine/books/s1a-book/design-runs',headers:{...headers,cookie},payload:{idempotencyKey:'legacy-2'}});
      expect(missing.statusCode).toBe(400);
      expect(c.database.prepare('SELECT COUNT(*) AS n FROM tm2_design_runs WHERE book_id=?').get('s1a-book')).toMatchObject({n:0});
      spy.mockRestore();
    }finally{vi.restoreAllMocks();await app.close();c.close();}
  });
});
