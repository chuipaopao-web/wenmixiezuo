import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, Check, FloppyDisk, MagnifyingGlass, X } from '@phosphor-icons/react';
import type { AuthAccountData } from '../../lib/api/client';
import { FeatureCapabilitiesPage } from './FeatureCapabilitiesPage';
import {
  activateCreativeTemplateVersion, addAdminAiMember, archivePromptOverride, createCreativeTemplateVersion, fetchAdminUsersPage, fetchAiGovernance, fetchDashboard, fetchIssues, fetchMembershipStats,
  fetchMembershipUsers, fetchModelScheme, fetchNarrativeMethods, fetchPromptCall, fetchPromptCalls,
  fetchPromptCatalog, fetchRuntimeSystemPrompt, fetchUsage, fetchUserOperations, grantMembership, revokeMembership,
  saveModelScheme, saveNarrativeMethod, savePromptOverride, setAdminUserStatus, setCreativeTemplateRollout, updateAdminAiMember, updateIssue,
  type AdminAiGovernanceData, type AdminDashboardData, type AdminIssue, type AdminMembershipUser, type AdminModelScheme,
  type AdminSection, type AdminUsageData, type AdminUser, type AdminUserOperationsData, type MembershipStats, type NarrativeMethod,
  type NarrativeMethodContent, type PromptCall, type PromptCatalogData
} from './admin-api';

interface PageProps { onError: (message: string | null) => void }

export function AdminPages({ section, searchSeed, currentUser, onError }: {
  section: AdminSection; searchSeed: string; currentUser: AuthAccountData; onError: (message: string | null) => void;
}): React.JSX.Element {
  if (section === 'dashboard') return <DashboardPage onError={onError} />;
  if (section === 'users') return <UsersPage currentUser={currentUser} searchSeed={searchSeed} onError={onError} />;
  if (section === 'compute') return <UsagePage mode="compute" onError={onError} />;
  if (section === 'api') return <UsagePage mode="api" onError={onError} />;
  if (section === 'models') return <ModelsPage onError={onError} />;
  if (section === 'issues') return <IssuesPage searchSeed={searchSeed} onError={onError} />;
  if (section === 'templates') return <TemplatesPage onError={onError} />;
  if (section === 'prompts') return <PromptsPage onError={onError} />;
  if (section === 'memberships') return <MembershipsPage onError={onError} />;
  return <FeatureCapabilitiesPage onError={onError} />;
}

function DashboardPage({ onError }: PageProps): React.JSX.Element {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (signal?: AbortSignal) => {
    try { setData(await fetchDashboard(signal)); onError(null); } catch (reason) { if (!signal?.aborted) onError(errorText(reason)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [onError]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  if (loading) return <PageLoading label="正在读取运营数据…" />;
  if (data === null) return <PageEmpty title="运营数据暂时不可用" action="重新加载" onAction={() => { setLoading(true); void load(); }} />;
  const maxTrend = Math.max(...data.trend.map((item) => item.compute), 1);
  return <div className="admin-page admin-dashboard-page">
    <PageHeading title="运营总览" description="先处理失败任务，再看成本、会员与高消耗用户。" action={<button type="button" className="quiet" onClick={() => void load()}><ArrowClockwise />刷新</button>} />
    <section className="admin-metrics" aria-label="今日运营指标">
      <Metric label="今日失败任务" value={formatInteger(data.overview.failedTasksToday)} tone={data.overview.failedTasksToday > 0 ? 'danger' : 'normal'} />
      <Metric label="今日真实API支出" value={formatCny(data.overview.apiCashMicrosToday)} />
      <Metric label="活跃会员" value={formatInteger(data.overview.activeMembers)} />
      <Metric label="今日算力消耗" value={formatCompute(data.overview.computeToday)} />
    </section>

    <div className="admin-dashboard-grid">
      <section className="admin-panel admin-trend-panel">
        <header><div><h2>近7日成本与算力</h2><p>深色柱为算力，绿色线点为真实API现金成本。</p></div><span>{formatCny(data.trend.reduce((sum, item) => sum + item.cashMicros, 0))}</span></header>
        <div className="admin-combo-chart" role="img" aria-label="近7日真实API成本与算力趋势">
          {data.trend.map((item) => <div className="admin-chart-day" key={item.day}>
            <div className="admin-chart-value">{formatCny(item.cashMicros)}</div>
            <div className="admin-chart-track"><i style={{ height: `${Math.max(2, item.compute / maxTrend * 100)}%` }} /></div>
            <span>{item.day.slice(5)}</span>
          </div>)}
        </div>
      </section>
      <section className="admin-panel admin-attention-panel">
        <header><div><h2>当前需要处理</h2><p>问题台中的未解决事项。</p></div><strong>{data.overview.openIssues}</strong></header>
        <dl>
          <div><dt>今日失败任务</dt><dd>{data.overview.failedTasksToday}</dd></div>
          <div><dt>未处理问题</dt><dd>{data.overview.openIssues}</dd></div>
          <div><dt>30天内到期会员</dt><dd>{data.expiring.length}</dd></div>
          <div><dt>本月已记录收入</dt><dd>{formatCny(data.overview.monthRevenueCashMicros)}</dd></div>
        </dl>
      </section>
    </div>
    <div className="admin-dashboard-grid lower">
      <DataSection title="即将到期会员" description="仅列出30天内到期的生效会员。">
        <ResponsiveTable columns={['用户', '套餐', '到期时间', '剩余天数']} empty="未来30天没有会员到期">
          {data.expiring.map((row) => <tr key={row.userId}><td data-label="用户"><strong>{row.displayName}</strong><small>{row.email}</small></td><td data-label="套餐">{planLabel(row.plan)}</td><td data-label="到期时间">{formatDate(row.periodEnd)}</td><td data-label="剩余天数" className={row.daysRemaining <= 7 ? 'danger-text' : ''}>{row.daysRemaining}天</td></tr>)}
        </ResponsiveTable>
      </DataSection>
      <DataSection title="近7日高消耗用户" description="按真实账本换算后的算力值排序。">
        <ResponsiveTable columns={['用户', '算力消耗', 'API支出', '调用']} empty="近7日还没有模型调用">
          {data.topUsers.map((row) => <tr key={row.userId}><td data-label="用户"><strong>{row.displayName}</strong><small>{row.email}</small></td><td data-label="算力消耗">{formatCompute(row.compute)}</td><td data-label="API支出">{formatCny(row.cashMicros)}</td><td data-label="调用">{row.calls}</td></tr>)}
        </ResponsiveTable>
      </DataSection>
    </div>
    {data.business !== undefined && <>
      <section className="admin-metrics compact admin-business-metrics" aria-label="经营转化指标">
        <Metric label="累计注册普通用户" value={formatInteger(data.business.registeredUsers)} />
        <Metric label="累计付费普通用户" value={formatInteger(data.business.cumulativePaidUsers)} />
        <Metric label="累计付费率" value={formatRate(data.business.cumulativePaidRate)} />
        <Metric label="近30天首付费率" value={formatRate(data.business.firstPaidRate30d)} />
        <Metric label="活跃付费用户" value={formatInteger(data.business.activePaidUsers)} />
        <Metric label="已记录会员收入" value={formatCny(data.business.recordedMembershipRevenueCashMicros)} />
      </section>
      <p className="admin-definition-note">{data.business.definitions.revenue}</p>
    </>}
  </div>;
}

function UsersPage({ currentUser, searchSeed, onError }: PageProps & { currentUser: AuthAccountData; searchSeed: string }): React.JSX.Element {
  const [query, setQuery] = useState(searchSeed);
  const [status, setStatus] = useState('');
  const [auditDay, setAuditDay] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()));
  const [data, setData] = useState<{ items: AdminUser[]; total: number } | null>(null);
  const [operations, setOperations] = useState<AdminUserOperationsData | null>(null);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (searchSeed) setQuery(searchSeed); }, [searchSeed]);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [users, nextOperations] = await Promise.all([fetchAdminUsersPage(query, status, signal), fetchUserOperations(auditDay, signal)]);
      setData(users); setOperations(nextOperations); onError(null);
    } catch (reason) { if (!signal?.aborted) onError(errorText(reason)); }
  }, [query, status, auditDay, onError]);
  useEffect(() => { const controller = new AbortController(); const timer = window.setTimeout(() => void load(controller.signal), 180); return () => { window.clearTimeout(timer); controller.abort(); }; }, [load]);
  const toggle = async (user: AdminUser): Promise<void> => {
    setBusy(true);
    try { await setAdminUserStatus(user.userId, user.status === 'active' ? 'suspended' : 'active'); await load(); setSelected(null); }
    catch (reason) { onError(errorText(reason)); } finally { setBusy(false); }
  };
  const selectedOperation = selected === null ? null : operations?.items.find((item) => item.userId === selected.userId) ?? null;
  return <div className="admin-page">
    <PageHeading title="用户管理" description="搜索账号、查看注册与最后活动，暂停账号会立即撤销旧会话。" />
    <FilterBar query={query} onQuery={setQuery} queryLabel="搜索昵称或邮箱" status={status} onStatus={setStatus} options={[['', '全部状态'], ['active', '正常使用'], ['suspended', '已暂停']]} extra={<label className="admin-audit-day">任务日期<input aria-label="任务审计日期" type="date" value={auditDay} onChange={(event) => setAuditDay(event.target.value)} /></label>} />
    <DataSection title={`${data?.total ?? 0} 个账号`} description="密码、盐值和会话令牌永远不在后台接口中返回。">
      <ResponsiveTable columns={['用户', '角色', '状态', '注册时间', '最后活动', '']} empty="没有找到符合条件的用户">
        {data?.items.map((user) => <tr key={user.userId} onClick={() => setSelected(user)} className="clickable">
          <td data-label="用户"><strong>{user.displayName}</strong><small>{user.email}</small>{operations?.items.find((item) => item.userId === user.userId) !== undefined && <small>{operations.items.find((item) => item.userId === user.userId)!.bookCount} 本书 · 今日 {operations.items.find((item) => item.userId === user.userId)!.today.taskCount} 个任务{operations.items.find((item) => item.userId === user.userId)!.today.failed ? ` · ${operations.items.find((item) => item.userId === user.userId)!.today.failureCount} 个失败` : ''}</small>}</td>
          <td data-label="角色">{user.role === 'admin' ? '管理员' : '普通用户'}</td>
          <td data-label="状态"><StatusText value={user.status === 'active' ? '正常' : '已暂停'} tone={user.status === 'active' ? 'success' : 'danger'} /></td>
          <td data-label="注册时间">{formatDateTime(user.createdAt)}</td><td data-label="最后活动">{formatDateTime(operations?.items.find((item) => item.userId === user.userId)?.lastActivityAt ?? user.lastLoginAt)}</td>
          <td><button type="button" className="row-action" onClick={(event) => { event.stopPropagation(); setSelected(user); }}>管理</button></td>
        </tr>)}
      </ResponsiveTable>
    </DataSection>
    {selected !== null && <DetailDrawer title="用户详情" onClose={() => setSelected(null)}>
      <DetailList items={[['昵称', selected.displayName], ['邮箱', selected.email], ['身份', selected.role === 'admin' ? '管理员' : '普通用户'], ['当前状态', selected.status === 'active' ? '正常使用' : '已暂停'], ['注册时间', formatDateTime(selected.createdAt)], ['最后活动', formatDateTime(selectedOperation?.lastActivityAt ?? selected.lastLoginAt)]]} />
      {selectedOperation !== null && <>
        <DetailList items={[['书籍总数', String(selectedOperation.bookCount)], ['活跃 / 归档', `${selectedOperation.activeBookCount} / ${selectedOperation.archivedBookCount}`],
          ['今日任务', String(selectedOperation.today.taskCount)], ['今日失败', selectedOperation.today.failed ? `${selectedOperation.today.failureCount} 个` : '没有失败'], ['统计时区', operations?.timezone ?? 'Asia/Shanghai']]} />
        <section className="drawer-copy"><h3>用户书籍</h3>
          <ResponsiveTable columns={['书籍', '阶段', '当前位置', '最近任务']} empty="这个用户还没有创建书籍">
            {selectedOperation.books.map((book) => <tr key={book.bookId}><td data-label="书籍"><strong>{book.title}</strong><small>{book.status}</small></td>
              <td data-label="阶段">{book.workflowStage}</td><td data-label="当前位置">卷 {book.currentVolume ?? '—'} · 事件 {book.currentEvent ?? '—'} · 章 {book.currentChapter ?? '—'}</td>
              <td data-label="最近任务"><strong>{book.latestTaskStatus ?? '无'}</strong><small>{formatDateTime(book.latestManuscriptAt ?? book.latestSettlementAt)}</small></td></tr>)}
          </ResponsiveTable>
        </section>
        <section className="drawer-copy"><h3>今日失败位置</h3>
          <ResponsiveTable columns={['书籍 / 页面', '任务 / 节点', '失败席', '错误 / 恢复键']} empty="今天没有任务失败">
            {selectedOperation.failures.map((failure) => <tr key={failure.taskId}><td data-label="书籍 / 页面"><strong>{failure.bookTitle}</strong><small>{failure.frontEndPage}</small></td>
              <td data-label="任务 / 节点"><strong>{failure.taskType}</strong><small>{failure.workflowNode}</small></td>
              <td data-label="失败席">{failure.failedSeats.map((seat) => `${seat.memberName}（${seat.roleKey}）`).join('、') || failure.memberName || '任务级失败'}<small>已保留 {failure.retainedResults} 份结果</small></td>
              <td data-label="错误 / 恢复键"><strong>{failure.errorSummary}</strong><small>{failure.recoveryKey}</small></td></tr>)}
          </ResponsiveTable>
        </section>
      </>}
      <div className="drawer-actions"><button type="button" className={selected.status === 'active' ? 'danger-button' : 'primary'} disabled={busy || selected.userId === currentUser.userId} onClick={() => void toggle(selected)}>{selected.userId === currentUser.userId ? '当前账号不可暂停' : selected.status === 'active' ? '暂停账号并撤销会话' : '恢复账号'}</button></div>
    </DetailDrawer>}
  </div>;
}

function UsagePage({ mode, onError }: PageProps & { mode: 'compute' | 'api' }): React.JSX.Element {
  const [data, setData] = useState<AdminUsageData | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => { try { setData(await fetchUsage(signal)); onError(null); } catch (reason) { if (!signal?.aborted) onError(errorText(reason)); } }, [onError]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  if (data === null) return <PageLoading label={mode === 'compute' ? '正在汇总算力账本…' : '正在汇总真实API账本…'} />;
  const compute = data.totalTokens * 2;
  return <div className="admin-page">
    <PageHeading title={mode === 'compute' ? '用户算力消耗' : '真实API消耗'} description={mode === 'compute' ? '算力值 = 真实输入与输出用量 × 2；会员与作者端统一使用这一口径。' : '直接读取 usage_ledger 的真实输入、输出、调用次数与现金成本，不使用会员标价代替。'} action={<button type="button" className="quiet" onClick={() => void load()}><ArrowClockwise />刷新</button>} />
    <section className="admin-metrics compact">
      {mode === 'compute' ? <>
        <Metric label="累计算力值" value={formatCompute(compute)} />
        <Metric label="真实用量" value={formatToken(data.totalTokens)} />
        <Metric label="累计调用" value={formatInteger(data.totalCalls)} />
        <Metric label="涉及用户" value={formatInteger(data.perUser.filter((row) => row.calls > 0).length)} />
      </> : <>
        <Metric label="累计真实支出" value={formatCny(data.totalCashMicros)} />
        <Metric label="输入用量" value={formatToken(data.totalInputTokens ?? 0)} />
        <Metric label="输出用量" value={formatToken(data.totalOutputTokens ?? 0)} />
        <Metric label="累计调用" value={formatInteger(data.totalCalls)} />
      </>}
    </section>
    <div className="admin-dashboard-grid lower">
      <DataSection title={mode === 'compute' ? '按用户统计' : '按模型统计'} description={mode === 'compute' ? '按累计算力值从高到低。' : '供应商、模型、真实用量和现金成本保持可审计。'}>
        {mode === 'compute' ? <ResponsiveTable columns={['用户', '书籍', '算力值', '调用']} empty="暂无用量">
          {data.perUser.map((row) => <tr key={row.userId}><td data-label="用户"><strong>{row.displayName}</strong><small>{row.email}</small></td><td data-label="书籍">{row.books}</td><td data-label="算力值">{formatCompute(row.tokens * 2)}</td><td data-label="调用">{row.calls}</td></tr>)}
        </ResponsiveTable> : <ResponsiveTable columns={['供应商 / 模型', '输入', '输出', '真实支出', '调用']} empty="暂无真实API调用">
          {data.perModel.map((row) => <tr key={`${row.provider}/${row.modelId}`}><td data-label="供应商 / 模型"><strong>{row.modelId}</strong><small>{row.provider}</small></td><td data-label="输入">{formatToken(row.inputTokens ?? 0)}</td><td data-label="输出">{formatToken(row.outputTokens ?? 0)}</td><td data-label="真实支出">{formatCny(row.cashMicros ?? 0)}</td><td data-label="调用">{row.calls}</td></tr>)}
        </ResponsiveTable>}
      </DataSection>
      <DataSection title="近30日趋势" description={mode === 'compute' ? '每日算力消耗。' : '每日真实API支出。'}>
        <UsageBars rows={data.daily} mode={mode} />
      </DataSection>
    </div>
  </div>;
}

function ModelsPage({ onError }: PageProps): React.JSX.Element {
  const [scheme, setScheme] = useState<AdminModelScheme | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchModelScheme(signal); setScheme(next);
      setChoice(Object.fromEntries(next.members.map((member) => [member.roleKey, `${next.profiles[member.roleKey]?.provider}/${next.profiles[member.roleKey]?.modelId}`])));
      onError(null);
    } catch (reason) { if (!signal?.aborted) onError(errorText(reason)); }
  }, [onError]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const save = async (): Promise<void> => {
    if (scheme === null) return;
    const profiles = Object.fromEntries(scheme.members.map((member) => {
      const selected = choice[member.roleKey] ?? ''; const model = scheme.allowedModels.find((item) => `${item.provider}/${item.modelId}` === selected);
      return [member.roleKey, model ?? scheme.profiles[member.roleKey]!];
    })) as AdminModelScheme['profiles'];
    setBusy(true); setMessage('');
    try { const result = await saveModelScheme(profiles, '独立管理后台调整模型方案'); setMessage(`已保存；检查${result.convergence.booksVisited}本书，更新${result.convergence.revisedBooks}本。`); await load(); }
    catch (reason) { onError(errorText(reason)); } finally { setBusy(false); }
  };
  if (scheme === null) return <PageLoading label="正在读取模型方案…" />;
  return <div className="admin-page">
    <PageHeading title="模型配置" description="配置每位AI成员未来任务使用的模型；在途任务和历史调用快照不改变。" action={<button type="button" className="primary" disabled={busy} onClick={() => void save()}><FloppyDisk />{busy ? '正在应用…' : '保存并应用'}</button>} />
    {message && <p className="admin-inline-success"><Check />{message}</p>}
    <DataSection title="团队模型绑定" description={scheme.source === 'custom' ? `当前自定义方案，最后保存于 ${formatDateTime(scheme.updatedAt)}` : '当前使用代码默认方案。'}>
      <div className="admin-model-list">{scheme.members.map((member) => <label key={member.roleKey}><span><strong>{member.memberName}</strong><small>{member.shortTitle}</small></span><select value={choice[member.roleKey] ?? ''} disabled={busy} onChange={(event) => setChoice((current) => ({ ...current, [member.roleKey]: event.target.value }))}>{scheme.allowedModels.map((model) => <option key={`${model.provider}/${model.modelId}`} value={`${model.provider}/${model.modelId}`}>{model.modelId} · {model.plan}</option>)}</select></label>)}</div>
    </DataSection>
  </div>;
}

function IssuesPage({ searchSeed, onError }: PageProps & { searchSeed: string }): React.JSX.Element {
  const [query, setQuery] = useState(searchSeed);
  const [status, setStatus] = useState('open');
  const [source, setSource] = useState('');
  const [data, setData] = useState<{ items: AdminIssue[]; total: number } | null>(null);
  const [selected, setSelected] = useState<AdminIssue | null>(null);
  const [edit, setEdit] = useState({ status: 'open', severity: 'medium', note: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (searchSeed) setQuery(searchSeed); }, [searchSeed]);
  const load = useCallback(async (signal?: AbortSignal) => { try { setData(await fetchIssues({ query, status, source }, signal)); onError(null); } catch (reason) { if (!signal?.aborted) onError(errorText(reason)); } }, [query, status, source, onError]);
  useEffect(() => { const controller = new AbortController(); const timer = window.setTimeout(() => void load(controller.signal), 180); return () => { window.clearTimeout(timer); controller.abort(); }; }, [load]);
  const open = (issue: AdminIssue): void => { setSelected(issue); setEdit({ status: issue.status, severity: issue.severity, note: issue.note }); };
  const save = async (): Promise<void> => { if (selected === null) return; setBusy(true); try { await updateIssue(selected, edit); await load(); setSelected(null); } catch (reason) { onError(errorText(reason)); } finally { setBusy(false); } };
  return <div className="admin-page">
    <PageHeading title="问题记录" description="自动收集所有失败任务，并与用户主动反馈放在同一个处理队列。" />
    <div className="admin-filter-bar three"><SearchInput value={query} onChange={setQuery} placeholder="搜索用户、书籍、错误…" /><select aria-label="问题状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="open">待处理</option><option value="in_progress">处理中</option><option value="resolved">已解决</option><option value="ignored">已忽略</option></select><select aria-label="问题来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="">全部来源</option><option value="failed_task">失败任务</option><option value="feedback">用户反馈</option></select></div>
    <DataSection title={`${data?.total ?? 0} 条问题`} description="错误详情只在管理员后台显示，密钥形态会再次脱敏。">
      <ResponsiveTable columns={['时间', '来源', '用户 / 书籍', '问题', '严重程度', '状态']} empty="当前筛选条件下没有问题">
        {data?.items.map((issue) => <tr key={`${issue.sourceType}:${issue.sourceId}`} onClick={() => open(issue)} className="clickable"><td data-label="时间">{formatDateTime(issue.occurredAt)}</td><td data-label="来源">{issue.sourceType === 'failed_task' ? '失败任务' : '用户反馈'}</td><td data-label="用户 / 书籍"><strong>{issue.displayName}</strong><small>{issue.bookTitle || issue.email}</small></td><td data-label="问题" className="truncate-cell">{issue.detail}</td><td data-label="严重程度"><StatusText value={severityLabel(issue.severity)} tone={issue.severity === 'critical' || issue.severity === 'high' ? 'danger' : 'normal'} /></td><td data-label="状态">{issueStatusLabel(issue.status)}</td></tr>)}
      </ResponsiveTable>
    </DataSection>
    {selected !== null && <DetailDrawer title="问题详情" onClose={() => setSelected(null)}>
      <DetailList items={[['来源', selected.sourceType === 'failed_task' ? '系统失败任务' : '用户反馈'], ['用户', `${selected.displayName} ${selected.email}`], ['书籍', selected.bookTitle || '未关联'], ['发生时间', formatDateTime(selected.occurredAt)], ['任务类型', selected.category], ['错误码', selected.errorCode ?? '无'], ['页面', selected.pagePath || '无']]} />
      <section className="drawer-copy"><h3>问题正文</h3><pre>{selected.detail}</pre></section>
      <label className="drawer-field">严重程度<select value={edit.severity} onChange={(event) => setEdit((current) => ({ ...current, severity: event.target.value }))}><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="critical">紧急</option></select></label>
      <label className="drawer-field">处理状态<select value={edit.status} onChange={(event) => setEdit((current) => ({ ...current, status: event.target.value }))}><option value="open">待处理</option><option value="in_progress">处理中</option><option value="resolved">已解决</option><option value="ignored">已忽略</option></select></label>
      <label className="drawer-field">处理记录<textarea value={edit.note} onChange={(event) => setEdit((current) => ({ ...current, note: event.target.value }))} placeholder="记录根因、修复版本或忽略理由" /></label>
      <div className="drawer-actions"><button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? '正在保存…' : '保存处理结果'}</button></div>
    </DetailDrawer>}
  </div>;
}

function TemplatesPage({ onError }: PageProps): React.JSX.Element {
  const [items, setItems] = useState<NarrativeMethod[]>([]);
  const [governance, setGovernance] = useState<AdminAiGovernanceData | null>(null);
  const [selected, setSelected] = useState<NarrativeMethod | null>(null);
  const [draft, setDraft] = useState<NarrativeMethodContent | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [memberEditor, setMemberEditor] = useState<AdminAiGovernanceData['actualMembers'][number] | null>(null);
  const [memberDraft, setMemberDraft] = useState({ enabled: true, supplierCompany: '', provider: '', modelId: '', costTier: 'medium' });
  const [newMember, setNewMember] = useState({ bookId: '', roleKey: 'screenwriter', displayName: '', supplierCompany: '', provider: '', modelId: '', costTier: 'medium' });
  const [templateEditor, setTemplateEditor] = useState<AdminAiGovernanceData['templates'][number] | null>(null);
  const [templateDraft, setTemplateDraft] = useState({ targetObject: '', schema: '{}', promptContract: '{}', rolloutPercent: 100 });
  const [busy, setBusy] = useState(false);
  const governanceBooks = governance?.books ?? [];
  const load = useCallback(async (signal?: AbortSignal) => { try {
    const [methods, nextGovernance] = await Promise.all([fetchNarrativeMethods(signal), fetchAiGovernance(signal)]);
    setItems(methods.items); setGovernance(nextGovernance); onError(null);
  } catch (reason) { if (!signal?.aborted) onError(errorText(reason)); } }, [onError]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const open = (method: NarrativeMethod): void => { setSelected(method); setDraft(structuredClone(method.content)); setEnabled(method.enabled); };
  const save = async (): Promise<void> => { if (selected === null || draft === null) return; setBusy(true); try { await saveNarrativeMethod(selected.methodKey, draft, enabled); await load(); setSelected(null); } catch (reason) { onError(errorText(reason)); } finally { setBusy(false); } };
  const openMember = (member: AdminAiGovernanceData['actualMembers'][number]): void => {
    setMemberEditor(member); setMemberDraft({ enabled: member.enabled === 1, supplierCompany: member.supplierCompany,
      provider: member.provider, modelId: member.modelId, costTier: member.costTier });
  };
  const saveMember = async (): Promise<void> => { if (memberEditor === null) return; setBusy(true); try {
    await updateAdminAiMember(memberEditor.bookId, memberEditor.agentId, memberDraft); await load(); setMemberEditor(null);
  } catch (reason) { onError(errorText(reason)); } finally { setBusy(false); } };
  const addMember = async (): Promise<void> => {
    const bookId = newMember.bookId || governanceBooks[0]?.bookId || ''; if (!bookId) return;
    setBusy(true); try { await addAdminAiMember(bookId, { roleKey: newMember.roleKey, displayName: newMember.displayName, provider: newMember.provider,
      modelId: newMember.modelId, supplierCompany: newMember.supplierCompany, costTier: newMember.costTier }); await load();
      setNewMember((current) => ({ ...current, displayName: '', supplierCompany: '', provider: '', modelId: '' }));
    } catch (reason) { onError(errorText(reason)); } finally { setBusy(false); }
  };
  const openTemplate = (template: AdminAiGovernanceData['templates'][number]): void => {
    setTemplateEditor(template); setTemplateDraft({ targetObject: template.targetObject,
      schema: JSON.stringify(JSON.parse(template.schemaJson), null, 2),
      promptContract: JSON.stringify(JSON.parse(template.promptContractJson), null, 2), rolloutPercent: template.rolloutPercent });
  };
  const saveTemplateVersion = async (): Promise<void> => { if (templateEditor === null) return; setBusy(true); try {
    const schema = JSON.parse(templateDraft.schema) as unknown; const promptContract = JSON.parse(templateDraft.promptContract) as unknown;
    if (!isPlainRecord(schema) || !isPlainRecord(promptContract)) throw new Error('Schema 和提示合同必须是 JSON 对象');
    await createCreativeTemplateVersion(templateEditor.templateKey, { targetObject: templateDraft.targetObject, schema, promptContract,
      rolloutPercent: templateDraft.rolloutPercent }); await load(); setTemplateEditor(null);
  } catch (reason) { onError(errorText(reason)); } finally { setBusy(false); } };
  const applyTemplate = async (mode: 'activate' | 'rollout'): Promise<void> => { if (templateEditor === null) return; setBusy(true); try {
    if (mode === 'activate') await activateCreativeTemplateVersion(templateEditor.templateVersionId, templateDraft.rolloutPercent);
    else await setCreativeTemplateRollout(templateEditor.templateVersionId, templateDraft.rolloutPercent);
    await load(); setTemplateEditor(null);
  } catch (reason) { onError(errorText(reason)); } finally { setBusy(false); } };
  return <div className="admin-page">
    <PageHeading title="创作模板与叙事方法" description="专业方法只在后台作为AI软工具；作者端仍只看到代入本书的具体故事路线。" />
    <DataSection title={`${items.length} 种内部方法`} description="修改会创建新版本并只影响未来卷方案，历史方案保留原方法版本。">
      <ResponsiveTable columns={['方法', '类别', '适合题材', '版本', '状态', '']} empty="没有可管理的叙事方法">
        {items.map((method) => <tr key={method.methodKey}><td data-label="方法"><strong>{method.content.internalLabel}</strong><small>{method.methodKey}</small></td><td data-label="类别">{methodCategoryLabel(method.category)}</td><td data-label="适合题材">{method.content.fitGenres.slice(0, 4).join('、')}</td><td data-label="版本">{method.activeOverrideVersion === null ? method.builtInVersion : `管理版 ${method.activeOverrideVersion}`}</td><td data-label="状态"><StatusText value={method.enabled ? '启用' : '停用'} tone={method.enabled ? 'success' : 'normal'} /></td><td><button type="button" className="row-action" onClick={() => open(method)}>编辑</button></td></tr>)}
      </ResponsiveTable>
    </DataSection>
    {governance !== null && <>
      <section className="admin-metrics compact"><Metric label="岗位类别" value={`${governance.roleCategoryCount} 类`} /><Metric label="初始成员" value={`${governance.initialMemberCount} 名`} />
        <Metric label="已登记 Skill" value={String(governance.codeSkills.length)} /><Metric label="模板版本" value={String(governance.templates.length)} />
        {governance.storylineQuality !== undefined && <><Metric label="故事线候选采纳率" value={formatRate(governance.storylineQuality.adoptionRate)} />
          <Metric label="继续观察选择率" value={formatRate(governance.storylineQuality.continueObservingRate)} />
          <Metric label="重复候选率" value={formatRate(governance.storylineQuality.duplicateRate)} />
          <Metric label="无证据候选率" value={formatRate(governance.storylineQuality.noEvidenceRate)} /></>}</section>
      <DataSection title="核心、岗位与节点 Skill" description="25 名成员共享 7 类岗位 Skill；任务冻结具体版本和哈希，后台只展示安全可读内容。">
        <ResponsiveTable columns={['Skill', '层级 / 适用范围', '版本 / 哈希', '状态与内容']} empty="尚未登记 Skill">
          {governance.codeSkills.map((skill) => <tr key={skill.skillVersionId}><td data-label="Skill"><strong>{skill.skillVersionId}</strong></td>
            <td data-label="层级 / 适用范围">{skill.layer}<small>{skill.roleKey ?? skill.nodeKind ?? '全局'}</small></td>
            <td data-label="版本 / 哈希">v{skill.version}<small>{skill.contentHash.slice(0, 16)}…</small></td>
            <td data-label="状态与内容"><StatusText value="代码当前版" tone="success" /><details className="admin-inline-detail"><summary>查看安全内容</summary><pre>{JSON.stringify(skill.content, null, 2)}</pre></details></td></tr>)}
        </ResponsiveTable>
      </DataSection>
      <DataSection title="结构化创作模板" description="模板 schema、提示合同、灰度比例和哈希按版本保存；只影响以后启动的任务。">
        <ResponsiveTable columns={['模板', '目标节点', '版本 / 灰度', '状态 / 哈希', '']} empty="模板会在对应节点首次使用时登记">
          {governance.templates.map((template) => <tr key={template.templateVersionId}><td data-label="模板"><strong>{template.templateKey}</strong><small>{template.templateVersionId}</small></td>
            <td data-label="目标节点">{template.targetObject}</td><td data-label="版本 / 灰度">v{template.version} · {template.rolloutPercent}%</td>
            <td data-label="状态 / 哈希"><StatusText value={template.status} tone={template.status === 'active' ? 'success' : 'normal'} /><small>{template.contentHash.slice(0, 16)}…</small></td>
            <td><button type="button" className="row-action" onClick={() => openTemplate(template)}>管理</button></td></tr>)}
        </ResponsiveTable>
      </DataSection>
      <DataSection title="AI 成员与内部绑定" description="作者端不显示模型；后台可核对并管理每本书的成员、供应商、模型、消耗等级和最近任务状态。">
        <ResponsiveTable columns={['书籍 / 成员', '岗位', '供应公司 / 模型', '消耗 / 状态', '']} empty="还没有实际书籍成员">
          {governance.actualMembers.slice(0, 100).map((member) => <tr key={`${member.bookId}:${member.agentId}`}><td data-label="书籍 / 成员"><strong>{member.displayName}</strong><small>{member.bookTitle}</small></td>
            <td data-label="岗位">{member.roleKey}</td><td data-label="供应公司 / 模型"><strong>{member.supplierCompany}</strong><small>{member.provider} / {member.modelId}</small></td>
            <td data-label="消耗 / 状态">{member.costTier}<small>{member.enabled === 1 ? member.latestTaskStatus ?? '空闲' : '停用'}</small></td>
            <td><button type="button" className="row-action" onClick={() => openMember(member)}>管理</button></td></tr>)}
        </ResponsiveTable>
        <details className="admin-governance-create"><summary>新增第 26 名及更多成员</summary>
          <div className="admin-inline-form-grid">
            <label>书籍<select value={newMember.bookId || governanceBooks[0]?.bookId || ''} onChange={(event) => setNewMember({ ...newMember, bookId: event.target.value })}>{governanceBooks.map((book) => <option value={book.bookId} key={book.bookId}>{book.title}</option>)}</select></label>
            <label>岗位<select value={newMember.roleKey} onChange={(event) => setNewMember({ ...newMember, roleKey: event.target.value })}>{[['chief_editor','主编'],['deputy_editor','副编'],['screenwriter','编剧'],['writer','主笔'],['fact_reviewer','事实审查席'],['literary_reviewer','文学审查席'],['experience_reviewer','体验审查席']].map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>成员姓名<input value={newMember.displayName} onChange={(event) => setNewMember({ ...newMember, displayName: event.target.value })} /></label>
            <label>供应公司<input value={newMember.supplierCompany} onChange={(event) => setNewMember({ ...newMember, supplierCompany: event.target.value })} /></label>
            <label>内部供应商<input value={newMember.provider} onChange={(event) => setNewMember({ ...newMember, provider: event.target.value })} /></label>
            <label>内部模型<input value={newMember.modelId} onChange={(event) => setNewMember({ ...newMember, modelId: event.target.value })} /></label>
            <label>消耗等级<select value={newMember.costTier} onChange={(event) => setNewMember({ ...newMember, costTier: event.target.value })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
          </div><button type="button" className="primary admin-inline-save" disabled={busy || !newMember.displayName || !newMember.supplierCompany || !newMember.provider || !newMember.modelId || governanceBooks.length === 0} onClick={() => void addMember()}>{busy ? '正在新增…' : '新增成员'}</button>
        </details>
      </DataSection>
      <DataSection title="近期批次公平性" description="同批次 ContextPack 哈希必须唯一；成员模型签名必须相互独立，Skill 与模板快照固定。">
        <ResponsiveTable columns={['书籍 / 节点', '成员', '同包', '模板 / 状态']} empty="还没有 AI 节点批次">
          {governance.batches.map((batch) => <tr key={batch.batchId}><td data-label="书籍 / 节点"><strong>{batch.bookTitle}</strong><small>{batch.nodeKind}</small></td>
            <td data-label="成员">{batch.members}</td><td data-label="同包"><StatusText value={batch.distinctContextHashes <= 1 ? '通过' : '异常'} tone={batch.distinctContextHashes <= 1 ? 'success' : 'danger'} /><small>{batch.contextPackHash.slice(0, 12)}…</small></td>
            <td data-label="模板 / 状态"><strong>{batch.templateVersionId ?? batch.templateVersion}</strong><small>{batch.status}</small></td></tr>)}
        </ResponsiveTable>
      </DataSection>
    </>}
    {selected !== null && draft !== null && <DetailDrawer title="编辑叙事方法" wide onClose={() => setSelected(null)}>
      <label className="drawer-field">内部名称<input value={draft.internalLabel} onChange={(event) => setDraft({ ...draft, internalLabel: event.target.value })} /></label>
      <ArrayTextarea label="适合解决的问题" value={draft.suitableProblems} onChange={(value) => setDraft({ ...draft, suitableProblems: value })} />
      <ArrayTextarea label="组织方式 / 给AI的结构职责" value={draft.organization} onChange={(value) => setDraft({ ...draft, organization: value })} />
      <ArrayTextarea label="适合题材（也用于后台推荐信号）" value={draft.fitGenres} onChange={(value) => setDraft({ ...draft, fitGenres: value })} />
      <ArrayTextarea label="适合长度" value={draft.fitLengths} onChange={(value) => setDraft({ ...draft, fitLengths: value })} />
      <ArrayTextarea label="套路风险" value={draft.routineRisks} onChange={(value) => setDraft({ ...draft, routineRisks: value })} />
      <label className="drawer-field">调整说明<textarea value={draft.adaptability.note} onChange={(event) => setDraft({ ...draft, adaptability: { ...draft.adaptability, note: event.target.value } })} /></label>
      <label className="admin-check"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />允许未来卷方案使用这个方法</label>
      <div className="drawer-actions"><button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? '正在保存…' : '保存为新版本'}</button></div>
    </DetailDrawer>}
    {memberEditor !== null && <DetailDrawer title={`管理 ${memberEditor.displayName}`} onClose={() => setMemberEditor(null)}>
      <DetailList items={[['书籍', memberEditor.bookTitle], ['岗位', memberEditor.roleKey], ['最近任务', memberEditor.latestTaskStatus ?? '空闲'], ['生效边界', '只影响以后启动的任务']]} />
      <label className="admin-check"><input type="checkbox" checked={memberDraft.enabled} onChange={(event) => setMemberDraft({ ...memberDraft, enabled: event.target.checked })} />允许新任务选择这名成员</label>
      <label className="drawer-field">供应公司<input value={memberDraft.supplierCompany} onChange={(event) => setMemberDraft({ ...memberDraft, supplierCompany: event.target.value })} /></label>
      <label className="drawer-field">内部供应商<input value={memberDraft.provider} onChange={(event) => setMemberDraft({ ...memberDraft, provider: event.target.value })} /></label>
      <label className="drawer-field">内部模型<input value={memberDraft.modelId} onChange={(event) => setMemberDraft({ ...memberDraft, modelId: event.target.value })} /></label>
      <label className="drawer-field">消耗等级<select value={memberDraft.costTier} onChange={(event) => setMemberDraft({ ...memberDraft, costTier: event.target.value })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
      <p className="drawer-hint">改绑不会修改在途任务和历史调用；它们继续使用任务开始时冻结的成员、模型、Skill、模板和资料包。</p>
      <div className="drawer-actions"><button type="button" className="primary" disabled={busy} onClick={() => void saveMember()}>{busy ? '正在保存…' : '保存成员配置'}</button></div>
    </DetailDrawer>}
    {templateEditor !== null && <DetailDrawer title={`管理模板 ${templateEditor.templateKey}`} wide onClose={() => setTemplateEditor(null)}>
      <DetailList items={[['当前版本', `v${templateEditor.version}`], ['状态', templateEditor.status], ['内容哈希', templateEditor.contentHash], ['生效边界', '只影响以后启动的新任务']]} />
      <label className="drawer-field">目标节点<input value={templateDraft.targetObject} onChange={(event) => setTemplateDraft({ ...templateDraft, targetObject: event.target.value })} /></label>
      <label className="drawer-field">Schema JSON<textarea className="prompt-editor" value={templateDraft.schema} onChange={(event) => setTemplateDraft({ ...templateDraft, schema: event.target.value })} /></label>
      <label className="drawer-field">提示合同 JSON<textarea className="prompt-editor" value={templateDraft.promptContract} onChange={(event) => setTemplateDraft({ ...templateDraft, promptContract: event.target.value })} /></label>
      <label className="drawer-field">新任务灰度比例（0—100）<input type="number" min="0" max="100" step="1" value={templateDraft.rolloutPercent} onChange={(event) => setTemplateDraft({ ...templateDraft, rolloutPercent: Number(event.target.value) })} /></label>
      <div className="drawer-actions split"><button type="button" className="primary" disabled={busy} onClick={() => void saveTemplateVersion()}>{busy ? '正在保存…' : '保存为新版本'}</button>
        {templateEditor.status === 'active' ? <button type="button" disabled={busy} onClick={() => void applyTemplate('rollout')}>只调整灰度</button>
          : <button type="button" disabled={busy} onClick={() => void applyTemplate('activate')}>回滚启用此版</button>}</div>
    </DetailDrawer>}
  </div>;
}
function PromptsPage({ onError }: PageProps): React.JSX.Element {
  const [catalog, setCatalog] = useState<PromptCatalogData | null>(null);
  const [calls, setCalls] = useState<PromptCall[]>([]);
  const [tab, setTab] = useState<'triggers' | 'calls'>('triggers');
  const [selectedTrigger, setSelectedTrigger] = useState<string | null>(null);
  const [roleKey, setRoleKey] = useState('*');
  const [phaseKey, setPhaseKey] = useState('*');
  const [content, setContent] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [callDetail, setCallDetail] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try { const [nextCatalog, nextCalls] = await Promise.all([fetchPromptCatalog(signal), fetchPromptCalls(signal)]); setCatalog(nextCatalog); setCalls(nextCalls.items); onError(null); }
    catch (reason) { if (!signal?.aborted) onError(errorText(reason)); }
  }, [onError]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const trigger = catalog?.triggers.find((item) => item.triggerKey === selectedTrigger) ?? null;
  const openTrigger = async (key: string): Promise<void> => {
    setSelectedTrigger(key); const next = catalog?.triggers.find((item) => item.triggerKey === key); const firstRole = next?.memberRoles[0] ?? '*'; setRoleKey(firstRole);
    const active = catalog?.overrides.find((item) => item.triggerKey === key && item.roleKey === firstRole && item.phaseKey === '*'); setContent(active?.content ?? ''); setPhaseKey('*');
    if (next !== undefined && firstRole !== '*') { try { setSystemPrompt((await fetchRuntimeSystemPrompt(firstRole, next.taskPurpose)).systemPrompt); } catch { setSystemPrompt(''); } }
  };
  const changeRole = async (nextRole: string): Promise<void> => {
    setRoleKey(nextRole); const active = catalog?.overrides.find((item) => item.triggerKey === selectedTrigger && item.roleKey === nextRole && item.phaseKey === phaseKey); setContent(active?.content ?? '');
    if (trigger !== null && nextRole !== '*') { try { setSystemPrompt((await fetchRuntimeSystemPrompt(nextRole, trigger.taskPurpose)).systemPrompt); } catch { setSystemPrompt(''); } } else setSystemPrompt('');
  };
  const save = async (): Promise<void> => { if (selectedTrigger === null) return; setBusy(true); try { await savePromptOverride({ triggerKey: selectedTrigger, roleKey, phaseKey, content }); await load(); } catch (reason) { onError(errorText(reason)); } finally { setBusy(false); } };
  const archive = async (): Promise<void> => { const active = catalog?.overrides.find((item) => item.triggerKey === selectedTrigger && item.roleKey === roleKey && item.phaseKey === phaseKey); if (active === undefined) return; setBusy(true); try { await archivePromptOverride(active.promptOverrideId); setContent(''); await load(); } catch (reason) { onError(errorText(reason)); } finally { setBusy(false); } };
  const openCall = async (call: PromptCall): Promise<void> => { try { setCallDetail(await fetchPromptCall(call.requestId)); } catch (reason) { onError(errorText(reason)); } };
  if (catalog === null) return <PageLoading label="正在整理AI触发点与提示词…" />;
  return <div className="admin-page">
    <PageHeading title="提示词与AI介入" description="查看按钮何时触发谁、收到哪些资料包、执行什么任务；修改以附加指令新版本应用到未来调用。" />
    <div className="admin-tabs"><button className={tab === 'triggers' ? 'active' : ''} type="button" onClick={() => setTab('triggers')}>触发目录</button><button className={tab === 'calls' ? 'active' : ''} type="button" onClick={() => setTab('calls')}>真实调用快照</button></div>
    {tab === 'triggers' ? <DataSection title={`${catalog.triggers.length} 个AI触发点`} description="前端按钮文案可以变化，后台覆盖绑定稳定任务类型、成员与阶段。">
      <ResponsiveTable columns={['页面', '作者按钮', '介入时机', 'AI成员', '当前覆盖', '']} empty="没有登记AI触发点">
        {catalog.triggers.map((item) => <tr key={item.triggerKey}><td data-label="页面"><strong>{item.surface}</strong><small>{item.triggerKey}</small></td><td data-label="作者按钮">{item.authorActions.join(' / ')}</td><td data-label="介入时机" className="wide-cell">{item.interventionTiming}</td><td data-label="AI成员">{item.memberRoles.map((role) => catalog.members.find((member) => member.roleKey === role)?.memberName ?? role).join('、')}</td><td data-label="当前覆盖">{catalog.overrides.filter((override) => override.triggerKey === item.triggerKey).length}条</td><td><button className="row-action" type="button" onClick={() => void openTrigger(item.triggerKey)}>查看</button></td></tr>)}
      </ResponsiveTable>
    </DataSection> : <DataSection title={`${calls.length} 次有提示词快照的真实调用`} description="上线后新调用会保存最终任务提示词、附加指令和资料包清单；历史只有哈希的调用不会伪造还原。">
      <ResponsiveTable columns={['时间', '用户 / 书籍', '任务 / 阶段', '成员', '模型', '状态', '']} empty="还没有新的提示词调用快照">
        {calls.map((call) => <tr key={call.requestId}><td data-label="时间">{formatDateTime(call.createdAt)}</td><td data-label="用户 / 书籍"><strong>{call.displayName ?? '未关联'}</strong><small>{call.bookTitle}</small></td><td data-label="任务 / 阶段"><strong>{call.taskType}</strong><small>{call.phaseKey}</small></td><td data-label="成员">{memberName(catalog, call.roleKey)}</td><td data-label="模型"><strong>{call.modelId}</strong><small>{call.provider}</small></td><td data-label="状态">{call.state}</td><td><button className="row-action" type="button" onClick={() => void openCall(call)}>资料包</button></td></tr>)}
      </ResponsiveTable>
    </DataSection>}
    {trigger !== null && <DetailDrawer title={`${trigger.surface} · ${trigger.authorActions[0]}`} wide onClose={() => setSelectedTrigger(null)}>
      <DetailList items={[['稳定任务类型', trigger.triggerKey], ['AI介入时机', trigger.interventionTiming], ['输出结果', trigger.output], ['任务模式', trigger.taskPurpose]]} />
      <section className="drawer-copy"><h3>接收的资料包</h3><ul>{trigger.contextPackages.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <label className="drawer-field">作用成员<select value={roleKey} onChange={(event) => void changeRole(event.target.value)}><option value="*">全部参与成员</option>{trigger.memberRoles.map((role) => <option key={role} value={role}>{memberName(catalog, role)}</option>)}</select></label>
      <label className="drawer-field">作用阶段<input value={phaseKey} onChange={(event) => setPhaseKey(event.target.value)} placeholder="* 表示该任务所有阶段" /></label>
      {systemPrompt && <details className="admin-prompt-base"><summary>查看成员基础系统提示词</summary><pre>{systemPrompt}</pre></details>}
      <label className="drawer-field">平台附加提示词<textarea className="prompt-editor" value={content} onChange={(event) => setContent(event.target.value)} placeholder="只写需要补充或调整的任务指令；留空时不要保存。" /></label>
      <p className="drawer-hint">保存会创建新版本，只影响以后开始的模型调用。不会修改在途任务、历史结果或作者已确认内容。</p>
      <div className="drawer-actions split"><button type="button" className="primary" disabled={busy || !content.trim()} onClick={() => void save()}>{busy ? '正在保存…' : '保存新版本'}</button><button type="button" disabled={busy || !catalog.overrides.some((item) => item.triggerKey === selectedTrigger && item.roleKey === roleKey && item.phaseKey === phaseKey)} onClick={() => void archive()}>停用当前覆盖</button></div>
    </DetailDrawer>}
    {callDetail !== null && <DetailDrawer title="真实调用资料" wide onClose={() => setCallDetail(null)}>
      <DetailList items={[['用户', objectPath(callDetail, 'user.displayName')], ['书籍', String(callDetail.bookTitle ?? '')], ['任务类型', String(callDetail.taskType ?? '')], ['成员 / 阶段', `${String(callDetail.roleKey ?? '')} / ${String(callDetail.phaseKey ?? '')}`], ['模型', `${String(callDetail.provider ?? '')} / ${String(callDetail.modelId ?? '')}`], ['状态', String(callDetail.state ?? '')]]} />
      <section className="drawer-copy"><h3>本次任务提示词</h3><pre>{String(callDetail.taskPrompt ?? '')}</pre></section>
      {String(callDetail.supplementalInstructions ?? '') && <section className="drawer-copy"><h3>附加指令</h3><pre>{String(callDetail.supplementalInstructions ?? '')}</pre></section>}
      <section className="drawer-copy"><h3>ContextPack资料包</h3><pre>{JSON.stringify(callDetail.contextPack ?? null, null, 2)}</pre></section>
      <section className="drawer-copy"><h3>任务快照</h3><pre>{JSON.stringify(callDetail.taskBrief ?? null, null, 2)}</pre></section>
    </DetailDrawer>}
  </div>;
}

function MembershipsPage({ onError }: PageProps): React.JSX.Element {
  const [users, setUsers] = useState<AdminMembershipUser[]>([]);
  const [stats, setStats] = useState<MembershipStats | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<AdminMembershipUser | null>(null);
  const [plan, setPlan] = useState('silver');
  const [amount, setAmount] = useState(98);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => { try { const [memberships, nextStats] = await Promise.all([fetchMembershipUsers(query, '', signal), fetchMembershipStats(signal)]); setUsers(memberships.items); setStats(nextStats); onError(null); } catch (reason) { if (!signal?.aborted) onError(errorText(reason)); } }, [query, onError]);
  useEffect(() => { const controller = new AbortController(); const timer = window.setTimeout(() => void load(controller.signal), 180); return () => { window.clearTimeout(timer); controller.abort(); }; }, [load]);
  const choosePlan = (value: string): void => { setPlan(value); setAmount({ bronze: 0, silver: 98, gold: 198, diamond: 980 }[value as 'bronze'] ?? 0); };
  const grant = async (): Promise<void> => { if (selected === null) return; setBusy(true); try { await grantMembership(selected.userId, plan, amount, note); await load(); setSelected(null); } catch (reason) { onError(errorText(reason)); } finally { setBusy(false); } };
  const revoke = async (): Promise<void> => { if (selected === null) return; setBusy(true); try { await revokeMembership(selected.userId); await load(); setSelected(null); } catch (reason) { onError(errorText(reason)); } finally { setBusy(false); } };
  return <div className="admin-page">
    <PageHeading title="会员与收入" description="会员当前状态和不可变办理流水分开保存；收入只统计有流水证据的实收金额。" />
    {stats !== null && <section className="admin-metrics compact"><Metric label="活跃会员" value={formatInteger(stats.summary.activeMembers)} /><Metric label="累计已记录收入" value={formatCny(stats.summary.totalRevenueCashMicros)} /><Metric label="本月已记录收入" value={formatCny(stats.summary.monthRevenueCashMicros)} /><Metric label="续费次数" value={formatInteger(stats.summary.renewals)} /></section>}
    <div className="admin-filter-bar"><SearchInput value={query} onChange={setQuery} placeholder="搜索会员昵称或邮箱" /></div>
    <div className="admin-dashboard-grid lower">
      <DataSection title={`${users.length} 个用户`} description="查看套餐、算力消耗和续费时间，点击用户办理。">
        <ResponsiveTable columns={['用户', '当前套餐', '算力剩余', '到期时间', '']} empty="没有找到用户">
          {users.map((user) => { const member = user.membership; const remain = member === null ? 0 : Math.max(0, member.tokenQuota - member.periodTokens * 2); return <tr key={user.userId}><td data-label="用户"><strong>{user.displayName}</strong><small>{user.email}</small></td><td data-label="当前套餐">{user.role === 'admin' ? '管理员不限额' : member === null ? '未开通' : `${member.planLabel}${member.status === 'revoked' ? ' · 已撤销' : member.expired ? ' · 已到期' : ''}`}</td><td data-label="算力剩余">{user.role === 'admin' ? '不限' : formatCompute(remain)}</td><td data-label="到期时间">{member === null ? '—' : formatDate(member.periodEnd)}</td><td><button type="button" className="row-action" disabled={user.role === 'admin'} onClick={() => setSelected(user)}>办理</button></td></tr>; })}
        </ResponsiveTable>
      </DataSection>
      <DataSection title="最近会员流水" description="开通、续费、撤销均保留，续费不再覆盖历史收入。">
        <ResponsiveTable columns={['时间', '用户', '类型', '套餐', '实收']} empty="新流水上线后还没有办理记录">
          {stats?.transactions.slice(0, 20).map((item) => <tr key={item.transactionId}><td data-label="时间">{formatDateTime(item.createdAt)}</td><td data-label="用户"><strong>{item.displayName}</strong><small>{item.email}</small></td><td data-label="类型">{item.eventType === 'renew' ? '续费' : item.eventType === 'grant' ? '开通' : '撤销'}</td><td data-label="套餐">{planLabel(item.plan)}</td><td data-label="实收">{formatCny(item.amountCashMicros)}</td></tr>)}
        </ResponsiveTable>
      </DataSection>
    </div>
    {selected !== null && <DetailDrawer title={`为 ${selected.displayName} 办理会员`} onClose={() => setSelected(null)}>
      <DetailList items={[['邮箱', selected.email], ['当前会员', selected.membership?.planLabel ?? '未开通'], ['当前到期', selected.membership === null ? '—' : formatDate(selected.membership.periodEnd)], ['累计算力消耗', formatCompute(selected.totalTokens * 2)]]} />
      <label className="drawer-field">会员套餐<select value={plan} onChange={(event) => choosePlan(event.target.value)}><option value="bronze">青铜 · 20万算力</option><option value="silver">白银 · 2000万算力</option><option value="gold">黄金 · 5000万算力</option><option value="diamond">钻石 · 2亿算力</option></select></label>
      <label className="drawer-field">本次实收金额（元）<input type="number" min="0" max="100000" step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label>
      <label className="drawer-field">备注<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="优惠、渠道或补发说明（可空）" /></label>
      <p className="drawer-hint">续费会保留剩余有效期，并从当前到期日继续顺延；新周期算力重新计量。</p>
      <div className="drawer-actions split"><button className="primary" type="button" disabled={busy || amount < 0} onClick={() => void grant()}>{busy ? '正在办理…' : selected.membership?.status === 'active' && !selected.membership.expired ? '续费并记录收入' : '开通并记录收入'}</button>{selected.membership?.status === 'active' && !selected.membership.expired && <button type="button" disabled={busy} onClick={() => void revoke()}>撤销会员</button>}</div>
    </DetailDrawer>}
  </div>;
}

function PageHeading({ title, description, action }: { title: string; description: string; action?: React.ReactNode }): React.JSX.Element {
  return <header className="admin-page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action !== undefined && <div>{action}</div>}</header>;
}
function Metric({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'danger' }): React.JSX.Element { return <article className={`admin-metric ${tone}`}><span>{label}</span><strong>{value}</strong></article>; }
function DataSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }): React.JSX.Element { return <section className="admin-data-section"><header><h2>{title}</h2><p>{description}</p></header>{children}</section>; }
function ResponsiveTable({ columns, empty, children }: { columns: string[]; empty: string; children: React.ReactNode }): React.JSX.Element { const hasRows = Array.isArray(children) ? children.length > 0 : children !== null && children !== undefined; return <div className="admin-table-wrap"><table><thead><tr>{columns.map((column, index) => <th key={`${column}-${index}`}>{column}</th>)}</tr></thead><tbody>{hasRows ? children : <tr><td colSpan={columns.length} className="admin-table-empty">{empty}</td></tr>}</tbody></table></div>; }
function DetailDrawer({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }): React.JSX.Element { return <><button className="admin-detail-scrim" type="button" aria-label="关闭详情" onClick={onClose} /><aside className={`admin-detail-drawer ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button type="button" aria-label="关闭" onClick={onClose}><X /></button></header><div className="admin-drawer-body">{children}</div></aside></>; }
function DetailList({ items }: { items: Array<[string, string]> }): React.JSX.Element { return <dl className="admin-detail-list">{items.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || '—'}</dd></div>)}</dl>; }
function PageLoading({ label }: { label: string }): React.JSX.Element { return <div className="admin-page-state"><span className="admin-spinner" />{label}</div>; }
function PageEmpty({ title, action, onAction }: { title: string; action: string; onAction: () => void }): React.JSX.Element { return <div className="admin-page-state"><strong>{title}</strong><button type="button" onClick={onAction}>{action}</button></div>; }
function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }): React.JSX.Element { return <label className="admin-search"><MagnifyingGlass /><input aria-label={placeholder} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>; }
function FilterBar({ query, onQuery, queryLabel, status, onStatus, options, extra }: { query: string; onQuery: (value: string) => void; queryLabel: string; status: string; onStatus: (value: string) => void; options: Array<[string, string]>; extra?: React.ReactNode }): React.JSX.Element { return <div className="admin-filter-bar"><SearchInput value={query} onChange={onQuery} placeholder={queryLabel} /><select aria-label="筛选状态" value={status} onChange={(event) => onStatus(event.target.value)}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{extra}</div>; }
function StatusText({ value, tone }: { value: string; tone: 'success' | 'danger' | 'normal' }): React.JSX.Element { return <span className={`admin-status-text ${tone}`}>{value}</span>; }
function ArrayTextarea({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }): React.JSX.Element { return <label className="drawer-field">{label}<textarea value={value.join('\n')} onChange={(event) => onChange(event.target.value.split('\n').map((item) => item.trim()).filter(Boolean))} /></label>; }
function UsageBars({ rows, mode }: { rows: AdminUsageData['daily']; mode: 'compute' | 'api' }): React.JSX.Element { const ordered = [...rows].reverse(); const values = ordered.map((row) => mode === 'compute' ? row.tokens * 2 : row.cashMicros ?? 0); const peak = Math.max(...values, 1); return <div className="admin-usage-bars">{ordered.map((row, index) => <div key={row.day}><span>{row.day.slice(5)}</span><i><b style={{ width: `${Math.max(1, values[index]! / peak * 100)}%` }} /></i><strong>{mode === 'compute' ? formatCompute(values[index]!) : formatCny(values[index]!)}</strong></div>)}</div>; }

function formatRate(value: number | null): string { return value === null ? '—' : `${(value * 100).toFixed(1)}%`; }
function formatCny(micros: number): string { return `¥${(Number(micros || 0) / 1_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function formatCompute(value: number): string { if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`; if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`; return formatInteger(value); }
function formatToken(value: number): string { if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`; if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`; return formatInteger(value); }
function formatInteger(value: number): string { return Number(value || 0).toLocaleString('zh-CN'); }
function formatDate(value?: string | null): string { return value ? value.slice(0, 10) : '—'; }
function formatDateTime(value?: string | null): string { return value ? value.slice(0, 16).replace('T', ' ') : '—'; }
function planLabel(value: string): string { return ({ bronze: '青铜会员', silver: '白银会员', gold: '黄金会员', diamond: '钻石会员' } as Record<string, string>)[value] ?? value; }
function issueStatusLabel(value: string): string { return ({ open: '待处理', in_progress: '处理中', resolved: '已解决', ignored: '已忽略' } as Record<string, string>)[value] ?? value; }
function severityLabel(value: string): string { return ({ low: '低', medium: '中', high: '高', critical: '紧急' } as Record<string, string>)[value] ?? value; }
function methodCategoryLabel(value: string): string { return ({ macro: '宏观结构', character_arc: '人物成长', causal_principle: '因果推进', serial_rhythm: '连载节奏', narration: '叙述方式' } as Record<string, string>)[value] ?? value; }
function memberName(catalog: PromptCatalogData, roleKey: string): string { const member = catalog.members.find((item) => item.roleKey === roleKey); return member === undefined ? roleKey : `${member.memberName}（${member.shortTitle}）`; }
function isPlainRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function objectPath(value: Record<string, unknown>, path: string): string { return path.split('.').reduce<unknown>((current, key) => current !== null && typeof current === 'object' ? (current as Record<string, unknown>)[key] : '', value) as string || ''; }
function errorText(reason: unknown): string {
  if (reason === null || typeof reason !== 'object') return '后台请求没有成功';
  const value = Reflect.get(reason, 'message');
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) return '后台请求没有成功';
  return /(?:\bSQL\b|sqlite|stack|\\private\\|node_modules|Bearer\s|\b(?:sk|ak)-[A-Za-z0-9_-]{8,})/iu.test(value)
    ? '后台请求没有成功' : value;
}
