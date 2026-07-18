import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/server.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';

const BROWSER_HEADERS = {
  host: '127.0.0.1:43111',
  origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site',
  'content-type': 'application/json'
};

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('本机运行会话', () => {
  it('只向精确本机入口签发短期HttpOnly会话', async () => {
    context = createTestContext('wenmi-session-');
    const app = await createServer(context.config, context.database);
    try {
      const wrongHost = await app.inject({
        method: 'POST', url: '/api/v1/runtime/session',
        headers: { ...BROWSER_HEADERS, host: 'localhost:43111' }, payload: {}
      });
      expect(wrongHost.statusCode).toBe(403);

      const wrongOrigin = await app.inject({
        method: 'POST', url: '/api/v1/runtime/session',
        headers: { ...BROWSER_HEADERS, origin: 'http://evil.invalid' }, payload: {}
      });
      expect(wrongOrigin.statusCode).toBe(403);

      const response = await app.inject({
        method: 'POST', url: '/api/v1/runtime/session', headers: BROWSER_HEADERS, payload: {}
      });
      expect(response.statusCode).toBe(200);
      const cookie = response.headers['set-cookie'];
      expect(cookie).toContain('wenmi_session=');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/api/v1');
      expect(cookie).toContain('Max-Age=');
      expect(cookie).not.toContain('Secure');
      expect(response.json().data).toMatchObject({ authenticated: true, expiresInSeconds: expect.any(Number) });
    } finally {
      await app.close();
    }
  });

  it('会话在API重启后失效且绝不接受URL令牌', async () => {
    context = createTestContext('wenmi-session-restart-');
    const first = await createServer(context.config, context.database);
    const session = await first.inject({ method: 'POST', url: '/api/v1/runtime/session', headers: BROWSER_HEADERS, payload: {} });
    const rawCookie = session.headers['set-cookie'];
    const cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie)!.split(';', 1)[0]!;
    expect((await first.inject({ method: 'GET', url: '/api/v1/books', headers: { host: BROWSER_HEADERS.host, cookie } })).statusCode).toBe(200);
    await first.close();

    const restarted = await createServer(context.config, context.database);
    try {
      expect((await restarted.inject({ method: 'GET', url: '/api/v1/books', headers: { host: BROWSER_HEADERS.host, cookie } })).statusCode).toBe(401);
      expect((await restarted.inject({ method: 'GET', url: `/api/v1/books?token=${encodeURIComponent(cookie)}`, headers: { host: BROWSER_HEADERS.host } })).statusCode).toBe(401);
      expect((await restarted.inject({ method: 'GET', url: '/api/v1/events?after=0&token=fake', headers: { host: BROWSER_HEADERS.host } })).statusCode).toBe(401);
    } finally {
      await restarted.close();
    }
  });
});
