import { afterEach, describe, expect, it } from 'vitest';
import { CanonIndexService } from '../../../apps/api/src/application/projections/canon-index-service.js';
import { CanonService } from '../../../apps/api/src/application/knowledge/canon-service.js';
import { addApprovedChapter, createKnowledgeFixture } from '../../helpers/knowledge-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('正史结算后的全量检索快照', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('持久化索引请求，并在后续修订中保留前章正史来源', () => {
    context = createTestContext('wenmi-canon-index-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock, { content: '张三在天安城外立下盟约。' });
    const canon = new CanonService(context.database, ids, clock);

    canon.settleChapter(fixture.scope, fixture.chapterId, fixture.manuscriptVersionId, { location: '天安城' });
    const first = claimLatest(context, fixture.scope, 'worker-index');
    const firstResult = new CanonIndexService(context.database, context.dataDir, ids, clock)
      .executeClaimed(fixture.scope, first, 'worker-index');
    expect(firstResult).toMatchObject({ status: 'completed', sourceCount: 1 });

    const second = addApprovedChapter(context, ids, clock, fixture, 2, '李四在北塔重申盟约。');
    canon.settleChapter(fixture.scope, second.chapterId, second.manuscriptVersionId, { location: '北塔' });
    const secondRequest = claimLatest(context, fixture.scope, 'worker-index');
    const secondResult = new CanonIndexService(context.database, context.dataDir, ids, clock)
      .executeClaimed(fixture.scope, secondRequest, 'worker-index');

    expect(secondResult.status).toBe('completed');
    expect(context.database.prepare(`
      SELECT source_id FROM chunk_snapshot_sources
      WHERE owner_id = ? AND book_id = ? AND chunk_snapshot_id = ? AND source_type = 'manuscript'
      ORDER BY source_id
    `).all(fixture.scope.ownerId, fixture.scope.bookId, secondResult.snapshotId)).toEqual([
      { source_id: fixture.manuscriptVersionId },
      { source_id: second.manuscriptVersionId }
    ]);
    expect(context.database.prepare(`
      SELECT projection_type, status FROM projection_outbox
      WHERE owner_id = ? AND book_id = ? AND source_snapshot_id = ? ORDER BY projection_type
    `).all(fixture.scope.ownerId, fixture.scope.bookId, secondResult.snapshotId)).toEqual([
      { projection_type: 'fts', status: 'pending' },
      { projection_type: 'vector', status: 'pending' }
    ]);
  });

  it('旧修订请求不会覆盖新正史投影', () => {
    context = createTestContext('wenmi-canon-index-stale-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const canon = new CanonService(context.database, ids, clock);
    canon.settleChapter(fixture.scope, fixture.chapterId, fixture.manuscriptVersionId, {});
    const staleRequest = claimLatest(context, fixture.scope, 'worker-index');
    const second = addApprovedChapter(context, ids, clock, fixture, 2);
    canon.settleChapter(fixture.scope, second.chapterId, second.manuscriptVersionId, {});

    expect(new CanonIndexService(context.database, context.dataDir, ids, clock)
      .executeClaimed(fixture.scope, staleRequest, 'worker-index')).toEqual({
      status: 'superseded', snapshotId: null, sourceCount: 0
    });
    expect(context.database.prepare(`SELECT status FROM canon_index_requests WHERE canon_index_request_id = ?`)
      .get(staleRequest)).toEqual({ status: 'superseded' });
  });
});

function claimLatest(
  context: TestContext,
  scope: { ownerId: string; bookId: string },
  workerId: string
): string {
  const row = context.database.prepare(`
    SELECT canon_index_request_id FROM canon_index_requests
    WHERE owner_id = ? AND book_id = ? AND status = 'pending'
    ORDER BY canon_revision DESC LIMIT 1
  `).get(scope.ownerId, scope.bookId) as { canon_index_request_id: string };
  context.database.prepare(`
    UPDATE canon_index_requests SET status = 'claimed', worker_id = ?, attempts = attempts + 1
    WHERE canon_index_request_id = ?
  `).run(workerId, row.canon_index_request_id);
  return row.canon_index_request_id;
}
