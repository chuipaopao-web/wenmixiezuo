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

  it('在同一ready快照中原子收录多个不可变来源且来源间邻接不串线', () => {
    context = createTestContext('wenmi-multi-source-snapshot-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-many' };
    initializeRuntimeBook(context, scope, ids, clock, '多来源长篇书');
    const repository = new ChunkSnapshotRepository(context.database);
    const service = new ChunkSnapshotService(repository, new UnitOfWork(context.database), new StructuralChunker(), ids, clock);
    const first = '第一章藏有硬锚点 ALPHA-CHAPTER。'.repeat(80);
    const second = '第二章藏有硬锚点 BETA-CHAPTER。'.repeat(80);
    const built = service.buildMany(scope, [
      { sourceType: 'manuscript', sourceId: 'chapter-a', sourceVersion: 'canon-v1', content: first,
        sourceHash: createHash('sha256').update(first).digest('hex'), sourceLocator: { chapter: 1 }, lifecycleLayer: 'canon', authorityGrade: 'A' },
      { sourceType: 'manuscript', sourceId: 'chapter-b', sourceVersion: 'canon-v1', content: second,
        sourceHash: createHash('sha256').update(second).digest('hex'), sourceLocator: { chapter: 2 }, lifecycleLayer: 'canon', authorityGrade: 'A' }
    ], 1);
    expect(context.database.prepare(`SELECT source_count, status FROM chunk_snapshots WHERE chunk_snapshot_id = ?`).get(built.snapshotId))
      .toEqual({ source_count: 2, status: 'ready' });
    expect(repository.searchFts(scope, built.snapshotId, 'ALPHA-CHAPTER', 5)[0]?.sourceId).toBe('chapter-a');
    expect(repository.searchFts(scope, built.snapshotId, 'BETA-CHAPTER', 5)[0]?.sourceId).toBe('chapter-b');
    const boundaryLinks = context.database.prepare(`SELECT COUNT(*) AS count FROM content_chunks a JOIN content_chunks b
      ON a.next_chunk_id = b.content_chunk_id WHERE a.chunk_snapshot_id = ? AND a.source_id <> b.source_id`).get(built.snapshotId);
    expect(boundaryLinks).toEqual({ count: 0 });
  });
});
