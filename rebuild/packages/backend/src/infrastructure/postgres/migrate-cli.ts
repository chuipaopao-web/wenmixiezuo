import { loadPostgresRuntimeConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { toSafeErrorResponse } from "../safe-error.js";
import { runMigrations } from "./migrations.js";

const logger = createLogger("migrator");

try {
  const config = loadPostgresRuntimeConfig(process.env, "migrator");
  const result = await runMigrations({ config });
  logger.info("migrations-complete", result);
} catch (error) {
  logger.error("migrations-failed", toSafeErrorResponse(error));
  process.exitCode = 1;
}
