import { useCallback, useEffect, useRef, useState } from 'react';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import {
  fetchSettlementFollowUp,
  startSettlementFollowUp,
  type SettlementFollowUpData
} from '../../lib/api/client';

function followUpActive(status: string): boolean {
  return ['pending', 'queued', 'working', 'paused'].includes(status);
}

function followUpStatusLabel(data: SettlementFollowUpData): string {
  if (followUpActive(data.status)) {
    return data.pacingReport === null ? '主编正在做节奏体检…' : '副编正在整理大白话摘要…';
  }
  if (data.status === 'succeeded') return '体检与摘要已完成';
  if (data.status === 'failed' || data.status === 'interrupted') return '本轮未完成，可以重试';
  if (data.status === 'cancelled') return '本轮已停止';
  return '正在处理';
}

/**
 * 结算后续卡：事件或卷结算完成后，展示主编节奏体检报告和副编大白话摘要。
 * 结算本身不依赖这份产物；产物没准备好时只显示进度，不阻塞阅读结算内容。
 */
export function SettlementFollowUpCard({ bookId, stageKind, stageObjectId }: {
  bookId: string;
  stageKind: 'event' | 'volume';
  stageObjectId: string;
}): React.JSX.Element | null {
  const [data, setData] = useState<SettlementFollowUpData | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const next = await fetchSettlementFollowUp(bookId, stageKind, stageObjectId, signal);
    setMissing(next === null);
    setData(next);
  }, [bookId, stageKind, stageObjectId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(() => setMissing(true));
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (data !== null && followUpActive(data.status)) {
      timer.current = setInterval(() => { void load().catch(() => undefined); }, 3_000);
    }
    return () => { if (timer.current !== null) clearInterval(timer.current); };
  }, [data, load]);

  const start = (): void => {
    setBusy(true);
    setError(null);
    void startSettlementFollowUp(bookId, stageKind, stageObjectId)
      .then((next) => { setData(next); setMissing(false); })
      .catch((reason: unknown) => setError(authorErrorFromUnknown(reason, '暂时无法发起，请稍后重试。')))
      .finally(() => setBusy(false));
  };

  if (missing && data === null) {
    return <section className="settlement-follow-up-card">
      <header><small>结算后续</small><h4>节奏体检与大白话摘要</h4></header>
      <p>这次结算还没有团队体检和摘要。</p>
      <button type="button" className="secondary-button" disabled={busy} onClick={start}>
        {busy ? '正在安排…' : '让主编和副编补做'}
      </button>
      {error !== null && <p className="planning-error" role="alert">{error}</p>}
    </section>;
  }
  if (data === null) return null;

  const report = data.pacingReport;
  return <section className="settlement-follow-up-card">
    <header><small>结算后续</small><h4>节奏体检与大白话摘要</h4>
      <span className={`follow-up-status ${followUpActive(data.status) ? 'working' : ''}`}>{followUpStatusLabel(data)}</span></header>
    {data.summary !== null && <div className="follow-up-summary">
      <strong>{data.summaryBy === null ? '副编' : data.summaryBy.displayName} · 大白话摘要</strong>
      <p>{data.summary}</p>
    </div>}
    {report !== null && <div className="follow-up-pacing">
      <strong>{data.pacingBy === null ? '主编' : data.pacingBy.displayName} · 节奏体检</strong>
      <dl>
        <div><dt>总评</dt><dd>{report.overallAssessment}</dd></div>
        <div><dt>爽点与付费点</dt><dd>{report.payoffPlacement}</dd></div>
        <div><dt>高潮间隔</dt><dd>{report.climaxSpacing}</dd></div>
        <div><dt>压抑时长</dt><dd>{report.pressureDuration}</dd></div>
        <div><dt>恢复节拍</dt><dd>{report.recoveryBeats}</dd></div>
      </dl>
      {report.risks.length > 0 && <ul className="follow-up-risks">
        {report.risks.map((risk) => <li key={risk}>{risk}</li>)}
      </ul>}
      {report.suggestions.length > 0 && <ul className="follow-up-suggestions">
        {report.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}
      </ul>}
    </div>}
    {(data.status === 'failed' || data.status === 'interrupted' || data.status === 'cancelled')
      && <button type="button" className="secondary-button" disabled={busy} onClick={start}>
        {busy ? '正在安排…' : '重试未完成的部分'}
      </button>}
    {error !== null && <p className="planning-error" role="alert">{error}</p>}
  </section>;
}
