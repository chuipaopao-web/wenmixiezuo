// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeMachineOpsPage } from './TimeMachineOpsPage';
import * as api from './platform-api';

vi.mock('./platform-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./platform-api')>();
  return { ...actual, fetchTimeMachineRuns: vi.fn() };
});

const mockedApi = vi.mocked(api);

describe('后台时光机运行与规格页', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.fetchTimeMachineRuns.mockResolvedValue({
      runs: [
        { id: 'run-a', ownerId: 'owner-1', bookId: 'book-1', bookTitle: '机甲会修仙', kind: 'design', scheme: 'A', roundKey: 'round-1', state: 'succeeded', phase: 'review-source:0', errorCode: null, updatedAt: '2026-09-11T12:00:00Z', createdAt: '2026-09-11T11:00:00Z', writer: '红玉', revision: 2, reviewPass: true, editedBy: 'author', calls: 9, tokens: 48210, failedCalls: 0 },
        { id: 'run-b', ownerId: 'owner-1', bookId: 'book-1', bookTitle: '机甲会修仙', kind: 'design', scheme: 'B', roundKey: 'round-1', state: 'failed', phase: 'volumes:2', errorCode: 'temporary', updatedAt: '2026-09-11T12:05:00Z', createdAt: '2026-09-11T11:00:00Z', writer: '幼薇', revision: null, reviewPass: null, editedBy: null, calls: 6, tokens: 30110, failedCalls: 2 },
        { id: 'run-rec', ownerId: 'owner-2', bookId: 'book-2', bookTitle: null, kind: 'recommend', scheme: null, roundKey: null, state: 'working', phase: 'card:0', errorCode: null, updatedAt: '2026-09-11T12:06:00Z', createdAt: '2026-09-11T12:00:00Z', writer: null, revision: null, reviewPass: null, editedBy: null, calls: 0, tokens: 0, failedCalls: 0 }
      ],
      totals: { calls: 15, tokens: 78320 }
    });
  });
  afterEach(() => cleanup());

  it('展示运行状态、方案归属、修订与用量，并可按状态筛选', async () => {
    render(<TimeMachineOpsPage />);
    expect((await screen.findAllByText('机甲会修仙')).length).toBe(2);
    expect(screen.getByText('round-1 · 方案A')).toBeVisible();
    expect(screen.getByText('round-1 · 方案B')).toBeVisible();
    expect(screen.getByText('红玉')).toBeVisible();
    expect(screen.getByText('第2版·作者修改')).toBeVisible();
    expect(screen.getByText(/未完成（temporary）/)).toBeVisible();
    expect(screen.getByText(/失败2/)).toBeVisible();
    expect(screen.getByText('48k')).toBeVisible();
    expect(screen.getByText(/book-2（推荐）/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('状态筛选'), { target: { value: 'failed' } });
    await waitFor(() => { expect(mockedApi.fetchTimeMachineRuns).toHaveBeenCalledWith('failed'); });
  });

  it('同源渲染时光机规格全部章节并支持搜索定位', async () => {
    render(<TimeMachineOpsPage />);
    await screen.findAllByText('机甲会修仙');
    expect(screen.getByRole('heading', { name: /分层编号、叙事锚点与自主记忆维护/ })).toBeVisible();
    const status = screen.getAllByRole('status').find(element => element.textContent?.includes('共'))!;
    expect(status.textContent).toMatch(/共2\d节/);
    fireEvent.change(screen.getByLabelText('搜索规格文档'), { target: { value: '锚点' } });
    await waitFor(() => { expect(screen.getAllByRole('heading', { name: /分层编号、叙事锚点与自主记忆维护/ }).length).toBeGreaterThan(0); });
    const matches = screen.getAllByRole('status').find(element => element.textContent?.includes('匹配'))!;
    expect(matches.textContent).toMatch(/匹配\d节/);
  });

  it('运行读取失败时给出可读状态而不是空白', async () => {
    mockedApi.fetchTimeMachineRuns.mockRejectedValue(new Error('network'));
    render(<TimeMachineOpsPage />);
    expect(await screen.findByText('运行状态暂时读取失败，稍后自动重试。')).toBeVisible();
    expect(screen.getByRole('heading', { name: /分层编号、叙事锚点与自主记忆维护/ })).toBeVisible();
  });
});
