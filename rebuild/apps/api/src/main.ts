import { createApiServer } from "./create-server.js";
import { createLogger, toSafeErrorResponse } from "@wenmi-rebuild/backend";

const logger = createLogger("api");

try {
  const server = await createApiServer();
  await server.listen({ host: "127.0.0.1", port: 43282 });
  logger.info("api-started", { host: "127.0.0.1", port: 43282 });
} catch (error) {
  logger.error("api-start-failed", toSafeErrorResponse(error));
  process.exitCode = 1;
}
