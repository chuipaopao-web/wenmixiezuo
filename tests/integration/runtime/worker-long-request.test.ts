import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChapterTaskExecutor, WorkerExecutionError } from '../../../apps/worker/src/executors/chapter-task-executor.js';

describe('Worker long-running internal request', () => {
  let server: Server | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (server !== undefined) {
      await new Promise<void>((resolve, reject) => server?.close((error) => error === undefined ? resolve() : reject(error)));
      server = undefined;
    }
  });

  it('does not depend on fetch header deadlines while a leased model task is still running', async () => {
    let received = '';
    server = createServer((request, response) => {
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => { received += chunk; });
      request.on('end', () => {
        setTimeout(() => {
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          response.end('{"ok":true}');
        }, 25);
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('test server did not bind');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('UND_ERR_HEADERS_TIMEOUT')));
    const executor = new ChapterTaskExecutor(`http://127.0.0.1:${address.port}`, 'worker-long', 'token-long');
    await executor.execute({
      taskId: 'task-long', ownerId: 'owner-long', bookId: 'book-long', taskType: 'discussion',
      currentPhase: 'collecting', leaseToken: 'lease-long-000000000000', attemptNo: 1, requiredEditorEpoch: 1
    });

    expect(JSON.parse(received)).toMatchObject({
      ownerId: 'owner-long', bookId: 'book-long', leaseToken: 'lease-long-000000000000', attemptNo: 1
    });
  });

  it('preserves an explicit non-retryable API error for terminal task handling', async () => {
    server = createServer((_request, response) => {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end('{"error":{"code":"INTERNAL_ERROR","message":"failed","details":{},"retryable":false}}');
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('test server did not bind');

    const executor = new ChapterTaskExecutor(`http://127.0.0.1:${address.port}`, 'worker-terminal', 'token-terminal');
    let caught: unknown;
    try {
      await executor.execute({
        taskId: 'task-terminal', ownerId: 'owner-terminal', bookId: 'book-terminal', taskType: 'discussion',
        currentPhase: 'collecting', leaseToken: 'lease-terminal-0000000000', attemptNo: 1, requiredEditorEpoch: 1
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WorkerExecutionError);
    expect(caught).toMatchObject({
      name: 'WorkerExecutionError', code: 'INTERNAL_ERROR', retryable: false, statusCode: 500
    });
  });
});
