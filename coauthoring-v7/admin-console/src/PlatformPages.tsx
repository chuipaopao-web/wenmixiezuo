import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, MagnifyingGlass } from '@phosphor-icons/react';
import {
  fetchMembershipUsers,
  fetchMembershipStats,
  fetchPlatformDashboard,
  fetchPlatformIssues,
  fetchPlatformUsers,
  fetchPlatformUsage,
  fetchUserOperations,
  grantMembership,
  newPlatformActionKey,
  revokeMembership,
  setPlatformUserStatus,
  updatePlatformIssue,
  type MembershipPlan,
  type MembershipStats,
  type MembershipUser,
  type PlatformDashboard,
  type PlatformIssue,
  type PlatformUser,
  type PlatformUsage,
  type UserOperation
} from './platform-api';

export type PlatformSection = 'operations' | 'users' | 'usage' | 'issues' | 'memberships';

export function PlatformPage({ section, currentAccountId }: { section: PlatformSection; currentAccountId?: string }): React.JSX.Element {
  if (section === 'operations') return <OperationsPage />;
  if (section === 'users') return <UsersPage currentAccountId={currentAccountId} />;
  if (section === 'usage') return <UsagePage />;
  if (section === 'issues') return <IssuesPage />;
  return <MembershipsPage />;
}

function OperationsPage(): React.JSX.Element {
  const state = useRemoteData(fetchPlatformDashboard);
  if (state.data === null) return <RemoteState label="正在读取生产运营数据…" error={state.error} onRetry={state.reload} />;
  const data = state.data;
  return <div className="asset-page platform-page">
    <PlatformHeading title="平台运营总览" description="直接读取生产账本、任务和会员数据；这里不保存统计副本。" onRefresh={state.reload} />
    <section className="platform-metrics image-aware" aria-label="今日运营指标">
      <PlatformMetric label="今日失败任务" value={String(data.overview.failedTasksToday)} tone={data.overview.failedTasksToday > 0 ? 'warning' : 'normal'} />
      <PlatformMetric label="待处理问题" value={String(data.overview.openIssues)} tone={data.overview.openIssues > 0 ? 'warning' : 'normal'} />
      <PlatformMetric label="今日算力" value={formatCompute(data.overview.computeToday)} />
      <PlatformMetric label="今日图片已制作" value={`${data.overview.imageUnitsToday} 张`} />
      <PlatformMetric label="图片制作中占用" value={`${data.overview.reservedImageUnits} 张`} />
      <PlatformMetric label="今日 API 成本" value={formatCny(data.overview.apiCashMicrosToday)} />
      <PlatformMetric label="有效会员" value={String(data.overview.activeMembers)} />
      <PlatformMetric label="本月会员流水" value={formatCny(data.overview.monthRevenueCashMicros)} />
    </section>
    <div className="platform-two-column">
      <PlatformPanel title="商业概况" description="收入只统计会员不可变流水，不把套餐标价当成实收。">
        <dl className="platform-fact-grid">
          <Fact label="注册用户" value={String(data.business.registeredUsers)} />
          <Fact label="累计付费用户" value={String(data.business.cumulativePaidUsers)} />
          <Fact label="累计付费率" value={formatRatio(data.business.cumulativePaidRate)} />
          <Fact label="近30天新用户" value={String(data.business.newUsers30d)} />
          <Fact label="近30天首付用户" value={String(data.business.firstPaidUsers30d)} />
          <Fact label="近30天首付率" value={formatRatio(data.business.firstPaidRate30d)} />
        </dl>
      </PlatformPanel>
      <PlatformPanel title="近七日趋势" description="每日模型调用、算力、图片制作、API成本和会员流水。">
        <div className="platform-trend-list">{data.trend.map((item) => <div key={item.day}>
          <span>{item.day.slice(5)}</span><b>{item.calls} 次</b><small>{formatCompute(item.compute)} · 图片 {item.imageUnits} 张 · {formatCny(item.cashMicros)} · 收入 {formatCny(item.revenueCashMicros)}</small>
        </div>)}</div>
      </PlatformPanel>
    </div>
    <PlatformPanel title="近期高用量用户" description="按近七日模型算力排序，便于发现异常或高活跃用户。">
      <PlatformTable headers={['用户', '调用', '算力', '图片已制作', 'API成本']} empty="近期没有模型调用">
        {data.topUsers.map((item) => <tr key={item.userId}><td data-label="用户"><strong>{item.displayName}</strong><small>{item.email}</small></td><td data-label="调用">{item.calls}</td><td data-label="算力">{formatCompute(item.compute)}</td><td data-label="图片已制作">{item.imageUnits} 张</td><td data-label="API成本">{formatCny(item.cashMicros)}</td></tr>)}
      </PlatformTable>
    </PlatformPanel>
  </div>;
}

function UsersPage({ currentAccountId }: { currentAccountId: string | undefined }): React.JSX.Element {
  const [query, setQuery] = useState('');
  const loader = useCallback((signal?: AbortSignal) => loadUsersPage(query, signal), [query]);
  const state = useRemoteData(loader);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingPause, setConfirmingPause] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const operationByUser = useMemo(() => new Map((state.data?.operations ?? []).map((item) => [item.userId, item])), [state.data]);
  const items = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    return (state.data?.users ?? []).filter((item) => {
      const operation = operationByUser.get(item.userId);
      return normalized.length === 0 || `${item.displayName} ${item.email} ${operation?.books.map((book) => book.title).join(' ') ?? ''}`.toLocaleLowerCase('zh-CN').includes(normalized);
    });
  }, [operationByUser, query, state.data]);
  const selected = state.data?.users.find((item) => item.userId === selectedUserId) ?? null;
  const selectedOperation = selected === null ? null : operationByUser.get(selected.userId) ?? null;

  const openUser = (userId: string): void => {
    setSelectedUserId((current) => current === userId ? null : userId);
    setConfirmingPause(false);
    setActionError(null);
  };

  const changeStatus = async (nextStatus: PlatformUser['status']): Promise<void> => {
    if (selected === null) return;
    setBusy(true);
    setActionError(null);
    try {
      await setPlatformUserStatus(selected.userId, nextStatus);
      setMessage(nextStatus === 'active' ? `已恢复 ${selected.displayName} 的账号。` : `已暂停 ${selected.displayName} 的账号并撤销旧会话。`);
      setSelectedUserId(null);
      setConfirmingPause(false);
      state.reload();
    } catch (reason) {
      setActionError(safePlatformMessage(reason, '账号状态没有更新成功，请稍后重试。'));
    } finally {
      setBusy(false);
    }
  };

  if (state.data === null) return <RemoteState label="正在读取用户和书籍活动…" error={state.error} onRetry={state.reload} />;
  return <div className="asset-page platform-page">
    <PlatformHeading title="用户与书籍活动" description="查看账号和书籍进度；暂停账号会立即撤销该账号的旧会话。" count={`${items.length} / ${state.data.total}`} onRefresh={state.reload} />
    {message !== null && <p className="platform-action-message" role="status">{message}</p>}
    <PlatformSearch value={query} onChange={setQuery} placeholder="搜索昵称、邮箱或书名" />
    <PlatformTable headers={['用户', '书籍', '今日任务', '最近活动', '状态', '']} empty="没有符合条件的用户">
      {items.map((item) => {
        const operation = operationByUser.get(item.userId);
        return <tr key={item.userId}>
          <td data-label="用户"><strong>{item.displayName}</strong><small>{item.email}</small></td>
          <td data-label="书籍">{operation?.activeBookCount ?? 0} 本活跃 / {operation?.bookCount ?? 0} 本</td>
          <td data-label="今日任务">{operation?.today.taskCount ?? 0}{(operation?.today.failureCount ?? 0) > 0 ? ` · ${operation?.today.failureCount} 失败` : ''}</td>
          <td data-label="最近活动">{formatDateTime(operation?.lastActivityAt ?? item.lastLoginAt ?? null)}</td>
          <td data-label="状态"><Status value={item.status === 'active' ? '正常' : '已暂停'} tone={item.status === 'active' ? 'success' : 'warning'} /></td>
          <td data-label="管理"><button className="asset-row-action" type="button" aria-expanded={selectedUserId === item.userId} onClick={() => openUser(item.userId)}>{selectedUserId === item.userId ? '收起' : '管理'}</button></td>
        </tr>;
      })}
    </PlatformTable>
    {selected !== null && <section className="platform-inline-editor" aria-label={`${selected.displayName} 用户管理`}>
      <header><div><small>账号管理</small><h2>{selected.displayName}</h2><p>{selected.email}</p></div><button type="button" onClick={() => setSelectedUserId(null)}>收起</button></header>
      <div className="platform-inline-body">
        <dl className="platform-detail-list"><Fact label="身份" value={selected.role === 'admin' ? '平台管理员' : '普通用户'} /><Fact label="注册时间" value={formatDateTime(selected.createdAt ?? null)} /><Fact label="最近活动" value={formatDateTime(selectedOperation?.lastActivityAt ?? selected.lastLoginAt ?? null)} /><Fact label="会员" value={selectedOperation?.membership?.plan ? planLabel(selectedOperation.membership.plan) : '未开通'} /><Fact label="失败任务" value={String(selectedOperation?.failures.length ?? 0)} /></dl>
        <h3>书籍与当前进度</h3>
        {selectedOperation === null || selectedOperation.books.length === 0 ? <p className="platform-muted">还没有书籍。</p> : <div className="platform-book-list">{selectedOperation.books.map((book) => <article key={book.bookId}><strong>{book.title}</strong><span>{book.status} · {book.workflowStage}</span><small>卷 {book.currentVolume ?? '—'} · 事件 {book.currentEvent ?? '—'} · 章节 {book.currentChapter ?? '—'}</small><small>最近任务：{book.latestTaskStatus ?? '无'}</small></article>)}</div>}
        {actionError !== null && <p className="platform-action-error" role="alert">{actionError}</p>}
        {selected.userId === currentAccountId ? <p className="platform-action-note">当前登录管理员不能暂停自己的账号。</p> : selected.status === 'suspended' ? <div className="platform-inline-actions"><button className="primary" type="button" disabled={busy} onClick={() => void changeStatus('active')}>{busy ? '正在恢复…' : '恢复账号'}</button></div> : confirmingPause ? <div className="platform-inline-confirm" role="group" aria-label="确认暂停账号"><p>暂停后，这个账号的现有登录会立即失效。确定继续吗？</p><div><button type="button" disabled={busy} onClick={() => setConfirmingPause(false)}>取消</button><button className="danger" type="button" disabled={busy} onClick={() => void changeStatus('suspended')}>{busy ? '正在暂停…' : '确认暂停账号'}</button></div></div> : <div className="platform-inline-actions"><button className="danger" type="button" disabled={busy} onClick={() => setConfirmingPause(true)}>暂停账号</button></div>}
      </div>
    </section>}
  </div>;
}

function UsagePage(): React.JSX.Element {
  const state = useRemoteData(fetchPlatformUsage);
  if (state.data === null) return <RemoteState label="正在读取算力、图片和 API 成本…" error={state.error} onRetry={state.reload} />;
  const data = state.data;
  return <div className="asset-page platform-page">
    <PlatformHeading title="算力、图片与 API 成本" description="统一用量账本是唯一统计来源；不展示 API Key、思维链或供应商密钥。" onRefresh={state.reload} />
    <section className="platform-metrics" aria-label="累计用量">
      <PlatformMetric label="累计调用" value={`${data.totalCalls} 次`} />
      <PlatformMetric label="累计算力" value={formatCompute(data.totalTokens * 2)} />
      <PlatformMetric label="图片已制作" value={`${data.totalImageUnits} 张`} />
      <PlatformMetric label="制作中占用" value={`${data.totalReservedImageUnits} 张`} />
      <PlatformMetric label="累计 API 成本" value={formatCny(data.totalCashMicros)} />
      <PlatformMetric label="有调用的模型" value={String(data.perModel.length)} />
    </section>
    <div className="platform-two-column">
      <PlatformPanel title="按模型" description="供应商与模型仅在管理员审计面展示。">
        <PlatformTable headers={['模型', '调用', '算力', '图片已制作', '成本']} empty="暂无模型调用">
          {data.perModel.map((item) => <tr key={`${item.provider}:${item.modelId}`}><td data-label="模型"><strong>{item.modelId}</strong><small>{item.provider}</small></td><td data-label="调用">{item.calls}</td><td data-label="算力">{formatCompute(item.tokens * 2)}</td><td data-label="图片已制作">{item.imageUnits} 张</td><td data-label="成本">{formatCny(item.cashMicros ?? 0)}</td></tr>)}
        </PlatformTable>
      </PlatformPanel>
      <PlatformPanel title="按用户" description="用于发现异常用量，不改变用户余额。">
        <PlatformTable headers={['用户', '书籍', '调用', '算力', '图片']} empty="暂无用户调用">
          {data.perUser.slice(0, 30).map((item) => <tr key={item.userId}><td data-label="用户"><strong>{item.displayName}</strong><small>{item.email}</small></td><td data-label="书籍">{item.books}</td><td data-label="调用">{item.calls}</td><td data-label="算力">{formatCompute(item.tokens * 2)}</td><td data-label="图片"><span>{item.imageUnits} 张已制作</span>{item.reservedImageUnits > 0 && <small>{item.reservedImageUnits} 张制作中占用</small>}</td></tr>)}
        </PlatformTable>
      </PlatformPanel>
    </div>
  </div>;
}

function IssuesPage(): React.JSX.Element {
  const state = useRemoteData(loadIssues);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [selected, setSelected] = useState<PlatformIssue | null>(null);
  const [edit, setEdit] = useState<Pick<PlatformIssue, 'status' | 'severity' | 'note'>>({ status: 'open', severity: 'medium', note: '' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const items = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    return (state.data ?? []).filter((item) => {
      const statusMatch = status === 'all' || (status === 'active' ? item.status === 'open' || item.status === 'in_progress' : item.status === status);
      const queryMatch = normalized.length === 0 || `${item.displayName} ${item.email} ${item.bookTitle} ${item.category} ${item.detail}`.toLocaleLowerCase('zh-CN').includes(normalized);
      return statusMatch && queryMatch;
    });
  }, [query, state.data, status]);

  const openIssue = (issue: PlatformIssue): void => {
    if (selected?.sourceType === issue.sourceType && selected.sourceId === issue.sourceId) {
      setSelected(null);
      return;
    }
    setSelected(issue);
    setEdit({ status: issue.status, severity: issue.severity, note: issue.note });
    setActionError(null);
  };

  const saveIssue = async (): Promise<void> => {
    if (selected === null) return;
    setBusy(true);
    setActionError(null);
    try {
      await updatePlatformIssue(selected, edit);
      setMessage('问题处理结果已保存。');
      setSelected(null);
      state.reload();
    } catch (reason) {
      setActionError(safePlatformMessage(reason, '问题处理结果没有保存成功，请稍后重试。'));
    } finally {
      setBusy(false);
    }
  };

  if (state.data === null) return <RemoteState label="正在读取问题记录…" error={state.error} onRetry={state.reload} />;
  return <div className="asset-page platform-page">
    <PlatformHeading title="问题记录" description="集中查看失败任务和作者反馈，并在当前页面记录处理结果。" count={`${items.length} / ${state.data.length}`} onRefresh={state.reload} />
    {message !== null && <p className="platform-action-message" role="status">{message}</p>}
    <div className="platform-filter-bar"><PlatformSearch value={query} onChange={setQuery} placeholder="搜索用户、书籍或问题" /><select aria-label="筛选问题状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">待处理</option><option value="all">全部</option><option value="open">未处理</option><option value="in_progress">处理中</option><option value="resolved">已解决</option><option value="ignored">已忽略</option></select></div>
    <PlatformTable headers={['问题', '用户/书籍', '状态', '严重度', '时间', '']} empty="没有符合条件的问题">
      {items.map((item) => <tr key={`${item.sourceType}:${item.sourceId}`}>
        <td data-label="问题"><strong>{item.category}</strong><small className="platform-clamp">{item.detail}</small></td>
        <td data-label="用户/书籍"><span>{item.displayName || '未知用户'}</span><small>{item.bookTitle || item.email || '未关联书籍'}</small></td>
        <td data-label="状态"><Status value={issueStatusLabel(item.status)} tone={item.status === 'open' ? 'warning' : item.status === 'resolved' ? 'success' : 'normal'} /></td>
        <td data-label="严重度">{severityLabel(item.severity)}</td>
        <td data-label="时间">{formatDateTime(item.occurredAt)}</td>
        <td data-label="处理"><button className="asset-row-action" type="button" aria-expanded={selected?.sourceType === item.sourceType && selected.sourceId === item.sourceId} onClick={() => openIssue(item)}>{selected?.sourceType === item.sourceType && selected.sourceId === item.sourceId ? '收起' : '处理'}</button></td>
      </tr>)}
    </PlatformTable>
    {selected !== null && <section className="platform-inline-editor" aria-label="问题处理">
      <header><div><small>{selected.sourceType === 'feedback' ? '作者反馈' : '失败任务'}</small><h2>{selected.category}</h2><p>{selected.displayName || '未知用户'}{selected.bookTitle ? ` · ${selected.bookTitle}` : ''}</p></div><button type="button" onClick={() => setSelected(null)}>收起</button></header>
      <div className="platform-inline-body">
        <dl className="platform-detail-list"><Fact label="用户" value={`${selected.displayName || '未知'} ${selected.email ? `· ${selected.email}` : ''}`} /><Fact label="书籍" value={selected.bookTitle || '未关联'} /><Fact label="发生时间" value={formatDateTime(selected.occurredAt)} /><Fact label="页面" value={selected.pagePath || '未记录'} /></dl>
        <h3>问题内容</h3><p className="platform-detail-copy">{selected.detail}</p>
        <div className="platform-edit-fields">
          <label>严重度<select value={edit.severity} onChange={(event) => setEdit((current) => ({ ...current, severity: event.target.value as PlatformIssue['severity'] }))}><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="critical">紧急</option></select></label>
          <label>处理状态<select value={edit.status} onChange={(event) => setEdit((current) => ({ ...current, status: event.target.value as PlatformIssue['status'] }))}><option value="open">未处理</option><option value="in_progress">处理中</option><option value="resolved">已解决</option><option value="ignored">已忽略</option></select></label>
          <label className="wide">处理记录<textarea value={edit.note} onChange={(event) => setEdit((current) => ({ ...current, note: event.target.value }))} placeholder="记录根因、修复版本或忽略理由" /></label>
        </div>
        {actionError !== null && <p className="platform-action-error" role="alert">{actionError}</p>}
        <div className="platform-inline-actions"><button className="primary" type="button" disabled={busy} onClick={() => void saveIssue()}>{busy ? '正在保存…' : '保存处理结果'}</button></div>
      </div>
    </section>}
  </div>;
}

function MembershipsPage(): React.JSX.Element {
  const [query, setQuery] = useState('');
  const loader = useCallback((signal?: AbortSignal) => loadMembershipsPage(query, signal), [query]);
  const state = useRemoteData(loader);
  const [selected, setSelected] = useState<MembershipUser | null>(null);
  const [plan, setPlan] = useState<MembershipPlan>('silver');
  const [amountCny, setAmountCny] = useState(98);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState(() => newPlatformActionKey('membership'));
  const [revokeKey, setRevokeKey] = useState(() => newPlatformActionKey('membership-revoke'));
  const items = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN');
    return (state.data?.users ?? []).filter((item) => normalized.length === 0 || `${item.displayName} ${item.email}`.toLocaleLowerCase('zh-CN').includes(normalized));
  }, [query, state.data]);
  useEffect(() => {
    if (selected === null || state.data === null) return;
    setSelected(state.data.users.find((item) => item.userId === selected.userId) ?? null);
  }, [selected?.userId, state.data]);

  const openMembership = (user: MembershipUser): void => {
    if (selected?.userId === user.userId) {
      setSelected(null);
      return;
    }
    const nextPlan = user.membership === null || user.membership.plan === 'bronze'
      ? 'silver'
      : user.membership.plan;
    setSelected(user);
    setPlan(nextPlan);
    setAmountCny(defaultPlanAmount(nextPlan));
    setNote('');
    setActionKey(newPlatformActionKey('membership'));
    setRevokeKey(newPlatformActionKey('membership-revoke'));
    setConfirmingRevoke(false);
    setActionError(null);
  };

  const choosePlan = (value: MembershipPlan): void => {
    setPlan(value);
    setAmountCny(defaultPlanAmount(value));
    setActionKey(newPlatformActionKey('membership'));
  };

  const saveMembership = async (): Promise<void> => {
    if (selected === null || !Number.isFinite(amountCny) || amountCny < 0 || amountCny > 100_000) {
      setActionError('请填写 0 到 100000 元之间的实收金额。');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await grantMembership(selected.userId, { plan, amountCny, note, idempotencyKey: actionKey });
      setMessage(`已为 ${selected.displayName} 办理会员并记录流水。`);
      setSelected(null);
      state.reload();
    } catch (reason) {
      setActionError(safePlatformMessage(reason, '会员没有办理成功，请稍后重试。'));
    } finally {
      setBusy(false);
    }
  };

  const removeMembership = async (): Promise<void> => {
    if (selected === null) return;
    setBusy(true);
    setActionError(null);
    try {
      await revokeMembership(selected.userId, revokeKey);
      setMessage(`已撤销 ${selected.displayName} 的会员，历史流水仍保留。`);
      setSelected(null);
      setConfirmingRevoke(false);
      state.reload();
    } catch (reason) {
      setActionError(safePlatformMessage(reason, '会员没有撤销成功，请稍后重试。'));
    } finally {
      setBusy(false);
    }
  };

  if (state.data === null) return <RemoteState label="正在读取会员和收入流水…" error={state.error} onRetry={state.reload} />;
  const data = state.data.stats;
  const selectedHasActivePaidMembership = selected?.membership?.status === 'active'
    && !selected.membership.expired
    && selected.membership.plan !== 'bronze';
  const selectedHasCurrentMembership = selected?.membership?.status === 'active'
    && !selected.membership.expired;
  const selectedIsBronzeUpgrade = selected?.membership?.status === 'active'
    && !selected.membership.expired
    && selected.membership.plan === 'bronze'
    && plan !== 'bronze';
  return <div className="asset-page platform-page">
    <PlatformHeading title="会员与收入" description="办理、续费和撤销都在当前页面完成；历史流水始终保留。" count={`${items.length} / ${state.data.total}`} onRefresh={state.reload} />
    {message !== null && <p className="platform-action-message" role="status">{message}</p>}
    <section className="platform-metrics compact" aria-label="会员指标">
      <PlatformMetric label="有效会员" value={String(data.summary.activeMembers)} />
      <PlatformMetric label="累计会员流水" value={formatCny(data.summary.totalRevenueCashMicros)} />
      <PlatformMetric label="本月会员流水" value={formatCny(data.summary.monthRevenueCashMicros)} />
      <PlatformMetric label="30天内到期" value={String(data.summary.expiringIn30Days)} tone={data.summary.expiringIn30Days > 0 ? 'warning' : 'normal'} />
    </section>
    <PlatformSearch value={query} onChange={setQuery} placeholder="搜索会员昵称或邮箱" />
    <PlatformPanel title="用户会员" description="管理员账号不限额；普通用户可在同页办理、续费或撤销。">
      <PlatformTable headers={['用户', '当前套餐', '剩余算力', '到期时间', '']} empty="没有符合条件的用户">
        {items.map((user) => {
          const membership = user.membership;
          const remainingCompute = membership === null ? 0 : Math.max(0, membership.tokenQuota - membership.periodTokens * 2);
          return <tr key={user.userId}>
            <td data-label="用户"><strong>{user.displayName}</strong><small>{user.email}</small></td>
            <td data-label="当前套餐">{user.role === 'admin' ? '管理员不限额' : membership === null ? '未开通' : `${membership.planLabel}${membership.status === 'revoked' ? ' · 已撤销' : membership.expired ? ' · 已到期' : ''}`}</td>
            <td data-label="剩余算力">{user.role === 'admin' ? '不限' : formatCompute(remainingCompute)}</td>
            <td data-label="到期时间">{membership === null ? '—' : formatDateTime(membership.periodEnd)}</td>
            <td data-label="办理"><button className="asset-row-action" type="button" disabled={user.role === 'admin'} aria-expanded={selected?.userId === user.userId} onClick={() => openMembership(user)}>{selected?.userId === user.userId ? '收起' : '办理'}</button></td>
          </tr>;
        })}
      </PlatformTable>
    </PlatformPanel>
    {selected !== null && <section className="platform-inline-editor" aria-label={`为 ${selected.displayName} 办理会员`}>
      <header><div><small>会员办理</small><h2>{selected.displayName}</h2><p>{selected.email}</p></div><button type="button" onClick={() => setSelected(null)}>收起</button></header>
      <div className="platform-inline-body">
        <dl className="platform-detail-list"><Fact label="当前会员" value={selected.membership?.planLabel ?? '未开通'} /><Fact label="当前到期" value={selected.membership === null ? '—' : formatDateTime(selected.membership.periodEnd)} /><Fact label="累计算力" value={formatCompute(selected.totalTokens * 2)} /></dl>
        <div className="platform-edit-fields">
          <label>会员套餐<select value={plan} onChange={(event) => choosePlan(event.target.value as MembershipPlan)}><option value="bronze" disabled={selectedHasCurrentMembership}>青铜 · 20万算力</option><option value="silver">白银 · 2000万算力</option><option value="gold">黄金 · 5000万算力</option><option value="diamond">钻石 · 2亿算力</option></select></label>
          <label>本次实收金额（元）<input type="number" min="0" max="100000" step="0.01" value={amountCny} onChange={(event) => { setAmountCny(Number(event.target.value)); setActionKey(newPlatformActionKey('membership')); }} /></label>
          <label className="wide">备注<input value={note} onChange={(event) => { setNote(event.target.value); setActionKey(newPlatformActionKey('membership')); }} placeholder="优惠、渠道或补发说明（可空）" /></label>
        </div>
        <p className="platform-action-note">{selectedHasActivePaidMembership
          ? '有效付费会员续费会保留剩余时间，并从当前到期日继续顺延；本次办理会新增一条不可变流水。'
          : selectedIsBronzeUpgrade
            ? '青铜体验升级为付费会员时，从办理当天开始计算12个月，不会把体验档的长期有效期带入付费套餐。'
            : '本次会员办理从今天开始计算有效期，并新增一条不可变流水。'}</p>
        {actionError !== null && <p className="platform-action-error" role="alert">{actionError}</p>}
        <div className="platform-inline-actions"><button className="primary" type="button" disabled={busy} onClick={() => void saveMembership()}>{busy ? '正在办理…' : selectedIsBronzeUpgrade ? '升级并记录收入' : selectedHasActivePaidMembership ? '续费并记录收入' : '开通并记录收入'}</button></div>
        {selected.membership?.status === 'active' && !selected.membership.expired && (confirmingRevoke ? <div className="platform-inline-confirm" role="group" aria-label="确认撤销会员"><p>撤销会立即结束当前会员权益，但不会删除历史办理流水。</p><div><button type="button" disabled={busy} onClick={() => setConfirmingRevoke(false)}>取消</button><button className="danger" type="button" disabled={busy} onClick={() => void removeMembership()}>{busy ? '正在撤销…' : '确认撤销会员'}</button></div></div> : <button className="platform-secondary-danger" type="button" disabled={busy} onClick={() => { setRevokeKey(newPlatformActionKey('membership-revoke')); setConfirmingRevoke(true); }}>撤销会员</button>)}
      </div>
    </section>}
    <div className="platform-two-column membership-layout">
      <PlatformPanel title="当前套餐分布" description="只统计仍在有效期内的活动会员。"><div className="platform-plan-list">{data.byPlan.length === 0 ? <p className="platform-muted">暂无有效会员</p> : data.byPlan.map((item) => <div key={item.plan}><span>{planLabel(item.plan)}</span><strong>{item.members} 人</strong></div>)}</div></PlatformPanel>
      <PlatformPanel title="最近会员流水" description="开通、续费和撤销均保留历史。">
        <PlatformTable headers={['用户', '类型', '套餐', '金额', '时间']} empty="暂无会员流水">
          {data.transactions.map((item) => <tr key={item.transactionId}><td data-label="用户"><strong>{item.displayName}</strong><small>{item.email}</small></td><td data-label="类型">{transactionLabel(item.eventType)}</td><td data-label="套餐">{planLabel(item.plan)}</td><td data-label="金额">{formatCny(item.amountCashMicros)}</td><td data-label="时间">{formatDateTime(item.createdAt)}</td></tr>)}
        </PlatformTable>
      </PlatformPanel>
    </div>
  </div>;
}

function useRemoteData<T>(loader: (signal?: AbortSignal) => Promise<T>): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void loader(controller.signal).then(setData).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(safePlatformMessage(reason));
    });
    return () => controller.abort();
  }, [loader, revision]);
  return { data, error, reload: () => { setData(null); setRevision((value) => value + 1); } };
}

interface UsersPageData { users: PlatformUser[]; total: number; operations: UserOperation[] }
interface MembershipsPageData { users: MembershipUser[]; total: number; stats: MembershipStats }

const loadUsersPage = async (query: string, signal?: AbortSignal): Promise<UsersPageData> => {
  const [users, operations] = await Promise.all([fetchPlatformUsers(query, signal), fetchUserOperations(signal)]);
  return { users: users.items, total: users.total, operations: operations.items };
};
const loadIssues = async (signal?: AbortSignal): Promise<PlatformIssue[]> => (await fetchPlatformIssues(signal)).items;
const loadMembershipsPage = async (query: string, signal?: AbortSignal): Promise<MembershipsPageData> => {
  const [memberships, stats] = await Promise.all([fetchMembershipUsers(query, signal), fetchMembershipStats(signal)]);
  return { users: memberships.items, total: memberships.total, stats };
};

function PlatformHeading({ title, description, count, onRefresh }: { title: string; description: string; count?: string; onRefresh: () => void }): React.JSX.Element {
  return <header className="asset-page-heading platform-heading"><div><h1>{title}</h1><p>{description}</p></div><div>{count && <strong>{count}</strong>}<button type="button" onClick={onRefresh}><ArrowClockwise aria-hidden="true" />刷新</button></div></header>;
}

function PlatformMetric({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'warning' }): React.JSX.Element {
  return <article className={`platform-metric ${tone}`}><span>{label}</span><strong>{value}</strong></article>;
}

function PlatformPanel({ title, description, children }: { title: string; description: string; children: React.ReactNode }): React.JSX.Element {
  return <section className="platform-panel"><header><h2>{title}</h2><p>{description}</p></header>{children}</section>;
}

function PlatformTable({ headers, empty, children }: { headers: string[]; empty: string; children: React.ReactNode }): React.JSX.Element {
  const rows = Array.isArray(children) ? children : children === null || children === undefined ? [] : [children];
  return <div className="asset-table-wrap platform-table"><table><thead><tr>{headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr></thead><tbody>{rows.length > 0 ? children : <tr><td colSpan={headers.length}>{empty}</td></tr>}</tbody></table></div>;
}

function PlatformSearch({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }): React.JSX.Element {
  return <label className="platform-search"><MagnifyingGlass aria-hidden="true" /><span className="sr-only">{placeholder}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

function RemoteState({ label, error, onRetry }: { label: string; error: string | null; onRetry: () => void }): React.JSX.Element {
  return <div className="platform-remote-state" role={error === null ? 'status' : 'alert'}>{error === null ? <><span className="asset-spinner" /><strong>{label}</strong><p>数据来自受保护的生产管理员接口。</p></> : <><strong>当前页面没有加载成功</strong><p>{error}</p><button type="button" onClick={onRetry}><ArrowClockwise aria-hidden="true" />重新加载</button></>}</div>;
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element { return <div><dt>{label}</dt><dd>{value || '—'}</dd></div>; }
function Status({ value, tone }: { value: string; tone: 'success' | 'warning' | 'normal' }): React.JSX.Element { return <span className={`platform-status ${tone}`}>{value}</span>; }

function formatCny(micros: number): string { return `¥${(micros / 1_000_000).toFixed(2)}`; }
function formatCompute(value: number): string { return value >= 100_000_000 ? `${(value / 100_000_000).toFixed(2)}亿` : value >= 10_000 ? `${(value / 10_000).toFixed(1)}万` : value.toLocaleString('zh-CN'); }
function formatRatio(value: number | null): string { return value === null ? '—' : `${(value * 100).toFixed(1)}%`; }
function formatDateTime(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false }); }
function issueStatusLabel(value: PlatformIssue['status']): string { return ({ open: '未处理', in_progress: '处理中', resolved: '已解决', ignored: '已忽略' })[value]; }
function severityLabel(value: PlatformIssue['severity']): string { return ({ low: '低', medium: '中', high: '高', critical: '紧急' })[value]; }
function planLabel(value: string): string { return ({ bronze: '青铜', silver: '白银', gold: '黄金', diamond: '钻石' } as Record<string, string>)[value] ?? value; }
function defaultPlanAmount(value: MembershipPlan): number { return ({ bronze: 0, silver: 98, gold: 198, diamond: 980 })[value]; }
function transactionLabel(value: string): string { return ({ grant: '开通', renew: '续费', revoke: '撤销' } as Record<string, string>)[value] ?? value; }
function safePlatformMessage(reason: unknown, fallback = '读取生产数据失败，请稍后重试。'): string { if (reason !== null && typeof reason === 'object') { const message = Reflect.get(reason, 'message'); if (typeof message === 'string' && message.length > 0 && message.length <= 300 && !/(?:\bSQL\b|sqlite|stack|node_modules|Bearer\s)/iu.test(message)) return message; } return fallback; }
