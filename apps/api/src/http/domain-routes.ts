import type { FastifyInstance } from 'fastify';
import { getPublicNarrativeTemplateCatalog, parsePlanningScope } from '@wenmi/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { readFileSync, statfsSync } from 'node:fs';
import { success } from '../contracts/api.js';
import { SystemClock, UuidGenerator } from '../domain/ids.js';
import { PositioningService } from '../application/books/positioning-service.js';
import { BookOnboardingService } from '../application/books/book-onboarding-service.js';
import { BookLifecycleService } from '../application/books/book-lifecycle-service.js';
import { BookRepository } from '../infrastructure/db/repositories/book-repository.js';
import { AgentTeamService, type AgentRecord } from '../application/agents/agent-team-service.js';
import { ArtifactService, type ArtifactType } from '../application/artifacts/artifact-service.js';
import { DiscussionService, type DiscussionType } from '../application/discussions/discussion-service.js';
import type { RuntimeConfig } from '../infrastructure/runtime-config.js';
import { ChapterCatalogService } from '../application/chapters/chapter-catalog-service.js';
import { CanonService, type FactInput } from '../application/knowledge/canon-service.js';
import { MemoryService, type MemoryLayer } from '../application/memory/memory-service.js';
import { HybridRetrievalService } from '../application/memory/hybrid-retrieval-service.js';
import { ContextPackService, type ContextPackInput } from '../application/memory/context-pack-service.js';
import { ChapterBatchService } from '../application/creation/chapter-batch-service.js';
import { resolveInside } from '../infrastructure/files/file-utils.js';
import { NarrativeProjectionService, type NarrativeProjectionType } from '../application/projections/narrative-projection-service.js';
import { CopyrightService, type RightsPath } from '../application/copyright/copyright-service.js';
import { ResearchService } from '../application/research/research-service.js';
import { diagnoseTextEncoding } from '../application/presentation/text-encoding-diagnostics.js';
import { AuthorAttachmentService } from '../application/planning/author-attachment-service.js';
import { TaskService } from '../application/tasks/task-service.js';
import { BackupService } from '../infrastructure/recovery/backup-service.js';
import { cancelActiveModelCall, ModelCallService } from '../application/calls/model-call-service.js';
import { cancelActiveToolCall } from '../application/calls/tool-call-service.js';
import { buildRuntimeRoleSystemPrompt, ModelAdapterFactory } from '../infrastructure/models/model-adapter-factory.js';
import type { ModelPurpose } from '../infrastructure/models/model-runtime-config.js';
import { PlanningArtifactService } from '../application/artifacts/planning-artifact-service.js';
import { ChapterApprovalService } from '../application/creation/chapter-approval-service.js';
import { CreationWorkflowProgressService } from '../application/creation/creation-workflow-progress-service.js';
import { EditorLeaseService, type EditorLeaseStatus } from '../application/editors/editor-lease-service.js';
import { ProductionWorkflowRepository } from '../infrastructure/db/repositories/production-workflow-repository.js';
import { ExpressionProfileService } from '../application/books/expression-profile-service.js';
import { ExpressionProfileRepository } from '../infrastructure/db/repositories/expression-profile-repository.js';
import { UnitOfWork } from '../infrastructure/db/unit-of-work.js';
import { DomainError, errorCodes } from '../domain/errors.js';
import { creativeMemberContracts, creativeRoleKeys, type CreativeRoleKey, type TeamModelProfile } from '../contracts/agent-team-v2.js';
import { AgentGovernanceRepository } from '../infrastructure/db/repositories/agent-governance-repository.js';
import { ModelBindingV2Service } from '../application/agents/model-binding-v2-service.js';
import { BookPortabilityService } from '../application/portability/book-portability-service.js';
import { TaxonomyService } from '../application/knowledge/taxonomy-service.js';
import { TaxonomyRepository } from '../infrastructure/db/repositories/taxonomy-repository.js';
import { RetrievalOrchestrationRepository } from '../infrastructure/db/repositories/retrieval-orchestration-repository.js';
import { KnowledgeRepository } from '../infrastructure/db/repositories/knowledge-repository.js';
import { ChunkSnapshotRepository } from '../infrastructure/db/repositories/chunk-snapshot-repository.js';
import { loadLocalRetrievalRuntime } from '../infrastructure/retrieval/local-retrieval-runtime.js';
import type { RetrievalMode } from '../contracts/retrieval-plan.js';
import type { AuthorAttachmentRecord } from '../infrastructure/db/repositories/author-attachment-repository.js';
import { ProtagonistStateService, type ProtagonistStateStatus, type ProtagonistValueType } from '../application/knowledge/protagonist-state-service.js';
import { AttributeFormulaService, type FormulaVariable } from '../application/knowledge/attribute-formula-service.js';
import { OwnerManuscriptService } from '../application/creation/owner-manuscript-service.js';
import { BudgetService } from '../application/budget/budget-service.js';
import { OPENING_TAXONOMY, type OpeningBlueprintInput } from '../contracts/opening-blueprint.js';
import { OpeningSynopsisAnalysisService } from '../application/books/opening-synopsis-analysis-service.js';
import { AgentPromptPreferenceService } from '../application/agents/agent-prompt-preference-service.js';
import { AgentPromptPreferenceRepository } from '../infrastructure/db/repositories/agent-prompt-preference-repository.js';
import { SettingOutlineWorkspaceService } from '../application/knowledge/setting-outline-workspace-service.js';
import { SettingCollaborationService } from '../application/knowledge/setting-collaboration-service.js';
import { SettingCollaborationRepository } from '../infrastructure/db/repositories/setting-collaboration-repository.js';
import { SettingCollaborationCommandService } from '../application/knowledge/setting-collaboration-command-service.js';
import { BookProfileViewService } from '../application/books/book-profile-view-service.js';
import { OpeningBlueprintService } from '../application/books/opening-blueprint-service.js';
import { OpeningBlueprintRepository } from '../infrastructure/db/repositories/opening-blueprint-repository.js';
import { PlanningStateService } from '../application/books/planning-state-service.js';
import { StyleBaselineService } from '../application/books/style-baseline-service.js';
import type { StyleBaselineInput } from '../contracts/style-baseline.js';
import { SettingBaselineService } from '../application/knowledge/setting-baseline-service.js';
import { PlanningStageArtifactService } from '../application/artifacts/planning-stage-artifact-service.js';
import { ExistingManuscriptContinuationService } from '../application/continuation/existing-manuscript-continuation-service.js';
import { PromptViewAccessService } from '../infrastructure/security/prompt-view-access.js';
import {
  AuthorCollaborationService,
  type CreateAuthorPlanningInput,
  type DecideAuthorPlanningInput
} from '../application/planning/author-collaboration-service.js';
import { AuthorPlanningInputRepository } from '../infrastructure/db/repositories/author-planning-input-repository.js';
import { IdeationService } from '../application/ideation/ideation-service.js';
import { VolumePlanService, type VolumePlanCandidateKind } from '../application/planning/volume-plan-service.js';
import { VolumePlanRepository } from '../infrastructure/db/repositories/volume-plan-repository.js';
import { VolumePlanGenerationRepository } from '../infrastructure/db/repositories/volume-plan-generation-repository.js';
import { VolumePlanGenerationService } from '../application/planning/volume-plan-generation-service.js';
import { StoryEventService } from '../application/planning/story-event-service.js';
import { StoryEventRepository, type StoryEventCandidateKind } from '../infrastructure/db/repositories/story-event-repository.js';
import { StoryEventGenerationRepository } from '../infrastructure/db/repositories/story-event-generation-repository.js';
import { StoryEventGenerationService } from '../application/planning/story-event-generation-service.js';
import { EventChapterOutlineService } from '../application/planning/event-chapter-outline-service.js';
import { EventChapterOutlineRepository } from '../infrastructure/db/repositories/event-chapter-outline-repository.js';
import { EventChapterGenerationRepository } from '../infrastructure/db/repositories/event-chapter-generation-repository.js';
import { EventChapterGenerationService, type EventChapterGenerationKind } from '../application/planning/event-chapter-generation-service.js';
import { CreationSettlementService } from '../application/planning/creation-settlement-service.js';
import { CreationSettlementRepository } from '../infrastructure/db/repositories/creation-settlement-repository.js';
import { LongformContinuityRepository } from '../infrastructure/db/repositories/longform-continuity-repository.js';
import { StageSettlementService } from '../application/continuity/stage-settlement-service.js';

const promptPurposeLabels: Readonly<Record<ModelPurpose, string>> = {
  discussion: '讨论与规划',
  novel_writer: '正文写作',
  novel_reviewer: '正文点评',
  review_synthesis: '点评综合'
};

function isCreativeRoleKey(value: string | undefined): value is CreativeRoleKey {
  return value !== undefined && (creativeRoleKeys as readonly string[]).includes(value);
}

function promptPurposesForRole(roleKey: CreativeRoleKey): ModelPurpose[] {
  const purposes: ModelPurpose[] = ['discussion'];
  if (roleKey === 'chief_editor' || roleKey === 'deputy_editor') purposes.push('review_synthesis');
  if (roleKey === 'lead_writer' || roleKey === 'backup_writer') purposes.push('novel_writer');
  if (roleKey === 'setting' || roleKey === 'literary_reviewer' || roleKey === 'experience_reviewer') {
    purposes.push('novel_reviewer');
  }
  return purposes;
}

function publicRoleStatement(roleKey: CreativeRoleKey): string {
  const contract = creativeMemberContracts.find((item) => item.roleKey === roleKey);
  if (contract === undefined) return '按照当前岗位职责完成工作，不冒充其他成员，也不声称完成尚未执行的操作。';
  const mainWork = contract.responsibilities.slice(0, 3).join('、');
  return `${contract.memberName}是团队中的${contract.shortTitle}，${contract.publicSummary}。主要负责${mainWork}。`;
}

function agentAvailability(
  agent: AgentRecord,
  modelRuntime: RuntimeConfig['modelRuntime']
): { availability: 'available' | 'unavailable'; availabilityReason: string | null } {
  if (agent.activationState === 'disabled') {
    return { availability: 'unavailable', availabilityReason: '成员已停用' };
  }
  if (agent.provider === 'local-deterministic' || agent.provider === 'openai-codex-subscription') {
    return { availability: 'available', availabilityReason: null };
  }
  const publicProfile = modelRuntime.publicProfiles.find((profile) =>
    profile.provider === agent.provider && profile.modelId === agent.modelId
  );
  const credentialConfigured = publicProfile?.credentialConfigured
    ?? (agent.provider === modelRuntime.endpoints.coding.provider
      ? modelRuntime.endpoints.coding.apiKey !== undefined
      : agent.provider === modelRuntime.endpoints.agent.provider
        ? modelRuntime.endpoints.agent.apiKey !== undefined
        : false);
  return credentialConfigured
    ? { availability: 'available', availabilityReason: null }
    : { availability: 'unavailable', availabilityReason: '模型路线缺少可用凭证' };
}

function authorAttachmentView(record: AuthorAttachmentRecord): Record<string, unknown> {
  return {
    attachmentId: record.attachmentId,
    originalName: record.originalName,
    mediaKind: record.mediaKind,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    parseStatus: record.parseStatus,
    parsedCharCount: record.parsedCharCount,
    parseError: record.parseError,
    lifecycleLayer: record.lifecycleLayer,
    createdAt: record.createdAt
  };
}

export async function registerDomainRoutes(app: FastifyInstance, database: DatabaseSync, config: RuntimeConfig): Promise<void> {
  const ids = new UuidGenerator();
  const clock = new SystemClock();
  const modelAdapters = new ModelAdapterFactory(config.modelRuntime);
  const promptViewAccess = new PromptViewAccessService(config.promptViewPassword);
  const owner = { ownerId: config.ownerId };
  const positioning = new PositioningService(database, ids, clock);
  const onboarding = new BookOnboardingService(database, ids, clock, config.modelRuntime.roleProfiles, config.releaseId);
  const lifecycle = new BookLifecycleService(database, config.dataDir, ids, clock);
  const books = new BookRepository(database);
  const agents = new AgentTeamService(database, ids, clock, config.modelRuntime.roleProfiles);
  const artifacts = new ArtifactService(database, ids, clock);
  const discussions = new DiscussionService(database, ids, clock);
  const chapters = new ChapterCatalogService(database, ids, clock);
  const canon = new CanonService(database, ids, clock);
  const memory = new MemoryService(database, ids, clock);
  const localRetrievalRuntime = loadLocalRetrievalRuntime(config.dataDir);
  const retrieval = new HybridRetrievalService(
    new RetrievalOrchestrationRepository(database), new KnowledgeRepository(database),
    new ChunkSnapshotRepository(database), ids, clock, localRetrievalRuntime
  );
  const contextPacks = new ContextPackService(database, ids, clock);
  const chapterBatches = new ChapterBatchService(database, config.dataDir, config.releaseId, ids, clock, modelAdapters);
  const projections = new NarrativeProjectionService(database, ids, clock);
  const copyright = new CopyrightService(database, ids, clock);
  const research = new ResearchService(database, ids, clock);

  const authorAttachments = new AuthorAttachmentService(database, config.dataDir, ids, clock);
  const tasks = new TaskService(database, config.releaseId, clock);
  const ownerManuscripts = new OwnerManuscriptService(database, config.dataDir, config.releaseId, ids, clock);
  const continuationImports = new ExistingManuscriptContinuationService(
    database, config.dataDir, config.releaseId, ids, clock
  );
  const protagonists = new ProtagonistStateService(database, ids, clock);
  const attributeFormulas = new AttributeFormulaService(database, ids, clock);
  const settingOutlineWorkspace = new SettingOutlineWorkspaceService(database, clock);
  const settingCollaboration = new SettingCollaborationService(
    new SettingCollaborationRepository(database), settingOutlineWorkspace
  );
  const settingCollaborationCommands = new SettingCollaborationCommandService(
    database, config.releaseId, ids, clock
  );
  const bookProfileView = new BookProfileViewService(database);
  const openingBlueprints = new OpeningBlueprintService(
    new OpeningBlueprintRepository(database), books, new UnitOfWork(database), ids, clock
  );
  const planningStates = new PlanningStateService(database);
  const styleBaselines = new StyleBaselineService(database, ids, clock);
  const settingBaselines = new SettingBaselineService(database, ids, clock);
  const planningStageArtifacts = new PlanningStageArtifactService(database, clock);
  const budgets = new BudgetService(database, ids, clock);
  const modelCalls = new ModelCallService(database, clock, budgets);
  const editors = new EditorLeaseService(database, ids, clock);
  const chapterApprovals = new ChapterApprovalService(
    new ProductionWorkflowRepository(database), config.dataDir, config.releaseId, ids, clock, chapters, canon, tasks, protagonists, new CreationWorkflowProgressService(database)
  );
  const backups = new BackupService(database, config);
  const expressionProfiles = new ExpressionProfileService(new ExpressionProfileRepository(database), new UnitOfWork(database), ids, clock);
  const agentGovernance = new AgentGovernanceRepository(database);
  const modelBindings = new ModelBindingV2Service(agentGovernance, new UnitOfWork(database), ids, clock, config.modelRuntime.activeMode);
  const portability = new BookPortabilityService(database, config, ids, clock);
  const taxonomy = new TaxonomyService(new TaxonomyRepository(database), ids, clock);
  const openingSynopsisAnalysis = new OpeningSynopsisAnalysisService();
  const agentPromptPreferences = new AgentPromptPreferenceService(
    new AgentPromptPreferenceRepository(database), ids, clock
  );
  const authorCollaboration = new AuthorCollaborationService(
    new AuthorPlanningInputRepository(database), new UnitOfWork(database), ids, clock
  );
  const ideation = new IdeationService(
    database, ids, clock, discussions, tasks, authorCollaboration
  );
  const volumePlans = new VolumePlanService(
    new VolumePlanRepository(database), new UnitOfWork(database), ids, clock
  );
  const volumePlanGenerationRepository = new VolumePlanGenerationRepository(database);
  const volumePlanGenerations = new VolumePlanGenerationService(
    volumePlanGenerationRepository, volumePlans, tasks, new UnitOfWork(database), ids, clock
  );

  const storyEventRepository = new StoryEventRepository(database);
  const storyEvents = new StoryEventService(
    storyEventRepository, new UnitOfWork(database), ids, clock
  );
  const storyEventGenerationRepository = new StoryEventGenerationRepository(database);
  const storyEventGenerations = new StoryEventGenerationService(
    storyEventGenerationRepository, storyEventRepository, volumePlanGenerationRepository, tasks,
    new UnitOfWork(database), ids, clock
  );
  const eventChapterOutlineRepository = new EventChapterOutlineRepository(database);
  const eventChapterOutlines = new EventChapterOutlineService(
    eventChapterOutlineRepository, new UnitOfWork(database), artifacts, ids, clock
  );
  const eventChapterGenerationRepository = new EventChapterGenerationRepository(database);
  const eventChapterGenerations = new EventChapterGenerationService(
    eventChapterGenerationRepository, eventChapterOutlines, volumePlanGenerationRepository, tasks,
    new UnitOfWork(database), ids, clock
  );
  const continuityRepository = new LongformContinuityRepository(database);
  const creationSettlements = new CreationSettlementService(
    new CreationSettlementRepository(database), continuityRepository,
    new StageSettlementService(continuityRepository, new UnitOfWork(database), ids, clock), ids, clock
  );

  app.get('/api/v1/opening-taxonomy', async (request) => success(OPENING_TAXONOMY, request.id));

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/workflow', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    books.require(scope);
    return success(volumePlans.workflow(scope), request.id);
  });

  app.get<{Params:{bookId:string;eventId:string}}>(
    '/api/v1/books/:bookId/story-events/:eventId/settlement',async(request)=>{
      const scope={ownerId:owner.ownerId,bookId:request.params.bookId};books.require(scope);
      return success(creationSettlements.getEvent(scope,request.params.eventId),request.id);
    });
  app.post<{Params:{bookId:string;eventId:string};Body:{expectedWorkflowVersion:number}}>(
    '/api/v1/books/:bookId/story-events/:eventId/settle',async(request)=>{
      const scope={ownerId:owner.ownerId,bookId:request.params.bookId};books.require(scope);
      return success(creationSettlements.settleEvent(scope,request.params.eventId,request.body.expectedWorkflowVersion),request.id);
    });
  app.get<{Params:{bookId:string;volumePlanId:string}}>(
    '/api/v1/books/:bookId/volume-plans/:volumePlanId/settlement',async(request)=>{
      const scope={ownerId:owner.ownerId,bookId:request.params.bookId};books.require(scope);
      return success(creationSettlements.getVolume(scope,request.params.volumePlanId),request.id);
    });
  app.post<{Params:{bookId:string;volumePlanId:string};Body:{expectedWorkflowVersion:number}}>(
    '/api/v1/books/:bookId/volume-plans/:volumePlanId/settle',async(request)=>{
      const scope={ownerId:owner.ownerId,bookId:request.params.bookId};books.require(scope);
      return success(creationSettlements.settleVolume(scope,request.params.volumePlanId,request.body.expectedWorkflowVersion),request.id);
    });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/volume-plans', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    books.require(scope);
    return success(volumePlans.list(scope), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: {
    expectedWorkflowVersion: number;
    planNumber: number;
    physicalVolumeId?: string | null;
    idempotencyKey: string;
  } }>('/api/v1/books/:bookId/volume-plans', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    books.require(scope);
    return success(volumePlans.create(scope, request.body), request.id);
  });

  app.get<{ Params: { bookId: string; volumePlanId: string } }>(
    '/api/v1/books/:bookId/volume-plans/:volumePlanId', async (request) => {
      const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
      books.require(scope);
      return success(volumePlans.get(scope, request.params.volumePlanId), request.id);
    }
  );

  app.get<{ Params: { bookId: string; volumePlanId: string } }>(
    '/api/v1/books/:bookId/volume-plans/:volumePlanId/versions', async (request) => {
      const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
      books.require(scope);
      return success(volumePlans.listVersions(scope, request.params.volumePlanId), request.id);
    }
  );

  app.post<{ Params: { bookId: string; volumePlanId: string }; Body: {
    expectedPlanRevision: number;
    candidateKind: VolumePlanCandidateKind;
    parentVersionId?: string | null;
    sourceTaskId?: string | null;
    authorInputRefs?: string[];
    template: unknown;
    content: unknown;
    idempotencyKey: string;
  } }>('/api/v1/books/:bookId/volume-plans/:volumePlanId/versions', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    books.require(scope);
    return success(volumePlans.addVersion(scope, request.params.volumePlanId, request.body), request.id);
  });

  app.get<{ Params: { bookId: string; volumePlanId: string } }>(
    '/api/v1/books/:bookId/volume-plans/:volumePlanId/generation', async (request) => {
      const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
      books.require(scope);
      return success(volumePlanGenerations.latest(scope, request.params.volumePlanId), request.id);
    }
  );

  app.post<{ Params: { bookId: string; volumePlanId: string }; Body: {
    expectedPlanRevision: number;
    expectedActiveVersionId?: string | null;
    expectedWorkflowVersion: number;
    template: unknown;
    authorInputRefs?: string[];
    idempotencyKey: string;
  } }>('/api/v1/books/:bookId/volume-plans/:volumePlanId/generate', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    books.require(scope);
    return success(volumePlanGenerations.start(
      scope, request.params.volumePlanId, request.body
    ), request.id);
  });
  app.post<{ Params: { bookId: string; volumePlanId: string }; Body: { volumePlanVersionId: string } }>(
    '/api/v1/books/:bookId/volume-plans/:volumePlanId/impact-preview', async (request) => {
      const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
      books.require(scope);
      return success(volumePlans.impactPreview(
        scope, request.params.volumePlanId, request.body.volumePlanVersionId
      ), request.id);
    }
  );

  app.post<{ Params: { bookId: string; volumePlanId: string }; Body: {
    volumePlanVersionId: string;
    expectedPlanRevision: number;
    expectedActiveVersionId?: string | null;
    expectedWorkflowVersion: number;
  } }>('/api/v1/books/:bookId/volume-plans/:volumePlanId/confirm', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    books.require(scope);
    return success(volumePlans.confirm(scope, request.params.volumePlanId, request.body), request.id);
  });

  app.get<{ Params: { bookId: string; volumePlanId: string } }>(
    '/api/v1/books/:bookId/volume-plans/:volumePlanId/event-sequence', async (request) => {
      const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
      books.require(scope);
      return success(storyEvents.getSequence(scope, request.params.volumePlanId), request.id);
    }
  );

  app.post<{ Params: { bookId: string; volumePlanId: string }; Body: {
    expectedWorkflowVersion: number; idempotencyKey: string;
  } }>('/api/v1/books/:bookId/volume-plans/:volumePlanId/event-sequence/initialize', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    books.require(scope);
    return success(storyEvents.initialize(scope, request.params.volumePlanId, request.body), request.id);
  });

  app.post<{ Params: { bookId: string; volumePlanId: string }; Body: {
    expectedSequenceRevision: number; proposal: unknown; idempotencyKey: string;
  } }>('/api/v1/books/:bookId/volume-plans/:volumePlanId/event-sequence/operations/preview', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    books.require(scope);
    return success(storyEvents.previewOperation(scope, request.params.volumePlanId, request.body), request.id);
  });

  app.post<{ Params: { bookId: string; volumePlanId: string }; Body: {
    operationId: string; expectedSequenceRevision: number;
  } }>('/api/v1/books/:bookId/volume-plans/:volumePlanId/event-sequence/operations/apply', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    books.require(scope);
    return success(storyEvents.applyOperation(scope, request.params.volumePlanId, request.body), request.id);
  });

  app.get<{ Params: { bookId: string; eventId: string } }>(
    '/api/v1/books/:bookId/story-events/:eventId/generation', async (request) => {
      const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
      books.require(scope);
      return success(storyEventGenerations.latest(scope, request.params.eventId), request.id);
    }
  );

  app.post<{ Params: { bookId: string; eventId: string }; Body: {
    expectedEventRevision: number; expectedActiveVersionId?: string | null;
    expectedWorkflowVersion: number; template: unknown; authorInputRefs?: string[]; idempotencyKey: string;
  } }>('/api/v1/books/:bookId/story-events/:eventId/generate', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    books.require(scope);
    return success(storyEventGenerations.start(scope, request.params.eventId, request.body), request.id);
  });
  app.get<{ Params: { bookId: string; eventId: string } }>(
    '/api/v1/books/:bookId/story-events/:eventId/versions', async (request) => {
      const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
      books.require(scope);
      return success(storyEvents.listVersions(scope, request.params.eventId), request.id);
    }
  );

  app.post<{ Params: { bookId: string; eventId: string }; Body: {
    expectedEventRevision: number; candidateKind: StoryEventCandidateKind;
    parentVersionId?: string | null; sourceTaskId?: string | null; authorInputRefs?: string[];
    template: unknown; content: unknown; idempotencyKey: string;
  } }>('/api/v1/books/:bookId/story-events/:eventId/versions', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    books.require(scope);
    return success(storyEvents.addVersion(scope, request.params.eventId, request.body), request.id);
  });

  app.post<{ Params: { bookId: string; eventId: string }; Body: { versionId: string } }>(
    '/api/v1/books/:bookId/story-events/:eventId/impact-preview', async (request) => {
      const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
      books.require(scope);
      return success(storyEvents.impactPreview(scope, request.params.eventId, request.body.versionId), request.id);
    }
  );

  app.post<{ Params: { bookId: string; eventId: string }; Body: {
    versionId: string; expectedEventRevision: number; expectedWorkflowVersion: number;
  } }>('/api/v1/books/:bookId/story-events/:eventId/confirm', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    books.require(scope);
    return success(storyEvents.confirm(scope, request.params.eventId, request.body), request.id);
  });
  app.get<{ Params:{bookId:string;eventId:string} }>('/api/v1/books/:bookId/story-events/:eventId/chapter-sequence',async(request)=>{
    const scope={ownerId:owner.ownerId,bookId:request.params.bookId};books.require(scope);
    return success(eventChapterOutlines.get(scope,request.params.eventId),request.id);
  });
  app.post<{ Params:{bookId:string;eventId:string};Body:{expectedWorkflowVersion:number;idempotencyKey:string} }>(
    '/api/v1/books/:bookId/story-events/:eventId/chapter-sequence/initialize',async(request)=>{
      const scope={ownerId:owner.ownerId,bookId:request.params.bookId};books.require(scope);
      return success(eventChapterOutlines.initialize(scope,request.params.eventId,request.body),request.id);
    });
  app.post<{ Params:{bookId:string;eventId:string};Body:{expectedSequenceRevision:number;parentVersionId?:string|null;
    authorInputRefs?:string[];content:unknown;sourceTaskId?:string|null;idempotencyKey:string} }>(
    '/api/v1/books/:bookId/story-events/:eventId/chapter-sequence/versions',async(request)=>{
      const scope={ownerId:owner.ownerId,bookId:request.params.bookId};books.require(scope);
      return success(eventChapterOutlines.addSequenceVersion(scope,request.params.eventId,request.body),request.id);
    });
  app.post<{ Params:{bookId:string;eventId:string};Body:{sequenceVersionId:string;expectedSequenceRevision:number;expectedWorkflowVersion:number} }>(
    '/api/v1/books/:bookId/story-events/:eventId/chapter-sequence/confirm',async(request)=>{
      const scope={ownerId:owner.ownerId,bookId:request.params.bookId};books.require(scope);
      return success(eventChapterOutlines.confirmSequence(scope,request.params.eventId,request.body),request.id);
    });
  app.get<{ Params:{bookId:string;eventId:string};Querystring:{kind?:EventChapterGenerationKind} }>(
    '/api/v1/books/:bookId/story-events/:eventId/chapter-sequence/generation',async(request)=>{
      const scope={ownerId:owner.ownerId,bookId:request.params.bookId};books.require(scope);
      return success(eventChapterGenerations.latest(scope,request.params.eventId,request.query.kind??'sequence'),request.id);
    });
  app.post<{ Params:{bookId:string;eventId:string};Body:{expectedSequenceRevision:number;expectedWorkflowVersion:number;
    authorInputRefs?:string[];idempotencyKey:string} }>(
    '/api/v1/books/:bookId/story-events/:eventId/chapter-sequence/generate',async(request)=>{
      const scope={ownerId:owner.ownerId,bookId:request.params.bookId};books.require(scope);
      return success(eventChapterGenerations.startSequence(scope,request.params.eventId,request.body),request.id);
    });
  app.post<{ Params:{bookId:string;eventId:string};Body:{count:number;expectedSequenceRevision:number;expectedWorkflowVersion:number;
    authorInputRefs?:string[];idempotencyKey:string} }>(
    '/api/v1/books/:bookId/story-events/:eventId/chapter-outlines/generate',async(request)=>{
      const scope={ownerId:owner.ownerId,bookId:request.params.bookId};books.require(scope);
      return success(eventChapterGenerations.startDetails(scope,request.params.eventId,request.body),request.id);
    });
  app.get<{ Params:{bookId:string;outlineId:string} }>(
    '/api/v1/books/:bookId/event-chapter-outlines/:outlineId/versions',async(request)=>{
      const scope={ownerId:owner.ownerId,bookId:request.params.bookId};books.require(scope);
      return success(eventChapterOutlines.listOutlineVersions(scope,request.params.outlineId),request.id);
    });
  app.post<{ Params:{bookId:string;outlineId:string};Body:{expectedOutlineRevision:number;parentVersionId?:string|null;
    authorInputRefs?:string[];content:Record<string,unknown>;sourceTaskId?:string|null;idempotencyKey:string} }>(
    '/api/v1/books/:bookId/event-chapter-outlines/:outlineId/versions',async(request)=>{
      const scope={ownerId:owner.ownerId,bookId:request.params.bookId};books.require(scope);
      return success(eventChapterOutlines.addOutlineVersion(scope,request.params.outlineId,request.body),request.id);
    });
  app.post<{ Params:{bookId:string;eventId:string};Body:{items:Array<{outlineId:string;outlineVersionId:string;expectedOutlineRevision:number}>;
    expectedWorkflowVersion:number} }>('/api/v1/books/:bookId/story-events/:eventId/chapter-outlines/freeze',async(request)=>{
      const scope={ownerId:owner.ownerId,bookId:request.params.bookId};books.require(scope);
      return success(eventChapterOutlines.freezeRecent(scope,request.params.eventId,request.body),request.id);
    });

  app.get<{ Params: { bookId: string }; Querystring: { scope?: string } }>(
    '/api/v1/books/:bookId/planning-templates',
    async (request) => {
      const bookScope = { ownerId: owner.ownerId, bookId: request.params.bookId };
      books.require(bookScope);
      let templateScope: 'volume' | 'event';
      try {
        templateScope = parsePlanningScope(request.query.scope);
      } catch {
        throw new DomainError(errorCodes.validation, '请选择“当前卷”或“当前事件”的推进参考。');
      }
      const profile = bookProfileView.find(bookScope);
      const signals = profile === null
        ? []
        : [profile.category, ...profile.subjects, ...profile.mainTags, ...profile.customTags];
      return success(getPublicNarrativeTemplateCatalog(templateScope, signals), request.id);
    }
  );

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/book-profile', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    return success(bookProfileView.get(scope), request.id);
  });
  app.put<{ Params: { bookId: string }; Body: {
    expectedVersion: number;
    title: string;
    openingBlueprint: OpeningBlueprintInput;
  } }>('/api/v1/books/:bookId/book-profile', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    openingBlueprints.revise(scope, request.body);
    return success(bookProfileView.get(scope), request.id);
  });
  app.get<{
    Params: { bookId: string };
    Querystring: { surface?: string; subjectType?: string; subjectId?: string };
  }>('/api/v1/books/:bookId/author-planning-inputs', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    books.require(scope);
    return success(authorCollaboration.list(scope, {
      ...(request.query.surface === undefined ? {} : { surface: request.query.surface as CreateAuthorPlanningInput['surface'] }),
      ...(request.query.subjectType === undefined ? {} : { subjectType: request.query.subjectType }),
      ...(request.query.subjectId === undefined ? {} : { subjectId: request.query.subjectId })
    }), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: CreateAuthorPlanningInput }>(
    '/api/v1/books/:bookId/author-planning-inputs',
    async (request) => {
      const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
      books.require(scope);
      return success(authorCollaboration.create(scope, request.body), request.id);
    }
  );

  app.get<{ Params: { bookId: string; authorInputId: string } }>(
    '/api/v1/books/:bookId/author-planning-inputs/:authorInputId',
    async (request) => {
      const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
      books.require(scope);
      return success(authorCollaboration.get(scope, request.params.authorInputId), request.id);
    }
  );

  app.post<{
    Params: { bookId: string; authorInputId: string };
    Body: DecideAuthorPlanningInput;
  }>('/api/v1/books/:bookId/author-planning-inputs/:authorInputId/decisions', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    books.require(scope);
    return success(authorCollaboration.decide(scope, request.params.authorInputId, request.body), request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/planning-state', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    return success(planningStates.get(scope), request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/style-baseline', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    return success(styleBaselines.get(scope), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { expectedPlanningVersion: number; style: StyleBaselineInput } }>(
    '/api/v1/books/:bookId/style-baseline/confirm',
    async (request) => {
      const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
      return success(styleBaselines.confirm(scope, request.body.expectedPlanningVersion, request.body.style), request.id);
    }
  );

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/setting-baseline/readiness', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    return success(settingBaselines.inspect(scope), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { expectedPlanningVersion: number } }>(
    '/api/v1/books/:bookId/setting-baseline/confirm',
    async (request) => {
      const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
      return success(settingBaselines.confirm(scope, request.body.expectedPlanningVersion), request.id);
    }
  );

  app.post<{
    Params: { bookId: string };
    Body: { expectedPlanningVersion: number; artifactVersionId: string; artifactType: 'master_outline' | 'chapter_outline' };
  }>('/api/v1/books/:bookId/planning-artifacts/confirm', async (request) => {
    const scope = { ownerId: owner.ownerId, bookId: request.params.bookId };
    return success(planningStageArtifacts.confirm(
      scope,
      request.body.expectedPlanningVersion,
      request.body.artifactVersionId,
      request.body.artifactType
    ), request.id);
  });

  app.post<{ Body: { synopsis?: string } }>('/api/v1/opening-synopsis/analyze', async (request) => {
    try {
      return success(openingSynopsisAnalysis.analyze({ synopsis: request.body.synopsis ?? '' }), request.id);
    } catch (error) {
      throw new DomainError(
        errorCodes.validation,
        error instanceof Error ? error.message : '剧情梗概格式无效',
        {},
        false,
        400
      );
    }
  });

  app.post<{ Body: {
    title?: string; text: string; category?: string; classification?: string;
    targetAudience?: string; expectedScaleChars?: number; initialExpressionBaseline?: string;
    tags?: string[]; style?: string; openingBlueprint?: OpeningBlueprintInput;
  } }>('/api/v1/books/drafts', async (request) => {
    try {
      return success(positioning.createDraft(owner, request.body), request.id);
    } catch (error) {
      if (request.body.openingBlueprint !== undefined && error instanceof Error) {
        throw new DomainError(errorCodes.validation, error.message, {}, false, 400);
      }
      throw error;
    }
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

  app.get('/api/v1/task-center', async (request) => {
    const activeTaskStatuses = new Set([
      'pending', 'queued', 'working', 'waiting_confirmation', 'paused', 'blocked', 'interrupted'
    ]);
    const chapterStatement = database.prepare(`
      SELECT chapter_id AS chapterId, volume_id AS volumeId, chapter_number AS chapterNumber, title,
             plan_status AS planStatus, generation_status AS generationStatus,
             settlement_status AS settlementStatus,
             current_manuscript_version_id AS currentManuscriptVersionId,
             canon_manuscript_version_id AS canonManuscriptVersionId
      FROM chapters
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ?
    `);
    const taskBooks = books.list(owner)
      .filter((book) => book.status !== 'archived')
      .map((book) => {
        const scope = { ...owner, bookId: book.bookId };
        const allTasks = tasks.list(scope);
        const activeTasks = allTasks.filter((task) => activeTaskStatuses.has(task.status));
        const recentTasks = allTasks.filter((task) => !activeTaskStatuses.has(task.status)).slice(-8);
        const visibleTasks = [...activeTasks, ...recentTasks];
        const chapterIds = [...new Set(visibleTasks.flatMap((task) => task.chapterId === null ? [] : [task.chapterId]))];
        const taskChapters = chapterIds.flatMap((chapterId) => {
          const chapter = chapterStatement.get(scope.ownerId, scope.bookId, chapterId);
          return chapter === undefined ? [] : [chapter];
        });
        const assignedAgentIds = new Set(visibleTasks.flatMap((task) =>
          task.assignedAgentId === null ? [] : [task.assignedAgentId]));
        const taskAgents = agents.list(scope)
          .filter((agent) => assignedAgentIds.has(agent.agentId))
          .map((agent) => {
            const contract = creativeMemberContracts.find((item) => item.roleKey === agent.roleKey as string);
            return {
              ...agent,
              publicSummary: contract?.publicSummary ?? agent.roleName,
              responsibilities: contract?.responsibilities ?? [],
              boundaries: contract?.boundaries ?? [],
              retrievalFocus: contract?.retrievalFocus ?? [],
              outputKinds: contract?.outputKinds ?? []
            };
          });
        const budget = database.prepare(`
          SELECT mode, token_limit, spent_tokens, reserved_tokens, cash_limit_micros, spent_cash_micros, status
          FROM budgets WHERE owner_id = ? AND book_id = ? ORDER BY created_at LIMIT 1
        `).get(scope.ownerId, scope.bookId) ?? null;
        const confirmationRows = database.prepare(`
          SELECT confirmation_id, target_type, target_id, expected_canon_revision,
                 scope_json, impact_json, created_at
          FROM confirmations WHERE owner_id = ? AND book_id = ? AND status = 'pending'
          ORDER BY created_at, confirmation_id
        `).all(scope.ownerId, scope.bookId) as unknown as Array<{
          confirmation_id: string; target_type: string; target_id: string;
          expected_canon_revision: number; scope_json: string; impact_json: string; created_at: string;
        }>;
        return {
          book,
          chapters: taskChapters,
          agents: taskAgents,
          tasks: visibleTasks,
          budget,
          confirmations: {
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
          }
        };
      });
    return success({ books: taskBooks }, request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/expression-profile', async (request) => {
    return success(expressionProfiles.active({ ...owner, bookId: request.params.bookId }), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: Parameters<ExpressionProfileService['revise']>[1] }>('/api/v1/books/:bookId/expression-profile', async (request) => {
    return success(expressionProfiles.revise({ ...owner, bookId: request.params.bookId }, request.body), request.id);
  });

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
    const volumes = database.prepare(`
      SELECT v.volume_id AS volumeId, v.volume_number AS volumeNumber, v.title, v.status,
        COUNT(c.chapter_id) AS chapterCount,
        SUM(CASE WHEN c.settlement_status = 'settled' THEN 1 ELSE 0 END) AS settledCount
      FROM volumes v LEFT JOIN chapters c ON c.owner_id = v.owner_id AND c.book_id = v.book_id AND c.volume_id = v.volume_id
      WHERE v.owner_id = ? AND v.book_id = ? GROUP BY v.volume_id ORDER BY v.volume_number
    `).all(scope.ownerId, scope.bookId);
    const liveAgents = agents.list(scope).map((agent) => {
      const contract = creativeMemberContracts.find((item) => item.roleKey === agent.roleKey as string);
      return {
        ...agent,
        ...agentAvailability(agent, config.modelRuntime),
        publicSummary: contract?.publicSummary ?? agent.roleName,
        responsibilities: contract?.responsibilities ?? [],
        boundaries: contract?.boundaries ?? [],
        retrievalFocus: contract?.retrievalFocus ?? [],
        outputKinds: contract?.outputKinds ?? []
      };
    });
    // P0-4: 暴露主编租约真实状态（含过期标记与接管态），前端据此显示"西施接管中"而非把过期租约当 stable。
    let editorLease: EditorLeaseStatus | null = null;
    try {
      editorLease = editors.describeLease(scope);
    } catch {
      editorLease = null;
    }
    return success({
      book,
      chapters: chapters.listWorkspaceWindow(scope),
      volumes,
      agents: liveAgents,
      tasks: tasks.list(scope),
      budget,
      editor: editorLease,
      confirmations,
      localAssistant: {
        displayName: '小文秘书', roleName: '本地秘书', status: 'ready',
        summary: '整理作者资料、附件、任务状态和页面导航，不参与剧情决策。'
      }
    }, request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/team-config', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    books.require(scope);
    const preferences = new Map(agentPromptPreferences.list(scope).map((item) => [item.agentId, item]));
    const members = agents.list(scope).map((agent) => {
      const contract = creativeMemberContracts.find((item) => item.roleKey === agent.roleKey as string);
      return {
        ...agent,
        ...agentAvailability(agent, config.modelRuntime),
        publicSummary: contract?.publicSummary ?? agent.roleName,
        responsibilities: contract?.responsibilities ?? [],
        boundaries: contract?.boundaries ?? [],
        retrievalFocus: contract?.retrievalFocus ?? [],
        outputKinds: contract?.outputKinds ?? [],
        roleStatement: isCreativeRoleKey(agent.roleKey)
          ? publicRoleStatement(agent.roleKey)
          : `按照${agent.roleName}的职责完成工作，不冒充其他成员。`,
        promptPreference: preferences.get(agent.agentId) ?? {
          promptPreferenceId: null,
          agentId: agent.agentId,
          version: 0,
          content: '',
          createdAt: null
        }
      };
    });
    return success({
      members,
      promptPolicy: {
        editableLabel: '本书岗位补充要求',
        maxChars: 4000,
        priority: '软性要求不会覆盖系统硬约束、事实证据、正史、安全规则和输出格式。',
        fullPromptAccess: {
          configured: promptViewAccess.configured,
          passwordProtected: true
        }
      }
    }, request.id);
  });

  app.get('/api/v1/team-template', async (request) => success({
    fullPromptAccess: {
      configured: promptViewAccess.configured,
      passwordProtected: true
    },
    members: creativeMemberContracts.map((contract) => ({
      roleTemplateId: contract.roleTemplateId,
      roleKey: contract.roleKey,
      memberName: contract.memberName,
      shortTitle: contract.shortTitle,
      category: contract.category,
      publicSummary: contract.publicSummary,
      responsibilities: contract.responsibilities,
      boundaries: contract.boundaries,
      retrievalFocus: contract.retrievalFocus,
      outputKinds: contract.outputKinds,
      defaultActivation: contract.defaultActivation,
      defaultModel: contract.defaultModel,
      roleStatement: publicRoleStatement(contract.roleKey)
    }))
  }, request.id));

  app.post<{
    Body: { password?: string; roleKey?: string; bookId?: string; agentId?: string };
  }>('/api/v1/prompt-view', async (request, reply) => {
    reply.header('Cache-Control', 'no-store, max-age=0');
    reply.header('Pragma', 'no-cache');
    promptViewAccess.verify(request.body.password, request.ip);
    if (!isCreativeRoleKey(request.body.roleKey)) {
      throw new DomainError(errorCodes.validation, '请选择有效的团队岗位。');
    }
    const contract = creativeMemberContracts.find((item) => item.roleKey === request.body.roleKey);
    if (contract === undefined) throw new DomainError(errorCodes.validation, '岗位合同不存在。');

    if (request.body.bookId !== undefined || request.body.agentId !== undefined) {
      if (request.body.bookId === undefined || request.body.agentId === undefined) {
        throw new DomainError(errorCodes.validation, '查看本书成员提示词时，书籍和成员必须同时提供。');
      }
      const scope = { ...owner, bookId: request.body.bookId };
      books.require(scope);
      const agent = agents.list(scope).find((item) => item.agentId === request.body.agentId);
      if (agent === undefined || agent.roleKey !== request.body.roleKey) {
        throw new DomainError(errorCodes.validation, '成员与书籍或岗位不匹配。');
      }
    }

    return success({
      roleKey: contract.roleKey,
      identity: `${contract.memberName}（${contract.shortTitle}）`,
      note: '以下是后端实际使用的稳定岗位系统提示词。每次任务动态追加的本书补充要求、任务指令和检索资料包不会展示；查看密码也不会保存。',
      variants: promptPurposesForRole(contract.roleKey).map((purpose) => ({
        purpose,
        label: promptPurposeLabels[purpose],
        prompt: buildRuntimeRoleSystemPrompt(contract.roleKey, purpose)
      }))
    }, request.id);
  });

  app.put<{
    Params: { bookId: string; agentId: string };
    Body: { expectedVersion: number; content?: string };
  }>('/api/v1/books/:bookId/agents/:agentId/prompt-preference', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    books.require(scope);
    return success(agentPromptPreferences.revise(
      scope,
      request.params.agentId,
      request.body.expectedVersion,
      request.body.content ?? ''
    ), request.id);
  });

  app.get<{ Params: { bookId: string }; Querystring: { offset?: number; limit?: number } }>('/api/v1/books/:bookId/volumes', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    books.require(scope);
    const offset = Math.max(0, Number(request.query.offset ?? 0));
    const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 30)));
    const total = (database.prepare(`SELECT COUNT(*) AS count FROM volumes WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { count: number }).count;
    const items = database.prepare(`SELECT volume_id AS volumeId, volume_number AS volumeNumber, title, status
      FROM volumes WHERE owner_id = ? AND book_id = ? ORDER BY volume_number LIMIT ? OFFSET ?`)
      .all(scope.ownerId, scope.bookId, limit, offset);
    return success({ items, total, offset, limit }, request.id);
  });

  app.get<{ Params: { bookId: string; volumeId: string }; Querystring: { offset?: number; limit?: number; query?: string; status?: string } }>('/api/v1/books/:bookId/volumes/:volumeId/chapters', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    books.require(scope);
    const offset = Math.max(0, Number(request.query.offset ?? 0));
    const limit = Math.min(200, Math.max(1, Number(request.query.limit ?? 80)));
    const query = String(request.query.query ?? '').trim();
    const status = String(request.query.status ?? '').trim();
    const pattern = `%${query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    const where = `c.owner_id = ? AND c.book_id = ? AND (? = 'all' OR c.volume_id = ?)
      AND (? = '' OR c.plan_status = ? OR c.generation_status = ? OR c.settlement_status = ?
        OR (? = 'review' AND c.generation_status = 'completed' AND c.settlement_status <> 'settled')
        OR (? = 'blocked' AND c.generation_status = 'failed'))
      AND (? = '%%' OR CAST(c.chapter_number AS TEXT) LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM fact_assertions f JOIN entities e ON e.entity_id = f.subject_entity_id
          WHERE f.owner_id = c.owner_id AND f.book_id = c.book_id AND f.source_chapter_id = c.chapter_id
            AND (e.canonical_name LIKE ? ESCAPE '\\' OR e.aliases_json LIKE ? ESCAPE '\\')
        ))`;
    const countParameters = [
      scope.ownerId, scope.bookId, request.params.volumeId, request.params.volumeId,
      status, status, status, status, status, status,
      pattern, pattern, pattern, pattern, pattern
    ];
    const total = (database.prepare(`SELECT COUNT(*) AS count FROM chapters c WHERE ${where}`)
      .get(...countParameters) as { count: number }).count;
    const items = database.prepare(`SELECT chapter_id AS chapterId, volume_id AS volumeId, chapter_number AS chapterNumber,
      title, plan_status AS planStatus, generation_status AS generationStatus, settlement_status AS settlementStatus,
      current_manuscript_version_id AS currentManuscriptVersionId, canon_manuscript_version_id AS canonManuscriptVersionId
      FROM chapters c WHERE ${where} ORDER BY c.chapter_number LIMIT ? OFFSET ?`)
      .all(...countParameters, limit, offset);
    return success({ items, total, offset, limit }, request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/library', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    const book = books.require(scope);
    const entities = (database.prepare(`SELECT entity_id, entity_type, canonical_name, aliases_json, schema_version, status, updated_at
      FROM entities WHERE owner_id = ? AND book_id = ? ORDER BY entity_type, canonical_name LIMIT 500`)
      .all(scope.ownerId, scope.bookId) as unknown as Array<Record<string, unknown> & { aliases_json: string }>).map(({ aliases_json: aliasesJson, ...row }) => ({ ...row, aliases: parseStoredJson(aliasesJson) }));
    const facts = (database.prepare(`SELECT f.fact_id, f.subject_entity_id, e.canonical_name, f.relation_key, f.value_json,
      f.story_time_start, f.story_time_end, f.evidence_json, f.grade, f.status, f.source_chapter_id, f.source_manuscript_version_id,
      c.chapter_number AS source_chapter_number, c.title AS source_chapter_title
      FROM fact_assertions f JOIN entities e
        ON e.entity_id = f.subject_entity_id AND e.owner_id = f.owner_id AND e.book_id = f.book_id
      LEFT JOIN chapters c ON c.chapter_id = f.source_chapter_id AND c.owner_id = f.owner_id AND c.book_id = f.book_id
      WHERE f.owner_id = ? AND f.book_id = ? AND f.status NOT IN ('withdrawn', 'rejected')
      ORDER BY CASE f.status WHEN 'active' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, e.canonical_name LIMIT 1000`)
      .all(scope.ownerId, scope.bookId) as unknown as Array<Record<string, unknown> & { value_json: string; evidence_json: string }>).map(({ value_json: valueJson, evidence_json: evidenceJson, ...row }) => ({
        ...row, value: parseStoredJson(valueJson), evidence: parseStoredJson(evidenceJson)
      }));
    const relations = (database.prepare(`SELECT r.relationship_id, r.canon_revision, r.from_entity_id,
      e.canonical_name AS from_name, r.relation_key, r.to_value_json, r.source_fact_id
      FROM relationship_projection r JOIN entities e
        ON e.entity_id = r.from_entity_id AND e.owner_id = r.owner_id AND e.book_id = r.book_id
      WHERE r.owner_id = ? AND r.book_id = ? AND r.canon_revision = ? ORDER BY e.canonical_name, r.relation_key LIMIT 500`)
      .all(scope.ownerId, scope.bookId, book.canonRevision) as unknown as Array<Record<string, unknown> & { to_value_json: string }>).map(({ to_value_json: toValueJson, ...row }) => ({ ...row, toValue: parseStoredJson(toValueJson) }));
    const tags = database.prepare(`SELECT d.tag_definition_id, d.namespace, d.name, d.description, d.color, d.icon,
      d.created_source, d.version, d.status, COUNT(a.tag_assignment_id) AS assignment_count
      FROM tag_definitions d LEFT JOIN tag_assignments a ON a.owner_id = d.owner_id AND a.book_id = d.book_id
        AND a.tag_definition_id = d.tag_definition_id AND a.status = 'active'
      WHERE d.owner_id = ? AND d.book_id = ? GROUP BY d.tag_definition_id ORDER BY d.namespace, d.name LIMIT 500`)
      .all(scope.ownerId, scope.bookId);
    const projections = (database.prepare(`SELECT projection_id, projection_type, track, chapter_number,
      canon_revision, content_json, source_ids_json, rebuilt_at FROM narrative_projections
      WHERE owner_id = ? AND book_id = ? ORDER BY projection_type, track, chapter_number LIMIT 1000`)
      .all(scope.ownerId, scope.bookId) as unknown as Array<Record<string, unknown> & { content_json: string; source_ids_json: string }>).map(({ content_json: contentJson, source_ids_json: sourceIdsJson, ...row }) => ({
        ...row, content: parseStoredJson(contentJson), sourceIds: parseStoredJson(sourceIdsJson)
      }));
    const gaps = database.prepare(`SELECT knowledge_gap_id, target_type, target_id, narrative_goal, gap_type,
      diagnosis, severity, intentional_unknown, source_task_id, status, created_at, resolved_at
      FROM knowledge_gap_findings WHERE owner_id = ? AND book_id = ? ORDER BY
      CASE severity WHEN 'blocking' THEN 0 WHEN 'important' THEN 1 WHEN 'optional' THEN 2 ELSE 3 END, created_at DESC LIMIT 500`)
      .all(scope.ownerId, scope.bookId);
    const scopedCount = (table: string, extra = '', parameters: Array<string | number> = []): number =>
      (database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id = ? AND book_id = ? ${extra}`)
        .get(scope.ownerId, scope.bookId, ...parameters) as { count: number }).count;
    return success({
      canonRevision: book.canonRevision,
      entities,
      facts,
      relations,
      tags,
      projections,
      gaps,
      settings: settingOutlineWorkspace.list(scope).filter((item) => item.status === '已确认' && item.content !== null),
      bookProfile: bookProfileView.find(scope),
      protagonists: protagonists.dashboard(scope),
      attributeFormulas: attributeFormulas.list(scope),
      summary: {
        entityCount: scopedCount('entities'),
        factCount: scopedCount('fact_assertions', `AND status NOT IN ('withdrawn', 'rejected')`),
        relationCount: scopedCount('relationship_projection', 'AND canon_revision = ?', [book.canonRevision]),
        tagCount: scopedCount('tag_definitions'),
        projectionCount: scopedCount('narrative_projections'),
        openGapCount: scopedCount('knowledge_gap_findings', `AND status = 'open'`)
      }
    }, request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/protagonists', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
    return success(protagonists.dashboard(scope), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { profileId?: string; displayName: string; entityId?: string | null; isPrimary?: boolean } }>(
    '/api/v1/books/:bookId/protagonists', async (request) => {
      const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
      return success(protagonists.saveProfile(scope, request.body), request.id);
    }
  );

  app.post<{ Params: { bookId: string; profileId: string } }>(
    '/api/v1/books/:bookId/protagonists/:profileId/archive', async (request) => {
      const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
      return success(protagonists.archiveProfile(scope, request.params.profileId), request.id);
    }
  );

  app.post<{ Params: { bookId: string; profileId: string }; Body: {
    category: string; logicalKey: string; label: string; valueType: ProtagonistValueType; value: unknown;
    unit?: string | null; stateStatus?: ProtagonistStateStatus; confirmed?: boolean;
    effectiveChapterNumber?: number | null; storyTime?: string | null; note?: string | null;
  } }>('/api/v1/books/:bookId/protagonists/:profileId/state', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
    return success(protagonists.append(scope, { profileId: request.params.profileId, ...request.body }), request.id);
  });

  app.post<{ Params: { bookId: string; entryId: string }; Body: { note?: string | null } }>(
    '/api/v1/books/:bookId/protagonist-state/:entryId/archive', async (request) => {
      const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
      return success(protagonists.archiveEntry(scope, request.params.entryId, request.body?.note ?? null), request.id);
    }
  );

  app.post<{ Params: { bookId: string; entryId: string }; Body: { category?: string } }>(
    '/api/v1/books/:bookId/protagonist-state/:entryId/classify', async (request) => {
      const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
      return success(protagonists.classify(scope, request.params.entryId, request.body?.category ?? ''), request.id);
    }
  );

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/attribute-formulas', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
    return success(attributeFormulas.list(scope), request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/setting-outline-workspace', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
    return success(settingOutlineWorkspace.list(scope), request.id);
  });
  app.get<{ Params: { bookId: string; itemKey: string } }>(
    '/api/v1/books/:bookId/setting-outline-workspace/:itemKey/collaboration', async (request) => {
      const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
      return success(settingCollaboration.inspect(scope, request.params.itemKey), request.id);
    }
  );
  app.post<{ Params: { bookId: string; itemKey: string }; Body: { authorInputId?: string | null; idempotencyKey: string } }>(
    '/api/v1/books/:bookId/setting-outline-workspace/:itemKey/collaboration/start', async (request) => {
      const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
      return success(settingCollaborationCommands.start(scope, request.params.itemKey, request.body), request.id);
    }
  );
  app.post<{ Params: { bookId: string; itemKey: string }; Body: { proposalIds: string[]; authorInputId?: string | null; idempotencyKey: string } }>(
    '/api/v1/books/:bookId/setting-outline-workspace/:itemKey/collaboration/synthesize', async (request) => {
      const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
      return success(settingCollaborationCommands.synthesize(scope, request.params.itemKey, request.body), request.id);
    }
  );
  app.post<{ Params: { bookId: string; itemKey: string }; Body: { authorInputId: string; idempotencyKey: string } }>(
    '/api/v1/books/:bookId/setting-outline-workspace/:itemKey/collaboration/revise', async (request) => {
      const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
      return success(settingCollaborationCommands.revise(scope, request.params.itemKey, request.body), request.id);
    }
  );

  app.put<{ Params: { bookId: string; itemKey: string }; Body: {
    groupTitle: string;
    label: string;
    prompt: string;
    sourceLabel: string;
    status: string;
    custom?: boolean;
    sortOrder?: number;
    content?: string | null;
  } }>('/api/v1/books/:bookId/setting-outline-workspace/:itemKey', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
    return success(settingOutlineWorkspace.save(scope, {
      itemKey: request.params.itemKey,
      ...request.body
    }), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { items: Array<{
    itemKey: string;
    groupTitle: string;
    label: string;
    prompt: string;
    sourceLabel: string;
    custom?: boolean;
    sortOrder?: number;
  }> } }>('/api/v1/books/:bookId/setting-outline-workspace/initialize', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
    return success(settingOutlineWorkspace.initialize(scope, request.body.items), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: {
    formulaKey: string; label: string; category?: string; expression: string; variables: FormulaVariable[]; unit?: string | null;
  } }>('/api/v1/books/:bookId/attribute-formulas', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
    return success(attributeFormulas.create(scope, request.body), request.id);
  });

  app.post<{ Params: { bookId: string; formulaId: string }; Body: { values: Record<string, number> } }>(
    '/api/v1/books/:bookId/attribute-formulas/:formulaId/evaluate', async (request) => {
      const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
      return success(attributeFormulas.evaluate(scope, request.params.formulaId, request.body.values), request.id);
    }
  );

  app.post<{ Params: { bookId: string; formulaId: string } }>(
    '/api/v1/books/:bookId/attribute-formulas/:formulaId/archive', async (request) => {
      const scope = { ...owner, bookId: request.params.bookId }; books.require(scope);
      return success(attributeFormulas.archive(scope, request.params.formulaId), request.id);
    }
  );

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/model-bindings', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    books.require(scope);
    const revisions = database.prepare(`SELECT agent_model_binding_revision_id AS revisionId, version, effective_from AS effectiveFrom,
      reason, status, created_at AS createdAt FROM agent_model_binding_revisions
      WHERE owner_id = ? AND book_id = ? ORDER BY version DESC`).all(scope.ownerId, scope.bookId);
    return success({ active: agentGovernance.activeBindings(scope), revisions, contracts: creativeMemberContracts }, request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { profiles: Record<string, TeamModelProfile> } }>('/api/v1/books/:bookId/model-bindings/preview', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    books.require(scope);
    const profiles = normalizeTeamProfiles(request.body.profiles);
    modelBindings.validate(profiles);
    return success({
      valid: true,
      futureTasksOnly: true,
      roleCount: creativeRoleKeys.length,
      compatibility: {
        plotModelsDiffer: modelSignature(profiles.lead_screenwriter) !== modelSignature(profiles.second_screenwriter),
        glmWriterUsesDeepseekFactSeat: true,
        cashFallbackAllowed: false
      }
    }, request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { profiles: Record<string, TeamModelProfile>; reason?: string } }>('/api/v1/books/:bookId/model-bindings/activate', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    books.require(scope);
    const profiles = normalizeTeamProfiles(request.body.profiles);
    const version = modelBindings.reviseFuture(scope, profiles, request.body.reason?.trim() || '老板在设置页激活未来任务模型绑定');
    return success({ version, futureTasksOnly: true, active: agentGovernance.activeBindings(scope) }, request.id);
  });

  app.post<{ Params: { bookId: string; revisionId: string } }>('/api/v1/books/:bookId/model-bindings/:revisionId/restore', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    books.require(scope);
    const version = modelBindings.restoreFuture(
      scope,
      request.params.revisionId,
      `从历史修订 ${request.params.revisionId} 创建新的未来任务绑定`
    );
    return success({ version, futureTasksOnly: true, restoredFrom: request.params.revisionId, active: agentGovernance.activeBindings(scope) }, request.id);
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
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type <> 'volume_outline'
      ORDER BY a.artifact_type, a.title
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

  app.post<{ Params: { bookId: string; artifactId: string }; Body: { content: Record<string, unknown>; parentVersionId?: string | null } }>('/api/v1/books/:bookId/artifacts/:artifactId/versions', async (request) => {
    return success(artifacts.addVersion(
      { ...owner, bookId: request.params.bookId }, request.params.artifactId, request.body.content, request.body.parentVersionId ?? null
    ), request.id);
  });

  app.post<{ Params: { bookId: string; artifactId: string; versionId: string } }>('/api/v1/books/:bookId/artifacts/:artifactId/versions/:versionId/reject', async (request) => {
    return success(artifacts.reject({ ...owner, bookId: request.params.bookId }, request.params.artifactId, request.params.versionId), request.id);
  });

  app.get<{ Params: { bookId: string; artifactId: string }; Querystring: { left: string; right: string } }>('/api/v1/books/:bookId/artifacts/:artifactId/compare', async (request) => {
    return success(artifacts.compare({ ...owner, bookId: request.params.bookId }, request.query.left, request.query.right), request.id);
  });

  app.post<{ Params: { bookId: string; artifactId: string }; Body: { historicalVersionId: string } }>('/api/v1/books/:bookId/artifacts/:artifactId/revert', async (request) => {
    return success(artifacts.revert({ ...owner, bookId: request.params.bookId }, request.params.artifactId, request.body.historicalVersionId), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { type: DiscussionType; scopeText: string; createdByAgentId: string; participants: Array<{ agentId: string; reason: string }> } }>('/api/v1/books/:bookId/discussions', async (request) => {
    // R10: 讨论范围文本同样做编码健康诊断，避免问号串进入双编剧/主编昂贵会话
    const encodingHealth = diagnoseTextEncoding(request.body.scopeText);
    if (encodingHealth.damaged) {
      throw new DomainError(errorCodes.operationIncomplete,
        '讨论范围文本疑似编码损坏，包含 UTF-8 替换符或长问号串；请检查终端/脚本编码后重新发送',
        { damaged: encodingHealth.damaged, reason: encodingHealth.reason, replacementCharCount: encodingHealth.replacementCharCount, suspiciousQuestionMarkRun: encodingHealth.suspiciousQuestionMarkRun, totalLength: encodingHealth.totalLength }, false, 400);
    }
    return success(discussions.create({ ...owner, bookId: request.params.bookId }, request.body), request.id);
  });

  app.get<{ Params: { bookId: string; discussionId: string } }>('/api/v1/books/:bookId/discussions/:discussionId', async (request) => {
    return success(discussions.require({ ...owner, bookId: request.params.bookId }, request.params.discussionId), request.id);
  });

  app.post<{ Params: { bookId: string; discussionId: string }; Body: { decisionId: string } }>('/api/v1/books/:bookId/discussions/:discussionId/confirm', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    if (ideation.isIdeationDiscussion(scope, request.params.discussionId)) {
      throw new DomainError(errorCodes.validation,
        '灵感讨论不能整轮确认或直接写入正式内容；请只选择需要的一条建议，转为指定创作对象的作者意见。', {}, false, 409);
    }
    const discussion = discussions.confirm(scope, request.params.discussionId, request.body.decisionId);
    const planning = new PlanningArtifactService(database, ids, clock)
      .promoteIfPlanningTask(scope, request.params.discussionId, request.body.decisionId);
    return success({ discussion, planning }, request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/ideation/members', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    books.require(scope);
    return success(ideation.members(scope), request.id);
  });

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/ideation/rounds', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    books.require(scope);
    return success(ideation.rounds(scope), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: {
    message: string; participantAgentIds: string[]; idempotencyKey: string;
  } }>('/api/v1/books/:bookId/ideation/rounds', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    books.require(scope);
    return success(ideation.startRound(scope, request.body), request.id);
  });

  app.post<{ Params: { bookId: string; roundId: string }; Body: {
    opinionId: string;
    surface: import('@wenmi/contracts').AuthorInputSurface;
    subjectType: string;
    subjectId?: string | null;
    intentStrength?: import('@wenmi/contracts').AuthorIntentStrength;
    scopeNotes?: string | null;
    idempotencyKey: string;
  } }>('/api/v1/books/:bookId/ideation/rounds/:roundId/promote', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    books.require(scope);
    return success(ideation.promote(scope, request.params.roundId, request.body), request.id);
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
    if (request.body.count !== 1) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '正式正文必须逐章生成、逐章点评、逐章确认和逐章结算；旧批量入口不再调度多章',
        { replacement: `/api/v1/books/${request.params.bookId}/writing-runs`, requestedCount: request.body.count },
        false,
        409
      );
    }
    const options = {
      ...(request.body.volumeTitle === undefined ? {} : { volumeTitle: request.body.volumeTitle }),
      ...(request.body.firstChapterTitle === undefined ? {} : { firstChapterTitle: request.body.firstChapterTitle })
    };
    return success(chapterBatches.scheduleNewChapters({ ...owner, bookId: request.params.bookId }, request.body.count, options), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { volumeTitle?: string; chapterTitle?: string } }>('/api/v1/books/:bookId/writing-runs', async (request) => {
    const options = {
      ...(request.body?.volumeTitle === undefined ? {} : { volumeTitle: request.body.volumeTitle }),
      ...(request.body?.chapterTitle === undefined ? {} : { firstChapterTitle: request.body.chapterTitle })
    };
    return success(chapterBatches.scheduleNewChapters({ ...owner, bookId: request.params.bookId }, 1, options), request.id);
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
    const writingOrders = database.prepare(`SELECT * FROM writing_orders WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY version DESC`)
      .all(scope.ownerId, scope.bookId, request.params.chapterId);
    const reviewPanels = database.prepare(`SELECT * FROM review_panels WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY review_round`)
      .all(scope.ownerId, scope.bookId, request.params.chapterId);
    const reviewReports = database.prepare(`SELECT r.*, m.provider, m.model_id FROM review_reports r
      JOIN review_panels p ON p.review_panel_id = r.review_panel_id
      JOIN model_config_snapshots m ON m.model_snapshot_id = r.model_snapshot_id
      WHERE r.owner_id = ? AND r.book_id = ? AND p.chapter_id = ? ORDER BY p.review_round, r.reviewer_role`)
      .all(scope.ownerId, scope.bookId, request.params.chapterId);
    const approvalGates = database.prepare(`SELECT * FROM chapter_approval_gates WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY created_at DESC`)
      .all(scope.ownerId, scope.bookId, request.params.chapterId);
    return success({ chapter, manuscripts, facts, reviews, production: { writingOrders, reviewPanels, reviewReports, approvalGates } }, request.id);
  });

  app.get<{ Params: { bookId: string; writingOrderId: string } }>('/api/v1/books/:bookId/writing-orders/:writingOrderId', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    const order = database.prepare(`SELECT * FROM writing_orders WHERE writing_order_id = ? AND owner_id = ? AND book_id = ?`)
      .get(request.params.writingOrderId, scope.ownerId, scope.bookId);
    if (order === undefined) throw new Error('写作工单不存在或越权');
    const sources = database.prepare(`SELECT source_class, source_type, source_id, reason, content_hash, character_count, ordinal
      FROM writing_order_sources WHERE writing_order_id = ? AND owner_id = ? AND book_id = ? ORDER BY ordinal`)
      .all(request.params.writingOrderId, scope.ownerId, scope.bookId);
    return success({ order, sources }, request.id);
  });

  app.get<{ Params: { bookId: string; chapterId: string } }>('/api/v1/books/:bookId/chapters/:chapterId/manuscripts', async (request) => {
    return success(database.prepare(`SELECT * FROM manuscript_versions WHERE owner_id = ? AND book_id = ? AND chapter_id = ? ORDER BY created_at, manuscript_version_id`)
      .all(config.ownerId, request.params.bookId, request.params.chapterId), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { sourceName: string; text: string } }>(
    '/api/v1/books/:bookId/continuation-imports/preview', async (request) => {
      const scope = { ...owner, bookId: request.params.bookId };
      return success(continuationImports.preview(scope, request.body), request.id);
    }
  );

  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/continuation-imports/latest', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    return success(continuationImports.latest(scope), request.id);
  });

  app.get<{ Params: { bookId: string; importId: string } }>(
    '/api/v1/books/:bookId/continuation-imports/:importId', async (request) => {
      const scope = { ...owner, bookId: request.params.bookId };
      return success(continuationImports.get(scope, request.params.importId), request.id);
    }
  );

  app.post<{ Params: { bookId: string; importId: string }; Body: {
    chapters: Array<{ importChapterId: string; title: string; included: boolean }>;
  } }>('/api/v1/books/:bookId/continuation-imports/:importId/confirm', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    return success(continuationImports.confirm(scope, request.params.importId, request.body), request.id);
  });

  app.post<{ Params: { bookId: string; importId: string } }>(
    '/api/v1/books/:bookId/continuation-imports/:importId/analyze', async (request) => {
      const scope = { ...owner, bookId: request.params.bookId };
      return success(continuationImports.analyze(scope, request.params.importId), request.id);
    }
  );

  app.post<{ Params: { bookId: string; chapterId: string }; Body: { manuscriptVersionId: string } }>('/api/v1/books/:bookId/chapters/:chapterId/select-manuscript', async (request) => {
    throw new DomainError(errorCodes.operationIncomplete, '正文不能绕过审校直接选定；请使用定稿入口提交完整审校', {
      replacement: `/api/v1/books/${request.params.bookId}/chapters/${request.params.chapterId}/finalize`,
      manuscriptVersionId: request.body.manuscriptVersionId
    }, false, 409);
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

  app.post<{ Params: { bookId: string; chapterId: string }; Body: {
    baseManuscriptVersionId: string | null; content: string; note?: string | null;
  } }>('/api/v1/books/:bookId/chapters/:chapterId/manuscripts/owner-drafts', async (request) => {
    return success(ownerManuscripts.saveDraft({ ...owner, bookId: request.params.bookId }, {
      chapterId: request.params.chapterId, ...request.body
    }), request.id);
  });

  app.post<{ Params: { bookId: string; chapterId: string }; Body: {
    expectedManuscriptVersionId: string;
  } }>('/api/v1/books/:bookId/chapters/:chapterId/manuscripts/current/withdraw', async (request) => {
    return success(ownerManuscripts.withdrawDraft({ ...owner, bookId: request.params.bookId }, {
      chapterId: request.params.chapterId,
      expectedManuscriptVersionId: request.body.expectedManuscriptVersionId
    }), request.id);
  });

  app.post<{ Params: { bookId: string; chapterId: string }; Body: { manuscriptVersionId: string; instruction?: string | null } }>(
    '/api/v1/books/:bookId/chapters/:chapterId/rewrite', async (request) => {
      const scope = { ...owner, bookId: request.params.bookId };
      const gate = database.prepare(`SELECT confirmation_id, task_id, expected_canon_revision FROM chapter_approval_gates
        WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND manuscript_version_id = ? AND status = 'awaiting_owner'
        ORDER BY created_at DESC LIMIT 1`).get(scope.ownerId, scope.bookId, request.params.chapterId, request.body.manuscriptVersionId) as {
          confirmation_id: string; task_id: string; expected_canon_revision: number;
        } | undefined;
      if (gate !== undefined) {
        chapterApprovals.resolve(scope, gate.confirmation_id, gate.expected_canon_revision, false,
          request.body.instruction?.trim() || '老板要求完整重写当前正文');
        const task = tasks.queue(scope, gate.task_id);
        return success({ taskId: task.taskId, operation: 'rewrite_existing', manuscriptVersionId: request.body.manuscriptVersionId }, request.id);
      }
      return success(chapterBatches.scheduleExistingRevision(scope, request.params.chapterId, request.body.manuscriptVersionId,
        'rewrite_existing', request.body.instruction?.trim() || null), request.id);
    }
  );

  app.post<{ Params: { bookId: string; chapterId: string }; Body: { manuscriptVersionId: string } }>(
    '/api/v1/books/:bookId/chapters/:chapterId/finalize', async (request) => {
      const scope = { ...owner, bookId: request.params.bookId };
      const gate = database.prepare(`SELECT confirmation_id, task_id FROM chapter_approval_gates
        WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND manuscript_version_id = ? AND status = 'awaiting_owner'
        ORDER BY created_at DESC LIMIT 1`).get(scope.ownerId, scope.bookId, request.params.chapterId, request.body.manuscriptVersionId) as {
          confirmation_id: string; task_id: string;
        } | undefined;
      if (gate !== undefined) return success({ taskId: gate.task_id, confirmationId: gate.confirmation_id, operation: 'awaiting_owner' }, request.id);
      return success(chapterBatches.scheduleExistingRevision(scope, request.params.chapterId, request.body.manuscriptVersionId,
        'review_existing'), request.id);
    }
  );

  app.post<{ Params: { bookId: string }; Body: { entityType: string; canonicalName: string; aliases?: string[] } }>('/api/v1/books/:bookId/entities', async (request) => {
    return success({ entityId: canon.createEntity({ ...owner, bookId: request.params.bookId }, request.body) }, request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { namespace: string; name: string; description?: string; appliesTo: string[]; color?: string | null } }>('/api/v1/books/:bookId/tags', async (request) => {
    return success(taxonomy.createTag({ ...owner, bookId: request.params.bookId }, {
      ...request.body, createdSource: 'boss', changesStoryFact: false
    }), request.id);
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
    const scope = { ...owner, bookId: request.params.bookId };
    const target = database.prepare(`SELECT target_type FROM confirmations WHERE confirmation_id = ? AND owner_id = ? AND book_id = ?`)
      .get(request.params.confirmationId, scope.ownerId, scope.bookId) as { target_type: string } | undefined;
    if (target?.target_type === 'manuscript') {
      return success({ confirmationId: request.params.confirmationId, ...chapterApprovals.resolve(scope, request.params.confirmationId, request.body.expectedCanonRevision, true) }, request.id);
    }
    canon.resolveConfirmation(scope, request.params.confirmationId, request.body.expectedCanonRevision, true);
    return success({ confirmationId: request.params.confirmationId, status: 'accepted' }, request.id);
  });

  app.post<{ Params: { bookId: string; confirmationId: string }; Body: { expectedCanonRevision: number; note?: string } }>('/api/v1/books/:bookId/confirmations/:confirmationId/reject', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    const target = database.prepare(`SELECT target_type FROM confirmations WHERE confirmation_id = ? AND owner_id = ? AND book_id = ?`)
      .get(request.params.confirmationId, scope.ownerId, scope.bookId) as { target_type: string } | undefined;
    if (target?.target_type === 'manuscript') {
      return success({ confirmationId: request.params.confirmationId, ...chapterApprovals.resolve(scope, request.params.confirmationId, request.body.expectedCanonRevision, false, request.body.note ?? null) }, request.id);
    }
    canon.resolveConfirmation(scope, request.params.confirmationId, request.body.expectedCanonRevision, false);
    return success({ confirmationId: request.params.confirmationId, status: 'rejected' }, request.id);
  });

  app.post<{ Params: { bookId: string; chapterId: string }; Body: { manuscriptVersionId: string; chapterEndState: Record<string, unknown> } }>('/api/v1/books/:bookId/chapters/:chapterId/settle', async (request) => {
    throw new DomainError(errorCodes.operationIncomplete, '正文不能绕过三席点评和老板确认直接结算', {
      replacement: `/api/v1/books/${request.params.bookId}/chapters/${request.params.chapterId}/finalize`,
      manuscriptVersionId: request.body.manuscriptVersionId
    }, false, 409);
  });

  app.get<{ Params: { bookId: string }; Querystring: { layer?: MemoryLayer; agentId?: string; chapter?: number; canonRevision?: number } }>('/api/v1/books/:bookId/memories', async (request) => {
    return success(memory.listActive({ ...owner, bookId: request.params.bookId }, request.query), request.id);
  });

  app.get<{ Params: { bookId: string }; Querystring: { layer?: MemoryLayer; agentId?: string; chapter?: number; canonRevision?: number } }>('/api/v1/books/:bookId/memory', async (request) => {
    return success(memory.listActive({ ...owner, bookId: request.params.bookId }, request.query), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { query: string; roleKey?: string; mode?: RetrievalMode; taskId?: string; limit?: number;
    sourceTypes?: string[]; adoptedSourceIds?: string[]; canonRevision: number; worldTime?: string | null; knowledgeTime?: string | null;
    viewpointEntityId?: string | null } }>('/api/v1/books/:bookId/retrievals', async (request) => {
    const { query, roleKey = 'chief_editor', mode = 'open_discussion', ...options } = request.body;
    return success(await retrieval.search({ ...owner, bookId: request.params.bookId }, { query, roleKey, mode, ...options }), request.id);
  });

  app.post<{ Params: { bookId: string }; Body: { query: string; roleKey?: string; mode?: RetrievalMode; taskId?: string; limit?: number;
    sourceTypes?: string[]; adoptedSourceIds?: string[]; canonRevision: number; worldTime?: string | null; knowledgeTime?: string | null;
    viewpointEntityId?: string | null } }>('/api/v1/books/:bookId/retrieval/preview', async (request) => {
    const { query, roleKey = 'chief_editor', mode = 'open_discussion', ...options } = request.body;
    return success(await retrieval.search({ ...owner, bookId: request.params.bookId }, { query, roleKey, mode, ...options }), request.id);
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


  app.post<{ Params: { bookId: string } }>('/api/v1/books/:bookId/author-attachments', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    try {
      const part = await request.file();
      if (part === undefined) throw new DomainError(errorCodes.validation, '请选择一个附件');
      const record = await authorAttachments.upload(scope, {
        filename: part.filename,
        mimeType: part.mimetype,
        buffer: await part.toBuffer()
      });
      return success(authorAttachmentView(record), request.id);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode: unknown }).statusCode)
        : 400;
      const message = statusCode === 413
        ? '单个附件不能超过20 MiB'
        : error instanceof Error ? error.message : '附件上传失败';
      throw new DomainError(errorCodes.validation, message, {}, false, statusCode === 413 ? 413 : 400);
    }
  });

  app.get<{ Params: { bookId: string; attachmentId: string } }>('/api/v1/books/:bookId/author-attachments/:attachmentId/content', async (request, reply) => {
    const { record, buffer } = authorAttachments.readSource(
      { ...owner, bookId: request.params.bookId }, request.params.attachmentId
    );
    reply.header('content-type', record.mimeType);
    reply.header('content-disposition', 'inline');
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(buffer);
  });

  app.post<{ Params: { bookId: string; attachmentId: string } }>('/api/v1/books/:bookId/author-attachments/:attachmentId/discard', async (request) => {
    return success(authorAttachmentView(authorAttachments.discard(
      { ...owner, bookId: request.params.bookId }, request.params.attachmentId
    )), request.id);
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

  app.post<{ Params: { bookId: string; taskId: string } }>('/api/v1/books/:bookId/tasks/:taskId/retry', async (request) => {
    return success(tasks.retryFailed({ ...owner, bookId: request.params.bookId }, request.params.taskId), request.id);
  });

  app.post<{ Params: { bookId: string; taskId: string } }>('/api/v1/books/:bookId/tasks/:taskId/cancel', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    const cancelledTask = tasks.requestCancel(scope, request.params.taskId);
    volumePlanGenerations.reconcileTerminal(scope, cancelledTask);
    const modelCalls = database.prepare(`SELECT request_id FROM model_calls WHERE owner_id = ? AND book_id = ? AND task_id = ? AND state = 'working'`)
      .all(scope.ownerId, scope.bookId, request.params.taskId) as unknown as Array<{ request_id: string }>;
    const toolCalls = database.prepare(`SELECT tool_call_id FROM tool_calls WHERE owner_id = ? AND book_id = ? AND task_id = ? AND state = 'working'`)
      .all(scope.ownerId, scope.bookId, request.params.taskId) as unknown as Array<{ tool_call_id: string }>;
    const cancelledModelCalls = modelCalls.filter((call) => cancelActiveModelCall(call.request_id)).length;
    const cancelledToolCalls = toolCalls.filter((call) => cancelActiveToolCall(call.tool_call_id)).length;
    return success({ ...tasks.require(scope, request.params.taskId), cancelledModelCalls, cancelledToolCalls }, request.id);
  });

  app.post<{ Params: { bookId: string } }>('/api/v1/books/:bookId/projections/rebuild', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    canon.rebuildProjections(scope);
    const narrative = projections.rebuild(scope);
    const relationship = (database.prepare(`SELECT COUNT(*) AS count FROM relationship_projection
      WHERE owner_id = ? AND book_id = ? AND canon_revision = (
        SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?
      )`).get(scope.ownerId, scope.bookId, scope.ownerId, scope.bookId) as { count: number }).count;
    return success({ rebuilt: narrative + relationship, narrative, relationship }, request.id);
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

  app.patch<{
    Params: { bookId: string; budgetId: string };
    Body: { expectedTokenLimit: number; tokenLimit: number };
  }>('/api/v1/books/:bookId/budgets/:budgetId', async (request) => {
    books.require({ ...owner, bookId: request.params.bookId });
    return success(budgets.reviseTokenLimit(
      { ...owner, bookId: request.params.bookId }, request.params.budgetId,
      request.body.expectedTokenLimit, request.body.tokenLimit
    ), request.id);
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

  // P0-5: 暴露无主预留巡检与中断调用手动调和入口。无活动调用且无调和记录的预留必须为0；
  // 中断调用可由人工/供应商确认后推进到 reusable/retry_safe/release，避免永久冻结。
  app.get<{ Params: { bookId: string } }>('/api/v1/books/:bookId/budgets/reconciliation', async (request) => {
    books.require({ ...owner, bookId: request.params.bookId });
    return success(modelCalls.reportUnreconciledReservations(
      { ownerId: config.ownerId, bookId: request.params.bookId }
    ), request.id);
  });

  app.post<{ Params: { bookId: string; requestId: string } }>('/api/v1/books/:bookId/model-calls/:requestId/reconcile', async (request) => {
    books.require({ ...owner, bookId: request.params.bookId });
    return success(modelCalls.reconcileInterruptedCall(
      { ownerId: config.ownerId, bookId: request.params.bookId }, request.params.requestId
    ), request.id);
  });

  // P0-4: 主编模型恢复后，在无活动/未知调用安全边界手动回切主编；不满足边界时返回原因不切。
  app.post<{ Params: { bookId: string }; Body: { chiefAgentId: string } }>('/api/v1/books/:bookId/editor/revert', async (request) => {
    const scope = { ...owner, bookId: request.params.bookId };
    books.require(scope);
    return success(editors.safeRevertToChief(scope, request.body.chiefAgentId), request.id);
  });

  app.post('/api/v1/backups', async (request) => success(backups.create(), request.id));

  app.post<{ Params: { bookId: string } }>('/api/v1/books/:bookId/export', async (request) => {
    return success(portability.exportBook({ ...owner, bookId: request.params.bookId }), request.id);
  });

  app.post<{ Body: { packageName: string } }>('/api/v1/imports/copy', async (request) => {
    return success(portability.importCopy(owner, request.body.packageName), request.id);
  });

  app.get('/api/v1/portability/operations', async (request) => success(portability.listOperations(owner.ownerId), request.id));

  app.get('/api/v1/operations/status', async (request) => {
    const volume = statfsSync(config.dataDir);
    const count = (table: string, where = ''): number => (database.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get() as { count: number }).count;
    const activeSnapshot = database.prepare(`SELECT status, canon_revision AS canonRevision, source_count AS sourceCount,
      chunk_count AS chunkCount, ready_at AS readyAt, failure_code AS failureCode
      FROM chunk_snapshots WHERE status = 'ready' ORDER BY ready_at DESC LIMIT 1`).get();
    const latestBackup = database.prepare(`SELECT backup_id AS backupId, status, verified_at AS verifiedAt, created_at AS createdAt
      FROM backups ORDER BY created_at DESC LIMIT 1`).get();
    return success({
      releaseId: config.releaseId,
      schemaVersion: Number((database.prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`).get() as { value: string }).value),
      disk: { totalBytes: Number(volume.blocks) * Number(volume.bsize), freeBytes: Number(volume.bavail) * Number(volume.bsize) },
      queue: {
        queued: count('tasks', `WHERE status = 'queued'`),
        working: count('tasks', `WHERE status = 'working'`),
        blocked: count('tasks', `WHERE status IN ('blocked', 'failed', 'interrupted')`)
      },
      projection: activeSnapshot ?? { status: 'missing' },
      latestBackup: latestBackup ?? null,
      portability: { completed: count('portable_operations', `WHERE status = 'completed'`), failed: count('portable_operations', `WHERE status = 'failed'`) },
      diagnostics: { telemetrySent: false, secretsIncluded: false, listeningHost: config.apiHost }
    }, request.id);
  });

  app.get('/api/v1/backups', async (request) => success(database.prepare(`
    SELECT backup_id, release_id, status, backup_path, database_hash, manifest_hash,
           file_count, created_at, verified_at, verification_json
    FROM backups ORDER BY created_at DESC, backup_id DESC
  `).all(), request.id));

  app.post<{ Params: { backupId: string } }>('/api/v1/backups/:backupId/verify', async (request) => {
    return success(backups.verify(request.params.backupId), request.id);
  });
}

function parseStoredJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function modelSignature(profile: TeamModelProfile): string {
  return `${profile.provider}/${profile.modelId}`;
}

function normalizeTeamProfiles(input: Record<string, TeamModelProfile>): Record<CreativeRoleKey, TeamModelProfile> {
  const result = {} as Record<CreativeRoleKey, TeamModelProfile>;
  for (const role of creativeRoleKeys) {
    const profile = input[role];
    if (profile === undefined || typeof profile.provider !== 'string' || typeof profile.modelId !== 'string'
      || !['deterministic', 'codex', 'coding', 'agent'].includes(profile.plan)) {
      throw new Error(`岗位${role}缺少有效模型绑定`);
    }
    result[role] = { provider: profile.provider.trim(), modelId: profile.modelId.trim(), plan: profile.plan };
    if (result[role].provider.length === 0 || result[role].modelId.length === 0) throw new Error(`岗位${role}缺少有效模型绑定`);
  }
  return result;
}
