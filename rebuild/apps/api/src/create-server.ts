import Fastify from "fastify";
import cors from "@fastify/cors";
import { createFoundationStatus, createLogger, loadPostgresRuntimeConfig, toSafeErrorResponse, verifyRuntimeDatabase } from "@wenmi-rebuild/backend";
import { foundationStatusSchema } from "@wenmi-rebuild/contracts";

export async function createApiServer() {
  const logger = createLogger("api");
  const config = loadPostgresRuntimeConfig(process.env, "app");
  await verifyRuntimeDatabase(config);
  const server = Fastify({
    logger: false
  });

  await server.register(cors, {
    origin: [/^http:\/\/127\.0\.0\.1:4328[01]$/],
    methods: ["GET"]
  });

  server.setErrorHandler((error, _request, reply) => {
    const safe = toSafeErrorResponse(error);
    logger.error("request-failed", safe);
    const statusCode = safe.code === "CONFIGURATION_INVALID" || safe.code === "DATABASE_GUARD_FAILED" ? 503 : 500;
    reply.status(statusCode).send(safe);
  });

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
