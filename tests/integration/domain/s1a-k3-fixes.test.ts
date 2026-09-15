import {describe,it,expect,afterEach} from 'vitest';
import {createTestContext,type TestContext} from '../../helpers/test-context.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import {TimeMachineDesignService} from '../../../apps/api/src/application/books/time-machine-design-service.js';
import {TimeMachineModelGateway} from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import {StorylineSelectionInput} from '../../../apps/api/src/application/books/storyline-selection.js';
// K3批（14b58cae复核后第一项）反例与回归：
// ① 新volume-card节点初次生成必须携带冻结正式资料短卡与作者要求；
// ② 修订时volume-card携带本卷旧内容及其顶层锚点，不整轮无差别重写；
// ③ 骨架无固定条数上限：至少7条有效选择（含自添线）全部有可核对去向（covers）；
// ④ 覆盖缺失/合并给精确反馈一次局部修复，不静默丢弃作者方向；
// ⑤ keywords/aliases机械归一化保留原始输出并落可审查记录。全部离线夹具，不调用真实模型。
const contexts:TestContext[]=[];
afterEach(()=>contexts.splice(0).forEach(c=>c.close()));
interface Counters{skeletonAttempts:number;seenPrompts:string[]}
type Overrides={
 recommend?:()=>unknown;
 skeleton?:(prompt:string,attempt:number)=>unknown;
 review?:(attempt:number)=>unknown;
 volume?:(briefId:string,lineIds:string[])=>unknown;
};
function lineFor(id:string,role:string,title:string,covers:string[]){return {id,role,title,goal:'目标',answer:'收束',process:'过程方向',parentIds:[],covers,milestones:[{id:`${id}-ms`,summary:'落点',suggestedVolumes:['v1'],importance:'flexible'}]};}
function volumeCardFor(id:string,lineIds:string[],keywords:string[]=[]){return {id,title:id==='v1'?'开张':'扩张',start:'濒临倒闭',goal:'完成订单',conflict:'封锁',beat:'起',turningPoint:'机甲完成',gain:'伙伴',loss:null,arc:null,payoff:null,hook:null,mood:null,ending:'工坊建立',handoff:'',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},anchors:[{id:'in',ownerEntityId:id,kind:'entry',summary:'危机成立',span:'本卷开篇',conditions:[{summary:'订单危机已经成立',subjectIds:[lineIds[0]!]}],logic:'all',importance:'required',fallback:'补开场',keywords,aliases:[]},{id:'out',ownerEntityId:id,kind:'exit',summary:'交付完成',span:'本卷收束',conditions:[{summary:'订单交付完成',subjectIds:[lineIds[0]!]}],logic:'all',importance:'required',fallback:'补收束',keywords:[],aliases:[]}],duties:lineIds.map(lineId=>({lineId,action:'advance',result:'推进',anchorIds:['out'],strength:'flexible',reason:'本卷职责'}))};}
function makeGateway(c:TestContext,overrides:Overrides,counters:Counters){
 return (provider:string,modelId:string)=>({provider,modelId,
  async generate(request:{prompt:string}){
   counters.seenPrompts.push(request.prompt);
   const p=request.prompt;
   if(p.includes('核对短卡是否'))return result(provider,modelId,{pass:true,issues:[]});
   if(p.includes('判断需要哪些方法'))return result(provider,modelId,{action:'ready',selected:[]});
   if(p.includes('你是主编，推荐'))return result(provider,modelId,overrides.recommend?overrides.recommend():{greeting:'老板，推荐如下',lines:[{id:'growth',role:'main',title:'成长线',description:'建立工坊',recommended:true}],structure:'single',reason:'聚焦成长'});
   if(p.includes('设计全书骨架。只设计')){counters.skeletonAttempts++;const value=overrides.skeleton?overrides.skeleton(p,counters.skeletonAttempts):{structure:'四幕起承转合',baseline:'轻快成长',ending:'建立工坊',openingHooks:['开头钩子','第一章钩子','前三章钩子'],words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},lines:[lineFor('main','main','工坊',['成长线'])],expectations:[{id:'promise',opening:'期待',change:'变化',answer:'回应',lineIds:['main']}],relations:[],volumeBriefs:[{id:'v1',title:'开张',goal:'建立工坊',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'}}]};return result(provider,modelId,value);}
   if(p.includes('补全本卷卷卡')){
    const brief=JSON.parse(p.split('\n本卷概要：')[1]!.split('\n前卷交接：')[0].trim()) as {id:string};
    const skeleton=counters.seenPrompts.find(x=>x.includes('设计全书骨架。只设计'))!;
    void skeleton;
    return result(provider,modelId,{volumes:[overrides.volume?overrides.volume(String(brief.id),['main']):volumeCardFor(String(brief.id),['main'])]});
   }
   if(p.includes('自检你刚完成')||p.includes('自检候选锚点'))return result(provider,modelId,{pass:true,issues:[]});
   if(p.includes('核对候选锚点'))return result(provider,modelId,{pass:true,issues:[],suggestions:[]});
   if(p.includes('核对候选骨架'))return result(provider,modelId,overrides.review?overrides.review(1):{action:'verdict',pass:true,issues:[],suggestions:[]});
   return result(provider,modelId,{fields:{premise:[{text:'修理工建立工坊',sourceKeys:['opening:opening:1']}],protagonists:[{text:'林舟',sourceKeys:['opening:opening:1']}],world:[],openingEnding:[],preferences:[],prohibitions:[]}});
  }});
}
function result(provider:string,modelId:string,value:unknown){return {provider,modelId,output:JSON.stringify(value),inputTokens:20,outputTokens:20,cashCostCny:0,state:'succeeded' as const};}
function setup(overrides:Overrides,counters:Counters,bookId:string){
 const c=createTestContext();contexts.push(c);const scope={ownerId:c.config.ownerId,bookId};
 c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId,'K3作者','2026-09-15','2026-09-15');
 new BookRepository(c.database).create(scope,'K3批验证书','2026-09-15','active');
 c.database.prepare("INSERT INTO book_opening_blueprints VALUES('opening',?,?,1,'v1','male','fantasy','玄幻',?,?,'active','2026-09-15')").run(scope.ownerId,scope.bookId,JSON.stringify({protagonists:['林舟'],storyDirection:'无灵根修理工建立工坊'}),'a'.repeat(64));
 const service=new TimeMachineDesignService(c.database,new TimeMachineModelGateway(c.database,makeGateway(c,overrides,counters)),64000);
 (service as unknown as {_prerequisiteReader?:(s:{ownerId:string;bookId:string})=>{ready:boolean;message:string;version:string|null}})._prerequisiteReader=()=>({ready:true,message:'已确认',version:'pv-k3'});
 return {c,scope,service};
}
async function recommend(service:TimeMachineDesignService,scope:{ownerId:string;bookId:string},key:string){const id=service.start(scope,'recommend','',key);await service.process(id);const run=service.state(scope).find(r=>r.id===id);expect(run?.state).toBe('succeeded');return {id:String(run!.id),recommendationHash:run!.recommendationHash??null};}
function selectionFor(run:{id:string;recommendationHash?:string|null},overrides:Partial<StorylineSelectionInput>={}):StorylineSelectionInput{return {recommendationRunId:run.id,recommendationHash:String(run.recommendationHash),preparationVersion:'pv-k3',selectedLineIds:['growth'],addedLines:[],shape:'auto',ensemble:true,authorNote:'希望更热血一点',...overrides};}
describe('K3 batch: volume-card inputs, storyline coverage, normalization audit',()=>{
 it('volume-card initial generation carries the frozen formal card and the author requirements',async()=>{
  const counters:Counters={skeletonAttempts:0,seenPrompts:[]};
  const {scope,service}=setup({},counters,'k3-input-book');
  const rec=await recommend(service,scope,'k3-input-rec');
  const created=service.startDesignRound(scope,selectionFor(rec),'k3-input-round');
  await service.process(created.find(x=>x.scheme==='A')!.id);
  const done=service.state(scope).find(r=>r.id===created.find(x=>x.scheme==='A')!.id)!;
  expect(done.state).toBe('succeeded');
  const volumePrompts=counters.seenPrompts.filter(p=>p.includes('补全本卷卷卡'));
  expect(volumePrompts.length).toBeGreaterThan(0);
  for(const prompt of volumePrompts){
   expect(prompt).toContain('正式资料短卡（原始约束');
   expect(prompt).toContain('修理工建立工坊'); // 冻结短卡内容真实注入
   expect(prompt).toContain('作者选择与要求');
   expect(prompt).toContain('希望更热血一点'); // 作者原文要求真实注入
  }
 });
 it('volume-card revision carries the old version of that volume with its top-level anchors, not the whole plan',async()=>{
  const counters:Counters={skeletonAttempts:0,seenPrompts:[]};
  // 第一次全书审查revise→修订轮；修订后过审
  let reviewCalls=0;
  const {scope,service}=setup({review:()=>{reviewCalls++;return reviewCalls===1?{action:'verdict',pass:false,issues:['卷A开场文字与锚点条件不一致'],suggestions:[]}:{action:'verdict',pass:true,issues:[],suggestions:[]};}},counters,'k3-rev-book');
  const rec=await recommend(service,scope,'k3-rev-rec');
  const created=service.startDesignRound(scope,selectionFor(rec),'k3-rev-round');
  const runId=created.find(x=>x.scheme==='A')!.id;
  await service.process(runId);
  const done=service.state(scope).find(r=>r.id===runId)!;
  expect(done.state).toBe('succeeded');
  const revisionVolumePrompts=counters.seenPrompts.filter(p=>p.includes('补全本卷卷卡')&&p.includes('上轮意见'));
  expect(revisionVolumePrompts.length).toBeGreaterThan(0);
  for(const prompt of revisionVolumePrompts){
   const feedback=JSON.parse(prompt.split('上轮意见（不是作者新增设定）：')[1]!.split('。只修正有问题的内容')[0]!) as {issues:unknown;previousPart:{volume:{id:string;title:string};anchors:{ownerEntityId:string;summary:string}[]}};
   expect(feedback.previousPart.volume.id).toBe('v1'); // 本卷旧内容
   expect(feedback.previousPart.volume.title).toBe('开张');
   expect(feedback.previousPart.anchors).toHaveLength(2); // 本卷顶层锚点（entry+exit）
   for(const anchor of feedback.previousPart.anchors)expect(anchor.ownerEntityId).toBe('v1');
   expect(JSON.stringify(feedback.previousPart)).not.toContain('扩张'); // 不携带无关卷旧内容
  }
 });
 it('seven valid selections (including author-added lines) all get a traceable line, no fixed cap',async()=>{
  const titles=['成长主线','伙伴同行','宿敌对抗','家园重建','秘境探索'];
  const counters:Counters={skeletonAttempts:0,seenPrompts:[]};
  const {scope,service}=setup({
   recommend:()=>({greeting:'老板，推荐如下',lines:titles.map((title,i)=>({id:`l${i+1}`,role:i===0?'main':'through',title,description:`${title}说明`,recommended:i===0})),structure:'multiple',reason:'多线并行'}),
   skeleton:()=>({structure:'四幕起承转合',baseline:'轻快成长',ending:'建立工坊',openingHooks:['开头钩子','第一章钩子','前三章钩子'],words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},
    lines:[...titles.map((title,i)=>lineFor(`line${i+1}`,i===0?'main':'through',`第${i+1}条线`,[title])),lineFor('line6','through','暗线',['自添暗线']),lineFor('line7','through','感情',['自添感情'])],
    expectations:[{id:'promise',opening:'期待',change:'变化',answer:'回应',lineIds:['line1']}],relations:[],volumeBriefs:[{id:'v1',title:'开张',goal:'建立工坊',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'}}]}),
   volume:(briefId)=>volumeCardFor(briefId,['line1','line2','line3','line4','line5','line6','line7']),
  },counters,'k3-seven-book');
  const rec=await recommend(service,scope,'k3-seven-rec');
  const created=service.startDesignRound(scope,selectionFor(rec,{selectedLineIds:['l1','l2','l3','l4','l5'],addedLines:[{title:'自添暗线',description:'隐藏势力'},{title:'自添感情',description:'并肩生情'}]}),'k3-seven-round');
  const runId=created.find(x=>x.scheme==='A')!.id;
  await service.process(runId);
  const done=service.state(scope).find(r=>r.id===runId)!;
  expect(done.state).toBe('succeeded');
  const skeletonPrompt=counters.seenPrompts.find(p=>p.includes('设计全书骨架。只设计'))!;
  expect(skeletonPrompt).toContain('作者已确认的故事线共7条');
  expect(skeletonPrompt).not.toContain('lines≤6');
  for(const title of [...titles,'自添暗线','自添感情'])expect(skeletonPrompt).toContain(title);
  const plan=(done.result as {plan:{lines:{id:string}[]}}).plan;
  expect(plan.lines.length).toBe(7); // 7条作者故事线各有独立去向，未被压缩合并
 });
 it('missing or merged coverage gets one precise repair naming the dropped author lines',async()=>{
  const counters:Counters={skeletonAttempts:0,seenPrompts:[]};
  const full={structure:'四幕起承转合',baseline:'轻快成长',ending:'建立工坊',openingHooks:['开头钩子','第一章钩子','前三章钩子'],words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},
   lines:[lineFor('main','main','工坊',['成长线']),lineFor('rival','through','宿敌',['宿敌线'])],
   expectations:[{id:'promise',opening:'期待',change:'变化',answer:'回应',lineIds:['main']}],relations:[],volumeBriefs:[{id:'v1',title:'开张',goal:'建立工坊',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'}}]};
  const {scope,service}=setup({
   skeleton:(_p,attempt)=>{
    if(attempt===1)return {...full,lines:[{...lineFor('main','main','工坊',['成长线','宿敌线'])}]}; // 合并+覆盖错位：一条线吞掉两条作者线
    return full;
   },
   volume:(briefId)=>volumeCardFor(briefId,['main','rival']),
  },counters,'k3-repair-book');
  const rec=await recommend(service,scope,'k3-repair-rec');
  const created=service.startDesignRound(scope,selectionFor(rec,{addedLines:[{title:'宿敌线',description:'对手改变彼此'}]}),'k3-repair-round');
  const runId=created.find(x=>x.scheme==='A')!.id;
  await service.process(runId);
  const done=service.state(scope).find(r=>r.id===runId)!;
  expect(done.state).toBe('succeeded');
  expect(counters.skeletonAttempts).toBe(2); // 一次精确修复，不静默通过
  const repairPrompt=counters.seenPrompts.filter(p=>p.includes('设计全书骨架。只设计'))[1]!;
  expect(repairPrompt).toContain('上次输出未通过校验');
  expect(repairPrompt).toContain('不得把作者不同方向合并到同一条线');
 });
 it('keywords/aliases trimming keeps the raw step output and writes an auditable normalization record',async()=>{
  const counters:Counters={skeletonAttempts:0,seenPrompts:[]};
  const many=Array.from({length:19},(_,i)=>`检索词${i+1}`);
  const {c,scope,service}=setup({volume:(briefId)=>volumeCardFor(briefId,['main'],many)},counters,'k3-norm-book');
  const rec=await recommend(service,scope,'k3-norm-rec');
  const created=service.startDesignRound(scope,selectionFor(rec),'k3-norm-round');
  const runId=created.find(x=>x.scheme==='A')!.id;
  await service.process(runId);
  const done=service.state(scope).find(r=>r.id===runId)!;
  expect(done.state).toBe('succeeded');
  const events=c.database.prepare("SELECT body FROM tm2_outbox WHERE kind='design.volume-normalization'").all() as {body:string}[];
  expect(events).toHaveLength(1);
  const record0=JSON.parse(events[0]!.body) as {runId:string;items:{node:string;path:string;original:string[];normalized:string[]}[]};
  expect(record0.runId).toBe(runId);
  const keywords=record0.items.find(item=>item.path.endsWith('.keywords'))!;
  expect(keywords.original).toHaveLength(19);
  expect(keywords.normalized).toHaveLength(12);
  // 原始模型输出在步骤记录中逐字保留（含被裁掉的第19个词），归一化只是系统侧合同处理
  const step=c.database.prepare("SELECT output FROM tm2_steps WHERE id=?").get(`${runId}:volume-card:0`) as {output:string};
  expect(step.output).toContain('检索词19');
 });
});
