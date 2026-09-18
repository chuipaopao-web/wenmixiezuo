import { afterEach, describe, expect, it } from 'vitest';
import { V7_PLANNING_TREE_SCHEMA, type PlanningTreeDocument, type PlanningTreeNode } from '@wenmi/v7-backend';
import { BookLifecycleService, type PermanentDeleteInput } from '../../../apps/api/src/application/books/book-lifecycle-service.js';
import { V7PlanningTreeService } from '../../../apps/api/src/application/planning/v7-planning-tree-service.js';
import {
  requiredPermanentDeleteSecondText,
  requiredPermanentDeleteText
} from '../../../apps/api/src/domain/permanent-delete.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { initializeV7Book } from '../../helpers/v7-book-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

const NOW = '2026-07-16T00:00:00.000Z';
const PROMPT_HASH = 'a'.repeat(64);

function makeService(ctx: TestContext, ids = new SequenceIds(), clock = new FixedClock()) {
  return { service: new BookLifecycleService(ctx.database, ctx.dataDir, ids, clock), ids, clock };
}

function confirmedDelete(book: { version: number }, previewId: string, over: Partial<PermanentDeleteInput> = {}): PermanentDeleteInput {
  return {
    expectedVersion: book.version,
    confirmationText: requiredPermanentDeleteText(),
    secondConfirmationText: requiredPermanentDeleteSecondText(),
    previewId,
    ...over
  };
}

function countRows(sql: string, ...params: string[]): number {
  const row = context!.database.prepare(sql).get(...params) as { count: number };
  return row.count;
}

function projectionSnapshot(ownerId: string): string {
  const rows = context!.database.prepare(
    'SELECT * FROM account_usage_projection WHERE owner_id = ? ORDER BY source_kind, source_id'
  ).all(ownerId);
  return JSON.stringify(rows, Object.keys(rows[0] ?? {}).sort());
}

describe('V7 书籍生命周期与删除墓碑', () => {
  it('归档和恢复使用乐观版本，并保留 V7 内容', () => {
    context = createTestContext('wenmi-v7-book-archive-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const ownerId = 'owner-v7-lifecycle';
    const book = initializeV7Book(context, ownerId, ids, clock, { title: '归档恢复书' });
    const scope = { ownerId, bookId: book.bookId };
    const { service } = makeService(context, ids, clock);
    const archived = service.archive(scope, book.version);
    expect(archived.status).toBe('archived');
    const restored = service.restoreFromArchive(scope, archived.version);
    expect(restored.status).toBe('active');
    expect(() => service.archive(scope, book.version)).toThrow('版本已经变化');
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM positioning_drafts WHERE confirmed_book_id=?')
      .get(book.bookId)).toEqual({ count: 1 });
  });

  it('永久删除要求归档和精确确认，并对 V7 数据原子执行且不污染同作者另一书', () => {
    context = createTestContext('wenmi-v7-book-purge-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const ownerId = 'owner-v7-purge';
    const target = initializeV7Book(context, ownerId, ids, clock, { title: '待删除书' });
    const survivor = initializeV7Book(context, ownerId, ids, clock, { title: '保留书' });
    const scope = { ownerId, bookId: target.bookId };
    const survivorScope = { ownerId, bookId: survivor.bookId };
    const { service } = makeService(context, ids, clock);
    const trees = new V7PlanningTreeService(context.database, ids, clock);
    trees.createCandidate(ownerId, target.bookId, 'book', target.bookId, {
      expectedRevision: 0,
      tree: bookTree(target.bookId),
      sourceRefs: [{ sourceKind: 'opening', sourceId: target.bookId, version: '1' }],
      idempotencyKey: 'v7-purge-tree-candidate-0001'
    });

    expect(() => service.permanentlyDelete(scope, confirmedDelete(target, 'unused')))
      .toThrow('只有已归档书籍可以永久删除');
    const archived = service.archive(scope, target.version);
    const preview = service.deletePreview(scope);
    expect(preview.book.version).toBe(archived.version);
    expect(preview.canDelete).toBe(true);
    expect(() => service.permanentlyDelete(scope, confirmedDelete(archived, preview.previewId, { confirmationText: '不是确认词' })))
      .toThrow('确认词不匹配');
    expect(() => service.permanentlyDelete(scope, confirmedDelete(archived, preview.previewId, { secondConfirmationText: '随便' })))
      .toThrow('二次确认词不匹配');
    expect(() => service.permanentlyDelete(scope, confirmedDelete(archived, preview.previewId, { expectedVersion: archived.version + 9 })))
      .toThrow('版本已经变化');
    expect(new BookRepository(context.database).require(scope).status).toBe('archived');

    context.database.exec(`CREATE TABLE purge_v7_blockers(
      blocker_id TEXT PRIMARY KEY,
      referenced_book_id TEXT NOT NULL REFERENCES books(book_id)
    ) STRICT`);
    context.database.prepare('INSERT INTO purge_v7_blockers(blocker_id,referenced_book_id) VALUES(?,?)')
      .run('blocker-v7', target.bookId);
    expect(() => service.permanentlyDelete(scope, confirmedDelete(archived, preview.previewId)))
      .toThrow('FOREIGN KEY constraint failed');
    expect(new BookRepository(context.database).require(scope).version).toBe(archived.version);
    expect(countRows('SELECT COUNT(*) AS count FROM deletion_tombstones WHERE deleted_book_id=?', target.bookId)).toBe(0);
    context.database.exec('DROP TABLE purge_v7_blockers');

    const result = service.permanentlyDelete(scope, confirmedDelete(archived, preview.previewId));
    expect(result.deleted).toBe(true);
    expect(result.alreadyDeleted).toBe(false);
    expect(result.filesFailed).toEqual([]);
    expect(new BookRepository(context.database).find(scope)).toBeNull();
    expect(new BookRepository(context.database).require(survivorScope).title).toBe('保留书');
    expect(countRows('SELECT COUNT(*) AS count FROM v7_planning_tree_heads WHERE owner_id=? AND book_id=?', ownerId, target.bookId)).toBe(0);
    expect(countRows('SELECT COUNT(*) AS count FROM positioning_drafts WHERE owner_id=? AND (proposed_book_id=? OR confirmed_book_id=?)', ownerId, target.bookId, target.bookId)).toBe(0);
    expect(countRows('SELECT COUNT(*) AS count FROM positioning_drafts WHERE confirmed_book_id=?', survivor.bookId)).toBe(1);
    expect(countRows('SELECT COUNT(*) AS count FROM deletion_tombstones WHERE owner_id=? AND deleted_book_id=?', ownerId, target.bookId)).toBe(1);
    expect(context.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});

describe('归档书永久删除扩展反例（NEWBOOK-E2E-01）', () => {
  function archivedTarget(ownerId: string, title = '目标书') {
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeV7Book(context!, ownerId, ids, clock, { title });
    const { service } = makeService(context!, ids, clock);
    const archived = service.archive({ ownerId, bookId: book.bookId }, book.version);
    return { service, ids, clock, book, archived, scope: { ownerId, bookId: book.bookId } };
  }

  it('在途任务门禁：工作/排队任务与活租约拒绝删除，结束后放行', () => {
    context = createTestContext('wenmi-v7-purge-active-');
    const { service, archived, scope } = archivedTarget('owner-active');
    const insertTask = context.database.prepare(`
      INSERT INTO tasks (task_id, release_id, owner_id, book_id, task_type, task_brief_json, status,
        current_phase, idempotency_key, checkpoint_json, created_at, updated_at, current_attempt_no)
      VALUES (?, ?, ?, ?, 'design', '{}', ?, 'phase-1', ?, '{}', ?, ?, 1)
    `);
    insertTask.run('task-active-1', context.config.releaseId, scope.ownerId, scope.bookId, 'working', 'idem-active-1', NOW, NOW);

    const blockedPreview = service.deletePreview(scope);
    expect(blockedPreview.canDelete).toBe(false);
    expect(blockedPreview.activeWork).toContainEqual({ table: 'tasks', count: 1, reason: 'active_state' });
    expect(() => service.permanentlyDelete(scope, confirmedDelete(archived, blockedPreview.previewId)))
      .toThrow('还有正在进行的任务');
    expect(new BookRepository(context.database).require(scope).status).toBe('archived');
    expect(countRows('SELECT COUNT(*) AS count FROM deletion_tombstones WHERE deleted_book_id=?', scope.bookId)).toBe(0);

    // 任务进入终态后放行。
    context.database.prepare(`UPDATE tasks SET status = 'succeeded' WHERE task_id = 'task-active-1'`).run();
    const readyPreview = service.deletePreview(scope);
    expect(readyPreview.canDelete).toBe(true);
    const result = service.permanentlyDelete(scope, confirmedDelete(archived, readyPreview.previewId));
    expect(result.deleted).toBe(true);
    expect(countRows('SELECT COUNT(*) AS count FROM tasks WHERE owner_id=? AND book_id=?', scope.ownerId, scope.bookId)).toBe(0);
  });

  it('tm2 活租约步骤视为在途并拒绝删除', () => {
    context = createTestContext('wenmi-v7-purge-tm2lease-');
    const { service, archived, scope } = archivedTarget('owner-tm2-lease');
    context.database.prepare(`INSERT INTO tm2_books(owner,book,revision,manifest) VALUES(?,?,0,'{}')`)
      .run(scope.ownerId, scope.bookId);
    context.database.prepare(`INSERT INTO tm2_steps(owner,book,id,input_hash,member,state,lease_until) VALUES(?,?,?,'h','member-1','running',?)`)
      .run(scope.ownerId, scope.bookId, 'step-1', Date.parse('2027-01-01T00:00:00.000Z'));
    const preview = service.deletePreview(scope);
    expect(preview.canDelete).toBe(false);
    expect(preview.activeWork).toContainEqual({ table: 'tm2_steps', count: 1, reason: 'live_lease' });
    expect(() => service.permanentlyDelete(scope, confirmedDelete(archived, preview.previewId)))
      .toThrow('还有正在进行的任务');
  });

  it('预览后数据变化使预览指纹失效并 409 拒绝', () => {
    context = createTestContext('wenmi-v7-purge-stale-');
    const { service, archived, scope } = archivedTarget('owner-stale');
    const preview = service.deletePreview(scope);
    context.database.prepare(`
      INSERT INTO tm2_design_runs (id, owner_id, book_id, kind, request_key, input_hash, snapshot_json,
        state, phase, created_at, updated_at, scheme, round_key, needs_redesign)
      VALUES ('run-stale', ?, ?, 'design', 'key-stale', 'hash', '{}', 'failed', 'done', ?, ?, 'A', 'round-1', 0)
    `).run(scope.ownerId, scope.bookId, NOW, NOW);
    expect(() => service.permanentlyDelete(scope, confirmedDelete(archived, preview.previewId)))
      .toThrow('预览已过期');
    expect(new BookRepository(context.database).require(scope).status).toBe('archived');
    const fresh = service.deletePreview(scope);
    expect(fresh.previewId).not.toBe(preview.previewId);
    expect(service.permanentlyDelete(scope, confirmedDelete(archived, fresh.previewId)).deleted).toBe(true);
  });

  it('重复提交幂等：成功后的相同请求返回 alreadyDeleted 且不报错', () => {
    context = createTestContext('wenmi-v7-purge-idem-');
    const { service, archived, scope } = archivedTarget('owner-idem');
    const preview = service.deletePreview(scope);
    const input = confirmedDelete(archived, preview.previewId);
    expect(service.permanentlyDelete(scope, input).alreadyDeleted).toBe(false);
    const replay = service.permanentlyDelete(scope, input);
    expect(replay.deleted).toBe(true);
    expect(replay.alreadyDeleted).toBe(true);
    expect(countRows('SELECT COUNT(*) AS count FROM books WHERE owner_id=? AND book_id=?', scope.ownerId, scope.bookId)).toBe(0);
  });

  it('tm2 核心状态（owner/book 列）随书清除且不波及另一书', () => {
    context = createTestContext('wenmi-v7-purge-tm2-');
    const ownerId = 'owner-tm2';
    const { service, archived, scope } = archivedTarget(ownerId, '时光机书');
    const survivor = initializeV7Book(context, ownerId, new SequenceIds(), new FixedClock(), { title: '留存书', bookId: 'survivor-tm2-book' });
    const seedTm2 = (bookId: string, tag: string) => {
      context!.database.prepare(`INSERT INTO tm2_books(owner,book,revision,manifest) VALUES(?,?,1,'{}')`).run(ownerId, bookId);
      context!.database.prepare(`INSERT INTO tm2_candidates(owner,book,id,revision,body,hash) VALUES(?,?,?,1,'{}','h')`).run(ownerId, bookId, `cand-${tag}`);
      context!.database.prepare(`INSERT INTO tm2_reviews(owner,book,candidate,revision,reviewer,verdict) VALUES(?,?,?,1,'reviewer-1','pass')`).run(ownerId, bookId, `cand-${tag}`);
      context!.database.prepare(`INSERT INTO tm2_steps(owner,book,id,input_hash,member,state) VALUES(?,?,?,'h','member-1','succeeded')`).run(ownerId, bookId, `step-${tag}`);
      context!.database.prepare(`INSERT INTO tm2_attempts(id,owner,book,step,state,started_at) VALUES(?,?,?,?,'succeeded',1)`).run(`att-${tag}`, ownerId, bookId, `step-${tag}`);
      context!.database.prepare(`INSERT INTO tm2_outbox(owner,book,id,kind,body) VALUES(?,?,?,'kind','{}')`).run(ownerId, bookId, `evt-${tag}`);
      context!.database.prepare(`INSERT INTO tm2_consumptions(owner,book,event,consumer) VALUES(?,?,?,'consumer-1')`).run(ownerId, bookId, `evt-${tag}`);
      context!.database.prepare(`INSERT INTO tm2_storyline_materials(owner,book,id,revision,content_json,content_hash,created_by,idempotency_key,created_at) VALUES(?,?,'mat',1,'{}','h','author-edit',?,?)`).run(ownerId, bookId, `idem-${tag}`, NOW);
      context!.database.prepare(`INSERT INTO tm2_model_calls(id,owner_id,book_id,member_id,provider,model_id,request_hash,state,reserved_tokens,started_at) VALUES(?,?,?,'m','p','model','h','succeeded',100,?)`).run(`call-${tag}`, ownerId, bookId, NOW);
    };
    seedTm2(scope.bookId, 'target');
    seedTm2(survivor.bookId, 'survivor');
    const preview = service.deletePreview(scope);
    expect(preview.impact.timeMachineRows).toBeGreaterThan(0);
    service.permanentlyDelete(scope, confirmedDelete(archived, preview.previewId));
    for (const table of ['tm2_books', 'tm2_candidates', 'tm2_reviews', 'tm2_steps', 'tm2_attempts', 'tm2_outbox', 'tm2_consumptions', 'tm2_storyline_materials']) {
      expect(countRows(`SELECT COUNT(*) AS count FROM ${table} WHERE owner=? AND book=?`, ownerId, scope.bookId)).toBe(0);
      expect(countRows(`SELECT COUNT(*) AS count FROM ${table} WHERE owner=? AND book=?`, ownerId, survivor.bookId)).toBeGreaterThan(0);
    }
    expect(countRows('SELECT COUNT(*) AS count FROM tm2_model_calls WHERE owner_id=? AND book_id=?', ownerId, scope.bookId)).toBe(0);
    expect(countRows('SELECT COUNT(*) AS count FROM tm2_model_calls WHERE owner_id=? AND book_id=?', ownerId, survivor.bookId)).toBe(1);
    expect(context.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('用量结算记录先归档再删除，账号用量投影逐行不变', () => {
    context = createTestContext('wenmi-v7-purge-usage-');
    const ownerId = 'owner-usage';
    const { service, archived, scope } = archivedTarget(ownerId, '计费书');
    const survivor = initializeV7Book(context, ownerId, new SequenceIds(), new FixedClock(), { title: '留存计费书', bookId: 'survivor-usage-book' });
    const insertUsage = context.database.prepare(`
      INSERT INTO account_usage_supplemental_calls (source_kind, source_id, owner_id, book_id, provider, model_id,
        state, reserved_tokens, input_tokens, output_tokens, cash_micros, reserved_units, consumed_units,
        started_at, completed_at, updated_at)
      VALUES ('v7_title', ?, ?, ?, 'provider', 'model', 'succeeded', 10, 6, 4, 7, 0, 1, ?, ?, ?)
    `);
    insertUsage.run('usage-target-1', ownerId, scope.bookId, NOW, NOW, NOW);
    insertUsage.run('usage-target-2', ownerId, scope.bookId, NOW, NOW, NOW);
    insertUsage.run('usage-survivor', ownerId, survivor.bookId, NOW, NOW, NOW);

    const before = projectionSnapshot(ownerId);
    const preview = service.deletePreview(scope);
    expect(preview.impact.usageRecordsPreserved).toBe(2);
    service.permanentlyDelete(scope, confirmedDelete(archived, preview.previewId));
    const after = projectionSnapshot(ownerId);
    expect(after).toBe(before);
    expect(countRows('SELECT COUNT(*) AS count FROM account_usage_supplemental_calls WHERE owner_id=? AND book_id=?', ownerId, scope.bookId)).toBe(0);
    expect(countRows('SELECT COUNT(*) AS count FROM account_usage_purge_archive WHERE owner_id=? AND book_id=?', ownerId, scope.bookId)).toBe(2);
    expect(countRows('SELECT COUNT(*) AS count FROM account_usage_purge_archive WHERE owner_id=? AND book_id=?', ownerId, survivor.bookId)).toBe(0);
  });

  it('开书草稿与开书任务按 JSON 引用联动删除，无引用草稿与无关记录保留', () => {
    context = createTestContext('wenmi-v7-purge-opening-');
    const ownerId = 'owner-opening';
    const { service, archived, scope } = archivedTarget(ownerId, '开书联动书');
    context.database.prepare(`
      INSERT INTO user_accounts (user_id, owner_id, email_normalized, display_name, password_salt, password_hash,
        role, status, created_at, updated_at)
      VALUES ('user-opening', ?, 'opening@example.com', '开书作者', 'salt', 'hash', 'user', 'active', ?, ?)
    `).run(ownerId, NOW, NOW);
    context.database.prepare(`INSERT INTO opening_drafts (owner_id, payload, updated_at) VALUES (?, ?, ?)`)
      .run(ownerId, JSON.stringify({ idea: '草稿', confirmedBookId: scope.bookId }), NOW);
    context.database.prepare(`
      INSERT INTO v7_opening_agent_tasks (task_id, owner_id, idempotency_key, request_hash, idea_text, idea_version,
        idea_hash, status, phase, state_json, created_at, updated_at, publishing_platform)
      VALUES ('task-opening-1', ?, 'idem-opening-1', ?, '快递员在三国送快递', 1, ?, 'failed', 'done', ?, ?, ?, 'mainstream')
    `).run(ownerId, PROMPT_HASH, PROMPT_HASH, JSON.stringify({ confirmedBookId: scope.bookId }), NOW, NOW);
    context.database.prepare(`
      INSERT INTO v7_opening_agent_model_calls (request_id, owner_id, task_id, node_key, member_key, provider, model_id,
        plan, state, prompt_hash, reserved_tokens, input_tokens, output_tokens, cash_micros, started_at, created_at, updated_at, governance_revision)
      VALUES ('call-opening-1', ?, 'task-opening-1', 'node', 'member', 'provider', 'model', 'agent', 'succeeded', ?, 5, 3, 2, 1, ?, ?, ?, 1)
    `).run(ownerId, PROMPT_HASH, NOW, NOW, NOW);

    const before = projectionSnapshot(ownerId);
    const preview = service.deletePreview(scope);
    expect(preview.impact.taskCount).toBeGreaterThanOrEqual(1);
    expect(preview.impact.usageRecordsPreserved).toBe(1); // 开书调用在投影中 book_id 为 NULL，单独归档
    service.permanentlyDelete(scope, confirmedDelete(archived, preview.previewId));

    expect(countRows('SELECT COUNT(*) AS count FROM opening_drafts WHERE owner_id=?', ownerId)).toBe(0);
    expect(countRows('SELECT COUNT(*) AS count FROM v7_opening_agent_tasks WHERE owner_id=?', ownerId)).toBe(0);
    expect(countRows('SELECT COUNT(*) AS count FROM v7_opening_agent_model_calls WHERE owner_id=?', ownerId)).toBe(0);
    expect(projectionSnapshot(ownerId)).toBe(before);
    expect(countRows('SELECT COUNT(*) AS count FROM account_usage_purge_archive WHERE owner_id=? AND source_id=?', ownerId, 'call-opening-1')).toBe(1);
    expect(context.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('跨用户与跨书范围一律 404，不泄漏存在性', () => {
    context = createTestContext('wenmi-v7-purge-cross-');
    const { service, scope } = archivedTarget('owner-cross');
    initializeV7Book(context, 'owner-other', new SequenceIds(), new FixedClock(), { title: '他人书', bookId: 'other-owner-book' });
    expect(() => service.deletePreview({ ownerId: 'owner-other', bookId: scope.bookId })).toThrow('书籍不存在');
    expect(() => service.deletePreview({ ownerId: scope.ownerId, bookId: 'book-not-exist' })).toThrow('书籍不存在');
    expect(() => service.permanentlyDelete({ ownerId: 'owner-other', bookId: scope.bookId }, confirmedDelete({ version: 1 }, 'x')))
      .toThrow('书籍不存在');
    expect(new BookRepository(context.database).require(scope).status).toBe('archived');
  });

  it('迟到写入不能复活已删除书籍：同ID重建被墓碑拒绝，tm2 写入被外键拒绝', () => {
    context = createTestContext('wenmi-v7-purge-late-');
    const { service, archived, scope } = archivedTarget('owner-late');
    const preview = service.deletePreview(scope);
    service.permanentlyDelete(scope, confirmedDelete(archived, preview.previewId));
    expect(() => service.createDraft(scope, '复活书')).toThrow('删除墓碑禁止旧书籍ID复活');
    expect(() => context!.database.prepare(`INSERT INTO tm2_steps(owner,book,id,input_hash,member,state) VALUES(?,?,?,'h','m','ready')`)
      .run(scope.ownerId, scope.bookId, 'late-step')).toThrow('FOREIGN KEY constraint failed');
    expect(context.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('历史删除墓碑与其他保留表不随新书删除而消失', () => {
    context = createTestContext('wenmi-v7-purge-keep-');
    const ownerId = 'owner-keep';
    const { service, archived, scope } = archivedTarget(ownerId, '新书删除');
    context.database.prepare(`
      INSERT INTO deletion_tombstones (tombstone_id, owner_id, deleted_book_id, deleted_book_title,
        deletion_operation_id, confirmation_text_hash, deleted_at)
      VALUES ('tomb-old', ?, 'book-old', '旧书', 'op-old', ?, ?)
    `).run(ownerId, PROMPT_HASH, NOW);
    const preview = service.deletePreview(scope);
    service.permanentlyDelete(scope, confirmedDelete(archived, preview.previewId));
    expect(countRows('SELECT COUNT(*) AS count FROM deletion_tombstones WHERE deleted_book_id=?', 'book-old')).toBe(1);
    expect(countRows('SELECT COUNT(*) AS count FROM deletion_tombstones WHERE deleted_book_id=?', scope.bookId)).toBe(1);
  });
});

function bookTree(bookId: string): PlanningTreeDocument {
  return {
    schema: V7_PLANNING_TREE_SCHEMA,
    treeKind: 'book',
    scopeId: bookId,
    title: '删除隔离测试规划',
    root: planningNode('book-root', 'book', [planningNode('volume-1', 'volume')])
  };
}

function planningNode(key: string, kind: PlanningTreeNode['kind'], children: PlanningTreeNode[] = []): PlanningTreeNode {
  return {
    key, kind, sequence: 1, title: kind === 'book' ? '全书方向' : '第一卷',
    story: {
      summary: '只用于验证 V7 书籍删除隔离。', majorEvents: ['建立测试规划。'],
      protagonistChange: '尚未发生', outcome: '形成可删除的候选版本。', nextStep: '等待作者确认。'
    },
    emotion: {
      publicSummary: '保持稳定。', openingEmotion: '平静', pressureMovement: '不增加压力',
      releaseEmotion: '完成验证', intensity: 'moderate'
    },
    experience: {
      publicSummary: '验证数据隔离。', pressureRhythm: '稳定', payoffCadence: '完成即兑现',
      informationRhythm: '只展示必要信息', contrastWithPrevious: '无', designReason: '只用于安全测试'
    },
    causality: {
      trigger: '创建测试书', causes: ['需要验证删除隔离'], coreConflict: '删除与保留必须分离',
      turningPoint: '执行原子删除', consequences: ['目标书清除，另一书保留']
    },
    threads: { foreshadowing: [], openQuestions: [] },
    budget: { wordTarget: 1000, chapterRange: [1, 1] },
    linkedTree: kind === 'volume' ? { treeKind: 'volume', scopeId: 'volume-1' } : null,
    children
  };
}
