import { CaretDown, CircleNotch, ClockCounterClockwise, Robot, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchV7CreationAdminAudit,
  fetchV7CreationAdminTasks,
  fetchV7PlanningAdminAudit,
  fetchV7PlanningAdminTasks,
  type V7CreationAdminAudit,
  type V7CreationAdminTask,
  type V7PlanningAdminAudit,
  type V7PlanningAdminTask
} from './platform-api';

export function CreationOperationsPage(): React.JSX.Element {
  const [tasks, setTasks] = useState<V7CreationAdminTask[]>([]);
  const [planningTasks, setPlanningTasks] = useState<V7PlanningAdminTask[]>([]);
  const [audit, setAudit] = useState<Record<string, V7CreationAdminAudit>>({});
  const [planningAudit, setPlanningAudit] = useState<Record<string, V7PlanningAdminAudit>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([fetchV7CreationAdminTasks(controller.signal), fetchV7PlanningAdminTasks(controller.signal)]).then(([creation, planning]) => {
      setTasks(creation); setPlanningTasks(planning);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : '创作运行记录暂时无法读取。');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  const metrics = useMemo(() => ({
    active: tasks.filter((task) => ['queued', 'working', 'awaiting_author'].includes(task.status)).length
      + planningTasks.filter((task) => ['waiting', 'working', 'waiting_for_you'].includes(task.status)).length,
    failed: tasks.filter((task) => ['failed', 'partially_failed', 'unknown'].includes(task.status) || task.failedUpdates > 0).length
      + planningTasks.filter((task) => task.status === 'failed').length,
    calls: tasks.reduce((sum, task) => sum + task.modelCalls, 0)
      + planningTasks.reduce((sum, task) => sum + task.modelCalls, 0),
    updates: tasks.reduce((sum, task) => sum + task.pendingUpdates, 0)
  }), [planningTasks, tasks]);

  const loadAudit = async (task: V7CreationAdminTask): Promise<void> => {
    if (audit[task.workflowId] !== undefined) return;
    try {
      const result = await fetchV7CreationAdminAudit(task);
      setAudit((current) => ({ ...current, [task.workflowId]: result }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '任务审计暂时无法读取。');
    }
  };

  const loadPlanningAudit = async (task: V7PlanningAdminTask): Promise<void> => {
    if (planningAudit[task.taskId] !== undefined) return;
    try {
      const result = await fetchV7PlanningAdminAudit(task);
      setPlanningAudit((current) => ({ ...current, [task.taskId]: result }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '规划审计暂时无法读取。');
    }
  };

  if (loading) return <section className="creation-ops-state"><CircleNotch className="spin"/><strong>正在读取创作总线…</strong></section>;
  return <section className="creation-ops-page">
    <header className="creation-ops-heading"><div><small>创作运行</small><h2>全书规划与正文任务总线</h2><p>查看真实成员调用、写后更新和失败交接；提示词与正文不在列表泄漏。</p></div></header>
    {error !== null && <div className="creation-ops-error"><WarningCircle/>{error}</div>}
    <div className="creation-ops-metrics"><Metric label="当前进行" value={metrics.active}/><Metric label="需要处理" value={metrics.failed}/><Metric label="成员调用" value={metrics.calls}/><Metric label="等待更新" value={metrics.updates}/></div>
    <div className="creation-ops-list">{planningTasks.map((task) => <details key={task.taskId} onToggle={(event) => { if (event.currentTarget.open) void loadPlanningAudit(task); }}>
      <summary><span className={`creation-ops-dot state-${task.status}`} /><span><strong>{task.bookTitle}</strong><small>{planningStageName(task)} · {formatTime(task.updatedAt)}</small></span><span className="creation-ops-members"><Robot/>{task.memberName ?? '等待派单'}</span><span className={`creation-ops-status state-${task.status}`}>{statusName(task.status)}</span><CaretDown/></summary>
      <div className="creation-ops-detail"><dl><div><dt>作者范围</dt><dd>{task.ownerId}</dd></div><div><dt>书籍范围</dt><dd>{task.bookId}</dd></div><div><dt>规划范围</dt><dd>{task.treeKind === null ? '全书路线' : `${task.treeKind} / ${task.scopeId ?? '-'}`}</dd></div><div><dt>真实进度</dt><dd>{task.progress}%</dd></div><div><dt>当前成员</dt><dd>{task.memberName ?? '尚未派单'}</dd></div><div><dt>状态说明</dt><dd>{task.message}</dd></div></dl><PlanningAuditDetail value={planningAudit[task.taskId]} /></div>
    </details>)}{tasks.length === 0 && planningTasks.length === 0 ? <div className="creation-ops-state"><ClockCounterClockwise/><strong>还没有V7创作任务</strong></div> : tasks.map((task) => <details key={task.workflowId} onToggle={(event) => { if (event.currentTarget.open) void loadAudit(task); }}>
      <summary><span className={`creation-ops-dot state-${task.status}`} /><span><strong>{task.bookTitle}</strong><small>{stageName(task.stage)} · {formatTime(task.updatedAt)}</small></span><span className="creation-ops-members"><Robot/>{task.memberKeys.length}名成员</span><span className={`creation-ops-status state-${task.status}`}>{statusName(task.status)}</span><CaretDown/></summary>
      <div className="creation-ops-detail"><dl><div><dt>书籍范围</dt><dd>{task.bookId}</dd></div><div><dt>卷 / 链</dt><dd>{task.volumeScopeId} / {task.chainScopeId ?? '尚未进入'}</dd></div><div><dt>模型调用</dt><dd>{task.modelCalls} 次（失败 {task.failedCalls}）</dd></div><div><dt>Token</dt><dd>{(task.inputTokens + task.outputTokens).toLocaleString('zh-CN')}</dd></div><div><dt>写后更新</dt><dd>等待 {task.pendingUpdates} · 异常 {task.failedUpdates}</dd></div><div><dt>成员</dt><dd>{task.memberKeys.join('、') || '尚未派单'}</dd></div></dl><AuditDetail value={audit[task.workflowId]} /></div>
    </details>)}</div>
  </section>;
}

function PlanningAuditDetail({ value }: { value: V7PlanningAdminAudit | undefined }): React.JSX.Element {
  if (value === undefined) return <div className="creation-ops-audit"><CircleNotch className="spin"/>正在整理成员调用记录…</div>;
  const tokens = value.calls.reduce((sum, call) => sum + (call.input_tokens ?? 0) + (call.output_tokens ?? 0), 0);
  return <section className="creation-ops-audit">
    <ContextPlanSummary value={value.contextPlan ?? null} />
    <strong>成员调用</strong><span>{value.calls.length} 次 · {tokens.toLocaleString('zh-CN')} Token</span>{value.calls.map((call, index) => <article key={`${call.member_key}-${index}`}><b>{call.member_key}</b><small>{call.state}{call.failure_message === null ? '' : ` · ${call.failure_message}`}</small></article>)}
  </section>;
}

function AuditDetail({ value }: { value: V7CreationAdminAudit | undefined }): React.JSX.Element {
  if (value === undefined) return <div className="creation-ops-audit"><CircleNotch className="spin"/>正在整理审计记录…</div>;
  // 独立后台和API允许分服务滚动更新。旧API响应尚未包含新审计数组时，
  // 必须保留基础写后记录，不能因前端先更新而把整个页面打白。
  const calls = value.creation.calls ?? [];
  const contextPacks = value.creation.contextPacks ?? [];
  const options = value.creation.options ?? [];
  const outlineCandidates = value.creation.outlineCandidates ?? [];
  const tokens = calls.reduce((sum, call) => sum + (call.input_tokens ?? 0) + (call.output_tokens ?? 0), 0);
  const activeOutlineCandidates = outlineCandidates.filter((item) => item.lifecycle !== 'superseded').length;
  const requestedCandidateCount = value.creation.requestedCandidateCount ?? 1;
  return <section className="creation-ops-audit">
    <strong>本轮生成</strong>
    <span>请求 {requestedCandidateCount} 套 · 卷链方案 {options.length} 套 · 章纲方案 {activeOutlineCandidates} 套</span>
    <article><b>资料包</b><small>{contextPacks.length} 份 · {contextPacks.reduce((sum, item) => sum + item.content_characters, 0).toLocaleString('zh-CN')} 字符</small></article>
    {contextPacks.map((pack) => <ContextPackSummary key={pack.context_pack_id} value={pack} />)}
    <article><b>成员调用</b><small>{calls.length} 次 · {tokens.toLocaleString('zh-CN')} Token</small></article>
    {calls.map((call) => <article key={call.request_id}><b>{call.member_key}</b><small>{runKindName(call.run_kind)} · {call.state}{call.failure_message === null ? '' : ` · ${call.failure_message}`}</small></article>)}
    <strong>写后维护</strong><span>{value.writeBack.completed}/{value.writeBack.total} 已完成</span>
    {value.writeBack.tasks.map((task) => <article key={task.taskId}><b>{task.task}</b><small>{task.message} · 尝试 {task.attempts} 次</small></article>)}
  </section>;
}

function ContextPlanSummary({ value }: { value: V7PlanningAdminAudit['contextPlan'] }): React.JSX.Element {
  const request = value?.request;
  if (request === undefined) return <article><b>资料策划</b><small>旧任务没有结构化资料策划记录</small></article>;
  return <details className="creation-ops-context"><summary><b>资料策划</b><small>{request.taskPersona?.publicLabel ?? '本任务临时题材身份'} · 菜单{value?.assetMenu?.allowedKeys?.length ?? 0} 项资产</small><CaretDown/></summary><dl>
    <div><dt>任务身份</dt><dd>{request.taskPersona?.workingIdentity ?? request.taskPersona?.publicLabel ?? '未记录'}</dd></div>
    <div><dt>本轮责任</dt><dd>{request.taskResponsibilities?.join('；') || '未记录'}</dd></div>
    <div><dt>创意空间</dt><dd>{request.creativeSpace?.join('；') || '未记录'}</dd></div>
    <div><dt>检索目标</dt><dd>{request.publicGoal ?? '未记录'}</dd></div>
  </dl></details>;
}

function ContextPackSummary({ value }: { value: NonNullable<V7CreationAdminAudit['creation']['contextPacks']>[number] }): React.JSX.Element {
  const summary = value.context_summary;
  return <details className="creation-ops-context"><summary><b>{contextTaskName(value.task_kind)}资料包</b><small>{summary === undefined ? value.status : `${summary.characterCount}/${summary.budgetChars} 字符 · ${summary.methodPlan.assetMenuVersion === null ? '无资产菜单' : `资产菜单${summary.methodPlan.assetMenuChars}字符`}`}</small><CaretDown/></summary>
    {summary === undefined ? <p>这份旧资料包没有结构化摘要。</p> : <dl>
      <div><dt>任务身份</dt><dd>{summary.taskPersona.workingIdentity}</dd></div>
      <div><dt>本轮责任</dt><dd>{summary.taskResponsibilities.join('；')}</dd></div>
      <div><dt>创意空间</dt><dd>{summary.creativeSpace.join('；')}</dd></div>
      <div><dt>方法策略</dt><dd>{methodModeName(summary.methodPlan.mode)} · {summary.methodPlan.publicSummary}</dd></div>
      <div><dt>资料选择</dt><dd>采用 {summary.selectedSources.length} 项 · 排除 {summary.excludedSources.length} 项 · 约 {summary.estimatedTokens.toLocaleString('zh-CN')} 字元</dd></div>
    </dl>}
  </details>;
}

function methodModeName(value: 'asset' | 'combined' | 'original' | 'none'): string {
  return ({ asset: '采用资产方法', combined: '组合资产与原创', original: '本轮原创', none: '不需要创作方法' } as const)[value];
}

function contextTaskName(value: string): string {
  return ({ volume: '本卷', chain: '单元链', outline: '章纲', manuscript: '正文', review: '审查', settlement: '写后结算' } as Record<string, string>)[value] ?? '创作';
}

function runKindName(value: string): string {
  return ({ context: '资料整理', option: '方案设计', option_review: '方案点评', outline: '章纲', manuscript: '正文', review: '独立审查', settlement: '定稿结算' } as Record<string, string>)[value] ?? value;
}

function Metric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return <article><strong>{value.toLocaleString('zh-CN')}</strong><span>{label}</span></article>;
}

function stageName(value: string): string {
  if (value.startsWith('volume') || value === 'context_selection') return '本卷设计';
  if (value.startsWith('chain')) return '单元链设计';
  if (value.includes('outline')) return '章纲';
  if (value.includes('manuscript')) return '正文';
  if (value === 'settlement') return '写后维护';
  return '已完成';
}
function planningStageName(task: V7PlanningAdminTask): string {
  if (task.taskKind === 'planning_route') return '全书路线';
  if (task.treeKind === 'book') return '全书框架';
  if (task.treeKind === 'volume') return '本卷框架';
  return '单元链框架';
}
function statusName(value: string): string {
  return ({ queued: '排队', waiting: '马上开始', working: '工作中', awaiting_author: '等作者', waiting_for_you: '等作者', ready: '等作者', succeeded: '完成', completed: '完成', partially_failed: '部分失败', failed: '失败', unknown: '结果待核对', cancelled: '已停止' } as Record<string, string>)[value] ?? value;
}
function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '刚刚' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
