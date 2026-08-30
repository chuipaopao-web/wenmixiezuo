import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/v7-server.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';

const HEADERS = {
  host: '127.0.0.1:43111',
  origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site',
  'content-type': 'application/json'
};

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('V7 作者响应与后台错误物理分离', () => {
  it('作者投影隐藏内部错误字段，后台路由仍保留审计错误码', async () => {
    context = createTestContext('wenmi-v7-author-projection-');
    const app = await createServer(context.config, context.database);
    try {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: HEADERS,
        payload: { email: 'admin@example.com', password: 'strong-pass-123', displayName: '管理员' }
      });
      const registered = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: HEADERS,
        payload: { email: 'writer@example.com', password: 'strong-pass-456', displayName: '作者' }
      });
      const cookie = cookieFrom(registered);

      const clean = await app.inject({
        method: 'GET',
        url: '/api/v1/v7/books/missing-book/book-profile',
        headers: { host: HEADERS.host, cookie, 'x-wenmi-author-projection': 'clean-v1' }
      });
      expect(clean.statusCode).toBe(404);
      expect(clean.json()).toMatchObject({
        error: { message: expect.any(String), action: 'return_to_books', retryable: false }
      });
      expect(JSON.stringify(clean.json())).not.toMatch(/BOOK_NOT_FOUND|details|stack|sqlite|provider|modelId|worker/iu);

      const raw = await app.inject({
        method: 'GET',
        url: '/api/v1/v7/books/missing-book/book-profile',
        headers: { host: HEADERS.host, cookie }
      });
      expect(raw.statusCode).toBe(404);
      expect(raw.json().error.code).toBe('BOOK_NOT_FOUND');

      const adminBoundary = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/dashboard',
        headers: { host: HEADERS.host, cookie, 'x-wenmi-author-projection': 'clean-v1' }
      });
      expect(adminBoundary.statusCode).toBe(403);
      expect(adminBoundary.json().error.code).toBe('ADMINISTRATOR_REQUIRED');
    } finally {
      await app.close();
    }
  });
});

function cookieFrom(response: { headers: Record<string, string | string[] | number | undefined> }): string {
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}
