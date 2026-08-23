import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen, Bug, CaretDown, ChartLineUp, Crown, CurrencyCircleDollar, House, Lightning,
  List, MagnifyingGlass, Robot, SignOut, TextT, Users, X
} from '@phosphor-icons/react';
import { fetchCurrentAccount, loginAccount, logoutAccount, type AuthAccountData } from '../../lib/api/client';
import { AdminPages } from './AdminPages';
import type { AdminSection } from './admin-api';
import './admin.css';

const NAVIGATION: Array<{ key: AdminSection; label: string; icon: typeof House }> = [
  { key: 'dashboard', label: '总览', icon: House },
  { key: 'users', label: '用户', icon: Users },
  { key: 'compute', label: '算力', icon: Lightning },
  { key: 'api', label: 'API消耗', icon: CurrencyCircleDollar },
  { key: 'models', label: '模型', icon: Robot },
  { key: 'issues', label: '问题记录', icon: Bug },
  { key: 'templates', label: '创作模板', icon: BookOpen },
  { key: 'prompts', label: '提示词', icon: TextT },
  { key: 'memberships', label: '会员', icon: Crown },
  { key: 'capabilities', label: '功能台账', icon: List }
];

const MOBILE_PRIMARY: AdminSection[] = ['dashboard', 'users', 'issues', 'models'];
const AUTHOR_SITE_URL = authorSiteUrl();

export function AdminApp(): React.JSX.Element {
  const [account, setAccount] = useState<AuthAccountData | null | undefined>(undefined);
  const [section, setSection] = useState<AdminSection>(() => sectionFromUrl());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchSeed, setSearchSeed] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchCurrentAccount(controller.signal).then(setAccount).catch(() => setAccount(null));
    return () => controller.abort();
  }, []);

  const current = useMemo(() => NAVIGATION.find((item) => item.key === section) ?? NAVIGATION[0]!, [section]);
  const navigate = (next: AdminSection): void => {
    setSection(next);
    setDrawerOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set('section', next);
    window.history.replaceState({}, '', url);
  };

  const signOut = async (): Promise<void> => {
    await logoutAccount().catch(() => undefined);
    setAccount(null);
  };

  if (account === undefined) return <div className="admin-boot"><span className="admin-spinner" />正在核验后台身份…</div>;
  if (account === null) return <AdminLogin onAuthenticated={setAccount} />;
  if (account.role !== 'admin') return <main className="admin-denied">
    <div className="admin-brand-mark">文</div>
    <h1>这个入口只用于平台管理</h1>
    <p>当前账号没有管理权限。作者创作请返回文秘写作首页。</p>
    <div><a href={AUTHOR_SITE_URL}>返回创作台</a><button type="button" onClick={() => void signOut()}>退出当前账号</button></div>
  </main>;

  return <div className="admin-app">
    <aside className={`admin-sidebar ${drawerOpen ? 'open' : ''}`} aria-label="管理后台导航">
      <header><span className="admin-brand-mark">文</span><strong>文秘管理</strong><button className="admin-mobile-close" type="button" aria-label="关闭导航" onClick={() => setDrawerOpen(false)}><X /></button></header>
      <nav>{NAVIGATION.map(({ key, label, icon: Icon }) => <button key={key} type="button" className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined} onClick={() => navigate(key)}><Icon /><span>{label}</span></button>)}</nav>
      <footer><span>{account.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{account.displayName}</strong><small>平台管理员</small></div><button type="button" title="退出" aria-label="退出管理后台" onClick={() => void signOut()}><SignOut /></button></footer>
    </aside>
    {drawerOpen && <button type="button" className="admin-scrim" aria-label="关闭导航" onClick={() => setDrawerOpen(false)} />}
    <div className="admin-stage">
      <header className="admin-topbar">
        <button className="admin-menu-button" type="button" aria-label="打开导航" onClick={() => setDrawerOpen(true)}><List /></button>
        <h1>{current.label}</h1>
        <form onSubmit={(event) => { event.preventDefault(); if (globalSearch.trim()) { setSearchSeed(globalSearch.trim()); navigate('users'); } }}>
          <MagnifyingGlass aria-hidden="true" />
          <input aria-label="搜索用户或问题" value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="搜索用户、问题…" />
        </form>
        <a href={AUTHOR_SITE_URL} className="admin-creator-link">创作台</a>
        <button className="admin-account-button" type="button" onClick={() => void signOut()}><span>{account.displayName.slice(0, 1).toUpperCase()}</span><b>{account.displayName}</b><CaretDown /></button>
      </header>
      {error !== null && <div className="admin-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="关闭提示"><X /></button></div>}
      <main className="admin-content"><AdminPages section={section} searchSeed={searchSeed} currentUser={account} onError={setError} /></main>
    </div>
    <nav className="admin-mobile-nav" aria-label="手机后台导航">
      {MOBILE_PRIMARY.map((key) => {
        const item = NAVIGATION.find((entry) => entry.key === key)!;
        const Icon = item.icon;
        return <button type="button" key={key} className={section === key ? 'active' : ''} onClick={() => navigate(key)}><Icon /><span>{item.label}</span></button>;
      })}
      <button type="button" className={!MOBILE_PRIMARY.includes(section) ? 'active' : ''} onClick={() => setDrawerOpen(true)}><ChartLineUp /><span>更多</span></button>
    </nav>
  </div>;
}

function AdminLogin({ onAuthenticated }: { onAuthenticated: (account: AuthAccountData) => void }): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await loginAccount({ email, password });
      if (result.account.role !== 'admin') {
        await logoutAccount().catch(() => undefined);
        setError('这个账号没有平台管理权限。');
        return;
      }
      onAuthenticated(result.account);
    } catch (reason) {
      setError(safeAdminMessage(reason, '登录没有成功'));
    } finally { setBusy(false); }
  };
  return <main className="admin-login">
    <section>
      <div className="admin-login-brand"><span className="admin-brand-mark">文</span><strong>文秘管理</strong></div>
      <h1>登录独立管理后台</h1>
      <p>运营数据、模型、问题、模板和提示词只在这里管理，不进入作者创作台。</p>
      <form onSubmit={(event) => void submit(event)}>
        <label>管理员邮箱<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error !== null && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? '正在登录…' : '进入管理后台'}</button>
      </form>
      <a href={AUTHOR_SITE_URL}>返回作者创作台</a>
    </section>
  </main>;
}

function authorSiteUrl(): string {
  const configured = import.meta.env.VITE_AUTHOR_ORIGIN?.trim();
  if (configured) return configured;
  const hostname = window.location.hostname.toLowerCase();
  if (!hostname.startsWith('admin.')) return '/';
  const authorHostname = hostname.slice('admin.'.length);
  const port = window.location.port ? `:${window.location.port}` : '';
  return `${window.location.protocol}//${authorHostname}${port}`;
}

function safeAdminMessage(reason: unknown, fallback: string): string {
  if (reason === null || typeof reason !== 'object') return fallback;
  const value = Reflect.get(reason, 'message');
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) return fallback;
  return /(?:\bSQL\b|sqlite|stack|\\private\\|node_modules|Bearer\s|\b(?:sk|ak)-[A-Za-z0-9_-]{8,})/iu.test(value)
    ? fallback : value;
}

function sectionFromUrl(): AdminSection {
  const value = new URL(window.location.href).searchParams.get('section');
  return NAVIGATION.some((item) => item.key === value) ? value as AdminSection : 'dashboard';
}
