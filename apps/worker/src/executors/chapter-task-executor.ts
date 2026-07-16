import type { ClaimedTask } from '../scheduler/task-claimer.js';

export class ChapterTaskExecutor {
  public constructor(
    private readonly apiBaseUrl: string,
    private readonly workerId: string
  ) {}

  public async execute(task: ClaimedTask): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/api/v1/internal/worker/tasks/${encodeURIComponent(task.taskId)}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-wenmi-worker-id': this.workerId },
      body: JSON.stringify({ ownerId: task.ownerId, bookId: task.bookId })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`章节执行API失败：${response.status} ${body.slice(0, 300)}`);
    }
  }
}
