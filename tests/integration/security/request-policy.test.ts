import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/server.js';
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
      expect((await app.inject({ method: 'GET', url: '/api/v1/books', headers: { host: HOST } })).statusCode).toBe(401);
      const cookie = await sessionCookie(app);
      expect((await app.inject({ method: 'GET', url: '/api/v1/books', headers: { host: HOST, cookie } })).statusCode).toBe(200);

      const write = { method: 'POST' as const, url: '/api/v1/books/drafts', payload: { title: '安全测试', text: '测试' } };
      expect((await app.inject({ ...write, headers: { host: HOST, cookie, origin: 'http://evil.invalid', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' } })).statusCode).toBe(403);
      expect((await app.inject({ ...write, headers: { host: HOST, cookie, origin: ORIGIN, 'content-type': 'application/json' } })).statusCode).toBe(403);
      expect((await app.inject({ ...write, headers: { host: HOST, cookie, origin: ORIGIN, 'sec-fetch-site': 'same-site', 'content-type': 'text/plain' } })).statusCode).toBe(415);
      expect((await app.inject({ ...write, headers: { host: HOST, cookie, origin: ORIGIN, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' } })).statusCode).toBe(200);
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
        url: '/api/v1/books/book-1/setting-outline-workspace/world-era',
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

  it('Worker独立Token仅能访问Worker入口', async () => {
    context = createTestContext('wenmi-policy-worker-');
    const app = await createServer(context.config, context.database);
    try {
      const url = '/api/v1/internal/worker/tasks/missing/execute';
      const body = { ownerId: context.config.ownerId, bookId: 'missing' };
      expect((await app.inject({ method: 'POST', url, payload: body, headers: { host: HOST, 'content-type': 'application/json', 'x-wenmi-worker-id': 'worker' } })).statusCode).toBe(401);
      const accepted = await app.inject({ method: 'POST', url, payload: body, headers: { host: HOST, 'content-type': 'application/json', 'x-wenmi-worker-id': 'worker', 'x-wenmi-worker-token': context.config.workerToken } });
      expect(accepted.statusCode).toBe(400);
      expect(accepted.body).not.toContain(context.config.workerToken);

      const cookie = await sessionCookie(app);
      expect((await app.inject({ method: 'GET', url: '/api/v1/books', headers: { host: HOST, cookie: `${cookie}; x=${context.config.workerToken}` } })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
