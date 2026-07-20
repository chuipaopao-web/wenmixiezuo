// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../apps/web/src/app/App';
import type { WorkspaceData } from '../../../apps/web/src/lib/api/client';

const book = {
  bookId: 'book-ui-1', title: '雾钟档案', status: 'active', canonRevision: 3,
  version: 2, positioningVersion: 1, updatedAt: '2026-07-16T12:00:00.000Z'
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
  messageCount: 0,
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
  localAssistant: { displayName: '小文秘书', roleName: '本地秘书', status: 'ready', sessionCount: 1, summary: '接收消息、整理附件、查看任务，并把创作问题交给合适的成员。' }
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('完整创作工作台', () => {
  it('显示内容优先三栏、小文秘书、十一名女性成员原型头像与真实状态并通过自动无障碍检查', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchRouter()));
    render(<App />);

    expect((await screen.findAllByText('雾钟档案')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('complementary', { name: '书籍与功能' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '创作团队' })).toBeInTheDocument();
    expect(await screen.findByText('11 名成员')).toBeInTheDocument();
    expect(screen.getByText('小文秘书（本地秘书）')).toBeInTheDocument();
    expect(screen.getByText('秋香（主笔）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /秋香（主笔），后台工作中/ })).toBeInTheDocument();
    expect(screen.getByText('后台工作中')).toBeInTheDocument();
    expect(screen.getByText('排队中')).toBeInTheDocument();
    expect(screen.getAllByText('空闲')).toHaveLength(9);
    expect(screen.getByText('弄玉（版权）')).toBeInTheDocument();
    expect(screen.queryByText('按需专家 4')).not.toBeInTheDocument();
    expect(screen.queryByText('设定与连续性统筹')).not.toBeInTheDocument();
    expect(screen.queryByText('local-deterministic/wenmi-fixture-v1')).not.toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /头像/ })).toHaveLength(11);
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-theme', 'sage');

    const bookRail = screen.getByRole('complementary', { name: '书籍与功能' });
    const workspaceNavigation = within(bookRail).getByRole('navigation', { name: '创作功能' });
    for (const name of ['对话', '规划', '正文', '图谱', '资料库', '版权与研究', '任务']) {
      expect(within(workspaceNavigation).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(document.querySelector('.task-center')).toBeNull();
    expect(document.querySelector('.chapter-tree')).toBeNull();
    expect(screen.queryByText('卷章目录')).not.toBeInTheDocument();
    expect(document.querySelector('.workspace-tabs')).toBeNull();
    const bookSummary = document.querySelector('.topbar-book-summary') as HTMLElement;
    expect(bookSummary).toBeInTheDocument();
    expect(within(bookSummary).getByText('雾钟档案')).toBeInTheDocument();
    expect(within(bookSummary).getByText('创作中')).toBeInTheDocument();
    expect(within(bookSummary).getByText('1 卷')).toBeInTheDocument();
    expect(within(bookSummary).getByText('1 章')).toBeInTheDocument();
    expect(within(bookSummary).getByText('正史修订 3')).toBeInTheDocument();
    expect(document.querySelector('.topbar-center')).toBeNull();
    expect(document.querySelector('.workspace-book-summary')).toBeNull();
    expect(screen.queryByText('规划成果')).not.toBeInTheDocument();
    expect(screen.queryByText('知识与正史')).not.toBeInTheDocument();

    const results = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('把应用壳固定在动态视口并只让内容区独立滚动', () => {
    const css = readFileSync(resolve('apps/web/src/app/app.css'), 'utf8');
    expect(css).toMatch(/html\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/su);
    expect(css).toMatch(/#root\s*\{[^}]*height:\s*100dvh[^}]*overflow:\s*hidden/su);
    expect(css).toMatch(/\.app-shell\s*\{[^}]*height:\s*100dvh[^}]*max-height:\s*100dvh[^}]*overflow:\s*hidden/su);
    expect(css).toMatch(/\.conversation-stream\s*\{[^}]*overflow:\s*auto/su);
    expect(css).toMatch(/\.manuscript-view,[^}]*\.reference-view,[^}]*\.task-workspace\s*\{[^}]*overflow:\s*auto/su);
  });

  it('把归档书移出主书架并放入可恢复的归档区', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchRouter('正文内容', { ...workspace, book: { ...book, status: 'archived' } })));
    render(<App />);
    const archiveToggle = await screen.findByRole('button', { name: '查看已归档书籍，共 1 本' });
    expect(screen.queryByRole('button', { name: /打开《雾钟档案》/ })).not.toBeInTheDocument();
    fireEvent.click(archiveToggle);
    expect(screen.getByText('雾钟档案')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢复《雾钟档案》' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '彻底删除《雾钟档案》' })).toBeInTheDocument();
    expect(screen.queryByText('archived')).not.toBeInTheDocument();
  });

  it('新建书只要求书名和频道，主要标签不限制其他自由发挥', async () => {
    const fetchMock = vi.fn(createFetchRouter());
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '创建新书' }));
    const dialog = screen.getByRole('dialog', { name: '创建一本新书' });
    expect(within(dialog).getByText('主要选择 + 其他自由发挥')).toBeInTheDocument();
    expect(within(dialog).getByText(/标签只确定主要方向，不是每章清单/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('目标读者')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('预计规模')).not.toBeInTheDocument();
    expect((await axe.run(dialog, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText('书名'), { target: { value: '长安簪影' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: '女频' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '选择主类型：古代言情' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '选择故事特点：群像' }));
    fireEvent.change(within(dialog).getByLabelText('自定义主要标签'), { target: { value: '轻悬疑' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '添加自定义标签' }));
    fireEvent.click(within(dialog).getByText('必须遵守（可不选）'));
    fireEvent.click(within(dialog).getByRole('button', { name: '选择必须遵守：不写后宫' }));
    expect(within(dialog).getByText(/当前 3 个主要标签/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '确认建书' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => {
      if (!String(input).endsWith('/api/v1/books/drafts') || (init as RequestInit | undefined)?.method !== 'POST') return false;
      const payload = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return payload.title === '长安簪影'
        && payload.classification === '女频'
        && Array.isArray(payload.tags)
        && payload.tags.includes('古代言情')
        && payload.tags.includes('群像')
        && payload.tags.includes('轻悬疑')
        && payload.tags.includes('必须遵守：不写后宫');
    })).toBe(true));
  });

  it('书籍菜单只提供可逆归档，并使用真实版本调用归档接口', async () => {
    const fetchMock = vi.fn(createFetchRouter());
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '管理《雾钟档案》' }));
    fireEvent.click(screen.getByRole('button', { name: '移到归档' }));
    expect(screen.getByRole('dialog', { name: '归档《雾钟档案》' })).toHaveTextContent('可以随时恢复');
    expect(screen.queryByRole('button', { name: /永久删除/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认归档' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).endsWith('/api/v1/books/book-ui-1/archive')
      && (init as RequestInit | undefined)?.method === 'POST'
      && JSON.parse(String((init as RequestInit).body)).expectedVersion === 2)).toBe(true));
  });

  it('归档区可以恢复书籍', async () => {
    const archivedWorkspace = { ...workspace, book: { ...book, status: 'archived' } };
    const fetchMock = vi.fn(createFetchRouter('正文内容', archivedWorkspace));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '查看已归档书籍，共 1 本' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复《雾钟档案》' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).endsWith('/api/v1/books/book-ui-1/restore')
      && (init as RequestInit | undefined)?.method === 'POST'
      && JSON.parse(String((init as RequestInit).body)).expectedVersion === 2)).toBe(true));
  });

  it('归档书输入YES并再次点击后才能彻底删除', async () => {
    const archivedWorkspace = { ...workspace, book: { ...book, status: 'archived' } };
    const fetchMock = vi.fn(createFetchRouter('正文内容', archivedWorkspace));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '查看已归档书籍，共 1 本' }));
    fireEvent.click(screen.getByRole('button', { name: '彻底删除《雾钟档案》' }));
    const dialog = screen.getByRole('dialog', { name: '彻底删除《雾钟档案》' });
    expect(dialog).toHaveTextContent('删除后无法恢复');
    expect(within(dialog).getByRole('button', { name: '彻底删除' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('永久删除确认词'), { target: { value: 'YSE' } });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('确认词不匹配');
    expect(within(dialog).queryByRole('button', { name: '填入完整确认词' })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('永久删除确认词'), { target: { value: 'YES' } });
    expect(within(dialog).getByRole('button', { name: '彻底删除' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '彻底删除' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).endsWith('/api/v1/books/book-ui-1/purge')
      && (init as RequestInit | undefined)?.method === 'POST'
      && JSON.parse(String((init as RequestInit).body)).confirmationText === 'YES')).toBe(true));
  });

  it('成员详情显示公开职责、边界、模型和真实证据，不展示隐藏提示', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchRouter()));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /貂蝉（主编），空闲，打开岗位详情/ }));
    expect(screen.getByRole('dialog', { name: /貂蝉（主编）/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '负责' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '不负责' })).toBeInTheDocument();
    expect(screen.getByText(/local-deterministic\/wenmi-fixture-v2-chief_editor/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/chain.of.thought|system prompt|api key/i);
  });

  it('左栏任务标签打开二级页面承载预算与待确认，右栏只显示团队成员', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchRouter()));
    render(<App />);

    const teamRail = await screen.findByRole('complementary', { name: '创作团队' });
    expect(within(teamRail).getByRole('heading', { name: '团队' })).toBeInTheDocument();
    expect(within(teamRail).queryByRole('heading', { name: '预算' })).not.toBeInTheDocument();
    expect(within(teamRail).queryByRole('heading', { name: '待确认' })).not.toBeInTheDocument();
    expect(screen.queryByText('现金保护线 0.00 元')).not.toBeInTheDocument();

    const bookRail = screen.getByRole('complementary', { name: '书籍与功能' });
    fireEvent.click(within(bookRail).getByRole('button', { name: '任务' }));
    expect(screen.getByRole('heading', { name: '任务中心' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '预算' })).toBeInTheDocument();
    expect(screen.getByText('现金保护线 0.00 元')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '待确认' })).toBeInTheDocument();
    expect(screen.getByText('当前没有需要老板确认的重大事项。')).toBeInTheDocument();
  });

  it('任务页面显示章节与阶段，可查看详情并调用真实取消接口', async () => {
    const fetchMock = vi.fn(createFetchRouter());
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    const bookRail = await screen.findByRole('complementary', { name: '书籍与功能' });
    fireEvent.click(within(bookRail).getByRole('button', { name: '任务' }));
    const taskButton = await screen.findByRole('button', { name: /第1章.*章节创作.*生成完整初稿/ });
    fireEvent.click(taskButton);
    expect(screen.getByRole('dialog', { name: '任务详情' })).toBeInTheDocument();
    expect(screen.getByText('task-ui-1')).toBeInTheDocument();
    expect(screen.getAllByText(/第 1 章/).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: '取消任务' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).includes('/tasks/task-ui-1/cancel') && (init as RequestInit | undefined)?.method === 'POST')).toBe(true));
  });

  it('设置可调整底色和字体并持久化', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchRouter()));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '界面设置' }));
    expect(screen.getByRole('dialog', { name: '界面设置' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '雾蓝' }));
    fireEvent.click(screen.getByRole('radio', { name: '大' }));
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-theme', 'mist');
    expect(document.querySelector('.app-shell')).toHaveStyle({ '--font-scale': '1.1' });
    expect(JSON.parse(localStorage.getItem('wenmi:workspace-preferences') ?? '{}')).toMatchObject({ theme: 'mist', fontSize: 'large' });
    expect(screen.getByText('订阅与套餐模型已启用')).toBeInTheDocument();
    expect(screen.getByText('禁止按量付费回退')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.6-sol')).toBeInTheDocument();
    expect(screen.getByText('deepseek-v4-pro')).toBeInTheDocument();
    expect(screen.getByText('glm-5-2')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/api[_-]?key|bearer/i);
  });

  it('正文页面固定显示左侧章节列表，右侧阅读已定稿正文', async () => {
    const longText = '雾城的钟声穿过石墙。'.repeat(250);
    vi.stubGlobal('fetch', vi.fn(createFetchRouter(longText)));
    render(<App />);
    const bookRail = await screen.findByRole('complementary', { name: '书籍与功能' });
    fireEvent.click(within(bookRail).getByRole('button', { name: '正文' }));
    expect(await screen.findByRole('region', { name: '正文章节列表' })).toBeInTheDocument();
    const chapterButton = await screen.findByRole('button', { name: /1\. 雾城初响/ });
    fireEvent.click(chapterButton);
    await waitFor(() => expect(document.querySelector('.novel-text')?.textContent).toBe(longText));
    expect(await screen.findByRole('heading', { name: '工单与三席点评' })).toBeInTheDocument();
    expect(screen.getByText('文学与AI腔席')).toBeInTheDocument();
    expect(screen.getByText(/10%/u)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '正文章节列表' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '章节列表' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存修改' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '进入沉浸阅读' }));
    expect(document.querySelector('.app-shell')).toHaveClass('reader-mode');
  });

  it('规划工作台显示五个层级且资料库使用结构化卡片而非原始JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchRouter()));
    render(<App />);
    const bookRail = await screen.findByRole('complementary', { name: '书籍与功能' });
    fireEvent.click(within(bookRail).getByRole('button', { name: '规划' }));
    expect(await screen.findByRole('heading', { name: '规划工作台' })).toBeInTheDocument();
    for (const name of ['全书框架', '基本设定', '总纲', '卷纲', '章纲']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '章节列表' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '基本设定' }));
    expect(await screen.findByRole('heading', { name: '属性计算公式' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '卷纲' }));
    expect(await screen.findByRole('heading', { name: '第一卷卷纲' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '资料库' }));
    expect(await screen.findByRole('heading', { name: '资料库' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '主角' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关系' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '情绪' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '主角' }));
    expect(await screen.findByRole('heading', { name: '主角实时面板' })).toBeInTheDocument();
    expect(screen.getByText('步兵数量')).toBeInTheDocument();
    expect(screen.getByText('1,200人')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '城池领地' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '角色' }));
    expect(await screen.findByText('张三')).toBeInTheDocument();
    expect(document.querySelector('.library-workspace pre')).toBeNull();
    fireEvent.click(within(bookRail).getByRole('button', { name: '图谱' }));
    expect(await screen.findByRole('heading', { name: '叙事图谱' })).toBeInTheDocument();
    for (const name of ['人物关系', '情绪', '主线', '支线', '钩子与伏笔', '信息差']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });

  it('未定稿正文可编辑保存，并提供重写与定稿审校入口', async () => {
    const draftWorkspace: WorkspaceData = {
      ...workspace,
      chapters: [{ ...chapter, volumeId: 'volume-ui-1', settlementStatus: 'unsettled', currentManuscriptVersionId: 'manuscript-draft-1', canonManuscriptVersionId: null }],
      tasks: [],
      volumes: [{ ...workspace.volumes![0]!, settledCount: 0 }]
    };
    const fetchMock = vi.fn(createFetchRouter('旧稿正文', draftWorkspace));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    const bookRail = await screen.findByRole('complementary', { name: '书籍与功能' });
    fireEvent.click(within(bookRail).getByRole('button', { name: '正文' }));
    fireEvent.click(await screen.findByRole('button', { name: /1\. 雾城初响/ }));
    const editor = await screen.findByRole('textbox', { name: '正文编辑器' });
    fireEvent.change(editor, { target: { value: '作者修改后的正文' } });
    expect(screen.getByText(/未保存修改/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/manuscripts/owner-drafts') && (init as RequestInit | undefined)?.method === 'POST')).toBe(true));
    expect(screen.getByRole('button', { name: '重写' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '定稿' })).toBeInTheDocument();
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

    const bookRail = await screen.findByRole('complementary', { name: '书籍与功能' });
    fireEvent.click(within(bookRail).getByRole('button', { name: '任务' }));
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
      role_key: index % 2 === 0 ? null : 'chief_editor',
      model_provider: index % 2 === 0 ? null : 'local-deterministic',
      model_id: index % 2 === 0 ? null : 'wenmi-fixture-v1',
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

  it('聊天按成员左老板右显示，并可通过加号上传解析附件后发送引用', async () => {
    const chatMessages = [{
      message_id: 'boss-message', sender_type: 'boss' as const, sender_agent_id: null, role_key: null,
      model_provider: null, model_id: null, message_type: 'text', content: '老板消息', references_json: '[]',
      created_at: '2026-07-16T12:00:00.000Z'
    }, {
      message_id: 'agent-message', sender_type: 'agent' as const, sender_agent_id: 'agent-1', role_key: 'chief_editor',
      model_provider: 'local-deterministic', model_id: 'fixture', message_type: 'text', content: '主编回复', references_json: '[]',
      created_at: '2026-07-16T12:01:00.000Z'
    }, {
      message_id: 'legacy-system-message', sender_type: 'system' as const, sender_agent_id: null, role_key: null,
      model_provider: null, model_id: null, message_type: 'capability_notice', content: '消息已保存。当前使用确定性离线适配器，不会把开放式创作对话伪装成真实模型回复。你可以使用“写一章”等明确命令。', references_json: '[]',
      created_at: '2026-07-16T12:02:00.000Z'
    }, {
      message_id: 'effective-agent-message', sender_type: 'agent' as const, sender_agent_id: 'agent-1', role_key: 'chief_editor',
      model_provider: 'local-deterministic', model_id: 'fixture', message_type: 'conversation_reply', content: '精简结论：先核对双方实力。',
      references_json: JSON.stringify([{ type: 'effective_output', version: 1, format: 'structured',
        fullContent: '精简结论：先核对双方实力。\n\n完整依据：旧盟约仍然有效。', contentHash: 'a'.repeat(64) }]),
      created_at: '2026-07-16T12:03:00.000Z'
    }, {
      message_id: 'invalid-effective-agent-message', sender_type: 'agent' as const, sender_agent_id: 'agent-1', role_key: 'chief_editor',
      model_provider: 'local-deterministic', model_id: 'fixture', message_type: 'conversation_reply', content: '损坏引用安全降级。',
      references_json: JSON.stringify([{ type: 'effective_output', version: 1,
        fullContent: '这段损坏引用不得展示。', contentHash: 'invalid' }]),
      created_at: '2026-07-16T12:04:00.000Z'
    }];
    const fetchMock = vi.fn(createFetchRouter('正文内容', { ...workspace, messageCount: chatMessages.length }, chatMessages));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect(await screen.findByText('老板消息')).toBeInTheDocument();
    expect(document.querySelector('.message.boss')).toHaveClass('align-right');
    expect(document.querySelector('.message.agent')).toHaveClass('align-left');
    expect(screen.getByRole('img', { name: '老板头像' })).toBeInTheDocument();
    expect(within(document.querySelector('.message.agent') as HTMLElement).getByRole('img', { name: /貂蝉（主编）头像/ })).toBeInTheDocument();
    const legacyNotice = screen.getByText(/您的消息我已经收好/).closest('.message') as HTMLElement;
    expect(within(legacyNotice).getByText('小文秘书')).toBeInTheDocument();
    expect(within(legacyNotice).getByRole('img', { name: '小文秘书头像' })).toBeInTheDocument();
    expect(within(legacyNotice).queryByText('系统')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '系统头像' })).not.toBeInTheDocument();
    expect(screen.queryByText(/确定性离线适配器/)).not.toBeInTheDocument();
    expect(screen.queryByText('聊天只按需带入最近上下文，不会自动写入正史。Ctrl + Enter 发送。')).not.toBeInTheDocument();
    expect(screen.getByText('精简结论：先核对双方实力。')).toBeInTheDocument();
    expect(screen.queryByText(/完整依据：旧盟约仍然有效/u)).not.toBeInTheDocument();
    const expandReply = screen.getByRole('button', { name: '查看完整回复' });
    expect(expandReply).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(expandReply);
    expect(screen.getByText(/完整依据：旧盟约仍然有效/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起完整回复' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('损坏引用安全降级。')).toBeInTheDocument();
    expect(screen.queryByText('这段损坏引用不得展示。')).not.toBeInTheDocument();

    const addButton = screen.getByRole('button', { name: '添加图片或文件' });
    expect(addButton).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['张三与天安城'], 'plot.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('已解析 7 字符')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('和创作团队说'), { target: { value: '讨论附件剧情' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([inputUrl, init]) => {
      if (!String(inputUrl).endsWith('/api/v1/books/book-ui-1/messages') || (init as RequestInit | undefined)?.method !== 'POST') return false;
      const payload = JSON.parse(String((init as RequestInit).body)) as { content: string; attachmentIds: string[] };
      return payload.content === '讨论附件剧情' && payload.attachmentIds[0] === 'attachment-ui-1';
    })).toBe(true));
  });
});

function createFetchRouter(chapterContent = '正文内容', workspaceData = workspace, messages: unknown[] = []) {
  const protagonistDashboard = { profiles: [{
    profileId: 'protagonist-ui-1', entityId: 'entity-1', displayName: '张三', isPrimary: true, status: 'active', historyCount: 2,
    current: [{ entryId: 'state-ui-1', profileId: 'protagonist-ui-1', category: 'army', logicalKey: 'army_步兵数量', label: '步兵数量', valueType: 'resource', value: 1200, unit: '人', stateStatus: 'active', authorityLayer: 'canon', effectiveChapterNumber: 1, revision: 2, note: null }],
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
    if (path === '/api/v1/books/drafts') return apiResponse({ draftId: 'draft-ui-1', version: 1 });
    if (path === '/api/v1/book-drafts/draft-ui-1/confirm') return apiResponse({ bookId: workspaceData.book.bookId });
    if (path === `/api/v1/books/${workspaceData.book.bookId}/archive`) return apiResponse({ ...workspaceData.book, status: 'archived', version: workspaceData.book.version + 1 });
    if (path === `/api/v1/books/${workspaceData.book.bookId}/restore`) return apiResponse({ ...workspaceData.book, status: 'active', version: workspaceData.book.version + 1 });
    if (path === `/api/v1/books/${workspaceData.book.bookId}/purge`) return apiResponse({ bookId: workspaceData.book.bookId, status: 'purged', tombstoneWritten: true });
    if (path === `/api/v1/books/${workspaceData.book.bookId}/chat-attachments` && init?.method === 'POST') return apiResponse({
      attachmentId: 'attachment-ui-1', originalName: 'plot.txt', mediaKind: 'text', mimeType: 'text/plain', sizeBytes: 21,
      parseStatus: 'parsed', parsedCharCount: 7, parseError: null, lifecycleLayer: 'temporary', createdAt: '2026-07-16T12:00:00.000Z'
    });
    if (path.endsWith('/chat-attachments/attachment-ui-1/discard')) return apiResponse({ attachmentId: 'attachment-ui-1', parseStatus: 'discarded' });
    if (path === '/api/v1/runtime/worker') return apiResponse({
      status: 'ready', worker: { workerId: 'worker-ui', heartbeatAt: new Date().toISOString(), currentTaskId: 'task-ui-1' }
    });
    if (path === '/api/v1/operations/status') return apiResponse({ releaseId: 'release-ui', schemaVersion: 18, disk: { totalBytes: 1000, freeBytes: 800 }, queue: { queued: 0, working: 1, blocked: 0 }, projection: { status: 'ready' }, latestBackup: null, portability: { completed: 0, failed: 0 }, diagnostics: { telemetrySent: false, secretsIncluded: false, listeningHost: '127.0.0.1' } });
    if (path.endsWith('/workspace')) return apiResponse(workspaceData);
    if (path.includes('/volumes/') && path.endsWith('/chapters')) return apiResponse({
      items: workspaceData.chapters,
      total: workspaceData.chapters.length,
      offset: Number(url.searchParams.get('offset') ?? 0),
      limit: Number(url.searchParams.get('limit') ?? 80)
    });
    if (path.endsWith('/messages') && init?.method === 'POST') return apiResponse({ messageId: 'message-ui-new', action: { kind: 'conversation_reply_scheduled' } });
    if (path.endsWith('/messages')) return apiResponse(messages);
    if (path.endsWith('/manuscripts/owner-drafts') && init?.method === 'POST') return apiResponse({ manuscriptVersionId: 'manuscript-owner-2', parentVersionId: 'manuscript-1', contentHash: 'hash-owner-2', wordCount: 8, status: 'candidate', unchanged: false });
    if (path.endsWith('/rewrite') && init?.method === 'POST') return apiResponse({ taskId: 'task-rewrite-1', operation: 'rewrite_existing', manuscriptVersionId: 'manuscript-owner-2' });
    if (path.endsWith('/finalize') && init?.method === 'POST') return apiResponse({ taskId: 'task-review-1', operation: 'review_existing' });
    if (path.endsWith('/content')) return apiResponse({
      manuscriptVersionId: 'manuscript-1', contentHash: 'hash-1', totalLength: chapterContent.length, content: chapterContent
    });
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
      { artifact_id: 'story-1', artifact_type: 'story_bible', title: '设定框架', status: 'active', version: 1, active_version_status: 'active', active_content: { worldRules: ['钟响后可见未来一天'], characters: ['张三'] } },
      { artifact_id: 'master-1', artifact_type: 'master_outline', title: '总纲', status: 'active', version: 1, active_version_status: 'active', active_content: { premise: '守城与预见', acts: ['雾城危机'], endingDirection: '待确认' } },
      { artifact_id: 'volume-1', artifact_type: 'volume_outline', title: '第一卷卷纲', status: 'active', version: 1, active_version_status: 'active', active_content: { volumeNumber: 1, goal: '揭开钟声来源', arcs: ['雾城危机'], endingState: '城门失守' } },
      { artifact_id: 'chapter-1', artifact_type: 'chapter_outline', title: '第一章章纲', status: 'active', version: 1, active_version_status: 'active', active_content: { chapterNumber: 1, goal: '听见钟声', beats: ['登城'], hook: '未来罪案出现' } }
    ]);
    if (path.endsWith('/protagonists')) return apiResponse(protagonistDashboard);
    if (path.endsWith('/attribute-formulas')) return apiResponse([]);
    if (path.endsWith('/library')) return apiResponse({ canonRevision: 3, entities: [{ entity_id: 'entity-1', entity_type: 'character', canonical_name: '张三', aliases: [], schema_version: 1, status: 'active' }], facts: [], relations: [], tags: [], projections: [], gaps: [], protagonists: protagonistDashboard, attributeFormulas: [], summary: { entityCount: 1, factCount: 0, relationCount: 0, tagCount: 0, projectionCount: 0, openGapCount: 0 } });
    if (path.endsWith('/memory') || path.endsWith('/projections')) return apiResponse([]);
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
