import { afterEach, describe, expect, it } from 'vitest';
import { createV7Server } from '../../../apps/api/src/http/v7-server.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';

const HEADERS = {
  host: '127.0.0.1:43111', origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site', 'content-type': 'application/json'
};

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

function cookieFrom(response: { headers: Record<string, string | string[] | number | undefined> }): string {
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

describe('V7 平台权限与公开信息边界', () => {
  it('普通作者不能读取后台，管理员可以读取当前统一用量与经营数据', async () => {
    context = createTestContext('wenmi-v7-platform-boundary-');
    const app = await createV7Server(context.config, context.database);
    try {
      const admin = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'admin@example.com', password: 'strong-pass-123', displayName: '管理员' } });
      const author = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'author@example.com', password: 'strong-pass-456', displayName: '作者' } });
      const adminCookie = cookieFrom(admin);
      const authorCookie = cookieFrom(author);

      for (const url of ['/api/v1/admin/usage', '/api/v1/admin/dashboard']) {
        expect((await app.inject({ method: 'GET', url, headers: { host: HEADERS.host, cookie: authorCookie } })).statusCode, url)
          .toBe(403);
        expect((await app.inject({ method: 'GET', url, headers: { host: HEADERS.host, cookie: adminCookie } })).statusCode, url)
          .toBe(200);
      }

      expect((await app.inject({ method: 'GET', url: '/api/v1/admin/model-scheme',
        headers: { host: HEADERS.host, cookie: adminCookie } })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('作者团队视图不泄露供应商、模型标识、密钥或内部提示词', async () => {
    context = createTestContext('wenmi-v7-public-agent-view-');
    const app = await createV7Server(context.config, context.database);
    try {
      await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'admin@example.com', password: 'strong-pass-123', displayName: '管理员' } });
      const author = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'author@example.com', password: 'strong-pass-456', displayName: '作者' } });
      const response = await app.inject({ method: 'GET', url: '/api/v1/v7/editorial-department',
        headers: { host: HEADERS.host, cookie: cookieFrom(author) } });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toMatch(/provider|modelId|apiKey|systemPrompt|promptInstruction/iu);
    } finally {
      await app.close();
    }
  });
});
