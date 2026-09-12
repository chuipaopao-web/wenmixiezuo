import {afterEach,describe,it,expect} from 'vitest';
import {createTestContext,type TestContext} from '../../helpers/test-context.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import {TimeMachineModelGateway,type TimeMachineCall} from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import {ModelAdapterError} from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import {accountUsageTotals} from '../../../apps/api/src/infrastructure/security/account-usage-service.js';
const contexts:TestContext[]=[];afterEach(()=>contexts.splice(0).forEach(c=>c.close()));
function setup(){const c=createTestContext();contexts.push(c);const scope={ownerId:c.config.ownerId,bookId:'tm-book'};c.database.prepare('INSERT INTO owners(owner_id,display_name,version,created_at,updated_at) VALUES(?,?,1,?,?)').run(scope.ownerId,'测试作者',new Date().toISOString(),new Date().toISOString());new BookRepository(c.database).create(scope,'测试书',new Date().toISOString(),'active');const request:TimeMachineCall={scope,id:'call-1',memberId:'writer',provider:'test',modelId:'test',prompt:'只返回测试内容',maxOutputTokens:100,windowTokens:64000,temperature:0.5};return {c,request};}
describe('new time machine billing transport',()=>{
 it('counts adapter system and wrapping at the 15000 boundary before dispatch or reservation',async()=>{
  const {c,request}=setup();let calls=0;
  const gateway=new TimeMachineModelGateway(c.database,()=>({provider:'test',modelId:'test',inputContext:({prompt})=>'系统'.repeat(100)+prompt,async generate(){calls++;return {provider:'test',modelId:'test',output:'done',inputTokens:20,outputTokens:10,cashCostCny:0,state:'succeeded'};}}));
  await expect(gateway.generate({...request,prompt:'书'.repeat(14801)})).rejects.toMatchObject({kind:'budget'});
  expect(calls).toBe(0);expect(c.database.prepare('SELECT COUNT(*) AS n FROM tm2_model_calls').get()).toMatchObject({n:0});
  expect(await gateway.generate({...request,prompt:'书'.repeat(14800)})).toBe('done');expect(calls).toBe(1);
  expect(c.database.prepare('SELECT prompt_chars FROM tm2_model_calls').get()).toMatchObject({prompt_chars:15000});
 });
 it('accounts for known consumed tokens even when the generated output is incomplete',async()=>{
  const {c,request}=setup();let calls=0;const gateway=new TimeMachineModelGateway(c.database,()=>({provider:'test',modelId:'test',async generate(){calls++;throw new ModelAdapterError('output incomplete','technical_failure',true,200,false,{inputTokens:80,outputTokens:100,cashCostCny:0});}}));
  await expect(gateway.generate(request)).rejects.toMatchObject({kind:'temporary'});expect(accountUsageTotals(c.database)).toMatchObject({consumedTokens:180,reservedTokens:0,consumedCalls:1});
  await expect(gateway.generate(request)).rejects.toThrow();expect(calls).toBe(1);expect(c.database.prepare('SELECT state FROM tm2_model_calls').get()).toMatchObject({state:'failed'});
 });
 it('reserves before dispatch, charges real usage once, returns saved output',async()=>{const {c,request}=setup();let calls=0;const gateway=new TimeMachineModelGateway(c.database,()=>({provider:'test',modelId:'test',async generate(){calls++;expect(accountUsageTotals(c.database,{ownerId:request.scope.ownerId}).reservedTokens).toBeGreaterThan(0);return {provider:'test',modelId:'test',output:'done',inputTokens:20,outputTokens:10,cashCostCny:0,state:'succeeded'};}}));expect(await gateway.generate(request)).toBe('done');expect(await gateway.generate(request)).toBe('done');expect(calls).toBe(1);expect(accountUsageTotals(c.database,{ownerId:request.scope.ownerId})).toMatchObject({consumedTokens:30,reservedTokens:0,consumedCalls:1});});
 it('unknown result retains reservation and never silently resends',async()=>{const {c,request}=setup();let calls=0;const gateway=new TimeMachineModelGateway(c.database,()=>({provider:'test',modelId:'test',async generate(){calls++;throw new ModelAdapterError('private provider detail','technical_failure',true,undefined,true);}}));await expect(gateway.generate(request)).rejects.toMatchObject({kind:'unknown'});await expect(gateway.generate(request)).rejects.toMatchObject({kind:'unknown'});expect(calls).toBe(1);expect(accountUsageTotals(c.database).reservedTokens).toBeGreaterThan(0);});
 it('rejects mismatched id and foreign book before any dispatch',async()=>{const {c,request}=setup();let calls=0;const gateway=new TimeMachineModelGateway(c.database,()=>{calls++;throw Error('not used');});await expect(gateway.generate({...request,scope:{...request.scope,ownerId:'other'}})).rejects.toThrow('不可访问');expect(calls).toBe(0);await expect(gateway.generate({...request,windowTokens:1})).rejects.toMatchObject({kind:'budget'});expect(calls).toBe(0);});
 it('known authentication failure releases reservation without leaking provider text',async()=>{const {c,request}=setup();const gateway=new TimeMachineModelGateway(c.database,()=>({provider:'test',modelId:'test',async generate(){throw new ModelAdapterError('SECRET','authentication_failure',false,401);}}));await expect(gateway.generate(request)).rejects.toMatchObject({kind:'authentication',message:'本次成员调用未完成，已保留进度'});expect(accountUsageTotals(c.database)).toMatchObject({reservedTokens:0,consumedTokens:0,failedCalls:1});});
});
