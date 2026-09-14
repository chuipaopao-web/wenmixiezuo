/**
 * AUTH-TAKEOVER-01 返工3（R3-1）：失败安全审计持久化。
 * 使用完整迁移库（真实表结构含CHECK约束），通过HTTP API走真实路由：
 * 错误登录后login_failed恰好+1且无副作用；错误改密后password_change_failed恰好+1且密码/版本/会话不变；
 * 正确路径成功审计原子；审计写入失败时不提交成功身份变化。
 */
import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../helpers/test-context.js';
import { createAppServer } from '../../../apps/api/src/http/app-server.js';

const HEADERS = { host: '127.0.0.1:43111', origin: 'http://127.0.0.1:43110', 'sec-fetch-site': 'same-site', 'content-type': 'application/json' };

interface AuditRow { event_type: string; user_id: string | null; email_normalized: string | null; details_json: string }

function auditCount(c: ReturnType<typeof createTestContext>, type: string): number {
  return (c.database.prepare('SELECT COUNT(*) n FROM auth_audit_events WHERE event_type=?').get(type) as { n: number }).n;
}
function auditRows(c: ReturnType<typeof createTestContext>, type: string): AuditRow[] {
  return c.database.prepare('SELECT event_type, user_id, email_normalized, details_json FROM auth_audit_events WHERE event_type=? ORDER BY recorded_at').all(type) as AuditRow[];
}
function accountRow(c: ReturnType<typeof createTestContext>, email: string): { password_hash: string; credential_version: number; last_login_at: string | null } {
  return c.database.prepare('SELECT password_hash, credential_version, last_login_at FROM user_accounts WHERE email_normalized=?').get(email) as { password_hash: string; credential_version: number; last_login_at: string | null };
}
function sessionCount(c: ReturnType<typeof createTestContext>, email: string): number {
  return (c.database.prepare('SELECT COUNT(*) n FROM auth_sessions s JOIN user_accounts a ON a.user_id=s.user_id WHERE a.email_normalized=?').get(email) as { n: number }).n;
}

describe('AUTH-TAKEOVER-01 返工3：失败审计持久化（完整迁移库）', () => {
  it('错误登录：login_failed恰好+1，无会话/升级/last_login副作用；不含明文密码', async () => {
    const c = createTestContext('r3-login-');
    const app = await createAppServer(c.config, c.database);
    try {
      const register = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS, payload: { email: 'r3-login@example.com', displayName: '用户', password: 'Correct-pass-123!' } });
      expect(register.statusCode).toBe(200);
      const before = accountRow(c, 'r3-login@example.com');
      const beforeSessions = sessionCount(c, 'r3-login@example.com');
      const beforeAudit = auditCount(c, 'login_failed');

      const wrong = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { email: 'r3-login@example.com', password: 'Wrong-pass-456!' } });
      expect(wrong.statusCode).toBe(401);

      // 失败审计恰好+1且持久化
      expect(auditCount(c, 'login_failed')).toBe(beforeAudit + 1);
      const rows = auditRows(c, 'login_failed');
      const last = rows[rows.length - 1]!;
      expect(last.email_normalized).toBe('r3-login@example.com');
      expect(last.user_id).not.toBeNull();
      // 不含明文密码/token/cookie
      const serialized = JSON.stringify(rows);
      expect(serialized).not.toContain('Wrong-pass-456!');
      expect(serialized).not.toContain('Correct-pass-123!');

      // 无副作用：密码哈希/版本/last_login/会话数不变
      const after = accountRow(c, 'r3-login@example.com');
      expect(after.password_hash).toBe(before.password_hash);
      expect(after.credential_version).toBe(before.credential_version);
      expect(after.last_login_at).toBe(before.last_login_at);
      expect(sessionCount(c, 'r3-login@example.com')).toBe(beforeSessions);
    } finally { await app.close(); c.close(); }
  });

  it('错误改密：password_change_failed恰好+1，密码/版本/会话不变', async () => {
    const c = createTestContext('r3-chg-');
    const app = await createAppServer(c.config, c.database);
    try {
      const register = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS, payload: { email: 'r3-chg@example.com', displayName: '用户', password: 'First-pass-123!' } });
      const cookie = String(register.headers['set-cookie']).split(';')[0]!;
      const before = accountRow(c, 'r3-chg@example.com');
      const beforeSessions = sessionCount(c, 'r3-chg@example.com');
      const beforeAudit = auditCount(c, 'password_change_failed');

      const wrong = await app.inject({ method: 'POST', url: '/api/v1/auth/password/change', headers: { ...HEADERS, cookie }, payload: { currentPassword: 'Wrong-current-99!', nextPassword: 'New-pass-456!' } });
      expect(wrong.statusCode).toBe(401);

      expect(auditCount(c, 'password_change_failed')).toBe(beforeAudit + 1);
      const rows = auditRows(c, 'password_change_failed');
      const serialized = JSON.stringify(rows);
      expect(serialized).not.toContain('Wrong-current-99!');
      expect(serialized).not.toContain('First-pass-123!');

      const after = accountRow(c, 'r3-chg@example.com');
      expect(after.password_hash).toBe(before.password_hash);
      expect(after.credential_version).toBe(before.credential_version);
      expect(sessionCount(c, 'r3-chg@example.com')).toBe(beforeSessions);
    } finally { await app.close(); c.close(); }
  });

  it('正确登录：login_success审计与last_login/会话签发原子（成功路径不受影响）', async () => {
    const c = createTestContext('r3-ok-');
    const app = await createAppServer(c.config, c.database);
    try {
      await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS, payload: { email: 'r3-ok@example.com', displayName: '用户', password: 'Good-pass-123!' } });
      const before = auditCount(c, 'login_success');
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { email: 'r3-ok@example.com', password: 'Good-pass-123!' } });
      expect(login.statusCode).toBe(200);
      expect(auditCount(c, 'login_success')).toBe(before + 1);
      expect(accountRow(c, 'r3-ok@example.com').last_login_at).not.toBeNull();
      expect(sessionCount(c, 'r3-ok@example.com')).toBeGreaterThanOrEqual(2);
    } finally { await app.close(); c.close(); }
  });

  it('审计写入失败：登录整体不提交——无会话/无last_login/无升级（成功审计失败=整体回滚）', async () => {
    const c = createTestContext('r3-auditfail-');
    const app = await createAppServer(c.config, c.database);
    try {
      await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS, payload: { email: 'r3-af@example.com', displayName: '用户', password: 'Good-pass-123!' } });
      const before = accountRow(c, 'r3-af@example.com');
      const beforeSessions = sessionCount(c, 'r3-af@example.com');

      // 让login_success审计写入失败（触发器），验证整体回滚
      c.database.exec("CREATE TRIGGER r3_fail_success BEFORE INSERT ON auth_audit_events WHEN NEW.event_type='login_success' BEGIN SELECT RAISE(ABORT,'r3 audit fail'); END");
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { email: 'r3-af@example.com', password: 'Good-pass-123!' } });
      expect(login.statusCode).toBeGreaterThanOrEqual(500);

      const after = accountRow(c, 'r3-af@example.com');
      expect(after.last_login_at).toBe(before.last_login_at);
      expect(sessionCount(c, 'r3-af@example.com')).toBe(beforeSessions);
      c.database.exec('DROP TRIGGER r3_fail_success');
    } finally { await app.close(); c.close(); }
  });

  it('错误登录重试3次：每次恰好+1条login_failed（合计3），失败审计不遗漏不重复', async () => {
    const c = createTestContext('r3-multi-');
    const app = await createAppServer(c.config, c.database);
    try {
      await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS, payload: { email: 'r3-multi@example.com', displayName: '用户', password: 'Good-pass-123!' } });
      const before = auditCount(c, 'login_failed');
      for (let i = 0; i < 3; i += 1) {
        const wrong = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { email: 'r3-multi@example.com', password: `Wrong-${i}-pass-999!` } });
        expect(wrong.statusCode).toBe(401);
      }
      expect(auditCount(c, 'login_failed')).toBe(before + 3);
      const serialized = JSON.stringify(auditRows(c, 'login_failed'));
      expect(serialized).not.toContain('Wrong-0-pass-999!');
      expect(serialized).not.toContain('Wrong-1-pass-999!');
      expect(serialized).not.toContain('Wrong-2-pass-999!');
    } finally { await app.close(); c.close(); }
  });
});
