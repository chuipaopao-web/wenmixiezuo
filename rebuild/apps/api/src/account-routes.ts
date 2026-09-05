import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  authSessionResultSchema,
  accountProfileSchema,
  accountProfileUpdateSchema,
  currentAccountSchema,
  passwordChangedSchema,
  revokeOtherSessionsSchema
} from "@wenmi-rebuild/contracts";
import {
  DomainError,
  type AccountCoreService,
  type AuthContext
} from "@wenmi-rebuild/backend";
import { clientIp, registerLocalProtectedHooks, requireSessionToken } from "./local-security.js";

interface Envelope<T> {
  readonly data: T;
  readonly meta: { readonly requestId: string };
}

declare module "fastify" {
  interface FastifyRequest {
    rebuildAuth: AuthContext | null;
  }
}

export async function registerAccountRoutes(app: FastifyInstance, accounts: AccountCoreService): Promise<void> {
  await app.register(async (authApp) => {
    authApp.addHook("onRequest", async (request) => {
      request.rebuildAuth = null;
    });
    registerLocalProtectedHooks(authApp);

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

    authApp.get("/profile", async (request) => {
      const token = requireSessionToken(request);
      return envelope(accountProfileSchema.parse(await accounts.getProfile(token)), request);
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

    authApp.post("/profile", async (request) => {
      const token = requireSessionToken(request);
      const input = parseProfileUpdate(request.body);
      return envelope(accountProfileSchema.parse(await accounts.updateProfile({
        sessionToken: token,
        displayName: input.displayName,
        expectedVersion: input.expectedVersion
      })), request);
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

function readString(value: unknown): string {
  if (typeof value !== "string") throw new DomainError("ACCOUNT_INPUT_INVALID", "请求内容不完整。");
  return value;
}

function parseProfileUpdate(value: unknown): { displayName: string; expectedVersion: number } {
  const parsed = accountProfileUpdateSchema.safeParse(value);
  if (!parsed.success) throw new DomainError("ACCOUNT_INPUT_INVALID", "资料内容没有通过检查。");
  return parsed.data;
}

function envelope<T>(data: T, request: FastifyRequest): Envelope<T> {
  return { data, meta: { requestId: request.id } };
}
