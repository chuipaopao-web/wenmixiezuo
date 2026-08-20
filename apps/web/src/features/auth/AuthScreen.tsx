import { useState } from 'react';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import { loginAccount, registerAccount, type AuthAccountData } from '../../lib/api/client';

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (account: AuthAccountData) => void }): React.JSX.Element {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (mode === 'register' && password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = mode === 'register'
        ? await registerAccount({ email, password, displayName })
        : await loginAccount({ email, password });
      onAuthenticated(result.account);
    } catch (reason) {
      setError(authorErrorFromUnknown(reason, '这次没有登录成功，请稍后再试'));
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-shell">
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-brand" aria-hidden="true">文</div>
      <p className="auth-eyebrow">文秘写作</p>
      <h1 id="auth-title">{mode === 'login' ? '欢迎回来' : '创建作者账号'}</h1>
      <p className="auth-intro">{mode === 'login' ? '登录后继续管理自己的书籍与创作进度。' : '第一位注册的用户会自动成为管理员。'}</p>
      <div className="auth-mode" role="tablist" aria-label="选择登录或注册">
        <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(null); }}>登录</button>
        <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(null); }}>注册</button>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        {mode === 'register' && <label><span>昵称</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={30} autoComplete="name" placeholder="作者昵称" required /></label>}
        <label><span>邮箱</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} autoComplete="email" placeholder="name@example.com" required /></label>
        <label><span>密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="至少10个字符" required /></label>
        {mode === 'register' && <label><span>再次输入密码</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={10} maxLength={128} autoComplete="new-password" placeholder="再输入一次密码" required /></label>}
        {error !== null && <p className="auth-error" role="alert">{error}</p>}
        <button className="auth-submit" type="submit" disabled={busy}>{busy ? '正在处理…' : mode === 'login' ? '登录文秘写作' : '创建账号并登录'}</button>
      </form>
      <p className="auth-footnote">当前先使用邮箱和密码，手机与微信登录可在公网部署后接入。</p>
    </section>
  </main>;
}
