import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  NarrativeTemplateCatalogView,
  PlanningTemplateInstance,
  PublicNarrativeTemplate,
  VolumePlanContent
} from '@wenmi/contracts';
import {
  addVolumePlanVersion,
  cancelTask,
  confirmVolumePlanVersion,
  createVolumePlan,
  fetchAuthorPlanningInputs,
  fetchCreationWorkflow,
  fetchPlanningTemplates,
  fetchVolumePlanGeneration,
  fetchVolumePlans,
  fetchVolumePlanVersions,
  previewVolumePlanImpact,
  resumeTask,
  retryTask,
  settleVolumePlan,
  startVolumePlanGeneration,
  type VolumePlanData,
  type VolumePlanGenerationData,
  type VolumePlanImpactData,
  type VolumePlanVersionData
} from '../../lib/api/client';
import { AuthorIdeaComposer } from '../creation-desk/AuthorIdeaComposer';

interface VolumePlanningSnapshot {
  workflow: Awaited<ReturnType<typeof fetchCreationWorkflow>>;
  plans: VolumePlanData[];
  templates: NarrativeTemplateCatalogView;
}

export function VolumePlanningPanel({ bookId }: { bookId: string }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<VolumePlanningSnapshot | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VolumePlanVersionData[]>([]);
  const [generation, setGeneration] = useState<VolumePlanGenerationData | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<PublicNarrativeTemplate | null>(null);
  const [templateMode, setTemplateMode] = useState<'template' | 'custom' | 'none'>('none');
  const [customDirection, setCustomDirection] = useState('');
  const [draft, setDraft] = useState<VolumePlanContent>(() => emptyVolumePlan(1));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<VolumePlanImpactData | null>(null);

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const [workflow, plans, templates] = await Promise.all([
      fetchCreationWorkflow(bookId, signal),
      fetchVolumePlans(bookId, signal),
      fetchPlanningTemplates(bookId, 'volume', signal)
    ]);
    setSnapshot({ workflow, plans, templates });
    setSelectedPlanId((current) => {
      if (current !== null && plans.some((plan) => plan.volumePlanId === current)) return current;
      return plans.at(-1)?.volumePlanId ?? null;
    });
  }, [bookId]);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void load(controller.signal).catch((reason) => {
      if (!controller.signal.aborted) setError(messageOf(reason));
    });
    return () => controller.abort();
  }, [load]);

  const selectedPlan = useMemo(
    () => snapshot?.plans.find((plan) => plan.volumePlanId === selectedPlanId) ?? null,
    [selectedPlanId, snapshot]
  );

  useEffect(() => {
    if (selectedPlan === null) {
      setVersions([]);
      setGeneration(null);
      return;
    }
    const controller = new AbortController();
    void Promise.all([
      fetchVolumePlanVersions(bookId, selectedPlan.volumePlanId, controller.signal),
      fetchVolumePlanGeneration(bookId, selectedPlan.volumePlanId, controller.signal)
    ]).then(([nextVersions, nextGeneration]) => {
      setVersions(nextVersions);
      setGeneration(nextGeneration);
    }).catch((reason) => { if (!controller.signal.aborted) setError(messageOf(reason)); });
    setDraft(selectedPlan.activeVersion?.content ?? emptyVolumePlan(selectedPlan.planNumber));
    setEditing(selectedPlan.activeVersion === null);
    setImpact(null);
    return () => controller.abort();
  }, [bookId, selectedPlan?.volumePlanId, selectedPlan?.activeVersionId]);

  useEffect(() => {
    if (selectedPlan === null || generation === null || !generationIsActive(generation.status)) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void Promise.all([
        fetchVolumePlanGeneration(bookId, selectedPlan.volumePlanId, controller.signal),
        fetchVolumePlanVersions(bookId, selectedPlan.volumePlanId, controller.signal)
      ]).then(([nextGeneration, nextVersions]) => {
        setGeneration(nextGeneration);
        setVersions(nextVersions);
        if (nextGeneration !== null && !generationIsActive(nextGeneration.status)) void load();
      }).catch((reason) => {
        if (!controller.signal.aborted) setError(messageOf(reason));
      });
    }, 1_250);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [bookId, generation?.status, generation?.taskId, load, selectedPlan?.volumePlanId]);

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(null);
    try { await work(); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  };

  const createCurrentVolume = (): void => {
    if (snapshot === null) return;
    const planNumber = (snapshot.plans.at(-1)?.planNumber ?? 0) + 1;
    void run(async () => {
      const created = await createVolumePlan(bookId, {
        expectedWorkflowVersion: snapshot.workflow.planningVersion,
        planNumber,
        idempotencyKey: key(`volume-plan-${planNumber}`)
      });
      await load();
      setSelectedPlanId(created.volumePlanId);
      setDraft(emptyVolumePlan(planNumber));
      setEditing(true);
    });
  };

  const saveAuthorDraft = (): void => {
    if (selectedPlan === null) return;
    void run(async () => {
      const authorIdeas = await fetchAuthorPlanningInputs(bookId, {
        surface: 'volume_plan', subjectType: 'volume_plan', subjectId: selectedPlan.volumePlanId
      });
      const saved = await addVolumePlanVersion(bookId, selectedPlan.volumePlanId, {
        expectedPlanRevision: selectedPlan.revision,
        candidateKind: 'author_edit',
        parentVersionId: selectedPlan.activeVersionId,
        authorInputRefs: authorIdeas
          .filter((idea) => !['withdrawn', 'superseded'].includes(idea.status))
          .map((idea) => idea.authorInputId),
        template: templateInstance(templateMode, selectedTemplate, customDirection),
        content: draft,
        idempotencyKey: key(`volume-author-${selectedPlan.volumePlanId}`)
      });
      setVersions(await fetchVolumePlanVersions(bookId, selectedPlan.volumePlanId));
      setEditing(false);
      setImpact(await previewVolumePlanImpact(bookId, selectedPlan.volumePlanId, saved.volumePlanVersionId));
    });
  };

  const startTeamGeneration = (): void => {
    if (selectedPlan === null || snapshot === null) return;
    void run(async () => {
      const authorIdeas = await fetchAuthorPlanningInputs(bookId, {
        surface: 'volume_plan', subjectType: 'volume_plan', subjectId: selectedPlan.volumePlanId
      });
      const nextGeneration = await startVolumePlanGeneration(bookId, selectedPlan.volumePlanId, {
        expectedPlanRevision: selectedPlan.revision,
        expectedActiveVersionId: selectedPlan.activeVersionId,
        expectedWorkflowVersion: snapshot.workflow.planningVersion,
        template: templateInstance(templateMode, selectedTemplate, customDirection),
        authorInputRefs: authorIdeas
          .filter((idea) => !['withdrawn', 'superseded'].includes(idea.status))
          .map((idea) => idea.authorInputId),
        idempotencyKey: key(`volume-team-${selectedPlan.volumePlanId}`)
      });
      setGeneration(nextGeneration);
    });
  };

  const cancelGeneration = (): void => {
    if (selectedPlan === null || generation === null) return;
    void run(async () => {
      await cancelTask(bookId, generation.taskId);
      setGeneration(await fetchVolumePlanGeneration(bookId, selectedPlan.volumePlanId));
    });
  };

  const retryGeneration = (): void => {
    if (selectedPlan === null || generation === null) return;
    void run(async () => {
      await retryTask(bookId, generation.taskId);
      setGeneration(await fetchVolumePlanGeneration(bookId, selectedPlan.volumePlanId));
    });
  };

  const resumeGeneration = (): void => {
    if (selectedPlan === null || generation === null) return;
    void run(async () => {
      await resumeTask(bookId, generation.taskId);
      setGeneration(await fetchVolumePlanGeneration(bookId, selectedPlan.volumePlanId));
    });
  };

  const previewCandidate = (versionId: string): void => {
    if (selectedPlan === null) return;
    void run(async () => setImpact(await previewVolumePlanImpact(bookId, selectedPlan.volumePlanId, versionId)));
  };

  const confirmCandidate = (): void => {
    if (selectedPlan === null || impact === null || snapshot === null) return;
    void run(async () => {
      await confirmVolumePlanVersion(bookId, selectedPlan.volumePlanId, {
        volumePlanVersionId: impact.candidateVersionId,
        expectedPlanRevision: selectedPlan.revision,
        expectedActiveVersionId: selectedPlan.activeVersionId,
        expectedWorkflowVersion: snapshot.workflow.planningVersion
      });
      setImpact(null);
      await load();
    });
  };

  const settleCurrentVolume = (): void => {
    if (selectedPlan === null || snapshot === null) return;
    void run(async () => { await settleVolumePlan(bookId, selectedPlan.volumePlanId, snapshot.workflow.planningVersion); await load(); });
  };

  if (snapshot === null) {
    return <section className="volume-planning-panel"><p>{error ?? '正在读取当前卷规划…'}</p></section>;
  }

  return <section className="volume-planning-panel" aria-labelledby="volume-planning-title">
    <header className="volume-planning-header">
      <div>
        <span className="eyebrow">当前卷工作台</span>
        <h3 id="volume-planning-title">先确定这一卷要改变什么，再拆事件</h3>
        <p>卷规划只约束目标、冲突、人物变化和事件因果；具体场景、对白和局部反转继续留给编剧与主笔发挥。</p>
      </div>
      {snapshot.plans.length === 0
        ? <button className="primary-button" type="button" disabled={busy} onClick={createCurrentVolume}>开始规划第一卷</button>
        : <select aria-label="选择卷规划" value={selectedPlanId ?? ''} onChange={(event) => setSelectedPlanId(event.target.value)}>
          {snapshot.plans.map((plan) => <option key={plan.volumePlanId} value={plan.volumePlanId}>第{plan.planNumber}卷 · {plan.activeVersion?.content.title ?? '规划中'}</option>)}
        </select>}
    </header>

    <ol className="volume-workflow-strip" aria-label="当前卷流程">
      <li className={selectedPlan !== null ? 'done' : 'current'}><b>1</b><span>建立当前卷</span></li>
      <li className={versions.length > 0 ? 'done' : selectedPlan !== null ? 'current' : ''}><b>2</b><span>比较方案</span></li>
      <li className={selectedPlan?.activeVersion ? 'done' : versions.length > 0 ? 'current' : ''}><b>3</b><span>确认卷规划</span></li>
      <li className={selectedPlan?.activeVersion ? 'current' : ''}><b>4</b><span>继续拆事件</span></li>
    </ol>

    {error !== null && <p className="inline-error" role="alert">{error}</p>}
{snapshot.workflow.stage === 'volume_settlement_in_progress' && selectedPlan !== null && <section className="writing-launch-card volume-settlement-card">
      <div><small>本卷事件已全部完成</small><h4>核对实际后果，完成本卷</h4><p>卷结算只汇总已结算事件和正式正史；原卷规划单独用于差异对照。完成后才会解锁下一卷规划。</p></div>
      <div className="writing-launch-action"><button className="primary-button" type="button" disabled={busy} onClick={settleCurrentVolume}>完成本卷，规划下一卷</button></div>
    </section>}

    {selectedPlan !== null && <>
      <section className="volume-plan-status-card">
        <div><small>第{selectedPlan.planNumber}卷</small><strong>{selectedPlan.activeVersion?.content.title ?? '尚未确认卷规划'}</strong></div>
        <div><small>当前状态</small><strong>{selectedPlan.activeVersion === null ? '比较方案中' : `已确认第${selectedPlan.activeVersion.version}版`}</strong></div>
        <div><small>上游依据</small><strong>{selectedPlan.planNumber === 1 ? '开书资料 + 设定基线' : '上卷结算 + 当前设定'}</strong></div>
        <button type="button" disabled={busy} onClick={() => {
          setDraft(selectedPlan.activeVersion?.content ?? emptyVolumePlan(selectedPlan.planNumber));
          setEditing((value) => !value);
        }}>{editing ? '收起编辑' : selectedPlan.activeVersion === null ? '填写我的方案' : '在确认版上修改'}</button>
      </section>

      <TemplateChooser
        catalog={snapshot.templates}
        mode={templateMode}
        selected={selectedTemplate}
        customDirection={customDirection}
        onMode={setTemplateMode}
        onSelect={(template) => { setSelectedTemplate(template); setTemplateMode('template'); }}
        onCustomDirection={setCustomDirection}
      />

      <AuthorIdeaComposer
        bookId={bookId}
        surface="volume_plan"
        subjectType="volume_plan"
        subjectId={selectedPlan.volumePlanId}
        title="补充你对这一卷的想法"
      />

      <VolumeGenerationCard
        generation={generation}
        busy={busy}
        onStart={startTeamGeneration}
        onCancel={cancelGeneration}
        onRetry={retryGeneration}
        onResume={resumeGeneration}
      />

      {editing && <VolumePlanEditor value={draft} onChange={setDraft} onSave={saveAuthorDraft} busy={busy} />}

      {versions.length > 0 && <section className="volume-version-section">
        <header><div><h4>方案与历史版本</h4><p>候选稿互不覆盖；确认新版本前会先显示影响范围。</p></div><span>{versions.length} 个版本</span></header>
        <div className="volume-version-grid">{versions.map((version) => <VolumeVersionCard
          key={version.volumePlanVersionId}
          version={version}
          active={selectedPlan.activeVersionId === version.volumePlanVersionId}
          busy={busy}
          onPreview={() => previewCandidate(version.volumePlanVersionId)}
        />)}</div>
      </section>}

      {impact !== null && <aside className="volume-impact-card" aria-label="版本影响预览">
        <div><strong>确认前影响预览</strong><p>{impact.note}</p></div>
        <dl><div><dt>改变的部分</dt><dd>{impact.changedFields.map(fieldLabel).join('、') || '无'}</dd></div><div><dt>需要复核的下游</dt><dd>{impact.downstreamDependencyCount} 项</dd></div></dl>
        <div className="button-row"><button type="button" onClick={() => setImpact(null)}>先不确认</button><button className="primary-button" type="button" disabled={busy} onClick={confirmCandidate}>确认此版本</button></div>
      </aside>}
    </>}
  </section>;
}

function TemplateChooser({ catalog, mode, selected, customDirection, onMode, onSelect, onCustomDirection }: {
  catalog: NarrativeTemplateCatalogView;
  mode: 'template' | 'custom' | 'none';
  selected: PublicNarrativeTemplate | null;
  customDirection: string;
  onMode: (mode: 'template' | 'custom' | 'none') => void;
  onSelect: (template: PublicNarrativeTemplate) => void;
  onCustomDirection: (value: string) => void;
}): React.JSX.Element {
  return <section className="volume-template-section">
    <header><div><h4>这一卷想怎么推进？</h4><p>这些是大白话的节奏参考，可以调整，也可以完全不用。</p></div></header>
    <div className="volume-template-grid">
      {catalog.templates.map((template) => <button
        type="button"
        className={mode === 'template' && selected?.templateKey === template.templateKey ? 'selected' : ''}
        key={template.templateKey}
        onClick={() => onSelect(template)}
      ><span>{template.recommended ? '推荐' : '推进参考'}</span><strong>{template.publicTitle}</strong><p>{template.publicExplanation}</p></button>)}
      <button type="button" className={mode === 'custom' ? 'selected' : ''} onClick={() => onMode('custom')}><span>自定义</span><strong>按我的想法推进</strong><p>只记录你的方向，不套用固定节奏。</p></button>
      <button type="button" className={mode === 'none' ? 'selected' : ''} onClick={() => onMode('none')}><span>自由设计</span><strong>暂时不选推进参考</strong><p>让人物目标和已有因果自然决定本卷结构。</p></button>
    </div>
    {mode === 'custom' && <label className="volume-custom-direction"><span>我的推进方向</span><textarea rows={3} value={customDirection} onChange={(event) => onCustomDirection(event.target.value)} placeholder="例如：前半卷让主角以为自己找对了方向，中段发现胜利反而伤害了盟友，后半卷必须换一种办法。" /></label>}
  </section>;
}

function VolumeGenerationCard({ generation, busy, onStart, onCancel, onRetry, onResume }: {
  generation: VolumePlanGenerationData | null;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onResume: () => void;
}): React.JSX.Element {
  const active = generation !== null && generationIsActive(generation.status);
  const canRetry = generation?.status === 'failed' || generation?.status === 'interrupted';
  const candidateCount = generation === null ? 0 : [
    generation.candidateVersionIds.candidateA,
    generation.candidateVersionIds.candidateB,
    generation.candidateVersionIds.fusion
  ].filter(Boolean).length;
  return <section className={`volume-generation-card ${active ? 'working' : ''}`} aria-label="卷规划团队设计">
    <header>
      <div>
        <span>AI协作</span>
        <h4>两位编剧独立设计，主编最后融合</h4>
        <p>两位编剧使用同一份事实底稿，但互不查看对方答案；主编只在两份方案完成后比较取舍。模板是参考，不会把人物和剧情锁死。</p>
      </div>
      <button className="primary-button" type="button" disabled={busy || active} onClick={onStart}>
        {generation?.status === 'succeeded' ? '再设计一组方案' : '让团队开始设计'}
      </button>
    </header>

    {generation === null
      ? <div className="volume-generation-empty"><strong>尚未启动</strong><p>先选择推进参考、补充作者想法，再启动团队。你也可以随时手工填写自己的方案。</p></div>
      : <>
        <div className="volume-generation-summary">
          <div><small>本轮状态</small><strong>{generationStatusLabel(generation.status)}</strong></div>
          <div><small>当前步骤</small><strong>{generationPhaseLabel(generation.currentPhase)}</strong></div>
          <div><small>已保存</small><strong>{candidateCount}/3 个候选版本</strong></div>
          <div><small>独立性</small><strong>{generation.modelDiversityVerified ? '两位编剧来自不同模型' : '本地流程测试配置'}</strong></div>
        </div>
        {!generation.modelDiversityVerified && <p className="volume-generation-notice">当前两位编剧使用本地确定性测试模型，只验证任务、上下文和版本流程，不冒充异模型独立复核。</p>}
        <div className="volume-generation-members">
          {generation.members.map((member) => <article key={`${member.roleKey}:${member.agentId}`}>
            <div><strong>{generationRoleLabel(member.roleKey)}</strong><span>{member.displayName}</span></div>
            <p>{generationMemberState(generation, member.roleKey)}</p>
            <small>{member.provider} · {member.modelId}</small>
          </article>)}
        </div>
        {generation.errorCode !== null && <p className="inline-error">本轮没有完整结束（{generation.errorCode}）。已成功保存的候选不会丢失。</p>}
        <footer className="button-row">
          {active && generation.status !== 'paused' && <button type="button" disabled={busy} onClick={onCancel}>停止本轮</button>}
          {generation.status === 'paused' && <button type="button" disabled={busy} onClick={onResume}>继续本轮</button>}
          {canRetry && <button type="button" disabled={busy} onClick={onRetry}>从已保存进度重试</button>}
        </footer>
      </>}
  </section>;
}

function VolumePlanEditor({ value, onChange, onSave, busy }: {
  value: VolumePlanContent;
  onChange: (value: VolumePlanContent) => void;
  onSave: () => void;
  busy: boolean;
}): React.JSX.Element {
  const firstEvent = value.eventSequence[0]!;
  const setText = (field: keyof VolumePlanContent, next: string): void => onChange({ ...value, [field]: next });
  const setList = (field: keyof VolumePlanContent, next: string): void => onChange({
    ...value, [field]: lines(next)
  });
  const setEvent = (field: keyof typeof firstEvent, next: string): void => onChange({
    ...value,
    eventSequence: [{ ...firstEvent, [field]: next }, ...value.eventSequence.slice(1)]
  });
  return <section className="volume-plan-editor">
    <header><div><h4>我的卷规划草案</h4><p>先写清“为什么发生”和“发生后改变什么”。章节数只是预估，不会锁死。</p></div><button className="primary-button" type="button" disabled={busy} onClick={onSave}>保存为新候选版</button></header>
    <div className="volume-editor-grid">
      <label><span>卷标题</span><input value={value.title} onChange={(event) => setText('title', event.target.value)} /></label>
      <label><span>开卷时人物与局面</span><textarea rows={3} value={value.openingState} onChange={(event) => setText('openingState', event.target.value)} /></label>
      <label><span>这一卷必须完成什么</span><textarea rows={3} value={value.coreGoal} onChange={(event) => setText('coreGoal', event.target.value)} /></label>
      <label><span>最主要的对抗</span><textarea rows={3} value={value.coreConflict} onChange={(event) => setText('coreConflict', event.target.value)} /></label>
      <label><span>失败会失去什么</span><textarea rows={3} value={value.failureCost} onChange={(event) => setText('failureCost', event.target.value)} /></label>
      <label><span>人物要发生的变化（每行一条）</span><textarea rows={3} value={value.characterChanges.join('\n')} onChange={(event) => setList('characterChanges', event.target.value)} /></label>
      <label><span>卷末留下什么局面</span><textarea rows={3} value={value.endingState} onChange={(event) => setText('endingState', event.target.value)} /></label>
      <label><span>怎样自然引出下一卷</span><textarea rows={3} value={value.nextVolumeTrigger} onChange={(event) => setText('nextVolumeTrigger', event.target.value)} /></label>
    </div>
    <fieldset className="volume-event-seed"><legend>第一个事件种子</legend><div className="volume-editor-grid">
      <label><span>事件名称</span><input value={firstEvent.title} onChange={(event) => setEvent('title', event.target.value)} /></label>
      <label><span>它为本卷承担什么任务</span><textarea rows={2} value={firstEvent.responsibility} onChange={(event) => setEvent('responsibility', event.target.value)} /></label>
      <label><span>从什么状态进入</span><textarea rows={2} value={firstEvent.entryState} onChange={(event) => setEvent('entryState', event.target.value)} /></label>
      <label><span>什么事情触发它</span><textarea rows={2} value={firstEvent.trigger} onChange={(event) => setEvent('trigger', event.target.value)} /></label>
      <label><span>人物采取什么行动</span><textarea rows={2} value={firstEvent.action} onChange={(event) => setEvent('action', event.target.value)} /></label>
      <label><span>行动造成什么结果</span><textarea rows={2} value={firstEvent.result} onChange={(event) => setEvent('result', event.target.value)} /></label>
    </div></fieldset>
    <div className="volume-editor-grid compact">
      <label><span>信息怎样逐步揭示（每行一条）</span><textarea rows={3} value={value.informationPlan.join('\n')} onChange={(event) => setList('informationPlan', event.target.value)} /></label>
      <label><span>压力怎样升级、人物怎样喘息（每行一条）</span><textarea rows={3} value={value.escalationAndRecovery.join('\n')} onChange={(event) => setList('escalationAndRecovery', event.target.value)} /></label>
      <label><span>卷末仍未解决的问题（每行一条）</span><textarea rows={3} value={value.openThreads.join('\n')} onChange={(event) => setList('openThreads', event.target.value)} /></label>
      <label><span>不能违反（每行一条）</span><textarea rows={3} value={value.boundaries.mustNotViolate.join('\n')} onChange={(event) => onChange({ ...value, boundaries: { ...value.boundaries, mustNotViolate: lines(event.target.value) } })} /></label>
      <label><span>允许自由发挥（每行一条）</span><textarea rows={3} value={value.boundaries.creativeFreedom.join('\n')} onChange={(event) => onChange({ ...value, boundaries: { ...value.boundaries, creativeFreedom: lines(event.target.value) } })} /></label>
    </div>
  </section>;
}

function VolumeVersionCard({ version, active, busy, onPreview }: {
  version: VolumePlanVersionData;
  active: boolean;
  busy: boolean;
  onPreview: () => void;
}): React.JSX.Element {
  return <article className={`volume-version-card ${active ? 'active' : ''}`}>
    <header><span>{candidateLabel(version.candidateKind)}</span><small>第{version.version}版 · {active ? '当前确认版' : statusLabel(version.status)}</small></header>
    <h5>{version.content.title}</h5>
    <dl><div><dt>本卷目标</dt><dd>{version.content.coreGoal}</dd></div><div><dt>核心冲突</dt><dd>{version.content.coreConflict}</dd></div><div><dt>卷末状态</dt><dd>{version.content.endingState}</dd></div><div><dt>事件数量</dt><dd>{version.content.eventSequence.length} 个</dd></div></dl>
    <button type="button" disabled={busy || active} onClick={onPreview}>{active ? '正在使用' : version.status === 'superseded' ? '查看切回影响' : '预览并确认'}</button>
  </article>;
}

function emptyVolumePlan(planNumber: number): VolumePlanContent {
  return {
    title: `第${planNumber}卷`, openingState: '', coreGoal: '', coreConflict: '', failureCost: '',
    characterChanges: [],
    eventSequence: [{
      eventId: `event-${planNumber}-1`, order: 1, title: '', responsibility: '', entryState: '',
      trigger: '', action: '', result: '', leadsToNext: null,
      estimatedChapterRange: { minimum: null, likely: null, maximum: null }
    }],
    informationPlan: [], escalationAndRecovery: [], endingState: '', openThreads: [], nextVolumeTrigger: '',
    boundaries: { mustAchieve: [], mustNotViolate: [], creativeFreedom: [], openQuestions: [] }
  };
}

function templateInstance(
  mode: 'template' | 'custom' | 'none',
  selected: PublicNarrativeTemplate | null,
  customDirection: string
): PlanningTemplateInstance {
  if (mode === 'template' && selected !== null) return {
    selectionMode: 'template', templateKey: selected.templateKey, templateVersion: selected.templateVersion,
    templateHash: selected.contentHash, scope: 'volume',
    beats: selected.beats.map((beat) => ({ ...beat, authorIdeaRefs: [] })), customDirection: null
  };
  return {
    selectionMode: mode, templateKey: null, templateVersion: null, templateHash: null,
    scope: 'volume', beats: [], customDirection: mode === 'custom' ? customDirection.trim() || null : null
  };
}

function lines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean))];
}

function key(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${prefix}:${randomId ?? `${Date.now()}-${Math.random()}`}`;
}

function generationIsActive(status: string): boolean {
  return ['pending', 'queued', 'working', 'paused'].includes(status);
}

function generationStatusLabel(status: string): string {
  return ({
    pending: '正在准备', queued: '已进入任务队列', working: '团队正在设计', paused: '已暂停',
    succeeded: '三个方案已完成', failed: '本轮未完成', interrupted: '任务被中断',
    cancelled: '本轮已停止', blocked: '等待处理'
  } as Record<string, string>)[status] ?? status;
}

function generationPhaseLabel(phase: string): string {
  return ({
    preparing_context: '准备事实、设定与作者意见',
    screenwriter_candidates: '两份独立方案已保存，主编正在融合',
    fusion_complete: '主编融合方案已保存',
    failed: '保留检查点，等待重试'
  } as Record<string, string>)[phase] ?? phase;
}

function generationRoleLabel(roleKey: string): string {
  return ({
    lead_screenwriter: '编剧A', second_screenwriter: '编剧B',
    main_editor: '主编', deputy_editor: '代理主编'
  } as Record<string, string>)[roleKey] ?? roleKey;
}

function generationMemberState(generation: VolumePlanGenerationData, roleKey: string): string {
  const storedId = roleKey === 'lead_screenwriter'
    ? generation.candidateVersionIds.candidateA
    : roleKey === 'second_screenwriter'
      ? generation.candidateVersionIds.candidateB
      : generation.candidateVersionIds.fusion;
  if (storedId !== null) return '方案已保存为不可覆盖的新版本';
  if (generation.status === 'cancelled') return '本轮已停止';
  if (generation.status === 'failed' || generation.status === 'interrupted') return '本轮未完成，可从检查点重试';
  if (generation.status === 'paused') return '已暂停，等待作者继续';
  if (['pending', 'queued'].includes(generation.status)) return '等待后台领取任务';
  const screenwritersReady = generation.candidateVersionIds.candidateA !== null
    && generation.candidateVersionIds.candidateB !== null;
  if (!['lead_screenwriter', 'second_screenwriter'].includes(roleKey) && screenwritersReady) {
    return '正在比较两份完整方案并融合';
  }
  if (!['lead_screenwriter', 'second_screenwriter'].includes(roleKey)) return '等待两位编剧独立完成';
  return '正在使用独立上下文设计方案';
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : '当前卷规划操作失败，请稍后重试。';
}

function candidateLabel(kind: VolumePlanVersionData['candidateKind']): string {
  return ({ candidate_a: '编剧方案A', candidate_b: '编剧方案B', author_edit: '作者修改', fusion: '主编融合', legacy: '旧稿参考' })[kind];
}

function statusLabel(status: VolumePlanVersionData['status']): string {
  return ({ candidate: '待确认', active: '已确认', superseded: '历史确认版', archived: '已归档' })[status];
}

function fieldLabel(field: string): string {
  return ({
    title: '卷标题', openingState: '开卷状态', coreGoal: '本卷目标', coreConflict: '核心冲突',
    failureCost: '失败代价', characterChanges: '人物变化', eventSequence: '事件链',
    informationPlan: '信息推进', escalationAndRecovery: '压力与恢复', endingState: '卷末状态',
    openThreads: '开放线索', nextVolumeTrigger: '下一卷接口', boundaries: '创作边界'
  } as Record<string, string>)[field] ?? field;
}
