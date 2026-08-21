import { useCallback, useEffect, useMemo, useState } from 'react';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import type { EventChainContent, EventChainVersion, PlanningTemplateInstance, PublicNarrativeTemplate, StoryEventContent } from '@wenmi/contracts';
import {
  abandonStoryThread, actOnEventChainGeneration, actOnStoryEventGeneration, addEventChainVersion, addStoryEventVersion, applyEventOperation, confirmEventChain, confirmStoryEventVersion,
  fetchAuthorPlanningInputs, fetchCreationWorkflow, fetchEventChainGeneration, fetchEventChains,
  fetchEventSequence, fetchPlanningTemplates, fetchStoryEventGeneration, fetchStoryEventVersions, fetchStoryThreads,
  fetchVolumePlans, initializeEventSequence,
  previewEventOperation, previewStoryEventImpact, startEventChainGeneration, startStoryEventGeneration,
  type EventChainGenerationData, type EventOperationData, type EventOperationProposal, type EventSequenceData,
  type StoryEventData, type StoryEventGenerationData, type StoryEventImpactData, type StoryThreadData,
  type StoryEventVersionData, type VolumePlanData
} from '../../lib/api/client';
import { AuthorIdeaComposer } from '../creation-desk/AuthorIdeaComposer';
import {
  buildStoryEventPresentation,
  StoryCausalLink,
  StoryEventNodeCard,
  StoryEventPreview,
} from './StoryEventCard';
import { useMembershipGate } from '../shared/membership-gate';
import { SettingGapPanel } from './SettingGapPanel';
import { AgentAvatar } from '../shared/AgentAvatar';

interface EventWorkspaceSnapshot {
  workflow: Awaited<ReturnType<typeof fetchCreationWorkflow>>;
  plan: VolumePlanData | null;
  templates: Awaited<ReturnType<typeof fetchPlanningTemplates>>;
}

export function EventPlanningPanel({ bookId }: { bookId: string }): React.JSX.Element {
  const [snapshot,setSnapshot]=useState<EventWorkspaceSnapshot|null>(null);
  const [sequence,setSequence]=useState<EventSequenceData|null>(null);
  const [chainVersions,setChainVersions]=useState<EventChainVersion[]>([]);
  const [chainGeneration,setChainGeneration]=useState<EventChainGenerationData|null>(null);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [versions,setVersions]=useState<StoryEventVersionData[]>([]);
  const [generation,setGeneration]=useState<StoryEventGenerationData|null>(null);
  const [mode,setMode]=useState<'template'|'custom'|'none'>('none');
  const [selectedTemplates,setSelectedTemplates]=useState<PublicNarrativeTemplate[]>([]);
  const [customDirection,setCustomDirection]=useState('');
  const [draft,setDraft]=useState<StoryEventContent>(()=>emptyEvent('新事件'));
  const [editing,setEditing]=useState(false);
  const [presentationMode,setPresentationMode]=useState<'story'|'detail'>('story');
  const [impact,setImpact]=useState<StoryEventImpactData|null>(null);
  const [operation,setOperation]=useState<EventOperationData|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [storyThreads,setStoryThreads]=useState<StoryThreadData[]>([]);
  const [abandoningThreadId,setAbandoningThreadId]=useState<string|null>(null);
  const [abandonReason,setAbandonReason]=useState('');
  const {guardAi}=useMembershipGate();

  const load=useCallback(async(signal?:AbortSignal)=>{
    const[workflow,plans,templates,threads]=await Promise.all([
      fetchCreationWorkflow(bookId,signal),fetchVolumePlans(bookId,signal),fetchPlanningTemplates(bookId,'event',signal),
      fetchStoryThreads(bookId,signal).catch(()=>[])
    ]);
    const plan=[...plans].reverse().find(item=>['active','completed'].includes(item.status)&&item.activeVersionId!==null)??null;
    const [loadedSequence,nextChains,nextChainGeneration]:[
      EventSequenceData|null,EventChainVersion[],EventChainGenerationData|null
    ]=plan===null
      ?[null,[],null]
      :await Promise.all([
        fetchEventSequence(bookId,plan.volumePlanId,signal),
        fetchEventChains(bookId,plan.volumePlanId,signal),
        fetchEventChainGeneration(bookId,plan.volumePlanId,signal)
      ]);
    const nextSequence=loadedSequence!==null&&loadedSequence.volumePlanVersionId===plan?.activeVersionId?loadedSequence:null;
    setSnapshot({workflow,plan,templates});setSequence(nextSequence);setStoryThreads(threads);
    setChainVersions(nextChains);setChainGeneration(nextChainGeneration);
    setSelectedId(current=>current!==null&&nextSequence?.events.some(item=>item.eventId===current)
      ?current:nextSequence?.events[0]?.eventId??null);
  },[bookId]);

  useEffect(()=>{const controller=new AbortController();setError(null);
    void load(controller.signal).catch(reason=>{if(!controller.signal.aborted)setError(messageOf(reason));});
    return()=>controller.abort();},[load]);

  useEffect(()=>{const plan=snapshot?.plan;
    if(plan===null||plan===undefined||chainGeneration===null||!chainGeneration.isRunning||sequence!==null)return;
    const controller=new AbortController(),timer=window.setInterval(()=>{
      void Promise.all([
        fetchEventChainGeneration(bookId,plan.volumePlanId,controller.signal),
        fetchEventChains(bookId,plan.volumePlanId,controller.signal)
      ]).then(([nextGeneration,nextChains])=>{
        setChainGeneration(nextGeneration);setChainVersions(nextChains);
        if(nextGeneration!==null&&!nextGeneration.isRunning)void load();
      }).catch(reason=>{if(!controller.signal.aborted)setError(messageOf(reason));});
    },1250);return()=>{controller.abort();window.clearInterval(timer);};
  },[bookId,chainGeneration?.isRunning,chainGeneration?.candidateEventChainId,load,sequence,snapshot?.plan?.volumePlanId]);

  const selected=useMemo(()=>sequence?.events.find(item=>item.eventId===selectedId)??null,[selectedId,sequence]);
  useEffect(()=>{if(selected===null){setVersions([]);setGeneration(null);return;}
    const controller=new AbortController();
    void Promise.all([fetchStoryEventVersions(bookId,selected.eventId,controller.signal),
      fetchStoryEventGeneration(bookId,selected.eventId,controller.signal)]).then(([nextVersions,nextGeneration])=>{
        setVersions(nextVersions);setGeneration(nextGeneration);
      }).catch(reason=>{if(!controller.signal.aborted)setError(messageOf(reason));});
    setDraft(selected.activeVersion?.content??selected.latestVersion?.content??emptyEvent('新事件'));
    setEditing(false);setImpact(null);setOperation(null);
    return()=>controller.abort();
  },[bookId,selected?.eventId,selected?.activeVersionId]);

  useEffect(()=>{if(selected===null||generation===null||!generation.isRunning)return;
    const controller=new AbortController(),timer=window.setInterval(()=>{
      void Promise.all([fetchStoryEventGeneration(bookId,selected.eventId,controller.signal),
        fetchStoryEventVersions(bookId,selected.eventId,controller.signal)]).then(([nextGeneration,nextVersions])=>{
          setGeneration(nextGeneration);setVersions(nextVersions);
          if(nextGeneration!==null&&!nextGeneration.isRunning)void load();
        }).catch(reason=>{if(!controller.signal.aborted)setError(messageOf(reason));});
    },1250);return()=>{controller.abort();window.clearInterval(timer);};
  },[bookId,generation?.isRunning,generation?.updatedAt,load,selected?.eventId]);

  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError(null);try{await work();}catch(reason){setError(messageOf(reason));}finally{setBusy(false);}};

  const generateChain=()=>{if(snapshot?.plan===null||snapshot===null)return;if(!guardAi())return;void run(async()=>{
    const authorInputRefs=(await fetchAuthorPlanningInputs(bookId,{
      surface:'event',subjectType:'event_sequence',subjectId:snapshot.plan!.volumePlanId
    })).filter(item=>!['withdrawn','superseded'].includes(item.status)).map(item=>item.authorInputId);
    const next=await startEventChainGeneration(bookId,snapshot.plan!.volumePlanId,{
      expectedWorkflowVersion:snapshot.workflow.planningVersion,authorInputRefs,idempotencyKey:key('event-chain-team')
    });setChainGeneration(next);if(!next.isRunning)await load();
  });};

  const saveChain=(chain:EventChainVersion,content:EventChainContent)=>{if(snapshot?.plan===null||snapshot===null)return;void run(async()=>{
    await addEventChainVersion(bookId,snapshot.plan!.volumePlanId,{
      content,parentVersionId:chain.id,idempotencyKey:key('event-chain-author')
    });await load();
  });};

  const confirmChain=(eventChainVersionId:string)=>{if(snapshot?.plan===null||snapshot===null)return;void run(async()=>{
    await confirmEventChain(bookId,snapshot.plan!.volumePlanId,eventChainVersionId);await load();
  });};

  const chainTaskAction=(action:'cancel'|'retry'|'resume')=>{if(snapshot?.plan===null||snapshot===null||chainGeneration===null)return;void run(async()=>{
    await actOnEventChainGeneration(bookId,snapshot.plan!.volumePlanId,action);
    setChainGeneration(await fetchEventChainGeneration(bookId,snapshot.plan!.volumePlanId));
  });};

  const initialize=()=>{if(snapshot?.plan===null||snapshot===null)return;void run(async()=>{
    const next=await initializeEventSequence(bookId,snapshot.plan!.volumePlanId,{
      expectedWorkflowVersion:snapshot.workflow.planningVersion,idempotencyKey:key('event-sequence')
    });setSequence(next);setSelectedId(next.events[0]?.eventId??null);await load();
  });};

  const authorRefs=async(eventId:string)=>(await fetchAuthorPlanningInputs(bookId,{
    surface:'event',subjectType:'story_event',subjectId:eventId
  })).filter(item=>!['withdrawn','superseded'].includes(item.status)).map(item=>item.authorInputId);

  const generate=()=>{if(selected===null||snapshot===null)return;if(!guardAi())return;void run(async()=>{
    setGeneration(await startStoryEventGeneration(bookId,selected.eventId,{
      expectedEventRevision:selected.revision,expectedActiveVersionId:selected.activeVersionId,
      expectedWorkflowVersion:snapshot.workflow.planningVersion,template:templateInstance(mode,selectedTemplates,customDirection),
      authorInputRefs:await authorRefs(selected.eventId),idempotencyKey:key('event-team')
    }));
  });};

  const saveDraft=()=>{if(selected===null)return;void run(async()=>{
    const saved=await addStoryEventVersion(bookId,selected.eventId,{
      expectedEventRevision:selected.revision,candidateKind:'author_edit',parentVersionId:selected.activeVersionId,
      authorInputRefs:await authorRefs(selected.eventId),template:templateInstance(mode,selectedTemplates,customDirection),
      content:draft,idempotencyKey:key('event-author')
    });setVersions(await fetchStoryEventVersions(bookId,selected.eventId));setEditing(false);
    setImpact(await previewStoryEventImpact(bookId,selected.eventId,saved.storyEventVersionId));
  });};

  const previewVersion=(version:StoryEventVersionData)=>{if(selected===null)return;setDraft(version.content);
    void run(async()=>setImpact(await previewStoryEventImpact(bookId,selected.eventId,version.storyEventVersionId)));};

  const confirmVersion=()=>{if(selected===null||snapshot===null||impact===null)return;void run(async()=>{
    await confirmStoryEventVersion(bookId,selected.eventId,{versionId:impact.candidateVersionId,
      expectedEventRevision:selected.revision,expectedWorkflowVersion:snapshot.workflow.planningVersion});
    setImpact(null);await load();
  });};

  const abandonThread=()=>{if(abandoningThreadId===null)return;void run(async()=>{
    await abandonStoryThread(bookId,abandoningThreadId,abandonReason);setAbandoningThreadId(null);setAbandonReason('');await load();
  });};
  const taskAction=(action:'cancel'|'retry'|'resume')=>{if(selected===null||generation===null)return;void run(async()=>{
    await actOnStoryEventGeneration(bookId,selected.eventId,action);
    setGeneration(await fetchStoryEventGeneration(bookId,selected.eventId));
  });};

  const previewStructure=(proposal:EventOperationProposal)=>{const volumePlanId=snapshot?.plan?.volumePlanId;if(sequence===null||volumePlanId===undefined)return;void run(async()=>{
    setOperation(await previewEventOperation(bookId,volumePlanId,{
      expectedSequenceRevision:sequence.revision,proposal,idempotencyKey:key('event-operation')
    }));
  });};

  const applyStructure=()=>{const volumePlanId=snapshot?.plan?.volumePlanId;if(sequence===null||volumePlanId===undefined||operation===null)return;void run(async()=>{
    const next=await applyEventOperation(bookId,volumePlanId,{
      operationId:operation.operationId,expectedSequenceRevision:sequence.revision
    });setSequence(next);setOperation(null);setSelectedId(next.events[0]?.eventId??null);await load();
  });};

  const move=(direction:-1|1)=>{if(sequence===null||selected===null)return;
    const ids=sequence.events.map(item=>item.eventId),from=ids.indexOf(selected.eventId),to=from+direction;
    if(to<0||to>=ids.length)return;[ids[from],ids[to]]=[ids[to]!,ids[from]!];
    previewStructure({operationKind:'reorder',eventIds:ids});
  };
  const insertAfter=()=>{if(selected===null)return;previewStructure({operationKind:'insert',afterEventId:selected.eventId,
    content:emptyEvent('新增事件')});};
  const split=()=>{if(selected===null)return;const source=selected.activeVersion?.content??selected.latestVersion?.content??draft;
    previewStructure({operationKind:'split',eventId:selected.eventId,
      first:{...source,title:source.title+'（前段）',nextEventImpact:'本段结果直接触发同一事件的后段冲突'},
      second:{...source,title:source.title+'（后段）',startingState:'承接前段已经发生的结果与代价'}});
  };
  const mergeNext=()=>{if(sequence===null||selected===null)return;const next=sequence.events.find(item=>item.order===selected.order+1);
    if(next===undefined)return;const a=selected.activeVersion?.content??selected.latestVersion?.content??draft;
    const b=next.activeVersion?.content??next.latestVersion?.content??emptyEvent('后续事件');
    previewStructure({operationKind:'merge',eventIds:[selected.eventId,next.eventId],merged:mergeEvents(a,b)});
  };

  if(snapshot===null)return <section className="event-planning-panel"><p>{error??'正在读取当前事件链…'}</p></section>;
  if(snapshot.plan===null)return <section className="event-planning-panel event-empty-state"><h3>先确认当前卷规划</h3><p>事件必须服务于当前卷目标。确认卷规划后，这里会建立有因果关系的事件链。</p></section>;
  if(sequence===null){
    const activeChain=chainVersions.find(item=>item.status==='active')??null;
    const candidateChain=[...chainVersions].reverse().find(item=>item.status==='candidate')
      ??chainVersions.find(item=>item.id===chainGeneration?.candidateEventChainId&&item.status==='candidate')??null;
    const displayChain=candidateChain??activeChain;
    return <EventChainDesignCard
      bookId={bookId}
      volumePlanId={snapshot.plan.volumePlanId}
      chain={displayChain}
      active={displayChain?.status==='active'}
      generation={chainGeneration}
      busy={busy}
      error={error}
      onGenerate={generateChain}
      onSave={saveChain}
      onConfirm={()=>{if(candidateChain!==null)confirmChain(candidateChain.id);}}
      onInitialize={initialize}
      onTaskAction={chainTaskAction}
    />;
  }
  if(snapshot.plan.status==='completed')return <CompletedEventPlanningView plan={snapshot.plan} sequence={sequence}
    selected={selected} selectedId={selectedId} versions={versions} onSelect={setSelectedId}/>;

  const recommendedTemplates=snapshot.templates.templates.filter(template=>template.recommended);
  const additionalTemplates=snapshot.templates.templates.filter(template=>!template.recommended);
  const renderTemplate=(template:PublicNarrativeTemplate)=>{const emotion=eventEmotionGuide(template);return <button type="button"
    className={mode==='template'&&selectedTemplates.some(item=>item.templateKey===template.templateKey)?'selected':''}
    aria-pressed={mode==='template'&&selectedTemplates.some(item=>item.templateKey===template.templateKey)}
    key={template.templateKey} onClick={()=>{setSelectedTemplates(current=>{const next=current.some(item=>item.templateKey===template.templateKey)
      ?[]:[template];setMode(next.length===0?'none':'template');return next;});}}>
    <span aria-hidden="true">{emotion.emoji}</span><strong>{emotion.label}</strong><p>{emotion.explanation}</p></button>;};

  return <section className="event-planning-panel" aria-labelledby="event-planning-title">
    <header className="event-planning-header"><h3 id="event-planning-title" className="sr-only">规划</h3>
      <div className="event-sequence-meta"><small>当前卷</small><strong>{snapshot.plan.activeVersion?.content.title}</strong></div>
    </header>
    {error!==null&&<p className="inline-error" role="alert">{error}</p>}
    <SettingGapPanel bookId={bookId}/>
    <div className="event-chain story-artery" aria-label="事件因果链">{sequence.events.map((item,index)=>{const content=eventContentOf(item);
      const next=sequence.events[index+1]??null,nextContent=next===null?null:eventContentOf(next);
      const presentation=eventPresentation(sequence,item,content);
      return <div className="event-chain-node" key={item.eventId}>
        <StoryEventNodeCard title={content.title} order={item.order} status={eventStatus(item.status)}
          presentation={presentation} selected={item.eventId===selectedId} onSelect={()=>setSelectedId(item.eventId)}/>
        {next!==null&&<StoryCausalLink from={content} to={nextContent!}
          actual={eventVersionOf(next)?.previousSettlementId!=null}/>}
      </div>;})}</div>

    {selected!==null&&<div className="event-workspace-grid">
      <main>
        <section className="event-focus-card"><header><div><small>当前选择 · 事件 {selected.order}</small>
          <h4>{selected.activeVersion?.content.title??selected.latestVersion?.content.title}</h4></div>
          <span>{selected.activeVersionId===null?'等待确认':'已确认，可继续章纲'}</span></header>
          <StoryViewSwitch value={presentationMode} onChange={setPresentationMode}/>
          {presentationMode==='story'?<StoryEventPreview presentation={eventPresentation(sequence,selected,eventContentOf(selected))}/>:<>
            <p className="event-causality-guide">上一事件实际结果 → 主角与局面新状态 → 无法回避的新问题 → 主角选择与代价 → 本事件结果 → 结尾钩子与下一事件接口</p>
            <dl><div><dt>进入时的主角与局面</dt><dd>{selected.latestVersion?.content.startingState}</dd></div>
              <div><dt>从当前状态怎样触发</dt><dd>{selected.latestVersion?.content.trigger}</dd></div>
              <div><dt>人物必须作出的选择与代价</dt><dd>{selected.latestVersion?.content.choicesAndCosts.join('；')||'等待补充'}</dd></div>
              <div><dt>必须形成的事件结果</dt><dd>{selected.latestVersion?.content.requiredResult}</dd></div>
              <div><dt>人物与关系的新状态</dt><dd>{selected.latestVersion?.content.characterArcImpact}</dd></div>
              <div><dt>结尾钩子与下一事件接口</dt><dd>{selected.latestVersion?.content.nextEventImpact}</dd></div></dl></>}
          <div className="button-row"><button type="button" disabled={busy||selected.order===1} onClick={()=>move(-1)}>向前移动</button>
            <button type="button" disabled={busy||selected.order===sequence.events.length} onClick={()=>move(1)}>向后移动</button>
            <button type="button" disabled={busy} onClick={insertAfter}>在后面加事件</button>
            <button type="button" disabled={busy} onClick={split}>拆成两个事件</button>
            <button type="button" disabled={busy||selected.order===sequence.events.length} onClick={mergeNext}>与下一个合并</button></div>
        </section>

        <section className="event-template-section"><header><div><h4>这段剧情最想让读者感受到什么？</h4><p>可选且一次只选一种。它只告诉编剧希望形成的阅读感受，不是必须完成的配方，也不会限制具体写法。</p></div>{mode==='template'&&<span>已选一种</span>}</header>
          <div className="template-choice-group recommended"><div className="template-choice-heading"><div><strong>根据当前故事推荐</strong><small>结合题材、当前卷、人物处境和已经发生的结果排序</small></div><span>{recommendedTemplates.length} 种</span></div>
            <div className="event-template-grid emotion-goal-grid">{recommendedTemplates.map(renderTemplate)}</div></div>
          {additionalTemplates.length>0&&<details className="template-choice-group template-more-options"><summary><span><strong>查看更多阅读感受</strong><small>推荐只负责排序，不限制你的选择</small></span><b>{additionalTemplates.length} 种</b></summary>
            <div className="event-template-grid emotion-goal-grid">{additionalTemplates.map(renderTemplate)}</div></details>}
          <div className="event-template-grid template-alternative-grid">
            <button type="button" aria-pressed={mode==='custom'} className={mode==='custom'?'selected':''} onClick={()=>setMode('custom')}><span>✨</span><strong>我有自己的感觉</strong><p>用一句话告诉编剧，希望读者经历什么。</p></button>
            <button type="button" aria-pressed={mode==='none'} className={mode==='none'?'selected':''} onClick={()=>setMode('none')}><span>🌿</span><strong>让故事自然发生</strong><p>不指定阅读感受，由人物和因果决定这一幕。</p></button></div>
          {mode==='custom'&&<textarea rows={3} value={customDirection} onChange={e=>setCustomDirection(e.target.value)}
            placeholder="例如：希望主角用之前掌握的信息诱使对手犯错，但胜利要伤害一段重要关系。" />}
        </section>

        <AuthorIdeaComposer bookId={bookId} surface="event" subjectType="story_event" subjectId={selected.eventId}
          title="告诉团队你对这个事件的想法" />

        <section className={`event-generation-card ${generation?.isRunning===true?'working':''}`}>
          <header><h4>团队设计</h4>
            <button className="primary-button" type="button" disabled={busy||(generation?.isRunning===true)} onClick={generate}>
              {generation?.isCompleted===true?'再设计一组':'开始设计事件'}</button></header>
          {generation!==null&&<><div className="event-generation-summary" role="status"><strong>{generation.stateText}</strong>
            <span>{generation.phaseText}</span></div>
            <div className="event-generation-members">{generation.members.map(member=><article key={member.roleKey}>
              <AgentAvatar roleKey={member.roleKey} roleName={member.displayName} /><strong>{member.displayName}</strong></article>)}</div>
            <div className="button-row">{generation.canCancel&&<button onClick={()=>taskAction('cancel')}>停止本轮</button>}
              {generation.canResume&&<button onClick={()=>taskAction('resume')}>继续本轮</button>}
              {generation.canRetry&&<button onClick={()=>taskAction('retry')}>继续完成</button>}</div></>}
        </section>

        <section className="event-version-section"><header><div><h4>方案与历史稿</h4><p>编剧方案、主编融合稿和作者修改稿都会保留，不互相覆盖。</p></div>
          <button type="button" onClick={()=>{setDraft(selected.activeVersion?.content??selected.latestVersion?.content??emptyEvent('新事件'));setEditing(value=>!value);}}>
            {editing?'收起编辑':'修改事件内容'}</button></header>
          {editing&&<EventEditor value={draft} onChange={setDraft} onSave={saveDraft} busy={busy}/>}
          <div className="event-version-grid">{versions.map(version=><article key={version.storyEventVersionId}
            className={version.storyEventVersionId===selected.activeVersionId?'active':''}>
            <header><span>{candidateLabel(version.candidateKind)}</span><strong>第 {version.version} 稿 · {versionStatus(version.status)}</strong></header>
            <h5>{version.content.title}</h5>{presentationMode==='story'
              ?<StoryEventPreview compact presentation={eventPresentation(sequence,selected,version.content,version.previousSettlementId)}/>
              :<><p>{version.content.volumeResponsibility}</p><dl><dt>关键选择与代价</dt><dd>{version.content.choicesAndCosts.join('；')||'待补充'}</dd>
                <dt>事件结果</dt><dd>{version.content.requiredResult}</dd><dt>后续接口</dt><dd>{version.content.nextEventImpact}</dd></dl></>}
            {version.content.fusionNotes!=null&&<div className="fusion-notes">
              <p><strong>爽点怎么兑现</strong>{version.content.fusionNotes.payoffDesign}</p>
              <p><strong>逻辑链怎么闭环</strong>{version.content.fusionNotes.logicChain}</p>
              <p><strong>新鲜感来自哪里</strong>{version.content.fusionNotes.freshness}</p>
            </div>}
            <button type="button" disabled={busy} onClick={()=>previewVersion(version)}>查看并准备确认</button></article>)}</div>
        </section>
      </main>
      <aside className="event-side-panel">
        <section><h4>当前事件边界</h4><dl><dt>必须服务本卷</dt><dd>{selected.latestVersion?.content.volumeResponsibility}</dd>
          <dt>留给后续自由发挥</dt><dd>{selected.latestVersion?.content.flexibleExecution.join('；')}</dd>
          <dt>预计篇幅</dt><dd>{rangeLabel(selected.latestVersion?.content)}</dd></dl></section>
        <section><h4>链路记录</h4><p>已有 {sequence.operations.length} 次结构预览或调整，全部保留历史。</p>
          <ul>{sequence.operations.slice(0,5).map(item=><li key={item.operationId}>{operationLabel(item.operationKind)} · {item.status==='applied'?'已应用':'仅预览'}</li>)}</ul></section>
        <section className="story-thread-ledger"><h4>未解决的承诺与伏笔</h4><p>规划只登记责任；只有正文定稿并完成事件结算，状态才会变成已埋、推进或解决。</p>
          {storyThreads.filter(thread=>!['resolved','abandoned_by_author'].includes(thread.status)).length===0?<small>当前没有需要追踪的故事线。</small>:
            <ul>{storyThreads.filter(thread=>!['resolved','abandoned_by_author'].includes(thread.status)).map(thread=><li key={thread.threadId}>
              <div><strong>{thread.title}</strong><span>{threadStatusLabel(thread.status)}{thread.actualEvidenceCount>0?` · ${thread.actualEvidenceCount}份正文证据`:''}</span></div>
              {abandoningThreadId===thread.threadId?<div className="story-thread-abandon"><textarea rows={2} value={abandonReason}
                onChange={event=>setAbandonReason(event.target.value)} placeholder="为什么不再继续这条线？这个原因会保留。"/>
                <div><button type="button" onClick={()=>{setAbandoningThreadId(null);setAbandonReason('');}}>取消</button>
                  <button type="button" disabled={busy||abandonReason.trim().length<2} onClick={abandonThread}>确认放弃</button></div></div>:
                <button className="text-button" type="button" onClick={()=>setAbandoningThreadId(thread.threadId)}>不再继续这条线</button>}
            </li>)}</ul>}
        </section>
      </aside>
    </div>}

    {impact!==null&&<aside className="event-impact-card"><div><strong>确认前影响预览</strong><p>{impact.note}</p></div>
      <dl><dt>改变的部分</dt><dd>{impact.changedFields.map(fieldLabel).join('、')||'无'}</dd>
        <dt>已有下游内容</dt><dd>{impact.downstreamDependencyCount} 项</dd></dl>
      <div className="button-row"><button onClick={()=>setImpact(null)}>先不确认</button>
        <button className="primary-button" disabled={busy} onClick={confirmVersion}>确认这份稿</button></div></aside>}
    {operation!==null&&<aside className="event-operation-card"><div><strong>结构调整预览</strong><p>{operation.impact.note}</p></div>
      <dl><dt>操作</dt><dd>{operationLabel(operation.operationKind)}</dd><dt>影响事件</dt><dd>{operation.impact.affectedEventIds.length} 个</dd>
        <dt>结果</dt><dd>{operation.impact.resultingTitles.join('、')}</dd></dl>
      <div className="button-row"><button onClick={()=>setOperation(null)}>取消</button>
        <button className="primary-button" disabled={busy||operation.impact.blocked} onClick={applyStructure}>应用调整</button></div></aside>}
  </section>;
}

function EventChainDesignCard({bookId,volumePlanId,chain,active,generation,busy,error,onGenerate,onSave,onConfirm,onInitialize,onTaskAction}:{
  bookId:string;volumePlanId:string;chain:EventChainVersion|null;active:boolean;generation:EventChainGenerationData|null;busy:boolean;error:string|null;
  onGenerate:()=>void;onSave:(chain:EventChainVersion,content:EventChainContent)=>void;onConfirm:()=>void;
  onInitialize:()=>void;onTaskAction:(action:'cancel'|'retry'|'resume')=>void;
}):React.JSX.Element{
  const working=generation?.isRunning===true;
  const[editing,setEditing]=useState(false);
  const[draft,setDraft]=useState<EventChainContent|null>(chain?.content??null);
  useEffect(()=>{setDraft(chain?.content??null);setEditing(false);},[chain?.id]);
  return <section className="event-planning-panel event-chain-design-card" aria-label="当前卷事件链设计">
    <header><div><span className="eyebrow">卷方向已经确认</span><h3>把大故事方向拆成连续的小故事</h3><p>团队只设计事件之间的进入状态、人物行动、阻力、回报或代价和因果交接；章数、场景和对白留到后面。</p></div>
      {chain===null&&!working&&<button className="primary-button" type="button" disabled={busy} onClick={onGenerate}>让团队设计事件链</button>}
    </header>
    {error!==null&&<p className="inline-error" role="alert">{error}</p>}
    {chain===null&&<details className="event-chain-author-ideas"><summary>补充你想要的事件顺序（可选）</summary>
      <AuthorIdeaComposer bookId={bookId} surface="event" subjectType="event_sequence" subjectId={volumePlanId}
        title="告诉AI这卷要怎样拆成小故事"/>
    </details>}
    <SettingGapPanel bookId={bookId}/>
    {generation!==null&&<section className="event-chain-generation-status" role="status">
      <div><strong>{working?'团队正在拆分事件':generation.isCompleted?'事件链候选已准备好':'本轮事件链未完成'}</strong>
        <span>{generation.phaseText}</span></div>
      <div>{generation.members.map(member=><span key={member.roleKey}><AgentAvatar roleKey={member.roleKey} roleName={member.displayName} />{member.displayName}</span>)}</div>
      <footer>
        {generation.canCancel&&<button type="button" disabled={busy} onClick={()=>onTaskAction('cancel')}>停止本轮</button>}
        {generation.canResume&&<button type="button" disabled={busy} onClick={()=>onTaskAction('resume')}>继续本轮</button>}
        {generation.canRetry&&<button type="button" disabled={busy} onClick={()=>onTaskAction('retry')}>继续完成</button>}
      </footer>
    </section>}
    {chain!==null&&<section className="event-chain-candidate">
      <header><div><strong>{active?'已经确认的事件链':'团队给出的事件链候选'}</strong><small>{chain.content.events.length} 个连续事件</small></div><span>{active?'已确认':'待你确认'}</span></header>
      <ol>{chain.content.events.map(event=><li key={event.nodeId}>
        <div><small>事件 {event.order}</small><strong>{event.title}</strong></div>
        <dl><div><dt>人物行动</dt><dd>{event.protagonistAction}</dd></div><div><dt>阻力怎样升级</dt><dd>{event.oppositionEscalation}</dd></div><div><dt>回报或代价</dt><dd>{event.stagePayoffOrCost}</dd></div><div><dt>结束后变成什么局面</dt><dd>{event.exitState}</dd></div></dl>
        {event.leadsToNext!==null&&<p><b>接到下一个事件：</b>{event.leadsToNext}</p>}
        {(event.plantThreadIds.length>0||event.payoffThreadIds.length>0||event.consequenceThreadIds.length>0)&&<div className="event-thread-responsibilities">
          {event.plantThreadIds.length>0&&<span><b>本事件埋下</b>{event.plantThreadIds.join('、')}</span>}
          {event.payoffThreadIds.length>0&&<span><b>本事件兑现</b>{event.payoffThreadIds.join('、')}</span>}
          {event.consequenceThreadIds.length>0&&<span><b>交给后续</b>{event.consequenceThreadIds.join('、')}</span>}
        </div>}
      </li>)}</ol>
      {editing&&draft!==null&&<EventChainEditor value={draft} onChange={setDraft}/>}
      <footer><button type="button" disabled={busy||working} onClick={()=>setEditing(value=>!value)}>{editing?'收起修改':'修改这条链'}</button>
        {editing&&draft!==null&&<button type="button" disabled={busy} onClick={()=>onSave(chain,draft)}>保存为我的版本</button>}
        {active
          ?<button className="primary-button" type="button" disabled={busy||editing} onClick={onInitialize}>按这条链进入逐事件设计</button>
          :<><button type="button" disabled={busy||working} onClick={onGenerate}>重新设计</button><button className="primary-button" type="button" disabled={busy||working||editing} onClick={onConfirm}>确认这条事件链</button></>}
      </footer>
    </section>}
  </section>;
}

function EventChainEditor({value,onChange}:{value:EventChainContent;onChange:(value:EventChainContent)=>void}):React.JSX.Element{
  const update=(index:number,field:'title'|'protagonistAction'|'oppositionEscalation'|'stagePayoffOrCost'|'exitState'|'leadsToNext',next:string)=>{
    const events=value.events.map((event,eventIndex)=>eventIndex===index?{...event,[field]:field==='leadsToNext'&&next.trim()===''?null:next}:event);
    onChange({...value,events});
  };
  return <section className="event-chain-editor" aria-label="修改事件链">
    <header><strong>修改具体故事走向</strong><p>责任覆盖、伏笔引用和因果位置由系统保留；你只需调整人物怎样行动、阻力怎样升级、得到什么和怎样接到下一件事。</p></header>
    <div>{value.events.map((event,index)=><article key={event.nodeId}><h4>事件 {event.order}</h4>
      <label><span>事件名称</span><input value={event.title} onChange={e=>update(index,'title',e.target.value)}/></label>
      <label><span>人物行动</span><textarea rows={2} value={event.protagonistAction} onChange={e=>update(index,'protagonistAction',e.target.value)}/></label>
      <label><span>阻力怎样升级</span><textarea rows={2} value={event.oppositionEscalation} onChange={e=>update(index,'oppositionEscalation',e.target.value)}/></label>
      <label><span>回报或代价</span><textarea rows={2} value={event.stagePayoffOrCost} onChange={e=>update(index,'stagePayoffOrCost',e.target.value)}/></label>
      <label><span>结束后变成什么局面</span><textarea rows={2} value={event.exitState} onChange={e=>update(index,'exitState',e.target.value)}/></label>
      {event.leadsToNext!==null&&<label><span>怎样接到下一个事件</span><textarea rows={2} value={event.leadsToNext} onChange={e=>update(index,'leadsToNext',e.target.value)}/></label>}
    </article>)}</div>
  </section>;
}
function CompletedEventPlanningView({plan,sequence,selected,selectedId,versions,onSelect}:{
  plan:VolumePlanData;sequence:EventSequenceData;selected:StoryEventData|null;selectedId:string|null;
  versions:StoryEventVersionData[];onSelect:(eventId:string)=>void;
}):React.JSX.Element{
  const[presentationMode,setPresentationMode]=useState<'story'|'detail'>('story');
  const content=selected?.activeVersion?.content??selected?.latestVersion?.content??null;
  return <section className="event-planning-panel completed-planning-history" aria-label="completed-event-history">
    <header className="event-planning-header"><div><span className="eyebrow">已完成卷 · 只读记录</span>
      <h3>事件链和事件大纲仍然完整保留</h3><p>本卷已经结算。这里展示当时确认的规划与全部历史稿，不会因为进入下一卷而隐藏。</p></div>
      <div className="event-sequence-meta"><small>已完成卷</small><strong>{plan.activeVersion?.content.title}</strong><span>事件链第 {sequence.revision} 稿</span></div></header>
    <div className="event-chain story-artery" aria-label="已完成事件因果链">{sequence.events.map((item,index)=>{const itemContent=eventContentOf(item);
      const next=sequence.events[index+1]??null,nextContent=next===null?null:eventContentOf(next);
      return <div className="event-chain-node" key={item.eventId}>
        <StoryEventNodeCard title={itemContent.title} order={item.order} status={eventStatus(item.status)}
          presentation={eventPresentation(sequence,item,itemContent)} selected={item.eventId===selectedId} onSelect={()=>onSelect(item.eventId)}/>
        {next!==null&&<StoryCausalLink from={itemContent} to={nextContent!} actual={eventVersionOf(next)?.previousSettlementId!=null}/>}
      </div>;})}</div>
    {content!==null&&<div className="event-workspace-grid"><main>
      <section className="event-focus-card"><header><div><small>事件 {selected?.order} · 已确认大纲</small><h4>{content.title}</h4></div><span>历史只读</span></header>
        <StoryViewSwitch value={presentationMode} onChange={setPresentationMode}/>
        {presentationMode==='story'?<StoryEventPreview presentation={eventPresentation(sequence,selected!,content)}/>:<dl>
          <div><dt>服务本卷</dt><dd>{content.volumeResponsibility}</dd></div><div><dt>进入状态</dt><dd>{content.startingState}</dd></div>
          <div><dt>触发原因</dt><dd>{content.trigger}</dd></div><div><dt>必须产生的结果</dt><dd>{content.requiredResult}</dd></div>
          <div><dt>引向后续</dt><dd>{content.nextEventImpact}</dd></div><div><dt>人物变化</dt><dd>{content.characterArcImpact}</dd></div></dl>}</section>
      <section className="event-version-section"><header><div><h4>方案与历史稿</h4><p>编剧方案、融合稿和作者确认稿都会保留，可逐项复制核对。</p></div></header>
        <div className="event-version-grid">{versions.map(version=><article key={version.storyEventVersionId} className={version.storyEventVersionId===selected?.activeVersionId?'active':''}>
          <header><span>{candidateLabel(version.candidateKind)}</span><strong>第 {version.version} 稿 · {versionStatus(version.status)}</strong></header>
          <h5>{version.content.title}</h5>{presentationMode==='story'
            ?<StoryEventPreview compact presentation={eventPresentation(sequence,selected!,version.content,version.previousSettlementId)}/>
            :<><p>{version.content.volumeResponsibility}</p><dl>
              <dt>参与人物</dt><dd>{version.content.participants.join('、')||'未记录'}</dd><dt>阻力</dt><dd>{version.content.obstacles.join('；')||'未记录'}</dd>
              <dt>选择与代价</dt><dd>{version.content.choicesAndCosts.join('；')||'未记录'}</dd><dt>事件推进</dt><dd>{version.content.localProgression.join(' → ')||'未记录'}</dd>
              <dt>结束条件</dt><dd>{version.content.endingConditions.join('；')||'未记录'}</dd><dt>自由发挥</dt><dd>{version.content.flexibleExecution.join('；')||'未记录'}</dd>
            </dl></>}</article>)}</div></section>
    </main><aside className="event-side-panel"><section><h4>已完成事件边界</h4><dl><dt>必须得到</dt><dd>{content.requiredResult}</dd>
      <dt>对卷高潮的作用</dt><dd>{content.volumeClimaxImpact}</dd><dt>仍可自由发挥</dt><dd>{content.flexibleExecution.join('；')}</dd></dl></section></aside></div>}
  </section>;
}

function EventEditor({value,onChange,onSave,busy}:{value:StoryEventContent;onChange:(value:StoryEventContent)=>void;onSave:()=>void;busy:boolean}){
  const text=(field:keyof StoryEventContent)=>(next:string)=>onChange({...value,[field]:next});
  const list=(field:keyof StoryEventContent)=>(next:string)=>onChange({...value,[field]:lines(next)});
  return <section className="event-editor"><div className="event-editor-grid">
    <label><span>事件名称</span><input value={value.title} onChange={e=>text('title')(e.target.value)}/></label>
    <label><span>服务本卷什么目标</span><textarea value={value.volumeResponsibility} onChange={e=>text('volumeResponsibility')(e.target.value)}/></label>
    <label><span>进入事件时的主角与局面状态</span><textarea value={value.startingState} onChange={e=>text('startingState')(e.target.value)}/></label>
    <label><span>为什么现在发生（来自上一结果或当前状态）</span><textarea value={value.trigger} onChange={e=>text('trigger')(e.target.value)}/></label>
    <label><span>参与人物（每行一项）</span><textarea value={value.participants.join('\n')} onChange={e=>list('participants')(e.target.value)}/></label>
    <label><span>人物想达到什么（每行一项）</span><textarea value={value.characterGoals.join('\n')} onChange={e=>list('characterGoals')(e.target.value)}/></label>
    <label><span>主要阻力（每行一项）</span><textarea value={value.obstacles.join('\n')} onChange={e=>list('obstacles')(e.target.value)}/></label>
    <label><span>关键选择与代价（每行一项）</span><textarea value={value.choicesAndCosts.join('\n')} onChange={e=>list('choicesAndCosts')(e.target.value)}/></label>
    <label><span>内部推进节点（每行一项）</span><textarea value={value.localProgression.join('\n')} onChange={e=>list('localProgression')(e.target.value)}/></label>
    <label><span>必须得到的结果</span><textarea value={value.requiredResult} onChange={e=>text('requiredResult')(e.target.value)}/></label>
    <label><span>事件结束条件与钩子（每行一项）</span><textarea value={value.endingConditions.join('\n')} onChange={e=>list('endingConditions')(e.target.value)}/></label>
    <label><span>事件结果怎样引出下一个事件</span><textarea value={value.nextEventImpact} onChange={e=>text('nextEventImpact')(e.target.value)}/></label>
    <label><span>人物变化</span><textarea value={value.characterArcImpact} onChange={e=>text('characterArcImpact')(e.target.value)}/></label>
    <label><span>对卷高潮的作用</span><textarea value={value.volumeClimaxImpact} onChange={e=>text('volumeClimaxImpact')(e.target.value)}/></label>
    <label><span>自由发挥空间（每行一项）</span><textarea value={value.flexibleExecution.join('\n')} onChange={e=>list('flexibleExecution')(e.target.value)}/></label>
  </div><button className="primary-button" type="button" disabled={busy} onClick={onSave}>另存一份作者稿</button></section>;
}

function emptyEvent(title:string):StoryEventContent{return{title,volumeResponsibility:'推动当前卷目标并改变人物状态',
  startingState:'承接上一事件已经发生的实际结果',trigger:'上一事件的结果造成无法回避的新问题',
  participants:['主角'],characterGoals:['解决当下问题并守住长期目标'],obstacles:['现有能力和关系不足以无代价解决'],
  choicesAndCosts:['主角必须作出会留下后果的选择'],informationMoves:['发现一条会改变判断的新信息'],
  localProgression:['问题落地','尝试受阻','作出选择','结果改变状态'],requiredResult:'产生可以由下一事件承接的明确结果',
  flexibleExecution:['具体场景、对白、局部误判和解法可以自由设计'],endingConditions:['核心问题得到有限解决','下一事件条件形成'],
  nextEventImpact:'事件结果自然触发新的问题',characterArcImpact:'人物通过行动发生可见变化',
  volumeClimaxImpact:'为当前卷高潮积累因果、关系或资源',estimatedChapterRange:{minimum:null,likely:null,maximum:null},
  uncertaintyNotes:[]};}
function mergeEvents(a:StoryEventContent,b:StoryEventContent):StoryEventContent{return{...a,title:a.title+'与'+b.title,
  volumeResponsibility:a.volumeResponsibility+'；'+b.volumeResponsibility,participants:[...new Set([...a.participants,...b.participants])],
  characterGoals:[...new Set([...a.characterGoals,...b.characterGoals])],obstacles:[...new Set([...a.obstacles,...b.obstacles])],
  choicesAndCosts:[...a.choicesAndCosts,...b.choicesAndCosts],informationMoves:[...a.informationMoves,...b.informationMoves],
  localProgression:[...a.localProgression,...b.localProgression],requiredResult:b.requiredResult,
  flexibleExecution:[...new Set([...a.flexibleExecution,...b.flexibleExecution])],endingConditions:b.endingConditions,
  nextEventImpact:b.nextEventImpact,characterArcImpact:a.characterArcImpact+'；'+b.characterArcImpact,
  volumeClimaxImpact:b.volumeClimaxImpact,estimatedChapterRange:{minimum:add(a.estimatedChapterRange.minimum,b.estimatedChapterRange.minimum),
    likely:add(a.estimatedChapterRange.likely,b.estimatedChapterRange.likely),maximum:add(a.estimatedChapterRange.maximum,b.estimatedChapterRange.maximum)},
  uncertaintyNotes:[...new Set([...a.uncertaintyNotes,...b.uncertaintyNotes])]};}
function add(a:number|null,b:number|null){return a===null||b===null?null:a+b;}
function templateInstance(mode:'template'|'custom'|'none',selected:PublicNarrativeTemplate[],direction:string):PlanningTemplateInstance{
  const primary=selected[0]??null;
  if(mode==='template'&&primary!==null)return{selectionMode:'template',templateKey:primary.templateKey,
    templateVersion:primary.templateVersion,templateHash:primary.contentHash,
    templateRefs:[{templateKey:primary.templateKey,templateVersion:primary.templateVersion,templateHash:primary.contentHash}],
    scope:'event',beats:primary.beats.map(beat=>({...beat,
      beatId:primary.templateKey+':'+beat.beatId,authorIdeaRefs:[]})),customDirection:null};
  return{selectionMode:mode,templateKey:null,templateVersion:null,templateHash:null,scope:'event',beats:[],
    customDirection:mode==='custom'?direction.trim()||null:null};}
function lines(value:string){return[...new Set(value.split(/\r?\n/u).map(item=>item.trim()).filter(Boolean))];}
function key(prefix:string){return prefix+':'+(globalThis.crypto?.randomUUID?.()??Date.now()+'-'+Math.random());}
function threadStatusLabel(status:StoryThreadData['status']){return({planned:'等待正文埋下',planted:'正文已经埋下',advanced:'正在推进',
  due:'已经到兑现窗口',resolved:'已经解决',abandoned_by_author:'作者决定放弃'}as const)[status];}
function messageOf(reason:unknown){return authorErrorFromUnknown(reason, '事件规划操作失败，请稍后重试。');}
function eventStatus(status:string){return({planning:'规划中',active:'已确认',settled:'已完成',archived:'已归档'}as Record<string,string>)[status]??'正在处理';}
function eventVersionOf(item:StoryEventData){return item.activeVersion??item.latestVersion;}
function eventContentOf(item:StoryEventData){return eventVersionOf(item)?.content??emptyEvent('待设计事件');}
function eventPresentation(sequence:EventSequenceData,item:StoryEventData,content:StoryEventContent,
  previousSettlementId:string|null|undefined=eventVersionOf(item)?.previousSettlementId){
  const index=sequence.events.findIndex(event=>event.eventId===item.eventId);
  const previous=index>0?eventContentOf(sequence.events[index-1]!):null;
  return buildStoryEventPresentation({content,previousContent:previous,
    carryKind:item.order===1?'opening':previousSettlementId!=null?'actual':'planned'});
}
function StoryViewSwitch({value,onChange}:{value:'story'|'detail';onChange:(value:'story'|'detail')=>void}){
  return <div className="story-view-switch" role="group" aria-label="事件查看方式">
    <button type="button" aria-pressed={value==='story'} className={value==='story'?'selected':''} onClick={()=>onChange('story')}>故事视图</button>
    <button type="button" aria-pressed={value==='detail'} className={value==='detail'?'selected':''} onClick={()=>onChange('detail')}>细节视图</button>
  </div>;
}
export function eventEmotionGuide(template:PublicNarrativeTemplate){
  const guides:Record<string,{emoji:string;label:string;explanation:string}>={
    'event-problem-demands-response':{emoji:'⚡',label:'危机逼近',explanation:'让新问题立刻落到人物身上，逼他回应，并让回应产生下一步后果。'},
    'event-pressure-reveals-capability':{emoji:'😤',label:'逆风亮招',explanation:'先让人物被低估或受压，再用有准备、有代价的行动改变他人判断。'},
    'event-false-win-higher-cost':{emoji:'🤯',label:'赢了却更危险',explanation:'先兑现眼前收获，再揭示胜利带来的更大代价，让反转有前因可循。'},
    'event-failure-finds-breakthrough':{emoji:'🔥',label:'绝境翻盘',explanation:'让旧办法真正失败，再从人物已有能力与线索里找到新的突破口。'},
    'event-clues-change-understanding':{emoji:'😱',label:'真相翻面',explanation:'让公平出现的线索改变原有判断，读者回看时能找到依据。'},
    'event-factions-change-sides':{emoji:'🧠',label:'阵营博弈',explanation:'让不同立场因利益和选择发生变化，每次站队都反过来改变局势。'},
    'event-relationship-forces-choice':{emoji:'💔',label:'关系抉择',explanation:'让重要关系经受一次不能两全的选择，结果同时改变感情与行动。'},
    'event-hope-loss-choice':{emoji:'🌧️',label:'希望落空后的选择',explanation:'先让人物看见希望，再失去原来的解法，最终用新的选择继续向前。'}
  };
  const guide=guides[template.templateKey];
  if(guide!==undefined)return guide;
  const text=(template.templateKey+' '+template.publicTitle+' '+template.publicExplanation).toLowerCase();
  if(/线索|谜|真相|clue|mystery/u.test(text))return{emoji:'😱',label:'细思极恐',explanation:'线索改变原有判断，让读者发现事情远没有表面那么简单。'};
  if(/阵营|博弈|计谋|智|faction|strategy/u.test(text))return{emoji:'🧠',label:'智斗博弈',explanation:'靠判断、信息和布局取胜，让每一步选择都能反过来影响局势。'};
  if(/关系|感情|失去|hope|relationship/u.test(text))return{emoji:'💔',label:'关系震荡',explanation:'让重要关系经受一次选择，读者既在意结果，也在意人物会失去什么。'};
  if(/失败|绝境|breakthrough|failure/u.test(text))return{emoji:'🔥',label:'绝境翻盘',explanation:'先把人物压到难以退让的位置，再靠合理行动找到新的突破口。'};
  if(/压力|逼近|选择|pressure|choice/u.test(text))return{emoji:'😤',label:'扬眉吐气',explanation:'压住情绪后让人物用一次有代价的选择扭转局面。'};
  if(/反转|假胜|代价|false.win|cost/u.test(text))return{emoji:'🤯',label:'意外反转',explanation:'眼前的赢法带来更大代价，让结果意外，却能从前面的因果中找到依据。'};
  return{emoji:'✨',label:template.publicTitle,explanation:template.publicExplanation};
}

function candidateLabel(kind:StoryEventVersionData['candidateKind']){return({candidate_a:'方案一',candidate_b:'方案二',
  author_edit:'我的修改',fusion:'主编整理版',volume_seed:'卷纲分配的初始任务'})[kind];}
function versionStatus(status:StoryEventVersionData['status']){return({candidate:'待确认',active:'已确认',superseded:'历史确认版',archived:'已归档'})[status];}
function operationLabel(kind:EventOperationData['operationKind']){return({reorder:'调整事件顺序',insert:'插入新事件',split:'拆分事件',merge:'合并事件'})[kind];}
function rangeLabel(content:StoryEventContent|undefined){if(content===undefined)return'待设计';const r=content.estimatedChapterRange;
  if(r.likely!==null)return`大约 ${r.likely} 章（可在 ${r.minimum??'更少'}—${r.maximum??'更多'} 章间调整）`;return'不设固定章数，按事件实际需要决定';}
function fieldLabel(field:string){return({title:'事件名称',volumeResponsibility:'服务本卷的作用',startingState:'进入状态',trigger:'触发原因',
  participants:'参与人物',characterGoals:'人物目标',obstacles:'阻力',choicesAndCosts:'选择与代价',informationMoves:'信息变化',
  localProgression:'内部推进',requiredResult:'必须结果',flexibleExecution:'自由发挥',endingConditions:'结束条件',
  nextEventImpact:'下一事件接口',characterArcImpact:'人物变化',volumeClimaxImpact:'卷高潮作用',
  estimatedChapterRange:'预计篇幅',uncertaintyNotes:'待确认项'}as Record<string,string>)[field]??field;}
