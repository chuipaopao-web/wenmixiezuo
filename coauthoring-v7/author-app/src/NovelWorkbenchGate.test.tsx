import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NovelWorkbenchGate } from './NovelWorkbenchGate';

// OPENING-UI-02返修R2：长篇工作台门禁——加载中/读取失败/非长篇都不能先挂载可发任务的界面；
// 长篇与无类型快照的旧书放行；非长篇给诚实说明并保留开书资料入口。
type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn<FetchStub>>;

function profileResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(status === 200 ? { data: body } : body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  fetchMock = vi.fn(async () => profileResponse({ title: '测试书', workType: 'novel', openingBlueprint: {} }));
  vi.stubGlobal('fetch', fetchMock);
});

describe('NovelWorkbenchGate 长篇工作台类型门禁', () => {
  it('类型读取中显示等待提示，不挂载工作台内容', () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    render(<NovelWorkbenchGate bookId="book-1" onOpenInformation={() => {}}><div>时光机工作台</div></NovelWorkbenchGate>);
    expect(screen.getByText('正在确认本书类型与可用功能…')).toBeInTheDocument();
    expect(screen.queryByText('时光机工作台')).not.toBeInTheDocument();
  });

  it('读取失败显示可重试错误，重试成功后挂载工作台', async () => {
    let attempts = 0;
    fetchMock.mockImplementation(async () => {
      attempts += 1;
      return attempts === 1
        ? profileResponse({ error: { message: '读取失败' } }, 500)
        : profileResponse({ title: '测试书', workType: 'novel', openingBlueprint: {} });
    });
    render(<NovelWorkbenchGate bookId="book-1" onOpenInformation={() => {}}><div>时光机工作台</div></NovelWorkbenchGate>);
    expect(await screen.findByText('开书资料读取失败')).toBeInTheDocument();
    expect(screen.queryByText('时光机工作台')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    expect(await screen.findByText('时光机工作台')).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('短篇书显示尚未开放说明与开书资料入口，不挂载工作台', async () => {
    fetchMock.mockImplementation(async () => profileResponse({ title: '短篇书', workType: 'short_story', openingBlueprint: {} }));
    const onOpenInformation = vi.fn();
    render(<NovelWorkbenchGate bookId="book-1" onOpenInformation={onOpenInformation}><div>时光机工作台</div></NovelWorkbenchGate>);
    expect(await screen.findByText('短篇小说的后续创作工作台尚未开放')).toBeInTheDocument();
    expect(screen.queryByText('时光机工作台')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看开书资料' }));
    expect(onOpenInformation).toHaveBeenCalledTimes(1);
  });

  it('无类型快照的旧书按长篇放行', async () => {
    fetchMock.mockImplementation(async () => profileResponse({ title: '旧书', openingBlueprint: {} }));
    render(<NovelWorkbenchGate bookId="book-1" onOpenInformation={() => {}}><div>时光机工作台</div></NovelWorkbenchGate>);
    expect(await screen.findByText('时光机工作台')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/v7/books/book-1/book-profile', expect.objectContaining({ credentials: 'include' })));
  });
});
