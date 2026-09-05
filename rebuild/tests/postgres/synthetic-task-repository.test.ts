import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DomainError, type PgPool, type SyntheticTaskLease } from "@wenmi-rebuild/backend";
import { createSyntheticTaskTestContext, delay, testScope, truncateSyntheticTasks, type SyntheticTaskTestContext } from "./helpers/synthetic-task-test-context.js";

let context: SyntheticTaskTestContext;
const rebuildRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("real PostgreSQL synthetic task recovery repository", () => {
  beforeAll(async () => {
    context = await createSyntheticTaskTestContext();
  });

  beforeEach(async () => {
    await truncateSyntheticTasks(context.migratorPool);
  });

  afterAll(async () => {
    await context?.appPool.end();
    await context?.migratorPool.end();
  });

  it("deduplicates the same scoped request and rejects content or execution-contract conflicts", async () => {
    const scope = testScope(randomUUID());
    const first = await context.service.enqueue({ scope, idempotencyKey: "same", payload: { b: 2, a: 1 }, maxAttempts: 2 });
    const second = await context.service.enqueue({ scope, idempotencyKey: "same", payload: { a: 1, b: 2 }, maxAttempts: 2 });
    expect(second.id).toBe(first.id);

    await expect(
      context.service.enqueue({ scope, idempotencyKey: "same", payload: { a: 1, b: 2 }, maxAttempts: 3 })
    ).rejects.toMatchObject({ code: "TASK_IDEMPOTENCY_CONFLICT" });
    await expect(context.service.cancelTask(testScope("other"), first.id)).rejects.toMatchObject({ code: "TASK_SCOPE_DENIED" });
  });

  it("claims queued work with SKIP LOCKED and fences out stale lease holders", async () => {
    const scope = testScope(randomUUID());
    const tasks = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        context.service.enqueue({ scope, idempotencyKey: `claim-${index}`, payload: { index }, maxAttempts: 3 })
      )
    );
    const claimed = await Promise.all(
      Array.from({ length: 6 }, (_, index) => context.service.claimNext(`worker-${index}`, 1_000))
    );
    expect(new Set(claimed.map((task) => task?.id).filter(Boolean))).toHaveLength(6);
    for (const task of claimed) {
      expect(task?.leaseToken).toBe(1n);
      await context.service.completeTask(leaseFromClaim(task), { ok: task?.id });
    }
    const rows = await context.appPool.query("SELECT status, count(*)::int FROM synthetic_tasks GROUP BY status");
    expect(rows.rows).toEqual([{ status: "completed", count: tasks.length }]);
  });

  it("uses database time after row locks and rejects old fencing tokens after lease expiry", async () => {
    const scope = testScope(randomUUID());
    await context.service.enqueue({ scope, idempotencyKey: "lease", payload: { task: "lease" }, maxAttempts: 3 });
    const first = await context.service.claimNext("worker-a", 250);
    if (!first) {
      throw new Error("expected first claim");
    }
    await delay(320);
    const second = await context.service.claimNext("worker-b", 1_000);
    if (!second) {
      throw new Error("expected second claim after expiry");
    }
    expect(second.leaseToken).toBe(2n);
    await expect(context.service.saveCheckpoint(leaseFromClaim(first), { stale: true })).rejects.toMatchObject({
      code: "TASK_LEASE_INVALID"
    });
    const saved = await context.service.saveCheckpoint(leaseFromClaim(second), { live: true });
    expect(saved.checkpoint).toEqual({ live: true });
    const jsonNull = await context.service.saveCheckpoint(leaseFromClaim(second), null);
    expect(jsonNull.checkpoint).toBeNull();
  });

  it("moves an expired inflight external call to waiting check and does not blindly redispatch it", async () => {
    const scope = testScope(randomUUID());
    await context.service.enqueue({ scope, idempotencyKey: "external", payload: { task: "external" }, maxAttempts: 3 });
    const first = await context.service.claimNext("worker-a", 250);
    if (!first) {
      throw new Error("expected claim");
    }
    const call = await context.service.recordExternalCallStarted(leaseFromClaim(first), "call");
    expect(call.canDispatch).toBe(true);
    const duplicate = await context.service.recordExternalCallStarted(leaseFromClaim(first), "call");
    expect(duplicate).toEqual({ callId: call.callId, canDispatch: false });
    await expect(context.service.recordExternalCallStarted(leaseFromClaim(first), "other-call")).rejects.toMatchObject({
      code: "TASK_EXTERNAL_CHECK_REQUIRED"
    });

    await delay(320);
    expect(await context.service.claimNext("worker-b", 1_000)).toBeNull();
    const waiting = await context.service.getTask(scope, first.id);
    expect(waiting?.status).toBe("waiting_external_check");
    expect(await context.service.claimNext("worker-c", 1_000)).toBeNull();

    const queued = await context.service.resolveUnknownExternalCall({
      scope,
      taskId: first.id,
      callId: call.callId,
      resolution: { kind: "not-started", retry: true }
    });
    expect(queued.status).toBe("queued");
    const second = await context.service.claimNext("worker-d", 1_000);
    if (!second) {
      throw new Error("expected retry claim");
    }
    const retryCall = await context.service.recordExternalCallStarted(leaseFromClaim(second), "call");
    expect(retryCall.callId).not.toBe(call.callId);
    expect(retryCall.canDispatch).toBe(true);
    const completed = await context.service.completeTask(leaseFromClaim(second), { ok: true });
    expect(completed.status).toBe("completed");
  });

  it("keeps a canceled waiting task canceled even when external check confirms a result", async () => {
    const scope = testScope(randomUUID());
    const task = await context.service.enqueue({ scope, idempotencyKey: "cancel-waiting", payload: { task: "cancel-waiting" }, maxAttempts: 2 });
    const claimed = await context.service.claimNext("worker-a", 250);
    if (!claimed) {
      throw new Error("expected claim");
    }
    const call = await context.service.recordExternalCallStarted(leaseFromClaim(claimed), "call");
    await delay(320);
    await context.service.claimNext("worker-b", 1_000);
    const cancelRequested = await context.service.cancelTask(scope, task.id);
    expect(cancelRequested.status).toBe("waiting_external_check");
    const resolved = await context.service.resolveUnknownExternalCall({
      scope,
      taskId: task.id,
      callId: call.callId,
      resolution: { kind: "completed", result: { late: true } }
    });
    expect(resolved.status).toBe("canceled");
    expect(resolved.result).toBeNull();
    const external = await context.appPool.query("SELECT status, result_payload FROM synthetic_external_calls WHERE id = $1", [call.callId]);
    expect(external.rows[0]).toMatchObject({ status: "completed", result_payload: { late: true } });
  });

  it("preserves external check state on failure and cancellation races", async () => {
    const scope = testScope(randomUUID());
    const task = await context.service.enqueue({ scope, idempotencyKey: "cancel", payload: { task: "cancel" }, maxAttempts: 2 });
    const claimed = await context.service.claimNext("worker-a", 1_000);
    if (!claimed) {
      throw new Error("expected claim");
    }
    const call = await context.service.recordExternalCallStarted(leaseFromClaim(claimed), "call");
    const canceled = await context.service.cancelTask(scope, task.id);
    expect(canceled.status).toBe("running");
    await expect(context.service.saveCheckpoint(leaseFromClaim(claimed), { late: true })).rejects.toMatchObject({
      code: "TASK_LEASE_INVALID"
    });
    const finalTask = await context.service.completeTask(leaseFromClaim(claimed), { lateResult: true });
    expect(finalTask.status).toBe("canceled");
    const external = await context.appPool.query("SELECT status FROM synthetic_external_calls WHERE id = $1", [call.callId]);
    expect(external.rows[0]?.status).toBe("completed");
  });

  it("commits task result and event atomically", async () => {
    const scope = testScope(randomUUID());
    await context.service.enqueue({ scope, idempotencyKey: "rollback", payload: { task: "rollback" }, maxAttempts: 1 });
    const claimed = await context.service.claimNext("worker-a", 1_000);
    if (!claimed) {
      throw new Error("expected claim");
    }
    await installEventFailureTrigger(context.migratorPool, "task.completed");
    try {
      await expect(context.service.completeTask(leaseFromClaim(claimed), { text: "clock_timestamp() + interval '1 hour'" }))
        .rejects.toThrow(/forced synthetic event failure/);
    } finally {
      await dropEventFailureTrigger(context.migratorPool);
    }
    const task = await context.service.getTask(scope, claimed.id);
    expect(task?.status).toBe("running");
    expect(task?.result).toBeNull();
  });

  it("replays scoped task events by monotonic per-task revision cursor", async () => {
    const scope = testScope(randomUUID());
    const task = await context.service.enqueue({ scope, idempotencyKey: "events", payload: { task: "events" }, maxAttempts: 1 });
    const claimed = await context.service.claimNext("worker-a", 1_000);
    if (!claimed) {
      throw new Error("expected claim");
    }
    const saved = await context.service.saveCheckpoint(leaseFromClaim(claimed), { one: true });
    const events = await context.service.listEvents({ scope, taskId: task.id, afterRevision: 0n, limit: 10 });
    expect(events.map((event) => event.revision.toString())).toEqual(["1", "2", "3"]);
    expect(events.map((event) => event.eventType)).toEqual(["task.enqueued", "task.claimed", "task.checkpoint_saved"]);
    const after = await context.service.listEvents({ scope, taskId: task.id, afterRevision: saved.revision, limit: 10 });
    expect(after).toEqual([]);
    expect(() => context.service.listEvents({ scope, taskId: task.id, afterRevision: -1n })).toThrow(DomainError);
  });

  it("recovers from a real worker process crash after a deterministic checkpoint", async () => {
    const scope = testScope(randomUUID());
    const task = await context.service.enqueue({ scope, idempotencyKey: "worker-checkpoint", payload: { task: "worker" }, maxAttempts: 3 });

    await expect(
      runWorkerProcess(context.appEnv, {
        WENMI_REBUILD_SYNTHETIC_LEASE_MS: "250",
        WENMI_REBUILD_SYNTHETIC_CRASH_AFTER_CHECKPOINT: "1"
      })
    ).resolves.toBe(74);

    const afterCrash = await context.service.getTask(scope, task.id);
    expect(afterCrash?.status).toBe("running");
    expect(afterCrash?.checkpoint).toMatchObject({ prepared: true });

    await delay(320);
    await expect(runWorkerProcess(context.appEnv, { WENMI_REBUILD_SYNTHETIC_LEASE_MS: "1000" })).resolves.toBe(0);
    const recovered = await context.service.getTask(scope, task.id);
    expect(recovered?.status).toBe("completed");
    expect(recovered?.attempts).toBe(2);
    expect(recovered?.result).toMatchObject({ kind: "synthetic-result" });
  }, 30_000);

  it("lets two real worker processes race for one task with one effective result", async () => {
    const scope = testScope(randomUUID());
    const task = await context.service.enqueue({ scope, idempotencyKey: "worker-race", payload: { task: "race" }, maxAttempts: 3 });

    await expect(Promise.all([
      runWorkerProcess(context.appEnv, { WENMI_REBUILD_SYNTHETIC_LEASE_MS: "1000" }),
      runWorkerProcess(context.appEnv, { WENMI_REBUILD_SYNTHETIC_LEASE_MS: "1000" })
    ])).resolves.toEqual([0, 0]);

    const completed = await context.service.getTask(scope, task.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.attempts).toBe(1);
    const calls = await context.appPool.query("SELECT count(*)::int AS count FROM synthetic_external_calls WHERE task_id = $1", [task.id]);
    expect(calls.rows[0]?.count).toBe(1);
  }, 30_000);

  it("stops a real worker process after an unknown external call instead of dispatching again", async () => {
    const scope = testScope(randomUUID());
    const task = await context.service.enqueue({ scope, idempotencyKey: "worker-external", payload: { task: "external" }, maxAttempts: 3 });

    await expect(
      runWorkerProcess(context.appEnv, {
        WENMI_REBUILD_SYNTHETIC_LEASE_MS: "250",
        WENMI_REBUILD_SYNTHETIC_CRASH_AFTER_EXTERNAL_START: "1"
      })
    ).resolves.toBe(75);

    await delay(320);
    await expect(runWorkerProcess(context.appEnv, { WENMI_REBUILD_SYNTHETIC_LEASE_MS: "1000" })).resolves.toBe(0);
    const waiting = await context.service.getTask(scope, task.id);
    expect(waiting?.status).toBe("waiting_external_check");
    const calls = await context.appPool.query("SELECT id, status FROM synthetic_external_calls WHERE task_id = $1", [task.id]);
    expect(calls.rowCount).toBe(1);
    expect(calls.rows[0]?.status).toBe("unknown");

    const confirmed = await context.service.resolveUnknownExternalCall({
      scope,
      taskId: task.id,
      callId: calls.rows[0]?.id as string,
      resolution: { kind: "completed", result: { checked: true } }
    });
    expect(confirmed.status).toBe("completed");
    expect(confirmed.result).toEqual({ checked: true });
  }, 30_000);
});

function leaseFromClaim(task: NonNullable<Awaited<ReturnType<SyntheticTaskTestContext["service"]["claimNext"]>>>): SyntheticTaskLease {
  return {
    taskId: task.id,
    ownerId: task.scope.ownerId,
    bookId: task.scope.bookId,
    leaseToken: task.leaseToken,
    workerId: task.leaseOwner
  };
}

async function installEventFailureTrigger(pool: PgPool, eventType: string): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION synthetic_task_event_failure_for_test()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.event_type = '${eventType}' THEN
        RAISE EXCEPTION 'forced synthetic event failure';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  await pool.query(`
    CREATE TRIGGER synthetic_task_event_failure_for_test
    BEFORE INSERT ON synthetic_task_events
    FOR EACH ROW EXECUTE FUNCTION synthetic_task_event_failure_for_test();
  `);
}

async function dropEventFailureTrigger(pool: PgPool): Promise<void> {
  await pool.query("DROP TRIGGER IF EXISTS synthetic_task_event_failure_for_test ON synthetic_task_events");
  await pool.query("DROP FUNCTION IF EXISTS synthetic_task_event_failure_for_test()");
}

function runWorkerProcess(baseEnv: NodeJS.ProcessEnv, extraEnv: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(rebuildRoot, "apps", "worker", "dist", "main.js")],
      {
        cwd: rebuildRoot,
        env: {
          ...baseEnv,
          ...extraEnv,
          WENMI_REBUILD_WORKER_ONCE: "1",
          WENMI_REBUILD_WORKER_SYNTHETIC: "1",
          WENMI_REBUILD_WORKER_ID: `worker-process-${randomUUID()}`
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );
    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`worker timed out: ${output}`));
    }, 20_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === null) {
        reject(new Error(`worker exited without code: ${output}`));
        return;
      }
      resolve(code);
    });
  });
}
