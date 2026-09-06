import { randomUUID } from "node:crypto";
import { DomainError } from "../../domain/errors.js";
import { hashSyntheticTaskPayload as hash, normalizeSyntheticJson as json } from "../../domain/synthetic-tasks/index.js";
import type { SyntheticJsonValue } from "../../domain/synthetic-tasks/index.js";
import { withTransaction, type PgClient, type PgPool } from "../../infrastructure/postgres/client.js";
import type { AccountCoreService } from "../accounts/index.js";
import { createUsageCoreService } from "../usage/index.js";

export interface OpeningTask {
  task_id: string; owner_id: string; command_key: string; request_hash: string;
  request: SyntheticJsonValue; reservation_id: string;
  status: "queued" | "running" | "reconciling" | "awaiting_author" | "failed" | "cancelled";
  total_tokens: string; input_tokens: string; output_tokens: string;
  max_attempts: number; attempts: number; deadline: Date; retry_at: Date;
  worker_id: string | null; lease_token: number; lease_until: Date | null;
  active_call_id: string | null; cancel_requested: boolean; checkpoint: SyntheticJsonValue;
}
export interface OpeningLease { taskId: string; ownerId: string; workerId: string; token: number }
export interface OpeningPolicy { totalTokens: number; maxAttempts: number; deadlineMs: number }
// Internal verified provider receipt. Neither this nor policy is accepted from an author HTTP body.
export interface OpeningCallReceipt {
  inputTokens: number; outputTokens: number; result: SyntheticJsonValue;
  outcome: "continue" | "ready" | "retry" | "failed" | "not_started";
  evidence?: string;
}

/** Internal orchestration only. Provider dispatch happens outside these transactions. */
export class OpeningTaskService {
  private readonly usage;
  constructor(private readonly pool: PgPool, private readonly accounts: AccountCoreService) {
    this.usage = createUsageCoreService(pool);
  }

  async enqueue(sessionToken: string, commandKey: string, input: { idea: string; memberId?: string }, policy: OpeningPolicy): Promise<OpeningTask> {
    text(commandKey, 160); text(input.idea, 2000, 4);
    if (input.memberId !== undefined) text(input.memberId, 120);
    integer(policy.totalTokens, 1, 1_000_000); integer(policy.maxAttempts, 1, 10);
    integer(policy.deadlineMs, 1000, 86_400_000);
    const request = { idea: input.idea, memberId: input.memberId ?? null };
    const requestHash = hash({ request: json(request, "开书请求"), totalTokens: policy.totalTokens, maxAttempts: policy.maxAttempts, deadlineMs: policy.deadlineMs });
    return this.accounts.withAuthenticatedSessionTransaction(sessionToken, async (client, session) => {
      const ownerId = session.account.ownerId;
      await this.lockOwner(client, ownerId);
      const existing = (await client.query<OpeningTask>("SELECT * FROM opening_tasks WHERE owner_id=$1 AND command_key=$2", [ownerId, commandKey])).rows[0];
      if (existing) {
        if (existing.request_hash !== requestHash) throw new DomainError("TASK_IDEMPOTENCY_CONFLICT", "该提交编号已用于不同的开书请求。");
        return existing;
      }
      const taskId = randomUUID();
      const reservation = await this.usage.reserveFromAuthenticatedSessionTransaction(client, session, {
        operationKind: "prebook_opening", operationId: taskId, idempotencyKey: `opening:${taskId}`,
        request, reservedTokens: policy.totalTokens
      });
      return (await client.query<OpeningTask>(`INSERT INTO opening_tasks
        (task_id,owner_id,command_key,request_hash,request,reservation_id,status,total_tokens,max_attempts,deadline)
        VALUES ($1,$2,$3,$4,$5,$6,'queued',$7,$8,clock_timestamp()+$9*interval '1 millisecond') RETURNING *`,
        [taskId, ownerId, commandKey, requestHash, request, reservation.reservationId, policy.totalTokens, policy.maxAttempts, policy.deadlineMs])).rows[0]!;
    });
  }

  async get(sessionToken: string, taskId: string): Promise<OpeningTask> {
    return this.accounts.withAuthenticatedSessionTransaction(sessionToken, (client, session) => this.task(client, taskId, session.account.ownerId));
  }

  async cancel(sessionToken: string, taskId: string): Promise<OpeningTask> {
    return this.accounts.withAuthenticatedSessionTransaction(sessionToken, async (client, session) => {
      await this.lockOwner(client, session.account.ownerId);
      const task = await this.task(client, taskId, session.account.ownerId);
      if (terminal(task)) return task;
      task.cancel_requested = true;
      await client.query("UPDATE opening_tasks SET cancel_requested=true WHERE task_id=$1", [taskId]);
      if (task.active_call_id) return this.unknown(client, task);
      return this.close(client, task, "cancelled");
    });
  }

  // Scheduler supplies task IDs. Any process can resume a queued/expired task; no process-local state.
  async claim(taskId: string, ownerId: string, workerId: string, leaseMs = 30_000): Promise<OpeningTask> {
    text(workerId, 120); integer(leaseMs, 100, 60_000);
    return this.transaction(taskId, ownerId, async (client, task) => {
      if (terminal(task) || task.status === "reconciling") return task;
      const now = await this.now(client);
      if (task.status === "running" && task.lease_until! > now) throw new DomainError("TASK_NOT_CLAIMABLE", "任务正在执行。");
      if (task.active_call_id) return this.unknown(client, task);
      if (task.cancel_requested) return this.close(client, task, "cancelled");
      if (task.deadline <= now || task.attempts >= task.max_attempts) return this.close(client, task, "failed");
      if (task.retry_at > now) throw new DomainError("TASK_NOT_CLAIMABLE", "任务等待重试。");
      return (await client.query<OpeningTask>(`UPDATE opening_tasks SET status='running', worker_id=$2,
        attempts=attempts+1,lease_token=lease_token+1,lease_until=clock_timestamp()+$3*interval '1 millisecond'
        WHERE task_id=$1 RETURNING *`, [taskId, workerId, leaseMs])).rows[0]!;
    });
  }

  async renew(lease: OpeningLease, leaseMs = 30_000): Promise<void> {
    integer(leaseMs, 100, 60_000);
    await this.transaction(lease.taskId, lease.ownerId, async (client, task) => {
      await this.assertLease(client, task, lease);
      await client.query("UPDATE opening_tasks SET lease_until=clock_timestamp()+$2*interval '1 millisecond' WHERE task_id=$1", [task.task_id, leaseMs]);
    });
  }

  async beginCall(lease: OpeningLease, step: string, provider: string, modelId: string, tokenLimit: number): Promise<string> {
    text(step, 80); text(provider, 80); text(modelId, 120); integer(tokenLimit, 1, 1_000_000);
    return this.transaction(lease.taskId, lease.ownerId, async (client, task) => {
      await this.assertLease(client, task, lease);
      if (task.active_call_id) throw new DomainError("TASK_EXTERNAL_CHECK_REQUIRED", "上次调用尚未核实，不能再次发送。");
      const saved = await client.query("SELECT call_id FROM opening_task_calls WHERE task_id=$1 AND step=$2 AND receipt->>'outcome' IN ('continue','ready')", [task.task_id, step]);
      if (saved.rows.length) throw new DomainError("TASK_IDEMPOTENCY_CONFLICT", "该步骤已有保存结果，请继续后续步骤。");
      if (Number(task.input_tokens) + Number(task.output_tokens) + tokenLimit > Number(task.total_tokens)) {
        throw new DomainError("USAGE_QUOTA_EXHAUSTED", "本次开书剩余预算不足，请保留已完成结果。");
      }
      const callId = randomUUID();
      await client.query("INSERT INTO opening_task_calls (call_id,task_id,step,provider,model_id,token_limit) VALUES ($1,$2,$3,$4,$5,$6)", [callId, task.task_id, step, provider, modelId, tokenLimit]);
      await client.query("UPDATE opening_tasks SET active_call_id=$2 WHERE task_id=$1", [task.task_id, callId]);
      return callId; // Durable dispatch intent. A crash after this point requires reconciliation.
    });
  }

  // May receive a late response after lease loss. It records evidence, never grants the old worker a new lease.
  async recordReceipt(taskId: string, ownerId: string, callId: string, receipt: OpeningCallReceipt): Promise<OpeningTask> {
    integer(receipt.inputTokens, 0, 1_000_000); integer(receipt.outputTokens, 0, 1_000_000);
    if (!["continue", "ready", "retry", "failed", "not_started"].includes(receipt.outcome)) throw new DomainError("TASK_REQUEST_INVALID", "调用结果类型不正确。");
    if (receipt.outcome === "not_started" && (receipt.inputTokens !== 0 || receipt.outputTokens !== 0)) throw new DomainError("TASK_REQUEST_INVALID", "未执行证据不能包含已消耗用量。");
    if (receipt.outcome === "not_started") text(receipt.evidence!, 500);
    const evidence = json(receipt, "调用结果");
    return this.transaction(taskId, ownerId, async (client, task) => {
      const call = (await client.query<{ step: string; receipt: SyntheticJsonValue | null }>("SELECT step,receipt FROM opening_task_calls WHERE task_id=$1 AND call_id=$2 FOR UPDATE", [taskId, callId])).rows[0];
      if (!call) throw new DomainError("TASK_SCOPE_DENIED", "调用不属于该开书任务。");
      if (call.receipt !== null) {
        if (hash(call.receipt) !== hash(evidence)) throw new DomainError("TASK_IDEMPOTENCY_CONFLICT", "该调用已有不同结果，需核对证据。");
        return task;
      }
      if (task.active_call_id !== callId) throw new DomainError("TASK_EXTERNAL_CHECK_REQUIRED", "调用状态需核对。");
      await client.query("UPDATE opening_task_calls SET receipt=$2 WHERE call_id=$1", [callId, evidence]);
      // Keep every receipt in calls; only successful steps become the resumable checkpoint.
      const checkpoint = ["continue", "ready"].includes(receipt.outcome) ? { step: call.step, result: receipt.result } : task.checkpoint;
      task = (await client.query<OpeningTask>(`UPDATE opening_tasks SET active_call_id=NULL,input_tokens=input_tokens+$2,
        output_tokens=output_tokens+$3,checkpoint=$4,worker_id=NULL,lease_until=NULL WHERE task_id=$1 RETURNING *`,
        [taskId, receipt.inputTokens, receipt.outputTokens, checkpoint])).rows[0]!;
      if (Number(task.input_tokens) + Number(task.output_tokens) > Number(task.total_tokens)) return this.close(client, task, "failed");
      if (task.cancel_requested) return this.close(client, task, "cancelled");
      if (receipt.outcome === "ready") return this.close(client, task, "awaiting_author");
      if (receipt.outcome === "failed" || task.deadline <= await this.now(client) || task.attempts >= task.max_attempts) return this.close(client, task, "failed");
      const delay = receipt.outcome === "continue" ? 0 : Math.min(30_000, 1000 * 2 ** task.attempts);
      return (await client.query<OpeningTask>("UPDATE opening_tasks SET status='queued',retry_at=clock_timestamp()+$2*interval '1 millisecond' WHERE task_id=$1 RETURNING *", [taskId, delay])).rows[0]!;
    }, true);
  }

  async failBeforeDispatch(lease: OpeningLease, retryable: boolean): Promise<OpeningTask> {
    return this.transaction(lease.taskId, lease.ownerId, async (client, task) => {
      await this.assertLease(client, task, lease);
      if (task.active_call_id) return this.unknown(client, task);
      if (!retryable || task.attempts >= task.max_attempts) return this.close(client, task, "failed");
      return (await client.query<OpeningTask>(`UPDATE opening_tasks SET status='queued',worker_id=NULL,lease_until=NULL,
        retry_at=clock_timestamp()+$2*interval '1 millisecond' WHERE task_id=$1 RETURNING *`, [task.task_id, Math.min(30_000, 1000 * 2 ** task.attempts)])).rows[0]!;
    });
  }

  private scope(task: OpeningTask) { return { ownerId: task.owner_id, reservationId: task.reservation_id, operationKind: "prebook_opening" as const, operationId: task.task_id }; }
  private async unknown(client: PgClient, task: OpeningTask) {
    await this.usage.markUnknownTransaction(client, this.scope(task));
    return (await client.query<OpeningTask>("UPDATE opening_tasks SET status='reconciling',worker_id=NULL,lease_until=NULL WHERE task_id=$1 RETURNING *", [task.task_id])).rows[0]!;
  }
  private async close(client: PgClient, task: OpeningTask, status: OpeningTask["status"]): Promise<OpeningTask> {
    const consumed = Number(task.input_tokens) + Number(task.output_tokens);
    const executed = await client.query("SELECT call_id FROM opening_task_calls WHERE task_id=$1 AND receipt IS NOT NULL AND receipt->>'outcome'<>'not_started' LIMIT 1", [task.task_id]);
    if (consumed > 0 || executed.rows.length > 0 || status === "awaiting_author") {
      const settled = await this.usage.settleTransaction(client, { ...this.scope(task), inputTokens: Number(task.input_tokens), outputTokens: Number(task.output_tokens) });
      if (settled.state === "unknown") status = "reconciling";
    } else {
      await this.usage.releaseTransaction(client, { ...this.scope(task), confirmedNotStarted: true, evidence: "开书任务结束：无已执行调用，已发送意图均有未执行回执。" });
    }
    return (await client.query<OpeningTask>("UPDATE opening_tasks SET status=$2,worker_id=NULL,lease_until=NULL WHERE task_id=$1 RETURNING *", [task.task_id, status])).rows[0]!;
  }
  private async task(client: PgClient, id: string, ownerId: string): Promise<OpeningTask> {
    const task = (await client.query<OpeningTask>("SELECT * FROM opening_tasks WHERE task_id=$1 AND owner_id=$2 FOR UPDATE", [id, ownerId])).rows[0];
    if (!task) throw new DomainError("TASK_SCOPE_DENIED", "开书任务不存在或不属于当前账号。");
    return task;
  }
  private async lockOwner(client: PgClient, ownerId: string, evidenceOnly = false) {
    const result = await client.query("SELECT owner_id FROM account_users WHERE owner_id=$1 AND (status='active' OR $2) FOR UPDATE", [ownerId, evidenceOnly]);
    if (!result.rows.length) throw new DomainError("ACCOUNT_DISABLED", "账号暂不可用。");
  }
  private async transaction<T>(id: string, ownerId: string, work: (client: PgClient, task: OpeningTask) => Promise<T>, evidenceOnly = false) {
    return withTransaction(this.pool, async client => { await this.lockOwner(client, ownerId, evidenceOnly); return work(client, await this.task(client, id, ownerId)); });
  }
  private async now(client: PgClient): Promise<Date> { return (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")).rows[0]!.now; }
  private async assertLease(client: PgClient, task: OpeningTask, lease: OpeningLease) {
    const now = await this.now(client);
    if (task.status !== "running" || task.cancel_requested || task.worker_id !== lease.workerId || task.lease_token !== lease.token || !task.lease_until || task.lease_until <= now || task.deadline <= now) {
      throw new DomainError("TASK_LEASE_INVALID", "任务执行权已失效，请读取已保存进度。");
    }
  }
}
function terminal(task: OpeningTask) { return ["awaiting_author", "failed", "cancelled"].includes(task.status); }
function text(value: string, max: number, min = 1) { if (typeof value !== "string" || value.trim().length < min || value.length > max) throw new DomainError("TASK_REQUEST_INVALID", "开书请求不正确。"); }
function integer(value: number, min: number, max: number) { if (!Number.isSafeInteger(value) || value < min || value > max) throw new DomainError("TASK_REQUEST_INVALID", "任务预算或次数不正确。"); }
