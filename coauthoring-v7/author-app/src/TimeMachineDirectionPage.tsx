import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircleIcon, ClockCounterClockwiseIcon, PencilSimpleIcon, SparkleIcon } from '@phosphor-icons/react';
import {
  adoptTimeMachinePlan,
  fetchTimeMachineDirectionState,
  retryTimeMachineRun,
  saveTimeMachineCandidateRevision,
  startTimeMachineDesignRound,
  startTimeMachineRecommendation,
  timeMachineRunBusy,
  type TimeMachineDesignResultView,
  type TimeMachinePlanView,
  type TimeMachineRecommendationView,
  type TimeMachineRunView,
  type TimeMachineStateView,
  type TimeMachineVolumeView
} from './time-machine-direction-api';
import { AuthorApiError, fetchLatestPlanningRouteRun, fetchLatestPlanningTreeGeneration } from './opening-api';
import { TimeMachinePage } from './TimeMachinePage';
import './time-machine-direction.css';

type EntryMode = 'detecting' | 'legacy' | 'v2';
type Feedback = { tone: 'error' | 'info'; text: string } | null;

function volumeLetter(index: number): string {
  let n = index + 1;
  let code = '';
  while (n > 0) { const rest = (n - 1) % 26; code = String.fromCharCode(65 + rest) + code; n = Math.floor((n - 1) / 26); }
  return code;
}

function roleLabel(role: string): string {
  if (role === 'main') return '主线';
  if (role === 'through') return '支线';
  return '阶段线';
}

function actionLabel(action: string): string {
  if (action === 'start') return '开启';
  if (action === 'advance') return '推进';
  if (action === 'pause') return '暂缓';
  return '收束';
}

function formatWords(target: number): string {
  if (target >= 10000) return `约${Math.round(target / 10000)}万字`;
  return `约${target}字`;
}

function isDesignResult(value: unknown): value is TimeMachineDesignResultView {
  return value !== null && typeof value === 'object' && 'candidateId' in value && 'plan' in value;
}

function isRecommendation(value: unknown): value is TimeMachineRecommendationView {
  return value !== null && typeof value === 'object' && 'greeting' in value && 'lines' in value;
}

/** 时光机入口：新书面向新版全书方向；已有旧规划数据的书保留旧视图并可进入新版（第23.12节阶段二）。 */
export function TimeMachineDirectionEntry({ bookId, onOpenSettings }: { bookId: string; onOpenSettings?: (() => void) | undefined }): React.JSX.Element {
  const [mode, setMode] = useState<EntryMode>('detecting');
  const manualChoice = useRef<'legacy' | 'v2' | null>(null);

  useEffect(() => {
    let cancelled = false;
    const detect = async () => {
      if (manualChoice.current !== null) { if (!cancelled) setMode(manualChoice.current); return; }
      // tm2状态可读且有活动 → 新版；否则查旧规划数据；状态读取失败时进入久经使用的旧视图，不阻塞作者。
      let stateLoaded: TimeMachineStateView | null = null;
      try {
        stateLoaded = await fetchTimeMachineDirectionState(bookId);
        if (cancelled) return;
      } catch { stateLoaded = null; }
      if (stateLoaded !== null && (stateLoaded.runs.length > 0 || stateLoaded.adopted !== null)) { if (!cancelled) setMode('v2'); return; }
      let hasLegacy = false;
      try {
        const [routeRun, generation] = await Promise.allSettled([fetchLatestPlanningRouteRun(bookId), fetchLatestPlanningTreeGeneration(bookId, 'book', 'book')]);
        if (cancelled) return;
        hasLegacy = (routeRun.status === 'fulfilled' && routeRun.value !== null)
          || (generation.status === 'fulfilled' && generation.value !== null);
      } catch { hasLegacy = false; }
      if (cancelled) return;
      if (stateLoaded === null) { setMode('legacy'); return; }
      setMode(hasLegacy ? 'legacy' : 'v2');
    };
    void detect();
    return () => { cancelled = true; };
  }, [bookId]);

  if (mode === 'detecting') {
    return <div className="tmd-shell"><div className="tmd-loading">正在打开时光机……</div></div>;
  }
  if (mode === 'legacy') {
    return (
      <div className="tmd-legacy-wrap">
        <div className="tmd-legacy-switch">
          <span>本书有旧版规划记录，先保留旧视图。</span>
          <button type="button" onClick={() => { manualChoice.current = 'v2'; setMode('v2'); }}>用新版全书方向</button>
        </div>
        <TimeMachinePage bookId={bookId} {...(onOpenSettings !== undefined ? { onOpenSettings } : {})} />
      </div>
    );
  }
  return <TimeMachineDirectionPage bookId={bookId} onOpenSettings={onOpenSettings} onBackToLegacy={manualChoice.current === null ? () => { manualChoice.current = 'legacy'; setMode('legacy'); } : undefined} />;
}

function TimeMachineDirectionPage({ bookId, onOpenSettings, onBackToLegacy }: { bookId: string; onOpenSettings?: (() => void) | undefined; onBackToLegacy?: (() => void) | undefined }): React.JSX.Element {
  const [state, setState] = useState<TimeMachineStateView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [selectedScheme, setSelectedScheme] = useState<string | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [authorNote, setAuthorNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TimeMachinePlanView | null>(null);
  const recommendStarted = useRef(false);
  const designKey = useRef(`design:${bookId}:${Date.now()}`);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchTimeMachineDirectionState(bookId, signal);
      setState(next); setLoadFailed(false);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      setLoadFailed(true);
    }
  }, [bookId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const anyBusy = state?.runs.some(timeMachineRunBusy) ?? false;
  useEffect(() => {
    const period = anyBusy ? 3000 : 15000;
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, period);
    return () => window.clearInterval(timer);
  }, [anyBusy, refresh]);

  const runs = state?.runs ?? [];
  const recommendRun = useMemo(() => runs.find(run => run.kind === 'recommend') ?? null, [runs]);
  const designRuns = useMemo(() => runs.filter(run => run.kind === 'design'), [runs]);
  const latestRoundKey = useMemo(() => {
    if (designRuns.length === 0) return null;
    const latestAt = new Map<string, string>();
    for (const run of designRuns) {
      const key = run.roundKey ?? run.id;
      const prev = latestAt.get(key);
      if (prev === undefined || run.updatedAt > prev) latestAt.set(key, run.updatedAt);
    }
    let best: string | null = null; let bestAt = '';
    for (const [key, at] of latestAt) if (best === null || at > bestAt) { best = key; bestAt = at; }
    return best;
  }, [designRuns]);
  const roundRuns = useMemo(() => designRuns.filter(run => run.roundKey === latestRoundKey), [designRuns, latestRoundKey]);
  const roundActive = roundRuns.some(timeMachineRunBusy);
  const recommendBusy = recommendRun !== null && timeMachineRunBusy(recommendRun);

  useEffect(() => {
    if (state === null || !state.enabled || loadFailed) return;
    if (recommendRun === null && designRuns.length === 0 && !recommendStarted.current && state.adopted === null) {
      recommendStarted.current = true;
      void (async () => {
        try { await startTimeMachineRecommendation(bookId, `recommend-initial:${bookId}`); await refresh(); }
        catch (error) { setFeedback({ tone: 'error', text: error instanceof AuthorApiError ? error.message : '推荐尚未建立，请稍后重试' }); }
      })();
    }
  }, [state, loadFailed, recommendRun, designRuns.length, bookId, refresh]);

  const recommendation = recommendRun !== null && isRecommendation(recommendRun.result) ? recommendRun.result : null;

  useEffect(() => {
    if (recommendation !== null && selectedLineIds.length === 0) {
      setSelectedLineIds(recommendation.lines.filter(line => line.recommended).map(line => line.id));
    }
  }, [recommendation, selectedLineIds.length]);

  useEffect(() => {
    if (selectedScheme === null) {
      const firstDone = roundRuns.find(run => run.state === 'succeeded' && isDesignResult(run.result));
      if (firstDone !== undefined) setSelectedScheme(firstDone.scheme ?? 'A');
    }
  }, [roundRuns, selectedScheme]);

  const selectedRun = roundRuns.find(run => run.scheme === selectedScheme) ?? null;
  const selectedResult = selectedRun !== null && isDesignResult(selectedRun.result) ? selectedRun.result : null;
  const adopted = state?.adopted ?? null;

  const runAction = async (action: () => Promise<unknown>, success?: () => void) => {
    if (busy) return;
    setBusy(true); setFeedback(null);
    try { await action(); await refresh(); success?.(); }
    catch (error) {
      setFeedback({ tone: 'error', text: error instanceof AuthorApiError ? error.message : '操作未能完成，已保留当前结果' });
    } finally { setBusy(false); }
  };

  const startDesign = () => {
    if (recommendation === null) return;
    const picked = recommendation.lines.filter(line => selectedLineIds.includes(line.id));
    const intent = `选择的故事线：${picked.map(line => `${roleLabel(line.role)}·${line.title}`).join('；')}${authorNote.trim() ? `。作者补充：${authorNote.trim()}` : ''}${recommendation.structure === 'multiple' ? '。建议多线交织' : '。建议单主线推进'}`;
    designKey.current = `design:${bookId}:${Date.now()}`;
    void runAction(() => startTimeMachineDesignRound(bookId, intent, designKey.current));
  };

  const retryRun = (runId: string) => { void runAction(() => retryTimeMachineRun(bookId, runId)); };

  const beginEdit = () => {
    if (selectedResult === null) return;
    setDraft(structuredClone(selectedResult.plan)); setEditing(true); setFeedback(null);
  };

  const saveEdit = () => {
    if (draft === null || selectedResult === null) return;
    void runAction(async () => {
      const saved = await saveTimeMachineCandidateRevision(bookId, selectedResult.candidateId, draft, selectedResult.revision);
      setEditing(false);
      setFeedback({ tone: 'info', text: `修改已保存为第${saved.revision}版，原方案仍可回看。` });
    });
  };

  const adopt = () => {
    if (selectedResult === null || selectedRun === null || state === null) return;
    const planRevision = state.planRevision;
    void runAction(async () => {
      await adoptTimeMachinePlan(bookId, { candidateId: selectedResult.candidateId, revision: selectedResult.revision, expectedRevision: planRevision, idempotencyKey: `adopt:${selectedResult.candidateId}:${selectedResult.revision}` });
      setFeedback({ tone: 'info', text: '已采用本方案作为全书方向。规划是后续卷链章设计的依据，不代表正文已经发生。' });
    });
  };

  const redesign = () => {
    if (recommendation === null) return;
    designKey.current = `design:${bookId}:${Date.now()}`;
    void runAction(() => startTimeMachineDesignRound(bookId, `重新设计。${authorNote.trim() ? `作者补充：${authorNote.trim()}` : ''}`, designKey.current));
  };

  if (state === null) {
    return (
      <div className="tmd-shell">
        {loadFailed
          ? <div className="tmd-load-failure"><strong>时光机暂时打不开</strong><span>可能是网络问题；已完成的方案不会丢失。</span><button type="button" onClick={() => void refresh()}>重试</button></div>
          : <div className="tmd-loading">正在打开时光机……</div>}
      </div>
    );
  }

  if (!state.enabled) {
    return (
      <div className="tmd-shell">
        <div className="tmd-panel">
          <h2>全书方向</h2>
          <p>新版时光机正在接入成员与模型配置，暂时还不能开始设计。已确认的开书和设定资料不会受影响。</p>
          {onOpenSettings !== undefined && <button type="button" onClick={onOpenSettings}>查看资料</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="tmd-shell">
      <header className="tmd-header">
        <div>
          <h2>全书方向</h2>
          <p>确定基线、故事线和分卷方向；采用后作为卷、链、章设计的依据，不代表正文已经发生。</p>
        </div>
        {onBackToLegacy !== undefined && <button type="button" className="tmd-ghost" onClick={onBackToLegacy}>旧版规划</button>}
      </header>

      {feedback !== null && <div className={feedback.tone === 'error' ? 'tmd-error' : 'tmd-info'}>{feedback.text}</div>}

      {adopted !== null && (
        <section className="tmd-panel tmd-adopted">
          <div className="tmd-adopted-head">
            <CheckCircleIcon weight="fill" />
            <div>
              <strong>已采用 · {adopted.member.name} 的方案</strong>
              <span>
                {adopted.numbering !== null
                  ? `${adopted.numbering.volumes.map(v => `卷${v.code}`).join('、')}；${[...adopted.numbering.mainLines, ...adopted.numbering.branchLines].join('、')}`
                  : `${adopted.plan.volumes.length}卷规划`}
                ，全书{formatWords(adopted.plan.words.target)}
              </span>
            </div>
          </div>
          <PlanDetail plan={adopted.plan} numbering={adopted.numbering} />
          <div className="tmd-actions">
            <button type="button" disabled={busy || roundActive || recommendation === null} onClick={redesign}>重新设计全书方向</button>
          </div>
          <p className="tmd-note">下方仍可查看最近一轮的方案对比；重新设计并采用新方案后，这里的规划会更新，历史结果保留可回看。</p>
        </section>
      )}

      {recommendation !== null && adopted === null && designRuns.length === 0 && (
        <section className="tmd-panel">
          <div className="tmd-recommend-head">
            <SparkleIcon weight="fill" />
            <p>{recommendation.greeting}</p>
          </div>
          <div className="tmd-line-grid">
            {recommendation.lines.map(line => (
              <label key={line.id} className={`tmd-line-card${selectedLineIds.includes(line.id) ? ' selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={selectedLineIds.includes(line.id)}
                  onChange={event => setSelectedLineIds(prev => event.target.checked ? [...prev, line.id] : prev.filter(id => id !== line.id))}
                />
                <span className="tmd-line-role">{roleLabel(line.role)}</span>
                <strong>{line.title}{line.recommended ? ' · 主编推荐' : ''}</strong>
                <small>{line.description}</small>
              </label>
            ))}
          </div>
          <p className="tmd-suggest">主编建议：{recommendation.structure === 'multiple' ? '多条故事线交织推进' : '以单主线聚焦推进'}——{recommendation.reason}</p>
          <label className="tmd-note-field">
            <span>补充要求（可选）</span>
            <textarea value={authorNote} onChange={event => setAuthorNote(event.target.value)} rows={3} placeholder="例如：保留哪条线、想要的结局倾向、不想要的情节" />
          </label>
          <div className="tmd-actions">
            <button type="button" className="tmd-primary" disabled={busy || selectedLineIds.length === 0} onClick={startDesign}>开始设计（三位编剧各出一套方案）</button>
          </div>
        </section>
      )}

      {(roundRuns.length > 0 || recommendRun !== null) && adopted === null && (recommendBusy || recommendRun?.state === 'failed' || roundRuns.length > 0) && (
        <section className="tmd-panel">
          <h3>设计进度</h3>
          {recommendRun !== null && (recommendBusy || recommendRun.state === 'failed') && <RunRow run={recommendRun} spinning={recommendBusy} onRetry={retryRun} />}
          {roundRuns.length > 0 && (
            <div className="tmd-scheme-grid">
              {['A', 'B', 'C'].map(scheme => {
                const run = roundRuns.find(item => item.scheme === scheme);
                if (run === undefined) return null;
                return (
                  <button type="button" key={scheme} className={`tmd-scheme-card${selectedScheme === scheme ? ' selected' : ''}${run.state === 'failed' ? ' failed' : ''}`} onClick={() => setSelectedScheme(scheme)}>
                    <span className="tmd-scheme-tag">方案{scheme}</span>
                    <strong>{isDesignResult(run.result) ? run.result.member.name : run.member?.name ?? '待接手'}</strong>
                    <span className={`tmd-scheme-state state-${run.state}`}>{run.state === 'failed' ? '未完成' : run.progress}</span>
                    {run.state === 'failed' && <span className="tmd-scheme-retry" role="button" tabIndex={0} onClick={event => { event.stopPropagation(); retryRun(run.id); }} onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); retryRun(run.id); } }}>续做</span>}
                  </button>
                );
              })}
            </div>
          )}
          {roundActive && <p className="tmd-note">三套方案独立进行：先完成的可先查看；某一套未完成不影响其他两套。</p>}
          {recommendRun !== null && recommendRun.state === 'failed' && <p className="tmd-note">{recommendRun.message ?? '推荐未完成，已保存的进度会保留。'}</p>}
        </section>
      )}

      {selectedResult !== null && selectedRun !== null && (
        <section className="tmd-panel">
          <div className="tmd-plan-head">
            <h3>方案{selectedRun.scheme} · {selectedResult.member.name} · 第{selectedResult.revision}版</h3>
            <div className="tmd-actions">
              {editing
                ? <>
                    <button type="button" className="tmd-primary" disabled={busy} onClick={saveEdit}>保存修改</button>
                    <button type="button" className="tmd-ghost" disabled={busy} onClick={() => { setEditing(false); setDraft(null); }}>取消</button>
                  </>
                : <button type="button" disabled={busy} onClick={beginEdit}><PencilSimpleIcon /> 修改方案</button>}
              <button type="button" className="tmd-primary" disabled={busy || selectedResult.review.pass !== true} onClick={adopt}>采用本方案</button>
            </div>
          </div>
          {selectedResult.review.pass !== true && <div className="tmd-error">方案仍有待核对的问题，暂不能采用；可先修改，或等主编核对通过。</div>}
          {selectedResult.review.suggestions.length > 0 && (
            <details className="tmd-suggestions">
              <summary>主编文学建议（{selectedResult.review.suggestions.length}条，不阻断采用）</summary>
              <ul>{selectedResult.review.suggestions.map((text, index) => <li key={index}>{text}</li>)}</ul>
            </details>
          )}
          {editing && draft !== null
            ? <PlanEditor plan={draft} onChange={setDraft} />
            : <PlanDetail plan={selectedResult.plan} numbering={null} />}
        </section>
      )}
    </div>
  );
}

function RunRow({ run, spinning, onRetry }: { run: TimeMachineRunView; spinning: boolean; onRetry: (id: string) => void }) {
  return (
    <div className="tmd-run-row">
      {spinning && <ClockCounterClockwiseIcon className="spin" />}
      <span>{run.member !== null ? `${run.member.name} ` : ''}{run.progress}</span>
      {run.state === 'failed' && <button type="button" onClick={() => onRetry(run.id)}>续做</button>}
    </div>
  );
}

function PlanDetail({ plan, numbering }: { plan: TimeMachinePlanView; numbering: { volumes: { localId: string; code: string }[]; mainLines: string[]; branchLines: string[] } | null }) {
  const codeOf = (volumeId: string, index: number) => numbering?.volumes.find(item => item.localId === volumeId)?.code ?? volumeLetter(index);
  const lineLabel = (lineId: string, index: number) => {
    const line = plan.lines.find(item => item.id === lineId);
    if (line === undefined) return lineId;
    if (numbering === null) return `${roleLabel(line.role)}${index + 1}`;
    const mainIndex = plan.lines.filter(l => l.role === 'main').indexOf(line);
    const branchIndex = plan.lines.filter(l => l.role !== 'main').indexOf(line);
    return line.role === 'main' ? `主线${mainIndex + 1}` : `支线${branchIndex + 1}`;
  };
  return (
    <div className="tmd-plan">
      <div className="tmd-baseline">
        <p><strong>全书基线</strong>{plan.baseline}</p>
        <p><strong>最终回答</strong>{plan.ending}</p>
        <p><strong>计划字数</strong>{formatWords(plan.words.target)}{plan.words.hard ? '（作者硬要求）' : '（软目标，超出会重新估量）'}</p>
      </div>
      {plan.openingHooks.length === 3 && (
        <div className="tmd-opening">
          <h4>开篇，就让读者想看下去</h4>
          <div className="tmd-opening-grid">
            <article className="tmd-opening-card"><span>开头约300字</span><b>{plan.openingHooks[0]}</b></article>
            <article className="tmd-opening-card"><span>第一章</span><b>{plan.openingHooks[1]}</b></article>
            <article className="tmd-opening-card"><span>前三章</span><b>{plan.openingHooks[2]}</b></article>
          </div>
        </div>
      )}
      {plan.expectations.length > 0 && (
        <div className="tmd-expectations">
          <h4>从开篇惦记到结尾</h4>
          <div className="tmd-expect-head"><span>开篇的期待</span><span>想看到的变化</span><span>结尾的回应</span></div>
          {plan.expectations.map(expectation => (
            <div key={expectation.id} className="tmd-expect-row"><p>{expectation.opening}</p><p>{expectation.change}</p><p>{expectation.answer}</p></div>
          ))}
        </div>
      )}
      <div className="tmd-lines">
        <h4>故事线怎样交织</h4>
        {plan.lines.map((line, index) => (
          <div key={line.id} className="tmd-line-item">
            <span className="tmd-line-role">{lineLabel(line.id, index)}</span>
            <strong>{line.title}</strong>
            <small>{line.process}</small>
            {line.milestones.length > 0 && (
              <div className="tmd-chain">
                {line.milestones.map(milestone => (
                  <span key={milestone.id} className="tmd-chain-node">{milestone.summary}<small>{milestone.suggestedVolumes.map(id => {
                    const volumeIndex = plan.volumes.findIndex(v => v.id === id);
                    return volumeIndex >= 0 ? `卷${codeOf(id, volumeIndex)}` : id;
                  }).join('—')}{milestone.importance === 'required' ? '·必选' : ''}</small></span>
                ))}
                <span className="tmd-chain-node tmd-chain-end">{line.answer}<small>收束</small></span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="tmd-volumes">
        {plan.volumes.map((volume, index) => (
          <VolumeCard key={volume.id} volume={volume} code={codeOf(volume.id, index)} plan={plan} lineLabel={lineLabel} />
        ))}
      </div>
    </div>
  );
}

function VolumeCard({ volume, code, plan, lineLabel }: { volume: TimeMachineVolumeView; code: string; plan: TimeMachinePlanView; lineLabel: (lineId: string, index: number) => string }) {
  const entry = plan.anchors.find(anchor => anchor.ownerEntityId === volume.id && anchor.kind === 'entry');
  const exit = plan.anchors.find(anchor => anchor.ownerEntityId === volume.id && anchor.kind === 'exit');
  return (
    <details className="tmd-volume-card" open={false}>
      <summary>
        <span className="tmd-volume-code">卷{code}</span>
        <strong>{volume.title}</strong>
        {volume.beat.trim() !== '' && <span className="tmd-volume-beat">{volume.beat}</span>}
        <small>{formatWords(volume.words.target)}</small>
      </summary>
      <div className="tmd-volume-body">
        <p><strong>开场</strong>{entry?.summary ?? volume.start}</p>
        <p><strong>本卷目标</strong>{volume.goal}</p>
        <p><strong>主要阻碍</strong>{volume.conflict}</p>
        <p><strong>关键转折</strong>{volume.turningPoint}</p>
        {volume.arc !== null && <p><strong>人物变化</strong>{volume.arc}</p>}
        {volume.payoff !== null && <p><strong>期待兑现</strong>{volume.payoff}</p>}
        {volume.hook !== null && <p><strong>爽点</strong>{volume.hook}</p>}
        {volume.mood !== null && <p><strong>情绪</strong>{volume.mood}</p>}
        {volume.gain !== null && <p><strong>获得</strong>{volume.gain}</p>}
        {volume.loss !== null && <p><strong>失去</strong>{volume.loss}</p>}
        <p><strong>收束</strong>{exit?.summary ?? volume.ending}</p>
        {volume.handoff.trim() !== '' && <p><strong>留给下一卷</strong>{volume.handoff}</p>}
        <div className="tmd-duties">
          {volume.duties.map(duty => (
            <p key={duty.lineId}><span className={`tmd-duty-strength${duty.strength === 'required' ? ' required' : ''}`}>{duty.strength === 'required' ? '必做' : '可调'}</span>{lineLabel(duty.lineId, plan.lines.findIndex(l => l.id === duty.lineId))}·{actionLabel(duty.action)}：{duty.result}</p>
          ))}
        </div>
        {entry !== undefined && exit !== undefined && (
          <details className="tmd-anchor-detail">
            <summary>开场/收束核对条件</summary>
            <p><strong>开场条件</strong>{entry.conditions.map(condition => condition.summary).join('；')}（{entry.importance === 'required' ? '必达' : '可调'}；未达成：{entry.fallback}）</p>
            <p><strong>收束条件</strong>{exit.conditions.map(condition => condition.summary).join('；')}（{exit.importance === 'required' ? '必达' : '可调'}；未达成：{exit.fallback}）</p>
          </details>
        )}
      </div>
    </details>
  );
}

function PlanEditor({ plan, onChange }: { plan: TimeMachinePlanView; onChange: (plan: TimeMachinePlanView) => void }) {
  const update = (patch: Partial<TimeMachinePlanView>) => onChange({ ...plan, ...patch });
  const updateVolume = (index: number, patch: Partial<TimeMachineVolumeView>) => {
    const volumes = plan.volumes.map((volume, i) => i === index ? { ...volume, ...patch } : volume);
    update({ volumes });
  };
  return (
    <div className="tmd-editor">
      <p className="tmd-note">修改会保存为新版本，原方案保留可回看；分卷字数与锚点结构由系统校验。</p>
      <label><span>全书基线</span><textarea rows={3} value={plan.baseline} onChange={event => update({ baseline: event.target.value })} /></label>
      <label><span>最终回答</span><textarea rows={2} value={plan.ending} onChange={event => update({ ending: event.target.value })} /></label>
      {plan.volumes.map((volume, index) => (
        <fieldset key={volume.id}>
          <legend>卷{volumeLetter(index)} · {volume.title}</legend>
          <label><span>卷名</span><input value={volume.title} onChange={event => updateVolume(index, { title: event.target.value })} /></label>
          <label><span>本卷目标</span><textarea rows={2} value={volume.goal} onChange={event => updateVolume(index, { goal: event.target.value })} /></label>
          <label><span>收束</span><textarea rows={2} value={volume.ending} onChange={event => updateVolume(index, { ending: event.target.value })} /></label>
        </fieldset>
      ))}
    </div>
  );
}
