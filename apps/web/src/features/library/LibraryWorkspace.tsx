import { useCallback, useEffect, useState } from 'react';
import { DatabaseIcon, TreeStructureIcon, UserCircleIcon } from '@phosphor-icons/react';
import {
  appendProtagonistState,
  archiveProtagonistState,
  classifyProtagonistState,
  createLibraryTag,
  evaluateAttributeFormula,
  fetchAttributeFormulas,
  fetchProtagonists,
  saveProtagonistProfile,
  type AttributeFormulaData,
  type LibraryData,
  type ProtagonistDashboardData,
  type ProtagonistStateData
} from '../../lib/api/client';
import {
  authorFactRelationLabel,
  authorFormatScalar,
  authorRelationshipLabel
} from '../../app/author-presentation';
import { PROTAGONIST_ROLES } from '../onboarding/opening-options';
import { EmptyReference, RecordCollection, StructuredContent, authorityLabel, formatValue, isRecord } from '../shared/StructuredContent';

type LibraryTab = 'overview' | 'settings' | 'protagonist' | 'characters' | 'organizations' | 'locations' | 'items' | 'events' | 'rules' | 'tags' | 'gaps' | 'evidence';

export function LibraryWorkspace({ data, bookId }: { data: unknown; bookId: string | null }): React.JSX.Element {
  const [tab, setTab] = useState<LibraryTab>('overview');
  const library = isLibraryData(data) ? data : emptyLibraryData();
  const tabs: Array<[LibraryTab, string]> = [
    ['overview', '总览'], ['settings', '已确认设定'], ['protagonist', '主角'], ['characters', '角色'], ['organizations', '势力'], ['locations', '地点与地图'], ['items', '道具资源'], ['events', '事件时间线'],
    ['rules', '规则'], ['tags', '标签'], ['gaps', '待补内容'], ['evidence', '内容来源']
  ];
  const entityTypes: Partial<Record<LibraryTab, string[]>> = {
    characters: ['character'], organizations: ['organization'], locations: ['location'], items: ['item', 'resource', 'skill', 'stat_panel'],
    events: ['event'], rules: ['world_rule']
  };
  return (
    <section className="reference-view library-workspace" aria-labelledby="library-title">
      <header><h2 id="library-title">资料库</h2><p>正式内容版本 {library.canonRevision}</p></header>
      <nav className="secondary-tabs scrollable" aria-label="资料分类">{tabs.map(([key, label]) => <button type="button" className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>{label}</button>)}</nav>
      {tab === 'overview' && <LibraryOverview data={library} />}
      {tab === 'settings' && <ConfirmedSettingsLibrary data={library} />}
      {tab === 'protagonist' && <ProtagonistWorkspace bookId={bookId} initialDashboard={library.protagonists} initialFormulas={library.attributeFormulas} />}
      {entityTypes[tab] !== undefined && tab !== 'locations' && <EntityGrid
        entities={library.entities.filter((entity) => entityTypes[tab]!.includes(String(entity.entity_type)))}
        facts={library.facts}
        protagonists={library.protagonists}
      />}
      {tab === 'locations' && <LocationLibrary entities={library.entities.filter((entity) => entity.entity_type === 'location')} facts={library.facts} />}
      {tab === 'tags' && <TagCenter records={library.tags} bookId={bookId} />}
      {tab === 'gaps' && <RecordCollection records={library.gaps} empty="当前没有已登记的资料缺口。" />}
      {tab === 'evidence' && <EvidenceCenter facts={library.facts} />}
    </section>
  );
}

function LibraryOverview({ data }: { data: LibraryData }): React.JSX.Element {
  const metrics = [
    ['人物与事物', data.summary.entityCount], ['正式事实', data.summary.factCount], ['关系', data.summary.relationCount],
    ['标签', data.summary.tagCount], ['分析结果', data.summary.projectionCount], ['待补内容', data.summary.openGapCount]
  ];
  return <div className="library-overview"><div className="library-metrics">{metrics.map(([label, value]) => <div key={String(label)}><strong>{value}</strong><span>{label}</span></div>)}</div>{data.bookProfile !== null && <section className="book-profile-summary"><header><h3>{data.bookProfile.title}</h3><span>{data.bookProfile.source}</span></header><dl><div><dt>频道与分类</dt><dd>{data.bookProfile.channel} · {data.bookProfile.category}</dd></div><div><dt>题材</dt><dd>{data.bookProfile.subjects.join('、') || '尚未选择'}</dd></div><div><dt>主要标签</dt><dd>{[...data.bookProfile.mainTags, ...data.bookProfile.customTags].join('、') || '尚未选择'}</dd></div><div><dt>初始角色</dt><dd>{data.bookProfile.protagonists.map((item) => `${item.name}（${PROTAGONIST_ROLES.find((role) => role.id === item.role)?.label ?? '主角'}）`).join('、') || '尚未填写'}</dd></div><div><dt>必须遵守</dt><dd>{data.bookProfile.mustFollow.join('；') || '无额外限制'}</dd></div></dl></section>}<div className="library-explainer"><TreeStructureIcon /><div><h3>哪些内容算正式资料</h3><p>开书资料、已经确认的设定、定稿正文和事实算正式资料。人物关系、情绪和地图位置由系统整理；如果出现冲突，以原文和作者确认内容为准。</p></div></div></div>;
}

function ConfirmedSettingsLibrary({ data }: { data: LibraryData }): React.JSX.Element {
  if (data.settings.length === 0) return <EmptyReference icon={<DatabaseIcon />} title="还没有已确认设定" description="在设定中确认的内容会按板块收在这里；仍在讨论的内容不会当成正式资料。" />;
  const groups = new Map<string, typeof data.settings>();
  for (const item of data.settings) groups.set(item.groupTitle, [...(groups.get(item.groupTitle) ?? []), item]);
  return <div className="confirmed-settings-library">{[...groups.entries()].map(([groupTitle, items]) => <section key={groupTitle}><header><h3>{groupTitle}</h3><span>{items.length} 项已确认</span></header><div>{items.map((item) => <article key={item.itemKey}><h4>{item.label}</h4><p>{item.content}</p><small>{item.sourceLabel} · {item.confirmedAt === null ? '确认时间未记录' : new Date(item.confirmedAt).toLocaleString('zh-CN')}</small></article>)}</div></section>)}</div>;
}

const PROTAGONIST_CATEGORY_LABELS: Record<string, string> = {
  overview: '身份与状态', attribute: '属性面板', resource: '资源', equipment: '装备道具',
  skill: '技能能力', territory: '城池领地', general: '将领随从', army: '士兵军队',
  identity: '身份', governance: '治理与权力', debt: '债务与承诺', injury: '伤势',
  physical: '身体状态', physical_injury: '身体伤势', memory: '记忆与认知',
  unclassified: '待归类'
};

function ProtagonistWorkspace({ bookId, initialDashboard, initialFormulas }: {
  bookId: string | null; initialDashboard?: ProtagonistDashboardData | undefined; initialFormulas?: AttributeFormulaData[] | undefined;
}): React.JSX.Element {
  const [dashboard, setDashboard] = useState<ProtagonistDashboardData>(initialDashboard ?? { profiles: [] });
  const [formulas, setFormulas] = useState<AttributeFormulaData[]>(initialFormulas ?? []);
  const [selectedProfileId, setSelectedProfileId] = useState(initialDashboard?.profiles[0]?.profileId ?? '');
  const [profileName, setProfileName] = useState('');
  const [category, setCategory] = useState('');
  const [label, setLabel] = useState('');
  const [rawValue, setRawValue] = useState('');
  const [unit, setUnit] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [classificationDrafts, setClassificationDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (bookId === null) return;
    const [nextDashboard, nextFormulas] = await Promise.all([fetchProtagonists(bookId), fetchAttributeFormulas(bookId)]);
    setDashboard(nextDashboard); setFormulas(nextFormulas);
    setSelectedProfileId((current) => nextDashboard.profiles.some((profile) => profile.profileId === current) ? current : nextDashboard.profiles[0]?.profileId ?? '');
  }, [bookId]);
  useEffect(() => { void refresh().catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '主角面板加载失败')); }, [refresh]);
  const selected = dashboard.profiles.find((profile) => profile.profileId === selectedProfileId) ?? dashboard.profiles[0] ?? null;
  const selectedStates = selected === null ? [] : [...selected.current, ...selected.pending];
  const categories = [...new Set(selectedStates.map((item) => item.category))]
    .sort((left, right) => Number(isUnclassifiedCategory(right)) - Number(isUnclassifiedCategory(left)) || protagonistCategoryLabel(left).localeCompare(protagonistCategoryLabel(right), 'zh-CN'));
  const categorySuggestions = categories.filter((value) => !isUnclassifiedCategory(value));
  const addState = async (): Promise<void> => {
    if (bookId === null || selected === null || !category.trim() || !label.trim() || !rawValue.trim()) return;
    const categoryKey = resolveProtagonistCategoryKey(category);
    const numeric = Number(rawValue);
    const valueType: ProtagonistStateData['valueType'] = Number.isFinite(numeric) && rawValue.trim() !== '' ? 'number' : 'text';
    const value: unknown = valueType === 'number' ? numeric : rawValue.trim();
    const logicalKey = normalizeStateKey(`${categoryKey}_${label}`);
    setBusy(true); setNotice(null);
    try {
      await appendProtagonistState(bookId, selected.profileId, { category: categoryKey, logicalKey, label: label.trim(), valueType, value, unit: unit.trim() || null, confirmed });
      setLabel(''); setRawValue(''); setUnit(''); setConfirmed(false);
      await refresh();
      setNotice(confirmed ? '已经保存到当前主角资料中，以前的版本仍然保留。' : '已经保存，等你确认后才会成为正式人物资料。');
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '主角状态保存失败'); }
    finally { setBusy(false); }
  };
  const classifyState = async (item: ProtagonistStateData): Promise<void> => {
    const nextCategory = classificationDrafts[item.entryId]?.trim() ?? '';
    if (bookId === null || nextCategory.length === 0) return;
    setBusy(true); setNotice(null);
    try {
      const categoryKey = resolveProtagonistCategoryKey(nextCategory);
      await classifyProtagonistState(bookId, item.entryId, categoryKey);
      setClassificationDrafts((current) => { const next = { ...current }; delete next[item.entryId]; return next; });
      await refresh();
      setNotice(`已将“${item.label}”归入“${protagonistCategoryLabel(categoryKey)}”；原来的值、来源和历史版本都已保留。`);
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '资料归类失败'); }
    finally { setBusy(false); }
  };
  return <div className="protagonist-workspace">
    <section className="protagonist-toolbar"><div><h3>主角实时面板</h3><p>只展示当前状态；变化通过新版本记录，战死、消耗或移除不会抹掉历史证据。</p></div>
      {dashboard.profiles.length > 0 && <select aria-label="选择主角" value={selected?.profileId ?? ''} onChange={(event) => setSelectedProfileId(event.target.value)}>{dashboard.profiles.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.displayName}{profile.isPrimary ? '（主角）' : ''}</option>)}</select>}
    </section>
    {selected === null ? <form className="protagonist-create" onSubmit={(event) => {
      event.preventDefault(); if (bookId === null || !profileName.trim()) return; setBusy(true);
      void saveProtagonistProfile(bookId, { displayName: profileName.trim(), isPrimary: true }).then(async (profile) => { setSelectedProfileId(profile.profileId); setProfileName(''); await refresh(); }).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '主角档案创建失败')).finally(() => setBusy(false));
    }}><label>主角姓名<input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="例如：张三" /></label><button className="primary-button" disabled={busy || !profileName.trim()}>建立主角面板</button></form> : <>
      {categories.length === 0 ? <EmptyReference icon={<UserCircleIcon />} title="还没有主角资料" description="定稿章节产生明确主角事实后，小文秘书会自动整理到这里；也可以先手工补充作者已经确认的信息。" /> : <div className="protagonist-state-grid">{categories.map((key) => {
        const title = protagonistCategoryLabel(key);
        const records = selected.current.filter((item) => item.category === key);
        const pending = selected.pending.filter((item) => item.category === key);
        return <section key={key}><header><h4>{title}</h4><span>{records.length + pending.length}</span></header>{[...records, ...pending].map((item) => <article key={item.entryId}><div><strong>{item.label}</strong><small>{item.authorityLayer === 'candidate' ? '待确认' : item.authorityLayer === 'canon' ? '正式内容' : '计算结果'} · 版本 {item.revision}</small></div><span>{authorFormatScalar(item.value)}{item.unit ?? ''}</span><button type="button" title="从当前面板移除，历史仍保留" disabled={busy} onClick={() => {
          if (bookId === null) return; setBusy(true); void archiveProtagonistState(bookId, item.entryId).then(refresh).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '状态移除失败')).finally(() => setBusy(false));
        }}>移除</button>{isUnclassifiedCategory(item.category) && <form className="protagonist-classifier" onSubmit={(event) => { event.preventDefault(); void classifyState(item); }}><p>系统已记录这项资料，但不能可靠判断应该放在哪一类。可以询问主编建议，最终由作者确认。</p><label>确认分类<input aria-label={`为${item.label}确认分类`} value={classificationDrafts[item.entryId] ?? ''} onChange={(event) => setClassificationDrafts((current) => ({ ...current, [item.entryId]: event.target.value }))} placeholder="例如：契约伙伴" /></label><button className="secondary-button" disabled={busy || !(classificationDrafts[item.entryId]?.trim())}>确认分类</button></form>}</article>)}</section>;
      })}</div>}
      <form className="protagonist-state-form" onSubmit={(event) => { event.preventDefault(); void addState(); }}><header><h4>补充或纠正一项资料</h4><p>分类由这本书自己的内容决定，不套固定模板；同名资料会保存为新版本，原来的值和来源仍可查看。</p></header><div><label>分类<input list="protagonist-category-suggestions" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="例如：合同伙伴、城池等级" /><datalist id="protagonist-category-suggestions">{categorySuggestions.map((value) => <option key={value} value={protagonistCategoryLabel(value)} />)}</datalist></label><label>名称<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：步兵数量" /></label><label>当前值<input value={rawValue} onChange={(event) => setRawValue(event.target.value)} placeholder="例如：1200 或 城主" /></label><label>单位<input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="例如：人、级" /></label></div><label className="protagonist-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />这是作者已经确认的信息</label><button className="primary-button" disabled={busy || !category.trim() || !label.trim() || !rawValue.trim()}>保存状态</button></form>
    </>}
    {formulas.length > 0 && <FormulaCalculator bookId={bookId} formulas={formulas} />}
    {notice !== null && <p className="binding-status" role="status">{notice}</p>}
  </div>;
}

function FormulaCalculator({ bookId, formulas }: { bookId: string | null; formulas: AttributeFormulaData[] }): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, string>>({});
  return <section className="formula-calculator"><header><h3>属性试算</h3><p>这里只计算数值，不会自动把结果当成正式内容。</p></header>{formulas.map((formula) => <form key={formula.formulaId} onSubmit={(event) => {
    event.preventDefault(); if (bookId === null) return;
    const payload: Record<string, number> = {};
    for (const variable of formula.variables) payload[variable.key] = Number(values[`${formula.formulaId}:${variable.key}`] ?? variable.defaultValue ?? '');
    void evaluateAttributeFormula(bookId, formula.formulaId, payload).then((result) => setResults((current) => ({ ...current, [formula.formulaId]: `${result.result}${formula.unit ?? ''}` }))).catch((reason: unknown) => setResults((current) => ({ ...current, [formula.formulaId]: reason instanceof Error ? reason.message : '计算失败' })));
  }}><strong>{formula.label}</strong><code>{formula.expression}</code><div>{formula.variables.map((variable) => <label key={variable.key}>{variable.label}<input type="number" step="any" value={values[`${formula.formulaId}:${variable.key}`] ?? String(variable.defaultValue ?? '')} onChange={(event) => setValues((current) => ({ ...current, [`${formula.formulaId}:${variable.key}`]: event.target.value }))} /></label>)}</div><button className="secondary-button">计算</button>{results[formula.formulaId] !== undefined && <output>{results[formula.formulaId]}</output>}</form>)}</section>;
}

function EntityGrid({ entities, facts, protagonists }: {
  entities: Array<Record<string, unknown>>;
  facts: Array<Record<string, unknown>>;
  protagonists?: ProtagonistDashboardData | undefined;
}): React.JSX.Element {
  if (entities.length === 0) return <EmptyReference icon={<DatabaseIcon />} title="此分类尚无资料" description="可直接告诉主编需要增加的人物、势力、地点、规则或道具标签。" />;
  return <div className="entity-grid">{entities.slice(0, 300).map((entity) => {
    const entityId = String(entity.entity_id);
    const name = String(entity.canonical_name);
    const entityFacts = uniqueEntityFacts(facts.filter((fact) => String(fact.subject_entity_id) === entityId));
    const protagonist = protagonists?.profiles.find((profile) => profile.entityId === entityId || profile.displayName === name);
    const states = protagonist === undefined ? [] : uniqueProtagonistStates([...protagonist.current, ...protagonist.pending], entityFacts);
    const aliases = Array.isArray(entity.aliases) ? entity.aliases : [];
    return <article key={entityId}><header><span>{entityTypeLabel(String(entity.entity_type))}</span><em>{authorityLabel(String(entity.status))}</em></header><h3>{name}</h3>{aliases.length > 0 && <p>别名：{arrayText(aliases, '')}</p>}{entityFacts.length === 0 && states.length === 0 ? <p className="entity-empty-detail">还没有已经确认的详细资料，系统不会用猜测补齐。</p> : <div className="entity-detail-list">{entityFacts.slice(0, 12).map((fact) => <div key={String(fact.fact_id)}><dt>{authorFactRelationLabel(fact.relation_key)}</dt><dd><AuthorValue value={fact.value} /></dd><small>{factSourceLabel(fact)}</small></div>)}{states.slice(0, 8).map((state) => <div key={state.entryId}><dt>{state.label}</dt><dd>{authorFormatScalar(state.value)}{state.unit ?? ''}</dd><small>{state.authorityLayer === 'canon' ? '主角正式状态' : state.authorityLayer === 'candidate' ? '主角待确认状态' : '主角计算结果'} · 版本 {state.revision}</small></div>)}</div>}{entityFacts.length > 12 && <details><summary>查看其余 {entityFacts.length - 12} 条事实</summary><div className="entity-detail-list">{entityFacts.slice(12).map((fact) => <div key={String(fact.fact_id)}><dt>{authorFactRelationLabel(fact.relation_key)}</dt><dd><AuthorValue value={fact.value} /></dd><small>{factSourceLabel(fact)}</small></div>)}</div></details>}</article>;
  })}</div>;
}

function AuthorValue({ value }: { value: unknown }): React.JSX.Element {
  return isRecord(value) || Array.isArray(value)
    ? <StructuredContent value={value} />
    : <>{authorFormatScalar(value)}</>;
}

function uniqueEntityFacts(facts: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const signature = `${String(fact.relation_key)}\u0000${JSON.stringify(fact.value)}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function uniqueProtagonistStates(states: ProtagonistStateData[], facts: Array<Record<string, unknown>>): ProtagonistStateData[] {
  const seen = new Set(facts.map((fact) => `${authorFactRelationLabel(fact.relation_key)}\u0000${JSON.stringify(fact.value)}`));
  return states.filter((state) => {
    const signature = `${state.label}\u0000${JSON.stringify(state.value)}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function factSourceLabel(fact: Record<string, unknown>): string {
  const chapterNumber = Number(fact.source_chapter_number);
  const chapter = Number.isInteger(chapterNumber) && chapterNumber > 0 ? `第 ${chapterNumber} 章` : '已确认资料';
  const grade = typeof fact.grade === 'string' && fact.grade.length > 0 ? `${fact.grade}级证据` : '来源已记录';
  const chapterTitle = typeof fact.source_chapter_title === 'string' && fact.source_chapter_title.trim().length > 0
    ? ` ·《${fact.source_chapter_title.trim()}》`
    : '';
  return `${chapter} · ${grade} · ${authorityLabel(String(fact.status))}${chapterTitle}`;
}

function EvidenceCenter({ facts }: { facts: Array<Record<string, unknown>> }): React.JSX.Element {
  const groups = new Map<string, { title: string; facts: Array<Record<string, unknown>> }>();
  for (const fact of facts) {
    const title = typeof fact.canonical_name === 'string' && fact.canonical_name.trim().length > 0
      ? fact.canonical_name.trim()
      : '未归属资料';
    const key = `${String(fact.subject_entity_id ?? '')}\u0000${title}`;
    const current = groups.get(key) ?? { title, facts: [] };
    current.facts.push(fact);
    groups.set(key, current);
  }
  const visibleGroups = [...groups.entries()]
    .map(([key, group]) => ({ ...group, key, facts: uniqueEntityFacts(group.facts).sort(compareEvidenceFacts) }))
    .filter((group) => group.facts.length > 0)
    .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
  return <section className="evidence-center" aria-labelledby="evidence-center-title">
    <header><div><h3 id="evidence-center-title">内容来自哪里</h3><p>这里按人物和事物归类，只显示已经确认的事实，以及它来自哪一章。内部字段、原始 JSON 和重复记录不会显示。</p></div><span>{visibleGroups.reduce((total, group) => total + group.facts.length, 0)} 条有来源的事实</span></header>
    {visibleGroups.length === 0
      ? <EmptyReference icon={<DatabaseIcon />} title="还没有可展示的来源" description="正文定稿或资料经作者确认后，这里会显示相关事实来自哪里。" />
      : <div className="evidence-groups">{visibleGroups.map((group) => <article key={group.key}>
        <header><h4>{group.title}</h4><span>{group.facts.length} 条</span></header>
        <dl>{group.facts.map((fact) => {
          const excerpts = authorEvidenceExcerpts(fact.evidence);
          return <div key={String(fact.fact_id ?? `${fact.relation_key}-${JSON.stringify(fact.value)}`)}>
            <dt>{authorFactRelationLabel(fact.relation_key)}</dt>
            <dd><AuthorValue value={fact.value} /></dd>
            <small>{factSourceLabel(fact)}</small>
            {excerpts.length > 0 && <details><summary>查看依据</summary>{excerpts.map((excerpt) => <p key={excerpt}>{excerpt}</p>)}</details>}
          </div>;
        })}</dl>
      </article>)}</div>}
  </section>;
}

function compareEvidenceFacts(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const leftChapter = Number(left.source_chapter_number ?? Number.MAX_SAFE_INTEGER);
  const rightChapter = Number(right.source_chapter_number ?? Number.MAX_SAFE_INTEGER);
  if (leftChapter !== rightChapter) return leftChapter - rightChapter;
  return authorFactRelationLabel(left.relation_key).localeCompare(authorFactRelationLabel(right.relation_key), 'zh-CN');
}

function authorEvidenceExcerpts(value: unknown): string[] {
  const excerpts: string[] = [];
  const add = (candidate: unknown): void => {
    if (typeof candidate !== 'string') return;
    const text = candidate.replace(/\s+/gu, ' ').trim();
    if (text.length < 4 || /^[a-z0-9_.:/-]+$/iu.test(text) || excerpts.includes(text)) return;
    excerpts.push(text.slice(0, 260));
  };
  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'string' && /^[\[{]/u.test(candidate.trim())) {
      try {
        visit(JSON.parse(candidate));
      } catch {
        // Raw serialized payloads are internal evidence, not author-facing copy.
      }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate.slice(0, 10)) visit(item);
      return;
    }
    if (!isRecord(candidate)) {
      add(candidate);
      return;
    }
    for (const key of ['excerpt', 'quote', 'text', 'summary', 'sentence']) add(candidate[key]);
  };
  visit(value);
  return excerpts.slice(0, 3);
}

function TagCenter({ records, bookId }: { records: Array<Record<string, unknown>>; bookId: string | null }): React.JSX.Element {
  const [local, setLocal] = useState<Array<Record<string, unknown>>>([]);
  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('story');
  const [description, setDescription] = useState('');
  const [target, setTarget] = useState('character');
  const [notice, setNotice] = useState<string | null>(null);
  const all = [...records, ...local];
  return <div className="tag-center"><form onSubmit={(event) => {
    event.preventDefault();
    if (bookId === null || !name.trim()) return;
    void createLibraryTag(bookId, { namespace: namespace.trim(), name: name.trim(), description: description.trim(), appliesTo: [target] }).then((created) => {
      setLocal((current) => [...current, { tag_definition_id: created.tagId, namespace, name, description, created_source: 'boss', status: created.status, assignment_count: 0 }]);
      setNotice(`标签“${name.trim()}”已创建，只更新结构化元数据，不会重写正文或全量重嵌入。`); setName(''); setDescription('');
    }).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '标签创建失败'));
  }}><header><h3>新增资料标签</h3><p>普通标签不会改变已经发生的故事；如果会改变正式内容，仍需你确认。</p></header><div><label>标签分类<input value={namespace} onChange={(event) => setNamespace(event.target.value)} /></label><label>标签名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>适用对象<select value={target} onChange={(event) => setTarget(event.target.value)}><option value="character">人物</option><option value="location">地点</option><option value="organization">势力</option><option value="item">道具</option><option value="event">事件</option><option value="world_rule">规则</option><option value="chapter">章节</option></select></label></div><label>说明<input value={description} onChange={(event) => setDescription(event.target.value)} /></label><button className="primary-button" type="submit" disabled={bookId === null || !name.trim()}>创建标签</button></form>{notice !== null && <p className="binding-status" role="status">{notice}</p>}<RecordCollection records={all} empty="还没有资料标签。可在这里创建，也可直接告诉主编需要增加的标签。" /></div>;
}

export function KnowledgeGraph({ records }: { records: Array<Record<string, unknown>> }): React.JSX.Element {
  if (records.length === 0) return <EmptyReference icon={<TreeStructureIcon />} title="尚无人物关系" description="确认人物之间的关系后会在这里简洁显示；没有依据时不会猜测或补造。" />;
  const edges = records.slice(0, 500).map((record) => ({ from: String(record.from_name ?? '未知'), relation: authorRelationshipLabel(record.relation_key), to: graphTarget(record.toValue) }));
  return <div className="knowledge-graph" role="list" aria-label={`人物关系，共${edges.length}条`}>
    {edges.slice(0, 100).map((edge, index) => <p role="listitem" key={`${edge.from}-${edge.relation}-${edge.to}-${index}`}>{`${edge.from} → ${edge.to}（${edge.relation}）`}</p>)}
  </div>;
}

function LocationLibrary({ entities, facts }: { entities: Array<Record<string, unknown>>; facts: Array<Record<string, unknown>> }): React.JSX.Element {
  const points = facts.flatMap((fact) => {
    const value = isRecord(fact.value) ? fact.value : null;
    const relation = String(fact.relation_key ?? '');
    if (value === null || !/(coordinate|position|map|坐标|位置)/iu.test(relation) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return [];
    return [{ name: String(fact.canonical_name ?? '地点'), x: clampPercent(Number(value.x)), y: clampPercent(Number(value.y)), source: String(fact.fact_id ?? '') }];
  });
  return <div className="location-library">{points.length > 0 ? <div className="author-map" role="img" aria-label={`使用作者坐标的故事地图，共${points.length}个地点`}>{points.map((point) => <button type="button" key={`${point.name}-${point.source}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} title={`作者坐标 ${point.x}, ${point.y}`}>{point.name}</button>)}</div> : <p className="record-empty">尚无作者确认的地图坐标。系统不会用力导向布局冒充地理事实。</p>}<EntityGrid entities={entities} facts={facts} /></div>;
}

function entityTypeLabel(type: string): string {
  return ({ character: '角色', location: '地点', organization: '势力', item: '道具', resource: '资源', skill: '技能', stat_panel: '数值面板', world_rule: '规则', event: '事件', foreshadowing: '伏笔', hook: '钩子' } as Record<string, string>)[type] ?? type;
}

function arrayText(value: unknown, fallback: string): string {
  return Array.isArray(value) && value.length > 0 ? value.map(formatValue).join('、') : fallback;
}

function isLibraryData(value: unknown): value is LibraryData {
  return isRecord(value) && typeof value.canonRevision === 'number' && Array.isArray(value.entities) && Array.isArray(value.facts)
    && Array.isArray(value.relations) && Array.isArray(value.tags) && Array.isArray(value.projections) && Array.isArray(value.gaps)
    && Array.isArray(value.settings) && (value.bookProfile === null || isRecord(value.bookProfile)) && isRecord(value.summary);
}

function emptyLibraryData(): LibraryData {
  return { canonRevision: 0, entities: [], facts: [], relations: [], tags: [], projections: [], gaps: [], settings: [], bookProfile: null, summary: { entityCount: 0, factCount: 0, relationCount: 0, tagCount: 0, projectionCount: 0, openGapCount: 0 } };
}

function isUnclassifiedCategory(category: string): boolean {
  const normalized = category.trim().toLocaleLowerCase('zh-CN');
  return normalized === 'unclassified' || normalized === '待归类';
}

function protagonistCategoryLabel(category: string): string {
  if (isUnclassifiedCategory(category)) return '待归类';
  return PROTAGONIST_CATEGORY_LABELS[category] ?? (/\p{Script=Han}/u.test(category) ? category : '其他资料');
}

function resolveProtagonistCategoryKey(category: string): string {
  const normalized = category.trim();
  const legacy = Object.entries(PROTAGONIST_CATEGORY_LABELS).find(([, label]) => label === normalized)?.[0];
  return legacy ?? normalized;
}

function graphTarget(value: unknown): string {
  if (isRecord(value)) return String(value.name ?? value.canonicalName ?? value.entityId ?? Object.values(value)[0] ?? '未知');
  if (Array.isArray(value)) return value.map(formatValue).join('、') || '未知';
  return formatValue(value);
}

function clampPercent(value: number): number { return Math.max(3, Math.min(97, value)); }

function normalizeStateKey(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, '_').replace(/[^\p{L}\p{N}_-]/gu, '_').replace(/^([\p{N}-])/u, '_$1');
  return normalized.slice(0, 80) || '未命名';
}
