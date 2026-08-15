import { useCallback, useEffect, useState } from 'react';
import {
  fetchAdminMemberships, fetchAdminOverview, fetchAdminUsers, grantAdminMembership,
  revokeAdminMembership, updateAdminUserStatus,
  type AdminMembershipUserData, type AdminOverviewData, type AuthAccountData, type MembershipPlanKey
} from '../../lib/api/client';

const PLAN_OPTIONS: Array<{ value: MembershipPlanKey; label: string }> = [
  { value: 'monthly', label: '包月 · 3亿算力值' },
  { value: 'quarterly', label: '包季 · 10亿算力值' },
  { value: 'yearly', label: '包年 · 百亿算力值' }
];

/** 算力值展示：亿为单位保留一位小数，不足一亿显示万。 */
function formatComputePoints(tokens: number): string {
  if (tokens >= 100_000_000) return `${(tokens / 100_000_000).toFixed(1)}亿`;
  if (tokens >= 10_000) return `${(tokens / 10_000).toFixed(1)}万`;
  return String(tokens);
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
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [planChoice, setPlanChoice] = useState<Record<string, MembershipPlanKey>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const [nextOverview, nextUsers, nextMemberships] = await Promise.all([
      fetchAdminOverview(signal), fetchAdminUsers({ query, status }, signal), fetchAdminMemberships(signal)
    ]);
    setOverview(nextOverview); setUsers(nextUsers); setMemberships(nextMemberships); setError(null);
  }, [query, status]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '用户列表暂时无法打开');
    });
    return () => controller.abort();
  }, [load]);

  const membershipOf = (userId: string): AdminMembershipUserData | undefined =>
    memberships.find((entry) => entry.userId === userId);

  const changeStatus = async (account: AuthAccountData): Promise<void> => {
    setBusyUserId(account.userId);
    try {
      await updateAdminUserStatus(account.userId, account.status === 'active' ? 'suspended' : 'active');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '账号状态没有修改成功');
    } finally {
      setBusyUserId(null);
    }
  };

  const grant = async (userId: string): Promise<void> => {
    const plan = planChoice[userId] ?? 'monthly';
    setBusyUserId(userId);
    try {
      await grantAdminMembership(userId, plan);
      await load();
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '会员没有开通成功');
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
      setError(reason instanceof Error ? reason.message : '会员没有撤销成功');
    } finally {
      setBusyUserId(null);
    }
  };

  return <section className="admin-workspace">
    <header><div><span>管理后台</span><h2>用户与会员管理</h2></div><p>查看注册用户、算力值消耗并开通会员。密码永远不会在这里显示。</p></header>
    {overview !== null && <div className="admin-overview" aria-label="用户概况">
      <article><strong>{overview.totalUsers}</strong><span>全部用户</span></article>
      <article><strong>{overview.activeUsers}</strong><span>正常使用</span></article>
      <article><strong>{overview.suspendedUsers}</strong><span>已暂停</span></article>
      <article><strong>{overview.totalBooks}</strong><span>用户书籍</span></article>
      <article><strong>{formatComputePoints(memberships.reduce((sum, entry) => sum + entry.totalTokens, 0))}</strong><span>总算力值消耗</span></article>
    </div>}
    <div className="admin-filters">
      <label><span className="sr-only">搜索用户</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索昵称或邮箱" /></label>
      <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="按账号状态筛选"><option value="">全部状态</option><option value="active">正常使用</option><option value="suspended">已暂停</option></select>
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
              <span className="membership-quota">剩余 {formatComputePoints(Math.max(0, record.tokenQuota - record.periodTokens))} / {formatComputePoints(record.tokenQuota)} 算力值 · 至 {formatDate(record.periodEnd)}</span>
            )}
            {membership !== undefined && membership.totalTokens > 0 && (
              <span className="membership-total">累计消耗 {formatComputePoints(membership.totalTokens)}</span>
            )}</div>
          {account.role !== 'admin' && (
            <div className="admin-membership-actions">
              <select
                value={planChoice[account.userId] ?? 'monthly'}
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
    </div>
  </section>;
}
