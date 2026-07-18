import { afterEach, describe, expect, it } from 'vitest';
import { ProjectionJobService } from '../../../apps/api/src/application/projections/projection-job-service.js';
import { ProjectionRepository } from '../../../apps/api/src/infrastructure/db/repositories/projection-repository.js';
import { ChunkSnapshotRepository } from '../../../apps/api/src/infrastructure/db/repositories/chunk-snapshot-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { ChunkSnapshotService } from '../../../apps/api/src/application/memory/chunk-snapshot-service.js';
import { StructuralChunker } from '../../../apps/api/src/application/memory/structural-chunker.js';
import { ProjectionTaskExecutor } from '../../../apps/worker/src/executors/projection-task-executor.js';
import { createHash } from 'node:crypto';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('投影outbox与独立故障状态', () => {
  it('幂等入队且失败不会伪造ready', () => {
    context = createTestContext('wenmi-projection-jobs-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-one' };
    initializeRuntimeBook(context, scope, ids, clock, '投影书');
    const service = new ProjectionJobService(new ProjectionRepository(context.database), new UnitOfWork(context.database), ids, clock);
    const enqueued = service.enqueue(scope, { projectionType: 'vector', sourceSnapshotId: 'snapshot-1', requiredCanonRevision: 1, idempotencyKey: 'vector:snapshot-1' });
    expect(service.enqueue(scope, { projectionType: 'vector', sourceSnapshotId: 'snapshot-1', requiredCanonRevision: 1, idempotencyKey: 'vector:snapshot-1' }))
      .toEqual({ outboxId: enqueued.outboxId, created: false });
    expect(service.run(scope, enqueued.outboxId, 'worker-1', () => { throw new Error('asset missing'); }).status).toBe('failed');
    expect(context.database.prepare(`SELECT status FROM projection_outbox WHERE projection_outbox_id = ?`).get(enqueued.outboxId)).toEqual({ status: 'failed' });
  });

  it('Worker只在来源ready且探针通过后切换FTS水位', () => {
    context = createTestContext('wenmi-projection-worker-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-one' };
    initializeRuntimeBook(context, scope, ids, clock, '投影执行书');
    const content = '张三在天安城外确认了旧约。';
    const chunks = new ChunkSnapshotService(new ChunkSnapshotRepository(context.database), new UnitOfWork(context.database), new StructuralChunker(), ids, clock);
    const built = chunks.build(scope, {
      sourceType: 'manuscript', sourceId: 'chapter-1', sourceVersion: 'v1', content,
      sourceHash: createHash('sha256').update(content).digest('hex'), sourceLocator: { chapterId: 'chapter-1' },
      lifecycleLayer: 'canon', authorityGrade: 'A'
    }, 1);
    const jobs = new ProjectionJobService(new ProjectionRepository(context.database), new UnitOfWork(context.database), ids, clock);
    jobs.enqueue(scope, { projectionType: 'fts', sourceSnapshotId: built.snapshotId, requiredCanonRevision: 1, idempotencyKey: `fts:${built.snapshotId}` });
    expect(new ProjectionTaskExecutor(context.database, 'worker-test').runNext(clock.now())).toBe(true);
    expect(new ChunkSnapshotRepository(context.database).requireWatermark(scope, 'fts')).toMatchObject({ activeSnapshotId: built.snapshotId, canonRevision: 1, status: 'ready' });
  });
});
