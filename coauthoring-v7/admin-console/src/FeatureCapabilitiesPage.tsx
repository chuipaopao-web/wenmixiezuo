import { useCallback, useDeferredValue, useEffect, useState } from 'react';
import { ArrowClockwise, CaretDown, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import {
  fetchFeatureCapabilities,
  type AdminFeatureBaseline,
  type AdminFeatureCapabilitiesData,
  type AdminFeatureCapability,
  type AdminFeatureStatus
} from './platform-api';

export function FeatureCapabilitiesPage(): React.JSX.Element {
  const [baseline, setBaseline] = useState<AdminFeatureBaseline>('stable-baseline');
  const [status, setStatus] = useState<AdminFeatureStatus | ''>('');
  const [moduleId, setModuleId] = useState('');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [data, setData] = useState<AdminFeatureCapabilitiesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setRefreshing(true);
    try {
      const next = await fetchFeatureCapabilities({
        baseline,
        ...(status === '' ? {} : { status }),
        ...(moduleId === '' ? {} : { moduleId }),
        ...(deferredQuery.trim() === '' ? {} : { query: deferredQuery.trim() })
      }, signal);
      setData(next);
      setError(null);
    } catch (reason) {
      if (!signal?.aborted) setError(safeMessage(reason));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [baseline, deferredQuery, moduleId, status]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (loading && data === null) {
    return <div className="feature-ledger-state"><span className="feature-ledger-spinner" />正在核对功能台账…</div>;
  }
  if (data === null) {
    return <div className="feature-ledger-state">
      <strong>抱歉，功能台账暂时没有读取成功。</strong>
      <p>{error ?? '请重新加载。'}</p>
      <button type="button" onClick={() => { setLoading(true); void load(); }}><ArrowClockwise />重新加载</button>
    </div>;
  }

  return <div className="feature-ledger-page">
    <header className="feature-ledger-heading">
      <div><h2>功能台账</h2><p>查看 V7 当前能力、旧功能去向和疑似遗漏。代码证据默认收起，需要时再展开。</p></div>
      <button type="button" disabled={refreshing} onClick={() => void load()}>
        <ArrowClockwise className={refreshing ? 'spinning' : ''} />{refreshing ? '核对中…' : '重新核对'}
      </button>
    </header>

    <section className="feature-ledger-baseline" aria-label="功能对照版本">
      <label><span>对照版本</span><select value={baseline} onChange={(event) => {
        setBaseline(event.target.value as AdminFeatureBaseline);
        setModuleId('');
      }}>{data.registry.availableBaselines.map((item) => <option key={item.key} value={item.key}>{item.label} · {item.revision}</option>)}</select></label>
      <div><strong>{data.registry.baseline.label}</strong><p>{data.registry.baseline.purpose}</p></div>
      <small>台账 {data.registry.version} · 更新于 {data.registry.updatedAt}</small>
    </section>

    <section className="feature-ledger-metrics" aria-label="功能台账统计">
      <article><span>功能模块</span><strong>{data.summary.modules}</strong></article>
      <article><span>登记能力</span><strong>{data.summary.capabilities}</strong></article>
      <article><span>当前可用</span><strong>{data.summary.currentAvailable}</strong></article>
      <article className={data.summary.statuses.suspected_missing > 0 ? 'warning' : ''}><span>疑似遗漏</span><strong>{data.summary.statuses.suspected_missing}</strong></article>
    </section>

    {data.losses.length > 0 && <section className="feature-ledger-losses" aria-label="疑似遗漏功能">
      <header><WarningCircle /><div><h3>需要核查的疑似遗漏</h3><p>这些能力有历史证据，但当前没有可确认入口，也没有正式下线决定。</p></div></header>
      <div>{data.losses.map((item) => <details key={item.id}>
        <summary><span><strong>{item.name}</strong><small>{item.moduleName}</small></span><em>需要核查</em><CaretDown /></summary>
        <dl>
          <div><dt>影响</dt><dd>{item.impact ?? '尚未登记'}</dd></div>
          <div><dt>旧入口</dt><dd>{item.previousEntry ?? '尚未登记'}</dd></div>
          <div><dt>当前结论</dt><dd>{item.decision ?? '尚未登记'}</dd></div>
          <div><dt>建议</dt><dd>{item.recommendation ?? '尚未登记'}</dd></div>
        </dl>
      </details>)}</div>
    </section>}

    <section className="feature-ledger-filters" aria-label="筛选功能台账">
      <label className="feature-ledger-search"><MagnifyingGlass /><input aria-label="搜索功能、入口或证据" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索功能、入口或证据…" /></label>
      <select aria-label="筛选功能状态" value={status} onChange={(event) => setStatus(event.target.value as AdminFeatureStatus | '')}>
        <option value="">全部状态</option>
        {Object.entries(data.registry.statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <select aria-label="筛选功能模块" value={moduleId} onChange={(event) => setModuleId(event.target.value)}>
        <option value="">全部模块</option>
        {data.moduleOptions.map((item) => <option key={item.id} value={item.id}>{data.registry.surfaceLabels[item.surface]} · {item.name}</option>)}
      </select>
      <span>{data.summary.filteredCapabilities} 项结果</span>
    </section>

    {error !== null && <p className="feature-ledger-error" role="alert">抱歉，刚才没有核对成功。当前仍显示上次成功结果，您可以重新核对。</p>}

    {data.modules.length === 0 ? <div className="feature-ledger-state compact">
      <strong>没有符合条件的功能</strong>
      <button type="button" onClick={() => { setQuery(''); setStatus(''); setModuleId(''); }}>清除筛选</button>
    </div> : <div className="feature-ledger-modules">
      {data.modules.map((module, index) => <details key={module.id} open={index === 0}>
        <summary><span><strong>{module.name}</strong><small>{data.registry.surfaceLabels[module.surface]} · {module.id}</small></span><em>{module.capabilities.length} 项</em><CaretDown /></summary>
        <div className="feature-ledger-capabilities">{module.capabilities.map((item) => <CapabilityCard key={item.id} item={item} labels={data.registry.statusLabels} />)}</div>
      </details>)}
    </div>}
  </div>;
}

function CapabilityCard({ item, labels }: {
  item: AdminFeatureCapability;
  labels: Record<AdminFeatureStatus, string>;
}): React.JSX.Element {
  return <article className={item.status === 'suspected_missing' ? 'is-missing' : ''}>
    <header><div><strong>{item.name}</strong><small>{item.id}</small></div><span className={`status-${item.status}`}>{labels[item.status]}</span></header>
    <p>{item.description}</p>
    <dl className="feature-ledger-entry">
      <div><dt>当前入口</dt><dd>{item.currentEntry ?? '当前没有入口'}</dd></div>
      {item.replacement !== undefined && <div><dt>现有去向</dt><dd>{item.replacement}</dd></div>}
    </dl>
    <details className="feature-ledger-evidence"><summary>查看判定与代码证据<CaretDown /></summary><dl>
      {item.previousEntry !== undefined && <div><dt>旧入口</dt><dd>{item.previousEntry}</dd></div>}
      {item.decision !== undefined && <div><dt>判定</dt><dd>{item.decision}</dd></div>}
      {item.impact !== undefined && <div><dt>影响</dt><dd>{item.impact}</dd></div>}
      <div><dt>代码证据</dt><dd>{item.evidence.map((path) => <code key={path}>{path}</code>)}</dd></div>
    </dl></details>
  </article>;
}

function safeMessage(reason: unknown): string {
  if (reason && typeof reason === 'object') {
    const message = Reflect.get(reason, 'message');
    if (typeof message === 'string' && message.length > 0 && message.length < 240 && !/(?:SQL|sqlite|node_modules|Bearer\s|\b(?:sk|ak)-)/iu.test(message)) return message;
  }
  return '功能台账读取失败';
}
