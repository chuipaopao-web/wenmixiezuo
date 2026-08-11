import { useCallback, useEffect, useState } from 'react';
import { fetchAdminOverview, fetchAdminUsers, updateAdminUserStatus, type AdminOverviewData, type AuthAccountData } from '../../lib/api/client';

export function AdminWorkspace({ currentUser }: { currentUser: AuthAccountData }): React.JSX.Element {
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [users, setUsers] = useState<AuthAccountData[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const [nextOverview, nextUsers] = await Promise.all([fetchAdminOverview(signal), fetchAdminUsers({ query, status }, signal)]);
    setOverview(nextOverview); setUsers(nextUsers); setError(null);
  }, [query, status]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '用户列表暂时无法打开');
    });
    return () => controller.abort();
  }, [load]);

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

  return <section className="admin-workspace">
    <header><div><span>管理后台</span><h2>用户管理</h2></div><p>查看注册用户并暂停或恢复账号。密码永远不会在这里显示。</p></header>
    {overview !== null && <div className="admin-overview" aria-label="用户概况">
      <article><strong>{overview.totalUsers}</strong><span>全部用户</span></article>
      <article><strong>{overview.activeUsers}</strong><span>正常使用</span></article>
      <article><strong>{overview.suspendedUsers}</strong><span>已暂停</span></article>
      <article><strong>{overview.totalBooks}</strong><span>用户书籍</span></article>
    </div>}
    <div className="admin-filters">
      <label><span className="sr-only">搜索用户</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索昵称或邮箱" /></label>
      <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="按账号状态筛选"><option value="">全部状态</option><option value="active">正常使用</option><option value="suspended">已暂停</option></select>
    </div>
    {error !== null && <p className="auth-error" role="alert">{error}</p>}
    <div className="admin-user-list">
      {users.map((account) => <article key={account.userId}>
        <div className="admin-avatar" aria-hidden="true">{account.displayName.slice(0, 1).toUpperCase()}</div>
        <div className="admin-user-main"><strong>{account.displayName}</strong><span>{account.email}</span></div>
        <span className={`account-status ${account.status}`}>{account.status === 'active' ? '正常使用' : '已暂停'}</span>
        <span className="account-role">{account.role === 'admin' ? '管理员' : '用户'}</span>
        <button type="button" disabled={busyUserId === account.userId || account.userId === currentUser.userId} onClick={() => void changeStatus(account)}>
          {account.userId === currentUser.userId ? '当前账号' : account.status === 'active' ? '暂停账号' : '恢复账号'}
        </button>
      </article>)}
      {users.length === 0 && <p className="admin-empty">没有找到符合条件的用户。</p>}
    </div>
  </section>;
}
