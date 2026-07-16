import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { success } from '../contracts/api.js';
import { SystemClock, UuidGenerator } from '../domain/ids.js';
import { PositioningService } from '../application/books/positioning-service.js';
import { BookOnboardingService } from '../application/books/book-onboarding-service.js';
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

export async function registerDomainRoutes(app: FastifyInstance, database: DatabaseSync, config: RuntimeConfig): Promise<void> {
  const ids = new UuidGenerator();
  const clock = new SystemClock();
  const owner = { ownerId: config.ownerId };
  const positioning = new PositioningService(database, ids, clock);
  const onboarding = new BookOnboardingService(database, ids, clock);
  const books = new BookRepository(database);
  const agents = new AgentTeamService(database, ids, clock);
  const artifacts = new ArtifactService(database, ids, clock);
  const discussions = new DiscussionService(database, ids, clock);
  const chapters = new ChapterCatalogService(database, ids, clock);
  const canon = new CanonService(database, ids, clock);
  const memory = new MemoryService(database, ids, clock);
  const retrieval = new RetrievalService(database, ids, clock);
  const contextPacks = new ContextPackService(database, ids, clock);
  const chapterBatches = new ChapterBatchService(database, config.dataDir, config.releaseId, ids, clock);

  app.post<{ Body: { title?: string; text: string; category?: string; tags?: string[]; style?: string } }>('/api/v1/books/drafts', async (request) => {
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

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/agents', async (request) => {
    return success(agents.list({ ...owner, bookId: request.params.bookId }), request.id);
  });

  app.post<{ Params: { bookId: string; agentId: string }; Body: { requiredCapability: string } }>('/api/v1/books/:bookId/agents/:agentId/activate', async (request) => {
    return success(agents.activate({ ...owner, bookId: request.params.bookId }, request.params.agentId, request.body.requiredCapability), request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/artifacts', async (request) => {
    const rows = database.prepare(`
      SELECT artifact_id, artifact_type, title, active_version_id, status, version, updated_at
      FROM artifacts WHERE owner_id = ? AND book_id = ? ORDER BY artifact_type, title
    `).all(config.ownerId, request.params.bookId);
    return success(rows, request.id);
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
    return success(discussions.confirm({ ...owner, bookId: request.params.bookId }, request.params.discussionId, request.body.decisionId), request.id);
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

  app.post<{ Params: { bookId: string; factId: string }; Body: Omit<FactInput, 'grade'> }>('/api/v1/books/:bookId/facts/:factId/correct-request', async (request) => {
    const existing = database.prepare(`SELECT 1 FROM fact_assertions WHERE fact_id = ? AND owner_id = ? AND book_id = ?`)
      .get(request.params.factId, config.ownerId, request.params.bookId);
    if (existing === undefined) throw new Error('待纠正事实不存在或越权');
    return success(canon.proposeFact({ ...owner, bookId: request.params.bookId }, { ...request.body, grade: 'D' }), request.id);
  });
}
