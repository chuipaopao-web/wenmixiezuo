import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { ChapterCatalogService } from '../../apps/api/src/application/chapters/chapter-catalog-service.js';
import { ChunkSnapshotService, type ChunkSourceInput } from '../../apps/api/src/application/memory/chunk-snapshot-service.js';
import { StructuralChunker } from '../../apps/api/src/application/memory/structural-chunker.js';
import type { Clock, IdGenerator } from '../../apps/api/src/domain/ids.js';
import type { BookScope } from '../../apps/api/src/domain/scope.js';
import { bootstrapDatabase } from '../../apps/api/src/infrastructure/db/bootstrap.js';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { BookRepository } from '../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { ChunkSnapshotRepository } from '../../apps/api/src/infrastructure/db/repositories/chunk-snapshot-repository.js';
import { OwnerRepository } from '../../apps/api/src/infrastructure/db/repositories/owner-repository.js';
import { UnitOfWork } from '../../apps/api/src/infrastructure/db/unit-of-work.js';
import { BackupService } from '../../apps/api/src/infrastructure/recovery/backup-service.js';
import { loadRuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';

const OWNER_ID = 'owner-local-boss';
const MAIN_BOOK_ID = 'scale-book-01';
const CHAPTER_COUNT = 1_500;
const TARGET_NORMALIZED_CHARACTERS = 5_000_000;
const ANCHOR_SAMPLE_SIZE = 120;

class FixedClock implements Clock {
  public now(): Date { return new Date('2026-07-19T03:00:00.000Z'); }
}

class SequenceIds implements IdGenerator {
  #value = 0;
  public next(): string {
    this.#value += 1;
    return `scale-${String(this.#value).padStart(8, '0')}`;
  }
}

interface ScaleReport {
  evidenceLevel: 'E2';
  evaluationMode: 'deterministic-offline-scale-replay';
  generatedAt: string;
  releaseId: string;
  corpus: {
    bookCount: number;
    mainBookChapterCount: number;
    mainBookVolumeCount: number;
    normalizedCharacterCount: number;
    sourceCount: number;
    chunkCount: number;
    workspaceWindowCount: number;
  };
  retrieval: {
    sampledAnchors: number;
    recallAt5: number;
    crossBookLeakageCount: number;
    restoredRecallAt5: number;
    p50Milliseconds: number;
    p95Milliseconds: number;
  };
  recovery: {
    deliberatelyDeletedFtsRows: number;
    rebuiltFtsRows: number;
    rebuildRecallAt5: number;
    backupId: string;
    backupDatabaseHash: string;
    restoredIntegrity: string;
    restoredForeignKeyViolations: number;
  };
  performance: {
    fixtureMilliseconds: number;
    snapshotBuildMilliseconds: number;
    ftsRebuildMilliseconds: number;
    backupAndRestoreMilliseconds: number;
    databaseBytes: number;
    residentSetBytesAtReport: number;
  };
  assertions: string[];
}

const verificationDirectory = resolve(process.cwd(), 'data', 'verification');
mkdirSync(verificationDirectory, { recursive: true });
const reportPath = resolve(verificationDirectory, 'final-scale-e2.json');
const temporaryRoot = mkdtempSync(resolve(verificationDirectory, 'full-scale-'));
let database: DatabaseSync | null = null;

try {
  const config = loadRuntimeConfig({
    WENMI_PROJECT_ROOT: process.cwd(),
    WENMI_DATA_DIR: temporaryRoot,
    WENMI_OWNER_ID: OWNER_ID,
    WENMI_MODEL_MODE: 'deterministic',
    WENMI_WORKER_TOKEN: 'scale-replay-worker-token-not-a-secret-000000000000'
  });
  database = openDatabase(config.databasePath);
  bootstrapDatabase(database, config);

  const clock = new FixedClock();
  const ids = new SequenceIds();
  const now = clock.now().toISOString();
  new OwnerRepository(database).ensure({ ownerId: OWNER_ID }, '规模回放作者', now);
  const books = new BookRepository(database);
  const chapters = new ChapterCatalogService(database, ids, clock);

  const fixtureStarted = performance.now();
  const scopes: BookScope[] = Array.from({ length: 5 }, (_, index) => ({
    ownerId: OWNER_ID,
    bookId: `scale-book-${String(index + 1).padStart(2, '0')}`
  }));
  for (const [index, scope] of scopes.entries()) books.create(scope, `规模隔离书${index + 1}`, now, 'active');

  const mainScope = scopes[0]!;
  const mainSources: ChunkSourceInput[] = [];
  let normalizedCharacterCount = 0;
  for (let volumeNumber = 1; volumeNumber <= 15; volumeNumber += 1) {
    const volumeId = chapters.createVolume(mainScope, volumeNumber, `第${volumeNumber}卷`);
    for (let offset = 1; offset <= 100; offset += 1) {
      const chapterNumber = (volumeNumber - 1) * 100 + offset;
      const chapter = chapters.createChapter(mainScope, volumeId, chapterNumber, `第${chapterNumber}章`);
      const targetLength = chapterNumber <= 500 ? 3_334 : 3_333;
      const anchor = scaleAnchor(chapterNumber);
      const content = fillToExactLength(`${anchor}。张三在天安城核对宣战规则。`, targetLength);
      normalizedCharacterCount += [...content.normalize('NFC')].length;
      mainSources.push(sourceFor(chapter.chapterId, chapterNumber, content));
    }
  }
  assert(normalizedCharacterCount === TARGET_NORMALIZED_CHARACTERS, `正文字符数应为${TARGET_NORMALIZED_CHARACTERS}，实际为${normalizedCharacterCount}`);
  assert(chapters.list(mainScope).length === CHAPTER_COUNT, '主书章节数不是1500');
  const fixtureMilliseconds = performance.now() - fixtureStarted;

  const repository = new ChunkSnapshotRepository(database);
  const snapshots = new ChunkSnapshotService(repository, new UnitOfWork(database), new StructuralChunker(), ids, clock);
  const snapshotStarted = performance.now();
  const built = snapshots.buildMany(mainScope, mainSources, 1);
  repository.switchWatermark(mainScope, {
    watermarkId: ids.next(), projectionType: 'fts', snapshotId: built.snapshotId, canonRevision: 1, now
  });
  const snapshotBuildMilliseconds = performance.now() - snapshotStarted;

  const isolatedSnapshots = new Map<string, string>();
  for (const [index, scope] of scopes.slice(1).entries()) {
    const secret = `ISOLATED-BOOK-${index + 2}-ONLY`;
    const isolated = snapshots.build(scope, sourceFor(`isolated-source-${index + 2}`, 1, `${secret}。此资料只属于第${index + 2}本书。`), 1);
    repository.switchWatermark(scope, {
      watermarkId: ids.next(), projectionType: 'fts', snapshotId: isolated.snapshotId, canonRevision: 1, now
    });
    isolatedSnapshots.set(scope.bookId, isolated.snapshotId);
  }

  const sampledChapters = distributedSample(CHAPTER_COUNT, ANCHOR_SAMPLE_SIZE);
  const initial = measureAnchorRecall(repository, mainScope, built.snapshotId, sampledChapters);
  let crossBookLeakageCount = 0;
  for (const [index, scope] of scopes.slice(1).entries()) {
    const isolatedSnapshotId = isolatedSnapshots.get(scope.bookId)!;
    crossBookLeakageCount += repository.searchFts(mainScope, built.snapshotId, `ISOLATED-BOOK-${index + 2}-ONLY`, 5).length;
    crossBookLeakageCount += repository.searchFts(scope, isolatedSnapshotId, scaleAnchor((index + 1) * 300), 5).length;
    crossBookLeakageCount += repository.searchFts(scope, built.snapshotId, scaleAnchor((index + 1) * 300), 5).length;
  }
  assert(initial.recall === 1, `初始锚点Recall@5不是100%：${initial.recall}`);
  assert(crossBookLeakageCount === 0, `发现跨书检索泄漏：${crossBookLeakageCount}`);
  const workspaceWindowCount = chapters.listWorkspaceWindow(mainScope, 80).length;
  assert(workspaceWindowCount === 80, `工作区窗口不是80章：${workspaceWindowCount}`);

  const deleted = database.prepare(`
    DELETE FROM content_chunks_fts WHERE owner_id = ? AND book_id = ? AND chunk_snapshot_id = ?
  `).run(mainScope.ownerId, mainScope.bookId, built.snapshotId).changes;
  assert(repository.searchFts(mainScope, built.snapshotId, scaleAnchor(1), 5).length === 0, '故障注入后FTS仍返回结果');
  const rebuildStarted = performance.now();
  const rebuiltFtsRows = repository.replaceFts(mainScope, built.snapshotId);
  const ftsRebuildMilliseconds = performance.now() - rebuildStarted;
  const rebuilt = measureAnchorRecall(repository, mainScope, built.snapshotId, sampledChapters);
  assert(rebuilt.recall === 1, `重建后锚点Recall@5不是100%：${rebuilt.recall}`);
  assert(rebuiltFtsRows === built.chunkCount, '重建行数与快照块数不一致');

  const recoveryStarted = performance.now();
  const backupService = new BackupService(database, config);
  const backup = backupService.create();
  const verified = backupService.verify(backup.backupId);
  const restoredDatabasePath = resolve(config.dataDir, verified.restorePath, 'database.sqlite');
  const restored = new DatabaseSync(restoredDatabasePath, { readOnly: true });
  let restoredIntegrity = '';
  let restoredForeignKeyViolations = -1;
  let restoredRecall = 0;
  try {
    restored.exec('PRAGMA foreign_keys = ON');
    restoredIntegrity = (restored.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    restoredForeignKeyViolations = restored.prepare('PRAGMA foreign_key_check').all().length;
    restoredRecall = measureAnchorRecall(new ChunkSnapshotRepository(restored), mainScope, built.snapshotId, sampledChapters).recall;
  } finally {
    restored.close();
  }
  const backupAndRestoreMilliseconds = performance.now() - recoveryStarted;
  assert(restoredIntegrity === 'ok', `恢复库完整性检查失败：${restoredIntegrity}`);
  assert(restoredForeignKeyViolations === 0, `恢复库存在外键错误：${restoredForeignKeyViolations}`);
  assert(restoredRecall === 1, `恢复库锚点Recall@5不是100%：${restoredRecall}`);

  database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const databaseBytes = statSync(config.databasePath).size;
  const report: ScaleReport = {
    evidenceLevel: 'E2',
    evaluationMode: 'deterministic-offline-scale-replay',
    generatedAt: new Date().toISOString(),
    releaseId: config.releaseId,
    corpus: {
      bookCount: scopes.length,
      mainBookChapterCount: CHAPTER_COUNT,
      mainBookVolumeCount: 15,
      normalizedCharacterCount,
      sourceCount: mainSources.length,
      chunkCount: built.chunkCount,
      workspaceWindowCount
    },
    retrieval: {
      sampledAnchors: sampledChapters.length,
      recallAt5: initial.recall,
      crossBookLeakageCount,
      restoredRecallAt5: restoredRecall,
      p50Milliseconds: percentile(initial.latencies, 0.5),
      p95Milliseconds: percentile(initial.latencies, 0.95)
    },
    recovery: {
      deliberatelyDeletedFtsRows: Number(deleted),
      rebuiltFtsRows,
      rebuildRecallAt5: rebuilt.recall,
      backupId: backup.backupId,
      backupDatabaseHash: verified.databaseHash,
      restoredIntegrity,
      restoredForeignKeyViolations
    },
    performance: {
      fixtureMilliseconds: round(fixtureMilliseconds),
      snapshotBuildMilliseconds: round(snapshotBuildMilliseconds),
      ftsRebuildMilliseconds: round(ftsRebuildMilliseconds),
      backupAndRestoreMilliseconds: round(backupAndRestoreMilliseconds),
      databaseBytes,
      residentSetBytesAtReport: process.memoryUsage.rss()
    },
    assertions: [
      '500万NFC规范化字符与1500章同书共存',
      '15卷与80章有界工作区窗口',
      '至少120个全书分布锚点Recall@5为100%',
      '5本书并存时跨书泄漏为0',
      'FTS整表故障后可由权威块重建并恢复100%召回',
      '隔离恢复库通过哈希、integrity_check、foreign_key_check及检索复验'
    ]
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  writeFileSync(reportPath, `${JSON.stringify({
    evidenceLevel: 'failed',
    evaluationMode: 'deterministic-offline-scale-replay',
    generatedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error)
  }, null, 2)}\n`, 'utf8');
  throw error;
} finally {
  database?.close();
  rmSync(temporaryRoot, { force: true, recursive: true });
}

function sourceFor(sourceId: string, chapterNumber: number, content: string): ChunkSourceInput {
  return {
    sourceType: 'manuscript',
    sourceId,
    sourceVersion: 'canon-v1',
    content,
    sourceHash: createHash('sha256').update(content).digest('hex'),
    sourceLocator: { chapterNumber },
    lifecycleLayer: 'canon',
    authorityGrade: 'A',
    title: `第${chapterNumber}章`,
    embeddingHeader: `正史正文｜第${chapterNumber}章`
  };
}

function fillToExactLength(prefix: string, targetLength: number): string {
  const filler = '雾城长路。旧约仍在。人物选择改变因果。';
  let value = prefix;
  while (value.length < targetLength) value += filler;
  return value.slice(0, targetLength);
}

function scaleAnchor(chapterNumber: number): string {
  return `SCALEANCHOR${String(chapterNumber).padStart(4, '0')}`;
}

function distributedSample(maximum: number, count: number): number[] {
  const values = new Set<number>([1, 500, 1_000, 1_500]);
  for (let index = 0; index < count; index += 1) {
    values.add(1 + Math.round((maximum - 1) * index / (count - 1)));
  }
  return [...values].sort((left, right) => left - right);
}

function measureAnchorRecall(repository: ChunkSnapshotRepository, scope: BookScope, snapshotId: string, chapters: number[]): { recall: number; latencies: number[] } {
  let hits = 0;
  const latencies: number[] = [];
  for (const chapterNumber of chapters) {
    const started = performance.now();
    const results = repository.searchFts(scope, snapshotId, scaleAnchor(chapterNumber), 5);
    latencies.push(performance.now() - started);
    if (results.some((result) => result.text.includes(scaleAnchor(chapterNumber)))) hits += 1;
  }
  return { recall: hits / chapters.length, latencies };
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0);
}

function round(value: number): number { return Math.round(value * 100) / 100; }

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
