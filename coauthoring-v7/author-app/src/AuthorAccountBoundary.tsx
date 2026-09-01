import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react';
import {
  AuthorAccountError,
  AUTHOR_AUTHENTICATION_REQUIRED_EVENT,
  authorAccountErrorMessage,
  fetchAuthorMembership,
  fetchCurrentAuthorAccount,
  loginAuthorAccount,
  logoutAuthorAccount,
  registerAuthorAccount,
  type AuthorAccount,
  type AuthorMembershipStatus
} from './account-api';
import { submitAuthorFeedback } from './opening-api';
import './account-shell.css';

const SUPPORT_WECHAT = '595341366';

type MembershipLoadState = 'loading' | 'ready' | 'error';

export interface AuthorAccountSession {
  account: AuthorAccount;
  membership: AuthorMembershipStatus | null;
  membershipState: MembershipLoadState;
  membershipError: string | null;
  signingOut: boolean;
  sessionNotice: string | null;
  refreshMembership: () => Promise<void>;
  signOut: () => Promise<void>;
  requireSignIn: () => void;
}

const AuthorAccountContext = createContext<AuthorAccountSession | null>(null);

export function useAuthorAccount(): AuthorAccountSession {
  const value = useContext(AuthorAccountContext);
  if (value === null) throw new Error('useAuthorAccount must be used inside AuthorAccountBoundary');
  return value;
}

export function AuthorAccountSessionProvider({
  session,
  children
}: {
  session: AuthorAccountSession;
  children: ReactNode;
}): React.JSX.Element {
  return <AuthorAccountContext.Provider value={session}>{children}</AuthorAccountContext.Provider>;
}

export function AuthorAccountBoundary({
  children,
  initialMode = 'login'
}: {
  children: ReactNode | ((session: AuthorAccountSession) => ReactNode);
  initialMode?: 'login' | 'register';
}): React.JSX.Element {
  const [phase, setPhase] = useState<'checking' | 'guest' | 'authenticated' | 'unavailable'>('checking');
  const [account, setAccount] = useState<AuthorAccount | null>(null);
  const [membership, setMembership] = useState<AuthorMembershipStatus | null>(null);
  const [membershipState, setMembershipState] = useState<MembershipLoadState>('loading');
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const activeUserIdRef = useRef<string | null>(null);
  const membershipRequestRef = useRef(0);

  const invalidateMembershipRequests = useCallback((): void => {
    activeUserIdRef.current = null;
    membershipRequestRef.current += 1;
  }, []);

  const requireSignIn = useCallback((): void => {
    invalidateMembershipRequests();
    setAccount(null);
    setMembership(null);
    setMembershipState('loading');
    setMembershipError(null);
    setSessionNotice(null);
    setPhase('guest');
  }, [invalidateMembershipRequests]);

  const refreshMembership = useCallback(async (userId: string, signal?: AbortSignal): Promise<void> => {
    if (activeUserIdRef.current !== userId) return;
    const requestVersion = membershipRequestRef.current + 1;
    membershipRequestRef.current = requestVersion;
    setMembershipState('loading');
    setMembershipError(null);
    try {
      const current = await fetchAuthorMembership(signal);
      if (signal?.aborted === true || membershipRequestRef.current !== requestVersion || activeUserIdRef.current !== userId) return;
      setMembership(current);
      setMembershipState('ready');
    } catch (reason) {
      if (signal?.aborted === true || (reason instanceof DOMException && reason.name === 'AbortError')) return;
      if (membershipRequestRef.current !== requestVersion || activeUserIdRef.current !== userId) return;
      if (reason instanceof AuthorAccountError && reason.kind === 'unauthenticated') {
        requireSignIn();
        return;
      }
      setMembership(null);
      setMembershipState('error');
      setMembershipError(authorAccountErrorMessage(reason, '会员信息暂时没有加载出来，请稍后重试。'));
    }
  }, [requireSignIn]);

  const inspectSession = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setPhase('checking');
    setStartupError(null);
    try {
      const current = await fetchCurrentAuthorAccount(signal);
      if (signal?.aborted === true) return;
      if (current === null) {
        requireSignIn();
        return;
      }
      activeUserIdRef.current = current.userId;
      setAccount(current);
      setPhase('authenticated');
      await refreshMembership(current.userId, signal);
    } catch (reason) {
      if (signal?.aborted === true || (reason instanceof DOMException && reason.name === 'AbortError')) return;
      invalidateMembershipRequests();
      setAccount(null);
      setMembership(null);
      setMembershipState('loading');
      setStartupError(authorAccountErrorMessage(reason, '暂时无法打开您的创作空间，请稍后重试。'));
      setPhase('unavailable');
    }
  }, [invalidateMembershipRequests, refreshMembership, requireSignIn]);

  useEffect(() => {
    const controller = new AbortController();
    void inspectSession(controller.signal);
    return () => controller.abort();
  }, [inspectSession]);

  useEffect(() => {
    window.addEventListener(AUTHOR_AUTHENTICATION_REQUIRED_EVENT, requireSignIn);
    return () => window.removeEventListener(AUTHOR_AUTHENTICATION_REQUIRED_EVENT, requireSignIn);
  }, [requireSignIn]);

  const authenticated = useCallback((current: AuthorAccount): void => {
    activeUserIdRef.current = current.userId;
    setAccount(current);
    setPhase('authenticated');
    setSessionNotice(null);
    void refreshMembership(current.userId);
  }, [refreshMembership]);

  const signOut = useCallback(async (): Promise<void> => {
    if (signingOut) return;
    setSigningOut(true);
    setSessionNotice(null);
    try {
      await logoutAuthorAccount();
      requireSignIn();
    } catch (reason) {
      if (reason instanceof AuthorAccountError && reason.kind === 'unauthenticated') requireSignIn();
      else setSessionNotice(authorAccountErrorMessage(reason, '这次没有退出成功，请稍后重试。'));
    } finally {
      setSigningOut(false);
    }
  }, [requireSignIn, signingOut]);

  const retryStartup = useCallback((): void => {
    void inspectSession();
  }, [inspectSession]);

  if (phase === 'checking') return <AuthorSessionLoading />;
  if (phase === 'unavailable') {
    return <AuthorSessionUnavailable message={startupError ?? '暂时无法打开您的创作空间，请稍后重试。'} onRetry={retryStartup} />;
  }
  if (phase === 'guest' || account === null) {
    return <AuthorAuthenticationPage initialMode={initialMode} onAuthenticated={authenticated} />;
  }

  const session: AuthorAccountSession = {
    account,
    membership,
    membershipState,
    membershipError,
    signingOut,
    sessionNotice,
    refreshMembership: async () => refreshMembership(account.userId),
    signOut,
    requireSignIn
  };

  return <AuthorAccountSessionProvider session={session}>
    {typeof children === 'function' ? children(session) : children}
  </AuthorAccountSessionProvider>;
}

function AuthorSessionLoading(): React.JSX.Element {
  return <main className="v7-account-shell" aria-busy="true">
    <section className="v7-account-card v7-account-status-card" aria-live="polite">
      <BrandMark />
      <h1>文秘写作</h1>
      <p>正在打开您的创作空间…</p>
    </section>
  </main>;
}

function AuthorSessionUnavailable({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  return <main className="v7-account-shell">
    <section className="v7-account-card v7-account-status-card">
      <BrandMark />
      <h1>暂时没有打开</h1>
      <p role="alert">{message}</p>
      <button className="v7-account-primary" type="button" onClick={onRetry}>重新连接</button>
    </section>
  </main>;
}

export function AuthorAuthenticationPage({
  initialMode = 'login',
  onAuthenticated
}: {
  initialMode?: 'login' | 'register';
  onAuthenticated: (account: AuthorAccount) => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeMode = (next: 'login' | 'register'): void => {
    setMode(next);
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (mode === 'register' && password.length < 10) {
      setError('密码至少需要10个字符。');
      return;
    }
    if (mode === 'register' && displayName.trim().length === 0) {
      setError('请填写您的昵称。');
      return;
    }
    if (mode === 'register' && password !== confirmPassword) {
      setError('两次输入的密码不一致。');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = mode === 'login'
        ? await loginAuthorAccount({ email: email.trim(), password })
        : await registerAuthorAccount({ email: email.trim(), password, displayName: displayName.trim() });
      onAuthenticated(result.account);
    } catch (reason) {
      setError(authorAccountErrorMessage(reason, mode === 'login'
        ? '这次没有登录成功，请稍后重试。'
        : '这次没有创建成功，请稍后重试。'));
    } finally {
      setBusy(false);
    }
  };

  return <main className="v7-account-shell">
    <section className="v7-account-card v7-account-auth-card" aria-labelledby="v7-account-title">
      <BrandMark />
      <p className="v7-account-eyebrow">文秘写作 V7</p>
      <h1 id="v7-account-title">{mode === 'login' ? '欢迎回来' : '创建作者账号'}</h1>
      <p className="v7-account-intro">{mode === 'login' ? '登录后继续您的创作。' : '注册后即可开始创作。'}</p>

      <div className="v7-account-mode" role="tablist" aria-label="登录或注册">
        <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => changeMode('login')}>登录</button>
        <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => changeMode('register')}>注册</button>
      </div>

      <form onSubmit={(event) => void submit(event)}>
        {mode === 'register' && <label>
          <span>昵称</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={30}
            autoComplete="name"
            placeholder="您的作者昵称"
            required
          />
        </label>}
        <label>
          <span>邮箱</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            autoComplete="email"
            inputMode="email"
            placeholder="name@example.com"
            required
          />
        </label>
        <label>
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={mode === 'register' ? 10 : undefined}
            maxLength={128}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder={mode === 'login' ? '请输入密码' : '至少10个字符'}
            required
          />
        </label>
        {mode === 'register' && <label>
          <span>再次输入密码</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            placeholder="再输入一次密码"
            required
          />
        </label>}
        {error !== null && <p className="v7-account-error" role="alert">{error}</p>}
        <button className="v7-account-primary" type="submit" disabled={busy}>
          {busy ? '正在处理…' : mode === 'login' ? '登录文秘写作' : '创建账号并登录'}
        </button>
      </form>
    </section>
  </main>;
}

export function AuthorAccountCenter({
  onClose,
  closeLabel = '收起'
}: {
  onClose?: () => void;
  closeLabel?: string;
}): React.JSX.Element {
  const session = useAuthorAccount();
  const [feedbackCategory, setFeedbackCategory] = useState<'bug' | 'experience' | 'suggestion' | 'other'>('experience');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [supportCopied, setSupportCopied] = useState(false);
  const record = session.membership?.membership ?? null;
  const isAdmin = session.account.role === 'admin' || session.membership?.isAdmin === true;
  const usedRatio = record === null || record.computeQuota <= 0
    ? 0
    : Math.min(100, Math.round((record.computeConsumed / record.computeQuota) * 100));
  const submitFeedback = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const message = feedbackMessage.trim();
    if (feedbackBusy || message.length < 2) return;
    setFeedbackBusy(true);
    setFeedbackNotice(null);
    try {
      const bookId = new URLSearchParams(window.location.search).get('bookId');
      await submitAuthorFeedback({
        category: feedbackCategory,
        message,
        pagePath: `${window.location.pathname}${window.location.search}`,
        ...(bookId === null ? {} : { bookId })
      });
      setFeedbackMessage('');
      setFeedbackNotice('已经收到，谢谢您告诉我们。');
    } catch (reason) {
      setFeedbackNotice(reason instanceof Error ? reason.message : '抱歉，这次没有提交成功，请稍后重试。');
    } finally {
      setFeedbackBusy(false);
    }
  };
  const copySupport = (): void => {
    void navigator.clipboard?.writeText(SUPPORT_WECHAT).then(() => {
      setSupportCopied(true);
      window.setTimeout(() => setSupportCopied(false), 1_500);
    }).catch(() => setSupportCopied(false));
  };

  return <section className="v7-account-center" aria-label="个人中心">
    <header className="v7-account-center-head">
      <span className="v7-account-avatar" aria-hidden="true">{firstCharacter(session.account.displayName)}</span>
      <div>
        <h2>{session.account.displayName}</h2>
        <p>{session.account.email}</p>
      </div>
      {onClose !== undefined && <button className="v7-account-quiet" type="button" onClick={onClose}>{closeLabel}</button>}
    </header>

    <dl className="v7-account-facts">
      <div><dt>身份</dt><dd>{session.account.role === 'admin' ? '管理员' : '作者'}</dd></div>
      <div><dt>账号状态</dt><dd>{session.account.status === 'active' ? '正常使用' : '已暂停'}</dd></div>
    </dl>

    <section className="v7-account-membership" aria-label="会员与算力">
      {session.membershipState === 'loading' && <p className="v7-account-muted" aria-live="polite">正在读取会员信息…</p>}
      {session.membershipState === 'error' && <div className="v7-account-membership-error">
        <p role="alert">{session.membershipError}</p>
        <button className="v7-account-secondary" type="button" onClick={() => void session.refreshMembership()}>重新读取</button>
      </div>}
      {session.membershipState === 'ready' && isAdmin && <>
        <div className="v7-account-tier"><strong>管理员账号</strong><span>算力值不限</span></div>
      </>}
      {session.membershipState === 'ready' && !isAdmin && record === null && <>
        <div className="v7-account-tier"><strong>尚未开通会员</strong><span>开通后可使用智能创作能力</span></div>
      </>}
      {session.membershipState === 'ready' && !isAdmin && record !== null && <>
        <div className="v7-account-tier">
          <strong>{record.planLabel}</strong>
          <span>{membershipStateText(record)}</span>
        </div>
        <dl className="v7-account-compute">
          <div><dt>已用算力</dt><dd>{formatCompute(record.computeConsumed)}</dd></div>
          <div><dt>剩余算力</dt><dd>{formatCompute(record.computeRemaining)}</dd></div>
          <div><dt>本期额度</dt><dd>{formatCompute(record.computeQuota)}</dd></div>
        </dl>
        <div className="v7-account-progress" role="img" aria-label={`本期算力已使用${usedRatio}%`}>
          <span style={{ width: `${usedRatio}%` }} />
        </div>
        <p className="v7-account-expiry">到期时间：{formatDate(record.periodEnd)}</p>
      </>}
    </section>

    <section className="v7-account-support" aria-label="会员开通">
      <div><strong>开通或续费会员</strong><span>添加管理员微信，说明您的登录邮箱即可办理。</span></div>
      <button className="v7-account-secondary" type="button" onClick={copySupport}>{supportCopied ? '已经复制' : `复制微信 ${SUPPORT_WECHAT}`}</button>
    </section>

    <details className="v7-account-feedback">
      <summary>意见与问题反馈</summary>
      <form onSubmit={(event) => void submitFeedback(event)}>
        <label><span>反馈类型</span><select value={feedbackCategory} onChange={(event) => setFeedbackCategory(event.target.value as typeof feedbackCategory)}><option value="bug">功能异常</option><option value="experience">不好使用</option><option value="suggestion">功能建议</option><option value="other">其他</option></select></label>
        <label><span>请告诉我们具体情况</span><textarea maxLength={2_000} value={feedbackMessage} onChange={(event) => setFeedbackMessage(event.target.value)} placeholder="例如：在哪个页面、点了什么、希望怎样改。" /></label>
        {feedbackNotice !== null && <p className="v7-account-feedback-notice" role="status">{feedbackNotice}</p>}
        <button className="v7-account-primary" type="submit" disabled={feedbackBusy || feedbackMessage.trim().length < 2}>{feedbackBusy ? '正在提交…' : '提交反馈'}</button>
      </form>
    </details>

    {session.sessionNotice !== null && <p className="v7-account-error" role="alert">{session.sessionNotice}</p>}
    <footer className="v7-account-center-actions">
      <button className="v7-account-secondary" type="button" disabled={session.signingOut} onClick={() => void session.signOut()}>
        {session.signingOut ? '正在退出…' : '退出登录'}
      </button>
    </footer>
  </section>;
}

function BrandMark(): React.JSX.Element {
  return <span className="v7-account-brand" aria-hidden="true">文</span>;
}

function firstCharacter(value: string): string {
  return Array.from(value.trim())[0]?.toUpperCase() ?? '文';
}

function formatCompute(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (safeValue >= 100_000_000) return `${trimDecimal(safeValue / 100_000_000)}亿`;
  if (safeValue >= 10_000) return `${trimDecimal(safeValue / 10_000)}万`;
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(safeValue);
}

function trimDecimal(value: number): string {
  return value.toFixed(value >= 100 ? 0 : 1).replace(/\.0$/u, '');
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '待确认';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(date);
}

function membershipStateText(record: NonNullable<AuthorMembershipStatus['membership']>): string {
  if (record.status === 'revoked') return '已停止使用';
  if (record.expired) return '已到期';
  if (record.computeRemaining <= 0) return '本期算力已用完';
  return '使用中';
}
