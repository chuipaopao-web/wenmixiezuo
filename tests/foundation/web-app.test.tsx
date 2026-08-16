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
  it('显示统一创作台入口并按产品决定隐藏连接状态图标', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      const data = path === '/api/v1/auth/me'
        ? { userId: 'user-web', email: 'boss@example.com', displayName: '老板', role: 'admin', status: 'active' }
        : path === '/health'
        ? { service: 'wenmi-api', status: 'ok', releaseId: 'wm-v1-20260716-220959-d5dd704d', schemaVersion: 9 }
        : path === '/api/v1/books'
          ? []
          : { status: 'ready', worker: null };
      return apiResponse(data);
    }));
    render(<App />);
    expect(screen.getByRole('heading', { name: '文秘写作' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '创建您的第一本书' })).toBeInTheDocument();
    expect(screen.queryByText(/本地服务已就绪/)).not.toBeInTheDocument();
  });
});

function apiResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: 'request-1', version: 1 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}
