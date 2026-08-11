import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../../apps/api/src/infrastructure/db/database.js';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('首位管理员接管账号体系启用前的本机数据', () => {
  it('44版迁移只重绑唯一空管理员并完整保留旧书与会话', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'wenmi-admin-adoption-'));
    temporaryDirectories.push(root);
    const stagedMigrations = resolve(root, 'migrations-through-0043');
    mkdirSync(stagedMigrations);
    const migrations = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql') && name < '0044_first_admin_legacy_owner.sql')) {
      copyFileSync(resolve(migrations, file), resolve(stagedMigrations, file));
    }

    const database = openDatabase(resolve(root, 'wenmi.sqlite'));
    try {
      runMigrations(database, stagedMigrations);
      const now = '2026-08-11T00:00:00.000Z';
      database.prepare(`
        INSERT INTO owners (owner_id, display_name, version, created_at, updated_at)
        VALUES ('owner-local-boss', '老板', 1, ?, ?),
               ('empty-admin-owner', '管理员', 1, ?, ?)
      `).run(now, now, now, now);
      database.prepare(`
        INSERT INTO books (
          book_id, owner_id, title, status, version, positioning_version,
          canon_revision, editor_epoch, created_at, updated_at
        ) VALUES ('legacy-book', 'owner-local-boss', '原本机书籍', 'active', 1, 0, 0, 0, ?, ?)
      `).run(now, now);
      database.prepare(`
        INSERT INTO user_accounts (
          user_id, owner_id, email_normalized, display_name, password_salt, password_hash,
          role, status, created_at, updated_at, last_login_at
        ) VALUES ('admin-user', 'empty-admin-owner', 'boss@example.com', '管理员',
          'salt', 'hash', 'admin', 'active', ?, ?, ?)
      `).run(now, now, now);
      database.prepare(`
        INSERT INTO auth_sessions (
          session_id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at
        ) VALUES ('session-1', 'admin-user', ?, ?, '2026-08-25T00:00:00.000Z', ?, NULL)
      `).run('a'.repeat(64), now, now);

      const bookBefore = database.prepare('SELECT * FROM books WHERE book_id = ?').get('legacy-book');
      const upgraded = runMigrations(database, migrations);

      expect(upgraded.applied).toEqual(['0044_first_admin_legacy_owner.sql']);
      expect(database.prepare('SELECT owner_id FROM user_accounts WHERE user_id = ?').get('admin-user'))
        .toEqual({ owner_id: 'owner-local-boss' });
      expect(database.prepare('SELECT * FROM books WHERE book_id = ?').get('legacy-book')).toEqual(bookBefore);
      expect(database.prepare('SELECT user_id, revoked_at FROM auth_sessions WHERE session_id = ?').get('session-1'))
        .toEqual({ user_id: 'admin-user', revoked_at: null });
      expect(database.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(runMigrations(database, migrations).applied).toEqual([]);
    } finally {
      database.close();
    }
  });
});
