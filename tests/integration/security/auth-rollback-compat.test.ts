/**
 * AUTH-TAKEOVER-01 返工1：回滚兼容演练。
 * 场景：库中存在 v1历史 / 已升级v2 / 新装v2 混合账号与既有会话；
 * 用独立子进程（模拟回滚兼容构建重启后新进程）打开同一库文件：
 * 三类账号全部可登录、升级不丢last_login、既有会话仍有效、owner/权益行完整。
 * 回滚策略：回滚目标=本分支兼容构建（读双格式+含0125迁移），不回退旧v1-only构建。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';
import { IdentityService } from '../../../apps/api/src/identity/identity-service.js';
import { grantDefaultBronze } from '../../../apps/api/src/infrastructure/security/membership-service.js';

const MIGRATIONS_DIR = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
const WORKER = resolve(process.cwd(), 'tests/fixtures/auth/rollback-worker.mts');

function v1Hash(password: string, salt: string): string {
  return scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
}
function seedLegacy(db: DatabaseSync, email: string, password: string): void {
  const salt = randomBytes(16).toString('hex');
  db.prepare("INSERT INTO owners (owner_id, display_name, version, created_at, updated_at) VALUES (?, '回滚历史', 1, '2026-01-01', '2026-01-01')").run(`owner-${email}`);
  db.prepare(`
    INSERT INTO user_accounts (user_id, owner_id, email_normalized, display_name, password_salt, password_hash,
      password_format, password_n, password_r, password_p, credential_version, role, status, created_at, updated_at, last_login_at)
    VALUES (?, ?, ?, '回滚历史', ?, ?, NULL, NULL, NULL, NULL, 0, 'user', 'active', '2026-01-01', '2026-01-01', NULL)
  `).run(`user-${email}`, `owner-${email}`, email, salt, v1Hash(password, salt));
  grantDefaultBronze(db, `user-${email}`, `owner-${email}`, '2026-01-01');
}

describe('AUTH-TAKEOVER-01 回滚兼容演练', () => {
  it('混合凭据+既有会话：新进程全部可登录，账号/owner/权益/会话无丢失', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'auth-rollback-'));
    const dbPath = resolve(root, 'wenmi.sqlite');
    try {
      const db = new DatabaseSync(dbPath);
      runMigrations(db, MIGRATIONS_DIR);
      // 新装v2（走正式注册：owner+bronze）
      const service = new IdentityService(db, false, 'rollback-legacy-owner');
      await service.register({ email: 'rollback-fresh@example.com', password: 'Fresh-roll-123!', displayName: '新装用户' });
      // v1历史 + 登录升级为v2
      seedLegacy(db, 'rollback-upgraded@example.com', 'Upgrade-roll-123!');
      await service.login({ email: 'rollback-upgraded@example.com', password: 'Upgrade-roll-123!' });
      // v1历史（未登录过，保持v1）
      seedLegacy(db, 'rollback-legacy@example.com', 'Legacy-roll-123!');
      // 既有会话：给升级账号再签一个会话，取cookie供子进程验证
      const session = await service.login({ email: 'rollback-upgraded@example.com', password: 'Upgrade-roll-123!' });
      const cookieHeader = session.cookie.split(';')[0]!;
      const before = {
        accounts: (db.prepare('SELECT COUNT(*) n FROM user_accounts').get() as { n: number }).n,
        owners: (db.prepare('SELECT COUNT(*) n FROM owners').get() as { n: number }).n,
        memberships: (db.prepare('SELECT COUNT(*) n FROM user_memberships').get() as { n: number }).n,
        sessions: (db.prepare('SELECT COUNT(*) n FROM auth_sessions').get() as { n: number }).n,
        upgradedLastLogin: (db.prepare("SELECT last_login_at FROM user_accounts WHERE email_normalized='rollback-upgraded@example.com'").get() as { last_login_at: string | null }).last_login_at
      };
      expect(before.accounts).toBe(3);
      expect(before.owners).toBe(3);
      // 首位注册=admin不发会员；两历史账号各一份青铜 → 2。
      expect(before.memberships).toBe(2);
      expect(before.upgradedLastLogin).not.toBeNull();
      db.close();

      // 独立子进程（新进程启动）：三类账号登录 + 既有会话认证
      const child = spawn(process.execPath, ['--import', 'tsx', WORKER, dbPath, cookieHeader], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => { out += String(chunk); });
      child.stderr.on('data', (chunk) => { err += String(chunk); });
      const exit = await new Promise<number>((resolveExit) => child.on('exit', (code) => resolveExit(code ?? -1)));
      const line = out.trim().split('\n').pop() ?? '';
      const result = JSON.parse(line) as { logins: Record<string, string>; legacySessionValid: boolean | null };
      expect(result.logins.legacyV1, `worker stderr: ${err}`).toBe('ok');
      expect(result.logins.upgradedV2).toBe('ok');
      expect(result.logins.freshV2).toBe('ok');
      expect(result.legacySessionValid).toBe(true);
      expect(exit).toBe(0);

      // 子进程登录后数据仍完整（新登录只增会话行，不改账号/owner/权益）
      const reopen = new DatabaseSync(dbPath);
      const after = {
        accounts: (reopen.prepare('SELECT COUNT(*) n FROM user_accounts').get() as { n: number }).n,
        owners: (reopen.prepare('SELECT COUNT(*) n FROM owners').get() as { n: number }).n,
        memberships: (reopen.prepare('SELECT COUNT(*) n FROM user_memberships').get() as { n: number }).n
      };
      reopen.close();
      expect(after.accounts).toBe(before.accounts);
      expect(after.owners).toBe(before.owners);
      expect(after.memberships).toBe(before.memberships);
    } finally {
      try { rmSync(root, { force: true, recursive: true }); } catch { /* Windows句柄释放滞后，残留临时目录由系统清理 */ }
    }
  }, 120_000);
});
