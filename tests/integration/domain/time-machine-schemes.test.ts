import {afterEach,describe,it,expect} from 'vitest';
import {createTestContext,type TestContext} from '../../helpers/test-context.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import {TimeMachineDesignService} from '../../../apps/api/src/application/books/time-machine-design-service.js';
import {TimeMachineModelGateway} from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import {ModelAdapterError} from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import {SqlPlanRepository} from '@wenmi/time-machine-core';
const contexts:TestContext[]=[];afterEach(()=>contexts.splice(0).forEach(c=>c.close()));
function setup(){const c=createTestContext();contexts.push(c);const scope={ownerId:c.config.ownerId,bookId:'tm-scheme-book'};c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'测试作者','2026-09-11','2026-09-11');new BookRepository(c.database).create(scope,'机甲会修仙','2026-09-11','active');c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-11')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));return {c,scope};}
function output(prompt:string,modelId:string):unknown{
 if(prompt.includes('核对短卡是否'))return {pass:true,issues:[]};
 if(prompt.includes('判断需要哪些方法'))return prompt.includes('上次工具结果（仅资料）：null')?{action:'search_methods',category:'',cursor:0}:{action:'ready',selected:[]};
 if(prompt.includes('设计全书骨架。只设计'))return {structure:'四幕起承转合',baseline:`轻快成长-${modelId}`,ending:'建立工坊',openingHooks:['开头钩子','第一章钩子','前三章钩子'],words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},lines:[{id:'main',role:'main',title:'工坊',goal:'立足',answer:'建立工坊',process:'从修理接单到建立工坊',parentIds:[],milestones:[]}],expectations:[{id:'promise',opening:'无灵根能否立足',change:'看到变化',answer:'以机甲立足',lineIds:['main']}],relations:[],volumeBriefs:[{id:'v1',title:'开张',goal:'建立工坊',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'}}]};
 if(prompt.includes('补全本批卷卡'))return {volumes:[{id:'v1',title:`开张-${modelId}`,start:'濒临倒闭',goal:'完成订单',conflict:'封锁',beat:'起',turningPoint:'机甲完成',gain:'伙伴',loss:null,arc:null,payoff:null,hook:null,mood:null,ending:'工坊建立',handoff:'',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},anchors:[{id:'v1-in',ownerEntityId:'v1',kind:'entry',summary:'店铺濒临倒闭',span:'本卷开篇',conditions:[{summary:'订单危机已经成立',subjectIds:['main']}],logic:'all',importance:'required',fallback:'未达成需修订开场',keywords:[],aliases:[]},{id:'v1-out',ownerEntityId:'v1',kind:'exit',summary:'订单交付工坊立足',span:'本卷收束',conditions:[{summary:'订单交付完成',subjectIds:['main']}],logic:'all',importance:'required',fallback:'全书结束，未兑现期待单独跟踪',keywords:[],aliases:[]}],duties:[{lineId:'main',action:'close',result:'工坊建立',anchorIds:['v1-out'],strength:'required',reason:'主线起点'}]}]};
 if(prompt.includes('自检你刚完成')||prompt.includes('自检候选锚点'))return {pass:true,issues:[]};
 if(prompt.includes('核对候选锚点'))return {pass:true,issues:[],suggestions:[]};
 if(prompt.includes('核对候选骨架'))return {action:'verdict',pass:true,issues:[],suggestions:[]};
 return {fields:{premise:[{text:'修理工建立工坊',sourceKeys:['opening:opening:1']}],protagonists:[{text:'林舟',sourceKeys:['opening:opening:1']}],world:[],openingEnding:[],preferences:[],prohibitions:[]}};
}
function schemeWriters(c:TestContext,bookId:string){return (c.database.prepare('SELECT scheme,snapshot_json FROM tm2_design_runs WHERE book_id=? ORDER BY scheme').all(bookId) as {scheme:string;snapshot_json:string}[]).map(row=>({scheme:row.scheme,writer:(JSON.parse(row.snapshot_json) as {members:{writer:{memberKey:string;model:{modelId:string}}}}).members.writer}));}
describe('three independent schemes per design round',()=>{
 it('creates A/B/C with distinct writers, idempotent re-click and honest attribution',async()=>{
  const {c,scope}=setup();const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){return {provider,modelId,output:JSON.stringify(output(request.prompt,modelId)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};}}));
  const service=new TimeMachineDesignService(c.database,gateway,64000);
  const created=service.startDesignRound(scope,'成长线','round-1');
  expect(created.map(x=>x.scheme).sort()).toEqual(['A','B','C']);
  expect(service.startDesignRound(scope,'成长线','round-1').map(x=>x.id).sort()).toEqual(created.map(x=>x.id).sort());
  const writers=schemeWriters(c,scope.bookId);
  expect(new Set(writers.map(w=>w.writer.memberKey)).size).toBe(3);
  expect(new Set(writers.map(w=>w.writer.model.modelId)).size).toBe(3);
  expect(()=>service.startDesignRound(scope,'成长线','round-2')).toThrow('已有新时光机任务');
  for(const item of created)await service.process(item.id);
  const states=service.state(scope).filter(row=>row.roundKey==='round-1');
  expect(states.filter(row=>row.state==='succeeded')).toHaveLength(3);
  expect(states.map(row=>row.scheme).sort()).toEqual(['A','B','C']);
  const repo=new SqlPlanRepository(c.database);
  const candidates=created.map(item=>repo.readCandidate(scope,item.id,states.find(row=>row.id===item.id)?.result?.revision??1));
  expect(new Set(candidates.map(candidate=>candidate!.member.id)).size).toBe(3);
  expect(new Set(candidates.map(candidate=>candidate!.plan.volumes[0]!.title)).size).toBe(3);
  const adopted=created.find(item=>item.scheme==='B')!;
  const adoption=repo.adopt(scope,adopted.id,1,0,'adopt-b');
  expect(adoption.mapping['volume:v1']).toMatchObject({number:1});
 });
 it('one scheme failing does not drag the others and recovery keeps attribution',async()=>{
  const {c,scope}=setup();const failModels=new Set<string>();
  const gateway=new TimeMachineModelGateway(c.database,(provider,modelId)=>({provider,modelId,async generate(request){
   if(failModels.has(modelId))throw new ModelAdapterError('供应商暂时不可用','technical_failure',true,500);
   return {provider,modelId,output:JSON.stringify(output(request.prompt,modelId)),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded'};
  }}));
  const service=new TimeMachineDesignService(c.database,gateway,64000);
  const created=service.startDesignRound(scope,'成长线','round-f');
  const writers=schemeWriters(c,scope.bookId);
  const target=writers.find(w=>w.scheme==='C')!;
  failModels.add(target.writer.model.modelId);
  for(const item of created){try{await service.process(item.id);}catch{/* failed run recorded */}}
  const states=service.state(scope).filter(row=>row.roundKey==='round-f');
  expect(states.find(row=>row.scheme==='C')?.state).toBe('failed');
  expect(states.filter(row=>row.state==='succeeded')).toHaveLength(2);
  const repo=new SqlPlanRepository(c.database);
  const adopted=created.find(item=>item.scheme==='A')!;
  expect(repo.readCandidate(scope,adopted.id,1)).not.toBeNull();
  expect(repo.adopt(scope,adopted.id,1,0,'adopt-a').revision).toBe(1);
  failModels.clear();
  const retried=service.retry(scope,created.find(item=>item.scheme==='C')!.id);
  await service.process(retried);
  const recovered=service.state(scope).find(row=>row.id===retried);
  expect(recovered?.state).toBe('succeeded');expect(recovered?.scheme).toBe('C');expect(recovered?.roundKey).toBe('round-f');
  // 同轮兄弟方案重试不互相阻塞；新一轮仍被排队任务挡住。
  const schemeB=created.find(item=>item.scheme==='B')!;
  c.database.prepare("UPDATE tm2_design_runs SET state='failed',error_code='needs_review' WHERE id=?").run(schemeB.id);
  const retriedB=service.retry(scope,schemeB.id);
  expect(service.state(scope).find(row=>row.id===retriedB)?.scheme).toBe('B');
  expect(()=>service.startDesignRound(scope,'成长线','round-blocked')).toThrow('已有新时光机任务');
 });
});
