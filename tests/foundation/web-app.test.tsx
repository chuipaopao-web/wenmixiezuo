// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../apps/web/src/app/App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Web基础入口', () => {
  it('显示产品名称和真实健康状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      const data = path === '/health'
        ? { service: 'wenmai-api', status: 'ok', releaseId: 'wm-v1-20260716-220959-d5dd704d', schemaVersion: 7 }
        : path === '/api/v1/books'
          ? []
          : { status: 'ready', worker: null };
      return apiResponse(data);
    }));
    render(<App />);
    expect(screen.getByRole('heading', { name: '文脉写作' })).toBeInTheDocument();
    expect(await screen.findByText(/本地服务已就绪/)).toBeInTheDocument();
  });
});

function apiResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: 'request-1', version: 1 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}
