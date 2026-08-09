import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlanningTemplateInstance, PublicNarrativeTemplate, StoryEventContent } from '@wenmi/contracts';
import {
  addStoryEventVersion, applyEventOperation, cancelTask, confirmStoryEventVersion,
  fetchAuthorPlanningInputs, fetchCreationWorkflow, fetchEventSequence, fetchPlanningTemplates,
  fetchStoryEventGeneration, fetchStoryEventVersions, fetchVolumePlans, initializeEventSequence,
  previewEventOperation, previewStoryEventImpact, resumeTask, retryTask, startStoryEventGeneration,
  type EventOperationData, type EventOperationProposal, type EventSequenceData,
  type StoryEventData, type StoryEventGenerationData, type StoryEventImpactData,
  type StoryEventVersionData, type VolumePlanData
} from '../../lib/api/client';
import { AuthorIdeaComposer } from '../creation-desk/AuthorIdeaComposer';

interface EventWorkspaceSnapshot {
  workflow: Awaited<ReturnType<typeof fetchCreationWorkflow>>;
  plan: VolumePlanData | null;
  templates: Awaited<ReturnType<typeof fetchPlanningTemplates>>;
}

export function EventPlanningPanel({ bookId }: { bookId: string }): React.JSX.Element {
  const [snapshot,setSnapshot]=useState<EventWorkspaceSnapshot|null>(null);
  const [sequence,setSequence]=useState<EventSequenceData|null>(null);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [versions,setVersions]=useState<StoryEventVersionData[]>([]);
  const [generation,setGeneration]=useState<StoryEventGenerationData|null>(null);
  const [mode,setMode]=useState<'template'|'custom'|'none'>('none');
  const [selectedTemplate,setSelectedTemplate]=useState<PublicNarrativeTemplate|null>(null);
  const [customDirection,setCustomDirection]=useState('');
  const [draft,setDraft]=useState<StoryEventContent>(()=>emptyEvent('新事件'));
  const [editing,setEditing]=useState(false);
  const [impact,setImpact]=useState<StoryEventImpactData|null>(null);
  const [operation,setOperation]=useState<EventOperationData|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);

  const load=useCallback(async(signal?:AbortSignal)=>{
    const[workflow,plans,templates]=await Promise.all([
      fetchCreationWorkflow(bookId,signal),fetchVolumePlans(bookId,signal),fetchPlanningTemplates(bookId,'event',signal)
    ]);
    const plan=[...plans].reverse().find(item=>['active','completed'].includes(item.status)&&item.activeVersionId!==null)??null;
    const nextSequence=plan===null?null:await fetchEventSequence(bookId,plan.volumePlanId,signal);
    setSnapshot({workflow,plan,templates});setSequence(nextSequence);
    setSelectedId(current=>current!==null&&nextSequence?.events.some(item=>item.eventId===current)
      ?current:nextSequence?.events[0]?.eventId??null);
  },[bookId]);

  useEffect(()=>{const controller=new AbortController();setError(null);
    void load(controller.signal).catch(reason=>{if(!controller.signal.aborted)setError(messageOf(reason));});
    return()=>controller.abort();},[load]);

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

  useEffect(()=>{if(selected===null||generation===null||!activeTask(generation.status))return;
    const controller=new AbortController(),timer=window.setInterval(()=>{
      void Promise.all([fetchStoryEventGeneration(bookId,selected.eventId,controller.signal),
        fetchStoryEventVersions(bookId,selected.eventId,controller.signal)]).then(([nextGeneration,nextVersions])=>{
          setGeneration(nextGeneration);setVersions(nextVersions);
          if(nextGeneration!==null&&!activeTask(nextGeneration.status))void load();
        }).catch(reason=>{if(!controller.signal.aborted)setError(messageOf(reason));});
    },1250);return()=>{controller.abort();window.clearInterval(timer);};
  },[bookId,generation?.status,generation?.taskId,load,selected?.eventId]);

  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError(null);try{await work();}catch(reason){setError(messageOf(reason));}finally{setBusy(false);}};

  const initialize=()=>{if(snapshot?.plan===null||snapshot===null)return;void run(async()=>{
    const next=await initializeEventSequence(bookId,snapshot.plan!.volumePlanId,{
      expectedWorkflowVersion:snapshot.workflow.planningVersion,idempotencyKey:key('event-sequence')
    });setSequence(next);setSelectedId(next.events[0]?.eventId??null);await load();
  });};

  const authorRefs=async(eventId:string)=>(await fetchAuthorPlanningInputs(bookId,{
    surface:'event',subjectType:'story_event',subjectId:eventId
  })).filter(item=>!['withdrawn','superseded'].includes(item.status)).map(item=>item.authorInputId);

  const generate=()=>{if(selected===null||snapshot===null)return;void run(async()=>{
    setGeneration(await startStoryEventGeneration(bookId,selected.eventId,{
      expectedEventRevision:selected.revision,expectedActiveVersionId:selected.activeVersionId,
      expectedWorkflowVersion:snapshot.workflow.planningVersion,template:templateInstance(mode,selectedTemplate,customDirection),
      authorInputRefs:await authorRefs(selected.eventId),idempotencyKey:key('event-team')
    }));
  });};

  const saveDraft=()=>{if(selected===null)return;void run(async()=>{
    const saved=await addStoryEventVersion(bookId,selected.eventId,{
      expectedEventRevision:selected.revision,candidateKind:'author_edit',parentVersionId:selected.activeVersionId,
      authorInputRefs:await authorRefs(selected.eventId),template:templateInstance(mode,selectedTemplate,customDirection),
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

  const taskAction=(action:'cancel'|'retry'|'resume')=>{if(selected===null||generation===null)return;void run(async()=>{
    if(action==='cancel')await cancelTask(bookId,generation.taskId);
    else if(action==='retry')await retryTask(bookId,generation.taskId);
    else await resumeTask(bookId,generation.taskId);
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
  if(sequence===null)return <section className="event-planning-panel event-empty-state"><span className="eyebrow">当前卷已经确认</span>
    <h3>把卷规划拆成可以连续创作的小事件</h3><p>系统会保留卷纲给出的事件任务，但不会把预计章数变成硬限制。</p>
    {error!==null&&<p className="inline-error">{error}</p>}<button className="primary-button" type="button" disabled={busy} onClick={initialize}>建立事件链</button></section>;
  if(snapshot.plan.status==='completed')return <CompletedEventPlanningView plan={snapshot.plan} sequence={sequence}
    selected={selected} selectedId={selectedId} versions={versions} onSelect={setSelectedId}/>;

  return <section className="event-planning-panel" aria-labelledby="event-planning-title">
    <header className="event-planning-header"><div><span className="eyebrow">事件设计台</span>
      <h3 id="event-planning-title">先看整条因果链，再深入设计当前事件</h3>
      <p>每个事件都承接上一事件的实际结果，并为下一事件制造条件；章数只是弹性估计。</p></div>
      <div className="event-sequence-meta"><small>当前卷</small><strong>{snapshot.plan.activeVersion?.content.title}</strong><span>事件链第 {sequence.revision} 版</span></div>
    </header>
    {error!==null&&<p className="inline-error" role="alert">{error}</p>}
    <div className="event-chain" aria-label="事件因果链">{sequence.events.map((item,index)=><div className="event-chain-node" key={item.eventId}>
      <button type="button" className={item.eventId===selectedId?'selected':''} onClick={()=>setSelectedId(item.eventId)}>
        <small>事件 {item.order} · {eventStatus(item.status)}</small>
        <strong>{item.activeVersion?.content.title??item.latestVersion?.content.title??'待设计事件'}</strong>
        <span>{item.activeVersion?.content.requiredResult??item.latestVersion?.content.requiredResult??'等待补充必须产生的结果'}</span>
      </button>{index<sequence.events.length-1&&<i aria-hidden="true">→</i>}</div>)}</div>

    {selected!==null&&<div className="event-workspace-grid">
      <main>
        <section className="event-focus-card"><header><div><small>当前选择 · 事件 {selected.order}</small>
          <h4>{selected.activeVersion?.content.title??selected.latestVersion?.content.title}</h4></div>
          <span>{selected.activeVersionId===null?'等待确认':'已确认，可继续章纲'}</span></header>
          <dl><div><dt>承接哪里</dt><dd>{selected.latestVersion?.content.startingState}</dd></div>
            <div><dt>为什么发生</dt><dd>{selected.latestVersion?.content.trigger}</dd></div>
            <div><dt>必须改变什么</dt><dd>{selected.latestVersion?.content.requiredResult}</dd></div>
            <div><dt>怎样引出后续</dt><dd>{selected.latestVersion?.content.nextEventImpact}</dd></div></dl>
          <div className="button-row"><button type="button" disabled={busy||selected.order===1} onClick={()=>move(-1)}>向前移动</button>
            <button type="button" disabled={busy||selected.order===sequence.events.length} onClick={()=>move(1)}>向后移动</button>
            <button type="button" disabled={busy} onClick={insertAfter}>在后面加事件</button>
            <button type="button" disabled={busy} onClick={split}>拆成两个事件</button>
            <button type="button" disabled={busy||selected.order===sequence.events.length} onClick={mergeNext}>与下一个合并</button></div>
        </section>

        <section className="event-template-section"><header><h4>这个事件想怎么推进？</h4><p>以下是大白话参考，不是剧情公式。</p></header>
          <div className="event-template-grid">{snapshot.templates.templates.map(template=><button type="button"
            className={mode==='template'&&selectedTemplate?.templateKey===template.templateKey?'selected':''}
            key={template.templateKey} onClick={()=>{setMode('template');setSelectedTemplate(template);}}>
            <span>{template.recommended?'适合本书':'可选参考'}</span><strong>{template.publicTitle}</strong><p>{template.publicExplanation}</p></button>)}
            <button type="button" className={mode==='custom'?'selected':''} onClick={()=>setMode('custom')}><span>自己决定</span><strong>按我的方向推进</strong><p>只把你的方向交给团队，不套固定顺序。</p></button>
            <button type="button" className={mode==='none'?'selected':''} onClick={()=>setMode('none')}><span>自由设计</span><strong>让人物和因果自然推动</strong><p>不选择结构参考，由当前局面决定事件形态。</p></button></div>
          {mode==='custom'&&<textarea rows={3} value={customDirection} onChange={e=>setCustomDirection(e.target.value)}
            placeholder="例如：希望主角用之前掌握的信息诱使对手犯错，但胜利要伤害一段重要关系。" />}
        </section>

        <AuthorIdeaComposer bookId={bookId} surface="event" subjectType="story_event" subjectId={selected.eventId}
          title="告诉团队你对这个事件的想法" />

        <section className={`event-generation-card ${generation!==null&&activeTask(generation.status)?'working':''}`}>
          <header><div><span>AI协作</span><h4>两位编剧独立设计，主编比较后融合</h4>
            <p>每位编剧都看到当前卷约束、事件任务、作者原话和上一事件实际结算，但不会互看答案。</p></div>
            <button className="primary-button" type="button" disabled={busy||(generation!==null&&activeTask(generation.status))} onClick={generate}>
              {generation?.status==='succeeded'?'再设计一组':'开始设计事件'}</button></header>
          {generation!==null&&<><div className="event-generation-summary"><strong>{taskStatus(generation.status)}</strong>
            <span>{taskPhase(generation.currentPhase)}</span><span>{generation.modelDiversityVerified?'两位编剧来自不同模型':'本地验收模型，不冒充异模型意见'}</span></div>
            <div className="event-generation-members">{generation.members.map(member=><article key={member.roleKey+member.agentId}>
              <strong>{roleLabel(member.roleKey)} · {member.displayName}</strong><span>{member.provider} · {member.modelId}</span></article>)}</div>
            <div className="button-row">{activeTask(generation.status)&&generation.status!=='paused'&&<button onClick={()=>taskAction('cancel')}>停止本轮</button>}
              {generation.status==='paused'&&<button onClick={()=>taskAction('resume')}>继续本轮</button>}
              {['failed','interrupted'].includes(generation.status)&&<button onClick={()=>taskAction('retry')}>从保存进度重试</button>}</div></>}
        </section>

        <section className="event-version-section"><header><div><h4>方案与历史版本</h4><p>编剧方案、主编融合和作者修改都保留，不互相覆盖。</p></div>
          <button type="button" onClick={()=>{setDraft(selected.activeVersion?.content??selected.latestVersion?.content??emptyEvent('新事件'));setEditing(value=>!value);}}>
            {editing?'收起编辑':'手工修改'}</button></header>
          {editing&&<EventEditor value={draft} onChange={setDraft} onSave={saveDraft} busy={busy}/>}
          <div className="event-version-grid">{versions.map(version=><article key={version.storyEventVersionId}
            className={version.storyEventVersionId===selected.activeVersionId?'active':''}>
            <header><span>{candidateLabel(version.candidateKind)}</span><strong>第 {version.version} 版 · {versionStatus(version.status)}</strong></header>
            <h5>{version.content.title}</h5><p>{version.content.volumeResponsibility}</p>
            <dl><dt>关键选择与代价</dt><dd>{version.content.choicesAndCosts.join('；')||'待补充'}</dd>
              <dt>事件结果</dt><dd>{version.content.requiredResult}</dd><dt>后续接口</dt><dd>{version.content.nextEventImpact}</dd></dl>
            <button type="button" disabled={busy} onClick={()=>previewVersion(version)}>查看并准备确认</button></article>)}</div>
        </section>
      </main>
      <aside className="event-side-panel">
        <section><h4>当前事件边界</h4><dl><dt>必须服务本卷</dt><dd>{selected.latestVersion?.content.volumeResponsibility}</dd>
          <dt>留给后续自由发挥</dt><dd>{selected.latestVersion?.content.flexibleExecution.join('；')}</dd>
          <dt>预计篇幅</dt><dd>{rangeLabel(selected.latestVersion?.content)}</dd></dl></section>
        <section><h4>链路记录</h4><p>已有 {sequence.operations.length} 次结构预览或调整，全部保留历史。</p>
          <ul>{sequence.operations.slice(0,5).map(item=><li key={item.operationId}>{operationLabel(item.operationKind)} · {item.status==='applied'?'已应用':'仅预览'}</li>)}</ul></section>
      </aside>
    </div>}

    {impact!==null&&<aside className="event-impact-card"><div><strong>确认前影响预览</strong><p>{impact.note}</p></div>
      <dl><dt>改变的部分</dt><dd>{impact.changedFields.map(fieldLabel).join('、')||'无'}</dd>
        <dt>已有下游内容</dt><dd>{impact.downstreamDependencyCount} 项</dd></dl>
      <div className="button-row"><button onClick={()=>setImpact(null)}>先不确认</button>
        <button className="primary-button" disabled={busy} onClick={confirmVersion}>确认此版本</button></div></aside>}
    {operation!==null&&<aside className="event-operation-card"><div><strong>结构调整预览</strong><p>{operation.impact.note}</p></div>
      <dl><dt>操作</dt><dd>{operationLabel(operation.operationKind)}</dd><dt>影响事件</dt><dd>{operation.impact.affectedEventIds.length} 个</dd>
        <dt>结果</dt><dd>{operation.impact.resultingTitles.join('、')}</dd></dl>
      <div className="button-row"><button onClick={()=>setOperation(null)}>取消</button>
        <button className="primary-button" disabled={busy||operation.impact.blocked} onClick={applyStructure}>应用调整</button></div></aside>}
  </section>;
}

function CompletedEventPlanningView({plan,sequence,selected,selectedId,versions,onSelect}:{
  plan:VolumePlanData;sequence:EventSequenceData;selected:StoryEventData|null;selectedId:string|null;
  versions:StoryEventVersionData[];onSelect:(eventId:string)=>void;
}):React.JSX.Element{
  const content=selected?.activeVersion?.content??selected?.latestVersion?.content??null;
  return <section className="event-planning-panel completed-planning-history" aria-label="completed-event-history">
    <header className="event-planning-header"><div><span className="eyebrow">已完成卷 · 只读记录</span>
      <h3>事件链和事件大纲仍然完整保留</h3><p>本卷已经结算。这里展示当时确认的事件设计与全部历史版本，不会因为进入下一卷而隐藏。</p></div>
      <div className="event-sequence-meta"><small>已完成卷</small><strong>{plan.activeVersion?.content.title}</strong><span>事件链第 {sequence.revision} 版</span></div></header>
    <div className="event-chain" aria-label="已完成事件因果链">{sequence.events.map((item,index)=><div className="event-chain-node" key={item.eventId}>
      <button type="button" className={item.eventId===selectedId?'selected':''} onClick={()=>onSelect(item.eventId)}>
        <small>事件 {item.order} · {eventStatus(item.status)}</small><strong>{item.activeVersion?.content.title??item.latestVersion?.content.title??'未命名事件'}</strong>
        <span>{item.activeVersion?.content.requiredResult??item.latestVersion?.content.requiredResult??'未记录事件结果'}</span>
      </button>{index<sequence.events.length-1&&<i aria-hidden="true">→</i>}</div>)}</div>
    {content!==null&&<div className="event-workspace-grid"><main>
      <section className="event-focus-card"><header><div><small>事件 {selected?.order} · 已确认大纲</small><h4>{content.title}</h4></div><span>历史只读</span></header>
        <dl><div><dt>服务本卷</dt><dd>{content.volumeResponsibility}</dd></div><div><dt>进入状态</dt><dd>{content.startingState}</dd></div>
          <div><dt>触发原因</dt><dd>{content.trigger}</dd></div><div><dt>必须产生的结果</dt><dd>{content.requiredResult}</dd></div>
          <div><dt>引向后续</dt><dd>{content.nextEventImpact}</dd></div><div><dt>人物变化</dt><dd>{content.characterArcImpact}</dd></div></dl></section>
      <section className="event-version-section"><header><div><h4>方案与历史版本</h4><p>编剧方案、融合稿和作者确认稿均保留，可逐项复制核对。</p></div></header>
        <div className="event-version-grid">{versions.map(version=><article key={version.storyEventVersionId} className={version.storyEventVersionId===selected?.activeVersionId?'active':''}>
          <header><span>{candidateLabel(version.candidateKind)}</span><strong>第 {version.version} 版 · {versionStatus(version.status)}</strong></header>
          <h5>{version.content.title}</h5><p>{version.content.volumeResponsibility}</p><dl>
            <dt>参与人物</dt><dd>{version.content.participants.join('、')||'未记录'}</dd><dt>阻力</dt><dd>{version.content.obstacles.join('；')||'未记录'}</dd>
            <dt>选择与代价</dt><dd>{version.content.choicesAndCosts.join('；')||'未记录'}</dd><dt>事件推进</dt><dd>{version.content.localProgression.join(' → ')||'未记录'}</dd>
            <dt>结束条件</dt><dd>{version.content.endingConditions.join('；')||'未记录'}</dd><dt>自由发挥</dt><dd>{version.content.flexibleExecution.join('；')||'未记录'}</dd>
          </dl></article>)}</div></section>
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
    <label><span>进入事件时的状态</span><textarea value={value.startingState} onChange={e=>text('startingState')(e.target.value)}/></label>
    <label><span>为什么现在发生</span><textarea value={value.trigger} onChange={e=>text('trigger')(e.target.value)}/></label>
    <label><span>参与人物（每行一项）</span><textarea value={value.participants.join('\n')} onChange={e=>list('participants')(e.target.value)}/></label>
    <label><span>人物想达到什么（每行一项）</span><textarea value={value.characterGoals.join('\n')} onChange={e=>list('characterGoals')(e.target.value)}/></label>
    <label><span>主要阻力（每行一项）</span><textarea value={value.obstacles.join('\n')} onChange={e=>list('obstacles')(e.target.value)}/></label>
    <label><span>关键选择与代价（每行一项）</span><textarea value={value.choicesAndCosts.join('\n')} onChange={e=>list('choicesAndCosts')(e.target.value)}/></label>
    <label><span>内部推进节点（每行一项）</span><textarea value={value.localProgression.join('\n')} onChange={e=>list('localProgression')(e.target.value)}/></label>
    <label><span>必须得到的结果</span><textarea value={value.requiredResult} onChange={e=>text('requiredResult')(e.target.value)}/></label>
    <label><span>怎样引出下一个事件</span><textarea value={value.nextEventImpact} onChange={e=>text('nextEventImpact')(e.target.value)}/></label>
    <label><span>人物变化</span><textarea value={value.characterArcImpact} onChange={e=>text('characterArcImpact')(e.target.value)}/></label>
    <label><span>对卷高潮的作用</span><textarea value={value.volumeClimaxImpact} onChange={e=>text('volumeClimaxImpact')(e.target.value)}/></label>
    <label><span>自由发挥空间（每行一项）</span><textarea value={value.flexibleExecution.join('\n')} onChange={e=>list('flexibleExecution')(e.target.value)}/></label>
  </div><button className="primary-button" type="button" disabled={busy} onClick={onSave}>保存为新的作者版本</button></section>;
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
function templateInstance(mode:'template'|'custom'|'none',selected:PublicNarrativeTemplate|null,direction:string):PlanningTemplateInstance{
  if(mode==='template'&&selected!==null)return{selectionMode:'template',templateKey:selected.templateKey,
    templateVersion:selected.templateVersion,templateHash:selected.contentHash,scope:'event',
    beats:selected.beats.map(beat=>({...beat,authorIdeaRefs:[]})),customDirection:null};
  return{selectionMode:mode,templateKey:null,templateVersion:null,templateHash:null,scope:'event',beats:[],
    customDirection:mode==='custom'?direction.trim()||null:null};}
function lines(value:string){return[...new Set(value.split(/\r?\n/u).map(item=>item.trim()).filter(Boolean))];}
function key(prefix:string){return prefix+':'+(globalThis.crypto?.randomUUID?.()??Date.now()+'-'+Math.random());}
function activeTask(status:string){return['pending','queued','working','paused'].includes(status);}
function messageOf(reason:unknown){return reason instanceof Error?reason.message:'事件规划操作失败，请稍后重试。';}
function eventStatus(status:string){return({planning:'规划中',active:'已确认',settled:'已完成',archived:'已归档'}as Record<string,string>)[status]??status;}
function taskStatus(status:string){return({pending:'准备中',queued:'等待开始',working:'团队设计中',paused:'已暂停',
  succeeded:'三份方案已保存',failed:'本轮未完成',interrupted:'任务中断',cancelled:'本轮已停止',blocked:'等待处理'}as Record<string,string>)[status]??status;}
function taskPhase(phase:string){return({preparing_context:'准备卷纲、设定、结算与作者想法',screenwriter_candidates:'两份独立方案已完成，主编正在融合',
  fusion_complete:'主编融合方案已保存',failed:'保留检查点，等待重试'}as Record<string,string>)[phase]??phase;}
function roleLabel(role:string){return({lead_screenwriter:'编剧A',second_screenwriter:'编剧B',main_editor:'主编',deputy_editor:'代理主编'}as Record<string,string>)[role]??role;}
function candidateLabel(kind:StoryEventVersionData['candidateKind']){return({candidate_a:'编剧方案A',candidate_b:'编剧方案B',
  author_edit:'作者修改',fusion:'主编融合',volume_seed:'卷纲分配的初始任务'})[kind];}
function versionStatus(status:StoryEventVersionData['status']){return({candidate:'待确认',active:'已确认',superseded:'历史确认版',archived:'已归档'})[status];}
function operationLabel(kind:EventOperationData['operationKind']){return({reorder:'调整事件顺序',insert:'插入新事件',split:'拆分事件',merge:'合并事件'})[kind];}
function rangeLabel(content:StoryEventContent|undefined){if(content===undefined)return'待设计';const r=content.estimatedChapterRange;
  if(r.likely!==null)return`大约 ${r.likely} 章（可在 ${r.minimum??'更少'}—${r.maximum??'更多'} 章间调整）`;return'不设固定章数，按事件实际需要决定';}
function fieldLabel(field:string){return({title:'事件名称',volumeResponsibility:'服务本卷的作用',startingState:'进入状态',trigger:'触发原因',
  participants:'参与人物',characterGoals:'人物目标',obstacles:'阻力',choicesAndCosts:'选择与代价',informationMoves:'信息变化',
  localProgression:'内部推进',requiredResult:'必须结果',flexibleExecution:'自由发挥',endingConditions:'结束条件',
  nextEventImpact:'下一事件接口',characterArcImpact:'人物变化',volumeClimaxImpact:'卷高潮作用',
  estimatedChapterRange:'预计篇幅',uncertaintyNotes:'待确认项'}as Record<string,string>)[field]??field;}
