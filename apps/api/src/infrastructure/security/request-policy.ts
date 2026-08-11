import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DomainError } from '../../domain/errors.js';
import type { RuntimeConfig } from '../runtime-config.js';
import { AccountAuthService, constantTimeTokenMatches } from './account-auth-service.js';

export interface RequestPolicyOptions {
  trustedTest?: boolean;
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const PUBLIC_AUTH_PATHS = new Set(['/api/v1/auth/register', '/api/v1/auth/login']);

function reject(code: string, message: string, statusCode: number): never {
  throw new DomainError(code, message, {}, false, statusCode);
}

function verifyBrowserWrite(request: FastifyRequest, config: RuntimeConfig): void {
  if (request.headers.origin !== config.webOrigin) reject('ORIGIN_REJECTED', '请求来源不受信任', 403);
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite !== 'same-site' && fetchSite !== 'same-origin') reject('FETCH_METADATA_REJECTED', '请求站点范围不受信任', 403);
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') reject('CONTENT_TYPE_REJECTED', '写操作只接受JSON数据', 415);
}

function allowedHosts(config: RuntimeConfig): Set<string> {
  const hosts = new Set([`${config.apiHost}:${config.apiPort}`]);
  try {
    hosts.add(new URL(config.webOrigin).host);
  } catch {
    // 启动配置会在其他位置给出明确错误；这里保持最小Host白名单。
  }
  return hosts;
}

export function registerRequestPolicy(
  app: FastifyInstance,
  config: RuntimeConfig,
  accounts: AccountAuthService,
  options: RequestPolicyOptions = {}
): void {
  const hosts = allowedHosts(config);
  app.addHook('onRequest', async (request) => {
    request.authContext = null;
    const path = request.url.split('?', 1)[0] ?? request.url;

    if (!options.trustedTest && (request.headers.host === undefined || !hosts.has(request.headers.host))) {
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

    if (options.trustedTest) {
      request.authContext = {
        userId: 'trusted-test-user',
        ownerId: config.ownerId,
        email: 'trusted-test@wenmi.local',
        displayName: '测试作者',
        role: 'admin',
        sessionId: 'trusted-test-session'
      };
      return;
    }

    if (PUBLIC_AUTH_PATHS.has(path)) {
      if (request.method !== 'POST') reject('METHOD_NOT_ALLOWED', '这个入口只接受提交操作', 405);
      verifyBrowserWrite(request, config);
      return;
    }
    if (!path.startsWith('/api/v1/')) return;

    request.authContext = accounts.authenticate(request.headers.cookie);
    if (request.authContext === null) reject('AUTHENTICATION_REQUIRED', '请先登录文秘写作', 401);
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