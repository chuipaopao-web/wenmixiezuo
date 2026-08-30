// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthorAccountError,
  fetchAuthorMembership,
  fetchCurrentAuthorAccount,
  loginAuthorAccount,
  logoutAuthorAccount,
  registerAuthorAccount,
  type AuthorAccount,
  type AuthorMembershipStatus
} from './account-api';

const ACCOUNT: AuthorAccount = {
  userId: 'user-1',
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(status >= 200 && status < 300 ? { data } : data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('V7 作者端账号 API', () => {
  it('启动时用现有 Cookie 核验会话，401 只表示需要登录', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { message: '内部身份字段' } }, 401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCurrentAuthorAccount()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/v1/auth/me');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('x-wenmi-author-projection')).toBe('clean-v1');
  });

  it('登录、注册、退出和会员状态只复用既有账号接口', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/v1/auth/login')) return jsonResponse({ account: ACCOUNT, expiresInSeconds: 3600 });
      if (path.endsWith('/api/v1/auth/register')) return jsonResponse({ account: ACCOUNT, expiresInSeconds: 3600 });
      if (path.endsWith('/api/v1/auth/logout')) return jsonResponse({ loggedOut: true });
      if (path.endsWith('/api/v1/membership/me')) return jsonResponse(MEMBERSHIP);
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loginAuthorAccount({ email: ACCOUNT.email, password: 'strong-pass-123' })).resolves.toMatchObject({ account: ACCOUNT });
    await expect(registerAuthorAccount({ email: ACCOUNT.email, password: 'strong-pass-123', displayName: ACCOUNT.displayName })).resolves.toMatchObject({ account: ACCOUNT });
    await expect(fetchAuthorMembership()).resolves.toEqual(MEMBERSHIP);
    await expect(logoutAuthorAccount()).resolves.toEqual({ loggedOut: true });

    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    expect(calls.map(([path]) => String(path))).toEqual([
      '/api/v1/auth/login',
      '/api/v1/auth/register',
      '/api/v1/membership/me',
      '/api/v1/auth/logout'
    ]);
    for (const [, init] of calls) {
      expect(init?.credentials).toBe('include');
    }
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      email: ACCOUNT.email,
      password: 'strong-pass-123'
    });
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({
      email: ACCOUNT.email,
      password: 'strong-pass-123',
      displayName: ACCOUNT.displayName
    });
  });

  it('登录失败、权限不足和限流都使用作者能执行的说明', async () => {
    const responses = [
      jsonResponse({ error: { message: 'internal auth stack' } }, 401),
      jsonResponse({ error: { message: 'SQL owner_id denied' } }, 403),
      jsonResponse({ error: { message: 'rate limiter internal' } }, 429)
    ];
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!));

    await expect(loginAuthorAccount({ email: ACCOUNT.email, password: 'wrong-password' })).rejects.toMatchObject({
      message: '邮箱或密码不正确，请重新输入。',
      kind: 'unauthenticated'
    });
    await expect(fetchAuthorMembership()).rejects.toMatchObject({
      message: '当前账号暂时不能使用文秘写作，请联系管理员。',
      kind: 'forbidden'
    });
    await expect(logoutAuthorAccount()).rejects.toMatchObject({
      message: '操作太频繁，请稍等一会儿再试。',
      kind: 'rate_limited'
    });
  });

  it('服务错误和断网不把后台信息带到作者页面', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'SQLite token model stack' } }, 500))
      .mockRejectedValueOnce(new TypeError('Failed to fetch')));

    const serviceFailure = fetchAuthorMembership();
    await expect(serviceFailure).rejects.toBeInstanceOf(AuthorAccountError);
    await expect(serviceFailure).rejects.not.toThrow(/SQLite|token|model|stack/iu);
    await expect(fetchCurrentAuthorAccount()).rejects.toThrow('暂时连接不上文秘写作，请检查网络后重试。');
  });
});
