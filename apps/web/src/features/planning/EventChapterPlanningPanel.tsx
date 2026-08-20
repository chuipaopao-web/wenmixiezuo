import type { EventChapterChallengeContent } from '@wenmi/contracts';
import { useCallback,useEffect,useMemo,useState } from 'react';
import {
  actOnEventChapterGeneration,confirmEventChapterSequence,fetchAuthorPlanningInputs,fetchCreationWorkflow,fetchExpressionProfile,fetchFirstVolumeLaunchProgress,
  fetchEventChapterGeneration,fetchEventChapterSequence,fetchEventSequence,fetchTeamConfig,fetchVolumePlans,freezeRecentEventChapterOutlines,
  initializeEventChapterSequence,saveExpressionProfile,settleStoryEvent,startEventChapterDetailGeneration,startWritingRun,
  startEventChapterDetailChallenge,startEventChapterSequenceChallenge,startEventChapterSequenceGeneration,
  type EventChapterGenerationData,type EventChapterOutlineData,
  type EventChapterSequenceData,type EventChapterSequenceVersionData,type ExpressionProfileData,type StoryEventData
} from '../../lib/api/client';
import { AuthorIdeaComposer } from '../creation-desk/AuthorIdeaComposer';
import { SettlementFollowUpCard } from './SettlementFollowUpCard';
import { useMembershipGate } from '../shared/membership-gate';
import { SettingGapPanel } from './SettingGapPanel';

export function EventChapterPlanningPanel({bookId,onOpenManuscript,onChanged}:{bookId:string;onOpenManuscript?:()=>void;onChanged?:()=>Promise<void>|void}):React.JSX.Element{
  const[workflow,setWorkflow]=useState<Awaited<ReturnType<typeof fetchCreationWorkflow>>|null>(null);
  const[launchProgress,setLaunchProgress]=useState<Awaited<ReturnType<typeof fetchFirstVolumeLaunchProgress>>|null>(null);
  const[sequence,setSequence]=useState<EventChapterSequenceData|null>(null);
  const[expression,setExpression]=useState<ExpressionProfileData|null>(null);
  const[narrativePerson,setNarrativePerson]=useState<'first'|'third'|'mixed'>('third');
  const[viewpointDistance,setViewpointDistance]=useState<'close'|'medium'|'distant'|'adaptive'>('close');
  const[writingTaskId,setWritingTaskId]=useState<string|null>(null);
  const[sequenceTask,setSequenceTask]=useState<EventChapterGenerationData|null>(null);
  const[detailTask,setDetailTask]=useState<EventChapterGenerationData|null>(null);
  const[sequenceChallengeTask,setSequenceChallengeTask]=useState<EventChapterGenerationData|null>(null);
  const[detailChallengeTask,setDetailChallengeTask]=useState<EventChapterGenerationData|null>(null);
  const[challengers,setChallengers]=useState<Array<{roleKey:string;name:string}>>([]);
  const[detailCount,setDetailCount]=useState(1);
  const[freezeCount,setFreezeCount]=useState(1);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const[eventId,setEventId]=useState<string|null>(null);
  const[historyMode,setHistoryMode]=useState(false);
  const[historyEvents,setHistoryEvents]=useState<StoryEventData[]>([]);
  const{guardAi}=useMembershipGate();

  const load=useCallback(async(signal?:AbortSignal)=>{
    const[nextWorkflow,nextExpression,nextTeam,nextLaunchProgress]=await Promise.all([fetchCreationWorkflow(bookId,signal),fetchExpressionProfile(bookId,signal),fetchTeamConfig(bookId,signal),fetchFirstVolumeLaunchProgress(bookId,signal).catch(()=>null)]);
    setWorkflow(nextWorkflow);setExpression(nextExpression);setLaunchProgress(nextLaunchProgress);
    setChallengers(nextTeam.members.filter(member=>member.roleKey==='second_screenwriter'||member.roleKey==='third_screenwriter')
      .map(member=>({roleKey:member.roleKey,name:member.displayName})));
    if(nextExpression?.narrativePerson)setNarrativePerson(nextExpression.narrativePerson);
    if(nextExpression?.viewpointDistance)setViewpointDistance(nextExpression.viewpointDistance);
    let nextEventId=nextWorkflow.activeEventRef?.id??null;
    let nextHistoryMode=false;
    let nextHistoryEvents:StoryEventData[]=[];
    if(nextEventId===null){
      const plans=await fetchVolumePlans(bookId,signal);
      const historicalPlan=[...plans].reverse().find(item=>['active','completed'].includes(item.status)&&item.activeVersionId!==null)??null;
      if(historicalPlan!==null){
        const eventSequence=await fetchEventSequence(bookId,historicalPlan.volumePlanId,signal);
        nextHistoryEvents=(eventSequence?.events??[]).filter(item=>['active','settled'].includes(item.status));
        const historicalEvent=[...nextHistoryEvents].reverse()[0]??null;
        nextEventId=historicalEvent?.eventId??null;
        nextHistoryMode=historicalEvent?.status==='settled'||historicalPlan.status==='completed';
      }
    }
    setEventId(nextEventId);setHistoryMode(nextHistoryMode);setHistoryEvents(nextHistoryEvents);
    if(nextEventId===null){setSequence(null);setSequenceTask(null);setDetailTask(null);setSequenceChallengeTask(null);setDetailChallengeTask(null);return;}
    if(nextHistoryMode){
      setSequence(await fetchEventChapterSequence(bookId,nextEventId,signal));setSequenceTask(null);setDetailTask(null);
      setSequenceChallengeTask(null);setDetailChallengeTask(null);return;
    }
    const[nextSequence,nextSequenceTask,nextDetailTask,nextSequenceChallenge,nextDetailChallenge]=await Promise.all([
      fetchEventChapterSequence(bookId,nextEventId,signal),
      fetchEventChapterGeneration(bookId,nextEventId,'sequence',signal),
      fetchEventChapterGeneration(bookId,nextEventId,'details',signal),
      fetchEventChapterGeneration(bookId,nextEventId,'sequence_challenge',signal),
      fetchEventChapterGeneration(bookId,nextEventId,'detail_challenge',signal)
    ]);
    setSequence(nextSequence);setSequenceTask(nextSequenceTask);setDetailTask(nextDetailTask);
    setSequenceChallengeTask(nextSequenceChallenge);setDetailChallengeTask(nextDetailChallenge);
  },[bookId]);
  useEffect(()=>{const controller=new AbortController();setError(null);
    void load(controller.signal).catch(reason=>{if(!controller.signal.aborted)setError(messageOf(reason));});
    return()=>controller.abort();},[load]);
  useEffect(()=>{if(![sequenceTask,detailTask,sequenceChallengeTask,detailChallengeTask].some(task=>task?.isRunning===true))return;
    const controller=new AbortController(),timer=window.setInterval(()=>{
      void load(controller.signal).catch(reason=>{if(!controller.signal.aborted)setError(messageOf(reason));});
    },1250);
    return()=>{controller.abort();window.clearInterval(timer);};
  },[detailChallengeTask?.isRunning,detailChallengeTask?.updatedAt,detailTask?.isRunning,detailTask?.updatedAt,load,
    sequenceChallengeTask?.isRunning,sequenceChallengeTask?.updatedAt,sequenceTask?.isRunning,sequenceTask?.updatedAt]);

  const pending=useMemo(()=>sequence?.outlines.filter(item=>!['frozen','settled'].includes(item.status))??[],[sequence]);
  const readOnly=historyMode||sequence?.status==='completed';
  const detailItems=useMemo(()=>readOnly
    ?sequence?.outlines.filter(item=>item.activeVersion!==null||item.versions.length>0)??[]
    :pending.slice(0,3),[pending,readOnly,sequence]);
  const firstChapterOnly=pending[0]?.chapterNumber===1;
  const available=Math.min(firstChapterOnly?1:3,pending.length);
  useEffect(()=>{if(available>0){setDetailCount(value=>Math.min(Math.max(1,value),available));setFreezeCount(value=>Math.min(Math.max(1,value),available));}},[available]);

  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError(null);try{await work();await load();}catch(reason){setError(messageOf(reason));}finally{setBusy(false);}};
  const initialize=()=>{if(workflow===null||eventId===null)return;void run(async()=>{
    setSequence(await initializeEventChapterSequence(bookId,eventId,{expectedWorkflowVersion:workflow.planningVersion,idempotencyKey:key('chapter-sequence')}));
  });};
  const ideaRefs=async(kind:'sequence'|'details',count=1)=>{
    if(eventId===null)return[];
    if(kind==='sequence'){
      const ideas=await fetchAuthorPlanningInputs(bookId,{surface:'chapter_outline',subjectType:'event_chapter_sequence',subjectId:eventId});
      return currentIdeas(ideas);
    }
    const targets=pending.slice(0,count);
    const groups=await Promise.all(targets.map(item=>fetchAuthorPlanningInputs(bookId,{
      surface:'chapter_outline',subjectType:'event_chapter_outline',subjectId:item.outlineId
    })));
    return[...new Set(groups.flatMap(currentIdeas))];
  };
  const generateSequence=()=>{if(sequence===null||workflow===null||eventId===null)return;if(!guardAi())return;void run(async()=>{
    const refs=await ideaRefs('sequence');
    setSequenceTask(await startEventChapterSequenceGeneration(bookId,eventId,{expectedSequenceRevision:sequence.revision,
      expectedWorkflowVersion:workflow.planningVersion,authorInputRefs:refs,idempotencyKey:key('chapter-sequence-ai')}));
  });};
  const challengeSequence=(version:EventChapterSequenceVersionData,challengerRoleKey:string)=>{if(sequence===null||workflow===null||eventId===null)return;if(!guardAi())return;void run(async()=>{
    setSequenceChallengeTask(await startEventChapterSequenceChallenge(bookId,eventId,version.sequenceVersionId,{
      expectedSequenceRevision:sequence.revision,expectedWorkflowVersion:workflow.planningVersion,
      challengerRoleKey,idempotencyKey:key('chapter-sequence-challenge')}));
  });};
  const confirm=(version:EventChapterSequenceVersionData)=>{if(sequence===null||workflow===null||eventId===null)return;void run(async()=>{
    setSequence(await confirmEventChapterSequence(bookId,eventId,{sequenceVersionId:version.sequenceVersionId,
      expectedSequenceRevision:sequence.revision,expectedWorkflowVersion:workflow.planningVersion}));
  });};
  const generateDetails=()=>{if(sequence===null||workflow===null||eventId===null)return;if(!guardAi())return;void run(async()=>{
    const refs=await ideaRefs('details',detailCount);
    setDetailTask(await startEventChapterDetailGeneration(bookId,eventId,{count:detailCount,
      expectedSequenceRevision:sequence.revision,expectedWorkflowVersion:workflow.planningVersion,
      authorInputRefs:refs,idempotencyKey:key('chapter-details-ai')}));
  });};
  const challengeDetail=(item:EventChapterOutlineData,challengerRoleKey:string)=>{if(sequence===null||workflow===null||eventId===null)return;if(!guardAi())return;
    const version=item.activeVersion??item.versions[0]??null;if(version===null)return;void run(async()=>{
      setDetailChallengeTask(await startEventChapterDetailChallenge(bookId,eventId,item.outlineId,version.outlineVersionId,{
        expectedSequenceRevision:sequence.revision,expectedWorkflowVersion:workflow.planningVersion,
        challengerRoleKey,idempotencyKey:key('chapter-detail-challenge')}));
    });};
  const freeze=()=>{if(sequence===null||workflow===null||eventId===null)return;const targets=pending.slice(0,freezeCount);
    const items=targets.map(item=>({outlineId:item.outlineId,outlineVersionId:item.versions[0]?.outlineVersionId??'',
      expectedOutlineRevision:item.revision}));
    if(items.some(item=>item.outlineVersionId.length===0)){setError('请先让主编完成这些章节的详细章纲，再冻结。');return;}
    void run(async()=>{setSequence(await freezeRecentEventChapterOutlines(bookId,eventId,{items,
      expectedWorkflowVersion:workflow.planningVersion}));});
  };
const confirmExpression=()=>void run(async()=>{
    setExpression(await saveExpressionProfile(bookId,{narrativePerson,viewpointDistance,textDensity:'adaptive',
      humorSeriousness:'adaptive',impactScope:{appliesFrom:'next_formal_work_order'},confirm:true}));
  });
  const startWriting=()=>{if(!guardAi())return;void run(async()=>{
    const next=sequence?.outlines.find(item=>item.status==='frozen')??null;
    if(next===null)throw new Error('没有可用于正文的冻结章纲。');
    const batch=await startWritingRun(bookId,{chapterTitle:next.activeVersion?.content.title??next.planned.title});
    setWritingTaskId(batch.taskIds[0]??null);await onChanged?.();onOpenManuscript?.();
  });};
  const settleCurrentEvent=()=>{if(eventId===null||workflow===null)return;void run(async()=>{
    await settleStoryEvent(bookId,eventId,workflow.planningVersion);await onChanged?.();
  });};
  const taskControl=(task:EventChapterGenerationData,action:'cancel'|'retry')=>void run(async()=>{
    if(eventId!==null)await actOnEventChapterGeneration(bookId,eventId,task.kind,action);
  });
  const selectHistoryEvent=(nextEventId:string)=>{if(!historyMode)return;setBusy(true);setError(null);
    void fetchEventChapterSequence(bookId,nextEventId).then(nextSequence=>{setEventId(nextEventId);setSequence(nextSequence);})
      .catch(reason=>setError(messageOf(reason))).finally(()=>setBusy(false));
  };

  if(workflow===null)return <section className="event-chapter-panel"><p>正在读取当前创作进度…</p></section>;
  if(eventId===null)return <section className="event-chapter-panel chapter-empty"><small>章纲设计</small><h3>先确认当前事件</h3>
    <p>章纲必须从已经确认的卷纲和事件大纲向下展开，不能脱离上层约束单独生成。</p></section>;
  if(sequence===null)return <section className="event-chapter-panel chapter-empty"><small>章纲设计</small><h3>建立当前事件的章链</h3>
    <p>先建立一个稳定的工作容器；随后由指定编剧设计完整事件章链，并只细化最近1—3章。</p>
    <button className="primary-button" disabled={busy} type="button" onClick={initialize}>{busy?'正在建立…':'开始规划章纲'}</button>
    {error!==null&&<p className="planning-error" role="alert">{error}</p>}</section>;

  const candidates=sequence.versions.filter(version=>version.status==='candidate');
  const nextIdeaOutline=pending[0]??null;
  const sequenceHealth=['completed','archived'].includes(sequence.status)
    ?(sequence.valid?'已完成内容已锁定':'历史内容需要检查')
    :(sequence.valid?'上层内容没有变化':'上层已变化，需重建');
  return <section className="event-chapter-panel" aria-label={readOnly?'completed-event-chapter-history':undefined}>
    <header className="event-chapter-header"><div>
      <h3>{sequence.activeVersion?.content.eventTitle??candidates[0]?.content.eventTitle??'当前事件章纲'}</h3></div>
      <div>{readOnly&&historyEvents.length>1&&<label>查看已完成事件<select aria-label="查看已完成事件" value={eventId??''}
        disabled={busy} onChange={event=>selectHistoryEvent(event.target.value)}>{historyEvents.map((item,index)=><option key={item.eventId} value={item.eventId}>
          {item.activeVersion?.content.title??item.latestVersion?.content.title??`事件 ${item.order??index+1}`}</option>)}</select></label>}
        <span className={"sequence-health "+(sequence.valid?'ready':'stale')}>{sequenceHealth}</span></div></header>

    <SettingGapPanel bookId={bookId}/>
    {launchProgress!==null&&<FirstVolumeLaunchProgressCard progress={launchProgress}/>}
    {sequence.activeVersionId===null&&!readOnly&&<section className="chapter-sequence-design">
      <div className="planning-section-heading"><div><small>第一步</small><h4>设计完整事件章链</h4>
        <p>章数由事件实际需要决定，不固定为六章或十章；相邻章节的开场与结尾必须连续。</p></div>
        <button className="primary-button" type="button" disabled={busy||sequenceTask?.isRunning===true}
          onClick={generateSequence}>{sequenceTask?.isRunning===true?'编剧正在设计…':'让编剧设计完整章链'}</button></div>
      <AuthorIdeaComposer bookId={bookId} surface="chapter_outline" subjectType="event_chapter_sequence" subjectId={eventId}
        title="对整个事件章链的想法"/>
      {sequenceTask!==null&&<TaskStrip task={sequenceTask} onCancel={()=>taskControl(sequenceTask,'cancel')} onRetry={()=>taskControl(sequenceTask,'retry')}/>}
      {sequenceChallengeTask!==null&&<TaskStrip task={sequenceChallengeTask} onCancel={()=>taskControl(sequenceChallengeTask,'cancel')} onRetry={()=>taskControl(sequenceChallengeTask,'retry')}/>}
      {candidates.length>0&&<div className="chapter-sequence-candidates">{candidates.map(version=>
        <SequenceCandidate key={version.sequenceVersionId} version={version} busy={busy} challengers={challengers}
          challenge={challengeFor(sequenceChallengeTask,'sequence',sequence.sequenceId,version.sequenceVersionId)}
          challengeBusy={sequenceChallengeTask?.isRunning===true} onChallenge={(roleKey)=>challengeSequence(version,roleKey)} onConfirm={()=>confirm(version)}/>)}</div>}
    </section>}

    {sequence.activeVersion!==null&&<><section className="chapter-chain-section">
      <div className="planning-section-heading"><div><small>完整事件章链 · 已确认</small><h4>从第{sequence.activeVersion.content.startChapterNumber}章开始，共{sequence.outlines.length}章</h4>
        <p>每一章只承担一项清楚责任，最后一章覆盖全部事件结束条件。</p></div></div>
      <div className="chapter-chain">{sequence.outlines.map((outline,index)=><CoarseChapterCard key={outline.outlineId} item={outline}
        last={index===sequence.outlines.length-1}/>)}</div>
    </section>
    <section className="recent-detail-section">
      <div className="planning-section-heading"><div><small>{readOnly?'已完成事件 · 只读记录':'第二步'}</small><h4>{readOnly?'详细章纲完整保留':'只细化最近要写的章节'}</h4>
        <p>{readOnly?'这里展示正文生成时实际绑定的冻结章纲；进入下一卷后也不会隐藏。':firstChapterOnly?'黄金三章的总体承诺已经保留；现在只详细设计第一章，定稿后再按实际结果回校第二、三章。':'一次选择1—3章。后面的章暂不锁死，会根据正文实际结果继续滚动设计。'}</p></div>
        {!readOnly&&<div className="chapter-count-actions"><label>本轮细化<select value={detailCount} onChange={e=>setDetailCount(Number(e.target.value))}>
          {Array.from({length:available},(_,index)=><option key={index+1} value={index+1}>{index+1}章</option>)}</select></label>
          <button className="primary-button" disabled={busy||available===0||detailTask?.isRunning===true} type="button" onClick={generateDetails}>
            {detailTask?.isRunning===true?'编剧正在细化…':'生成详细章纲'}</button></div>}</div>
      {!readOnly&&nextIdeaOutline!==null&&<AuthorIdeaComposer key={nextIdeaOutline.outlineId} bookId={bookId} surface="chapter_outline"
        subjectType="event_chapter_outline" subjectId={nextIdeaOutline.outlineId} title={`对第${nextIdeaOutline.chapterNumber}章的想法`}/>}
      {!readOnly&&detailTask!==null&&<TaskStrip task={detailTask} onCancel={()=>taskControl(detailTask,'cancel')} onRetry={()=>taskControl(detailTask,'retry')}/>}
      {!readOnly&&detailChallengeTask!==null&&<TaskStrip task={detailChallengeTask} onCancel={()=>taskControl(detailChallengeTask,'cancel')} onRetry={()=>taskControl(detailChallengeTask,'retry')}/>}
      <div className="detailed-outline-grid" aria-label={readOnly?'历史详细章纲':undefined}>{detailItems.map(item=>{
        const version=item.activeVersion??item.versions[0]??null;
        return <DetailedOutlineCard key={item.outlineId} item={item} readOnly={readOnly} challengers={challengers}
          challenge={version===null?null:challengeFor(detailChallengeTask,'detail',item.outlineId,version.outlineVersionId)}
          challengeBusy={detailChallengeTask?.isRunning===true} onChallenge={(roleKey)=>challengeDetail(item,roleKey)}/>;
      })}</div>
      {!readOnly&&available>0&&<div className="freeze-chapters"><label>确认并冻结<select value={freezeCount} onChange={e=>setFreezeCount(Number(e.target.value))}>
        {Array.from({length:available},(_,index)=><option key={index+1} value={index+1}>{index+1}章</option>)}</select></label>
        <button className="primary-button" disabled={busy||pending.slice(0,freezeCount).some(item=>item.versions.length===0)}
          type="button" onClick={freeze}>确认近期章纲，进入正文</button></div>}
    </section></>}
    {!readOnly&&workflow.frozenChapterOutlineRefs.length>0&&<section className="writing-launch-card" aria-label="正文开始前确认">
      <div><small>第三步 · 正文准备</small><h4>{expression?.status==='confirmed'?'叙事方式已确认':'先确认这本书怎么讲述'}</h4>
        <p>{expression?.status==='confirmed'?'系统只会安排最前面一章，上一章未定稿前不会启动下一章。':'这不是固定文风模板，只确定人称和镜头距离；人物声音、对白和现场发挥仍由主笔完成。'}</p></div>
      {expression?.status!=='confirmed'?<div className="expression-confirmation">
        <label>叙述人称<select value={narrativePerson} onChange={event=>setNarrativePerson(event.target.value as typeof narrativePerson)}>
          <option value="third">第三人称（推荐，适合长篇多角色）</option><option value="first">第一人称（更贴近主角感受）</option><option value="mixed">按已确认场景切换</option>
        </select></label>
        <label>镜头距离<select value={viewpointDistance} onChange={event=>setViewpointDistance(event.target.value as typeof viewpointDistance)}>
          <option value="close">贴近人物（推荐）</option><option value="medium">适中，兼顾人物与全局</option><option value="distant">偏全局观察</option><option value="adaptive">随场景调整</option>
        </select></label>
        <button className="primary-button" type="button" disabled={busy} onClick={confirmExpression}>确认叙事方式</button>
      </div>:<div className="writing-launch-action"><span>{expression.narrativePerson==='first'?'第一人称':expression.narrativePerson==='mixed'?'按场景切换':'第三人称'} · {viewpointLabel(expression.viewpointDistance)}</span>
        <button className="primary-button" type="button" disabled={busy||writingTaskId!==null} onClick={startWriting}>{writingTaskId===null?'开始撰写下一章':'正文任务已建立'}</button></div>}
    </section>}
{!readOnly&&workflow.stage==='event_settlement_in_progress'&&<section className="writing-launch-card event-settlement-card">
      <div><small>当前事件已写完</small><h4>核对实际结果，完成事件结算</h4><p>结算只读取已经定稿的正文和已确认内容；原事件大纲只用于对照偏差，不会反过来覆盖实际剧情。</p></div>
      <div className="writing-launch-action"><button className="primary-button" type="button" disabled={busy} onClick={settleCurrentEvent}>完成事件，继续下一事件</button></div>
    </section>}
{readOnly&&eventId!==null&&<SettlementFollowUpCard bookId={bookId} stageKind="event" stageObjectId={eventId}/>}
{error!==null&&<p className="planning-error" role="alert">{error}</p>}
  </section>;
}

function FirstVolumeLaunchProgressCard({progress}:{progress:NonNullable<Awaited<ReturnType<typeof fetchFirstVolumeLaunchProgress>>>}){
  const projected=typeof progress.prediction.projectedClimaxAtEffectiveCharacters==='number'
    ?progress.prediction.projectedClimaxAtEffectiveCharacters:null;
  const action=typeof progress.prediction.recommendedAction==='string'?progress.prediction.recommendedAction:null;
  const risk=['at_risk','overdue','completed_late'].includes(progress.climaxStatus);
  return <aside className={'first-volume-progress '+(risk?'risk':progress.climaxStatus)} aria-label="首卷爆款节奏进度">
    <header><div><small>首卷强启动 · 按定稿正文追踪</small><h4>{launchStatusLabel(progress.climaxStatus)}</h4></div>
      <strong>{progress.totalEffectiveCharacters.toLocaleString('zh-CN')} / 100,000 有效字</strong></header>
    <p>已结算到第{progress.latestSettledChapterNumber}章。{projected===null?'高潮位置将在事件推进后估算。':`按当前事件与章节消耗，预计在约${projected.toLocaleString('zh-CN')}有效字完成高潮。`}</p>
    {action!==null&&<em>{action}</em>}
    {progress.actualEvidence!==null&&<p className="launch-completion-evidence">高潮承载事件已经实际结算；这里记录的是正文结果，不以原计划代替兑现证据。</p>}
  </aside>;
}
function launchStatusLabel(status:NonNullable<Awaited<ReturnType<typeof fetchFirstVolumeLaunchProgress>>>['climaxStatus']){
  return({planned:'高潮已规划',approaching:'正在进入高潮准备区',at_risk:'存在超过10万字风险',completed:'高潮已按时兑现',
    completed_late:'高潮已兑现但发生偏晚',overdue:'已超过10万字且高潮未结算'}as const)[status];
}
function SequenceCandidate({version,busy,challengers,challenge,challengeBusy,onChallenge,onConfirm}:{version:EventChapterSequenceVersionData;busy:boolean;
  challengers:Array<{roleKey:string;name:string}>;challenge:{advice:EventChapterChallengeContent;by:string}|null;challengeBusy:boolean;
  onChallenge:(challengerRoleKey:string)=>void;onConfirm:()=>void}){
  return <article><header><div><small>候选稿 {version.version}</small><h5>{version.content.eventTitle}</h5></div>
    <strong>{version.content.chapters.length}章</strong></header>
    {version.content.goldenThreeLaunch!==undefined&&<section className="golden-three-launch" aria-label="黄金三章总体启动包">
      <strong>前三章怎样让读者追下去</strong><p>{version.content.goldenThreeLaunch.overallPromise}</p>
      <ol>{version.content.goldenThreeLaunch.chapters.map(chapter=><li key={chapter.chapterNumber}><b>第{chapter.chapterNumber}章</b>
        <span>{chapter.responsibility}</span><small>{chapter.protagonistAction} → {chapter.deliveredPayoff} → {chapter.nextExpectation}</small></li>)}</ol>
      <em>第一章定稿后，保留总体承诺，再根据实际正文调整第二、三章的具体场景。</em>
    </section>}
    <ol>{version.content.chapters.map(chapter=><li key={chapter.chapterNumber}><b>第{chapter.chapterNumber}章 {chapter.title}</b>
      <span>{chapter.eventResponsibility}</span><small>{chapter.openingState} → {chapter.endingState}</small></li>)}</ol>
    <div className="closure-list"><b>事件闭环</b>{version.content.closureCoverage.map(item=>
      <span key={item.endingCondition}>第{item.evidenceChapterNumber}章：{item.endingCondition}</span>)}</div>
    {challenge!==null&&<ChallengeAdvice challenge={challenge.advice} by={challenge.by}/>}<div className="chapter-candidate-actions">
      {challengers.map(person=><button key={person.roleKey} className="secondary-button" disabled={busy||challengeBusy} type="button"
        onClick={()=>onChallenge(person.roleKey)}>{challengeBusy?'编剧正在看…':`请${person.name}看看`}</button>)}
      <button className="primary-button" disabled={busy} type="button" onClick={onConfirm}>确认这条完整章链</button>
    </div></article>;
}
function CoarseChapterCard({item,last}:{item:EventChapterOutlineData;last:boolean}){
  return <article className={"coarse-chapter "+item.status}><header><span>第{item.chapterNumber}章</span><b>{statusLabel(item.status)}</b></header>
    <h5>{item.planned.title}</h5><p>{item.planned.eventResponsibility}</p>
    <small>{item.planned.openingState}</small><i>↓</i><small>{item.planned.endingState}</small>
    {last&&<em>本章负责事件收束</em>}</article>;
}
function DetailedOutlineCard({item,readOnly,challengers,challenge,challengeBusy,onChallenge}:{item:EventChapterOutlineData;readOnly:boolean;
  challengers:Array<{roleKey:string;name:string}>;challenge:{advice:EventChapterChallengeContent;by:string}|null;challengeBusy:boolean;
  onChallenge:(challengerRoleKey:string)=>void}){
  const version=item.activeVersion??item.versions[0]??null;
  if(version===null)return <article className="detailed-outline empty"><small>第{item.chapterNumber}章</small><h5>{item.planned.title}</h5>
    <p>等待本轮详细设计</p></article>;
  const content=version.content;
  return <article className="detailed-outline"><header><div><small>第{item.chapterNumber}章 · 候选{version.version}</small><h5>{content.title}</h5></div>
    <span>{statusLabel(item.status)}</span></header><p><b>本章作用：</b>{content.chapterFunction}</p>
    <p><b>核心冲突：</b>{content.conflict.surface}</p><ol>{content.plotBeats.map(beat=><li key={beat.order}>{beat.action} → {beat.result}</li>)}</ol>
    <p><b>必须到达：</b>{content.requiredEndingState}</p>
    {content.firstChapterLaunch!==undefined&&<section className="first-chapter-launch" aria-label="第一章强启动合同">
      <strong>第一章开篇任务</strong><dl><div><dt>前500字为什么让人继续看</dt><dd>{content.firstChapterLaunch.first500InterestAnchor}</dd></div>
        <div><dt>主角眼前的处境</dt><dd>{content.firstChapterLaunch.immediateSituation}</dd></div>
        <div><dt>第一章必须发生的变化</dt><dd>{content.firstChapterLaunch.requiredEffectiveChange}</dd></div>
        <div><dt>第一次小回报</dt><dd>{content.firstChapterLaunch.firstPayoff}</dd></div>
        <div><dt>章末下一期待</dt><dd>{content.firstChapterLaunch.nextExpectation}</dd></div></dl>
      <em>{content.firstChapterLaunch.writerFreedom.join('；')}</em></section>}
    <details><summary>人物、边界与自由发挥</summary>
      <p>{content.cast.map(person=>person.name+'：'+person.objective).join('；')}</p>
      <p>不能违反：{content.mustNotViolate.join('；')}</p><p>自由发挥：{content.creativeFreedom.join('；')}</p></details>
    {challenge!==null&&<ChallengeAdvice challenge={challenge.advice} by={challenge.by}/>} {!readOnly&&<div className="chapter-challenge-row">
      {challengers.map(person=><button key={person.roleKey} className="secondary-button chapter-challenge-button"
        disabled={challengeBusy} type="button" aria-label={`请${person.name}看看第${item.chapterNumber}章`} onClick={()=>onChallenge(person.roleKey)}>
        {challengeBusy?'编剧正在看…':`请${person.name}看看`}</button>)}</div>}</article>;
}
function ChallengeAdvice({challenge,by}:{challenge:EventChapterChallengeContent;by:string}){
  return <aside className="chapter-challenge-advice"><small>{by}的参考意见</small><p>{challenge.summary}</p>
    <div>{challenge.suggestions.map(item=><article key={item.focus}><h6>{focusLabel(item.focus)}</h6>
      <p><b>另一种走法：</b>{item.alternative}</p><p><b>可能更好之处：</b>{item.benefit}</p>
      <p><b>需要承担的代价：</b>{item.tradeoff}</p><p><b>会影响后面什么：</b>{item.downstreamImpact}</p></article>)}</div>
    <em>这些只是参考，不会自动改动当前章纲。</em></aside>;
}
function challengeFor(task:EventChapterGenerationData|null,targetKind:'sequence'|'detail',targetId:string,targetVersionId:string){
  const challenge=task?.challenge;if(challenge===undefined||challenge.targetKind!==targetKind
    ||challenge.targetId!==targetId||challenge.targetVersionId!==targetVersionId)return null;
  return {advice:challenge,by:task?.members[0]?.displayName??'挑战编剧'};
}
function focusLabel(value:EventChapterChallengeContent['suggestions'][number]['focus']){return({chapter_structure:'章节安排',opening_pressure:'开场压力',
  core_conflict:'核心冲突',choice_and_cost:'人物选择与代价',turning_point:'关键转折',ending_hook:'结尾钩子',
  next_chapter_interface:'下一章承接'}as const)[value];}
function TaskStrip({task,onCancel,onRetry}:{task:EventChapterGenerationData;onCancel:()=>void;onRetry:()=>void}){
  return <aside className={"chapter-task-strip "+(task.isRunning?'working':'settled')}><div><span>{task.members[0]?.displayName??'创作成员'}</span>
    <b>{task.stateText} · {task.phaseText}</b>
    </div>
    {task.canCancel&&<button className="text-button" type="button" onClick={onCancel}>取消</button>}
    {task.canRetry&&<button className="secondary-button" type="button" onClick={onRetry}>继续完成</button>}</aside>;
}
function currentIdeas(items:Array<{authorInputId:string;status:string}>){return items.filter(item=>!['withdrawn','superseded'].includes(item.status)).map(item=>item.authorInputId);}
function viewpointLabel(value:ExpressionProfileData['viewpointDistance']){return({close:'贴近人物',medium:'适中',distant:'偏全局',adaptive:'随场景调整'}as Record<string,string>)[value??'']??'未确认';}
function statusLabel(status:string){return({planned:'待细化',candidate:'待确认',frozen:'已冻结',settled:'已定稿',archived:'已归档'}as Record<string,string>)[status]??'正在处理';}
function key(prefix:string){return prefix+':'+(globalThis.crypto?.randomUUID?.()??Date.now()+'-'+Math.random());}
function messageOf(reason:unknown){return reason instanceof Error?reason.message:'章纲操作没有完成，请稍后重试。';}
