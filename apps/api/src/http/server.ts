import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { success } from '../contracts/api.js';
import { DomainError } from '../domain/errors.js';
import type { RuntimeConfig } from '../infrastructure/runtime-config.js';

interface WorkerHealthRow {
  worker_id: string;
  release_id: string;
  process_id: number;
  started_at: string;
  heartbeat_at: string;
  capabilities_json: string;
  current_task_id: string | null;
}

export async function createServer(config: RuntimeConfig, database: DatabaseSync): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.WENMAI_LOG_LEVEL ?? 'info' } });
  await app.register(cors, { origin: config.webOrigin, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });

  app.get('/health', async (request) => {
    const integrity = database.prepare('PRAGMA quick_check').get() as { quick_check: string };
    return success({
      service: 'wenmai-api',
      status: integrity.quick_check === 'ok' ? 'ok' : 'degraded',
      database: integrity.quick_check,
      releaseId: config.releaseId,
      schemaVersion: 1,
      dataDirectoryReady: true
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

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id || randomUUID();
    if (error instanceof DomainError) {
      void reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details, retryable: error.retryable },
        meta: { requestId }
      });
      return;
    }
    request.log.error({ err: error }, 'unhandled request error');
    void reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: '内部错误', details: {}, retryable: false },
      meta: { requestId }
    });
  });

  return app;
}

