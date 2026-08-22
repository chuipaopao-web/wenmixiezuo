import type {
  AuthorObjectDraftView,
  CharacterCardContent,
  CharacterCardView,
  CoreWorkflowStage,
  CreativeLedgerEntryView,
  CreativeLedgerType,
  StorylineContent,
  StorylineLifecycleStatus,
  StorylineRelationView,
  StorylineTopologyContent,
  StorylineVolumeParticipationStatus
} from '@wenmi/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { CoreWorkflowV6Service } from '../application/planning/core-workflow-v6-service.js';
import { success } from '../contracts/api.js';
import { SystemClock, UuidGenerator } from '../domain/ids.js';
import { requireAuthenticatedOwner } from '../infrastructure/security/auth-context.js';

type JsonObject = Record<string, unknown>;
type BookParams = { bookId: string };
type VersionSource = {
  sourceTaskId?: string | null;
  sourceVersionIds?: string[];
  authorInputRefs?: string[];
  parentVersionId?: string | null;
  baseVersion?: number;
};

export async function registerCoreWorkflowV6Routes(app: FastifyInstance, database: DatabaseSync): Promise<void> {
  const service = new CoreWorkflowV6Service(database, new UuidGenerator(), new SystemClock());
  const scope = (request: FastifyRequest, bookId: string) => ({ ...requireAuthenticatedOwner(request), bookId });

  app.get<{ Params: BookParams }>('/api/v1/books/:bookId/core-workflow', async (request) =>
    success(service.view(scope(request, request.params.bookId)), request.id));

  app.post<{ Params: BookParams; Body: VersionSource & { content: StorylineTopologyContent } }>(
    '/api/v1/books/:bookId/core-workflow/storyline-topology/versions', async (request) =>
      success({ topologyVersionId: service.saveTopology(scope(request, request.params.bookId), request.body) }, request.id));

  app.post<{ Params: BookParams & { topologyVersionId: string }; Body: { expectedActiveVersionId: string | null } }>(
    '/api/v1/books/:bookId/core-workflow/storyline-topology/versions/:topologyVersionId/confirm', async (request) => {
      service.confirmTopology(scope(request, request.params.bookId), request.params.topologyVersionId, request.body.expectedActiveVersionId);
      return success({ confirmed: true }, request.id);
    });

  app.post<{ Params: BookParams; Body: VersionSource & { content: StorylineContent; sortOrder?: number } }>(
    '/api/v1/books/:bookId/core-workflow/storylines', async (request) =>
      success(service.createStoryline(scope(request, request.params.bookId), request.body), request.id));

  app.post<{ Params: BookParams & { storylineId: string }; Body: VersionSource & { content: StorylineContent } }>(
    '/api/v1/books/:bookId/core-workflow/storylines/:storylineId/versions', async (request) =>
      success({ versionId: service.saveStorylineVersion(scope(request, request.params.bookId), request.params.storylineId, request.body) }, request.id));

  app.post<{ Params: BookParams & { storylineId: string; versionId: string }; Body: { expectedActiveVersionId: string | null } }>(
    '/api/v1/books/:bookId/core-workflow/storylines/:storylineId/versions/:versionId/confirm', async (request) => {
      service.confirmStoryline(scope(request, request.params.bookId), request.params.storylineId, request.params.versionId,
        request.body.expectedActiveVersionId);
      return success({ confirmed: true }, request.id);
    });

  app.put<{ Params: BookParams; Body: { storylineIds: string[] } }>(
    '/api/v1/books/:bookId/core-workflow/storylines/order', async (request) => {
      service.reorderStorylines(scope(request, request.params.bookId), request.body.storylineIds);
      return success({ reordered: true }, request.id);
    });

  app.patch<{ Params: BookParams & { storylineId: string }; Body: { status: StorylineLifecycleStatus } }>(
    '/api/v1/books/:bookId/core-workflow/storylines/:storylineId/lifecycle', async (request) => {
      service.updateStorylineLifecycle(scope(request, request.params.bookId), request.params.storylineId, request.body.status);
      return success({ updated: true }, request.id);
    });

  app.post<{ Params: BookParams; Body: { fromStorylineId: string; toStorylineId: string;
    relationType: StorylineRelationView['relationType']; description: string } }>(
    '/api/v1/books/:bookId/core-workflow/storyline-relations', async (request) =>
      success({ relationId: service.upsertRelation(scope(request, request.params.bookId), request.body) }, request.id));

  app.put<{ Params: BookParams; Body: { storylineId: string; volumePlanId: string;
    participationStatus: StorylineVolumeParticipationStatus; responsibility?: string | null } }>(
    '/api/v1/books/:bookId/core-workflow/volume-participations', async (request) =>
      success({ participationId: service.upsertVolumeParticipation(scope(request, request.params.bookId), request.body) }, request.id));

  app.post<{ Params: BookParams; Body: { characterKind: CharacterCardView['characterKind']; content: CharacterCardContent;
    promotedFromCharacterId?: string | null } }>('/api/v1/books/:bookId/core-workflow/characters', async (request) =>
      success(service.createCharacter(scope(request, request.params.bookId), request.body), request.id));

  app.put<{ Params: BookParams; Body: { eventChainVersionId: string; eventNodeId: string; roleFunctionKey: string;
    roleFunctionLabel: string; requirement: JsonObject; assignedCharacterId?: string | null } }>(
    '/api/v1/books/:bookId/core-workflow/event-role-assignments', async (request) =>
      success({ assignmentId: service.upsertEventRole(scope(request, request.params.bookId), request.body) }, request.id));

  app.put<{ Params: BookParams; Body: { objectType: AuthorObjectDraftView['objectType']; objectId: string;
    baseVersion: number; expectedDraftRevision: number; draft: JsonObject; authorInputVersion?: number } }>(
    '/api/v1/books/:bookId/core-workflow/drafts', async (request) =>
      success(service.saveDraft(scope(request, request.params.bookId), request.body), request.id));

  app.post<{ Params: BookParams & { storylineId: string }; Body: { expectedActiveVersionId: string } }>(
    '/api/v1/books/:bookId/core-workflow/storylines/:storylineId/reopen', async (request) =>
      success(service.reopenStoryline(scope(request, request.params.bookId), request.params.storylineId,
        request.body.expectedActiveVersionId), request.id));

  app.post<{ Params: BookParams; Body: { ledgerType: CreativeLedgerType; truthStatus: 'planned' | 'actual';
    scopeType: CreativeLedgerEntryView['scopeType']; scopeId: string; subjectKey: string;
    entryStatus: CreativeLedgerEntryView['entryStatus']; content: JsonObject; sourceKind: CreativeLedgerEntryView['sourceKind'];
    sourceVersionId: string; sourceLocator?: JsonObject | null; supersedesEntryId?: string | null } }>(
    '/api/v1/books/:bookId/core-workflow/ledgers', async (request) =>
      success({ ledgerEntryId: service.writeLedger(scope(request, request.params.bookId), request.body) }, request.id));

  app.post<{ Params: BookParams & { invalidationId: string }; Body: { resolution: 'resolved' | 'not_affected' } }>(
    '/api/v1/books/:bookId/core-workflow/invalidations/:invalidationId/resolve', async (request) => {
      service.resolveInvalidation(scope(request, request.params.bookId), request.params.invalidationId, request.body.resolution);
      return success({ resolved: true }, request.id);
    });

  app.put<{ Params: BookParams; Body: { stage: CoreWorkflowStage; activeObjectId?: string | null;
    expectedStateVersion: number; blockingReason?: string | null } }>(
    '/api/v1/books/:bookId/core-workflow/state', async (request) =>
      success({ stateVersion: service.setWorkflowStage(scope(request, request.params.bookId), request.body) }, request.id));
}
