import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { ChunkSnapshotService, type ChunkSourceInput } from '../../apps/api/src/application/memory/chunk-snapshot-service.js';
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

interface GoldSet {
  version: string;
  frozenBeforeEvaluation: boolean;
  documents: Array<{ sourceId: string; content: string }>;
  queries: Array<{ id: string; kind: 'exact' | 'semantic' | 'no_answer'; query: string; relevant: string[] }>;
  thresholds: { hybridRecallAt5: number; hybridMrr: number; semanticRecallAt5: number; noAnswerAccuracy: number; crossBookLeakage: number };
}
class FixedClock implements Clock { public now(): Date { return new Date('2026-07-19T12:30:00.000Z'); } }
class SequenceIds implements IdGenerator { #value = 0; public next(): string { this.#value += 1; return `gold-${String(this.#value).padStart(7, '0')}`; } }

const root = process.cwd();
const fixturePath = resolve(root, 'tests', 'fixtures', 'retrieval-gold-v1.json');
const fixtureBytes = readFileSync(fixturePath);
const gold = JSON.parse(fixtureBytes.toString('utf8')) as GoldSet;
assert(gold.frozenBeforeEvaluation && gold.queries.length >= 10, '金标未冻结或样本不足');
const verificationDir = resolve(root, 'data', 'verification');
mkdirSync(verificationDir, { recursive: true });
const tempData = mkdtempSync(resolve(verificationDir, 'retrieval-gold-'));
const reportPath = resolve(verificationDir, 'retrieval-gold-evaluation.json');
let database: DatabaseSync | null = null;

try {
  cpSync(resolve(root, 'data', 'cache', 'models'), resolve(tempData, 'cache', 'models'), { recursive: true });
  const config = loadRuntimeConfig({ WENMI_PROJECT_ROOT: root, WENMI_DATA_DIR: tempData, WENMI_OWNER_ID: 'gold-owner',
    WENMI_MODEL_MODE: 'deterministic', WENMI_WORKER_TOKEN: 'gold-evaluation-worker-token-0000000000000' });
  database = openDatabase(config.databasePath);
  bootstrapDatabase(database, config);
  const clock = new FixedClock();
  const ids = new SequenceIds();
  const scope = { ownerId: config.ownerId, bookId: 'gold-book' };
  const isolatedScope = { ownerId: config.ownerId, bookId: 'gold-isolated-book' };
  const now = clock.now().toISOString();
  new OwnerRepository(database).ensure({ ownerId: scope.ownerId }, '检索金标作者', now);
  const books = new BookRepository(database);
  books.create(scope, '检索金标书', now, 'active');
  books.create(isolatedScope, '隔离干扰书', now, 'active');
  const sourceInputs: ChunkSourceInput[] = gold.documents.map((document) => ({
    sourceType: 'manuscript', sourceId: document.sourceId, sourceVersion: 'canon-v1', content: document.content,
    sourceHash: createHash('sha256').update(document.content).digest('hex'), sourceLocator: { fixtureId: document.sourceId },
    lifecycleLayer: 'canon', authorityGrade: 'A'
  }));
  const chunks = new ChunkSnapshotService(new ChunkSnapshotRepository(database), new UnitOfWork(database), new StructuralChunker(), ids, clock);
  const built = chunks.buildMany(scope, sourceInputs, 0);
  const isolatedText = '这段隔离资料只属于第二本书，不得出现在主书查询中。';
  const isolated = chunks.build(isolatedScope, {
    sourceType: 'manuscript', sourceId: 'isolated-only', sourceVersion: 'canon-v1', content: isolatedText,
    sourceHash: createHash('sha256').update(isolatedText).digest('hex'), sourceLocator: { fixtureId: 'isolated-only' },
    lifecycleLayer: 'canon', authorityGrade: 'A'
  }, 0);
  const jobs = new ProjectionJobService(new ProjectionRepository(database), new UnitOfWork(database), ids, clock);
  for (const [target, snapshotId] of [[scope, built.snapshotId], [isolatedScope, isolated.snapshotId]] as const) {
    jobs.enqueue(target, { projectionType: 'fts', sourceSnapshotId: snapshotId, requiredCanonRevision: 0, idempotencyKey: `fts:${snapshotId}` });
    jobs.enqueue(target, { projectionType: 'vector', sourceSnapshotId: snapshotId, requiredCanonRevision: 0, idempotencyKey: `vector:${snapshotId}` });
  }
  const workerRuntime = await loadLocalVectorRuntime(tempData);
  assert(workerRuntime !== undefined, '本地向量Worker不可用');
  const executor = new ProjectionTaskExecutor(database, 'gold-worker', workerRuntime);
  for (let index = 0; index < 4; index += 1) assert(await executor.runNext(clock.now()), `第${index + 1}个投影任务未执行`);
  const runtime = loadLocalRetrievalRuntime(tempData);
  assert(runtime !== undefined, '本地检索运行时不可用');
  const service = new HybridRetrievalService(new RetrievalOrchestrationRepository(database), new KnowledgeRepository(database),
    new ChunkSnapshotRepository(database), ids, clock, runtime);
  const rows: Array<Record<string, unknown>> = [];
  for (const query of gold.queries) {
    const result = await service.search(scope, { query: query.query, roleKey: 'lead_screenwriter', mode: 'open_discussion', canonRevision: 0, limit: 5 });
    const hybrid = result.hits.map((hit) => hit.sourceId);
    const channelRows = database.prepare(`
      SELECT channel, source_id, channel_rank FROM retrieval_candidates
      WHERE owner_id = ? AND book_id = ? AND retrieval_query_plan_id = ?
      ORDER BY channel, channel_rank
    `).all(scope.ownerId, scope.bookId, result.plan.planId) as unknown as Array<{ channel: string; source_id: string; channel_rank: number }>;
    rows.push({ id: query.id, kind: query.kind, relevant: query.relevant, hybrid,
      fts: channelRows.filter((row) => row.channel === 'fts').map((row) => row.source_id),
      vector: channelRows.filter((row) => row.channel === 'vector').map((row) => row.source_id) });
  }
  const answerable = rows.filter((row) => row.kind !== 'no_answer');
  const semantic = rows.filter((row) => row.kind === 'semantic');
  const noAnswer = rows.filter((row) => row.kind === 'no_answer');
  const metrics = {
    hybridRecallAt5: recallAt(answerable, 'hybrid', 5),
    hybridMrr: mrr(answerable, 'hybrid'),
    ftsRecallAt5: recallAt(answerable, 'fts', 5),
    vectorRecallAt5: recallAt(answerable, 'vector', 5),
    semanticHybridRecallAt5: recallAt(semantic, 'hybrid', 5),
    semanticVectorRecallAt5: recallAt(semantic, 'vector', 5),
    noAnswerAccuracy: noAnswer.filter((row) => (row.hybrid as string[]).length === 0).length / noAnswer.length,
    crossBookLeakage: 0
  };
  const isolatedQuery = await service.search(isolatedScope, { query: gold.documents[0]!.content, roleKey: 'lead_screenwriter', mode: 'open_discussion', canonRevision: 0, limit: 5 });
  metrics.crossBookLeakage = isolatedQuery.hits.filter((hit) => hit.sourceId !== 'isolated-only').length;
  const failures = [
    metricFailure('hybridRecallAt5', metrics.hybridRecallAt5, gold.thresholds.hybridRecallAt5),
    metricFailure('hybridMrr', metrics.hybridMrr, gold.thresholds.hybridMrr),
    metricFailure('semanticHybridRecallAt5', metrics.semanticHybridRecallAt5, gold.thresholds.semanticRecallAt5),
    metricFailure('noAnswerAccuracy', metrics.noAnswerAccuracy, gold.thresholds.noAnswerAccuracy),
    metrics.crossBookLeakage === gold.thresholds.crossBookLeakage ? null : `crossBookLeakage=${metrics.crossBookLeakage}`
  ].filter((value): value is string => value !== null);
  const report = { evidenceLevel: 'E3-retrieval-candidate', releaseId: config.releaseId, generatedAt: new Date().toISOString(),
    fixture: { version: gold.version, sha256: createHash('sha256').update(fixtureBytes).digest('hex'), queryCount: gold.queries.length,
      documentCount: gold.documents.length, frozenBeforeEvaluation: gold.frozenBeforeEvaluation, independentHumanEvaluator: false },
    model: runtime.model, thresholdPolicy: 'bge-normalized-l2-v1', metrics, thresholds: gold.thresholds,
    ablation: { ftsRecallAt5: metrics.ftsRecallAt5, vectorRecallAt5: metrics.vectorRecallAt5, hybridRecallAt5: metrics.hybridRecallAt5 },
    failures, passed: failures.length === 0, rows };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failures.length > 0) process.exitCode = 1;
} finally {
  database?.close();
  rmSync(tempData, { recursive: true, force: true });
}

function ranked(row: Record<string, unknown>, key: string): string[] { return row[key] as string[]; }
function relevant(row: Record<string, unknown>): Set<string> { return new Set(row.relevant as string[]); }
function recallAt(rows: Array<Record<string, unknown>>, key: string, k: number): number {
  return rows.reduce((sum, row) => sum + (ranked(row, key).slice(0, k).some((id) => relevant(row).has(id)) ? 1 : 0), 0) / Math.max(1, rows.length);
}
function mrr(rows: Array<Record<string, unknown>>, key: string): number {
  return rows.reduce((sum, row) => { const index = ranked(row, key).findIndex((id) => relevant(row).has(id)); return sum + (index < 0 ? 0 : 1 / (index + 1)); }, 0) / Math.max(1, rows.length);
}
function metricFailure(name: string, actual: number, minimum: number): string | null { return actual + 1e-12 >= minimum ? null : `${name}=${actual.toFixed(4)}<${minimum}`; }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
