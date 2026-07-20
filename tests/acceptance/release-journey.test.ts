import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentTeamService } from '../../apps/api/src/application/agents/agent-team-service.js';
import { ConversationService } from '../../apps/api/src/application/chat/conversation-service.js';
import { ChapterBatchService } from '../../apps/api/src/application/creation/chapter-batch-service.js';
import { EditorLeaseService } from '../../apps/api/src/application/editors/editor-lease-service.js';
import { CanonService } from '../../apps/api/src/application/knowledge/canon-service.js';
import { MemoryService } from '../../apps/api/src/application/memory/memory-service.js';
import { RetrievalService } from '../../apps/api/src/application/memory/retrieval-service.js';
import { NarrativeProjectionService } from '../../apps/api/src/application/projections/narrative-projection-service.js';
import { sha256File } from '../../apps/api/src/infrastructure/files/file-utils.js';
import { BackupService } from '../../apps/api/src/infrastructure/recovery/backup-service.js';
import { TaskService } from '../../apps/api/src/application/tasks/task-service.js';
import { approvePendingManuscript, initializeDomainBook, prepareBookForWriting } from '../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../helpers/test-context.js';

describe('首版全链路验收旅程', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('两书严格隔离，主测试书中断接管后连续完成5章并可干净恢复', async () => {
    context = createTestContext('wenmi-acceptance-journey-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const ownerId = context.config.ownerId;
    const mainBook = initializeDomainBook(context, ownerId, ids, clock, { title: '主验收书', text: '失忆守城人追查钟声后的未来罪案' });
    const secondBook = initializeDomainBook(context, ownerId, ids, clock, { title: '隔离验收书', text: '海岛药师追查潮汐改变的原因' });
    const mainScope = { ownerId, bookId: mainBook.bookId };
    const secondScope = { ownerId, bookId: secondBook.bookId };
    prepareBookForWriting(context, mainScope, ids, clock, 5);
    prepareBookForWriting(context, secondScope, ids, clock, 1);

    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    conversations.sendBossMessage(mainScope, '主书秘密 MAIN-ONLY-MESSAGE');
    conversations.sendBossMessage(secondScope, '乙书秘密 SECOND-ONLY-MESSAGE');
    expect(JSON.stringify(conversations.listMessages(mainScope))).not.toContain('SECOND-ONLY-MESSAGE');
    expect(JSON.stringify(conversations.listMessages(secondScope))).not.toContain('MAIN-ONLY-MESSAGE');
    const taskService = new TaskService(context.database, context.config.releaseId, clock);
    for (const scope of [mainScope, secondScope]) {
      for (const task of taskService.list(scope).filter((item) => item.taskType === 'conversation_reply')) taskService.requestCancel(scope, task.taskId);
    }

    const memory = new MemoryService(context.database, ids, clock);
    memory.remember(mainScope, { layer: 'story_bible', content: '主书硬锚 MAIN-ONLY-ANCHOR', sourceType: 'acceptance', sourceId: 'main-anchor', canonRevision: 0, positioningVersion: 1 });
    memory.remember(secondScope, { layer: 'story_bible', content: '乙书硬锚 SECOND-ONLY-ANCHOR', sourceType: 'acceptance', sourceId: 'second-anchor', canonRevision: 0, positioningVersion: 1 });
    const retrieval = new RetrievalService(context.database, ids, clock);
    expect(retrieval.search(mainScope, 'SECOND-ONLY-ANCHOR', { canonRevision: 0 })).toEqual([]);
    expect(retrieval.search(secondScope, 'MAIN-ONLY-ANCHOR', { canonRevision: 0 })).toEqual([]);

    const batches = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const mainBatch = batches.scheduleNewChapters(mainScope, 5, { firstChapterTitle: '第一声雾钟' });
    const firstGenerated = await batches.run(mainScope, mainBatch.batchId);
    approvePendingManuscript(context, mainScope, ids, clock);
    const secondGenerated = await batches.run(mainScope, mainBatch.batchId);
    approvePendingManuscript(context, mainScope, ids, clock);
    const interrupted = await batches.run(mainScope, mainBatch.batchId);
    expect(interrupted.batch).toMatchObject({ status: 'paused', nextIndex: 2 });

    const canon = new CanonService(context.database, ids, clock);
    const decisionEntityId = canon.createEntity(mainScope, { entityType: 'item', canonicalName: '未决钟锤' });
    const pending = canon.proposeFact(mainScope, {
      subjectEntityId: decisionEntityId, relationKey: 'destroyed', value: true,
      evidence: [{ chapter: 2, location: '章末' }], grade: 'D',
      sourceChapterId: mainBatch.chapterIds[1]!, sourceManuscriptVersionId: secondGenerated.results[0]!.manuscriptVersionId
    });
    const team = new AgentTeamService(context.database, ids, clock).list(mainScope);
    const editors = new EditorLeaseService(context.database, ids, clock);
    const beforeTakeover = editors.require(mainScope);
    const candidate = team.find((agent) => agent.category === 'core' && agent.agentId !== beforeTakeover.activeEditorAgentId)!;
    const takeover = editors.prepareTakeover(mainScope, candidate.agentId);
    expect((takeover.package.chapters as unknown[])).toHaveLength(5);
    expect((takeover.package.pendingDecisions as unknown[])).toHaveLength(2);
    const afterTakeover = editors.completeTakeover(mainScope, takeover.takeoverId);
    expect(afterTakeover.editorEpoch).toBe(beforeTakeover.editorEpoch + 1);
    expect(() => editors.assertEpoch(mainScope, beforeTakeover.activeEditorAgentId, beforeTakeover.editorEpoch)).toThrow('旧指令被拒绝');
    canon.resolveConfirmation(mainScope, pending.confirmationId!, 2, false);

    const laterResults = [...firstGenerated.results, ...secondGenerated.results, ...interrupted.results];
    for (let chapter = 3; chapter <= 5; chapter += 1) {
      approvePendingManuscript(context, mainScope, ids, clock);
      const next = await batches.run(mainScope, mainBatch.batchId);
      laterResults.push(...next.results);
    }
    const resumed = { batch: batches.require(mainScope, mainBatch.batchId), results: laterResults };
    expect(resumed.batch).toMatchObject({ status: 'completed', nextIndex: 5 });
    expect(resumed.results).toHaveLength(5);
    const secondBatch = batches.scheduleNewChapters(secondScope, 1, { firstChapterTitle: '潮线之外' });
    expect((await batches.run(secondScope, secondBatch.batchId)).batch.status).toBe('paused');
    approvePendingManuscript(context, secondScope, ids, clock);
    expect((await batches.run(secondScope, secondBatch.batchId)).batch.status).toBe('completed');

    const settled = context.database.prepare(`
      SELECT book_id, COUNT(*) AS count FROM chapters
      WHERE owner_id = ? AND settlement_status = 'settled' GROUP BY book_id ORDER BY book_id
    `).all(ownerId) as unknown as Array<{ book_id: string; count: number }>;
    expect(settled.find((row) => row.book_id === mainBook.bookId)?.count).toBe(5);
    expect(settled.find((row) => row.book_id === secondBook.bookId)?.count).toBe(1);
    const mainWords = context.database.prepare(`
      SELECT word_count FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND status = 'canon'
    `).all(ownerId, mainBook.bookId) as unknown as Array<{ word_count: number }>;
    expect(mainWords).toHaveLength(5);
    expect(mainWords.every((row) => row.word_count >= 2_500 && row.word_count <= 3_500)).toBe(true);

    const mainFileRows = context.database.prepare(`
      SELECT relative_path, content_hash FROM file_registry WHERE owner_id = ? AND book_id = ? AND status = 'active'
    `).all(ownerId, mainBook.bookId) as unknown as Array<{ relative_path: string; content_hash: string }>;
    const secondFileRows = context.database.prepare(`
      SELECT relative_path, content_hash FROM file_registry WHERE owner_id = ? AND book_id = ? AND status = 'active'
    `).all(ownerId, secondBook.bookId) as unknown as Array<{ relative_path: string; content_hash: string }>;
    expect(mainFileRows).not.toHaveLength(0);
    expect(secondFileRows).not.toHaveLength(0);
    expect(mainFileRows.every((row) => row.relative_path.includes(mainBook.bookId) && sha256File(resolve(context!.dataDir, row.relative_path)) === row.content_hash)).toBe(true);
    expect(secondFileRows.every((row) => row.relative_path.includes(secondBook.bookId) && sha256File(resolve(context!.dataDir, row.relative_path)) === row.content_hash)).toBe(true);
    const mainPaths = new Set(mainFileRows.map((row) => row.relative_path));
    expect(secondFileRows.every((row) => !mainPaths.has(row.relative_path))).toBe(true);

    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE context_pack_id IS NULL`).get()).toEqual({ count: 0 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND book_id = ? AND required_editor_epoch <> ? AND status NOT IN ('succeeded','failed','cancelled')`)
      .get(ownerId, mainBook.bookId, afterTakeover.editorEpoch)).toEqual({ count: 0 });
    expect(new NarrativeProjectionService(context.database, ids, clock).rebuild(mainScope)).toBe(50);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM narrative_projections WHERE owner_id = ? AND book_id = ?`).get(ownerId, secondBook.bookId)).toEqual({ count: 10 });

    const backupService = new BackupService(context.database, context.config);
    const backup = backupService.create();
    const verification = backupService.verify(backup.backupId);
    expect(backup.fileCount).toBe(mainFileRows.length + secondFileRows.length);
    const restoredDatabasePath = resolve(context.dataDir, verification.restorePath, 'database.sqlite');
    const restored = new DatabaseSync(restoredDatabasePath, { readOnly: true });
    try {
      expect(restored.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(restored.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(restored.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(ownerId, mainBook.bookId)).toEqual({ canon_revision: 5 });
      expect(restored.prepare(`SELECT COUNT(*) AS count FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND status = 'canon'`).get(ownerId, mainBook.bookId)).toEqual({ count: 5 });
      expect(restored.prepare(`SELECT COUNT(*) AS count FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND status = 'canon'`).get(ownerId, secondBook.bookId)).toEqual({ count: 1 });
    } finally {
      restored.close();
      backupService.discardVerification(verification.restorePath);
    }

    const manifestPath = resolve(context.dataDir, 'backups', backup.backupId, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { files: unknown[]; databaseHash: string };
    expect(manifest.files).toHaveLength(backup.fileCount);
    expect(manifest.databaseHash).toHaveLength(64);
  }, 30_000);
});
