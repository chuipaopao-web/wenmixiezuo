import type { ProjectionTaskExecutor } from '../executors/projection-task-executor.js';

export class ProjectionLoop {
  #timer: NodeJS.Timeout | undefined;
  #working = false;
  public constructor(private readonly executor: ProjectionTaskExecutor) {}
  public start(): void { void this.tick(); this.#timer = setInterval(() => void this.tick(), 1_000); }
  public stop(): void { if (this.#timer !== undefined) clearInterval(this.#timer); this.#timer = undefined; }
  public async runOnce(): Promise<void> { await this.tick(); }
  private async tick(): Promise<void> {
    if (this.#working) return;
    this.#working = true;
    try { this.executor.runNext(); }
    catch (error) { console.error(JSON.stringify({ service: 'wenmi-worker', component: 'projection-loop', errorType: error instanceof Error ? error.name : 'UnknownError' })); }
    finally { this.#working = false; }
  }
}
