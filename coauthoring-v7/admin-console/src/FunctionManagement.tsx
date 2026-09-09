import { useEffect, useState } from 'react';
import type { RebuildUnit } from '../../backend/admin/rebuild-control-types.js';
import { detailText } from './WorkflowGuide';
import { readAiNodes } from './AiWorkNodes';
import { PromptContextCenter } from './PromptContextCenter';
import { MemberInput } from './MemberWorkspace';
import { DeliveryScope } from './DeliveryScope';
import { fetchV7PromptAssets, fetchV7UnifiedAgentGovernance, fetchV7PromptManifests, fetchV7PromptManifest,
  type V7PromptAssetSummary, type V7UnifiedAgentGovernance, type V7PromptManifestSummary, type V7PromptManifestDetail } from './platform-api';
import './function-management.css';

const field = (u: RebuildUnit, key: string) => detailText(u, `管理·${key}`) ?? '';
const list = (value: string) => value.split(',').map(s => s.trim()).filter(Boolean);
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
type View = 'overview' | 'rules' | 'sample';
export function relatedFunctionAssets(unit: RebuildUnit, assets: V7PromptAssetSummary[]) {
  const stations = list(field(unit, '工位')), roles = list(field(unit, '岗位'));
  const stationAssets = assets.filter(a => stations.includes(a.assetKey.replace(/^workstation\./, '')) && a.kind === 'workstation_prompt');
  const tasks = new Set(stationAssets.flatMap(a => strings(a.published?.content.taskKinds)));
  return assets.filter(a => stationAssets.includes(a) || roles.some(r => a.assetKey === `role.${r}`)
    || a.kind === 'skill' && strings(a.published?.content.triggerTaskKinds).some(t => tasks.has(t)));
}
export function FunctionManagement({ units, onDetails, onDirtyChange }: {
  units: RebuildUnit[]; onDetails: (id: string) => void; onDirtyChange: (value: boolean) => void;
}) {
  const functions = units.filter(u => field(u, '功能介绍'));
  const [id, setId] = useState(() => new URL(window.location.href).searchParams.get('function') ?? 'RB-19');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>(() => new URL(window.location.href).searchParams.get('functionView') === 'sample' ? 'sample' : 'overview');
  const [editor, setEditor] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [assets, setAssets] = useState<V7PromptAssetSummary[]>([]);
  const [governance, setGovernance] = useState<V7UnifiedAgentGovernance | null>(null);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState('');
  const unit = functions.find(u => u.id === id) ?? functions[0];
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: Event) => { e.preventDefault(); setError('修改尚未保存，请先保存草稿再切换。'); };
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('wenmi:admin-navigate', guard); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('wenmi:admin-navigate', guard); window.removeEventListener('beforeunload', unload); };
  }, [dirty]);
  useEffect(() => {
    if (editor) return;
    const controller = new AbortController();
    Promise.all([fetchV7PromptAssets({}, controller.signal), fetchV7UnifiedAgentGovernance(controller.signal)])
      .then(([a, g]) => { if (!controller.signal.aborted) { setAssets(a); setGovernance(g); setUpdated(new Date().toLocaleTimeString('zh-CN')); setError(''); } })
      .catch(() => { if (!controller.signal.aborted) setError('实时配置读取失败，已保留上次内容；不能据此判断当前配置未变化。'); });
    return () => controller.abort();
  }, [revision, editor]);
  useEffect(() => {
    const refresh = () => { if (!editor && document.visibilityState === 'visible') setRevision(r => r + 1); };
    const timer = setInterval(refresh, 30_000); window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [editor]);
  function leave(action: () => void) { if (dirty) { setError('修改尚未保存，请先保存草稿再切换。'); return; } action(); setError(''); }
  const choose = (next: string) => leave(() => { setId(next); setView('overview'); setEditor(null); const url = new URL(window.location.href); url.searchParams.set('function', next); window.history.replaceState({}, '', url); });
  if (!unit) return <p role="status">当前版本尚未登记功能管理档案。开发路线保持可查，不推测配置。</p>;
  const relevant = relatedFunctionAssets(unit, assets);
  const roles = governance?.roles.filter(r => list(field(unit, '岗位')).includes(r.roleKey)) ?? [];
  const nodes = readAiNodes(units).filter(n => n.unit.id === unit.id || list(field(unit, '共享步骤')).includes(n.id));
  return <section className="function-manager" aria-label="按功能统一管理">
    <aside className="function-menu"><label>查找功能<input value={query} onChange={e => setQuery(e.target.value)} placeholder="开书、设定、正文…" /></label>
      <nav aria-label="功能目录">{functions.filter(u => `${u.name} ${field(u, '功能介绍')}`.includes(query.trim())).map(u => <button key={u.id} aria-current={u.id === unit.id ? 'page' : undefined} onClick={() => choose(u.id)}>{field(u, '名称') || u.name}</button>)}</nav>
      <small>已登记 {functions.length} 项。后续功能随开发接入；未登记的仍在开发路线查看。</small>
    </aside>
    <div className="function-main"><header><small>功能管理 · {unit.id}</small><h2>{field(unit, '名称') || unit.name}</h2><p>{field(unit, '功能介绍')}</p>
      <p className="function-sync">配置{updated ? `最近读取于 ${updated}` : '正在读取'} · 页面可见时每30秒同步，返回窗口及退出编辑后同步。功能说明随已发布版本更新，历史任务保留当时版本。</p>
      <button onClick={() => leave(() => { setEditor(null); setRevision(r => r + 1); })}>刷新配置</button> <button onClick={() => leave(() => onDetails(unit.id))}>开发路线与变更说明</button></header>
      {error && <p role="alert">{error}</p>}
      <nav className="function-tabs" aria-label="功能管理内容">{([['overview', '功能与完整流程'], ['rules', '岗位、提示词与规则'], ['sample', '实际资料与上下文']] as const).map(([key, name]) => <button key={key} aria-pressed={view === key} onClick={() => leave(() => { setView(key); setEditor(null); })}>{name}</button>)}</nav>
      {view === 'overview' && <>
        <DeliveryScope unit={unit} />
        <section><h3>怎么使用</h3><p>{field(unit, '用户操作')}</p><h3>正常流程</h3><ol className="function-flow">{field(unit, '流程').split(' → ').map((step, i) => <li key={i}>{step}</li>)}</ol></section>
        {['资料供给', '注入与压缩', '格式化输入', '输出与校验', '系统职责', '思考与解释', '调整边界'].map(key => <section key={key}><h3>{key}</h3><p>{field(unit, key) || '当前尚未登记，不能推测。'}</p></section>)}
        <section><h3>每一步与失败分支</h3><p>包含该功能及标明适用范围的共享步骤。失败类型决定是否启动重试；不把轮询、复用成功结果算作模型调用。</p>
          {nodes.map(n => <article className="function-step" key={n.id}><strong>{n.name}</strong><span>{n.kind} · {n.role}</span><p>{n.trigger}</p><small>{n.unit.id === unit.id ? '本功能步骤' : `共享步骤 · ${n.unit.name}`} · {n.id}</small></article>)}
        </section>
      </>}
      {view === 'rules' && <>
        <p>下面读取执行端的已发布资产及成员绑定。岗位和共用规则可能影响多个功能，修改前先查看作用范围。来源范围不代表每项规则都会注入每次任务，实际采用情况见任务样例。</p>
        <div className="function-roles">{roles.map(r => <article key={r.roleKey}><h3>{r.publicName}</h3><p>{r.publicResponsibility}</p><p>交付：{r.outputContract}</p><p>失败：{r.failureContract}</p><ul>{r.members.map(m => <li key={m.memberKey}>{m.displayName} · {m.modelName} · {m.status === 'on_duty' ? '在岗' : m.status === 'unbound' ? '未绑定' : m.status === 'candidate' ? '待验证' : '停岗'}{m.defaultForRole ? ' · 岗位默认' : ''}</li>)}</ul></article>)}</div>
        {!editor ? <section><h3>本功能关联的可编辑规则</h3>{relevant.length ? relevant.map(a => <article className="function-rule" key={a.assetKey}><div><strong>{a.published?.title ?? a.latestDraft?.title ?? a.assetKey}</strong><p>{a.published ? `生效版本 ${a.published.version} · ${a.published.summary}` : '未发布，尚未生效'}{a.latestDraft ? ' · 有草稿' : ''}</p></div><button onClick={() => setEditor(a.assetKey)}>查看与调整</button></article>) : <p>尚无可读取的关联资产；不提供无效编辑入口。</p>}</section>
          : <section><button onClick={() => leave(() => setEditor(null))}>返回规则列表并同步</button><p>编辑通用规则，不修改用户资料。保存草稿后预览，发布后按执行端版本策略生效；历史任务快照保持不变。</p><PromptContextCenter key={`${unit.id}:${editor}`} initialAssetKey={editor} allowedAssetKeys={[editor]} editorOnly workstationKey={list(field(unit, '工位'))[0] ?? 'none'} taskKindFilter={field(unit, '任务类型')} onDirtyChange={setDirty}/></section>}
      </>}
      {view === 'sample' && <FunctionSample key={unit.id} unit={unit} revision={revision} />}
    </div>
  </section>;
}

function FunctionSample({ unit, revision }: { unit: RebuildUnit; revision: number }) {
  const [rows, setRows] = useState<V7PromptManifestSummary[]>([]), [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<V7PromptManifestDetail | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const stations = list(field(unit, '工位')), tasks = list(field(unit, '任务类型'));
  useEffect(() => {
    const c = new AbortController(); setLoading(true); setError('');
    Promise.all(stations.map(workstationKey => fetchV7PromptManifests({ workstationKey, limit: 30 }, c.signal)))
      .then(results => { if (c.signal.aborted) return; const r = results.flat().filter(r => stations.includes(r.workstationKey) && (!tasks.length || tasks.includes(r.taskKind))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); setRows(r); setSelected(s => r.some(x => x.manifestId === s) ? s : r[0]?.manifestId ?? ''); })
      .catch(() => { if (!c.signal.aborted) setError('样例读取失败，可重试；通用规则不受影响。'); }).finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [unit.id, revision]);
  useEffect(() => {
    setDetail(null); if (!selected) return; const c = new AbortController();
    fetchV7PromptManifest(selected, c.signal).then(d => { if (c.signal.aborted) return; if (d.manifest.manifestId !== selected || !stations.includes(d.manifest.workstationKey) || tasks.length && !tasks.includes(d.manifest.taskKind)) throw Error('scope'); setDetail(d); })
      .catch(() => { if (!c.signal.aborted) setError('该样例无法读取或不属于本功能，已停止展示。'); });
    return () => c.abort();
  }, [selected, unit.id]);
  return <section aria-label="功能实际上下文样例"><h3>实际执行样例 · 只读</h3><p>按本功能工位与任务类型读取最近记录，默认最新一条；这是样例，不是管理全部用户资料。字符数不等于Token数，也不代表注意力或质量保证。没有记录时不伪造样例。</p>
    {error && <p role="alert">{error}</p>}{loading ? <p role="status">正在读取本功能样例…</p> : !rows.length ? <p role="status">本功能最近记录中没有可展示的样例。</p> : <label>选择执行样例<select value={selected} onChange={e => { setError(''); setSelected(e.target.value); }}>{rows.map(r => <option key={r.manifestId} value={r.manifestId}>{new Date(r.createdAt).toLocaleString('zh-CN')} · {r.memberKey} · {r.execution.state}</option>)}</select></label>}
    {detail && <><p>本次温度：{detail.manifest.temperature}；资料包预算：{detail.contextPack?.tokenBudget ?? '未记录'} Token；估算用量：{detail.contextPack?.estimatedTokens ?? '未记录'} Token。估算不等于供应商计费用量。</p><h4>本次任务的明确约束</h4><p>必须保留：{detail.taskContract?.mustPreserve.join('；') || '未单独记录，见实际输入'}</p><p>禁止改动：{detail.taskContract?.forbiddenChanges.join('；') || '未单独记录，见实际输入'}</p><details><summary>本次实际输出合同</summary><pre>{JSON.stringify(detail.taskContract?.outputContract ?? {}, null, 2)}</pre></details><MemberInput detail={detail} /></>}
  </section>;
}
