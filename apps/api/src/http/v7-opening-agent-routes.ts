import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openingRosterFromGlobal, visualRosterFromGlobal } from '@wenmi/v7-backend';
import { V7OpeningAgentService } from '../application/books/v7-opening-agent-service.js';
import { V7OpeningBookService } from '../application/books/v7-opening-book-service.js';
import { BookProfileViewService } from '../application/books/book-profile-view-service.js';
import { BookLifecycleService } from '../application/books/book-lifecycle-service.js';
import { OpeningBlueprintService } from '../application/books/opening-blueprint-service.js';
import { V7BookTitleDesignService } from '../application/books/v7-book-title-design-service.js';
import { V7BookCoverDesignService } from '../application/books/v7-book-cover-design-service.js';
import { V7UnifiedEditorialDepartmentService } from '../application/books/v7-unified-editorial-department-service.js';
import { V7AgentGovernanceService } from '../application/agents/v7-agent-governance-service.js';
import { designTaskLimit } from '../application/books/v7-design-task-view.js';
import { success } from '../contracts/api.js';
import { SystemClock, UuidGenerator } from '../domain/ids.js';
import { V7OpeningAgentRepository } from '../infrastructure/db/repositories/v7-opening-agent-repository.js';
import { V7BookTitleDesignRepository } from '../infrastructure/db/repositories/v7-book-title-design-repository.js';
import { V7BookCoverDesignRepository } from '../infrastructure/db/repositories/v7-book-cover-design-repository.js';
import { V7AgentGovernanceRepository } from '../infrastructure/db/repositories/v7-agent-governance-repository.js';
import { BookRepository } from '../infrastructure/db/repositories/book-repository.js';
import { OpeningBlueprintRepository } from '../infrastructure/db/repositories/opening-blueprint-repository.js';
import { UnitOfWork } from '../infrastructure/db/unit-of-work.js';
import {
  V7OpeningAgentModelGateway,
  type V7OpeningModelAdapterResolver
} from '../infrastructure/models/v7-opening-agent-model-gateway.js';
import type { V7CoverImageGateway } from '../infrastructure/models/volcengine-ark-image-gateway.js';
import { requireAdministrator, requireAuthenticatedOwner } from '../infrastructure/security/auth-context.js';
import { OPENING_TAXONOMY, type OpeningBlueprintInput } from '../contracts/opening-blueprint.js';

export async function registerV7OpeningAgentRoutes(
  app: FastifyInstance,
  database: DatabaseSync,
  adapters: V7OpeningModelAdapterResolver,
  credentials: Readonly<{ codingPlan: boolean; agentPlan: boolean }>,
  coverRuntime: Readonly<{ dataDir: string; imageGateway: V7CoverImageGateway }>
): Promise<void> {
  const clock = new SystemClock();
  const ids = new UuidGenerator();
  const repository = new V7OpeningAgentRepository(database);
  const unifiedGovernance = new V7AgentGovernanceService(
    new V7AgentGovernanceRepository(database), ids, clock,
    { codingPlan: credentials.codingPlan, agentPlan: credentials.agentPlan, image: coverRuntime.imageGateway.configured }
  );
  const effectiveOpeningRoster = () => openingRosterFromGlobal(unifiedGovernance.snapshot().members);
  const effectiveVisualRoster = () => visualRosterFromGlobal(unifiedGovernance.snapshot().members);
  const service = new V7OpeningAgentService(
    repository,
    new V7OpeningAgentModelGateway(database, adapters, clock),
    ids,
    clock,
    { effectiveRoster: effectiveOpeningRoster }
  );
  const books = new V7OpeningBookService(database, ids, clock);
  const bookProfiles = new BookProfileViewService(database);
  const lifecycle = new BookLifecycleService(database, coverRuntime.dataDir, ids, clock);
  const bookRepository = new BookRepository(database);
  const openingBlueprints = new OpeningBlueprintService(
    new OpeningBlueprintRepository(database), bookRepository, new UnitOfWork(database), ids, clock
  );
  const titleDesigns = new V7BookTitleDesignService(
    database,
    new V7BookTitleDesignRepository(database),
    adapters,
    ids,
    clock,
    effectiveOpeningRoster,
    credentials
  );
  const coverDesigns = new V7BookCoverDesignService(
    database,
    new V7BookCoverDesignRepository(database),
    adapters,
    coverRuntime.imageGateway,
    coverRuntime.dataDir,
    ids,
    clock,
    effectiveOpeningRoster,
    credentials,
    effectiveVisualRoster
  );
  const editorialDepartment = new V7UnifiedEditorialDepartmentService(
    database,
    () => unifiedGovernance.snapshot().members,
    credentials,
    coverRuntime.imageGateway.configured
  );

  app.get('/api/v1/v7/opening-taxonomy', async (request) => success(OPENING_TAXONOMY, request.id));

  app.get('/api/v1/admin/v7/opening-agent/members', async (request) => {
    requireAdministrator(request);
    return success(unifiedGovernance.adminView(), request.id);
  });

  app.get('/api/v1/admin/v7/agent-governance', async (request) => {
    requireAdministrator(request);
    return success(unifiedGovernance.adminView(), request.id);
  });

  app.patch<{
    Params: { memberKey: string };
    Body: Record<string, unknown>;
  }>('/api/v1/admin/v7/agent-governance/members/:memberKey', async (request) => {
    const administrator = requireAdministrator(request);
    return success(unifiedGovernance.updateMember(administrator.userId, request.params.memberKey, request.body ?? {}), request.id);
  });

  app.patch<{
    Params: { taskKind: import('@wenmi/v7-backend').V7AgentTaskKind };
    Body: Record<string, unknown>;
  }>('/api/v1/admin/v7/agent-governance/task-policies/:taskKind', async (request) => {
    const administrator = requireAdministrator(request);
    return success(unifiedGovernance.updateTaskPolicy(administrator.userId, request.params.taskKind, request.body ?? {}), request.id);
  });

  app.get('/api/v1/admin/v7/visual-agent/members', async (request) => {
    requireAdministrator(request);
    return success({
      credentials: {
        agentPlanConfigured: credentials.agentPlan,
        imageCapabilityConfigured: coverRuntime.imageGateway.configured
      },
      members: effectiveVisualRoster().map((member) => {
        const credentialReady = coverRuntime.imageGateway.configured;
        return {
          memberKey: member.memberKey,
          displayName: member.displayName,
          roleName: member.publicRoleName,
          responsibility: member.publicResponsibility,
          modelId: member.defaultModelId,
          planName: 'Agent Plan · Seedream',
          credentialReady,
          status: member.enabledByDefault && credentialReady ? 'on_duty' : 'on_leave'
        };
      })
    }, request.id);
  });

  app.patch<{
    Params: { memberKey: string };
    Body: {
      expectedRevision?: unknown;
      enabled?: unknown;
      defaultForRole?: unknown;
      fallbackPriority?: unknown;
      promptInstruction?: unknown;
      reason?: unknown;
    };
  }>('/api/v1/admin/v7/opening-agent/members/:memberKey', async (request) => {
    const administrator = requireAdministrator(request);
    return success(unifiedGovernance.updateMember(administrator.userId, request.params.memberKey, request.body ?? {}), request.id);
  });

  app.post<{
    Body: {
      idea?: unknown;
      idempotencyKey?: unknown;
      selectedChiefMemberKey?: unknown;
      selectedScreenwriterMemberKey?: unknown;
      publishingPlatform?: unknown;
    };
  }>('/api/v1/v7/opening-agent/tasks', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    return success(service.create(owner.ownerId, {
      idea: request.body?.idea,
      idempotencyKey: request.body?.idempotencyKey,
      selectedChiefMemberKey: request.body?.selectedChiefMemberKey,
      selectedScreenwriterMemberKey: request.body?.selectedScreenwriterMemberKey,
      publishingPlatform: request.body?.publishingPlatform
    }), request.id);
  });

  app.get<{ Querystring: { limit?: string } }>('/api/v1/v7/opening-agent/tasks', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    return success(service.list(owner.ownerId, request.query.limit), request.id);
  });

  app.get('/api/v1/v7/editorial-department', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    return success(editorialDepartment.get(owner.ownerId), request.id);
  });

  app.post('/api/v1/v7/opening-agent/tasks/abandon-all', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    return success(service.abandonAll(owner.ownerId), request.id);
  });

  app.get<{ Params: { taskId: string } }>(
    '/api/v1/v7/opening-agent/tasks/:taskId',
    async (request: FastifyRequest<{ Params: { taskId: string } }>) => {
      const owner = requireAuthenticatedOwner(request);
      return success(service.get(owner.ownerId, request.params.taskId), request.id);
    }
  );

  app.post<{ Params: { taskId: string } }>(
    '/api/v1/v7/opening-agent/tasks/:taskId/abandon',
    async (request) => {
      const owner = requireAuthenticatedOwner(request);
      return success(service.abandon(owner.ownerId, request.params.taskId), request.id);
    }
  );

  app.post<{
    Params: { taskId: string };
    Body: {
      baseCandidateId?: unknown;
      openingPackage?: unknown;
      adjustmentNote?: unknown;
      decisionResolutions?: unknown;
      idempotencyKey?: unknown;
    };
  }>('/api/v1/v7/opening-agent/tasks/:taskId/revisions', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    return success(await service.revise(owner.ownerId, request.params.taskId, {
      baseCandidateId: request.body?.baseCandidateId,
      openingPackage: request.body?.openingPackage,
      adjustmentNote: request.body?.adjustmentNote,
      decisionResolutions: request.body?.decisionResolutions,
      idempotencyKey: request.body?.idempotencyKey
    }), request.id);
  });

  app.post<{
    Body: {
      taskId?: unknown;
      candidateId?: unknown;
      openingIdea?: unknown;
      openingPackage?: unknown;
      idempotencyKey?: unknown;
    };
  }>('/api/v1/v7/opening-books', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    return success(await books.confirm(owner.ownerId, {
      taskId: request.body?.taskId,
      candidateId: request.body?.candidateId,
      openingIdea: request.body?.openingIdea,
      openingPackage: request.body?.openingPackage,
      idempotencyKey: request.body?.idempotencyKey
    }), request.id);
  });

  app.get('/api/v1/v7/books', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    return success(books.list(owner.ownerId), request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/v7/books/:bookId/book-profile', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    books.requireVisible(owner.ownerId, request.params.bookId);
    return success(bookProfiles.get({ ownerId: owner.ownerId, bookId: request.params.bookId }), request.id);
  });

  app.put<{ Params: { bookId: string }; Body: {
    expectedVersion: number;
    title: string;
    openingBlueprint: OpeningBlueprintInput;
  } }>('/api/v1/v7/books/:bookId/book-profile', async (request) => {
    const scope = { ownerId: requireAuthenticatedOwner(request).ownerId, bookId: request.params.bookId };
    openingBlueprints.revise(scope, request.body);
    return success(bookProfiles.get(scope), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { expectedVersion: number } }>(
    '/api/v1/v7/books/:bookId/archive', async (request) => {
      const scope = { ...requireAuthenticatedOwner(request), bookId: request.params.bookId };
      return success(lifecycle.archive(scope, request.body.expectedVersion), request.id);
    }
  );

  app.post<{ Params: { bookId: string }; Body: { expectedVersion: number } }>(
    '/api/v1/v7/books/:bookId/restore', async (request) => {
      const scope = { ...requireAuthenticatedOwner(request), bookId: request.params.bookId };
      return success(lifecycle.restoreFromArchive(scope, request.body.expectedVersion), request.id);
    }
  );

  app.post<{ Params: { bookId: string }; Body: { idempotencyKey?: unknown; platformStyle?: unknown; titleFlavor?: unknown; authorDirection?: unknown } }>('/api/v1/v7/books/:bookId/title-designs', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    books.requireVisible(owner.ownerId, request.params.bookId);
    return success(await titleDesigns.design(owner.ownerId, request.params.bookId, request.body ?? {}), request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/v7/books/:bookId/title-studio', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    books.requireVisible(owner.ownerId, request.params.bookId);
    return success(titleDesigns.studio(owner.ownerId, request.params.bookId), request.id);
  });

  app.get<{ Querystring: { limit?: string } }>('/api/v1/v7/design-tasks', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    const limit = designTaskLimit(request.query.limit);
    const tasks = [...titleDesigns.tasks(owner.ownerId, limit), ...coverDesigns.tasks(owner.ownerId, limit)]
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit);
    return success(tasks, request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/v7/books/:bookId/cover-studio', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    books.requireVisible(owner.ownerId, request.params.bookId);
    return success(coverDesigns.studio(owner.ownerId, request.params.bookId), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { idempotencyKey?: unknown; platformStyle?: unknown; visualStyle?: unknown; compositionStyle?: unknown; paletteStyle?: unknown; atmosphereStyle?: unknown; elements?: unknown; avoidElements?: unknown; authorDirection?: unknown } }>('/api/v1/v7/books/:bookId/cover-designs', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    books.requireVisible(owner.ownerId, request.params.bookId);
    return success(await coverDesigns.design(owner.ownerId, request.params.bookId, request.body ?? {}), request.id);
  });

  app.post<{ Params: { bookId: string; designId: string } }>('/api/v1/v7/books/:bookId/cover-designs/:designId/adopt', async (request) => {
    const owner = requireAuthenticatedOwner(request);
    books.requireVisible(owner.ownerId, request.params.bookId);
    return success(coverDesigns.adopt(owner.ownerId, request.params.bookId, request.params.designId), request.id);
  });

  app.get<{ Params: { bookId: string; designId: string } }>('/api/v1/v7/books/:bookId/cover-designs/:designId/image', async (request, reply) => {
    const owner = requireAuthenticatedOwner(request);
    books.requireVisible(owner.ownerId, request.params.bookId);
    const image = coverDesigns.readImage(owner.ownerId, request.params.bookId, request.params.designId);
    reply.header('content-type', image.mimeType);
    reply.header('content-disposition', 'inline');
    reply.header('cache-control', 'private, max-age=300');
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(image.buffer);
  });

  app.get<{ Params: { bookId: string; designId: string } }>('/api/v1/v7/books/:bookId/cover-designs/:designId/download', async (request, reply) => {
    const owner = requireAuthenticatedOwner(request);
    books.requireVisible(owner.ownerId, request.params.bookId);
    const image = coverDesigns.readImage(owner.ownerId, request.params.bookId, request.params.designId);
    const extension = image.mimeType === 'image/png' ? 'png' : image.mimeType === 'image/jpeg' ? 'jpg' : 'webp';
    reply.header('content-type', image.mimeType);
    reply.header('content-disposition', `attachment; filename="wenmi-cover-${request.params.designId}.${extension}"`);
    reply.header('cache-control', 'private, no-store');
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(image.buffer);
  });
}
