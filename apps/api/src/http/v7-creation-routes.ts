import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { characterRosterFromGlobal, creationRosterFromGlobal, planningRosterFromGlobal } from '@wenmi/v7-backend';
import { V7OpeningBookService } from '../application/books/v7-opening-book-service.js';
import { V7CreationFormalizationService } from '../application/creation/v7-creation-formalization-service.js';
import { V7ManagedCreationService } from '../application/creation/v7-managed-creation-service.js';
import { V7CreationWorkflowService } from '../application/creation/v7-creation-workflow-service.js';
import { success } from '../contracts/api.js';
import { SystemClock, UuidGenerator } from '../domain/ids.js';
import type { V7CreationModelAdapterResolver } from '../infrastructure/models/v7-creation-model-gateway.js';
import { V7AgentGovernanceRepository } from '../infrastructure/db/repositories/v7-agent-governance-repository.js';
import { requireAdministrator, requireAuthenticatedOwner } from '../infrastructure/security/auth-context.js';

export async function registerV7CreationRoutes(
  app: FastifyInstance,
  database: DatabaseSync,
  adapters: V7CreationModelAdapterResolver
): Promise<void> {
  const ids = new UuidGenerator();
  const clock = new SystemClock();
  const governance = new V7AgentGovernanceRepository(database);
  governance.ensureSeeded(clock.now().toISOString());
  const creationRoster = () => creationRosterFromGlobal(governance.snapshot().members);
  const workflows = new V7CreationWorkflowService(database, adapters, ids, clock, creationRoster);
  const formalization = new V7CreationFormalizationService(
    database, adapters, ids, clock, creationRoster,
    () => characterRosterFromGlobal(governance.snapshot().members),
    () => planningRosterFromGlobal(governance.snapshot().members)
  );
  const managed = new V7ManagedCreationService(database, workflows, formalization, ids, clock);
  const books = new V7OpeningBookService(database, ids, clock);
  const scope = (request: Parameters<typeof requireAuthenticatedOwner>[0], bookId: string): string => {
    const owner = requireAuthenticatedOwner(request);
    books.requireVisible(owner.ownerId, bookId);
    return owner.ownerId;
  };

  app.post<{
    Params: { bookId: string };
    Body: { volumeScopeId?: unknown; authorGoal?: unknown; candidateCount?: unknown; idempotencyKey?: unknown; memberPreferences?: unknown };
  }>('/api/v1/v7/books/:bookId/creation-workflows', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(workflows.create(ownerId, request.params.bookId, request.body ?? {}), request.id);
  });

  app.get<{ Params: { bookId: string } }>(
    '/api/v1/v7/books/:bookId/creation-workflows/latest', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(workflows.latest(ownerId, request.params.bookId), request.id);
    }
  );

  app.get<{ Params: { bookId: string } }>(
    '/api/v1/v7/books/:bookId/creation-library', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(workflows.library(ownerId, request.params.bookId), request.id);
    }
  );

  app.get<{ Params: { bookId: string; manuscriptVersionId: string } }>(
    '/api/v1/v7/books/:bookId/manuscripts/:manuscriptVersionId', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(workflows.manuscript(ownerId, request.params.bookId, request.params.manuscriptVersionId), request.id);
    }
  );

  app.get<{ Params: { bookId: string; workflowId: string } }>(
    '/api/v1/v7/books/:bookId/creation-workflows/:workflowId', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(workflows.get(ownerId, request.params.bookId, request.params.workflowId), request.id);
    }
  );

  app.get<{ Querystring: { limit?: string } }>('/api/v1/v7/creation-tasks', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    const limit = Number.parseInt(request.query.limit ?? '50', 10);
    return success(workflows.tasks(owner.ownerId, Number.isFinite(limit) ? limit : 50), request.id);
  });

  app.get('/api/v1/v7/editorial/creation-members', async (request) => {
    requireAuthenticatedOwner(request);
    return success(workflows.members(), request.id);
  });

  app.post<{
    Params: { bookId: string; workflowId: string };
    Body: { reason?: unknown; idempotencyKey?: unknown };
  }>('/api/v1/v7/books/:bookId/creation-workflows/:workflowId/cancel', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(workflows.cancel(ownerId, request.params.bookId, request.params.workflowId, request.body ?? {}), request.id);
  });

  app.post<{
    Params: { bookId: string; workflowId: string };
    Body: { selectionKey?: unknown; roleKey?: unknown; memberKey?: unknown };
  }>('/api/v1/v7/books/:bookId/creation-workflows/:workflowId/member', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(workflows.chooseMember(ownerId, request.params.bookId, request.params.workflowId, request.body ?? {}), request.id);
  });

  app.post<{ Params: { bookId: string; workflowId: string } }>(
    '/api/v1/v7/books/:bookId/creation-workflows/:workflowId/options/retry', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(workflows.retryOptions(ownerId, request.params.bookId, request.params.workflowId), request.id);
    }
  );

  app.post<{
    Params: { bookId: string; workflowId: string };
    Body: { idempotencyKey?: unknown };
  }>('/api/v1/v7/books/:bookId/creation-workflows/:workflowId/options/redesign', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(workflows.redesignOptions(
      ownerId, request.params.bookId, request.params.workflowId, request.body ?? {}
    ), request.id);
  });

  app.post<{
    Params: { bookId: string; workflowId: string };
    Body: { kind?: unknown; optionId?: unknown; authorNote?: unknown; idempotencyKey?: unknown };
  }>('/api/v1/v7/books/:bookId/creation-workflows/:workflowId/options/choose', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(workflows.chooseOption(
      ownerId, request.params.bookId, request.params.workflowId, request.body ?? {}
    ), request.id);
  });

  app.post<{
    Params: { bookId: string; workflowId: string };
    Body: { chainScopeId?: unknown; candidateCount?: unknown; memberPreferences?: unknown };
  }>('/api/v1/v7/books/:bookId/creation-workflows/:workflowId/continue-to-chain', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(workflows.continueToChain(
      ownerId, request.params.bookId, request.params.workflowId, request.body ?? {}
    ), request.id);
  });

  app.post<{
    Params: { bookId: string; workflowId: string };
    Body: { chainScopeId?: unknown; candidateCount?: unknown; memberPreferences?: unknown; idempotencyKey?: unknown };
  }>('/api/v1/v7/books/:bookId/creation-workflows/:workflowId/continue-to-next-chain', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(workflows.continueToNextChain(
      ownerId, request.params.bookId, request.params.workflowId, request.body ?? {}
    ), request.id);
  });

  app.post<{
    Params: { bookId: string; workflowId: string };
    Body: {
      chapterStart?: unknown; maximumChapters?: unknown; memberKey?: unknown; memberKeys?: unknown;
      candidateCount?: unknown; replaceCandidateId?: unknown; regenerate?: unknown;
    };
  }>('/api/v1/v7/books/:bookId/creation-workflows/:workflowId/outlines', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(await workflows.generateOutlines(
      ownerId, request.params.bookId, request.params.workflowId, request.body ?? {}
    ), request.id);
  });

  app.post<{
    Params: { bookId: string; workflowId: string };
    Body: { sequenceId?: unknown; idempotencyKey?: unknown };
  }>('/api/v1/v7/books/:bookId/creation-workflows/:workflowId/outlines/confirm', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(workflows.confirmOutline(
      ownerId, request.params.bookId, request.params.workflowId, request.body ?? {}
    ), request.id);
  });

  app.post<{
    Params: { bookId: string; workflowId: string };
    Body: { chapterNumber?: unknown; writerMemberKey?: unknown; reviewerMemberKey?: unknown; resumeExistingDraft?: unknown };
  }>('/api/v1/v7/books/:bookId/creation-workflows/:workflowId/manuscripts', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(await workflows.generateManuscript(
      ownerId, request.params.bookId, request.params.workflowId, request.body ?? {}
    ), request.id);
  });

  app.post<{
    Params: { bookId: string; workflowId: string };
    Body: { writerMemberKey?: unknown; reviewerMemberKey?: unknown };
  }>('/api/v1/v7/books/:bookId/creation-workflows/:workflowId/managed/activate', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(managed.activate(ownerId, request.params.bookId, request.params.workflowId, request.body ?? {}), request.id);
  });

  app.post<{
    Params: { bookId: string; workflowId: string };
    Body: { manuscriptVersionId?: unknown; idempotencyKey?: unknown };
  }>('/api/v1/v7/books/:bookId/creation-workflows/:workflowId/manuscripts/finalize', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    const result = workflows.finalizeManuscript(
      ownerId, request.params.bookId, request.params.workflowId, request.body ?? {}
    );
    formalization.kick();
    return success(result, request.id);
  });

  app.get<{ Params: { bookId: string; workflowId: string } }>(
    '/api/v1/v7/books/:bookId/creation-workflows/:workflowId/write-back', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      formalization.kick();
      return success(formalization.status(ownerId, request.params.bookId, request.params.workflowId), request.id);
    }
  );

  app.post<{
    Headers: { 'x-wenmi-worker-id'?: string };
    Body: { limit?: unknown };
  }>('/api/v1/internal/worker/v7/creation-formalization/process', async (request) => {
    const workerId = request.headers['x-wenmi-worker-id'];
    if (typeof workerId !== 'string' || workerId.length === 0) throw new Error('缺少Worker身份');
    const worker = database.prepare('SELECT 1 AS ok FROM worker_health WHERE worker_id=?').get(workerId);
    if (worker === undefined) throw new Error('Worker身份未登记');
    const limit = Number.isInteger(request.body?.limit) ? Number(request.body?.limit) : 24;
    return success(await formalization.processPending(Math.max(1, Math.min(limit, 100))), request.id);
  });

  app.post<{
    Headers: { 'x-wenmi-worker-id'?: string };
    Body: { limit?: unknown };
  }>('/api/v1/internal/worker/v7/managed-creation/process', async (request) => {
    const workerId = request.headers['x-wenmi-worker-id'];
    if (typeof workerId !== 'string' || workerId.length === 0) throw new Error('缺少Worker身份');
    const worker = database.prepare('SELECT 1 AS ok FROM worker_health WHERE worker_id=?').get(workerId);
    if (worker === undefined) throw new Error('Worker身份未登记');
    const limit = Number.isInteger(request.body?.limit) ? Number(request.body?.limit) : 1;
    return success(await managed.processPending(Math.max(1, Math.min(limit, 20))), request.id);
  });

  app.get<{ Params: { bookId: string } }>(
    '/api/v1/v7/books/:bookId/story-state', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(formalization.storyState(ownerId, request.params.bookId), request.id);
    }
  );

  app.get<{ Querystring: { limit?: string } }>('/api/v1/v7/admin/creation-workflows', async (request) => {
    requireAdministrator(request);
    const limit = Number.parseInt(request.query.limit ?? '100', 10);
    return success(workflows.adminTasks(Number.isFinite(limit) ? limit : 100), request.id);
  });

  app.get<{ Params: { bookId: string; workflowId: string }; Querystring: { ownerId?: string } }>(
    '/api/v1/v7/admin/books/:bookId/creation-workflows/:workflowId/audit', async (request) => {
      requireAdministrator(request);
      const ownerId = request.query.ownerId?.trim();
      if (ownerId === undefined || ownerId.length < 8 || ownerId.length > 128) throw new Error('缺少有效的作者范围');
      return success({
        creation: workflows.adminAudit(ownerId, request.params.bookId, request.params.workflowId),
        writeBack: formalization.status(ownerId, request.params.bookId, request.params.workflowId)
      }, request.id);
    }
  );
}
