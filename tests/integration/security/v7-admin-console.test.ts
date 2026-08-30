import { afterEach, describe, expect, it } from 'vitest';
import { createV7Server } from '../../../apps/api/src/http/v7-server.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';

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

describe('V7 独立后台当前接口白名单', () => {
  it('当前后台接口保持管理员门禁，已退役后台接口不再注册', async () => {
    context = createTestContext('wenmi-v7-admin-console-');
    const app = await createV7Server(context.config, context.database);
    try {
      const admin = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'admin@example.com', password: 'strong-pass-123', displayName: '管理员' } });
      const author = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'author@example.com', password: 'strong-pass-456', displayName: '作者' } });
      const adminCookie = cookieFrom(admin);
      const authorCookie = cookieFrom(author);
      for (const url of [
        '/api/v1/admin/dashboard', '/api/v1/admin/user-operations', '/api/v1/admin/usage',
        '/api/v1/admin/issues?limit=10', '/api/v1/admin/membership-stats', '/api/v1/admin/feature-capabilities'
      ]) {
        expect((await app.inject({ method: 'GET', url, headers: { host: HEADERS.host, cookie: authorCookie } })).statusCode, url)
          .toBe(403);
        expect((await app.inject({ method: 'GET', url, headers: { host: HEADERS.host, cookie: adminCookie } })).statusCode, url)
          .toBe(200);
      }
      const feedback = await app.inject({ method: 'POST', url: '/api/v1/feedback',
        headers: { ...HEADERS, cookie: authorCookie }, payload: { category: 'experience', message: '当前页面需要改进' } });
      expect(feedback.statusCode).toBe(200);
      for (const url of [
        '/api/v1/admin/model-scheme', '/api/v1/admin/ai-governance',
        '/api/v1/admin/narrative-methods', '/api/v1/admin/prompt-catalog', '/api/v1/capabilities'
      ]) {
        expect((await app.inject({ method: 'GET', url, headers: { host: HEADERS.host, cookie: adminCookie } })).statusCode, url)
          .toBe(404);
      }
    } finally {
      await app.close();
    }
  });

  it('仪表盘和用户操作只读投影统计 V7 失败任务，不依赖旧团队任务表', async () => {
    context = createTestContext('wenmi-v7-admin-task-audit-');
    const app = await createV7Server(context.config, context.database);
    try {
      const admin = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'admin-audit@example.com', password: 'strong-pass-123', displayName: '管理员' } });
      await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
        payload: { email: 'author-audit@example.com', password: 'strong-pass-456', displayName: '审计作者' } });
      const account = context.database.prepare(`SELECT owner_id FROM user_accounts WHERE email_normalized=?`)
        .get('author-audit@example.com') as { owner_id: string };
      const now = new Date().toISOString();
      const bookId = 'v7-admin-audit-book';
      new BookRepository(context.database).create({ ownerId: account.owner_id, bookId }, 'V7审计书', now, 'active');
      context.database.prepare(`INSERT INTO v7_book_title_design_calls(
        design_id,owner_id,book_id,idempotency_key,request_hash,source_version,member_key,state,
        prompt_hash,options_json,failure_message,created_at,updated_at
      ) VALUES(?,?,?,?,?,1,'chief-deepseek-v4-pro','failed',?,'[]','模型没有返回有效书名',?,?)`).run(
        'v7-title-failed-1', account.owner_id, bookId, 'title-audit-0001', 'a'.repeat(64), 'b'.repeat(64), now, now
      );
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE owner_id=?`).get(account.owner_id))
        .toEqual({ count: 0 });

      const headers = { host: HEADERS.host, cookie: cookieFrom(admin) };
      const dashboard = (await app.inject({ method: 'GET', url: '/api/v1/admin/dashboard', headers })).json() as {
        data: { overview: { failedTasksToday: number } };
      };
      expect(dashboard.data.overview.failedTasksToday).toBe(1);
      const operations = (await app.inject({ method: 'GET', url: '/api/v1/admin/user-operations', headers })).json() as {
        data: { items: Array<{ email: string; failures: Array<Record<string, unknown>>; books: Array<Record<string, unknown>> }> };
      };
      const author = operations.data.items.find((item) => item.email === 'author-audit@example.com');
      expect(author?.failures).toEqual([expect.objectContaining({
        taskId: 'v7-title-failed-1', bookId, taskType: 'title_design', errorSummary: '模型没有返回有效书名'
      })]);
      expect(author?.books[0]).toEqual(expect.objectContaining({
        bookId, latestTaskId: 'v7-title-failed-1', latestTaskStatus: 'failed'
      }));
    } finally {
      await app.close();
    }
  });
});
