import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  createAccountCoreService,
  createBookShelfService,
  createFoundationStatus,
  createEditorialDepartmentService,
  OpeningConfirmationService,
  createLogger,
  createPostgresPool,
  loadPostgresRuntimeConfig,
  toSafeErrorResponse,
  verifyRuntimeDatabase,
  type AccountCoreService,
  type BookShelfService,
  type EditorialDepartmentService,
  type PgPool
} from "@wenmi-rebuild/backend";
import { foundationStatusSchema } from "@wenmi-rebuild/contracts";
import { registerAccountRoutes } from "./account-routes.js";
import { registerBookshelfRoutes } from "./bookshelf-routes.js";
import { registerOpeningRoutes } from "./opening-routes.js";

export interface ApiServerOptions {
  readonly accountService?: AccountCoreService;
  readonly bookShelfService?: BookShelfService;
  readonly editorialDepartmentService?: EditorialDepartmentService;
  readonly accountPool?: PgPool;
}

export async function createApiServer(options: ApiServerOptions = {}) {
  const logger = createLogger("api");
  const config = loadPostgresRuntimeConfig(process.env, "app");
  await verifyRuntimeDatabase(config);
  const accountPool = options.accountPool ?? createPostgresPool(config);
  const accountService = options.accountService ?? createAccountCoreService(accountPool, { secureCookies: false });
  const bookShelfService = options.bookShelfService ?? createBookShelfService(accountPool, accountService);
  const editorialDepartmentService = options.editorialDepartmentService ?? createEditorialDepartmentService(accountService);
  const server = Fastify({
    logger: false,
    bodyLimit: 16 * 1024
  });

  await server.register(cors, {
    origin: [/^http:\/\/127\.0\.0\.1:4328[01]$/],
    credentials: true,
    methods: ["GET", "POST", "PUT"]
  });

  server.setErrorHandler((error, request, reply) => {
    const safe = safeRequestBodyError(error) ?? toSafeErrorResponse(error);
    logger.error("request-failed", safe);
    const statusCode = statusForError(error, safe.code);
    reply.header("Cache-Control", "no-store");
    reply.status(statusCode).send({ ...safe, error: { message: safe.message, retryable: safe.retryable } });
  });

  server.addHook("onClose", async () => {
    if (options.accountPool === undefined) await accountPool.end();
  });

  await registerAccountRoutes(server, accountService);
  await registerOpeningRoutes(server, bookShelfService, editorialDepartmentService, new OpeningConfirmationService(accountPool, accountService));
  await registerBookshelfRoutes(server, bookShelfService);

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

function safeRequestBodyError(error: unknown): { readonly code: string; readonly message: string; readonly retryable: boolean } | null {
  const fastifyCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (fastifyCode === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return { code: "REQUEST_BODY_TOO_LARGE", message: "请求内容过大，请删减后重试。", retryable: false };
  }
  if (fastifyCode === "FST_ERR_CTP_INVALID_JSON_BODY") {
    return { code: "REQUEST_JSON_INVALID", message: "请求JSON格式无效，请检查后重试。", retryable: false };
  }
  return null;
}

function statusForError(error: unknown, code: string): number {
  const fastifyCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  if (fastifyCode === "FST_ERR_CTP_BODY_TOO_LARGE") return 413;
  if (fastifyCode === "FST_ERR_CTP_INVALID_JSON_BODY") return 400;
  if (code === "CONFIGURATION_INVALID" || code === "DATABASE_GUARD_FAILED" || code === "ACCOUNT_PASSWORD_HASH_BUSY") return 503;
  if (code === "AUTHENTICATION_REQUIRED" || code === "ACCOUNT_CREDENTIALS_INVALID") return 401;
  if (code === "AUTHORIZATION_REQUIRED" || code === "ACCOUNT_EMAIL_NOT_VERIFIED" || code === "ACCOUNT_DISABLED" ||
    code === "REQUEST_ORIGIN_REJECTED" || code === "REQUEST_HOST_REJECTED" || code === "REQUEST_COOKIE_REJECTED") return 403;
  if (code === "REQUEST_CONTENT_TYPE_REJECTED") return 415;
  if (code === "ACCOUNT_RATE_LIMITED") return 429;
  if (code === "ACCOUNT_PROFILE_CONFLICT") return 409;
  if (code === "BOOK_VERSION_CONFLICT" || code === "BOOK_IDEMPOTENCY_CONFLICT") return 409;
  if (code === "BOOK_NOT_FOUND") return 404;
  if (code === "BOOK_INPUT_INVALID") return 400;
  if (code === "ACCOUNT_INPUT_INVALID" || code === "ACCOUNT_TOKEN_INVALID") return 400;
  return 500;
}
