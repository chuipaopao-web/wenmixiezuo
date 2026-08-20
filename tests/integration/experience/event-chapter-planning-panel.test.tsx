// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {EventChapterPlanningPanel} from '../../../apps/web/src/features/planning/EventChapterPlanningPanel';
import {type EventChapterOutlineData,type EventChapterSequenceData,type EventChapterSequenceVersionData} from '../../../apps/web/src/lib/api/client';

afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});

it('显示完整事件章链，只细化并冻结最近章节，同时传递真实版本与作者意见边界',async()=>{
  let sequence:EventChapterSequenceData=sequenceView();
  let detailTask:Record<string,unknown>|null=null;
  let detailChallengeTask:Record<string,unknown>|null=null;
  const requests:Array<{path:string;method:string;body:Record<string,unknown>|null;query:string}>=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input),'http://127.0.0.1'),path=url.pathname,method=init?.method??'GET';
    const body=init?.body===undefined?null:JSON.parse(String(init.body)) as Record<string,unknown>;
    requests.push({path,method,body,query:url.search});
    if(path.endsWith('/workflow'))return api(workflow());
    if(path.endsWith('/team-config'))return api(teamConfig());
    if(path.endsWith('/expression-profile'))return api({expressionProfileId:'expression-1',version:1,narrativePerson:null,viewpointDistance:null,languageTone:[],textDensity:null,targetAudience:null,contentBoundaries:{},humorSeriousness:null,voiceEvidence:[],impactScope:{},status:'provisional'});
    if(path.endsWith('/author-planning-inputs'))return api([]);
    if(path.endsWith('/chapter-sequence')&&method==='GET')return api(sequence);
    if(path.endsWith('/chapter-sequence/generation')&&method==='GET'){
      const kind=url.searchParams.get('kind');
      return api(kind==='details'?detailTask:kind==='detail_challenge'?detailChallengeTask:null);
    }
    if(path.endsWith('/challenge')&&method==='POST'){
      detailChallengeTask={kind:'detail_challenge',stateText:'本轮方案已经准备好',phaseText:'单章参考意见已经准备好',
        isRunning:false,isCompleted:true,canCancel:false,canResume:false,canRetry:false,errorMessage:null,
        challenge:{targetKind:'detail',targetId:'outline-1',
          targetVersionId:'outline-version-1',summary:'这一章最值得再看的，是人物选择能否同时推动关系变化。',suggestions:[{
            focus:'core_conflict',alternative:'让同伴提出一条更安全却会牺牲无辜者的办法，逼主角当场表态。',
            benefit:'冲突同时体现人物关系和价值选择。',tradeoff:'必须给同伴合理动机，不能把他写成工具人。',
            downstreamImpact:'下一章需要承接分歧，关系不能自动恢复。'}]},members:[{roleKey:'third_screenwriter',displayName:'幼薇'}],
        createdAt:'2026-08-09T00:00:30.000Z',updatedAt:'2026-08-09T00:00:40.000Z'};
      return api(detailChallengeTask);
    }
    if(path.endsWith('/chapter-outlines/generate')&&method==='POST'){
      detailTask={kind:'details',stateText:'本轮方案已经准备好',phaseText:'近期详细章纲已经保存',
        isRunning:false,isCompleted:true,canCancel:false,canResume:false,canRetry:false,errorMessage:null,
        members:[{roleKey:'main_editor',displayName:'昭明'}],
        createdAt:'2026-08-09T00:00:00.000Z',updatedAt:'2026-08-09T00:01:00.000Z'};
      return api(detailTask);
    }
    if(path.endsWith('/chapter-outlines/freeze')&&method==='POST'){
      sequence={...sequence,outlines:sequence.outlines.map((item,index)=>index===0?{...item,status:'frozen',
        activeVersionId:'outline-version-1',activeVersion:item.versions[0]??null}:item)};
      return api(sequence);
    }
    return new Response(JSON.stringify({error:{message:`未配置测试接口 ${method} ${path}`}}),{status:404});
  }));

  render(<EventChapterPlanningPanel bookId="book-chapters-ui"/>);
  expect(await screen.findByRole('heading',{name:'公开选择'})).toBeInTheDocument();
  expect(screen.getByText('从第1章开始，共3章')).toBeInTheDocument();
  expect(screen.getByText('本章负责事件收束')).toBeInTheDocument();
  expect(screen.getByText('对第1章的想法')).toBeInTheDocument();
  expect(screen.getByText(/自由发挥：对话、动作、意象与节奏/u)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button',{name:'请幼薇看看第1章'}));
  await waitFor(()=>expect(requests.find(item=>item.path.endsWith('/challenge')&&item.method==='POST')?.body)
    .toMatchObject({expectedSequenceRevision:2,expectedWorkflowVersion:8,challengerRoleKey:'third_screenwriter'}));
  expect(await screen.findByText('幼薇的参考意见')).toBeInTheDocument();
  expect(screen.getByText(/让同伴提出一条更安全/u)).toBeInTheDocument();
  expect(screen.getByText(/这些只是参考，不会自动改动当前章纲/u)).toBeInTheDocument();
  expect(screen.queryByText(/fixture-challenger|local-deterministic|detail_challenge/u)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button',{name:'生成详细章纲'}));
  await waitFor(()=>expect(requests.find(item=>item.path.endsWith('/chapter-outlines/generate')&&item.method==='POST')?.body)
    .toMatchObject({count:1,expectedSequenceRevision:2,expectedWorkflowVersion:8,authorInputRefs:[]}));
  expect(await screen.findByText(/昭明/u)).toBeInTheDocument();
  expect(screen.queryByText(/local-deterministic|fixture-editor/u)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button',{name:'确认近期章纲，进入正文'}));
  await waitFor(()=>expect(requests.find(item=>item.path.endsWith('/chapter-outlines/freeze')&&item.method==='POST')?.body)
    .toMatchObject({expectedWorkflowVersion:8,items:[{outlineId:'outline-1',outlineVersionId:'outline-version-1',expectedOutlineRevision:2}]}));
});

it('事件结算后仍展示正文实际绑定的完整详细章纲',async()=>{
  const sequence=historySequenceView();
  const requests:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input),'http://127.0.0.1'),path=url.pathname,method=init?.method??'GET';requests.push(`${method} ${path}`);
    if(path.endsWith('/workflow'))return api({...workflow(),stage:'ready_for_next_volume',planningVersion:23,activeEventRef:null,frozenChapterOutlineRefs:[]});
    if(path.endsWith('/team-config'))return api(teamConfig());
    if(path.endsWith('/expression-profile'))return api({expressionProfileId:'expression-history',version:1,narrativePerson:'third',viewpointDistance:'close',languageTone:[],textDensity:'adaptive',targetAudience:null,contentBoundaries:{},humorSeriousness:'adaptive',voiceEvidence:[],impactScope:{},status:'confirmed'});
    if(path.endsWith('/volume-plans'))return api([{volumePlanId:'volume-1',planNumber:1,status:'completed',activeVersionId:'volume-v1'}]);
    if(path.endsWith('/event-sequence'))return api({volumePlanId:'volume-1',revision:1,events:[
      {eventId:'event-1',order:1,status:'settled'},{eventId:'event-2',order:2,status:'settled'}
    ],operations:[]});
    if(path.endsWith('/chapter-sequence'))return api(sequence);
    return new Response(JSON.stringify({error:{message:`unhandled ${method} ${path}`}}),{status:404});
  }));

  const{container}=render(<EventChapterPlanningPanel bookId="book-chapters-history"/>);
  expect(await screen.findByLabelText('completed-event-chapter-history')).toBeInTheDocument();
  expect(screen.getByText('已完成内容已锁定')).toBeInTheDocument();
  expect(screen.queryByText('上层已变化，需重建')).not.toBeInTheDocument();
  expect(screen.getByText('详细章纲完整保留')).toBeInTheDocument();
  expect(container.querySelectorAll('.detailed-outline')).toHaveLength(3);
  expect(screen.queryByRole('button',{name:'生成详细章纲'})).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('查看已完成事件'),{target:{value:'event-1'}});
  await waitFor(()=>expect(requests.some(item=>item.endsWith('/story-events/event-1/chapter-sequence'))).toBe(true));
  expect(requests.filter(item=>item.endsWith('/chapter-sequence'))).toHaveLength(2);
  expect(requests.some(item=>item.includes('/chapter-sequence/generation'))).toBe(false);
});

function workflow(){return{ownerId:'owner',bookId:'book-chapters-ui',stage:'chapter_outlines_in_progress',planningVersion:8,
  activeVolumePlanRef:{kind:'volume_plan',id:'volume-1',version:1,contentHash:'v',required:true},
  activeEventRef:{kind:'story_event',id:'event-1',version:1,contentHash:'e',required:true},
  frozenChapterOutlineRefs:[],waitingTaskId:null,blockingReason:null,updatedAt:'2026-08-09T00:00:00.000Z'};}
function sequenceView():EventChapterSequenceData{const chapters=[
  coarse(1,'后果落地','事件开始状态','第一次选择产生后果'),
  coarse(2,'选择的代价','第一次选择产生后果','人物承担公开代价'),
  coarse(3,'局面改写','人物承担公开代价','事件结果得到验证')
 ];const active:EventChapterSequenceVersionData={sequenceVersionId:'sequence-v1',sequenceId:'sequence-1',version:1,parentVersionId:null,status:'active',
  dependencies:[],authorInputRefs:[],content:{eventTitle:'公开选择',startChapterNumber:1,chapters,
    eventEndingConditions:['事件结果得到验证'],closureCoverage:[{endingCondition:'事件结果得到验证',evidenceChapterNumber:3}],
    flexibilityNotes:['未冻结部分可以滚动调整']},contentHash:'hash',sourceTaskId:'sequence-task',
  createdAt:'2026-08-09T00:00:00.000Z',confirmedAt:'2026-08-09T00:01:00.000Z'};
  return{sequenceId:'sequence-1',eventId:'event-1',eventVersionId:'event-v1',volumePlanVersionId:'volume-v1',
    revision:2,status:'active',activeVersionId:'sequence-v1',activeVersion:active,versions:[active],
    outlines:chapters.map((planned,index)=>outline(index+1,planned)),nextChapterNumber:1,valid:true,
    createdAt:'2026-08-09T00:00:00.000Z',updatedAt:'2026-08-09T00:01:00.000Z'};}
function coarse(chapterNumber:number,title:string,openingState:string,endingState:string){return{chapterNumber,title,
  eventResponsibility:'完成当前事件的一项明确责任',openingState,characterGoals:['主角要推进目标'],conflicts:['现实阻力'],
  choicesAndCosts:['放弃轻松退路'],informationChanges:['新证据改变判断'],storyBeats:['后果落地','行动受阻','作出选择'],
  endingState,nextChapterInterface:endingState,softSuggestions:['允许局部调整'],creativeFreedom:['对话、动作、意象与节奏']};}
function outline(chapterNumber:number,planned:ReturnType<typeof coarse>):EventChapterOutlineData{const candidate:EventChapterOutlineData['activeVersion']=chapterNumber===1?{
  outlineVersionId:'outline-version-1',outlineId:'outline-1',version:1,parentVersionId:null,status:'candidate',
  sequenceVersionId:'sequence-v1',dependencies:[],authorInputRefs:[],content:{outlineSchema:'chapter_outline_v2',
    chapterNumber,title:planned.title,chapterFunction:planned.eventResponsibility,openingState:planned.openingState,
    requiredEndingState:planned.endingState,cast:[{name:'主角',objective:'推进目标',knowledgeBoundary:'不知道后续答案',chapterRole:'作出选择'}],
    conflict:{surface:'现实阻力',failureCost:'失去机会'},plotBeats:[
      {order:1,trigger:'后果出现',action:'核验',result:'确认问题'},{order:2,trigger:'受阻',action:'修正',result:'被迫选择'},
      {order:3,trigger:'退路消失',action:'承担代价',result:planned.endingState}],
    ending:{result:planned.endingState,stateChanges:[planned.endingState],hook:'下一步',nextChapterInterface:planned.nextChapterInterface},
    mustImplement:['完成本章责任'],mustNotViolate:['不能凭空加能力'],allowedCandidates:[],creativeFreedom:['对话、动作、意象与节奏']},
  contentHash:'outline-hash',artifactVersionId:null,sourceTaskId:'detail-task',createdAt:'2026-08-09T00:02:00.000Z',frozenAt:null}:null;
  return{outlineId:'outline-'+chapterNumber,eventId:'event-1',chapterNumber,order:chapterNumber,
    revision:candidate===null?1:2,status:candidate===null?'planned':'candidate',activeVersionId:null,planned,activeVersion:null,
    versions:candidate===null?[]:[candidate],createdAt:'2026-08-09T00:01:00.000Z',updatedAt:'2026-08-09T00:02:00.000Z'};}
function historySequenceView():EventChapterSequenceData{
  const base=sequenceView();
  const template=base.outlines[0]!.versions[0]!;
  const outlines=base.outlines.map(item=>{
    const version={...template,outlineVersionId:`history-version-${item.chapterNumber}`,outlineId:item.outlineId,status:'frozen' as const,
      content:{...template.content,chapterNumber:item.chapterNumber,title:item.planned.title,openingState:item.planned.openingState,
        requiredEndingState:item.planned.endingState,ending:{...template.content.ending,result:item.planned.endingState,
          stateChanges:[item.planned.endingState],nextChapterInterface:item.planned.nextChapterInterface}},frozenAt:'2026-08-09T01:00:00.000Z'};
    return{...item,status:'settled' as const,revision:3,activeVersionId:version.outlineVersionId,activeVersion:version,versions:[version]};
  });
  return{...base,status:'completed',outlines,nextChapterNumber:4};
}
function teamConfig(){return{members:[
    {agentId:'screenwriter-b',roleKey:'second_screenwriter',roleName:'编剧',displayName:'红玉',category:'core',provider:'local-deterministic',modelId:'fixture-b',activationState:'idle'},
    {agentId:'screenwriter-c',roleKey:'third_screenwriter',roleName:'编剧',displayName:'幼薇',category:'core',provider:'local-deterministic',modelId:'fixture-c',activationState:'idle'}
  ],promptPolicy:{editableLabel:'本书补充要求',maxChars:500,priority:'作者要求优先'}};}
function api(data:unknown){return new Response(JSON.stringify({data,meta:{requestId:'chapter-ui',version:1}}),{
  status:200,headers:{'content-type':'application/json'}});}
