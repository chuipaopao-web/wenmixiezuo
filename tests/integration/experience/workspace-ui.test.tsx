// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  creativeSession: {
    sessionId: 'creative-session-ui-1',
    status: 'awaiting_direction',
    mode: 'creative_forecast',
    activeTopic: '张三如何进入天安城',
    currentBlackboardRevision: 3,
    canonRevision: 3,
    blackboard: {
      revision: 3,
      currentGoal: '比较张三潜入天安城的两条剧情方向',
      maturity: 'direction_ready',
      nextStep: '继续比较，或由老板锁定一个方向',
      candidates: [],
      disagreements: ['是否让守城将领主动接触张三'],
      risks: ['过早暴露张三身份'],
      unknowns: ['城门审查规则'],
      lockedDirection: null
    },
    activeForecast: {
      forecastId: 'forecast-ui-1',
      status: 'active',
      staleReason: null,
      branchCount: 2,
      branches: [{
        branchId: 'branch-ui-1',
        ordinal: 1,
        title: '商队伪装线',
        proposal: { summary: '张三随商队入城' },
        sourceAgentId: 'agent-3'
      }, {
        branchId: 'branch-ui-2',
        ordinal: 2,
        title: '守将邀约线',
        proposal: { summary: '守将暗中邀请张三' },
        sourceAgentId: 'agent-4'
      }]
    }
  },
  localAssistant: { displayName: '小文秘书', roleName: '本地秘书', status: 'ready', sessionCount: 1, summary: '接收消息、整理附件、查看任务，并把创作问题交给合适的成员。' }
};

beforeEach(() => {
  window.history.replaceState(null, '', '/?book=book-ui-1');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('完整创作工作台', () => {
  it('新书等待主编主动开场时显示真实任务状态而不是普通空白提示', async () => {
    const onboardingWorkspace: WorkspaceData = {
      ...workspace,
      messageCount: 0,
      creativeSession: null,
      tasks: [{
        taskId: 'task-onboarding-1',
        taskType: 'conversation_reply',
        status: 'working',
        currentPhase: 'reply',
        pauseRequested: false,
        cancelRequested: false,
        attemptCount: 1,
        assignedAgentId: 'agent-1',
        chapterId: null,
        brief: { proactiveOnboarding: true, openingBlueprintId: 'blueprint-1' },
        checkpoint: {}
      }]
    };
    vi.stubGlobal('fetch', vi.fn(createFetchRouter('正文内容', onboardingWorkspace, [])));

    render(<App />);

    expect(await screen.findByRole('heading', { name: '主编正在整理开书资料' })).toBeInTheDocument();
    expect(screen.getByText(/一至三个最值得先确定的设定问题/u)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '从故事想法开始聊' })).not.toBeInTheDocument();
  });

  it('服务未启动时显示中文恢复提示，不暴露Failed to fetch', async () => {
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<App />);
    expect(await screen.findByText('无法连接文秘写作服务，请重新启动应用后再试。')).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  });

  it('根入口先显示书架，打开书后才显示书内功能，返回书架不发送任务控制请求', async () => {
    window.history.replaceState(null, '', '/');
    const fetchMock = vi.fn(createFetchRouter());
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    const shelf = await screen.findByRole('heading', { name: '我的作品' });
    expect(shelf).toBeInTheDocument();
    expect(shelf.closest('.bookshelf-home')?.querySelector('.bookshelf-scroll-region')).not.toBeNull();
    expect(screen.getByRole('button', { name: '打开《雾钟档案》' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '首页功能' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '创作功能' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/books/book-ui-1/workspace'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '打开《雾钟档案》' }));
    expect(await screen.findByRole('navigation', { name: '创作功能' })).toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get('book')).toBe('book-ui-1');
    fireEvent.click(screen.getByRole('button', { name: '返回书架' }));
    expect(await screen.findByRole('heading', { name: '我的作品' })).toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get('book')).toBeNull();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes('/tasks/') && (init as RequestInit | undefined)?.method !== 'GET')).toBe(false);
  });

  it('空书架只显示一个创建新书入口', async () => {
    window.history.replaceState(null, '', '/');
    const baseRouter = createFetchRouter();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/books') return apiResponse([]);
      return baseRouter(input, init);
    }));
    render(<App />);

    expect(await screen.findByRole('heading', { name: '把第一本书放进工作台' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '创建新书' })).toHaveLength(1);
  });

  it('首页团队显示全局岗位模板，不把模板状态伪装成实时工作状态', async () => {
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn(createFetchRouter()));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '团队' }));
    expect(await screen.findByRole('heading', { name: '创作团队' })).toBeInTheDocument();
    expect(screen.getAllByText('全局岗位模板').length).toBeGreaterThan(0);
    expect(screen.getByText('11 名成员')).toBeInTheDocument();
    expect(screen.queryByText('后台工作中')).not.toBeInTheDocument();
    expect(screen.getAllByText('貂蝉（主编）').length).toBeGreaterThan(0);
    expect(screen.getByText('Codex订阅 · gpt-5.6-sol')).toBeInTheDocument();
  });

  it('显示内容优先三栏、仅十一名女性创作成员、原型头像与真实状态并通过自动无障碍检查', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchRouter()));
    render(<App />);

    expect((await screen.findAllByText('雾钟档案')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('complementary', { name: '书籍与功能' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '创作团队' })).toBeInTheDocument();
    expect(await screen.findByText('11 名成员')).toBeInTheDocument();
    expect(screen.queryByText('小文秘书（本地秘书）')).not.toBeInTheDocument();
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
    expect(document.querySelector('.app-shell')).toHaveStyle({ '--font-scale': '1.1' });

    const bookRail = screen.getByRole('complementary', { name: '书籍与功能' });
    const workspaceNavigation = within(bookRail).getByRole('navigation', { name: '创作功能' });
    for (const name of ['返回书架', '对话', '规划', '正文', '图谱', '资料库', '版权与研究', '任务']) {
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

  it('团队页展示公开岗位配置并保存书籍级补充提示词', async () => {
    const fetchMock = vi.fn(createFetchRouter());
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    await screen.findAllByText('雾钟档案');
    fireEvent.click(screen.getByRole('button', { name: '返回书架' }));
    fireEvent.click(screen.getByRole('button', { name: '团队' }));
    fireEvent.click(await screen.findByRole('button', { name: '雾钟档案' }));
    const team = (await screen.findByRole('heading', { name: '团队配置' })).closest('section') as HTMLElement;
    expect(within(team).getByText('11 名成员')).toBeInTheDocument();
    fireEvent.click(within(team).getByRole('button', { name: /貂蝉（主编）/ }));
    expect(within(team).getByText('岗位职责')).toBeInTheDocument();
    expect(within(team).getByText('工作边界')).toBeInTheDocument();
    expect(within(team).getByText('默认岗位提示词')).toBeInTheDocument();
    expect(within(team).getByText(/你是文秘写作团队中的貂蝉/)).toBeInTheDocument();
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
    expect(css).toMatch(/\.conversation-stream\s*\{[^}]*grid-row:\s*2[^}]*overflow:\s*auto/su);
    expect(css).toMatch(/\.composer-wrap\s*\{[^}]*grid-row:\s*3/su);
    expect(css).toMatch(/\.manuscript-view,[^}]*\.reference-view,[^}]*\.task-workspace\s*\{[^}]*overflow:\s*auto/su);
    expect(css).toMatch(/\.manuscript-workspace\s*\{[^}]*grid-template-columns:\s*clamp\(176px,\s*13vw,\s*224px\)\s+minmax\(0,\s*1fr\)/su);
  });

  it('在聊天顶部显示持续剧情会话、候选方向和自然操作', async () => {
    const fetchMock = vi.fn(createFetchRouter());
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    const strip = await screen.findByRole('region', { name: '当前剧情会话' });
    expect(within(strip).getByText('待锁定方向')).toBeInTheDocument();
    expect(within(strip).getByText('比较张三潜入天安城的两条剧情方向')).toBeInTheDocument();
    expect(within(strip).getByText('商队伪装线')).toBeInTheDocument();
    expect(within(strip).getByText('守将邀约线')).toBeInTheDocument();
    fireEvent.click(within(strip).getByRole('button', { name: '锁定方向' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => {
      if (!String(input).endsWith('/api/v1/books/book-ui-1/messages')
        || (init as RequestInit | undefined)?.method !== 'POST') return false;
      return JSON.parse(String((init as RequestInit).body)).content === '锁定当前方向';
    })).toBe(true));
  });

  it('图谱、规划和版权页只显示作者可读中文，不暴露JSON、内部ID与协议枚举', async () => {
    const baseRouter = createFetchRouter();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path.endsWith('/projections')) return apiResponse([{
        projection_id: 'projection-internal-1', owner_id: 'owner-internal', book_id: 'book-internal',
        projection_type: 'emotion', track: 'actual', chapter_number: 12, canon_revision: 3,
        content_json: JSON.stringify({ status: 'not_extracted', source: 'selected_manuscript' }),
        source_ids_json: JSON.stringify(['source-internal-1']), rebuilt_at: '2026-07-25T01:00:00.000Z'
      }]);
      return baseRouter(input, init);
    }));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '图谱' }));
    fireEvent.click(await screen.findByRole('button', { name: '情绪' }));
    expect(await screen.findByText('暂无可展示内容')).toBeInTheDocument();
    expect(screen.getByText('正式正文')).toBeInTheDocument();
    expect(screen.queryByText(/projection-internal|source-internal|content_json|projection_type/u)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '规划' }));
    expect(await screen.findByText('作品定位与全书框架')).toBeInTheDocument();
    expect(screen.queryByText('sourceStatus')).not.toBeInTheDocument();
    expect(screen.queryByText('explicit')).not.toBeInTheDocument();
    expect(screen.getAllByText('明确确认').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '版权与研究' }));
    expect(await screen.findByText('作者提供')).toBeInTheDocument();
    expect(screen.getAllByText('候选判断').length).toBeGreaterThan(0);
    expect(screen.queryByText('source_status')).not.toBeInTheDocument();
    expect(screen.queryByText('candidate_status')).not.toBeInTheDocument();
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

  it('只用作品定位建书，并把人物、设定和剧情留到后续阶段', async () => {
    window.history.replaceState(null, '', '/');
    const fetchMock = vi.fn(createFetchRouter());
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '创建新书' }));
    const dialog = screen.getByRole('dialog', { name: '创建一本新书' });
    expect(within(dialog).getByText('主要选择 + 其他自由发挥')).toBeInTheDocument();
    expect(within(dialog).getByText(/标签只确定主要方向/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('目标读者')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('目标读者推荐')).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('书名'), { target: { value: '长安簪影' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: '女频' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: '选择作品分类：现言脑洞' }));
    await waitFor(() => expect(within(dialog).getByText(/已自动勾选 8 个/)).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('button', { name: '取消主要标签：群像' }));
    expect(within(dialog).getByText(/已自动勾选 7 个/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '选择主要标签：群像' }));
    fireEvent.change(within(dialog).getByLabelText('自定义标签'), { target: { value: '轻悬疑' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '添加自定义标签' }));
    expect(within(dialog).getByText('感情与关系')).toBeInTheDocument();
    expect(within(dialog).getByText('主角体验')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '选择必须遵守：不写后宫' }));
    fireEvent.change(within(dialog).getByLabelText('自定义必须遵守'), { target: { value: '不靠误会强推剧情' } });
    expect(within(dialog).getByText(/已自动勾选 8 个/)).toBeInTheDocument();
    expect((await axe.run(dialog, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);

    expect(within(dialog).queryByLabelText('主角姓名')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('世界观背景')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('第一阶段起始剧情')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '创建并进入设定' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => {
      if (!String(input).endsWith('/api/v1/books/drafts') || (init as RequestInit | undefined)?.method !== 'POST') return false;
      const payload = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      const blueprint = payload.openingBlueprint as Record<string, unknown>;
      return payload.title === '长安簪影'
        && payload.classification === '女频'
        && blueprint.categoryKey === 'female-modern-brain'
        && blueprint.targetAudience === ''
        && Array.isArray(blueprint.protagonists)
        && blueprint.protagonists.length === 0
        && blueprint.worldBackground === ''
        && blueprint.fullBookOutline === ''
        && Array.isArray(blueprint.mainTags)
        && blueprint.mainTags.includes('现言')
        && blueprint.mainTags.includes('脑洞')
        && Array.isArray(blueprint.customTags)
        && blueprint.customTags.includes('轻悬疑')
        && Array.isArray(blueprint.mustFollow)
        && blueprint.mustFollow.includes('不写后宫')
        && blueprint.mustFollow.includes('不靠误会强推剧情');
    })).toBe(true));
  });

  it('开书资料未填完整时明确列出缺失项，不用静默禁用按钮', async () => {
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('fetch', vi.fn(createFetchRouter()));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '创建新书' }));
    const dialog = screen.getByRole('dialog', { name: '创建一本新书' });
    fireEvent.change(within(dialog).getByLabelText('书名'), { target: { value: '待完善的新书' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: '男频' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: '选择作品分类：玄幻脑洞' }));

    expect(within(dialog).getByText('还需填写：必须遵守')).toBeInTheDocument();
    const submit = within(dialog).getByRole('button', { name: '创建并进入设定' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('请先补充：必须遵守');
  });

  it('书籍菜单只提供可逆归档，并使用真实版本调用归档接口', async () => {
    window.history.replaceState(null, '', '/');
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
    expect(document.querySelector('.app-shell')).toHaveStyle({ '--font-scale': '1.2' });
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
    expect(await screen.findByRole('button', { name: /1\. 雾城初响/ })).toHaveClass('active');
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
    expect(await screen.findByRole('heading', { name: '创作准备' })).toBeInTheDocument();
    for (const name of ['本书资料', '设定大纲', '剧情总纲', '卷纲', '章纲']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '章节列表' })).not.toBeInTheDocument();
    expect(await screen.findByText('游戏历史')).toBeInTheDocument();
    expect(screen.queryByText('钟响后可见未来一天')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '设定大纲' }));
    expect(await screen.findByText('钟响后可见未来一天')).toBeInTheDocument();
    expect(screen.getByText('军功与精神力双轨成长')).toBeInTheDocument();
    expect(screen.getByText('游戏历史')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '设定大纲' })).toBeInTheDocument();
    const importBox = screen.getByRole('textbox', { name: '已有设定原文' });
    const catalogHeading = screen.getByRole('heading', { name: '设定大纲' });
    expect(catalogHeading.compareDocumentPosition(importBox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: '搜索设定项' })).toBeInTheDocument();
    expect(screen.getByText('策划理念')).toBeInTheDocument();
    expect(screen.getByText('游戏世界接入方式')).toBeInTheDocument();
    expect(screen.getByText('历史基线')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '自定义设定项' }), { target: { value: '神名禁忌' } });
    fireEvent.click(screen.getByRole('button', { name: '添加到清单' }));
    expect(screen.getByText('神名禁忌')).toBeInTheDocument();
    expect(importBox).toHaveAttribute('maxlength', '10000');
    expect(screen.getAllByRole('button', { name: '跳转讨论' }).length).toBeGreaterThan(10);
    fireEvent.click(screen.getByRole('button', { name: '卷纲' }));
    expect(await screen.findByRole('heading', { name: '第一卷卷纲' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '剧情总纲' }));
    expect(await screen.findByText('守城与预见')).toBeInTheDocument();
    expect(screen.queryByText(/minimum|recommended|suggestedChapters/u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '资料库' }));
    expect(await screen.findByRole('heading', { name: '资料库' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '主角' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关系' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '情绪' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '主角' }));
    expect(await screen.findByRole('heading', { name: '主角实时面板' })).toBeInTheDocument();
    expect(screen.getByText('步兵数量')).toBeInTheDocument();
    expect(screen.getByText('1,200人')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '契约伙伴' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '城池领地' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '待归类' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '身体伤势' })).toBeInTheDocument();
    expect(screen.getByText('后颈疼痛并伴有视觉闪光')).toBeInTheDocument();
    expect(screen.queryByText(/physical_injury|posterior_neck/u)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('为灵魂印记确认分类'), { target: { value: '灵魂能力' } });
    fireEvent.click(screen.getByRole('button', { name: '确认分类' }));
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([input, init]) =>
      String(input).endsWith('/protagonist-state/state-ui-3/classify') && (init as RequestInit | undefined)?.method === 'POST')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '角色' }));
    expect(await screen.findByText('张三')).toBeInTheDocument();
    expect(document.querySelector('.library-workspace pre')).toBeNull();
    fireEvent.click(within(bookRail).getByRole('button', { name: '图谱' }));
    expect(await screen.findByRole('heading', { name: '叙事图谱' })).toBeInTheDocument();
    for (const name of ['人物关系', '情绪', '主线', '支线', '钩子与伏笔', '信息差']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });

  it('编辑基本设定时保留同一故事圣经中的全书框架字段', async () => {
    const fetchMock = vi.fn(createFetchRouter());
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    const bookRail = await screen.findByRole('complementary', { name: '书籍与功能' });
    fireEvent.click(within(bookRail).getByRole('button', { name: '规划' }));
    fireEvent.click(await screen.findByRole('button', { name: '设定大纲' }));
    fireEvent.click(await screen.findByRole('button', { name: '作者编辑' }));
    fireEvent.change(screen.getByRole('textbox', { name: '世界观' }), { target: { value: '钟声只展示与守城有关的未来碎片' } });
    fireEvent.click(screen.getByRole('button', { name: '保存候选' }));

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/artifacts/story-1/versions') && (init as RequestInit | undefined)?.method === 'POST');
      expect(request).toBeDefined();
      const payload = JSON.parse(String((request![1] as RequestInit).body)) as { content: Record<string, unknown>; parentVersionId: string };
      expect(payload.parentVersionId).toBe('story-version-1');
      expect(payload.content).toMatchObject({
        worldView: '钟声只展示与守城有关的未来碎片',
        positioning: { genre: { value: '游戏历史', sourceStatus: 'explicit' } }
      });
    });
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
    expect(await screen.findByRole('button', { name: /1\. 雾城初响/ })).toHaveClass('active');
    const editor = await screen.findByRole('textbox', { name: '正文编辑器' });
    fireEvent.change(editor, { target: { value: '作者修改后的正文' } });
    expect(screen.getByText(/未保存修改/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/manuscripts/owner-drafts') && (init as RequestInit | undefined)?.method === 'POST')).toBe(true));
    expect(screen.getByRole('button', { name: '重写' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '定稿' })).toBeInTheDocument();
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
    const bookRail = await screen.findByRole('complementary', { name: '书籍与功能' });
    fireEvent.click(within(bookRail).getByRole('button', { name: '正文' }));

    expect(await screen.findByRole('button', { name: /1\. 雾城初响/ })).toHaveClass('active');
    const editor = await screen.findByRole('textbox', { name: '正文编辑器' });
    expect(editor).toHaveValue('');
    expect(screen.getByRole('button', { name: '重写' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '定稿' })).toBeDisabled();
    expect(screen.getByText(/先输入或粘贴正文并保存第一稿/)).toBeInTheDocument();

    fireEvent.change(editor, { target: { value: '这是作者从空白章节写下的第一稿。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => {
      const request = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/manuscripts/owner-drafts') && (init as RequestInit | undefined)?.method === 'POST');
      expect(request).toBeDefined();
      expect(JSON.parse(String((request![1] as RequestInit).body))).toMatchObject({ baseManuscriptVersionId: null, content: '这是作者从空白章节写下的第一稿。' });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '重写' })).toBeEnabled());
    expect(screen.getByRole('button', { name: '定稿' })).toBeEnabled();
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
    expect(screen.getByText('可能影响')).toBeInTheDocument();
    expect(screen.getByText('是否阻止定稿结算')).toBeInTheDocument();
    expect(screen.queryByText(/blocksSettlement|relationKey/u)).not.toBeInTheDocument();
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
    }, {
      message_id: 'legacy-fallback-agent-message', sender_type: 'agent' as const, sender_agent_id: 'agent-1', role_key: 'chief_editor',
      model_provider: 'local-deterministic', model_id: 'fixture', message_type: 'discussion_summary',
      content: '主编汇总未能解析为结构化结论，请查看原始结果。',
      references_json: JSON.stringify([{ type: 'effective_output', version: 1, format: 'fallback',
        fullContent: `【婉儿】原始意见\n${JSON.stringify({ version: 1, format: 'json_object', fields: { answer: '先查清灰塔账簿，再决定是否迁移。', keyPoints: ['账簿有断页'], alternatives: [], risks: ['水源不足'], questions: [], nextStep: null, details: null } })}\n规划落库 {"chapters":[1,2,3]}`,
        contentHash: 'b'.repeat(64) }]),
      created_at: '2026-07-16T12:05:00.000Z'
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
    expect(screen.getByText(/先查清灰塔账簿/)).toBeInTheDocument();
    expect(screen.queryByText(/主编汇总未能解析/)).not.toBeInTheDocument();
    expect(screen.queryByText(/规划落库/)).not.toBeInTheDocument();
    expect(screen.queryByText('local-deterministic/fixture')).not.toBeInTheDocument();

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
    if (path === '/api/v1/team-template') return apiResponse({
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
        defaultPrompt: `你是文秘写作团队中的${agent.displayName}（${agent.roleName}）。`
      }))
    });
    if (path.endsWith('/team-config')) return apiResponse({
      members: agents.map((agent) => ({
        ...agent,
        defaultPrompt: `你是文秘写作团队中的${agent.displayName}（${agent.roleName}）。\n主要职责：完成岗位任务。`,
        promptPreference: {
          promptPreferenceId: null, agentId: agent.agentId, version: 0, content: '', createdAt: null
        }
      })),
      promptPolicy: {
        editableLabel: '本书岗位补充要求',
        maxChars: 4000,
        priority: '软性要求不会覆盖系统硬约束、事实证据、正史、安全规则和输出格式。',
        internalPromptVisible: false
      }
    });
    if (path.endsWith('/prompt-preference') && init?.method === 'PUT') {
      const payload = JSON.parse(String(init.body)) as { expectedVersion: number; content: string };
      const agentId = path.split('/').at(-2) ?? '';
      return apiResponse({
        promptPreferenceId: 'preference-ui-1', agentId,
        version: payload.expectedVersion + 1, content: payload.content,
        createdAt: '2026-07-26T12:00:00.000Z'
      });
    }
    if (path.includes('/volumes/') && path.endsWith('/chapters')) return apiResponse({
      items: workspaceData.chapters,
      total: workspaceData.chapters.length,
      offset: Number(url.searchParams.get('offset') ?? 0),
      limit: Number(url.searchParams.get('limit') ?? 80)
    });
    if (path.endsWith('/messages') && init?.method === 'POST') return apiResponse({ messageId: 'message-ui-new', action: { kind: 'conversation_reply_scheduled' } });
    if (path.endsWith('/messages')) return apiResponse(messages);
    if (path.endsWith('/setting-outline-workspace') && init?.method !== 'PUT') return apiResponse([]);
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
      { artifact_id: 'volume-1', artifact_type: 'volume_outline', title: '第一卷卷纲', status: 'active', version: 1, active_version_status: 'active', active_content: { volumeNumber: 1, goal: '揭开钟声来源', arcs: ['雾城危机'], endingState: '城门失守' } },
      { artifact_id: 'chapter-1', artifact_type: 'chapter_outline', title: '第一章章纲', status: 'active', version: 1, active_version_status: 'active', active_content: { chapterNumber: 1, goal: '听见钟声', beats: ['登城'], hook: '未来罪案出现' } }
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
