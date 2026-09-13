/**
 * R209-B2 创作库管理页（返修版）：列表（服务端筛选+游标分页）→ 详情/草稿编辑/人工审核/退役恢复
 * → 完整清单发布（条目+关系显式编辑、悬空阻止）→ 发布历史（冻结分页）。
 * 只通过creative-reference-api访问真实接口；状态来自真实执行，失败保留输入不自动重试；
 * 脏表单在取消/返回/切页时保护输入，保存成功后不再提示。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { newPlatformActionKey } from './platform-api';
import {
  createCreativeCard, fetchCreativeCardDetail, fetchCreativeCards, fetchCreativeReleaseDetail,
  fetchCreativeReleaseEntries, fetchCreativeReleases, fetchCreativeRevisionSnapshot, fetchCreativeRevisions,
  publishCreativeRelease, reviewCreativeCard, saveCreativeCardRevision, setCreativeAvailability,
  type CreativeAvailability, type CreativeCardDetail, type CreativeCardPayload, type CreativeCardSummary,
  type CreativeReferenceContent, type CreativeReleaseSummary, type CreativeRelationInput
} from './creative-reference-api';
import './creative-reference-library.css';
import { CREATIVE_USAGE_NAV, usageParent } from './creative-usage-navigation';

export const CREATIVE_USAGE_TREES = [
  '题材与融合', '卖点与阅读体验', '人物与关系', '故事与因果', '结构与节奏', '信息与表达', '衔接与收束', '审查与修订'
] as const;

const METHOD_KIND_LABELS={technique:'叙事技法',story_container:'故事场合',action_strategy:'人物行动策略',story_beat:'剧情变化与结果',combination:'组合参考',checklist:'检查准则'};
const stageLabel=(key:string)=>CREATIVE_LAYER_OPTIONS.find(x=>x.key===key)?.label??key;

export const CREATIVE_LAYER_OPTIONS = [
  { key:'opening',label:'开书' }, { key:'setting',label:'设定' }, { key:'book',label:'时光机（全书与分卷）' },
  { key:'volume',label:'卷设计' }, { key:'chain',label:'链故事设计' }, { key:'chain_chapters',label:'链页面·链分章' }, { key:'chapter',label:'章纲' }, { key:'prose',label:'正文' }
] as const;

export const CREATIVE_AVAILABILITY_LABELS: Record<CreativeAvailability, string> = {
  draft: '草稿', reviewed: '已审核', published: '已发布', retired: '已退役'
};

export const CREATIVE_RELATION_TYPE_LABELS: Record<CreativeRelationInput['relationType'], string> = {
  supplement: '补充', fusion: '融合', synonym: '同义', replacement: '替代', related_method: '关联方法'
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

function UsageOptions():React.JSX.Element{return <>{CREATIVE_USAGE_NAV.map(group=><optgroup key={group.value} label={group.label}>
  <option value={group.value}>{group.label} · 通用</option>{group.children.map(child=><option key={child} value={child}>{child}</option>)}
</optgroup>)}</>;}
function StageChoices({value,onChange}:{value:string;onChange:(value:string)=>void}):React.JSX.Element{
 const selected=parseArrayText(value);
 return <fieldset className="crl-stage-choices crl-span2"><legend>重点使用阶段</legend>{CREATIVE_LAYER_OPTIONS.map(s=><button type="button" key={s.key} aria-pressed={selected.includes(s.key)} onClick={()=>onChange((selected.includes(s.key)?selected.filter(k=>k!==s.key):[...selected,s.key]).join('，'))}>{s.label}</button>)}</fieldset>;
}

/** 脏表单离开保护：取消/返回/切页统一走这里，提示一次；保存成功后调用方复位不再提示。 */
function useDirtyGuard(): { dirty: boolean; setDirty: (value: boolean) => void; confirmLeave: () => boolean } {
  const [dirty, setDirty] = useState(false);
  // 切页保护：AssetAdminApp导航派发cancelable事件，脏表单时阻止一次。
  useEffect(() => {
    if (!dirty) return;
    const block = (event: Event): void => { event.preventDefault(); };
    window.addEventListener('wenmi:admin-navigate', block);
    return () => window.removeEventListener('wenmi:admin-navigate', block);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent): void => { event.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const confirmLeave = useCallback((): boolean => (!dirty || window.confirm('有未保存的修改，确定离开？')), [dirty]);
  return { dirty, setDirty, confirmLeave };
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
        availabilities: effective.status.length > 0 ? [effective.status as CreativeAvailability] : ['draft','reviewed','published'],
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
        <p>按用途和阶段管理方法。已审核发布的版本供开书、设定、故事线与全书方向按需检索；草稿不进入成员上下文。</p>
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

    <nav className="crl-usage-nav" aria-label="按设计用途浏览">
      {CREATIVE_USAGE_NAV.map(group=><button key={group.value} type="button" aria-pressed={usageParent(effective.usageTree)===group.value}
        onClick={()=>applyFilters({...filters,usageTree:effective.usageTree===group.value?'':group.value})}>
        <strong>{group.label}</strong><span>{group.children.slice(0,3).join(' · ')}</span>
      </button>)}
    </nav>
    {usageParent(effective.usageTree) && <div className="crl-usage-children" role="group" aria-label="细分用途">
      {CREATIVE_USAGE_NAV.find(g=>g.value===usageParent(effective.usageTree))!.children.map(child=><button key={child} type="button" aria-pressed={effective.usageTree===child}
        onClick={()=>applyFilters({...filters,usageTree:child})}>{child}</button>)}
    </div>}

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
        {CREATIVE_USAGE_NAV.map((group) => <optgroup key={group.value} label={group.label}>
          <option value={group.value}>{group.label} · 全部</option>
          {group.children.map(child=><option key={child} value={child}>{child}</option>)}
        </optgroup>)}
      </select>
      <select aria-label="按适用层级筛选" value={filters.layer} onChange={(event) => applyFilters({ ...filters, layer: event.target.value })}>
        <option value="">全部重点阶段</option>
        {CREATIVE_LAYER_OPTIONS.map((layer) => <option key={layer.key} value={layer.key}>{layer.label}</option>)}
      </select>
      <select aria-label="按状态筛选" value={filters.status} onChange={(event) => applyFilters({ ...filters, status: event.target.value })}>
        <option value="">现有条目（不含已合并/退役）</option>
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
      ? <div className="crl-empty"><MagnifyingGlass aria-hidden="true" /><h2>没有符合条件的结果</h2><p>{effective.keyword ? '当前关键词与筛选组合没有匹配条目，可修改关键词或放宽筛选。' : '当前用途、重点阶段与状态组合没有匹配条目，不代表其他阶段或创作参考也没有内容。'}</p>{effective.layer && <button type="button" onClick={()=>applyFilters({...filters,layer:''})}>查看此用途的全部阶段</button>}{kind==='method' && <button type="button" onClick={()=>{setKind('reference');applyFilters({...filters,layer:''});}}>查看相关创作参考</button>}<button type="button" onClick={resetFilters}>重置筛选</button></div>
      : <div className="crl-empty"><h2>尚未录入</h2><p>当前没有可查看的条目。</p></div>)}

    {!loading && error === null && items.length > 0 && <>
      <ul className="crl-list" aria-label="创作库条目">
        {items.map((item) => <li key={item.internalId}>
          <button type="button" className="crl-item" onClick={() => setSelectedId(item.internalId)}>
            <span className="crl-item-code">{item.displayCode}{item.availability === 'retired' ? '（已合并或退役）' : ''}</span>
            <strong>{item.name}</strong>
            <span className="crl-item-summary">{item.summary}</span>
            <span className="crl-item-meta">
              {item.usageTree !== null && <i>{item.usageTree}</i>}
              {item.applicableLayers.length > 0 && <i>重点：{item.applicableLayers.map(stageLabel).join('、')}</i>}
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
  const { setDirty, confirmLeave } = useDirtyGuard();
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
    <button type="button" className="crl-back" onClick={() => { if (confirmLeave()) onBack(); }}>← 返回列表（保留筛选）</button>
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
      <AvailabilityControl internalId={internalId} availability={card.availability} seenRevision={card.currentRevision} onDone={reload} />
    </div>}

    {editing && payload !== null && <DraftEditor
      internalId={internalId}
      basePayload={payload}
      expectedRevision={card.currentRevision ?? 1}
      onDirtyChange={setDirty}
      onCancel={() => { if (confirmLeave()) setEditing(false); }}
      onSaved={() => { setDirty(false); setEditing(false); void reload(); }}
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

/** 读取具体版本快照（版本对比用）；读取失败返回null由上层提示。 */
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
        if (a === null || b === null) {
          setCompareError('版本快照读取失败，稍后可重试对比。');
          return;
        }
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
      result['method.relatedPurposes'] = (payload.method.relatedPurposes??[]).join('、');
      result['method.methodKind'] = payload.method.methodKind??'';
      result['method.conditionalUses'] = (payload.method.conditionalUses??[]).map(x=>`${stageLabel(x.stage)}：${x.condition} → ${x.use}`).join('\n');
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
        <div><dt>重点阶段</dt><dd>{payload.method.applicableLayers.map(stageLabel).join('、') || '—'}</dd></div>
        <div><dt>关联用途</dt><dd>{payload.method.relatedPurposes?.join('、')||'暂无其他关联'}</dd></div>
        <div><dt>内容类型</dt><dd>{payload.method.methodKind?METHOD_KIND_LABELS[payload.method.methodKind]:'待细分'}</dd></div>
      </>}
    </dl>
    {payload.method !== undefined && <section className="crl-section"><h2>做法与边界</h2>
      <p>{payload.method.instruction}</p>
      {(payload.method.conditionalUses?.length??0)>0 && <section><h3>其他阶段：满足条件时才使用</h3>{payload.method.conditionalUses!.map(item=><div key={item.stage} className="crl-section"><strong>{stageLabel(item.stage)}</strong><p>当{item.condition}时：</p><p>{item.use}</p></div>)}</section>}
      {payload.method.boundary !== undefined && payload.method.boundary.length > 0 && <div className="crl-method-guide">
        {payload.method.boundary.split('\n').filter(Boolean).map((line,index)=>{
          const split=line.indexOf('：');
          return split>0?<div key={index}><h3>{line.slice(0,split)}</h3><p>{line.slice(split+1)}</p></div>:<p key={index}>{line}</p>;
        })}
      </div>}
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

function AvailabilityControl({ internalId, availability, seenRevision, onDone }: { internalId: string; availability: CreativeAvailability; seenRevision: number | null; onDone: () => void }): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: 'retire' | 'restore'): Promise<void> => {
    if (busy || seenRevision === null) return;
    setBusy(true);
    setError(null);
    try {
      // 所见状态+版本必传：服务端在事务内原子校验，防并发覆盖。
      await setCreativeAvailability(internalId, {
        action, seenAvailability: availability, seenRevision,
        ...(reason.trim().length > 0 ? { reason: reason.trim() } : {})
      });
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
  methodRelated: string;
  methodKind: NonNullable<import('./creative-reference-api').CreativeMethodContent['methodKind']>;
  methodConditional: Array<{stage:string;condition:string;use:string}>;
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
    methodRelated: toArrayText(method?.relatedPurposes),
    methodKind: method?.methodKind??'technique',
    methodConditional: (method?.conditionalUses??[]).map(x=>({...x})),
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
        relatedPurposes:parseArrayText(form.methodRelated),methodKind:form.methodKind,conditionalUses:form.methodConditional,
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

function MethodMetadataEditor({form,update}:{form:DraftFormState;update:(patch:Partial<DraftFormState>)=>void}):React.JSX.Element{
 return <section className="crl-span2 crl-section">
  <label><span>关联用途（逗号分隔）</span><input aria-label="关联用途" value={form.methodRelated} onChange={e=>update({methodRelated:e.target.value})}/></label>
  <label><span>内容类型</span><select aria-label="内容类型" value={form.methodKind} onChange={e=>update({methodKind:e.target.value as DraftFormState['methodKind']})}>{Object.entries(METHOD_KIND_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  <h3>其他阶段的条件用法</h3>
  {form.methodConditional.map((item,i)=><div key={i} className="crl-section">
   <select aria-label={`条件阶段${i+1}`} value={item.stage} onChange={e=>update({methodConditional:form.methodConditional.map((x,j)=>j===i?{...x,stage:e.target.value}:x)})}>{CREATIVE_LAYER_OPTIONS.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}</select>
   <label><span>触发条件</span><textarea aria-label={`触发条件${i+1}`} rows={2} value={item.condition} onChange={e=>update({methodConditional:form.methodConditional.map((x,j)=>j===i?{...x,condition:e.target.value}:x)})}/></label>
   <label><span>这一阶段怎么用</span><textarea aria-label={`条件用法${i+1}`} rows={2} value={item.use} onChange={e=>update({methodConditional:form.methodConditional.map((x,j)=>j===i?{...x,use:e.target.value}:x)})}/></label>
   <button type="button" onClick={()=>update({methodConditional:form.methodConditional.filter((_,j)=>j!==i)})}>移除此条件用法</button>
  </div>)}
  <button type="button" disabled={!CREATIVE_LAYER_OPTIONS.some(s=>!parseArrayText(form.methodLayers).includes(s.key)&&!form.methodConditional.some(x=>x.stage===s.key))} onClick={()=>{const stage=CREATIVE_LAYER_OPTIONS.find(s=>!parseArrayText(form.methodLayers).includes(s.key)&&!form.methodConditional.some(x=>x.stage===s.key));if(stage)update({methodConditional:[...form.methodConditional,{stage:stage.key,condition:'',use:''}]});}}>添加条件用法</button>
 </section>;
}

function DraftEditor({ internalId, basePayload, expectedRevision, onDirtyChange, onCancel, onSaved }: {
  internalId: string;
  basePayload: CreativeCardPayload;
  expectedRevision: number;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const kind = basePayload.assetKind;
  const [form, setForm] = useState<DraftFormState>(() => formFromPayload(basePayload));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ serverPayload: CreativeCardPayload } | null>(null);
  const dirty = useMemo(() => JSON.stringify(formFromPayload(basePayload)) !== JSON.stringify(form), [form, basePayload]);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

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
    {dirty && <p className="crl-hint">有未保存修改；取消、返回或切换页面前会提示一次。</p>}
    <div className="crl-form-grid">
      <label><span>名称</span><input aria-label="名称" value={form.name} onChange={(event) => update({ name: event.target.value })} /></label>
      <label><span>短语（4—12字，最多30字符）</span><input aria-label="短语" value={form.shortPhrase} onChange={(event) => update({ shortPhrase: event.target.value })} /></label>
      <label className="crl-span2"><span>一句说明</span><textarea aria-label="一句说明" rows={2} value={form.summary} onChange={(event) => update({ summary: event.target.value })} /></label>
      <label className="crl-span2"><span>别名（逗号分隔）</span><input aria-label="别名" value={form.aliases} onChange={(event) => update({ aliases: event.target.value })} /></label>
      {kind === 'method' && <>
        <label><span>方法标题</span><input aria-label="方法标题" value={form.methodTitle} onChange={(event) => update({ methodTitle: event.target.value })} /></label>
        <label><span>用途主类</span>
          <select aria-label="用途主类" value={form.methodUsageTree} onChange={(event) => update({ methodUsageTree: event.target.value })}>
            <UsageOptions />
          </select>
        </label>
        <label className="crl-span2"><span>具体做法</span><textarea aria-label="具体做法" rows={3} value={form.methodInstruction} onChange={(event) => update({ methodInstruction: event.target.value })} /></label>
        <label className="crl-span2"><span>使用条件、边界与阶段用法（每行一项）</span><textarea aria-label="边界与限制" rows={7} value={form.methodBoundary} onChange={(event) => update({ methodBoundary: event.target.value })} /></label>
        <StageChoices value={form.methodLayers} onChange={value=>update({methodLayers:value})}/>
        <label className="crl-span2"><span>方法别名（逗号分隔）</span><input aria-label="方法别名" value={form.methodAliases} onChange={(event) => update({ methodAliases: event.target.value })} /></label>
        <MethodMetadataEditor form={form} update={update}/>
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

interface PublishRelation extends CreativeRelationInput {}

function relationSignature(relation: PublishRelation): string {
  return `${relation.fromId}@${relation.fromRevision}->${relation.toId}@${relation.toRevision}:${relation.relationType}`;
}

/**
 * 发布：基于打开预览时的active完整清单（固定releaseId遍历冻结分页，不逐页读活动指针）做条目与关系的
 * 显式调整（加入/替换/移除条目；增加/修改端点版本/移除关系），悬空或端点版本过期必须显式处理后才能确认。
 */
function PublishPanel({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [phase, setPhase] = useState<'loading' | 'editing' | 'publishing' | 'done'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expectedActive, setExpectedActive] = useState<string | null>(null);
  const [baseEntries, setBaseEntries] = useState<Array<{ internalId: string; revision: number }>>([]);
  const [baseRelations, setBaseRelations] = useState<PublishRelation[]>([]);
  const [cards, setCards] = useState<CreativeCardSummary[]>([]);
  const [changes, setChanges] = useState<Record<string, { revision: number } | null>>({});
  const [relations, setRelations] = useState<PublishRelation[]>([]);
  const [addFrom, setAddFrom] = useState('');
  const [addTo, setAddTo] = useState('');
  const [addType, setAddType] = useState<PublishRelation['relationType']>('supplement');
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
        let relationsList: PublishRelation[] = [];
        if (activeId !== null) {
          // 固定release遍历冻结分页拿完整清单；不逐页重读active指针。
          const detail = await fetchCreativeReleaseDetail(activeId);
          relationsList = detail.relations;
          let cursor: string | null = null;
          for (let page = 0; page < 200; page += 1) {
            const result = await fetchCreativeReleaseEntries(activeId, { limit: 100, ...(cursor === null ? {} : { cursor }) });
            entries.push(...result.items);
            cursor = result.nextCursor;
            if (cursor === null) break;
          }
        }
        // 拉全库卡片（分页累积）作为选择基础。
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
        setBaseRelations(relationsList);
        setRelations(relationsList);
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
  for (const [internalId] of plannedEntries) {
    if (!baseMap.has(internalId)) added.push(internalId);
  }
  for (const [internalId, change] of Object.entries(changes)) {
    if (change === null) { if (baseMap.has(internalId)) removed.push(internalId); continue; }
    const baseRevision = baseMap.get(internalId);
    if (baseRevision !== undefined && baseRevision !== change.revision) replaced.push({ internalId, from: baseRevision, to: change.revision });
  }
  const kept = plannedEntries.size - added.length - replaced.length;

  const plannedPairs = useMemo(() => new Set([...plannedEntries.entries()].map(([id, rev]) => `${id}@${rev}`)), [plannedEntries]);
  const baseRelationSigs = useMemo(() => new Set(baseRelations.map(relationSignature)), [baseRelations]);
  const relationSigs = useMemo(() => new Set(relations.map(relationSignature)), [relations]);
  // 悬空：端点(条目,版本)不在计划清单内（含移除条目残留的边、替换后端点版本过期）。
  const dangling = useMemo(() => relations.filter((rel) => !plannedPairs.has(`${rel.fromId}@${rel.fromRevision}`) || !plannedPairs.has(`${rel.toId}@${rel.toRevision}`)), [relations, plannedPairs]);
  const relationsAdded = relations.filter((rel) => !baseRelationSigs.has(relationSignature(rel)));
  const relationsRemoved = baseRelations.filter((rel) => !relationSigs.has(relationSignature(rel)));

  const cardById = useMemo(() => new Map(cards.map((card) => [card.internalId, card])), [cards]);
  const codeOf = (id: string): string => cardById.get(id)?.displayCode ?? id;

  const submit = async (): Promise<void> => {
    if (phase === 'publishing' || dangling.length > 0) return;
    setPhase('publishing');
    setPublishError(null);
    try {
      const result = await publishCreativeRelease({
        entries: [...plannedEntries.entries()].map(([internalId, revision]) => ({ internalId, revision })),
        relations,
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

  if (phase === 'loading') return <div className="crl-page"><p className="crl-status" role="status">正在读取当前版本与全库清单…</p><button type="button" onClick={onBack}>返回</button></div>;
  if (loadError !== null) return <div className="crl-page"><div className="crl-error" role="alert"><p>{loadError}</p></div><button type="button" onClick={onBack}>返回列表</button></div>;
  if (phase === 'done') return <div className="crl-page crl-publish-done">
    <h1>{replayed ? '该发布请求已存在（幂等重放）' : '发布成功'}</h1>
    <p>新版本号：{publishedId}</p>
    <p className="crl-hint">发布后用于新任务；进行中的任务继续使用启动时的版本。成员只读取选中的参考，作品事实以本书正式资料为准。</p>
    <button type="button" onClick={onBack}>返回列表</button>
  </div>;

  return <div className="crl-page crl-publish">
    <button type="button" className="crl-back" onClick={onBack}>← 返回列表</button>
    <h1>发布整库版本</h1>
    <p className="crl-hint">
      基于打开时的完整清单（{baseEntries.length} 条、{baseRelations.length} 关系）调整；未调整的条目与关系原样保留。当前基准：{expectedActive === null ? '初次发布（无活动版本）' : expectedActive}。
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
      <h2>关联关系（显式编辑，不自动删边）</h2>
      {relations.length === 0 && <p className="crl-hint">当前清单没有关系。</p>}
      <ul className="crl-relation-list">
        {relations.map((relation, index) => {
          const plannedFrom = plannedEntries.get(relation.fromId);
          const plannedTo = plannedEntries.get(relation.toId);
          const staleFrom = plannedFrom !== undefined && plannedFrom !== relation.fromRevision;
          const staleTo = plannedTo !== undefined && plannedTo !== relation.toRevision;
          const lostFrom = !plannedEntries.has(relation.fromId);
          const lostTo = !plannedEntries.has(relation.toId);
          return <li key={`${relationSignature(relation)}-${index}`}>
            <span className="crl-item-code">{codeOf(relation.fromId)}@{relation.fromRevision} → {codeOf(relation.toId)}@{relation.toRevision}</span>
            <select aria-label={`关系${index + 1}类型`} value={relation.relationType} onChange={(event) => setRelations(relations.map((item, i) => i === index ? { ...item, relationType: event.target.value as PublishRelation['relationType'] } : item))}>
              {Object.entries(CREATIVE_RELATION_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            {(lostFrom || lostTo) && <small className="crl-error-inline">端点条目已被移除：该关系悬空，必须移除该关系或恢复条目。</small>}
            {(!lostFrom && !lostTo && (staleFrom || staleTo)) && <small className="crl-error-inline">端点版本已变化（本次清单为 {codeOf(relation.fromId)}@{plannedFrom ?? '?'} / {codeOf(relation.toId)}@{plannedTo ?? '?'}）。</small>}
            <div className="crl-publish-actions">
              {(!lostFrom && !lostTo && (staleFrom || staleTo)) && <button type="button" onClick={() => setRelations(relations.map((item, i) => i === index ? { ...item, fromRevision: plannedFrom ?? item.fromRevision, toRevision: plannedTo ?? item.toRevision } : item))}>更新端点版本</button>}
              <button type="button" className="crl-danger" onClick={() => setRelations(relations.filter((_, i) => i !== index))}>移除该关系</button>
            </div>
          </li>;
        })}
      </ul>
      <div className="crl-relation-add">
        <select aria-label="新关系起点" value={addFrom} onChange={(event) => setAddFrom(event.target.value)}>
          <option value="">选择起点条目</option>
          {[...plannedEntries.entries()].map(([id, rev]) => <option key={id} value={id}>{codeOf(id)}@{rev}</option>)}
        </select>
        <select aria-label="新关系终点" value={addTo} onChange={(event) => setAddTo(event.target.value)}>
          <option value="">选择终点条目</option>
          {[...plannedEntries.entries()].map(([id, rev]) => <option key={id} value={id}>{codeOf(id)}@{rev}</option>)}
        </select>
        <select aria-label="新关系类型" value={addType} onChange={(event) => setAddType(event.target.value as PublishRelation['relationType'])}>
          {Object.entries(CREATIVE_RELATION_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <button type="button" disabled={addFrom === '' || addTo === '' || addFrom === addTo} onClick={() => {
          setRelations([...relations, { fromId: addFrom, fromRevision: plannedEntries.get(addFrom) ?? 1, toId: addTo, toRevision: plannedEntries.get(addTo) ?? 1, relationType: addType }]);
          setAddFrom(''); setAddTo('');
        }}>添加关联</button>
      </div>
      {dangling.length > 0 && <div className="crl-error" role="alert">
        <p>有{dangling.length}条关系端点不在本次清单内（悬空或版本过期）。移除被关联条目时必须显式处理这些关系；不会自动删边。</p>
        <p className="crl-hint">在上方列表逐条“更新端点版本”或“移除该关系”后才能确认发布。</p>
      </div>}
    </section>

    <section className="crl-section">
      <h2>发布预览（发送完整manifest）</h2>
      <dl className="crl-facts">
        <div><dt>总条目</dt><dd>{plannedEntries.size}</dd></div>
        <div><dt>新增</dt><dd>{added.length}</dd></div>
        <div><dt>替换</dt><dd>{replaced.length}</dd></div>
        <div><dt>移除</dt><dd>{removed.length}</dd></div>
        <div><dt>保留</dt><dd>{kept}</dd></div>
        <div><dt>关系（新增/移除）</dt><dd>{relationsAdded.length} / {relationsRemoved.length}（共{relations.length}条）</dd></div>
      </dl>
      {added.length > 0 && <p className="crl-hint">新增：{added.map((id) => codeOf(id)).join('、')}</p>}
      {replaced.length > 0 && <p className="crl-hint">替换：{replaced.map((item) => `${codeOf(item.internalId)} 第${item.from}→${item.to}版`).join('、')}</p>}
      {removed.length > 0 && <p className="crl-hint">移除：{removed.map((id) => codeOf(id)).join('、')}</p>}
      {relationsAdded.length > 0 && <p className="crl-hint">新增关系：{relationsAdded.map((rel) => `${codeOf(rel.fromId)}@${rel.fromRevision}→${codeOf(rel.toId)}@${rel.toRevision}（${CREATIVE_RELATION_TYPE_LABELS[rel.relationType]}）`).join('；')}</p>}
      {relationsRemoved.length > 0 && <p className="crl-hint">移除关系：{relationsRemoved.map((rel) => `${codeOf(rel.fromId)}@${rel.fromRevision}→${codeOf(rel.toId)}@${rel.toRevision}（${CREATIVE_RELATION_TYPE_LABELS[rel.relationType]}）`).join('；')}</p>}
      {publishError !== null && <div className="crl-error" role="alert"><p>{publishError}</p><p className="crl-hint">编辑意图已保留；请刷新基准重新比较后再发布。</p></div>}
      <div className="crl-editor-actions">
        <button type="button" className="crl-primary" disabled={phase === 'publishing' || plannedEntries.size === 0 || dangling.length > 0} onClick={() => void submit()}>
          {phase === 'publishing' ? '发布中…' : `确认发布（${plannedEntries.size} 条 · ${relations.length} 关系）`}
        </button>
      </div>
      <p className="crl-hint">确认后发送完整清单与关系；双击与超时重试由幂等键保护，同内容不会重复建版。</p>
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
      // 冻结清单分页遍历固定release。
      const collected: Array<{ internalId: string; revision: number }> = [];
      let cursor: string | null = null;
      for (let page = 0; page < 200; page += 1) {
        const result = await fetchCreativeReleaseEntries(releaseId, { limit: 100, ...(cursor === null ? {} : { cursor }) });
        collected.push(...result.items);
        cursor = result.nextCursor;
        if (cursor === null) break;
      }
      setOpenDetail(collected);
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
  const [touched, setTouched] = useState(false);
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
  const update = (patch: Partial<DraftFormState>): void => { setTouched(true); setForm((current) => ({ ...current, ...patch })); };
  const switchKind = (next: 'method' | 'reference'): void => {
    setKind(next);
    setForm((current) => ({ ...formFromPayload(payloadFromForm(current, next)) }));
  };
  const guardedClose = (): void => {
    if (!touched || window.confirm('有未保存的输入，确定放弃并关闭？')) onClose();
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
              <UsageOptions />
            </select>
          </label>
          <label className="crl-span2"><span>具体做法</span><textarea aria-label="具体做法" rows={3} value={form.methodInstruction} onChange={(event) => update({ methodInstruction: event.target.value })} /></label>
          <StageChoices value={form.methodLayers} onChange={value=>update({methodLayers:value})}/>
          <MethodMetadataEditor form={form} update={update}/>
        </> : <>
          <label><span>参考类型</span><input aria-label="参考类型" value={form.referenceKind} onChange={(event) => update({ referenceKind: event.target.value })} /></label>
          <label><span>题材（逗号分隔）</span><input aria-label="题材" value={form.refGenres} onChange={(event) => update({ refGenres: event.target.value })} /></label>
          <label className="crl-span2"><span>适用条件（逗号分隔）</span><textarea aria-label="适用条件" rows={2} value={form.refUseWhen} onChange={(event) => update({ refUseWhen: event.target.value })} /></label>
          <label className="crl-span2"><span>局限说明</span><textarea aria-label="局限说明" rows={2} value={form.evidenceLimitations} onChange={(event) => update({ evidenceLimitations: event.target.value })} /></label>
        </>}
        <label><span>旧库命名空间（可选）</span><input aria-label="旧库命名空间" value={legacyNamespace} onChange={(event) => { setTouched(true); setLegacyNamespace(event.target.value); }} /></label>
        <label><span>旧库key（可选）</span><input aria-label="旧库key" value={legacyKey} onChange={(event) => { setTouched(true); setLegacyKey(event.target.value); }} /></label>
      </div>
      {error !== null && <div className="crl-error" role="alert"><p>{error}</p></div>}
      <div className="crl-editor-actions">
        <button type="button" className="crl-primary" disabled={busy} onClick={() => void submit()}>{busy ? '创建中…' : '创建（编号由服务器分配）'}</button>
        <button type="button" disabled={busy} onClick={guardedClose}>取消</button>
      </div>
    </>}
  </section>;
}
