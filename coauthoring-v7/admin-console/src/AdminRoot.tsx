import { useEffect, useState } from 'react';
import { ArrowLeft, ShieldCheck } from '@phosphor-icons/react';
import { AssetAdminApp } from './AssetAdminApp';
import {
  ADMIN_AUTHENTICATION_REQUIRED_EVENT,
  AUTHOR_SITE_ORIGIN,
  fetchCurrentAccount,
  loginAccount,
  logoutAccount,
  type AdminAccount
} from './platform-api';

export function AdminRoot(): React.JSX.Element {
  const [account, setAccount] = useState<AdminAccount | null | undefined>(undefined);
  const [bootError, setBootError] = useState<string | null>(null);

  const verify = (): void => {
    setAccount(undefined);
    setBootError(null);
    void fetchCurrentAccount()
      .then(setAccount)
      .catch((reason: unknown) => {
        setBootError(safeUiMessage(reason, '暂时无法核验管理员身份'));
        setAccount(null);
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    void fetchCurrentAccount(controller.signal)
      .then(setAccount)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setBootError(safeUiMessage(reason, '暂时无法核验管理员身份'));
        setAccount(null);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const requireAuthentication = (): void => {
      setBootError(null);
      setAccount(null);
    };
    window.addEventListener(ADMIN_AUTHENTICATION_REQUIRED_EVENT, requireAuthentication);
    return () => window.removeEventListener(ADMIN_AUTHENTICATION_REQUIRED_EVENT, requireAuthentication);
  }, []);

  const signOut = async (): Promise<void> => {
    await logoutAccount().catch(() => undefined);
    setAccount(null);
  };

  if (account === undefined) return <main className="asset-auth-state" role="status" aria-live="polite">
    <span className="asset-spinner" />
    <strong>正在核验 V7 后台身份</strong>
    <p>生产数据只向平台管理员开放。</p>
  </main>;

  if (account === null) return <AdminLogin
    initialError={bootError}
    onAuthenticated={setAccount}
    onRetry={verify}
  />;

  if (account.role !== 'admin') return <main className="asset-auth-state asset-denied">
    <ShieldCheck aria-hidden="true" />
    <h1>当前账号没有管理权限</h1>
    <p>V7 后台包含平台运营数据和内部创作资产，只允许管理员查看。</p>
    <div><a href={AUTHOR_SITE_ORIGIN}><ArrowLeft aria-hidden="true" />返回作者创作台</a><button type="button" onClick={() => void signOut()}>退出当前账号</button></div>
  </main>;

  return <AssetAdminApp account={account} onSignOut={signOut} />;
}

function AdminLogin({ initialError, onAuthenticated, onRetry }: {
  initialError: string | null;
  onAuthenticated: (account: AdminAccount) => void;
  onRetry: () => void;
}): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await loginAccount({ email, password });
      if (result.account.role !== 'admin') {
        await logoutAccount().catch(() => undefined);
        setError('这个账号没有平台管理权限。');
        return;
      }
      onAuthenticated(result.account);
    } catch (reason) {
      setError(safeUiMessage(reason, '登录没有成功'));
    } finally {
      setBusy(false);
    }
  };

  return <main className="asset-login">
    <section>
      <div className="asset-login-brand"><span className="asset-brand-mark">文</span><div><strong>文秘写作 V7</strong><small>独立管理后台</small></div></div>
      <span className="asset-login-kicker">ADMIN CONSOLE</span>
      <h1>登录管理后台</h1>
      <p>创作资产、运营数据和问题记录与作者创作台分开管理。</p>
      <form onSubmit={(event) => void submit(event)}>
        <label>管理员邮箱<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        {error !== null && <div className="asset-login-error" role="alert"><span>{error}</span>{initialError !== null && <button type="button" onClick={onRetry}>重新核验</button>}</div>}
        <button className="asset-login-submit" type="submit" disabled={busy}>{busy ? '正在登录…' : '进入 V7 管理后台'}</button>
      </form>
      <a href={AUTHOR_SITE_ORIGIN}><ArrowLeft aria-hidden="true" />返回作者创作台</a>
    </section>
    <aside aria-hidden="true"><span>V7</span><strong>创作资产与平台运营<br />在独立后台统一管理。</strong><p>账号、会员和问题处理与作者创作台清楚分开。</p></aside>
  </main>;
}

function safeUiMessage(reason: unknown, fallback: string): string {
  if (reason === null || typeof reason !== 'object') return fallback;
  const message = Reflect.get(reason, 'message');
  if (typeof message !== 'string' || message.length === 0 || message.length > 300) return fallback;
  return /(?:\bSQL\b|sqlite|stack|\\private\\|node_modules|Bearer\s|\b(?:sk|ak)-[A-Za-z0-9_-]{8,})/iu.test(message)
    ? fallback
    : message;
}
