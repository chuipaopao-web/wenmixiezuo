import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBooks } from '../../apps/web/src/lib/api/client.js';

const OK_BODY = { data: [], meta: { requestId: 'test', version: 1 } };
const RATE_LIMITED_BODY = { error: { code: 'RATE_LIMITED', message: '请求太频繁，请稍后再试', details: {}, retryable: true }, meta: { requestId: 'test' } };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('API客户端429限流处理', () => {
  it('无请求体的读取请求不伪装成空JSON', async () => {
    let requestHeaders = new Headers();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestHeaders = new Headers(init?.headers);
      return jsonResponse(200, OK_BODY);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchBooks()).resolves.toEqual([]);
    expect(requestHeaders.has('content-type')).toBe(false);
  });

  it('遇到429自动延迟重试，恢复后正常返回数据', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, RATE_LIMITED_BODY))
      .mockResolvedValueOnce(jsonResponse(200, OK_BODY));
    vi.stubGlobal('fetch', fetchMock);
    const pending = fetchBooks();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('重试节奏逐步拉长，全部失败才把请求太频繁抛给页面', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, RATE_LIMITED_BODY));
    vi.stubGlobal('fetch', fetchMock);
    const pending = fetchBooks();
    const assertion = expect(pending).rejects.toThrow('请求太频繁，请稍后再试');
    // 初始 1 次 + 2s/5s/10s 后各重试 1 次 = 共 4 次。
    await vi.advanceTimersByTimeAsync(17_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('等待重试期间被中止立即抛出AbortError，不再发请求', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, RATE_LIMITED_BODY));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const pending = fetchBooks(controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
