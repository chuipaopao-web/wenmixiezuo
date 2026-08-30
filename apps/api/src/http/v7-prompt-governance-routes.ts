import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { V7PromptGovernanceService } from '../application/agents/v7-prompt-governance-service.js';
import { success } from '../contracts/api.js';
import { SystemClock, UuidGenerator } from '../domain/ids.js';
import { V7PromptGovernanceRepository } from '../infrastructure/db/repositories/v7-prompt-governance-repository.js';
import { requireAdministrator } from '../infrastructure/security/auth-context.js';

export async function registerV7PromptGovernanceRoutes(app: FastifyInstance, database: DatabaseSync): Promise<void> {
  const service = new V7PromptGovernanceService(
    new V7PromptGovernanceRepository(database),
    new UuidGenerator(),
    new SystemClock()
  );

  app.get('/api/v1/admin/v7/prompt-context/summary', async (request) => {
    requireAdministrator(request);
    return success(service.summary(), request.id);
  });

  app.get<{ Querystring: Record<string, unknown> }>('/api/v1/admin/v7/prompt-context/assets', async (request) => {
    requireAdministrator(request);
    return success(service.assets(request.query ?? {}), request.id);
  });

  app.get<{ Params: { assetKey: string } }>('/api/v1/admin/v7/prompt-context/assets/:assetKey/versions', async (request) => {
    requireAdministrator(request);
    return success(service.versions(request.params.assetKey), request.id);
  });

  app.post<{ Params: { assetKey: string }; Body: Record<string, unknown> }>(
    '/api/v1/admin/v7/prompt-context/assets/:assetKey/drafts',
    async (request) => {
      const administrator = requireAdministrator(request);
      return success(service.createDraft(administrator.userId, request.params.assetKey, request.body ?? {}), request.id);
    }
  );

  app.post<{ Params: { assetKey: string }; Body: Record<string, unknown> }>(
    '/api/v1/admin/v7/prompt-context/assets/:assetKey/preview',
    async (request) => {
      const administrator = requireAdministrator(request);
      return success(service.preview(administrator.userId, request.params.assetKey, request.body ?? {}), request.id);
    }
  );

  app.post<{ Params: { assetKey: string }; Body: Record<string, unknown> }>(
    '/api/v1/admin/v7/prompt-context/assets/:assetKey/publish',
    async (request) => {
      const administrator = requireAdministrator(request);
      return success(service.publish(administrator.userId, request.params.assetKey, request.body ?? {}), request.id);
    }
  );

  app.post<{ Params: { assetKey: string }; Body: Record<string, unknown> }>(
    '/api/v1/admin/v7/prompt-context/assets/:assetKey/restore-draft',
    async (request) => {
      const administrator = requireAdministrator(request);
      return success(service.restoreDraft(administrator.userId, request.params.assetKey, request.body ?? {}), request.id);
    }
  );

  app.get<{ Querystring: Record<string, unknown> }>('/api/v1/admin/v7/prompt-context/manifests', async (request) => {
    requireAdministrator(request);
    return success(service.manifests(request.query ?? {}), request.id);
  });

  app.get<{ Params: { manifestId: string } }>('/api/v1/admin/v7/prompt-context/manifests/:manifestId', async (request) => {
    requireAdministrator(request);
    return success(service.manifest(request.params.manifestId), request.id);
  });

  app.post<{ Params: { manifestId: string } }>(
    '/api/v1/admin/v7/prompt-context/manifests/:manifestId/verify-rebuild',
    async (request) => {
      requireAdministrator(request);
      return success(service.verifyManifestRebuild(request.params.manifestId), request.id);
    }
  );
}
