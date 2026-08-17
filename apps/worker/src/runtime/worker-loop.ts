import type { WorkerHeartbeat } from '../health/heartbeat.js';
import type { TaskClaimer, ClaimedTask } from '../scheduler/task-claimer.js';
import type { ChapterTaskExecutor } from '../executors/chapter-task-executor.js';

const WORKER_EXECUTION_LEASE_MS = 120_000;
const DEFAULT_MAX_CONCURRENCY = 8;
const MAX_CONCURRENCY_CAP = 32;

/** 可并发执行的任务类型：不同书的这些任务彼此独立，允许并行。 */
const EXECUTABLE_TASK_TYPES = new Set([
  'chapter_creation', 'discussion', 'continuation_analysis', 'volume_plan_generation',
  'book_branding_design',
  'story_event_generation', 'event_chapter_sequence_generation', 'event_chapter_detail_generation',
  'event_chapter_sequence_challenge', 'event_chapter_detail_challenge'
]);

export class WorkerLoop {
  #timer: NodeJS.Timeout | undefined;
  readonly #inFlight = new Set<string>();
  readonly #maxConcurrency: number;

  public constructor(
    private readonly claimer: TaskClaimer,
    private readonly heartbeat: WorkerHeartbeat,
    private readonly chapterTasks?: ChapterTaskExecutor,
    maxConcurrency = DEFAULT_MAX_CONCURRENCY
  ) {
    this.#maxConcurrency = Number.isInteger(maxConcurrency)
      ? Math.max(1, Math.min(maxConcurrency, MAX_CONCURRENCY_CAP))
      : DEFAULT_MAX_CONCURRENCY;
  }

  public start(): void {
    void this.pump();
    this.#timer = setInterval(() => void this.pump(), 1_000);
  }

  public stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** 单次收拢：跑一轮领取并把已认领任务派发执行。返回时在途任务仍在后台运行。 */
  public async runOnce(): Promise<void> {
    await this.pump();
  }

  /** 领取并派发，直到在途任务达到并发上限或暂时没有可领取任务。 */
  private async pump(): Promise<void> {
    try {
      // 即使并发已满也先收拢过期租约，避免停摆任务占住并发槽位永不恢复。
      this.claimer.recoverExpired();
      if (this.#inFlight.size >= this.#maxConcurrency) return;
      while (this.#inFlight.size < this.#maxConcurrency) {
        const task = this.claimer.claimNext(undefined, WORKER_EXECUTION_LEASE_MS);
        if (task === null) break;
        this.#inFlight.add(task.taskId);
        void this.run(task);
      }
    } catch (error) {
      console.error(JSON.stringify({ service: 'wenmi-worker', error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private async run(task: ClaimedTask): Promise<void> {
    try {
      this.heartbeat.setCurrentTask(task.taskId);
      if (task.taskType === 'runtime_probe') {
        this.claimer.complete(task, { workerExecuted: true, deterministic: true });
      } else if (EXECUTABLE_TASK_TYPES.has(task.taskType) && this.chapterTasks !== undefined) {
        const controller = new AbortController();
        let leaseError: Error | null = null;
        const renewal = setInterval(() => {
          try {
            this.claimer.renew(task, WORKER_EXECUTION_LEASE_MS);
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
      this.#inFlight.delete(task.taskId);
      if (this.#inFlight.size === 0) this.heartbeat.setCurrentTask(null);
      void this.pump();
    }
  }
}
