import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircleIcon, CompassIcon, PauseCircleIcon, PathIcon } from '@phosphor-icons/react';
import type { CoreWorkflowV6View, StorylineVolumeParticipationStatus } from '@wenmi/contracts';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import {
  fetchVolumePlans, fetchVolumeSettlement, type PlanningSettlementData, type VolumePlanData
} from '../../lib/api/client';
import { AiNodePanel, V6ErrorState, V6LoadingState } from './V6Shared';
import { fetchCoreWorkflow, upsertVolumeParticipation } from './v6-api';

type LineChoice = { status: StorylineVolumeParticipationStatus; responsibility: string };

export function VolumeLineOrchestration({ bookId, bookTitle }: { bookId: string; bookTitle: string }): React.JSX.Element {
  const [workflow, setWorkflow] = useState<CoreWorkflowV6View | null>(null);
  const [plan, setPlan] = useState<VolumePlanData | null>(null);
  const [previousSettlement, setPreviousSettlement] = useState<PlanningSettlementData | null>(null);
  const [choices, setChoices] = useState<Record<string, LineChoice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [nextWorkflow, plans] = await Promise.all([fetchCoreWorkflow(bookId, signal), fetchVolumePlans(bookId, signal)]);
      const activePlan = [...plans].reverse().find((item) => item.status !== 'archived') ?? null;
      const settlement = activePlan?.previousVolumePlanId == null
        ? null : await fetchVolumeSettlement(bookId, activePlan.previousVolumePlanId, signal);
      setWorkflow(nextWorkflow); setPlan(activePlan); setPreviousSettlement(settlement);
      if (activePlan !== null) {
        const next: Record<string, LineChoice> = {};
        for (const line of nextWorkflow.storylines.filter((item) => item.lifecycleStatus !== 'abandoned')) {
          const saved = nextWorkflow.volumeParticipations.find((item) => item.storylineId === line.storylineId && item.volumePlanId === activePlan.volumePlanId);
          next[line.storylineId] = { status: saved?.participationStatus ?? 'unrelated', responsibility: saved?.responsibility ?? '' };
        }
        setChoices(next);
      }
      setError(null);
    } catch (reason) { if (signal?.aborted !== true) setError(authorErrorFromUnknown(reason, '本卷线路编排加载失败')); }
  }, [bookId]);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const activeLines = workflow?.storylines.filter((line) => line.lifecycleStatus !== 'abandoned' && line.activeVersion !== null) ?? [];
  const confirmedCount = plan === null ? 0 : workflow?.volumeParticipations.filter((item) => item.volumePlanId === plan.volumePlanId && item.status === 'active').length ?? 0;
  const source = useMemo(() => ({
    sourceType: activeLines.length === 0 ? 'author_opening_boundary' : 'author_storyline_frontier',
    sourceId: plan?.activeVersion?.volumePlanVersionId ?? workflow?.growth.frontiers[0]?.frontierVersionId ?? bookId,
    version: plan?.activeVersion?.volumePlanVersionId ?? workflow?.growth.frontiers[0]?.frontierVersionId ?? bookId,
    content: JSON.stringify({ title: bookTitle, currentVolumePlan: plan?.activeVersion?.content ?? null,
      storylines: activeLines.map((line) => line.activeVersion?.content),
      protagonists: (workflow?.characters ?? []).filter((item) => item.characterKind === 'protagonist' && item.content !== null)
        .map((item) => item.content), authorFrontiers: workflow?.growth.frontiers ?? [] }),
    reason: activeLines.length === 0 ? '开书蓝图、主角当前处境和作者已知边界；不要求全书故事线。' : '作者已确认的故事线、本卷方向和目前最远边界。',
    priority: 100, truthStatus: 'planned' as const, knowledgeZone: 'author_plan' as const, constraintStrength: 'current_task' as const,
    scopeType: 'volume' as const, scopeId: plan?.volumePlanId ?? bookId, componentKind: 'VolumeResponsibilityPack' as const
  }), [activeLines, bookId, bookTitle, plan?.activeVersion, plan?.volumePlanId, workflow?.growth.frontiers]);
  const volumeActualSources = useMemo(() => previousSettlement === null ? [] : [{
    sourceType: 'volume_settlement_actual', sourceId: previousSettlement.settlementId, version: previousSettlement.version,
    content: JSON.stringify(previousSettlement.actual), reason: '上一卷已经确认的实际结算，只记录正文真正发生的结果。', priority: 100,
    truthStatus: 'actual' as const, knowledgeZone: 'hard_fact' as const, constraintStrength: 'hard_fact' as const,
    scopeType: 'volume' as const, scopeId: previousSettlement.stageObjectId, componentKind: 'RecentActualStatePack' as const
  }], [previousSettlement]);
  const volumeOpenQuestionSources = useMemo(() => (workflow?.growth.openQuestions ?? []).filter((item) => item.status === 'open').map((item) => ({
    sourceType: 'storyline_open_question', sourceId: item.openQuestionId, version: item.updatedAt,
    content: item.question, reason: '作者明确保留的未知压力，不得在分卷候选中擅自补成事实。', priority: 78,
    truthStatus: 'confirmed' as const, knowledgeZone: 'open_question' as const, constraintStrength: 'open_space' as const,
    scopeType: 'volume' as const, scopeId: plan?.volumePlanId ?? bookId, componentKind: 'VolumeResponsibilityPack' as const
  })), [bookId, plan?.volumePlanId, workflow?.growth.openQuestions]);

  if (workflow === null && error === null) return <V6LoadingState label="正在读取上卷结算与本卷状态…" />;
  if (workflow === null) return <V6ErrorState message={error ?? '本卷方向暂时无法打开'} onRetry={() => void load()} />;

  const save = async (): Promise<void> => {
    if (plan === null) return;
    setBusy(true); setError(null);
    try {
      for (const line of activeLines) {
        const choice = choices[line.storylineId] ?? { status: 'unrelated' as const, responsibility: '' };
        await upsertVolumeParticipation(bookId, { storylineId: line.storylineId, volumePlanId: plan.volumePlanId,
          participationStatus: choice.status, responsibility: choice.responsibility || null });
      }
      await load();
    } catch (reason) { setError(authorErrorFromUnknown(reason, '线路参与状态保存失败')); }
    finally { setBusy(false); }
  };

  const content = plan?.activeVersion?.content;
  const actualSummary = previousSettlement === null ? null : plainSettlement(previousSettlement.actual);
  return <section className="v6-line-orchestration">
    <header><div><span>01 · 线路编排</span><h3>本卷推进哪些线</h3><p>这里只决定主导、配合、埋伏或暂缓；没有故事线也能继续设计本卷。</p></div>
      {confirmedCount > 0 && <small><CheckCircleIcon weight="fill" />已保存 {confirmedCount} 条线路参与状态</small>}</header>
    <details className="v6-causal-bridge-inline" open>
      <summary><span>下一卷因果桥</span><strong>{plan?.planNumber === 1 ? '第一卷从开局自然出发' : '上一卷实际结果如何把故事推到这里'}</strong></summary>
      <dl><div><dt>上卷实际结果</dt><dd>{actualSummary ?? (plan?.planNumber === 1 ? '第一卷没有上卷结算' : '等待有效卷结算')}</dd></div>
        <div><dt>新的状态</dt><dd>{content?.openingState ?? '从开书蓝图、主角当前处境和已确认设定出发'}</dd></div>
        <div><dt>未解决压力</dt><dd>{content?.coreConflict ?? '当前卷压力尚待作者确认'}</dd></div>
        <div><dt>主角选择</dt><dd>{content?.coreGoal ?? '主角将作出本卷最关键的选择'}</dd></div>
        <div><dt>本卷目标</dt><dd>{content?.endingState ?? '形成可被正文验证的本卷变化'}</dd></div>
        <div><dt>受影响故事线</dt><dd>{activeLines.length === 0 ? '暂不挂靠；可随正文长出' : `${activeLines.length} 条已确认线路可选`}</dd></div></dl>
    </details>
    {plan === null ? <p className="v6-soft-notice"><PauseCircleIcon />先在下方建立当前卷，再回来确认线路参与。</p>
      : activeLines.length === 0 ? <div className="v6-no-line-volume"><CompassIcon /><div><strong>本卷暂不挂靠正式故事线</strong><p>这不是缺陷。可以直接确认本卷方向，正文推进后再由主编提炼潜在线路。</p></div></div>
      : <><div className="v6-line-choice-list">{activeLines.map((line) => {
        const lineContent = line.activeVersion!.content; const choice = choices[line.storylineId] ?? { status: 'unrelated' as const, responsibility: '' };
        return <article key={line.storylineId}><div><PathIcon /><span><small>{lineContent.lineKind === 'core' ? '核心线' : lineContent.lineKind === 'branch' ? '支线' : '单元线'}</small>
          <strong>{lineContent.title}</strong><p>{lineContent.stageGoal}</p></span></div>
          <select aria-label={`${lineContent.title}本卷参与状态`} value={choice.status} onChange={(event) => setChoices((current) => ({ ...current,
            [line.storylineId]: { ...choice, status: event.target.value as StorylineVolumeParticipationStatus } }))}>
            <option value="leading">本卷主导</option><option value="important">重要配合</option><option value="foreshadow">只埋伏笔</option>
            <option value="paused">本卷暂缓</option><option value="unrelated">本卷不涉及</option></select>
          <input aria-label={`${lineContent.title}本卷责任`} value={choice.responsibility} placeholder="本卷只写到什么程度（可选）"
            disabled={['paused', 'unrelated'].includes(choice.status)} onChange={(event) => setChoices((current) => ({ ...current,
              [line.storylineId]: { ...choice, responsibility: event.target.value } }))} /></article>;
      })}</div><footer><button type="button" className="v6-primary-button" disabled={busy} onClick={() => void save()}>{busy ? '正在保存…' : '确认本卷线路参与'}</button></footer></>}
    <AiNodePanel bookId={bookId} nodeKind="volume_causal_direction" objectId={plan?.volumePlanId ?? 'next-volume'} roleKey="screenwriter"
      title="让编剧提出当前卷走向" taskDescription="只根据因果桥、作者当前边界和开放问题设计这一卷；不得要求完整全书结局。"
      source={source} additionalHardSources={volumeActualSources} optionalSources={volumeOpenQuestionSources} templateVersion="volume-causal-direction-v2" defaultMemberCount={2} />
    {error !== null && <p className="v6-inline-error">{error}</p>}
  </section>;
}
function plainSettlement(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    for (const key of ['summary', 'result', 'endingState', 'actual']) {
      const candidate = row[key]; if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  }
  return '上一卷已经完成结算；完整实际结果可从卷记录查看。';
}
