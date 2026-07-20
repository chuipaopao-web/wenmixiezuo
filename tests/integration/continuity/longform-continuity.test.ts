import { afterEach, describe, expect, it } from 'vitest';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { LongformContinuityRepository } from '../../../apps/api/src/infrastructure/db/repositories/longform-continuity-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { CommitmentService } from '../../../apps/api/src/application/continuity/commitment-service.js';
import { StageSettlementService } from '../../../apps/api/src/application/continuity/stage-settlement-service.js';
import { RollingPlanService } from '../../../apps/api/src/application/continuity/rolling-plan-service.js';

describe('超长篇连续性', () => {
  let context: TestContext | undefined;
  afterEach(() => { context?.close(); context = undefined; });

  it('开放承诺不会按固定章数遗忘，并能按来源解决', () => {
    context = createTestContext(); const ids = new SequenceIds(); const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock); const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const commitments = new CommitmentService(new LongformContinuityRepository(context.database), ids, clock);
    const opened = commitments.open(scope, { type: 'foreshadowing', title: '旧印记', description: '五百章后仍可能触发', entityIds: ['张三'],
      openedChapter: 1, sourceType: 'canon_chapter', sourceId: 'chapter-1', sourceHash: 'a'.repeat(64), sourceLocator: { paragraph: 2 }, authorityGrade: 'A' });
    expect(commitments.relevant(scope, 500).map((item) => item.commitmentId)).toContain(opened.commitmentId);
    commitments.resolve(scope, opened.commitmentId, 'chapter-501');
    expect(commitments.relevant(scope, 501)).toEqual([]);
  });

  it('阶段结算探针失败时保留上一活动版本，成功时原子切换', () => {
    context = createTestContext(); const ids = new SequenceIds(); const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock); const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const repository = new LongformContinuityRepository(context.database);
    const service = new StageSettlementService(repository, new UnitOfWork(context.database), ids, clock);
    const base = { stageType: 'volume' as const, stageKey: 'volume-1', chapterStart: 1, chapterEnd: 100, canonRevision: 10,
      payload: { irreversibleResults: ['城破'], entityStates: [], closedThreads: [], openThreads: ['复仇'], relationshipChanges: [], knowledgeChanges: [], resourceChanges: [], ruleChanges: [], exclusions: [] },
      sources: [{ sourceType: 'canon_volume', sourceId: 'volume-1', sourceHash: 'b'.repeat(64), locator: { chapters: [1, 100] } }] };
    const first = service.build(scope, { ...base, probes: [{ type: 'fact', expected: true, actual: true, passed: true }] });
    expect(first.activated).toBe(true);
    expect(() => service.build(scope, { ...base, canonRevision: 11, probes: [] }))
      .toThrow('至少一个可验证探针');
    const failed = service.build(scope, { ...base, canonRevision: 11, probes: [{ type: 'negative', expected: '无冲突', actual: '冲突', passed: false }] });
    expect(failed).toMatchObject({ activated: false, retainedPreviousId: first.settlementId });
    expect(repository.activeSettlement(scope, 'volume', 'volume-1')?.id).toBe(first.settlementId);
  });

  it('滚动规划只有重大变化才失效', () => {
    context = createTestContext(); const ids = new SequenceIds(); const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock); const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const repository = new LongformContinuityRepository(context.database); const plans = new RollingPlanService(repository, ids, clock);
    expect(plans.advance(scope, { currentChapter: 500, detailedChapters: 5, outlinedChapters: 20, plan: { arc: '北境' } })).toBe(1);
    expect(plans.invalidateForMaterialChange(scope, '措辞微调', false)).toBe(false);
    expect(repository.activeRollingPlan(scope)).not.toBeNull();
    expect(plans.invalidateForMaterialChange(scope, '主角目标改变', true)).toBe(true);
    expect(repository.activeRollingPlan(scope)).toBeNull();
  });
});
