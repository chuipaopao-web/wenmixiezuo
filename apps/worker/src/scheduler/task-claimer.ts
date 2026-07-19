import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface ClaimedTask {
  taskId: string;
  ownerId: string;
  bookId: string;
  taskType: string;
  currentPhase: string;
  leaseToken: string;
  attemptNo: number;
  requiredEditorEpoch: number;
}

interface TaskRow {
  task_id: string;
  owner_id: string;
  book_id: string;
  task_type: string;
  current_phase: string;
  required_editor_epoch: number;
}

export class TaskClaimer {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly workerId: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  public claimNext(now = this.now()): ClaimedTask | null {
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + 15_000).toISOString();
    const leaseToken = randomUUID();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const active = this.database.prepare("SELECT 1 FROM tasks WHERE status = 'working' AND lease_expires_at > ? LIMIT 1").get(nowIso);
      if (active !== undefined) {
        this.database.exec('COMMIT');
        return null;
      }
      const row = this.database.prepare(`
        SELECT t.task_id, t.owner_id, t.book_id, t.task_type, t.current_phase, t.required_editor_epoch
        FROM tasks t JOIN books b ON b.owner_id = t.owner_id AND b.book_id = t.book_id
        WHERE t.status = 'queued' AND t.cancel_requested = 0
          AND (t.required_editor_epoch = 0 OR t.required_editor_epoch = b.editor_epoch)
          AND NOT EXISTS (
            SELECT 1 FROM task_dependencies d JOIN tasks dependency ON dependency.task_id = d.depends_on_task_id
            WHERE d.task_id = t.task_id AND dependency.status <> 'succeeded'
          )
        ORDER BY t.created_at, t.task_id LIMIT 1
      `).get() as TaskRow | undefined;
      if (row === undefined) {
        this.database.exec('COMMIT');
        return null;
      }
      const result = this.database.prepare(`
        UPDATE tasks SET status = 'working', lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?,
          lease_token = ?, attempt_count = attempt_count + 1, current_attempt_no = attempt_count + 1,
          updated_at = ? WHERE task_id = ? AND status = 'queued'
      `).run(this.workerId, leaseExpiresAt, nowIso, leaseToken, nowIso, row.task_id);
      if (result.changes !== 1) {
        this.database.exec('ROLLBACK');
        return null;
      }
      const claimed = this.database.prepare(`SELECT current_attempt_no FROM tasks WHERE task_id = ?`)
        .get(row.task_id) as { current_attempt_no: number };
      this.database.prepare(`
        INSERT INTO task_attempts (
          task_attempt_id, task_id, owner_id, book_id, attempt_no, worker_id, lease_token,
          required_editor_epoch, status, lease_expires_at, started_at, heartbeat_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'working', ?, ?, ?)
      `).run(`attempt-${randomUUID()}`, row.task_id, row.owner_id, row.book_id, claimed.current_attempt_no,
        this.workerId, leaseToken, row.required_editor_epoch, leaseExpiresAt, nowIso, nowIso);
      this.database.prepare(`
        INSERT INTO task_phases (
          task_id, owner_id, book_id, phase_key, status, input_version_json,
          checkpoint_json, artifact_json, entered_at, heartbeat_at
        ) VALUES (?, ?, ?, ?, 'working', '{}', '{}', '{}', ?, ?)
        ON CONFLICT(task_id, phase_key) DO UPDATE SET status = 'working', heartbeat_at = excluded.heartbeat_at
      `).run(row.task_id, row.owner_id, row.book_id, row.current_phase, nowIso, nowIso);
      this.database.exec('COMMIT');
      return {
        taskId: row.task_id, ownerId: row.owner_id, bookId: row.book_id,
        taskType: row.task_type, currentPhase: row.current_phase, leaseToken,
        attemptNo: claimed.current_attempt_no, requiredEditorEpoch: row.required_editor_epoch
      };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public renew(task: ClaimedTask, leaseMs = 15_000, now = this.now()): void {
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = this.database.prepare(`
        UPDATE tasks SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
        WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'working'
          AND lease_owner = ? AND lease_token = ? AND current_attempt_no = ? AND lease_expires_at > ?
          AND (required_editor_epoch = 0 OR required_editor_epoch = (
            SELECT editor_epoch FROM books WHERE owner_id = ? AND book_id = ?
          ))
      `).run(nowIso, leaseExpiresAt, nowIso, task.taskId, task.ownerId, task.bookId,
        this.workerId, task.leaseToken, task.attemptNo, nowIso, task.ownerId, task.bookId);
      if (result.changes !== 1) throw new Error('TASK_LEASE_LOST');
      const attempt = this.database.prepare(`
        UPDATE task_attempts SET heartbeat_at = ?, lease_expires_at = ?
        WHERE task_id = ? AND owner_id = ? AND book_id = ? AND attempt_no = ?
          AND worker_id = ? AND lease_token = ? AND status = 'working'
      `).run(nowIso, leaseExpiresAt, task.taskId, task.ownerId, task.bookId, task.attemptNo,
        this.workerId, task.leaseToken);
      if (attempt.changes !== 1) throw new Error('TASK_ATTEMPT_LEASE_LOST');
      this.database.exec('COMMIT');
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public recoverExpired(now = this.now()): number {
    const nowIso = now.toISOString();
    const rows = this.database.prepare(`
      SELECT task_id, owner_id, book_id, current_attempt_no, lease_token, cancel_requested
      FROM tasks WHERE status = 'working' AND lease_expires_at <= ?
      ORDER BY task_id
    `).all(nowIso) as unknown as Array<{
      task_id: string; owner_id: string; book_id: string; current_attempt_no: number;
      lease_token: string | null; cancel_requested: number;
    }>;
    let recovered = 0;
    for (const row of rows) {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const workingCall = this.database.prepare(`
          SELECT request_id FROM model_calls WHERE task_id = ? AND owner_id = ? AND book_id = ? AND state = 'working' LIMIT 1
        `).get(row.task_id, row.owner_id, row.book_id) as { request_id: string } | undefined;
        const unresolvedCall = this.database.prepare(`
          SELECT 1 FROM model_calls m JOIN model_call_reconciliations r ON r.request_id = m.request_id
          WHERE m.task_id = ? AND m.owner_id = ? AND m.book_id = ?
            AND r.state IN ('awaiting_provider', 'discarded') LIMIT 1
        `).get(row.task_id, row.owner_id, row.book_id);
        const nextStatus = row.cancel_requested === 1 ? 'cancelled'
          : workingCall === undefined && unresolvedCall === undefined ? 'queued' : 'interrupted';
        if (workingCall !== undefined) {
          this.database.prepare(`
            UPDATE model_calls SET state = 'interrupted', error_class = 'lease_expired_result_unknown', completed_at = ?
            WHERE request_id = ? AND state = 'working'
          `).run(nowIso, workingCall.request_id);
          this.database.prepare(`
            INSERT INTO model_call_reconciliations (
              request_id, owner_id, book_id, state, reason_code, details_json, created_at
            ) VALUES (?, ?, ?, 'awaiting_provider', 'LEASE_EXPIRED_RESULT_UNKNOWN', '{}', ?)
            ON CONFLICT(request_id) DO NOTHING
          `).run(workingCall.request_id, row.owner_id, row.book_id, nowIso);
        }
        const updated = this.database.prepare(`
          UPDATE tasks SET status = ?, error_code = ?, lease_owner = NULL, lease_token = NULL,
            lease_expires_at = NULL, heartbeat_at = NULL, updated_at = ?
          WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'working'
            AND current_attempt_no = ? AND lease_token IS ? AND lease_expires_at <= ?
        `).run(nextStatus, nextStatus === 'interrupted' ? 'MODEL_CALL_RESULT_UNKNOWN' : null,
          nowIso, row.task_id, row.owner_id, row.book_id, row.current_attempt_no, row.lease_token, nowIso);
        if (updated.changes === 1) {
          this.database.prepare(`
            UPDATE task_attempts SET status = ?, error_code = ?, completed_at = ?
            WHERE task_id = ? AND attempt_no = ? AND lease_token IS ? AND status = 'working'
          `).run(nextStatus === 'queued' ? 'expired' : nextStatus, nextStatus === 'interrupted' ? 'MODEL_CALL_RESULT_UNKNOWN' : null,
            nowIso, row.task_id, row.current_attempt_no, row.lease_token);
          recovered += 1;
        }
        this.database.exec('COMMIT');
      } catch (error) {
        if (this.database.isTransaction) this.database.exec('ROLLBACK');
        throw error;
      }
    }
    return recovered;
  }

  public complete(task: ClaimedTask, artifact: Record<string, unknown>): void {
    const now = this.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = this.database.prepare(`
        UPDATE tasks SET status = CASE WHEN cancel_requested = 1 THEN 'cancelled' ELSE 'succeeded' END,
          checkpoint_json = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
          heartbeat_at = NULL, updated_at = ?
        WHERE task_id = ? AND owner_id = ? AND book_id = ? AND lease_owner = ? AND lease_token = ?
          AND current_attempt_no = ? AND lease_expires_at > ? AND status = 'working'
      `).run(JSON.stringify({ completedPhase: task.currentPhase }), now, task.taskId, task.ownerId,
        task.bookId, this.workerId, task.leaseToken, task.attemptNo, now);
      if (result.changes !== 1) throw new Error('TASK_COMMIT_FENCE_REJECTED');
      this.database.prepare(`
        UPDATE task_phases SET status = 'succeeded', artifact_json = ?, completed_at = ?, heartbeat_at = ?
        WHERE task_id = ? AND phase_key = ? AND status = 'working'
      `).run(JSON.stringify(artifact), now, now, task.taskId, task.currentPhase);
      this.database.prepare(`
        UPDATE task_attempts SET status = 'succeeded', completed_at = ?, heartbeat_at = ?
        WHERE task_id = ? AND attempt_no = ? AND lease_token = ? AND status = 'working'
      `).run(now, now, task.taskId, task.attemptNo, task.leaseToken);
      this.database.prepare(`UPDATE worker_health SET current_task_id = NULL, heartbeat_at = ? WHERE worker_id = ? AND current_task_id = ?`)
        .run(now, this.workerId, task.taskId);
      this.appendEvent(task, 'task.completed', { taskId: task.taskId });
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public block(task: ClaimedTask, reason: string): void {
    const now = this.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = this.database.prepare(`
        UPDATE tasks SET status = 'blocked', error_code = ?, lease_owner = NULL,
          lease_token = NULL, lease_expires_at = NULL, heartbeat_at = NULL, updated_at = ?
        WHERE task_id = ? AND owner_id = ? AND book_id = ? AND lease_owner = ? AND lease_token = ?
          AND current_attempt_no = ? AND lease_expires_at > ? AND status = 'working'
      `).run(reason, now, task.taskId, task.ownerId, task.bookId, this.workerId,
        task.leaseToken, task.attemptNo, now);
      if (result.changes !== 1) throw new Error('TASK_BLOCK_FENCE_REJECTED');
      this.database.prepare(`
        UPDATE task_attempts SET status = 'blocked', error_code = ?, completed_at = ?
        WHERE task_id = ? AND attempt_no = ? AND lease_token = ? AND status = 'working'
      `).run(reason, now, task.taskId, task.attemptNo, task.leaseToken);
      this.database.prepare(`UPDATE worker_health SET current_task_id = NULL, heartbeat_at = ? WHERE worker_id = ? AND current_task_id = ?`)
        .run(now, this.workerId, task.taskId);
      this.appendEvent(task, 'task.blocked', { taskId: task.taskId, reason });
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private appendEvent(task: ClaimedTask, eventType: string, data: Record<string, unknown>): void {
    this.database.prepare(`
      INSERT INTO persistent_events (event_id, event_type, owner_id, book_id, occurred_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(`worker-${crypto.randomUUID()}`, eventType, task.ownerId, task.bookId, this.now().toISOString(), JSON.stringify(data));
  }
}
