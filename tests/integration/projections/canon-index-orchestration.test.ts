import { afterEach, describe, expect, it } from 'vitest';
import { CanonIndexService } from '../../../apps/api/src/application/projections/canon-index-service.js';
import { CanonService } from '../../../apps/api/src/application/knowledge/canon-service.js';
import { ChunkSnapshotRepository } from '../../../apps/api/src/infrastructure/db/repositories/chunk-snapshot-repository.js';
import { ProjectionTaskExecutor } from '../../../apps/worker/src/executors/projection-task-executor.js';
import { addApprovedChapter, createKnowledgeFixture } from '../../helpers/knowledge-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('正史结算后的全量检索快照', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('持久化索引请求，增量复用前章切片并只让最新正史水位生效', async () => {
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
    const firstMember = context.database.prepare(`SELECT member_snapshot_id FROM chunk_snapshot_memberships
      WHERE owner_id = ? AND book_id = ? AND manifest_snapshot_id = ? AND source_id = ?`)
      .get(fixture.scope.ownerId, fixture.scope.bookId, firstResult.snapshotId, fixture.manuscriptVersionId);

    const second = addApprovedChapter(context, ids, clock, fixture, 2, '李四在北塔重申盟约。');
    canon.settleChapter(fixture.scope, second.chapterId, second.manuscriptVersionId, { location: '北塔' });
    const secondRequest = claimLatest(context, fixture.scope, 'worker-index');
    const secondResult = new CanonIndexService(context.database, context.dataDir, ids, clock)
      .executeClaimed(fixture.scope, secondRequest, 'worker-index');

    expect(secondResult.status).toBe('completed');
    expect(context.database.prepare(`
      SELECT source_id FROM chunk_snapshot_memberships
      WHERE owner_id = ? AND book_id = ? AND manifest_snapshot_id = ? AND source_type = 'manuscript'
      ORDER BY source_id
    `).all(fixture.scope.ownerId, fixture.scope.bookId, secondResult.snapshotId)).toEqual([
      { source_id: fixture.manuscriptVersionId },
      { source_id: second.manuscriptVersionId }
    ]);
    expect(context.database.prepare(`SELECT member_snapshot_id FROM chunk_snapshot_memberships
      WHERE owner_id = ? AND book_id = ? AND manifest_snapshot_id = ? AND source_id = ?`)
      .get(fixture.scope.ownerId, fixture.scope.bookId, secondResult.snapshotId, fixture.manuscriptVersionId)).toEqual(firstMember);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM content_chunks WHERE owner_id = ? AND book_id = ?`)
      .get(fixture.scope.ownerId, fixture.scope.bookId)).toEqual({ count: 2 });
    expect(context.database.prepare(`
      SELECT projection_type, status FROM projection_outbox
      WHERE owner_id = ? AND book_id = ? AND source_snapshot_id = ? ORDER BY projection_type
    `).all(fixture.scope.ownerId, fixture.scope.bookId, secondResult.snapshotId)).toEqual([
      { projection_type: 'fts', status: 'pending' },
      { projection_type: 'vector', status: 'pending' }
    ]);
    const projectionWorker = new ProjectionTaskExecutor(context.database, 'worker-projection');
    expect(await projectionWorker.runNext(clock.now())).toBe(true);
    expect(await projectionWorker.runNext(clock.now())).toBe(true);
    expect(await projectionWorker.runNext(clock.now())).toBe(true);
    expect(new ChunkSnapshotRepository(context.database).requireWatermark(fixture.scope, 'fts')).toMatchObject({
      activeSnapshotId: secondResult.snapshotId, canonRevision: 2, status: 'ready'
    });
    expect(new ChunkSnapshotRepository(context.database).searchFts(fixture.scope, secondResult.snapshotId!, '北塔', 5)[0])
      .toMatchObject({ sourceId: second.manuscriptVersionId });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM projection_outbox WHERE owner_id = ? AND book_id = ?
      AND required_canon_revision = 1 AND status = 'superseded'`).get(fixture.scope.ownerId, fixture.scope.bookId))
      .toEqual({ count: 2 });
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
