import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { planningRosterFromGlobal } from '@wenmi/v7-backend';
import { V7PlanningTreeService } from '../application/planning/v7-planning-tree-service.js';
import { V7PlanningEditorialService } from '../application/planning/v7-planning-editorial-service.js';
import { V7PlanningTreeGenerationService } from '../application/planning/v7-planning-tree-generation-service.js';
import { V7PlanningMaintenanceService } from '../application/planning/v7-planning-maintenance-service.js';
import { V7PlanningRouteService } from '../application/planning/v7-planning-route-service.js';
import { V7OpeningBookService } from '../application/books/v7-opening-book-service.js';
import { success } from '../contracts/api.js';
import { SystemClock, UuidGenerator } from '../domain/ids.js';
import { DomainError, errorCodes } from '../domain/errors.js';
import { requireAdministrator, requireAuthenticatedOwner } from '../infrastructure/security/auth-context.js';
import type { V7PlanningModelAdapterResolver } from '../infrastructure/models/v7-planning-model-gateway.js';
import { V7AgentGovernanceRepository } from '../infrastructure/db/repositories/v7-agent-governance-repository.js';

type TreeParams = { bookId: string; treeKind: string; scopeId: string };

export async function registerV7PlanningTreeRoutes(
  app: FastifyInstance,
  database: DatabaseSync,
  adapters: V7PlanningModelAdapterResolver
): Promise<void> {
  const ids = new UuidGenerator();
  const clock = new SystemClock();
  const governance = new V7AgentGovernanceRepository(database);
  governance.ensureSeeded(clock.now().toISOString());
  const planningRoster = () => planningRosterFromGlobal(governance.snapshot().members);
  const service = new V7PlanningTreeService(database, ids, clock);
  const editorial = new V7PlanningEditorialService(database, adapters, ids, clock, planningRoster);
  const generation = new V7PlanningTreeGenerationService(database, adapters, ids, clock, planningRoster);
  const maintenance = new V7PlanningMaintenanceService(database, adapters, ids, clock, planningRoster);
  const routes = new V7PlanningRouteService(database, adapters, ids, clock, planningRoster);
  const books = new V7OpeningBookService(database, ids, clock);
  const scope = (request: Parameters<typeof requireAuthenticatedOwner>[0], bookId: string): string => {
    const owner = requireAuthenticatedOwner(request);
    books.requireVisible(owner.ownerId, bookId);
    return owner.ownerId;
  };

  app.get('/api/v1/v7/editorial/planning-members', async (request) => {
    requireAuthenticatedOwner(request);
    return success(routes.publicMembers(), request.id);
  });

  app.get<{ Querystring: { limit?: string } }>('/api/v1/v7/planning-tasks', async (request) => {
    const ownerId = requireAuthenticatedOwner(request).ownerId;
    const parsed = Number(request.query.limit ?? 50);
    const limit = Number.isInteger(parsed) ? Math.max(1, Math.min(100, parsed)) : 50;
    const tasks = [...routes.listTasks(ownerId, limit), ...generation.listTasks(ownerId, limit)]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit);
    return success(tasks, request.id);
  });

  app.get<{ Querystring: { limit?: string } }>('/api/v1/v7/admin/planning-tasks', async (request) => {
    requireAdministrator(request);
    const parsed = Number(request.query.limit ?? 100);
    const limit = Number.isInteger(parsed) ? Math.max(1, Math.min(200, parsed)) : 100;
    const tasks = [...routes.adminTasks(limit), ...generation.adminTasks(limit)]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit);
    return success(tasks, request.id);
  });

  app.get<{ Params: TreeParams }>('/api/v1/v7/books/:bookId/planning-trees/:treeKind/:scopeId', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(service.get(ownerId, request.params.bookId, request.params.treeKind, request.params.scopeId), request.id);
  });
  app.get<{ Params: TreeParams }>('/api/v1/v7/books/:bookId/planning-trees/:treeKind/:scopeId/history', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(service.history(ownerId, request.params.bookId, request.params.treeKind, request.params.scopeId), request.id);
  });
  app.post<{ Params: TreeParams; Body: { expectedRevision?: unknown; tree?: unknown; sourceRefs?: unknown; idempotencyKey?: unknown } }>(
    '/api/v1/v7/books/:bookId/planning-trees/:treeKind/:scopeId/candidates',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(service.createCandidate(ownerId, request.params.bookId, request.params.treeKind, request.params.scopeId, request.body ?? {}), request.id);
    }
  );
  app.patch<{ Params: TreeParams; Body: { expectedRevision?: unknown; operations?: unknown; sourceRefs?: unknown; idempotencyKey?: unknown } }>(
    '/api/v1/v7/books/:bookId/planning-trees/:treeKind/:scopeId/candidate',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(service.reviseCandidate(ownerId, request.params.bookId, request.params.treeKind, request.params.scopeId, request.body ?? {}), request.id);
    }
  );
  app.post<{ Params: TreeParams; Body: { expectedRevision?: unknown; idempotencyKey?: unknown } }>(
    '/api/v1/v7/books/:bookId/planning-trees/:treeKind/:scopeId/confirm',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(service.confirmCandidate(ownerId, request.params.bookId, request.params.treeKind, request.params.scopeId, request.body ?? {}), request.id);
    }
  );

  app.post<{ Params: { bookId: string }; Body: { authorGoal?: unknown; candidateCount?: unknown; memberKeys?: unknown; idempotencyKey?: unknown } }>(
    '/api/v1/v7/books/:bookId/planning-recipes/runs',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(editorial.createRecipeRun(ownerId, request.params.bookId, request.body ?? {}), request.id);
    }
  );
  app.get<{ Params: { bookId: string; runId: string } }>(
    '/api/v1/v7/books/:bookId/planning-recipes/runs/:runId',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(editorial.getRecipeRun(ownerId, request.params.bookId, request.params.runId), request.id);
    }
  );
  app.post<{ Params: { bookId: string; runId: string } }>(
    '/api/v1/v7/books/:bookId/planning-routes/runs/:runId/retry-missing',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(routes.retryMissing(ownerId, request.params.bookId, request.params.runId), request.id);
    }
  );
  app.post<{ Params: { bookId: string; runId: string } }>(
    '/api/v1/v7/books/:bookId/planning-routes/runs/:runId/cancel',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(routes.cancel(ownerId, request.params.bookId, request.params.runId), request.id);
    }
  );
  app.get<{ Params: { bookId: string } }>(
    '/api/v1/v7/books/:bookId/planning-routes/latest',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(routes.latest(ownerId, request.params.bookId), request.id);
    }
  );
  app.post<{ Params: { bookId: string; runId: string }; Body: { choice?: unknown; authorNote?: unknown; idempotencyKey?: unknown } }>(
    '/api/v1/v7/books/:bookId/planning-recipes/runs/:runId/confirm',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(editorial.confirmRecipe(ownerId, request.params.bookId, request.params.runId, request.body ?? {}), request.id);
    }
  );
  app.post<{ Params: { bookId: string }; Body: { authorGoal?: unknown; idempotencyKey?: unknown } }>(
    '/api/v1/v7/books/:bookId/planning-routes/runs',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(routes.create(ownerId, request.params.bookId, request.body ?? {}), request.id);
    }
  );
  app.get<{ Params: { bookId: string; runId: string } }>(
    '/api/v1/v7/books/:bookId/planning-routes/runs/:runId',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(routes.get(ownerId, request.params.bookId, request.params.runId), request.id);
    }
  );
  app.post<{ Params: { bookId: string; runId: string } }>(
    '/api/v1/v7/books/:bookId/planning-tree-generation-runs/:runId/cancel',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(generation.cancel(ownerId, request.params.bookId, request.params.runId), request.id);
    }
  );
  app.get<{ Params: TreeParams }>(
    '/api/v1/v7/books/:bookId/planning-trees/:treeKind/:scopeId/generation-runs/latest',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(generation.latest(
        ownerId, request.params.bookId, request.params.treeKind, request.params.scopeId
      ), request.id);
    }
  );
  app.post<{
    Params: { bookId: string; runId: string };
    Body: { mode?: unknown; routeIds?: unknown; authorNote?: unknown; idempotencyKey?: unknown };
  }>('/api/v1/v7/books/:bookId/planning-routes/runs/:runId/decision', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(await routes.decide(ownerId, request.params.bookId, request.params.runId, request.body ?? {}), request.id);
  });
  app.post<{ Params: TreeParams; Body: { selectedMemberKey?: unknown; idempotencyKey?: unknown } }>(
    '/api/v1/v7/books/:bookId/planning-trees/:treeKind/:scopeId/generation-runs',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(generation.create(
        ownerId, request.params.bookId, request.params.treeKind, request.params.scopeId, request.body ?? {}
      ), request.id);
    }
  );
  app.get<{ Params: { bookId: string; runId: string } }>(
    '/api/v1/v7/books/:bookId/planning-tree-generation-runs/:runId',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(generation.get(ownerId, request.params.bookId, request.params.runId), request.id);
    }
  );
  app.get<{ Params: { bookId: string; runId: string } }>(
    '/api/v1/v7/books/:bookId/planning-maintenance-runs/:runId',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(maintenance.get(ownerId, request.params.bookId, request.params.runId), request.id);
    }
  );
  app.get<{ Params: { bookId: string } }>(
    '/api/v1/v7/books/:bookId/planning-adjustment-suggestions',
    async (request) => {
      const ownerId = scope(request, request.params.bookId);
      return success(maintenance.pendingSuggestions(ownerId, request.params.bookId), request.id);
    }
  );
  app.post<{
    Params: { bookId: string; suggestionId: string };
    Body: { decision?: unknown; authorNote?: unknown; idempotencyKey?: unknown };
  }>('/api/v1/v7/books/:bookId/planning-adjustment-suggestions/:suggestionId/decision', async (request) => {
    const ownerId = scope(request, request.params.bookId);
    return success(maintenance.decideSuggestion(
      ownerId, request.params.bookId, request.params.suggestionId, request.body ?? {}
    ), request.id);
  });
  app.post<{
    Params: { bookId: string };
    Headers: { 'x-wenmi-worker-id'?: string };
    Body: { ownerId?: unknown; sourceKind?: unknown; sourceVersionId?: unknown };
  }>('/api/v1/internal/worker/v7/books/:bookId/planning-maintenance', async (request) => {
    const workerId = request.headers['x-wenmi-worker-id'];
    if (typeof workerId !== 'string' || workerId.length === 0) throw new DomainError(errorCodes.validation, '缺少Worker身份');
    const worker = database.prepare('SELECT 1 AS ok FROM worker_health WHERE worker_id=?').get(workerId);
    if (worker === undefined) throw new DomainError(errorCodes.validation, 'Worker身份未登记');
    const ownerId = typeof request.body?.ownerId === 'string' ? request.body.ownerId : '';
    books.requireVisible(ownerId, request.params.bookId);
    return success(maintenance.trigger(
      ownerId, request.params.bookId, request.body?.sourceKind, request.body?.sourceVersionId
    ), request.id);
  });
}
