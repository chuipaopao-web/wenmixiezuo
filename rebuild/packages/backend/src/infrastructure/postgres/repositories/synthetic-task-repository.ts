import { randomUUID } from "node:crypto";
import { DomainError } from "../../../domain/errors.js";
import type {
  ClaimedSyntheticTask,
  ExternalResolution,
  SyntheticJsonValue,
  SyntheticTaskEvent,
  SyntheticTaskLease,
  SyntheticTaskRecord,
  SyntheticTaskScope,
  SyntheticTaskStatus
} from "../../../domain/synthetic-tasks/index.js";
import type { SyntheticTaskRepository } from "../../../application/synthetic-tasks/index.js";
import { withTransaction, type PgClient, type PgPool } from "../client.js";

type TaskRow = {
  id: string;
  owner_id: string;
  book_id: string;
  idempotency_key: string;
  request_hash: string;
  status: SyntheticTaskStatus;
  attempts: number;
  max_attempts: number;
  lease_token: string;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  checkpoint: unknown;
  result_payload: unknown;
  error_payload: unknown;
  cancellation_requested_at: Date | null;
  revision: string;
};

type EventRow = {
  task_id: string;
  owner_id: string;
  book_id: string;
  revision: string;
  event_type: string;
  payload: unknown;
  occurred_at: Date;
};

const sqlExpressionBrand = Symbol("syntheticTaskSqlExpression");

type SqlExpression = {
  readonly [sqlExpressionBrand]: true;
  readonly sql: string;
};

export class PostgresSyntheticTaskRepository implements SyntheticTaskRepository {
  constructor(private readonly pool: PgPool) {}

  async enqueue(input: {
    readonly id: string;
    readonly scope: SyntheticTaskScope;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly payload: unknown;
    readonly maxAttempts: number;
  }): Promise<SyntheticTaskRecord> {
    return withTransaction(this.pool, async (client) => {
      const inserted = await client.query<TaskRow>(
        `INSERT INTO synthetic_tasks (
           id, owner_id, book_id, idempotency_key, request_hash, request_payload, status, max_attempts
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'queued', $7)
         ON CONFLICT (owner_id, book_id, idempotency_key) DO NOTHING
         RETURNING ${taskColumns()}`,
        [
          input.id,
          input.scope.ownerId,
          input.scope.bookId,
          input.idempotencyKey,
          input.requestHash,
          JSON.stringify(input.payload),
          input.maxAttempts
        ]
      );

      if (inserted.rows[0]) {
        const task = mapTask(inserted.rows[0]);
        await appendEvent(client, task, "task.enqueued", { idempotencyKey: input.idempotencyKey });
        return (await selectTaskForUpdate(client, input.scope, task.id)) ?? task;
      }

      const existing = await client.query<TaskRow>(
        `SELECT ${taskColumns()} FROM synthetic_tasks
         WHERE owner_id = $1 AND book_id = $2 AND idempotency_key = $3
         FOR UPDATE`,
        [input.scope.ownerId, input.scope.bookId, input.idempotencyKey]
      );
      const row = existing.rows[0];
      if (!row) {
        throw new DomainError("TASK_NOT_CLAIMABLE", "合成任务入队冲突后无法读取现有任务。", true);
      }
      if (row.request_hash !== input.requestHash) {
        throw new DomainError("TASK_IDEMPOTENCY_CONFLICT", "同一 owner/book 幂等键已绑定不同合成请求。");
      }
      return mapTask(row);
    });
  }

  async claimNext(input: { readonly workerId: string; readonly leaseMs: number }): Promise<ClaimedSyntheticTask | null> {
    return withTransaction(this.pool, async (client) => {
      const candidates = await client.query<TaskRow>(
        `SELECT ${taskColumns()} FROM synthetic_tasks
         WHERE status = 'queued'
            OR (status = 'running' AND lease_expires_at <= clock_timestamp())
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1`
      );
      const row = candidates.rows[0];
      if (!row) {
        return null;
      }
      const task = mapTask(row);

      if (task.status === "running") {
        const expired = await client.query<{ expired: boolean }>(
          "SELECT $1::timestamptz <= clock_timestamp() AS expired",
          [task.leaseExpiresAt]
        );
        if (!expired.rows[0]?.expired) {
          return null;
        }
        const inflight = await hasInflightExternalCall(client, task.id);
        if (inflight) {
          const waiting = await updateTask(client, task.id, {
            status: "waiting_external_check",
            lease_owner: null,
            lease_expires_at: null,
            updated_at: sqlExpression("clock_timestamp()")
          });
          await client.query(
            `UPDATE synthetic_external_calls
             SET status = 'unknown', updated_at = clock_timestamp()
             WHERE task_id = $1 AND status = 'inflight'`,
            [task.id]
          );
          await appendEvent(client, waiting, "task.external_result_unknown", {
            previousLeaseToken: task.leaseToken.toString()
          });
          return null;
        }
      }

      if (task.cancellationRequestedAt) {
        const canceled = await updateTask(client, task.id, {
          status: "canceled",
          lease_owner: null,
          lease_expires_at: null,
          completed_at: sqlExpression("clock_timestamp()"),
          updated_at: sqlExpression("clock_timestamp()")
        });
        await appendEvent(client, canceled, "task.canceled", { reason: "cancel-before-claim" });
        return null;
      }

      if (task.attempts >= task.maxAttempts) {
        const failed = await updateTask(client, task.id, {
          status: "failed",
          error_payload: { message: "合成任务已达到最大尝试次数。" },
          lease_owner: null,
          lease_expires_at: null,
          completed_at: sqlExpression("clock_timestamp()"),
          updated_at: sqlExpression("clock_timestamp()")
        });
        await appendEvent(client, failed, "task.failed", { reason: "max-attempts" });
        return null;
      }

      const claimed = await updateTask(client, task.id, {
        status: "running",
        attempts: task.attempts + 1,
        lease_token: task.leaseToken + 1n,
        lease_owner: input.workerId,
        lease_expires_at: sqlIntervalFromNow(input.leaseMs),
        updated_at: sqlExpression("clock_timestamp()")
      });
      const claimedWithEvent = await appendEvent(client, claimed, "task.claimed", {
        workerId: input.workerId,
        leaseToken: claimed.leaseToken.toString(),
        attempt: claimed.attempts
      });
      return asClaimed(claimedWithEvent);
    });
  }

  async renewLease(lease: SyntheticTaskLease, leaseMs: number): Promise<ClaimedSyntheticTask> {
    return this.withValidLease(lease, async (client, task) => {
      const renewed = await updateTask(client, task.id, {
        lease_expires_at: sqlIntervalFromNow(leaseMs),
        updated_at: sqlExpression("clock_timestamp()")
      });
      const renewedWithEvent = await appendEvent(client, renewed, "task.lease_renewed", {
        workerId: lease.workerId,
        leaseToken: lease.leaseToken.toString()
      });
      return asClaimed(renewedWithEvent);
    });
  }

  async saveCheckpoint(lease: SyntheticTaskLease, checkpoint: unknown): Promise<SyntheticTaskRecord> {
    return this.withValidLease(lease, async (client, task) => {
      const saved = await updateTask(client, task.id, {
        checkpoint,
        updated_at: sqlExpression("clock_timestamp()")
      });
      return appendEvent(client, saved, "task.checkpoint_saved", { checkpoint });
    });
  }

  async recordExternalCallStarted(lease: SyntheticTaskLease, callKey: string): Promise<{ readonly callId: string; readonly canDispatch: boolean }> {
    return this.withValidLease(lease, async (client, task) => {
      const unresolved = await client.query<{ id: string; call_key: string; lease_token: string; status: string }>(
        `SELECT id, call_key, lease_token, status
         FROM synthetic_external_calls
         WHERE task_id = $1 AND status IN ('inflight', 'unknown')
         FOR UPDATE`,
        [task.id]
      );
      for (const existingRow of unresolved.rows) {
        if (
          existingRow.call_key === callKey &&
          existingRow.lease_token === lease.leaseToken.toString() &&
          existingRow.status === "inflight"
        ) {
          return { callId: existingRow.id, canDispatch: false };
        }
        throw new DomainError("TASK_EXTERNAL_CHECK_REQUIRED", "合成任务已有未解决外部调用，必须先核对。");
      }

      const callId = randomUUID();
      await client.query(
        `INSERT INTO synthetic_external_calls (id, task_id, call_key, lease_token, status)
         VALUES ($1, $2, $3, $4, 'inflight')`,
        [callId, task.id, callKey, lease.leaseToken.toString()]
      );
      const current = await selectTaskForUpdate(client, lease, task.id);
      if (!current) {
        throw new DomainError("TASK_SCOPE_DENIED", "合成任务不存在或不属于当前范围。");
      }
      await appendEvent(client, current, "task.external_call_started", {
        callId,
        callKey,
        leaseToken: lease.leaseToken.toString()
      });
      return { callId, canDispatch: true };
    });
  }

  async completeTask(lease: SyntheticTaskLease, result: unknown): Promise<SyntheticTaskRecord> {
    return this.withValidLease(lease, async (client, task) => {
      if (task.cancellationRequestedAt) {
        await client.query(
          `UPDATE synthetic_external_calls
           SET status = 'completed', result_payload = $2::jsonb, updated_at = clock_timestamp()
           WHERE task_id = $1 AND lease_token = $3 AND status = 'inflight'`,
          [task.id, JSON.stringify(result), lease.leaseToken.toString()]
        );
        const canceled = await updateTask(client, task.id, {
          status: "canceled",
          lease_owner: null,
          lease_expires_at: null,
          completed_at: sqlExpression("clock_timestamp()"),
          updated_at: sqlExpression("clock_timestamp()")
        });
        return appendEvent(client, canceled, "task.canceled", { reason: "cancel-won-before-complete" });
      }
      await client.query(
        `UPDATE synthetic_external_calls
         SET status = 'completed', result_payload = $2::jsonb, updated_at = clock_timestamp()
         WHERE task_id = $1 AND lease_token = $3 AND status = 'inflight'`,
        [task.id, JSON.stringify(result), lease.leaseToken.toString()]
      );
      const completed = await updateTask(client, task.id, {
        status: "completed",
        result_payload: result,
        lease_owner: null,
        lease_expires_at: null,
        completed_at: sqlExpression("clock_timestamp()"),
        updated_at: sqlExpression("clock_timestamp()")
      });
      return appendEvent(client, completed, "task.completed", { result });
    }, { allowCanceledLease: true });
  }

  async failTask(lease: SyntheticTaskLease, error: unknown, retryable: boolean): Promise<SyntheticTaskRecord> {
    return this.withValidLease(lease, async (client, task) => {
      if (await hasInflightExternalCall(client, task.id)) {
        const waiting = await updateTask(client, task.id, {
          status: "waiting_external_check",
          error_payload: error,
          lease_owner: null,
          lease_expires_at: null,
          updated_at: sqlExpression("clock_timestamp()")
        });
        await client.query(
          `UPDATE synthetic_external_calls
           SET status = 'unknown', updated_at = clock_timestamp()
           WHERE task_id = $1 AND status = 'inflight'`,
          [task.id]
        );
        return appendEvent(client, waiting, "task.external_result_unknown", { error, retryable });
      }
      const willRetry = retryable && task.attempts < task.maxAttempts && !task.cancellationRequestedAt;
      const failed = await updateTask(client, task.id, {
        status: willRetry ? "queued" : task.cancellationRequestedAt ? "canceled" : "failed",
        error_payload: error,
        lease_owner: null,
        lease_expires_at: null,
        completed_at: willRetry ? null : sqlExpression("clock_timestamp()"),
        updated_at: sqlExpression("clock_timestamp()")
      });
      return appendEvent(client, failed, willRetry ? "task.retry_scheduled" : failed.status === "canceled" ? "task.canceled" : "task.failed", {
        error,
        retryable
      });
    }, { allowCanceledLease: true });
  }

  async cancelTask(scope: SyntheticTaskScope, taskId: string): Promise<SyntheticTaskRecord> {
    return withTransaction(this.pool, async (client) => {
      const task = await selectTaskForUpdate(client, scope, taskId);
      if (!task) {
        throw new DomainError("TASK_SCOPE_DENIED", "合成任务不存在或不属于当前范围。");
      }
      if (task.status === "completed" || task.status === "failed" || task.status === "canceled") {
        return task;
      }
      const cancelNow = task.status !== "running" && task.status !== "waiting_external_check";
      const canceled = await updateTask(client, task.id, {
        status: cancelNow ? "canceled" : task.status,
        cancellation_requested_at: task.cancellationRequestedAt ?? sqlExpression("clock_timestamp()"),
        lease_owner: cancelNow ? null : task.leaseOwner,
        lease_expires_at: cancelNow ? null : task.leaseExpiresAt,
        completed_at: cancelNow ? sqlExpression("clock_timestamp()") : null,
        updated_at: sqlExpression("clock_timestamp()")
      });
      return appendEvent(client, canceled, cancelNow ? "task.canceled" : "task.cancel_requested", {});
    });
  }

  async resolveUnknownExternalCall(input: {
    readonly scope: SyntheticTaskScope;
    readonly taskId: string;
    readonly callId: string;
    readonly resolution: ExternalResolution;
  }): Promise<SyntheticTaskRecord> {
    return withTransaction(this.pool, async (client) => {
      const task = await selectTaskForUpdate(client, input.scope, input.taskId);
      if (!task) {
        throw new DomainError("TASK_SCOPE_DENIED", "合成任务不存在或不属于当前范围。");
      }
      if (task.status !== "waiting_external_check") {
        throw new DomainError("TASK_EXTERNAL_CHECK_REQUIRED", "合成任务当前不在外部结果待核对状态。");
      }
      const call = await client.query<{ id: string; status: string }>(
        "SELECT id, status FROM synthetic_external_calls WHERE id = $1 AND task_id = $2 FOR UPDATE",
        [input.callId, input.taskId]
      );
      if (call.rowCount !== 1 || call.rows[0]?.status !== "unknown") {
        throw new DomainError("TASK_EXTERNAL_CHECK_REQUIRED", "合成外部调用记录不存在或状态不可核对。");
      }

      if (input.resolution.kind === "completed") {
        await client.query(
          `UPDATE synthetic_external_calls
           SET status = 'completed', result_payload = $2::jsonb, updated_at = clock_timestamp()
           WHERE id = $1`,
          [input.callId, JSON.stringify(input.resolution.result)]
        );
        const completed = await updateTask(client, task.id, {
          status: task.cancellationRequestedAt ? "canceled" : "completed",
          result_payload: task.cancellationRequestedAt ? null : input.resolution.result,
          lease_owner: null,
          lease_expires_at: null,
          completed_at: sqlExpression("clock_timestamp()"),
          updated_at: sqlExpression("clock_timestamp()")
        });
        return appendEvent(
          client,
          completed,
          task.cancellationRequestedAt ? "task.external_result_confirmed_after_cancel" : "task.external_result_confirmed",
          { callId: input.callId }
        );
      }

      await client.query(
        `UPDATE synthetic_external_calls
         SET status = 'confirmed_not_started', updated_at = clock_timestamp()
         WHERE id = $1`,
        [input.callId]
      );
      const shouldRetry = input.resolution.retry && task.attempts < task.maxAttempts && !task.cancellationRequestedAt;
      const updated = await updateTask(client, task.id, {
        status: shouldRetry ? "queued" : task.cancellationRequestedAt ? "canceled" : "failed",
        error_payload: shouldRetry ? task.error : { message: "外部调用未执行且不再重试。" },
        lease_owner: null,
        lease_expires_at: null,
        completed_at: shouldRetry ? null : sqlExpression("clock_timestamp()"),
        updated_at: sqlExpression("clock_timestamp()")
      });
      return appendEvent(client, updated, shouldRetry ? "task.external_not_started_retry_scheduled" : "task.external_not_started_closed", {
        callId: input.callId
      });
    });
  }

  async listEvents(input: {
    readonly scope: SyntheticTaskScope;
    readonly taskId: string;
    readonly afterRevision?: bigint;
    readonly limit?: number;
  }): Promise<readonly SyntheticTaskEvent[]> {
    const result = await this.pool.query<EventRow>(
      `SELECT task_id, owner_id, book_id, revision, event_type, payload, occurred_at
       FROM synthetic_task_events
       WHERE owner_id = $1 AND book_id = $2 AND task_id = $3 AND revision > $4
       ORDER BY revision
       LIMIT $5`,
      [input.scope.ownerId, input.scope.bookId, input.taskId, (input.afterRevision ?? 0n).toString(), input.limit ?? 100]
    );
    return result.rows.map(mapEvent);
  }

  async getTask(scope: SyntheticTaskScope, taskId: string): Promise<SyntheticTaskRecord | null> {
    const result = await this.pool.query<TaskRow>(
      `SELECT ${taskColumns()} FROM synthetic_tasks WHERE owner_id = $1 AND book_id = $2 AND id = $3`,
      [scope.ownerId, scope.bookId, taskId]
    );
    return result.rows[0] ? mapTask(result.rows[0]) : null;
  }

  private async withValidLease<T>(
    lease: SyntheticTaskLease,
    work: (client: PgClient, task: SyntheticTaskRecord) => Promise<T>,
    options: { readonly allowCanceledLease?: boolean } = {}
  ): Promise<T> {
    return withTransaction(this.pool, async (client) => {
      const task = await selectTaskForUpdate(client, lease, lease.taskId);
      if (!task) {
        throw new DomainError("TASK_SCOPE_DENIED", "合成任务不存在或不属于当前范围。");
      }
      if (
        task.status !== "running" ||
        task.leaseToken !== lease.leaseToken ||
        task.leaseOwner !== lease.workerId ||
        !task.leaseExpiresAt
      ) {
        throw new DomainError("TASK_LEASE_INVALID", "合成任务租约围栏已失效。", true);
      }
      const leaseLive = await client.query<{ live: boolean }>(
        "SELECT $1::timestamptz > clock_timestamp() AS live",
        [task.leaseExpiresAt]
      );
      if (!leaseLive.rows[0]?.live) {
        throw new DomainError("TASK_LEASE_INVALID", "合成任务租约已过期。", true);
      }
      if (task.cancellationRequestedAt && !options.allowCanceledLease) {
        throw new DomainError("TASK_LEASE_INVALID", "合成任务已收到取消请求，当前租约不能继续工作。", true);
      }
      return work(client, task);
    });
  }
}

async function hasInflightExternalCall(client: PgClient, taskId: string): Promise<boolean> {
  const result = await client.query("SELECT 1 FROM synthetic_external_calls WHERE task_id = $1 AND status = 'inflight' LIMIT 1", [
    taskId
  ]);
  return result.rowCount === 1;
}

async function selectTaskForUpdate(client: PgClient, scope: SyntheticTaskScope, taskId: string): Promise<SyntheticTaskRecord | null> {
  const result = await client.query<TaskRow>(
    `SELECT ${taskColumns()} FROM synthetic_tasks WHERE owner_id = $1 AND book_id = $2 AND id = $3 FOR UPDATE`,
    [scope.ownerId, scope.bookId, taskId]
  );
  return result.rows[0] ? mapTask(result.rows[0]) : null;
}

async function updateTask(
  client: PgClient,
  taskId: string,
  values: Record<string, unknown | SqlExpression>
): Promise<SyntheticTaskRecord> {
  const assignments: string[] = [];
  const params: unknown[] = [taskId];
  for (const [column, value] of Object.entries(values)) {
    if (column.endsWith("_payload") || column === "checkpoint") {
      params.push(JSON.stringify(value));
      assignments.push(`${column} = $${params.length}::jsonb`);
    } else if (value === null) {
      assignments.push(`${column} = NULL`);
    } else if (isSqlExpression(value)) {
      assignments.push(`${column} = ${value.sql}`);
    } else if (typeof value === "bigint") {
      params.push(value.toString());
      assignments.push(`${column} = $${params.length}`);
    } else {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    }
  }
  const result = await client.query<TaskRow>(
    `UPDATE synthetic_tasks
     SET ${assignments.join(", ")}
     WHERE id = $1
     RETURNING ${taskColumns()}`,
    params
  );
  const row = result.rows[0];
  if (!row) {
    throw new DomainError("TASK_NOT_CLAIMABLE", "合成任务更新失败。", true);
  }
  return mapTask(row);
}

async function appendEvent(
  client: PgClient,
  task: SyntheticTaskRecord,
  eventType: string,
  payload: unknown
): Promise<SyntheticTaskRecord> {
  const updated = await client.query<TaskRow>(
    `UPDATE synthetic_tasks
     SET revision = revision + 1, updated_at = clock_timestamp()
     WHERE id = $1
     RETURNING ${taskColumns()}`,
    [task.id]
  );
  const row = updated.rows[0];
  if (!row) {
    throw new DomainError("TASK_NOT_CLAIMABLE", "合成任务事件版本更新失败。", true);
  }
  await client.query(
    `INSERT INTO synthetic_task_events (task_id, owner_id, book_id, revision, event_type, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [task.id, task.scope.ownerId, task.scope.bookId, row.revision, eventType, JSON.stringify(payload)]
  );
  return mapTask(row);
}

function taskColumns(): string {
  return `id, owner_id, book_id, idempotency_key, request_hash, status, attempts, max_attempts,
    lease_token, lease_owner, lease_expires_at, checkpoint, result_payload, error_payload,
    cancellation_requested_at, revision`;
}

function mapTask(row: TaskRow): SyntheticTaskRecord {
  return {
    id: row.id,
    scope: { ownerId: row.owner_id, bookId: row.book_id },
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    leaseToken: BigInt(row.lease_token),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    checkpoint: row.checkpoint as SyntheticJsonValue,
    result: row.result_payload as SyntheticJsonValue | null,
    error: row.error_payload as SyntheticJsonValue | null,
    cancellationRequestedAt: row.cancellation_requested_at,
    revision: BigInt(row.revision)
  };
}

function mapEvent(row: EventRow): SyntheticTaskEvent {
  return {
    taskId: row.task_id,
    ownerId: row.owner_id,
    bookId: row.book_id,
    revision: BigInt(row.revision),
    eventType: row.event_type,
    payload: row.payload as SyntheticJsonValue,
    occurredAt: row.occurred_at
  };
}

function asClaimed(task: SyntheticTaskRecord): ClaimedSyntheticTask {
  if (!task.leaseOwner || !task.leaseExpiresAt) {
    throw new DomainError("TASK_LEASE_INVALID", "合成任务领取后缺少租约。", true);
  }
  return {
    ...task,
    leaseOwner: task.leaseOwner,
    leaseExpiresAt: task.leaseExpiresAt
  };
}

function sqlExpression(sql: string): SqlExpression {
  return { [sqlExpressionBrand]: true, sql };
}

function isSqlExpression(value: unknown): value is SqlExpression {
  return Boolean(value && typeof value === "object" && (value as { [sqlExpressionBrand]?: true })[sqlExpressionBrand]);
}

function sqlIntervalFromNow(ms: number): SqlExpression {
  return sqlExpression(`clock_timestamp() + interval '${ms} milliseconds'`);
}
