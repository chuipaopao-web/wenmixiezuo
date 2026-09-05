import { randomUUID } from "node:crypto";
import { DomainError } from "../../domain/errors.js";
import { hashSyntheticTaskPayload, normalizeSyntheticJson } from "../../domain/synthetic-tasks/index.js";
import type {
  ClaimedSyntheticTask,
  ExternalResolution,
  SyntheticTaskEvent,
  SyntheticTaskLease,
  SyntheticTaskRecord,
  SyntheticTaskRequest,
  SyntheticTaskScope
} from "../../domain/synthetic-tasks/index.js";

export interface SyntheticTaskRepository {
  enqueue(input: {
    readonly id: string;
    readonly scope: SyntheticTaskScope;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly payload: unknown;
    readonly maxAttempts: number;
  }): Promise<SyntheticTaskRecord>;
  claimNext(input: { readonly workerId: string; readonly leaseMs: number }): Promise<ClaimedSyntheticTask | null>;
  renewLease(lease: SyntheticTaskLease, leaseMs: number): Promise<ClaimedSyntheticTask>;
  saveCheckpoint(lease: SyntheticTaskLease, checkpoint: unknown): Promise<SyntheticTaskRecord>;
  recordExternalCallStarted(lease: SyntheticTaskLease, callKey: string): Promise<{ readonly callId: string; readonly canDispatch: boolean }>;
  completeTask(lease: SyntheticTaskLease, result: unknown): Promise<SyntheticTaskRecord>;
  failTask(lease: SyntheticTaskLease, error: unknown, retryable: boolean): Promise<SyntheticTaskRecord>;
  cancelTask(scope: SyntheticTaskScope, taskId: string): Promise<SyntheticTaskRecord>;
  resolveUnknownExternalCall(input: {
    readonly scope: SyntheticTaskScope;
    readonly taskId: string;
    readonly callId: string;
    readonly resolution: ExternalResolution;
  }): Promise<SyntheticTaskRecord>;
  listEvents(input: {
    readonly scope: SyntheticTaskScope;
    readonly taskId: string;
    readonly afterRevision?: bigint;
    readonly limit?: number;
  }): Promise<readonly SyntheticTaskEvent[]>;
  getTask(scope: SyntheticTaskScope, taskId: string): Promise<SyntheticTaskRecord | null>;
}

export interface SyntheticTaskService {
  enqueue(request: SyntheticTaskRequest): Promise<SyntheticTaskRecord>;
  claimNext(workerId: string, leaseMs: number): Promise<ClaimedSyntheticTask | null>;
  renewLease(lease: SyntheticTaskLease, leaseMs: number): Promise<ClaimedSyntheticTask>;
  saveCheckpoint(lease: SyntheticTaskLease, checkpoint: unknown): Promise<SyntheticTaskRecord>;
  recordExternalCallStarted(lease: SyntheticTaskLease, callKey: string): Promise<{ readonly callId: string; readonly canDispatch: boolean }>;
  completeTask(lease: SyntheticTaskLease, result: unknown): Promise<SyntheticTaskRecord>;
  failTask(lease: SyntheticTaskLease, error: unknown, retryable?: boolean): Promise<SyntheticTaskRecord>;
  cancelTask(scope: SyntheticTaskScope, taskId: string): Promise<SyntheticTaskRecord>;
  resolveUnknownExternalCall(input: {
    readonly scope: SyntheticTaskScope;
    readonly taskId: string;
    readonly callId: string;
    readonly resolution: ExternalResolution;
  }): Promise<SyntheticTaskRecord>;
  listEvents(input: {
    readonly scope: SyntheticTaskScope;
    readonly taskId: string;
    readonly afterRevision?: bigint;
    readonly limit?: number;
  }): Promise<readonly SyntheticTaskEvent[]>;
  getTask(scope: SyntheticTaskScope, taskId: string): Promise<SyntheticTaskRecord | null>;
}

export function createSyntheticTaskService(repository: SyntheticTaskRepository): SyntheticTaskService {
  return {
    enqueue(request) {
      assertScope(request.scope);
      if (!request.idempotencyKey.trim()) {
        throw new DomainError("TASK_REQUEST_INVALID", "合成任务幂等键不能为空。");
      }
      const maxAttempts = request.maxAttempts ?? 3;
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
        throw new DomainError("TASK_REQUEST_INVALID", "合成任务最大尝试次数必须在 1 到 10 之间。");
      }
      const payload = normalizeSyntheticJson(request.payload, "合成任务请求");
      return repository.enqueue({
        id: randomUUID(),
        scope: request.scope,
        idempotencyKey: request.idempotencyKey,
        requestHash: hashSyntheticTaskPayload({ maxAttempts, payload }),
        payload,
        maxAttempts
      });
    },
    claimNext(workerId, leaseMs) {
      assertWorkerLease(workerId, leaseMs);
      return repository.claimNext({ workerId, leaseMs });
    },
    renewLease(lease, leaseMs) {
      assertLease(lease);
      assertWorkerLease(lease.workerId, leaseMs);
      return repository.renewLease(lease, leaseMs);
    },
    saveCheckpoint(lease, checkpoint) {
      assertLease(lease);
      return repository.saveCheckpoint(lease, normalizeSyntheticJson(checkpoint, "合成任务检查点"));
    },
    recordExternalCallStarted(lease, callKey) {
      assertLease(lease);
      if (!callKey.trim()) {
        throw new DomainError("TASK_REQUEST_INVALID", "合成外部调用键不能为空。");
      }
      return repository.recordExternalCallStarted(lease, callKey);
    },
    completeTask(lease, result) {
      assertLease(lease);
      return repository.completeTask(lease, normalizeSyntheticJson(result, "合成任务结果"));
    },
    failTask(lease, error, retryable = false) {
      assertLease(lease);
      return repository.failTask(lease, normalizeSyntheticJson(error, "合成任务错误"), retryable);
    },
    cancelTask(scope, taskId) {
      assertScope(scope);
      return repository.cancelTask(scope, taskId);
    },
    resolveUnknownExternalCall(input) {
      assertScope(input.scope);
      if (input.resolution.kind === "completed") {
        const resolution = {
          ...input,
          resolution: {
            kind: "completed" as const,
            result: normalizeSyntheticJson(input.resolution.result, "合成外部核对结果")
          }
        };
        return repository.resolveUnknownExternalCall(resolution);
      }
      return repository.resolveUnknownExternalCall(input);
    },
    listEvents(input) {
      assertScope(input.scope);
      if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500)) {
        throw new DomainError("TASK_REQUEST_INVALID", "合成任务事件回放数量必须在 1 到 500 之间。");
      }
      if (input.afterRevision !== undefined && input.afterRevision < 0n) {
        throw new DomainError("TASK_REQUEST_INVALID", "合成任务事件游标无效。");
      }
      return repository.listEvents(input);
    },
    getTask(scope, taskId) {
      assertScope(scope);
      return repository.getTask(scope, taskId);
    }
  };
}

function assertScope(scope: SyntheticTaskScope): void {
  if (!scope.ownerId.trim() || !scope.bookId.trim()) {
    throw new DomainError("TASK_REQUEST_INVALID", "合成任务必须绑定 owner 和 book。");
  }
}

function assertLease(lease: SyntheticTaskLease): void {
  assertScope({ ownerId: lease.ownerId, bookId: lease.bookId });
  if (!lease.taskId.trim() || lease.leaseToken <= 0n || !lease.workerId.trim()) {
    throw new DomainError("TASK_REQUEST_INVALID", "合成任务租约无效。");
  }
}

function assertWorkerLease(workerId: string, leaseMs: number): void {
  if (!workerId.trim() || !Number.isInteger(leaseMs) || leaseMs < 100 || leaseMs > 60_000) {
    throw new DomainError("TASK_REQUEST_INVALID", "合成任务 Worker 或租约时长无效。");
  }
}
