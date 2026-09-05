import { createFoundationStatus, createLogger, loadPostgresRuntimeConfig, toSafeErrorResponse, verifyRuntimeDatabase } from "@wenmi-rebuild/backend";

const logger = createLogger("worker");

try {
  const config = loadPostgresRuntimeConfig(process.env, "app");
  await verifyRuntimeDatabase(config);
  logger.info("worker-started", {
    status: createFoundationStatus("worker", Boolean(config.database)),
    note: "foundation worker has no task executor in batch 108"
  });

  if (process.env.WENMI_REBUILD_WORKER_ONCE === "1") {
    process.exitCode = 0;
  } else {
    const heartbeat = setInterval(() => {
      logger.info("worker-idle", { taskExecution: "not-implemented" });
    }, 60_000);

    const stop = () => {
      clearInterval(heartbeat);
      logger.info("worker-stopped", { reason: "signal" });
      process.exit(0);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
} catch (error) {
  logger.error("worker-start-failed", toSafeErrorResponse(error));
  process.exitCode = 1;
}
