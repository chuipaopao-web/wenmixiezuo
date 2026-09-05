import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  createAccountCoreService,
  createFoundationStatus,
  createLogger,
  createPostgresPool,
  loadPostgresRuntimeConfig,
  toSafeErrorResponse,
  verifyRuntimeDatabase,
  type AccountCoreService,
  type PgPool
} from "@wenmi-rebuild/backend";
import { foundationStatusSchema } from "@wenmi-rebuild/contracts";
import { registerAccountRoutes } from "./account-routes.js";

export interface ApiServerOptions {
  readonly accountService?: AccountCoreService;
  readonly accountPool?: PgPool;
}

export async function createApiServer(options: ApiServerOptions = {}) {
  const logger = createLogger("api");
  const config = loadPostgresRuntimeConfig(process.env, "app");
  await verifyRuntimeDatabase(config);
  const accountPool = options.accountPool ?? createPostgresPool(config);
  const accountService = options.accountService ?? createAccountCoreService(accountPool, { secureCookies: false });
  const server = Fastify({
    logger: false,
    bodyLimit: 16 * 1024
  });

  await server.register(cors, {
    origin: [/^http:\/\/127\.0\.0\.1:4328[01]$/],
    credentials: true,
    methods: ["GET", "POST"]
  });

  server.setErrorHandler((error, request, reply) => {
    const safe = toSafeErrorResponse(error);
    logger.error("request-failed", safe);
    const statusCode = statusForSafeCode(safe.code);
    reply.header("Cache-Control", "no-store");
    reply.status(statusCode).send(safe);
  });

  server.addHook("onClose", async () => {
    if (options.accountPool === undefined) await accountPool.end();
  });

  await registerAccountRoutes(server, accountService);

  server.get("/health", async (_request, reply) => {
    try {
      await verifyRuntimeDatabase(config);
    } catch (error) {
      reply.status(503);
      return toSafeErrorResponse(error);
    }
    const status = createFoundationStatus("api", Boolean(config.database));
    return foundationStatusSchema.parse(status);
  });

  server.get("/v1/foundation/status", async (_request, reply) => {
    try {
      await verifyRuntimeDatabase(config);
    } catch (error) {
      reply.status(503);
      return toSafeErrorResponse(error);
    }
    const status = createFoundationStatus("api", Boolean(config.database));
    return foundationStatusSchema.parse(status);
  });

  return server;
}

function statusForSafeCode(code: string): number {
  if (code === "CONFIGURATION_INVALID" || code === "DATABASE_GUARD_FAILED" || code === "ACCOUNT_PASSWORD_HASH_BUSY") return 503;
  if (code === "AUTHENTICATION_REQUIRED" || code === "ACCOUNT_CREDENTIALS_INVALID") return 401;
  if (code === "AUTHORIZATION_REQUIRED" || code === "ACCOUNT_EMAIL_NOT_VERIFIED" || code === "ACCOUNT_DISABLED" ||
    code === "REQUEST_ORIGIN_REJECTED" || code === "REQUEST_HOST_REJECTED" || code === "REQUEST_COOKIE_REJECTED") return 403;
  if (code === "REQUEST_CONTENT_TYPE_REJECTED") return 415;
  if (code === "ACCOUNT_RATE_LIMITED") return 429;
  if (code === "ACCOUNT_INPUT_INVALID" || code === "ACCOUNT_TOKEN_INVALID") return 400;
  return 500;
}
