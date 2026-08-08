import type { DatabaseSync } from 'node:sqlite';
import type { WorkerConfig } from '../runtime/config.js';

export class WorkerHeartbeat {
  readonly #startedAt = new Date().toISOString();
  #timer: NodeJS.Timeout | undefined;
  #currentTaskId: string | null = null;
  #extraCapabilities: string[];

  public constructor(
    private readonly database: DatabaseSync,
    private readonly config: WorkerConfig,
    extraCapabilities: string[] = []
  ) { this.#extraCapabilities = [...extraCapabilities]; }

  public start(): void {
    this.write();
    this.#timer = setInterval(() => this.write(), 5_000);
    this.#timer.unref();
  }

  public stop(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  public setCurrentTask(taskId: string | null): void {
    this.#currentTaskId = taskId;
    this.write();
  }

  public setExtraCapabilities(capabilities: string[]): void {
    this.#extraCapabilities = [...capabilities];
    this.write();
  }

  private write(): void {
    try {
      this.database.prepare(`
        INSERT INTO worker_health (
          worker_id, release_id, process_id, started_at, heartbeat_at, capabilities_json, current_task_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(worker_id) DO UPDATE SET
          release_id = excluded.release_id,
          process_id = excluded.process_id,
          started_at = excluded.started_at,
          heartbeat_at = excluded.heartbeat_at,
          capabilities_json = excluded.capabilities_json,
          current_task_id = excluded.current_task_id
      `).run(
        this.config.workerId,
        this.config.releaseId,
        process.pid,
        this.#startedAt,
        new Date().toISOString(),
        JSON.stringify(['conversation-reply', 'role-discussion', 'chapter-creation', 'task-heartbeat', 'persistent-task-claim', 'volume-plan-generation', ...this.#extraCapabilities]),
        this.#currentTaskId
      );
    } catch (error) {
      if (!isTransientDatabaseLock(error)) throw error;
      console.warn(JSON.stringify({
        service: 'wenmi-worker',
        component: 'heartbeat',
        status: 'deferred',
        reason: 'database-busy'
      }));
    }
  }
}

function isTransientDatabaseLock(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const sqliteError = error as Error & { errcode?: number; errstr?: string };
  return sqliteError.errcode === 5
    || sqliteError.errstr === 'database is locked'
    || /database is (?:locked|busy)/iu.test(error.message);
}
