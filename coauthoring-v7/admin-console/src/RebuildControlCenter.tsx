import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowClockwise, ArrowRight, CheckCircle, GearSix, GitBranch, MagnifyingGlass } from '@phosphor-icons/react';
import type { RebuildControlData, RebuildUnit } from '../../backend/admin/rebuild-control-types.js';
import { fetchRebuildControl } from './platform-api';
import './rebuild-control.css';
import { detailText } from './WorkflowGuide';
import { FunctionManagement } from './FunctionManagement';
import { DeliveryScope, reviewedStage, implementationStatus } from './DeliveryScope';

type Destination = 'agents' | 'prompt-context' | 'rhythm' | 'memberships' | 'issues' | 'features' | 'time-machine';
type Filter = 'all' | 'active' | 'pending' | 'accepted' | 'attention';
type MapView = 'functions' | 'all';
function readMapView(): MapView {
  const params = new URL(window.location.href).searchParams;
  const value = params.get('mapView');
  return value === 'all' || !value && params.has('unit') ? 'all' : 'functions';
}

export function unitStage(unit: RebuildUnit): string {
  if (unit.acceptance === '未通过' || unit.acceptance === '阻塞') return '需要处理';
  if (unit.design === '取消' || unit.design === '暂缓') return unit.design;
  if (unit.deployment === '已回退') return '已回退·待处理';
  const reviewed = reviewedStage(unit);
  if (reviewed) return reviewed;
  if (unit.acceptance === '通过') return unit.deployment === '已发布' ? '已发布' : '本地验收通过';
  if (unit.deployment === '已发布') return '已上线·待收尾';
  if (unit.deployment === '试用中') return '试用中·待验收';
  if (unit.acceptance === '验收中') return '验收中';
  if (unit.frontend === '开发中' || unit.backend === '开发中') return '开发中';
  if (unit.frontend === '已实现' || unit.backend === '已实现') {
    return [unit.frontend, unit.backend].every((value) => ['已实现', '不适用'].includes(value)) ? '待验收' : '部分实现';
  }
  return unit.design === '已定' ? '待开发' : unit.design;
}

function isActive(unit: RebuildUnit): boolean {
  if (reviewedStage(unit)) return unitStage(unit) !== '已合并';
  return ['开发中', '验收中', '讨论中', '部分实现', '待验收', '需要处理', '已上线·待收尾', '试用中·待验收', '已回退·待处理'].includes(unitStage(unit));
}

function displayTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

export function RebuildControlCenter({ mode, onNavigate }: {
  mode: 'map' | 'configuration';
  onNavigate: (section: Destination) => void;
}): React.JSX.Element {
  const [data, setData] = useState<RebuildControlData | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [mapView, setMapView] = useState<MapView>(readMapView);
  const [managerDirty, setManagerDirty] = useState(false);
  const [railWidth, setRailWidth] = useState(280);
  const changeView = (view: MapView): void => {
    if (!window.dispatchEvent(new Event('wenmi:admin-navigate', { cancelable: true }))) return;
    setMapView(view);
    const url = new URL(window.location.href); url.searchParams.set('mapView', view);
    window.history.replaceState({}, '', url);
  };
  const [selectedId, setSelectedId] = useState(() => new URL(window.location.href).searchParams.get('unit') ?? '');
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetchRebuildControl(controller.signal).then((next) => {
      if (!controller.signal.aborted) { setData(next); setError(false); }
    }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!managerDirty && document.visibilityState === 'visible') setRevision((value) => value + 1);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [managerDirty]);

  useEffect(() => {
    const restore = (): void => { setSelectedId(new URL(window.location.href).searchParams.get('unit') ?? ''); setMapView(readMapView()); };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const active = data?.units.filter(isActive) ?? [];
  const next = data?.units.find((unit) => !['通过', '不适用'].includes(unit.acceptance) && !['取消', '暂缓'].includes(unit.design));
  const selected = data?.units.find((unit) => unit.id === selectedId) ?? active[0] ?? next ?? data?.units[0];
  const stages = [...new Set(data?.units.map((unit) => unit.stage) ?? [])];
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (data?.units ?? []).filter((unit) => {
      if (stage !== 'all' && unit.stage !== stage) return false;
      if (filter === 'active' && !isActive(unit)) return false;
      if (filter === 'pending' && !['待讨论', '待开发', '待调整'].includes(unitStage(unit))) return false;
      if (filter === 'accepted' && unit.acceptance !== '通过') return false;
      if (filter === 'attention' && !['未通过', '阻塞'].includes(unit.acceptance)) return false;
      return !needle || [unit.id, unit.name, unit.stage, ...unit.details.map((item) => item.text),
        ...unit.sourceFeatures.flatMap((item) => [item.id, item.name])].join(' ').toLocaleLowerCase().includes(needle);
    });
  }, [data, query, stage, filter]);

  const choose = (id: string): void => {
    setMapView('all');
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('unit', id);
    url.searchParams.set('mapView', 'all');
    window.history.replaceState({}, '', url);
    detailRef.current?.focus({ preventScroll: true });
    detailRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  };

  useEffect(() => {
    if (mapView === 'all' && selectedId) { detailRef.current?.focus({ preventScroll: true }); detailRef.current?.scrollIntoView({ block: 'start' }); }
  }, [mapView, selectedId]);

  const refresh = <button type="button" className="rebuild-button" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
    <ArrowClockwise aria-hidden="true" />{loading ? '读取中…' : '刷新状态'}
  </button>;

  if (!data) return <section className="rebuild-empty" role={error ? 'alert' : 'status'}>
    <GitBranch size={32} aria-hidden="true" /><h2>{error ? '功能地图暂时没有读取成功' : '正在读取开发计划与运行记录'}</h2>
    <p>{error ? '请重新加载。未取得数据时不会显示空进度或正常状态。' : '进度来自项目内的开发顺序表。'}</p>{error && refresh}
  </section>;

  return <div className="rebuild-center">
    <header className="rebuild-intro"><div><span className="rebuild-eyebrow">文秘写作 · 全产品重构</span>
      <h2>{mode === 'map' ? '每一步，都看得清楚' : '配置有入口，变更有依据'}</h2>
      <p>{mode === 'map' ? '按实际开发顺序查看功能、技术方案、验收与运行证据。' : '打开当前已经生效的管理能力，查看后续需要建设的配置。'}</p></div>{refresh}</header>

    {error && <p className="rebuild-alert" role="alert">刷新失败。以下保留上次读取结果，时间见下方；当前运行情况尚未重新核实。</p>}

    <section className="rebuild-snapshot" aria-label="当前运行来源">
      <div><strong>{data.runtime.origin}</strong><span>检查于 {displayTime(data.runtime.checkedAt)}（北京时间）</span></div>
      <div><span>数据库有响应</span><span className={data.runtime.worker === 'recent_heartbeat' ? '' : 'needs-check'}>
        {data.runtime.worker === 'recent_heartbeat' ? 'Worker有近期心跳' : 'Worker心跳缺失或过期'}</span>
        <button type="button" onClick={() => onNavigate('issues')}>待处理问题 {data.runtime.openIssueCount} 条<ArrowRight aria-hidden="true" /></button></div>
      <p>这是当前服务的运行信号，不代表所有功能畅通。过去24小时共 {data.runtime.taskCount} 条任务记录，读取最近 {data.runtime.sampledCount} 条；任务失败可能来自额度、输入或服务异常，需要进一步判断。</p>
    </section>

    {mode === 'configuration' ? <ConfigurationCenter data={data} onNavigate={onNavigate} /> : <>
      <nav className="workflow-guide-switch" aria-label="功能地图视图">{([['functions','功能管理'],['all','开发路线']] as const).map(([view,label]) => <button key={view} type="button" aria-pressed={mapView === view} onClick={() => changeView(view)}>{label}</button>)}</nav>
      {mapView === 'functions' && <FunctionManagement units={data.units} onDetails={choose} onDirtyChange={setManagerDirty} />}
      {mapView === 'all' && <>
      <details className="rebuild-overview-drawer"><summary>开发总览与当前批次 · {data.units.length}项功能</summary>
      <section className="rebuild-summary" aria-label="重构进度">
        <article><span>计划工作单元</span><strong>{data.units.length}<small>项</small></strong><p>覆盖 {data.sourceFeatures.length} 项来源功能</p></article>
        <article><span>已开始待完成</span><strong>{active.length}<small>项</small></strong><p>{active[0]?.name ?? '当前没有已开始待完成的单元'}</p></article>
        <article><span>本地验收通过</span><strong>{data.units.filter((unit) => unit.acceptance === '通过').length}<small>项</small></strong><p>按单元合同核对，未验证不计入</p></article>
        <article><span>已发布</span><strong>{data.units.filter((unit) => unit.deployment === '已发布').length}<small>项</small></strong><p>上线状态与开发进度分开</p></article>
      </section>
      <section className="rebuild-now" aria-label="当前工作"><GitBranch aria-hidden="true" /><div>
        <strong>当前批次：{data.source.currentBatch ?? '未登记'}</strong>
        <p>当前工作：{data.source.currentWork ?? '未登记'}</p>
        <p>下方“已开始待完成”是计划累计状态；开发完成、验收通过、已发布是不同状态。</p></div>
        {(active[0] ?? next) && <button type="button" onClick={() => choose((active[0] ?? next)!.id)}>查看待完成单元<ArrowRight aria-hidden="true" /></button>}
      </section>
      </details>
      <div className="rebuild-toolbar">
        <label className="rebuild-search"><MagnifyingGlass aria-hidden="true" /><input aria-label="搜索功能地图" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索功能、说明或编号…" /></label>
        <select aria-label="按开发阶段筛选" value={stage} onChange={(event) => setStage(event.target.value)}><option value="all">全部开发阶段</option>{stages.map((item) => <option key={item}>{item}</option>)}</select>
        <select aria-label="按重构进度筛选" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
          <option value="all">全部进度</option><option value="active">已开始待完成</option><option value="pending">待讨论 / 待开发</option><option value="accepted">验收通过</option><option value="attention">验收未通过 / 阻塞</option>
        </select>
      </div>
      <p>这里记录完整重构合同的进度，不等于线上功能是否存在。已上线但仍有未完成范围的单元标为“已上线·待收尾”；点开可查看当前能力、剩余工作及旧代码退出条件。</p>
      <label className="rebuild-rail-size">目录宽度<input type="range" min="240" max="360" step="10" value={railWidth} onChange={event => setRailWidth(Number(event.target.value))} /><span>{railWidth}px</span></label>
      <div className="rebuild-workspace" style={{gridTemplateColumns:`${railWidth}px minmax(0, 1fr)`}}>
        <section className="rebuild-map" aria-label="按顺序排列的功能地图">
          <header><strong>开发路线</strong><span>{filtered.length} 项结果</span></header>
          {!filtered.length && <div className="rebuild-empty"><p>没有符合条件的功能。</p><button type="button" onClick={() => { setQuery(''); setStage('all'); setFilter('all'); }}>清除筛选</button></div>}
          {stages.map((stageName) => {
            const items = filtered.filter((unit) => unit.stage === stageName);
            if (!items.length) return null;
            return <section className="rebuild-phase" key={stageName}><h3>{stageName}</h3><ol>
              {items.map((unit) => <li key={unit.id}><button type="button" aria-current={selected?.id === unit.id ? 'true' : undefined} onClick={() => choose(unit.id)}>
                <span className="rebuild-order">{String(unit.order).padStart(2, '0')}</span><span><strong>{unit.name}</strong><small>{unit.id} · {unit.backend === '不适用' ? '前端功能' : unit.frontend === '不适用' ? '后端能力' : '前后端闭环'}</small></span>
                <em className={`rebuild-state ${unit.acceptance === '通过' ? 'accepted' : isActive(unit) ? 'active' : ''}`}>{unitStage(unit)}</em>
              </button></li>)}
            </ol></section>;
          })}
        </section>
        <section ref={detailRef} tabIndex={-1} className="rebuild-detail" aria-label="功能详情">
          {selected && <UnitDetail key={selected.id} unit={selected} data={data} onSelect={choose} onNavigate={onNavigate} />}
        </section>
      </div>
      <button className="rebuild-text-link" type="button" onClick={() => onNavigate('features')}>查看现有产品能力对照<ArrowRight aria-hidden="true" /></button>
      </>}
    </>}
    <footer className="rebuild-source"><span>进度来源：项目开发顺序表 v{data.source.version} · 文件更新 {displayTime(data.source.updatedAt)}</span>
      <span>运行版本：{data.runtime.releaseId}</span><p>维护者更新项目原文后，本地刷新即读取；线上展示所在发布版本的文档。每60秒自动刷新一次，隐藏页面暂停轮询。没有另存一套进度。</p></footer>
  </div>;
}

function UnitDetail({ unit, data, onSelect, onNavigate }: {
  unit: RebuildUnit; data: RebuildControlData; onSelect: (id: string) => void; onNavigate: (section: Destination) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState('overview');
  const tabs=[['overview','功能概览'],['flow','功能流程'],['plan','方案文档'],['history','开发记录'],['checks','缺陷与核查'],['config','调整入口']];
  const signals = data.runtime.taskSignals.filter((signal) => unit.taskKinds.includes(signal.taskKind));
  const failed = signals.reduce((sum, item) => sum + item.failed, 0);
  const issues = unit.details.find((item) => item.label === '已知问题');
  const recordedRun = unit.details.find((item) => item.label === '运行验证');
  const sections = [
    ['讨论', '功能介绍与设计目标'], ['前端交付', '用户将怎样操作'], ['后端逐项实现', '技术路线与后端工作'],
    ['本轮补全', '补充要求'], ['重点验收', '怎样才算完成'], ['依赖与详细设计', '详细规格与依据'], ['运行验证', '已取得的运行证据']
  ];
  return <>
    <header><span className="rebuild-eyebrow">第 {unit.order} 项 · {unit.id}</span><h3>{unit.name}</h3><span className="rebuild-state">{unitStage(unit)}</span></header>
    <nav className="rebuild-detail-tabs" aria-label="功能档案分页">{tabs.map(([id,label])=><button type="button" key={id} aria-pressed={tab===id} onClick={()=>setTab(id!)}>{label}</button>)}</nav>
    <div className="rebuild-detail-pages" data-page={tab}>
    <div data-part="overview" hidden={tab!=='overview'}>
    <DeliveryScope unit={unit} />
    <section className="rebuild-detail-section" aria-label="功能方案概览"><h4>功能简介</h4><p>{detailText(unit, '设计·功能简介') ?? detailText(unit, '讨论') ?? '尚未登记功能简介。'}</p>
      <h4>功能逻辑</h4><p>{detailText(unit, '设计·功能逻辑') ?? detailText(unit, '后端逐项实现') ?? '尚未登记功能逻辑。'}</p>
      <h4>已确认的设计方案</h4><p>{detailText(unit, '设计·已确认方案') ?? '本单元尚未单独整理确认决定；下方保留原讨论与交付记录，不自动视为已确认方案。'}</p>
      <h4>待确认 / 待验证</h4><p>{detailText(unit, '设计·待验证') ?? '按下方设计状态、验收要求和证据判断；没有记录不代表已经验证。'}</p>
    </section>
    <dl className="rebuild-status-grid">{[['设计', unit.design], ['前端', implementationStatus(unit, unit.frontend)], ['后端', implementationStatus(unit, unit.backend)], ['验收', unit.acceptance], ['上线', unit.deployment]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <section className="rebuild-detail-section"><h4>方案与实现是否一致</h4><p>{detailText(unit,'核查·方案一致性') ?? '尚无逐项对照结论。已实现或已发布不代表完整符合方案。'}</p><h4>待补充能力</h4><p>{detailText(unit,'收尾·剩余工作') ?? detailText(unit,'设计·待验证') ?? '尚未登记专项清单，需要核对方案与代码后补充。'}</p></section>
    </div>
    <div data-part="checks" hidden={tab!=='checks'}>
    <section className="rebuild-evidence"><h4>BUG与当前可用性</h4><p><strong>缺陷核查：</strong>{issues?.text ?? '尚未完成该功能的专项缺陷核查；不能据此判断没有BUG。'}</p>
      <p><strong>业务畅通：</strong>{failed > 0 ? `相关现有链路观察到 ${failed} 条失败记录，需在问题记录核查。` : recordedRun ? '已有本批运行验证记录，见下方；当前实时业务畅通仍未验证。' : signals.length ? '相关现有链路有任务记录；尚无本功能完整探针，仍为未验证。' : '尚无本功能的完整运行证据，未验证。'}</p>
      {signals.length > 0 && <p>关联样本：{signals.reduce((sum, item) => sum + item.observed, 0)} 条，其中成功 {signals.reduce((sum, item) => sum + item.succeeded, 0)} 条、失败 {failed} 条。多个功能可能共享同一链路，样本不能相加当总任务数。</p>}
      <button type="button" onClick={() => onNavigate('issues')}>打开问题记录<ArrowRight aria-hidden="true" /></button>
    </section>
    <section className="rebuild-detail-section"><h4>BUG自检与测试证据</h4><p>{detailText(unit,'核查·自检记录') ?? recordedRun?.text ?? '尚未登记专项自检证据，未验证。'}</p><h4>核查范围与时间</h4><p>{detailText(unit,'核查·范围与时间') ?? `记录读取时间：${displayTime(data.runtime.checkedAt)}；这不是功能专项测试时间。`}</p></section>
    </div>
    <div data-part="flow"><section className="rebuild-detail-section"><h4>用户操作与成员执行流程</h4><p>{detailText(unit,'设计·功能流程') ?? detailText(unit,'前端交付') ?? detailText(unit,'设计·功能逻辑') ?? '尚未登记本功能完整流程。'}</p><h4>后端处理</h4><p>{detailText(unit,'后端逐项实现') ?? '尚未登记。'}</p><h4>失败与恢复</h4><p>{detailText(unit,'设计·失败恢复') ?? '请核对下方方案中的异常处理；未登记不等于已经支持自动恢复。'}</p></section></div>
    <div data-part="plan" hidden={tab!=='plan'}>
    {['RB-22','RB-30'].includes(unit.id)&&<button type="button" className="rebuild-button" onClick={()=>onNavigate('time-machine')}>打开时光机完整方案与运行记录</button>}
    {sections.map(([key, title]) => {
      if (key === '讨论' && !detailText(unit, '设计·功能简介')) return null;
      if (key === '后端逐项实现' && !detailText(unit, '设计·功能逻辑')) return null;
      const detail = unit.details.find((item) => item.label === key);
      return detail ? <section key={key} className="rebuild-detail-section"><h4>{title}</h4><p>{detail.text}</p></section> : null;
    })}
    {unit.details.filter((item) => !item.label.startsWith('收尾·') && !sections.some(([key]) => key === item.label) && !['已知问题', '设计·功能简介', '设计·功能逻辑', '设计·已确认方案', '设计·待验证', '设计·流程序号'].includes(item.label)).map((detail, index) => <section key={`${detail.label}-${index}`} className="rebuild-detail-section"><h4>{detail.label.replace(/^设计·/, '')} · 设计与处理逻辑</h4><p>{detail.text}</p></section>)}
    <section className="rebuild-detail-section"><h4>前置功能</h4>{unit.dependencies.length ? <div className="rebuild-dependencies">{unit.dependencies.map((id) => {
      const dependency = data.units.find((item) => item.id === id)!;
      return <button type="button" key={id} onClick={() => onSelect(id)}>{id} {dependency.name}<small>{unitStage(dependency)}</small><ArrowRight aria-hidden="true" /></button>;
    })}</div> : <p>没有重构单元前置依赖，具体复用范围见上方方案。</p>}</section>
    <section className="rebuild-detail-section"><h4>合同与验收记录</h4><p>{unit.evidence}</p></section>
    {unit.sourceFeatures.length > 0 && <section className="rebuild-detail-section"><h4>对应的来源功能 · {unit.sourceFeatures.length} 项</h4><div className="rebuild-feature-sources">{unit.sourceFeatures.map((item) => <details key={item.id}><summary>{item.id} {item.name}</summary><p>{item.decision}</p><p><strong>验收：</strong>{item.acceptance}</p><small>规格 {item.specification} · 协作单元 {item.unitIds.join('、')}</small></details>)}</div></section>}
    </div>
    <div data-part="history"><section className="rebuild-detail-section"><h4>开发与维护者</h4><p>{detailText(unit,'开发·维护者') ?? '尚未登记开发者；执行模块名称不能作为开发者身份。'}</p><h4>本轮开发记录</h4><p>{detailText(unit,'开发·当前记录') ?? unit.evidence}</p><h4>历史批次</h4>{unit.details.filter(item=>/第\d+批|开发记录|发布结果|开发合同/u.test(item.label)).map((item,index)=><details key={index}><summary>{item.label}</summary><p>{item.text}</p></details>)}<p>历史验证仅对当时版本与范围有效；当前发布版本为 {data.runtime.releaseId}。</p></section></div>
    <div data-part="config"><section className="rebuild-detail-section"><h4>可调整的配置</h4>{data.configurations.filter(item=>item.unitIds.includes(unit.id)).map(item=><article key={item.id}><h4>{item.name}</h4><p>{item.description}</p><p>{item.scope}</p>{item.section ? <button type="button" className="rebuild-button" onClick={()=>onNavigate(item.section!)}>打开{item.name}</button> : <p>入口尚未实现</p>}</article>)}{!data.configurations.some(item=>item.unitIds.includes(unit.id))&&<p>本单元尚无已登记的独立配置入口。</p>}<h4>修改功能说明与方案</h4><p>正式记录来源：{data.source.path}。由开发者在项目中更新并随版本发布，避免后台说明与代码各存一份。尚未提供在线修改方案功能。</p></section></div>
    </div>
  </>;
}

function ConfigurationCenter({ data, onNavigate }: { data: RebuildControlData; onNavigate: (section: Destination) => void }): React.JSX.Element {
  return <section className="rebuild-configurations" aria-label="统一配置入口">{data.configurations.map((item) => <article key={item.id}>
    <div className="rebuild-config-title"><GearSix aria-hidden="true" /><span>{item.section ? '已有管理入口' : '待建设'}</span></div><h3>{item.name}</h3><p>{item.description}</p><small>{item.scope}</small>
    <div className="rebuild-config-bottom"><span>{item.unitIds.join(' · ')}</span>{item.section ? <button type="button" onClick={() => onNavigate(item.section!)}><CheckCircle aria-hidden="true" />打开管理<ArrowRight aria-hidden="true" /></button> : <strong>尚不可配置</strong>}</div>
  </article>)}</section>;
}
