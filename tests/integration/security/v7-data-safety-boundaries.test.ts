import { afterEach, describe, expect, it } from 'vitest';
import { createV7Server } from '../../../apps/api/src/http/v7-server.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { initializeV7Book } from '../../helpers/v7-book-fixture.js';

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

describe('V7 作者与书籍数据隔离', () => {
  it('列表和书籍详情都不会跨作者泄露', async () => {
    context = createTestContext('wenmi-v7-data-boundary-');
    const app = await createV7Server(context.config, context.database);
    try {
      await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'admin@example.com', password: 'strong-pass-123', displayName: '管理员' } });
      const first = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'first@example.com', password: 'strong-pass-456', displayName: '甲作者' } });
      const second = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'second@example.com', password: 'strong-pass-789', displayName: '乙作者' } });
      const firstOwner = (context.database.prepare("SELECT owner_id FROM user_accounts WHERE email_normalized='first@example.com'")
        .get() as { owner_id: string }).owner_id;
      const secondOwner = (context.database.prepare("SELECT owner_id FROM user_accounts WHERE email_normalized='second@example.com'")
        .get() as { owner_id: string }).owner_id;
      const ids = new SequenceIds();
      const firstBook = initializeV7Book(context, firstOwner, ids, new FixedClock(), { title: '甲的书' });
      initializeV7Book(context, secondOwner, ids, new FixedClock(), { title: '乙的书' });

      const firstList = await app.inject({ method: 'GET', url: '/api/v1/v7/books',
        headers: { host: HEADERS.host, cookie: cookieFrom(first) } });
      expect(firstList.statusCode).toBe(200);
      expect(firstList.body).toContain('甲的书');
      expect(firstList.body).not.toContain('乙的书');

      const crossBook = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${firstBook.bookId}/book-profile`,
        headers: { host: HEADERS.host, cookie: cookieFrom(second) } });
      expect([403, 404]).toContain(crossBook.statusCode);
      expect(crossBook.body).not.toContain('甲的书');
    } finally {
      await app.close();
    }
  });
});
