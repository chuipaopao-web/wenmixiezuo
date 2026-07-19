import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HybridRetrievalService } from '../../../apps/api/src/application/memory/hybrid-retrieval-service.js';
import { ChunkSnapshotService } from '../../../apps/api/src/application/memory/chunk-snapshot-service.js';
import { StructuralChunker } from '../../../apps/api/src/application/memory/structural-chunker.js';
import { ProjectionJobService } from '../../../apps/api/src/application/projections/projection-job-service.js';
import { DeterministicEmbeddingAdapter } from '../../../apps/api/src/infrastructure/retrieval/embedding-adapter.js';
import { LanceDbVectorStore } from '../../../apps/api/src/infrastructure/retrieval/lancedb-vector-store.js';
import { ChunkSnapshotRepository } from '../../../apps/api/src/infrastructure/db/repositories/chunk-snapshot-repository.js';
import { ProjectionRepository } from '../../../apps/api/src/infrastructure/db/repositories/projection-repository.js';
import { RetrievalOrchestrationRepository } from '../../../apps/api/src/infrastructure/db/repositories/retrieval-orchestration-repository.js';
import { KnowledgeRepository } from '../../../apps/api/src/infrastructure/db/repositories/knowledge-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { ProjectionTaskExecutor } from '../../../apps/worker/src/executors/projection-task-executor.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('公开混合RAG运行链', () => {
  it('执行并保存四通道状态、向量候选、融合和跨书隔离', async () => {
    context = createTestContext('wenmi-hybrid-runtime-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const scope = { ownerId: 'owner-one', bookId: 'book-one' };
    const secondScope = { ownerId: 'owner-one', bookId: 'book-two' };
    initializeRuntimeBook(context, scope, ids, clock, '混合检索甲书');
    initializeRuntimeBook(context, secondScope, ids, clock, '混合检索乙书');
    const now = clock.now().toISOString();
    for (const [entityId, type, name] of [['zhang', 'character', '张三'], ['tianan', 'location', '天安城']] as const) {
      context.database.prepare(`
        INSERT INTO entities (entity_id, owner_id, book_id, entity_type, canonical_name, aliases_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '[]', 'active', ?, ?)
      `).run(entityId, scope.ownerId, scope.bookId, type, name, now, now);
    }
    const content = '张三依照王国宣战规则，向天安城递交战书。守军粮草只够七日。';
    const chunks = new ChunkSnapshotService(new ChunkSnapshotRepository(context.database), new UnitOfWork(context.database), new StructuralChunker(), ids, clock);
    const built = chunks.build(scope, {
      sourceType: 'manuscript', sourceId: 'chapter-9', sourceVersion: 'v1', content,
      sourceHash: createHash('sha256').update(content).digest('hex'), sourceLocator: { chapterId: 'chapter-9' },
      lifecycleLayer: 'canon', authorityGrade: 'A'
    }, 0);
    const jobs = new ProjectionJobService(new ProjectionRepository(context.database), new UnitOfWork(context.database), ids, clock);
    jobs.enqueue(scope, { projectionType: 'fts', sourceSnapshotId: built.snapshotId, requiredCanonRevision: 0, idempotencyKey: `fts:${built.snapshotId}` });
    jobs.enqueue(scope, { projectionType: 'vector', sourceSnapshotId: built.snapshotId, requiredCanonRevision: 0, idempotencyKey: `vector:${built.snapshotId}` });
    const embedding = new DeterministicEmbeddingAdapter(32);
    const store = new LanceDbVectorStore(resolve(context.dataDir, 'indexes', 'lance'));
    const executor = new ProjectionTaskExecutor(context.database, 'worker-hybrid', {
      embedding, store, indexPath: 'indexes/lance',
      model: { modelId: 'deterministic-test', modelVersion: '1', source: 'test', license: 'test-only', localPath: 'fixture',
        filesJson: '[]', tokenizerId: 'deterministic', normalized: true, queryInstruction: '', quantization: null, assetHash: 'b'.repeat(64) }
    });
    expect(await executor.runNext(clock.now())).toBe(true);
    expect(await executor.runNext(clock.now())).toBe(true);

    const repository = new RetrievalOrchestrationRepository(context.database);
    const knowledge = new KnowledgeRepository(context.database);
    const service = new HybridRetrievalService(repository, knowledge, new ChunkSnapshotRepository(context.database), ids, clock, {
      embedding, store, model: { modelId: 'deterministic-test', modelVersion: '1', assetHash: 'b'.repeat(64) }
    });
    const result = await service.search(scope, {
      query: '张三今天要对天安城宣战，胜算如何？', roleKey: 'lead_screenwriter', mode: 'open_discussion', canonRevision: 0, limit: 8
    });
    expect(result.plan).toMatchObject({ blocked: false, entitySeeds: expect.arrayContaining([
      expect.objectContaining({ canonicalName: '张三' }), expect.objectContaining({ canonicalName: '天安城' })
    ]) });
    expect(result.channels.map((channel) => channel.channel)).toEqual(['structured', 'fts', 'vector', 'relation']);
    expect(result.channels.find((channel) => channel.channel === 'vector')).toMatchObject({ status: 'ready', candidateCount: expect.any(Number) });
    expect(result.hits.some((hit) => hit.content.includes('宣战规则'))).toBe(true);
    expect((context.database.prepare(`SELECT COUNT(*) AS count FROM retrieval_candidates WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { count: number }).count).toBeGreaterThan(0);

    const isolated = await service.search(secondScope, {
      query: '张三对天安城宣战', roleKey: 'lead_screenwriter', mode: 'open_discussion', canonRevision: 0, limit: 8
    });
    expect(isolated.hits).toEqual([]);
    expect(isolated.channels.find((channel) => channel.channel === 'vector')?.status).toBe('degraded');
  });
});
