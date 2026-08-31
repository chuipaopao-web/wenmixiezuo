import {
  CaretDownIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  GitBranchIcon,
  PathIcon,
  SparkleIcon
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AuthorApiError,
  cancelPlanningRouteRun,
  cancelPlanningTreeGeneration,
  confirmPlanningTree,
  createPlanningRouteRun,
  createPlanningTreeGeneration,
  decidePlanningRoute,
  decidePlanningAdjustmentSuggestion,
  fetchLatestPlanningRouteRun,
  fetchLatestPlanningTreeGeneration,
  fetchPlanningMembers,
  fetchPlanningAdjustmentSuggestions,
  fetchPlanningRouteRun,
  fetchPlanningTree,
  fetchPlanningTreeGeneration,
  retryMissingPlanningRoutes,
  retryPlanningTreeGeneration,
  type PlanningRouteRunView,
  type PlanningMemberView,
  type PlanningAdjustmentSuggestionView,
  type PlanningRouteView,
  type PlanningTreeGenerationView,
  type PlanningTreeNodeView,
  type PlanningTreeView
} from './opening-api';
import { memberAvatarPosition, memberDisplayName } from './member-avatars';
import { publicFailureCopy, publicRoleLabel, publicStatusCopy, uniqueByMemberKey } from './author-projection';
import { WorkflowActionDock } from './WorkflowActionDock';

type DecisionMode = 'select' | 'adjust' | 'merge';

export function TimeMachinePage({ bookId, onOpenSettings }: { bookId: string; onOpenSettings?: () => void }): React.JSX.Element {
  const [routeRun, setRouteRun] = useState<PlanningRouteRunView | null>(null);
  const [generation, setGeneration] = useState<PlanningTreeGenerationView | null>(null);
  const [tree, setTree] = useState<PlanningTreeView | null>(null);
  const [members, setMembers] = useState<PlanningMemberView[]>([]);
  const [suggestions, setSuggestions] = useState<PlanningAdjustmentSuggestionView[]>([]);
  const [treeMemberKey, setTreeMemberKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authorGoal, setAuthorGoal] = useState('');
  const [candidateCount, setCandidateCount] = useState<1 | 2 | 3>(1);
  const [routeMemberKeys, setRouteMemberKeys] = useState<string[]>([]);
  const [mode, setMode] = useState<DecisionMode>('select');
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);
  const [authorNote, setAuthorNote] = useState('');
  const [editingDirection, setEditingDirection] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    const [treeResult, routeResult, generationResult, rosterResult, suggestionsResult] = await Promise.allSettled([
      fetchPlanningTree(bookId, 'book', bookId, signal),
      fetchLatestPlanningRouteRun(bookId, signal),
      fetchLatestPlanningTreeGeneration(bookId, 'book', bookId, signal),
      fetchPlanningMembers(signal),
      fetchPlanningAdjustmentSuggestions(bookId, signal)
    ]);
    if (Boolean(signal?.aborted)) return;

    let coreError: string | null = null;
    let loadedTree: PlanningTreeView | null = null;
    if (treeResult.status === 'fulfilled') {
      loadedTree = treeResult.value;
      setTree(treeResult.value);
    }
    else if (treeResult.reason instanceof AuthorApiError && treeResult.reason.status === 404) setTree(null);
    else {
      setTree(null);
      coreError = publicError(treeResult.reason);
    }

    if (routeResult.status === 'fulfilled') setRouteRun(routeResult.value);
    else {
      setRouteRun(null);
      coreError ??= publicError(routeResult.reason);
    }
    if (generationResult.status === 'fulfilled') {
      setGeneration(generationResult.value);
      if (generationResult.value?.status === 'ready' && loadedTree === null) {
        try {
          loadedTree = await fetchPlanningTree(bookId, 'book', bookId, signal);
          if (Boolean(signal?.aborted)) return;
          setTree(loadedTree);
        } catch (reason) {
          if (!(reason instanceof AuthorApiError && reason.status === 404)) coreError ??= publicError(reason);
        }
      }
    }
    else {
      setGeneration(null);
      coreError ??= publicError(generationResult.reason);
    }

    // 成员名单和未来调整建议都是辅助信息；它们临时失败时，核心规划仍可自动安排并继续。
    setMembers(rosterResult.status === 'fulfilled' ? uniqueByMemberKey(rosterResult.value) : []);
    setSuggestions(suggestionsResult.status === 'fulfilled' ? suggestionsResult.value : []);
    setError(coreError);
  }, [bookId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(publicError(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (routeRun === null || !['waiting', 'working'].includes(routeRun.status)) return;
    const timer = window.setInterval(() => {
      void fetchPlanningRouteRun(bookId, routeRun.runId)
        .then(setRouteRun)
        .catch((reason: unknown) => setError(publicError(reason)));
    }, 1_800);
    return () => window.clearInterval(timer);
  }, [bookId, routeRun]);

  const applyGeneration = useCallback(async (next: PlanningTreeGenerationView): Promise<void> => {
    setGeneration(next);
    if (next.status !== 'ready') return;
    setTree(await fetchPlanningTree(bookId, 'book', bookId));
    setEditingDirection(false);
  }, [bookId]);

  useEffect(() => {
    if (generation === null || !['waiting', 'working'].includes(generation.status)) return;
    const timer = window.setInterval(() => {
      void fetchPlanningTreeGeneration(bookId, generation.runId).then(async (next) => {
        await applyGeneration(next);
      }).catch((reason: unknown) => setError(publicError(reason)));
    }, 1_800);
    return () => window.clearInterval(timer);
  }, [applyGeneration, bookId, generation]);

  const recommendedId = routeRun?.chiefReview?.recommendedRouteId ?? null;
  useEffect(() => {
    if (routeRun?.canDecide !== true || selectedRouteIds.length > 0) return;
    const first = recommendedId ?? routeRun.routes[0]?.routeId;
    if (first !== undefined) setSelectedRouteIds([first]);
  }, [recommendedId, routeRun, selectedRouteIds.length]);

  const startRoutes = async (): Promise<void> => {
    setEditingDirection(true);
    setBusy(true); setError(null);
    try { setRouteRun(await createPlanningRouteRun(bookId, authorGoal, candidateCount, routeMemberKeys.slice(0, candidateCount).filter(Boolean))); }
    catch (reason) { setError(publicError(reason)); }
    finally { setBusy(false); }
  };

  const retryMissingRoutes = async (): Promise<void> => {
    if (routeRun === null) return;
    setBusy(true); setError(null);
    try { setRouteRun(await retryMissingPlanningRoutes(bookId, routeRun.runId)); }
    catch (reason) { setError(publicError(reason)); }
    finally { setBusy(false); }
  };

  const continueTree = async (): Promise<void> => {
    setBusy(true); setError(null);
    try { await applyGeneration(await createPlanningTreeGeneration(bookId, 'book', bookId, treeMemberKey || undefined)); }
    catch (reason) { setError(publicError(reason)); }
    finally { setBusy(false); }
  };

  const retryGeneration = async (): Promise<void> => {
    if (generation?.status !== 'failed') return;
    setBusy(true); setError(null);
    try { await applyGeneration(await retryPlanningTreeGeneration(bookId, generation.runId)); }
    catch (reason) { setError(publicError(reason)); }
    finally { setBusy(false); }
  };

  const reconcileGeneration = async (): Promise<void> => {
    if (generation?.status !== 'result_unknown') return;
    setBusy(true); setError(null);
    try { await applyGeneration(await fetchPlanningTreeGeneration(bookId, generation.runId)); }
    catch (reason) { setError(publicError(reason)); }
    finally { setBusy(false); }
  };

  const returnToBookDirection = (): void => {
    setError(null);
    setRouteRun(null);
    setGeneration(null);
    setSelectedRouteIds([]);
    setMode('select');
    setAuthorNote('');
    setEditingDirection(true);
  };

  const submitDecision = async (): Promise<void> => {
    if (routeRun === null) return;
    const validCount = mode === 'merge' ? selectedRouteIds.length >= 2 : selectedRouteIds.length === 1;
    if (!validCount) { setError(mode === 'merge' ? '请先勾选两到三套方向。' : '请先选择一套方向。'); return; }
    if (mode !== 'select' && authorNote.trim().length === 0) { setError('请写下您想怎么调整。'); return; }
    setBusy(true); setError(null);
    try {
      await decidePlanningRoute(bookId, routeRun.runId, { mode, routeIds: selectedRouteIds, authorNote });
      setRouteRun(await fetchPlanningRouteRun(bookId, routeRun.runId));
      setGeneration(await createPlanningTreeGeneration(bookId, 'book', bookId, treeMemberKey || undefined));
    } catch (reason) { setError(publicError(reason)); }
    finally { setBusy(false); }
  };

  const confirmTree = async (): Promise<void> => {
    if (tree === null) return;
    setBusy(true); setError(null);
    try { setTree(await confirmPlanningTree(bookId, 'book', bookId, tree.revision)); }
    catch (reason) { setError(publicError(reason)); }
    finally { setBusy(false); }
  };

  const stopRoute = async (): Promise<void> => {
    if (routeRun === null) return;
    setBusy(true); setError(null);
    try { setRouteRun(await cancelPlanningRouteRun(bookId, routeRun.runId)); }
    catch (reason) { setError(publicError(reason)); }
    finally { setBusy(false); }
  };

  const stopGeneration = async (): Promise<void> => {
    if (generation === null) return;
    setBusy(true); setError(null);
    try { setGeneration(await cancelPlanningTreeGeneration(bookId, generation.runId)); }
    catch (reason) { setError(publicError(reason)); }
    finally { setBusy(false); }
  };

  const decideSuggestion = async (suggestion: PlanningAdjustmentSuggestionView, decision: 'accept' | 'dismiss'): Promise<void> => {
    setBusy(true); setError(null);
    try {
      await decidePlanningAdjustmentSuggestion(bookId, suggestion.suggestionId, decision);
      setSuggestions((current) => current.filter((item) => item.suggestionId !== suggestion.suggestionId));
    } catch (reason) { setError(publicError(reason)); }
    finally { setBusy(false); }
  };

  const selectRoute = (routeId: string): void => {
    if (mode !== 'merge') { setSelectedRouteIds([routeId]); return; }
    setSelectedRouteIds((current) => current.includes(routeId)
      ? current.filter((item) => item !== routeId)
      : current.length >= 3 ? current : [...current, routeId]);
  };

  const renderPlanningWorkflow = (compact = false, freshStart = false): React.JSX.Element => {
    if (!freshStart && generation !== null && ['waiting', 'working'].includes(generation.status)) {
      return <PlanningWaiting message={generation.message} state={generation.status === 'working' ? 'working' : 'waiting'} memberName={generation.member.name} memberKey={generation.member.memberKey} timing={generation.timing} busy={busy} onStop={stopGeneration} />;
    }
    if (!freshStart && generation?.status === 'failed') {
      return <PlanningRecovery
        message={generation.errorMessage ?? generation.message}
        busy={busy}
        onRetry={retryGeneration}
        action="继续未完成步骤"
        onReturnDirection={returnToBookDirection}
        {...(onOpenSettings === undefined ? {} : { onOpenSettings })}
      />;
    }
    if (!freshStart && generation?.status === 'result_unknown') {
      return <PlanningRecovery
        message={generation.errorMessage ?? generation.message}
        busy={busy}
        onRetry={reconcileGeneration}
        action="核对这次结果"
        onReturnDirection={returnToBookDirection}
        {...(onOpenSettings === undefined ? {} : { onOpenSettings })}
      />;
    }
    if (!freshStart && routeRun !== null && routeRun.sourceIssues.length > 0) {
      return <PlanningSourceIssues run={routeRun} {...(onOpenSettings === undefined ? {} : { onOpenSettings })} />;
    }
    if (!freshStart && routeRun?.canDecide === true) {
      return <RouteChoicePanel
        run={routeRun} mode={mode} selectedRouteIds={selectedRouteIds} authorNote={authorNote}
        members={members} treeMemberKey={treeMemberKey}
        busy={busy} onMode={(next) => { setMode(next); setSelectedRouteIds([]); }}
        onSelect={selectRoute} onNote={setAuthorNote} onTreeMember={setTreeMemberKey}
        onSubmit={submitDecision} onRetryMissing={retryMissingRoutes}
      />;
    }
    if (!freshStart && routeRun !== null && ['waiting', 'working'].includes(routeRun.status)) {
      return <PlanningWaiting message={routeRun.message} state={routeRun.status === 'working' ? 'working' : 'waiting'} percent={routeRun.progress.percent} actors={routeRun.actors} timing={routeRun.timing} busy={busy} onStop={stopRoute} />;
    }
    if (!freshStart && routeRun?.status === 'failed') {
      return <PlanningRecovery
        message={routeRun.errorMessage ?? routeRun.message}
        busy={busy}
        onRetry={retryMissingRoutes}
        action="继续未完成步骤"
        onReturnDirection={returnToBookDirection}
        {...(onOpenSettings === undefined ? {} : { onOpenSettings })}
      />;
    }
    if (!freshStart && routeRun?.status === 'completed') {
      return <TreeGenerationStart members={members} selectedMemberKey={treeMemberKey} busy={busy} onMember={setTreeMemberKey} onStart={continueTree} />;
    }
    return <PlanningStart
      members={members} authorGoal={authorGoal} candidateCount={candidateCount}
      memberKeys={routeMemberKeys} busy={busy} message={routeRun?.errorMessage ?? null} compact={compact}
      onGoal={setAuthorGoal} onCount={(count) => { setCandidateCount(count); setRouteMemberKeys((current) => current.slice(0, count)); }}
      onMember={(index, memberKey) => setRouteMemberKeys((current) => {
        const next = [...current]; next[index] = memberKey; return next;
      })}
      onStart={startRoutes}
    />;
  };

  const hasPendingPlanning = routeRun?.canDecide === true
    || (routeRun !== null && ['waiting', 'working'].includes(routeRun.status))
    || (generation !== null && ['waiting', 'working'].includes(generation.status))
    || (editingDirection && routeRun !== null && routeRun.sourceIssues.length > 0)
    || routeRun?.status === 'failed'
    || generation?.status === 'failed'
    || generation?.status === 'result_unknown';

  return <section className="time-machine-surface" aria-label="时光机">
    <header className="time-machine-heading">
      <div><ClockCounterClockwiseIcon /><span><strong>时光机</strong><small>看清全书往哪里走，也看见正文实际走到了哪里。</small></span></div>
      {tree?.status === 'confirmed' && <span className="planning-confirmed-mark"><CheckCircleIcon /> 已确认</span>}
    </header>

    {error !== null && <div className="planning-error" role="alert">{error}</div>}
    {!loading && suggestions.length > 0 && <PlanningSuggestionPanel suggestions={suggestions} busy={busy} onDecision={decideSuggestion} />}
    {loading ? <PlanningWaiting message="正在找回这本书的规划进度…" state="waiting" />
      : tree !== null ? <PlanningTreeResult
          tree={tree} busy={busy} members={members} generation={generation} routeRun={routeRun}
          editorialOpen={editingDirection || hasPendingPlanning}
          editorialContent={editingDirection || hasPendingPlanning
            ? renderPlanningWorkflow(true, editingDirection && !hasPendingPlanning)
            : null}
          onEditDirection={() => setEditingDirection(true)} onConfirm={confirmTree}
        />
        : renderPlanningWorkflow()}
  </section>;
}

function PlanningSourceIssues({ run, onOpenSettings }: { run: PlanningRouteRunView; onOpenSettings?: () => void }): React.JSX.Element {
  const chief = run.actors.find((actor) => actor.role.includes('主编')) ?? run.actors[0];
  const memberKey = chief?.memberKey ?? 'planning-chief-deepseek-v4-pro';
  const memberName = memberDisplayName(memberKey, chief?.memberName ?? '主编');
  return <section className="planning-source-issues">
    <header>
      <span className="planning-waiting-avatar" style={{ backgroundPosition: memberAvatarPosition(memberKey) }} aria-hidden="true" />
      <div><strong>{memberName}请您先定几件事</strong><p>这些口径会直接影响全书的时间、资源和卷数，我没有替您擅自决定。</p></div>
    </header>
    <ul>{run.sourceIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
    <div><small>修改并保存设定后，回到时光机重新开始规划即可；本次记录会保留，不会继续消耗额度。</small>
      {onOpenSettings !== undefined && <button type="button" className="planning-primary" onClick={onOpenSettings}>返回设定处理</button>}
    </div>
  </section>;
}

function PlanningSuggestionPanel({ suggestions, busy, onDecision }: {
  suggestions: PlanningAdjustmentSuggestionView[]; busy: boolean;
  onDecision: (suggestion: PlanningAdjustmentSuggestionView, decision: 'accept' | 'dismiss') => Promise<void>;
}): React.JSX.Element {
  return <details className="planning-suggestions" open>
    <summary><span><strong>正文带来了新的变化</strong><small>{suggestions.length}条未来方向建议，只影响还没开始的内容</small></span><CaretDownIcon /></summary>
    <div>{suggestions.map((suggestion) => <article key={suggestion.suggestionId}>
      <div><b>{suggestion.publicSummary}</b>{suggestion.detail.reason !== undefined && <p>{suggestion.detail.reason}</p>}{suggestion.detail.proposedChange !== undefined && <small>建议下一步：{suggestion.detail.proposedChange}</small>}</div>
      <span><button type="button" disabled={busy} onClick={() => void onDecision(suggestion, 'dismiss')}>暂不调整</button><button type="button" className="planning-primary" disabled={busy} onClick={() => void onDecision(suggestion, 'accept')}>采纳到未来方案</button></span>
    </article>)}</div>
  </details>;
}

function PlanningStart({ members, authorGoal, candidateCount, memberKeys, busy, message, compact = false, onGoal, onCount, onMember, onStart }: {
  members: PlanningMemberView[]; authorGoal: string; candidateCount: 1 | 2 | 3; memberKeys: string[];
  busy: boolean; message?: string | null; compact?: boolean; onGoal: (value: string) => void;
  onCount: (value: 1 | 2 | 3) => void; onMember: (index: number, memberKey: string) => void; onStart: () => void;
}): React.JSX.Element {
  const chiefs = uniqueByMemberKey(members.filter((member) => member.roleKey === 'chief_editor')).slice(0, 3);
  return <section className={`planning-start-card${compact ? ' is-compact' : ''}`}>
    <PathIcon />
    <div><h2>先准备全书方向</h2><p>资料策划会先整理本次真正需要的设定和方法，再由主编设计；您需要比较时，可增加到两套或三套。</p></div>
    {chiefs.length > 0 && <PlanningMemberFaces members={chiefs} />}
    {message !== undefined && message !== null && <p className="planning-start-failure">{publicFailureCopy(message)}</p>}
    <div className="planning-route-count" role="group" aria-label="全书路线数量">{([1, 2, 3] as const).map((count) => <button key={count} type="button" aria-pressed={candidateCount === count} onClick={() => onCount(count)}>{count}套</button>)}</div>
    <details className="planning-member-choice"><summary>选择本轮主编（可不选）<CaretDownIcon /></summary>{Array.from({ length: candidateCount }, (_, index) => <label key={index}><span>路线{['一', '二', '三'][index]}主编</span><select value={memberKeys[index] ?? ''} onChange={(event) => onMember(index, event.target.value)}><option value="">编辑部自动安排</option>{chiefs.filter((member) => !memberKeys.some((selected, selectedIndex) => selectedIndex !== index && selected === member.memberKey)).map((member) => <option key={member.memberKey} value={member.memberKey}>{memberDisplayName(member.memberKey, member.name)}{member.defaultForRole ? '（推荐）' : ''}</option>)}</select></label>)}</details>
    <label><span>还有特别想法可以补充（可不填）</span><textarea value={authorGoal} maxLength={2000} onChange={(event) => onGoal(event.target.value)} placeholder="例如：前期重点写小人物求生，中后期再扩大到天下格局。" /></label>
    <WorkflowActionDock
      mode="card"
      title={`准备生成 ${candidateCount} 套全书方向`}
      detail="任务创建后会自动保存进度，离开页面也可以继续。"
      primary={<button type="button" className="planning-primary" disabled={busy} onClick={onStart}>{busy ? '正在建立任务…' : '开始规划全书'}</button>}
    />
  </section>;
}

function PlanningWaiting({ message, percent, state = 'waiting', memberName, memberKey, actors = [], timing, busy = false, onStop }: {
  message: string; percent?: number | null; state?: 'waiting' | 'working'; memberName?: string; memberKey?: string; actors?: PlanningRouteRunView['actors'];
  timing?: PlanningRouteRunView['timing']; busy?: boolean; onStop?: () => void;
}): React.JSX.Element {
  const [confirmingStop, setConfirmingStop] = useState(false);
  const visibleActors = uniqueByMemberKey(actors);
  const active = visibleActors.find((actor) => actor.status === 'working')
    ?? visibleActors.find((actor) => actor.status === 'waiting');
  const displayKey = active?.memberKey ?? memberKey;
  const storedDisplayName = active?.memberName ?? memberName;
  const displayName = displayKey === undefined || storedDisplayName === undefined
    ? storedDisplayName
    : memberDisplayName(displayKey, storedDisplayName);
  const displayState = active?.status === 'working' ? 'working' : active?.status === 'waiting' ? 'waiting' : state;
  const statusCopy = publicStatusCopy(active?.message ?? message, displayState === 'working' ? '正在处理这项工作，请稍等。' : '任务已经接单，正在排队。');
  return <section className="planning-waiting-card" aria-live="polite">
    {displayKey === undefined
      ? <div className="planning-member-orb"><SparkleIcon /></div>
      : <span className="planning-waiting-avatar" style={{ backgroundPosition: memberAvatarPosition(displayKey) }} aria-hidden="true" />}
    <div><strong>{displayState === 'working'
      ? (displayName === undefined ? '编辑部正在工作' : `${displayName}正在工作`)
      : (displayName === undefined ? '任务正在排队' : `${displayName}已经接单`)}</strong><p>{active?.emoji} {statusCopy}</p></div>
    {visibleActors.length > 0 && <PlanningActorStrip actors={visibleActors} />}
    {percent === null || percent === undefined
      ? <div className="planning-progress is-indeterminate" aria-label="正在处理"><span /></div>
      : <div className="planning-progress" aria-label={`已完成${percent}%`}><span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div>}
    <small>{timing === undefined
      ? '任务已经保存，离开页面也不会丢失，回来会继续显示真实进度。'
      : planningTimingCopy(timing.elapsedSeconds, timing.idleSeconds, timing.state)}</small>
    {onStop !== undefined && (confirmingStop
      ? <div className="planning-stop-confirm" role="group" aria-label="确认停止规划">
          <span>已经完成的方案会保留。</span>
          <button type="button" disabled={busy} onClick={() => { setConfirmingStop(false); onStop(); }}>{busy ? '正在停止…' : '保留成果并停止'}</button>
          <button type="button" disabled={busy} onClick={() => setConfirmingStop(false)}>继续工作</button>
        </div>
      : <button type="button" className="planning-stop-button" disabled={busy} onClick={() => setConfirmingStop(true)}>{busy ? '正在停止…' : '停止这项工作'}</button>)}
  </section>;
}

function planningTimingCopy(elapsedSeconds: number, idleSeconds: number, state: 'normal' | 'slow' | 'overdue'): string {
  const elapsed = elapsedSeconds < 60 ? `${elapsedSeconds}秒` : `${Math.floor(elapsedSeconds / 60)}分${elapsedSeconds % 60}秒`;
  if (state === 'overdue') return `已进行${elapsed}，超过15分钟没有新进展；您可以保留成果并停止，再换成员继续。`;
  if (state === 'slow') return `已进行${elapsed}，最近${Math.max(5, Math.floor(idleSeconds / 60))}分钟没有新进展，系统仍在等待真实结果。`;
  return `已进行${elapsed}；任务已保存，离开页面也不会丢失。`;
}

function PlanningActorStrip({ actors }: { actors: PlanningRouteRunView['actors'] }): React.JSX.Element {
  const visibleActors = uniqueByMemberKey(actors);
  const copyFor = (actor: PlanningRouteRunView['actors'][number]): string => actor.status === 'failed'
    ? publicFailureCopy(actor.message)
    : publicStatusCopy(actor.message, actor.status === 'working' ? '正在处理这项工作。' : actor.status === 'waiting' ? '已经接单，正在排队。' : '本轮工作已经完成。');
  return <details className="planning-actor-strip"><summary><span>{visibleActors.slice(0, 6).map((actor) => <i key={actor.memberKey} className={`state-${actor.status}`} style={{ backgroundPosition: memberAvatarPosition(actor.memberKey) }} title={`${memberDisplayName(actor.memberKey, actor.memberName)}：${copyFor(actor)}`} />)}</span>查看成员状态<CaretDownIcon /></summary><div>{visibleActors.map((actor) => <article key={actor.memberKey}><i style={{ backgroundPosition: memberAvatarPosition(actor.memberKey) }} /><span><b>{memberDisplayName(actor.memberKey, actor.memberName)} · {publicRoleLabel(actor.role)}</b><small>{actor.emoji} {copyFor(actor)}</small></span></article>)}</div></details>;
}

function PlanningMemberFaces({ members }: { members: PlanningMemberView[] }): React.JSX.Element {
  const visibleMembers = uniqueByMemberKey(members);
  return <div className="planning-member-faces" aria-label="可选择的成员">{visibleMembers.map((member) => { const name = memberDisplayName(member.memberKey, member.name); return <span key={member.memberKey} title={`${name} · ${publicRoleLabel(member.role, member.roleKey)}`}><i style={{ backgroundPosition: memberAvatarPosition(member.memberKey) }} /><small>{name}</small></span>; })}</div>;
}

function TreeGenerationStart({ members, selectedMemberKey, busy, onMember, onStart }: {
  members: PlanningMemberView[]; selectedMemberKey: string; busy: boolean;
  onMember: (memberKey: string) => void; onStart: () => void;
}): React.JSX.Element {
  const writers = uniqueByMemberKey(members.filter((member) => member.roleKey === 'planning_writer'));
  return <section className="planning-tree-start">
    <div><strong>全书方向已经确认</strong><p>资料策划会按这一步重新整理所需资料，再把方向展开成可逐卷查看的正式框架。</p></div>
    <PlanningMemberFaces members={writers} />
    {writers.length > 1 && <label><span>选择规划编剧（可不选）</span><select value={selectedMemberKey} onChange={(event) => onMember(event.target.value)}><option value="">编辑部自动安排</option>{writers.map((member) => <option key={member.memberKey} value={member.memberKey}>{memberDisplayName(member.memberKey, member.name)}{member.defaultForRole ? '（推荐）' : ''}</option>)}</select></label>}
    <WorkflowActionDock
      mode="card"
      title="全书方向已经确认"
      detail="下一步把方向展开成可逐卷查看的正式框架。"
      primary={<button type="button" className="planning-primary" disabled={busy} onClick={onStart}>{busy ? '正在建立任务…' : '生成正式框架'}</button>}
    />
  </section>;
}

function PlanningRecovery({ message, busy, onRetry, onReturnDirection, onOpenSettings, action = '重新开始' }: {
  message: string;
  busy: boolean;
  onRetry: () => void;
  onReturnDirection: () => void;
  onOpenSettings?: () => void;
  action?: string;
}): React.JSX.Element {
  return <section className="planning-recovery-card">
    <p>{publicFailureCopy(message)}</p>
    <WorkflowActionDock
      mode="card"
      title="已经完成的内容会保留"
      detail="可以继续当前步骤，也可以返回上游调整后重新开始。"
      secondary={<><button type="button" className="planning-secondary" disabled={busy} onClick={onReturnDirection}>返回全书方向</button>{onOpenSettings !== undefined && <button type="button" className="planning-secondary" disabled={busy} onClick={onOpenSettings}>返回设定修改</button>}</>}
      primary={<button type="button" className="planning-primary" disabled={busy} onClick={onRetry}>{busy ? '正在处理…' : action}</button>}
    />
  </section>;
}

function RouteChoicePanel({ run, mode, selectedRouteIds, authorNote, members, treeMemberKey, busy, onMode, onSelect, onNote, onTreeMember, onSubmit, onRetryMissing }: {
  run: PlanningRouteRunView; mode: DecisionMode; selectedRouteIds: string[]; authorNote: string;
  members: PlanningMemberView[]; treeMemberKey: string; busy: boolean;
  onMode: (mode: DecisionMode) => void; onSelect: (routeId: string) => void; onNote: (value: string) => void;
  onTreeMember: (memberKey: string) => void; onSubmit: () => void; onRetryMissing: () => void;
}): React.JSX.Element {
  const reviewByRoute = useMemo(() => new Map(run.chiefReview?.routeReviews.map((review) => [review.routeId, review]) ?? []), [run.chiefReview]);
  const writers = uniqueByMemberKey(members.filter((member) => member.roleKey === 'planning_writer'));
  return <section className="route-choice-panel">
    {run.chiefReview !== null && <article className="chief-route-review"><span className="planning-person-avatar" style={{ backgroundPosition: memberAvatarPosition(run.chiefReview.memberKey) }} aria-hidden="true"/><div><strong>{memberDisplayName(run.chiefReview.memberKey, run.chiefReview.memberName)}主编的建议</strong><p>{run.chiefReview.summary}</p></div></article>}
    <div className="route-choice-mode" aria-label="选择处理方式">
      <button type="button" aria-pressed={mode === 'select'} onClick={() => onMode('select')}>直接采用</button>
      <button type="button" aria-pressed={mode === 'adjust'} onClick={() => onMode('adjust')}>按想法调整</button>
      {run.routes.length >= 2 && <button type="button" aria-pressed={mode === 'merge'} onClick={() => onMode('merge')}>融合几套</button>}
    </div>
    <div className="route-card-list">{run.routes.map((route, index) => <RouteCard
      key={route.routeId} route={route} index={index} selected={selectedRouteIds.includes(route.routeId)}
      recommended={route.routeId === run.chiefReview?.recommendedRouteId} review={reviewByRoute.get(route.routeId)}
      multi={mode === 'merge'} onSelect={() => onSelect(route.routeId)}
    />)}</div>
    {mode !== 'select' && <label className="route-author-note"><span>{mode === 'merge' ? '告诉主编，您想分别保留什么' : '告诉主编，您想怎么改'}</span><textarea value={authorNote} maxLength={2000} onChange={(event) => onNote(event.target.value)} placeholder="例如：保留第一套的小人物成长，但结局不要称帝；把第二套的家国情感融进来。" /></label>}
    {writers.length > 1 && <details className="route-tree-member"><summary>选择展开正式框架的编剧（可不选）<CaretDownIcon /></summary><PlanningMemberFaces members={writers}/><select value={treeMemberKey} onChange={(event) => onTreeMember(event.target.value)}><option value="">编辑部自动安排</option>{writers.map((member) => <option key={member.memberKey} value={member.memberKey}>{memberDisplayName(member.memberKey, member.name)}{member.defaultForRole ? '（推荐）' : ''}</option>)}</select></details>}
    <WorkflowActionDock
      title={mode === 'select' ? '确认本书采用的全书路线' : mode === 'adjust' ? '把您的想法交给主编整理' : '把所选路线融合成一个方向'}
      detail="确认后会继续生成正式框架；已经完成的路线会保留。"
      secondary={run.routes.length < (run.expectedRoutes ?? run.routes.length) ? <button type="button" className="planning-secondary" disabled={busy} onClick={onRetryMissing}>只补未完成路线</button> : undefined}
      primary={<button type="button" className="planning-primary" disabled={busy} onClick={onSubmit}>{busy ? '主编正在整理…' : mode === 'select' ? '采用所选路线' : mode === 'adjust' ? '按我的想法整理' : '融合所选路线'}</button>}
    />
  </section>;
}

type RouteReviewItem = NonNullable<PlanningRouteRunView['chiefReview']>['routeReviews'][number];

function RouteCard({ route, index, selected, recommended, review, multi, onSelect }: {
  route: PlanningRouteView; index: number; selected: boolean; recommended: boolean; multi: boolean;
  review: RouteReviewItem | undefined; onSelect: () => void;
}): React.JSX.Element {
  return <article className={`planning-route-card${selected ? ' is-selected' : ''}`}>
    <button type="button" className="route-card-select" aria-pressed={selected} onClick={onSelect}>
      <span className="route-number">{String(index + 1).padStart(2, '0')}</span>
      <span className="route-writer-line"><i className="planning-person-avatar" style={{ backgroundPosition: memberAvatarPosition(route.memberKey) }} aria-hidden="true"/><span><strong>{route.title}</strong><small>{memberDisplayName(route.memberKey, route.memberName)}设计 · {formatWords(route.targetWords)} · {route.targetVolumes}卷</small></span></span>
      <em>{selected ? '已选择' : multi ? '勾选融合' : '选这套'}{recommended ? ' · 主编推荐' : ''}</em>
    </button>
    <div className="route-card-copy"><h3>{route.oneLinePromise}</h3><p>{route.summary}</p><dl>
      <div><dt>为什么这样设计</dt><dd>{route.designRationale ?? route.summary}</dd></div>
      <div><dt>建议分几卷</dt><dd>{route.targetVolumes}卷，合计{formatWords(route.targetWords)}</dd></div>
      <div><dt>适合谁看</dt><dd>{route.commercialAudience}</dd></div>
      <div><dt>为什么会继续追</dt><dd>{route.retentionPositioning}</dd></div>
      <div><dt>主角会怎样走</dt><dd>{route.protagonistJourney}</dd></div>
      <div><dt>读起来什么感觉</dt><dd>{route.readingExperience}</dd></div>
    </dl></div>
    <details><summary>查看全书各卷方向 <CaretDownIcon /></summary><div className="route-volume-list">{route.volumes.map((volume) => <article key={volume.order}><b>{volume.order}. {volume.title}</b><p>{volume.direction}</p><small>{volume.readerPayoff} · {formatWords(volume.targetWords)}</small></article>)}</div></details>
    {review !== undefined && <details className="route-review-detail"><summary>查看主编点评 <CaretDownIcon /></summary><p><b>最大优点：</b>{review.biggestStrength}</p><p><b>需要注意：</b>{review.mainRisk}</p><p><b>卷数是否合理：</b>{review.volumeJudgement}</p><p><b>受众是否清楚：</b>{review.audienceJudgement}</p><p><b>追读能否持续：</b>{review.retentionJudgement}</p><p><b>更适合：</b>{review.suitableFor}</p></details>}
  </article>;
}

function PlanningTreeResult({ tree, busy, members, generation, routeRun, editorialOpen, editorialContent, onEditDirection, onConfirm }: {
  tree: PlanningTreeView;
  busy: boolean;
  members: PlanningMemberView[];
  generation: PlanningTreeGenerationView | null;
  routeRun: PlanningRouteRunView | null;
  editorialOpen: boolean;
  editorialContent: ReactNode | null;
  onEditDirection: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const currentVolumeIndex = findCurrentVolumeIndex(tree.root.children);
  const currentVolume = tree.root.children[currentVolumeIndex];
  const visibleMembers = uniqueByMemberKey(members.filter((member) => member.roleKey === 'chief_editor' || member.roleKey === 'planning_writer')).slice(0, 4);
  const activeActor = routeRun?.actors.find((actor) => actor.status === 'working')
    ?? routeRun?.actors.find((actor) => actor.status === 'waiting');
  const activeMemberKey = activeActor?.memberKey ?? generation?.member.memberKey;
  const activeMemberName = activeActor === undefined
    ? generation === null ? null : memberDisplayName(generation.member.memberKey, generation.member.name)
    : memberDisplayName(activeActor.memberKey, activeActor.memberName);
  const editorialSummary = activeActor !== undefined || generation !== null && ['waiting', 'working'].includes(generation.status)
    ? `${activeMemberName ?? '编辑部'}正在整理方向`
    : tree.status === 'candidate' ? '框架草案已完成，等您确认' : '正式框架已保存，需要时可以重新规划';

  return <section className="planning-tree-result time-machine-dashboard">
    <TimeMachineGroup
      className="time-machine-editorial-group"
      icon={<SparkleIcon />}
      title="编辑部"
      summary={editorialSummary}
      open={editorialOpen || tree.status === 'candidate'}
    >
      {tree.status === 'candidate' && <div className="tree-candidate-bar"><span><strong>正式框架已经生成</strong><small>现在还是草案，确认后才会成为后续分卷的方向依据。</small></span></div>}
      {editorialContent ?? <div className="time-machine-editorial-summary">
        <div className="time-machine-editorial-person">
          {activeMemberKey === undefined
            ? <span className="planning-member-orb"><SparkleIcon /></span>
            : <span className="planning-waiting-avatar" style={{ backgroundPosition: memberAvatarPosition(activeMemberKey) }} aria-hidden="true" />}
          <span><strong>{editorialSummary}</strong><small>{tree.status === 'confirmed' ? '方向调整只影响未来规划，已经定稿的正文不会被改写。' : '确认后，后续分卷会沿用这份全书方向。'}</small></span>
        </div>
        {visibleMembers.length > 0 && <PlanningMemberFaces members={visibleMembers} />}
        <button type="button" className="planning-secondary" onClick={onEditDirection}>调整方向与成员</button>
      </div>}
    </TimeMachineGroup>

    <TimeMachineGroup
      className="time-machine-direction-group"
      icon={<PathIcon />}
      title="全书方向"
      summary={tree.root.story.summary}
      open
    >
      <article className="planning-tree-root time-machine-direction-card">
        <span>全书</span>
        <div><h2>{tree.root.title}</h2><p>{tree.root.story.summary}</p><small>{tree.root.experience.publicSummary}</small></div>
        {tree.designSummary !== null && tree.designSummary !== undefined && <details className="planning-tree-design-summary" open={tree.status === 'candidate'}>
          <summary>这次为什么这样设计 <CaretDownIcon /></summary>
          <p>{tree.designSummary.decisionNote}</p>
          {tree.designSummary.originalApproaches.length > 0 && <ul>{tree.designSummary.originalApproaches.map((approach) => <li key={`${approach.title}-${approach.applicationNote}`}><b>{approach.title}</b><span>{approach.applicationNote}</span></li>)}</ul>}
        </details>}
        <dl>
          <div><dt>核心矛盾</dt><dd>{tree.root.causality.coreConflict}</dd></div>
          <div><dt>主角长期变化</dt><dd>{tree.root.story.protagonistChange}</dd></div>
          <div><dt>最终走向</dt><dd>{tree.root.story.outcome}</dd></div>
          <div><dt>预计篇幅</dt><dd>{tree.root.budget.wordTarget === null ? '篇幅待定' : formatWords(tree.root.budget.wordTarget)}</dd></div>
        </dl>
        {tree.root.actual !== null && <p className="planning-tree-actual"><b>正文实际进展：</b>{tree.root.actual.summary}</p>}
      </article>
    </TimeMachineGroup>

    <TimeMachineGroup
      className="time-machine-route-group"
      icon={<ClockCounterClockwiseIcon />}
      title="全书路线"
      summary={`${tree.root.children.length}卷路线${currentVolume === undefined ? '' : ` · 当前查看${currentVolume.title}`}`}
      open
    >
      {tree.root.children.length === 0
        ? <p className="time-machine-empty-state">还没有分卷路线，调整全书方向后可以重新生成。</p>
        : <div className="planning-tree-vertical">{tree.root.children.map((node, index) => <PlanningTreeBranch key={node.key} node={node} index={index} defaultOpen={index === currentVolumeIndex} />)}</div>}
    </TimeMachineGroup>

    <TimeMachineGroup
      className="time-machine-dynamics-group"
      icon={<GitBranchIcon />}
      title="故事动态"
      summary="故事线、交汇点与伏笔会随正文定稿持续更新"
    >
      <StoryDynamicsPlaceholder volumes={tree.root.children} />
    </TimeMachineGroup>
    {tree.status === 'candidate' && editorialContent === null && <WorkflowActionDock
      title="正式框架草案已经完成"
      detail="确认后才会成为后续分卷的方向依据。"
      primary={<button type="button" className="planning-primary" disabled={busy} onClick={onConfirm}>{busy ? '正在保存…' : '确认采用框架'}</button>}
    />}
  </section>;
}

function TimeMachineGroup({ className = '', icon, title, summary, open = false, children }: {
  className?: string;
  icon: ReactNode;
  title: string;
  summary: string;
  open?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return <details className={`time-machine-group ${className}`} open={open}>
    <summary>
      <span className="time-machine-group-icon">{icon}</span>
      <span className="time-machine-group-copy"><strong>{title}</strong><small>{summary}</small></span>
      <CaretDownIcon />
    </summary>
    <div className="time-machine-group-body">{children}</div>
  </details>;
}

function StoryDynamicsPlaceholder({ volumes }: { volumes: PlanningTreeNodeView[] }): React.JSX.Element {
  const plannedForeshadowing = volumes.flatMap((volume) => volume.threads.foreshadowing.map((item) => ({ volume: volume.title, item })));
  return <div className="time-machine-story-dynamics">
    <details><summary><span><strong>故事线</strong><small>正文定稿后自动整理</small></span><CaretDownIcon /></summary><p>这里会根据已经定稿的正文，显示主线、重要线和支线的真实推进状态。目前没有可结算的故事线数据。</p></details>
    <details><summary><span><strong>交汇点</strong><small>正文定稿后自动识别</small></span><CaretDownIcon /></summary><p>故事线真正发生交汇后才会记录；规划中的可能性不会冒充已经发生的事实。</p></details>
    <details><summary><span><strong>伏笔</strong><small>{plannedForeshadowing.length === 0 ? '正文定稿后自动记录' : `规划中${plannedForeshadowing.length}项，实际状态待正文记录`}</small></span><CaretDownIcon /></summary>
      {plannedForeshadowing.length === 0
        ? <p>目前没有可展示的伏笔。正文定稿后，这里会记录实际埋下、强化和回收的内容。</p>
        : <div className="time-machine-planned-threads"><p>下面只是分卷规划，只有正文真正写入并定稿后，才会记为已埋下。</p>{plannedForeshadowing.map((thread) => <span key={`${thread.volume}-${thread.item}`}><b>{thread.volume}</b>{thread.item}</span>)}</div>}
    </details>
  </div>;
}

function findCurrentVolumeIndex(volumes: PlanningTreeNodeView[]): number {
  const activeIndex = volumes.findIndex((volume) => volume.actual?.state === 'partial' || volume.actual?.state === 'deviated');
  if (activeIndex >= 0) return activeIndex;
  const firstNotCompleted = volumes.findIndex((volume) => volume.actual?.state !== 'completed');
  return firstNotCompleted >= 0 ? firstNotCompleted : Math.max(0, volumes.length - 1);
}

function PlanningTreeBranch({ node, index, defaultOpen }: { node: PlanningTreeNodeView; index: number; defaultOpen: boolean }): React.JSX.Element {
  const stateCopy = node.actual?.state === 'completed' ? '已完成'
    : node.actual?.state === 'partial' ? '创作中'
      : node.actual?.state === 'deviated' ? '有变化' : '尚未开始';
  return <details className={`planning-tree-branch state-${node.actual?.state ?? 'planned'}`} open={defaultOpen}>
    <summary><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{node.title}</strong><small>{node.story.summary}</small><em>{stateCopy}</em></div><CaretDownIcon /></summary>
    <div className="planning-tree-branch-body">
      <dl>
        <div><dt>这一段要发生什么</dt><dd>{node.story.majorEvents.length > 0 ? node.story.majorEvents.join('；') : node.story.summary}</dd></div>
        <div><dt>主角有什么变化</dt><dd>{node.story.protagonistChange}</dd></div>
        <div><dt>读者会有什么感受</dt><dd>{node.emotion.publicSummary}；{node.experience.publicSummary}</dd></div>
        <div><dt>为什么会走到这里</dt><dd>{node.causality.trigger}；{node.causality.coreConflict}</dd></div>
        <div><dt>阶段结果与下一步</dt><dd>{node.story.outcome}；{node.story.nextStep}</dd></div>
      </dl>
      <div className="planning-tree-tags"><span>{node.budget.wordTarget === null ? '篇幅待定' : formatWords(node.budget.wordTarget)}</span>{node.threads.foreshadowing.map((item) => <span key={item}>伏笔：{item}</span>)}</div>
      {node.actual !== null && <p className="planning-tree-actual"><b>正文实际进展：</b>{node.actual.summary}</p>}
    </div>
  </details>;
}

function formatWords(value: number): string { return value >= 10_000 ? `${Number((value / 10_000).toFixed(1))}万字` : `${value}字`; }
function publicError(reason: unknown): string {
  if (reason instanceof AuthorApiError && reason.retryable) return '对不起，暂时连接不上文秘写作服务，请稍后重试。';
  if (reason instanceof AuthorApiError) return publicStatusCopy(reason.message, '对不起，这次操作没有完成，请稍后重试。');
  return '对不起，这次操作没有完成，请稍后重试。';
}
