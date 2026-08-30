import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/server.js';
import { BackupService } from '../../../apps/api/src/infrastructure/recovery/backup-service.js';
import {
  applyCleanCutoverReset,
  prepareCleanCutoverFileBackup,
  previewCleanCutover,
  resumeCleanCutoverFiles,
  type CleanCutoverPreview
} from '../../../scripts/evaluation/v7-clean-cutover-reset.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';

const HEADERS = {
  host: '127.0.0.1:43111',
  origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site',
  'content-type': 'application/json'
};
const CUTOVER_NOW = new Date('2026-08-30T00:00:00.000Z');

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('V7 干净切换数据清理', () => {
  it('拒绝缺失备份、错误首次确认和不匹配的第二次确认', async () => {
    context = createTestContext('wenmi-v7-clean-cutover-gates-');
    await seedAccounts(context);
    seedBookAndUsage(context);
    const cutoverPreview = preview(context);
    const base = {
      dataDir: context.dataDir,
      expectedPreviewId: cutoverPreview.previewId,
      confirmation: 'YES',
      secondConfirmation: `CONFIRM:${cutoverPreview.previewId}`,
      backupId: 'backup-missing'
    };
    expect(() => applyCleanCutoverReset(context!.database, { ...base, confirmation: 'yes' }))
      .toThrow('精确输入 YES');
    expect(() => applyCleanCutoverReset(context!.database, { ...base, secondConfirmation: 'CONFIRM:old-preview' }))
      .toThrow('影响预览不匹配');
    expect(() => applyCleanCutoverReset(context!.database, base))
      .toThrow('已完成恢复验证的备份');
    expect(count(context.database, 'books')).toBe(1);
  });

  it('清空书籍、历史用量及不可变工作流记录，真实计数并逐行保留账号、会话、会员与配置', async () => {
    context = createTestContext('wenmi-v7-clean-cutover-success-');
    await seedAccounts(context);
    context.database.prepare(`INSERT INTO platform_model_scheme (
      scheme_id, profiles_json, updated_by_user_id, updated_at
    ) VALUES ('scheme-preserved', '{}', NULL, '2026-08-30T00:00:00.000Z')`).run();
    const ownerId = seedBookAndUsage(context);
    seedImmutableTaskContract(context, ownerId);
    expect(() => context!.database.prepare("DELETE FROM v7_task_contracts WHERE contract_id='contract-old'").run())
      .toThrow();
    const before = preview(context);
    const backup = createVerifiedBackup(context, before);
    expect(backup.restoredBooks).toBe(1);
    const result = applyCleanCutoverReset(context.database, {
      dataDir: context.dataDir,
      expectedPreviewId: before.previewId,
      confirmation: 'YES',
      secondConfirmation: `CONFIRM:${before.previewId}`,
      backupId: backup.backupId,
      now: new Date('2026-08-30T00:00:00.000Z')
    });
    const after = preview(context);
    expect(result.deletedBooks).toBe(1);
    expect(result.deletedRows).toBe(before.deleteTables.reduce((sum, table) => sum + table.rows, 0));
    expect(result.deletedFiles).toBe(0);
    expect(result.alreadyMissingFiles).toBe(1);
    expect(result.foreignKeyViolations).toBe(0);
    expect(after.books).toBe(0);
    expect(after.usage).toEqual({
      consumedTokens: 0, reservedTokens: 0, consumedUnits: 0, reservedUnits: 0, calls: 0
    });
    expect(count(context.database, 'v7_task_contracts')).toBe(0);
    expect(count(context.database, 'user_accounts')).toBe(2);
    expect(count(context.database, 'user_memberships')).toBe(1);
    expect(count(context.database, 'auth_sessions')).toBe(2);
    expect(count(context.database, 'platform_model_scheme')).toBeGreaterThan(0);
    expect(count(context.database, 'deletion_tombstones')).toBe(1);
    expect(count(context.database, 'clean_cutover_delete_guard')).toBe(0);
    expect(after.preserve).toEqual(before.preserve);
    expect(context.database.prepare(`SELECT preview_id, backup_id, status, deleted_books, deleted_rows,
      length(first_confirmation_hash) AS firstHashLength, length(second_confirmation_hash) AS secondHashLength
      FROM clean_cutover_operations WHERE operation_id=?`).get(result.operationId)).toMatchObject({
        preview_id: before.previewId,
        backup_id: backup.backupId,
        status: 'completed',
        deleted_books: 1,
        deleted_rows: result.deletedRows,
        firstHashLength: 64,
        secondHashLength: 64
      });
    expect(context.database.prepare(`SELECT deletion_operation_id FROM deletion_tombstones
      WHERE deleted_book_id='book-old'`).get()).toEqual({ deletion_operation_id: result.operationId });
  });

  it('强预览指纹会识别同一行内容变化并拒绝旧预览', async () => {
    context = createTestContext('wenmi-v7-clean-cutover-stale-');
    await seedAccounts(context);
    seedBookAndUsage(context);
    const before = preview(context);
    const backup = createVerifiedBackup(context, before);
    context.database.prepare("UPDATE usage_ledger SET provider='changed-provider' WHERE request_id='request-old'").run();
    expect(() => applyCleanCutoverReset(context!.database, {
      dataDir: context!.dataDir,
      expectedPreviewId: before.previewId,
      confirmation: 'YES',
      secondConfirmation: `CONFIRM:${before.previewId}`,
      backupId: backup.backupId
    })).toThrow('数据已变化');
    expect(count(context.database, 'books')).toBe(1);
    expect(count(context.database, 'clean_cutover_operations')).toBe(0);
  });

  it('新鲜 Worker 心跳即使暂时空闲也会在写锁内阻止清理', async () => {
    context = createTestContext('wenmi-v7-clean-cutover-active-');
    await seedAccounts(context);
    seedBookAndUsage(context);
    const releaseId = (context.database.prepare('SELECT release_id AS releaseId FROM release_runs LIMIT 1').get() as { releaseId: string }).releaseId;
    context.database.prepare(`INSERT INTO worker_health (
      worker_id, release_id, process_id, started_at, heartbeat_at, capabilities_json, current_task_id
    ) VALUES ('worker-busy', ?, 1, '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z', '{}', NULL)`).run(releaseId);
    const before = preview(context);
    expect(before.activeWork).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'worker_health', count: 1 })
    ]));
    const backup = createVerifiedBackup(context, before);
    expect(() => applyCleanCutoverReset(context!.database, {
      dataDir: context!.dataDir,
      expectedPreviewId: before.previewId,
      confirmation: 'YES',
      secondConfirmation: `CONFIRM:${before.previewId}`,
      backupId: backup.backupId,
      now: CUTOVER_NOW
    })).toThrow('任务正在执行');
    expect(count(context.database, 'books')).toBe(1);
  });

  it('停机后的陈旧 queued 状态只进入 staleWork，不再误阻塞清理', async () => {
    context = createTestContext('wenmi-v7-clean-cutover-stale-work-');
    await seedAccounts(context);
    const ownerId = seedBookAndUsage(context);
    context.database.prepare(`INSERT INTO chapter_batches (
      batch_id, owner_id, book_id, chapter_ids_json, task_ids_json, next_index,
      status, checkpoint_json, created_at, updated_at
    ) VALUES ('batch-stale', ?, 'book-old', '[]', '[]', 0, 'pending', '{}',
      '2026-08-29T12:00:00.000Z', '2026-08-29T12:00:00.000Z')`).run(ownerId);
    const before = preview(context);
    expect(before.activeWork).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'chapter_batches' })
    ]));
    expect(before.staleWork).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'chapter_batches', count: 1 })
    ]));
    const backup = createVerifiedBackup(context, before);
    expect(() => applyCleanCutoverReset(context!.database, {
      dataDir: context!.dataDir,
      expectedPreviewId: before.previewId,
      confirmation: 'YES',
      secondConfirmation: `CONFIRM:${before.previewId}`,
      backupId: backup.backupId,
      now: CUTOVER_NOW
    })).not.toThrow();
    expect(count(context.database, 'books')).toBe(0);
  });

  it('近期 queued 状态即使尚未取得 Worker 也必须阻塞', async () => {
    context = createTestContext('wenmi-v7-clean-cutover-recent-work-');
    await seedAccounts(context);
    const ownerId = seedBookAndUsage(context);
    context.database.prepare(`INSERT INTO chapter_batches (
      batch_id, owner_id, book_id, chapter_ids_json, task_ids_json, next_index,
      status, checkpoint_json, created_at, updated_at
    ) VALUES ('batch-recent', ?, 'book-old', '[]', '[]', 0, 'pending', '{}',
      '2026-08-29T23:30:00.000Z', '2026-08-29T23:30:00.000Z')`).run(ownerId);
    const before = preview(context);
    expect(before.activeWork).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'chapter_batches', count: 1 })
    ]));
    const backup = createVerifiedBackup(context, before);
    expect(() => applyCleanCutoverReset(context!.database, {
      dataDir: context!.dataDir,
      expectedPreviewId: before.previewId,
      confirmation: 'YES',
      secondConfirmation: `CONFIRM:${before.previewId}`,
      backupId: backup.backupId,
      now: CUTOVER_NOW
    })).toThrow('任务正在执行');
  });

  it('未过期任务 lease 无条件阻塞，即使其更新时间已经陈旧', async () => {
    context = createTestContext('wenmi-v7-clean-cutover-live-lease-');
    await seedAccounts(context);
    const ownerId = seedBookAndUsage(context);
    context.database.prepare(`INSERT INTO v7_opening_agent_tasks (
      task_id, owner_id, idempotency_key, request_hash, idea_text, idea_version, idea_hash,
      status, phase, state_json, lease_token, lease_expires_at, created_at, updated_at
    ) VALUES ('opening-live-lease', ?, 'opening-live-lease-key', ?, '测试开书想法', 1, ?,
      'queued', 'design', NULL, 'lease-token', '2026-08-30T00:05:00.000Z',
      '2026-08-29T12:00:00.000Z', '2026-08-29T12:00:00.000Z')`)
      .run(ownerId, 'a'.repeat(64), 'b'.repeat(64));
    const before = preview(context);
    expect(before.activeWork).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'v7_opening_agent_tasks', count: 1 })
    ]));
    const backup = createVerifiedBackup(context, before);
    expect(() => applyCleanCutoverReset(context!.database, {
      dataDir: context!.dataDir,
      expectedPreviewId: before.previewId,
      confirmation: 'YES',
      secondConfirmation: `CONFIRM:${before.previewId}`,
      backupId: backup.backupId,
      now: CUTOVER_NOW
    })).toThrow('任务正在执行');
  });

  it('Worker 从陈旧心跳变为新鲜心跳会改变强预览并拒绝旧确认', async () => {
    context = createTestContext('wenmi-v7-clean-cutover-worker-toctou-');
    await seedAccounts(context);
    seedBookAndUsage(context);
    const releaseId = (context.database.prepare('SELECT release_id AS releaseId FROM release_runs LIMIT 1')
      .get() as { releaseId: string }).releaseId;
    context.database.prepare(`INSERT INTO worker_health (
      worker_id, release_id, process_id, started_at, heartbeat_at, capabilities_json, current_task_id
    ) VALUES ('worker-changing', ?, 1, '2026-08-29T12:00:00.000Z',
      '2026-08-29T12:00:00.000Z', '{}', 'task-changing')`).run(releaseId);
    const before = preview(context);
    expect(before.activeWork).toEqual([]);
    expect(before.staleWork).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'worker_health', count: 1 })
    ]));
    const backup = createVerifiedBackup(context, before);
    context.database.prepare(`UPDATE worker_health SET heartbeat_at='2026-08-30T00:00:00.000Z'
      WHERE worker_id='worker-changing'`).run();
    const after = preview(context);
    expect(after.activeWork).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'worker_health', count: 1 })
    ]));
    expect(after.previewId).not.toBe(before.previewId);
    expect(() => applyCleanCutoverReset(context!.database, {
      dataDir: context!.dataDir,
      expectedPreviewId: before.previewId,
      confirmation: 'YES',
      secondConfirmation: `CONFIRM:${before.previewId}`,
      backupId: backup.backupId,
      now: CUTOVER_NOW
    })).toThrow('数据已变化');
    expect(count(context.database, 'books')).toBe(1);
  });

  it('发现未分类表或越界文件路径时 fail-closed，绝不触碰备份目录', async () => {
    context = createTestContext('wenmi-v7-clean-cutover-classify-');
    await seedAccounts(context);
    const ownerId = seedBookAndUsage(context);
    context.database.exec('CREATE TABLE unexpected_global_data (id TEXT PRIMARY KEY) STRICT');
    expect(() => preview(context!)).toThrow('存在未分类数据表');
    context.database.exec('DROP TABLE unexpected_global_data');
    context.database.prepare(`INSERT INTO quarantine_items (
      quarantine_id, owner_id, intended_book_id, kind, source_path, source_hash,
      status, validation_json, created_at, updated_at
    ) VALUES ('quarantine-unsafe', ?, 'book-old', 'import', 'backups/must-stay', ?,
      'pending', '{}', '2026-08-30T00:00:00.000Z', '2026-08-30T00:00:00.000Z')`).run(ownerId, 'a'.repeat(64));
    const before = preview(context);
    expect(before.fileManifest.unsafePaths.join('\n')).toContain('backups/must-stay');
    const backup = createVerifiedDatabaseBackupOnly(context);
    expect(() => prepareCleanCutoverFileBackup(context!.database, {
      dataDir: context!.dataDir,
      backupId: backup.backupId,
      preview: before
    })).toThrow('不安全文件路径');
    expect(existsSync(resolve(context.dataDir, 'backups'))).toBe(true);
    expect(count(context.database, 'books')).toBe(1);
  });

  it('数据库提交后文件删除失败可按持久清单续跑，缺失文件不冒充删除', async () => {
    context = createTestContext('wenmi-v7-clean-cutover-resume-');
    await seedAccounts(context);
    seedBookAndUsage(context);
    const bookDirectory = resolve(context.dataDir, 'books', 'book-old');
    mkdirSync(bookDirectory, { recursive: true });
    writeFileSync(resolve(bookDirectory, 'chapter.txt'), '旧正文', 'utf8');
    const before = preview(context);
    expect(before.fileManifest.entries).toHaveLength(1);
    const backup = createVerifiedBackup(context, before);
    expect(() => applyCleanCutoverReset(context!.database, {
      dataDir: context!.dataDir,
      expectedPreviewId: before.previewId,
      confirmation: 'YES',
      secondConfirmation: `CONFIRM:${before.previewId}`,
      backupId: backup.backupId,
      removePath: () => { throw new Error('模拟文件系统故障'); }
    })).toThrow('模拟文件系统故障');
    expect(count(context.database, 'books')).toBe(0);
    expect(existsSync(bookDirectory)).toBe(true);
    const operationId = `v7-clean-cutover-${before.previewId}`;
    expect(context.database.prepare('SELECT status FROM clean_cutover_operations WHERE operation_id=?')
      .get(operationId)).toEqual({ status: 'file_cleanup_failed' });
    const resumed = resumeCleanCutoverFiles(context.database, { dataDir: context.dataDir, operationId });
    expect(resumed).toEqual({ removedExisting: 1, alreadyMissing: 0 });
    expect(existsSync(bookDirectory)).toBe(false);
    expect(context.database.prepare(`SELECT status, removed_existing_paths, already_missing_paths
      FROM clean_cutover_operations WHERE operation_id=?`).get(operationId)).toEqual({
        status: 'completed', removed_existing_paths: 1, already_missing_paths: 0
      });
    expect(resumeCleanCutoverFiles(context.database, { dataDir: context.dataDir, operationId }))
      .toEqual({ removedExisting: 1, alreadyMissing: 0 });
  });
});

async function seedAccounts(testContext: TestContext): Promise<void> {
  const app = await createServer(testContext.config, testContext.database);
  try {
    await app.inject({
      method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
      payload: { email: 'admin@example.com', password: 'strong-pass-123', displayName: '管理员' }
    });
    await app.inject({
      method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
      payload: { email: 'owner@example.com', password: 'strong-pass-456', displayName: '作者' }
    });
  } finally {
    await app.close();
  }
}

function preview(testContext: TestContext): CleanCutoverPreview {
  return previewCleanCutover(testContext.database, {
    databasePath: testContext.config.databasePath,
    dataDir: testContext.dataDir,
    now: CUTOVER_NOW
  });
}

function createVerifiedDatabaseBackupOnly(testContext: TestContext): {
  backupId: string;
  restoredBooks: number;
} {
  const service = new BackupService(testContext.database, testContext.config);
  const backup = service.create();
  const verification = service.verify(backup.backupId);
  const restoredPath = resolve(testContext.dataDir, verification.restorePath, 'database.sqlite');
  const restored = new DatabaseSync(restoredPath, { readOnly: true });
  let restoredBooks = 0;
  try { restoredBooks = count(restored, 'books'); } finally { restored.close(); }
  return { backupId: backup.backupId, restoredBooks };
}

function createVerifiedBackup(testContext: TestContext, cutoverPreview: CleanCutoverPreview): {
  backupId: string;
  restoredBooks: number;
} {
  const backup = createVerifiedDatabaseBackupOnly(testContext);
  prepareCleanCutoverFileBackup(testContext.database, {
    dataDir: testContext.dataDir,
    backupId: backup.backupId,
    preview: cutoverPreview
  });
  return backup;
}

function seedBookAndUsage(testContext: TestContext): string {
  const database = testContext.database;
  const account = database.prepare("SELECT owner_id AS ownerId FROM user_accounts WHERE role = 'user' LIMIT 1")
    .get() as { ownerId: string };
  const now = '2026-08-30T00:00:00.000Z';
  database.prepare(`INSERT INTO books (
    book_id, owner_id, title, status, version, positioning_version, canon_revision, editor_epoch, created_at, updated_at
  ) VALUES ('book-old', ?, '旧测试书', 'active', 1, 0, 0, 0, ?, ?)`).run(account.ownerId, now, now);
  database.prepare(`INSERT INTO budgets (
    budget_id, owner_id, book_id, mode, token_limit, cash_limit_micros, status, created_at, updated_at
  ) VALUES ('budget-old', ?, 'book-old', 'standard', 0, 0, 'active', ?, ?)`).run(account.ownerId, now, now);
  database.prepare(`INSERT INTO budget_reservations (
    reservation_id, budget_id, owner_id, book_id, request_id, frozen_tokens, frozen_cash_micros,
    actual_tokens, actual_cash_micros, status, created_at, settled_at
  ) VALUES ('reservation-old', 'budget-old', ?, 'book-old', 'request-old', 30, 0, 30, 0, 'settled', ?, ?)`)
    .run(account.ownerId, now, now);
  database.prepare(`INSERT INTO usage_ledger (
    budget_id, reservation_id, owner_id, book_id, task_id, request_id, provider, model_id,
    input_tokens, output_tokens, cash_micros, duration_ms, recorded_at
  ) VALUES ('budget-old', 'reservation-old', ?, 'book-old', NULL, 'request-old', 'test', 'test-model',
    10, 20, 0, 1, ?)`).run(account.ownerId, now);
  return account.ownerId;
}

function seedImmutableTaskContract(testContext: TestContext, ownerId: string): void {
  testContext.database.prepare(`INSERT INTO v7_task_contracts (
    contract_id, version, owner_id, book_id, task_id, task_kind, workstation_key, operation_mode,
    objective, must_preserve_json, allowed_changes_json, forbidden_changes_json,
    success_criteria_json, output_contract_json, author_instruction_version, based_on_task_id,
    lifecycle_status, content_hash, created_at
  ) VALUES ('contract-old', 1, ?, 'book-old', 'task-old', 'outline', 'writer', 'fresh',
    '测试不可变追溯清理门禁', '[]', '[]', '[]', '[]', '{}', NULL, NULL, 'active', ?,
    '2026-08-30T00:00:00.000Z')`).run(ownerId, createHash('sha256').update('contract-old').digest('hex'));
}

function count(database: DatabaseSync, table: string): number {
  return Number((database.prepare(`SELECT COUNT(*) AS total FROM "${table}"`).get() as { total: number }).total);
}
