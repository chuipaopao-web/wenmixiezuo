import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { success } from '../contracts/api.js';
import { SystemClock, UuidGenerator } from '../domain/ids.js';
import { PositioningService } from '../application/books/positioning-service.js';
import { BookOnboardingService } from '../application/books/book-onboarding-service.js';
import { BookLifecycleService } from '../application/books/book-lifecycle-service.js';
import { BookRepository } from '../infrastructure/db/repositories/book-repository.js';
import { AgentTeamService } from '../application/agents/agent-team-service.js';
import { ArtifactService, type ArtifactType } from '../application/artifacts/artifact-service.js';
import { DiscussionService, type DiscussionType } from '../application/discussions/discussion-service.js';
import type { RuntimeConfig } from '../infrastructure/runtime-config.js';
import { ChapterCatalogService } from '../application/chapters/chapter-catalog-service.js';
import { CanonService, type FactInput } from '../application/knowledge/canon-service.js';
import { MemoryService, type MemoryLayer } from '../application/memory/memory-service.js';
import { RetrievalService } from '../application/memory/retrieval-service.js';
import { ContextPackService, type ContextPackInput } from '../application/memory/context-pack-service.js';
import { ChapterBatchService } from '../application/creation/chapter-batch-service.js';
import { resolveInside } from '../infrastructure/files/file-utils.js';
import { NarrativeProjectionService, type NarrativeProjectionType } from '../application/projections/narrative-projection-service.js';
import { CopyrightService, type RightsPath } from '../application/copyright/copyright-service.js';
import { ResearchService } from '../application/research/research-service.js';
import { ConversationService } from '../application/chat/conversation-service.js';
import { TaskService } from '../application/tasks/task-service.js';
import { BackupService } from '../infrastructure/recovery/backup-service.js';
import { cancelActiveModelCall } from '../application/calls/model-call-service.js';
import { cancelActiveToolCall } from '../application/calls/tool-call-service.js';
import { ModelAdapterFactory } from '../infrastructure/models/model-adapter-factory.js';
import { PlanningArtifactService } from '../application/artifacts/planning-artifact-service.js';

export async function registerDomainRoutes(app: FastifyInstance, database: DatabaseSync, config: RuntimeConfig): Promise<void> {
  const ids = new UuidGenerator();
  const clock = new SystemClock();
  const modelAdapters = new ModelAdapterFactory(config.modelRuntime);
  const owner = { ownerId: config.ownerId };
  const positioning = new PositioningService(database, ids, clock);
  const onboarding = new BookOnboardingService(database, ids, clock, config.modelRuntime.roleProfiles);
  const lifecycle = new BookLifecycleService(database, config.dataDir, ids, clock);
  const books = new BookRepository(database);
  const agents = new AgentTeamService(database, ids, clock, config.modelRuntime.roleProfiles);
  const artifacts = new ArtifactService(database, ids, clock);
  const discussions = new DiscussionService(database, ids, clock);
  const chapters = new ChapterCatalogService(database, ids, clock);
  const canon = new CanonService(database, ids, clock);
  const memory = new MemoryService(database, ids, clock);
  const retrieval = new RetrievalService(database, ids, clock);
  const contextPacks = new ContextPackService(database, ids, clock);
  const chapterBatches = new ChapterBatchService(database, config.dataDir, config.releaseId, ids, clock, modelAdapters);
  const projections = new NarrativeProjectionService(database, ids, clock);
  const copyright = new CopyrightService(database, ids, clock);
  const research = new ResearchService(database, ids, clock);
  const conversations = new ConversationService(database, config.dataDir, config.releaseId, ids, clock);
  const tasks = new TaskService(database, config.releaseId, clock);
  const backups = new BackupService(database, config);

  app.post<{ Body: {
    title?: string; text: string; category?: string; classification?: string;
    targetAudience?: string; expectedScaleChars?: number; initialExpressionBaseline?: string;
    tags?: string[]; style?: string;
  } }>('/api/v1/books/drafts', async (request) => {
    return success(positioning.createDraft(owner, request.body), request.id);
  });

  app.patch<{ Params: { draftId: string }; Body: { expectedVersion: number; title?: string; fields?: Parameters<PositioningService['updateDraft']>[3]['fields']; tags?: Parameters<PositioningService['updateDraft']>[3]['tags'] } }>('/api/v1/book-drafts/:draftId', async (request) => {
    const { expectedVersion } = request.body;
    const patch = {
      ...(request.body.title === undefined ? {} : { title: request.body.title }),
      ...(request.body.fields === undefined ? {} : { fields: request.body.fields }),
      ...(request.body.tags === undefined ? {} : { tags: request.body.tags })
    };
    return success(positioning.updateDraft(owner, request.params.draftId, expectedVersion, patch), request.id);
  });

  app.post<{ Params: { draftId: string }; Body: { expectedVersion: number } }>('/api/v1/book-drafts/:draftId/confirm', async (request) => {
    return success(onboarding.confirmDraft(owner, request.params.draftId, request.body.expectedVersion), request.id);
  });

  app.get('/api/v1/books', async (request) => success(books.list(owner), request.id));

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId', async (request) => {
    return success(books.require({ ...owner, bookId: request.params.bookId }), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { expectedVersion: number } }>('/api/v1/books/:bookId/archive', async (request) => {
    return success(lifecycle.archive({ ...owner, bookId: request.params.bookId }, request.body.expectedVersion), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { expectedVersion: number } }>('/api/v1/books/:bookId/restore', async (request) => {
    return success(lifecycle.restoreFromArchive({ ...owner, bookId: request.params.bookId }, request.body.expectedVersion), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { confirmationText: string } }>('/api/v1/books/:bookId/purge', async (request) => {
    lifecycle.permanentlyDelete({ ...owner, bookId: request.params.bookId }, request.body.confirmationText);
    return success({ bookId: request.params.bookId, status: 'purged', tombstoneWritten: true }, request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/workspace', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    const book = books.require(scope);
    const budget = database.prepare(`
      SELECT mode, token_limit, spent_tokens, reserved_tokens, cash_limit_micros, spent_cash_micros, status
      FROM budgets WHERE owner_id = ? AND book_id = ? ORDER BY created_at LIMIT 1
    `).get(scope.ownerId, scope.bookId);
    const confirmationRows = database.prepare(`
      SELECT confirmation_id, target_type, target_id, expected_canon_revision,
             scope_json, impact_json, created_at
      FROM confirmations WHERE owner_id = ? AND book_id = ? AND status = 'pending'
      ORDER BY created_at, confirmation_id
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{
      confirmation_id: string; target_type: string; target_id: string;
      expected_canon_revision: number; scope_json: string; impact_json: string; created_at: string;
    }>;
    const confirmations = {
      count: confirmationRows.length,
      items: confirmationRows.map((row) => ({
        confirmationId: row.confirmation_id,
        targetType: row.target_type,
        targetId: row.target_id,
        expectedCanonRevision: row.expected_canon_revision,
        scope: JSON.parse(row.scope_json) as unknown,
        impact: JSON.parse(row.impact_json) as unknown,
        createdAt: row.created_at
      }))
    };
    const messageCount = (database.prepare(`SELECT COUNT(*) AS count FROM messages WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { count: number }).count;
    return success({
      book,
      chapters: chapters.list(scope),
      agents: agents.list(scope),
      tasks: tasks.list(scope),
      budget,
      confirmations,
      messageCount
    }, request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/agents', async (request) => {
    return success(agents.list({ ...owner, bookId: request.params.bookId }), request.id);
  });

  app.post<{ Params: { bookId: string; agentId: string }; Body: { requiredCapability: string } }>('/api/v1/books/:bookId/agents/:agentId/activate', async (request) => {
    return success(agents.activate({ ...owner, bookId: request.params.bookId }, request.params.agentId, request.body.requiredCapability), request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/artifacts', async (request) => {
    const rows = database.prepare(`
      SELECT a.artifact_id, a.artifact_type, a.title, a.active_version_id, a.status,
        a.version, a.updated_at, v.content_json, v.content_hash, v.status AS active_version_status
      FROM artifacts a LEFT JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? ORDER BY a.artifact_type, a.title
    `).all(config.ownerId, request.params.bookId) as unknown as Array<Record<string, unknown> & { content_json: string | null }>;
    return success(rows.map(({ content_json: contentJson, ...row }) => ({
      ...row,
      active_content: contentJson === null ? null : JSON.parse(contentJson) as unknown
    })), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { type: ArtifactType; title: string; content: Record<string, unknown> } }>('/api/v1/books/:bookId/artifacts/generate', async (request) => {
    return success(artifacts.create({ ...owner, bookId: request.params.bookId }, request.body.type, request.body.title, request.body.content, 'candidate'), request.id);
  });

  app.get<{ Params: { bookId: string; artifactId: string } }>('/api/v1/books/:bookId/artifacts/:artifactId/versions', async (request) => {
    return success(artifacts.versions({ ...owner, bookId: request.params.bookId }, request.params.artifactId), request.id);
  });

  app.post<{ Params: { bookId: string; artifactId: string }; Body: { versionId: string } }>('/api/v1/books/:bookId/artifacts/:artifactId/select', async (request) => {
    return success(artifacts.select({ ...owner, bookId: request.params.bookId }, request.params.artifactId, request.body.versionId), request.id);
  });

  app.post<{ Params: { bookId: string; artifactId: string }; Body: { historicalVersionId: string } }>('/api/v1/books/:bookId/artifacts/:artifactId/revert', async (request) => {
    return success(artifacts.revert({ ...owner, bookId: request.params.bookId }, request.params.artifactId, request.body.historicalVersionId), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { type: DiscussionType; scopeText: string; createdByAgentId: string; participants: Array<{ agentId: string; reason: string }> } }>('/api/v1/books/:bookId/discussions', async (request) => {
    return success(discussions.create({ ...owner, bookId: request.params.bookId }, request.body), request.id);
  });

  app.get<{ Params: { bookId: string; discussionId: string } }>('/api/v1/books/:bookId/discussions/:discussionId', async (request) => {
    return success(discussions.require({ ...owner, bookId: request.params.bookId }, request.params.discussionId), request.id);
  });

  app.post<{ Params: { bookId: string; discussionId: string }; Body: { decisionId: string } }>('/api/v1/books/:bookId/discussions/:discussionId/confirm', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    const discussion = discussions.confirm(scope, request.params.discussionId, request.body.decisionId);
    const planning = new PlanningArtifactService(database, ids, clock)
      .promoteIfPlanningTask(scope, request.params.discussionId, request.body.decisionId);
    return success({ discussion, planning }, request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { volumeNumber: number; title: string } }>('/api/v1/books/:bookId/volumes', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    return success({ volumeId: chapters.createVolume(scope, request.body.volumeNumber, request.body.title) }, request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { volumeId: string; chapterNumber: number; title: string } }>('/api/v1/books/:bookId/chapters', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    return success(chapters.createChapter(scope, request.body.volumeId, request.body.chapterNumber, request.body.title), request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/chapters', async (request) => {
    return success(chapters.list({ ...owner, bookId: request.params.bookId }), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { count: 1 | 3 | 4 | 5; volumeTitle?: string; firstChapterTitle?: string } }>('/api/v1/books/:bookId/chapter-batches', async (request) => {
    const options = {
      ...(request.body.volumeTitle === undefined ? {} : { volumeTitle: request.body.volumeTitle }),
      ...(request.body.firstChapterTitle === undefined ? {} : { firstChapterTitle: request.body.firstChapterTitle })
    };
    return success(chapterBatches.scheduleNewChapters({ ...owner, bookId: request.params.bookId }, request.body.count, options), request.id);
  });

  app.get<{ Params: { bookId: string; batchId: string } }>('/api/v1/books/:bookId/chapter-batches/:batchId', async (request) => {
    return success(chapterBatches.require({ ...owner, bookId: request.params.bookId }, request.params.batchId), request.id);
  });

  app.get<{ Params: { bookId: string; chapterId: string } }>('/api/v1/books/:bookId/chapters/:chapterId', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    const chapter = chapters.requireChapter(scope, request.params.chapterId);
    const manuscripts = database.prepare(`SELECT * FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY created_at, manuscript_version_id`)
      .all(scope.ownerId, scope.bookId, request.params.chapterId);
    const facts = canon.listFacts(scope, request.params.chapterId);
    const reviews = database.prepare(`SELECT * FROM review_rounds WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY round_number`)
      .all(scope.ownerId, scope.bookId, request.params.chapterId);
    return success({ chapter, manuscripts, facts, reviews }, request.id);
  });

  app.get<{ Params: { bookId: string; chapterId: string } }>('/api/v1/books/:bookId/chapters/:chapterId/manuscripts', async (request) => {
    return success(database.prepare(`SELECT * FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY created_at, manuscript_version_id`)
      .all(config.ownerId, request.params.bookId, request.params.chapterId), request.id);
  });

  app.post<{ Params: { bookId: string; chapterId: string }; Body: { manuscriptVersionId: string } }>('/api/v1/books/:bookId/chapters/:chapterId/select-manuscript', async (request) => {
    chapters.selectManuscript({ ...owner, bookId: request.params.bookId }, request.params.chapterId, request.body.manuscriptVersionId);
    return success({ manuscriptVersionId: request.body.manuscriptVersionId, status: 'approved' }, request.id);
  });

  app.get<{ Params: { bookId: string; chapterId: string }; Querystring: { start?: number; end?: number } }>('/api/v1/books/:bookId/chapters/:chapterId/content', async (request) => {
    const row = database.prepare(`
      SELECT f.relative_path, m.manuscript_version_id, m.content_hash
      FROM chapters c JOIN manuscript_versions m ON m.manuscript_version_id = COALESCE(c.canon_manuscript_version_id, c.current_manuscript_version_id)
      JOIN file_registry f ON f.file_id = m.file_id
      WHERE c.owner_id = ? AND c.book_id = ? AND c.chapter_id = ? AND f.status = 'active'
    `).get(config.ownerId, request.params.bookId, request.params.chapterId) as { relative_path: string; manuscript_version_id: string; content_hash: string } | undefined;
    if (row === undefined) throw new Error('章节尚无可读取的正文或越权');
    const content = readFileSync(resolveInside(config.dataDir, row.relative_path), 'utf8');
    const start = Math.max(0, request.query.start ?? 0);
    const end = Math.min(content.length, request.query.end ?? content.length, start + 100_000);
    return success({ manuscriptVersionId: row.manuscript_version_id, contentHash: row.content_hash, start, end, totalLength: content.length, content: content.slice(start, end) }, request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { entityType: string; canonicalName: string; aliases?: string[] } }>('/api/v1/books/:bookId/entities', async (request) => {
    return success({ entityId: canon.createEntity({ ...owner, bookId: request.params.bookId }, request.body) }, request.id);
  });

  app.post<{ Params: { bookId: string }; Body: FactInput }>('/api/v1/books/:bookId/facts', async (request) => {
    return success(canon.proposeFact({ ...owner, bookId: request.params.bookId }, request.body), request.id);
  });

  app.get<{ Params: { bookId: string }; Querystring: { chapterId?: string } }>('/api/v1/books/:bookId/facts', async (request) => {
    return success(canon.listFacts({ ...owner, bookId: request.params.bookId }, request.query.chapterId), request.id);
  });

  app.post<{ Params: { bookId: string; factId: string }; Body: { accept: boolean; resolution?: Record<string, unknown> } }>('/api/v1/books/:bookId/facts/:factId/review', async (request) => {
    canon.reviewFact({ ...owner, bookId: request.params.bookId }, request.params.factId, request.body.accept, request.body.resolution ?? {});
    return success({ factId: request.params.factId, reviewed: true }, request.id);
  });

  app.post<{ Params: { bookId: string; confirmationId: string }; Body: { expectedCanonRevision: number } }>('/api/v1/books/:bookId/confirmations/:confirmationId/accept', async (request) => {
    canon.resolveConfirmation({ ...owner, bookId: request.params.bookId }, request.params.confirmationId, request.body.expectedCanonRevision, true);
    return success({ confirmationId: request.params.confirmationId, status: 'accepted' }, request.id);
  });

  app.post<{ Params: { bookId: string; confirmationId: string }; Body: { expectedCanonRevision: number } }>('/api/v1/books/:bookId/confirmations/:confirmationId/reject', async (request) => {
    canon.resolveConfirmation({ ...owner, bookId: request.params.bookId }, request.params.confirmationId, request.body.expectedCanonRevision, false);
    return success({ confirmationId: request.params.confirmationId, status: 'rejected' }, request.id);
  });

  app.post<{ Params: { bookId: string; chapterId: string }; Body: { manuscriptVersionId: string; chapterEndState: Record<string, unknown> } }>('/api/v1/books/:bookId/chapters/:chapterId/settle', async (request) => {
    return success(canon.settleChapter({ ...owner, bookId: request.params.bookId }, request.params.chapterId, request.body.manuscriptVersionId, request.body.chapterEndState), request.id);
  });

  app.get<{ Params: { bookId: string }; Querystring: { layer?: MemoryLayer; agentId?: string; chapter?: number; canonRevision?: number } }>('/api/v1/books/:bookId/memories', async (request) => {
    return success(memory.listActive({ ...owner, bookId: request.params.bookId }, request.query), request.id);
  });

  app.get<{ Params: { bookId: string }; Querystring: { layer?: MemoryLayer; agentId?: string; chapter?: number; canonRevision?: number } }>('/api/v1/books/:bookId/memory', async (request) => {
    return success(memory.listActive({ ...owner, bookId: request.params.bookId }, request.query), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { query: string; taskId?: string; limit?: number; sourceTypes?: string[]; adoptedSourceIds?: string[]; canonRevision: number } }>('/api/v1/books/:bookId/retrievals', async (request) => {
    const { query, ...options } = request.body;
    return success(retrieval.search({ ...owner, bookId: request.params.bookId }, query, options), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { query: string; taskId?: string; limit?: number; sourceTypes?: string[]; adoptedSourceIds?: string[]; canonRevision: number } }>('/api/v1/books/:bookId/retrieval/preview', async (request) => {
    const { query, ...options } = request.body;
    return success(retrieval.search({ ...owner, bookId: request.params.bookId }, query, options), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: ContextPackInput }>('/api/v1/books/:bookId/context-packs', async (request) => {
    return success(contextPacks.build({ ...owner, bookId: request.params.bookId }, request.body), request.id);
  });

  app.get<{ Params: { bookId: string; contextPackId: string } }>('/api/v1/books/:bookId/context-packs/:contextPackId', async (request) => {
    const row = database.prepare(`
      SELECT * FROM context_packs WHERE context_pack_id = ? AND owner_id = ? AND book_id = ?
    `).get(request.params.contextPackId, config.ownerId, request.params.bookId);
    if (row === undefined) throw new Error('上下文包不存在或越权');
    return success(row, request.id);
  });

  app.get<{ Params: { bookId: string; entityId: string } }>('/api/v1/books/:bookId/entities/:entityId', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    const entity = database.prepare(`SELECT * FROM entities WHERE entity_id = ? AND owner_id = ? AND book_id = ?`)
      .get(request.params.entityId, scope.ownerId, scope.bookId);
    if (entity === undefined) throw new Error('实体不存在或越权');
    const facts = database.prepare(`SELECT * FROM fact_assertions WHERE subject_entity_id = ? AND owner_id = ? AND book_id = ? ORDER BY created_at, fact_id`)
      .all(request.params.entityId, scope.ownerId, scope.bookId);
    return success({ entity, facts }, request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/canon', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    const book = database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId);
    const revisions = database.prepare(`SELECT * FROM canon_revisions WHERE owner_id = ? AND book_id = ? ORDER BY revision DESC`).all(scope.ownerId, scope.bookId);
    const changes = database.prepare(`SELECT * FROM canon_revisions_log WHERE owner_id = ? AND book_id = ? ORDER BY to_revision DESC`).all(scope.ownerId, scope.bookId);
    return success({ book, revisions, changes }, request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/confirmations', async (request) => {
    return success(database.prepare(`SELECT * FROM confirmations WHERE owner_id = ? AND book_id = ? ORDER BY created_at DESC`)
      .all(config.ownerId, request.params.bookId), request.id);
  });

  app.get<{ Params: { bookId: string }; Querystring: { limit?: number; before?: string } }>('/api/v1/books/:bookId/messages', async (request) => {
    return success(conversations.listMessages(
      { ...owner, bookId: request.params.bookId },
      { ...(request.query.limit === undefined ? {} : { limit: request.query.limit }), ...(request.query.before === undefined ? {} : { before: request.query.before }) }
    ), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { content: string } }>('/api/v1/books/:bookId/messages', async (request) => {
    return success(conversations.sendBossMessage({ ...owner, bookId: request.params.bookId }, request.body.content), request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/tasks', async (request) => {
    return success(tasks.list({ ...owner, bookId: request.params.bookId }), request.id);
  });

  app.get<{ Params: { bookId: string; taskId: string } }>('/api/v1/books/:bookId/tasks/:taskId', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    const task = tasks.require(scope, request.params.taskId);
    const phases = database.prepare(`SELECT * FROM task_phases WHERE owner_id = ? AND book_id = ? AND task_id = ? ORDER BY entered_at, phase_key`)
      .all(scope.ownerId, scope.bookId, request.params.taskId);
    const modelCalls = database.prepare(`SELECT * FROM model_calls WHERE owner_id = ? AND book_id = ? AND task_id = ? ORDER BY created_at, request_id`)
      .all(scope.ownerId, scope.bookId, request.params.taskId);
    const toolCalls = database.prepare(`SELECT * FROM tool_calls WHERE owner_id = ? AND book_id = ? AND task_id = ? ORDER BY created_at, tool_call_id`)
      .all(scope.ownerId, scope.bookId, request.params.taskId);
    return success({ task, phases, modelCalls, toolCalls }, request.id);
  });

  app.post<{ Params: { bookId: string; taskId: string } }>('/api/v1/books/:bookId/tasks/:taskId/pause', async (request) => {
    tasks.requestPause({ ...owner, bookId: request.params.bookId }, request.params.taskId);
    return success({ taskId: request.params.taskId, pauseRequested: true }, request.id);
  });

  app.post<{ Params: { bookId: string; taskId: string } }>('/api/v1/books/:bookId/tasks/:taskId/resume', async (request) => {
    return success(tasks.queue({ ...owner, bookId: request.params.bookId }, request.params.taskId), request.id);
  });

  app.post<{ Params: { bookId: string; taskId: string } }>('/api/v1/books/:bookId/tasks/:taskId/cancel', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    tasks.requestCancel(scope, request.params.taskId);
    const modelCalls = database.prepare(`SELECT request_id FROM model_calls WHERE owner_id = ? AND book_id = ? AND task_id = ? AND state = 'working'`)
      .all(scope.ownerId, scope.bookId, request.params.taskId) as unknown as Array<{ request_id: string }>;
    const toolCalls = database.prepare(`SELECT tool_call_id FROM tool_calls WHERE owner_id = ? AND book_id = ? AND task_id = ? AND state = 'working'`)
      .all(scope.ownerId, scope.bookId, request.params.taskId) as unknown as Array<{ tool_call_id: string }>;
    const cancelledModelCalls = modelCalls.filter((call) => cancelActiveModelCall(call.request_id)).length;
    const cancelledToolCalls = toolCalls.filter((call) => cancelActiveToolCall(call.tool_call_id)).length;
    return success({ ...tasks.require(scope, request.params.taskId), cancelledModelCalls, cancelledToolCalls }, request.id);
  });

  app.post<{ Params: { bookId: string } }>('/api/v1/books/:bookId/projections/rebuild', async (request) => {
    return success({ rebuilt: projections.rebuild({ ...owner, bookId: request.params.bookId }) }, request.id);
  });

  app.get<{ Params: { bookId: string }; Querystring: { type?: NarrativeProjectionType } }>('/api/v1/books/:bookId/projections', async (request) => {
    return success(projections.list({ ...owner, bookId: request.params.bookId }, request.query.type), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { title: string; content: string; rightsPath: RightsPath; authorization?: Record<string, unknown> } }>('/api/v1/books/:bookId/copyright/sources', async (request) => {
    return success({ copyrightSourceId: copyright.registerSource({ ...owner, bookId: request.params.bookId }, request.body) }, request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { sourceId: string; abstraction: Record<string, unknown>; prohibitedTerms: string[] } }>('/api/v1/books/:bookId/copyright/structure-cards', async (request) => {
    return success({ structureCardId: copyright.createStructureCard({ ...owner, bookId: request.params.bookId }, request.body.sourceId, request.body.abstraction, request.body.prohibitedTerms) }, request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { structureCardId: string } }>('/api/v1/books/:bookId/copyright/cleanroom-packages', async (request) => {
    return success({ cleanroomPackageId: copyright.buildCleanroomPackage({ ...owner, bookId: request.params.bookId }, request.body.structureCardId) }, request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { sourceId: string; targetType: string; targetId: string; targetContent: string } }>('/api/v1/books/:bookId/copyright/checks', async (request) => {
    return success(copyright.checkTarget({ ...owner, bookId: request.params.bookId }, request.body.sourceId, request.body.targetType, request.body.targetId, request.body.targetContent), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { title: string; content: string; url?: string | null; publisher?: string | null; publishedAt?: string | null; region?: string | null; language: string; credibility: number } }>('/api/v1/books/:bookId/research/sources', async (request) => {
    return success({ researchSourceId: research.addProvidedSource({ ...owner, bookId: request.params.bookId }, request.body) }, request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/research/sources', async (request) => {
    return success(research.listSources({ ...owner, bookId: request.params.bookId }), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { sourceId: string; claim: string; evidence: string } }>('/api/v1/books/:bookId/research/claims', async (request) => {
    return success({ researchClaimId: research.addCandidateClaim({ ...owner, bookId: request.params.bookId }, request.body.sourceId, request.body.claim, request.body.evidence) }, request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/research/claims', async (request) => {
    return success(research.listClaims({ ...owner, bookId: request.params.bookId }), request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/copyright/summary', async (request) => {
    books.require({ ...owner, bookId: request.params.bookId });
    const count = (table: string): unknown => database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id = ? AND book_id = ?`)
      .get(config.ownerId, request.params.bookId);
    return success({
      sources: count('copyright_sources'),
      structureCards: count('abstract_structure_cards'),
      cleanroomPackages: count('cleanroom_packages'),
      checks: count('copyright_checks'),
      recentChecks: database.prepare(`
        SELECT target_type, target_id, risk_level, decision, created_at
        FROM copyright_checks WHERE owner_id = ? AND book_id = ?
        ORDER BY created_at DESC, copyright_check_id DESC LIMIT 20
      `).all(config.ownerId, request.params.bookId)
    }, request.id);
  });

  app.get<{ Params: { bookId: string }; Querystring: { query: string } }>('/api/v1/books/:bookId/research/offline-status', async (request) => {
    books.require({ ...owner, bookId: request.params.bookId });
    return success(research.offlineStatus(request.query.query), request.id);
  });

  app.post<{ Params: { bookId: string; factId: string }; Body: Omit<FactInput, 'grade'> }>('/api/v1/books/:bookId/facts/:factId/correct-request', async (request) => {
    const existing = database.prepare(`SELECT 1 FROM fact_assertions WHERE fact_id = ? AND owner_id = ? AND book_id = ?`)
      .get(request.params.factId, config.ownerId, request.params.bookId);
    if (existing === undefined) throw new Error('待纠正事实不存在或越权');
    return success(canon.proposeFact({ ...owner, bookId: request.params.bookId }, { ...request.body, grade: 'D' }), request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/budgets', async (request) => {
    return success(database.prepare(`
      SELECT budget_id, mode, token_limit, cash_limit_micros, reserved_tokens,
             reserved_cash_micros, spent_tokens, spent_cash_micros, status, created_at, updated_at
      FROM budgets WHERE owner_id = ? AND book_id = ? ORDER BY created_at, budget_id
    `).all(config.ownerId, request.params.bookId), request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/usage', async (request) => {
    return success(database.prepare(`
      SELECT provider, model_id, SUM(input_tokens) AS input_tokens,
             SUM(output_tokens) AS output_tokens, SUM(cash_micros) AS cash_micros,
             COUNT(*) AS call_count
      FROM usage_ledger WHERE owner_id = ? AND book_id = ?
      GROUP BY provider, model_id ORDER BY provider, model_id
    `).all(config.ownerId, request.params.bookId), request.id);
  });

  app.post('/api/v1/backups', async (request) => success(backups.create(), request.id));

  app.get('/api/v1/backups', async (request) => success(database.prepare(`
    SELECT backup_id, release_id, status, backup_path, database_hash, manifest_hash,
           file_count, created_at, verified_at, verification_json
    FROM backups ORDER BY created_at DESC, backup_id DESC
  `).all(), request.id));

  app.post<{ Params: { backupId: string } }>('/api/v1/backups/:backupId/verify', async (request) => {
    return success(backups.verify(request.params.backupId), request.id);
  });
}
