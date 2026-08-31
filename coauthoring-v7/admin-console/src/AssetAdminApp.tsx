import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, Bug, CaretRight, ChartLineUp, Crown, CurrencyCircleDollar, GitBranch, House, List,
  MagnifyingGlass, Robot, SignOut, TextT, TreeStructure, Users, X, ClipboardText
} from '@phosphor-icons/react';
import {
  ASSET_SUMMARY,
  CATEGORY_OPTIONS,
  DIMENSION_OPTIONS,
  GENRE_OPTIONS,
  KIND_LABELS,
  SCOPE_LABELS,
  TIER_LABELS,
  filterMethods,
  filterPatterns,
  filterRecipes,
  getCategoryLabel,
  getDimensionLabel,
  getGenreLabel,
  getNarrativeMethodName,
  getMethodExecutionProfile,
  getPlotPatternName,
  hasActiveFilters,
  PLANNING_DEMO,
  PLANNING_EXPERIENCE_CURVE,
  PLANNING_LAYERS,
  type AssetDetail,
  type AssetSection,
  type MethodFilters,
  type PatternFilters,
  type RecipeFilters
} from './asset-view-model';
import type { NarrativeScope } from '../../backend/narrative-methods/narrative-method-library.js';
import {
  PLANNING_AUDIT_FIELDS,
  type LayeredRecipeNode
} from '../../backend/planning-methods/layered-planning-engine.js';
import { PlatformPage, type PlatformSection } from './PlatformPages';
import { fetchV7PlanningRuntimeAudit, type AdminAccount, type V7PlanningRuntimeAudit } from './platform-api';
import { AgentGovernancePage } from './AgentGovernancePage';
import { CreationOperationsPage } from './CreationOperationsPage';
import { PromptContextCenter } from './PromptContextCenter';
import { FeatureCapabilitiesPage } from './FeatureCapabilitiesPage';

const NAVIGATION = [
  { key: 'overview', label: '资产总览', icon: House, group: '创作资产' },
  { key: 'methods', label: '叙事方法', icon: TextT, group: '创作资产' },
  { key: 'patterns', label: '剧情模式', icon: BookOpen, group: '创作资产' },
  { key: 'recipes', label: '剧情配方', icon: List, group: '创作资产' },
  { key: 'planning', label: '分层规划', icon: TreeStructure, group: '创作资产' },
  { key: 'agents', label: '创作成员', icon: Robot, group: '创作团队' },
  { key: 'prompt-context', label: '提示词与上下文', mobileLabel: '提示词', icon: TextT, group: '创作团队' },
  { key: 'creation-ops', label: '创作运行', icon: GitBranch, group: '创作团队' },
  { key: 'features', label: '功能台账', icon: ClipboardText, group: '平台运营' },
  { key: 'operations', label: '运营总览', icon: ChartLineUp, group: '平台运营' },
  { key: 'users', label: '用户与书籍', icon: Users, group: '平台运营' },
  { key: 'usage', label: '算力与成本', icon: CurrencyCircleDollar, group: '平台运营' },
  { key: 'issues', label: '问题记录', icon: Bug, group: '平台运营' },
  { key: 'memberships', label: '会员与收入', icon: Crown, group: '平台运营' }
] as const;

type AdminSection = AssetSection | PlatformSection | 'agents' | 'prompt-context' | 'creation-ops' | 'features';

const DEFAULT_METHOD_FILTERS: MethodFilters = { query: '', dimension: 'all', scope: 'all' };
const DEFAULT_PATTERN_FILTERS: PatternFilters = { query: '', category: 'all', genre: 'all' };
const DEFAULT_RECIPE_FILTERS: RecipeFilters = { query: '', genre: 'all' };

const STRONG_PLANNING_SEATS = [
  { member: '貂蝉', model: 'DeepSeek V4 Pro' },
  { member: '顾承砚', model: 'GLM 5.3' },
  { member: '沈知微', model: 'Kimi K3' }
] as const;

const CURRENT_PLANNING_FLOW = [
  '每个新任务先由资料策划 Agent 理解本层目标，从作者确认资料中挑选最小必要范围，并签发本任务临时题材身份和候选方法。',
  '时光机由三名强模型主编读取同一资料范围，各自完成一套全案路线、设计理由、受众定位和卷数安排。',
  '卷和链默认只请一名强模型成员设计；作者需要比较时才扩展到两套或三套，多方案时再由异模型主编独立点评。',
  '同一方法可以跨全书、卷和链重复使用，但成员必须按当前层责任重新解释，并把钩子、伏笔和回收责任交给下层。',
  '作者只需要选择或提出调整；选中方案形成正式版本，未选方案保留审计但不污染正史。'
] as const;

export function AssetAdminApp({ account, onSignOut }: { account: AdminAccount; onSignOut: () => Promise<void> }): React.JSX.Element {
  const [section, setSection] = useState<AdminSection>(() => sectionFromUrl());
  const [methodFilters, setMethodFilters] = useState<MethodFilters>(DEFAULT_METHOD_FILTERS);
  const [patternFilters, setPatternFilters] = useState<PatternFilters>(DEFAULT_PATTERN_FILTERS);
  const [recipeFilters, setRecipeFilters] = useState<RecipeFilters>(DEFAULT_RECIPE_FILTERS);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const mobileNavigationRef = useRef<HTMLElement | null>(null);
  const current = NAVIGATION.find((item) => item.key === section) ?? NAVIGATION[0];

  const methods = useMemo(() => filterMethods(methodFilters), [methodFilters]);
  const patterns = useMemo(() => filterPatterns(patternFilters), [patternFilters]);
  const recipes = useMemo(() => filterRecipes(recipeFilters), [recipeFilters]);

  const navigate = (next: AdminSection): void => {
    setSection(next);
    setDetail(null);
    const url = new URL(window.location.href);
    url.searchParams.set('section', next);
    window.history.replaceState({}, '', url);
  };

  const updateCurrentQuery = (query: string): void => {
    if (section === 'methods') setMethodFilters((currentValue) => ({ ...currentValue, query }));
    if (section === 'patterns') setPatternFilters((currentValue) => ({ ...currentValue, query }));
    if (section === 'recipes') setRecipeFilters((currentValue) => ({ ...currentValue, query }));
  };

  const currentQuery = section === 'methods' ? methodFilters.query : section === 'patterns' ? patternFilters.query : section === 'recipes' ? recipeFilters.query : '';
  const clearFilters = (): void => {
    if (section === 'methods') setMethodFilters(DEFAULT_METHOD_FILTERS);
    if (section === 'patterns') setPatternFilters(DEFAULT_PATTERN_FILTERS);
    if (section === 'recipes') setRecipeFilters(DEFAULT_RECIPE_FILTERS);
  };

  useEffect(() => {
    const currentButton = mobileNavigationRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    currentButton?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [section]);

  return <div className="asset-admin-app">
    <aside className="asset-sidebar" aria-label="V7 管理后台导航">
      <header><span className="asset-brand-mark">文</span><div><strong>V7 管理后台</strong><small>创作资产与平台运营</small></div></header>
      <nav>{NAVIGATION.map(({ key, label, icon: Icon, group }, index) => <Fragment key={key}>
        {(index === 0 || NAVIGATION[index - 1]?.group !== group) && <span className="asset-nav-group">{group}</span>}
        <button
          type="button"
          className={section === key ? 'active' : ''}
          aria-current={section === key ? 'page' : undefined}
          onClick={() => navigate(key)}
        ><Icon aria-hidden="true" /><span>{label}</span></button>
      </Fragment>)}</nav>
      <footer className="asset-account-footer"><div><span>{account.displayName.slice(0, 1).toUpperCase()}</span><p><strong>{account.displayName}</strong><small>平台管理员</small></p></div><div><button type="button" aria-label="退出 V7 管理后台" title="退出" onClick={() => void onSignOut()}><SignOut /></button></div></footer>
    </aside>

    <div className="asset-stage">
      <header className="asset-topbar">
        <div><small>V7 / {current.group}</small><h1>{current.label}</h1></div>
        {(section === 'methods' || section === 'patterns' || section === 'recipes') && <label className="asset-global-search">
          <MagnifyingGlass aria-hidden="true" />
          <span className="sr-only">搜索当前资产</span>
          <input value={currentQuery} onChange={(event) => updateCurrentQuery(event.target.value)} placeholder={`搜索${current.label}名称、说明或效果…`} />
        </label>}
        <span className="asset-readonly-badge">{sectionCapabilityLabel(section)}</span>
      </header>

      <main className="asset-content">
        {section === 'overview' && <OverviewPage onNavigate={(next) => navigate(next)} />}
        {section === 'methods' && <MethodsPage items={methods} filters={methodFilters} onFilters={setMethodFilters} onOpen={(value) => setDetail({ kind: 'method', value })} onClear={clearFilters} />}
        {section === 'patterns' && <PatternsPage items={patterns} filters={patternFilters} onFilters={setPatternFilters} onOpen={(value) => setDetail({ kind: 'pattern', value })} onClear={clearFilters} />}
        {section === 'recipes' && <RecipesPage items={recipes} filters={recipeFilters} onFilters={setRecipeFilters} onOpen={(value) => setDetail({ kind: 'recipe', value })} onClear={clearFilters} />}
        {section === 'planning' && <PlanningPage />}
        {section === 'agents' && <AgentGovernancePage />}
        {section === 'prompt-context' && <PromptContextCenter />}
        {section === 'creation-ops' && <CreationOperationsPage />}
        {section === 'features' && <FeatureCapabilitiesPage />}
        {isPlatformSection(section) && <PlatformPage section={section} currentAccountId={account.userId} />}
      </main>
    </div>

    <nav ref={mobileNavigationRef} className="asset-mobile-nav" aria-label="手机后台导航">
      {NAVIGATION.map((item) => <button key={item.key} type="button" className={section === item.key ? 'active' : ''} aria-current={section === item.key ? 'page' : undefined} onClick={() => navigate(item.key)}><item.icon aria-hidden="true" /><span>{'mobileLabel' in item ? item.mobileLabel : item.label.replace('资产', '')}</span></button>)}
    </nav>

    {detail !== null && <DetailDrawer detail={detail} onClose={() => setDetail(null)} />}
  </div>;
}

function OverviewPage({ onNavigate }: { onNavigate: (section: AssetSection) => void }): React.JSX.Element {
  const categoryTotal = Math.max(...Object.values(ASSET_SUMMARY.patterns.categoryCounts));
  return <div className="asset-page">
    <PageHeading title="V7 创作资产总览" description="这里集中查看创作时可调用的内部方法、剧情零件和跨单元配方。当前页面只读，不会修改任何生产任务。" />
    <section className="asset-metrics" aria-label="资产数量">
      <Metric label="叙事方法" value={ASSET_SUMMARY.methods.totalMethods} suffix="项" hint="决定怎样组织和讲" onClick={() => onNavigate('methods')} />
      <Metric label="剧情模式" value={ASSET_SUMMARY.patterns.totalPatterns} suffix="项" hint="决定这一段发生什么" onClick={() => onNavigate('patterns')} />
      <Metric label="剧情配方" value={ASSET_SUMMARY.recipes.totalRecipes} suffix="套" hint="把模式编成因果单元" onClick={() => onNavigate('recipes')} />
      <Metric label="规划层级" value={ASSET_SUMMARY.planning.totalLayers} suffix="层" hint="把方法编进全书到章节" onClick={() => onNavigate('planning')} />
      <Metric label="题材覆盖" value={GENRE_OPTIONS.length} suffix="类" hint="题材只影响推荐排序" />
    </section>

    <div className="asset-overview-grid">
      <section className="asset-panel">
        <header><div><h2>剧情模式构成</h2><p>六种职责共同组成一段完整剧情，不是把套路名随机拼在一起。</p></div><span>{ASSET_SUMMARY.patterns.totalPatterns} 项</span></header>
        <div className="asset-bar-list">
          {CATEGORY_OPTIONS.map((item) => {
            const count = ASSET_SUMMARY.patterns.categoryCounts[item.key];
            return <div key={item.key}><span>{item.label}</span><i><b style={{ width: `${Math.max(8, count / categoryTotal * 100)}%` }} /></i><strong>{count}</strong></div>;
          })}
        </div>
      </section>
      <section className="asset-panel asset-explain-panel">
        <header><div><h2>四层能力怎样配合</h2><p>老板看故事效果，创作成员按责任执行，后台保留可追溯引用。</p></div></header>
        <ol>
          <li><span>1</span><div><strong>叙事方法</strong><p>控制因果、节奏、信息和人物变化，回答“怎样写”。</p></div></li>
          <li><span>2</span><div><strong>剧情模式</strong><p>提供副本、调查、隐藏实力、资源压力、身份揭露等可组合零件。</p></div></li>
          <li><span>3</span><div><strong>剧情配方</strong><p>把零件组织为标准五阶段，也能根据复杂度编成三至七个单元。</p></div></li>
          <li><span>4</span><div><strong>分层规划器</strong><p>按全书、跨卷、单卷、单链和章节逐层编译，方法只做软参考。</p></div></li>
        </ol>
      </section>
    </div>

    <section className="asset-panel asset-dimensions-panel">
      <header><div><h2>16 个叙事维度</h2><p>每个维度承担一种明确责任，实际调用时只选当前任务需要的少量方法。</p></div><span>方法库 v{ASSET_SUMMARY.methods.version}</span></header>
      <div className="asset-dimension-grid">{DIMENSION_OPTIONS.map((item) => {
        const count = ASSET_SUMMARY.methods.dimensionCounts[item.key];
        return <button type="button" key={item.key} onClick={() => onNavigate('methods')}><strong>{item.label}</strong><span>{count} 项</span><CaretRight /></button>;
      })}</div>
    </section>
  </div>;
}

function MethodsPage({ items, filters, onFilters, onOpen, onClear }: {
  items: ReturnType<typeof filterMethods>;
  filters: MethodFilters;
  onFilters: (filters: MethodFilters) => void;
  onOpen: (item: ReturnType<typeof filterMethods>[number]) => void;
  onClear: () => void;
}): React.JSX.Element {
  return <div className="asset-page">
    <PageHeading title="叙事方法库" description="负责故事怎样组织、怎样给信息、怎样制造节奏和怎样兑现。专业名用于后台审计，大白话责任供创作成员使用。" count={`${items.length} / ${ASSET_SUMMARY.methods.totalMethods}`} />
    <div className="asset-filter-bar">
      <select aria-label="按叙事维度筛选" value={filters.dimension} onChange={(event) => onFilters({ ...filters, dimension: event.target.value as MethodFilters['dimension'] })}>
        <option value="all">全部叙事维度</option>{DIMENSION_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
      <select aria-label="按作用层级筛选" value={filters.scope} onChange={(event) => onFilters({ ...filters, scope: event.target.value as MethodFilters['scope'] })}>
        <option value="all">全部作用层级</option>{Object.entries(SCOPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      {hasActiveFilters('methods', filters, DEFAULT_PATTERN_FILTERS, DEFAULT_RECIPE_FILTERS) && <button className="asset-clear-button" type="button" onClick={onClear}>清空筛选</button>}
    </div>
    {items.length === 0 ? <EmptyState onClear={onClear} /> : <AssetTable headers={['方法', '维度', '主要位置', '类型', '适用提示', '']}>
      {items.map((item) => <tr key={item.key}>
        <td data-label="方法"><button className="asset-title-button" type="button" onClick={() => onOpen(item)}><strong>{item.professionalName}</strong><span>{item.publicExplanation}</span></button></td>
        <td data-label="维度"><Badge>{getDimensionLabel(item.dimension)}</Badge></td>
        <td data-label="主要位置">{SCOPE_LABELS[item.primaryScope]}</td>
        <td data-label="类型">{KIND_LABELS[item.kind]}</td>
        <td data-label="适用提示"><TagLine values={item.fitSignals.slice(0, 3)} /></td>
        <td data-label="查看"><button className="asset-row-action" type="button" onClick={() => onOpen(item)}>查看详情<CaretRight /></button></td>
      </tr>)}
    </AssetTable>}
  </div>;
}

function PatternsPage({ items, filters, onFilters, onOpen, onClear }: {
  items: ReturnType<typeof filterPatterns>;
  filters: PatternFilters;
  onFilters: (filters: PatternFilters) => void;
  onOpen: (item: ReturnType<typeof filterPatterns>[number]) => void;
  onClear: () => void;
}): React.JSX.Element {
  return <div className="asset-page">
    <PageHeading title="剧情模式库" description="每项都是可组合的剧情零件。题材只影响推荐，不限制历史文加入解谜、言情加入生存等跨类型用法。" count={`${items.length} / ${ASSET_SUMMARY.patterns.totalPatterns}`} />
    <div className="asset-filter-bar">
      <select aria-label="按剧情职责筛选" value={filters.category} onChange={(event) => onFilters({ ...filters, category: event.target.value as PatternFilters['category'] })}>
        <option value="all">全部剧情职责</option>{CATEGORY_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
      <select aria-label="按常见题材筛选" value={filters.genre} onChange={(event) => onFilters({ ...filters, genre: event.target.value as PatternFilters['genre'] })}>
        <option value="all">全部常见题材</option>{GENRE_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
      {hasActiveFilters('patterns', DEFAULT_METHOD_FILTERS, filters, DEFAULT_RECIPE_FILTERS) && <button className="asset-clear-button" type="button" onClick={onClear}>清空筛选</button>}
    </div>
    {items.length === 0 ? <EmptyState onClear={onClear} /> : <AssetTable headers={['剧情模式', '职责', '常见题材', '完成后必须改变', '']}>
      {items.map((item) => <tr key={item.key}>
        <td data-label="剧情模式"><button className="asset-title-button" type="button" onClick={() => onOpen(item)}><strong>{item.professionalName}</strong><span>{item.publicExplanation}</span></button></td>
        <td data-label="职责"><Badge>{getCategoryLabel(item.category)}</Badge></td>
        <td data-label="常见题材">{item.commonGenreFamilies.length === 0 ? <span className="asset-universal">跨题材通用</span> : <TagLine values={item.commonGenreFamilies.slice(0, 3).map(getGenreLabel)} />}</td>
        <td data-label="完成后必须改变"><span className="asset-result-copy">{item.irreversibleResult}</span></td>
        <td data-label="查看"><button className="asset-row-action" type="button" onClick={() => onOpen(item)}>查看详情<CaretRight /></button></td>
      </tr>)}
    </AssetTable>}
  </div>;
}

function RecipesPage({ items, filters, onFilters, onOpen, onClear }: {
  items: ReturnType<typeof filterRecipes>;
  filters: RecipeFilters;
  onFilters: (filters: RecipeFilters) => void;
  onOpen: (item: ReturnType<typeof filterRecipes>[number]) => void;
  onClear: () => void;
}): React.JSX.Element {
  return <div className="asset-page">
    <PageHeading title="剧情配方库" description="配方负责把剧情模式组织成前后承接的完整推进。标准展示五个阶段，实际规划可以根据内容缩成三段或扩成七段。" count={`${items.length} / ${ASSET_SUMMARY.recipes.totalRecipes}`} />
    <div className="asset-filter-bar two-columns">
      <select aria-label="按常见题材筛选" value={filters.genre} onChange={(event) => onFilters({ ...filters, genre: event.target.value as RecipeFilters['genre'] })}>
        <option value="all">全部常见题材</option>{GENRE_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
      {hasActiveFilters('recipes', DEFAULT_METHOD_FILTERS, DEFAULT_PATTERN_FILTERS, filters) && <button className="asset-clear-button" type="button" onClick={onClear}>清空筛选</button>}
    </div>
    {items.length === 0 ? <EmptyState onClear={onClear} /> : <div className="asset-recipe-grid">{items.map((item) => <article key={item.key} className="asset-recipe-card">
      <header><Badge>{item.commonGenreFamilies.length === 0 ? '跨题材通用' : item.commonGenreFamilies.slice(0, 2).map(getGenreLabel).join(' · ')}</Badge><span>5 个标准阶段</span></header>
      <h2>{item.publicTitle}</h2><p>{item.publicExplanation}</p>
      <ol>{item.stages.map((stage) => <li key={stage.key}><span>{stage.publicTitle}</span></li>)}</ol>
      <button type="button" onClick={() => onOpen(item)}>查看完整配方<CaretRight /></button>
    </article>)}</div>}
  </div>;
}

function PlanningPage(): React.JSX.Element {
  const task = PLANNING_DEMO.currentTask;
  const [auditOwnerId, setAuditOwnerId] = useState('');
  const [auditBookId, setAuditBookId] = useState('');
  const [auditRunId, setAuditRunId] = useState('');
  const [audit, setAudit] = useState<V7PlanningRuntimeAudit | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const loadAudit = async (): Promise<void> => {
    if ([auditOwnerId, auditBookId, auditRunId].some((value) => value.trim().length === 0)) { setAuditError('请填写作者、书籍和任务编号。'); return; }
    setAuditLoading(true); setAuditError(null);
    try { setAudit(await fetchV7PlanningRuntimeAudit(auditOwnerId.trim(), auditBookId.trim(), auditRunId.trim())); }
    catch (reason) { setAuditError(reason instanceof Error ? reason.message : '读取运行记录失败。'); }
    finally { setAuditLoading(false); }
  };
  return <div className="asset-page planning-page">
    <PageHeading
      title="分层规划能力"
      description="这里展示方法资产怎样被编成全书到章节的动态配方。方法是软参考，正式事实是硬边界，具体故事仍由创作成员发挥。"
      count={`${ASSET_SUMMARY.planning.totalLayers} 层 · ${ASSET_SUMMARY.planning.totalMethodProfiles} 份方法档案`}
    />

    <section className="planning-principles" aria-label="规划原则">
      <article><strong>正式资料</strong><span>必须守住</span><p>作者确认、正式设定和已完成正文不能被规划改写。</p></article>
      <article><strong>方法与配方</strong><span>可以调整</span><p>成员可以组合、删减、移动，也可以提出本书临时方法。</p></article>
      <article><strong>故事创意</strong><span>保持开放</span><p>人物行动、具体阻力和实现方式不由系统关键词替作者决定。</p></article>
    </section>

    <section className="asset-panel planning-layer-panel">
      <header><div><h2>五层规划器</h2><p>只展开当前需要的层，未来卷保留粗方向，避免一次塞入整本书的细节。</p></div><span>逐层编译</span></header>
      <div className="planning-layer-list">{PLANNING_LAYERS.map((layer, index) => <article key={layer.key}>
        <span>{index + 1}</span><div><h3>{layer.publicName}<small>{layer.shortName}</small></h3><p>{layer.responsibility}</p><dl><div><dt>建议范围</dt><dd>{layer.recommendedScale}</dd></div><div><dt>暂不处理</dt><dd>{layer.defers}</dd></div></dl></div>
      </article>)}</div>
    </section>

    <div className="planning-two-columns">
      <section className="asset-panel planning-responsibility-panel">
        <header><div><h2>系统和成员怎样分工</h2><p>系统管确定性事务，模型成员负责真正的语义判断。</p></div></header>
        <div><article><strong>系统负责</strong><ul><li>身份、权限和书籍隔离</li><li>版本、来源、幂等和格式校验</li><li>树结构、篇幅加总和审计记录</li></ul></article><article><strong>成员负责</strong><ul><li>理解作者意图和作品语义</li><li>判断方法相关性并提出创意</li><li>发现文学冲突、漂移和兑现风险</li></ul></article></div>
      </section>
      <section className="asset-panel planning-seat-panel">
        <header><div><h2>全书路线三席</h2><p>三席只用于全书路线独立比较；卷和链按作者需要生成一至三套，不强制每轮都跑三次。</p></div></header>
        <div>{STRONG_PLANNING_SEATS.map((seat) => <details key={seat.member}><summary><strong>{seat.member}</strong><span>{seat.model}</span></summary><h3>独立交付</h3><BulletList values={['完整全书粗路线与卷数安排', '商业受众、追读承诺与阶段回报', '人物选择、因果推进和作品辨识度', '本方案采用的方法及本书具体用法']} /><h3>共同边界</h3><BulletList values={['读取相同的冻结资料范围', '不查看另外两人的答案', '方法卡只是少量参考，允许提出本书临时方法', '未来细节保持粗粒度，不冒充已经发生']} /></details>)}</div>
      </section>
    </div>

    <section className="asset-panel planning-flow-panel">
      <header><div><h2>协作与确认流程</h2><p>后台完整保留资料策划、实际方案数、比较理由和作者选择。</p></div></header>
      <ol>{CURRENT_PLANNING_FLOW.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}</ol>
    </section>

    <section className="asset-panel planning-runtime-audit">
      <header><div><h2>全书路线审计</h2><p>输入一次全书路线任务的范围，查看候选方法、三席独立路线、主编点评、作者确认与失败交接。其他层级的资料包和临时身份在“创作运行”查看。</p></div><span>只读</span></header>
      <div className="planning-audit-form">
        <label><span>作者编号</span><input value={auditOwnerId} onChange={(event) => setAuditOwnerId(event.target.value)} /></label>
        <label><span>书籍编号</span><input value={auditBookId} onChange={(event) => setAuditBookId(event.target.value)} /></label>
        <label><span>任务编号</span><input value={auditRunId} onChange={(event) => setAuditRunId(event.target.value)} /></label>
        <button type="button" disabled={auditLoading} onClick={() => void loadAudit()}>{auditLoading ? '正在读取…' : '查看运行记录'}</button>
      </div>
      {auditError !== null && <p className="planning-audit-error">{auditError}</p>}
      {audit !== null && <div className="planning-runtime-result">
        <article><span>任务状态</span><strong>{audit.run.status}</strong><small>{audit.run.current_phase}</small></article>
        <article><span>检索席位</span><strong>{audit.methodSearches.length}</strong><small>{audit.methodSearches.map((item) => `${item.seat_key} ${item.candidates.length}项`).join(' · ')}</small></article>
        <article><span>方法组合</span><strong>{audit.methodProposals.length}</strong><small>{audit.methodProposals.length} 套独立保存</small></article>
        <article><span>故事路线</span><strong>{audit.storyRoutes.length}</strong><small>三名编剧独立保存</small></article>
        <article><span>主编点评</span><strong>{audit.routeReview === null ? '未完成' : '已完成'}</strong><small>不代替作者选择</small></article>
        <article><span>正式路线版本</span><strong>{audit.confirmedRoutes.filter((item) => item.lifecycle === 'confirmed').length}</strong><small>{audit.routeDecisions.at(-1)?.decision_kind ?? '尚未确认'}</small></article>
        <details><summary>查看模型调用与失败交接</summary><div>{audit.modelCalls.map((call, index) => <p key={`${call.member_key}-${index}`}><b>{call.member_key}</b><span>{call.model_id}</span><em>{call.state}</em><small>{call.failure_message ?? `${call.input_tokens ?? 0} / ${call.output_tokens ?? 0} tokens`}</small></p>)}</div></details>
      </div>}
    </section>

    <details className="asset-panel planning-demo" open>
      <summary><div><small>复杂示范</small><h2>{PLANNING_DEMO.label}</h2><p>{PLANNING_DEMO.notice}</p></div><span>展开 / 收起</span></summary>
      <div className="planning-demo-body">
        <section><h3>输入资料及权威级别</h3><div className="planning-source-grid">{PLANNING_DEMO.sources.map((source) => <article key={source.sourceId}><span>{source.kind === 'formal' ? '正式资料' : source.kind === 'goal' ? '创作目标' : '开放创意'}</span><strong>{source.label} · v{source.version}</strong><p>{source.content}</p></article>)}</div></section>
        <section><h3>跨卷阅读体验曲线</h3><p className="planning-help">曲线来自各卷节点，不是系统按关键词自动评分；实际选择由主编和副编根据作品语义完成。</p><div className="planning-experience-curve">{PLANNING_EXPERIENCE_CURVE.map((point) => <article key={point.volumeNodeId}><span>{String(point.sequence).padStart(2, '0')}</span><div><h4>{point.title}</h4><p>{point.publicSummary}</p><small>{point.contrastWithPrevious}</small></div></article>)}</div></section>
        <section><h3>动态配方树</h3><p className="planning-help">示范只展开第一卷与第一条单元链；未来卷只保留方向责任，进入该卷时再选择合适方法。</p><RecipeTree node={PLANNING_DEMO.recipe.root} depth={0} /></section>
        <section><h3>当前单元链实际收到的任务包</h3><div className="planning-task-grid">
          <TaskBlock title="必须守住" values={task.mustHold} />
          <TaskBlock title="本次要完成" values={task.currentObjectives} />
          <TaskBlock title="方法提示（软参考）" values={task.methodHints.map((item) => `${item.title}：${item.explanation}；本次调整：${item.adaptationNote}`)} />
          <TaskBlock title="逐层阅读体验" values={task.experienceTargets.map((item) => `${item.layerName} · ${item.title}：${item.publicSummary}；压力：${item.pressureRhythm}；回报：${item.payoffCadence}`)} />
          <TaskBlock title="可以自由发挥" values={task.creativeSpace} />
          <TaskBlock title="交付检查" values={task.expectedOutput} />
          <TaskBlock title="偏离与创新规则" values={task.deviationPolicy} />
        </div><p className="planning-source-ref">引用快照：{task.sourceRefs.map((item) => `${item.sourceId}@${item.version}`).join(' · ')}</p></section>
      </div>
    </details>

    <section className="asset-panel planning-audit-panel">
      <header><div><h2>每次运行必须留下什么</h2><p>管理员能还原“谁用什么资料、什么方法、为什么采用、失败后如何恢复”。</p></div></header>
      <div>{PLANNING_AUDIT_FIELDS.map((field) => <span key={field}>{field}</span>)}</div>
    </section>
  </div>;
}

function RecipeTree({ node, depth }: { node: LayeredRecipeNode; depth: number }): React.JSX.Element {
  const layer = PLANNING_LAYERS.find((item) => item.key === node.layer);
  const methodNames = node.methodGuidance.map((item) => item.source === 'custom'
    ? `${item.customTitle ?? '临时方法'}（本书创新）`
    : getNarrativeMethodName(item.methodKey ?? ''));
  const budget = [node.budget?.wordTarget === undefined ? '' : `${formatWords(node.budget.wordTarget)}字`, node.budget?.chapterRange === undefined ? '' : `${node.budget.chapterRange[0]}—${node.budget.chapterRange[1]}章`].filter(Boolean).join(' · ');
  return <div className={`planning-tree-node depth-${Math.min(depth, 4)}`}>
    <article><header><span>{layer?.shortName ?? node.layer}</span><div><h4>{node.title}</h4><small>{node.status === 'outline' ? '未来粗方向' : '当前可展开'}{budget.length > 0 ? ` · ${budget}` : ''}</small></div></header><p>{node.responsibility}</p><p className="planning-experience-line"><strong>读者体验：</strong>{node.readerExperience.publicSummary}</p>{methodNames.length > 0 && <p className="planning-method-line"><strong>方法参考：</strong>{methodNames.join(' ＋ ')}</p>}{node.expectedChanges.length > 0 && <p className="planning-change-line"><strong>完成后：</strong>{node.expectedChanges.join('；')}</p>}<details className="planning-experience-details"><summary>查看体验依据</summary><dl><div><dt>压力变化</dt><dd>{node.readerExperience.pressureRhythm}</dd></div><div><dt>回报频率</dt><dd>{node.readerExperience.payoffCadence}</dd></div><div><dt>信息揭示</dt><dd>{node.readerExperience.informationRhythm}</dd></div><div><dt>前后差异</dt><dd>{node.readerExperience.contrastWithPrevious}</dd></div><div><dt>设计理由</dt><dd>{node.readerExperience.designReason}</dd></div></dl></details></article>
    {node.children.length > 0 && <div className="planning-tree-children">{node.children.map((child) => <RecipeTree key={child.nodeId} node={child} depth={depth + 1} />)}</div>}
  </div>;
}

function TaskBlock({ title, values }: { title: string; values: readonly string[] }): React.JSX.Element {
  return <article><h4>{title}</h4><BulletList values={values} /></article>;
}

function formatWords(value: number): string {
  return value >= 10_000 ? `${Number((value / 10_000).toFixed(1))}万` : String(value);
}

function DetailDrawer({ detail, onClose }: { detail: AssetDetail; onClose: () => void }): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const title = detail.kind === 'method' ? detail.value.professionalName : detail.kind === 'pattern' ? detail.value.professionalName : detail.value.publicTitle;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('drawer-open');
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('drawer-open');
      previous?.focus();
    };
  }, [onClose]);
  return <>
    <button className="asset-drawer-scrim" type="button" aria-label="关闭详情" onClick={onClose} />
    <aside className="asset-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="asset-detail-title">
      <header><div><small>{detail.kind === 'method' ? '叙事方法' : detail.kind === 'pattern' ? '剧情模式' : '剧情配方'}</small><h2 id="asset-detail-title">{title}</h2></div><button ref={closeRef} type="button" aria-label="关闭详情" onClick={onClose}><X /></button></header>
      <div className="asset-drawer-body">
        {detail.kind === 'method' && <MethodDetail value={detail.value} />}
        {detail.kind === 'pattern' && <PatternDetail value={detail.value} />}
        {detail.kind === 'recipe' && <RecipeDetail value={detail.value} />}
      </div>
    </aside>
  </>;
}

function MethodDetail({ value }: { value: Extract<AssetDetail, { kind: 'method' }>['value'] }): React.JSX.Element {
  const profile = getMethodExecutionProfile(value.key);
  return <>
    <DetailSummary>{value.publicExplanation}</DetailSummary>
    <DetailFacts values={[
      ['叙事维度', getDimensionLabel(value.dimension)],
      ['主要位置', SCOPE_LABELS[value.primaryScope]],
      ['可用位置', value.applicableScopes.map((scope: NarrativeScope) => SCOPE_LABELS[scope]).join('、')],
      ['方法角色', KIND_LABELS[value.kind]],
      ['推荐级别', TIER_LABELS[value.recommendationTier]],
      ['内部标识', value.key]
    ]} />
    <DetailSection title="适合什么时候用"><TagList values={value.fitSignals} /></DetailSection>
    {value.cautionSignals.length > 0 && <DetailSection title="什么时候慎用" tone="warning"><BulletList values={value.cautionSignals} /></DetailSection>}
    <DetailSection title="创作责任"><BulletList values={value.responsibilities} numbered /></DetailSection>
    {profile !== null && <>
      <DetailSection title="可以用在哪些规划层"><TagList values={profile.planningLayers.map((key) => PLANNING_LAYERS.find((item) => item.key === key)?.publicName ?? key)} /></DetailSection>
      <DetailSection title="建议处理范围"><BulletList values={profile.recommendedScale} /></DetailSection>
      <DetailSection title="它主要解决什么"><p>{profile.solves}</p></DetailSection>
      <DetailSection title="使用前要有什么资料"><BulletList values={profile.requiredInputs} /></DetailSection>
      <DetailSection title="标准交付内容"><BulletList values={profile.outputContract} /></DetailSection>
      <DetailSection title="怎样和其他方法组合"><p>{profile.combinationGuidance}</p></DetailSection>
      <DetailSection title="允许创作成员怎样创新"><BulletList values={profile.creativityPolicy} /></DetailSection>
      <DetailSection title="后台示范"><p className="asset-emphasis-copy">{profile.adminExample}</p></DetailSection>
      <DetailSection title="常见风险" tone="warning"><BulletList values={profile.risks} /></DetailSection>
    </>}
  </>;
}

function PatternDetail({ value }: { value: Extract<AssetDetail, { kind: 'pattern' }>['value'] }): React.JSX.Element {
  return <>
    <DetailSummary>{value.publicExplanation}</DetailSummary>
    <DetailFacts values={[
      ['剧情职责', getCategoryLabel(value.category)],
      ['主要位置', value.primaryScope === 'volume' ? '分卷' : value.primaryScope === 'unit' ? '剧情单元' : value.primaryScope === 'event' ? '事件' : '场景'],
      ['常见题材', value.commonGenreFamilies.length === 0 ? '跨题材通用' : value.commonGenreFamilies.map(getGenreLabel).join('、')],
      ['常用别名', value.aliases.join('、') || '无'],
      ['内部标识', value.key]
    ]} />
    <DetailSection title="使用前提"><BulletList values={value.requiredConditions} /></DetailSection>
    <DetailSection title="完成后必须改变"><p className="asset-emphasis-copy">{value.irreversibleResult}</p></DetailSection>
    <DetailSection title="可调整的方向"><TagList values={value.variationAxes} /></DetailSection>
    <DetailSection title="最容易写坏的地方" tone="warning"><p>{value.caution}</p></DetailSection>
    <DetailSection title="关联叙事方法"><TagList values={value.narrativeMethodKeys.map(getNarrativeMethodName)} /></DetailSection>
  </>;
}

function RecipeDetail({ value }: { value: Extract<AssetDetail, { kind: 'recipe' }>['value'] }): React.JSX.Element {
  return <>
    <DetailSummary>{value.publicExplanation}</DetailSummary>
    <DetailFacts values={[
      ['标准阶段', `${value.stages.length} 个`],
      ['常见题材', value.commonGenreFamilies.length === 0 ? '跨题材通用' : value.commonGenreFamilies.map(getGenreLabel).join('、')],
      ['适用提示', value.fitSignals.join('、')],
      ['资产来源', value.legacyTemplateKeys.length > 0 ? '承接历史版本有效责任并按 V7 重写' : 'V7 新增配方'],
      ['内部标识', value.key]
    ]} />
    <DetailSection title="五个标准阶段">
      <ol className="asset-stage-list">{value.stages.map((stage, index) => <li key={stage.key}>
        <span>{index + 1}</span><div><h3>{stage.publicTitle}</h3><p>{stage.responsibility}</p><dl><div><dt>必须改变</dt><dd>{stage.requiredChange}</dd></div><div><dt>优先模式</dt><dd>{stage.preferredPatternKeys.map(getPlotPatternName).join('、')}</dd></div></dl></div>
      </li>)}</ol>
    </DetailSection>
    <DetailSection title="组合风险" tone="warning"><p>{value.caution}</p></DetailSection>
    <DetailSection title="关联叙事方法"><TagList values={value.narrativeMethodKeys.map(getNarrativeMethodName)} /></DetailSection>
  </>;
}

function PageHeading({ title, description, count }: { title: string; description: string; count?: string }): React.JSX.Element {
  return <header className="asset-page-heading"><div><h1>{title}</h1><p>{description}</p></div>{count !== undefined && <strong>{count}</strong>}</header>;
}

function Metric({ label, value, suffix, hint, onClick }: { label: string; value: number; suffix: string; hint: string; onClick?: () => void }): React.JSX.Element {
  const content = <><span>{label}</span><strong>{value}<small>{suffix}</small></strong><p>{hint}</p>{onClick !== undefined && <CaretRight aria-hidden="true" />}</>;
  return onClick === undefined ? <div className="asset-metric">{content}</div> : <button className="asset-metric clickable" type="button" onClick={onClick}>{content}</button>;
}

function AssetTable({ headers, children }: { headers: readonly string[]; children: React.ReactNode }): React.JSX.Element {
  return <section className="asset-table-panel"><div className="asset-table-wrap"><table><thead><tr>{headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div></section>;
}

function Badge({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="asset-badge">{children}</span>;
}

function TagLine({ values }: { values: readonly string[] }): React.JSX.Element {
  return <span className="asset-tag-line">{values.length === 0 ? '—' : values.join(' · ')}</span>;
}

function TagList({ values }: { values: readonly string[] }): React.JSX.Element {
  return <div className="asset-tag-list">{values.map((value, index) => <span key={`${value}-${index}`}>{value}</span>)}</div>;
}

function BulletList({ values, numbered = false }: { values: readonly string[]; numbered?: boolean }): React.JSX.Element {
  const Tag = numbered ? 'ol' : 'ul';
  return <Tag className="asset-bullet-list">{values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}</Tag>;
}

function DetailSummary({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="asset-detail-summary">{children}</p>;
}

function DetailFacts({ values }: { values: ReadonlyArray<readonly [string, string]> }): React.JSX.Element {
  return <dl className="asset-detail-facts">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function DetailSection({ title, children, tone = 'normal' }: { title: string; children: React.ReactNode; tone?: 'normal' | 'warning' }): React.JSX.Element {
  return <section className={`asset-detail-section ${tone}`}><h3>{title}</h3>{children}</section>;
}

function EmptyState({ onClear }: { onClear: () => void }): React.JSX.Element {
  return <section className="asset-empty-state"><MagnifyingGlass aria-hidden="true" /><h2>没有找到符合条件的资产</h2><p>可以换一个关键词，或者清空当前分类和题材筛选。</p><button type="button" onClick={onClear}>清空筛选</button></section>;
}

function sectionFromUrl(): AdminSection {
  const value = new URL(window.location.href).searchParams.get('section');
  return NAVIGATION.some((item) => item.key === value) ? value as AdminSection : 'overview';
}

function sectionCapabilityLabel(section: AdminSection): string {
  if (section === 'agents' || section === 'prompt-context' || section === 'users' || section === 'issues' || section === 'memberships') return '可管理';
  if (section === 'operations' || section === 'usage') return '实时数据';
  if (section === 'creation-ops') return '运行只读';
  if (section === 'features') return '实时台账';
  return '资产只读';
}

function isPlatformSection(section: AdminSection): section is PlatformSection {
  return section === 'operations' || section === 'users' || section === 'usage' || section === 'issues' || section === 'memberships';
}
