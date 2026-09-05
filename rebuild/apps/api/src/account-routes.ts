import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  authSessionResultSchema,
  currentAccountSchema,
  passwordChangedSchema,
  revokeOtherSessionsSchema
} from "@wenmi-rebuild/contracts";
import {
  DomainError,
  REBUILD_SESSION_COOKIE,
  readCookie,
  type AccountCoreService,
  type AuthContext
} from "@wenmi-rebuild/backend";

interface Envelope<T> {
  readonly data: T;
  readonly meta: { readonly requestId: string };
}

declare module "fastify" {
  interface FastifyRequest {
    rebuildAuth: AuthContext | null;
  }
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LOCAL_BROWSER_ORIGINS = new Set(["http://127.0.0.1:43280", "http://127.0.0.1:43281"]);
const LOCAL_API_HOSTS = new Set([
  "127.0.0.1:43280",
  "127.0.0.1:43281",
  "127.0.0.1:43282",
  "localhost:43280",
  "localhost:43281",
  "localhost:43282"
]);

export async function registerAccountRoutes(app: FastifyInstance, accounts: AccountCoreService): Promise<void> {
  await app.register(async (authApp) => {
    authApp.addHook("onRequest", async (request) => {
      request.rebuildAuth = null;
      const host = request.headers.host;
      if (host === undefined || !LOCAL_API_HOSTS.has(host)) {
        throw new DomainError("REQUEST_HOST_REJECTED", "请求主机不受信任。");
      }
      if (duplicateCookie(request.headers.cookie, REBUILD_SESSION_COOKIE)) {
        throw new DomainError("REQUEST_COOKIE_REJECTED", "登录状态不明确，请重新登录。");
      }
      if (WRITE_METHODS.has(request.method)) verifyBrowserWrite(request);
    });

    authApp.addHook("onSend", async (_request, reply, payload) => {
      reply.header("Cache-Control", "no-store");
      return payload;
    });

    authApp.post<{ Body: { email?: unknown; password?: unknown } }>("/login", async (request, reply) => {
      const issued = await accounts.login({
        email: readString(request.body?.email),
        password: readString(request.body?.password),
        ipAddress: clientIp(request)
      });
      reply.header("Set-Cookie", issued.cookie);
      return envelope(authSessionResultSchema.parse({ account: issued.account, expiresInSeconds: issued.expiresInSeconds }), request);
    });

    authApp.get("/me", async (request) => {
      const context = await requireAuth(request, accounts);
      return envelope(currentAccountSchema.parse({
        userId: context.userId,
        email: context.email,
        displayName: context.displayName,
        role: context.role,
        status: "active",
        emailVerified: true
      }), request);
    });

    authApp.post("/logout", async (request, reply) => {
      const token = requireSessionToken(request);
      const result = await accounts.logout(token);
      reply.header("Set-Cookie", result.cookie);
      return envelope({ loggedOut: true }, request);
    });

    authApp.post<{ Body: { currentPassword?: unknown; nextPassword?: unknown } }>("/password/change", async (request) => {
      const token = requireSessionToken(request);
      const result = await accounts.changePassword({
        sessionToken: token,
        currentPassword: readString(request.body?.currentPassword),
        nextPassword: readString(request.body?.nextPassword),
        ipAddress: clientIp(request)
      });
      return envelope(passwordChangedSchema.parse(result), request);
    });

    authApp.post("/sessions/revoke-others", async (request) => {
      const token = requireSessionToken(request);
      const result = await accounts.revokeOtherSessions(token);
      return envelope(revokeOtherSessionsSchema.parse(result), request);
    });
  }, { prefix: "/v1/auth" });
}

async function requireAuth(request: FastifyRequest, accounts: AccountCoreService): Promise<AuthContext> {
  const context = await accounts.authenticateCookie(request.headers.cookie);
  if (context === null) throw new DomainError("AUTHENTICATION_REQUIRED", "请先登录。");
  request.rebuildAuth = context;
  return context;
}

function requireSessionToken(request: FastifyRequest): string {
  const token = readCookie(request.headers.cookie, REBUILD_SESSION_COOKIE);
  if (token === null) throw new DomainError("AUTHENTICATION_REQUIRED", "请先登录。");
  return token;
}

function readString(value: unknown): string {
  if (typeof value !== "string") throw new DomainError("ACCOUNT_INPUT_INVALID", "请求内容不完整。");
  return value;
}

function envelope<T>(data: T, request: FastifyRequest): Envelope<T> {
  return { data, meta: { requestId: request.id } };
}

function verifyBrowserWrite(request: FastifyRequest): void {
  const origin = request.headers.origin;
  if (origin === undefined || !LOCAL_BROWSER_ORIGINS.has(origin)) {
    throw new DomainError("REQUEST_ORIGIN_REJECTED", "请求来源不受信任。");
  }
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new DomainError("REQUEST_CONTENT_TYPE_REJECTED", "写操作只接受JSON。");
  }
}

function duplicateCookie(cookieHeader: string | undefined, name: string): boolean {
  if (cookieHeader === undefined) return false;
  return cookieHeader.split(";").filter((value) => value.trim().startsWith(`${name}=`)).length > 1;
}

function clientIp(request: FastifyRequest): string {
  return request.socket.remoteAddress ?? "127.0.0.1";
}
