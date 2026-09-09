import { useEffect, useState } from 'react';
import { RHYTHM_CATEGORIES, RHYTHM_LAYERS, renderRhythmFragment, validateRhythmPolicy, RHYTHM_FRAGMENT_LIMIT,
  type RhythmPolicy, type RhythmCard } from '../../backend/planning-methods/rhythm-policy.js';
import type { PlanningLayerKey } from '../../backend/planning-methods/method-asset-profiles.js';
import { COMPLETE_METHOD_CARDS, METHOD_MERGES, ORIGINAL_METHOD_COUNTS } from '../../backend/planning-methods/complete-method-catalog.js';
import { fetchRhythmPolicy, publishRhythmPolicy, previewRhythmPolicy, type RhythmPolicyView } from './platform-api';
import './rhythm-assets.css';
import { AUDITED_METHODS, AUDIT_MERGES } from '../../backend/planning-methods/audited-method-catalog.js';

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
    <header className="rhythm-heading"><div><h2>当前生效的方法配置</h2><p>{saved.policy.format==='audited-v4'?'新任务先读取分类导航，设计成员按需查询、选用或原创；查询页不会累积进最终设计。':'此版本仍为历史完整目录供给；旧任务按冻结版本运行。'}</p><p>当前版本共{draft.cards.length}项。下方目录供管理员查看，不代表一次全部发送给AI。</p></div><span>当前 v{saved.version} · {saved.enabled ? '运行供给已启用' : '运行供给未启用'}</span></header>
    <button type="button" onClick={()=>{if(!dirty||window.confirm('放弃未发布修改并刷新运行记录？'))setRetry(v=>v+1);}}>刷新版本与执行记录</button>
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
      {draft.format==='audited-v4'&&<label>适用说明<textarea value={card.boundary} maxLength={512} disabled={busy} onChange={e=>patchCard({boundary:e.target.value})}/></label>}
      {(draft.format==='audited-v4'?AUDITED_METHODS:COMPLETE_METHOD_CARDS).find(c=>c.key===card.key)?.aliases.map(a=><p key={a.key}>已合并：{a.title}。旧名称和历史引用保留。</p>)}
    </section></div>
    <details className="rhythm-panel rhythm-preview"><summary>查看首次提供的{draft.format==='audited-v4'?'分类导航':'历史目录'} · {preview.length}字符</summary>
      <p>与运行时使用同一编译器；这里只预览资产片段，不包含作者资料或整份任务上下文。{dirty ? '当前为未发布预览。' : '当前为已发布配置预览。'}</p>
      {validation ? <p role="alert" className="rhythm-error">{validation}</p> : <pre>{preview}</pre>}
    </details>
    <section className="rhythm-panel"><h3>成员实际查询与设计记录</h3><p>仅记录真实执行，不是演示。选材完成不代表作者已采用故事；请求字符数是节点输入，最终编译输入和Token可结合运行审计查看。</p>
    {!saved.agentEvents?.length?<p>尚无新查询执行记录。新版本任务运行后显示；不会自动重跑旧任务。</p>:saved.agentEvents.map(e=><details key={`${e.sessionId}:${e.step}`}><summary>{e.memberKey} · {({completed:'已提交设计',queried:'已查询方法',selected:'已选择方法',repair:'正在修正动作',failed:'未完成',selection_required:'待确认选择'} as Record<string,string>)[e.event.state]??'处理中'} · v{e.policyVersion} · {new Date(e.createdAt).toLocaleString('zh-CN')}</summary><p>层级：{RHYTHM_LAYERS[e.layer as PlanningLayerKey]?.label??e.layer}；累计查询{e.event.calls??0}次；请求{e.event.promptCharacters??'—'}字符；输入/输出Token：{e.event.inputTokens??'—'}/{e.event.outputTokens??'—'}</p>{e.event.selected?.map(s=><p key={s.id}>{saved.policy.cards.find(c=>c.key===s.id)?.title??s.id}：{s.application}</p>)}{e.event.results&&<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(e.event.results,null,2)}</pre>}<p>请求：{e.event.requestId??'—'}</p></details>)}
    </section>
    <section className="rhythm-panel"><h3>上下层怎样嵌套</h3><p>全书给方向，卷完成阶段责任，链推进事件，章落实场景。下层只承接相关目标、当前状态和不能提前完成的内容；不复制上层整份上下文，不要求每层都套相同结构。</p><p>前端“四节拍”对应“起承转合：起因—过程—转折—合拢”；阶段不绑定固定卷数。作者节拍选择页面待后续开发，本页管理方法供给。</p></section>
    <details className="rhythm-panel rhythm-preview"><summary>查看同义合并记录 · {(draft.format==='audited-v4'?AUDIT_MERGES:METHOD_MERGES).length}项</summary>{(draft.format==='audited-v4'?AUDIT_MERGES:METHOD_MERGES).map(m=><p key={m.from}>{(draft.format==='audited-v4'?AUDITED_METHODS:COMPLETE_METHOD_CARDS).find(c=>c.key===m.to)?.aliases.find(a=>a.key===m.from)?.title} → {draft.cards.find(c=>c.key===m.to)?.title}：{m.reason}</p>)}<p>用途不同的方法继续分别保留。原定义仍可供历史任务读取。</p></details>
    <footer className="rhythm-actions"><span>{dirty ? '有未发布修改' : '配置已保存'}</span><button disabled={busy || !dirty} onClick={() => { setDraft(structuredClone(saved.policy)); setError(''); setNotice('已放弃未发布修改。'); }}>放弃修改</button><button disabled={busy || !dirty || !!validation} onClick={() => void publish()}>{busy ? '正在发布…' : '发布共用配置'}</button></footer>
    <section className="rhythm-history"><h3>版本与使用</h3><p>历史任务不随新配置变化。次数是冻结过资产版本的任务数，不代表文学效果通过。</p>{saved.history.map(v => <p key={v.version}>v{v.version} · {new Date(v.createdAt).toLocaleString('zh-CN')} · {saved.usage.find(u => u.version === v.version)?.tasks ?? 0}项任务</p>)}</section>
  </section>;
}
