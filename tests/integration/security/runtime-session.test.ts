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

function cookieFrom(response: { headers: Record<string, string | string[] | number | undefined> }): string {
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

describe('统一用户账号与登录会话', () => {
  it('首位注册用户成为管理员并取得安全Cookie', async () => {
    context = createTestContext('wenmi-account-register-');
    const app = await createServer(context.config, context.database);
    try {
      const wrongHost = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: { ...BROWSER_HEADERS, host: 'localhost:43111' }, payload: { email: 'boss@example.com', password: 'strong-pass-123', displayName: '老板' } });
      expect(wrongHost.statusCode).toBe(403);
      const wrongOrigin = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: { ...BROWSER_HEADERS, origin: 'http://evil.invalid' }, payload: { email: 'boss@example.com', password: 'strong-pass-123', displayName: '老板' } });
      expect(wrongOrigin.statusCode).toBe(403);

      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: { email: 'Boss@Example.com', password: 'strong-pass-123', displayName: '老板' } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.account).toMatchObject({ email: 'boss@example.com', displayName: '老板', role: 'admin', status: 'active' });
      const cookie = response.headers['set-cookie'];
      expect(cookie).toContain('wenmi_session=');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('Max-Age=');
      expect(cookie).not.toContain('Secure');
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { host: BROWSER_HEADERS.host, cookie: cookieFrom(response) } })).statusCode).toBe(200);
      expect((context.database.prepare('SELECT password_hash, password_salt FROM user_accounts').get() as { password_hash: string; password_salt: string })).toMatchObject({
        password_hash: expect.not.stringContaining('strong-pass-123'),
        password_salt: expect.any(String)
      });
    } finally {
      await app.close();
    }
  });

  it('拒绝不完整注册、弱密码、重复邮箱和错误密码，并返回可读提示', async () => {
    context = createTestContext('wenmi-account-validation-');
    const app = await createServer(context.config, context.database);
    try {
      const missingPayload = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: {} });
      expect(missingPayload.statusCode).toBe(400);
      expect(missingPayload.json().error.message).toMatch(/填写邮箱和密码/u);
      const weakPassword = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: { email: 'boss@example.com', password: '123' } });
      expect(weakPassword.statusCode).toBe(400);
      const registration = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: { email: 'boss@example.com', password: 'strong-pass-123' } });
      expect(registration.statusCode).toBe(200);
      const duplicate = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: { email: 'BOSS@example.com', password: 'another-pass-123' } });
      expect(duplicate.statusCode).toBe(409);
      const wrongPassword = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: BROWSER_HEADERS, payload: { email: 'boss@example.com', password: 'wrong-pass-123' } });
      expect(wrongPassword.statusCode).toBe(401);
      expect(wrongPassword.json().error.message).toMatch(/邮箱或密码/u);
    } finally {
      await app.close();
    }
  });
  it('登录跨API重启保持有效，退出后立即撤销且URL令牌无效', async () => {
    context = createTestContext('wenmi-account-restart-');
    const first = await createServer(context.config, context.database);
    const registration = await first.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: { email: 'writer@example.com', password: 'strong-pass-456', displayName: '作者' } });
    const cookie = cookieFrom(registration);
    expect((await first.inject({ method: 'GET', url: '/api/v1/books', headers: { host: BROWSER_HEADERS.host, cookie } })).statusCode).toBe(200);
    await first.close();

    const restarted = await createServer(context.config, context.database);
    try {
      expect((await restarted.inject({ method: 'GET', url: '/api/v1/books', headers: { host: BROWSER_HEADERS.host, cookie } })).statusCode).toBe(200);
      expect((await restarted.inject({ method: 'GET', url: `/api/v1/books?token=${encodeURIComponent(cookie)}`, headers: { host: BROWSER_HEADERS.host } })).statusCode).toBe(401);
      const logout = await restarted.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { ...BROWSER_HEADERS, cookie }, payload: {} });
      expect(logout.statusCode).toBe(200);
      expect(logout.headers['set-cookie']).toContain('Max-Age=0');
      expect((await restarted.inject({ method: 'GET', url: '/api/v1/books', headers: { host: BROWSER_HEADERS.host, cookie } })).statusCode).toBe(401);
      const login = await restarted.inject({ method: 'POST', url: '/api/v1/auth/login', headers: BROWSER_HEADERS, payload: { email: 'writer@example.com', password: 'strong-pass-456' } });
      expect(login.statusCode).toBe(200);
    } finally {
      await restarted.close();
    }
  });

  it('不同用户书籍严格隔离，管理员可以暂停和恢复普通用户', async () => {
    context = createTestContext('wenmi-account-isolation-');
    const app = await createServer(context.config, context.database);
    try {
      const legacyNow = new Date().toISOString();
      context.database.prepare(`
        INSERT INTO owners (owner_id, display_name, version, created_at, updated_at)
        VALUES (?, '升级前本机用户', 1, ?, ?)
      `).run(context.config.ownerId, legacyNow, legacyNow);
      context.database.prepare(`
        INSERT INTO books (book_id, owner_id, title, status, version, positioning_version, canon_revision, editor_epoch, created_at, updated_at)
        VALUES ('legacy-book', ?, '升级前测试书', 'active', 1, 0, 0, 0, ?, ?)
      `).run(context.config.ownerId, legacyNow, legacyNow);
      const first = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: { email: 'admin@example.com', password: 'strong-pass-789', displayName: '管理员' } });
      const second = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS, payload: { email: 'reader@example.com', password: 'strong-pass-987', displayName: '读者' } });
      const adminCookie = cookieFrom(first);
      const userCookie = cookieFrom(second);
      const rows = context.database.prepare('SELECT user_id, owner_id, email_normalized FROM user_accounts ORDER BY created_at').all() as unknown as Array<{ user_id: string; owner_id: string; email_normalized: string }>;
      const admin = rows.find((row) => row.email_normalized === 'admin@example.com')!;
      const user = rows.find((row) => row.email_normalized === 'reader@example.com')!;
      expect(admin.owner_id).toBe(context.config.ownerId);
      expect(user.owner_id).not.toBe(context.config.ownerId);
      expect(user.owner_id).not.toBe(admin.owner_id);
      const now = new Date().toISOString();
      context.database.prepare(`
        INSERT INTO books (book_id, owner_id, title, status, version, positioning_version, canon_revision, editor_epoch, created_at, updated_at)
        VALUES ('admin-book', ?, '管理员的书', 'active', 1, 0, 0, 0, ?, ?)
      `).run(admin.owner_id, now, now);

      const overview = await app.inject({ method: 'GET', url: '/api/v1/admin/overview', headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } });
      expect(overview.statusCode).toBe(200);
      expect(overview.json().data.totalBooks).toBe(2);

      const adminBooks = (await app.inject({ method: 'GET', url: '/api/v1/books', headers: { host: BROWSER_HEADERS.host, cookie: adminCookie } })).json().data;
      expect(adminBooks).toHaveLength(2);
      expect(adminBooks.map((book: { bookId: string }) => book.bookId).sort()).toEqual(['admin-book', 'legacy-book']);
      expect((await app.inject({ method: 'GET', url: '/api/v1/books', headers: { host: BROWSER_HEADERS.host, cookie: userCookie } })).json().data).toHaveLength(0);

      const suspend = await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${user.user_id}/status`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { status: 'suspended' } });
      expect(suspend.statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/api/v1/books', headers: { host: BROWSER_HEADERS.host, cookie: userCookie } })).statusCode).toBe(401);
      const reactivate = await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${user.user_id}/status`, headers: { ...BROWSER_HEADERS, cookie: adminCookie }, payload: { status: 'active' } });
      expect(reactivate.statusCode).toBe(200);
      const loginAgain = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: BROWSER_HEADERS, payload: { email: 'reader@example.com', password: 'strong-pass-987' } });
      expect(loginAgain.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
