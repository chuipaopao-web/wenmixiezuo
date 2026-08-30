import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { success } from '../contracts/api.js';
import { DomainError } from '../domain/errors.js';
import { SystemClock, UuidGenerator } from '../domain/ids.js';
import { EventStore } from '../application/events/event-store.js';
import { registerDomainRoutes } from './domain-routes.js';
import { AiNodePipelineService } from '../application/agents/ai-node-pipeline-service.js';
import type { RuntimeConfig } from '../infrastructure/runtime-config.js';
import { ChapterPipelineService } from '../application/creation/chapter-pipeline-service.js';
import { DiscussionPipelineService } from '../application/discussions/discussion-pipeline-service.js';
import { ModelAdapterFactory } from '../infrastructure/models/model-adapter-factory.js';
import { ContinuationAnalysisPipelineService } from '../application/continuation/continuation-analysis-pipeline-service.js';
import { SettlementFollowUpPipelineService } from '../application/planning/settlement-follow-up-pipeline-service.js';
import { CoreWorkflowService } from '../application/planning/core-workflow-service.js';
import { SettlementFollowUpRepository } from '../infrastructure/db/repositories/settlement-follow-up-repository.js';
import { AccountAuthService } from '../infrastructure/security/account-auth-service.js';
import { requireAuthenticatedOwner } from '../infrastructure/security/auth-context.js';
import { registerRequestPolicy, type RequestPolicyOptions } from '../infrastructure/security/request-policy.js';
import { registerRuntimeRoutes } from './runtime-routes.js';
import { registerAccountRoutes } from './account-routes.js';
import { registerV7OpeningAgentRoutes } from './v7-opening-agent-routes.js';
import { registerV7SettingEditorialRoutes } from './v7-setting-editorial-routes.js';
import { registerV7PlanningTreeRoutes } from './v7-planning-tree-routes.js';
import { registerV7CharacterMemoryRoutes } from './v7-character-memory-routes.js';
import { registerV7CreationRoutes } from './v7-creation-routes.js';
import { registerV7PromptGovernanceRoutes } from './v7-prompt-governance-routes.js';
import { projectAuthorApiValue, projectSerializedAuthorResponse, requestsCleanAuthorProjection, shouldProjectAuthorResponse } from './author-api-projection.js';
import { MembershipService } from '../infrastructure/security/membership-service.js';
import { RuntimeCapabilityProbe } from '../infrastructure/capabilities/runtime-capability-probe.js';
import { ModelAssetRegistry } from '../infrastructure/capabilities/model-asset-registry.js';
import { CapabilityService } from '../application/capabilities/capability-service.js';
import { CanonIndexService } from '../application/projections/canon-index-service.js';
import { HybridRetrievalService } from '../application/memory/hybrid-retrieval-service.js';
import { RetrievalOrchestrationRepository } from '../infrastructure/db/repositories/retrieval-orchestration-repository.js';
import { KnowledgeRepository } from '../infrastructure/db/repositories/knowledge-repository.js';
import { ChunkSnapshotRepository } from '../infrastructure/db/repositories/chunk-snapshot-repository.js';
import { loadLocalRetrievalRuntime } from '../infrastructure/retrieval/local-retrieval-runtime.js';
import { VolumePlanGenerationPipelineService } from '../application/planning/volume-plan-generation-pipeline-service.js';
import { EventChainGenerationPipelineService } from '../application/planning/event-chain-generation-pipeline-service.js';
import { VolumePlanGenerationRepository } from '../infrastructure/db/repositories/volume-plan-generation-repository.js';
import { VolumePlanRepository } from '../infrastructure/db/repositories/volume-plan-repository.js';
import { VolumePlanService } from '../application/planning/volume-plan-service.js';
import { LayeredPlanningRepository } from '../infrastructure/db/repositories/layered-planning-repository.js';
import { LayeredPlanningService } from '../application/planning/layered-planning-service.js';
import { UnitOfWork } from '../infrastructure/db/unit-of-work.js';
import { TaskService } from '../application/tasks/task-service.js';
import { BudgetService } from '../application/budget/budget-service.js';
import { ModelCallService } from '../application/calls/model-call-service.js';
import { ContextPackService } from '../application/memory/context-pack-service.js';
import { RetrievalContextSourceService } from '../application/memory/retrieval-context-source-service.js';
import { StoryEventGenerationPipelineService } from '../application/planning/story-event-generation-pipeline-service.js';
import { StoryEventGenerationRepository } from '../infrastructure/db/repositories/story-event-generation-repository.js';
import { StoryEventRepository } from '../infrastructure/db/repositories/story-event-repository.js';
import { StoryEventService } from '../application/planning/story-event-service.js';
import { EventChapterGenerationPipelineService } from '../application/planning/event-chapter-generation-pipeline-service.js';
import { EventChapterGenerationRepository } from '../infrastructure/db/repositories/event-chapter-generation-repository.js';
import { EventChapterOutlineRepository } from '../infrastructure/db/repositories/event-chapter-outline-repository.js';
import { LongformContinuityRepository } from '../infrastructure/db/repositories/longform-continuity-repository.js';
import { EventChapterOutlineService } from '../application/planning/event-chapter-outline-service.js';
import { EventChapterGenerationService } from '../application/planning/event-chapter-generation-service.js';
import { ArtifactService } from '../application/artifacts/artifact-service.js';
import { BookBrandingDesignPipelineService } from '../application/books/book-branding-pipeline-service.js';
import { BookBrandingDesignRepository } from '../infrastructure/db/repositories/book-branding-design-repository.js';
import { ChapterChallengerReviewPipelineService } from '../application/creation/chapter-challenger-review-pipeline-service.js';
import { ChapterChallengerReviewRepository } from '../infrastructure/db/repositories/chapter-challenger-review-repository.js';
import { SettingGapService } from '../application/knowledge/setting-gap-service.js';
import { SettingGapRepository } from '../infrastructure/db/repositories/setting-gap-repository.js';
import {
  assertLayeredCreationWritesAllowed,
  resolveLayeredCreationWriteMode,
  type LayeredCreationWriteMode
} from './layered-creation-safety.js';
import type { V7OpeningModelAdapterResolver } from '../infrastructure/models/v7-opening-agent-model-gateway.js';
import { VolcengineArkImageGateway, type V7CoverImageGateway } from '../infrastructure/models/volcengine-ark-image-gateway.js';

interface WorkerHealthRow {
  worker_id: string;
  release_id: string;
  process_id: number;
  started_at: string;
  heartbeat_at: string;
  capabilities_json: string;
  current_task_id: string | null;
}

export interface ServerOptions extends RequestPolicyOptions {
  layeredCreationWrites?: LayeredCreationWriteMode;
  v7OpeningModelAdapters?: V7OpeningModelAdapterResolver;
  v7CoverImageGateway?: V7CoverImageGateway;
}

export async function createServer(config: RuntimeConfig, database: DatabaseSync, options: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.WENMI_LOG_LEVEL ?? 'info' },
    logController: new LogController({ disableRequestLogging: true }),
    // A five-million-character Chinese manuscript is roughly 15 MiB before JSON overhead.
    // The continuation service still enforces the stricter character limit and localhost session gate.
    bodyLimit: 24 * 1024 * 1024,
    // API 只监听 127.0.0.1，唯一能到达它的代理是本机 Caddy（自动带 X-Forwarded-For）。
    // 信任代理头让限流按真实访客 IP 分桶；否则全网访客共享 127.0.0.1 一个桶，
    // 正常翻页就会集体触发 RATE_LIMITED。
    trustProxy: true
  });
  const liveSseIntervals = new Set<ReturnType<typeof setInterval>>();
  app.addHook('onClose', async () => {
    for (const interval of liveSseIntervals) clearInterval(interval);
    liveSseIntervals.clear();
  });
  const corsOrigins = config.adminOrigin === null ? config.webOrigin : [config.webOrigin, config.adminOrigin];
  await app.register(cors, { origin: corsOrigins, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] });
  await app.register(multipart, {
    limits: { files: 1, fileSize: 20 * 1024 * 1024, fields: 0, parts: 1 }
  });
  const accounts = new AccountAuthService(database, config.webOrigin.startsWith('https://'), config.ownerId);
  await registerRequestPolicy(app, config, accounts, options);
  const layeredCreationWriteMode = resolveLayeredCreationWriteMode(options.layeredCreationWrites);
  app.addHook('onRequest', async (request) => {
    assertLayeredCreationWritesAllowed(layeredCreationWriteMode, request.method, request.url);
  });
  app.addHook('onSend', async (request, reply, payload) => {
    return shouldProjectAuthorResponse(request.url, reply.statusCode, request.headers)
      ? projectSerializedAuthorResponse(payload)
      : payload;
  });
  const events = new EventStore(database, new UuidGenerator(), new SystemClock());
  const modelAdapters = new ModelAdapterFactory(config.modelRuntime);
  const retrievalIds = new UuidGenerator();
  const retrievalClock = new SystemClock();
  const productionRetrieval = new HybridRetrievalService(
    new RetrievalOrchestrationRepository(database), new KnowledgeRepository(database),
    new ChunkSnapshotRepository(database), retrievalIds, retrievalClock,
    loadLocalRetrievalRuntime(config.dataDir)
  );
  const volumePlanIds = new UuidGenerator();
  const volumePlanClock = new SystemClock();
  const volumePlanBudgets = new BudgetService(database, volumePlanIds, volumePlanClock);
  const runtimeLayeredPlanning = new LayeredPlanningService(
    new LayeredPlanningRepository(database), new UnitOfWork(database), volumePlanIds, volumePlanClock
  );
  const runtimeVolumePlans = new VolumePlanService(
    new VolumePlanRepository(database), new UnitOfWork(database),
    volumePlanIds, volumePlanClock, runtimeLayeredPlanning
  );
  const runtimeTeamRepository = new VolumePlanGenerationRepository(database);
  const runtimeTaskService = new TaskService(database, config.releaseId, volumePlanClock);
  const runtimeSettingGaps = new SettingGapService(
    new SettingGapRepository(database), new UnitOfWork(database), volumePlanIds, volumePlanClock
  );
  const volumePlanGenerationPipeline = new VolumePlanGenerationPipelineService(
    runtimeTeamRepository, runtimeVolumePlans, runtimeTaskService, volumePlanBudgets,
    new ModelCallService(database, volumePlanClock, volumePlanBudgets),
    new ContextPackService(database, volumePlanIds, volumePlanClock),
    volumePlanIds, volumePlanClock, modelAdapters,
    new RetrievalContextSourceService(productionRetrieval),
    runtimeSettingGaps
  );
  const aiNodePipeline = new AiNodePipelineService(
    database, config.releaseId, runtimeTaskService, volumePlanBudgets,
    new ModelCallService(database, volumePlanClock, volumePlanBudgets),
    volumePlanIds, volumePlanClock, modelAdapters
  );
  const eventChainGenerationPipeline = new EventChainGenerationPipelineService(
    runtimeTeamRepository, runtimeLayeredPlanning, runtimeTaskService, volumePlanBudgets,
    new ModelCallService(database, volumePlanClock, volumePlanBudgets),
    new ContextPackService(database, volumePlanIds, volumePlanClock),
    volumePlanIds, volumePlanClock, modelAdapters
  );
  const bookBrandingDesignPipeline = new BookBrandingDesignPipelineService(
    new BookBrandingDesignRepository(database),
    new VolumePlanGenerationRepository(database),
    new TaskService(database, config.releaseId, volumePlanClock),
    volumePlanBudgets,
    new ModelCallService(database, volumePlanClock, volumePlanBudgets),
    new ContextPackService(database, volumePlanIds, volumePlanClock),
    volumePlanIds,
    volumePlanClock,
    modelAdapters
  );
  const chapterChallengerReviewPipeline = new ChapterChallengerReviewPipelineService(
    config.dataDir,
    new ChapterChallengerReviewRepository(database),
    new TaskService(database, config.releaseId, volumePlanClock),
    volumePlanBudgets,
    new ModelCallService(database, volumePlanClock, volumePlanBudgets),
    new ContextPackService(database, volumePlanIds, volumePlanClock),
    volumePlanIds,
    volumePlanClock,
    modelAdapters
  );
  const storyEventRepository = new StoryEventRepository(database);
  const storyEventGenerationPipeline = new StoryEventGenerationPipelineService(
    new StoryEventGenerationRepository(database),
    storyEventRepository,
    new StoryEventService(storyEventRepository, new UnitOfWork(database), volumePlanIds, volumePlanClock, runtimeLayeredPlanning),
    new TaskService(database, config.releaseId, volumePlanClock),
    volumePlanBudgets,
    new ModelCallService(database, volumePlanClock, volumePlanBudgets),
    new ContextPackService(database, volumePlanIds, volumePlanClock),
    volumePlanIds,
    volumePlanClock,
    modelAdapters,
    new RetrievalContextSourceService(productionRetrieval),
    runtimeSettingGaps
  );
  const settlementFollowUpPipeline = new SettlementFollowUpPipelineService(
    new SettlementFollowUpRepository(database),
    new TaskService(database, config.releaseId, volumePlanClock),
    volumePlanBudgets,
    new ModelCallService(database, volumePlanClock, volumePlanBudgets),
    new ContextPackService(database, volumePlanIds, volumePlanClock),
    volumePlanIds,
    volumePlanClock,
    modelAdapters,
    new CoreWorkflowService(database, volumePlanIds, volumePlanClock)
  );
  const eventChapterOutlineRepository = new EventChapterOutlineRepository(database);
  const eventChapterTaskService = new TaskService(database, config.releaseId, volumePlanClock);
  const eventChapterOutlineService = new EventChapterOutlineService(
    eventChapterOutlineRepository, new UnitOfWork(database),
    new ArtifactService(database, volumePlanIds, volumePlanClock), volumePlanIds, volumePlanClock
  );
  const eventChapterGenerationRepository = new EventChapterGenerationRepository(database);
  const eventChapterGenerationService = new EventChapterGenerationService(
    eventChapterGenerationRepository, eventChapterOutlineService,
    new VolumePlanGenerationRepository(database), eventChapterTaskService,
    new UnitOfWork(database), volumePlanIds, volumePlanClock
  );
  const eventChapterGenerationPipeline = new EventChapterGenerationPipelineService(
    eventChapterGenerationRepository, eventChapterOutlineRepository, new LongformContinuityRepository(database),
    eventChapterOutlineService,
    eventChapterGenerationService, eventChapterTaskService, volumePlanBudgets,
    new ModelCallService(database, volumePlanClock, volumePlanBudgets),
    new ContextPackService(database, volumePlanIds, volumePlanClock),
    volumePlanIds, volumePlanClock, modelAdapters, runtimeSettingGaps
  );  const capabilities = new CapabilityService(
    new RuntimeCapabilityProbe(database, config.dataDir),
    new ModelAssetRegistry(config.dataDir),
    config.modelRuntime,
    config.releaseId
  );
  await registerAccountRoutes(app, accounts, new MembershipService(database, new SystemClock()));
  await registerRuntimeRoutes(app, capabilities);
  await registerDomainRoutes(app, database, config);
  await registerV7OpeningAgentRoutes(app, database, options.v7OpeningModelAdapters ?? modelAdapters, {
    codingPlan: config.modelRuntime.endpoints.coding.apiKey !== undefined,
    agentPlan: config.modelRuntime.endpoints.agent.apiKey !== undefined
  }, {
    dataDir: config.dataDir,
    imageGateway: options.v7CoverImageGateway ?? new VolcengineArkImageGateway()
  });
  await registerV7SettingEditorialRoutes(app, database, options.v7OpeningModelAdapters ?? modelAdapters, {
    codingPlan: config.modelRuntime.endpoints.coding.apiKey !== undefined,
    agentPlan: config.modelRuntime.endpoints.agent.apiKey !== undefined
  });
  await registerV7PlanningTreeRoutes(app, database, options.v7OpeningModelAdapters ?? modelAdapters);
  await registerV7CharacterMemoryRoutes(app, database, options.v7OpeningModelAdapters ?? modelAdapters);
  await registerV7CreationRoutes(app, database, options.v7OpeningModelAdapters ?? modelAdapters);
  await registerV7PromptGovernanceRoutes(app, database);

  app.get('/health', async (request) => {
    const databaseProbe = database.prepare('SELECT 1 AS ok').get() as { ok: number };
    const heartbeat = database.prepare('SELECT heartbeat_at FROM worker_health ORDER BY heartbeat_at DESC LIMIT 1')
      .get() as { heartbeat_at: string } | undefined;
    const workerReady = heartbeat !== undefined && Date.now() - Date.parse(heartbeat.heartbeat_at) <= 15_000;
    return success({
      service: 'wenmi-api',
      status: databaseProbe.ok === 1 ? 'ok' : 'degraded',
      worker: workerReady ? 'ready' : 'possibly_offline',
      canStartModelTasks: workerReady,
      releaseId: config.releaseId,
      time: new Date().toISOString()
    }, request.id);
  });

  app.get('/api/v1/runtime/worker', async (request) => {
    const row = database.prepare('SELECT * FROM worker_health ORDER BY heartbeat_at DESC LIMIT 1').get() as WorkerHealthRow | undefined;
    if (row === undefined) {
      return success({ status: 'possibly_offline', worker: null }, request.id);
    }
    const ageMs = Date.now() - Date.parse(row.heartbeat_at);
    return success({
      status: ageMs <= 15_000 ? 'ready' : 'possibly_offline',
      worker: {
        workerId: row.worker_id,
        releaseId: row.release_id,
        processId: row.process_id,
        startedAt: row.started_at,
        heartbeatAt: row.heartbeat_at,
        capabilities: JSON.parse(row.capabilities_json) as string[],
        currentTaskId: row.current_task_id
      }
    }, request.id);
  });

  app.get('/api/v1/runtime/readiness', async (request) => {
    const row = database.prepare('SELECT heartbeat_at FROM worker_health ORDER BY heartbeat_at DESC LIMIT 1').get() as { heartbeat_at: string } | undefined;
    const workerReady = row !== undefined && Date.now() - Date.parse(row.heartbeat_at) <= 15_000;
    return success({ api: 'ready', worker: workerReady ? 'ready' : 'possibly_offline', canStartModelTasks: workerReady }, request.id);
  });

  app.post<{
    Params: { taskId: string };
    Headers: { 'x-wenmi-worker-id'?: string; 'x-wenmi-worker-token'?: string };
    Body: { ownerId: string; bookId: string; leaseToken: string; attemptNo: number };
  }>('/api/v1/internal/worker/tasks/:taskId/execute', async (request) => {
    const workerId = request.headers['x-wenmi-worker-id'];
    if (workerId === undefined || workerId.length === 0) throw new DomainError('VALIDATION_ERROR', '缺少Worker身份');
    const recorded = database.prepare(`SELECT 1 FROM worker_health WHERE worker_id = ?`).get(workerId);
    if (recorded === undefined) throw new DomainError('VALIDATION_ERROR', 'Worker身份未登记');
    if (typeof request.body.leaseToken !== 'string' || request.body.leaseToken.length < 16
      || !Number.isInteger(request.body.attemptNo) || request.body.attemptNo < 1) {
      throw new DomainError('VALIDATION_ERROR', 'Worker任务租约栅栏缺失');
    }
    const task = database.prepare(`SELECT task_type FROM tasks WHERE task_id = ? AND owner_id = ? AND book_id = ?`)
      .get(request.params.taskId, request.body.ownerId, request.body.bookId) as { task_type: string } | undefined;
    if (task === undefined) throw new DomainError('VALIDATION_ERROR', 'Worker任务不存在或范围不匹配');
    const scope = { ownerId: request.body.ownerId, bookId: request.body.bookId };
    const result = task.task_type === 'chapter_creation'
      ? await new ChapterPipelineService(database, config.dataDir, config.releaseId, new UuidGenerator(), new SystemClock(), modelAdapters, productionRetrieval).executeClaimed(scope, request.params.taskId, workerId, undefined, { leaseToken: request.body.leaseToken, attemptNo: request.body.attemptNo })
      : task.task_type === 'discussion'
        ? await new DiscussionPipelineService(database, config.releaseId, new UuidGenerator(), new SystemClock(), modelAdapters, productionRetrieval).executeClaimed(scope, request.params.taskId, workerId, { leaseToken: request.body.leaseToken, attemptNo: request.body.attemptNo })
        : task.task_type === 'continuation_analysis'
          ? await new ContinuationAnalysisPipelineService(database, config.dataDir, config.releaseId, new UuidGenerator(), new SystemClock(), modelAdapters).executeClaimed(scope, request.params.taskId, workerId, { leaseToken: request.body.leaseToken, attemptNo: request.body.attemptNo })
          : task.task_type === 'volume_plan_generation'
            ? await volumePlanGenerationPipeline.executeClaimed(scope, request.params.taskId, workerId, { leaseToken: request.body.leaseToken, attemptNo: request.body.attemptNo })
            : task.task_type === 'event_chain_generation'
              ? await eventChainGenerationPipeline.executeClaimed(scope, request.params.taskId, workerId, { leaseToken: request.body.leaseToken, attemptNo: request.body.attemptNo })
            : task.task_type === 'book_branding_design'
              ? await bookBrandingDesignPipeline.executeClaimed(scope, request.params.taskId, workerId, { leaseToken: request.body.leaseToken, attemptNo: request.body.attemptNo })
            : task.task_type === 'chapter_challenger_review'
              ? await chapterChallengerReviewPipeline.executeClaimed(scope, request.params.taskId, workerId, { leaseToken: request.body.leaseToken, attemptNo: request.body.attemptNo })
            : task.task_type === 'story_event_generation'
              ? await storyEventGenerationPipeline.executeClaimed(scope, request.params.taskId, workerId, { leaseToken: request.body.leaseToken, attemptNo: request.body.attemptNo })
              : task.task_type === 'settlement_follow_up'
                ? await settlementFollowUpPipeline.executeClaimed(scope, request.params.taskId, workerId, { leaseToken: request.body.leaseToken, attemptNo: request.body.attemptNo })
              : ['event_chapter_sequence_generation', 'event_chapter_detail_generation', 'event_chapter_sequence_challenge', 'event_chapter_detail_challenge'].includes(task.task_type)
                ? await eventChapterGenerationPipeline.executeClaimed(scope, request.params.taskId, workerId, { leaseToken: request.body.leaseToken, attemptNo: request.body.attemptNo })
              : task.task_type.startsWith('ai_node:')
                ? await aiNodePipeline.executeClaimed(scope, request.params.taskId, workerId, { leaseToken: request.body.leaseToken, attemptNo: request.body.attemptNo })
              : (() => { throw new DomainError('VALIDATION_ERROR', `未注册的Worker任务类型：${task.task_type}`); })();
    return success(result, request.id);
  });

  app.post<{
    Params: { requestId: string };
    Headers: { 'x-wenmi-worker-id'?: string; 'x-wenmi-worker-token'?: string };
    Body: { ownerId: string; bookId: string };
  }>('/api/v1/internal/worker/canon-index/:requestId/execute', async (request) => {
    const workerId = request.headers['x-wenmi-worker-id'];
    if (workerId === undefined || workerId.length === 0) throw new DomainError('VALIDATION_ERROR', '缺少Worker身份');
    const recorded = database.prepare(`SELECT 1 FROM worker_health WHERE worker_id = ?`).get(workerId);
    if (recorded === undefined) throw new DomainError('VALIDATION_ERROR', 'Worker身份未登记');
    const result = new CanonIndexService(database, config.dataDir, new UuidGenerator(), new SystemClock())
      .executeClaimed({ ownerId: request.body.ownerId, bookId: request.body.bookId }, request.params.requestId, workerId);
    return success(result, request.id);
  });

  app.get<{ Querystring: { after?: string; bookId?: string }; Headers: { 'last-event-id'?: string } }>('/api/v1/events', async (request, reply) => {
    const after = Number(request.query.after ?? request.headers['last-event-id'] ?? '0');
    if (!Number.isInteger(after) || after < 0) throw new DomainError('VALIDATION_ERROR', 'after必须是非负整数');
    reply.hijack();
    reply.raw.writeHead(200, {
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no'
    });
    let cursor = after;
    const writePending = (): void => {
      const pending = events.replay({ ...requireAuthenticatedOwner(request), bookId: request.query.bookId ?? null }, cursor);
      for (const event of pending) {
        const publicEvent = requestsCleanAuthorProjection(request.headers)
          ? projectAuthorApiValue(event)
          : event;
        reply.raw.write(`id: ${event.eventSeq}\nevent: ${event.eventType}\ndata: ${JSON.stringify(publicEvent)}\n\n`);
        cursor = event.eventSeq;
      }
    };
    writePending();
    const poll = setInterval(writePending, 1_000);
    const heartbeat = setInterval(() => reply.raw.write(': keepalive\n\n'), 10_000);
    liveSseIntervals.add(poll);
    liveSseIntervals.add(heartbeat);
    const cleanup = (): void => {
      clearInterval(poll);
      clearInterval(heartbeat);
      liveSseIntervals.delete(poll);
      liveSseIntervals.delete(heartbeat);
    };
    request.raw.once('close', cleanup);
    reply.raw.once('close', cleanup);
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id || randomUUID();
    if (error instanceof DomainError) {
      void reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details, retryable: error.retryable },
        meta: { requestId }
      });
      return;
    }
    const httpStatus = typeof error === 'object' && error !== null && 'statusCode' in error
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;
    if (typeof httpStatus === 'number' && httpStatus >= 400 && httpStatus < 500) {
      // 保留真实异常消息与堆栈：这类错误往往是 provider 4xx（如 400 上下文超长）
      // 被管道 rethrow 而来，若不记录则连运维都看不到原因。
      request.log.error({ err: error }, 'unhandled request error');
      void reply.status(httpStatus).send({
        error: { code: 'INVALID_REQUEST_BODY', message: '提交的内容格式不正确，请检查后再试', details: {}, retryable: false },
        meta: { requestId }
      });
      return;
    }
    // Keep the public response deliberately generic, but always retain the local
    // exception message and stack (including provider 4xx such as a 400 "prompt
    // too long") so a failed workflow can be diagnosed instead of being flattened
    // into an opaque INVALID_REQUEST_BODY / INTERNAL_ERROR with no trace.
    request.log.error({ err: error }, 'unhandled request error');
    void reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: '这次没有顺利完成，请稍后再试。问题已经留下本地追踪信息，方便继续排查。', details: {}, retryable: false },
      meta: { requestId }
    });
  });

  return app;
}
