import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openingRosterFromGlobal, settingRosterFromGlobal } from '@wenmi/v7-backend';
import { V7AgentGovernanceService } from '../application/agents/v7-agent-governance-service.js';
import { V7SettingEditorialService } from '../application/books/v7-setting-editorial-service.js';
import { V7OpeningBookService } from '../application/books/v7-opening-book-service.js';
import { success } from '../contracts/api.js';
import { SystemClock, UuidGenerator } from '../domain/ids.js';
import { V7AgentGovernanceRepository } from '../infrastructure/db/repositories/v7-agent-governance-repository.js';
import type { V7OpeningModelAdapterResolver } from '../infrastructure/models/v7-opening-agent-model-gateway.js';
import { requireAdministrator, requireAuthenticatedOwner } from '../infrastructure/security/auth-context.js';

export async function registerV7SettingEditorialRoutes(
  app: FastifyInstance,
  database: DatabaseSync,
  adapters: V7OpeningModelAdapterResolver,
  credentials: Readonly<{ codingPlan: boolean; agentPlan: boolean }>
): Promise<void> {
  const ids = new UuidGenerator();
  const clock = new SystemClock();
  const unifiedGovernance = new V7AgentGovernanceService(
    new V7AgentGovernanceRepository(database), ids, clock,
    { codingPlan: credentials.codingPlan, agentPlan: credentials.agentPlan, image: false }
  );
  const service = new V7SettingEditorialService(
    database, adapters, ids, clock, credentials,
    () => openingRosterFromGlobal(unifiedGovernance.snapshot().members),
    () => settingRosterFromGlobal(unifiedGovernance.snapshot().members)
  );
  const books = new V7OpeningBookService(database, ids, clock);
  const scope = (request: Parameters<typeof requireAuthenticatedOwner>[0], bookId: string): { ownerId: string; bookId: string } => {
    const owner = requireAuthenticatedOwner(request);
    books.requireVisible(owner.ownerId, bookId);
    return { ownerId: owner.ownerId, bookId };
  };

  app.get('/api/v1/admin/v7/setting-agent/members', async (request) => {
    requireAdministrator(request);
    const view = unifiedGovernance.adminView() as UnifiedGovernanceAdminView;
    return success(settingMembers(view), request.id);
  });
  app.patch<{ Params: { memberKey: string }; Body: { enabled?: unknown; expectedRevision?: unknown } }>('/api/v1/admin/v7/setting-agent/members/:memberKey', async (request) => {
    const administrator = requireAdministrator(request);
    const view = unifiedGovernance.updateMember(administrator.userId, request.params.memberKey, {
      ...(request.body ?? {}), reason: '通过设定编辑部兼容入口调整统一成员状态'
    }) as UnifiedGovernanceAdminView;
    const member = settingMembers(view).find((candidate) => candidate.memberKey === request.params.memberKey);
    if (member === undefined) throw new Error('统一设定成员更新后无法读取');
    return success(member, request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/v7/books/:bookId/setting-department', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.department(resolved.ownerId, resolved.bookId), request.id);
  });
  app.post<{ Params: { bookId: string }; Body: { idempotencyKey?: unknown } }>('/api/v1/v7/books/:bookId/setting-recommendations', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.createRecommendation(resolved.ownerId, resolved.bookId, request.body ?? {}), request.id);
  });
  app.post<{ Params: { bookId: string } }>('/api/v1/v7/books/:bookId/setting-recommendations/retry', async (request) => {
    const resolved = scope(request, request.params.bookId);
    try {
      return success(service.retryCurrentRecommendation(resolved.ownerId, resolved.bookId), request.id);
    } catch (error) {
      request.log.error({ err: error, bookId: request.params.bookId }, 'v7_setting_recommendation_retry_failed');
      throw error;
    }
  });
  app.get<{ Params: { bookId: string } }>('/api/v1/v7/books/:bookId/setting-recommendations/current', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.getCurrentRecommendation(resolved.ownerId, resolved.bookId), request.id);
  });
  app.get<{ Params: { bookId: string; taskId: string } }>('/api/v1/v7/books/:bookId/setting-recommendations/:taskId', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.getRecommendation(resolved.ownerId, resolved.bookId, request.params.taskId), request.id);
  });
  app.post<{ Params: { bookId: string; taskId: string } }>('/api/v1/v7/books/:bookId/setting-recommendations/:taskId/retry', async (request) => {
    const resolved = scope(request, request.params.bookId);
    try {
      return success(service.retryRecommendation(resolved.ownerId, resolved.bookId, request.params.taskId), request.id);
    } catch (error) {
      request.log.error({ err: error, bookId: request.params.bookId, taskId: request.params.taskId }, 'v7_setting_recommendation_retry_by_id_failed');
      throw error;
    }
  });
  app.put<{ Params: { bookId: string }; Body: { selectedItemKeys?: unknown; customItems?: unknown } }>('/api/v1/v7/books/:bookId/setting-selection', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.resolveSelection(resolved.ownerId, resolved.bookId, request.body ?? {}), request.id);
  });
  app.post<{ Params: { bookId: string }; Body: { selectedItemKeys?: unknown; customItems?: unknown; authorNotes?: unknown; idempotencyKey?: unknown } }>('/api/v1/v7/books/:bookId/setting-batches', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.createBatch(resolved.ownerId, resolved.bookId, request.body ?? {}), request.id);
  });
  app.get<{ Params: { bookId: string; batchId: string } }>('/api/v1/v7/books/:bookId/setting-batches/:batchId', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.getBatch(resolved.ownerId, resolved.bookId, request.params.batchId), request.id);
  });
  app.post<{ Params: { bookId: string; batchId: string } }>('/api/v1/v7/books/:bookId/setting-batches/:batchId/retry', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.retry(resolved.ownerId, resolved.bookId, request.params.batchId), request.id);
  });
  app.post<{ Params: { bookId: string; batchId: string }; Body: { idempotencyKey?: unknown } }>('/api/v1/v7/books/:bookId/setting-batches/:batchId/restart', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.restartFailed(
      resolved.ownerId,
      resolved.bookId,
      request.params.batchId,
      request.body ?? {}
    ), request.id);
  });
  app.post<{ Params: { bookId: string }; Body: { idempotencyKey?: unknown } }>('/api/v1/v7/books/:bookId/setting-final-reviews', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.createFinalReview(resolved.ownerId, resolved.bookId, request.body ?? {}), request.id);
  });
  app.get<{ Params: { bookId: string } }>('/api/v1/v7/books/:bookId/setting-final-reviews/current', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.getCurrentFinalReview(resolved.ownerId, resolved.bookId), request.id);
  });
  app.post<{ Params: { bookId: string; taskId: string } }>('/api/v1/v7/books/:bookId/setting-final-reviews/:taskId/retry', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.retryFinalReview(resolved.ownerId, resolved.bookId, request.params.taskId), request.id);
  });
  app.post<{ Params: { bookId: string; itemKey: string }; Body: { memberKeys?: unknown; authorNote?: unknown; idempotencyKey?: unknown } }>('/api/v1/v7/books/:bookId/setting-items/:itemKey/redesigns', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.redesign(resolved.ownerId, resolved.bookId, request.params.itemKey, request.body ?? {}), request.id);
  });
  app.get<{ Params: { bookId: string; itemKey: string } }>('/api/v1/v7/books/:bookId/setting-items/:itemKey/redesigns/current', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.getCurrentRedesign(resolved.ownerId, resolved.bookId, request.params.itemKey), request.id);
  });
  app.get<{ Params: { bookId: string; itemKey: string; taskId: string } }>('/api/v1/v7/books/:bookId/setting-items/:itemKey/redesigns/:taskId', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.getRedesign(resolved.ownerId, resolved.bookId, request.params.itemKey, request.params.taskId), request.id);
  });
  app.post<{ Params: { bookId: string; itemKey: string; taskId: string } }>('/api/v1/v7/books/:bookId/setting-items/:itemKey/redesigns/:taskId/retry', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.retryRedesign(resolved.ownerId, resolved.bookId, request.params.itemKey, request.params.taskId), request.id);
  });
  app.post<{ Params: { bookId: string; itemKey: string }; Body: { outputIds?: unknown; authorNote?: unknown; idempotencyKey?: unknown } }>('/api/v1/v7/books/:bookId/setting-items/:itemKey/fusions', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(await service.fuse(resolved.ownerId, resolved.bookId, request.params.itemKey, request.body ?? {}), request.id);
  });
  app.post<{ Params: { bookId: string; itemKey: string }; Body: { content?: unknown; idempotencyKey?: unknown } }>('/api/v1/v7/books/:bookId/setting-items/:itemKey/revisions', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(await service.reviseItem(resolved.ownerId, resolved.bookId, request.params.itemKey, request.body ?? {}), request.id);
  });
  app.post<{ Params: { bookId: string; itemKey: string }; Body: {
    content?: unknown; instruction?: unknown; idempotencyKey?: unknown;
    sourceRedesignTaskId?: unknown; sourceOutputId?: unknown;
  } }>('/api/v1/v7/books/:bookId/setting-items/:itemKey/review-tasks', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.createItemReviewTask(resolved.ownerId, resolved.bookId, request.params.itemKey, request.body ?? {}), request.id);
  });
  app.post<{ Params: { bookId: string; itemKey: string }; Body: { expectedRevision?: unknown } }>('/api/v1/v7/books/:bookId/setting-items/:itemKey/confirm', async (request) => {
    const resolved = scope(request, request.params.bookId);
    return success(service.confirm(resolved.ownerId, resolved.bookId, request.params.itemKey, request.body ?? {}), request.id);
  });
}

interface UnifiedGovernanceAdminView {
  revision: number;
  roles: Array<{
    roleKey: string;
    members: Array<Record<string, unknown> & { memberKey: string; enabled: boolean; credentialReady: boolean }>;
  }>;
}

function settingMembers(view: UnifiedGovernanceAdminView): Array<Record<string, unknown>> {
  return view.roles
    .filter((role) => ['chief_editor', 'deputy_editor', 'planning_writer'].includes(role.roleKey))
    .flatMap((role) => role.members.map((member) => ({ ...member, fixedRoleKey: role.roleKey, revision: view.revision })));
}
