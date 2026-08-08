import { useCallback,useEffect,useMemo,useState } from 'react';
import {
  cancelTask,confirmEventChapterSequence,fetchAuthorPlanningInputs,fetchCreationWorkflow,fetchExpressionProfile,
  fetchEventChapterGeneration,fetchEventChapterSequence,freezeRecentEventChapterOutlines,
  initializeEventChapterSequence,retryTask,saveExpressionProfile,settleStoryEvent,startEventChapterDetailGeneration,startWritingRun,
  startEventChapterSequenceGeneration,type EventChapterGenerationData,type EventChapterOutlineData,
  type EventChapterSequenceData,type EventChapterSequenceVersionData,type ExpressionProfileData
} from '../../lib/api/client';
import { AuthorIdeaComposer } from '../creation-desk/AuthorIdeaComposer';

export function EventChapterPlanningPanel({bookId,onOpenManuscript,onChanged}:{bookId:string;onOpenManuscript?:()=>void;onChanged?:()=>Promise<void>|void}):React.JSX.Element{
  const[workflow,setWorkflow]=useState<Awaited<ReturnType<typeof fetchCreationWorkflow>>|null>(null);
  const[sequence,setSequence]=useState<EventChapterSequenceData|null>(null);
  const[expression,setExpression]=useState<ExpressionProfileData|null>(null);
  const[narrativePerson,setNarrativePerson]=useState<'first'|'third'|'mixed'>('third');
  const[viewpointDistance,setViewpointDistance]=useState<'close'|'medium'|'distant'|'adaptive'>('close');
  const[writingTaskId,setWritingTaskId]=useState<string|null>(null);
  const[sequenceTask,setSequenceTask]=useState<EventChapterGenerationData|null>(null);
  const[detailTask,setDetailTask]=useState<EventChapterGenerationData|null>(null);
  const[detailCount,setDetailCount]=useState(1);
  const[freezeCount,setFreezeCount]=useState(1);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const eventId=workflow?.activeEventRef?.id??null;

  const load=useCallback(async(signal?:AbortSignal)=>{
    const[nextWorkflow,nextExpression]=await Promise.all([fetchCreationWorkflow(bookId,signal),fetchExpressionProfile(bookId,signal)]);
    setWorkflow(nextWorkflow);setExpression(nextExpression);
    if(nextExpression?.narrativePerson)setNarrativePerson(nextExpression.narrativePerson);
    if(nextExpression?.viewpointDistance)setViewpointDistance(nextExpression.viewpointDistance);
    const nextEventId=nextWorkflow.activeEventRef?.id??null;
    if(nextEventId===null){setSequence(null);setSequenceTask(null);setDetailTask(null);return;}
    const[nextSequence,nextSequenceTask,nextDetailTask]=await Promise.all([
      fetchEventChapterSequence(bookId,nextEventId,signal),
      fetchEventChapterGeneration(bookId,nextEventId,'sequence',signal),
      fetchEventChapterGeneration(bookId,nextEventId,'details',signal)
    ]);
    setSequence(nextSequence);setSequenceTask(nextSequenceTask);setDetailTask(nextDetailTask);
  },[bookId]);
  useEffect(()=>{const controller=new AbortController();setError(null);
    void load(controller.signal).catch(reason=>{if(!controller.signal.aborted)setError(messageOf(reason));});
    return()=>controller.abort();},[load]);
  useEffect(()=>{if(![sequenceTask,detailTask].some(task=>task!==null&&activeTask(task.status)))return;
    const controller=new AbortController(),timer=window.setInterval(()=>{
      void load(controller.signal).catch(reason=>{if(!controller.signal.aborted)setError(messageOf(reason));});
    },1250);
    return()=>{controller.abort();window.clearInterval(timer);};
  },[detailTask?.status,detailTask?.taskId,load,sequenceTask?.status,sequenceTask?.taskId]);

  const pending=useMemo(()=>sequence?.outlines.filter(item=>!['frozen','settled'].includes(item.status))??[],[sequence]);
  const available=Math.min(3,pending.length);
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
  const generateSequence=()=>{if(sequence===null||workflow===null||eventId===null)return;void run(async()=>{
    const refs=await ideaRefs('sequence');
    setSequenceTask(await startEventChapterSequenceGeneration(bookId,eventId,{expectedSequenceRevision:sequence.revision,
      expectedWorkflowVersion:workflow.planningVersion,authorInputRefs:refs,idempotencyKey:key('chapter-sequence-ai')}));
  });};
  const confirm=(version:EventChapterSequenceVersionData)=>{if(sequence===null||workflow===null||eventId===null)return;void run(async()=>{
    setSequence(await confirmEventChapterSequence(bookId,eventId,{sequenceVersionId:version.sequenceVersionId,
      expectedSequenceRevision:sequence.revision,expectedWorkflowVersion:workflow.planningVersion}));
  });};
  const generateDetails=()=>{if(sequence===null||workflow===null||eventId===null)return;void run(async()=>{
    const refs=await ideaRefs('details',detailCount);
    setDetailTask(await startEventChapterDetailGeneration(bookId,eventId,{count:detailCount,
      expectedSequenceRevision:sequence.revision,expectedWorkflowVersion:workflow.planningVersion,
      authorInputRefs:refs,idempotencyKey:key('chapter-details-ai')}));
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
  const startWriting=()=>void run(async()=>{
    const next=sequence?.outlines.find(item=>item.status==='frozen')??null;
    if(next===null)throw new Error('没有可用于正文的冻结章纲。');
    const batch=await startWritingRun(bookId,{chapterTitle:next.activeVersion?.content.title??next.planned.title});
    setWritingTaskId(batch.taskIds[0]??null);await onChanged?.();onOpenManuscript?.();
  });
  const settleCurrentEvent=()=>{if(eventId===null||workflow===null)return;void run(async()=>{
    await settleStoryEvent(bookId,eventId,workflow.planningVersion);await onChanged?.();
  });};
  const taskControl=(task:EventChapterGenerationData,action:'cancel'|'retry')=>void run(async()=>{
    if(action==='cancel')await cancelTask(bookId,task.taskId);else await retryTask(bookId,task.taskId);
  });

  if(workflow===null)return <section className="event-chapter-panel"><p>正在读取当前创作进度…</p></section>;
  if(eventId===null)return <section className="event-chapter-panel chapter-empty"><small>章纲设计</small><h3>先确认当前事件</h3>
    <p>章纲必须从已经确认的卷纲和事件大纲向下展开，不能脱离上层约束单独生成。</p></section>;
  if(sequence===null)return <section className="event-chapter-panel chapter-empty"><small>章纲设计</small><h3>建立当前事件的章链</h3>
    <p>先建立一个稳定的工作容器；随后由编剧设计完整事件章链，主编只细化最近1—3章。</p>
    <button className="primary-button" disabled={busy} type="button" onClick={initialize}>{busy?'正在建立…':'开始规划章纲'}</button>
    {error!==null&&<p className="planning-error" role="alert">{error}</p>}</section>;

  const candidates=sequence.versions.filter(version=>version.status==='candidate');
  const nextIdeaOutline=pending[0]??null;
  return <section className="event-chapter-panel">
    <header className="event-chapter-header"><div><span className="eyebrow">事件 → 完整章链 → 最近1—3章</span>
      <h3>{sequence.activeVersion?.content.eventTitle??candidates[0]?.content.eventTitle??'当前事件章纲'}</h3>
      <p>完整章链先保证事件因果与结尾闭环；详细章纲只冻结眼前要写的章节，给人物反应和现场创造保留空间。</p></div>
      <span className={"sequence-health "+(sequence.valid?'ready':'stale')}>{sequence.valid?'上层版本有效':'上层已变化，需重建'}</span></header>

    {sequence.activeVersionId===null&&<section className="chapter-sequence-design">
      <div className="planning-section-heading"><div><small>第一步</small><h4>设计完整事件章链</h4>
        <p>章数由事件实际需要决定，不固定为六章或十章；相邻章节的开场与结尾必须连续。</p></div>
        <button className="primary-button" type="button" disabled={busy||activeTask(sequenceTask?.status)}
          onClick={generateSequence}>{activeTask(sequenceTask?.status)?'编剧正在设计…':'让编剧设计完整章链'}</button></div>
      <AuthorIdeaComposer bookId={bookId} surface="chapter_outline" subjectType="event_chapter_sequence" subjectId={eventId}
        title="对整个事件章链的想法"/>
      {sequenceTask!==null&&<TaskStrip task={sequenceTask} onCancel={()=>taskControl(sequenceTask,'cancel')} onRetry={()=>taskControl(sequenceTask,'retry')}/>}
      {candidates.length>0&&<div className="chapter-sequence-candidates">{candidates.map(version=>
        <SequenceCandidate key={version.sequenceVersionId} version={version} busy={busy} onConfirm={()=>confirm(version)}/>)}</div>}
    </section>}

    {sequence.activeVersion!==null&&<><section className="chapter-chain-section">
      <div className="planning-section-heading"><div><small>完整事件章链 · 已确认</small><h4>从第{sequence.activeVersion.content.startChapterNumber}章开始，共{sequence.outlines.length}章</h4>
        <p>每一章只承担一项清楚责任，最后一章覆盖全部事件结束条件。</p></div></div>
      <div className="chapter-chain">{sequence.outlines.map((outline,index)=><CoarseChapterCard key={outline.outlineId} item={outline}
        last={index===sequence.outlines.length-1}/>)}</div>
    </section>
    <section className="recent-detail-section">
      <div className="planning-section-heading"><div><small>第二步</small><h4>只细化最近要写的章节</h4>
        <p>一次选择1—3章。后面的章暂不锁死，会根据正文实际结果继续滚动设计。</p></div>
        <div className="chapter-count-actions"><label>本轮细化<select value={detailCount} onChange={e=>setDetailCount(Number(e.target.value))}>
          {Array.from({length:available},(_,index)=><option key={index+1} value={index+1}>{index+1}章</option>)}</select></label>
          <button className="primary-button" disabled={busy||available===0||activeTask(detailTask?.status)} type="button" onClick={generateDetails}>
            {activeTask(detailTask?.status)?'主编正在细化…':'生成详细章纲'}</button></div></div>
      {nextIdeaOutline!==null&&<AuthorIdeaComposer key={nextIdeaOutline.outlineId} bookId={bookId} surface="chapter_outline"
        subjectType="event_chapter_outline" subjectId={nextIdeaOutline.outlineId} title={`对第${nextIdeaOutline.chapterNumber}章的想法`}/>}
      {detailTask!==null&&<TaskStrip task={detailTask} onCancel={()=>taskControl(detailTask,'cancel')} onRetry={()=>taskControl(detailTask,'retry')}/>}
      <div className="detailed-outline-grid">{pending.slice(0,3).map(item=><DetailedOutlineCard key={item.outlineId} item={item}/>)}</div>
      {available>0&&<div className="freeze-chapters"><label>确认并冻结<select value={freezeCount} onChange={e=>setFreezeCount(Number(e.target.value))}>
        {Array.from({length:available},(_,index)=><option key={index+1} value={index+1}>{index+1}章</option>)}</select></label>
        <button className="primary-button" disabled={busy||pending.slice(0,freezeCount).some(item=>item.versions.length===0)}
          type="button" onClick={freeze}>确认近期章纲，进入正文</button></div>}
    </section></>}
    {workflow.frozenChapterOutlineRefs.length>0&&<section className="writing-launch-card" aria-label="正文开始前确认">
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
{workflow.stage==='event_settlement_in_progress'&&<section className="writing-launch-card event-settlement-card">
      <div><small>当前事件已写完</small><h4>核对实际结果，完成事件结算</h4><p>结算只读取已经定稿的正文和正史；原事件大纲只用于对照偏差，不会反过来覆盖实际剧情。</p></div>
      <div className="writing-launch-action"><button className="primary-button" type="button" disabled={busy} onClick={settleCurrentEvent}>完成事件，继续下一事件</button></div>
    </section>}
{error!==null&&<p className="planning-error" role="alert">{error}</p>}
  </section>;
}

function SequenceCandidate({version,busy,onConfirm}:{version:EventChapterSequenceVersionData;busy:boolean;onConfirm:()=>void}){
  return <article><header><div><small>候选版本 {version.version}</small><h5>{version.content.eventTitle}</h5></div>
    <strong>{version.content.chapters.length}章</strong></header>
    <ol>{version.content.chapters.map(chapter=><li key={chapter.chapterNumber}><b>第{chapter.chapterNumber}章 {chapter.title}</b>
      <span>{chapter.eventResponsibility}</span><small>{chapter.openingState} → {chapter.endingState}</small></li>)}</ol>
    <div className="closure-list"><b>事件闭环</b>{version.content.closureCoverage.map(item=>
      <span key={item.endingCondition}>第{item.evidenceChapterNumber}章：{item.endingCondition}</span>)}</div>
    <button className="primary-button" disabled={busy} type="button" onClick={onConfirm}>确认这条完整章链</button></article>;
}
function CoarseChapterCard({item,last}:{item:EventChapterOutlineData;last:boolean}){
  return <article className={"coarse-chapter "+item.status}><header><span>第{item.chapterNumber}章</span><b>{statusLabel(item.status)}</b></header>
    <h5>{item.planned.title}</h5><p>{item.planned.eventResponsibility}</p>
    <small>{item.planned.openingState}</small><i>↓</i><small>{item.planned.endingState}</small>
    {last&&<em>本章负责事件收束</em>}</article>;
}
function DetailedOutlineCard({item}:{item:EventChapterOutlineData}){
  const version=item.activeVersion??item.versions[0]??null;
  if(version===null)return <article className="detailed-outline empty"><small>第{item.chapterNumber}章</small><h5>{item.planned.title}</h5>
    <p>等待本轮详细设计</p></article>;
  const content=version.content;
  return <article className="detailed-outline"><header><div><small>第{item.chapterNumber}章 · 候选{version.version}</small><h5>{content.title}</h5></div>
    <span>{statusLabel(item.status)}</span></header><p><b>本章作用：</b>{content.chapterFunction}</p>
    <p><b>核心冲突：</b>{content.conflict.surface}</p><ol>{content.plotBeats.map(beat=><li key={beat.order}>{beat.action} → {beat.result}</li>)}</ol>
    <p><b>必须到达：</b>{content.requiredEndingState}</p><details><summary>人物、边界与自由发挥</summary>
      <p>{content.cast.map(person=>person.name+'：'+person.objective).join('；')}</p>
      <p>不能违反：{content.mustNotViolate.join('；')}</p><p>自由发挥：{content.creativeFreedom.join('；')}</p></details></article>;
}
function TaskStrip({task,onCancel,onRetry}:{task:EventChapterGenerationData;onCancel:()=>void;onRetry:()=>void}){
  return <aside className={"chapter-task-strip "+task.status}><div><span>{task.member.displayName}</span>
    <b>{taskStatus(task.status)} · {phaseLabel(task.currentPhase)}</b>
    <small>{task.member.provider} / {task.member.modelId}</small></div>
    {activeTask(task.status)&&<button className="text-button" type="button" onClick={onCancel}>取消</button>}
    {['failed','interrupted','blocked'].includes(task.status)&&<button className="secondary-button" type="button" onClick={onRetry}>从检查点重试</button>}</aside>;
}
function currentIdeas(items:Array<{authorInputId:string;status:string}>){return items.filter(item=>!['withdrawn','superseded'].includes(item.status)).map(item=>item.authorInputId);}
function activeTask(status:string|undefined){return status!==undefined&&['pending','queued','working','paused'].includes(status);}
function taskStatus(status:string){return({pending:'准备中',queued:'等待执行',working:'正在工作',paused:'已暂停',succeeded:'候选已保存',
  failed:'本轮失败',interrupted:'任务中断',cancelled:'已取消',blocked:'等待处理'}as Record<string,string>)[status]??status;}
function phaseLabel(phase:string){return({preparing_context:'正在准备专用资料',sequence_candidate_saved:'完整章链候选已保存',
  detail_candidates_saved:'近期详细章纲已保存'}as Record<string,string>)[phase]??phase;}
function viewpointLabel(value:ExpressionProfileData['viewpointDistance']){return({close:'贴近人物',medium:'适中',distant:'偏全局',adaptive:'随场景调整'}as Record<string,string>)[value??'']??'未确认';}
function statusLabel(status:string){return({planned:'待细化',candidate:'待确认',frozen:'已冻结',settled:'已定稿',archived:'已归档'}as Record<string,string>)[status]??status;}
function key(prefix:string){return prefix+':'+(globalThis.crypto?.randomUUID?.()??Date.now()+'-'+Math.random());}
function messageOf(reason:unknown){return reason instanceof Error?reason.message:'章纲操作没有完成，请稍后重试。';}
