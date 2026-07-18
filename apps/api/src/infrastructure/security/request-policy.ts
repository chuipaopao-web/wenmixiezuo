import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DomainError } from '../../domain/errors.js';
import type { RuntimeConfig } from '../runtime-config.js';
import { constantTimeTokenMatches, RuntimeSessionService } from './runtime-session.js';

export interface RequestPolicyOptions {
  trustedTest?: boolean;
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function reject(code: string, message: string, statusCode: number): never {
  throw new DomainError(code, message, {}, false, statusCode);
}

function verifyBrowserWrite(request: FastifyRequest, config: RuntimeConfig): void {
  if (request.headers.origin !== config.webOrigin) reject('ORIGIN_REJECTED', '请求来源不受信任', 403);
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite !== 'same-site' && fetchSite !== 'same-origin') reject('FETCH_METADATA_REJECTED', '请求站点范围不受信任', 403);
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') reject('CONTENT_TYPE_REJECTED', '写操作只接受application/json', 415);
}

export function registerRequestPolicy(
  app: FastifyInstance,
  config: RuntimeConfig,
  sessions: RuntimeSessionService,
  options: RequestPolicyOptions = {}
): void {
  app.addHook('onRequest', async (request) => {
    const path = request.url.split('?', 1)[0] ?? request.url;
    const expectedHost = `127.0.0.1:${config.apiPort}`;

    if (!options.trustedTest && request.headers.host !== expectedHost) {
      reject('HOST_REJECTED', '请求主机不受信任', 403);
    }
    if (request.method === 'OPTIONS') return;
    if (path === '/health') return;

    if (path.startsWith('/api/v1/internal/worker/')) {
      if (!constantTimeTokenMatches(request.headers['x-wenmi-worker-token'] as string | undefined, config.workerToken)) {
        reject('WORKER_AUTHENTICATION_REQUIRED', 'Worker凭证无效', 401);
      }
      return;
    }

    if (options.trustedTest) return;
    if (path === '/api/v1/runtime/session') {
      if (request.method !== 'POST') reject('METHOD_NOT_ALLOWED', '会话入口只接受POST', 405);
      verifyBrowserWrite(request, config);
      return;
    }
    if (!path.startsWith('/api/v1/')) return;
    if (!sessions.validateCookie(request.headers.cookie)) reject('AUTHENTICATION_REQUIRED', '本机会话无效或已过期', 401);
    if (WRITE_METHODS.has(request.method)) verifyBrowserWrite(request, config);
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    reply.header('Cross-Origin-Resource-Policy', 'same-site');
    return payload;
  });
}
