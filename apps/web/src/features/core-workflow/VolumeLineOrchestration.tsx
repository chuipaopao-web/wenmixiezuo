import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircleIcon, PauseCircleIcon, PathIcon } from '@phosphor-icons/react';
import type { CoreWorkflowV6View, StorylineVolumeParticipationStatus } from '@wenmi/contracts';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import { fetchVolumePlans, type VolumePlanData } from '../../lib/api/client';
import { AiNodePanel, V6EmptyState, V6ErrorState, V6LoadingState } from './V6Shared';
import { fetchCoreWorkflow, upsertVolumeParticipation } from './v6-api';

type LineChoice = { status: StorylineVolumeParticipationStatus; responsibility: string };

export function VolumeLineOrchestration({ bookId, bookTitle }: { bookId: string; bookTitle: string }): React.JSX.Element {
  const [workflow, setWorkflow] = useState<CoreWorkflowV6View | null>(null);
  const [plan, setPlan] = useState<VolumePlanData | null>(null);
  const [choices, setChoices] = useState<Record<string, LineChoice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [nextWorkflow, plans] = await Promise.all([fetchCoreWorkflow(bookId, signal), fetchVolumePlans(bookId, signal)]);
      const activePlan = [...plans].reverse().find((item) => !['archived'].includes(item.status)) ?? null;
      setWorkflow(nextWorkflow); setPlan(activePlan);
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
    sourceType: 'storyline_spine', sourceId: workflow?.topology.active?.topologyVersionId ?? bookId,
    ...(workflow?.topology.active?.version === undefined ? {} : { version: workflow.topology.active.version }), content: JSON.stringify({ title: bookTitle,
      topology: workflow?.topology.active?.content ?? null, storylines: activeLines.map((line) => line.activeVersion?.content) }),
    reason: '已确认全书结构与故事线骨架', priority: 100, truthStatus: 'confirmed' as const,
    constraintStrength: 'hard_fact' as const, scopeType: 'volume' as const, scopeId: plan?.volumePlanId ?? bookId,
    componentKind: 'BookStorySpinePack' as const
  }), [activeLines, bookId, bookTitle, plan?.volumePlanId, workflow?.topology.active]);

  if (workflow === null && error === null) return <V6LoadingState label="正在读取故事线与本卷状态…" />;
  if (workflow === null) return <V6ErrorState message={error ?? '线路编排暂时无法打开'} onRetry={() => void load()} />;
  if (activeLines.length === 0) return <V6EmptyState title="先确认故事线" description="分卷只安排已确认的故事线，不会从分卷页反向臆造全书结构。" />;

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

  return <section className="v6-line-orchestration">
    <header><div><span>01 · 线路编排</span><h3>本卷推进哪些线</h3><p>这里只决定主导、配合、埋伏或暂缓；具体卷末责任留到路线选择后确认。</p></div>
      {confirmedCount > 0 && <small><CheckCircleIcon weight="fill" />已保存 {confirmedCount} 条线路参与状态</small>}</header>
    {plan === null ? <p className="v6-soft-notice"><PauseCircleIcon />先在下方建立当前卷，再回来确认线路参与。</p>
      : <><div className="v6-line-choice-list">{activeLines.map((line) => {
        const content = line.activeVersion!.content; const choice = choices[line.storylineId] ?? { status: 'unrelated' as const, responsibility: '' };
        return <article key={line.storylineId}>
          <div><PathIcon /><span><small>{content.lineKind === 'core' ? '核心线' : content.lineKind === 'branch' ? '支线' : '单元线'}</small><strong>{content.title}</strong><p>{content.stageGoal}</p></span></div>
          <select aria-label={`${content.title}本卷参与状态`} value={choice.status} onChange={(event) => setChoices((current) => ({ ...current,
            [line.storylineId]: { ...choice, status: event.target.value as StorylineVolumeParticipationStatus } }))}>
            <option value="leading">本卷主导</option><option value="important">重要配合</option><option value="foreshadow">只埋伏笔</option><option value="paused">本卷暂缓</option><option value="unrelated">本卷不涉及</option>
          </select>
          <input aria-label={`${content.title}本卷责任`} value={choice.responsibility} placeholder="本卷只写到什么程度（可选）"
            disabled={['paused', 'unrelated'].includes(choice.status)} onChange={(event) => setChoices((current) => ({ ...current,
              [line.storylineId]: { ...choice, responsibility: event.target.value } }))} />
        </article>;
      })}</div><footer><button type="button" className="v6-primary-button" disabled={busy} onClick={() => void save()}>{busy ? '正在保存…' : '确认本卷线路参与'}</button></footer></>}
    <AiNodePanel bookId={bookId} nodeKind="volume_lineup" objectId={plan?.volumePlanId ?? 'next-volume'} roleKey="screenwriter"
      title="让 AI 推荐线路编排" taskDescription="只推荐本卷推进与暂缓哪些线，不提前替您决定卷末结果。" source={source}
      templateVersion="volume-lineup-v1" />
    {error !== null && <p className="v6-inline-error">{error}</p>}
  </section>;
}
