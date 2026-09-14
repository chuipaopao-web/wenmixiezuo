/**
 * AUTH-TAKEOVER-01 返工1回归：身份域CAS安全。
 * 复现Codex探针三缺陷并断言修复：并发改密不被旧登录覆盖（旧密码不得复活）、
 * 升级登录last_login_at落库、并发停用不发会话；另覆盖fail-closed凭据、
 * 改密/撤销其他会话新能力、vendored域与rebuild原件parity。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scryptSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../helpers/test-context.js';
import { createAppServer } from '../../../apps/api/src/http/app-server.js';
import { IdentityService } from '../../../apps/api/src/identity/identity-service.js';
import * as vendored from '../../../apps/api/src/identity/domain/passwords.js';
import * as rebuildPasswords from '../../../rebuild/packages/backend/src/domain/accounts/passwords.js';

const HEADERS = { host: '127.0.0.1:43111', origin: 'http://127.0.0.1:43110', 'sec-fetch-site': 'same-site', 'content-type': 'application/json' };

function v1Hash(password: string, salt: string): string {
  return scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
}
function v2Hash(password: string, salt: string): string {
  return scryptSync(password, salt, 64, { N: 32_768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('hex');
}

/** 直插v1历史账号（owner行+外键）。 */
function seedLegacyAccount(c: ReturnType<typeof createTestContext>, email: string, password: string): void {
  const salt = randomBytes(16).toString('hex');
  c.database.prepare("INSERT INTO owners (owner_id, display_name, version, created_at, updated_at) VALUES (?, '历史用户', 1, '2026-01-01', '2026-01-01')").run(`owner-${email}`);
  c.database.prepare(`
    INSERT INTO user_accounts (user_id, owner_id, email_normalized, display_name, password_salt, password_hash,
      password_format, password_n, password_r, password_p, credential_version, role, status, created_at, updated_at, last_login_at)
    VALUES (?, ?, ?, '历史用户', ?, ?, NULL, NULL, NULL, NULL, 0, 'user', 'active', '2026-01-01', '2026-01-01', NULL)
  `).run(`user-${email}`, `owner-${email}`, email, salt, v1Hash(password, salt));
}

describe('AUTH-TAKEOVER-01 返工1：身份域CAS与能力', () => {
  it('并发改密：旧登录不覆盖新凭据，新密码保持有效、旧密码不复活（Codex探针场景）', async () => {
    const c = createTestContext('cas-pw-');
    const app = await createAppServer(c.config, c.database);
    try {
      seedLegacyAccount(c, 'cas@example.com', 'Old-pass-123!');
      const service = new IdentityService(c.database, false, c.config.ownerId);
      // 登录异步派生期间并发改密（直接写库，模拟另一管理员/流程改密，不动credential_version）
      const running = service.login({ email: 'cas@example.com', password: 'Old-pass-123!' });
      const newSalt = randomBytes(16).toString('hex');
      c.database.prepare("UPDATE user_accounts SET password_salt=?, password_hash=?, password_format='scrypt-v2', password_n=32768, password_r=8, password_p=3 WHERE email_normalized='cas@example.com'").run(newSalt, v2Hash('New-pass-456!', newSalt));
      let oldLoginError = 'unexpected-success';
      try { await running; } catch (error) { oldLoginError = error instanceof Error ? (error as { code?: string }).code ?? error.message : String(error); }
      expect(['INVALID_CREDENTIALS', 'LOGIN_STATE_CONFLICT']).toContain(oldLoginError);
      // 新密码可登录；旧密码不得复活
      await expect(service.login({ email: 'cas@example.com', password: 'New-pass-456!' })).resolves.toBeTruthy();
      await expect(service.login({ email: 'cas@example.com', password: 'Old-pass-123!' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      const row = c.database.prepare("SELECT password_hash FROM user_accounts WHERE email_normalized='cas@example.com'").get() as { password_hash: string };
      expect(row.password_hash).toBe(v2Hash('New-pass-456!', newSalt));
    } finally { await app.close(); c.close(); }
  });

  it('升级登录：last_login_at落库、版本+1、二次登录成功（Codex探针upgradeLastLoginAt=null修复）', async () => {
    const c = createTestContext('cas-up-');
    try {
      seedLegacyAccount(c, 'upgrade@example.com', 'Old-pass-123!');
      const service = new IdentityService(c.database, false, c.config.ownerId);
      await service.login({ email: 'upgrade@example.com', password: 'Old-pass-123!' });
      const row = c.database.prepare("SELECT password_format, password_n, credential_version, last_login_at FROM user_accounts WHERE email_normalized='upgrade@example.com'").get() as { password_format: string; password_n: number; credential_version: number; last_login_at: string | null };
      expect(row.password_format).toBe('scrypt-v2');
      expect(row.password_n).toBe(32_768);
      expect(row.credential_version).toBe(1);
      expect(row.last_login_at).not.toBeNull();
      await expect(service.login({ email: 'upgrade@example.com', password: 'Old-pass-123!' })).resolves.toBeTruthy();
    } finally { c.close(); }
  });

  it('并发停用：异步派生期间停用 → 登录被拒且不签发任何会话', async () => {
    const c = createTestContext('cas-sus-');
    try {
      seedLegacyAccount(c, 'suspend@example.com', 'Old-pass-123!');
      const service = new IdentityService(c.database, false, c.config.ownerId);
      const running = service.login({ email: 'suspend@example.com', password: 'Old-pass-123!' });
      c.database.prepare("UPDATE user_accounts SET status='suspended' WHERE email_normalized='suspend@example.com'").run();
      await expect(running).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });
      expect((c.database.prepare("SELECT COUNT(*) n FROM auth_sessions s JOIN user_accounts a ON a.user_id=s.user_id WHERE a.email_normalized='suspend@example.com'").get() as { n: number }).n).toBe(0);
    } finally { c.close(); }
  });

  it('fail closed：不支持的凭据格式/参数拒绝登录并留审计，不降级到默认参数', async () => {
    const c = createTestContext('cas-fc-');
    try {
      seedLegacyAccount(c, 'broken@example.com', 'Old-pass-123!');
      const salt = randomBytes(16).toString('hex');
      c.database.prepare("UPDATE user_accounts SET password_format='scrypt-v2', password_n=999, password_r=8, password_p=3, password_salt=?, password_hash=? WHERE email_normalized='broken@example.com'").run(salt, v2Hash('x', salt));
      const service = new IdentityService(c.database, false, c.config.ownerId);
      await expect(service.login({ email: 'broken@example.com', password: 'Old-pass-123!' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      c.database.prepare("UPDATE user_accounts SET password_format='argon2id' WHERE email_normalized='broken@example.com'").run();
      await expect(service.login({ email: 'broken@example.com', password: 'Old-pass-123!' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect((c.database.prepare("SELECT COUNT(*) n FROM auth_audit_events WHERE event_type='login_failed' AND email_normalized='broken@example.com'").get() as { n: number }).n).toBeGreaterThanOrEqual(2);
    } finally { c.close(); }
  });

  it('改密与撤销其他会话（HTTP）：当前会话保留、其他会话失效、旧密码作废', async () => {
    const c = createTestContext('cas-chg-');
    const app = await createAppServer(c.config, c.database);
    try {
      const register = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS, payload: { email: 'chg@example.com', displayName: '改密用户', password: 'First-pass-123!' } });
      expect(register.statusCode).toBe(200);
      const secondLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { email: 'chg@example.com', password: 'First-pass-123!' } });
      const cookieA = String(register.headers['set-cookie']).split(';')[0]!;
      const cookieB = String(secondLogin.headers['set-cookie']).split(';')[0]!;
      const authed = { ...HEADERS, cookie: cookieA };

      // 错误当前密码 → 401
      expect((await app.inject({ method: 'POST', url: '/api/v1/auth/password/change', headers: authed, payload: { currentPassword: 'Wrong-pass-999!', nextPassword: 'Second-pass-456!' } })).statusCode).toBe(401);
      // 正确改密 → 撤销1个其他会话
      const change = await app.inject({ method: 'POST', url: '/api/v1/auth/password/change', headers: authed, payload: { currentPassword: 'First-pass-123!', nextPassword: 'Second-pass-456!' } });
      expect(change.statusCode).toBe(200);
      expect((change.json().data as { revokedSessions: number }).revokedSessions).toBe(1);
      // 当前会话仍有效；另一会话失效
      expect((await app.inject({ url: '/api/v1/auth/me', headers: authed })).statusCode).toBe(200);
      expect((await app.inject({ url: '/api/v1/auth/me', headers: { ...HEADERS, cookie: cookieB } })).statusCode).toBe(401);
      // 旧密码登录401、新密码登录200
      expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { email: 'chg@example.com', password: 'First-pass-123!' } })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { email: 'chg@example.com', password: 'Second-pass-456!' } })).statusCode).toBe(200);

      // 撤销其他会话：新开两个会话后revoke-others
      const loginC = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { email: 'chg@example.com', password: 'Second-pass-456!' } });
      const cookieC = String(loginC.headers['set-cookie']).split(';')[0]!;
      const loginD = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { email: 'chg@example.com', password: 'Second-pass-456!' } });
      const cookieD = String(loginD.headers['set-cookie']).split(';')[0]!;
      const revoke = await app.inject({ method: 'POST', url: '/api/v1/auth/sessions/revoke-others', headers: { ...HEADERS, cookie: cookieC }, payload: {} });
      expect(revoke.statusCode).toBe(200);
      expect((revoke.json().data as { revoked: number }).revoked).toBeGreaterThanOrEqual(1);
      expect((await app.inject({ url: '/api/v1/auth/me', headers: { ...HEADERS, cookie: cookieC } })).statusCode).toBe(200);
      expect((await app.inject({ url: '/api/v1/auth/me', headers: { ...HEADERS, cookie: cookieD } })).statusCode).toBe(401);
    } finally { await app.close(); c.close(); }
  });

  it('vendored身份域与rebuild原件parity：两方向哈希/验证/升级判定一致', async () => {
    const salt = randomBytes(16).toString('hex');
    const password = 'Parity-pass-123!';
    const v1 = vendored.legacyScryptRecord(salt, v1Hash(password, salt));
    const v2 = { format: 'scrypt-v2' as const, salt, hash: v2Hash(password, salt), n: 32_768, r: 8, p: 3, keyLength: 64 as const };
    for (const record of [v1, v2]) {
      expect(await rebuildPasswords.verifyPassword(password, record)).toBe(true);
      expect(await vendored.verifyPassword(password, record)).toBe(true);
      expect(await rebuildPasswords.verifyPassword('wrong-password', record)).toBe(false);
      expect(await vendored.verifyPassword('wrong-password', record)).toBe(false);
      expect(vendored.shouldUpgradePassword(record)).toBe(rebuildPasswords.shouldUpgradePassword(record));
    }
    // rebuild域可直接验证本工程新装/升级后的v2记录（存储格式对齐）
    const fresh = await vendored.hashVerifiedPassword(password);
    expect(await rebuildPasswords.verifyPassword(password, fresh)).toBe(true);
    // 生产运行时确实调用vendored域（而非旧内联实现）：入口源码引用identity域
    const appServerSource = readFileSync(resolve(process.cwd(), 'apps/api/src/http/app-server.ts'), 'utf8');
    expect(appServerSource).toContain("identity/identity-service.js");
  });
});
