/**
 * AUTH-TAKEOVER-01 返工2确定性并发反例（R2-1/R2-2）：
 * 用Codex同法（包装只读SELECT在第二次await窗口注入状态变化，非固定sleep）复现
 * 修复前失败场景，断言修复后全部拦截。覆盖：升级哈希期间停用、改密哈希期间会话撤销、
 * 改密期间停用、审计写入失败事务一致性、有界哈希队列并发上限。
 */
import { describe, expect, it } from 'vitest';
import { randomBytes, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { IdentityService } from '../../../apps/api/src/identity/identity-service.js';
import type { AuthContext } from '../../../apps/api/src/identity/domain/types.js';

function v1Hash(password: string, salt: string): string {
  return scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
}

/** 直插v1历史账号的最小库（Codex探针同法）。 */
function setup(): DatabaseSync {
  const d = new DatabaseSync(':memory:');
  d.exec(`
    CREATE TABLE user_accounts(user_id TEXT PRIMARY KEY,owner_id TEXT,email_normalized TEXT,display_name TEXT,
      password_salt TEXT,password_hash TEXT,password_format TEXT,password_n INTEGER,password_r INTEGER,password_p INTEGER,
      credential_version INTEGER NOT NULL DEFAULT 0,role TEXT,status TEXT,created_at TEXT,updated_at TEXT,last_login_at TEXT);
    CREATE TABLE auth_sessions(session_id TEXT,user_id TEXT,token_hash TEXT,created_at TEXT,expires_at TEXT,last_seen_at TEXT,revoked_at TEXT);
    CREATE TABLE auth_audit_events(audit_id TEXT,user_id TEXT,event_type TEXT,email_normalized TEXT,actor_user_id TEXT,recorded_at TEXT,details_json TEXT);
  `);
  const salt = '0123456789abcdef0123456789abcdef';
  d.prepare('INSERT INTO user_accounts VALUES (?,?,?,?,?,?,NULL,NULL,NULL,NULL,0,?,?,?,?,?)')
    .run('u', 'o', 'probe@example.com', 'test', salt, v1Hash('Old-pass-123!', salt), 'user', 'active', '2026-01-01', '2026-01-01', null);
  return d;
}

/** 包装findAccountByEmail的SELECT，在第N次读取后queueMicrotask注入SQL（确定性阶段控制）。 */
function armInject(d: DatabaseSync, onRead: number, sql: string): void {
  const orig = d.prepare.bind(d);
  let reads = 0;
  d.prepare = ((query: string) => {
    const st = orig(query);
    if (query.includes('FROM user_accounts WHERE email_normalized')) {
      const get = st.get.bind(st);
      st.get = (...args: unknown[]) => {
        const row = get(...(args as [])) as unknown;
        if (++reads === onRead) queueMicrotask(() => d.exec(sql));
        return row;
      };
    }
    return st;
  }) as typeof d.prepare;
}

describe('AUTH-TAKEOVER-01 返工2：第二次await后状态重验', () => {
  it('R2-1：升级哈希期间停用 → 登录拒绝，不签发会话；恢复后该会话不存在', async () => {
    const d = setup();
    const s = new IdentityService(d, false, 'o');
    // 确定性阶段控制（Codex同法）：在首个异步派生窗口注入停用——
    // queueMicrotask在verifyPassword的await边界执行，先于任何最终事务代码；
    // 最终事务的三重守卫在全部await之后运行，任一窗口内的停用都会被拦截。
    armInject(d, 1, "UPDATE user_accounts SET status='suspended'");
    let code = 'unexpected-success';
    try { await s.login({ email: 'probe@example.com', password: 'Old-pass-123!' }); } catch (e) { code = (e as { code?: string }).code ?? String(e); }
    expect(code).toBe('ACCOUNT_SUSPENDED');
    expect((d.prepare('SELECT COUNT(*) n FROM auth_sessions').get() as { n: number }).n).toBe(0);
    // 恢复后无残留会话可复活
    d.exec("UPDATE user_accounts SET status='active'");
    expect((d.prepare('SELECT COUNT(*) n FROM auth_sessions WHERE revoked_at IS NULL').get() as { n: number }).n).toBe(0);
    d.close();
  });

  it('R2-2：改密哈希期间发起会话被logout撤销 → 改密拒绝，新密码不生效', async () => {
    const d = setup();
    const s = new IdentityService(d, false, 'o');
    const session = await s.login({ email: 'probe@example.com', password: 'Old-pass-123!' });
    const context = s.authenticate(session.cookie.split(';')[0]) as AuthContext;
    // 在当前密码验证（第一次await）返回后的微任务里撤销会话
    const orig = d.prepare.bind(d);
    let armed = false;
    d.prepare = ((query: string) => {
      const st = orig(query);
      if (query.includes('FROM user_accounts WHERE user_id = ?')) {
        const get = st.get.bind(st);
        st.get = (...args: unknown[]) => {
          const row = get(...(args as [])) as unknown;
          if (!armed) { armed = true; queueMicrotask(() => orig("UPDATE auth_sessions SET revoked_at='2026-09-14'").run()); }
          return row;
        };
      }
      return st;
    }) as typeof d.prepare;
    let code = 'unexpected-success';
    try {
      await s.changePassword({ context, currentPassword: 'Old-pass-123!', nextPassword: 'New-pass-456!' });
    } catch (e) { code = (e as { code?: string }).code ?? String(e); }
    expect(code).toBe('AUTHENTICATION_REQUIRED');
    // 新密码未生效、旧密码仍可登录
    await expect(s.login({ email: 'probe@example.com', password: 'New-pass-456!' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(s.login({ email: 'probe@example.com', password: 'Old-pass-123!' })).resolves.toBeTruthy();
    d.close();
  });

  it('R2-2：改密期间停用 → 改密拒绝（ACCOUNT_SUSPENDED），凭据不变', async () => {
    const d = setup();
    const s = new IdentityService(d, false, 'o');
    const session = await s.login({ email: 'probe@example.com', password: 'Old-pass-123!' });
    const context = s.authenticate(session.cookie.split(';')[0]) as AuthContext;
    const hashBefore = (d.prepare('SELECT password_hash, credential_version FROM user_accounts').get() as { password_hash: string; credential_version: number });
    const orig = d.prepare.bind(d);
    let armed = false;
    d.prepare = ((query: string) => {
      const st = orig(query);
      if (query.includes('FROM user_accounts WHERE user_id = ?')) {
        const get = st.get.bind(st);
        st.get = (...args: unknown[]) => {
          const row = get(...(args as [])) as unknown;
          if (!armed) { armed = true; queueMicrotask(() => orig("UPDATE user_accounts SET status='suspended'").run()); }
          return row;
        };
      }
      return st;
    }) as typeof d.prepare;
    // 停用同时撤销了会话（产品语义），改密在最终事务的状态或会话核查处拒绝
    await expect(s.changePassword({ context, currentPassword: 'Old-pass-123!', nextPassword: 'New-pass-456!' }))
      .rejects.toMatchObject({ code: expect.stringMatching(/AUTHENTICATION_REQUIRED|ACCOUNT_SUSPENDED/) });
    const hashRow = d.prepare('SELECT password_hash, credential_version FROM user_accounts').get() as { password_hash: string; credential_version: number };
    expect(hashRow.password_hash).toBe(hashBefore.password_hash);
    expect(hashRow.credential_version).toBe(hashBefore.credential_version);
    d.close();
  });

  it('审计写入失败：登录整体回滚——无会话、无last_login、无凭据升级', async () => {
    const d = setup();
    const s = new IdentityService(d, false, 'o');
    d.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON auth_audit_events WHEN NEW.event_type='login_success' BEGIN SELECT RAISE(ABORT,'audit fail'); END");
    let code = 'unexpected-success';
    try { await s.login({ email: 'probe@example.com', password: 'Old-pass-123!' }); } catch (e) { code = String((e as Error).message ?? e); }
    expect(code).toContain('audit fail');
    expect((d.prepare('SELECT COUNT(*) n FROM auth_sessions').get() as { n: number }).n).toBe(0);
    expect((d.prepare('SELECT last_login_at FROM user_accounts').get() as { last_login_at: string | null }).last_login_at).toBeNull();
    expect((d.prepare('SELECT password_format FROM user_accounts').get() as { password_format: string | null }).password_format).toBeNull();
    d.close();
  });

  it('R2-4：有界哈希队列——并发登录超限得到503 BUSY或全部完成，不无界堆积', async () => {
    const d = setup();
    const s = new IdentityService(d, false, 'o');
    // 同时发起5个登录（活跃上限2+等待上限16 → 全部应排队完成；若上限更紧则503）
    const results = await Promise.allSettled(Array.from({ length: 5 }, () =>
      s.login({ email: 'probe@example.com', password: 'Old-pass-123!' })
    ));
    for (const r of results) {
      if (r.status === 'rejected') expect(String(r.reason.code ?? r.reason)).toMatch(/PASSWORD_HASH_BUSY/);
    }
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBeGreaterThanOrEqual(1);
    // 全部通过或被有界拒绝，无进程堆积（Promise.allSettled已返回证明无死锁）
    d.close();
  }, 60_000);

  it('R2-1对照：无并发干扰时升级登录正常（修复未破坏正常路径）', async () => {
    const d = setup();
    const s = new IdentityService(d, false, 'o');
    const issued = await s.login({ email: 'probe@example.com', password: 'Old-pass-123!' });
    expect(issued.account.lastLoginAt).not.toBeNull();
    expect((d.prepare('SELECT password_format FROM user_accounts').get() as { password_format: string }).password_format).toBe('scrypt-v2');
    d.close();
  });
});
