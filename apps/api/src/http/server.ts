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
import type { RuntimeConfig } from '../infrastructure/runtime-config.js';
import { ChapterPipelineService } from '../application/creation/chapter-pipeline-service.js';
import { DiscussionPipelineService } from '../application/discussions/discussion-pipeline-service.js';
import { ModelAdapterFactory } from '../infrastructure/models/model-adapter-factory.js';
import { ConversationReplyPipelineService } from '../application/chat/conversation-reply-pipeline-service.js';
import { RuntimeSessionService } from '../infrastructure/security/runtime-session.js';
import { registerRequestPolicy, type RequestPolicyOptions } from '../infrastructure/security/request-policy.js';
import { registerRuntimeRoutes } from './runtime-routes.js';
import { RuntimeCapabilityProbe } from '../infrastructure/capabilities/runtime-capability-probe.js';
import { ModelAssetRegistry } from '../infrastructure/capabilities/model-asset-registry.js';
import { CapabilityService } from '../application/capabilities/capability-service.js';
import { CanonIndexService } from '../application/projections/canon-index-service.js';
import { HybridRetrievalService } from '../application/memory/hybrid-retrieval-service.js';
import { RetrievalOrchestrationRepository } from '../infrastructure/db/repositories/retrieval-orchestration-repository.js';
import { KnowledgeRepository } from '../infrastructure/db/repositories/knowledge-repository.js';
import { ChunkSnapshotRepository } from '../infrastructure/db/repositories/chunk-snapshot-repository.js';
import { loadLocalRetrievalRuntime } from '../infrastructure/retrieval/local-retrieval-runtime.js';

interface WorkerHealthRow {
  worker_id: string;
  release_id: string;
  process_id: number;
  started_at: string;
  heartbeat_at: string;
  capabilities_json: string;
  current_task_id: string | null;
}

export async function createServer(config: RuntimeConfig, database: DatabaseSync, options: RequestPolicyOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.WENMI_LOG_LEVEL ?? 'info' },
    logController: new LogController({ disableRequestLogging: true }),
    // A five-million-character Chinese manuscript is roughly 15 MiB before JSON overhead.
    // The continuation service still enforces the stricter character limit and localhost session gate.
    bodyLimit: 24 * 1024 * 1024
  });
  await app.register(cors, { origin: config.webOrigin, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] });
  await app.register(multipart, {
    limits: { files: 1, fileSize: 20 * 1024 * 1024, fields: 0, parts: 1 }
  });
  const sessions = new RuntimeSessionService();
  registerRequestPolicy(app, config, sessions, options);
  const events = new EventStore(database, new UuidGenerator(), new SystemClock());
  const modelAdapters = new ModelAdapterFactory(config.modelRuntime);
  const retrievalIds = new UuidGenerator();
  const retrievalClock = new SystemClock();
  const productionRetrieval = new HybridRetrievalService(
    new RetrievalOrchestrationRepository(database), new KnowledgeRepository(database),
    new ChunkSnapshotRepository(database), retrievalIds, retrievalClock,
    loadLocalRetrievalRuntime(config.dataDir)
  );
  const capabilities = new CapabilityService(
    new RuntimeCapabilityProbe(database, config.dataDir),
    new ModelAssetRegistry(config.dataDir),
    config.modelRuntime,
    config.releaseId
  );
  await registerRuntimeRoutes(app, sessions, capabilities);
  await registerDomainRoutes(app, database, config);

  app.get('/health', async (request) => {
    const integrity = database.prepare('PRAGMA quick_check').get() as { quick_check: string };
    return success({
      service: 'wenmi-api',
      status: integrity.quick_check === 'ok' ? 'ok' : 'degraded',
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
        : task.task_type === 'conversation_reply'
          ? await new ConversationReplyPipelineService(database, config.releaseId, new UuidGenerator(), new SystemClock(), modelAdapters, productionRetrieval).executeClaimed(scope, request.params.taskId, workerId, { leaseToken: request.body.leaseToken, attemptNo: request.body.attemptNo })
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

  app.get<{ Querystring: { after?: string; bookId?: string } }>('/api/v1/events', async (request, reply) => {
    const after = Number(request.query.after ?? '0');
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
      const pending = events.replay({ ownerId: config.ownerId, bookId: request.query.bookId ?? null }, cursor);
      for (const event of pending) {
        reply.raw.write(`id: ${event.eventSeq}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`);
        cursor = event.eventSeq;
      }
    };
    writePending();
    const poll = setInterval(writePending, 1_000);
    const heartbeat = setInterval(() => reply.raw.write(': keepalive\n\n'), 10_000);
    request.raw.once('close', () => {
      clearInterval(poll);
      clearInterval(heartbeat);
    });
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
    request.log.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'unhandled request error');
    void reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: '这次没有顺利完成，请稍后再试。问题已经留下本地追踪信息，方便继续排查。', details: {}, retryable: false },
      meta: { requestId }
    });
  });

  return app;
}
