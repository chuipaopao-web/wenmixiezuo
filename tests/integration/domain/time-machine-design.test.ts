import {afterEach,describe,it,expect} from 'vitest';
import {createTestContext,type TestContext} from '../../helpers/test-context.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import {TimeMachineDesignService} from '../../../apps/api/src/application/books/time-machine-design-service.js';
import {TimeMachineModelGateway} from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import {SqlPlanRepository} from '@wenmi/time-machine-core';
const contexts:TestContext[]=[];afterEach(()=>contexts.splice(0).forEach(c=>c.close()));
function setup(){const c=createTestContext();contexts.push(c);const scope={ownerId:c.config.ownerId,bookId:'tm-book'};c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'测试作者','2026-09-10','2026-09-10');new BookRepository(c.database).create(scope,'机甲会修仙','2026-09-10','active');c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-10')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));return {c,scope};}
function output(prompt:string):unknown{
 if(prompt.includes('核对短卡是否'))return {pass:true,issues:[]};
 if(prompt.includes('判断需要哪些方法'))return prompt.includes('上次工具结果（仅资料）：null')?{action:'search_methods',category:'',cursor:0}:{action:'ready',selected:[]};
 if(prompt.includes('你是主编，推荐'))return {greeting:'老板，我们现在设计全书骨架',lines:[{id:'growth',role:'main',title:'成长线',description:'林舟建立工坊',recommended:true}],structure:'single',reason:'聚焦修理工成长'};
 if(prompt.includes('设计全书骨架。只设计'))return {baseline:'轻快成长',ending:'建立工坊',lines:[{id:'main',role:'main',title:'工坊',goal:'立足',answer:'建立工坊',parentIds:[]}],expectations:[{id:'promise',opening:'无灵根能否立足',answer:'以机甲立足',lineIds:['main']}],relations:[],volumeBriefs:[{id:'v1',title:'开张',goal:'建立工坊'}]};
 if(prompt.includes('补全本批卷卡'))return {volumes:[{id:'v1',title:'开张',start:'濒临倒闭',goal:'完成订单',conflict:'封锁',turningPoint:'机甲完成',gain:'伙伴',loss:'积蓄',ending:'工坊建立',handoff:'',duties:[{lineId:'main',action:'close',result:'工坊建立'}]}]};
 if(prompt.includes('核对候选骨架'))return {pass:true,issues:[]};
 return {fields:{premise:[{text:'修理工建立工坊',sourceKeys:['opening:opening:1']}],protagonists:[{text:'林舟',sourceKeys:['opening:opening:1']}],world:[],openingEnding:[],preferences:[],prohibitions:[]}};
}
describe('new time machine orchestration with real persistence and simulated model',()=>{
 it('corrects source-card omissions once and restarts a known invalid run without erasing it',async()=>{
  const {c,scope}=setup();let audits=0,corrections=0;const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   let value=output(request.prompt);if(request.prompt.includes('核对短卡是否'))value=++audits===1?{pass:false,issues:['缺少主角无灵根限制']}:{pass:true,issues:[]};
   if(request.prompt.includes('根据原文修正本页'))corrections++;
   return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));const service=new TimeMachineDesignService(c.database,gateway,64000);const id=service.start(scope,'recommend','','source-review');await service.process(id);expect(corrections).toBe(1);expect(audits).toBe(2);expect(service.state(scope)[0]).toMatchObject({state:'succeeded'});
  c.database.prepare("UPDATE tm2_design_runs SET state='failed',error_code='needs_review' WHERE id=?").run(id);
  const retried=service.retry(scope,id);expect(retried).not.toBe(id);expect(service.retry(scope,id)).toBe(retried);expect(service.state(scope).find(r=>r.id===id)?.state).toBe('failed');
  c.database.prepare("UPDATE tm2_design_runs SET state='failed',error_code='unknown' WHERE id=?").run(retried);expect(()=>service.retry(scope,retried)).toThrow('不能重复');
 });
 it('preserves rejected revisions, performs only one semantic correction and blocks adoption if issues remain',async()=>{
  const {c,scope}=setup();let reviews=0;const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   const value=request.prompt.includes('核对候选骨架')?(reviews++,{pass:true,issues:['v1转折仍然过于空泛']}):output(request.prompt);
   return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));const service=new TimeMachineDesignService(c.database,gateway,64000);const id=service.start(scope,'design','成长线','review');await service.process(id);
  expect(reviews).toBe(2);expect(service.state(scope).find(r=>r.id===id)).toMatchObject({state:'succeeded',result:{revision:2,review:{pass:false}}});
  const repo=new SqlPlanRepository(c.database);expect(repo.readCandidate(scope,id,1)).not.toBeNull();expect(repo.readCandidate(scope,id,2)).not.toBeNull();expect(()=>repo.adopt(scope,id,2,0,'adopt')).toThrow('核查');
  await service.process(id);expect(reviews).toBe(2);
 });
 it('lets a member read five methods, correct invalid tool parameters and receive author intent',async()=>{
  const {c,scope}=setup();const ids=['a','b','c','d','e'];c.database.prepare('INSERT INTO v7_rhythm_policy_versions VALUES(1,?,?,?)').run(JSON.stringify({cards:ids.map(key=>({key,title:key,instruction:'推进本书冲突',boundary:'用于方向设计',category:'rhythm'}))}),'test','2026-09-10');
  let round=0;const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   let value=output(request.prompt);
   if(request.prompt.includes('判断需要哪些方法')){
    expect(request.prompt).toContain('作者当前选择与补充');expect(request.prompt).toContain('坚持单主线');
    value=[{action:'read_methods',ids:['missing']},{action:'search_methods',category:'',cursor:0},{action:'read_methods',ids},{action:'ready',selected:[{id:'a',application:'用订单危机推进成长'}]}][round++];
    if(round===2)expect(request.prompt).toContain('包含不存在的方法ID');
   }
   return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));const service=new TimeMachineDesignService(c.database,gateway,64000);const id=service.start(scope,'design','坚持单主线','methods');await service.process(id);
  expect(round).toBe(4);expect(service.state(scope).find(r=>r.id===id)).toMatchObject({state:'succeeded'});
 });
 it('reads formal sources, recommends and designs, saves review and adopts without old engine',async()=>{const {c,scope}=setup();let calls=0;const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){calls++;return {provider,modelId,output:JSON.stringify(output(request.prompt)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};}}));const service=new TimeMachineDesignService(c.database,gateway,128000);
  const recommendation=service.start(scope,'recommend','','recommend-1');expect(service.start(scope,'recommend','','recommend-1')).toBe(recommendation);await service.process(recommendation);expect(service.state(scope)[0]).toMatchObject({state:'succeeded'});
  const design=service.start(scope,'design','成长线','design-1');await service.process(design);const row=service.state(scope).find(r=>r.id===design)!;expect(row).toMatchObject({state:'succeeded',result:{review:{pass:true}}});const before=calls;await service.process(design);expect(calls).toBe(before);const adoption=new SqlPlanRepository(c.database).adopt(scope,design,1,0,'adopt-1');expect(adoption.mapping['line:main']!.number).toBe(1);
 });
 it('rejects missing formal sources and overlong author selections',()=>{const {c,scope}=setup();const gateway=new TimeMachineModelGateway(c.database,()=>{throw Error('must not dispatch');});const service=new TimeMachineDesignService(c.database,gateway,128000);expect(()=>service.start(scope,'recommend','x'.repeat(4001),'key')).toThrow('过长');c.database.prepare("UPDATE book_opening_blueprints SET status='superseded'").run();expect(()=>service.start(scope,'recommend','','key')).toThrow('开书');});
});
