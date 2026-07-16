import type { DatabaseSync } from 'node:sqlite';

export interface ClaimedTask {
  taskId: string;
  ownerId: string;
  bookId: string;
  taskType: string;
  currentPhase: string;
}

interface TaskRow {
  task_id: string;
  owner_id: string;
  book_id: string;
  task_type: string;
  current_phase: string;
}

export class TaskClaimer {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly workerId: string
  ) {}

  public claimNext(now = new Date()): ClaimedTask | null {
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + 15_000).toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const active = this.database.prepare("SELECT 1 FROM tasks WHERE status = 'working' AND lease_expires_at > ? LIMIT 1").get(nowIso);
      if (active !== undefined) {
        this.database.exec('COMMIT');
        return null;
      }
      const row = this.database.prepare(`
        SELECT t.task_id, t.owner_id, t.book_id, t.task_type, t.current_phase
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
          attempt_count = attempt_count + 1, updated_at = ? WHERE task_id = ? AND status = 'queued'
      `).run(this.workerId, leaseExpiresAt, nowIso, nowIso, row.task_id);
      if (result.changes !== 1) {
        this.database.exec('ROLLBACK');
        return null;
      }
      this.database.prepare(`
        INSERT INTO task_phases (
          task_id, owner_id, book_id, phase_key, status, input_version_json,
          checkpoint_json, artifact_json, entered_at, heartbeat_at
        ) VALUES (?, ?, ?, ?, 'working', '{}', '{}', '{}', ?, ?)
        ON CONFLICT(task_id, phase_key) DO UPDATE SET status = 'working', heartbeat_at = excluded.heartbeat_at
      `).run(row.task_id, row.owner_id, row.book_id, row.current_phase, nowIso, nowIso);
      this.database.exec('COMMIT');
      return { taskId: row.task_id, ownerId: row.owner_id, bookId: row.book_id, taskType: row.task_type, currentPhase: row.current_phase };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public complete(task: ClaimedTask, artifact: Record<string, unknown>): void {
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        UPDATE task_phases SET status = 'succeeded', artifact_json = ?, completed_at = ?, heartbeat_at = ?
        WHERE task_id = ? AND phase_key = ? AND status = 'working'
      `).run(JSON.stringify(artifact), now, now, task.taskId, task.currentPhase);
      this.database.prepare(`
        UPDATE tasks SET status = CASE WHEN cancel_requested = 1 THEN 'cancelled' ELSE 'succeeded' END,
          checkpoint_json = ?, lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL, updated_at = ?
        WHERE task_id = ? AND lease_owner = ? AND status = 'working'
      `).run(JSON.stringify({ completedPhase: task.currentPhase }), now, task.taskId, this.workerId);
      this.appendEvent(task, 'task.completed', { taskId: task.taskId });
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public block(task: ClaimedTask, reason: string): void {
    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE tasks SET status = 'blocked', error_code = ?, lease_owner = NULL,
        lease_expires_at = NULL, heartbeat_at = NULL, updated_at = ?
      WHERE task_id = ? AND lease_owner = ? AND status = 'working'
    `).run(reason, now, task.taskId, this.workerId);
    this.appendEvent(task, 'task.blocked', { taskId: task.taskId, reason });
  }

  private appendEvent(task: ClaimedTask, eventType: string, data: Record<string, unknown>): void {
    this.database.prepare(`
      INSERT INTO persistent_events (event_id, event_type, owner_id, book_id, occurred_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(`worker-${crypto.randomUUID()}`, eventType, task.ownerId, task.bookId, new Date().toISOString(), JSON.stringify(data));
  }
}

