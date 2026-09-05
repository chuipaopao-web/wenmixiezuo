import { CheckCircleIcon, CheckIcon, ClipboardTextIcon, PencilSimpleIcon, PlusIcon, RobotIcon, SparkleIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { memberAvatarPosition, memberDisplayName } from './member-avatars';
import { canonicalMemberIdentityKey, publicFailureCopy, publicRoleLabel, publicStatusCopy, uniqueByMemberKey } from './author-projection';
import { WorkflowActionDock } from './WorkflowActionDock';
import type { SettingRecoveryFocus } from './navigation';
import {
  AuthorApiError,
  confirmSettingItem, createSettingBatch, createSettingFinalReview, createSettingItemReviewTask, createSettingRecommendation, fetchSettingBatch,
  fetchCurrentSettingFinalReview, fetchCurrentSettingRecommendation, fetchCurrentSettingRedesignTask, fetchSettingDepartment, fetchSettingRedesignTask, fuseSettingItem, redesignSettingItem, restartSettingBatch, retrySettingBatch, retrySettingFinalReview, retrySettingRecommendation, retrySettingRedesignTask,
  type SettingBatchView, type SettingCatalogRecommendationView, type SettingDepartmentView, type SettingFinalReviewView, type SettingItemView, type SettingRedesignCandidate, type SettingRedesignTaskView
} from './opening-api';

export function SettingPage({ bookId, onOpenTimeMachine, recoveryFocus = null }: {
  bookId: string;
  onOpenTimeMachine?: () => void;
  recoveryFocus?: SettingRecoveryFocus | null;
}): React.JSX.Element {
  const [department, setDepartment] = useState<SettingDepartmentView | null>(null);
  const [batch, setBatch] = useState<SettingBatchView | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customItems, setCustomItems] = useState<Array<{ label: string; prompt: string }>>([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<SettingItemView | null>(null);
  const [redesigning, setRedesigning] = useState<SettingItemView | null>(null);
  const [optimizingItemKey, setOptimizingItemKey] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(true);
  const [finalReviewOpen, setFinalReviewOpen] = useState(false);
  const [finalReview, setFinalReview] = useState<SettingFinalReviewView | null>(null);
  const [finalReviewBusy, setFinalReviewBusy] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [finalSaved, setFinalSaved] = useState(false);
  const [recommendationBusy, setRecommendationBusy] = useState(false);
  const [batchRetryBusy, setBatchRetryBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const value = await fetchSettingDepartment(bookId, signal);
    const existingKeys = new Set(value.confirmedItems.map((item) => item.itemKey));
    const recommendation = value.recommendation ?? null;
    const recommended = recommendation?.status === 'ready' ? recommendation.result?.requiredKeys ?? [] : [];
    setDepartment({ ...value, recommendation }); setBatch(value.activeBatch); setFinalReview(value.finalReview); setSelected(new Set(recommended.filter((key) => !existingKeys.has(key))));
    setShowCatalog(recommendation?.status === 'ready' && value.confirmedItems.length === 0 && value.activeBatch === null);
    setFinalReviewOpen(value.finalReview !== null && (value.finalReview.status === 'failed' || recoveryFocus === 'final-review'));
    if (recoveryFocus === 'final-review') setShowResults(false);
    setFinalSaved(false);
    setError(null);
  }, [bookId, recoveryFocus]);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal).catch((reason: unknown) => { if (!controller.signal.aborted) setError(message(reason)); }); return () => controller.abort(); }, [load]);
  useEffect(() => {
    if (recoveryFocus !== 'final-review' || !finalReviewOpen || finalReview === null) return;
    const timer = window.setTimeout(() => {
      document.querySelector('.setting-final-review')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [finalReview?.taskId, finalReviewOpen, recoveryFocus]);
  useEffect(() => {
    if (batch === null || !['queued', 'working'].includes(batch.status)) return;
    let stopped = false;
    let timer = 0;
    const controller = new AbortController();
    const poll = async (): Promise<void> => {
      try {
        const next = await fetchSettingBatch(bookId, batch.batchId, controller.signal);
        if (stopped) return;
        setError(null);
        if (['queued', 'working'].includes(next.status)) {
          setBatch(next);
          timer = window.setTimeout(() => void poll(), 1_200);
        } else {
          await load(controller.signal);
        }
      } catch (reason) {
        if (stopped || controller.signal.aborted) return;
        setError(message(reason));
        timer = window.setTimeout(() => void poll(), 4_000);
      }
    };
    timer = window.setTimeout(() => void poll(), 1_200);
    return () => { stopped = true; controller.abort(); window.clearTimeout(timer); };
  }, [batch?.batchId, batch?.status, bookId, load]);
  useEffect(() => {
    const recommendation = department?.recommendation;
    if (recommendation === null || recommendation === undefined || !['queued', 'working'].includes(recommendation.status)) return;
    let stopped = false;
    let timer = 0;
    const controller = new AbortController();
    const poll = async (): Promise<void> => {
      try {
        const next = await fetchCurrentSettingRecommendation(bookId, controller.signal);
        if (stopped) return;
        setDepartment((current) => current === null ? current : { ...current, recommendation: next, recommendedKeys: next.result?.requiredKeys ?? [] });
        setError(null);
        if (next.status === 'ready' && next.result !== null) {
          const existingKeys = new Set(department?.confirmedItems.map((item) => item.itemKey) ?? []);
          setSelected(new Set(next.result.requiredKeys.filter((key) => !existingKeys.has(key))));
          setShowCatalog(true);
        } else if (['queued', 'working'].includes(next.status)) timer = window.setTimeout(() => void poll(), 1_200);
      } catch (reason) {
        if (stopped || controller.signal.aborted) return;
        setError(message(reason));
        timer = window.setTimeout(() => void poll(), 4_000);
      }
    };
    timer = window.setTimeout(() => void poll(), 1_200);
    return () => { stopped = true; controller.abort(); window.clearTimeout(timer); };
  }, [bookId, department?.confirmedItems, department?.recommendation?.status, department?.recommendation?.taskId]);
  useEffect(() => {
    if (finalReview === null || !['queued', 'working'].includes(finalReview.status)) return;
    let stopped = false;
    let timer = 0;
    const controller = new AbortController();
    const poll = async (): Promise<void> => {
      try {
        const next = await fetchCurrentSettingFinalReview(bookId, controller.signal);
        if (stopped) return;
        setError(null);
        if (next.status === 'ready') {
          await load(controller.signal);
          if (!stopped) setFinalReviewOpen(true);
        } else {
          setFinalReview(next);
          if (['queued', 'working'].includes(next.status)) timer = window.setTimeout(() => void poll(), 1_200);
        }
      } catch (reason) {
        if (stopped || controller.signal.aborted) return;
        setError(message(reason));
        timer = window.setTimeout(() => void poll(), 4_000);
      }
    };
    timer = window.setTimeout(() => void poll(), 1_200);
    return () => { stopped = true; controller.abort(); window.clearTimeout(timer); };
  }, [bookId, finalReview?.status, finalReview?.taskId, load]);

  const groups = useMemo(() => {
    const map = new Map<string, NonNullable<typeof department>['catalog']>();
    for (const item of department?.catalog ?? []) map.set(item.groupTitle, [...(map.get(item.groupTitle) ?? []), item]);
    return [...map.entries()];
  }, [department]);

  const start = async (): Promise<void> => {
    setBusy(true); setError(null);
    try {
      const existingKeys = new Set(department?.confirmedItems.map((item) => item.itemKey) ?? []);
      const next = await createSettingBatch(bookId, { selectedItemKeys: [...selected].filter((key) => !existingKeys.has(key)), customItems: customItems.filter((item) => item.label.trim() && item.prompt.trim()), authorNotes: {} });
      setBatch(next); setSelected(new Set()); setCustomItems([]); setShowCatalog(false); setFinalReview(null); setFinalReviewOpen(false); setFinalSaved(false);
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };

  const beginRecommendation = async (): Promise<void> => {
    setRecommendationBusy(true); setError(null);
    try {
      const next = await createSettingRecommendation(bookId);
      setDepartment((current) => current === null ? current : { ...current, recommendation: next, recommendedKeys: next.result?.requiredKeys ?? [] });
    } catch (reason) { setError(message(reason)); } finally { setRecommendationBusy(false); }
  };

  const continueRecommendation = async (): Promise<void> => {
    setRecommendationBusy(true); setError(null);
    try {
      const next = await retrySettingRecommendation(bookId);
      setDepartment((current) => current === null ? current : { ...current, recommendation: next, recommendedKeys: next.result?.requiredKeys ?? [] });
    } catch (reason) { setError(message(reason)); } finally { setRecommendationBusy(false); }
  };

  const refreshRecommendation = async (): Promise<void> => {
    if (recommendationBusy) return;
    setRecommendationBusy(true); setError(null);
    try {
      const next = await fetchCurrentSettingRecommendation(bookId);
      setDepartment((current) => current === null ? current : { ...current, recommendation: next, recommendedKeys: next.result?.requiredKeys ?? [] });
    } catch (reason) { setError(message(reason)); } finally { setRecommendationBusy(false); }
  };

  const beginFinalReview = async (): Promise<void> => {
    if (finalReview?.status === 'ready') { setFinalReviewOpen(true); return; }
    setFinalReviewBusy(true); setError(null); setFinalReviewOpen(true);
    try { setFinalReview(await createSettingFinalReview(bookId)); }
    catch (reason) { setError(message(reason)); }
    finally { setFinalReviewBusy(false); }
  };

  const continueFinalReview = async (): Promise<void> => {
    if (finalReview === null) return;
    setFinalReviewBusy(true); setError(null);
    try { setFinalReview(await retrySettingFinalReview(bookId, finalReview.taskId)); }
    catch (reason) { setError(message(reason)); }
    finally { setFinalReviewBusy(false); }
  };

  const refreshFinalReview = async (): Promise<void> => {
    if (finalReviewBusy) return;
    setFinalReviewBusy(true); setError(null);
    try { setFinalReview(await fetchCurrentSettingFinalReview(bookId)); }
    catch (reason) { setError(message(reason)); }
    finally { setFinalReviewBusy(false); }
  };

  const continueBatch = async (): Promise<void> => {
    if (batch === null || batchRetryBusy) return;
    setBatchRetryBusy(true);
    setError(null);
    try { setBatch(await retrySettingBatch(bookId, batch.batchId)); }
    catch (reason) { setError(message(reason)); }
    finally { setBatchRetryBusy(false); }
  };

  const restartBatch = async (): Promise<void> => {
    if (batch === null || batchRetryBusy) return;
    setBatchRetryBusy(true);
    setError(null);
    try { setBatch(await restartSettingBatch(bookId, batch.batchId)); }
    catch (reason) { setError(message(reason)); }
    finally { setBatchRetryBusy(false); }
  };

  const refreshBatch = async (): Promise<void> => {
    if (batchRetryBusy) return;
    setBatchRetryBusy(true);
    setError(null);
    try { await load(); }
    catch (reason) { setError(message(reason)); }
    finally { setBatchRetryBusy(false); }
  };

  if (department === null) return error === null
    ? <div className="setting-loading" role="status">正在准备设定编辑部…</div>
    : <div className="setting-load-failed" role="alert"><WarningCircleIcon /><strong>设定编辑部暂时没有准备好</strong><span>{error}</span><button type="button" className="primary-action" onClick={() => { setError(null); void load().catch((reason: unknown) => setError(message(reason))); }}>重新连接</button></div>;
  const items = mergeSettingItems(department.confirmedItems, batch?.items ?? []);
  const existingKeys = new Set(department.confirmedItems.map((item) => item.itemKey));
  const selectableCount = [...selected].filter((key) => !existingKeys.has(key)).length + customItems.filter((item) => item.label.trim() && item.prompt.trim()).length;
  const batchKeys = new Set(batch?.items.map((item) => item.itemKey) ?? []);
  const priorItemCount = department.confirmedItems.filter((item) => !batchKeys.has(item.itemKey)).length;
  const overallProgress = batch === null
    ? { completed: items.filter((item) => item.content !== null).length, total: items.length }
    : { completed: priorItemCount + batch.progress.completed, total: priorItemCount + batch.progress.total };
  const allDesigned = items.length > 0 && items.every((item) => item.content !== null && item.state !== 'failed') && (batch === null || !['queued', 'working'].includes(batch.status));
  const pendingConfirmation = items.filter((item) => item.content !== null && item.state !== 'confirmed');
  const issueItems = items.filter((item) => item.issues.length > 0);
  const settingTaskActive = batch !== null && (batch.status === 'queued' || batch.status === 'working');
  const finalReviewChief = finalReview?.member ?? uniqueByMemberKey(batch?.members ?? department.members).find((member) => publicRoleLabel(member.role) === '主编') ?? null;
  return (
    <section className="setting-page" aria-labelledby="setting-title">
      <header className="setting-page-heading"><p id="setting-title">主编先挑出本书真正需要的设定，您也可以随时补充。</p>{(items.length > 0 || department.recommendation?.status === 'ready') && <button type="button" className="secondary-action setting-catalog-toggle" aria-expanded={showCatalog} onClick={() => setShowCatalog((value) => !value)}><ClipboardTextIcon />{showCatalog ? '收起完整设定库' : '打开完整设定库'}</button>}</header>
      {error && <div className="error-notice" role="alert">{error}</div>}

      <SettingRecommendationPanel
        recommendation={department.recommendation}
        catalog={department.catalog}
        busy={recommendationBusy}
        catalogOpen={showCatalog}
        actionsEnabled={items.length === 0}
        onStart={() => void beginRecommendation()}
        onRetry={() => void continueRecommendation()}
        onRefresh={() => void refreshRecommendation()}
        onOpenCatalog={() => setShowCatalog(true)}
      />

      {showCatalog && <section className="setting-catalog-card" aria-labelledby="catalog-title">
        <div className="setting-section-title"><div><ClipboardTextIcon /><span><strong id="catalog-title">完整设定库</strong><small>只勾选这次新增的内容，已经设计好的不会重做</small></span></div><span>{selectableCount} 项新增</span></div>
        <div className="setting-groups">{groups.map(([title, entries]) => <details key={title} open={entries.some((entry) => selected.has(entry.key))}><summary>{title}<span>{entries.filter((entry) => selected.has(entry.key)).length}/{entries.length}</span></summary><div className="setting-choice-grid">{entries.map((item) => {
          const designed = existingKeys.has(item.key);
          return <label key={item.key} className={designed ? 'designed' : selected.has(item.key) ? 'selected' : ''}><input type="checkbox" disabled={designed} checked={!designed && selected.has(item.key)} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(item.key) : next.delete(item.key); return next; })}/><span><strong>{item.label}{item.required && <em>核心</em>}{designed && <em>已设计</em>}</strong><small>{designed ? '已有结果；需要修改请到结果卡使用“重新设计”' : publicStatusCopy(item.prompt, '编辑部会结合本书资料完成这一项。')}</small></span><CheckIcon /></label>;
        })}</div></details>)}</div>
        <div className="custom-setting-list"><div><strong>临时想到的条目</strong><button type="button" onClick={() => setCustomItems((items) => [...items, { label: '', prompt: '' }])}><PlusIcon />增加条目</button></div>{customItems.map((item, index) => <div className="custom-setting-row" key={index}><input aria-label={`自定义条目${index + 1}名称`} maxLength={40} placeholder="条目名称" value={item.label} onChange={(event) => setCustomItems((items) => items.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value } : entry))}/><input aria-label={`自定义条目${index + 1}说明`} maxLength={300} placeholder="希望编辑部设计什么" value={item.prompt} onChange={(event) => setCustomItems((items) => items.map((entry, entryIndex) => entryIndex === index ? { ...entry, prompt: event.target.value } : entry))}/><button type="button" aria-label="删除自定义条目" onClick={() => setCustomItems((items) => items.filter((_, entryIndex) => entryIndex !== index))}><XIcon /></button></div>)}</div>
        <WorkflowActionDock
          mode="card"
          ariaLabel="新增设定操作"
          title={selectableCount > 0 ? `已选 ${selectableCount} 项新增设定` : '请选择这次要新增的设定'}
          detail="每项默认由一位强模型成员设计；需要比较时，再到单条结果中重新设计。"
          primary={<button type="button" className="primary-action" disabled={busy || selectableCount === 0} onClick={() => void start()}><SparkleIcon />{busy ? '成员正在设计…' : `设计新增${selectableCount}项`}</button>}
        />
      </section>}

      {batch && <EditorialRoom batch={batch} overallProgress={overallProgress}/>}

      {items.length > 0 && <section className={`setting-results ${showResults ? 'expanded' : 'collapsed'}`} aria-labelledby="setting-results-title">
        <div className="setting-results-heading"><div><SparkleIcon /><span><strong id="setting-results-title">设定结果</strong><small>{items.length} 项 · 默认只显示摘要，需要时再展开。</small></span></div><button type="button" className="editorial-toggle" aria-expanded={showResults} onClick={() => setShowResults((value) => !value)}>{showResults ? '收起结果' : `查看${items.length}项结果`}</button></div>
        {showResults && items.map((item) => <SettingResultCard
          key={item.itemKey}
          bookId={bookId}
          item={item}
          members={batch?.members ?? department.members}
          editing={editing?.itemKey === item.itemKey}
          redesigning={redesigning?.itemKey === item.itemKey}
          optimizing={optimizingItemKey === item.itemKey}
          onEdit={() => {
            if (settingTaskActive) { setError('编辑部正在处理上一项修改，完成后就可以继续。'); return; }
            setRedesigning(null); setEditing((current) => current?.itemKey === item.itemKey ? null : item);
          }}
          onRedesign={() => {
            if (settingTaskActive) { setError('编辑部正在处理上一项修改，完成后就可以继续。'); return; }
            setEditing(null); setRedesigning((current) => current?.itemKey === item.itemKey ? null : item);
          }}
          onCloseInline={() => { setEditing(null); setRedesigning(null); }}
          onTaskStarted={(next) => { setBatch(next); setEditing(null); setRedesigning(null); setShowResults(true); setFinalReview(null); setFinalReviewOpen(false); setFinalSaved(false); }}
          onAdoptChief={async () => {
            setOptimizingItemKey(item.itemKey); setError(null);
            try {
              const instruction = Array.from(`只处理主编指出的问题，没有被点名的内容保持不变：${item.issues.map((issue) => `${issue.problem}；建议：${issue.suggestion}`).join('；')}`).slice(0, 800).join('');
              const next = await createSettingItemReviewTask(bookId, item.itemKey, { ...(item.content === null ? {} : { content: item.content }), instruction });
              setBatch(next); setFinalReview(null); setFinalReviewOpen(false); setFinalSaved(false);
            } catch (reason) { setError(message(reason)); } finally { setOptimizingItemKey(null); }
          }}
          onConfirm={async () => { try { const next = await confirmSettingItem(bookId, item.itemKey, item.revision); updateItem(next, setBatch, setDepartment); } catch (reason) { setError(message(reason)); } }}
        />)}
      </section>}

      {items.length > 0 && !finalReviewOpen && !showCatalog && (batch?.status === 'partially_failed'
        ? <WorkflowActionDock
            title={batch.retryable
              ? '已有结果已保留，只继续未完成条目'
              : batch.restartable
                ? '已有结果已保留，可重新发起未完成条目'
                : '当前结果已保留，请先核对最新状态'}
            detail={batch.retryable
              ? `当前完成 ${overallProgress.completed}/${overallProgress.total} 项，重新安排不会覆盖已完成内容。`
              : batch.restartable
                ? `当前完成 ${overallProgress.completed}/${overallProgress.total} 项，新任务只处理未完成条目，不会覆盖已有结果。`
                : `当前完成 ${overallProgress.completed}/${overallProgress.total} 项；这次不能安全自动重试，失败条目和已有结果仍可查看。`}
            primary={batch.retryable
              ? <button type="button" className="primary-action" disabled={batchRetryBusy} onClick={() => void continueBatch()}>{batchRetryBusy ? '正在重新安排…' : '重新安排未完成条目'}</button>
              : batch.restartable
                ? <button type="button" className="primary-action" disabled={batchRetryBusy} onClick={() => void restartBatch()}>{batchRetryBusy ? '正在重新发起…' : '重新发起未完成条目'}</button>
                : <button type="button" className="primary-action" disabled={batchRetryBusy} onClick={() => void refreshBatch()}>{batchRetryBusy ? '正在刷新…' : '刷新核对结果'}</button>}
          />
        : <WorkflowActionDock
            title={allDesigned ? '本轮设定已经设计完成' : '完成全部条目后，由主编统一整理'}
            detail={allDesigned ? `共 ${items.length} 项，主编还会跨条目统一核对名称、时间与规则。` : `当前完成 ${overallProgress.completed}/${overallProgress.total} 项。`}
            primary={<button type="button" className="primary-action" disabled={!allDesigned || finalReviewBusy} onClick={() => { if (finalReview?.status === 'failed') setFinalReviewOpen(true); else void beginFinalReview(); }}><ClipboardTextIcon />{finalReviewBusy ? '正在请主编接单…' : finalReview?.status === 'ready' ? '查看统一整理结果' : finalReview?.status === 'queued' || finalReview?.status === 'working' ? '主编正在统一整理' : finalReview?.status === 'failed' ? '查看统一整理状态' : '请主编统一整理'}</button>}
          />)}
      {finalReviewOpen && allDesigned && finalReview !== null && <section className={`setting-final-review ${finalReview.status}`} aria-label="主编统一整理结果">
        <header><div>{finalReviewChief !== null && <span className="chief-review-avatar" style={{ backgroundPosition: memberAvatarPosition(finalReviewChief.memberKey) }} />}<span><strong>{finalReviewChief === null ? '主编' : memberDisplayName(finalReviewChief.memberKey, finalReviewChief.displayName)} · 统一整理</strong><small>{publicStatusCopy(finalReview.statusText, finalReview.status === 'ready' ? '全部设定已经统一核对完成。' : '正在核对全部设定。')}</small></span></div>{finalReview.status !== 'ready' && <div className="setting-recommendation-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={finalReview.progress}><span style={{ width: `${finalReview.progress}%` }} /></div>}</header>
        {finalReview.status === 'failed' && <><div className="error-notice"><span>{publicFailureCopy(finalReview.statusText)}</span></div><WorkflowActionDock
          mode="card"
          title={finalReview.restartable ? '已经完成的设定都已保留，可重新发起' : '当前统一整理结果需要重新核对'}
          detail={finalReview.retryable
            ? '只继续未完成的统一核对，不会重新生成已完成内容。'
            : finalReview.restartable
              ? '重新发起一项新任务，已经完成的设定不会被覆盖。'
              : '上次结果还不能确认；刷新只核对当前任务，不会创建新任务。'}
          primary={finalReview.retryable
            ? <button type="button" className="primary-action" disabled={finalReviewBusy} onClick={() => void continueFinalReview()}>{finalReviewBusy ? '正在继续…' : '继续统一整理'}</button>
            : finalReview.restartable
              ? <button type="button" className="primary-action" disabled={finalReviewBusy} onClick={() => void beginFinalReview()}>{finalReviewBusy ? '正在重新发起…' : '重新发起统一整理'}</button>
              : <button type="button" className="primary-action" disabled={finalReviewBusy} onClick={() => void refreshFinalReview()}>{finalReviewBusy ? '正在刷新…' : '刷新核对结果'}</button>}
        /></>}
        {finalReview.status === 'ready' && finalReview.result !== null && <>
          <p className="setting-final-summary">{finalReview.result.summary}</p>
          {finalReview.result.unifiedDecisions.length > 0 && <details open><summary>本次统一了 {finalReview.result.unifiedDecisions.length} 处</summary><div>{finalReview.result.unifiedDecisions.map((decision) => <p key={`${decision.topic}-${decision.decision}`}><b>{decision.topic}</b><span>{decision.decision}</span><small>{decision.reason}</small></p>)}</div></details>}
          {finalReview.result.conflicts.length > 0 && <details><summary>查看发现的 {finalReview.result.conflicts.length} 处冲突</summary><div>{finalReview.result.conflicts.map((conflict) => <p key={`${conflict.itemKeys.join('-')}-${conflict.problem}`}><b>{conflict.problem}</b><span>{conflict.decision}</span><small>{conflict.impact}</small></p>)}</div></details>}
          {issueItems.length > 0 && <details><summary>仍有 {issueItems.length} 项需要您决定</summary><div>{issueItems.map((item) => <p key={item.itemKey}><b>{item.label}</b><span>{item.issues.map((issue) => `${issue.problem}；${issue.suggestion}`).join('；')}</span></p>)}</div></details>}
        </>}
        {finalReview.status === 'ready' && <WorkflowActionDock
          mode="card"
          title={finalSaved || pendingConfirmation.length === 0 ? '当前设定已经安全保存' : '统一整理已经完成'}
          detail={finalSaved || pendingConfirmation.length === 0 ? '设定已经安全保存，可以查看全书框架。' : `确认后保存当前 ${pendingConfirmation.length} 项设定。`}
          primary={finalSaved || pendingConfirmation.length === 0
            ? <button type="button" className="primary-action" disabled={onOpenTimeMachine === undefined} onClick={onOpenTimeMachine}>进入时光机</button>
            : <button type="button" className="primary-action" disabled={savingAll} onClick={() => {
                setSavingAll(true); setError(null);
                void (async () => {
                  for (const item of pendingConfirmation) updateItem(await confirmSettingItem(bookId, item.itemKey, item.revision), setBatch, setDepartment);
                  setFinalSaved(true);
                })().catch((reason: unknown) => setError(`已保存成功的条目会保留；${message(reason)}`)).finally(() => setSavingAll(false));
              }}><CheckCircleIcon />{savingAll ? '正在逐项保存…' : `保存当前设定（${pendingConfirmation.length}项）`}</button>}
        />}
      </section>}

    </section>
  );
}

function SettingRecommendationPanel({
  recommendation,
  catalog,
  busy,
  catalogOpen,
  actionsEnabled,
  onStart,
  onRetry,
  onRefresh,
  onOpenCatalog
}: {
  recommendation: SettingCatalogRecommendationView | null;
  catalog: SettingDepartmentView['catalog'];
  busy: boolean;
  catalogOpen: boolean;
  actionsEnabled: boolean;
  onStart: () => void;
  onRetry: () => void;
  onRefresh: () => void;
  onOpenCatalog: () => void;
}): React.JSX.Element {
  const member = recommendation?.member ?? null;
  const lookup = new Map(catalog.map((item) => [item.key, item.label]));
  if (recommendation === null) return <section className="setting-recommendation-card ready-to-start" aria-label="主编整理设定清单">
    <span className="setting-recommendation-placeholder" aria-hidden="true"><SparkleIcon /></span>
    <div><strong>主编整理设定清单</strong><p>开书资料已经保存。主编会先读懂这本书，再挑出真正需要准备的设定。</p><small>确认后开始整理，不会在您不知情时重复下单。</small></div>
    {actionsEnabled && <WorkflowActionDock
      mode="card"
      title="先让主编理解这本书"
      detail="任务只会创建一次，离开页面也会保留进度。"
      primary={<button type="button" className="primary-action" disabled={busy} onClick={onStart}><SparkleIcon />{busy ? '正在下单…' : '请主编整理设定清单'}</button>}
    />}
  </section>;
  const active = recommendation.status === 'queued' || recommendation.status === 'working';
  if (active) return <section className="setting-recommendation-card working" aria-live="polite">
    {member === null ? <span className="setting-recommendation-placeholder" aria-hidden="true"><SparkleIcon /></span> : <span className="setting-recommendation-avatar" style={{ backgroundPosition: memberAvatarPosition(member.memberKey) }} aria-hidden="true" />}
    <div><strong>{member === null ? '主编' : memberDisplayName(member.memberKey, member.displayName)} · 主编</strong><p>{publicStatusCopy(recommendation.statusText, recommendation.status === 'queued' ? '任务已经排队，开始后会更新进度。' : '正在整理本书需要的设定。')}</p><small>当前工位：{publicStatusCopy(recommendation.phaseText, '整理设定清单')}</small></div>
    <div className="setting-recommendation-progress" role="progressbar" aria-label={`整理进度${recommendation.progress}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={recommendation.progress}><span style={{ width: `${recommendation.progress}%` }} /></div>
  </section>;
  if (recommendation.status === 'failed') return <section className="setting-recommendation-card failed" role="alert">
    {member === null ? <span className="setting-recommendation-placeholder" aria-hidden="true"><WarningCircleIcon /></span> : <span className="setting-recommendation-avatar" style={{ backgroundPosition: memberAvatarPosition(member.memberKey) }} aria-hidden="true" />}
    <div><strong>{member === null ? '主编' : memberDisplayName(member.memberKey, member.displayName)} · 主编</strong><p>{publicFailureCopy(recommendation.statusText)}</p><small>开书资料和已经完成的结果都已保留。</small></div>
    {actionsEnabled && <WorkflowActionDock
      mode="card"
      title={recommendation.restartable ? '开书资料已保留，可按最新要求重新发起' : '当前整理结果需要重新核对'}
      detail={recommendation.retryable
        ? '继续时不会重复生成已经完成的内容。'
        : recommendation.restartable
          ? '重新发起一项新任务，已经保存的开书资料不会丢失。'
          : '上次结果还不能确认；刷新只核对当前任务，不会创建新任务。'}
      primary={recommendation.retryable
        ? <button type="button" className="primary-action" disabled={busy} onClick={onRetry}><SparkleIcon />{busy ? '正在继续…' : '继续整理'}</button>
        : recommendation.restartable
          ? <button type="button" className="primary-action" disabled={busy} onClick={onStart}><SparkleIcon />{busy ? '正在重新发起…' : '按最新要求重新整理'}</button>
          : <button type="button" className="primary-action" disabled={busy} onClick={onRefresh}><SparkleIcon />{busy ? '正在刷新…' : '刷新核对结果'}</button>}
    />}
  </section>;
  const result = recommendation.result;
  const labels = (keys: string[]) => keys.map((key) => lookup.get(key)).filter((item): item is string => item !== undefined);
  return <section className="setting-recommendation-card completed" aria-label="主编设定清单">
    <header>{member === null ? <span className="setting-recommendation-placeholder" aria-hidden="true"><CheckCircleIcon /></span> : <span className="setting-recommendation-avatar" style={{ backgroundPosition: memberAvatarPosition(member.memberKey) }} aria-hidden="true" />}<span><strong>{member === null ? '主编已经整理好了' : `${memberDisplayName(member.memberKey, member.displayName)}已经整理好了`}</strong><small>{result?.summary ?? '本书需要的设定已经分好轻重。'}</small></span></header>
    {result !== null && <div className="setting-recommendation-groups">
      <details open><summary>建议先设计 <em>{result.requiredKeys.length}项</em></summary><p>{labels(result.requiredKeys).join('、')}</p></details>
      <details><summary>可以以后补 <em>{result.suggestedKeys.length}项</em></summary><p>{labels(result.suggestedKeys).join('、') || '暂无'}</p></details>
      <details><summary>这本书暂时用不到 <em>{result.excludedKeys.length}项</em></summary><p>{labels(result.excludedKeys).join('、') || '暂无'}</p></details>
    </div>}
    {!catalogOpen && actionsEnabled && <WorkflowActionDock
      mode="card"
      title="设定清单已经按轻重整理好"
      detail="先查看建议，再决定本轮真正需要设计哪些条目。"
      primary={<button type="button" className="primary-action" onClick={onOpenCatalog}>查看并开始设计</button>}
    />}
  </section>;
}

function EditorialRoom({ batch, overallProgress }: { batch: SettingBatchView; overallProgress: { completed: number; total: number } }): React.JSX.Element {
  const active = batch.status === 'queued' || batch.status === 'working';
  const [expanded, setExpanded] = useState(false);
  const assignedKeys = new Set(batch.items.flatMap((item) => item.assignedMemberKey === null ? [] : [canonicalMemberIdentityKey(item.assignedMemberKey)]));
  const allMembers = uniqueByMemberKey(batch.members);
  // 三名主编是交接池，不是三个人同时参与。编辑部摘要只展示本轮主持
  // 主编（优先真实工作中的一位，否则使用冻结名册首位）和实际接单成员。
  const hostChief = allMembers.find((member) => publicRoleLabel(member.role) === '主编' && member.presence === 'working')
    ?? allMembers.find((member) => publicRoleLabel(member.role) === '主编');
  const members = allMembers.filter((member) => member.memberKey === hostChief?.memberKey
    || assignedKeys.has(canonicalMemberIdentityKey(member.memberKey))
    || (active && member.presence === 'working'));
  const chief = members.find((member) => member.memberKey === hostChief?.memberKey);
  const otherMembers = members.filter((member) => member.memberKey !== chief?.memberKey);
  const visiblePresence = (member: SettingBatchView['members'][number]): SettingBatchView['members'][number]['presence'] =>
    !active && member.presence === 'working' ? 'ready' : member.presence;
  const chiefMessage = batch.status === 'queued'
    ? '任务已经排队，开始后会在这里更新进度。'
    : batch.status === 'working'
      ? publicStatusCopy(chief?.presence === 'working' ? chief.statusText : batch.statusText, '编辑部正在设计本轮设定。')
      : batch.status === 'partially_failed'
        ? publicFailureCopy(batch.statusText)
        : publicStatusCopy(batch.statusText, '本轮设计已经完成，请查看结果。');
  return <section className={`editorial-room ${expanded ? 'expanded' : 'collapsed'}`} aria-label="设定编辑部">
    <div className="editorial-summary">
      {chief && <div className="editorial-chief"><span className={`agent-avatar ${visiblePresence(chief)}`} style={{ backgroundPosition: memberAvatarPosition(chief.memberKey) }} aria-hidden="true"/><span><strong>{memberDisplayName(chief.memberKey, chief.displayName)} · 主编</strong><small>{active && chief.currentItem !== null ? `正在处理：${chief.currentItem}` : '负责本轮统筹与审查'}</small></span></div>}
      <div className={`chief-message ${active ? 'moving' : ''}`} role="status"><span>{chiefMessage}</span></div>
      <div className="editorial-avatar-row" aria-label="本轮参与成员">{otherMembers.map((member) => { const presence = visiblePresence(member); return <span key={member.memberKey} className={`agent-avatar ${presence}`} title={`${memberDisplayName(member.memberKey, member.displayName)}：${presence === 'working' ? publicStatusCopy(member.currentItem ?? member.statusText, '正在处理本轮设定') : presence === 'leave' ? '暂时无法接单' : '本轮工作已经完成'}`} style={{ backgroundPosition: memberAvatarPosition(member.memberKey) }}/>; })}</div>
      <b>本轮 {batch.progress.completed}/{batch.progress.total}<small>全书 {overallProgress.completed}/{overallProgress.total}</small></b>
      <button type="button" className="editorial-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? '收起成员' : '查看参与成员'}</button>
    </div>
    <div className="editorial-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={batch.progress.percent}><span style={{ width: `${batch.progress.percent}%` }}/></div>
    {expanded && <div className="editorial-roster">{members.map((member) => { const presence = visiblePresence(member); return <article key={member.memberKey} className={presence}><div><span className="agent-avatar" style={{ backgroundPosition: memberAvatarPosition(member.memberKey) }} aria-hidden="true"/><div><strong>{memberDisplayName(member.memberKey, member.displayName)}</strong><small>{publicRoleLabel(member.role)}</small></div></div><p>{presence === 'working' ? publicStatusCopy(member.currentItem ?? member.statusText, '正在处理本轮设定。') : presence === 'leave' ? '暂时无法接单。' : active ? '本轮等待安排。' : '本轮工作已经完成。'}</p><em>本轮完成 {member.completedCount} 项</em></article>; })}</div>}
  </section>;
}

interface SettingResultCardProps {
  bookId: string;
  item: SettingItemView;
  members: SettingBatchView['members'];
  editing: boolean;
  redesigning: boolean;
  optimizing: boolean;
  onEdit: () => void;
  onRedesign: () => void;
  onCloseInline: () => void;
  onTaskStarted: (batch: SettingBatchView) => void;
  onAdoptChief: () => void;
  onConfirm: () => void;
}

function SettingResultCard(props: SettingResultCardProps): React.JSX.Element {
  const { item, members, editing, redesigning, optimizing } = props;
  const [expanded, setExpanded] = useState(false);
  const active = item.state === 'queued' || item.state === 'working' || item.state === 'chief_review';
  const assignedKey = item.assignedMemberKey === null ? null : canonicalMemberIdentityKey(item.assignedMemberKey);
  const assigned = uniqueByMemberKey(members).find((member) => canonicalMemberIdentityKey(member.memberKey) === assignedKey);
  // 条目卡必须展示这个条目自己的真实进度。成员可能同时承担多项工作，
  // 直接复用成员级 statusText 会把另一项任务的文案串到当前卡片上。
  const assignedStatus = publicStatusCopy(item.stateText ?? assigned?.statusText, '正在处理这个条目。');
  const stateText = item.state === 'failed'
    ? publicFailureCopy(item.stateText)
    : publicStatusCopy(item.stateText, active ? '正在处理这个条目。' : '等待您查看。');
  useEffect(() => { if (editing || redesigning) setExpanded(true); }, [editing, redesigning]);
  return <article className={`setting-result-card ${item.state} ${expanded ? 'expanded' : 'collapsed'}`}>
    <header>
      <div><span>{item.groupTitle}</span><h3>{item.label}</h3></div>
      {active && assigned ? <div className="setting-active-member" role="status">
        <span className="setting-active-avatar" style={{ backgroundPosition: memberAvatarPosition(assigned.memberKey) }} aria-hidden="true"/>
        <span><strong>{memberDisplayName(assigned.memberKey, assigned.displayName)}</strong><small>{assignedStatus}</small></span>
      </div> : <div className="setting-result-status"><em>{item.state === 'confirmed' ? <><CheckCircleIcon />已确认</> : stateText}</em>{item.issues.length > 0 && <small>需要决定 {item.issues.length} 项</small>}</div>}
      <button type="button" className="setting-detail-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? '收起详情' : '查看详情'}</button>
    </header>
    {!expanded && item.content !== null && <p className="setting-result-preview">{compactPreview(item.content, 88)}</p>}
    {expanded && <>
      {item.content !== null && <p className="setting-final-content">{item.content}</p>}
      {item.content !== null && item.designRationale !== null && <details className="setting-rationale"><summary><span>设计思路</span><small>展开查看</small></summary><div><h4>为什么这样设计</h4><p>{item.designRationale}</p>{item.storyConsequences.length > 0 && <><h4>会影响后续什么</h4><ul>{item.storyConsequences.map((entry) => <li key={entry}>{entry}</li>)}</ul></>}</div></details>}
      {!active && item.issues.length > 0 && <div className="chief-issues"><strong><WarningCircleIcon />需要您决定</strong>{item.issues.map((issue) => <p key={`${issue.problem}-${issue.suggestion}`}><b>{issue.problem}</b><span>{issue.suggestion}</span></p>)}<small>采用提醒后会把当前完整内容直接交给主编复审；您确认后才会正式采用。</small><button type="button" disabled={optimizing} onClick={props.onAdoptChief}><SparkleIcon />{optimizing ? '正在创建优化任务…' : '按提醒优化'}</button></div>}
      {!active && <footer><button type="button" aria-expanded={editing} onClick={props.onEdit}><PencilSimpleIcon />修改内容</button><button type="button" aria-expanded={redesigning} onClick={props.onRedesign}><RobotIcon />重新设计</button>{item.state !== 'confirmed' && <button type="button" className="confirm-setting" onClick={props.onConfirm}><CheckIcon />确认采用</button>}</footer>}
      {editing && <InlineEditPanel bookId={props.bookId} item={item} onClose={props.onCloseInline} onTaskStarted={props.onTaskStarted}/>} 
      {redesigning && <InlineRedesignPanel bookId={props.bookId} item={item} members={members.filter((member) => publicRoleLabel(member.role) === '策划编剧')} onClose={props.onCloseInline} onTaskStarted={props.onTaskStarted}/>}
    </>}
  </article>;
}

function InlineEditPanel({ bookId, item, onClose, onTaskStarted }: { bookId: string; item: SettingItemView; onClose: () => void; onTaskStarted: (batch: SettingBatchView) => void }): React.JSX.Element {
  const [content, setContent] = useState(item.content ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setBusy(true); setError(null);
    try {
      onTaskStarted(await createSettingItemReviewTask(bookId, item.itemKey, {
        content,
        instruction: '这是作者亲自修改后的版本。保留作者原意，只整理表达与明显的一致性问题，然后重新交给主编检查。'
      }));
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  return <section className="setting-inline-panel setting-inline-edit" aria-label={`修改${item.label}`}>
    <header><span><strong>修改后重新检查</strong><small>保存会创建新任务，旧审查不会直接沿用。</small></span><button type="button" aria-label="收起修改内容" onClick={onClose}><XIcon /></button></header>
    <textarea aria-label={`修改${item.label}内容`} maxLength={2000} value={content} onChange={(event) => setContent(event.target.value)}/><span className="field-count">{Array.from(content).length}/2000</span>
    {error && <div className="error-notice">{error}</div>}
    <footer><button type="button" onClick={onClose}>取消</button><button type="button" className="primary-action" disabled={busy || !content.trim()} onClick={() => void save()}>{busy ? '正在创建任务…' : '保存并交主编复审'}</button></footer>
  </section>;
}

function InlineRedesignPanel({ bookId, item, members, onClose, onTaskStarted }: { bookId: string; item: SettingItemView; members: SettingBatchView['members']; onClose: () => void; onTaskStarted: (batch: SettingBatchView) => void }): React.JSX.Element {
  const availableMembers = uniqueByMemberKey(members);
  const storageKey = `wenmi-v7-setting-redesign:${encodeURIComponent(bookId)}:${encodeURIComponent(item.itemKey)}`;
  const [selected, setSelected] = useState<string[]>(availableMembers.filter((member) => member.presence !== 'leave').slice(0, 1).map((member) => member.memberKey));
  const [note, setNote] = useState('');
  const [redesignTask, setRedesignTask] = useState<SettingRedesignTaskView | null>(null);
  const [taskId, setTaskId] = useState<string | null>(() => readLocalTask(storageKey));
  const [pollAttempt, setPollAttempt] = useState(0);
  const [currentAttempt, setCurrentAttempt] = useState(0);
  const [currentLookupEnabled, setCurrentLookupEnabled] = useState(true);
  const [restoringCurrent, setRestoringCurrent] = useState(() => readLocalTask(storageKey) === null);
  const [pollFailed, setPollFailed] = useState(false);
  const [candidates, setCandidates] = useState<SettingRedesignCandidate[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [failedMemberKeys, setFailedMemberKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (taskId !== null || !currentLookupEnabled) return;
    let stopped = false;
    const controller = new AbortController();
    setRestoringCurrent(true);
    void fetchCurrentSettingRedesignTask(bookId, item.itemKey, controller.signal).then((value) => {
      if (stopped) return;
      writeLocalTask(storageKey, value.taskId);
      setTaskId(value.taskId);
      setRedesignTask(value);
      setFailedMemberKeys(value.failedMemberKeys ?? []);
      setPollFailed(false);
      setError(value.status === 'failed' ? publicFailureCopy(value.statusText) : null);
      if ((value.status === 'ready' || value.status === 'failed') && value.candidates.length > 0) {
        setCandidates(value.candidates);
        setChosen(value.candidates.slice(0, 1).map((candidate) => candidate.outputId));
      }
    }).catch((reason: unknown) => {
      if (stopped || controller.signal.aborted) return;
      if (reason instanceof AuthorApiError && (reason.status === 404 || reason.status === 409)) {
        removeLocalTask(storageKey);
        setTaskId(null);
        setRedesignTask(null);
        setPollFailed(false);
        setError(null);
        return;
      }
      setPollFailed(true);
      setError(message(reason));
    }).finally(() => { if (!stopped) setRestoringCurrent(false); });
    return () => { stopped = true; controller.abort(); };
  }, [bookId, currentAttempt, currentLookupEnabled, item.itemKey, storageKey, taskId]);

  useEffect(() => {
    if (taskId === null || (redesignTask?.taskId === taskId && (redesignTask.status === 'ready' || redesignTask.status === 'failed'))) return;
    let stopped = false;
    let timer = 0;
    const controller = new AbortController();
    const poll = async (): Promise<void> => {
      try {
        const value = await fetchSettingRedesignTask(bookId, item.itemKey, taskId, controller.signal);
        if (stopped) return;
        setRedesignTask(value);
        setFailedMemberKeys(value.failedMemberKeys ?? []);
        setPollFailed(false);
        setError(value.status === 'failed' ? publicFailureCopy(value.statusText) : null);
        if ((value.status === 'ready' || value.status === 'failed') && value.candidates.length > 0) {
          setCandidates(value.candidates);
          setChosen(value.candidates.slice(0, 1).map((candidate) => candidate.outputId));
        } else if (value.status === 'queued' || value.status === 'working') {
          timer = window.setTimeout(() => void poll(), 1_200);
        }
      } catch (reason) {
        if (stopped || controller.signal.aborted) return;
        if (reason instanceof AuthorApiError && (reason.status === 404 || reason.status === 409)) {
          removeLocalTask(storageKey);
          setTaskId(null);
          setRedesignTask(null);
          setRestoringCurrent(true);
          return;
        }
        setPollFailed(true);
        setError(message(reason));
      }
    };
    void poll();
    return () => { stopped = true; controller.abort(); window.clearTimeout(timer); };
  }, [bookId, item.itemKey, pollAttempt, redesignTask?.status, redesignTask?.taskId, storageKey, taskId]);

  const clearTask = (): void => {
    removeLocalTask(storageKey);
    setTaskId(null);
    setRedesignTask(null);
    setCandidates([]);
    setChosen([]);
    setFailedMemberKeys([]);
    setPollFailed(false);
    setError(null);
    setCurrentLookupEnabled(false);
    setRestoringCurrent(false);
  };
  const run = async (): Promise<void> => {
    setBusy(true); setError(null); setPollFailed(false);
    try {
      const value = await redesignSettingItem(bookId, item.itemKey, selected, note);
      writeLocalTask(storageKey, value.taskId);
      setTaskId(value.taskId);
      setRedesignTask(value);
      setFailedMemberKeys(value.failedMemberKeys ?? []);
      if ((value.status === 'ready' || value.status === 'failed') && value.candidates.length > 0) {
        setCandidates(value.candidates);
        setChosen(value.candidates.slice(0, 1).map((candidate) => candidate.outputId));
      } else if (value.status === 'failed') setError(publicFailureCopy(value.statusText));
    } catch (reason) {
      setCurrentLookupEnabled(true);
      setCurrentAttempt((current) => current + 1);
      setError(message(reason));
    }
    finally { setBusy(false); }
  };
  const apply = async (): Promise<void> => {
    setBusy(true); setError(null);
    try {
      if (chosen.length === 1) {
        const candidate = candidates.find((entry) => entry.outputId === chosen[0]);
        if (candidate === undefined) throw new Error('请选择一份可用方案。');
        if (redesignTask === null) throw new Error('没有找到这份方案对应的任务。');
        const next = await createSettingItemReviewTask(bookId, item.itemKey, {
          content: candidate.proposal.content,
          instruction: note || '作者选择了这份重新设计方案，请在不改变核心内容的前提下重新整理并交给主编检查。',
          sourceRedesignTaskId: redesignTask.taskId,
          sourceOutputId: candidate.outputId
        });
        removeLocalTask(storageKey);
        onTaskStarted(next);
      } else {
        const next = await fuseSettingItem(bookId, item.itemKey, chosen, note);
        removeLocalTask(storageKey);
        onTaskStarted(next);
      }
    } catch (reason) { setError(message(reason)); setBusy(false); }
  };
  const memberFor = (memberKey: string) => availableMembers.find((member) => canonicalMemberIdentityKey(member.memberKey) === canonicalMemberIdentityKey(memberKey));
  const taskActive = redesignTask?.status === 'queued' || redesignTask?.status === 'working';
  return <section className="setting-inline-panel redesign-panel" aria-label={`重新设计${item.label}`}>
    <header><span><strong>重新设计 · {item.label}</strong><small>{candidates.length > 0 ? '勾选一份采用，或勾选多份交给主编融合。' : taskActive ? publicStatusCopy(redesignTask?.statusText, '编剧正在分别设计，离开页面也会保留进度。') : '默认一位强模型成员；需要比较时再加到三位，每份结果独立保存。'}</small></span><button type="button" aria-label="收起重新设计" onClick={onClose}><XIcon /></button></header>
    {taskActive && <div className="chief-message moving" role="status"><span>{publicStatusCopy(redesignTask.statusText, '编剧正在分别设计，完成后会在这里显示。')}</span></div>}
    {candidates.length === 0 ? <>
      <div className="redesign-members">{availableMembers.map((member) => <label key={member.memberKey} className={selected.includes(member.memberKey) ? 'selected' : ''}>
        <input type="checkbox" disabled={member.presence === 'leave' || restoringCurrent || taskActive || busy} checked={selected.includes(member.memberKey)} onChange={(event) => setSelected((current) => event.target.checked ? current.length < 3 ? [...current, member.memberKey] : current : current.filter((key) => key !== member.memberKey))}/>
        <span className="redesign-member-avatar" style={{ backgroundPosition: memberAvatarPosition(member.memberKey) }} aria-hidden="true"/>
        <span><strong>{memberDisplayName(member.memberKey, member.displayName)}</strong><small>{member.presence === 'leave' ? '暂时无法接单' : member.presence === 'working' ? publicStatusCopy(member.currentItem ?? member.statusText, '正在处理当前任务') : '当前空闲，可以接单'}</small></span>
      </label>)}</div>
      <textarea aria-label="重新设计调整意见" maxLength={800} disabled={restoringCurrent || taskActive || busy} placeholder="补充您的调整意见（可不填）" value={note} onChange={(event) => setNote(event.target.value)}/><span className="field-count">{Array.from(note).length}/800</span>
      <footer><button type="button" onClick={onClose}>收起</button>{pollFailed
        ? <button type="button" className="primary-action" onClick={() => { setPollFailed(false); setError(null); taskId === null ? setCurrentAttempt((current) => current + 1) : setPollAttempt((current) => current + 1); }}>重新连接这项任务</button>
        : redesignTask?.status === 'failed'
          ? redesignTask.retryable
            ? <button type="button" className="primary-action" disabled={busy} onClick={() => {
                if (taskId === null) return;
                setBusy(true); setError(null);
                void retrySettingRedesignTask(bookId, item.itemKey, taskId)
                  .then((value) => { setRedesignTask(value); setPollAttempt((current) => current + 1); })
                  .catch((reason: unknown) => setError(message(reason)))
                  .finally(() => setBusy(false));
              }}>{busy ? '正在继续…' : '继续未完成方案'}</button>
            : <button type="button" className="primary-action" onClick={() => setPollAttempt((current) => current + 1)}>刷新核对结果</button>
          : <button type="button" className="primary-action" disabled={restoringCurrent || busy || taskActive || selected.length < 1} onClick={() => void run()}>{restoringCurrent ? '正在找回上次任务…' : busy || taskActive ? '编剧正在设计…' : `请${selected.length}名编剧出方案`}</button>}</footer>
    </> : <>
      <div className="candidate-comparison">{candidates.map((candidate, index) => { const member = memberFor(candidate.memberKey); return <label key={candidate.outputId} className={chosen.includes(candidate.outputId) ? 'selected' : ''}>
        <input type="checkbox" checked={chosen.includes(candidate.outputId)} onChange={(event) => setChosen((current) => event.target.checked ? current.length < 3 ? [...current, candidate.outputId] : current : current.filter((id) => id !== candidate.outputId))}/>
        <span className="candidate-member"><span className="redesign-member-avatar" style={{ backgroundPosition: memberAvatarPosition(candidate.memberKey) }} aria-hidden="true"/><span><strong>方案 {index + 1}</strong><small>{member === undefined ? '编剧方案' : memberDisplayName(member.memberKey, member.displayName)}</small></span></span>
        <p>{candidate.proposal.content}</p><details><summary>为什么这样设计</summary><p>{candidate.proposal.designRationale}</p></details>
      </label>; })}</div>
      <footer><button type="button" disabled={busy} onClick={clearTask}>重新选择成员</button><button type="button" className="primary-action" disabled={busy || chosen.length < 1} onClick={() => void apply()}>{busy ? '正在整理…' : chosen.length > 1 ? `融合${chosen.length}份方案` : '采用并交主编复审'}</button></footer>
    </>}
    {failedMemberKeys.length > 0 && <div className="error-notice" role="alert">抱歉，有{failedMemberKeys.length}位编剧这次没有完成；已完成方案都已保留，您仍可直接采用。</div>}
    {error && <div className="error-notice" role="alert">{error}</div>}
  </section>;
}

function updateItem(item: SettingItemView, setBatch: React.Dispatch<React.SetStateAction<SettingBatchView | null>>, setDepartment: React.Dispatch<React.SetStateAction<SettingDepartmentView | null>>): void { setBatch((batch) => batch === null ? null : { ...batch, items: batch.items.map((entry) => entry.itemKey === item.itemKey ? item : entry) }); setDepartment((department) => department === null ? null : { ...department, confirmedItems: department.confirmedItems.some((entry) => entry.itemKey === item.itemKey) ? department.confirmedItems.map((entry) => entry.itemKey === item.itemKey ? item : entry) : [...department.confirmedItems, item] }); }
function mergeSettingItems(existing: SettingItemView[], currentBatch: SettingItemView[]): SettingItemView[] { const map = new Map(existing.map((item) => [item.itemKey, item])); for (const item of currentBatch) map.set(item.itemKey, item); return [...map.values()]; }
function compactPreview(content: string, limit: number): string { const normalized = content.replace(/\s+/gu, ' ').trim(); return Array.from(normalized).length > limit ? `${Array.from(normalized).slice(0, limit).join('')}…` : normalized; }
function readLocalTask(key: string): string | null { try { return window.localStorage.getItem(key); } catch { return null; } }
function writeLocalTask(key: string, value: string): void { try { window.localStorage.setItem(key, value); } catch { /* 服务端 current 查询仍可恢复任务。 */ } }
function removeLocalTask(key: string): void { try { window.localStorage.removeItem(key); } catch { /* 不影响服务端任务状态。 */ } }
function message(reason: unknown): string {
  if (reason instanceof AuthorApiError && reason.status >= 400 && reason.status < 500) {
    return publicStatusCopy(reason.message, '对不起，这次操作没有完成，请检查当前条件后再试。');
  }
  return '对不起，这次操作没有完成，请稍后再试。';
}
