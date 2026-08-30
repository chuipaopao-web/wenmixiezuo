import type { V7FormalizationExecutor } from '../executors/v7-formalization-executor.js';

export class V7FormalizationLoop {
  #timer: NodeJS.Timeout | undefined;
  #working = false;
  public constructor(private readonly executor: V7FormalizationExecutor) {}
  public start(): void { void this.tick(); this.#timer = setInterval(() => void this.tick(), 5_000); }
  public stop(): void { if (this.#timer !== undefined) clearInterval(this.#timer); this.#timer = undefined; }
  public async runOnce(): Promise<void> { await this.tick(); }
  private async tick(): Promise<void> {
    if (this.#working) return;
    this.#working = true;
    try { await this.executor.runNext(); }
    catch (error) {
      console.error(JSON.stringify({
        service: 'wenmi-worker', component: 'v7-formalization-loop',
        errorType: error instanceof Error ? error.name : 'UnknownError'
      }));
    } finally { this.#working = false; }
  }
}
