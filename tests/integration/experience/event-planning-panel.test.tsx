// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    if(path.endsWith('/workflow'))return response(workflow());
    if(path.endsWith('/volume-plans'))return response([volumePlan()]);
    if(path.endsWith('/planning-templates'))return response(templateCatalog());
    if(path.endsWith('/author-planning-inputs'))return response([]);
    if(path.endsWith('/event-chains/generation'))return response(null);
    if(path.endsWith('/event-chains')&&method==='GET')return response([]);
    if(path.endsWith('/event-sequence')&&method==='GET')return response(sequence);
    if(path.endsWith('/versions')&&method==='GET'){
      const eventId=path.split('/').at(-2)!;return response(sequence.events.find(item=>item.eventId===eventId)?.versions??[]);
    }
    if(path.endsWith('/generation')&&method==='GET')return response(generation);
    if(path.endsWith('/generate')&&method==='POST'){
      generation={stateText:'本轮方案已经准备好',phaseText:'融合方案已准备好',isRunning:false,isCompleted:true,
        canCancel:false,canResume:false,canRetry:false,errorMessage:null,members:[
          {roleKey:'lead_screenwriter',displayName:'婉儿'},
          {roleKey:'second_screenwriter',displayName:'红玉'},
          {roleKey:'main_editor',displayName:'昭昭'}],
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
  expect(await screen.findByRole('heading',{name:'规划'})).toBeInTheDocument();
  expect(screen.queryByText('规划台')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:/事件 1.*胜利留下的缺口/u})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/事件 2.*对手开始反制/u})).toBeInTheDocument();
  const chain=within(screen.getByLabelText('事件因果链'));
  expect(chain.getAllByText('既有结果造成新问题')).toHaveLength(2);
  expect(chain.getByRole('button',{name:/本卷开场/u})).toBeInTheDocument();
  expect(chain.getByRole('button',{name:/预计承接/u})).toBeInTheDocument();
  expect(chain.getByText('预计承接')).toBeInTheDocument();
  expect(screen.getAllByText('眼前的麻烦').length).toBeGreaterThan(0);
  expect(screen.getAllByText('不得不作出的选择').length).toBeGreaterThan(0);
  expect(screen.getByRole('button',{name:'故事视图'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByText('这段剧情最想让读者感受到什么？')).toBeInTheDocument();
  expect(screen.getByText('根据当前故事推荐')).toBeInTheDocument();
  expect(screen.getByText('扬眉吐气')).toBeInTheDocument();
  expect(screen.queryByText(/方法来源|救猫咪结构/u)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'细节视图'}));
  expect(screen.getByText(/上一事件实际结果.*主角与局面新状态.*下一事件接口/u)).toBeInTheDocument();
  expect(screen.getAllByText('人物必须作出的选择与代价').length).toBeGreaterThan(0);

  fireEvent.click(screen.getByRole('button',{name:'开始设计事件'}));
  expect(await screen.findByText('本轮方案已经准备好')).toBeInTheDocument();
  expect(screen.queryByText(/本地验收模型|local-deterministic|fixture-/u)).not.toBeInTheDocument();
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
  const completedSequence={...sequenceView(),events:sequenceView().events.map(item=>({...item,status:'settled',
    latestVersion:{...item.latestVersion,previousSettlementId:item.order===1?null:'settlement-event-1'},
    versions:item.versions.map(version=>({...version,previousSettlementId:item.order===1?null:'settlement-event-1'}))
  }))};
  const requests:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input),'http://127.0.0.1'),path=url.pathname,method=init?.method??'GET';requests.push(`${method} ${path}`);
    if(path.endsWith('/workflow'))return response({...workflow(),stage:'ready_for_next_volume',planningVersion:23});
    if(path.endsWith('/volume-plans'))return response([completedPlan]);
    if(path.endsWith('/planning-templates'))return response(templateCatalog());
    if(path.endsWith('/author-planning-inputs'))return response([]);
    if(path.endsWith('/event-chains/generation'))return response(null);
    if(path.endsWith('/event-chains'))return response([]);
    if(path.endsWith('/event-sequence'))return response(completedSequence);
    if(path.endsWith('/versions')){const eventId=path.split('/').at(-2)!;return response(completedSequence.events.find(item=>item.eventId===eventId)?.versions??[]);}
    if(path.endsWith('/generation'))return response(null);
    return new Response(JSON.stringify({error:{message:`unhandled ${method} ${path}`}}),{status:404});
  }));

  render(<EventPlanningPanel bookId="book-event-history"/>);
  expect(await screen.findByLabelText('completed-event-history')).toBeInTheDocument();
  expect(screen.getByText('事件链和事件大纲仍然完整保留')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/事件 1.*胜利留下的缺口/u})).toBeInTheDocument();
  const historyChain=within(screen.getByLabelText('已完成事件因果链'));
  expect(historyChain.getByRole('button',{name:/上一幕（已发生）/u})).toBeInTheDocument();
  expect(historyChain.getByText('已经发生')).toBeInTheDocument();
  expect(screen.getAllByText('眼前的麻烦').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button',{name:'细节视图'}));
  expect(screen.getByText('服务本卷')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'开始设计事件'})).not.toBeInTheDocument();
  expect(requests.some(item=>item.endsWith('/event-sequence'))).toBe(true);
});

it('手机端先由AI设计并确认事件链，再进入逐事件设计，不把卷方向直接当事件',async()=>{
  Object.defineProperty(window,'innerWidth',{configurable:true,value:390});
  let sequence:ReturnType<typeof sequenceView>|null=null;
  let chains:Array<ReturnType<typeof eventChain>>=[];
  let chainGeneration:Record<string,unknown>|null=null;
  const requests:Array<{path:string;method:string}>=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input),'http://127.0.0.1'),path=url.pathname,method=init?.method??'GET';
    requests.push({path,method});
    if(path.endsWith('/workflow'))return response(workflow());
    if(path.endsWith('/volume-plans'))return response([volumePlan()]);
    if(path.endsWith('/planning-templates'))return response(templateCatalog());
    if(path.endsWith('/author-planning-inputs'))return response([]);
    if(path.endsWith('/event-chains/generation')&&method==='GET')return response(chainGeneration);
    if(path.endsWith('/event-chains/generate')&&method==='POST'){
      chains=[eventChain('candidate')];
      chainGeneration={stateText:'本轮方案已经准备好',phaseText:'事件链候选已经准备好',isRunning:false,isCompleted:true,
        canCancel:false,canResume:false,canRetry:false,errorMessage:null,members:[{roleKey:'lead_screenwriter',displayName:'幼薇'},{roleKey:'second_screenwriter',displayName:'红玉'},{roleKey:'chief_editor',displayName:'貂蝉'}],
        candidateEventChainId:'chain-v1'};
      return response(chainGeneration);
    }
    if(path.includes('/event-chains/')&&path.endsWith('/confirm')&&method==='POST'){
      chains=chains.map((item,index)=>({...item,status:index===chains.length-1?'active' as const:'superseded' as const}));
      return response(chains.at(-1));
    }
    if(path.endsWith('/event-chains')&&method==='POST'){
      const input=JSON.parse(String(init?.body)) as {content:ReturnType<typeof eventChain>['content']};
      chains=[{...chains[0]!,status:'superseded'},{...eventChain('candidate'),id:'chain-v2',version:2,
        content:input.content,sourceVersionIds:['direction-v1','chain-v1']}];
      return response(chains[1]);
    }
    if(path.endsWith('/event-chains')&&method==='GET')return response(chains);
    if(path.endsWith('/event-sequence/initialize')&&method==='POST'){
      sequence=sequenceView();return response(sequence);
    }
    if(path.endsWith('/event-sequence')&&method==='GET')return response(sequence);
    if(path.endsWith('/versions'))return response([]);
    if(path.endsWith('/generation'))return response(null);
    return new Response(JSON.stringify({error:{message:`未配置测试接口 ${method} ${path}`}}),{status:404});
  }));

  render(<EventPlanningPanel bookId="book-event-mobile"/>);
  expect(await screen.findByRole('heading',{name:'把大故事方向拆成连续的小故事'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'开始设计事件'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'让团队设计事件链'}));
  expect(await screen.findByText('追踪失踪账册')).toBeInTheDocument();
  expect(screen.getByText('证人改口，主角必须先保住唯一愿意说话的人')).toBeInTheDocument();
  expect(screen.getByText('公开证据会暴露盟友，隐瞒又会失去公众信任')).toBeInTheDocument();
  expect(screen.queryByText(/猫咪|三幕|五幕|节拍|英雄之旅/u)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'修改这条链'}));
  const editor=within(screen.getByLabelText('修改事件链'));
  fireEvent.change(editor.getAllByLabelText('人物行动')[0]!,{target:{value:'主角先核实账册来源，再决定是否公开追查'}});
  fireEvent.click(screen.getByRole('button',{name:'保存为我的版本'}));
  expect(await screen.findByText('主角先核实账册来源，再决定是否公开追查')).toBeInTheDocument();
  const confirmButton=screen.getByRole('button',{name:'确认这条事件链'});
  await waitFor(()=>expect(confirmButton).not.toBeDisabled());
  fireEvent.click(confirmButton);
  expect(await screen.findByText('已经确认的事件链')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'按这条链进入逐事件设计'}));
  expect(await screen.findByRole('button',{name:/事件 1.*胜利留下的缺口/u})).toBeInTheDocument();
  const generatedAt=requests.findIndex(item=>item.path.endsWith('/event-chains/generate'));
  const savedAt=requests.findIndex(item=>item.path.endsWith('/event-chains')&&item.method==='POST');
  const confirmedAt=requests.findIndex(item=>item.path.includes('/event-chains/')&&item.path.endsWith('/confirm'));
  expect(requests[confirmedAt]?.path).toContain('/event-chains/chain-v2/confirm');
  const initializedAt=requests.findIndex(item=>item.path.endsWith('/event-sequence/initialize'));
  expect(generatedAt).toBeGreaterThan(-1);expect(savedAt).toBeGreaterThan(generatedAt);expect(confirmedAt).toBeGreaterThan(savedAt);expect(initializedAt).toBeGreaterThan(confirmedAt);
});

function eventChain(status:'candidate'|'active'|'superseded'){
  const stages=[
    ['追踪失踪账册','主角主动追查账册去向','证人改口，主角必须先保住唯一愿意说话的人','得到一条能指向内鬼的线索','主角知道危险来自内部','内鬼抢先销毁证据'],
    ['保护关键证人','主角转移证人并试探同伴','对手借规则封锁出路','保住证人却暴露主角立场','盟友开始怀疑主角隐瞒真相','怀疑迫使主角公开一部分证据'],
    ['公开有限证据','主角选择在众人面前亮出线索','公开证据会暴露盟友，隐瞒又会失去公众信任','换来调查资格但伤害盟友关系','主角得到行动权也失去私人信任','对手利用关系裂痕发动反击'],
    ['承受反击并反查','主角用对手留下的程序痕迹反向追踪','证据链被切断，旧办法完全失效','找到真正账册但必须牺牲既得利益','主角掌握真相并承担选择代价','真相把双方推入不可回避的公开决战'],
    ['公开真相改变局面','主角在决战中完成取舍并公布账册','对手以主角最在意的人为最后筹码','核心承诺兑现，旧秩序被打破且代价保留','局面不可逆改变，并打开下一阶段目标',null]
  ] as const;
  const responsibilities=['opening_launch','golden_three','early_payoff','conflict_and_emotion_escalation','major_climax_before_100k','climax_setup','climax_consequence'] as const;
  return{id:'chain-v1',bookId:'book-event-mobile',volumePlanId:'volume-1',version:1,status,sourceVersionIds:['direction-v1'],
    content:{volumeDirectionVersionId:'direction-v1',events:stages.map((stage,index)=>({nodeId:`node-${index+1}`,order:index+1,title:stage[0],
      volumeResponsibility:['opening_situation','volume_goal','escalation_1','major_choice','climax_responsibility'][index]!,entryState:index===0?'卷开场局面':stages[index-1]![4],
      protagonistAction:stage[1],oppositionEscalation:stage[2],stagePayoffOrCost:stage[3],exitState:stage[4],leadsToNext:stage[5],
      plantThreadIds:[],payoffThreadIds:[],consequenceThreadIds:[],firstVolumeResponsibilities:index===0?[...responsibilities]:[]})),
      coverage:['opening_situation','volume_goal','escalation_1','major_choice','climax_responsibility','cost_and_consequence','closing_state'].map((responsibility,index)=>({responsibility,eventNodeIds:[`node-${Math.min(index+1,5)}`],status:'covered' as const}))},
    contentHash:`sha256:${'4'.repeat(64)}`,createdAt:'2026-08-09T00:00:00.000Z',confirmedAt:status==='active'?'2026-08-09T00:02:00.000Z':null};
}
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
    publicTitle:'压力越来越大，人物必须作出选择',publicExplanation:'让阻力逼近，最后用有代价的选择改变状态。',sourceLabel:'救猫咪结构',
    fitConditions:['人物面对难题'],knownRisks:['不能只加敌人'],authorQuestions:['人物愿意失去什么？'],
    beats:[{beatId:'choice',publicFunction:'逼出选择',expectedChange:'人物承担后果',optional:false,order:1}],
    previewPrompt:'围绕选择推进',recommended:true}],alternativeChoices:[]};}
function noTemplate(){return{selectionMode:'none',templateKey:null,templateVersion:null,templateHash:null,scope:'event',beats:[],customDirection:null};}
function response(data:unknown){return new Response(JSON.stringify({data,meta:{requestId:'request-event-ui',version:1}}),{
  status:200,headers:{'content-type':'application/json'}});}
