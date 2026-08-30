import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { characterRosterFromGlobal } from '@wenmi/v7-backend';
import { V7CharacterMemoryService } from '../application/characters/v7-character-memory-service.js';
import { V7OpeningBookService } from '../application/books/v7-opening-book-service.js';
import { success } from '../contracts/api.js';
import { DomainError, errorCodes } from '../domain/errors.js';
import { SystemClock, UuidGenerator } from '../domain/ids.js';
import type { V7CharacterMemoryModelAdapterResolver } from '../infrastructure/models/v7-character-memory-model-gateway.js';
import { V7AgentGovernanceRepository } from '../infrastructure/db/repositories/v7-agent-governance-repository.js';
import { requireAdministrator, requireAuthenticatedOwner } from '../infrastructure/security/auth-context.js';

export async function registerV7CharacterMemoryRoutes(
  app: FastifyInstance,
  database: DatabaseSync,
  adapters: V7CharacterMemoryModelAdapterResolver
): Promise<void> {
  const ids = new UuidGenerator();
  const clock = new SystemClock();
  const governance = new V7AgentGovernanceRepository(database);
  governance.ensureSeeded(clock.now().toISOString());
  const service = new V7CharacterMemoryService(
    database, adapters, ids, clock, () => characterRosterFromGlobal(governance.snapshot().members)
  );
  const books = new V7OpeningBookService(database, ids, clock);
  const scope = (request: Parameters<typeof requireAuthenticatedOwner>[0], bookId: string): string => {
    const owner = requireAuthenticatedOwner(request);
    books.requireVisible(owner.ownerId, bookId);
    return owner.ownerId;
  };

  app.post<{ Params: { bookId: string } }>('/api/v1/v7/books/:bookId/characters/sync', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(service.syncProfiles(ownerId, request.params.bookId), request.id);
  });
  app.get<{ Params: { bookId: string }; Querystring: { includeArchived?: string } }>(
    '/api/v1/v7/books/:bookId/characters', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(service.listProfiles(ownerId, request.params.bookId, request.query.includeArchived === 'true'), request.id);
    }
  );
  app.post<{ Params: { bookId: string }; Body: { document?: unknown; narrativeTier?: unknown; idempotencyKey?: unknown } }>(
    '/api/v1/v7/books/:bookId/characters', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(service.createProfile(ownerId, request.params.bookId, request.body ?? {}), request.id);
    }
  );
  app.get<{ Params: { bookId: string; profileId: string }; Querystring: { includeHistory?: string } }>(
    '/api/v1/v7/books/:bookId/characters/:profileId', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(service.getProfile(
        ownerId, request.params.bookId, request.params.profileId, request.query.includeHistory === 'true'
      ), request.id);
    }
  );
  app.post<{
    Params: { bookId: string; profileId: string };
    Body: { document?: unknown; activate?: unknown; sourceKind?: unknown; sourceId?: unknown; idempotencyKey?: unknown };
  }>('/api/v1/v7/books/:bookId/characters/:profileId/versions', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(service.reviseProfile(ownerId, request.params.bookId, request.params.profileId, request.body ?? {}), request.id);
  });
  app.post<{
    Params: { bookId: string; profileId: string }; Body: { aliases?: unknown; idempotencyKey?: unknown };
  }>('/api/v1/v7/books/:bookId/characters/:profileId/aliases', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(service.updateAliases(
      ownerId, request.params.bookId, request.params.profileId, request.body ?? {}
    ), request.id);
  });
  app.post<{ Params: { bookId: string; profileId: string; versionId: string }; Body: { idempotencyKey?: unknown } }>(
    '/api/v1/v7/books/:bookId/characters/:profileId/versions/:versionId/activate', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(service.activateVersion(
        ownerId, request.params.bookId, request.params.profileId, request.params.versionId, request.body ?? {}
      ), request.id);
    }
  );
  app.patch<{
    Params: { bookId: string; profileId: string }; Body: { narrativeTier?: unknown; idempotencyKey?: unknown };
  }>('/api/v1/v7/books/:bookId/characters/:profileId/organization', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(service.updateOrganization(
      ownerId, request.params.bookId, request.params.profileId, request.body ?? {}
    ), request.id);
  });
  app.post<{ Params: { bookId: string; profileId: string }; Body: { idempotencyKey?: unknown } }>(
    '/api/v1/v7/books/:bookId/characters/:profileId/archive', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(service.setArchiveState(
        ownerId, request.params.bookId, request.params.profileId, true, request.body ?? {}
      ), request.id);
    }
  );
  app.post<{ Params: { bookId: string; profileId: string }; Body: { idempotencyKey?: unknown } }>(
    '/api/v1/v7/books/:bookId/characters/:profileId/restore', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(service.setArchiveState(
        ownerId, request.params.bookId, request.params.profileId, false, request.body ?? {}
      ), request.id);
    }
  );

  app.post<{
    Params: { bookId: string };
    Body: {
      taskKind?: unknown; taskId?: unknown; taskBrief?: unknown; candidateEntityIds?: unknown;
      relationshipDepth?: unknown; maxTokens?: unknown; selectedMemberKey?: unknown; idempotencyKey?: unknown;
    };
  }>('/api/v1/v7/books/:bookId/character-context-packs', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(service.createContextPack(ownerId, request.params.bookId, request.body ?? {}), request.id);
  });
  app.get<{
    Params: { bookId: string }; Querystring: { taskKind?: string; taskId?: string; limit?: string };
  }>('/api/v1/v7/books/:bookId/character-context-packs', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(service.listContextPacks(ownerId, request.params.bookId, {
      taskKind: request.query.taskKind, taskId: request.query.taskId,
      limit: request.query.limit === undefined ? undefined : Number(request.query.limit)
    }), request.id);
  });
  app.get<{ Params: { bookId: string; packId: string } }>(
    '/api/v1/v7/books/:bookId/character-context-packs/:packId', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(service.getContextPack(ownerId, request.params.bookId, request.params.packId), request.id);
    }
  );
  app.post<{ Params: { bookId: string; packId: string } }>(
    '/api/v1/v7/books/:bookId/character-context-packs/:packId/retry', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(service.retryContextPack(ownerId, request.params.bookId, request.params.packId), request.id);
    }
  );
  app.get<{ Params: { bookId: string; runId: string } }>(
    '/api/v1/v7/books/:bookId/character-maintenance-runs/:runId', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(service.getMaintenance(ownerId, request.params.bookId, request.params.runId), request.id);
    }
  );
  app.post<{ Params: { bookId: string; runId: string } }>(
    '/api/v1/v7/books/:bookId/character-maintenance-runs/:runId/retry', async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(service.retryMaintenance(ownerId, request.params.bookId, request.params.runId), request.id);
    }
  );
  app.get<{ Params: { bookId: string } }>('/api/v1/v7/books/:bookId/character-change-candidates', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(service.pendingCandidates(ownerId, request.params.bookId), request.id);
  });
  app.get<{ Params: { bookId: string } }>('/api/v1/v7/books/:bookId/character-review-issues', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(service.openIssues(ownerId, request.params.bookId), request.id);
  });
  app.post<{
    Params: { bookId: string; candidateId: string }; Body: { decision?: unknown; idempotencyKey?: unknown };
  }>('/api/v1/v7/books/:bookId/character-change-candidates/:candidateId/decision', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(service.decideCandidate(
      ownerId, request.params.bookId, request.params.candidateId, request.body ?? {}
    ), request.id);
  });
  app.post<{
    Params: { bookId: string; issueId: string }; Body: { decision?: unknown; idempotencyKey?: unknown };
  }>('/api/v1/v7/books/:bookId/character-review-issues/:issueId/decision', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(service.decideIssue(
      ownerId, request.params.bookId, request.params.issueId, request.body ?? {}
    ), request.id);
  });

  app.post<{
    Params: { bookId: string };
    Headers: { 'x-wenmi-worker-id'?: string };
    Body: { ownerId?: unknown; sourceKind?: unknown; sourceVersionId?: unknown; candidateEntityIds?: unknown };
  }>('/api/v1/internal/worker/v7/books/:bookId/character-maintenance', async (request) => {
    const workerId = request.headers['x-wenmi-worker-id'];
    if (typeof workerId !== 'string' || workerId.length === 0) throw new DomainError(errorCodes.validation, '缺少Worker身份');
    if (database.prepare('SELECT 1 AS ok FROM worker_health WHERE worker_id=?').get(workerId) === undefined) {
      throw new DomainError(errorCodes.validation, 'Worker身份未登记');
    }
    const ownerId = typeof request.body?.ownerId === 'string' ? request.body.ownerId : '';
    books.requireVisible(ownerId, request.params.bookId);
    return success(service.triggerMaintenance(ownerId, request.params.bookId, request.body ?? {}), request.id);
  });

  app.get<{ Querystring: { ownerId?: string; bookId?: string; runId?: string } }>(
    '/api/v1/admin/v7/character-memory/runs/audit', async (request) => {
      requireAdministrator(request);
      const ownerId = request.query.ownerId ?? '';
      const bookId = request.query.bookId ?? '';
      const runId = request.query.runId ?? '';
      return success(service.adminAudit(ownerId, bookId, runId), request.id);
    }
  );
}
