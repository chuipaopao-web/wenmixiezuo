import { afterEach, describe, expect, it } from 'vitest';
import { createAppServer } from '../../../apps/api/src/http/app-server.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';

const HOST = '127.0.0.1:43111';
const ORIGIN = 'http://127.0.0.1:43110';
let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

let accountCounter = 0;
async function sessionCookie(app: Awaited<ReturnType<typeof createAppServer>>, email?: string): Promise<string> {
  accountCounter += 1;
  const accountEmail = email ?? `policy-${accountCounter}@example.com`;
  const response = await app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: { email: accountEmail, password: 'policy-pass-123', displayName: '安全测试' },
    headers: { host: HOST, origin: ORIGIN, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' }
  });
  const rawCookie = response.headers['set-cookie'];
  return (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(';', 1)[0]!;
}

async function loginCookie(app: Awaited<ReturnType<typeof createAppServer>>, email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { email, password: 'policy-pass-123' },
    headers: { host: HOST, origin: ORIGIN, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' }
  });
  const rawCookie = response.headers['set-cookie'];
  return (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(';', 1)[0]!;
}

describe('统一账号HTTP请求策略', () => {
  it('health最小化且所有响应带安全头', async () => {
    context = createTestContext('wenmi-policy-health-');
    const app = await createAppServer(context.config, context.database);
    try {
      const response = await app.inject({ method: 'GET', url: '/health', headers: { host: HOST } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual({ service: 'wenmi-api', status: 'ok', worker: 'possibly_offline', canStartModelTasks: false, releaseId: context.config.releaseId, time: expect.any(String) });
      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.body).not.toContain(context.config.dataDir);
      expect(response.body).not.toContain('modelRuntime');
      expect(response.body).not.toContain('database');
    } finally {
      await app.close();
    }
  });

  it('数据读取要会话，写入还要精确Origin、Fetch Metadata和JSON', async () => {
    context = createTestContext('wenmi-policy-write-');
    const app = await createAppServer(context.config, context.database);
    try {
      expect((await app.inject({ method: 'GET', url: '/api/v1/v7/books', headers: { host: HOST } })).statusCode).toBe(401);
      const cookie = await sessionCookie(app);
      expect((await app.inject({ method: 'GET', url: '/api/v1/v7/books', headers: { host: HOST, cookie } })).statusCode).toBe(200);

      const write = { method: 'POST' as const, url: '/api/v1/auth/logout', payload: {} };
      expect((await app.inject({ ...write, headers: { host: HOST, cookie, origin: 'http://evil.invalid', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' } })).statusCode).toBe(403);
      expect((await app.inject({ ...write, headers: { host: HOST, cookie, origin: ORIGIN, 'content-type': 'application/json' } })).statusCode).toBe(403);
      expect((await app.inject({ ...write, headers: { host: HOST, cookie, origin: ORIGIN, 'sec-fetch-site': 'same-site', 'content-type': 'text/plain' } })).statusCode).toBe(415);
      expect((await app.inject({ ...write, headers: { host: HOST, cookie, origin: ORIGIN, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' } })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('独立后台子域通过Host、CORS和写入Origin校验，仿冒子域仍被拒绝', async () => {
    context = createTestContext('wenmi-policy-admin-origin-');
    context.config.adminOrigin = 'https://admin.wenmixiezuo.com';
    const app = await createAppServer(context.config, context.database);
    try {
      const register = await app.inject({
        method: 'POST', url: '/api/v1/auth/register',
        payload: { email: 'admin-origin@example.com', password: 'policy-pass-123', displayName: '后台管理员' },
        headers: {
          host: 'admin.wenmixiezuo.com', origin: 'https://admin.wenmixiezuo.com',
          'sec-fetch-site': 'same-site', 'content-type': 'application/json'
        }
      });
      expect(register.statusCode).toBe(200);
      expect(register.headers['access-control-allow-origin']).toBe('https://admin.wenmixiezuo.com');
      const rawCookie = register.headers['set-cookie'];
      const cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(';', 1)[0]!;
      expect((await app.inject({
        method: 'POST', url: '/api/v1/auth/logout', payload: {},
        headers: {
          host: 'admin.wenmixiezuo.com', cookie, origin: 'https://admin.wenmixiezuo.com',
          'sec-fetch-site': 'same-site', 'content-type': 'application/json'
        }
      })).statusCode).toBe(200);
      expect((await app.inject({
        method: 'POST', url: '/api/v1/auth/login', payload: { email: 'admin-origin@example.com', password: 'policy-pass-123' },
        headers: {
          host: 'admin.wenmixiezuo.com', origin: 'https://admin.wenmixiezuo.com.evil.invalid',
          'sec-fetch-site': 'same-site', 'content-type': 'application/json'
        }
      })).statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
  it('浏览器可以预检设定工作台使用的PUT写入', async () => {
    context = createTestContext('wenmi-policy-put-cors-');
    const app = await createAppServer(context.config, context.database);
    try {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/v7/books/book-1/book-profile',
        headers: {
          host: HOST,
          origin: ORIGIN,
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'content-type'
        }
      });
      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-methods']).toContain('PUT');
    } finally {
      await app.close();
    }
  });

  it('Worker令牌不能复活旧入口，也不能替代作者会话', async () => {
    context = createTestContext('wenmi-policy-worker-');
    const app = await createAppServer(context.config, context.database);
    try {
      const url = '/api/v1/internal/worker/tasks/missing/execute';
      const body = { ownerId: context.config.ownerId, bookId: 'missing' };
      expect((await app.inject({ method: 'POST', url, payload: body, headers: { host: HOST, 'content-type': 'application/json', 'x-wenmi-worker-id': 'worker' } })).statusCode).toBe(401);
      const accepted = await app.inject({ method: 'POST', url, payload: body, headers: { host: HOST, 'content-type': 'application/json', 'x-wenmi-worker-id': 'worker', 'x-wenmi-worker-token': context.config.workerToken } });
      expect(accepted.statusCode).toBe(404);
      expect(accepted.body).not.toContain(context.config.workerToken);

      const cookie = await sessionCookie(app);
      expect((await app.inject({ method: 'GET', url: '/api/v1/v7/books', headers: { host: HOST, cookie: `${cookie}; x=${context.config.workerToken}` } })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('公网限流按代理转发来的真实访客IP分桶，互不牵连', async () => {
    context = createTestContext('wenmi-policy-ratelimit-');
    // 公网部署才启用限流；Caddy 反代默认带 X-Forwarded-For，服务只监听 127.0.0.1。
    context.config.publicOrigin = 'https://wenmixiezuo.com';
    const app = await createAppServer(context.config, context.database);
    const register = (ip: string, email: string) => app.inject({
      method: 'POST', url: '/api/v1/auth/register',
      payload: { email, password: 'policy-pass-123', displayName: '访客' },
      headers: {
        host: HOST, origin: ORIGIN, 'sec-fetch-site': 'same-site',
        'content-type': 'application/json', 'x-forwarded-for': ip
      }
    });
    try {
      // 注册入口路由级限流为每 IP 5 分钟 3 次。
      for (let index = 0; index < 3; index += 1) {
        expect((await register('203.0.113.10', `limit-a-${index}@example.com`)).statusCode).toBe(200);
      }
      const limited = await register('203.0.113.10', 'limit-a-3@example.com');
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.code).toBe('RATE_LIMITED');
      // 另一个真实访客 IP 是独立的桶，不受前者耗尽影响。
      expect((await register('203.0.113.11', 'limit-b-0@example.com')).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('已认证业务读取按用户分桶，正常切页不会被100次IP桶拦住，直到600次才限流', async () => {
    context = createTestContext('wenmi-policy-auth-read-');
    context.config.publicOrigin = 'https://wenmixiezuo.com';
    const app = await createAppServer(context.config, context.database);
    try {
      const cookie = await sessionCookie(app, 'read-limit@example.com');
      let response;
      for (let index = 0; index < 600; index += 1) {
        response = await app.inject({
          method: 'GET',
          url: '/api/v1/v7/books',
          headers: { host: HOST, cookie, 'x-forwarded-for': '203.0.113.20' }
        });
        expect(response.statusCode).toBe(200);
      }
      const limited = await app.inject({
        method: 'GET',
        url: '/api/v1/v7/books',
        headers: { host: HOST, cookie, 'x-forwarded-for': '203.0.113.20' }
      });
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
      expect(limited.headers['retry-after']).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('相同IP下不同已认证账户读取限流互相隔离', async () => {
    context = createTestContext('wenmi-policy-auth-users-');
    context.config.publicOrigin = 'https://wenmixiezuo.com';
    const app = await createAppServer(context.config, context.database);
    try {
      const firstCookie = await sessionCookie(app, 'read-user-a@example.com');
      const secondCookie = await sessionCookie(app, 'read-user-b@example.com');
      for (let index = 0; index < 600; index += 1) {
        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/v7/books',
          headers: { host: HOST, cookie: firstCookie, 'x-forwarded-for': '203.0.113.21' }
        });
        expect(response.statusCode).toBe(200);
      }
      expect((await app.inject({
        method: 'GET',
        url: '/api/v1/v7/books',
        headers: { host: HOST, cookie: firstCookie, 'x-forwarded-for': '203.0.113.21' }
      })).statusCode).toBe(429);
      expect((await app.inject({
        method: 'GET',
        url: '/api/v1/v7/books',
        headers: { host: HOST, cookie: secondCookie, 'x-forwarded-for': '203.0.113.21' }
      })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('同一账户不同会话共享读取桶，读取耗尽不吞写入和health额度', async () => {
    context = createTestContext('wenmi-policy-auth-sessions-');
    context.config.publicOrigin = 'https://wenmixiezuo.com';
    const app = await createAppServer(context.config, context.database);
    try {
      const email = 'read-session@example.com';
      const firstCookie = await sessionCookie(app, email);
      const secondCookie = await loginCookie(app, email);
      for (let index = 0; index < 599; index += 1) {
        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/v7/books',
          headers: { host: HOST, cookie: firstCookie, 'x-forwarded-for': '203.0.113.22' }
        });
        expect(response.statusCode).toBe(200);
      }
      expect((await app.inject({
        method: 'HEAD',
        url: '/api/v1/v7/books',
        headers: { host: HOST, cookie: secondCookie, 'x-forwarded-for': '203.0.113.22' }
      })).statusCode).toBe(200);
      expect((await app.inject({
        method: 'GET',
        url: '/api/v1/v7/books',
        headers: { host: HOST, cookie: secondCookie, 'x-forwarded-for': '203.0.113.22' }
      })).statusCode).toBe(429);
      expect((await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: {},
        headers: {
          host: HOST,
          cookie: secondCookie,
          origin: ORIGIN,
          'sec-fetch-site': 'same-site',
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.22'
        }
      })).statusCode).toBe(200);
      expect((await app.inject({
        method: 'GET',
        url: '/health',
        headers: { host: HOST, 'x-forwarded-for': '203.0.113.22' }
      })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('注册和登录保持IP严格限额，不能被有效cookie绕过', async () => {
    context = createTestContext('wenmi-policy-public-auth-');
    context.config.publicOrigin = 'https://wenmixiezuo.com';
    const app = await createAppServer(context.config, context.database);
    const register = (index: number, cookie?: string) => app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: `public-auth-${index}@example.com`, password: 'policy-pass-123', displayName: '访客' },
      headers: {
        host: HOST,
        origin: ORIGIN,
        'sec-fetch-site': 'same-site',
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.23',
        ...(cookie === undefined ? {} : { cookie })
      }
    });
    const login = (cookie?: string) => app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'public-auth-0@example.com', password: 'policy-pass-123' },
      headers: {
        host: HOST,
        origin: ORIGIN,
        'sec-fetch-site': 'same-site',
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.24',
        ...(cookie === undefined ? {} : { cookie })
      }
    });
    try {
      const first = await register(0);
      expect(first.statusCode).toBe(200);
      const rawCookie = first.headers['set-cookie'];
      const cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(';', 1)[0]!;
      expect((await register(1, cookie)).statusCode).toBe(200);
      expect((await register(2, cookie)).statusCode).toBe(200);
      const registerLimited = await register(3, cookie);
      expect(registerLimited.statusCode).toBe(429);
      expect(registerLimited.json().error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
      expect(registerLimited.headers['retry-after']).toBeDefined();

      for (let index = 0; index < 10; index += 1) {
        expect((await login(cookie)).statusCode).toBe(200);
      }
      const loginLimited = await login(cookie);
      expect(loginLimited.statusCode).toBe(429);
      expect(loginLimited.json().error).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
      expect(loginLimited.headers['retry-after']).toBeDefined();
    } finally {
      await app.close();
    }
  });
});
