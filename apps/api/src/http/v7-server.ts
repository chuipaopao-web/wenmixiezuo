import cors from '@fastify/cors';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { success } from '../contracts/api.js';
import { DomainError } from '../domain/errors.js';
import { SystemClock } from '../domain/ids.js';
import { ModelAdapterFactory } from '../infrastructure/models/model-adapter-factory.js';
import type { V7OpeningModelAdapterResolver } from '../infrastructure/models/v7-opening-agent-model-gateway.js';
import { VolcengineArkImageGateway, type V7CoverImageGateway } from '../infrastructure/models/volcengine-ark-image-gateway.js';
import type { RuntimeConfig } from '../infrastructure/runtime-config.js';
import { AccountAuthService } from '../infrastructure/security/account-auth-service.js';
import { MembershipService } from '../infrastructure/security/membership-service.js';
import { registerRequestPolicy, type RequestPolicyOptions } from '../infrastructure/security/request-policy.js';
import { registerAccountRoutes } from './account-routes.js';
import { registerV7AdminConsoleRoutes } from './v7-admin-console-routes.js';
import { registerV7AdminPlatformRoutes } from './v7-admin-platform-routes.js';
import { projectSerializedAuthorResponse, shouldProjectAuthorResponse } from './author-api-projection.js';
import { registerV7CharacterMemoryRoutes } from './v7-character-memory-routes.js';
import { registerV7CreationRoutes } from './v7-creation-routes.js';
import { registerV7OpeningAgentRoutes } from './v7-opening-agent-routes.js';
import { registerV7PlanningTreeRoutes } from './v7-planning-tree-routes.js';
import { registerV7PromptGovernanceRoutes } from './v7-prompt-governance-routes.js';
import { registerV7SettingEditorialRoutes } from './v7-setting-editorial-routes.js';

interface WorkerHealthRow {
  worker_id: string;
  release_id: string;
  process_id: number;
  started_at: string;
  heartbeat_at: string;
  capabilities_json: string;
  current_task_id: string | null;
}

export interface V7ServerOptions extends RequestPolicyOptions {
  v7OpeningModelAdapters?: V7OpeningModelAdapterResolver;
  v7CoverImageGateway?: V7CoverImageGateway;
}

/** V7 唯一公开 API 入口；旧产品路由、旧任务执行器和旧 SSE 不在此运行时装配。 */
export async function createV7Server(
  config: RuntimeConfig,
  database: DatabaseSync,
  options: V7ServerOptions = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.WENMI_LOG_LEVEL ?? 'info' },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 24 * 1024 * 1024,
    trustProxy: true
  });
  const corsOrigins = config.adminOrigin === null ? config.webOrigin : [config.webOrigin, config.adminOrigin];
  await app.register(cors, { origin: corsOrigins, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] });
  const accounts = new AccountAuthService(database, config.webOrigin.startsWith('https://'), config.ownerId);
  await registerRequestPolicy(app, config, accounts, options);
  app.addHook('onSend', async (request, reply, payload) => shouldProjectAuthorResponse(request.url, reply.statusCode, request.headers)
    ? projectSerializedAuthorResponse(payload)
    : payload);

  const modelAdapters = new ModelAdapterFactory(config.modelRuntime);
  await registerAccountRoutes(app, accounts, new MembershipService(database, new SystemClock()));
  await registerV7AdminPlatformRoutes(app, database);
  await registerV7AdminConsoleRoutes(app, database);
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
    if (row === undefined) return success({ status: 'possibly_offline', worker: null }, request.id);
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
    const row = database.prepare('SELECT heartbeat_at FROM worker_health ORDER BY heartbeat_at DESC LIMIT 1')
      .get() as { heartbeat_at: string } | undefined;
    const workerReady = row !== undefined && Date.now() - Date.parse(row.heartbeat_at) <= 15_000;
    return success({ api: 'ready', worker: workerReady ? 'ready' : 'possibly_offline', canStartModelTasks: workerReady }, request.id);
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
    request.log.error({ err: error }, 'unhandled request error');
    if (typeof httpStatus === 'number' && httpStatus >= 400 && httpStatus < 500) {
      void reply.status(httpStatus).send({
        error: { code: 'INVALID_REQUEST_BODY', message: '提交的内容格式不正确，请检查后再试', details: {}, retryable: false },
        meta: { requestId }
      });
      return;
    }
    void reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: '这次没有顺利完成，请稍后再试。问题已经留下本地追踪信息，方便继续排查。', details: {}, retryable: false },
      meta: { requestId }
    });
  });

  return app;
}

export const createServer = createV7Server;
