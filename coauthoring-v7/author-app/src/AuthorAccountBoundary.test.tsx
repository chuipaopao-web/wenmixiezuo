// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthorAccountBoundary,
  AuthorAccountCenter,
  useAuthorAccount
} from './AuthorAccountBoundary';
import { AUTHOR_AUTHENTICATION_REQUIRED_EVENT, type AuthorAccount, type AuthorMembershipStatus } from './account-api';

const ACCOUNT: AuthorAccount = {
  userId: 'user-v7-1',
  email: 'writer@example.com',
  displayName: '林老师',
  role: 'user',
  status: 'active'
};

const MEMBERSHIP: AuthorMembershipStatus = {
  isAdmin: false,
  membership: {
    plan: 'gold',
    planLabel: '黄金会员',
    planPrice: '¥199/月',
    status: 'active',
    computeQuota: 2_000_000,
    computeConsumed: 360_000,
    computeRemaining: 1_640_000,
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-09-01T00:00:00.000Z',
    expired: false
  }
};

beforeEach(() => {
  window.history.replaceState({}, '', '/?view=information&bookId=v7-book-1');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(status >= 200 && status < 300 ? { data } : data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function AccountWorkspace(): React.JSX.Element {
  const session = useAuthorAccount();
  return <section>
    <p>创作首页：{session.account.displayName}</p>
    <AuthorAccountCenter />
  </section>;
}

describe('V7 作者端账号门禁与个人中心', () => {
  it('401 原位显示 V7 登录页，不跳转旧页面', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: { message: '请先登录' } }, 401)));

    render(<AuthorAccountBoundary><p>不应提前进入创作</p></AuthorAccountBoundary>);

    expect(await screen.findByRole('heading', { name: '欢迎回来' })).toBeVisible();
    expect(screen.getByRole('button', { name: '登录文秘写作' })).toBeEnabled();
    expect(screen.queryByText('不应提前进入创作')).not.toBeInTheDocument();
    expect(window.location.search).toBe('?view=information&bookId=v7-book-1');
    expect(document.body.textContent).not.toContain('43110');
  });

  it('已有会话直接进入创作，并显示真实账号、会员、到期和算力', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/api/v1/auth/me')) return response(ACCOUNT);
      if (path.endsWith('/api/v1/membership/me')) return response(MEMBERSHIP);
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthorAccountBoundary>{() => <AccountWorkspace />}</AuthorAccountBoundary>);

    expect(await screen.findByText('创作首页：林老师')).toBeVisible();
    expect(screen.getByText(ACCOUNT.email)).toBeVisible();
    expect(screen.getByText('黄金会员')).toBeVisible();
    expect(screen.getByText('36万')).toBeVisible();
    expect(screen.getByText('164万')).toBeVisible();
    expect(screen.getByText('200万')).toBeVisible();
    expect(screen.getByText(/2026年9月1日/)).toBeVisible();
    expect(screen.getByRole('img', { name: '本期算力已使用18%' })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/Token|模型|接口|Cookie|owner_id/iu);
  });

  it('在个人中心原页提交意见，并把当前书籍和页面一并交给后台', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/api/v1/auth/me')) return response(ACCOUNT);
      if (path.endsWith('/api/v1/membership/me')) return response(MEMBERSHIP);
      if (path.endsWith('/api/v1/feedback')) return response({ feedbackId: 'feedback-1', received: true });
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthorAccountBoundary><AccountWorkspace /></AuthorAccountBoundary>);
    await screen.findByText('创作首页：林老师');
    fireEvent.click(screen.getByText('意见与问题反馈'));
    fireEvent.change(screen.getByLabelText('反馈类型'), { target: { value: 'bug' } });
    fireEvent.change(screen.getByLabelText('请告诉我们具体情况'), { target: { value: '链页面的恢复按钮没有反应。' } });
    fireEvent.click(screen.getByRole('button', { name: '提交反馈' }));

    expect(await screen.findByText('已经收到，谢谢您告诉我们。')).toBeVisible();
    const feedbackCall = fetchMock.mock.calls.find(([path]) => String(path).endsWith('/api/v1/feedback'));
    expect(JSON.parse(String(feedbackCall?.[1]?.body))).toEqual({
      category: 'bug',
      message: '链页面的恢复按钮没有反应。',
      pagePath: '/?view=information&bookId=v7-book-1',
      bookId: 'v7-book-1'
    });
  });

  it('在 V7 内登录后继续原页面，账号 Cookie 只由后端响应处理', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/v1/auth/me')) return response({ error: { message: '请先登录' } }, 401);
      if (path.endsWith('/api/v1/auth/login')) return response({ account: ACCOUNT, expiresInSeconds: 3600 });
      if (path.endsWith('/api/v1/membership/me')) return response(MEMBERSHIP);
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthorAccountBoundary><AccountWorkspace /></AuthorAccountBoundary>);
    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: ACCOUNT.email } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'strong-pass-123' } });
    fireEvent.click(screen.getByRole('button', { name: '登录文秘写作' }));

    expect(await screen.findByText('创作首页：林老师')).toBeVisible();
    const loginCall = (fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>)
      .find(([path]) => String(path).endsWith('/api/v1/auth/login'));
    expect(loginCall?.[1]).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(document.cookie).toBe('');
    expect(window.location.search).toBe('?view=information&bookId=v7-book-1');
  });

  it('旧账号短密码可以交给后端登录，注册仍要求至少10个字符', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/v1/auth/me')) return response({ error: { message: '请先登录' } }, 401);
      if (path.endsWith('/api/v1/auth/login')) return response({ error: { message: '邮箱或密码不正确' } }, 401);
      if (path.endsWith('/api/v1/auth/register')) throw new Error('短密码注册不应发出请求');
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthorAccountBoundary><AccountWorkspace /></AuthorAccountBoundary>);
    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: ACCOUNT.email } });
    const loginPassword = screen.getByLabelText('密码');
    expect(loginPassword).not.toHaveAttribute('minlength');
    fireEvent.change(loginPassword, { target: { value: 'legacy' } });
    fireEvent.click(screen.getByRole('button', { name: '登录文秘写作' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/api/v1/auth/login'))).toBe(true));
    fireEvent.click(screen.getByRole('tab', { name: '注册' }));
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: ACCOUNT.displayName } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'legacy' } });
    fireEvent.change(screen.getByLabelText('再次输入密码'), { target: { value: 'legacy' } });
    expect(screen.getByLabelText('密码')).toHaveAttribute('minlength', '10');
    fireEvent.submit(screen.getByRole('button', { name: '创建账号并登录' }).closest('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('密码至少需要10个字符。');
    expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/api/v1/auth/register'))).toBe(false);
  });

  it('可在同一张 V7 页面注册，昵称与密码确认通过后进入创作', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/api/v1/auth/me')) return response({ error: { message: '请先登录' } }, 401);
      if (path.endsWith('/api/v1/auth/register')) return response({ account: ACCOUNT, expiresInSeconds: 3600 });
      if (path.endsWith('/api/v1/membership/me')) return response({ isAdmin: false, membership: null });
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthorAccountBoundary><AccountWorkspace /></AuthorAccountBoundary>);
    fireEvent.click(await screen.findByRole('tab', { name: '注册' }));
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: ACCOUNT.displayName } });
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: ACCOUNT.email } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'strong-pass-123' } });
    fireEvent.change(screen.getByLabelText('再次输入密码'), { target: { value: 'strong-pass-123' } });
    fireEvent.click(screen.getByRole('button', { name: '创建账号并登录' }));

    expect(await screen.findByText('创作首页：林老师')).toBeVisible();
    expect(screen.getByText('尚未开通会员')).toBeVisible();
    const registerCall = (fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>)
      .find(([path]) => String(path).endsWith('/api/v1/auth/register'));
    expect(JSON.parse(String(registerCall?.[1]?.body))).toEqual({
      email: ACCOUNT.email,
      password: 'strong-pass-123',
      displayName: ACCOUNT.displayName
    });
  });

  it('账号无权使用时显示大白话恢复，不进入创作也不泄漏后台错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: { message: 'SQL owner_id permission denied' } }, 403)));

    render(<AuthorAccountBoundary><p>不应进入创作</p></AuthorAccountBoundary>);

    expect(await screen.findByRole('heading', { name: '暂时没有打开' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('当前账号暂时不能使用文秘写作，请联系管理员。');
    expect(screen.getByRole('button', { name: '重新连接' })).toBeEnabled();
    expect(document.body.textContent).not.toMatch(/SQL|owner_id|permission/iu);
  });

  it('会员信息暂时失败不挡住创作，并可只重试失败的读取', async () => {
    let membershipCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/v1/auth/me')) return response(ACCOUNT);
      if (path.endsWith('/api/v1/membership/me')) {
        membershipCalls += 1;
        return membershipCalls === 1
          ? response({ error: { message: 'internal stack' } }, 500)
          : response(MEMBERSHIP);
      }
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthorAccountBoundary><AccountWorkspace /></AuthorAccountBoundary>);

    expect(await screen.findByText('创作首页：林老师')).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent('文秘写作暂时没有响应，请稍后重试。');
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    expect(await screen.findByText('黄金会员')).toBeVisible();
    expect(membershipCalls).toBe(2);
  });

  it('退出成功后清除当前页面账号状态并回到 V7 登录页', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/v1/auth/me')) return response(ACCOUNT);
      if (path.endsWith('/api/v1/membership/me')) return response(MEMBERSHIP);
      if (path.endsWith('/api/v1/auth/logout')) return response({ loggedOut: true });
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthorAccountBoundary><AccountWorkspace /></AuthorAccountBoundary>);
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }));

    expect(await screen.findByRole('heading', { name: '欢迎回来' })).toBeVisible();
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith('/api/v1/auth/logout'))).toBe(true));
  });

  it('退出时会话已失效也直接回到 V7 登录页', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/v1/auth/me')) return response(ACCOUNT);
      if (path.endsWith('/api/v1/membership/me')) return response(MEMBERSHIP);
      if (path.endsWith('/api/v1/auth/logout')) return response({ error: { message: '会话已失效' } }, 401);
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthorAccountBoundary><AccountWorkspace /></AuthorAccountBoundary>);
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }));

    expect(await screen.findByRole('heading', { name: '欢迎回来' })).toBeVisible();
    expect(window.location.search).toBe('?view=information&bookId=v7-book-1');
  });

  it('任一作者接口报告 401 时保留原 URL 并由全局 V7 登录壳接管', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
      String(input).endsWith('/api/v1/auth/me') ? response(ACCOUNT) : response(MEMBERSHIP)
    )));

    render(<AuthorAccountBoundary><AccountWorkspace /></AuthorAccountBoundary>);
    expect(await screen.findByText('创作首页：林老师')).toBeVisible();
    act(() => window.dispatchEvent(new Event(AUTHOR_AUTHENTICATION_REQUIRED_EVENT)));

    expect(await screen.findByRole('heading', { name: '欢迎回来' })).toBeVisible();
    expect(window.location.search).toBe('?view=information&bookId=v7-book-1');
  });

  it('切号时迟到的旧会员响应不会覆盖新账号会员信息', async () => {
    const secondAccount: AuthorAccount = {
      ...ACCOUNT,
      userId: 'user-v7-2',
      email: 'zhou@example.com',
      displayName: '周老师'
    };
    const secondMembership: AuthorMembershipStatus = {
      isAdmin: false,
      membership: {
        ...MEMBERSHIP.membership!,
        plan: 'silver',
        planLabel: '白银会员',
        computeQuota: 800_000,
        computeConsumed: 100_000,
        computeRemaining: 700_000
      }
    };
    let loginCount = 0;
    let membershipCount = 0;
    let resolveOldMembership!: (value: Response) => void;
    const oldMembership = new Promise<Response>((resolve) => { resolveOldMembership = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/v1/auth/me')) return response({ error: { message: '请先登录' } }, 401);
      if (path.endsWith('/api/v1/auth/login')) {
        loginCount += 1;
        return response({ account: loginCount === 1 ? ACCOUNT : secondAccount, expiresInSeconds: 3600 });
      }
      if (path.endsWith('/api/v1/membership/me')) {
        membershipCount += 1;
        return membershipCount === 1 ? oldMembership : response(secondMembership);
      }
      if (path.endsWith('/api/v1/auth/logout')) return response({ loggedOut: true });
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthorAccountBoundary><AccountWorkspace /></AuthorAccountBoundary>);
    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: ACCOUNT.email } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'strong-pass-123' } });
    fireEvent.click(screen.getByRole('button', { name: '登录文秘写作' }));
    expect(await screen.findByText('创作首页：林老师')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }));

    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: secondAccount.email } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'strong-pass-456' } });
    fireEvent.click(screen.getByRole('button', { name: '登录文秘写作' }));
    expect(await screen.findByText('创作首页：周老师')).toBeVisible();
    expect(await screen.findByText('白银会员')).toBeVisible();

    await act(async () => { resolveOldMembership(response(MEMBERSHIP)); await oldMembership; });
    expect(screen.getByText('白银会员')).toBeVisible();
    expect(screen.queryByText('黄金会员')).not.toBeInTheDocument();
  });

  it('管理员个人中心显示真实身份且不虚构会员额度', async () => {
    const admin: AuthorAccount = { ...ACCOUNT, role: 'admin', displayName: '平台管理员' };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
      String(input).endsWith('/api/v1/auth/me')
        ? response(admin)
        : response({ isAdmin: true, membership: null })
    )));

    render(<AuthorAccountBoundary><AccountWorkspace /></AuthorAccountBoundary>);

    expect(await screen.findByText('管理员账号')).toBeVisible();
    expect(screen.getAllByText('管理员').length).toBeGreaterThan(0);
    expect(screen.getByText('算力值不限')).toBeVisible();
    expect(screen.queryByText('尚未开通会员')).not.toBeInTheDocument();
  });
});
