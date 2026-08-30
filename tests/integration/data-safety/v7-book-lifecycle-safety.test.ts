import { afterEach, describe, expect, it } from 'vitest';
import { V7_PLANNING_TREE_SCHEMA, type PlanningTreeDocument, type PlanningTreeNode } from '@wenmi/v7-backend';
import { BookLifecycleService } from '../../../apps/api/src/application/books/book-lifecycle-service.js';
import { V7PlanningTreeService } from '../../../apps/api/src/application/planning/v7-planning-tree-service.js';
import { requiredPermanentDeleteText } from '../../../apps/api/src/domain/permanent-delete.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { initializeV7Book } from '../../helpers/v7-book-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('V7 书籍生命周期与删除墓碑', () => {
  it('归档和恢复使用乐观版本，并保留 V7 内容', () => {
    context = createTestContext('wenmi-v7-book-archive-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const ownerId = 'owner-v7-lifecycle';
    const book = initializeV7Book(context, ownerId, ids, clock, { title: '归档恢复书' });
    const scope = { ownerId, bookId: book.bookId };
    const service = new BookLifecycleService(context.database, context.dataDir, ids, clock);
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
    const service = new BookLifecycleService(context.database, context.dataDir, ids, clock);
    const trees = new V7PlanningTreeService(context.database, ids, clock);
    trees.createCandidate(ownerId, target.bookId, 'book', target.bookId, {
      expectedRevision: 0,
      tree: bookTree(target.bookId),
      sourceRefs: [{ sourceKind: 'opening', sourceId: target.bookId, version: '1' }],
      idempotencyKey: 'v7-purge-tree-candidate-0001'
    });

    expect(() => service.permanentlyDelete(scope, requiredPermanentDeleteText(target.title, target.bookId)))
      .toThrow('只有已归档书籍可以永久删除');
    const archived = service.archive(scope, target.version);
    expect(() => service.permanentlyDelete(scope, '不是确认词')).toThrow('确认词不匹配');
    expect(new BookRepository(context.database).require(scope).status).toBe('archived');

    context.database.exec(`CREATE TABLE purge_v7_blockers(
      blocker_id TEXT PRIMARY KEY,
      referenced_book_id TEXT NOT NULL REFERENCES books(book_id)
    ) STRICT`);
    context.database.prepare('INSERT INTO purge_v7_blockers(blocker_id,referenced_book_id) VALUES(?,?)')
      .run('blocker-v7', target.bookId);
    expect(() => service.permanentlyDelete(scope, requiredPermanentDeleteText(target.title, target.bookId)))
      .toThrow('FOREIGN KEY constraint failed');
    expect(new BookRepository(context.database).require(scope).version).toBe(archived.version);
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM deletion_tombstones WHERE deleted_book_id=?')
      .get(target.bookId)).toEqual({ count: 0 });
    context.database.exec('DROP TABLE purge_v7_blockers');

    service.permanentlyDelete(scope, requiredPermanentDeleteText(target.title, target.bookId));
    expect(new BookRepository(context.database).find(scope)).toBeNull();
    expect(new BookRepository(context.database).require(survivorScope).title).toBe('保留书');
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM v7_planning_tree_heads WHERE owner_id=? AND book_id=?')
      .get(ownerId, target.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM positioning_drafts WHERE owner_id=? AND (proposed_book_id=? OR confirmed_book_id=?)')
      .get(ownerId, target.bookId, target.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM positioning_drafts WHERE confirmed_book_id=?')
      .get(survivor.bookId)).toEqual({ count: 1 });
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM deletion_tombstones WHERE owner_id=? AND deleted_book_id=?')
      .get(ownerId, target.bookId)).toEqual({ count: 1 });
    expect(context.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
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
