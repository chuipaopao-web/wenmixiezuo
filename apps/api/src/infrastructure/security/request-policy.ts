import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { DomainError } from '../../domain/errors.js';
import type { RuntimeConfig } from '../runtime-config.js';
import { IdentityService } from '../../identity/identity-service.js';
import { constantTimeTokenMatches } from '../../identity/domain/tokens.js';

export interface RequestPolicyOptions {
  trustedTest?: boolean;
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const READ_METHODS = new Set(['GET', 'HEAD']);
const PUBLIC_AUTH_PATHS = new Set(['/api/v1/auth/register', '/api/v1/auth/login']);

function reject(code: string, message: string, statusCode: number): never {
  throw new DomainError(code, message, {}, false, statusCode);
}

function browserOrigins(config: RuntimeConfig): Set<string> {
  const origins = new Set([config.webOrigin]);
  if (config.adminOrigin !== null) origins.add(config.adminOrigin);
  return origins;
}

function verifyBrowserWrite(request: FastifyRequest, config: RuntimeConfig): void {
  if (request.headers.origin === undefined || !browserOrigins(config).has(request.headers.origin)) {
    reject('ORIGIN_REJECTED', '请求来源不受信任', 403);
  }
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite !== 'same-site' && fetchSite !== 'same-origin') reject('FETCH_METADATA_REJECTED', '请求站点范围不受信任', 403);
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') reject('CONTENT_TYPE_REJECTED', '写操作只接受JSON数据', 415);
}

function allowedHosts(config: RuntimeConfig): Set<string> {
  const hosts = new Set([`${config.apiHost}:${config.apiPort}`, `127.0.0.1:${config.apiPort}`]);
  try {
    hosts.add(new URL(config.webOrigin).host);
  } catch {
    // 启动配置会在其他位置给出明确错误；这里保持最小Host白名单。
  }
  if (config.publicOrigin !== null) {
    try {
      hosts.add(new URL(config.publicOrigin).host);
    } catch {
      // publicOrigin 已在 runtime-config 中校验过，此处仅兜底。
    }
  }
  if (config.adminOrigin !== null) {
    hosts.add(new URL(config.adminOrigin).host);
  }
  return hosts;
}

export async function registerRequestPolicy(
  app: FastifyInstance,
  config: RuntimeConfig,
  accounts: IdentityService,
  options: RequestPolicyOptions = {}
): Promise<void> {
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
        sessionId: 'trusted-test-session',
        credentialVersion: 0
      };
      return;
    }

    if (PUBLIC_AUTH_PATHS.has(path)) {
      if (request.method !== 'POST') reject('METHOD_NOT_ALLOWED', '这个入口只接受提交操作', 405);
      verifyBrowserWrite(request, config);
      return;
    }
    if (!path.startsWith('/api/v1/') && !path.startsWith('/api/time-machine/')) return;

    request.authContext = accounts.authenticate(request.headers.cookie);
    if (request.authContext === null) reject('AUTHENTICATION_REQUIRED', '请先登录文秘写作', 401);
    if (WRITE_METHODS.has(request.method)) verifyBrowserWrite(request, config);
  });

  // 公网部署时启用限流。认证 hook 已先填充 authContext，下面只使用已验证身份；
  // 注册、登录、匿名和健康检查仍按 IP 分桶，不能被任意 cookie/header 绕过。
  if (config.publicOrigin !== null) {
    await app.register(fastifyRateLimit, {
      max: async (request) => rateLimitBudget(request),
      timeWindow: '1 minute',
      keyGenerator: (request) => rateLimitKey(request),
      // 插件会原样 throw 这里返回的值，交给全局错误处理：返回 DomainError 才能得到
      // 正确的 429 + RATE_LIMITED + retryable，而不是被兜底成 500 INTERNAL_ERROR。
      errorResponseBuilder: () => new DomainError('RATE_LIMITED', '请求太频繁，请稍后再试', {}, true, 429),
      // 注册和登录使用更严格的路由级限流，见 account-routes。
    });
  }

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    reply.header('Cross-Origin-Resource-Policy', 'same-site');
    return payload;
  });
}

function requestPath(request: FastifyRequest): string {
  return request.url.split('?', 1)[0] ?? request.url;
}

function rateLimitKey(request: FastifyRequest): string {
  const path = requestPath(request);
  if (path === '/health') return `health:${request.ip}`;
  if (PUBLIC_AUTH_PATHS.has(path)) return `public-auth:${path}:${request.ip}`;
  if (request.authContext !== null) {
    if (READ_METHODS.has(request.method)) return `user-read:${request.authContext.userId}`;
    if (WRITE_METHODS.has(request.method)) return `user-write:${request.authContext.userId}`;
  }
  return `anonymous:${request.ip}`;
}

function rateLimitBudget(request: FastifyRequest): number {
  const path = requestPath(request);
  if (path === '/health') return 100;
  if (PUBLIC_AUTH_PATHS.has(path)) return 100;
  if (request.authContext !== null && READ_METHODS.has(request.method)) return 600;
  return 100;
}
