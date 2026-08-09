// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EventPlanningPanel } from '../../../apps/web/src/features/planning/EventPlanningPanel';

afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});

it('在创作台展示事件因果链、真实团队来源，并让结构调整先预览再应用',async()=>{
  let sequence=sequenceView();
  let generation:Record<string,unknown>|null=null;
  const requests:Array<{path:string;method:string;body:Record<string,unknown>|null;query:string}>=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input),'http://127.0.0.1'),path=url.pathname,method=init?.method??'GET';
    const body=init?.body===undefined?null:JSON.parse(String(init.body)) as Record<string,unknown>;
    requests.push({path,method,body,query:url.search});
    if(path==='/api/v1/runtime/session')return response({authenticated:true,expiresInSeconds:1800});
    if(path.endsWith('/workflow'))return response(workflow());
    if(path.endsWith('/volume-plans'))return response([volumePlan()]);
    if(path.endsWith('/planning-templates'))return response(templateCatalog());
    if(path.endsWith('/author-planning-inputs'))return response([]);
    if(path.endsWith('/event-sequence')&&method==='GET')return response(sequence);
    if(path.endsWith('/versions')&&method==='GET'){
      const eventId=path.split('/').at(-2)!;return response(sequence.events.find(item=>item.eventId===eventId)?.versions??[]);
    }
    if(path.endsWith('/generation')&&method==='GET')return response(generation);
    if(path.endsWith('/generate')&&method==='POST'){
      generation={taskId:'task-event-ui',status:'succeeded',currentPhase:'fusion_complete',errorCode:null,
        checkpoint:{awaitingAuthorChoice:true},modelDiversityVerified:false,members:[
          {roleKey:'lead_screenwriter',agentId:'agent-a',displayName:'婉儿',provider:'local-deterministic',modelId:'fixture-a'},
          {roleKey:'second_screenwriter',agentId:'agent-b',displayName:'红玉',provider:'local-deterministic',modelId:'fixture-b'},
          {roleKey:'main_editor',agentId:'editor',displayName:'昭昭',provider:'local-deterministic',modelId:'fixture-editor'}],
        candidateVersionIds:{candidateA:'event-a',candidateB:'event-b',fusion:'event-fusion'},
        createdAt:'2026-08-09T00:00:00.000Z',updatedAt:'2026-08-09T00:01:00.000Z'};
      return response(generation);
    }
    if(path.endsWith('/operations/preview')&&method==='POST')return response({
      operationId:'op-1',operationKind:'insert',expectedSequenceRevision:1,resultSequenceRevision:null,
      proposal:body!.proposal,impact:{affectedEventIds:['event-2'],settledEventIds:[],activeEventIds:[],
        downstreamDependencyCount:0,resultingTitles:['新增事件'],blocked:false,note:'应用后保留全部旧版本和操作记录。'},
      status:'previewed',createdAt:'2026-08-09T00:00:00.000Z',appliedAt:null
    });
    if(path.endsWith('/operations/apply')&&method==='POST'){
      sequence={...sequence,revision:2,operations:[{operationId:'op-1',operationKind:'insert',status:'applied'} as never]};
      return response(sequence);
    }
    return new Response(JSON.stringify({error:{message:`未配置测试接口 ${method} ${path}`}}),{status:404});
  }));

  render(<EventPlanningPanel bookId="book-event-ui"/>);
  expect(await screen.findByRole('heading',{name:'先看整条因果链，再深入设计当前事件'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/事件 1.*胜利留下的缺口/u})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/事件 2.*对手开始反制/u})).toBeInTheDocument();
  expect(screen.getByText(/章数只是弹性估计/u)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button',{name:'开始设计事件'}));
  expect(await screen.findByText('三份方案已保存')).toBeInTheDocument();
  expect(screen.getByText(/本地验收模型，不冒充异模型意见/u)).toBeInTheDocument();
  expect(screen.getByText(/编剧A · 婉儿/u)).toBeInTheDocument();
  expect(screen.getByText(/编剧B · 红玉/u)).toBeInTheDocument();
  expect(screen.getByText(/主编 · 昭昭/u)).toBeInTheDocument();
  const generated=requests.find(item=>item.path.endsWith('/generate')&&item.method==='POST');
  expect(generated?.body).toMatchObject({expectedEventRevision:1,expectedActiveVersionId:null,
    expectedWorkflowVersion:5,authorInputRefs:[],template:{selectionMode:'none',scope:'event'}});

  fireEvent.click(screen.getByRole('button',{name:'在后面加事件'}));
  expect(await screen.findByText('结构调整预览')).toBeInTheDocument();
  expect(screen.getByText('应用后保留全部旧版本和操作记录。')).toBeInTheDocument();
  const preview=requests.find(item=>item.path.endsWith('/operations/preview'));
  expect(preview?.body).toMatchObject({expectedSequenceRevision:1,proposal:{operationKind:'insert',afterEventId:'event-1'}});
  fireEvent.click(screen.getByRole('button',{name:'应用调整'}));
  await waitFor(()=>expect(requests.some(item=>item.path.endsWith('/operations/apply')&&item.method==='POST')).toBe(true));
});

it('已完成卷仍可回看事件链与事件大纲，不会被当成空白当前卷',async()=>{
  const completedPlan={...volumePlan(),status:'completed'};
  const completedSequence={...sequenceView(),events:sequenceView().events.map(item=>({...item,status:'settled'}))};
  const requests:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input),'http://127.0.0.1'),path=url.pathname,method=init?.method??'GET';requests.push(`${method} ${path}`);
    if(path==='/api/v1/runtime/session')return response({authenticated:true,expiresInSeconds:1800});
    if(path.endsWith('/workflow'))return response({...workflow(),stage:'ready_for_next_volume',planningVersion:23});
    if(path.endsWith('/volume-plans'))return response([completedPlan]);
    if(path.endsWith('/planning-templates'))return response(templateCatalog());
    if(path.endsWith('/event-sequence'))return response(completedSequence);
    if(path.endsWith('/versions')){const eventId=path.split('/').at(-2)!;return response(completedSequence.events.find(item=>item.eventId===eventId)?.versions??[]);}
    if(path.endsWith('/generation'))return response(null);
    return new Response(JSON.stringify({error:{message:`unhandled ${method} ${path}`}}),{status:404});
  }));

  render(<EventPlanningPanel bookId="book-event-history"/>);
  expect(await screen.findByLabelText('completed-event-history')).toBeInTheDocument();
  expect(screen.getByText('事件链和事件大纲仍然完整保留')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/事件 1.*胜利留下的缺口/u})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'开始设计事件'})).not.toBeInTheDocument();
  expect(requests.some(item=>item.endsWith('/event-sequence'))).toBe(true);
});

function workflow(){return{ownerId:'owner',bookId:'book-event-ui',stage:'event_sequence_in_progress',planningVersion:5,
  activeVolumePlanRef:{volumePlanId:'volume-1',volumePlanVersionId:'volume-version-1'},activeEventRef:null,
  frozenChapterOutlineRefs:[],waitingTaskId:null,blockingReason:null,updatedAt:'2026-08-09T00:00:00.000Z'};}
function volumePlan(){return{volumePlanId:'volume-1',planNumber:1,physicalVolumeId:null,previousVolumePlanId:null,
  previousSettlementId:null,status:'active',revision:2,activeVersionId:'volume-version-1',
  activeVersion:{volumePlanVersionId:'volume-version-1',volumePlanId:'volume-1',version:1,parentVersionId:null,status:'active',
    candidateKind:'fusion',dependencies:[],template:noTemplate(),authorInputRefs:[],content:{title:'第一卷·雾城选择'},
    contentHash:`sha256:${'1'.repeat(64)}`,sourceTaskId:null,createdAt:'2026-08-09T00:00:00.000Z',confirmedAt:'2026-08-09T00:00:00.000Z'},
  createdAt:'2026-08-09T00:00:00.000Z',updatedAt:'2026-08-09T00:00:00.000Z'};}
function sequenceView(){const one=eventData('event-1',1,'胜利留下的缺口','对手抓住主角暴露的软肋'),two=eventData('event-2',2,'对手开始反制','冲突升级并触发下一步');
  return{volumePlanId:'volume-1',volumePlanVersionId:'volume-version-1',revision:1,events:[one,two],operations:[],updatedAt:'2026-08-09T00:00:00.000Z'};}
function eventData(eventId:string,order:number,title:string,next:string){const version={storyEventVersionId:eventId+'-seed',eventId,version:1,parentVersionId:null,
  status:'candidate',candidateKind:'volume_seed',volumePlanVersionId:'volume-version-1',previousSettlementId:null,dependencies:[],
  template:noTemplate(),authorInputRefs:[],content:eventContent(title,next),contentHash:`sha256:${String(order).repeat(64)}`,sourceTaskId:null,
  createdAt:'2026-08-09T00:00:00.000Z',confirmedAt:null};
  return{eventId,volumePlanId:'volume-1',order,status:'planning',revision:1,previousEventId:order===1?null:'event-1',
    activeVersionId:null,activeVersion:null,latestVersion:version,downstreamDependencyCount:0,
    createdAt:'2026-08-09T00:00:00.000Z',updatedAt:'2026-08-09T00:00:00.000Z',versions:[version]};}
function eventContent(title:string,next:string){return{title,volumeResponsibility:'推动本卷核心矛盾',startingState:'承接上一结果',
  trigger:'既有结果造成新问题',participants:['主角'],characterGoals:['守住行动资格'],obstacles:['证据不足'],
  choicesAndCosts:['放弃短期收益换取长期机会'],informationMoves:['发现危机背后的利益关系'],
  localProgression:['问题落地','尝试受阻','作出选择','结果改变状态'],requiredResult:'主角取得有限主动权',
  flexibleExecution:['场景、对白和局部误判自由'],endingConditions:['状态发生变化'],nextEventImpact:next,
  characterArcImpact:'主角开始承担选择后果',volumeClimaxImpact:'积累卷末证据与代价',
  estimatedChapterRange:{minimum:5,likely:8,maximum:12},uncertaintyNotes:[]};}
function templateCatalog(){return{contractVersion:1,registryVersion:1,registryHash:`sha256:${'2'.repeat(64)}`,scope:'event',
  templates:[{templateKey:'event-pressure-choice',templateVersion:1,contentHash:`sha256:${'3'.repeat(64)}`,scope:'event',
    publicTitle:'压力越来越大，人物必须作出选择',publicExplanation:'让阻力逼近，最后用有代价的选择改变状态。',
    fitConditions:['人物面对难题'],knownRisks:['不能只加敌人'],authorQuestions:['人物愿意失去什么？'],
    beats:[{beatId:'choice',publicFunction:'逼出选择',expectedChange:'人物承担后果',optional:false,order:1}],
    previewPrompt:'围绕选择推进',recommended:true}],alternativeChoices:[]};}
function noTemplate(){return{selectionMode:'none',templateKey:null,templateVersion:null,templateHash:null,scope:'event',beats:[],customDirection:null};}
function response(data:unknown){return new Response(JSON.stringify({data,meta:{requestId:'request-event-ui',version:1}}),{
  status:200,headers:{'content-type':'application/json'}});}
