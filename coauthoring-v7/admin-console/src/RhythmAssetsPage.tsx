import { useEffect, useState } from 'react';
import { RHYTHM_CATEGORIES, RHYTHM_LAYERS, renderRhythmFragment, validateRhythmPolicy, RHYTHM_FRAGMENT_LIMIT,
  type RhythmPolicy, type RhythmCard } from '../../backend/planning-methods/rhythm-policy.js';
import type { PlanningLayerKey } from '../../backend/planning-methods/method-asset-profiles.js';
import { fetchRhythmPolicy, publishRhythmPolicy, previewRhythmPolicy, type RhythmPolicyView } from './platform-api';
import './rhythm-assets.css';

export function RhythmAssetsPage(): React.JSX.Element {
  const [saved, setSaved] = useState<RhythmPolicyView | null>(null);
  const [draft, setDraft] = useState<RhythmPolicy | null>(null);
  const [layer, setLayer] = useState<PlanningLayerKey>('book_backbone');
  const [selected, setSelected] = useState('single-core-line');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const dirty = !!saved && !!draft && JSON.stringify(saved.policy) !== JSON.stringify(draft);
  useEffect(() => {
    const abort = new AbortController();
    void fetchRhythmPolicy(abort.signal).then(data => { setSaved(data); setDraft(structuredClone(data.policy)); setError(''); })
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '读取失败，请重试。'); });
    return () => abort.abort();
  }, [retry]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent): void => { if (dirty) e.preventDefault(); };
    const navigate = (e: Event): void => { if (dirty) { e.preventDefault(); setError('还有未发布的修改，请发布或放弃修改后再离开。'); } };
    window.addEventListener('beforeunload', unload); window.addEventListener('wenmi:admin-navigate', navigate);
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('wenmi:admin-navigate', navigate); };
  }, [dirty]);
  if (!saved || !draft) return <section className="rhythm-page"><h2>节奏资产</h2><p role={error ? 'alert' : 'status'}>{error || '正在读取共用配置…'}</p>{error && <button onClick={() => setRetry(v => v + 1)}>重新读取</button>}</section>;
  const card = draft.cards.find(c => c.key === selected) ?? draft.cards[0]!;
  let preview = '', validation = '';
  try { validateRhythmPolicy(draft); preview = renderRhythmFragment(draft, layer, saved.version + (dirty ? 1 : 0)); }
  catch (e) { validation = e instanceof Error ? e.message : '请检查配置。'; }
  const patchCard = (patch: Partial<RhythmCard>): void => { setDraft({ ...draft, cards: draft.cards.map(c => c.key === card.key ? { ...c, ...patch } : c) }); setNotice(''); };
  const toggle = (key: string): void => { const current = draft.layers[layer]; setDraft({ ...draft, layers: { ...draft.layers,
    [layer]: current.includes(key) ? current.filter(k => k !== key) : [...current, key] } }); setNotice(''); };
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
    <header className="rhythm-heading"><div><h2>节奏资产</h2><p>管理全书到章的少量候选短卡。完整理论留在资产目录，不随任务整库发送。</p></div><span>当前 v{saved.version} · {saved.enabled ? '运行供给已启用' : '运行供给未启用'}</span></header>
    {error && <p role="alert" className="rhythm-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <nav className="rhythm-tabs" aria-label="节奏供给层">{Object.entries(RHYTHM_LAYERS).map(([key, value]) => <button key={key} aria-pressed={layer === key} onClick={() => setLayer(key as PlanningLayerKey)}>{value.label}</button>)}</nav>
    <p>{RHYTHM_LAYERS[layer].responsibility}</p>
    <div className="rhythm-columns"><section className="rhythm-panel"><h3>本层候选 · {draft.layers[layer].length}/6</h3><p>勾选表示提供参考，不代表模型必须使用。按类别查找，点击名称编辑。</p>
      {Object.entries(RHYTHM_CATEGORIES).map(([key, label]) => <div key={key} className="rhythm-category"><h4>{label}</h4>{draft.cards.filter(c => c.category === key).map(c => <div className="rhythm-card-row" key={c.key}>
        <label><input type="checkbox" disabled={busy} checked={draft.layers[layer].includes(c.key)} onChange={() => toggle(c.key)} /><span className="sr-only">提供{c.title}</span></label>
        <button aria-pressed={card.key === c.key} onClick={() => setSelected(c.key)}>{c.title}</button>
      </div>)}</div>)}
    </section><section className="rhythm-panel"><h3>编辑短卡</h3><p>修改共用短卡会影响选用它的各层；发布前可逐层预览。</p>
      <fieldset disabled={busy}><label>名称<input value={card.title} maxLength={30} onChange={e => patchCard({ title: e.target.value })} /></label>
      <label>用途分类<select value={card.category} onChange={e => patchCard({ category: e.target.value as RhythmCard['category'] })}>{Object.entries(RHYTHM_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>给 AI 的短指令<textarea value={card.instruction} maxLength={120} onChange={e => patchCard({ instruction: e.target.value })} /></label><small>{card.instruction.length}/120字符</small>
      <label>使用边界<textarea value={card.boundary} maxLength={100} onChange={e => patchCard({ boundary: e.target.value })} /></label><small>{card.boundary.length}/100字符</small></fieldset>
    </section></div>
    <section className="rhythm-panel rhythm-preview"><h3>AI 接收的资产片段 · {preview.length}/{RHYTHM_FRAGMENT_LIMIT}字符</h3>
      <p>与运行时使用同一编译器；这里只预览资产片段，不包含作者资料或整份任务上下文。{dirty ? '当前为未发布预览。' : '当前为已发布配置预览。'}</p>
      {validation ? <p role="alert" className="rhythm-error">{validation}</p> : <pre>{preview}</pre>}
    </section>
    <footer className="rhythm-actions"><span>{dirty ? '有未发布修改' : '配置已保存'}</span><button disabled={busy || !dirty} onClick={() => { setDraft(structuredClone(saved.policy)); setError(''); setNotice('已放弃未发布修改。'); }}>放弃修改</button><button disabled={busy || !dirty || !!validation} onClick={() => void publish()}>{busy ? '正在发布…' : '发布共用配置'}</button></footer>
    <section className="rhythm-history"><h3>版本与使用</h3><p>历史任务不随新配置变化。次数是冻结过资产版本的任务数，不代表文学效果通过。</p>{saved.history.map(v => <p key={v.version}>v{v.version} · {new Date(v.createdAt).toLocaleString('zh-CN')} · {saved.usage.find(u => u.version === v.version)?.tasks ?? 0}项任务</p>)}</section>
  </section>;
}
