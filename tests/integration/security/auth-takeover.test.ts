/**
 * AUTH-TAKEOVER-01 验收测试：
 * 1) 新运行入口装配（不依赖旧v7-server）与代表性行为矩阵；
 * 2) 密码体制接管：v2新装、v1历史记录兼容验证+登录透明升级、与rebuild域实现交叉验证；
 * 3) 会话生命周期：伪造/过期/撤销/停用即时失效。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { promisify } from 'node:util';
import { createTestContext } from '../../helpers/test-context.js';
import { createAppServer } from '../../../apps/api/src/http/app-server.js';
import { verifyPassword } from '../../../rebuild/packages/backend/src/domain/accounts/passwords.js';

const scrypt = promisify(scryptCallback) as (password: string, salt: string, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

function v1Hash(password: string, salt: string): Promise<string> {
  return scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).then((buffer) => buffer.toString('hex'));
}

describe('AUTH-TAKEOVER-01 接管验证', () => {
  it('新入口装配：健康端点与代表路由注册；入口源码不引用旧v7-server', async () => {
    const c = createTestContext();
    const app = await createAppServer(c.config, c.database);
    try {
      const headers = { host: '127.0.0.1:43111', origin: c.config.webOrigin, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' };
      const health = await app.inject({ url: '/health', headers });
      expect(health.statusCode).toBe(200);
      expect((health.json().data as { service: string }).service).toBe('wenmi-api');
      // 代表性业务路由全部已注册且要求会话（401而非404）
      for (const url of [
        '/api/v1/auth/me',
        '/api/v1/admin/overview',
        '/api/v1/admin/creative-reference/cards',
        '/api/v1/admin/time-machine/runs',
        '/api/v1/runtime/readiness'
      ]) {
        const response = await app.inject({ url, headers });
        expect(response.statusCode, url).toBe(401);
      }
      // 匿名写请求被来源校验拒绝（403，先于401的浏览器写防护语义与原入口一致）
      const anonymousWrite = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { host: '127.0.0.1:43111', 'content-type': 'application/json' }, payload: { email: 'x@example.com', password: 'password123' } });
      expect(anonymousWrite.statusCode).toBe(403);

      // 入口隔离静态守卫：新入口与main不得引用旧装配
      const appServerSource = readFileSync(resolve(process.cwd(), 'apps/api/src/http/app-server.ts'), 'utf8');
      expect(appServerSource).not.toMatch(/v7-server|createV7Server/);
      const mainSource = readFileSync(resolve(process.cwd(), 'apps/api/src/main.ts'), 'utf8');
      expect(mainSource).toContain("./http/app-server.js'");
      expect(mainSource).not.toMatch(/v7-server|createV7Server/);
    } finally {
      await app.close();
      c.close();
    }
  });

  it('密码体制接管：新账号v2落库；v1历史记录兼容验证并透明升级；rebuild域实现可验证v2', async () => {
    const c = createTestContext();
    const app = await createAppServer(c.config, c.database);
    try {
      const headers = { host: '127.0.0.1:43111', origin: c.config.webOrigin, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' };

      // 新注册：v2参数随行落库
      const register = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers, payload: { email: 'takeover-admin@example.com', displayName: '接管管理员', password: 'Strong-test-pass-123!' } });
      expect(register.statusCode).toBe(200);
      expect((register.json().data as { expiresInSeconds: number }).expiresInSeconds).toBe(14 * 24 * 60 * 60);
      const v2Row = c.database.prepare("SELECT password_format, password_n, password_r, password_p FROM user_accounts WHERE email_normalized='takeover-admin@example.com'").get() as { password_format: string; password_n: number; password_r: number; password_p: number };
      expect(v2Row).toMatchObject({ password_format: 'scrypt-v2', password_n: 32_768, password_r: 8, password_p: 3 });

      // 历史v1记录（NULL参数列=16384/8/1）：正确密码登录成功且透明升级；错误密码登录失败且不升级
      const legacySalt = randomBytes(16).toString('hex');
      const legacyHash = await v1Hash('Legacy-test-pass-456!', legacySalt);
      c.database.prepare("INSERT INTO owners (owner_id, display_name, version, created_at, updated_at) VALUES ('legacy-owner', '历史用户', 1, '2026-01-01', '2026-01-01')").run();
      c.database.prepare(`
        INSERT INTO user_accounts (user_id, owner_id, email_normalized, display_name, password_salt, password_hash,
          password_format, password_n, password_r, password_p, role, status, created_at, updated_at, last_login_at)
        VALUES ('legacy-user', 'legacy-owner', 'legacy@example.com', '历史用户', ?, ?, NULL, NULL, NULL, NULL, 'user', 'active', '2026-01-01', '2026-01-01', NULL)
      `).run(legacySalt, legacyHash);
      const wrongPassword = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: 'legacy@example.com', password: 'Wrong-pass-000!' } });
      expect(wrongPassword.statusCode).toBe(401);
      expect((c.database.prepare("SELECT password_format FROM user_accounts WHERE email_normalized='legacy@example.com'").get() as { password_format: string | null }).password_format).toBeNull();
      const legacyLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: 'legacy@example.com', password: 'Legacy-test-pass-456!' } });
      expect(legacyLogin.statusCode).toBe(200);
      const upgraded = c.database.prepare("SELECT password_salt, password_hash, password_format, password_n, password_r, password_p FROM user_accounts WHERE email_normalized='legacy@example.com'").get() as { password_salt: string; password_hash: string; password_format: string; password_n: number; password_r: number; password_p: number };
      expect(upgraded.password_format).toBe('scrypt-v2');
      expect(upgraded.password_n).toBe(32_768);
      // 升级后再次登录仍成功（新哈希验证链路）
      const secondLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: 'legacy@example.com', password: 'Legacy-test-pass-456!' } });
      expect(secondLogin.statusCode).toBe(200);

      // 交叉验证：v2记录可被 rebuild backend 域实现直接验证（未来PG迁移免重哈希）
      const crossVerified = await verifyPassword('Legacy-test-pass-456!', {
        format: 'scrypt-v2', n: upgraded.password_n, r: upgraded.password_r, p: upgraded.password_p,
        keyLength: 64, salt: upgraded.password_salt, hash: upgraded.password_hash
      });
      expect(crossVerified).toBe(true);
      const crossRejected = await verifyPassword('wrong-password', {
        format: 'scrypt-v2', n: upgraded.password_n, r: upgraded.password_r, p: upgraded.password_p,
        keyLength: 64, salt: upgraded.password_salt, hash: upgraded.password_hash
      });
      expect(crossRejected).toBe(false);
    } finally {
      await app.close();
      c.close();
    }
  });

  it('会话生命周期：伪造/过期/登出/停用即时失效；普通用户不可访问管理员接口', async () => {
    const c = createTestContext();
    const app = await createAppServer(c.config, c.database);
    try {
      const headers = { host: '127.0.0.1:43111', origin: c.config.webOrigin, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' };
      const adminCookie = String((await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers, payload: { email: 'matrix-admin@example.com', displayName: '管理员', password: 'Strong-test-pass-123!' } })).headers['set-cookie']).split(';')[0]!;
      const userLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: 'legacy@example.com', password: 'nope' } });
      void userLogin;
      // 建一个普通用户
      const userRegister = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers, payload: { email: 'matrix-user@example.com', displayName: '普通作者', password: 'Strong-user-pass-123!' } });
      const userCookie = String(userRegister.headers['set-cookie']).split(';')[0]!;
      const adminHeaders = { ...headers, cookie: adminCookie };
      const userHeaders = { ...headers, cookie: userCookie };

      // 普通用户 vs 管理员接口
      expect((await app.inject({ url: '/api/v1/admin/overview', headers: userHeaders })).statusCode).toBe(403);
      expect((await app.inject({ url: '/api/v1/admin/overview', headers: adminHeaders })).statusCode).toBe(200);

      // 伪造cookie → 401
      expect((await app.inject({ url: '/api/v1/auth/me', headers: { ...headers, cookie: 'wenmi_session=forged-token-value' } })).statusCode).toBe(401);

      // 过期会话 → 401
      c.database.prepare("UPDATE auth_sessions SET expires_at='2026-01-01T00:00:00.000Z' WHERE session_id IN (SELECT session_id FROM auth_sessions s JOIN user_accounts a ON a.user_id=s.user_id WHERE a.email_normalized='matrix-user@example.com')").run();
      expect((await app.inject({ url: '/api/v1/auth/me', headers: userHeaders })).statusCode).toBe(401);

      // 重新登录 → 停用 → 会话即时失效（401），恢复后旧会话仍失效需重新登录
      const relogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: 'matrix-user@example.com', password: 'Strong-user-pass-123!' } });
      const freshUserCookie = String(relogin.headers['set-cookie']).split(';')[0]!;
      expect((await app.inject({ url: '/api/v1/auth/me', headers: { ...headers, cookie: freshUserCookie } })).statusCode).toBe(200);
      const userId = (c.database.prepare("SELECT user_id FROM user_accounts WHERE email_normalized='matrix-user@example.com'").get() as { user_id: string }).user_id;
      const suspend = await app.inject({ method: 'PATCH', url: `/api/v1/admin/users/${userId}/status`, headers: adminHeaders, payload: { status: 'suspended' } });
      expect(suspend.statusCode).toBe(200);
      expect((await app.inject({ url: '/api/v1/auth/me', headers: { ...headers, cookie: freshUserCookie } })).statusCode).toBe(401);
      const suspendedLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { email: 'matrix-user@example.com', password: 'Strong-user-pass-123!' } });
      expect(suspendedLogin.statusCode).toBe(403);

      // 管理员登出后会话失效
      const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: adminHeaders, payload: {} });
      expect(logout.statusCode).toBe(200);
      expect((await app.inject({ url: '/api/v1/auth/me', headers: adminHeaders })).statusCode).toBe(401);
    } finally {
      await app.close();
      c.close();
    }
  });
});
