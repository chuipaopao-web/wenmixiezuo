export interface AuthorAccount {
  userId: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  status: 'active' | 'suspended';
}

export type AuthorMembershipPlan = 'bronze' | 'silver' | 'gold' | 'diamond';

export interface AuthorMembershipStatus {
  isAdmin: boolean;
  membership: null | {
    plan: AuthorMembershipPlan;
    planLabel: string;
    planPrice: string;
    status: 'active' | 'revoked';
    computeQuota: number;
    computeConsumed: number;
    computeRemaining: number;
    periodStart: string;
    periodEnd: string;
    expired: boolean;
  };
}

export interface AuthorAuthenticationResult {
  account: AuthorAccount;
  expiresInSeconds: number;
}

export const AUTHOR_AUTHENTICATION_REQUIRED_EVENT = 'wenmi:v7-authentication-required';

export function notifyAuthorAuthenticationRequired(): void {
  window.dispatchEvent(new Event(AUTHOR_AUTHENTICATION_REQUIRED_EVENT));
}

type AuthorAccountErrorKind = 'unauthenticated' | 'forbidden' | 'invalid' | 'conflict' | 'rate_limited' | 'unavailable';

export class AuthorAccountError extends Error {
  public constructor(
    message: string,
    public readonly kind: AuthorAccountErrorKind,
    public readonly status: number,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = 'AuthorAccountError';
  }
}

interface ApiEnvelope<T> {
  data?: T;
  error?: { message?: string };
}

const configuredOrigin = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.trim();
const API_ORIGIN = configuredOrigin && configuredOrigin.length > 0
  ? configuredOrigin.replace(/\/$/u, '')
  : '';

async function authorAccountRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'x-wenmi-author-projection': 'clean-v1',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers
      }
    });
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') throw reason;
    throw new AuthorAccountError('暂时连接不上文秘写作，请检查网络后重试。', 'unavailable', 0, true);
  }

  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw accountErrorForStatus(response.status, path);
  }
  return payload.data;
}

function accountErrorForStatus(status: number, path: string): AuthorAccountError {
  if (status === 401) {
    const message = path.endsWith('/auth/login')
      ? '邮箱或密码不正确，请重新输入。'
      : '登录已经失效，请重新登录。';
    return new AuthorAccountError(message, 'unauthenticated', status, false);
  }
  if (status === 403) {
    return new AuthorAccountError('当前账号暂时不能使用文秘写作，请联系管理员。', 'forbidden', status, false);
  }
  if (status === 409) {
    return new AuthorAccountError('这个邮箱已经注册，请直接登录。', 'conflict', status, false);
  }
  if (status === 429) {
    return new AuthorAccountError('操作太频繁，请稍等一会儿再试。', 'rate_limited', status, true);
  }
  if (status >= 400 && status < 500) {
    return new AuthorAccountError('填写的内容没有通过检查，请确认后再试。', 'invalid', status, false);
  }
  return new AuthorAccountError('文秘写作暂时没有响应，请稍后重试。', 'unavailable', status, true);
}

export async function fetchCurrentAuthorAccount(signal?: AbortSignal): Promise<AuthorAccount | null> {
  try {
    return await authorAccountRequest<AuthorAccount>('/api/v1/auth/me', signal === undefined ? {} : { signal });
  } catch (reason) {
    if (reason instanceof AuthorAccountError && reason.kind === 'unauthenticated') return null;
    throw reason;
  }
}

export function loginAuthorAccount(input: { email: string; password: string }): Promise<AuthorAuthenticationResult> {
  return authorAccountRequest('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function registerAuthorAccount(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<AuthorAuthenticationResult> {
  return authorAccountRequest('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function logoutAuthorAccount(): Promise<{ loggedOut: boolean }> {
  return authorAccountRequest('/api/v1/auth/logout', {
    method: 'POST',
    body: '{}'
  });
}

export function fetchAuthorMembership(signal?: AbortSignal): Promise<AuthorMembershipStatus> {
  return authorAccountRequest('/api/v1/membership/me', signal === undefined ? {} : { signal });
}

export function authorAccountErrorMessage(reason: unknown, fallback = '这次没有完成，请稍后重试。'): string {
  if (reason instanceof AuthorAccountError) return reason.message;
  if (reason instanceof DOMException && reason.name === 'AbortError') return fallback;
  return fallback;
}
