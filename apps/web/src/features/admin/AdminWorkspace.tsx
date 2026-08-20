import { useCallback, useEffect, useState } from 'react';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import {
  fetchAdminMemberships, fetchAdminModelScheme, fetchAdminOverview, fetchAdminUsage, fetchAdminUsers,
  grantAdminMembership, revokeAdminMembership, saveAdminModelScheme, updateAdminUserStatus,
  type AdminMembershipUserData, type AdminModelSchemeData, type AdminOverviewData, type AdminUsageData,
  type AuthAccountData, type MembershipPlanKey
} from '../../lib/api/client';

const PLAN_OPTIONS: Array<{ value: MembershipPlanKey; label: string }> = [
  { value: 'bronze', label: '青铜 · 20万算力值' },
  { value: 'silver', label: '白银 · 98元 · 2000万算力值' },
  { value: 'gold', label: '黄金 · 198元 · 5000万算力值' },
  { value: 'diamond', label: '钻石 · 980元 · 2亿算力值' }
];

const ADMIN_PAGE_SIZE = 50;

/** 算力值展示口径（2026-08-20 老板拍板）：系统记真实消耗，前台一律按双倍显示算力值。 */
const COMPUTE_DISPLAY_MULTIPLIER = 2;

/** 算力值展示：亿为单位保留一位小数，不足一亿显示万。 */
function formatComputePoints(tokens: number): string {
  const value = tokens * COMPUTE_DISPLAY_MULTIPLIER;
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(value);
}

/** token_quota 本身就是算力值（双倍口径），无需再乘。 */
function formatComputeQuota(computeValue: number): string {
  if (computeValue >= 100_000_000) return `${(computeValue / 100_000_000).toFixed(1)}亿`;
  if (computeValue >= 10_000) return `${(computeValue / 10_000).toFixed(1)}万`;
  return String(computeValue);
}

function formatDate(iso: string): string {
  return iso === '' ? '' : iso.slice(0, 10);
}

export function AdminWorkspace({ currentUser }: { currentUser: AuthAccountData }): React.JSX.Element {
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [users, setUsers] = useState<AuthAccountData[]>([]);
  const [memberships, setMemberships] = useState<AdminMembershipUserData[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [planChoice, setPlanChoice] = useState<Record<string, MembershipPlanKey>>({});
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<AdminUsageData | null>(null);
  const [scheme, setScheme] = useState<AdminModelSchemeData | null>(null);
  const [schemeChoice, setSchemeChoice] = useState<Record<string, string>>({});
  const [schemeBusy, setSchemeBusy] = useState(false);
  const [schemeMessage, setSchemeMessage] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const [nextOverview, nextUsers, nextMemberships, nextUsage, nextScheme] = await Promise.all([
      fetchAdminOverview(signal),
      fetchAdminUsers({ query, status, offset, limit: ADMIN_PAGE_SIZE }, signal),
      fetchAdminMemberships({ query, status, offset, limit: ADMIN_PAGE_SIZE }, signal),
      fetchAdminUsage(signal),
      fetchAdminModelScheme(signal)
    ]);
    setOverview(nextOverview); setUsers(nextUsers.items); setMemberships(nextMemberships.items);
    setTotal(nextUsers.total); setUsage(nextUsage); setScheme(nextScheme);
    setSchemeChoice(Object.fromEntries(nextScheme.members.map((member) => {
      const profile = nextScheme.profiles[member.roleKey];
      return [member.roleKey, profile === undefined ? '' : `${profile.provider}/${profile.modelId}`];
    })));
    setError(null);
  }, [query, status, offset]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(authorErrorFromUnknown(reason, '用户列表暂时无法打开'));
    });
    return () => controller.abort();
  }, [load]);

  const changeQuery = (value: string): void => { setQuery(value); setOffset(0); };
  const changeStatusFilter = (value: string): void => { setStatus(value); setOffset(0); };

  const membershipOf = (userId: string): AdminMembershipUserData | undefined =>
    memberships.find((entry) => entry.userId === userId);

  const changeStatus = async (account: AuthAccountData): Promise<void> => {
    setBusyUserId(account.userId);
    try {
      await updateAdminUserStatus(account.userId, account.status === 'active' ? 'suspended' : 'active');
      await load();
    } catch (reason) {
      setError(authorErrorFromUnknown(reason, '账号状态没有修改成功'));
    } finally {
      setBusyUserId(null);
    }
  };

  const grant = async (userId: string): Promise<void> => {
    const plan = planChoice[userId] ?? 'silver';
    setBusyUserId(userId);
    try {
      await grantAdminMembership(userId, plan);
      await load();
      setError(null);
    } catch (reason) {
      setError(authorErrorFromUnknown(reason, '会员没有开通成功'));
    } finally {
      setBusyUserId(null);
    }
  };

  const revoke = async (userId: string): Promise<void> => {
    setBusyUserId(userId);
    try {
      await revokeAdminMembership(userId);
      await load();
      setError(null);
    } catch (reason) {
      setError(authorErrorFromUnknown(reason, '会员没有撤销成功'));
    } finally {
      setBusyUserId(null);
    }
  };

  const saveScheme = async (): Promise<void> => {
    if (scheme === null) return;
    setSchemeBusy(true);
    setSchemeMessage(null);
    try {
      const profiles = Object.fromEntries(scheme.members.map((member) => {
        const key = schemeChoice[member.roleKey] ?? '';
        const [provider = '', modelId = ''] = key.split('/');
        const allowed = scheme.allowedModels.find((item) => item.provider === provider && item.modelId === modelId);
        return [member.roleKey, allowed ?? { provider, modelId, plan: 'agent' }];
      }));
      const result = await saveAdminModelScheme(profiles);
      setSchemeMessage(`已保存并应用到全部书籍：检查 ${result.convergence.booksVisited} 本，更新 ${result.convergence.revisedBooks} 本。`);
      await load();
    } catch (reason) {
      setSchemeMessage(authorErrorFromUnknown(reason, '模型方案没有保存成功'));
    } finally {
      setSchemeBusy(false);
    }
  };

  return <section className="admin-workspace">
    <header><div><span>管理后台</span><h2>用户与会员管理</h2></div><p>查看注册用户、算力值消耗并开通会员。密码永远不会在这里显示。</p></header>
    {overview !== null && <div className="admin-overview" aria-label="用户概况">
      <article><strong>{overview.totalUsers}</strong><span>全部用户</span></article>
      <article><strong>{overview.activeUsers}</strong><span>正常使用</span></article>
      <article><strong>{overview.suspendedUsers}</strong><span>已暂停</span></article>
      <article><strong>{overview.totalBooks}</strong><span>用户书籍</span></article>
      <article><strong>{formatComputePoints(overview.totalTokens)}</strong><span>总算力值消耗</span></article>
    </div>}
    <div className="admin-filters">
      <label><span className="sr-only">搜索用户</span><input value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="搜索昵称或邮箱" /></label>
      <select value={status} onChange={(event) => changeStatusFilter(event.target.value)} aria-label="按账号状态筛选"><option value="">全部状态</option><option value="active">正常使用</option><option value="suspended">已暂停</option></select>
    </div>
    {error !== null && <p className="auth-error" role="alert">{error}</p>}
    <div className="admin-user-list admin-membership-list">
      {users.map((account) => {
        const membership = membershipOf(account.userId);
        const record = membership?.membership ?? null;
        const active = record !== null && record.status === 'active' && !record.expired;
        return <article key={account.userId} className="admin-membership-row">
          <div className="admin-user-main">
            <div className="admin-avatar" aria-hidden="true">{account.displayName.slice(0, 1).toUpperCase()}</div>
            <div><strong>{account.displayName}</strong><span>{account.email}</span></div>
          </div>
          <span className={`account-status ${account.status}`}>{account.status === 'active' ? '正常使用' : '已暂停'}</span>
          <span className="account-role">{account.role === 'admin' ? '管理员' : '用户'}</span>
          <div className="admin-membership-info">
            {account.role === 'admin'
              ? <span className="membership-plan">算力值不限</span>
              : record === null
                ? <span className="membership-plan none">未开通会员</span>
                : <span className={`membership-plan ${active ? 'active' : 'inactive'}`}>
                    {record.planLabel}{active ? '' : record.expired ? ' · 已到期' : ' · 已撤销'}
                  </span>}
            {account.role !== 'admin' && active && record !== null && (
              <span className="membership-quota">剩余 {formatComputeQuota(Math.max(0, record.tokenQuota - record.periodTokens * COMPUTE_DISPLAY_MULTIPLIER))} / {formatComputeQuota(record.tokenQuota)} 算力值 · 至 {formatDate(record.periodEnd)}</span>
            )}
            {membership !== undefined && membership.totalTokens > 0 && (
              <span className="membership-total">累计消耗 {formatComputePoints(membership.totalTokens)}</span>
            )}</div>
          {account.role !== 'admin' && (
            <div className="admin-membership-actions">
              <select
                value={planChoice[account.userId] ?? 'silver'}
                aria-label="选择会员套餐"
                disabled={busyUserId === account.userId}
                onChange={(event) => setPlanChoice((current) => ({ ...current, [account.userId]: event.target.value as MembershipPlanKey }))}
              >
                {PLAN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <button type="button" className="primary" disabled={busyUserId === account.userId} onClick={() => void grant(account.userId)}>
                {active ? '续费' : '开通会员'}
              </button>
              {active && <button type="button" disabled={busyUserId === account.userId} onClick={() => void revoke(account.userId)}>撤销</button>}
            </div>
          )}
          <button type="button" disabled={busyUserId === account.userId || account.userId === currentUser.userId} onClick={() => void changeStatus(account)}>
            {account.userId === currentUser.userId ? '当前账号' : account.status === 'active' ? '暂停账号' : '恢复账号'}
          </button>
        </article>;
      })}
      {users.length === 0 && <p className="admin-empty">没有找到符合条件的用户。</p>}
      {total > ADMIN_PAGE_SIZE && <div className="admin-pager">
        <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - ADMIN_PAGE_SIZE))}>上一页</button>
        <span>{offset + 1}-{Math.min(total, offset + users.length)} / {total}</span>
        <button type="button" disabled={offset + users.length >= total} onClick={() => setOffset(offset + ADMIN_PAGE_SIZE)}>下一页</button>
      </div>}
    </div>
    {usage !== null && <section className="admin-usage" aria-label="算力消耗">
      <h3>算力消耗</h3>
      <div className="admin-overview">
        <article><strong>{formatComputePoints(usage.totalTokens)}</strong><span>总算力值</span></article>
        <article><strong>{usage.totalCalls}</strong><span>总调用次数</span></article>
      </div>
      {usage.perModel.length > 0 && <div className="admin-usage-models">
        <h4>按模型统计</h4>
        {usage.perModel.map((row) => <div key={`${row.provider}/${row.modelId}`} className="admin-usage-row">
          <span className="admin-usage-name">{row.modelId}</span>
          <span>{formatComputePoints(row.tokens)} 算力值 · {row.calls} 次</span>
        </div>)}
      </div>}
      {usage.daily.length > 0 && <div className="admin-usage-daily">
        <h4>近 30 天趋势</h4>
        {[...usage.daily].reverse().map((row) => {
          const peak = Math.max(...usage.daily.map((item) => item.tokens), 1);
          return <div key={row.day} className="admin-usage-day">
            <span className="admin-usage-day-label">{row.day.slice(5)}</span>
            <span className="admin-usage-day-bar" style={{ width: `${Math.max(2, Math.round((row.tokens / peak) * 100))}%` }} />
            <span className="admin-usage-day-value">{formatComputePoints(row.tokens)}</span>
          </div>;
        })}
      </div>}
    </section>}
    {scheme !== null && <section className="admin-scheme" aria-label="模型管理">
      <h3>模型管理</h3>
      <p className="admin-scheme-note">
        这里决定每位创作成员背后使用哪个创作服务，保存后立即应用到所有书籍的未来任务，已经开始的任务不受影响。
        {scheme.source === 'custom' && scheme.updatedAt !== null ? ` 当前为自定义方案，最后保存于 ${scheme.updatedAt.slice(0, 16).replace('T', ' ')}。` : ' 当前使用默认方案。'}
      </p>
      <div className="admin-scheme-list">
        {scheme.members.map((member) => <div key={member.roleKey} className="admin-scheme-row">
          <span className="admin-scheme-member">{member.memberName}<small>{member.shortTitle}</small></span>
          <select
            value={schemeChoice[member.roleKey] ?? ''}
            aria-label={`${member.memberName}的创作服务`}
            disabled={schemeBusy}
            onChange={(event) => setSchemeChoice((current) => ({ ...current, [member.roleKey]: event.target.value }))}
          >
            {(schemeChoice[member.roleKey] ?? '') === '' && <option value="">未选择</option>}
            {scheme.allowedModels.map((model) => {
              const key = `${model.provider}/${model.modelId}`;
              return <option key={key} value={key}>{model.modelId}</option>;
            })}
          </select>
        </div>)}
      </div>
      <div className="admin-scheme-actions">
        <button type="button" className="primary" disabled={schemeBusy} onClick={() => void saveScheme()}>
          {schemeBusy ? '正在保存…' : '保存并应用到全部书籍'}
        </button>
        {schemeMessage !== null && <p className="admin-scheme-message" role="status">{schemeMessage}</p>}
      </div>
    </section>}
  </section>;
}
