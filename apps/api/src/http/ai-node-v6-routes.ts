import type { EditorialRoleKey } from '@wenmi/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { AiNodeBatchService, type CreateAiNodeBatchInput } from '../application/agents/ai-node-batch-service.js';
import { success } from '../contracts/api.js';
import { SystemClock, UuidGenerator } from '../domain/ids.js';
import { requireAdministrator, requireAuthenticatedOwner } from '../infrastructure/security/auth-context.js';

type BookParams = { bookId: string };

export async function registerAiNodeV6Routes(app: FastifyInstance, database: DatabaseSync, releaseId: string): Promise<void> {
  const service = new AiNodeBatchService(database, releaseId, new UuidGenerator(), new SystemClock());
  const scope = (request: FastifyRequest, bookId: string) => ({ ...requireAuthenticatedOwner(request), bookId });

  app.get<{ Params: BookParams }>('/api/v1/books/:bookId/editorial-team', async (request) =>
    success({ pools: service.listPools(scope(request, request.params.bookId)) }, request.id));

  app.patch<{ Params: BookParams & { roleKey: EditorialRoleKey }; Body: {
    desiredCount: number; enabled: boolean; expectedRevision: number;
  } }>('/api/v1/books/:bookId/editorial-team/pools/:roleKey', async (request) => {
    requireAdministrator(request);
    return success(service.configurePool(scope(request, request.params.bookId), request.params.roleKey, request.body), request.id);
  });

  app.patch<{ Params: BookParams & { memberId: string }; Body: { enabled: boolean; expectedRevision: number } }>(
    '/api/v1/books/:bookId/editorial-team/members/:memberId', async (request) => {
      requireAdministrator(request);
      return success(service.setMemberEnabled(scope(request, request.params.bookId), request.params.memberId,
        request.body.enabled, request.body.expectedRevision), request.id);
    });

  app.put<{ Params: BookParams; Body: { nodeKind: string; objectId: string; contentText: string } }>(
    '/api/v1/books/:bookId/ai-nodes/author-input', async (request) =>
      success(service.saveAuthorInput(scope(request, request.params.bookId), request.body.nodeKind,
        request.body.objectId, request.body.contentText), request.id));

  app.post<{ Params: BookParams; Body: Pick<CreateAiNodeBatchInput,
    'roleKey' | 'hardSources' | 'optionalSources' | 'preferredMemberIds' | 'tokenBudget' | 'outputTokenBudget' | 'reasoningLevel' | 'roundCount' | 'exampleCount'> }>(
    '/api/v1/books/:bookId/ai-nodes/estimate', async (request) =>
      success(service.estimate(scope(request, request.params.bookId), request.body), request.id));

  app.post<{ Params: BookParams; Body: CreateAiNodeBatchInput }>('/api/v1/books/:bookId/ai-nodes/batches', async (request) =>
    success(service.createBatch(scope(request, request.params.bookId), request.body), request.id));

  app.get<{ Params: BookParams & { batchId: string } }>('/api/v1/books/:bookId/ai-nodes/batches/:batchId', async (request) =>
    success(service.viewBatch(scope(request, request.params.bookId), request.params.batchId), request.id));

  app.post<{ Params: BookParams & { batchId: string }; Body: { memberId: string; confirmHighCost?: boolean } }>(
    '/api/v1/books/:bookId/ai-nodes/batches/:batchId/members', async (request) =>
      success(service.addMember(scope(request, request.params.bookId), request.params.batchId,
        request.body.memberId, request.body.confirmHighCost === true), request.id));

  app.post<{ Params: BookParams & { batchId: string; batchMemberId: string } }>(
    '/api/v1/books/:bookId/ai-nodes/batches/:batchId/members/:batchMemberId/retry', async (request) =>
      success(service.retryMember(scope(request, request.params.bookId), request.params.batchId,
        request.params.batchMemberId), request.id));

  app.post<{ Params: BookParams & { batchId: string; batchMemberId: string }; Body: {
    replacementMemberId: string; confirmHighCost?: boolean;
  } }>('/api/v1/books/:bookId/ai-nodes/batches/:batchId/members/:batchMemberId/replace', async (request) =>
    success(service.replaceMember(scope(request, request.params.bookId), request.params.batchId,
      request.params.batchMemberId, request.body.replacementMemberId, request.body.confirmHighCost === true), request.id));
}
