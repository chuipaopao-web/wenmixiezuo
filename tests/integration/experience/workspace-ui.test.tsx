// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../apps/web/src/app/App';
import type { WorkspaceData } from '../../../apps/web/src/lib/api/client';

const book = {
  bookId: 'book-ui-1', title: '雾钟档案', status: 'active', canonRevision: 3,
  version: 2, positioningVersion: 1, updatedAt: '2026-07-16T12:00:00.000Z'
};

const secondBook = {
  bookId: 'book-ui-2', title: '北境军报', status: 'active', canonRevision: 1,
  version: 1, positioningVersion: 1, updatedAt: '2026-07-16T13:00:00.000Z'
};

const chapter = {
  chapterId: 'chapter-ui-1', chapterNumber: 1, title: '雾城初响', planStatus: 'planned',
  generationStatus: 'completed', settlementStatus: 'settled',
  currentManuscriptVersionId: 'manuscript-1', canonManuscriptVersionId: 'manuscript-1'
};

const agentRoles = [
  ['chief_editor', '主编', '貂蝉'],
  ['deputy_editor', '副编', '西施'],
  ['lead_screenwriter', '编剧', '婉儿'],
  ['second_screenwriter', '编剧', '红玉'],
  ['setting', '设定', '文姬'],
  ['lead_writer', '主笔', '秋香'],
  ['backup_writer', '副笔', '湘君'],
  ['literary_reviewer', '审校', '妲己'],
  ['experience_reviewer', '体验', '昭君'],
  ['researcher', '研究员', '道韫'],
  ['copyright', '版权', '弄玉']
] as const;

const agents: WorkspaceData['agents'] = agentRoles.map(([roleKey, roleName, displayName], index) => ({
  agentId: `agent-${index + 1}`,
  roleKey,
  roleName,
  displayName,
  category: index < 5 ? 'core' : 'specialist',
  provider: 'local-deterministic', modelId: `wenmi-fixture-v2-${roleKey}`, activationState: index < 6 ? 'idle' : 'standby',
  publicSummary: `${roleName}公开职责`, responsibilities: ['完成岗位任务'], boundaries: ['不越权修改正史'], retrievalFocus: ['当前任务证据'], outputKinds: ['结构化结果']
}));

const workspace: WorkspaceData = {
  book, chapters: [{ ...chapter, volumeId: 'volume-ui-1' }], volumes: [{ volumeId: 'volume-ui-1', volumeNumber: 1, title: '雾城卷', status: 'active', chapterCount: 1, settledCount: 1 }], agents,
  tasks: [{
    taskId: 'task-ui-1', taskType: 'chapter_creation', status: 'working', currentPhase: 'draft',
    pauseRequested: false, cancelRequested: false, attemptCount: 1, assignedAgentId: 'agent-6',
    chapterId: 'chapter-ui-1', brief: { chapterId: 'chapter-ui-1', chapterNumber: 1, batchIndex: 0 },
    checkpoint: { completedPhase: 'context' }
  }, {
    taskId: 'task-ui-2', taskType: 'discussion', status: 'queued', currentPhase: 'queued',
    pauseRequested: false, cancelRequested: false, attemptCount: 0, assignedAgentId: 'agent-3',
    chapterId: 'chapter-ui-1', brief: { chapterId: 'chapter-ui-1', chapterNumber: 1, summary: '讨论剧情转折' },
    checkpoint: {}
  }],
  budget: {
    mode: 'standard', token_limit: 100_000, spent_tokens: 12_000, reserved_tokens: 4_000,
    cash_limit_micros: 0, spent_cash_micros: 0, status: 'active'
  },
  confirmations: { count: 0, items: [] },
  localAssistant: { displayName: '小文秘书', roleName: '本地秘书', status: 'ready', summary: '接收消息、整理附件、查看任务，并把创作问题交给合适的成员。' }
};

beforeEach(() => {
  window.history.replaceState(null, '', '/?book=book-ui-1');
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('完整创作工作台', () => {
  it('服务未启动时显示中文恢复提示，不暴露Failed to fetch', async () => {
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<App />);
    expect(await screen.findByText('无法连接文秘写作服务，请重新启动应用后再试。')).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  });

  it('根入口直接进入最近书籍的统一创作台，不再经过书架或返回书架', async () => {
    window.history.replaceState(null, '', '/');
    const fetchMock = vi.fn(createFetchRouter());
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect(await screen.findByRole('complementary', { name: '书籍栏' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '创作台' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '功能栏' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '对话' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '版权与研究' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/books/book-ui-1/conversation-entry'))).toBe(false);
    expect(screen.queryByRole('button', { name: '返回书架' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes('/tasks/') && (init as RequestInit | undefined)?.method !== 'GET')).toBe(false);
  });
  it('没有书时直接显示统一创作台的新建引导', async () => {
    window.history.replaceState(null, '', '/');
    const baseRouter = createFetchRouter();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/books') return apiResponse([]);
      return baseRouter(input, init);
    }));
    render(<App />);

    expect(await screen.findByRole('heading', { name: '创建第一本书' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '新建书籍' }).length).toBeGreaterThanOrEqual(1);
  });

  it('顶部团队入口显示当前书11名真实成员状态', async () => {
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn(createFetchRouter()));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '团队' }));
    expect(await screen.findByRole('heading', { name: '团队配置' })).toBeInTheDocument();
    expect(screen.getByText('11 名成员')).toBeInTheDocument();
    expect(screen.getAllByText(/貂蝉/).length).toBeGreaterThan(0);
    expect(screen.getByText(/只显示真实任务/)).toBeInTheDocument();
  });

  it('前后端短暂版本不一致时团队页仍能打开', async () => {
    window.history.replaceState(null, '', '/');
    const baseRouter = createFetchRouter();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await baseRouter(input, init);
      const path = new URL(String(input)).pathname;
      if (path !== '/api/v1/team-template' && !path.endsWith('/team-config')) return response;
      const payload = await response.json() as { data: Record<string, unknown> };
      if (path === '/api/v1/team-template') {
        const { fullPromptAccess: _legacyMissingField, ...legacyData } = payload.data;
        return apiResponse(legacyData);
      }
      const promptPolicy = payload.data.promptPolicy as Record<string, unknown>;
      const { fullPromptAccess: _legacyMissingField, ...legacyPromptPolicy } = promptPolicy;
      return apiResponse({ ...payload.data, promptPolicy: legacyPromptPolicy });
    }));

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '团队' }));
    expect(await screen.findByRole('heading', { name: '团队配置' })).toBeInTheDocument();
    expect(screen.getByText('11 名成员')).toBeInTheDocument();
    expect(screen.getByText(/管理员尚未设置查看密码/)).toBeInTheDocument();
  });

  it('使用纯书籍左栏、顶部完整功能栏和中央内容区并通过自动无障碍检查', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchRouter()));
    render(<App />);

    expect((await screen.findAllByText('雾钟档案')).length).toBeGreaterThanOrEqual(1);
    const bookRail = screen.getByRole('complementary', { name: '书籍栏' });
    expect(screen.queryByText('小文秘书（本地秘书）')).not.toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-theme', 'sage');
    expect(document.querySelector('.app-shell')).toHaveStyle({ '--font-scale': '1.1' });

    expect(within(bookRail).queryByRole('button', { name: '返回书架' })).not.toBeInTheDocument();
    expect(within(bookRail).getByRole('button', { name: '新建书籍' })).toBeInTheDocument();
    expect(within(bookRail).getByRole('navigation', { name: '选择书籍' })).toBeInTheDocument();
    expect(within(bookRail).queryByRole('button', { name: '对话' })).not.toBeInTheDocument();
    expect(within(bookRail).queryByRole('button', { name: '版权与研究' })).not.toBeInTheDocument();

    const functionBar = screen.getByRole('navigation', { name: '功能栏' });
    for (const name of ['本书资料', '设定大纲', '当前卷纲', '事件设计', '章纲', '正文', '故事资料库', '取名']) {
      expect(within(functionBar).getByRole('button', { name })).toBeInTheDocument();
      expect(within(bookRail).queryByRole('button', { name })).not.toBeInTheDocument();
    }
    for (const name of ['团队', '任务', '灵感讨论', '设置']) {
      expect(within(functionBar).getByRole('button', { name })).toBeInTheDocument();
    }
    fireEvent.click(within(functionBar).getByRole('button', { name: '设定大纲' }));
    expect(within(functionBar).getByRole('button', { name: '设定大纲' })).toHaveAttribute('aria-current', 'page');
    expect(document.querySelector('.ios-book-sidebar')).toBeInTheDocument();
    expect(document.querySelector('.ios-commandbar')).toBeInTheDocument();
    expect(document.querySelector('.ios-function-bar')).toBeInTheDocument();
    expect(document.querySelector('.task-center')).toBeNull();
    expect(document.querySelector('.chapter-tree')).toBeNull();
    expect(document.querySelector('.workspace-tabs')).toBeNull();
    expect(document.querySelector('.team-rail')).toBeNull();
    expect(document.querySelector('.topbar-book-summary')).toBeNull();

    const results = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('点击左侧书籍只切换当前书，顶部功能保持在原页面', async () => {
    const baseRouter = createFetchRouter();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname === '/api/v1/books') return Promise.resolve(apiResponse([book, secondBook]));
      return baseRouter(input, init);
    }));
    render(<App />);
    const functionBar = await screen.findByRole('navigation', { name: '功能栏' });
    fireEvent.click(within(functionBar).getByRole('button', { name: '章纲' }));
    expect(within(functionBar).getByRole('button', { name: '章纲' })).toHaveAttribute('aria-current', 'page');

    const bookRail = screen.getByRole('complementary', { name: '书籍栏' });
    fireEvent.click(within(bookRail).getByRole('button', { name: /北境军报/ }));
    await waitFor(() => expect(screen.getByLabelText('当前功能：章纲')).toBeInTheDocument());
    expect(within(functionBar).getByRole('button', { name: '章纲' })).toHaveAttribute('aria-current', 'page');
    expect(within(bookRail).getByRole('button', { name: /北境军报/ })).toHaveAttribute('aria-current', 'page');
  });
  it('团队页展示公开岗位配置并保存书籍级补充提示词', async () => {
    const fetchMock = vi.fn(createFetchRouter());
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findAllByText('雾钟档案');
    fireEvent.click(screen.getByRole('button', { name: '团队' }));
    const team = (await screen.findByRole('heading', { name: '团队配置' })).closest('section') as HTMLElement;
    expect(within(team).getByText('11 名成员')).toBeInTheDocument();
    fireEvent.click(within(team).getByRole('button', { name: /貂蝉（主编）/ }));
    expect(within(team).getByText('岗位职责')).toBeInTheDocument();
    expect(within(team).getByText('负责什么')).toBeInTheDocument();
    expect(team).not.toHaveTextContent('边界');
    expect(within(team).getByText('岗位表达')).toBeInTheDocument();
    expect(within(team).getByText(/貂蝉是团队中的主编/)).toBeInTheDocument();
    expect(within(team).queryByText('受保护的完整运行提示词')).not.toBeInTheDocument();
    fireEvent.change(within(team).getByLabelText('完整提示词查看密码'), { target: { value: 'test-prompt-view-password' } });
    fireEvent.click(within(team).getByRole('button', { name: '解锁查看' }));
    expect(await within(team).findByText('受保护的完整运行提示词')).toBeInTheDocument();
    const editor = within(team).getByRole('textbox', { name: '貂蝉（主编）的本书岗位补充要求' });
    fireEvent.change(editor, { target: { value: '讨论时先指出最大风险，再给推荐方向。' } });
    fireEvent.click(within(team).getByRole('button', { name: '保存提示词' }));
    await within(team).findByText('已保存，新任务开始生效。');
    expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).endsWith('/agents/agent-1/prompt-preference')
      && (init as RequestInit | undefined)?.method === 'PUT'
      && String((init as RequestInit).body).includes('讨论时先指出最大风险')
    )).toBe(true);
  });

  it('把应用壳固定在动态视口并只让内容区独立滚动', () => {
    const css = readFileSync(resolve('apps/web/src/app/app.css'), 'utf8');
    expect(css).toMatch(/html\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/su);
    expect(css).toMatch(/#root\s*\{[^}]*height:\s*100dvh[^}]*overflow:\s*hidden/su);
    expect(css).toMatch(/\.app-shell\s*\{[^}]*height:\s*100dvh[^}]*max-height:\s*100dvh[^}]*overflow:\s*hidden/su);
    expect(css).toMatch(/\.creation-desk-body\s*\{[^}]*overflow:\s*auto/su);
    expect(css).not.toMatch(/\.conversation-stream|\.composer-wrap|\.chat-workspace/su);
    expect(css).toMatch(/\.manuscript-view,[^}]*\.reference-view,[^}]*\.task-workspace\s*\{[^}]*overflow:\s*auto/su);
    expect(css).toMatch(/\.manuscript-workspace\s*\{[^}]*grid-template-columns:\s*clamp\(176px,\s*13vw,\s*224px\)\s+minmax\(0,\s*1fr\)/su);
    expect(css).toMatch(/\.manuscript-view\s*\{[^}]*padding:\s*0\s+clamp\(10px,\s*1\.4vw,\s*22px\)/su);
    expect(css).toMatch(/\.manuscript-editor-textarea\s*\{[^}]*width:\s*100%[^}]*min-height:\s*max\(calc\(100dvh\s*-\s*300px\),\s*520px\)/su);
    expect(css).toMatch(/\.app-shell\.unified-desk\s*\{[^}]*grid-template-areas:\s*"sidebar commandbar"\s*"sidebar functions"\s*"sidebar main"/su);
    expect(css).toMatch(/\.ios-function-bar\s*\{[^}]*overflow:\s*visible/su);
    expect(css).toMatch(/\.ios-book-sidebar\s*\{[^}]*backdrop-filter:\s*saturate\(170%\)\s+blur\(28px\)/su);
    expect(css).toContain('#0a84ff');
  });

  it('合并后的故事资料库和规划只显示作者可读中文，不暴露JSON、内部ID与协议枚举', async () => {
    const baseRouter = createFetchRouter();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path.endsWith('/projections')) return apiResponse([{
        projection_id: 'projection-internal-1', owner_id: 'owner-internal', book_id: 'book-internal',
        projection_type: 'emotion', track: 'actual', chapter_number: 12, canon_revision: 3,
        content_json: JSON.stringify({
          scopeLabel: '第12章',
          emotionFlow: ['紧张', '平静'],
          baseline: '平'
        }),
        source_ids_json: JSON.stringify(['source-internal-1']), rebuilt_at: '2026-07-25T01:00:00.000Z'
      }]);
      return baseRouter(input, init);
    }));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '故事资料库' }));
    fireEvent.click(await screen.findByRole('button', { name: '关系与轨迹' }));
    fireEvent.click(await screen.findByRole('button', { name: '情绪' }));
    expect(await screen.findByText('第12章')).toBeInTheDocument();
    expect(screen.getByText('紧张 → 平静')).toBeInTheDocument();
    expect(screen.getByText('平')).toBeInTheDocument();
    expect(screen.queryByText(/projection-internal|source-internal|content_json|projection_type/u)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '本书资料' }));
    expect(await screen.findByText('作品定位与全书框架')).toBeInTheDocument();
    expect(screen.queryByText('sourceStatus')).not.toBeInTheDocument();
    expect(screen.queryByText('explicit')).not.toBeInTheDocument();
    expect(screen.getAllByText('明确确认').length).toBeGreaterThan(0);

    expect(screen.queryByRole('button', { name: '版权与研究' })).not.toBeInTheDocument();
  });

  it('把归档书移出活动书籍并放入左栏可恢复区域', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchRouter('正文内容', { ...workspace, book: { ...book, status: 'archived' } })));
    render(<App />);
    const archiveToggle = await screen.findByText('已归档书籍 · 1');
    expect(screen.queryByRole('navigation', { name: '当前书创作流程' })).not.toBeInTheDocument();
    fireEvent.click(archiveToggle);
    expect(screen.getByText('雾钟档案')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢复' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '彻底删除' })).toBeInTheDocument();
    expect(screen.queryByText('archived')).not.toBeInTheDocument();
  });

  it('只用作品定位建书，并把人物、设定和剧情留到后续阶段', async () => {
    window.history.replaceState(null, '', '/');
    const fetchMock = vi.fn(createFetchRouter());
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click((await screen.findAllByRole('button', { name: '新建书籍' }))[0]!);
    const dialog = screen.getByRole('dialog', { name: '创建一本新书' });
    expect(within(dialog).getByRole('navigation', { name: '开书步骤' })).toBeInTheDocument();
    expect(within(dialog).queryByText('主要选择 + 其他自由发挥')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '下一步' }));

    const storyDirection = '林舟收到一封来自未来的失踪通知，被迫调查城市记忆被改写的原因；她要找回失踪的姐姐，同时阻止下一次改写吞掉整座旧城。';
    fireEvent.change(within(dialog).getByLabelText('书名'), { target: { value: '长安簪影' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: '女频' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: '选择作品分类：现言脑洞' }));
    fireEvent.change(within(dialog).getByLabelText('故事方向'), { target: { value: storyDirection } });
    fireEvent.click(within(dialog).getByRole('button', { name: '第4步：题材与边界' }));

    expect(within(dialog).getByText('主要选择 + 其他自由发挥')).toBeInTheDocument();
    expect(within(dialog).getByText(/标签只确定主要方向/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('目标读者')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('目标读者推荐')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('查看和调整主要标签'));
    await waitFor(() => expect(within(dialog).getByText(/已自动推荐8个；当前共选 8 个/)).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('button', { name: '取消主要标签：群像' }));
    expect(within(dialog).getByText(/当前共选 7 个/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '选择主要标签：群像' }));
    fireEvent.change(within(dialog).getByLabelText('自定义标签'), { target: { value: '轻悬疑' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '添加自定义标签' }));
    expect(within(dialog).getByText('感情与关系')).toBeInTheDocument();
    expect(within(dialog).getByText('主角体验')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '选择必须遵守：不写后宫' }));
    fireEvent.change(within(dialog).getByLabelText('自定义必须遵守'), { target: { value: '不靠误会强推剧情' } });
    expect(within(dialog).getByText(/当前共选 8 个/)).toBeInTheDocument();
    expect((await axe.run(dialog, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);

    fireEvent.click(within(dialog).getByRole('button', { name: '第3步：初始主角' }));
    expect(dialog.querySelector('#opening-protagonist-name')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '为角色1取名' }));
    const namingDialog = await screen.findByRole('dialog', { name: '角色1取名助手' });
    const firstCandidate = within(namingDialog).getAllByRole('button', { name: /^填入名字：/ })[0]!;
    fireEvent.click(firstCandidate);
    expect(dialog.querySelector<HTMLInputElement>('#opening-protagonist-name')?.value).not.toBe('');
    fireEvent.click(within(namingDialog).getByRole('button', { name: '完成' }));
    expect(within(dialog).getByRole('button', { name: /增加角色/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('option', { name: '女主' })).toBeInTheDocument();
    expect(within(dialog).queryByText('表达调色板')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('世界观背景')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('第一阶段起始剧情')).not.toBeInTheDocument();
    fireEvent.change(dialog.querySelector('#opening-protagonist-name')!, { target: { value: '林舟' } });
    fireEvent.change(dialog.querySelector('#opening-protagonist-age')!, { target: { value: '十八岁' } });
    fireEvent.change(dialog.querySelector('#opening-protagonist-background')!, { target: { value: '普通玩家' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '选择角色性格：冷静' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '第4步：题材与边界' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '创建并进入设定' }));
    expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).endsWith('/api/v1/books/book-ui-1/messages') && (init as RequestInit | undefined)?.method === 'POST'
    )).toBe(false);
    await waitFor(() => expect(screen.getByRole('button', { name: '设定大纲' })).toHaveClass('active'));
  });

  it('空正文页以第1章占位并可按章建立目录，不会创建整本输入框', async () => {
    const emptyWorkspace: WorkspaceData = {
      ...workspace,
      chapters: [],
      volumes: [],
      tasks: []
    };
    const fetchMock = vi.fn(createFetchRouter('', emptyWorkspace));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '正文' }));
    expect(await screen.findByRole('button', { name: /第1章/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('已有正文')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /第1章.*等待导入作者原文/ }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/volumes') && (init as RequestInit | undefined)?.method === 'POST')).toBe(true);
      const request = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/chapters') && (init as RequestInit | undefined)?.method === 'POST');
      expect(request).toBeDefined();
      expect(JSON.parse(String((request![1] as RequestInit).body))).toEqual({ volumeId: 'volume-ui-created', chapterNumber: 1, title: '第1章' });
    });
  });

  it('计划章无正文时直接显示空编辑器和动作状态，并以空基线保存第一稿', async () => {
    const plannedWorkspace: WorkspaceData = {
      ...workspace,
      chapters: [{ ...chapter, volumeId: 'volume-ui-1', generationStatus: 'not_started', settlementStatus: 'unsettled', currentManuscriptVersionId: null, canonManuscriptVersionId: null }],
      tasks: [],
      volumes: [{ ...workspace.volumes![0]!, settledCount: 0 }]
    };
    const fetchMock = vi.fn(createFetchRouter('', plannedWorkspace));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '正文' }));

    expect(await screen.findByRole('button', { name: /1\. 雾城初响/ })).toHaveClass('active');
    const editor = await screen.findByRole('textbox', { name: '正文编辑器' });
    expect(editor).toHaveValue('');
    expect(screen.getByRole('button', { name: '优化表达' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '自然化（去AI腔）' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '自定义优化' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'AI点评' })).toBeDisabled();
    expect(screen.getByText(/先输入或导入当前章并保存作者原文/)).toBeInTheDocument();

    fireEvent.change(editor, { target: { value: '这是作者从空白章节写下的第一稿。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存原文' }));
    await waitFor(() => {
      const request = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/manuscripts/owner-drafts') && (init as RequestInit | undefined)?.method === 'POST');
      expect(request).toBeDefined();
      expect(JSON.parse(String((request![1] as RequestInit).body))).toMatchObject({ baseManuscriptVersionId: null, content: '这是作者从空白章节写下的第一稿。' });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '优化表达' })).toBeEnabled());
    expect(screen.getByRole('button', { name: '自然化（去AI腔）' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '自定义优化' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'AI点评' })).toBeEnabled();
  });

  it('独立版权页已经移除，但创作台不再暴露受保护原文', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchRouter()));
    render(<App />);
    await screen.findByRole('heading', { name: '创作台' });
    expect(screen.queryByRole('button', { name: '版权与研究' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('隔离原文正文不得显示');
  });
  it('重大确认展示对象、正史版本、影响和明确决策按钮', async () => {
    window.history.replaceState(null, '', '/');
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

    fireEvent.click(await screen.findByRole('button', { name: '任务' }));
    expect(await screen.findByText('重要正式事实')).toBeInTheDocument();
    expect(screen.getByText(/对应正式内容版本 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('查看范围与影响'));
    expect(screen.getByText('可能影响')).toBeInTheDocument();
    expect(screen.getByText('是否影响定稿')).toBeInTheDocument();
    expect(screen.queryByText(/blocksSettlement|relationKey/u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '明确接受' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).includes('/confirmations/confirmation-ui-1/accept') && (init as RequestInit | undefined)?.method === 'POST')).toBe(true));
  });

});

function createFetchRouter(chapterContent = '正文内容', workspaceData = workspace) {
  const protagonistDashboard = { profiles: [{
    profileId: 'protagonist-ui-1', entityId: 'entity-1', displayName: '张三', isPrimary: true, status: 'active', historyCount: 2,
    current: [
      { entryId: 'state-ui-1', profileId: 'protagonist-ui-1', category: 'army', logicalKey: 'army_步兵数量', label: '步兵数量', valueType: 'resource', value: 1200, unit: '人', stateStatus: 'active', authorityLayer: 'canon', effectiveChapterNumber: 1, revision: 2, note: null },
      { entryId: 'state-ui-2', profileId: 'protagonist-ui-1', category: '契约伙伴', logicalKey: 'spirit_deer', label: '白鹿', valueType: 'text', value: '共生契约', unit: null, stateStatus: 'active', authorityLayer: 'canon', effectiveChapterNumber: 1, revision: 1, note: null },
      { entryId: 'state-ui-3', profileId: 'protagonist-ui-1', category: 'unclassified', logicalKey: 'soul_mark', label: '灵魂印记', valueType: 'text', value: '初醒', unit: null, stateStatus: 'active', authorityLayer: 'canon', effectiveChapterNumber: 1, revision: 1, note: null },
      { entryId: 'state-ui-4', profileId: 'protagonist-ui-1', category: 'physical_injury', logicalKey: 'neck_injury', label: '后颈伤势', valueType: 'text', value: 'posterior_neck_pain_and_visual_flash', unit: null, stateStatus: 'active', authorityLayer: 'canon', effectiveChapterNumber: 1, revision: 1, note: null }
    ],
    pending: []
  }] };
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (path === '/api/v1/runtime/session') return apiResponse({ authenticated: true, expiresInSeconds: 1800 });
    if (path === '/api/v1/capabilities') return apiResponse({
      releaseId: 'release-ui', checkedAt: new Date().toISOString(),
      runtime: { platform: 'win32', architecture: 'x64', nodeVersion: process.version, logicalCpuCount: 16, totalMemoryBytes: 1, freeMemoryBytes: 1, dataVolumeFreeBytes: 1 },
      sqlite: { version: '3.50.0', foreignKeys: true, trustedSchema: false, json: true, fts5: true },
      dependencies: [], modelAssets: [],
      modelRuntime: {
        requestedMode: 'subscription-plan', activeMode: 'subscription-plan', strictPlanOnly: true,
        cashFallbackAllowed: false, missingCredentials: [],
        profiles: [
          { provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol', plan: 'codex', roles: ['chief_editor', 'writer'], credentialConfigured: true },
          { provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-pro', plan: 'coding', roles: ['screenwriter', 'copyright'], credentialConfigured: true },
          { provider: 'volcengine-ark-agent-plan', modelId: 'glm-5-2', plan: 'agent', roles: ['worldbuilder', 'researcher'], credentialConfigured: true },
          { provider: 'volcengine-ark-agent-plan', modelId: 'kimi-k2.6', plan: 'agent', roles: ['reviewer', 'line_editor'], credentialConfigured: true },
          { provider: 'volcengine-ark-agent-plan', modelId: 'doubao-seed-2-0-pro-260215', plan: 'agent', roles: ['reader_experience'], credentialConfigured: true }
        ]
      },
      degradation: { active: false, missingCapabilities: [], vectorSearchAvailable: true, localModelAssetsReady: true }
    });
    if (path === '/health') return apiResponse({
      service: 'wenmi-api', status: 'ok', releaseId: 'release-ui', schemaVersion: 9,
      modelRuntime: {
        requestedMode: 'subscription-plan', activeMode: 'subscription-plan', strictPlanOnly: true,
        cashFallbackAllowed: false, missingCredentials: [],
        profiles: [
          { provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol', plan: 'codex', roles: ['chief_editor', 'writer'], credentialConfigured: true },
          { provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-pro', plan: 'coding', roles: ['screenwriter', 'copyright'], credentialConfigured: true },
          { provider: 'volcengine-ark-agent-plan', modelId: 'glm-5-2', plan: 'agent', roles: ['worldbuilder', 'researcher'], credentialConfigured: true },
          { provider: 'volcengine-ark-agent-plan', modelId: 'kimi-k2.6', plan: 'agent', roles: ['reviewer', 'line_editor'], credentialConfigured: true },
          { provider: 'volcengine-ark-agent-plan', modelId: 'doubao-seed-2-0-pro-260215', plan: 'agent', roles: ['reader_experience'], credentialConfigured: true }
        ]
      }
    });
    if (path === '/api/v1/books') return apiResponse([workspaceData.book]);
    if (path === '/api/v1/opening-taxonomy') return apiResponse({
      version: 'fanqie-public-map-2026-07-23-v1', sourceLabel: '番茄小说公开分类本地映射', sourceUrl: 'https://fanqienovel.com/', updatedAt: '2026-07-23',
      notice: '主要选择只定方向，其他元素可随剧情自由创作。',
      categories: [
        { key: 'male-fantasy-brain', name: '玄幻脑洞', channel: 'male', description: '男频玄幻脑洞', recommendedMainTags: ['玄幻', '脑洞'] },
        { key: 'female-modern-brain', name: '现言脑洞', channel: 'female', description: '女频现言脑洞', recommendedMainTags: ['现言', '脑洞'] }
      ],
      mainTags: ['玄幻', '现言', '脑洞', '悬疑', '成长'], auxiliaryTags: ['职场成长'], storyTraits: ['群像', '感情细腻'], personalityOptions: ['冷静', '敏锐'],
      boundaryGroups: [
        { name: '感情与关系', description: '关系走向', options: ['不写后宫', '不写多角恋'] },
        { name: '主角体验', description: '主角底线', options: ['不虐主', '不降智'] },
        { name: '内容尺度', description: '额外尺度', options: ['不写露骨情色'] },
        { name: '结构与结局', description: '结局底线', options: ['不写开放式结局'] }
      ]
    });
    if (path === '/api/v1/opening-synopsis/analyze') return apiResponse({
      schemaVersion: 'opening-synopsis-suggestions-v1',
      analysisMode: 'local-deterministic',
      taxonomyVersion: 'fanqie-public-map-2026-07-23-v1',
      synopsisLength: JSON.parse(String(init?.body ?? '{}')).synopsis?.length ?? 0,
      suggestions: {
        title: '北境军报',
        channel: 'male',
        categoryKey: 'male-fantasy-brain',
        protagonist: {
          role: 'male_lead', name: '陆沉', age: '十八岁', background: '边军斥候。', personalities: ['冷静', '敏锐']
        },
        worldBackground: '城邦以军功与盟约维持秩序。',
        openingBackground: '天安城拒绝缴纳边境军费。',
        stageOne: {
          start: '陆沉发现伪造军令。',
          development: '他阻止第一次宣战。',
          end: '他查出军令来自城内权臣。'
        },
        fullBookOutline: '陆沉调查城邦战争规则，最终重建联盟。',
        initialMap: '天安城北门与边军大营。',
        mainTags: ['玄幻', '脑洞', '成长'],
        auxiliaryTags: [],
        storyTraits: ['群像'],
        mustFollow: ['不写后宫']
      },
      recognizedFields: ['书名', '创作频道', '作品分类', '初始主角', '世界观背景', '故事起始背景', '第一阶段起始剧情', '第一阶段发展剧情', '第一阶段结束剧情', '全书简介', '初始地图', '主要标签', '必须遵守'],
      unresolvedFields: [],
      evidence: [{ field: '书名', excerpt: '北境军报' }]
    });
    if (path === '/api/v1/books/drafts') return apiResponse({ draftId: 'draft-ui-1', version: 1 });
    if (path === '/api/v1/book-drafts/draft-ui-1/confirm') return apiResponse({ bookId: workspaceData.book.bookId });
    if (path === `/api/v1/books/${workspaceData.book.bookId}/archive`) return apiResponse({ ...workspaceData.book, status: 'archived', version: workspaceData.book.version + 1 });
    if (path === `/api/v1/books/${workspaceData.book.bookId}/restore`) return apiResponse({ ...workspaceData.book, status: 'active', version: workspaceData.book.version + 1 });
    if (path === `/api/v1/books/${workspaceData.book.bookId}/purge`) return apiResponse({ bookId: workspaceData.book.bookId, status: 'purged', tombstoneWritten: true });
    if (path === `/api/v1/books/${workspaceData.book.bookId}/author-attachments` && init?.method === 'POST') return apiResponse({
      attachmentId: 'attachment-ui-1', originalName: 'plot.txt', mediaKind: 'text', mimeType: 'text/plain', sizeBytes: 21,
      parseStatus: 'parsed', parsedCharCount: 7, parseError: null, lifecycleLayer: 'temporary', createdAt: '2026-07-16T12:00:00.000Z'
    });
    if (path.endsWith('/author-attachments/attachment-ui-1/discard')) return apiResponse({ attachmentId: 'attachment-ui-1', parseStatus: 'discarded' });
    if (path === '/api/v1/runtime/worker') return apiResponse({
      status: 'ready', worker: { workerId: 'worker-ui', heartbeatAt: new Date().toISOString(), currentTaskId: 'task-ui-1' }
    });
    if (path === '/api/v1/operations/status') return apiResponse({ releaseId: 'release-ui', schemaVersion: 18, disk: { totalBytes: 1000, freeBytes: 800 }, queue: { queued: 0, working: 1, blocked: 0 }, projection: { status: 'ready' }, latestBackup: null, portability: { completed: 0, failed: 0 }, diagnostics: { telemetrySent: false, secretsIncluded: false, listeningHost: '127.0.0.1' } });
    if (path === '/api/v1/task-center') return apiResponse({
      books: [{
        book: workspaceData.book,
        chapters: workspaceData.chapters,
        agents: workspaceData.agents,
        tasks: workspaceData.tasks,
        budget: workspaceData.budget,
        confirmations: workspaceData.confirmations
      }]
    });
    if (path.endsWith('/workspace')) return apiResponse(workspaceData);
    if (path === '/api/v1/team-template') return apiResponse({
      fullPromptAccess: { configured: true, passwordProtected: true },
      members: agents.map((agent, index) => ({
        roleTemplateId: `role-template-${agent.roleKey}`,
        roleKey: agent.roleKey,
        memberName: agent.displayName,
        shortTitle: agent.roleName,
        category: agent.category,
        publicSummary: agent.publicSummary,
        responsibilities: agent.responsibilities,
        boundaries: agent.boundaries,
        retrievalFocus: agent.retrievalFocus,
        outputKinds: agent.outputKinds,
        defaultActivation: index < 6 ? 'resident' : 'standby',
        defaultModel: index === 0
          ? { provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol', plan: 'codex' }
          : { provider: agent.provider, modelId: agent.modelId, plan: 'deterministic' },
        roleStatement: `${agent.displayName}是团队中的${agent.roleName}，负责完成岗位任务。`
      }))
    });
    if (path.endsWith('/team-config')) return apiResponse({
      members: agents.map((agent) => ({
        ...agent,
        roleStatement: `${agent.displayName}是团队中的${agent.roleName}，负责完成岗位任务。`,
        promptPreference: {
          promptPreferenceId: null, agentId: agent.agentId, version: 0, content: '', createdAt: null
        }
      })),
      promptPolicy: {
        editableLabel: '本书岗位补充要求',
        maxChars: 4000,
        priority: '软性要求不会覆盖系统硬约束、事实证据、正史、安全规则和输出格式。',
        fullPromptAccess: { configured: true, passwordProtected: true }
      }
    });
    if (path === '/api/v1/prompt-view' && init?.method === 'POST') {
      const payload = JSON.parse(String(init.body)) as { roleKey: string };
      return apiResponse({
        roleKey: payload.roleKey,
        identity: '貂蝉（主编）',
        note: '后端实际使用的稳定岗位系统提示词。',
        variants: [{ purpose: 'discussion', label: '讨论与规划', prompt: '受保护的完整运行提示词' }]
      });
    }
    if (path.endsWith('/prompt-preference') && init?.method === 'PUT') {
      const payload = JSON.parse(String(init.body)) as { expectedVersion: number; content: string };
      const agentId = path.split('/').at(-2) ?? '';
      return apiResponse({
        promptPreferenceId: 'preference-ui-1', agentId,
        version: payload.expectedVersion + 1, content: payload.content,
        createdAt: '2026-07-26T12:00:00.000Z'
      });
    }
    if (path === `/api/v1/books/${workspaceData.book.bookId}/volumes` && init?.method === 'POST') {
      return apiResponse({ volumeId: 'volume-ui-created' });
    }
    if (path === `/api/v1/books/${workspaceData.book.bookId}/chapters` && init?.method === 'POST') {
      const payload = JSON.parse(String(init.body)) as { volumeId: string; chapterNumber: number; title: string };
      return apiResponse({
        ...chapter,
        chapterId: `chapter-ui-created-${payload.chapterNumber}`,
        volumeId: payload.volumeId,
        chapterNumber: payload.chapterNumber,
        title: payload.title,
        generationStatus: 'not_started',
        settlementStatus: 'unsettled',
        currentManuscriptVersionId: null,
        canonManuscriptVersionId: null
      });
    }
    if (path.includes('/volumes/') && path.endsWith('/chapters')) return apiResponse({
      items: workspaceData.chapters,
      total: workspaceData.chapters.length,
      offset: Number(url.searchParams.get('offset') ?? 0),
      limit: Number(url.searchParams.get('limit') ?? 80)
    });
    if (path.endsWith('/workflow')) return apiResponse({
      ownerId: 'owner-ui', bookId: workspaceData.book.bookId, stage: 'setting_confirmed', planningVersion: 2,
      activeVolumePlanRef: null, activeEventRef: null, frozenChapterOutlineRefs: [],
      waitingTaskId: null, blockingReason: null, updatedAt: '2026-08-08T12:00:00.000Z'
    });
    if (path.endsWith('/planning-templates')) return apiResponse({
      contractVersion: 1, registryVersion: 1, registryHash: 'sha256:' + '1'.repeat(64), scope: 'volume',
      templates: [{
        templateKey: 'volume-escalating-goals', templateVersion: 1, contentHash: 'sha256:' + '2'.repeat(64),
        scope: 'volume', publicTitle: '解决一个麻烦，又引出更大的目标',
        publicExplanation: '每次解决都改变人物状态并暴露更大的问题。',
        fitConditions: ['持续推进'], knownRisks: ['不能只换更强敌人'], authorQuestions: ['这次结果改变了什么？'],
        beats: [{ beatId: 'cause', publicFunction: '先解决眼前问题', expectedChange: '人物状态发生变化', optional: false, order: 1 }],
        previewPrompt: '按因果推进', recommended: true
      }],
      alternativeChoices: [
        { mode: 'custom', publicTitle: '按我的想法推进', publicExplanation: '不套系统节奏。' },
        { mode: 'none', publicTitle: '暂时不选', publicExplanation: '让因果自然决定。' }
      ]
    });
    if (path.endsWith('/volume-plans') && init?.method !== 'POST') return apiResponse([]);
    if (path.endsWith('/author-planning-inputs') && init?.method !== 'POST') return apiResponse([]);
    if (path.endsWith('/setting-baseline/readiness')) return apiResponse({
      ready: false,
      missing: ['creative-concept', 'reader-promise', 'era', 'protagonist', 'motivation', 'must-follow', 'game-entry', 'player-npc', 'game-panel', 'class-skill', 'loot', 'history-baseline', 'divergence'],
      unresolved: [],
      required: ['creative-concept', 'reader-promise', 'era', 'protagonist', 'motivation', 'must-follow', 'game-entry', 'player-npc', 'game-panel', 'class-skill', 'loot', 'history-baseline', 'divergence'],
      recommended: ['theme-intent', 'differentiator', 'tone-boundary', 'geography', 'strength-flaw', 'supporting', 'relations', 'open', 'intentional-unknown', 'levels', 'costs', 'abilities', 'equipment', 'quest-instance', 'ranking', 'governance', 'history', 'class', 'culture', 'politics-military', 'technology-spread', 'historical-names'],
      profileKey: 'game+history',
      profileLabel: '游戏竞技＋历史古代'
    });
    if (path.endsWith('/setting-outline-workspace/creative-concept/collaboration')) return apiResponse({
      item: {
        itemKey: 'creative-concept', groupTitle: '作品策划', label: '核心看点',
        prompt: '这本书最吸引人的地方是什么，为什么读者愿意一直看下去？', sourceLabel: '通用',
        status: '待讨论', custom: false, sortOrder: 0, content: null,
        sourceDiscussionId: null, sourceDecisionId: null, candidateAt: null, confirmedAt: null,
        updatedAt: '2026-08-01T12:00:00.000Z'
      },
      panel: null, revisionTask: null, historyCount: 0,
      impact: { changesCanon: false, changesManuscript: false, formalVersionTiming: 'setting_baseline_confirmation' }
    });
    if (path.endsWith('/setting-outline-workspace') && init?.method !== 'PUT') return apiResponse([]);
    if (path.endsWith('/setting-outline-workspace/initialize') && init?.method === 'POST') {
      const payload = JSON.parse(String(init.body)) as { items: Array<Record<string, unknown>> };
      return apiResponse(payload.items.map((item) => ({
        ...item,
        status: '待讨论',
        content: null,
        custom: false,
        sourceDiscussionId: null,
        sourceDecisionId: null,
        confirmedAt: null,
        updatedAt: '2026-08-01T12:00:00.000Z'
      })));
    }
    if (path.includes('/setting-outline-workspace/') && init?.method === 'PUT') {
      const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
      return apiResponse({
        itemKey: decodeURIComponent(path.split('/').at(-1) ?? ''),
        ...payload,
        updatedAt: '2026-07-27T12:00:00.000Z'
      });
    }
    if (path.endsWith('/manuscripts/owner-drafts') && init?.method === 'POST') {
      const payload = JSON.parse(String(init.body)) as { baseManuscriptVersionId: string | null };
      return apiResponse({ manuscriptVersionId: 'manuscript-owner-2', parentVersionId: payload.baseManuscriptVersionId, contentHash: 'hash-owner-2', wordCount: 8, status: 'candidate', unchanged: false });
    }
    if (path.endsWith('/manuscripts/current/withdraw') && init?.method === 'POST') {
      const payload = JSON.parse(String(init.body)) as { expectedManuscriptVersionId: string };
      return apiResponse({
        withdrawnManuscriptVersionId: payload.expectedManuscriptVersionId,
        currentManuscriptVersionId: null,
        retainedInHistory: true
      });
    }
    if (path.endsWith('/rewrite') && init?.method === 'POST') return apiResponse({ taskId: 'task-rewrite-1', operation: 'rewrite_existing', manuscriptVersionId: 'manuscript-owner-2' });
    if (path.endsWith('/finalize') && init?.method === 'POST') return apiResponse({ taskId: 'task-review-1', operation: 'review_existing' });
    if (path.endsWith('/content')) {
      const activeChapter = workspaceData.chapters.find((item) => path.includes(`/chapters/${item.chapterId}/`));
      if (activeChapter?.currentManuscriptVersionId === null && activeChapter.canonManuscriptVersionId === null) {
        return new Response(JSON.stringify({ error: { message: '章节尚无可读取的正文或越权' } }), { status: 404, headers: { 'content-type': 'application/json' } });
      }
      return apiResponse({
        manuscriptVersionId: activeChapter?.currentManuscriptVersionId ?? activeChapter?.canonManuscriptVersionId ?? 'manuscript-1',
        contentHash: 'hash-1', totalLength: chapterContent.length, content: chapterContent
      });
    }
    if (/\/chapters\/chapter-ui-1$/u.test(path)) return apiResponse({
      chapter, manuscripts: [], facts: [], reviews: [], production: {
        writingOrders: [{ objective: '让钟声第一次改变主角选择', version: 1, canon_revision: 2, status: 'active' }], reviewPanels: [], approvalGates: [],
        reviewReports: [
          { review_report_id: 'report-fact', reviewer_role: 'fact', status: 'completed', provider: 'volcengine-ark-agent-plan', model_id: 'glm-5-2', input_tokens: 3200, report_json: JSON.stringify({ verdict: 'pass', summary: '事实与前文一致', issues: [], scores: { continuity: 95 } }) },
          { review_report_id: 'report-literary', reviewer_role: 'literary', status: 'completed', provider: 'volcengine-ark-agent-plan', model_id: 'kimi-k2.6', input_tokens: 3200, report_json: JSON.stringify({ verdict: 'rewrite', summary: '一处表达过于模板化', issues: [{ location: '第3段', issueType: 'ai_style', severity: 'minor', evidence: '连续同句式', requiredAction: '定点调整句式' }], scores: { literary: 88 }, aiStyle: { riskScore: 18, flaggedParagraphCount: 1, totalParagraphCount: 10, flaggedParagraphRatio: 0.1, isAuthorshipProbability: false, evidence: ['第3段'] } }) },
          { review_report_id: 'report-experience', reviewer_role: 'experience', status: 'completed', provider: 'volcengine-ark-agent-plan', model_id: 'doubao', input_tokens: 3200, report_json: JSON.stringify({ verdict: 'pass', summary: '追读动力清晰', issues: [], scores: { engagement: 91 }, politicalRisk: { level: 'none' }, sexualContentRisk: { level: 'none' } }) }
        ]
      }
    });
    if (path.endsWith('/copyright/summary')) return apiResponse({
      sources: { count: 1 }, structureCards: { count: 1 }, cleanroomPackages: { count: 1 }, checks: { count: 1 }, recentChecks: []
    });
    if (path.endsWith('/research/sources')) return apiResponse([{ title: '公开资料', source_status: 'provided' }]);
    if (path.endsWith('/research/claims')) return apiResponse([{ claim_text: '候选判断', candidate_status: 'candidate' }]);
    if (path.endsWith('/artifacts')) return apiResponse([
      { artifact_id: 'story-1', artifact_type: 'story_bible', title: '故事圣经', status: 'active', version: 1, active_version_id: 'story-version-1', active_version_status: 'active', active_content: {
        title: '雾钟档案',
        positioning: { genre: { value: '游戏历史', sourceStatus: 'explicit' }, audience: { value: '长篇成长读者', sourceStatus: 'explicit' } },
        mainPlot: { confirmed: { summary: '守住雾城并查明钟声来源' }, candidates: [] },
        characters: ['张三'],
        worldView: '钟声会短暂揭示未来碎片',
        powerSystem: '军功与精神力双轨成长',
        equipmentTiers: ['凡铁', '铭文', '王器'],
        worldRules: ['钟响后可见未来一天']
      } },
      { artifact_id: 'master-1', artifact_type: 'master_outline', title: '总纲', status: 'active', version: 1, active_version_status: 'active', active_content: { premise: '守城与预见\n章节跨度估算 {"minimum":10,"recommended":10,"maximum":12,"units":[{"unit":"审计推进","suggestedChapters":3}]}', acts: ['雾城危机'], endingDirection: '待确认' } },
      { artifact_id: 'chapter-1', artifact_type: 'chapter_outline', title: '第1章章纲', status: 'active', version: 1, active_version_status: 'active', active_content: {
        outlineSchema: 'chapter_outline_v2',
        chapterNumber: 1,
        title: '穷途末路的入口',
        sourceStage: { stageNumber: 1, title: '进入雾城', chapterRange: { start: 1, end: 50 } },
        chapterFunction: '确立生存压力并进入游戏舱',
        openingState: '张三只剩最后一笔生活费。',
        requiredEndingState: '张三进入游戏，并确认完成度会影响真实收益。',
        cast: [{ name: '张三', objective: '获得第一笔收入', knowledgeBoundary: '不知道游戏伤害会同步现实', chapterRole: '主动试探规则' }],
        conflict: { surface: '必须在保住生活费和购买接入资格间选择', failureCost: '失去住所' },
        plotBeats: [
          { order: 1, trigger: '房租催缴', action: '确认余额', result: '发现只够维持一天' },
          { order: 2, trigger: '游戏任务开放', action: '接取任务', resistance: '接入费会耗尽余额', result: '决定承担风险' },
          { order: 3, trigger: '完成度提示出现', action: '进入游戏舱', turn: '提示收益可提现', result: '锁定第一项任务' }
        ],
        experience: { primaryTone: '压抑转决意', emotionalCurve: ['压抑', '犹豫', '决意'], payoffPoints: [], pressurePoints: ['失去住所'], readerEffect: '期待第一笔收益' },
        descriptionFocus: { primary: ['选择瞬间'], secondary: ['游戏舱细节'], compress: ['缴费手续'] },
        informationControl: { reveals: ['收益可提现'], concealed: ['伤害同步现实'], gaps: [] },
        threadActions: [{ action: 'plant', summary: '完成度会影响收益' }],
        ending: { result: '张三正式接入游戏', stateChanges: ['余额归零'], hook: '完成度将影响收益', nextChapterInterface: '完成第一项任务并验证到账' },
        mustImplement: ['选择必须由生存压力推动'],
        mustNotViolate: ['张三此时不知道伤害同步现实'],
        allowedCandidates: [],
        creativeFreedom: ['对白、动作和游戏舱细节由主笔创造']
      } },
      { artifact_id: 'chapter-2', artifact_type: 'chapter_outline', title: '第2章章纲', status: 'active', version: 1, active_version_status: 'active', active_content: { chapterNumber: 2, title: '第一笔血汗钱', goal: '确认游戏收入真实到账', beats: ['完成采集', '收到转账'], hook: '设备状态开始下降' } },
      { artifact_id: 'chapter-3', artifact_type: 'chapter_outline', title: '第3章章纲', status: 'active', version: 1, active_version_status: 'active', active_content: { chapterNumber: 3, title: '摔在同一个坑里', goal: '因规则盲区受损并开始记录规律', beats: ['连续登录', '建立规则表'], hook: '需要查清隐藏规则' } }
    ]);
    if (path.endsWith('/artifacts/story-1/versions') && init?.method === 'POST') {
      const payload = JSON.parse(String(init.body)) as { content: Record<string, unknown>; parentVersionId: string | null };
      return apiResponse({
        artifactVersionId: 'story-version-2', artifactId: 'story-1', version: 2,
        parentVersionId: payload.parentVersionId, positioningVersion: 1, content: payload.content,
        contentHash: 'story-hash-2', status: 'candidate', createdAt: '2026-07-20T12:00:00.000Z'
      });
    }
    if (path.endsWith('/protagonists')) return apiResponse(protagonistDashboard);
    if (path.endsWith('/protagonist-state/state-ui-3/classify') && init?.method === 'POST') return apiResponse({
      ...protagonistDashboard.profiles[0]!.current[2], category: '灵魂能力', revision: 2, previousEntryId: 'state-ui-3'
    });
    if (path.endsWith('/attribute-formulas')) return apiResponse([]);
    if (path.endsWith('/library')) return apiResponse({
      canonRevision: 3,
      entities: [{ entity_id: 'entity-1', entity_type: 'character', canonical_name: '张三', aliases: ['雾城守备'], schema_version: 1, status: 'active' }],
      facts: [{
        fact_id: 'fact-ui-1', subject_entity_id: 'entity-1', canonical_name: '张三',
        relation_key: 'identity.origin', value: '雾城边防军出身', grade: 'A', status: 'active',
        source_chapter_number: 1, source_chapter_title: '雾城初响',
        evidence: JSON.stringify([{ excerpt: '城门名册记载张三来自雾城边防军。', source_id: 'internal-source-id' }])
      }, {
        fact_id: 'fact-ui-duplicate', subject_entity_id: 'entity-1', canonical_name: '张三',
        relation_key: 'identity.origin', value: '雾城边防军出身', grade: 'A', status: 'active',
        source_chapter_number: 1, source_chapter_title: '雾城初响',
        evidence: [{ excerpt: '城门名册记载张三来自雾城边防军。' }]
      }],
      relations: [{ relationship_id: 'relation-ui-1', from_name: '张三', relation_key: 'ally_of', toValue: '守城军' }],
      tags: [], projections: [], gaps: [],
      settings: [{ itemKey: 'world-era', groupTitle: '世界与环境', label: '时代背景', prompt: '时代是什么？', sourceLabel: '通用设定模板', status: '已确认', custom: false, sortOrder: 1, content: '架空王朝的雾城边境。', sourceDiscussionId: null, sourceDecisionId: null, confirmedAt: '2026-07-16T12:00:00.000Z', updatedAt: '2026-07-16T12:00:00.000Z' }],
      bookProfile: { title: '雾钟档案', channel: '男频', category: '历史脑洞', subjects: ['架空历史'], mainTags: ['成长', '守城'], customTags: [], protagonists: [{ role: 'male_lead', name: '张三', age: '二十岁', background: '雾城边军', personalities: ['坚韧'] }], mustFollow: ['钟声规则不得无代价改写'], style: { languageTones: [], emotionalTones: [], pacingAndPayoff: [], atmospheres: [], custom: [] }, source: '老板确认的开书资料', version: 1 },
      protagonists: protagonistDashboard, attributeFormulas: [],
      summary: { entityCount: 1, factCount: 1, relationCount: 1, tagCount: 0, projectionCount: 2, openGapCount: 0 }
    });
    if (path.endsWith('/projections')) return apiResponse([
      { projection_id: 'projection-planned', projection_type: 'emotion', track: 'planned', chapter_number: 1, canon_revision: 3, content_json: JSON.stringify({ scopeLabel: '第1章', emotionFlow: ['压抑', '决意'], baseline: '虐转爽' }) },
      { projection_id: 'projection-actual', projection_type: 'emotion', track: 'actual', chapter_number: 1, canon_revision: 3, content_json: JSON.stringify({ scopeLabel: '第1章', emotionFlow: ['惊讶', '平静'], baseline: '平' }) }
    ]);
    if (path.endsWith('/memory')) return apiResponse([]);
    if (path.endsWith('/model-bindings')) return apiResponse({ active: agents.map((agent) => ({ agentId: agent.agentId, roleKey: agent.roleKey, memberName: agent.displayName, shortTitle: agent.roleName, provider: agent.provider, modelId: agent.modelId, modelSnapshotId: `snapshot-${agent.agentId}`, plan: 'deterministic' })), revisions: [{ revisionId: 'revision-1', version: 1, effectiveFrom: '2026-07-16T12:00:00.000Z', reason: '创建十一人团队', status: 'active', createdAt: '2026-07-16T12:00:00.000Z' }], contracts: [] });
    if (path.endsWith('/model-bindings/preview') || path.endsWith('/model-bindings/activate')) return apiResponse({ valid: true, futureTasksOnly: true });
    if (path.includes('/model-bindings/') && path.endsWith('/restore')) return apiResponse({ version: 2, futureTasksOnly: true });
    if (path.includes('/confirmations/') && path.endsWith('/accept')) return apiResponse({ status: 'accepted' });
    if (path.endsWith('/tasks/task-ui-1/cancel')) return apiResponse({ taskId: 'task-ui-1', status: 'working', cancelRequested: true });
    return new Response(JSON.stringify({ error: { message: `未配置测试接口 ${path}` } }), { status: 404 });
  };
}

function apiResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: 'request-ui', version: 1 } }), {
    status: 200, headers: { 'content-type': 'application/json' }
  });
}
