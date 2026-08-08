import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  NarrativeTemplateCatalogView,
  PlanningTemplateInstance,
  PublicNarrativeTemplate,
  VolumePlanContent
} from '@wenmi/contracts';
import {
  addVolumePlanVersion,
  confirmVolumePlanVersion,
  createVolumePlan,
  fetchAuthorPlanningInputs,
  fetchCreationWorkflow,
  fetchPlanningTemplates,
  fetchVolumePlans,
  fetchVolumePlanVersions,
  previewVolumePlanImpact,
  type VolumePlanData,
  type VolumePlanImpactData,
  type VolumePlanVersionData
} from '../../lib/api/client';

interface VolumePlanningSnapshot {
  workflow: Awaited<ReturnType<typeof fetchCreationWorkflow>>;
  plans: VolumePlanData[];
  templates: NarrativeTemplateCatalogView;
}

export function VolumePlanningPanel({ bookId }: { bookId: string }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<VolumePlanningSnapshot | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VolumePlanVersionData[]>([]);
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
      return;
    }
    const controller = new AbortController();
    void fetchVolumePlanVersions(bookId, selectedPlan.volumePlanId, controller.signal)
      .then(setVersions)
      .catch((reason) => { if (!controller.signal.aborted) setError(messageOf(reason)); });
    setDraft(selectedPlan.activeVersion?.content ?? emptyVolumePlan(selectedPlan.planNumber));
    setEditing(selectedPlan.activeVersion === null);
    setImpact(null);
    return () => controller.abort();
  }, [bookId, selectedPlan?.volumePlanId, selectedPlan?.activeVersionId]);

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
      const authorIdeas = await fetchAuthorPlanningInputs(bookId, { surface: 'volume_plan' });
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
