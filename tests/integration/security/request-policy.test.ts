import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/v7-server.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';

const HOST = '127.0.0.1:43111';
const ORIGIN = 'http://127.0.0.1:43110';
let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

let accountCounter = 0;
async function sessionCookie(app: Awaited<ReturnType<typeof createServer>>): Promise<string> {
  accountCounter += 1;
  const response = await app.inject({
    method: 'POST', url: '/api/v1/auth/register',
    payload: { email: `policy-${accountCounter}@example.com`, password: 'policy-pass-123', displayName: '安全测试' },
    headers: { host: HOST, origin: ORIGIN, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' }
  });
  const rawCookie = response.headers['set-cookie'];
  return (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(';', 1)[0]!;
}

describe('统一账号HTTP请求策略', () => {
  it('health最小化且所有响应带安全头', async () => {
    context = createTestContext('wenmi-policy-health-');
    const app = await createServer(context.config, context.database);
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
    const app = await createServer(context.config, context.database);
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
    const app = await createServer(context.config, context.database);
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
    const app = await createServer(context.config, context.database);
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
    const app = await createServer(context.config, context.database);
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
    const app = await createServer(context.config, context.database);
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
});
