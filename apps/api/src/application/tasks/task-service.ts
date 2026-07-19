import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { EventStore } from '../events/event-store.js';

export type TaskStatus = 'pending' | 'queued' | 'working' | 'waiting_confirmation' | 'paused' | 'blocked' | 'interrupted' | 'failed' | 'cancelled' | 'succeeded';

export interface TaskRecord {
  taskId: string;
  ownerId: string;
  bookId: string;
  chapterId: string | null;
  taskType: string;
  assignedAgentId: string | null;
  status: TaskStatus;
  currentPhase: string;
  idempotencyKey: string;
  budgetId: string | null;
  requiredEditorEpoch: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  checkpoint: Record<string, unknown>;
  brief: Record<string, unknown>;
  pauseRequested: boolean;
  cancelRequested: boolean;
  attemptCount: number;
}

interface TaskRow {
  task_id: string;
  owner_id: string;
  book_id: string;
  chapter_id: string | null;
  task_type: string;
  assigned_agent_id: string | null;
  status: TaskStatus;
  current_phase: string;
  idempotency_key: string;
  budget_id: string | null;
  required_editor_epoch: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  checkpoint_json: string;
  task_brief_json: string;
  pause_requested: number;
  cancel_requested: number;
  attempt_count: number;
}

export interface CreateTaskInput {
  taskId: string;
  taskType: string;
  assignedAgentId?: string | null;
  chapterId?: string | null;
  idempotencyKey: string;
  budgetId?: string | null;
  requiredEditorEpoch?: number;
  initialPhase: string;
  brief: Record<string, unknown>;
}

export class TaskService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly releaseId: string,
    private readonly clock: Clock,
    private readonly events?: EventStore
  ) {}

  public create(scope: BookScope, input: CreateTaskInput): TaskRecord {
    assertBookScope(scope);
    const existing = this.database.prepare(`
      SELECT * FROM tasks WHERE owner_id = ? AND book_id = ? AND idempotency_key = ?
    `).get(scope.ownerId, scope.bookId, input.idempotencyKey) as TaskRow | undefined;
    if (existing !== undefined) return mapTask(existing);
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      INSERT INTO tasks (
        task_id, release_id, owner_id, book_id, chapter_id, task_type, assigned_agent_id,
        task_brief_json, status, current_phase, idempotency_key, budget_id,
        required_editor_epoch, checkpoint_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, '{}', ?, ?)
    `).run(
      input.taskId, this.releaseId, scope.ownerId, scope.bookId, input.chapterId ?? null,
      input.taskType, input.assignedAgentId ?? null, JSON.stringify(input.brief), input.initialPhase,
      input.idempotencyKey, input.budgetId ?? null, input.requiredEditorEpoch ?? 0, now, now
    );
    const task = this.require(scope, input.taskId);
    this.events?.append(scope, 'task.created', { taskId: task.taskId, taskType: task.taskType });
    return task;
  }

  public addDependency(scope: BookScope, taskId: string, dependsOnTaskId: string): void {
    const task = this.require(scope, taskId);
    const dependency = this.require(scope, dependsOnTaskId);
    if (task.taskId === dependency.taskId) throw new Error('任务不能依赖自己');
    this.database.prepare(`
      INSERT INTO task_dependencies (task_id, depends_on_task_id, owner_id, book_id)
      VALUES (?, ?, ?, ?) ON CONFLICT(task_id, depends_on_task_id) DO NOTHING
    `).run(taskId, dependsOnTaskId, scope.ownerId, scope.bookId);
  }

  public queue(scope: BookScope, taskId: string): TaskRecord {
    this.require(scope, taskId);
    const now = this.clock.now().toISOString();
    const result = this.database.prepare(`
      UPDATE tasks SET status = 'queued', updated_at = ?
      WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status IN ('pending', 'paused')
    `).run(now, taskId, scope.ownerId, scope.bookId);
    if (result.changes !== 1) throw new DomainError(errorCodes.taskAlreadyRunning, '任务当前状态不能入队', {}, false, 409);
    this.events?.append(scope, 'task.phase.changed', { taskId, status: 'queued' });
    return this.require(scope, taskId);
  }

  public claimNext(workerId: string, leaseMs = 15_000): TaskRecord | null {
    const nowDate = this.clock.now();
    const now = nowDate.toISOString();
    const leaseExpiresAt = new Date(nowDate.getTime() + leaseMs).toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const active = this.database.prepare(`
        SELECT 1 FROM tasks WHERE status = 'working' AND lease_expires_at > ? LIMIT 1
      `).get(now);
      if (active !== undefined) {
        this.database.exec('COMMIT');
        return null;
      }
      const row = this.database.prepare(`
        SELECT t.* FROM tasks t
        WHERE t.status = 'queued' AND t.cancel_requested = 0
          AND NOT EXISTS (
            SELECT 1 FROM task_dependencies d
            JOIN tasks dependency ON dependency.task_id = d.depends_on_task_id
            WHERE d.task_id = t.task_id AND dependency.status <> 'succeeded'
          )
        ORDER BY t.created_at, t.task_id LIMIT 1
      `).get() as TaskRow | undefined;
      if (row === undefined) {
        this.database.exec('COMMIT');
        return null;
      }
      this.database.prepare(`
        UPDATE tasks SET status = 'working', lease_owner = ?, lease_expires_at = ?,
          heartbeat_at = ?, attempt_count = attempt_count + 1, updated_at = ?
        WHERE task_id = ? AND status = 'queued'
      `).run(workerId, leaseExpiresAt, now, now, row.task_id);
      this.database.prepare(`
        INSERT INTO task_phases (
          task_id, owner_id, book_id, phase_key, status, input_version_json,
          checkpoint_json, artifact_json, entered_at, heartbeat_at
        ) VALUES (?, ?, ?, ?, 'working', '{}', ?, '{}', ?, ?)
        ON CONFLICT(task_id, phase_key) DO UPDATE SET
          status = 'working', checkpoint_json = excluded.checkpoint_json,
          heartbeat_at = excluded.heartbeat_at
      `).run(row.task_id, row.owner_id, row.book_id, row.current_phase, row.checkpoint_json, now, now);
      this.database.exec('COMMIT');
      const claimed = this.require({ ownerId: row.owner_id, bookId: row.book_id }, row.task_id);
      this.events?.append({ ownerId: row.owner_id, bookId: row.book_id }, 'task.phase.changed', { taskId: row.task_id, status: 'working', phase: row.current_phase });
      return claimed;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public heartbeat(scope: BookScope, taskId: string, workerId: string, leaseMs = 15_000): TaskRecord {
    const nowDate = this.clock.now();
    const result = this.database.prepare(`
      UPDATE tasks SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
      WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'working' AND lease_owner = ?
    `).run(
      nowDate.toISOString(), new Date(nowDate.getTime() + leaseMs).toISOString(), nowDate.toISOString(),
      taskId, scope.ownerId, scope.bookId, workerId
    );
    if (result.changes !== 1) throw new Error('任务租约不存在、已过期或不属于当前Worker');
    return this.require(scope, taskId);
  }

  public checkpoint(scope: BookScope, taskId: string, workerId: string, phase: string, checkpoint: Record<string, unknown>): TaskRecord {
    const now = this.clock.now().toISOString();
    const result = this.database.prepare(`
      UPDATE tasks SET current_phase = ?, checkpoint_json = ?, heartbeat_at = ?, updated_at = ?
      WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'working' AND lease_owner = ?
    `).run(phase, JSON.stringify(checkpoint), now, now, taskId, scope.ownerId, scope.bookId, workerId);
    if (result.changes !== 1) throw new Error('检查点写入被租约门禁拒绝');
    this.database.prepare(`
      INSERT INTO task_phases (
        task_id, owner_id, book_id, phase_key, status, input_version_json,
        checkpoint_json, artifact_json, entered_at, heartbeat_at
      ) VALUES (?, ?, ?, ?, 'working', '{}', ?, '{}', ?, ?)
      ON CONFLICT(task_id, phase_key) DO UPDATE SET checkpoint_json = excluded.checkpoint_json, heartbeat_at = excluded.heartbeat_at
    `).run(taskId, scope.ownerId, scope.bookId, phase, JSON.stringify(checkpoint), now, now);
    this.events?.append(scope, 'task.phase.changed', { taskId, status: 'working', phase });
    return this.require(scope, taskId);
  }

  public requestPause(scope: BookScope, taskId: string): void {
    this.require(scope, taskId);
    this.database.prepare(`UPDATE tasks SET pause_requested = 1, updated_at = ? WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'working'`)
      .run(this.clock.now().toISOString(), taskId, scope.ownerId, scope.bookId);
  }

  public pauseAtCheckpoint(scope: BookScope, taskId: string, workerId: string): TaskRecord {
    const now = this.clock.now().toISOString();
    const result = this.database.prepare(`
      UPDATE tasks SET status = 'paused', lease_owner = NULL, lease_expires_at = NULL,
        heartbeat_at = NULL, pause_requested = 0, updated_at = ?
      WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'working' AND lease_owner = ? AND pause_requested = 1
    `).run(now, taskId, scope.ownerId, scope.bookId, workerId);
    if (result.changes !== 1) throw new Error('任务不在可暂停检查点');
    this.events?.append(scope, 'task.phase.changed', { taskId, status: 'paused' });
    return this.require(scope, taskId);
  }

  public requestCancel(scope: BookScope, taskId: string): TaskRecord {
    const task = this.require(scope, taskId);
    const now = this.clock.now().toISOString();
    if (['pending', 'queued', 'paused', 'blocked'].includes(task.status)) {
      this.database.prepare(`
        UPDATE tasks SET status = 'cancelled', cancel_requested = 1, lease_owner = NULL,
          lease_expires_at = NULL, updated_at = ? WHERE task_id = ? AND owner_id = ? AND book_id = ?
      `).run(now, taskId, scope.ownerId, scope.bookId);
    } else {
      this.database.prepare(`UPDATE tasks SET cancel_requested = 1, updated_at = ? WHERE task_id = ? AND owner_id = ? AND book_id = ?`)
        .run(now, taskId, scope.ownerId, scope.bookId);
    }
    this.events?.append(scope, 'task.phase.changed', { taskId, cancelRequested: true });
    return this.require(scope, taskId);
  }

  public complete(scope: BookScope, taskId: string, workerId: string): TaskRecord {
    const now = this.clock.now().toISOString();
    const result = this.database.prepare(`
      UPDATE tasks SET status = CASE WHEN cancel_requested = 1 THEN 'cancelled' ELSE 'succeeded' END,
        lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL, updated_at = ?
      WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'working' AND lease_owner = ?
    `).run(now, taskId, scope.ownerId, scope.bookId, workerId);
    if (result.changes !== 1) throw new Error('任务完成被租约门禁拒绝');
    const task = this.require(scope, taskId);
    this.events?.append(scope, task.status === 'succeeded' ? 'task.completed' : 'task.phase.changed', { taskId, status: task.status });
    return task;
  }

  public waitForConfirmation(scope: BookScope, taskId: string, workerId: string): TaskRecord {
    const now = this.clock.now().toISOString();
    const result = this.database.prepare(`
      UPDATE tasks SET status = 'waiting_confirmation', current_phase = 'owner_confirmation',
        lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL, updated_at = ?
      WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'working' AND lease_owner = ?
    `).run(now, taskId, scope.ownerId, scope.bookId, workerId);
    if (result.changes !== 1) throw new Error('任务等待确认转换被租约门禁拒绝');
    this.events?.append(scope, 'task.phase.changed', { taskId, status: 'waiting_confirmation', phase: 'owner_confirmation' });
    return this.require(scope, taskId);
  }

  public resolveWaitingConfirmation(scope: BookScope, taskId: string, accept: boolean): TaskRecord {
    const now = this.clock.now().toISOString();
    const result = this.database.prepare(`
      UPDATE tasks SET status = ?, current_phase = ?, updated_at = ?
      WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'waiting_confirmation'
    `).run(accept ? 'succeeded' : 'cancelled', accept ? 'completed' : 'owner_rejected', now,
      taskId, scope.ownerId, scope.bookId);
    if (result.changes !== 1) throw new Error('等待确认任务不存在或状态冲突');
    this.events?.append(scope, accept ? 'task.completed' : 'task.phase.changed', { taskId, status: accept ? 'succeeded' : 'cancelled' });
    return this.require(scope, taskId);
  }

  public recoverExpired(): TaskRecord[] {
    const now = this.clock.now().toISOString();
    const expired = this.database.prepare(`SELECT * FROM tasks WHERE status = 'working' AND lease_expires_at <= ? ORDER BY task_id`)
      .all(now) as unknown as TaskRow[];
    const recovered: TaskRecord[] = [];
    for (const row of expired) {
      const scope = { ownerId: row.owner_id, bookId: row.book_id };
      const workingCall = this.database.prepare(`
        SELECT m.request_id, m.result_reference, r.status AS reservation_status
        FROM model_calls m JOIN budget_reservations r ON r.reservation_id = m.reservation_id
        WHERE m.task_id = ? AND m.state = 'working' LIMIT 1
      `).get(row.task_id) as { request_id: string; result_reference: string | null; reservation_status: string } | undefined;
      const reusableResult = workingCall !== undefined && workingCall.result_reference !== null && workingCall.reservation_status === 'settled';
      const nextStatus: TaskStatus = row.cancel_requested === 1 ? 'cancelled' : workingCall === undefined || reusableResult ? 'queued' : 'interrupted';
      this.database.exec('BEGIN IMMEDIATE');
      try {
        if (workingCall !== undefined) {
          this.database.prepare(`UPDATE model_calls SET state = ?, error_class = ?, completed_at = ? WHERE request_id = ? AND state = 'working'`)
            .run(reusableResult ? 'succeeded' : 'interrupted', reusableResult ? null : 'lease_expired', now, workingCall.request_id);
        }
        this.database.prepare(`
          UPDATE tasks SET status = ?, lease_owner = NULL, lease_expires_at = NULL,
            heartbeat_at = NULL, error_code = ?, updated_at = ? WHERE task_id = ?
        `).run(nextStatus, nextStatus === 'interrupted' ? errorCodes.modelCallInterrupted : null, now, row.task_id);
        this.database.exec('COMMIT');
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
      const task = this.require(scope, row.task_id);
      this.events?.append(scope, nextStatus === 'interrupted' ? 'model_call.interrupted' : 'task.phase.changed', { taskId: row.task_id, status: nextStatus });
      recovered.push(task);
    }
    return recovered;
  }

  public require(scope: BookScope, taskId: string): TaskRecord {
    assertBookScope(scope);
    const row = this.database.prepare('SELECT * FROM tasks WHERE task_id = ? AND owner_id = ? AND book_id = ?')
      .get(taskId, scope.ownerId, scope.bookId) as TaskRow | undefined;
    if (row === undefined) throw new Error('任务不存在或越权');
    return mapTask(row);
  }

  public list(scope: BookScope): TaskRecord[] {
    assertBookScope(scope);
    const rows = this.database.prepare('SELECT * FROM tasks WHERE owner_id = ? AND book_id = ? ORDER BY created_at, task_id')
      .all(scope.ownerId, scope.bookId) as unknown as TaskRow[];
    return rows.map(mapTask);
  }
}

function mapTask(row: TaskRow): TaskRecord {
  return {
    taskId: row.task_id,
    ownerId: row.owner_id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    taskType: row.task_type,
    assignedAgentId: row.assigned_agent_id,
    status: row.status,
    currentPhase: row.current_phase,
    idempotencyKey: row.idempotency_key,
    budgetId: row.budget_id,
    requiredEditorEpoch: row.required_editor_epoch,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    checkpoint: JSON.parse(row.checkpoint_json) as Record<string, unknown>,
    brief: JSON.parse(row.task_brief_json) as Record<string, unknown>,
    pauseRequested: row.pause_requested === 1,
    cancelRequested: row.cancel_requested === 1,
    attemptCount: row.attempt_count
  };
}
