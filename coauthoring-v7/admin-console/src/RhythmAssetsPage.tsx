import { useEffect, useState } from 'react';
import { RHYTHM_CATEGORIES, RHYTHM_LAYERS, renderRhythmFragment, validateRhythmPolicy, RHYTHM_FRAGMENT_LIMIT,
  type RhythmPolicy, type RhythmCard } from '../../backend/planning-methods/rhythm-policy.js';
import type { PlanningLayerKey } from '../../backend/planning-methods/method-asset-profiles.js';
import { COMPLETE_METHOD_CARDS, METHOD_MERGES, ORIGINAL_METHOD_COUNTS } from '../../backend/planning-methods/complete-method-catalog.js';
import { fetchRhythmPolicy, publishRhythmPolicy, previewRhythmPolicy, type RhythmPolicyView } from './platform-api';
import './rhythm-assets.css';

export function RhythmAssetsPage(): React.JSX.Element {
  const [saved, setSaved] = useState<RhythmPolicyView | null>(null);
  const [draft, setDraft] = useState<RhythmPolicy | null>(null);
  const [layer, setLayer] = useState<PlanningLayerKey>('book_backbone');
  const [selected, setSelected] = useState('four-act');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [query,setQuery]=useState('');
  const [kind,setKind]=useState('all');
  const [page,setPage]=useState(0);
  const dirty = !!saved && !!draft && JSON.stringify(saved.policy) !== JSON.stringify(draft);
  useEffect(() => {
    const abort = new AbortController();
    void fetchRhythmPolicy(abort.signal).then(data => { setSaved(data); setDraft(structuredClone(data.policy)); setError(''); })
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '读取失败，请重试。'); });
    return () => abort.abort();
  }, [retry]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent): void => { if (dirty) e.preventDefault(); };
    const navigate = (e: Event): void => {
      if (dirty && !window.confirm('方法介绍有未发布的修改。放弃这些修改并切换栏目？')) e.preventDefault();
    };
    window.addEventListener('beforeunload', unload); window.addEventListener('wenmi:admin-navigate', navigate);
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('wenmi:admin-navigate', navigate); };
  }, [dirty]);
  if (!saved || !draft) return <section className="rhythm-page"><h2>节奏资产</h2><p role={error ? 'alert' : 'status'}>{error || '正在读取共用配置…'}</p>{error && <button onClick={() => setRetry(v => v + 1)}>重新读取</button>}</section>;
  const layerCards=draft.cards.filter(c=>draft.layers[layer].includes(c.key));
  const card = layerCards.find(c => c.key === selected) ?? layerCards[0]!;
  const filtered=layerCards.filter(c=>(kind==='all'||c.assetType===kind) &&
    [c.title,c.instruction,...(COMPLETE_METHOD_CARDS.find(m=>m.key===c.key)?.aliases.map(a=>a.title)??[])].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const pageCount=Math.max(1,Math.ceil(filtered.length/24));
  const pageIndex=Math.min(page,pageCount-1);
  const visible=filtered.slice(pageIndex*24,(pageIndex+1)*24);
  const kindNames={narrative_method:'叙事方法',plot_pattern:'剧情模式',plot_recipe:'组合配方'};
  let preview = '', validation = '';
  try { validateRhythmPolicy(draft); preview = renderRhythmFragment(draft, layer, saved.version + (dirty ? 1 : 0)); }
  catch (e) { validation = e instanceof Error ? e.message : '请检查配置。'; }
  const patchCard = (patch: Partial<RhythmCard>): void => { setDraft({ ...draft, cards: draft.cards.map(c => c.key === card.key ? { ...c, ...patch } : c) }); setNotice(''); };
  const publish = async (): Promise<void> => {
    if (busy || validation) return;
    setBusy(true); setError('');
    try {
      await previewRhythmPolicy(draft);
      const result = await publishRhythmPolicy(saved.version, draft);
      setSaved(result); setDraft(structuredClone(result.policy)); setNotice(`版本 ${result.version} 已发布，新任务首次编译资产时使用；已冻结任务保持原版。`);
    } catch (e) { setError(e instanceof Error ? e.message : '发布失败，修改已保留。'); }
    finally { setBusy(false); }
  };
  return <section className="rhythm-page">
    <header className="rhythm-heading"><div><h2>分层方法库</h2><p>本层适用的方法全部提供，成员按故事需要选择搭配，无需勾选。</p><p>原库{ORIGINAL_METHOD_COUNTS.methods}种方法、{ORIGINAL_METHOD_COUNTS.patterns}种模式、{ORIGINAL_METHOD_COUNTS.recipes}种配方；合并{METHOD_MERGES.length}项同义内容，共{draft.cards.length}项。</p></div><span>当前 v{saved.version} · {saved.enabled ? '运行供给已启用' : '运行供给未启用'}</span></header>
    {error && <p role="alert" className="rhythm-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <nav className="rhythm-tabs" aria-label="节奏供给层">{Object.entries(RHYTHM_LAYERS).filter(([key])=>key!=='volume_distribution').map(([key, value]) => <button key={key} aria-pressed={layer === key} onClick={() => {setLayer(key as PlanningLayerKey);setPage(0);}}>{value.label}</button>)}</nav>
    <p>{RHYTHM_LAYERS[layer].responsibility}</p>
    <div className="rhythm-columns"><section className="rhythm-panel"><h3>本层可用 · {draft.layers[layer].length}项</h3>
      <fieldset><label>查找方法<input value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="名称、简介或合并前名称" /></label>
      <label>内容类别<select value={kind} onChange={e=>{setKind(e.target.value);setPage(0);}}><option value="all">全部</option>{Object.entries(kindNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></fieldset>
      <p>找到{filtered.length}项 · 第{pageIndex+1}/{pageCount}页</p>
      {visible.map(c=><div className="rhythm-card-row" key={c.key}><button aria-pressed={card.key===c.key} onClick={()=>setSelected(c.key)}><small>{kindNames[c.assetType]}</small><strong style={{display:'block'}}>{c.title}</strong><span style={{display:'block',fontWeight:400}}>{c.instruction}</span></button></div>)}
      {!visible.length&&<p role="status">没有匹配内容，请换个名称或清空搜索。</p>}
      <nav className="rhythm-tabs" aria-label="方法分页"><button disabled={pageIndex===0} onClick={()=>setPage(pageIndex-1)}>上一页</button><button disabled={pageIndex===pageCount-1} onClick={()=>setPage(pageIndex+1)}>下一页</button></nav>
    </section><section className="rhythm-panel"><h3>方法说明</h3><p>{kindNames[card.assetType]} · {RHYTHM_CATEGORIES[card.category]}。修改名称或简介后发布，各层同步使用新版本。</p>
      <fieldset disabled={busy}><label>名称<input value={card.title} maxLength={30} onChange={e => patchCard({ title: e.target.value })} /></label>
      <label>简短介绍<textarea aria-label="简短介绍" value={card.instruction} maxLength={120} onChange={e => patchCard({ instruction: e.target.value })} /></label><small>{card.instruction.length}/120字符</small></fieldset>
      {COMPLETE_METHOD_CARDS.find(c=>c.key===card.key)?.aliases.map(a=><p key={a.key}>已合并：{a.title}。旧名称和历史引用保留。</p>)}
    </section></div>
    <details className="rhythm-panel rhythm-preview"><summary>查看AI收到的完整目录 · {preview.length}/{RHYTHM_FRAGMENT_LIMIT}字符</summary>
      <p>与运行时使用同一编译器；这里只预览资产片段，不包含作者资料或整份任务上下文。{dirty ? '当前为未发布预览。' : '当前为已发布配置预览。'}</p>
      {validation ? <p role="alert" className="rhythm-error">{validation}</p> : <pre>{preview}</pre>}
    </details>
    <section className="rhythm-panel"><h3>上下层怎样嵌套</h3><p>全书给方向，卷完成阶段责任，链推进事件，章落实场景。下层只承接相关目标、当前状态和不能提前完成的内容；不复制上层整份上下文，不要求每层都套相同结构。</p><p>前端“四节拍”对应“起承转合：起因—过程—转折—合拢”；阶段不绑定固定卷数。作者节拍选择页面待后续开发，本页管理方法供给。</p></section>
    <details className="rhythm-panel rhythm-preview"><summary>查看同义合并记录 · {METHOD_MERGES.length}项</summary>{METHOD_MERGES.map(m=><p key={m.from}>{COMPLETE_METHOD_CARDS.find(c=>c.key===m.to)?.aliases.find(a=>a.key===m.from)?.title} → {COMPLETE_METHOD_CARDS.find(c=>c.key===m.to)?.title}：{m.reason}</p>)}<p>多线并进与多线汇流、结构原则与组合配方等用途不同，继续分别保留。原定义仍可供历史任务读取。</p></details>
    <footer className="rhythm-actions"><span>{dirty ? '有未发布修改' : '配置已保存'}</span><button disabled={busy || !dirty} onClick={() => { setDraft(structuredClone(saved.policy)); setError(''); setNotice('已放弃未发布修改。'); }}>放弃修改</button><button disabled={busy || !dirty || !!validation} onClick={() => void publish()}>{busy ? '正在发布…' : '发布共用配置'}</button></footer>
    <section className="rhythm-history"><h3>版本与使用</h3><p>历史任务不随新配置变化。次数是冻结过资产版本的任务数，不代表文学效果通过。</p>{saved.history.map(v => <p key={v.version}>v{v.version} · {new Date(v.createdAt).toLocaleString('zh-CN')} · {saved.usage.find(u => u.version === v.version)?.tasks ?? 0}项任务</p>)}</section>
  </section>;
}
