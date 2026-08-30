import type { DatabaseSync } from 'node:sqlite';

/** V7写后维护入口：每次只追赶一个正式待办，语义工作仍由对应Agent完成。 */
export class V7FormalizationExecutor {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly apiBaseUrl: string,
    private readonly workerId: string,
    private readonly workerToken: string
  ) {}

  public async runNext(): Promise<boolean> {
    const pending = this.database.prepare(`SELECT 1 AS ok FROM v7_formalization_outbox
      WHERE status IN ('pending','failed') AND attempt_count < 5 LIMIT 1`).get();
    if (pending === undefined) return false;
    const response = await fetch(`${this.apiBaseUrl}/api/v1/internal/worker/v7/creation-formalization/process`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wenmi-worker-id': this.workerId,
        'x-wenmi-worker-token': this.workerToken
      },
      body: JSON.stringify({ limit: 1 })
    });
    if (!response.ok) throw new Error(`V7_FORMALIZATION_API_${response.status}`);
    return true;
  }
}
