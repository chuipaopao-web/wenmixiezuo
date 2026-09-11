import { useEffect, useMemo, useState } from 'react';
import timeMachineSpec from '../../../docs/TIMEMACHINE_STORY_DESIGN.md?raw';
import { splitSpecDocument, SpecDocumentBody } from './spec-document';
import { fetchTimeMachineRuns, type TimeMachineAdminRun } from './platform-api';
import './agent-workflow.css';

const SPEC_SECTIONS = splitSpecDocument(timeMachineSpec);

function stateLabel(state: string): string {
  if (state === 'queued') return '排队';
  if (state === 'working') return '进行中';
  if (state === 'failed') return '未完成';
  return '已完成';
}

/** 后台时光机：唯一规格同源阅读 + 运行状态/用量，只读脱敏，不在此改配置。 */
export function TimeMachineOpsPage(): React.JSX.Element {
  const [runs, setRuns] = useState<TimeMachineAdminRun[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [stateFilter, setStateFilter] = useState<'' | 'working' | 'queued' | 'failed' | 'succeeded'>('');
  const [specQuery, setSpecQuery] = useState('');
  const [specSelected, setSpecSelected] = useState('all');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchTimeMachineRuns(stateFilter === '' ? undefined : stateFilter);
        if (!cancelled) { setRuns(data.runs); setLoadFailed(false); }
      } catch { if (!cancelled) setLoadFailed(true); }
    };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [stateFilter]);

  const matches = useMemo(() => SPEC_SECTIONS.map((s, i) => ({ ...s, id: String(i) })).filter(s => (s.title + ' ' + s.body).toLowerCase().includes(specQuery.trim().toLowerCase())), [specQuery]);
  const current = matches.find(s => s.id === specSelected) ?? matches[0];
  const visible = specSelected === 'all' ? matches : current !== undefined ? [current] : [];

  return <section className="rhythm-page workflow-page">
    <header><h2>时光机</h2><p>全书方向规格与运行状态同源展示。规格是产品合同，不是运行配置；运行表只含阶段、成员归属与用量，不展示提示词或作品内容。</p></header>
    <section className="rhythm-panel">
      <h3>运行状态</h3>
      <fieldset>
        <label>状态筛选<select aria-label="状态筛选" value={stateFilter} onChange={e => setStateFilter(e.target.value as '' | 'working' | 'queued' | 'failed' | 'succeeded')}>
          <option value="">全部</option><option value="working">进行中</option><option value="queued">排队</option><option value="failed">未完成</option><option value="succeeded">已完成</option>
        </select></label>
      </fieldset>
      {loadFailed && <p role="status">运行状态暂时读取失败，稍后自动重试。</p>}
      {runs !== null && runs.length === 0 && !loadFailed && <p role="status">还没有时光机运行记录。</p>}
      {runs !== null && runs.length > 0 && <div className="workflow-table"><table>
        <thead><tr><th scope="col">书籍</th><th scope="col">轮次/方案</th><th scope="col">编剧</th><th scope="col">状态</th><th scope="col">阶段</th><th scope="col">修订</th><th scope="col">调用</th><th scope="col">用量</th><th scope="col">更新</th></tr></thead>
        <tbody>{runs.map(run => <tr key={run.id}>
          <td>{run.bookTitle ?? run.bookId}{run.kind === 'recommend' ? '（推荐）' : ''}</td>
          <td>{run.roundKey !== null ? `${run.roundKey}${run.scheme !== null ? ' · 方案' + run.scheme : ''}` : '—'}</td>
          <td>{run.writer ?? '—'}</td>
          <td>{stateLabel(run.state)}{run.errorCode !== null ? `（${run.errorCode}）` : ''}</td>
          <td>{run.phase === 'queued' ? '等待成员接手' : run.phase}</td>
          <td>{run.revision !== null ? `第${run.revision}版${run.editedBy === 'author' ? '·作者修改' : ''}${run.reviewPass === false ? '·待核对' : ''}` : '—'}</td>
          <td>{run.calls}{run.failedCalls > 0 ? `（失败${run.failedCalls}）` : ''}</td>
          <td>{run.tokens > 0 ? `${Math.round(run.tokens / 1000)}k` : '—'}</td>
          <td>{run.updatedAt}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    <section className="rhythm-panel"><fieldset><label>搜索规格文档<input aria-label="搜索规格文档" value={specQuery} onChange={e => setSpecQuery(e.target.value)} placeholder="例如：编号、锚点、字数、结算" /></label>
      <label>规格章节<select aria-label="规格章节" value={specSelected} onChange={e => setSpecSelected(e.target.value)}><option value="all">查看全部章节</option>{matches.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label></fieldset>
      <p role="status">共{SPEC_SECTIONS.length}节，匹配{matches.length}节；与仓库 TIMEMACHINE_STORY_DESIGN.md 同源发布。</p>
    </section>
    {visible.map(s => <article className="rhythm-panel workflow-section" key={s.id}><h3>{s.title}</h3><SpecDocumentBody text={s.body} /></article>)}
    {!visible.length && <p role="status">没有匹配章节，请调整关键词。</p>}
  </section>;
}
