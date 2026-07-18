import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ChunkSnapshotService } from '../../../apps/api/src/application/memory/chunk-snapshot-service.js';
import { StructuralChunker } from '../../../apps/api/src/application/memory/structural-chunker.js';
import { ChunkSnapshotRepository } from '../../../apps/api/src/infrastructure/db/repositories/chunk-snapshot-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('不可变切片快照', () => {
  it('构建ready快照、FTS回链并按书原子切换水位', () => {
    context = createTestContext('wenmi-chunk-snapshot-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-one' };
    initializeRuntimeBook(context, scope, ids, clock, '长篇书');
    const repository = new ChunkSnapshotRepository(context.database);
    const service = new ChunkSnapshotService(repository, new UnitOfWork(context.database), new StructuralChunker(), ids, clock);
    const content = '张三在天安城外停下。\n\n他没有立刻宣战，而是先查看城防。';
    const built = service.build(scope, {
      sourceType: 'manuscript', sourceId: 'chapter-1', sourceVersion: 'canon-v1', content,
      sourceHash: createHash('sha256').update(content).digest('hex'), sourceLocator: { chapterId: 'chapter-1' },
      lifecycleLayer: 'canon', authorityGrade: 'A', title: '第一章', embeddingHeader: '正文 第一章'
    }, 1);
    expect(context.database.prepare(`SELECT status, chunk_count FROM chunk_snapshots WHERE chunk_snapshot_id = ?`).get(built.snapshotId))
      .toEqual({ status: 'ready', chunk_count: built.chunkCount });
    expect(repository.searchFts(scope, built.snapshotId, '张三', 5)).toEqual([
      expect.objectContaining({ text: expect.stringContaining('张三') })
    ]);
    const watermark = repository.switchWatermark(scope, {
      watermarkId: ids.next(), projectionType: 'fts', snapshotId: built.snapshotId, canonRevision: 1, now: clock.now().toISOString()
    });
    expect(watermark).toMatchObject({ activeSnapshotId: built.snapshotId, previousSnapshotId: null, status: 'ready' });
    expect(() => repository.searchFts({ ownerId: 'owner-one', bookId: 'other-book' }, built.snapshotId, '张三', 5)).not.toThrow();
    expect(repository.searchFts({ ownerId: 'owner-one', bookId: 'other-book' }, built.snapshotId, '张三', 5)).toEqual([]);
  });
});
