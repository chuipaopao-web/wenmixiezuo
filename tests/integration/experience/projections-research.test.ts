import { afterEach, describe, expect, it } from 'vitest';
import { ChapterBatchService } from '../../../apps/api/src/application/creation/chapter-batch-service.js';
import { NarrativeProjectionService } from '../../../apps/api/src/application/projections/narrative-projection-service.js';
import { ResearchService } from '../../../apps/api/src/application/research/research-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('叙事投影与研究候选边界', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('情绪、主线、支线、钩子和信息差均分计划轨与实际轨并可重建', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '投影测试书', text: '测试五类叙事投影' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const batch = batches.scheduleNewChapters(scope, 1);
    await batches.run(scope, batch.batchId);
    const projections = new NarrativeProjectionService(context.database, ids, clock);
    expect(projections.rebuild(scope)).toBe(10);
    const firstSnapshot = context.database.prepare(`
      SELECT projection_type, track, chapter_number, canon_revision, content_json
      FROM narrative_projections WHERE owner_id = ? AND book_id = ? ORDER BY projection_type, track
    `).all(scope.ownerId, scope.bookId);
    expect(firstSnapshot).toHaveLength(10);
    expect(new Set((firstSnapshot as Array<{ projection_type: string }>).map((row) => row.projection_type))).toEqual(new Set(['emotion', 'mainline', 'subplot', 'hook', 'information_gap']));
    expect(new Set((firstSnapshot as Array<{ track: string }>).map((row) => row.track))).toEqual(new Set(['planned', 'actual']));
    context.database.prepare(`DELETE FROM narrative_projections WHERE owner_id = ? AND book_id = ?`).run(scope.ownerId, scope.bookId);
    projections.rebuild(scope);
    expect(context.database.prepare(`
      SELECT projection_type, track, chapter_number, canon_revision, content_json
      FROM narrative_projections WHERE owner_id = ? AND book_id = ? ORDER BY projection_type, track
    `).all(scope.ownerId, scope.bookId)).toEqual(firstSnapshot);
  });

  it('离线研究诚实返回不可用，来源主张只进入候选而不修改正史', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '研究甲书', text: '研究候选边界' });
    const second = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '研究乙书', text: '隔离研究来源' });
    const firstScope = { ownerId: context.config.ownerId, bookId: first.bookId };
    const secondScope = { ownerId: context.config.ownerId, bookId: second.bookId };
    const research = new ResearchService(context.database, ids, clock);
    expect(research.offlineStatus('本周热门题材')).toEqual(expect.objectContaining({ status: 'offline_unavailable', claimsApplied: false }));
    const sourceId = research.addProvidedSource(firstScope, {
      title: '老板提供的历史资料', content: '某地旧制在特定年代发生变化', language: 'zh-CN', credibility: 80, region: 'CN'
    });
    research.addCandidateClaim(firstScope, sourceId, '旧制可能影响人物行动', '老板提供资料中的年代说明');
    expect(context.database.prepare(`SELECT candidate_status FROM research_claims WHERE owner_id = ? AND book_id = ?`).all(firstScope.ownerId, firstScope.bookId)).toEqual([{ candidate_status: 'candidate' }]);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM research_claims WHERE owner_id = ? AND book_id = ?`).get(secondScope.ownerId, secondScope.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(firstScope.ownerId, firstScope.bookId)).toEqual({ canon_revision: 0 });
  });
});
