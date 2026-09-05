import {
  createFoundationStatus,
  createLogger,
  createPostgresPool,
  createSyntheticTaskService,
  loadPostgresRuntimeConfig,
  PostgresSyntheticTaskRepository,
  toSafeErrorResponse,
  verifyRuntimeDatabase,
  type ClaimedSyntheticTask,
  type PgPool,
  type SyntheticTaskLease
} from "@wenmi-rebuild/backend";

const logger = createLogger("worker");

try {
  const config = loadPostgresRuntimeConfig(process.env, "app");
  await verifyRuntimeDatabase(config);
  const pool = createPostgresPool(config);
  await runWorkerProcess(pool, Boolean(config.database));
} catch (error) {
  logger.error("worker-start-failed", toSafeErrorResponse(error));
  process.exitCode = 1;
}

async function runWorkerProcess(pool: PgPool, databaseConfigured: boolean): Promise<void> {
  logger.info("worker-started", {
    status: createFoundationStatus("worker", databaseConfigured),
    syntheticTasks: process.env.WENMI_REBUILD_WORKER_SYNTHETIC === "1" ? "enabled" : "disabled"
  });

  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    if (process.env.WENMI_REBUILD_WORKER_ONCE === "1") {
      if (process.env.WENMI_REBUILD_WORKER_SYNTHETIC === "1") {
        await runSyntheticWorkerOnce(pool);
      }
      return;
    }

    while (!stopped) {
      try {
        if (process.env.WENMI_REBUILD_WORKER_SYNTHETIC === "1") {
          await runSyntheticWorkerOnce(pool);
        } else {
          logger.info("worker-idle", { syntheticTasks: "disabled" });
        }
      } catch (error) {
        logger.error("worker-loop-failed", toSafeErrorResponse(error));
      }
      await delay(5_000);
    }
    logger.info("worker-stopped", { reason: "signal" });
  } finally {
    await pool.end();
  }
}

async function runSyntheticWorkerOnce(pool: PgPool): Promise<void> {
  const service = createSyntheticTaskService(new PostgresSyntheticTaskRepository(pool));
  const workerId = process.env.WENMI_REBUILD_WORKER_ID ?? `synthetic-worker-${process.pid}`;
  const leaseMs = Number(process.env.WENMI_REBUILD_SYNTHETIC_LEASE_MS ?? "30000");
  const task = await service.claimNext(workerId, leaseMs);
  if (!task) {
    logger.info("synthetic-worker-idle", {});
    return;
  }
  const lease = leaseFromTask(task);
  try {
    const checkpoint = task.checkpoint && typeof task.checkpoint === "object" ? task.checkpoint as Record<string, unknown> : {};
    if (checkpoint["prepared"] !== true) {
      await service.saveCheckpoint(lease, { prepared: true, preparedBy: workerId });
      if (process.env.WENMI_REBUILD_SYNTHETIC_CRASH_AFTER_CHECKPOINT === "1") {
        logger.error("synthetic-worker-checkpoint-crash-requested", { taskId: task.id });
        process.exit(74);
      }
    }
    const external = await service.recordExternalCallStarted(lease, "synthetic-output");
    logger.info("synthetic-external-call-started", { taskId: task.id, callId: external.callId });
    if (!external.canDispatch) {
      logger.info("synthetic-external-call-already-started", { taskId: task.id, callId: external.callId });
      return;
    }
    if (process.env.WENMI_REBUILD_SYNTHETIC_CRASH_AFTER_EXTERNAL_START === "1") {
      logger.error("synthetic-worker-crash-requested", { taskId: task.id, callId: external.callId });
      process.exit(75);
    }
    await service.completeTask(lease, {
      kind: "synthetic-result",
      taskId: task.id,
      callId: external.callId,
      workerId
    });
    logger.info("synthetic-task-completed", { taskId: task.id });
  } catch (error) {
    logger.error("synthetic-task-failed", toSafeErrorResponse(error));
    await service.failTask(lease, { message: "合成任务执行失败。" }, true);
  }
}

function leaseFromTask(task: ClaimedSyntheticTask): SyntheticTaskLease {
  return {
    taskId: task.id,
    ownerId: task.scope.ownerId,
    bookId: task.scope.bookId,
    leaseToken: task.leaseToken,
    workerId: task.leaseOwner
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
