// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicAuthorEntry } from './PublicAuthorEntry';
import type { AuthorAccount } from './account-api';

vi.mock('./InformationPage', () => ({
  InformationPage: ({ bookId }: { bookId: string }) => <section aria-label="书籍信息"><h2>书籍信息 {bookId}</h2></section>
}));

const ACCOUNT: AuthorAccount = {
  userId: 'author-public-1',
  email: 'writer@example.com',
  displayName: '林老师',
  role: 'user',
  status: 'active'
};

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(status >= 200 && status < 300 ? { data } : data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function installFetch(account: AuthorAccount | null, overrides?: (url: string) => Response | Promise<Response> | null): ReturnType<typeof vi.fn> {
  let currentAccount = account;
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const override = overrides?.(url);
    if (override !== null && override !== undefined) return override;
    if (url.endsWith('/api/v1/auth/me')) {
      return currentAccount === null ? response({ error: { message: '请先登录' } }, 401) : response(currentAccount);
    }
    if (url.endsWith('/api/v1/auth/login')) {
      currentAccount = ACCOUNT;
      return response({ account: ACCOUNT, expiresInSeconds: 3600 });
    }
    if (url.endsWith('/api/v1/auth/register')) {
      currentAccount = ACCOUNT;
      return response({ account: ACCOUNT, expiresInSeconds: 3600 });
    }
    if (url.endsWith('/api/v1/auth/logout')) {
      currentAccount = null;
      return response({ loggedOut: true });
    }
    if (url.endsWith('/api/v1/membership/me')) return response({ isAdmin: false, membership: null });
    if (url.endsWith('/api/v1/v7/books')) return response([]);
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('public author homepage entry', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the public product homepage to anonymous visitors without blocking on auth', async () => {
    installFetch(null);
    render(<PublicAuthorEntry />);

    expect(await screen.findByRole('heading', { name: '从一个想法，开始你的小说。' })).toBeVisible();
    expect(screen.getByText('AI 帮你展开故事，每一步都由你决定。')).toBeVisible();
    expect(screen.getByRole('navigation', { name: '公开入口' })).toHaveTextContent('登录');
    expect(screen.getByRole('navigation', { name: '公开入口' })).toHaveTextContent('注册');
    expect(screen.getByRole('button', { name: /开始创作/ })).toBeEnabled();
    expect(screen.getByLabelText('创作流程示意')).toBeVisible();
    expect(document.body.textContent).toContain('短剧创作：规划中。');
    expect(document.body.textContent).not.toMatch(/实时必达|永久准确|成功率|用户数|剧本工作流已开放|后续公共页面批次|不把.*冒充|结算历史/u);
    expect(screen.queryByRole('link', { name: '用户协议' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '隐私说明' })).not.toBeInTheDocument();
  });

  it('keeps the homepage visible when the auth probe has a network error', async () => {
    installFetch(null, (url) => url.endsWith('/api/v1/auth/me') ? Promise.reject(new Error('network')) : null);
    render(<PublicAuthorEntry />);

    expect(await screen.findByRole('heading', { name: '从一个想法，开始你的小说。' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '暂时没有打开' })).not.toBeInTheDocument();
  });

  it('uses explicit login and register paths that can refresh', async () => {
    installFetch(null);
    render(<PublicAuthorEntry />);

    fireEvent.click(await screen.findByRole('button', { name: '登录' }));
    expect(window.location.pathname).toBe('/login');
    expect(await screen.findByRole('heading', { name: '欢迎回来' })).toBeVisible();

    window.history.pushState({}, '', '/register');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', { name: '创建作者账号' })).toBeVisible();
  });

  it('starts anonymous visitors through registration and returns to the new-novel flow after auth', async () => {
    const fetchMock = installFetch(null);
    render(<PublicAuthorEntry />);

    fireEvent.click(await screen.findByRole('button', { name: /开始创作/ }));
    expect(window.location.pathname).toBe('/register');
    expect(window.location.search).toContain('return=');
    fireEvent.change(await screen.findByLabelText('昵称'), { target: { value: '林老师' } });
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'writer@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'strong-pass-123' } });
    fireEvent.change(screen.getByLabelText('再次输入密码'), { target: { value: 'strong-pass-123' } });
    fireEvent.click(screen.getByRole('button', { name: '创建账号并登录' }));

    expect(await screen.findByLabelText('说说您想写什么')).toBeVisible();
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?view=new-novel&entry=ai');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/v1/auth/register'))).toBe(true);
  });

  it('preserves an old protected deep link for anonymous visitors and restores it after login', async () => {
    installFetch(null, (url) => url.endsWith('/api/v1/v7/books')
      ? response([{ bookId: 'book-deep', title: '深链书籍', status: 'active', updatedAt: '2026-09-06T00:00:00Z' }])
      : null);
    window.history.replaceState({}, '', '/?view=information&bookId=book-deep');
    render(<PublicAuthorEntry />);

    expect(await screen.findByRole('heading', { name: '欢迎回来' })).toBeVisible();
    expect(window.location.search).toBe('?view=information&bookId=book-deep');
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'writer@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'strong-pass-123' } });
    fireEvent.click(screen.getByRole('button', { name: '登录文秘写作' }));

    expect(await screen.findByRole('heading', { name: '书籍信息 book-deep' })).toBeVisible();
    expect(window.location.search).toBe('?view=information&bookId=book-deep');
  });

  it('shows an authenticated workspace entry on the public homepage', async () => {
    installFetch(ACCOUNT);
    render(<PublicAuthorEntry />);

    expect(await screen.findByText('林老师')).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: '进入工作台' })[0]!);
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?view=home');
    expect(await screen.findByText('创作小说')).toBeVisible();
  });

  it('remounts the auth form when browser history moves between login and register', async () => {
    installFetch(null);
    window.history.replaceState({}, '', '/login');
    render(<PublicAuthorEntry />);

    expect(await screen.findByRole('heading', { name: '欢迎回来' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '注册' }));
    expect(window.location.pathname).toBe('/register');
    expect(await screen.findByRole('heading', { name: '创建作者账号' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '登录' }));
    expect(window.location.pathname).toBe('/login');
    expect(await screen.findByRole('heading', { name: '欢迎回来' })).toBeVisible();
    window.history.pushState({}, '', '/register');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', { name: '创建作者账号' })).toBeVisible();
    window.history.pushState({}, '', '/login');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', { name: '欢迎回来' })).toBeVisible();
  });

  it('rejects unsafe auth return paths and opens the workspace root after login', async () => {
    installFetch(null);
    window.history.replaceState({}, '', '/login?return=%2Fregister');
    render(<PublicAuthorEntry />);

    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: 'writer@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'strong-pass-123' } });
    fireEvent.click(screen.getByRole('button', { name: '登录文秘写作' }));

    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(window.location.search).toBe('?view=home');
    expect(await screen.findByText('创作小说')).toBeVisible();
  });

  it('returns to the login form after registering, entering the workspace, and signing out', async () => {
    installFetch(null);
    const rendered = render(<PublicAuthorEntry />);

    fireEvent.click(await screen.findByRole('button', { name: /开始创作/ }));
    fireEvent.change(await screen.findByLabelText('昵称'), { target: { value: '林老师' } });
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'writer@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'strong-pass-123' } });
    fireEvent.change(screen.getByLabelText('再次输入密码'), { target: { value: 'strong-pass-123' } });
    fireEvent.click(screen.getByRole('button', { name: '创建账号并登录' }));
    expect(await screen.findByLabelText('说说您想写什么')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /林老师.*个人中心.*作者/ }));
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }));

    expect(await screen.findByRole('heading', { name: '欢迎回来' })).toBeVisible();
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?view=account');
    expect(screen.queryByRole('heading', { name: '创建作者账号' })).not.toBeInTheDocument();

    rendered.unmount();
    const renderedAfterRefresh = render(<PublicAuthorEntry />);
    expect(await renderedAfterRefresh.findByRole('heading', { name: '欢迎回来' })).toBeVisible();
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?view=account');
  });
});
