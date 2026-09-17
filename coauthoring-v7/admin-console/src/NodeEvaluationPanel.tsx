import { useCallback, useEffect, useState } from 'react';
import { ArrowClockwise, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import {
  fetchV7NodeEvaluations, computeV7NodeRanking, setV7NodePolicy,
  type V7NodeEvaluationView, type V7NodeModelSummary
} from './platform-api';

/**
 * MODEL-NODE-EVAL节点评测视图（合同"后台UI"节）：
 * 每节点直接看到前三、样本数、成功/质量率、median/p95秒、截断/超时、token、准入状态；
 * 未测/进行中/小样本/合格/不达标/暂停分开显示；旧成绩标"版本已变需复测"；
 * 可生成排名（仅保留验证样本）、应用/回滚、手工暂停/复测。复用现有样式类，不新建导航。
 */
export function NodeEvaluationPanel(): React.JSX.Element {
  const [nodes, setNodes] = useState<V7NodeEvaluationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [batchFilter, setBatchFilter] = useState<'1' | '2' | '3' | 'all'>('1');

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchV7NodeEvaluations(signal);
      setNodes(data.nodes);
      setError(null);
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : '节点评测数据暂时无法读取。');
    }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const act = async (key: string, action: () => Promise<unknown>, message: string) => {
    setBusy(key); setError(null); setNotice(null);
    try { await action(); setNotice(message); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作没有完成。'); }
    finally { setBusy(null); }
  };

  if (nodes === null) return <section className="platform-remote-state"><span className="asset-spinner" /><strong>正在读取节点评测</strong><p>{error ?? '正在核对评测记录。'}</p>{error && <button type="button" onClick={() => void load()}><ArrowClockwise />重试</button>}</section>;

  const visible = nodes.filter(n => batchFilter === 'all' || String(n.batch) === batchFilter);
  return <>
    {(notice || error) && <div className={`agent-team-notice ${error ? 'error' : 'success'}`}>{error ? <WarningCircle /> : <CheckCircle />}<span>{error ?? notice}</span></div>}
    <div className="admin-context-filters">
      <label>评测批次<select aria-label="评测批次" value={batchFilter} onChange={e => setBatchFilter(e.target.value as typeof batchFilter)}>
        <option value="1">首批·四类堵点</option><option value="2">第二批·推荐检索自检修订</option><option value="3">第三批·其余节点</option><option value="all">全部节点</option>
      </select></label>
      <button type="button" onClick={() => void load()}><ArrowClockwise />刷新</button>
      <p>成绩来自实时评测记录（tm2_eval_*）；上方"模型速度与准入"是历史静态报告，两者分开，不以静态报告冒充实时成绩。</p>
      <p role="note" className="prompt-context-notice">实验预览/未验收：排名与自动上岗策略未验收，应用与回滚已被服务端禁止（S1-FAST-CLOSE）；当前成绩仅为实验证据，未达标节点如实标"暂无合格成员"。</p>
    </div>
    {visible.map(node => <NodeSection key={node.nodeKey} node={node} busy={busy} act={act} />)}
  </>;
}

const STATE_LABELS: Record<V7NodeModelSummary['state'], string> = {
  untested: '未测', in_progress: '进行中', small_sample: '小样本', qualified: '合格',
  below_threshold: '不达标', suspended: '已暂停', pending_retest: '待复测'
};
const ROLE_LABELS: Record<string, string> = { researcher: '资料编辑', writer: '策划编剧', chief: '主编', reviewer: '审查编辑' };

function NodeSection({ node, busy, act }: {
  node: V7NodeEvaluationView; busy: string | null;
  act: (key: string, action: () => Promise<unknown>, message: string) => Promise<void>;
}): React.JSX.Element {
  const qualified = node.models.filter(m => m.state === 'qualified')
    .toSorted((a, b) => (b.stats?.wilsonLowerBound ?? 0) - (a.stats?.wilsonLowerBound ?? 0));
  const top = qualified.slice(0, 3);
  const others = node.models.filter(m => !top.includes(m));
  return <section className="agent-role-panel">
    <header>
      <div className="agent-role-icon">{node.budgetClass / 1000}k</div>
      <div>
        <span>{ROLE_LABELS[node.memberRole] ?? node.memberRole}岗位 · 提示{node.promptVersion}</span>
        <h2>{node.purpose.split('：')[0]}</h2>
        <p>{node.purpose}</p>
      </div>
      <strong>{node.finishedRuns}/{node.runCount} 批完成</strong>
    </header>
    {node.rankingStale && <p role="alert" className="prompt-context-notice error">排名配置的版本已变，旧成绩需复测后再应用。</p>}
    <div className="agent-policy-grid">
      {top.length === 0 && <article className="agent-member-card"><h3>暂无合格成员</h3><p>没有达到准入门槛的模型；不为凑三名放宽标准。可先用小样本初筛排查协议问题，再补保留验证样本。</p></article>}
      {top.map((model, index) => <ModelCard key={model.modelProfileKey} node={node} model={model} badge={`第${index + 1}名`} busy={busy} act={act} />)}
    </div>
    <details className="agent-prompt-editor"><summary>全部模型成绩（{others.length}）</summary>
      <div className="agent-policy-grid">{others.map(model => <ModelCard key={model.modelProfileKey} node={node} model={model} badge={null} busy={busy} act={act} />)}</div>
    </details>
    <div className="agent-member-actions">
      <button type="button" className="secondary" disabled={busy !== null}
        onClick={() => void act(`compute:${node.nodeKey}`, () => computeV7NodeRanking(node.nodeKey), '已按保留验证样本生成排名草稿（无合格样本会明确报错）')}>
        {busy === `compute:${node.nodeKey}` ? '计算中…' : '按保留验证生成排名'}</button>
      {node.ranking && <>
        <span>排名v{node.ranking.revision}（{node.ranking.status}，{new Date(node.ranking.createdAt).toLocaleString('zh-CN')}）</span>
        {node.ranking.status === 'draft' && <button type="button" disabled title="实验预览/未验收：服务端已禁止应用排名（S1-FAST-CLOSE）">应用排名（未验收已禁用）</button>}
        {node.ranking.status === 'applied' && <button type="button" disabled title="实验预览/未验收：服务端已禁止回滚排名（S1-FAST-CLOSE）">回滚（未验收已禁用）</button>}
      </>}
      {node.latestActivityAt && <span>最近测试 {new Date(node.latestActivityAt).toLocaleString('zh-CN')}</span>}
    </div>
  </section>;
}

function ModelCard({ node, model, badge, busy, act }: {
  node: V7NodeEvaluationView; model: V7NodeModelSummary; badge: string | null; busy: string | null;
  act: (key: string, action: () => Promise<unknown>, message: string) => Promise<void>;
}): React.JSX.Element {
  const s = model.stats;
  return <article className="agent-member-card">
    <h4>{model.publicName}{badge ? ` · ${badge}` : ''}</h4>
    <p><strong>{STATE_LABELS[model.state]}</strong>{s ? ` · n=${s.n}${s.p95SmallSample ? '（小样本估计）' : ''}` : ''}</p>
    {s && <>
      <p>技术交付{(s.technicalDeliveryRate * 100).toFixed(0)}%{s.qualityPassRate !== null ? ` · 质量通过${(s.qualityPassRate * 100).toFixed(0)}%` : ' · 质量未评审'} · Wilson下界{s.wilsonLowerBound.toFixed(3)}</p>
      <p>{s.medianMs !== null ? `median ${(s.medianMs / 1000).toFixed(1)}秒` : 'median —'} · {s.p95Ms !== null ? `p95 ${(s.p95Ms / 1000).toFixed(1)}秒` : 'p95 —'} · 截断{s.truncationCount} · 超时{s.timeoutCount} · 未知{s.unknownCount}</p>
      <p>平均token {s.avgTokens !== null ? Math.round(s.avgTokens) : '未知'} · 总token {s.totalTokens} · 平均重试{s.avgRetries.toFixed(1)}</p>
      {(s.seededErrorRecall !== null || s.cleanFalseAlarmRate !== null) && <p>植入召回{s.seededErrorRecall !== null ? `${(s.seededErrorRecall * 100).toFixed(0)}%` : '—'} · 干净误报{s.cleanFalseAlarmRate !== null ? `${(s.cleanFalseAlarmRate * 100).toFixed(0)}%` : '—'}</p>}
      {s.criticalMissCount > 0 && <p role="alert">关键约束漏失{s.criticalMissCount}次</p>}
    </>}
    {model.admissionReasons.length > 0 && <p>{model.admissionReasons.join('；')}</p>}
    {model.policy && <p>{model.policy.reason}（策略v{model.policy.policyVersion}）</p>}
    {model.state !== 'untested' && model.state !== 'in_progress' && <div className="agent-member-actions">
      {model.state !== 'suspended'
        ? <button type="button" className="danger" disabled={busy !== null} onClick={() => {
            const reason = window.prompt(`暂停${model.publicName}在「${node.purpose.split('：')[0]}」派工的原因（必填）`);
            if (reason) void act(`suspend:${node.nodeKey}:${model.modelProfileKey}`, () => setV7NodePolicy({ nodeKey: node.nodeKey, modelProfileKey: model.modelProfileKey, state: 'suspended', reason }), '已暂停该模型此节点派工');
          }}>暂停派工</button>
        : <button type="button" disabled={busy !== null} onClick={() => {
            const reason = window.prompt('标记待复测的原因（必填）');
            if (reason) void act(`retest:${node.nodeKey}:${model.modelProfileKey}`, () => setV7NodePolicy({ nodeKey: node.nodeKey, modelProfileKey: model.modelProfileKey, state: 'pending_retest', reason }), '已标记待复测');
          }}>标记待复测</button>}
    </div>}
  </article>;
}
