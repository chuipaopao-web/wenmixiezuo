/**
 * R209-B2 创作库管理页：列表（服务端筛选+游标分页）→ 详情/草稿编辑/人工审核/退役恢复 → 完整清单发布。
 * 只通过creative-reference-api访问真实接口；状态来自真实执行，失败保留输入不自动重试。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { newPlatformActionKey } from './platform-api';
import {
  createCreativeCard, fetchCreativeCardDetail, fetchCreativeCards, fetchCreativeReleaseDetail,
  fetchCreativeReleases, fetchCreativeRevisionSnapshot, fetchCreativeRevisions, publishCreativeRelease,
  reviewCreativeCard, saveCreativeCardRevision, setCreativeAvailability,
  type CreativeAvailability, type CreativeCardDetail, type CreativeCardPayload, type CreativeCardSummary,
  type CreativeReferenceContent, type CreativeReleaseSummary
} from './creative-reference-api';
import './creative-reference-library.css';

export const CREATIVE_USAGE_TREES = [
  '题材与融合', '卖点与阅读体验', '人物与关系', '故事与因果', '结构与节奏', '信息与表达', '衔接与收束', '审查与修订'
] as const;

export const CREATIVE_LAYER_OPTIONS = [
  { key: 'book_backbone', label: '全书顶层' }, { key: 'volume_distribution', label: '跨卷分布' },
  { key: 'volume', label: '单卷' }, { key: 'chain', label: '单元链' }, { key: 'chapter_execution', label: '章节' }
] as const;

export const CREATIVE_AVAILABILITY_LABELS: Record<CreativeAvailability, string> = {
  draft: '草稿', reviewed: '已审核', published: '已发布', retired: '已退役'
};

interface LibraryFilters {
  keyword: string;
  usageTree: string;
  layer: string;
  status: string;
  genre: string;
  mechanism: string;
  experience: string;
}

const EMPTY_FILTERS: LibraryFilters = { keyword: '', usageTree: '', layer: '', status: '', genre: '', mechanism: '', experience: '' };

function toArrayText(values: string[] | undefined): string {
  return (values ?? []).join('，');
}

function parseArrayText(text: string): string[] {
  return text.split(/[,，\n]/).map((item) => item.trim()).filter((item) => item.length > 0);
}

export function CreativeReferenceLibrary(): React.JSX.Element {
  const [kind, setKind] = useState<'method' | 'reference'>('method');
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const [effective, setEffective] = useState<LibraryFilters>(EMPTY_FILTERS);
  const [items, setItems] = useState<CreativeCardSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'publish' | 'releases'>('list');
  const [creating, setCreating] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const requestSeq = useRef(0);

  const currentCursor = cursorStack.length === 0 ? null : cursorStack[cursorStack.length - 1] ?? null;

  const load = useCallback(async (cursor: string | null): Promise<void> => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchCreativeCards({
        assetKind: kind,
        ...(effective.keyword.length > 0 ? { keyword: effective.keyword } : {}),
        ...(effective.usageTree.length > 0 ? { usageTree: effective.usageTree } : {}),
        ...(effective.layer.length > 0 ? { layers: [effective.layer] } : {}),
        ...(effective.status.length > 0 ? { availabilities: [effective.status as CreativeAvailability] } : {}),
        ...(kind === 'reference' && effective.genre.length > 0 ? { genre: effective.genre } : {}),
        ...(kind === 'reference' && effective.mechanism.length > 0 ? { mechanism: effective.mechanism } : {}),
        ...(kind === 'reference' && effective.experience.length > 0 ? { experience: effective.experience } : {}),
        ...(cursor === null ? {} : { cursor }),
        limit: 20
      });
      if (seq !== requestSeq.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      if (seq !== requestSeq.current) return;
      setItems([]);
      setNextCursor(null);
      setError(reason instanceof Error ? reason.message : '列表读取失败。');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [kind, effective]);

  useEffect(() => {
    if (view !== 'list' || selectedId !== null) return;
    void load(cursorStack.length === 0 ? null : cursorStack[cursorStack.length - 1] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, effective, cursorStack, view, selectedId, refreshTick]);

  const applyFilters = (next: LibraryFilters): void => { setFilters(next); setEffective(next); setCursorStack([]); };
  const resetFilters = (): void => applyFilters(EMPTY_FILTERS);
  const hasActiveFilters = useMemo(() => JSON.stringify(effective) !== JSON.stringify(EMPTY_FILTERS), [effective]);

  if (view === 'publish') {
    return <PublishPanel onBack={() => { setView('list'); }} />;
  }
  if (view === 'releases') {
    return <ReleaseHistoryPanel onBack={() => { setView('list'); }} />;
  }
  if (selectedId !== null) {
    return <CardDetailPanel
      internalId={selectedId}
      onBack={() => { setSelectedId(null); }}
    />;
  }

  const filterDirty = JSON.stringify(filters) !== JSON.stringify(effective);

  return <div className="crl-page">
    <header className="crl-heading">
      <div>
        <h1>创作库</h1>
        <p>方法卡与创作参考卡的稳定编号、审核与整库发布。AI检索接入待后续批次。</p>
      </div>
      <div className="crl-heading-actions">
        <button type="button" onClick={() => setView('releases')}>发布历史</button>
        <button type="button" className="crl-primary" onClick={() => setView('publish')}>发布版本</button>
        <button type="button" onClick={() => setCreating(true)}>新建卡</button>
      </div>
    </header>

    {creating && <CreateCardPanel onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setRefreshTick((tick) => tick + 1); }} />}

    <div className="crl-kind-tabs" role="tablist" aria-label="库内类型">
      <button type="button" role="tab" aria-selected={kind === 'method'} onClick={() => { setKind('method'); setCursorStack([]); }}>方法</button>
      <button type="button" role="tab" aria-selected={kind === 'reference'} onClick={() => { setKind('reference'); setCursorStack([]); }}>创作参考</button>
    </div>

    <div className="crl-toolbar">
      <label className="crl-search">
        <MagnifyingGlass aria-hidden="true" />
        <span className="sr-only">搜索编号、名称或短语</span>
        <input
          value={filters.keyword}
          placeholder="编号 / 名称 / 短语"
          onChange={(event) => setFilters({ ...filters, keyword: event.target.value })}
          onKeyDown={(event) => { if (event.key === 'Enter') applyFilters(filters); }}
        />
      </label>
      <select aria-label="按用途筛选" value={filters.usageTree} onChange={(event) => applyFilters({ ...filters, usageTree: event.target.value })}>
        <option value="">全部用途</option>
        {CREATIVE_USAGE_TREES.map((tree) => <option key={tree} value={tree}>{tree}</option>)}
      </select>
      <select aria-label="按适用层级筛选" value={filters.layer} onChange={(event) => applyFilters({ ...filters, layer: event.target.value })}>
        <option value="">全部层级</option>
        {CREATIVE_LAYER_OPTIONS.map((layer) => <option key={layer.key} value={layer.key}>{layer.label}</option>)}
      </select>
      <select aria-label="按状态筛选" value={filters.status} onChange={(event) => applyFilters({ ...filters, status: event.target.value })}>
        <option value="">全部状态</option>
        {Object.entries(CREATIVE_AVAILABILITY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      {kind === 'reference' && <>
        <input aria-label="按题材筛选" value={filters.genre} placeholder="题材" onChange={(event) => setFilters({ ...filters, genre: event.target.value })} onBlur={() => applyFilters(filters)} />
        <input aria-label="按机制筛选" value={filters.mechanism} placeholder="机制" onChange={(event) => setFilters({ ...filters, mechanism: event.target.value })} onBlur={() => applyFilters(filters)} />
        <input aria-label="按体验筛选" value={filters.experience} placeholder="体验" onChange={(event) => setFilters({ ...filters, experience: event.target.value })} onBlur={() => applyFilters(filters)} />
      </>}
      <button type="button" className="crl-apply" onClick={() => applyFilters(filters)}>应用筛选</button>
      {hasActiveFilters && <button type="button" className="crl-reset" onClick={resetFilters}>重置</button>}
    </div>

    {filterDirty && <p className="crl-hint">筛选条件已修改，点“应用筛选”后生效。</p>}
    {loading && <p className="crl-status" role="status">正在读取创作库…</p>}
    {error !== null && !loading && <div className="crl-error" role="alert">
      <p>{error}</p>
      <button type="button" onClick={() => void load(currentCursor)}>重试</button>
    </div>}
    {!loading && error === null && items.length === 0 && (hasActiveFilters
      ? <div className="crl-empty"><MagnifyingGlass aria-hidden="true" /><h2>没有符合条件的结果</h2><p>精确编号无结果就无结果；可换关键词或重置筛选。</p><button type="button" onClick={resetFilters}>重置筛选</button></div>
      : <div className="crl-empty"><h2>尚未录入</h2><p>创作库还是空的；此数量不包含旧分层方法库。</p></div>)}

    {!loading && error === null && items.length > 0 && <>
      <ul className="crl-list" aria-label="创作库条目">
        {items.map((item) => <li key={item.internalId}>
          <button type="button" className="crl-item" onClick={() => setSelectedId(item.internalId)}>
            <span className="crl-item-code">{item.displayCode} {item.shortPhrase}{item.availability === 'retired' ? '（已退役）' : ''}</span>
            <strong>{item.name}</strong>
            <span className="crl-item-summary">{item.summary}</span>
            <span className="crl-item-meta">
              {item.usageTree !== null && <i>{item.usageTree}</i>}
              {item.applicableLayers.length > 0 && <i>{item.applicableLayers.map((layer) => CREATIVE_LAYER_OPTIONS.find((option) => option.key === layer)?.label ?? layer).join('、')}</i>}
              <i>{item.currentRevision === null ? '无版本' : `第${item.currentRevision}版 · ${item.revisionStatus === null ? '' : item.revisionStatus === 'draft' ? '草稿' : item.revisionStatus === 'reviewed' ? '已审核' : '已发布'}`}</i>
              {item.availability === 'retired' && <i className="crl-retired">已退役</i>}
            </span>
          </button>
        </li>)}
      </ul>
      <div className="crl-pagination">
        <button type="button" disabled={cursorStack.length === 0} onClick={() => setCursorStack(cursorStack.slice(0, -1))}>上一页</button>
        <span>第 {cursorStack.length + 1} 页</span>
        <button type="button" disabled={nextCursor === null} onClick={() => { if (nextCursor !== null) setCursorStack([...cursorStack, nextCursor]); }}>下一页</button>
      </div>
    </>}
  </div>;
}

/** 详情与编辑：草稿保存用expectedRevision；失败/409保留输入并提供刷新对比，不自动重试。 */
function CardDetailPanel({ internalId, onBack }: { internalId: string; onBack: () => void }): React.JSX.Element {
  const [detail, setDetail] = useState<CreativeCardDetail | null>(null);
  const [revisions, setRevisions] = useState<CreativeRevisionList>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [nextDetail, nextRevisions] = await Promise.all([fetchCreativeCardDetail(internalId), fetchCreativeRevisions(internalId)]);
      setDetail(nextDetail);
      setRevisions(nextRevisions);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '详情读取失败。');
    } finally {
      setLoading(false);
    }
  }, [internalId]);
  useEffect(() => { void reload(); }, [reload]);

  if (loading && detail === null) return <div className="crl-page"><p className="crl-status" role="status">正在读取条目…</p><button type="button" onClick={onBack}>返回列表</button></div>;
  if (error !== null && detail === null) return <div className="crl-page"><div className="crl-error" role="alert"><p>{error}</p></div><button type="button" onClick={onBack}>返回列表</button></div>;
  if (detail === null || detail.card === null) return <div className="crl-page"><p>条目不存在。</p><button type="button" onClick={onBack}>返回列表</button></div>;

  const card = detail.card;
  const payload = detail.revision?.payload ?? null;

  return <div className="crl-page crl-detail">
    <button type="button" className="crl-back" onClick={onBack}>← 返回列表（保留筛选）</button>
    <header className="crl-detail-heading">
      <div>
        <h1>{card.displayCode}</h1>
        <p>{payload?.name ?? '（无内容版本）'}</p>
      </div>
      <div className="crl-detail-badges">
        <span>{card.assetKind === 'method' ? '方法卡' : '创作参考卡'}</span>
        <span>{CREATIVE_AVAILABILITY_LABELS[card.availability]}</span>
        {card.currentRevision !== null && <span>当前第{card.currentRevision}版</span>}
      </div>
    </header>

    {!editing && payload !== null && <PayloadView payload={payload} />}
    {payload === null && <p className="crl-hint">该条目还没有内容版本。</p>}

    {!editing && <div className="crl-detail-actions">
      <button type="button" className="crl-primary" disabled={card.availability === 'retired'} onClick={() => setEditing(true)}>{card.availability === 'retired' ? '已退役，不能编辑' : '编辑并保存新草稿'}</button>
      <ReviewControl internalId={internalId} expectedRevision={card.currentRevision} revisionStatus={detail.revision?.status ?? null} onDone={reload} />
      <AvailabilityControl internalId={internalId} availability={card.availability} onDone={reload} />
    </div>}

    {editing && payload !== null && <DraftEditor
      internalId={internalId}
      basePayload={payload}
      expectedRevision={card.currentRevision ?? 1}
      onCancel={() => setEditing(false)}
      onSaved={() => { setEditing(false); void reload(); }}
    />}

    <section className="crl-section">
      <h2>版本记录</h2>
      {revisions.items.length === 0 ? <p className="crl-hint">暂无历史版本。</p> : <RevisionHistory items={revisions.items} internalId={internalId} />}
    </section>

    <section className="crl-section">
      <h2>操作记录</h2>
      {detail.audit.length === 0 ? <p className="crl-hint">暂无操作记录。</p> : <ul className="crl-audit">
        {detail.audit.map((entry, index) => <li key={`${entry.createdAt}-${index}`}>
          <span>{entry.action === 'create' ? '创建' : entry.action === 'revise' ? '修订' : entry.action === 'review' ? '审核' : entry.action === 'retire' ? '退役' : entry.action === 'restore' ? '恢复' : '发布'}</span>
          <small>{entry.actorId} · {entry.createdAt}{entry.targetRevision !== null ? ` · 第${entry.targetRevision}版` : ''}{entry.opinion !== null && entry.opinion.length > 0 ? ` · ${entry.opinion}` : ''}</small>
        </li>)}
      </ul>}
    </section>

    {detail.aliases.length > 0 && <section className="crl-section">
      <h2>可追溯别名</h2>
      <ul className="crl-audit">{detail.aliases.map((alias, index) => <li key={index}><span>{alias.legacy.namespace}:{alias.legacy.key}{alias.legacy.version !== undefined ? `@${alias.legacy.version}` : ''}</span><small>{alias.sourceView}</small></li>)}</ul>
    </section>}
  </div>;
}

interface CreativeRevisionList { items: Array<{ revision: number; status: string; shortPhrase: string; summary: string; authorActor: string; reviewActor: string | null; reviewOpinion: string | null; createdAt: string }>; total: number }

/** 读取具体版本快照（版本对比用）；不存在返回null交由上层提示。 */
async function fetchCardRevision(internalId: string, revision: number): Promise<CreativeCardPayload | null> {
  try {
    const response = await fetchCreativeRevisionSnapshot(internalId, revision);
    return response.revision.payload;
  } catch {
    return null;
  }
}

function RevisionHistory({ items, internalId }: { items: CreativeRevisionList['items']; internalId: string }): React.JSX.Element {
  const [left, setLeft] = useState<number>(items.length >= 2 ? items[items.length - 2]!.revision : items[0]?.revision ?? 0);
  const [right, setRight] = useState<number>(items[0]?.revision ?? 0);
  const [leftPayload, setLeftPayload] = useState<CreativeCardPayload | null>(null);
  const [rightPayload, setRightPayload] = useState<CreativeCardPayload | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCompareError(null);
    setLeftPayload(null);
    setRightPayload(null);
    if (left === right) return;
    void (async () => {
      try {
        const [a, b] = await Promise.all([
          fetchCardRevision(internalId, left),
          fetchCardRevision(internalId, right)
        ]);
        if (cancelled) return;
        setLeftPayload(a);
        setRightPayload(b);
      } catch (reason) {
        if (!cancelled) setCompareError(reason instanceof Error ? reason.message : '版本读取失败。');
      }
    })();
    return () => { cancelled = true; };
  }, [internalId, left, right]);

  const diff = useMemo(() => leftPayload !== null && rightPayload !== null ? diffPayload(leftPayload, rightPayload) : [], [leftPayload, rightPayload]);

  return <div className="crl-revisions">
    <ul>
      {items.map((item) => <li key={item.revision}>
        <span>第{item.revision}版</span>
        <small>{item.status === 'draft' ? '草稿' : item.status === 'reviewed' ? '已审核' : '已发布'} · {item.shortPhrase} · {item.authorActor} · {item.createdAt}</small>
        {item.reviewOpinion !== null && item.reviewOpinion.length > 0 && <small className="crl-opinion">审核意见：{item.reviewOpinion}</small>}
      </li>)}
    </ul>
    {items.length >= 2 && <div className="crl-compare">
      <h3>版本对比（字段级，非仅哈希）</h3>
      <div className="crl-compare-selects">
        <label><span>旧版</span>
          <select aria-label="对比旧版" value={left} onChange={(event) => setLeft(Number(event.target.value))}>
            {items.map((item) => <option key={item.revision} value={item.revision}>第{item.revision}版</option>)}
          </select>
        </label>
        <label><span>新版</span>
          <select aria-label="对比新版" value={right} onChange={(event) => setRight(Number(event.target.value))}>
            {items.map((item) => <option key={item.revision} value={item.revision}>第{item.revision}版</option>)}
          </select>
        </label>
      </div>
      {compareError !== null && <p className="crl-error-inline">{compareError}</p>}
      {leftPayload !== null && rightPayload !== null && (diff.length === 0
        ? <p className="crl-hint">两个版本内容字段一致。</p>
        : <table className="crl-diff-table"><thead><tr><th>字段</th><th>改动前</th><th>改动后</th></tr></thead><tbody>
          {diff.map((row) => <tr key={row.field}><td>{row.field}</td><td>{row.before}</td><td>{row.after}</td></tr>)}
        </tbody></table>)}
    </div>}
  </div>;
}

function diffPayload(before: CreativeCardPayload, after: CreativeCardPayload): Array<{ field: string; before: string; after: string }> {
  const rows: Array<{ field: string; before: string; after: string }> = [];
  const flat = (payload: CreativeCardPayload): Record<string, string> => {
    const result: Record<string, string> = {
      name: payload.name, shortPhrase: payload.shortPhrase, summary: payload.summary, aliases: payload.aliases.join('，')
    };
    if (payload.method !== undefined) {
      result['method.title'] = payload.method.title;
      result['method.instruction'] = payload.method.instruction;
      result['method.boundary'] = payload.method.boundary ?? '';
      result['method.usageTree'] = payload.method.usageTree;
      result['method.applicableLayers'] = payload.method.applicableLayers.join('，');
      result['method.aliases'] = payload.method.aliases.join('，');
    }
    if (payload.reference !== undefined) {
      const reference = payload.reference;
      result['reference.kind'] = reference.kind;
      result['reference.facets.genres'] = reference.facets.genres.join('，');
      result['reference.facets.mechanisms'] = reference.facets.mechanisms.join('，');
      result['reference.facets.experiences'] = reference.facets.experiences.join('，');
      result['reference.facets.purposes'] = reference.facets.purposes.join('，');
      result['reference.stages'] = (reference.stages ?? []).join('，');
      result['reference.useWhen'] = (reference.useWhen ?? []).join('，');
      result['reference.questions'] = (reference.questions ?? []).join('；');
      result['reference.possibilities'] = (reference.possibilities ?? []).join('；');
      result['reference.imbalanceChecks'] = (reference.imbalanceChecks ?? []).join('；');
      result['reference.examples'] = (reference.examples ?? []).map((example) => `${example.premise}→${example.direction}（${example.boundary}）`).join('；');
      result['reference.methodRefs'] = (reference.methodRefs ?? []).join('，');
      result['reference.evidence.kind'] = reference.evidence.kind;
      result['reference.evidence.refs'] = reference.evidence.refs.join('，');
      result['reference.evidence.limitations'] = reference.evidence.limitations;
    }
    return result;
  };
  const beforeFlat = flat(before);
  const afterFlat = flat(after);
  for (const key of [...new Set([...Object.keys(beforeFlat), ...Object.keys(afterFlat)])].sort()) {
    if (beforeFlat[key] !== afterFlat[key]) {
      rows.push({ field: key, before: beforeFlat[key] ?? '（空）', after: afterFlat[key] ?? '（空）' });
    }
  }
  return rows;
}

function PayloadView({ payload }: { payload: CreativeCardPayload }): React.JSX.Element {
  return <div className="crl-payload">
    <dl className="crl-facts">
      <div><dt>短语</dt><dd>{payload.shortPhrase}</dd></div>
      <div><dt>一句说明</dt><dd>{payload.summary}</dd></div>
      {payload.method !== undefined && <>
        <div><dt>用途</dt><dd>{payload.method.usageTree}</dd></div>
        <div><dt>适用层级</dt><dd>{payload.method.applicableLayers.map((layer) => CREATIVE_LAYER_OPTIONS.find((option) => option.key === layer)?.label ?? layer).join('、') || '—'}</dd></div>
      </>}
    </dl>
    {payload.method !== undefined && <section className="crl-section"><h2>做法与边界</h2>
      <p>{payload.method.instruction}</p>
      {payload.method.boundary !== undefined && payload.method.boundary.length > 0 && <p className="crl-caution">边界：{payload.method.boundary}</p>}
    </section>}
    {payload.reference !== undefined && <ReferencePayloadView reference={payload.reference} />}
  </div>;
}

function ReferencePayloadView({ reference }: { reference: CreativeReferenceContent }): React.JSX.Element {
  return <>
    <dl className="crl-facts">
      <div><dt>参考类型</dt><dd>{reference.kind}</dd></div>
      <div><dt>题材</dt><dd>{reference.facets.genres.join('、') || '—'}</dd></div>
      <div><dt>机制</dt><dd>{reference.facets.mechanisms.join('、') || '—'}</dd></div>
      <div><dt>体验</dt><dd>{reference.facets.experiences.join('、') || '—'}</dd></div>
      <div><dt>用途</dt><dd>{reference.facets.purposes.join('、') || '—'}</dd></div>
    </dl>
    {(reference.stages ?? []).length > 0 && <section className="crl-section"><h2>适用阶段</h2><p>{(reference.stages ?? []).join('、')}</p></section>}
    {(reference.useWhen ?? []).length > 0 && <section className="crl-section"><h2>适用条件</h2><ul>{(reference.useWhen ?? []).map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
    {(reference.questions ?? []).length > 0 && <section className="crl-section"><h2>关键问题</h2><ul>{(reference.questions ?? []).map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
    {(reference.possibilities ?? []).length > 0 && <section className="crl-section"><h2>可选做法</h2><ul>{(reference.possibilities ?? []).map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
    {(reference.imbalanceChecks ?? []).length > 0 && <section className="crl-section"><h2>失衡提醒</h2><ul>{(reference.imbalanceChecks ?? []).map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
    {(reference.examples ?? []).length > 0 && <section className="crl-section"><h2>示例</h2>
      <ul>{(reference.examples ?? []).map((example, index) => <li key={index}><strong>{example.premise}</strong> → {example.direction}（{example.boundary}）</li>)}</ul>
    </section>}
    <section className="crl-section"><h2>原始依据及局限</h2>
      <p>{reference.evidence.kind === 'editorial_heuristic' ? '编辑假设' : reference.evidence.kind === 'cited_research' ? '引用研究' : '实测观察'}</p>
      {reference.evidence.refs.length > 0 && <p>依据：{reference.evidence.refs.join('；')}</p>}
      <p className="crl-caution">局限：{reference.evidence.limitations}</p>
    </section>
  </>;
}

function ReviewControl({ internalId, expectedRevision, revisionStatus, onDone }: { internalId: string; expectedRevision: number | null; revisionStatus: string | null; onDone: () => void }): React.JSX.Element {
  const [opinion, setOpinion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canReview = expectedRevision !== null && revisionStatus === 'draft';
  const submit = async (): Promise<void> => {
    if (expectedRevision === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reviewCreativeCard(internalId, { expectedRevision, ...(opinion.trim().length > 0 ? { opinion: opinion.trim() } : {}) });
      setOpinion('');
      onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '审核失败。');
    } finally {
      setBusy(false);
    }
  };
  return <div className="crl-inline-control">
    <label><span>人工审核意见（可选）</span>
      <input aria-label="人工审核意见" value={opinion} onChange={(event) => setOpinion(event.target.value)} placeholder="例如：结构与条件完整" disabled={!canReview} />
    </label>
    <button type="button" disabled={!canReview || busy} onClick={() => void submit()} title={canReview ? '表示管理员人工通过该版本' : '只有草稿版本可以审核'}>
      {busy ? '审核中…' : '通过人工审核'}
    </button>
    {error !== null && <p className="crl-error-inline" role="alert">{error}</p>}
  </div>;
}

function AvailabilityControl({ internalId, availability, onDone }: { internalId: string; availability: CreativeAvailability; onDone: () => void }): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: 'retire' | 'restore'): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setCreativeAvailability(internalId, { action, seenAvailability: availability, ...(reason.trim().length > 0 ? { reason: reason.trim() } : {}) });
      setReason('');
      onDone();
    } catch (reason_) {
      setError(reason_ instanceof Error ? reason_.message : '操作失败。');
    } finally {
      setBusy(false);
    }
  };
  return <div className="crl-inline-control">
    <label><span>{availability === 'retired' ? '恢复原因（可选）' : '退役原因（可选）'}</span>
      <input aria-label="原因" value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} />
    </label>
    {availability === 'retired'
      ? <button type="button" disabled={busy} onClick={() => void act('restore')}>{busy ? '处理中…' : '恢复使用'}</button>
      : <button type="button" className="crl-danger" disabled={busy} onClick={() => void act('retire')}>{busy ? '处理中…' : '退役（仅影响后续选择）'}</button>}
    {error !== null && <p className="crl-error-inline" role="alert">{error}</p>}
  </div>;
}

interface DraftFormState {
  name: string;
  shortPhrase: string;
  summary: string;
  aliases: string;
  methodTitle: string;
  methodInstruction: string;
  methodBoundary: string;
  methodUsageTree: string;
  methodLayers: string;
  methodAliases: string;
  referenceKind: string;
  refGenres: string;
  refMechanisms: string;
  refExperiences: string;
  refPurposes: string;
  refStages: string;
  refUseWhen: string;
  refQuestions: string;
  refPossibilities: string;
  refImbalanceChecks: string;
  refExamples: Array<{ premise: string; direction: string; boundary: string }>;
  refMethodRefs: string;
  evidenceKind: string;
  evidenceRefs: string;
  evidenceLimitations: string;
}

function formFromPayload(payload: CreativeCardPayload): DraftFormState {
  const method = payload.method;
  const reference = payload.reference;
  return {
    name: payload.name,
    shortPhrase: payload.shortPhrase,
    summary: payload.summary,
    aliases: toArrayText(payload.aliases),
    methodTitle: method?.title ?? '',
    methodInstruction: method?.instruction ?? '',
    methodBoundary: method?.boundary ?? '',
    methodUsageTree: method?.usageTree ?? '',
    methodLayers: toArrayText(method?.applicableLayers),
    methodAliases: toArrayText(method?.aliases),
    referenceKind: reference?.kind ?? 'genre',
    refGenres: toArrayText(reference?.facets.genres),
    refMechanisms: toArrayText(reference?.facets.mechanisms),
    refExperiences: toArrayText(reference?.facets.experiences),
    refPurposes: toArrayText(reference?.facets.purposes),
    refStages: toArrayText(reference?.stages),
    refUseWhen: toArrayText(reference?.useWhen),
    refQuestions: (reference?.questions ?? []).join('；'),
    refPossibilities: (reference?.possibilities ?? []).join('；'),
    refImbalanceChecks: (reference?.imbalanceChecks ?? []).join('；'),
    refExamples: (reference?.examples ?? []).map((example) => ({ ...example })),
    refMethodRefs: toArrayText(reference?.methodRefs),
    evidenceKind: reference?.evidence.kind ?? 'editorial_heuristic',
    evidenceRefs: toArrayText(reference?.evidence.refs),
    evidenceLimitations: reference?.evidence.limitations ?? ''
  };
}

function payloadFromForm(form: DraftFormState, kind: 'method' | 'reference'): CreativeCardPayload {
  if (kind === 'method') {
    return {
      assetKind: 'method',
      name: form.name, shortPhrase: form.shortPhrase, summary: form.summary, aliases: parseArrayText(form.aliases),
      method: {
        title: form.methodTitle, instruction: form.methodInstruction, boundary: form.methodBoundary,
        usageTree: form.methodUsageTree, applicableLayers: parseArrayText(form.methodLayers), aliases: parseArrayText(form.methodAliases)
      }
    };
  }
  return {
    assetKind: 'reference',
    name: form.name, shortPhrase: form.shortPhrase, summary: form.summary, aliases: parseArrayText(form.aliases),
    reference: {
      kind: form.referenceKind,
      facets: {
        genres: parseArrayText(form.refGenres), mechanisms: parseArrayText(form.refMechanisms),
        experiences: parseArrayText(form.refExperiences), purposes: parseArrayText(form.refPurposes)
      },
      stages: parseArrayText(form.refStages), useWhen: parseArrayText(form.refUseWhen),
      questions: form.refQuestions.split(/[；;]/).map((item) => item.trim()).filter((item) => item.length > 0),
      possibilities: form.refPossibilities.split(/[；;]/).map((item) => item.trim()).filter((item) => item.length > 0),
      imbalanceChecks: form.refImbalanceChecks.split(/[；;]/).map((item) => item.trim()).filter((item) => item.length > 0),
      examples: form.refExamples.filter((example) => example.premise.trim().length > 0),
      relatedCards: [],
      methodRefs: parseArrayText(form.refMethodRefs),
      evidence: { kind: form.evidenceKind as CreativeReferenceContent['evidence']['kind'], refs: parseArrayText(form.evidenceRefs), limitations: form.evidenceLimitations }
    }
  };
}

function DraftEditor({ internalId, basePayload, expectedRevision, onCancel, onSaved }: {
  internalId: string;
  basePayload: CreativeCardPayload;
  expectedRevision: number;
  onCancel: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const kind = basePayload.assetKind;
  const [form, setForm] = useState<DraftFormState>(() => formFromPayload(basePayload));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ serverPayload: CreativeCardPayload } | null>(null);
  const dirty = useMemo(() => JSON.stringify(formFromPayload(basePayload)) !== JSON.stringify(form), [form, basePayload]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent): void => { event.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const save = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setConflict(null);
    try {
      await saveCreativeCardRevision(internalId, { payload: payloadFromForm(form, kind), expectedRevision });
      onSaved();
    } catch (reason) {
      // 保存失败/版本冲突：保留本地输入，读取服务端最新内容供对比；禁止自动覆盖重试。
      setError(reason instanceof Error ? reason.message : '保存失败。');
      try {
        const latest = await fetchCreativeCardDetail(internalId);
        if (latest.revision !== null) setConflict({ serverPayload: latest.revision.payload });
      } catch { /* 对比读取失败不影响错误提示 */ }
    } finally {
      setBusy(false);
    }
  };

  const update = (patch: Partial<DraftFormState>): void => setForm((current) => ({ ...current, ...patch }));

  return <section className="crl-editor" aria-label="编辑草稿">
    <h2>编辑并保存新草稿（基于第{expectedRevision}版）</h2>
    {dirty && <p className="crl-hint">有未保存修改；离开页面前会提示一次。</p>}
    <div className="crl-form-grid">
      <label><span>名称</span><input aria-label="名称" value={form.name} onChange={(event) => update({ name: event.target.value })} /></label>
      <label><span>短语（4—12字，最多30字符）</span><input aria-label="短语" value={form.shortPhrase} onChange={(event) => update({ shortPhrase: event.target.value })} /></label>
      <label className="crl-span2"><span>一句说明</span><textarea aria-label="一句说明" rows={2} value={form.summary} onChange={(event) => update({ summary: event.target.value })} /></label>
      <label className="crl-span2"><span>别名（逗号分隔）</span><input aria-label="别名" value={form.aliases} onChange={(event) => update({ aliases: event.target.value })} /></label>
      {kind === 'method' && <>
        <label><span>方法标题</span><input aria-label="方法标题" value={form.methodTitle} onChange={(event) => update({ methodTitle: event.target.value })} /></label>
        <label><span>用途主类</span>
          <select aria-label="用途主类" value={form.methodUsageTree} onChange={(event) => update({ methodUsageTree: event.target.value })}>
            {CREATIVE_USAGE_TREES.map((tree) => <option key={tree} value={tree}>{tree}</option>)}
          </select>
        </label>
        <label className="crl-span2"><span>具体做法</span><textarea aria-label="具体做法" rows={3} value={form.methodInstruction} onChange={(event) => update({ methodInstruction: event.target.value })} /></label>
        <label className="crl-span2"><span>边界与限制</span><textarea aria-label="边界与限制" rows={2} value={form.methodBoundary} onChange={(event) => update({ methodBoundary: event.target.value })} /></label>
        <label className="crl-span2"><span>适用层级（逗号分隔：book_backbone/volume_distribution/volume/chain/chapter_execution）</span><input aria-label="适用层级" value={form.methodLayers} onChange={(event) => update({ methodLayers: event.target.value })} /></label>
        <label className="crl-span2"><span>方法别名（逗号分隔）</span><input aria-label="方法别名" value={form.methodAliases} onChange={(event) => update({ methodAliases: event.target.value })} /></label>
      </>}
      {kind === 'reference' && <>
        <label><span>参考类型</span><input aria-label="参考类型" value={form.referenceKind} onChange={(event) => update({ referenceKind: event.target.value })} /></label>
        <label><span>题材（逗号分隔）</span><input aria-label="题材" value={form.refGenres} onChange={(event) => update({ refGenres: event.target.value })} /></label>
        <label><span>机制（逗号分隔）</span><input aria-label="机制" value={form.refMechanisms} onChange={(event) => update({ refMechanisms: event.target.value })} /></label>
        <label><span>体验（逗号分隔）</span><input aria-label="体验" value={form.refExperiences} onChange={(event) => update({ refExperiences: event.target.value })} /></label>
        <label><span>用途标签（逗号分隔）</span><input aria-label="用途标签" value={form.refPurposes} onChange={(event) => update({ refPurposes: event.target.value })} /></label>
        <label><span>适用阶段（逗号分隔）</span><input aria-label="适用阶段" value={form.refStages} onChange={(event) => update({ refStages: event.target.value })} /></label>
        <label className="crl-span2"><span>适用条件（逗号分隔）</span><textarea aria-label="适用条件" rows={2} value={form.refUseWhen} onChange={(event) => update({ refUseWhen: event.target.value })} /></label>
        <details className="crl-advanced crl-span2"><summary>高级信息（关键问题/可选做法/失衡提醒/示例/依据）</summary>
          <label className="crl-span2"><span>关键问题（分号分隔）</span><textarea aria-label="关键问题" rows={2} value={form.refQuestions} onChange={(event) => update({ refQuestions: event.target.value })} /></label>
          <label className="crl-span2"><span>可选做法（分号分隔）</span><textarea aria-label="可选做法" rows={2} value={form.refPossibilities} onChange={(event) => update({ refPossibilities: event.target.value })} /></label>
          <label className="crl-span2"><span>失衡提醒（分号分隔）</span><textarea aria-label="失衡提醒" rows={2} value={form.refImbalanceChecks} onChange={(event) => update({ refImbalanceChecks: event.target.value })} /></label>
          <div className="crl-span2 crl-examples">
            <span>示例</span>
            {form.refExamples.map((example, index) => <div key={index} className="crl-example-row">
              <input aria-label={`示例${index + 1}前提`} placeholder="前提" value={example.premise} onChange={(event) => update({ refExamples: form.refExamples.map((item, i) => i === index ? { ...item, premise: event.target.value } : item) })} />
              <input aria-label={`示例${index + 1}方向`} placeholder="发展方向" value={example.direction} onChange={(event) => update({ refExamples: form.refExamples.map((item, i) => i === index ? { ...item, direction: event.target.value } : item) })} />
              <input aria-label={`示例${index + 1}边界`} placeholder="边界" value={example.boundary} onChange={(event) => update({ refExamples: form.refExamples.map((item, i) => i === index ? { ...item, boundary: event.target.value } : item) })} />
              <button type="button" aria-label={`删除示例${index + 1}`} onClick={() => update({ refExamples: form.refExamples.filter((_, i) => i !== index) })}><X /></button>
            </div>)}
            <button type="button" className="crl-add-example" onClick={() => update({ refExamples: [...form.refExamples, { premise: '', direction: '', boundary: '' }] })}>加一条示例</button>
          </div>
          <label><span>关联方法（逗号分隔编号）</span><input aria-label="关联方法" value={form.refMethodRefs} onChange={(event) => update({ refMethodRefs: event.target.value })} /></label>
          <label><span>依据类型</span>
            <select aria-label="依据类型" value={form.evidenceKind} onChange={(event) => update({ evidenceKind: event.target.value })}>
              <option value="editorial_heuristic">编辑假设</option>
              <option value="cited_research">引用研究</option>
              <option value="observed_evaluation">实测观察</option>
            </select>
          </label>
          <label><span>依据引用（逗号分隔）</span><input aria-label="依据引用" value={form.evidenceRefs} onChange={(event) => update({ evidenceRefs: event.target.value })} /></label>
          <label className="crl-span2"><span>局限说明</span><textarea aria-label="局限说明" rows={2} value={form.evidenceLimitations} onChange={(event) => update({ evidenceLimitations: event.target.value })} /></label>
        </details>
      </>}
    </div>
    {error !== null && <div className="crl-error" role="alert">
      <p>{error}</p>
      <p className="crl-hint">已保留你的全部输入；不会自动用服务器内容覆盖。</p>
    </div>}
    {conflict !== null && <div className="crl-compare-server">
      <h3>与服务器最新内容对比（字段级）</h3>
      <table className="crl-diff-table"><thead><tr><th>字段</th><th>我的输入</th><th>服务器最新</th></tr></thead><tbody>
        {diffPayload(payloadFromForm(form, kind), conflict.serverPayload).map((row) => <tr key={row.field}><td>{row.field}</td><td>{row.before}</td><td>{row.after}</td></tr>)}
      </tbody></table>
      <p className="crl-hint">刷新对比后仍可在上方继续编辑；重新保存会基于最新版本重试。</p>
    </div>}
    <div className="crl-editor-actions">
      <button type="button" className="crl-primary" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存为新草稿'}</button>
      <button type="button" disabled={busy} onClick={onCancel}>取消</button>
    </div>
  </section>;
}

/** 发布：基于打开预览时的active完整清单做增删改，预览后确认，幂等键防双击/超时重发。 */
function PublishPanel({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [phase, setPhase] = useState<'loading' | 'editing' | 'publishing' | 'done'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expectedActive, setExpectedActive] = useState<string | null>(null);
  const [baseEntries, setBaseEntries] = useState<Array<{ internalId: string; revision: number }>>([]);
  const [baseRelations, setBaseRelations] = useState<Array<{ fromId: string; fromRevision: number; toId: string; toRevision: number; relationType: string }>>([]);
  const [cards, setCards] = useState<CreativeCardSummary[]>([]);
  const [changes, setChanges] = useState<Record<string, { revision: number } | null>>({});
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [replayed, setReplayed] = useState(false);
  const idempotencyKey = useRef(newPlatformActionKey('creative-release'));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const releaseList = await fetchCreativeReleases();
        const activeId = releaseList.activeReleaseId;
        let entries: Array<{ internalId: string; revision: number }> = [];
        let relations: Array<{ fromId: string; fromRevision: number; toId: string; toRevision: number; relationType: string }> = [];
        if (activeId !== null) {
          const detail = await fetchCreativeReleaseDetail(activeId);
          entries = detail.release.entries;
          relations = detail.relations;
        }
        // 拉全库卡片（分页累积）作为选择基础；服务端筛选保证不全库进浏览器时也能逐页查看。
        const collected: CreativeCardSummary[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 50; page += 1) {
          const result = await fetchCreativeCards({ ...(cursor === null ? {} : { cursor }), limit: 100 });
          collected.push(...result.items);
          cursor = result.nextCursor;
          if (cursor === null) break;
        }
        if (cancelled) return;
        setExpectedActive(activeId);
        setBaseEntries(entries);
        setBaseRelations(relations);
        setCards(collected);
        setPhase('editing');
      } catch (reason) {
        if (!cancelled) setLoadError(reason instanceof Error ? reason.message : '发布基础信息读取失败。');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const baseMap = useMemo(() => new Map(baseEntries.map((entry) => [entry.internalId, entry.revision])), [baseEntries]);
  const plannedEntries = useMemo(() => {
    const result = new Map(baseMap);
    for (const [internalId, change] of Object.entries(changes)) {
      if (change === null) result.delete(internalId);
      else result.set(internalId, change.revision);
    }
    return result;
  }, [baseMap, changes]);
  const added: string[] = [];
  const replaced: Array<{ internalId: string; from: number; to: number }> = [];
  const removed: string[] = [];
  for (const [internalId, revision] of plannedEntries) {
    if (!baseMap.has(internalId)) added.push(internalId);
  }
  for (const [internalId, change] of Object.entries(changes)) {
    if (change === null) { if (baseMap.has(internalId)) removed.push(internalId); continue; }
    const baseRevision = baseMap.get(internalId);
    if (baseRevision !== undefined && baseRevision !== change.revision) replaced.push({ internalId, from: baseRevision, to: change.revision });
  }
  const kept = plannedEntries.size - added.length - replaced.length;
  const removedIds = new Set(removed);
  const droppedRelations = baseRelations.filter((relation) => removedIds.has(relation.fromId) || removedIds.has(relation.toId));
  const keptRelations = baseRelations.filter((relation) => !removedIds.has(relation.fromId) && !removedIds.has(relation.toId));

  const submit = async (): Promise<void> => {
    if (phase === 'publishing') return;
    setPhase('publishing');
    setPublishError(null);
    try {
      const result = await publishCreativeRelease({
        entries: [...plannedEntries.entries()].map(([internalId, revision]) => ({ internalId, revision })),
        relations: keptRelations.map((relation) => ({ ...relation, relationType: relation.relationType as 'supplement' })),
        expectedActiveReleaseId: expectedActive,
        idempotencyKey: idempotencyKey.current
      });
      setPublishedId(result.release.releaseId);
      setReplayed(result.replayed);
      setPhase('done');
    } catch (reason) {
      setPublishError(reason instanceof Error ? reason.message : '发布失败。');
      setPhase('editing');
    }
  };

  const cardById = useMemo(() => new Map(cards.map((card) => [card.internalId, card])), [cards]);

  if (phase === 'loading') return <div className="crl-page"><p className="crl-status" role="status">正在读取当前版本与全库清单…</p><button type="button" onClick={onBack}>返回</button></div>;
  if (loadError !== null) return <div className="crl-page"><div className="crl-error" role="alert"><p>{loadError}</p></div><button type="button" onClick={onBack}>返回列表</button></div>;
  if (phase === 'done') return <div className="crl-page crl-publish-done">
    <h1>{replayed ? '该发布请求已存在（幂等重放）' : '发布成功'}</h1>
    <p>新版本号：{publishedId}</p>
    <p className="crl-hint">“库已发布”表示可供后续接入读取；AI检索接入待后续批次。</p>
    <button type="button" onClick={onBack}>返回列表</button>
  </div>;

  return <div className="crl-page crl-publish">
    <button type="button" className="crl-back" onClick={onBack}>← 返回列表</button>
    <h1>发布整库版本</h1>
    <p className="crl-hint">
      基于打开时的完整清单（{baseEntries.length} 条）调整；未调整的条目与关系原样保留。当前基准：{expectedActive === null ? '初次发布（无活动版本）' : expectedActive}。
    </p>

    <section className="crl-section">
      <h2>清单调整</h2>
      <ul className="crl-publish-list">
        {cards.map((card) => {
          const baseRevision = baseMap.get(card.internalId);
          const planned = plannedEntries.get(card.internalId);
          const hasNewerReviewed = card.revisionStatus === 'reviewed' && card.currentRevision !== null && planned !== undefined && card.currentRevision > planned;
          return <li key={card.internalId} className={planned === undefined ? 'crl-removed' : ''}>
            <span className="crl-item-code">{card.displayCode} {card.shortPhrase}</span>
            <strong>{card.name}</strong>
            <small>
              {baseRevision === undefined ? '不在当前版本' : `当前第${baseRevision}版`}
              {planned !== undefined && planned !== baseRevision && ` → 本次第${planned}版`}
            </small>
            <div className="crl-publish-actions">
              {planned === undefined
                ? <button type="button" disabled={card.revisionStatus !== 'reviewed' || card.availability === 'retired'} title={card.revisionStatus !== 'reviewed' ? '只有已审核版本可以加入' : card.availability === 'retired' ? '退役卡不能进入新发布' : ''} onClick={() => setChanges({ ...changes, [card.internalId]: { revision: card.currentRevision ?? 1 } })}>加入第{card.currentRevision ?? '?'}版</button>
                : <>
                  {hasNewerReviewed && <button type="button" onClick={() => setChanges({ ...changes, [card.internalId]: { revision: card.currentRevision ?? 1 } })}>替换为第{card.currentRevision}版</button>}
                  <button type="button" className="crl-danger" onClick={() => setChanges({ ...changes, [card.internalId]: null })}>移除</button>
                  {changes[card.internalId] !== undefined && <button type="button" onClick={() => { const next = { ...changes }; delete next[card.internalId]; setChanges(next); }}>撤销调整</button>}
                </>}
            </div>
          </li>;
        })}
      </ul>
    </section>

    <section className="crl-section">
      <h2>发布预览（发送完整manifest）</h2>
      <dl className="crl-facts">
        <div><dt>总条目</dt><dd>{plannedEntries.size}</dd></div>
        <div><dt>新增</dt><dd>{added.length}</dd></div>
        <div><dt>替换</dt><dd>{replaced.length}</dd></div>
        <div><dt>移除</dt><dd>{removed.length}</dd></div>
        <div><dt>保留</dt><dd>{kept}</dd></div>
        <div><dt>关系</dt><dd>{keptRelations.length}{droppedRelations.length > 0 ? `（随移除条目去掉${droppedRelations.length}条）` : ''}</dd></div>
      </dl>
      {added.length > 0 && <p className="crl-hint">新增：{added.map((id) => cardById.get(id)?.displayCode ?? id).join('、')}</p>}
      {replaced.length > 0 && <p className="crl-hint">替换：{replaced.map((item) => `${cardById.get(item.internalId)?.displayCode ?? item.internalId} 第${item.from}→${item.to}版`).join('、')}</p>}
      {removed.length > 0 && <p className="crl-hint">移除：{removed.map((id) => cardById.get(id)?.displayCode ?? id).join('、')}</p>}
      {publishError !== null && <div className="crl-error" role="alert"><p>{publishError}</p><p className="crl-hint">编辑意图已保留；请刷新基准重新比较后再发布。</p></div>}
      <div className="crl-editor-actions">
        <button type="button" className="crl-primary" disabled={phase === 'publishing' || plannedEntries.size === 0} onClick={() => void submit()}>
          {phase === 'publishing' ? '发布中…' : `确认发布（${plannedEntries.size} 条）`}
        </button>
      </div>
      <p className="crl-hint">确认后发送完整清单；双击与超时重试由幂等键保护，同内容不会重复建版。</p>
    </section>
  </div>;
}

function ReleaseHistoryPanel({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [items, setItems] = useState<CreativeReleaseSummary[]>([]);
  const [activeReleaseId, setActiveReleaseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openDetail, setOpenDetail] = useState<Array<{ internalId: string; revision: number }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchCreativeReleases();
        if (cancelled) return;
        setItems(data.items);
        setActiveReleaseId(data.activeReleaseId);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '发布历史读取失败。');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const open = async (releaseId: string): Promise<void> => {
    if (openId === releaseId) { setOpenId(null); setOpenDetail(null); return; }
    setOpenId(releaseId);
    setOpenDetail(null);
    try {
      const detail = await fetchCreativeReleaseDetail(releaseId);
      setOpenDetail(detail.release.entries);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '版本详情读取失败。');
    }
  };

  return <div className="crl-page">
    <button type="button" className="crl-back" onClick={onBack}>← 返回列表</button>
    <h1>发布历史</h1>
    {loading && <p className="crl-status" role="status">正在读取发布历史…</p>}
    {error !== null && <div className="crl-error" role="alert"><p>{error}</p></div>}
    {!loading && error === null && items.length === 0 && <p className="crl-hint">还没有发布过整库版本。</p>}
    {items.length > 0 && <ul className="crl-release-list">
      {items.map((release) => <li key={release.releaseId}>
        <button type="button" onClick={() => void open(release.releaseId)}>
          <span>{release.createdAt}</span>
          <strong>{release.releaseId}</strong>
          <small>{release.entryCount} 条 · {release.relationCount} 关系 · {release.publishedBy}{release.active ? ' · 当前活动版本' : ''}{activeReleaseId === release.releaseId ? ' · 活动' : ''}</small>
        </button>
        {openId === release.releaseId && (openDetail === null
          ? <p className="crl-status" role="status">正在读取冻结清单…</p>
          : <details open><summary>冻结清单（{openDetail.length} 条，旧版本内容不变）</summary>
            <ul>{openDetail.map((entry) => <li key={entry.internalId}>{entry.internalId} · 第{entry.revision}版</li>)}</ul>
          </details>)}
      </li>)}
    </ul>}
  </div>;
}

function CreateCardPanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }): React.JSX.Element {
  const [kind, setKind] = useState<'method' | 'reference'>('method');
  const [form, setForm] = useState<DraftFormState>(() => formFromPayload({ assetKind: 'method', name: '', shortPhrase: '', summary: '', aliases: [], method: { title: '', instruction: '', usageTree: CREATIVE_USAGE_TREES[0], applicableLayers: [], aliases: [] } }));
  const [legacyNamespace, setLegacyNamespace] = useState('');
  const [legacyKey, setLegacyKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(newPlatformActionKey('creative-card'));
  const [created, setCreated] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createCreativeCard({
        payload: payloadFromForm(form, kind),
        legacy: legacyNamespace.trim().length > 0 && legacyKey.trim().length > 0 ? { namespace: legacyNamespace.trim(), key: legacyKey.trim() } : null,
        idempotencyKey: idempotencyKey.current
      });
      setCreated(result.card.displayCode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建失败。');
    } finally {
      setBusy(false);
    }
  };
  const update = (patch: Partial<DraftFormState>): void => setForm((current) => ({ ...current, ...patch }));
  const switchKind = (next: 'method' | 'reference'): void => {
    setKind(next);
    setForm((current) => ({ ...formFromPayload(payloadFromForm(current, next)) }));
  };

  return <section className="crl-editor" aria-label="新建卡">
    <h2>新建卡</h2>
    {created !== null ? <div className="crl-publish-done">
      <p>创建成功：{created}。编号由服务器分配，重复提交同一幂等键不会新建。</p>
      <button type="button" onClick={onCreated}>完成并刷新列表</button>
    </div> : <>
      <div className="crl-kind-tabs" role="tablist" aria-label="新卡类型">
        <button type="button" role="tab" aria-selected={kind === 'method'} onClick={() => switchKind('method')}>方法</button>
        <button type="button" role="tab" aria-selected={kind === 'reference'} onClick={() => switchKind('reference')}>创作参考</button>
      </div>
      <div className="crl-form-grid">
        <label><span>名称</span><input aria-label="名称" value={form.name} onChange={(event) => update({ name: event.target.value })} /></label>
        <label><span>短语</span><input aria-label="短语" value={form.shortPhrase} onChange={(event) => update({ shortPhrase: event.target.value })} /></label>
        <label className="crl-span2"><span>一句说明</span><textarea aria-label="一句说明" rows={2} value={form.summary} onChange={(event) => update({ summary: event.target.value })} /></label>
        {kind === 'method' ? <>
          <label><span>方法标题</span><input aria-label="方法标题" value={form.methodTitle} onChange={(event) => update({ methodTitle: event.target.value })} /></label>
          <label><span>用途主类</span>
            <select aria-label="用途主类" value={form.methodUsageTree} onChange={(event) => update({ methodUsageTree: event.target.value })}>
              {CREATIVE_USAGE_TREES.map((tree) => <option key={tree} value={tree}>{tree}</option>)}
            </select>
          </label>
          <label className="crl-span2"><span>具体做法</span><textarea aria-label="具体做法" rows={3} value={form.methodInstruction} onChange={(event) => update({ methodInstruction: event.target.value })} /></label>
          <label className="crl-span2"><span>适用层级（逗号分隔）</span><input aria-label="适用层级" value={form.methodLayers} onChange={(event) => update({ methodLayers: event.target.value })} /></label>
        </> : <>
          <label><span>参考类型</span><input aria-label="参考类型" value={form.referenceKind} onChange={(event) => update({ referenceKind: event.target.value })} /></label>
          <label><span>题材（逗号分隔）</span><input aria-label="题材" value={form.refGenres} onChange={(event) => update({ refGenres: event.target.value })} /></label>
          <label className="crl-span2"><span>适用条件（逗号分隔）</span><textarea aria-label="适用条件" rows={2} value={form.refUseWhen} onChange={(event) => update({ refUseWhen: event.target.value })} /></label>
          <label className="crl-span2"><span>局限说明</span><textarea aria-label="局限说明" rows={2} value={form.evidenceLimitations} onChange={(event) => update({ evidenceLimitations: event.target.value })} /></label>
        </>}
        <label><span>旧库命名空间（可选）</span><input aria-label="旧库命名空间" value={legacyNamespace} onChange={(event) => setLegacyNamespace(event.target.value)} /></label>
        <label><span>旧库key（可选）</span><input aria-label="旧库key" value={legacyKey} onChange={(event) => setLegacyKey(event.target.value)} /></label>
      </div>
      {error !== null && <div className="crl-error" role="alert"><p>{error}</p></div>}
      <div className="crl-editor-actions">
        <button type="button" className="crl-primary" disabled={busy} onClick={() => void submit()}>{busy ? '创建中…' : '创建（编号由服务器分配）'}</button>
        <button type="button" disabled={busy} onClick={onClose}>取消</button>
      </div>
    </>}
  </section>;
}
