import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ChunkSnapshotService } from '../../apps/api/src/application/memory/chunk-snapshot-service.js';
import { StructuralChunker } from '../../apps/api/src/application/memory/structural-chunker.js';
import { ChunkSnapshotRepository } from '../../apps/api/src/infrastructure/db/repositories/chunk-snapshot-repository.js';
import { UnitOfWork } from '../../apps/api/src/infrastructure/db/unit-of-work.js';
import { initializeRuntimeBook } from '../helpers/runtime-fixture.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('投影构建与原子切换故障恢复', () => {
  it('新快照探针失败时完整回滚并继续使用上一有效快照', () => {
    context = createTestContext('wenmi-projection-switch-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-one' };
    initializeRuntimeBook(context, scope, ids, clock, '故障书');
    const repository = new ChunkSnapshotRepository(context.database);
    const service = new ChunkSnapshotService(repository, new UnitOfWork(context.database), new StructuralChunker(), ids, clock);
    const input = (content: string, version: string) => ({
      sourceType: 'manuscript' as const, sourceId: 'chapter-1', sourceVersion: version, content,
      sourceHash: createHash('sha256').update(content).digest('hex'), sourceLocator: { chapterId: 'chapter-1' },
      lifecycleLayer: 'canon' as const, authorityGrade: 'A' as const
    });
    const first = service.build(scope, input('旧快照仍然有效。', 'v1'), 1);
    repository.switchWatermark(scope, { watermarkId: ids.next(), projectionType: 'fts', snapshotId: first.snapshotId, canonRevision: 1, now: clock.now().toISOString() });
    expect(() => service.build(scope, input('新快照探针失败。', 'v2'), 1, 'before_ready')).toThrow('simulated-snapshot-probe-failure');
    expect(repository.requireWatermark(scope, 'fts')).toMatchObject({ activeSnapshotId: first.snapshotId, previousSnapshotId: null });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM chunk_snapshots WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId))
      .toEqual({ count: 1 });
  });
});
