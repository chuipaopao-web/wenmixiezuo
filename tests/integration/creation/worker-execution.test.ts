import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ChapterBatchService } from '../../../apps/api/src/application/creation/chapter-batch-service.js';
import { createServer } from '../../../apps/api/src/http/server.js';
import { approvePendingManuscript, initializeDomainBook, prepareBookForWriting } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('独立Worker章节执行', () => {
  let context: TestContext | undefined;
  let app: FastifyInstance | undefined;
  let worker: ChildProcess | undefined;

  afterEach(async () => {
    if (worker !== undefined && worker.exitCode === null) {
      worker.kill('SIGTERM');
      await new Promise<void>((resolvePromise) => worker!.once('exit', () => resolvePromise()));
    }
    await app?.close();
    context?.close();
    worker = undefined;
    app = undefined;
    context = undefined;
  });

  it('Worker只领取任务并通过API应用服务完成章节流水线', async () => {
    context = createTestContext('wenmi-creation-worker-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: 'Worker创作书', text: '独立Worker执行完整章节任务' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    prepareBookForWriting(context, scope, ids, clock, 1);
    const batch = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock).scheduleNewChapters(scope, 1);
    app = await createServer(context.config, context.database, { trustedTest: true });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('测试API地址不可用');
    worker = spawn(process.execPath, ['--import', 'tsx', resolve(process.cwd(), 'apps/worker/src/main.ts')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WENMI_PROJECT_ROOT: process.cwd(),
        WENMI_DATA_DIR: context.dataDir,
        WENMI_WORKER_ID: 'creation-worker-test',
        WENMI_WORKER_TOKEN: context.config.workerToken,
        WENMI_API_BASE_URL: `http://127.0.0.1:${address.port}`
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const taskId = batch.taskIds[0]!;
    await waitUntil(() => {
      const row = context!.database.prepare(`SELECT status FROM tasks WHERE task_id = ?`).get(taskId) as { status: string };
      const heartbeat = context!.database.prepare(`SELECT current_task_id FROM worker_health WHERE worker_id = 'creation-worker-test'`).get() as { current_task_id: string | null } | undefined;
      return row.status === 'waiting_confirmation' && heartbeat?.current_task_id === null;
    }, 20_000);
    expect(context.database.prepare(`SELECT settlement_status FROM chapters WHERE chapter_id = ?`).get(batch.chapterIds[0]!)).toEqual({ settlement_status: 'awaiting_confirmation' });
    approvePendingManuscript(context, scope, ids, clock);
    expect(context.database.prepare(`SELECT status FROM tasks WHERE task_id = ?`).get(taskId)).toEqual({ status: 'succeeded' });
    expect(context.database.prepare(`SELECT settlement_status FROM chapters WHERE chapter_id = ?`).get(batch.chapterIds[0]!)).toEqual({ settlement_status: 'settled' });
    expect(context.database.prepare(`SELECT current_task_id FROM worker_health WHERE worker_id = 'creation-worker-test'`).get()).toEqual({ current_task_id: null });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE task_id = ? AND state = 'succeeded'`).get(taskId)).toEqual({ count: 12 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM editor_review_syntheses WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId)).toEqual({ count: 2 });
    const contentResponse = await app.inject({ method: 'GET', url: `/api/v1/books/${scope.bookId}/chapters/${batch.chapterIds[0]!}/content?start=0&end=120` });
    expect(contentResponse.statusCode).toBe(200);
    expect(contentResponse.json().data).toEqual(expect.objectContaining({ start: 0, end: 120, totalLength: expect.any(Number), content: expect.any(String) }));
  }, 30_000);
});

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error('等待Worker完成章节任务超时');
}
