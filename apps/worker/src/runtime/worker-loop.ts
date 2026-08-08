import type { WorkerHeartbeat } from '../health/heartbeat.js';
import type { TaskClaimer } from '../scheduler/task-claimer.js';
import type { ChapterTaskExecutor } from '../executors/chapter-task-executor.js';

export class WorkerLoop {
  #timer: NodeJS.Timeout | undefined;
  #working = false;

  public constructor(
    private readonly claimer: TaskClaimer,
    private readonly heartbeat: WorkerHeartbeat,
    private readonly chapterTasks?: ChapterTaskExecutor
  ) {}

  public start(): void {
    void this.tick();
    this.#timer = setInterval(() => void this.tick(), 1_000);
  }

  public stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  public async runOnce(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.#working) return;
    this.#working = true;
    try {
      this.claimer.recoverExpired();
      const task = this.claimer.claimNext();
      if (task === null) return;
      this.heartbeat.setCurrentTask(task.taskId);
      if (task.taskType === 'runtime_probe') {
        this.claimer.complete(task, { workerExecuted: true, deterministic: true });
      } else if (['chapter_creation', 'discussion', 'conversation_reply', 'continuation_analysis', 'volume_plan_generation'].includes(task.taskType) && this.chapterTasks !== undefined) {
        const controller = new AbortController();
        let leaseError: Error | null = null;
        const renewal = setInterval(() => {
          try {
            this.claimer.renew(task);
          } catch (error) {
            leaseError = error instanceof Error ? error : new Error(String(error));
            controller.abort(leaseError);
          }
        }, 5_000);
        try {
          await this.chapterTasks.execute(task, controller.signal);
          if (leaseError !== null) throw leaseError;
        } finally {
          clearInterval(renewal);
        }
      } else {
        this.claimer.block(task, 'EXECUTOR_NOT_REGISTERED');
      }
    } catch (error) {
      console.error(JSON.stringify({ service: 'wenmi-worker', error: error instanceof Error ? error.message : String(error) }));
    } finally {
      this.heartbeat.setCurrentTask(null);
      this.#working = false;
    }
  }
}
