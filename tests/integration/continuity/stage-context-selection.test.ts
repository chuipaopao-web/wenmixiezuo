import { afterEach, describe, expect, it } from 'vitest';
import { StageSettlementService } from '../../../apps/api/src/application/continuity/stage-settlement-service.js';
import { LongformContinuityRepository } from '../../../apps/api/src/infrastructure/db/repositories/longform-continuity-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('分层阶段记忆选择', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('保留最近卷摘要、卷后故事弧和故事弧后的最近章节，而不是被旧卷摘要遮蔽', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '阶段上下文书',
      text: '测试分层阶段记忆'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const repository = new LongformContinuityRepository(context.database);
    const service = new StageSettlementService(repository, new UnitOfWork(context.database), ids, clock);
    build(service, scope, 'volume', 'volume-1', 1, 3, '旧卷结果');
    build(service, scope, 'story_arc', 'arc-1', 4, 6, '新故事弧结果');
    build(service, scope, 'chapter', 'chapter-7', 7, 7, '第七章结果');
    build(service, scope, 'chapter', 'chapter-8', 8, 8, '第八章结果');

    expect(repository.writerSettlementContext(scope, 9, 3).map((item) => ({
      type: item.stageType,
      end: item.chapterEnd
    }))).toEqual([
      { type: 'volume', end: 3 },
      { type: 'story_arc', end: 6 },
      { type: 'chapter', end: 8 }
    ]);
  });

  it('只有老板明确结束阶段后才把连续章节结算压缩成可回溯故事弧', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '阶段结算书',
      text: '测试剧情阶段结算'
    });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const repository = new LongformContinuityRepository(context.database);
    const service = new StageSettlementService(repository, new UnitOfWork(context.database), ids, clock);
    const now = clock.now().toISOString();
    context.database.prepare(`
      INSERT INTO volumes (
        volume_id, owner_id, book_id, volume_number, title, status, created_at, updated_at
      ) VALUES ('volume-stage-test', ?, ?, 1, '第一卷', 'active', ?, ?)
    `).run(scope.ownerId, scope.bookId, now, now);
    for (let chapterNumber = 1; chapterNumber <= 3; chapterNumber += 1) {
      context.database.prepare(`
        INSERT INTO chapters (
          chapter_id, owner_id, book_id, volume_id, chapter_number, title,
          plan_status, generation_status, settlement_status, version, created_at, updated_at
        ) VALUES (?, ?, ?, 'volume-stage-test', ?, ?, 'planned', 'completed', 'settled', 1, ?, ?)
      `).run(`chapter-${chapterNumber}`, scope.ownerId, scope.bookId, chapterNumber, `第${chapterNumber}章`, now, now);
      build(service, scope, 'chapter', `chapter-${chapterNumber}`, chapterNumber, chapterNumber, `第${chapterNumber}章结果`);
    }

    const closed = service.closeCurrentStoryArc(scope, '城门危机');
    expect(closed).toMatchObject({ chapterStart: 1, chapterEnd: 3 });
    const active = repository.writerSettlementContext(scope, 4, 3);
    expect(active[0]).toMatchObject({ stageType: 'story_arc', chapterStart: 1, chapterEnd: 3 });
    expect(() => service.closeCurrentStoryArc(scope, '重复结算')).toThrow('没有尚未结算');
  });
});

function build(
  service: StageSettlementService,
  scope: { ownerId: string; bookId: string },
  stageType: 'chapter' | 'story_arc' | 'volume',
  stageKey: string,
  chapterStart: number,
  chapterEnd: number,
  result: string
): void {
  service.build(scope, {
    stageType,
    stageKey,
    chapterStart,
    chapterEnd,
    canonRevision: 0,
    payload: {
      irreversibleResults: [result],
      entityStates: { location: `第${chapterEnd}章` },
      closedThreads: [],
      openThreads: [],
      relationshipChanges: [],
      knowledgeChanges: [],
      resourceChanges: [],
      ruleChanges: [],
      exclusions: []
    },
    sources: [{
      sourceType: 'test',
      sourceId: stageKey,
      sourceHash: String(chapterEnd).padStart(64, '0'),
      locator: { chapterStart, chapterEnd }
    }],
    probes: [{ type: 'source', expected: stageKey, actual: stageKey, passed: true }]
  });
}
