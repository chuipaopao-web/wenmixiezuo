import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { ClaimedTask } from '../scheduler/task-claimer.js';

interface InternalResponse {
  statusCode: number;
  body: string;
}

interface InternalErrorBody {
  error?: {
    code?: unknown;
    retryable?: unknown;
  };
}

export class WorkerExecutionError extends Error {
  public constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly statusCode: number,
    detail: string
  ) {
    super(`章节执行API失败：${statusCode} ${detail}`);
    this.name = 'WorkerExecutionError';
  }
}

function executionError(response: InternalResponse): WorkerExecutionError {
  let parsed: InternalErrorBody | undefined;
  try {
    parsed = JSON.parse(response.body) as InternalErrorBody;
  } catch {
    parsed = undefined;
  }
  const rawCode = parsed?.error?.code;
  const code = typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/u.test(rawCode)
    ? rawCode
    : 'WORKER_API_HTTP_ERROR';
  const explicitRetryable = parsed?.error?.retryable;
  const retryable = typeof explicitRetryable === 'boolean'
    ? explicitRetryable
    : response.statusCode >= 500;
  return new WorkerExecutionError(code, retryable, response.statusCode, response.body.slice(0, 300));
}

function postJson(url: URL, headers: Record<string, string>, body: string, signal?: AbortSignal): Promise<InternalResponse> {
  return new Promise<InternalResponse>((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(url, {
      method: 'POST',
      headers: {
        ...headers,
        'content-length': Buffer.byteLength(body).toString()
      },
      ...(signal === undefined ? {} : { signal })
    }, (response) => {
      response.setEncoding('utf8');
      let responseBody = '';
      response.on('data', (chunk: string) => { responseBody += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode ?? 0, body: responseBody }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end(body);
  });
}

export class ChapterTaskExecutor {
  public constructor(
    private readonly apiBaseUrl: string,
    private readonly workerId: string,
    private readonly workerToken: string
  ) {}

  public async execute(task: ClaimedTask, signal?: AbortSignal): Promise<void> {
    const url = new URL(`/api/v1/internal/worker/tasks/${encodeURIComponent(task.taskId)}/execute`, this.apiBaseUrl);
    const response = await postJson(url, {
      'content-type': 'application/json',
      'x-wenmi-worker-id': this.workerId,
      'x-wenmi-worker-token': this.workerToken
    }, JSON.stringify({
      ownerId: task.ownerId,
      bookId: task.bookId,
      leaseToken: task.leaseToken,
      attemptNo: task.attemptNo
    }), signal);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw executionError(response);
    }
  }
}
