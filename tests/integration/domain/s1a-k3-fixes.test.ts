import {describe,it,expect,afterEach} from 'vitest';
import {createTestContext,type TestContext} from '../../helpers/test-context.js';
import {BookRepository} from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import {TimeMachineDesignService,timeMachineSynthesisHeadroom} from '../../../apps/api/src/application/books/time-machine-design-service.js';
import {TimeMachineModelGateway} from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import {StorylineSelectionInput} from '../../../apps/api/src/application/books/storyline-selection.js';
// K3批（14b58cae复核后第一项）反例与回归：
// ① 新volume-card节点初次生成必须携带冻结正式资料短卡与作者要求；
// ② 修订时volume-card携带本卷旧内容及其顶层锚点，不整轮无差别重写；
// ③ 骨架无固定条数上限：至少7条有效选择（含自添线）全部有可核对去向（covers）；
// ④ 覆盖缺失/合并给精确反馈一次局部修复，不静默丢弃作者方向；
// ⑤ keywords/aliases机械归一化保留原始输出并落可审查记录；
// ⑥ 审查阻塞问题超单次上限时有界续批收齐（hasMoreIssues），不硬截清单；⑦ 大综合节点推理余量按实测放大。全部离线夹具，不调用真实模型。
const contexts:TestContext[]=[];
afterEach(()=>contexts.splice(0).forEach(c=>c.close()));
interface Counters{skeletonAttempts:number;reviewMoreAttempts:number;seenPrompts:string[]}
type Overrides={
 recommend?:()=>unknown;
 skeleton?:(prompt:string,attempt:number)=>unknown;
 review?:(attempt:number)=>unknown;
 reviewMore?:(attempt:number)=>unknown;
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
   // 局部修订（7662b6f6）：按本卷现行内容的卷id回返该卷修订后完整卷卡
   if(p.includes('修订本卷卷卡')){
    const idMatch=p.match(/本卷现行内容：\{"id":"(v\d+)"/u);
    return result(provider,modelId,{volumes:[volumeCardFor(idMatch?.[1]??'v1',['main'])]});
   }
   if(p.includes('核对候选锚点'))return result(provider,modelId,{pass:true,issues:[],suggestions:[]});
   if(p.includes('只返回尚未报告的其余阻塞问题')){counters.reviewMoreAttempts++;return result(provider,modelId,overrides.reviewMore?overrides.reviewMore(counters.reviewMoreAttempts):{pass:false,issues:[],suggestions:[],hasMoreIssues:false});}
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
  const counters:Counters={skeletonAttempts:0,reviewMoreAttempts:0,seenPrompts:[]};
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
  const counters:Counters={skeletonAttempts:0,reviewMoreAttempts:0,seenPrompts:[]};
  // 第一次全书审查revise→修订轮；修订后过审
  let reviewCalls=0;
  const {scope,service}=setup({review:()=>{reviewCalls++;return reviewCalls===1?{action:'verdict',pass:false,issues:['卷A开场文字与锚点条件不一致'],suggestions:[]}:{action:'verdict',pass:true,issues:[],suggestions:[]};}},counters,'k3-rev-book');
  const rec=await recommend(service,scope,'k3-rev-rec');
  const created=service.startDesignRound(scope,selectionFor(rec),'k3-rev-round');
  const runId=created.find(x=>x.scheme==='A')!.id;
  await service.process(runId);
  const done=service.state(scope).find(r=>r.id===runId)!;
  expect(done.state).toBe('succeeded');
  // 局部修订（7662b6f6）：修订提示携带本卷旧内容+本卷顶层锚点，不携带无关卷
  const revisionVolumePrompts=counters.seenPrompts.filter(p=>p.includes('修订本卷卷卡'));
  expect(revisionVolumePrompts.length).toBeGreaterThan(0);
  for(const prompt of revisionVolumePrompts){
   const current=JSON.parse(prompt.split('本卷现行内容：')[1]!.split('\n本卷顶层锚点：')[0]!) as {id:string;title:string};
   expect(current.id).toBe('v1'); // 本卷旧内容
   expect(current.title).toBe('开张');
   const anchors=JSON.parse(prompt.split('\n本卷顶层锚点：')[1]!.split('\n本卷问题与依据')[0]!) as {ownerEntityId:string;summary:string}[];
   expect(anchors).toHaveLength(2); // 本卷顶层锚点（entry+exit）
   for(const anchor of anchors)expect(anchor.ownerEntityId).toBe('v1');
   expect(prompt).not.toContain('扩张'); // 不携带无关卷旧内容（单卷计划无相邻卷）
  }
 });
 it('seven valid selections (including author-added lines) all get a traceable line, no fixed cap',async()=>{
  const titles=['成长主线','伙伴同行','宿敌对抗','家园重建','秘境探索'];
  const counters:Counters={skeletonAttempts:0,reviewMoreAttempts:0,seenPrompts:[]};
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
  const counters:Counters={skeletonAttempts:0,reviewMoreAttempts:0,seenPrompts:[]};
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
  const counters:Counters={skeletonAttempts:0,reviewMoreAttempts:0,seenPrompts:[]};
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
 it('blocking issues beyond one batch are collected via bounded continuation and merged without duplicates',async()=>{
  const counters:Counters={skeletonAttempts:0,reviewMoreAttempts:0,seenPrompts:[]};
  let reviewCalls=0;
  const {c,scope,service}=setup({
   review:()=>{reviewCalls++;return reviewCalls===1
    ?{action:'verdict',pass:false,issues:['问题1：卷A字数不足','问题2：主线1无落点'],suggestions:[],hasMoreIssues:true}
    :{action:'verdict',pass:true,issues:[],suggestions:[]};},
   reviewMore:()=>({pass:false,issues:['问题1：卷A字数不足','问题3：卷A收束未兑现'],suggestions:[],hasMoreIssues:false}),
  },counters,'k3-more-book');
  const rec=await recommend(service,scope,'k3-more-rec');
  const created=service.startDesignRound(scope,selectionFor(rec),'k3-more-round');
  const runId=created.find(x=>x.scheme==='A')!.id;
  await service.process(runId);
  const done=service.state(scope).find(r=>r.id===runId)!;
  expect(done.state).toBe('succeeded');
  expect(counters.reviewMoreAttempts).toBe(1);
  // 续批提示词携带已报告清单防重复
  const morePrompt=counters.seenPrompts.find(p=>p.includes('只返回尚未报告的其余阻塞问题'))!;
  expect(morePrompt).toContain('问题2：主线1无落点');
  // 第一轮按合并清单判revise；去重后进入局部修订输入（问题1只出现一次，问题3被收齐）
  expect(c.database.prepare("SELECT verdict FROM tm2_reviews WHERE candidate=? AND revision=1").get(runId)).toMatchObject({verdict:'revise'});
  const revisionPrompt=counters.seenPrompts.find(p=>p.includes('修订本卷卷卡'))!;
  expect(revisionPrompt).toContain('问题3：卷A收束未兑现');
  expect(revisionPrompt.match(/问题1：卷A字数不足/g)!.length).toBe(1);
 });
 it('continuation is bounded: still-more after two batches gets an honest marker instead of silent truncation',async()=>{
  const counters:Counters={skeletonAttempts:0,reviewMoreAttempts:0,seenPrompts:[]};
  let reviewCalls=0;
  const {scope,service}=setup({
   review:()=>{reviewCalls++;return reviewCalls===1
    ?{action:'verdict',pass:false,issues:['甲：卷A开场矛盾'],suggestions:[],hasMoreIssues:true}
    :{action:'verdict',pass:true,issues:[],suggestions:[]};},
   reviewMore:(attempt)=>attempt===1
    ?{pass:false,issues:['乙：卷A锚点缺条件'],suggestions:[],hasMoreIssues:true}
    :{pass:false,issues:['丙：终卷未收束'],suggestions:[],hasMoreIssues:true},
  },counters,'k3-bound-book');
  const rec=await recommend(service,scope,'k3-bound-rec');
  const created=service.startDesignRound(scope,selectionFor(rec),'k3-bound-round');
  const runId=created.find(x=>x.scheme==='A')!.id;
  await service.process(runId);
  const done=service.state(scope).find(r=>r.id===runId)!;
  expect(done.state).toBe('succeeded');
  expect(counters.reviewMoreAttempts).toBe(2); // 有界：每个审查节点最多2次续批
  const revisionPrompt=counters.seenPrompts.find(p=>p.includes('修订本卷卷卡'))!;
  expect(revisionPrompt).toContain('乙：卷A锚点缺条件');
  expect(revisionPrompt).toContain('丙：终卷未收束');
  expect(revisionPrompt).toContain('未尽列'); // 不硬截清单，如实标记仍有余项
 });
 it('node budget strategy tm2-node-budget-v2 widens headroom only for measured large synthesis nodes',()=>{
  expect(timeMachineSynthesisHeadroom('glm-5.3',8000)).toBe(24000);
  expect(timeMachineSynthesisHeadroom('glm-5.3-flash',8000)).toBe(24000);
  expect(timeMachineSynthesisHeadroom('deepseek-v4-pro',8000)).toBe(12000);
  expect(timeMachineSynthesisHeadroom('glm-5.3',5000)).toBeUndefined();
  expect(timeMachineSynthesisHeadroom('deepseek-v4-pro',3000)).toBeUndefined();
  expect(timeMachineSynthesisHeadroom('doubao-seed-2.1-turbo',8000)).toBeUndefined();
 });
 it('required close duty never checked by its linked anchors gets one precise local repair (run3 scheme C evidence)',async()=>{
  const counters:Counters={skeletonAttempts:0,reviewMoreAttempts:0,seenPrompts:[]};
  let cardAttempts=0;
  const {scope,service}=setup({
   skeleton:()=>({structure:'四幕起承转合',baseline:'轻快成长',ending:'建立工坊',openingHooks:['开头钩子','第一章钩子','前三章钩子'],words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'},
    lines:[lineFor('main','main','工坊',['成长线']),lineFor('rival','through','机甲',['机甲线'])],
    expectations:[{id:'promise',opening:'期待',change:'变化',answer:'回应',lineIds:['main']}],relations:[],volumeBriefs:[{id:'v1',title:'开张',goal:'建立工坊',words:{target:200000,min:null,max:null,hard:false,policy:'chars-v1'}}]}),
   volume:(briefId)=>{
    cardAttempts++;
    const card=volumeCardFor(briefId,['main','rival']);
    card.duties=[{lineId:'main',action:'advance',result:'推进',anchorIds:['out'],strength:'flexible',reason:'本卷职责'},{lineId:'rival',action:'close',result:'机甲谜团揭晓',anchorIds:['out'],strength:'required',reason:'本卷收束机甲线'}];
    if(cardAttempts>1)card.anchors[1]!.conditions=[{summary:'机甲与灵气的关联已经揭晓',subjectIds:['rival']}]; // 修复：exit锚点条件把该线列为核对对象
    return card;
   },
  },counters,'k3-close-book');
  const rec=await recommend(service,scope,'k3-close-rec');
  const created=service.startDesignRound(scope,selectionFor(rec,{addedLines:[{title:'机甲线',description:'机甲来历之谜'}]}),'k3-close-round');
  const runId=created.find(x=>x.scheme==='A')!.id;
  await service.process(runId);
  const done=service.state(scope).find(r=>r.id===runId)!;
  expect(done.state).toBe('succeeded');
  expect(cardAttempts).toBe(2); // 精确报错后一次局部修复，不整轮推翻
  const repairPrompt=counters.seenPrompts.filter(p=>p.includes('补全本卷卷卡'))[1]!;
  expect(repairPrompt).toContain('上次输出未通过校验');
  expect(repairPrompt).toContain('duties[lineId="rival"]');
  expect(repairPrompt).toContain('收束无法按正文核对');
 });
});
