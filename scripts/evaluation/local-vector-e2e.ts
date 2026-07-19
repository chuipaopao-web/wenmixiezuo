import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { DatabaseSync } from 'node:sqlite';
import { ChunkSnapshotService } from '../../apps/api/src/application/memory/chunk-snapshot-service.js';
import { HybridRetrievalService } from '../../apps/api/src/application/memory/hybrid-retrieval-service.js';
import { StructuralChunker } from '../../apps/api/src/application/memory/structural-chunker.js';
import { ProjectionJobService } from '../../apps/api/src/application/projections/projection-job-service.js';
import type { Clock, IdGenerator } from '../../apps/api/src/domain/ids.js';
import { bootstrapDatabase } from '../../apps/api/src/infrastructure/db/bootstrap.js';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { BookRepository } from '../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { ChunkSnapshotRepository } from '../../apps/api/src/infrastructure/db/repositories/chunk-snapshot-repository.js';
import { KnowledgeRepository } from '../../apps/api/src/infrastructure/db/repositories/knowledge-repository.js';
import { OwnerRepository } from '../../apps/api/src/infrastructure/db/repositories/owner-repository.js';
import { ProjectionRepository } from '../../apps/api/src/infrastructure/db/repositories/projection-repository.js';
import { RetrievalOrchestrationRepository } from '../../apps/api/src/infrastructure/db/repositories/retrieval-orchestration-repository.js';
import { UnitOfWork } from '../../apps/api/src/infrastructure/db/unit-of-work.js';
import { loadLocalRetrievalRuntime } from '../../apps/api/src/infrastructure/retrieval/local-retrieval-runtime.js';
import { loadRuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';
import { loadLocalVectorRuntime } from '../../apps/worker/src/adapters/local-vector-runtime.js';
import { ProjectionTaskExecutor } from '../../apps/worker/src/executors/projection-task-executor.js';

class FixedClock implements Clock {
  public now(): Date { return new Date('2026-07-19T12:00:00.000Z'); }
}
class SequenceIds implements IdGenerator {
  #value = 0;
  public next(): string { this.#value += 1; return `vector-e2e-${String(this.#value).padStart(6, '0')}`; }
}

const projectRoot = process.cwd();
const verificationDir = resolve(projectRoot, 'data', 'verification');
mkdirSync(verificationDir, { recursive: true });
const tempDataDir = mkdtempSync(resolve(verificationDir, 'local-vector-e2e-'));
const reportPath = resolve(verificationDir, 'local-vector-e2e.json');
let database: DatabaseSync | null = null;

try {
  const copyStarted = performance.now();
  cpSync(resolve(projectRoot, 'data', 'cache', 'models'), resolve(tempDataDir, 'cache', 'models'), { recursive: true });
  const config = loadRuntimeConfig({
    WENMI_PROJECT_ROOT: projectRoot,
    WENMI_DATA_DIR: tempDataDir,
    WENMI_OWNER_ID: 'runtime-verification',
    WENMI_MODEL_MODE: 'deterministic',
    WENMI_WORKER_TOKEN: 'runtime-vector-e2e-worker-token-000000000000'
  });
  database = openDatabase(config.databasePath);
  bootstrapDatabase(database, config);
  const clock = new FixedClock();
  const ids = new SequenceIds();
  const scope = { ownerId: config.ownerId, bookId: 'vector-e2e-book' };
  const isolatedScope = { ownerId: config.ownerId, bookId: 'vector-e2e-isolated' };
  const now = clock.now().toISOString();
  new OwnerRepository(database).ensure({ ownerId: scope.ownerId }, '本地向量验收作者', now);
  const books = new BookRepository(database);
  books.create(scope, '本地向量验收书', now, 'active');
  books.create(isolatedScope, '跨书隔离验收书', now, 'active');
  for (const [entityId, entityType, name] of [['entity-zhang', 'character', '张三'], ['entity-tianan', 'location', '天安城']] as const) {
    database.prepare(`
      INSERT INTO entities (entity_id, owner_id, book_id, entity_type, canonical_name, aliases_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '[]', 'active', ?, ?)
    `).run(entityId, scope.ownerId, scope.bookId, entityType, name, now, now);
  }

  const source = '张三依照王国宣战规则，向天安城递交战书。守军粮草只够七日。\n\n李四在河岸清点粮草，尚不知道城门已经关闭。';
  const chunks = new ChunkSnapshotService(
    new ChunkSnapshotRepository(database), new UnitOfWork(database), new StructuralChunker(), ids, clock
  );
  const built = chunks.build(scope, {
    sourceType: 'manuscript', sourceId: 'chapter-9', sourceVersion: 'canon-v1', content: source,
    sourceHash: createHash('sha256').update(source).digest('hex'), sourceLocator: { chapterId: 'chapter-9' },
    lifecycleLayer: 'canon', authorityGrade: 'A'
  }, 0);
  const jobs = new ProjectionJobService(new ProjectionRepository(database), new UnitOfWork(database), ids, clock);
  jobs.enqueue(scope, { projectionType: 'fts', sourceSnapshotId: built.snapshotId, requiredCanonRevision: 0, idempotencyKey: `fts:${built.snapshotId}` });
  jobs.enqueue(scope, { projectionType: 'vector', sourceSnapshotId: built.snapshotId, requiredCanonRevision: 0, idempotencyKey: `vector:${built.snapshotId}` });

  const workerRuntime = await loadLocalVectorRuntime(tempDataDir);
  assert(workerRuntime !== undefined, '本地Worker向量运行时未加载');
  const projectionStarted = performance.now();
  const executor = new ProjectionTaskExecutor(database, 'vector-e2e-worker', workerRuntime);
  assert(await executor.runNext(clock.now()), 'FTS投影任务未执行');
  assert(await executor.runNext(clock.now()), '向量投影任务未执行');
  const projectionMs = performance.now() - projectionStarted;

  const retrievalRuntime = loadLocalRetrievalRuntime(tempDataDir);
  assert(retrievalRuntime !== undefined, '本地API检索运行时未加载');
  const retrievalStarted = performance.now();
  const retrieval = await new HybridRetrievalService(
    new RetrievalOrchestrationRepository(database), new KnowledgeRepository(database),
    new ChunkSnapshotRepository(database), ids, clock, retrievalRuntime
  ).search(scope, {
    query: '张三今天要对天安城宣战，按照规则双方胜算如何？',
    roleKey: 'lead_screenwriter', mode: 'open_discussion', canonRevision: 0, limit: 8
  });
  const retrievalMs = performance.now() - retrievalStarted;
  const vectorChannel = retrieval.channels.find((channel) => channel.channel === 'vector');
  assert(vectorChannel?.status === 'ready' && vectorChannel.candidateCount > 0, '真实向量通道没有返回候选');
  assert(retrieval.hits.some((hit) => hit.content.includes('宣战规则')), '融合结果没有召回宣战规则正文');
  const noAnswer = await new HybridRetrievalService(
    new RetrievalOrchestrationRepository(database), new KnowledgeRepository(database),
    new ChunkSnapshotRepository(database), ids, clock, retrievalRuntime
  ).search(scope, {
    query: '草莓蛋糕应该用多少度烘焙？',
    roleKey: 'lead_screenwriter', mode: 'open_discussion', canonRevision: 0, limit: 8
  });
  assert(noAnswer.hits.length === 0, '无答案查询被向量近邻强行填充');
  const isolated = await new HybridRetrievalService(
    new RetrievalOrchestrationRepository(database), new KnowledgeRepository(database),
    new ChunkSnapshotRepository(database), ids, clock, retrievalRuntime
  ).search(isolatedScope, {
    query: '张三向天安城宣战', roleKey: 'lead_screenwriter', mode: 'open_discussion', canonRevision: 0, limit: 8
  });
  assert(isolated.hits.length === 0, '真实向量检索发生跨书泄漏');

  const manifest = database.prepare(`
    SELECT v.table_name, v.dimension, v.row_count, v.status, e.model_id, e.model_version, e.asset_hash
    FROM vector_index_manifests v
    JOIN embedding_model_snapshots e ON e.embedding_model_snapshot_id = v.embedding_model_snapshot_id
    WHERE v.owner_id = ? AND v.book_id = ? AND v.status = 'ready'
  `).get(scope.ownerId, scope.bookId) as {
    table_name: string; dimension: number; row_count: number; status: string;
    model_id: string; model_version: string; asset_hash: string;
  } | undefined;
  assert(manifest !== undefined && manifest.dimension === 512 && manifest.row_count === built.chunkCount, '向量manifest与真实模型或切片不一致');
  const report = {
    evidenceLevel: 'E1',
    evaluationMode: 'actual-local-model-lancedb-hybrid-retrieval',
    releaseId: config.releaseId,
    generatedAt: new Date().toISOString(),
    model: { id: manifest.model_id, revision: manifest.model_version, assetHash: manifest.asset_hash, dimension: manifest.dimension },
    projection: { snapshotId: built.snapshotId, chunkCount: built.chunkCount, tableName: manifest.table_name, status: manifest.status, milliseconds: Math.round(projectionMs) },
    retrieval: { channels: retrieval.channels, hitCount: retrieval.hits.length, topHitSourceId: retrieval.hits[0]?.sourceId ?? null,
      noAnswerHitCount: noAnswer.hits.length, vectorThresholdPolicy: 'bge-normalized-l2-v1', milliseconds: Math.round(retrievalMs) },
    isolation: { secondBookHitCount: isolated.hits.length },
    localOnly: true,
    remoteModelDownloadAllowed: false,
    copiedAssetMilliseconds: Math.round(performance.now() - copyStarted - projectionMs - retrievalMs),
    passed: true
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  database?.close();
  rmSync(tempDataDir, { recursive: true, force: true });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
