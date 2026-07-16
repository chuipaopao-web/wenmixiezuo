// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../apps/web/src/app/App';
import type { WorkspaceData } from '../../../apps/web/src/lib/api/client';

const book = {
  bookId: 'book-ui-1', title: '雾钟档案', status: 'active', canonRevision: 3,
  positioningVersion: 1, updatedAt: '2026-07-16T12:00:00.000Z'
};

const chapter = {
  chapterId: 'chapter-ui-1', chapterNumber: 1, title: '雾城初响', planStatus: 'planned',
  generationStatus: 'completed', settlementStatus: 'settled',
  currentManuscriptVersionId: 'manuscript-1', canonManuscriptVersionId: 'manuscript-1'
};

const agents: WorkspaceData['agents'] = Array.from({ length: 9 }, (_, index) => ({
  agentId: `agent-${index + 1}`,
  roleKey: index === 0 ? 'editor_in_chief' : index === 1 ? 'writer' : `role-${index + 1}`,
  roleName: index === 0 ? '主编' : index === 1 ? '主笔' : `岗位${index + 1}`,
  displayName: index === 0 ? '主编' : index === 1 ? '主笔' : `岗位${index + 1}`,
  category: index < 5 ? 'core' : 'specialist',
  provider: 'local-deterministic', modelId: 'wenmai-fixture-v1', activationState: index < 5 ? 'idle' : 'standby'
}));

const workspace: WorkspaceData = {
  book, chapters: [chapter], agents,
  messageCount: 0,
  tasks: [{
    taskId: 'task-ui-1', taskType: 'chapter_creation', status: 'working', currentPhase: 'draft',
    pauseRequested: false, attemptCount: 1, assignedAgentId: 'agent-2'
  }],
  budget: {
    mode: 'standard', token_limit: 100_000, spent_tokens: 12_000, reserved_tokens: 4_000,
    cash_limit_micros: 0, spent_cash_micros: 0, status: 'active'
  },
  confirmations: { count: 0, items: [] }
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('完整创作工作台', () => {
  it('显示三栏真实状态并通过自动无障碍检查', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchRouter()));
    render(<App />);

    expect((await screen.findAllByText('雾钟档案')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('complementary', { name: '书籍与章节' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '团队与任务' })).toBeInTheDocument();
    expect(await screen.findByText('9 个岗位')).toBeInTheDocument();
    expect(screen.getByText('生成完整初稿')).toBeInTheDocument();
    expect(screen.getByText('工作中')).toBeInTheDocument();
    expect(screen.getAllByText('local-deterministic/wenmai-fixture-v1')).toHaveLength(9);

    const results = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('加载三千字正文且可进入沉浸阅读', async () => {
    const longText = '雾城的钟声穿过石墙。'.repeat(250);
    vi.stubGlobal('fetch', vi.fn(createFetchRouter(longText)));
    render(<App />);
    const chapterButton = await screen.findByRole('button', { name: /1\. 雾城初响/ });
    fireEvent.click(chapterButton);
    await waitFor(() => expect(document.querySelector('.novel-text')?.textContent).toBe(longText));
    fireEvent.click(screen.getByRole('button', { name: '进入沉浸阅读' }));
    expect(document.querySelector('.app-shell')).toHaveClass('reader-mode');
  });

  it('版权与研究入口只展示隔离后的真实摘要', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchRouter()));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '版权与研究' }));
    expect(await screen.findByRole('heading', { name: '版权与研究' })).toBeInTheDocument();
    expect(screen.getByText(/隔离原文不进入主笔上下文/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('隔离原文正文不得显示');
  });

  it('重大确认展示对象、正史版本、影响和明确决策按钮', async () => {
    const confirmationWorkspace = {
      ...workspace,
      confirmations: {
        count: 1,
        items: [{
          confirmationId: 'confirmation-ui-1', targetType: 'fact', targetId: 'fact-ui-123456',
          expectedCanonRevision: 3, scope: { relationKey: 'alive' }, impact: { blocksSettlement: true },
          createdAt: '2026-07-16T12:00:00.000Z'
        }]
      }
    };
    const fetchMock = vi.fn(createFetchRouter('正文内容', confirmationWorkspace));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(await screen.findByText('重大正史事实')).toBeInTheDocument();
    expect(screen.getByText(/绑定正史 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('查看范围与影响'));
    expect(screen.getByText(/blocksSettlement/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '明确接受' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).includes('/confirmations/confirmation-ui-1/accept') && (init as RequestInit | undefined)?.method === 'POST')).toBe(true));
  });

  it('长对话只挂载最近两百条消息并明确提示历史仍已保存', async () => {
    const messages = Array.from({ length: 500 }, (_, index) => ({
      message_id: `message-${index + 1}`,
      sender_type: index % 2 === 0 ? 'boss' as const : 'agent' as const,
      sender_agent_id: index % 2 === 0 ? null : 'agent-1',
      role_key: index % 2 === 0 ? null : 'editor_in_chief',
      model_provider: index % 2 === 0 ? null : 'local-deterministic',
      model_id: index % 2 === 0 ? null : 'wenmai-fixture-v1',
      message_type: 'text', content: `消息 ${index + 1}`, references_json: '{}',
      created_at: '2026-07-16T12:00:00.000Z'
    }));
    vi.stubGlobal('fetch', vi.fn(createFetchRouter('正文内容', { ...workspace, messageCount: messages.length }, messages)));
    render(<App />);

    expect(await screen.findByText(/当前显示最近 200 条消息/)).toHaveTextContent('更早的 300 条仍保存在本地记录中');
    expect(document.querySelectorAll('.message')).toHaveLength(200);
    expect(screen.queryByText('消息 1')).not.toBeInTheDocument();
    expect(screen.getByText('消息 500')).toBeInTheDocument();
  });
});

function createFetchRouter(chapterContent = '正文内容', workspaceData = workspace, messages: unknown[] = []) {
  return async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (path === '/health') return apiResponse({ service: 'wenmai-api', status: 'ok', releaseId: 'release-ui', schemaVersion: 7 });
    if (path === '/api/v1/books') return apiResponse([book]);
    if (path === '/api/v1/runtime/worker') return apiResponse({
      status: 'ready', worker: { workerId: 'worker-ui', heartbeatAt: new Date().toISOString(), currentTaskId: 'task-ui-1' }
    });
    if (path.endsWith('/workspace')) return apiResponse(workspaceData);
    if (path.endsWith('/messages')) return apiResponse(messages);
    if (path.endsWith('/content')) return apiResponse({
      manuscriptVersionId: 'manuscript-1', contentHash: 'hash-1', totalLength: chapterContent.length, content: chapterContent
    });
    if (path.endsWith('/copyright/summary')) return apiResponse({
      sources: { count: 1 }, structureCards: { count: 1 }, cleanroomPackages: { count: 1 }, checks: { count: 1 }, recentChecks: []
    });
    if (path.endsWith('/research/sources')) return apiResponse([{ title: '公开资料', source_status: 'provided' }]);
    if (path.endsWith('/research/claims')) return apiResponse([{ claim_text: '候选判断', candidate_status: 'candidate' }]);
    if (path.endsWith('/artifacts') || path.endsWith('/memory') || path.endsWith('/projections')) return apiResponse([]);
    if (path.includes('/confirmations/') && path.endsWith('/accept')) return apiResponse({ status: 'accepted' });
    return new Response(JSON.stringify({ error: { message: `未配置测试接口 ${path}` } }), { status: 404 });
  };
}

function apiResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: 'request-ui', version: 1 } }), {
    status: 200, headers: { 'content-type': 'application/json' }
  });
}
