// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../apps/web/src/app/App';

afterEach(() => vi.unstubAllGlobals());

describe('Web基础入口', () => {
  it('显示产品名称和真实健康状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: {
        service: 'wenmai-api',
        status: 'ok',
        releaseId: 'wm-v1-20260716-220959-d5dd704d',
        schemaVersion: 1
      },
      meta: { requestId: 'request-1', version: 1 }
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(<App />);
    expect(screen.getByRole('heading', { name: '文脉写作' })).toBeInTheDocument();
    expect(await screen.findByText(/本地服务已就绪/)).toBeInTheDocument();
  });
});

