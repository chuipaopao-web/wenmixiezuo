import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightIcon, EyeIcon, LightbulbIcon } from '@phosphor-icons/react';
import type {
  CoreWorkflowV6View, StorylineContent, StorylineGrowthCandidateContent, StorylineGrowthCandidateView
} from '@wenmi/contracts';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import { AiNodePanel, V6Dialog, V6Drawer, V6EmptyState, V6ErrorState, V6LoadingState, V6PageHeader } from './V6Shared';
import {
  addStorylineGrowthCandidate,
  addStorylineOpenQuestion,
  confirmStoryline,
  createStoryline,
  createStorylineGrowthRound,
  decideStorylineGrowthCandidate,
  fetchCoreWorkflow,
  reorderStorylines,
  saveStorylineFrontier,
  saveStorylineVersion,
  upsertStorylineRelation,
  updateStorylineLifecycle
} from './v6-api';
import { StorylineBoard } from './StorylineBoard';

export function StorylineWorkspace({ bookId, bookTitle, onChanged, onNext }: {
  bookId: string;
  bookTitle: string;
  onChanged?: () => Promise<void> | void;
  onNext: () => void;
}): React.JSX.Element {
  const [workflow, setWorkflow] = useState<CoreWorkflowV6View | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ storylineId: string | null; content: StorylineContent } | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [relationOpen, setRelationOpen] = useState(false);
  const [mapTab, setMapTab] = useState<'lines' | 'progress' | 'foreshadow'>('lines');
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try { setWorkflow(await fetchCoreWorkflow(bookId, signal)); setError(null); }
    catch (reason) { if (signal?.aborted !== true) setError(authorErrorFromUnknown(reason, '故事线加载失败')); }
    finally { if (signal?.aborted !== true) setLoading(false); }
  }, [bookId]);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const source = useMemo(() => {
    const actual = workflow?.ledgers.storyline.actual ?? [];
    const latest = actual.at(-1);
    return { sourceType: 'storyline_actual_settlements', sourceId: latest?.sourceVersionId ?? bookId,
      ...(latest === undefined ? {} : { version: latest.sourceVersionId }),
      content: JSON.stringify({ title: bookTitle, actual }),
      reason: '只包含正文与结算已经实际发生的故事线推进。', priority: 100,
      truthStatus: 'actual' as const, knowledgeZone: 'hard_fact' as const, constraintStrength: 'hard_fact' as const,
      scopeType: 'book' as const, scopeId: bookId, componentKind: 'RecentActualStatePack' as const };
  }, [bookId, bookTitle, workflow?.ledgers.storyline.actual]);
  const storylinePlanSources = useMemo(() => [{
    sourceType: 'author_storyline_frontier', sourceId: workflow?.growth.frontiers[0]?.frontierVersionId ?? bookId,
    version: workflow?.growth.frontiers[0]?.frontierVersionId ?? bookId,
    content: JSON.stringify({ activeStorylines: workflow?.storylines.filter((line) => line.lifecycleStatus !== 'abandoned')
      .map((line) => line.activeVersion?.content) ?? [], authorFrontiers: workflow?.growth.frontiers ?? [] }),
    reason: '作者已确认的当前故事线与最远边界；允许阶段终点和未知全书结局。', priority: 99,
    truthStatus: 'planned' as const, knowledgeZone: 'author_plan' as const, constraintStrength: 'current_task' as const,
    scopeType: 'book' as const, scopeId: bookId, componentKind: 'BookStorySpinePack' as const
  }], [bookId, workflow?.growth.frontiers, workflow?.storylines]);
  const storylineOpenQuestionSources = useMemo(() => (workflow?.growth.openQuestions ?? []).filter((item) => item.status === 'open').map((item) => ({
    sourceType: 'storyline_open_question', sourceId: item.openQuestionId, version: item.updatedAt,
    content: item.question, reason: '作者明确保留的未知项，不得被模型擅自补成事实。', priority: 80,
    truthStatus: 'confirmed' as const, knowledgeZone: 'open_question' as const, constraintStrength: 'open_space' as const,
    scopeType: 'book' as const, scopeId: bookId, componentKind: 'BookStorySpinePack' as const
  })), [bookId, workflow?.growth.openQuestions]);

  const activeLines = workflow?.storylines.filter((line) => line.lifecycleStatus !== 'abandoned') ?? [];

  const moveLine = async (storylineId: string, direction: -1 | 1): Promise<void> => {
    const ids = activeLines.map((line) => line.storylineId);
    const from = ids.indexOf(storylineId); const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    setBusy(true);
    try { await reorderStorylines(bookId, ids); await load(); }
    catch (reason) { setError(authorErrorFromUnknown(reason, '故事线排序失败')); }
    finally { setBusy(false); }
  };

  const saveLine = async (content: StorylineContent): Promise<void> => {
    setBusy(true); setError(null);
    try {
      if (editor?.storylineId === null || editor === null) {
        const created = await createStoryline(bookId, content, activeLines.length + 1);
        await confirmStoryline(bookId, created.storylineId, created.versionId, null);
      } else {
        const current = workflow?.storylines.find((item) => item.storylineId === editor.storylineId);
        const saved = await saveStorylineVersion(bookId, editor.storylineId, content);
        await confirmStoryline(bookId, editor.storylineId, saved.versionId, current?.activeVersionId ?? null);
      }
      setEditor(null); await load(); await onChanged?.();
    } catch (reason) { setError(authorErrorFromUnknown(reason, '故事线保存失败')); }
    finally { setBusy(false); }
  };

  const acceptAiDirection = async (content: Record<string, unknown>): Promise<void> => {
    if (workflow === null) return;
    setBusy(true); setError(null);
    try {
      const normalized = growthContent(content, activeLines.map((line) => line.storylineId));
      const evidenceRefs: Array<{ sourceKind: string; sourceVersionId: string; locator?: string }> = workflow.ledgers.storyline.actual.slice(-5).map((entry) => ({
        sourceKind: entry.sourceKind, sourceVersionId: entry.sourceVersionId,
        locator: `${entry.scopeType}:${entry.scopeId}`
      }));
      if (evidenceRefs.length === 0) evidenceRefs.push({ sourceKind: 'book_core', sourceVersionId: bookId, locator: '开书资料与作者当前边界' });
      const idempotencyKey = `author-direction:${crypto.randomUUID()}`;
      const growthRound = await createStorylineGrowthRound(bookId, {
        triggerKind: 'author_request', triggerObjectId: 'storyline-root', triggerVersionId: workflow.growth.frontiers[0]?.frontierVersionId ?? bookId,
        evidenceRefs, idempotencyKey
      });
      const candidate = await addStorylineGrowthCandidate(bookId, growthRound.growthRoundId, {
        candidateKind: 'next_direction', storylineId: activeLines[0]?.storylineId ?? null,
        title: String(content.title ?? '主编推荐的下一段').trim() || '主编推荐的下一段', content: normalized,
        evidenceRefs, basedOnVersionIds: activeLines.flatMap((line) => line.activeVersionId === null ? [] : [line.activeVersionId])
      });
      await decideStorylineGrowthCandidate(bookId, candidate.candidateId, {
        decision: 'accepted', idempotencyKey: `accept:${candidate.candidateId}`, expectedStatus: 'candidate'
      });
      setConfirmation('已把这份建议保存为作者当前规划；它不会冒充正文已经发生。');
      await load(); await onChanged?.();
    } catch (reason) { setError(authorErrorFromUnknown(reason, '这份下一段建议暂时无法采用')); }
    finally { setBusy(false); }
  };

  if (loading) return <V6LoadingState label="正在整理已发生、当前推进与开放问题…" />;
  if (workflow === null) return <V6ErrorState message={error ?? '故事线暂时无法打开'} onRetry={() => void load()} />;

  return <section className="v6-page v6-storyline-page">
    <V6PageHeader eyebrow="全书脉络" title="全书故事线" description="故事线跟着正文生长；只确认现在看得见的部分，未知和全书结局可以一直留空。" mapAction={() => setMapOpen(true)} />
    {activeLines.length === 0 && <section className="v6-paper-section v6-storyline-entry">
      <header><span>现在只决定眼前</span><h3>有完整想法就建立故事线，只有开局灵感也可以直接写第一卷</h3><p>系统不会把第一卷或第二卷设成必须交全书故事线的门槛。</p></header>
      <footer><button type="button" className="v6-quiet-button" onClick={() => setEditor({ storylineId: null, content: emptyLine('新故事线', 'core') })}>我已有故事线</button>
        <button type="button" className="v6-primary-button" onClick={onNext}>只有开局灵感，进入第一卷<ArrowRightIcon /></button></footer>
    </section>}
    <StorylineBoard lines={activeLines} busy={busy}
      growthPanel={<StorylineGrowthWorkspace bookId={bookId} workflow={workflow} busy={busy}
        onBusy={setBusy} onError={setError} onReload={load} />}
      onAdd={() => setEditor({ storylineId: null, content: emptyLine(activeLines.length === 0 ? '新故事线' : '新支线', activeLines.length === 0 ? 'core' : 'branch') })}
      onRelations={() => setRelationOpen(true)} onView={(view) => { setMapTab(view); setMapOpen(true); }}
      onMove={(storylineId, offset) => void moveLine(storylineId, offset)}
      onEdit={(storylineId, content) => setEditor({ storylineId, content })}
      onAbandon={(storylineId) => void updateStorylineLifecycle(bookId, storylineId, 'abandoned').then(() => load())} />
    <div className="v6-next-step"><span><strong>{activeLines.length === 0 ? '没有故事线也可以继续' : '目前能确认的部分已经保存'}</strong><small>{activeLines.length === 0 ? '先写第一卷，之后再从正文与结算提炼。' : '后续仍可随正文延长、暂停或长出新线。'}</small></span>
      <button type="button" className="v6-primary-button" onClick={onNext}>{activeLines.length === 0 ? '继续边写边看' : '进入分卷'}<ArrowRightIcon /></button></div>
    <details className="v6-storyline-ai-tools"><summary>请主编推荐下一段</summary><AiNodePanel bookId={bookId}
      nodeKind="storyline_next_direction" objectId="storyline-root" roleKey="chief_editor"
      title="主编只推荐下一至两卷" taskDescription="每位主编独立给出有正文证据的下一段方向，也可以建议继续观察。"
      source={source} additionalHardSources={storylinePlanSources} optionalSources={storylineOpenQuestionSources} templateVersion="storyline-next-direction-v2" defaultMemberCount={2}
      onUseCandidate={(content) => { void acceptAiDirection(content); }} /></details>
    {confirmation !== null && <p className="v6-inline-success" role="status">{confirmation}</p>}
    {editor !== null && <LineEditor initial={editor.content} characters={workflow.characters} busy={busy} onClose={() => setEditor(null)} onSave={(content) => void saveLine(content)} />}
    {relationOpen && <RelationEditor lines={activeLines.map((line) => ({ id: line.storylineId, title: line.activeVersion?.content.title ?? '未命名故事线' }))}
      onClose={() => setRelationOpen(false)} onSave={async (input) => {
        setBusy(true);
        try { await upsertStorylineRelation(bookId, input); setRelationOpen(false); await load(); }
        catch (reason) { setError(authorErrorFromUnknown(reason, '线路关系保存失败')); }
        finally { setBusy(false); }
      }} />}
    {mapOpen && <V6Drawer title="故事地图" onClose={() => setMapOpen(false)}>
      <div className="v6-map-tabs" role="tablist">{([['lines', '线路地图'], ['progress', '推进轨道'], ['foreshadow', '伏笔轨道']] as const).map(([key, label]) => <button type="button" role="tab" aria-selected={mapTab === key} key={key} onClick={() => setMapTab(key)}>{label}</button>)}</div>
      <StoryMap tab={mapTab} workflow={workflow} />
    </V6Drawer>}
    {error !== null && <p className="v6-inline-error" role="alert">{error}</p>}
  </section>;
}

function StorylineGrowthWorkspace({ bookId, workflow, busy, onBusy, onError, onReload }: {
  bookId: string; workflow: CoreWorkflowV6View; busy: boolean; onBusy: (value: boolean) => void;
  onError: (value: string | null) => void; onReload: () => Promise<void>;
}): React.JSX.Element {
  const lines = workflow.storylines.filter((line) => line.lifecycleStatus !== 'abandoned' && line.activeVersion !== null);
  const [frontierLineId, setFrontierLineId] = useState(lines[0]?.storylineId ?? '');
  const [frontierSummary, setFrontierSummary] = useState('');
  const [targetVolume, setTargetVolume] = useState('');
  const [stageEnding, setStageEnding] = useState('');
  const [questionLineId, setQuestionLineId] = useState('');
  const [question, setQuestion] = useState('');
  const [editingCandidate, setEditingCandidate] = useState<StorylineGrowthCandidateView | null>(null);
  const pending = workflow.growth.candidates.filter((item) => item.status === 'candidate');
  const openQuestions = workflow.growth.openQuestions.filter((item) => item.status === 'open');
  const globalFrontier = workflow.growth.frontiers.find((item) => item.storylineId === null);
  const globalQuestions = openQuestions.filter((item) => item.storylineId === null);
  const latestActual = workflow.ledgers.storyline.actual.at(-1);
  const visibleFrontiers = workflow.growth.frontiers.slice(0, 3);
  const progressing = lines.filter((line) => line.lifecycleStatus === 'active');

  const decide = async (candidate: StorylineGrowthCandidateView, decision: 'accepted' | 'rejected' | 'observing', editedContent?: StorylineGrowthCandidateContent): Promise<void> => {
    onBusy(true); onError(null);
    try {
      await decideStorylineGrowthCandidate(bookId, candidate.candidateId, {
        decision, idempotencyKey: `${decision}:${candidate.candidateId}`, expectedStatus: 'candidate',
        ...(editedContent === undefined ? {} : { editedContent })
      });
      await onReload();
    } catch (reason) { onError(authorErrorFromUnknown(reason, '候选处理失败')); }
    finally { onBusy(false); }
  };

  return <section className="v6-storyline-growth-panel" aria-label="滚动故事线">
    <header><div><span><LightbulbIcon />主编推荐下一段</span><h3>只看下一卷到未来两卷</h3><p>所有建议都是候选；作者确认前不会进入正式规划，更不会写成已发生事实。</p></div>
      <small>{pending.length === 0 ? '目前没有待决定建议' : `${pending.length} 条待决定`}</small></header>
    <section className="v6-growth-status-strip" aria-label="故事线当前状态">
      <div><strong>已经发生</strong><p>{latestActual === undefined ? '等待正文与结算长出真实进度' : growthLedgerSummary(latestActual.content)}</p><small>只读 · 来自正文结算</small></div>
      <div><strong>正在推进</strong><p>{progressing.length === 0 ? '当前没有必须建立的正式故事线' : progressing.map((line) => line.activeVersion?.content.title).filter(Boolean).join('、')}</p><small>{progressing.length} 条活跃线路</small></div>
      <div><strong>我目前想到这里</strong><p>{visibleFrontiers.length === 0 ? '可以暂时留空，边写边确认' : visibleFrontiers.map((item) => item.summary).join('；')}</p><small>作者确认的最远边界</small></div>
      <div><strong>还没决定</strong><p>{openQuestions.length === 0 ? '没有必须现在回答的问题' : openQuestions.slice(0, 3).map((item) => item.question).join('；')}</p><small>{openQuestions.length} 个开放问题</small></div>
    </section>
    {pending.length === 0 ? <div className="v6-growth-empty"><EyeIcon /><span><strong>可以继续观察</strong><small>证据不足时，不补方向也是专业结论。</small></span></div>
      : <div className="v6-growth-candidate-list">{pending.map((candidate) => <article key={candidate.candidateId}>
        <header><span>{candidate.candidateKind === 'emerging_line' ? '潜在线路' : '下一段方向'}</span><strong>{candidate.title}</strong></header>
        <p>{candidate.content.summary}</p><dl><div><dt>为什么自然延伸</dt><dd>{candidate.content.continuationReason}</dd></div>
          <div><dt>主角为什么卷入</dt><dd>{candidate.content.protagonistInvolvement}</dd></div>
          <div><dt>还不知道</dt><dd>{candidate.content.unknowns.join('；') || '暂无'}</dd></div></dl>
        <details><summary>查看证据与误判风险</summary><p>{candidate.evidenceRefs.map((item) => `${item.sourceKind} · ${item.locator ?? item.sourceVersionId}`).join('；')}</p><p>{candidate.content.misreadRisk}</p></details>
        <footer><button type="button" disabled={busy} className="v6-primary-button" onClick={() => void decide(candidate, 'accepted')}>直接采用</button>
          <button type="button" disabled={busy} className="v6-quiet-button" onClick={() => setEditingCandidate(candidate)}>编辑后采用</button>
          <button type="button" disabled={busy} className="v6-quiet-button" onClick={() => void decide(candidate, 'observing')}>继续观察</button>
          <button type="button" disabled={busy} className="v6-quiet-button" onClick={() => void decide(candidate, 'rejected')}>不采用</button></footer>
      </article>)}</div>}
    <details className="v6-growth-author-inputs"><summary>记录“我目前想到这里”和“还没决定”</summary>
      <div className="v6-growth-input-grid"><form onSubmit={(event) => { event.preventDefault(); if (!frontierSummary.trim()) return; onBusy(true); onError(null);
        const storylineId = frontierLineId || null; const active = workflow.growth.frontiers.find((item) => item.storylineId === storylineId);
        void saveStorylineFrontier(bookId, { storylineId, summary: frontierSummary, targetVolumeNumber: targetVolume ? Number(targetVolume) : null,
          stageEnding: stageEnding || null, fullBookEndingKnown: false, expectedActiveVersionId: active?.frontierVersionId ?? null })
          .then(async () => { setFrontierSummary(''); setTargetVolume(''); setStageEnding(''); await onReload(); })
          .catch((reason) => onError(authorErrorFromUnknown(reason, '作者边界保存失败'))).finally(() => onBusy(false)); }}>
          <h4>我目前想到这里</h4><select aria-label="边界所属故事线" value={frontierLineId} onChange={(event) => setFrontierLineId(event.target.value)}><option value="">全书当前边界</option>{lines.map((line) => <option value={line.storylineId} key={line.storylineId}>{line.activeVersion?.content.title}</option>)}</select>
          <textarea aria-label="目前想到的位置" rows={3} value={frontierSummary} onChange={(event) => setFrontierSummary(event.target.value)} placeholder={globalFrontier?.summary ?? '例如：我只想到第十卷完成宗门复仇'} />
          <div><input inputMode="numeric" aria-label="目前想到第几卷" value={targetVolume} onChange={(event) => setTargetVolume(event.target.value.replace(/\D/gu, ''))} placeholder="最远卷数（可空）" />
            <input aria-label="阶段终点" value={stageEnding} onChange={(event) => setStageEnding(event.target.value)} placeholder="阶段终点（可空）" /></div>
          <button type="submit" className="v6-quiet-button" disabled={busy || !frontierSummary.trim()}>保存目前边界</button></form>
        <form onSubmit={(event) => { event.preventDefault(); if (!question.trim()) return; onBusy(true); onError(null);
          void addStorylineOpenQuestion(bookId, { storylineId: questionLineId || null, question })
            .then(async () => { setQuestion(''); await onReload(); }).catch((reason) => onError(authorErrorFromUnknown(reason, '开放问题保存失败'))).finally(() => onBusy(false)); }}>
          <h4>还没决定</h4><select aria-label="开放问题所属故事线" value={questionLineId} onChange={(event) => setQuestionLineId(event.target.value)}><option value="">全书开放问题</option>{lines.map((line) => <option value={line.storylineId} key={line.storylineId}>{line.activeVersion?.content.title}</option>)}</select>
          <textarea aria-label="还没决定的问题" rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：身世线是否在复仇之后成为新主线？" />
          {globalQuestions.length > 0 && <small>已保留：{globalQuestions.map((item) => item.question).join('；')}</small>}
          <button type="submit" className="v6-quiet-button" disabled={busy || !question.trim()}>保留开放问题</button></form></div>
    </details>
    {editingCandidate !== null && <GrowthCandidateEditor candidate={editingCandidate} busy={busy} onClose={() => setEditingCandidate(null)} onSave={async (content) => {
      await decide(editingCandidate, 'accepted', content); setEditingCandidate(null);
    }} />}
  </section>;
}

function GrowthCandidateEditor({ candidate, busy, onClose, onSave }: {
  candidate: StorylineGrowthCandidateView; busy: boolean; onClose: () => void;
  onSave: (content: StorylineGrowthCandidateContent) => Promise<void>;
}): React.JSX.Element {
  const [content, setContent] = useState(candidate.content);
  const [unknowns, setUnknowns] = useState(candidate.content.unknowns.join('\n'));
  return <V6Dialog title="编辑后采用主编建议" onClose={onClose}>
    <div className="v6-field-grid">
      <label className="wide"><span>下一段方向</span><textarea rows={3} value={content.summary} onChange={(event) => setContent({ ...content, summary: event.target.value })} /></label>
      <label className="wide"><span>为什么能从正文自然延伸</span><textarea rows={3} value={content.continuationReason} onChange={(event) => setContent({ ...content, continuationReason: event.target.value })} /></label>
      <label className="wide"><span>主角为什么继续卷入</span><textarea rows={2} value={content.protagonistInvolvement} onChange={(event) => setContent({ ...content, protagonistInvolvement: event.target.value })} /></label>
      <label className="wide"><span>下一段核心问题</span><textarea rows={2} value={content.coreQuestion} onChange={(event) => setContent({ ...content, coreQuestion: event.target.value })} /></label>
      <label><span>还不知道（每行一项）</span><textarea rows={4} value={unknowns} onChange={(event) => setUnknowns(event.target.value)} /></label>
      <label><span>误判风险</span><textarea rows={4} value={content.misreadRisk} onChange={(event) => setContent({ ...content, misreadRisk: event.target.value })} /></label>
    </div>
    <footer><button type="button" className="v6-quiet-button" onClick={onClose}>取消</button><button type="button" className="v6-primary-button" disabled={busy || content.summary.trim() === ''}
      onClick={() => void onSave({ ...content, unknowns: lines(unknowns) })}>保存为作者计划</button></footer>
  </V6Dialog>;
}

function growthLedgerSummary(content: Record<string, unknown>): string {
  for (const key of ['actualProgress', 'result', 'summary', 'endingState', 'actual']) {
    const value = content[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '已产生结算记录，查看故事地图可核对完整证据';
}
function growthContent(value: Record<string, unknown>, validStorylineIds: string[]): StorylineGrowthCandidateContent {
  const list = (candidate: unknown): string[] => Array.isArray(candidate) ? candidate.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
  const text = (candidate: unknown, fallback: string): string => typeof candidate === 'string' && candidate.trim() ? candidate.trim() : fallback;
  const horizon = Number(value.recommendedHorizonVolumes ?? 1);
  return {
    summary: text(value.summary, '继续围绕当前最强矛盾推进一段'),
    continuationReason: text(value.continuationReason, '从当前已确认状态自然延伸'),
    protagonistInvolvement: text(value.protagonistInvolvement, '主角的当前目标使其无法置身事外'),
    coreQuestion: text(value.coreQuestion, '主角下一步要付出什么代价？'),
    pushesStorylineIds: list(value.pushesStorylineIds).filter((item) => validStorylineIds.includes(item)),
    mayCreateStoryline: value.mayCreateStoryline === true,
    inferences: list(value.inferences), unknowns: list(value.unknowns),
    misreadRisk: text(value.misreadRisk, '这只是基于当前资料的推断，正文改变后应重新评估。'),
    recommendedHorizonVolumes: Number.isInteger(horizon) ? Math.max(1, Math.min(2, horizon)) : 1
  };
}
function RelationEditor({ lines: items, onClose, onSave }: {
  lines: Array<{ id: string; title: string }>;
  onClose: () => void;
  onSave: (input: { fromStorylineId: string; toStorylineId: string; relationType: 'serves' | 'constrains' | 'mirrors' | 'intersects'; description: string }) => Promise<void>;
}): React.JSX.Element {
  const [from, setFrom] = useState(items[0]?.id ?? ''); const [to, setTo] = useState(items[1]?.id ?? '');
  const [relationType, setRelationType] = useState<'serves' | 'constrains' | 'mirrors' | 'intersects'>('serves');
  const [description, setDescription] = useState('');
  return <V6Dialog title="设置线路关系" onClose={onClose}>
    <div className="v6-field-grid"><label><span>从这条线</span><select value={from} onChange={(event) => setFrom(event.target.value)}>{items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label><span>到这条线</span><select value={to} onChange={(event) => setTo(event.target.value)}>{items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label><span>关系</span><select value={relationType} onChange={(event) => setRelationType(event.target.value as typeof relationType)}><option value="serves">服务</option><option value="constrains">牵制</option><option value="mirrors">映照</option><option value="intersects">交汇</option></select></label>
      <label className="wide"><span>白话说明</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label></div>
    <footer><button type="button" className="v6-quiet-button" onClick={onClose}>取消</button><button type="button" className="v6-primary-button" disabled={from === to || description.trim() === ''} onClick={() => void onSave({ fromStorylineId: from, toStorylineId: to, relationType, description })}>保存关系</button></footer>
  </V6Dialog>;
}
function LineEditor({ initial, characters, busy, onClose, onSave }: { initial: StorylineContent; characters: CoreWorkflowV6View['characters']; busy: boolean; onClose: () => void; onSave: (content: StorylineContent) => void }): React.JSX.Element {
  const [content, setContent] = useState(initial);
  const [stages, setStages] = useState(initial.expectedStages.join('\n'));
  const [foreshadows, setForeshadows] = useState(initial.foreshadowingKeys.join('\n'));
  return <div className="v6-dialog-backdrop"><section className="v6-dialog v6-line-editor" role="dialog" aria-modal="true" aria-labelledby="line-editor-title">
    <header><h3 id="line-editor-title">编辑故事线</h3><button type="button" className="v6-icon-button" aria-label="关闭" onClick={onClose}>×</button></header>
    <div className="v6-field-grid"><label><span>线路名称</span><input value={content.title} onChange={(event) => setContent({ ...content, title: event.target.value })} /></label>
      <label><span>线路性质</span><select value={content.lineKind} onChange={(event) => setContent({ ...content, lineKind: event.target.value as StorylineContent['lineKind'] })}><option value="core">核心线</option><option value="branch">支线</option><option value="unit">单元线</option></select></label>
      <label className="wide"><span>这条线要回答的核心问题</span><textarea rows={2} value={content.coreQuestion} onChange={(event) => setContent({ ...content, coreQuestion: event.target.value })} /></label>
      <label className="wide"><span>当前阶段目标</span><textarea rows={2} value={content.stageGoal} onChange={(event) => setContent({ ...content, stageGoal: event.target.value })} /></label>
      <label><span>预计阶段（每行一项）</span><textarea rows={4} value={stages} onChange={(event) => setStages(event.target.value)} /></label>
      <label><span>伏笔（每行一项）</span><textarea rows={4} value={foreshadows} onChange={(event) => setForeshadows(event.target.value)} /></label>
      <fieldset className="wide v6-option-checks"><legend>关联角色</legend>{characters.filter((item) => item.content !== null).map((character) => <label key={character.characterId}>
        <input type="checkbox" checked={content.associatedCharacterIds.includes(character.characterId)} onChange={(event) => setContent({ ...content,
          associatedCharacterIds: event.target.checked ? [...content.associatedCharacterIds, character.characterId] : content.associatedCharacterIds.filter((id) => id !== character.characterId) })} />
        <span>{character.content?.name}</span></label>)}{characters.length === 0 && <small>角色会在后续角色安排中补充。</small>}</fieldset>
    </div>
    <footer><button type="button" className="v6-quiet-button" onClick={onClose}>取消</button><button type="button" className="v6-primary-button" disabled={busy || content.title.trim() === '' || content.coreQuestion.trim() === ''}
      onClick={() => onSave({ ...content, expectedStages: lines(stages), foreshadowingKeys: lines(foreshadows) })}>保存并确认版本</button></footer>
  </section></div>;
}

function StoryMap({ tab, workflow }: { tab: 'lines' | 'progress' | 'foreshadow'; workflow: CoreWorkflowV6View }): React.JSX.Element {
  if (tab === 'foreshadow') {
    const items = workflow.storylines.flatMap((line) => line.activeVersion?.content.foreshadowingKeys.map((key) => ({ line: line.activeVersion?.content.title ?? '', key })) ?? []);
    return items.length === 0 ? <V6EmptyState title="尚无伏笔记录" description="伏笔计划在事件和章节中管理，实际进度由结算更新。" />
      : <ul className="v6-map-list">{items.map((item) => <li key={`${item.line}:${item.key}`}><i data-truth="planned" /><span><strong>{item.key}</strong><small>{item.line} · 计划</small></span></li>)}</ul>;
  }
  return <div className="v6-map-canvas">{workflow.storylines.map((line) => {
    const content = line.activeVersion?.content;
    if (content === undefined) return null;
    const actual = workflow.ledgers.storyline.actual.some((entry) => entry.subjectKey === line.storylineId);
    return <article key={line.storylineId} data-line={actual ? 'actual' : line.lifecycleStatus === 'abandoned' ? 'abandoned' : line.lifecycleStatus === 'ideation' ? 'pending' : 'planned'}>
      <span>{content.lineKind === 'core' ? '核心线' : content.lineKind === 'branch' ? '支线' : '单元线'}</span><strong>{content.title}</strong><p>{tab === 'progress' ? content.stageGoal : content.coreQuestion}</p>
    </article>;
  })}<div className="v6-map-legend"><span><i data-line="actual" />真实已发生</span><span><i data-line="planned" />计划</span><span><i data-line="pending" />待定</span><span><i data-line="abandoned" />废弃</span></div></div>;
}

function emptyLine(title: string, kind: StorylineContent['lineKind']): StorylineContent {
  return { title, lineKind: kind, coreQuestion: '', stageGoal: '', expectedStages: [], associatedCharacterIds: [], foreshadowingKeys: [], rhythmMethodVersionId: null };
}

function lines(value: string): string[] { return value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean); }
function lineKindLabel(value: StorylineContent['lineKind']): string { return value === 'core' ? '全书核心线' : value === 'branch' ? '支线' : '单元线'; }
function lifecycleLabel(value: string): string { return ({ ideation: '构思中', active: '推进中', paused: '暂缓', completed: '已完成', abandoned: '已废弃' } as Record<string, string>)[value] ?? value; }
