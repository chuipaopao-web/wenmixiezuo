import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { BookLifecycleService } from '../../../apps/api/src/application/books/book-lifecycle-service.js';
import { requiredPermanentDeleteText } from '../../../apps/api/src/domain/permanent-delete.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { openDatabase } from '../../../apps/api/src/infrastructure/db/database.js';
import { BudgetService } from '../../../apps/api/src/application/budget/budget-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('书籍生命周期与删除墓碑', () => {
  it('使用乐观版本归档和恢复', () => {
    context = createTestContext();
    const service = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    service.ensureOwner(scope);
    const created = service.createDraft(scope, '甲书');
    const archived = service.archive(scope, created.version);
    expect(archived.status).toBe('archived');
    const restored = service.restoreFromArchive(scope, archived.version);
    expect(restored.status).toBe('active');
    expect(() => service.archive(scope, created.version)).toThrow('版本已经变化');
  });

  it('非YES确认词不能永久删除', () => {
    context = createTestContext();
    const service = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    service.ensureOwner(scope);
    const created = service.createDraft(scope, '甲书');
    service.archive(scope, created.version);
    expect(() => service.permanentlyDelete(scope, '好')).toThrow('确认词不匹配');
    expect(new BookRepository(context.database).require(scope).title).toBe('甲书');
  });

  it('YES确认后删除临时测试书并留下不可变墓碑', () => {
    context = createTestContext();
    const service = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    const scope = { ownerId: 'owner-one', bookId: 'book-alpha' };
    service.ensureOwner(scope);
    const created = service.createDraft(scope, '甲书');
    service.archive(scope, created.version);
    service.permanentlyDelete(scope, ' yes ');
    expect(new BookRepository(context.database).find(scope)).toBeNull();
    const tombstone = context.database.prepare('SELECT deleted_book_id, deleted_book_title FROM deletion_tombstones WHERE owner_id = ?')
      .get(scope.ownerId);
    expect(tombstone).toEqual({ deleted_book_id: 'book-alpha', deleted_book_title: '甲书' });
    expect(() => service.createDraft(scope, '甲书复活')).toThrow('墓碑禁止');
    expect(() => service.permanentlyDelete(scope, 'YES')).not.toThrow();
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM deletion_tombstones
      WHERE owner_id = ? AND deleted_book_id = ?
    `).get(scope.ownerId, scope.bookId)).toEqual({ count: 1 });
  });

  it('永久删除在关闭并重新打开数据库后不会复活', () => {
    context = createTestContext();
    const current = context;
    const service = new BookLifecycleService(current.database, current.dataDir, new SequenceIds(), new FixedClock());
    const scope = { ownerId: 'owner-one', bookId: 'book-restart-check' };
    service.ensureOwner(scope);
    const created = service.createDraft(scope, '重启验证书');
    service.archive(scope, created.version);
    service.permanentlyDelete(scope, 'YES');

    current.database.close();
    const reopened = openDatabase(current.config.databasePath);
    expect(new BookRepository(reopened).find(scope)).toBeNull();
    expect(reopened.prepare(`
      SELECT COUNT(*) AS count FROM deletion_tombstones
      WHERE owner_id = ? AND deleted_book_id = ?
    `).get(scope.ownerId, scope.bookId)).toEqual({ count: 1 });
    expect(reopened.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    reopened.close();
    rmSync(current.root, { force: true, recursive: true });
    context = undefined;
  });

  it('活动书即使确认词正确也不能永久删除', () => {
    context = createTestContext();
    const service = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    const scope = { ownerId: 'owner-one', bookId: 'book-active' };
    service.ensureOwner(scope);
    service.createDraft(scope, '活动书');
    expect(() => service.permanentlyDelete(scope, requiredPermanentDeleteText('活动书', scope.bookId)))
      .toThrow('只有已归档书籍可以永久删除');
    expect(new BookRepository(context.database).require(scope).title).toBe('活动书');
  });

  it('真实开书产生的全部书内数据可在归档后原子删除', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const lifecycle = new BookLifecycleService(context.database, context.dataDir, ids, clock);
    lifecycle.ensureOwner({ ownerId: 'owner-one' });
    const created = initializeDomainBook(context, 'owner-one', ids, clock, { title: '完整测试书' });
    const survivor = initializeDomainBook(context, 'owner-one', ids, clock, { title: '隔离保留书' });
    const scope = { ownerId: 'owner-one', bookId: created.bookId };
    const survivorScope = { ownerId: 'owner-one', bookId: survivor.bookId };
    const active = new BookRepository(context.database).require(scope);
    lifecycle.archive(scope, active.version);
    context.database.prepare(`
      INSERT INTO quarantine_items (
        quarantine_id, owner_id, intended_book_id, kind, source_path, source_hash,
        status, validation_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'import', ?, ?, 'pending', '{}', ?, ?)
    `).run('quarantine-target', scope.ownerId, scope.bookId, 'incoming/test.txt', 'a'.repeat(64), clock.now().toISOString(), clock.now().toISOString());
    context.database.prepare(`
      INSERT INTO portable_operations (
        portable_operation_id, owner_id, book_id, operation_type, status, package_name,
        source_book_id, target_book_id, summary_json, created_at, completed_at
      ) VALUES (?, ?, ?, 'export', 'completed', ?, ?, NULL, '{}', ?, ?)
    `).run('portable-operation-target', scope.ownerId, scope.bookId, 'target.wenmi', scope.bookId, clock.now().toISOString(), clock.now().toISOString());
    context.database.prepare(`
      INSERT INTO portable_manifests (
        portable_manifest_id, portable_operation_id, owner_id, book_id, format_version,
        schema_version, manifest_hash, table_count, row_count, file_count, byte_count, created_at
      ) VALUES (?, ?, ?, ?, 1, 19, ?, 1, 1, 1, 1, ?)
    `).run('portable-manifest-target', 'portable-operation-target', scope.ownerId, scope.bookId, 'b'.repeat(64), clock.now().toISOString());
    context.database.prepare(`
      INSERT INTO portable_files (
        portable_file_id, portable_manifest_id, relative_path, content_hash, byte_count, media_type, created_at
      ) VALUES (?, ?, ?, ?, 1, 'text/plain', ?)
    `).run('portable-file-target', 'portable-manifest-target', 'payload/test.txt', 'c'.repeat(64), clock.now().toISOString());
    context.database.prepare(`
      INSERT INTO import_quarantine_checks (
        import_quarantine_check_id, portable_operation_id, check_key, status, details_json, created_at
      ) VALUES (?, ?, 'scope', 'passed', '{}', ?)
    `).run('portable-check-target', 'portable-operation-target', clock.now().toISOString());
    context.database.prepare(`
      INSERT INTO restore_impact_reports (
        restore_impact_report_id, portable_operation_id, target_book_id, current_schema_version,
        package_schema_version, affected_json, status, created_at
      ) VALUES (?, ?, ?, 19, 19, '{}', 'preview', ?)
    `).run('portable-report-target', 'portable-operation-target', scope.bookId, clock.now().toISOString());
    const agent = context.database.prepare(`
      SELECT a.agent_id, s.provider, s.model_id, a.model_snapshot_id
      FROM agent_instances a
      JOIN model_config_snapshots s ON s.model_snapshot_id = a.model_snapshot_id
      WHERE a.owner_id = ? AND a.book_id = ? ORDER BY a.agent_id LIMIT 1
    `).get(scope.ownerId, scope.bookId) as {
      agent_id: string; provider: string; model_id: string; model_snapshot_id: string;
    };
    const budgets = new BudgetService(context.database, ids, clock);
    const budget = budgets.create(scope, 'standard', 1_000, 0);
    new TaskService(context.database, context.config.releaseId, clock).create(scope, {
      taskId: 'purge-prompt-task', taskType: 'model_probe', assignedAgentId: agent.agent_id,
      idempotencyKey: 'purge-prompt-task', budgetId: budget.budgetId, initialPhase: 'draft', brief: {}
    });
    const reservationId = budgets.reserve(scope, budget.budgetId, 'purge-prompt-request', 10, 0);
    context.database.prepare(`
      INSERT INTO model_calls (
        request_id, owner_id, book_id, task_id, phase_key, agent_id, provider, model_id,
        model_snapshot_id, input_hash, parameters_hash, reservation_id, state, created_at
      ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, 'failed', ?)
    `).run(
      'purge-prompt-request', scope.ownerId, scope.bookId, 'purge-prompt-task', agent.agent_id,
      agent.provider, agent.model_id, agent.model_snapshot_id, 'd'.repeat(64), 'e'.repeat(64),
      reservationId, clock.now().toISOString()
    );
    context.database.prepare(`
      INSERT INTO model_call_prompt_snapshots (
        request_id, task_type, role_key, phase_key, task_prompt,
        supplemental_instructions, prompt_override_id, created_at
      ) VALUES (?, 'model_probe', 'chief_editor', 'draft', '测试提示词', '', NULL, ?)
    `).run('purge-prompt-request', clock.now().toISOString());

    lifecycle.permanentlyDelete(scope, requiredPermanentDeleteText('完整测试书', scope.bookId));

    expect(new BookRepository(context.database).find(scope)).toBeNull();
    expect(new BookRepository(context.database).require(survivorScope).title).toBe('隔离保留书');
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM book_configs WHERE owner_id = ? AND book_id = ?`)
      .get(survivorScope.ownerId, survivorScope.bookId)).toEqual({ count: 1 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM book_configs WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
    const scopedTables = context.database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'books'
      ORDER BY name
    `).all() as unknown as Array<{ name: string }>;
    for (const table of scopedTables) {
      const identifier = `"${table.name.replaceAll('"', '""')}"`;
      const columns = context.database.prepare(`PRAGMA table_info(${identifier})`).all() as unknown as Array<{ name: string }>;
      const names = new Set(columns.map((column) => column.name));
      if (!names.has('owner_id') || !names.has('book_id')) continue;
      expect(
        context.database.prepare(`SELECT COUNT(*) AS count FROM ${identifier} WHERE owner_id = ? AND book_id = ?`)
          .get(scope.ownerId, scope.bookId),
        `${table.name} 仍留有被删除书籍的数据`
      ).toEqual({ count: 0 });
    }
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM positioning_drafts
      WHERE owner_id = ? AND (proposed_book_id = ? OR confirmed_book_id = ?)
    `).get(scope.ownerId, scope.bookId, scope.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM quarantine_items WHERE owner_id = ? AND intended_book_id = ?
    `).get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM portable_operations WHERE portable_operation_id = 'portable-operation-target'
    `).get()).toEqual({ count: 0 });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM portable_files WHERE portable_file_id = 'portable-file-target'
    `).get()).toEqual({ count: 0 });
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM model_call_prompt_snapshots WHERE request_id = 'purge-prompt-request'
    `).get()).toEqual({ count: 0 });
    expect(context.database.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  });

  it('清理中发现未处理引用时整个事务回滚', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const lifecycle = new BookLifecycleService(context.database, context.dataDir, ids, clock);
    lifecycle.ensureOwner({ ownerId: 'owner-one' });
    const created = initializeDomainBook(context, 'owner-one', ids, clock, { title: '回滚测试书' });
    const scope = { ownerId: 'owner-one', bookId: created.bookId };
    const active = new BookRepository(context.database).require(scope);
    lifecycle.archive(scope, active.version);
    context.database.exec(`
      CREATE TABLE purge_test_blockers (
        blocker_id TEXT PRIMARY KEY,
        referenced_book_id TEXT NOT NULL REFERENCES books(book_id)
      ) STRICT;
    `);
    context.database.prepare('INSERT INTO purge_test_blockers (blocker_id, referenced_book_id) VALUES (?, ?)')
      .run('blocker-one', scope.bookId);

    expect(() => lifecycle.permanentlyDelete(scope, 'YES')).toThrow('FOREIGN KEY constraint failed');

    expect(new BookRepository(context.database).require(scope).title).toBe('回滚测试书');
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM book_configs WHERE owner_id = ? AND book_id = ?')
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 1 });
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM deletion_tombstones WHERE owner_id = ? AND deleted_book_id = ?')
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
  it('底层创建同样拒绝超过15字', () => {
    context = createTestContext();
    const service = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    const scope = { ownerId: 'owner-one', bookId: 'book-title-limit' };
    service.ensureOwner(scope);
    expect(() => service.createDraft(scope, '一二三四五六七八九十一二三四五六')).toThrow('1至15字');
    expect(service.createDraft(scope, '一二三四五六七八九十一二三四五').title)
      .toBe('一二三四五六七八九十一二三四五');
  });

  it('同一作者不能创建含归档书在内的同名书，不同作者仍可同名', () => {
    context = createTestContext();
    const service = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    const first = { ownerId: 'owner-one', bookId: 'book-same-title-one' };
    service.ensureOwner(first);
    const created = service.createDraft(first, 'Ａ 计划');
    service.archive(first, created.version);

    expect(() => service.createDraft(
      { ownerId: 'owner-one', bookId: 'book-same-title-two' },
      ' a   计划 '
    )).toThrow('同名书籍');

    const otherOwner = { ownerId: 'owner-two', bookId: 'book-same-title-other-owner' };
    service.ensureOwner(otherOwner);
    expect(service.createDraft(otherOwner, 'A 计划').title).toBe('A 计划');

    service.permanentlyDelete(first, 'YES');
    expect(service.createDraft(
      { ownerId: 'owner-one', bookId: 'book-same-title-reused' },
      'A 计划'
    ).title).toBe('A 计划');
  });

  it('改名不能制造同一作者重名，未改变书名时仍可保存', () => {
    context = createTestContext();
    const service = new BookLifecycleService(context.database, context.dataDir, new SequenceIds(), new FixedClock());
    service.ensureOwner({ ownerId: 'owner-one' });
    const first = service.createDraft({ ownerId: 'owner-one', bookId: 'book-title-first' }, '甲书');
    const secondScope = { ownerId: 'owner-one', bookId: 'book-title-second' };
    const second = service.createDraft(secondScope, '乙书');
    const books = new BookRepository(context.database);

    expect(() => books.updateTitle(secondScope, second.version, first.title, new FixedClock().now().toISOString()))
      .toThrow('同名书籍');
    expect(books.updateTitle(secondScope, second.version, second.title, new FixedClock().now().toISOString()).title)
      .toBe('乙书');
  });
});
