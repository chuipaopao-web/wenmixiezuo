// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreationWorkspacePage } from './CreationWorkspacePage';
import * as creation from './creation-api';
import * as opening from './opening-api';

vi.mock('./creation-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./creation-api')>();
  return {
    ...actual,
    fetchCreationMembers: vi.fn(), fetchLatestCreationWorkflow: vi.fn(), fetchCreationWorkflow: vi.fn(),
    fetchCreationLibrary: vi.fn(), fetchCreationManuscript: vi.fn(),
    fetchCreationWriteBack: vi.fn(),
    createCreationWorkflow: vi.fn(), activateManagedCreation: vi.fn(), cancelCreationWorkflow: vi.fn(), confirmCreationOutline: vi.fn(),
    retryCreationOptions: vi.fn(), generateCreationOutlines: vi.fn()
  };
});
vi.mock('./opening-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./opening-api')>();
  return { ...actual, fetchPlanningTree: vi.fn(), confirmPlanningTree: vi.fn() };
});

const mockedCreation = vi.mocked(creation);
const mockedOpening = vi.mocked(opening);

describe('V7卷链章创作工作台', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/?view=volume&bookId=book-1');
    mockedOpening.fetchPlanningTree.mockImplementation(async (_bookId, treeKind) =>
      treeKind === 'book' ? bookTree() : treeKind === 'volume' ? volumeTree() : chainTree()
    );
    mockedCreation.fetchCreationMembers.mockResolvedValue(members());
    mockedCreation.fetchCreationLibrary.mockResolvedValue({ volumes: [] });
    mockedCreation.fetchCreationManuscript.mockResolvedValue({
      manuscriptVersionId: 'manuscript-1', workflowId: 'workflow-2', sequenceId: 'outline-2', chapterNumber: 4,
      revision: 1, status: 'final', memberKey: 'writer-kimi-k3', reviewerMemberKey: 'review-glm-5-3',
      content: '张三顶着风雪推开粮仓。', review: { passed: true, publicSummary: '因果清楚。', hardConflicts: [], continuityRisks: [], qualitySuggestions: [], rewriteInstructions: [] },
      createdAt: '2026-08-30T00:00:00.000Z', finalizedAt: '2026-08-30T00:05:00.000Z'
    });
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow());
    mockedCreation.fetchCreationWorkflow.mockResolvedValue(workflow());
    mockedCreation.fetchCreationWriteBack.mockResolvedValue({
      workflowId: 'workflow-1', total: 4, completed: 4, pending: 0, failed: 0, unknown: 0, tasks: []
    });
    mockedCreation.createCreationWorkflow.mockResolvedValue(workflow({ stage: 'context_selection', status: 'waiting' }));
    mockedCreation.activateManagedCreation.mockResolvedValue(workflow({ execution: { mode: 'managed', status: 'active', writerMemberKey: 'writer-kimi-k3', reviewerMemberKey: 'review-glm-5-3', errorMessage: null } }));
    mockedCreation.retryCreationOptions.mockResolvedValue(workflow({ stage: 'volume_options', status: 'working' }));
    mockedCreation.generateCreationOutlines.mockResolvedValue({});
    mockedCreation.confirmCreationOutline.mockResolvedValue({});
  });
  afterEach(cleanup);

  it('默认说明剩余成本并允许作者选择托管或逐章确认', async () => {
    render(<CreationWorkspacePage bookId="book-1" focus="chapter" onNavigate={vi.fn()} />);
    expect(await screen.findByText('下一章：第2章')).toBeVisible();
    expect(screen.getByText(/剩余2章，预计最多进行4次写作与复核/u)).toBeVisible();
    expect(screen.getByText('选择主笔与审校（可不选）')).toBeVisible();
    expect(screen.getByRole('button', { name: /确认托管，写完本链/u })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /确认托管，写完本链/u }));
    await waitFor(() => expect(mockedCreation.activateManagedCreation).toHaveBeenCalledWith('book-1', 'workflow-1', {}));
  });

  it('创作目录加载失败时显示真实错误并可原页重试，不伪装成时光机未确认', async () => {
    mockedCreation.fetchCreationLibrary.mockRejectedValueOnce(new opening.AuthorApiError(
      '创作目录暂时无法加载。', true, 500
    ));
    render(<CreationWorkspacePage bookId="book-1" focus="volume" onNavigate={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('创作目录暂时无法加载。');
    expect(screen.queryByText('先在时光机确认全书方向')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
    expect(await screen.findByText('分卷规划')).toBeVisible();
  });

  it('卷页在正文阶段仍只显示本卷详细骨架，不串入章纲和正文工作台', async () => {
    mockedOpening.fetchPlanningTree.mockImplementation(async (_bookId, treeKind) =>
      treeKind === 'volume' ? volumeTree() : bookTree()
    );
    render(<CreationWorkspacePage bookId="book-1" focus="volume" onNavigate={vi.fn()} />);
    expect(await screen.findByText('分卷规划')).toBeVisible();
    expect(await screen.findByLabelText('本卷方向与粗单元链')).toBeVisible();
    expect(screen.getByText('本卷责任')).toBeVisible();
    expect(screen.getByLabelText('粗单元链')).toBeVisible();
    expect(screen.getByText('本卷详细骨架已确认')).toBeVisible();
    expect(screen.getByRole('button', { name: '进入链页' })).toBeEnabled();
    expect(screen.getAllByText('军营立足')[0]).toBeVisible();
    expect(screen.queryByText('本卷单元链')).not.toBeInTheDocument();
    expect(screen.queryByText('下一章：第2章')).not.toBeInTheDocument();
    expect(screen.queryByText('本链章纲')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '创作步骤' })).not.toBeInTheDocument();
  });

  it('卷骨架的阶段确认只出现在内容底部操作区', async () => {
    const candidate = { ...volumeTree(), status: 'candidate' as const };
    mockedOpening.fetchPlanningTree.mockImplementation(async (_bookId, treeKind) => treeKind === 'book' ? bookTree() : candidate);
    mockedOpening.confirmPlanningTree.mockResolvedValue({ ...candidate, status: 'confirmed' });
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({ stage: 'volume_tree_confirmation', status: 'waiting' }));
    render(<CreationWorkspacePage bookId="book-1" focus="volume" onNavigate={vi.fn()} />);
    const dock = await screen.findByRole('group', { name: '当前步骤操作' });
    expect(dock).toHaveTextContent('本卷方向与粗单元链草案已经完成');
    expect(dock.querySelectorAll('.workflow-action-dock-primary > button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '确认采用' }));
    await waitFor(() => expect(mockedOpening.confirmPlanningTree).toHaveBeenCalledWith('book-1', 'volume', 'volume-1', 1));
  });

  it('链页显示全卷单元链和已确认章纲，不显示正文操作', async () => {
    mockedOpening.fetchPlanningTree.mockImplementation(async (_bookId, treeKind) =>
      treeKind === 'volume' ? volumeTree() : treeKind === 'chain' ? chainTree() : bookTree()
    );
    render(<CreationWorkspacePage bookId="book-1" focus="chain" onNavigate={vi.fn()} />);
    expect(await screen.findByText('本卷单元链')).toBeVisible();
    expect(await screen.findByText('单元链事件节奏')).toBeVisible();
    expect(screen.getByText('起因与阻力')).toBeVisible();
    expect(screen.getByText('情绪变化')).toBeVisible();
    expect(screen.getByText('伏笔')).toBeVisible();
    expect(screen.getByText('待回答问题')).toBeVisible();
    expect(screen.getByText('已确认章纲')).toBeVisible();
    expect(screen.getByRole('button', { name: '进入章页写正文' })).toBeEnabled();
    expect(document.querySelector('.creation-outline-member-row .creation-avatar')).toBeInTheDocument();
    expect(screen.queryByText('下一章：第2章')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /确认托管/u })).not.toBeInTheDocument();
  });

  it('章页以正文为主，只把本章章纲放在折叠参考中', async () => {
    render(<CreationWorkspacePage bookId="book-1" focus="chapter" onNavigate={vi.fn()} />);
    expect(await screen.findByText('下一章：第2章')).toBeVisible();
    expect(screen.getByText('章节正文')).toBeVisible();
    expect(await screen.findByText('军营立足')).toBeVisible();
    expect(screen.getByText('第2章章纲')).toBeVisible();
    fireEvent.click(screen.getByText('第2章章纲'));
    expect(screen.getByText(/场景准备/u)).toBeVisible();
    expect(screen.getByText(/情绪推进/u)).toBeVisible();
    expect(screen.getByText(/连续性责任/u)).toBeVisible();
    expect(screen.getByText(/待回答问题/u)).toBeVisible();
    expect(screen.queryByText('本卷单元链')).not.toBeInTheDocument();
    expect(screen.queryByText('已确认章纲')).not.toBeInTheDocument();
  });

  it('正文待确认时同时显示本章主笔和独立审校头像', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({
      stage: 'manuscript_confirmation', status: 'waiting_for_you',
      manuscript: {
        manuscriptVersionId: 'manuscript-2', chapterNumber: 2, revision: 1, status: 'reviewed',
        memberKey: 'writer-kimi-k3', reviewerMemberKey: 'review-glm-5-3', content: '张三翻开粮册。',
        review: { passed: true, publicSummary: '人物行动和前后因果成立。', hardConflicts: [{
          evidence: '军营时间与上章冲突。', impact: '时间线无法衔接。', action: '改回已确认时间。'
        }], continuityRisks: [], qualitySuggestions: [], rewriteInstructions: [] }
      }
    }));
    render(<CreationWorkspacePage bookId="book-1" focus="chapter" onNavigate={vi.fn()} />);
    expect(await screen.findByText('第2章正文')).toBeVisible();
    expect(screen.getAllByText('清照 · 主笔').some((node) => node.closest('.creation-result-members') !== null)).toBe(true);
    expect(screen.getByText('顾清辞 · 独立审查')).toBeVisible();
    fireEvent.click(screen.getByText('完整审查'));
    expect(screen.getByText('必须处理')).toBeVisible();
    expect(screen.getByText('军营时间与上章冲突。')).toBeInTheDocument();
    expect(document.querySelectorAll('.creation-result-members .creation-avatar')).toHaveLength(2);
  });

  it('卷开始前默认一套，需要比较时才展开到三个固定策划编剧席位', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(null);
    render(<CreationWorkspacePage bookId="book-1" focus="volume" onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByText('需要多做几套对比？'));
    expect(screen.getByText('方案一编剧')).toBeVisible();
    expect(screen.queryByText('方案二编剧')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1套' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '3套' }));
    expect(screen.getByText('方案二编剧')).toBeVisible();
    expect(screen.getByText('方案三编剧')).toBeVisible();
    expect(screen.getAllByText('自动安排不同成员')).toHaveLength(3);
    expect(screen.queryByText('结构编剧')).not.toBeInTheDocument();
    expect(screen.queryByText('追读编剧')).not.toBeInTheDocument();
    expect(screen.queryByText('人物编剧')).not.toBeInTheDocument();
  });

  it('章纲默认一案并沿用固定策划编剧池，不依赖重复的章纲临时身份', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({
      stage: 'chain_tree_confirmation', status: 'waiting_for_you', outline: null
    }));
    mockedOpening.fetchPlanningTree.mockImplementation(async (_bookId, treeKind) =>
      treeKind === 'chain' ? chainTree() : bookTree()
    );
    render(<CreationWorkspacePage bookId="book-1" focus="chain" onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByText('需要多做几套对比？'));
    expect(screen.getByRole('button', { name: '1套' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('方案一编剧')).toBeVisible();
    const label = screen.getByText('方案一编剧').closest('label');
    expect(label).not.toBeNull();
    const options = Array.from(label!.querySelectorAll('option')).map((option) => option.textContent);
    expect(options.some((option) => option?.startsWith('红玉'))).toBe(true);
    expect(options).toEqual(expect.arrayContaining(['幼薇', '苏映棠']));
    expect(document.body.textContent).not.toMatch(/outline_writer|结构编剧|追读编剧|人物编剧/u);
  });

  it('章纲资料超限时显示服务返回的真实原因，不误报为连接失败', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({
      stage: 'chain_tree_confirmation', status: 'waiting_for_you', outline: null
    }));
    mockedOpening.fetchPlanningTree.mockImplementation(async (_bookId, treeKind) =>
      treeKind === 'chain' ? chainTree() : bookTree()
    );
    mockedCreation.generateCreationOutlines.mockRejectedValue(new opening.AuthorApiError(
      '对不起，当前资料仍超过章纲安全范围，请先压缩重复资料。', true, 409
    ));
    render(<CreationWorkspacePage bookId="book-1" focus="chain" onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '生成章纲' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('当前资料仍超过章纲安全范围');
    expect(screen.getByRole('alert')).not.toHaveTextContent('连接不上');
  });

  it('托管执行中显示真实成员头像、动态与可停止入口', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({
      status: 'working',
      message: '亲爱的，第2章正在加急创作中 ✍️',
      execution: { mode: 'managed', status: 'active', writerMemberKey: 'writer-kimi-k3', reviewerMemberKey: 'review-glm-5-3', errorMessage: null },
      actors: [
        { memberKey: 'writer-kimi-k3', memberName: '清照', role: 'lead_writer', status: 'working', message: '第2章正在创作中', emoji: '✍️' },
        { memberKey: 'creation-writer-kimi-k3', memberName: '清照', role: 'outline_writer', status: 'working', message: '重复快照', emoji: '✍️' }
      ]
    }));
    render(<CreationWorkspacePage bookId="book-1" focus="chapter" onNavigate={vi.fn()} />);
    expect((await screen.findAllByText('第2章正在创作中'))[0]).toBeVisible();
    expect(screen.getAllByText('清照 · 主笔')[0]).toBeVisible();
    expect(screen.getByText(/本链还剩2章/u)).toBeVisible();
    expect(screen.getByRole('button', { name: '停止任务' })).toBeEnabled();
    fireEvent.click(screen.getByText('查看编辑部状态'));
    expect(document.querySelectorAll('.creation-actor-list article')).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/lead_writer|outline_writer/u);
  });

  it('等待作者确认时把遗留的工作中快照收口为已完成，不继续显示成员在工作', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({
      status: 'waiting_for_you',
      actors: [{ memberKey: 'writer-kimi-k3', memberName: '清照', role: 'lead_writer', status: 'working', message: '旧快照仍说正在写作', emoji: '✍️' }],
      execution: { mode: 'managed', status: 'active', writerMemberKey: 'writer-kimi-k3', reviewerMemberKey: null, errorMessage: null }
    }));
    render(<CreationWorkspacePage bookId="book-1" focus="chapter" onNavigate={vi.fn()} />);
    expect(await screen.findByText('编辑部当前空闲')).toBeVisible();
    expect(screen.queryByText('旧快照仍说正在写作')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('查看编辑部状态'));
    expect(screen.getByText(/本轮工作已经完成/u)).toBeVisible();
  });

  it('任务排队且没有真实执行者时不补假头像，也不声称成员正在工作', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({
      status: 'waiting', message: '任务已经进入队列。', actors: [],
      execution: { mode: 'managed', status: 'active', writerMemberKey: null, reviewerMemberKey: null, errorMessage: null }
    }));
    render(<CreationWorkspacePage bookId="book-1" focus="chapter" onNavigate={vi.fn()} />);
    expect(await screen.findByText('任务正在排队')).toBeVisible();
    expect(document.querySelector('.creation-waiting.managed .creation-avatar')).not.toBeInTheDocument();
    expect(screen.queryByText(/正在工作/u)).not.toBeInTheDocument();
  });

  it('停止任务使用手机友好的页内确认并保留已有成果', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({ status: 'working' }));
    mockedCreation.cancelCreationWorkflow.mockResolvedValue(workflow({
      status: 'cancelled',
      message: '任务已停止，已经完成的内容仍然保留。',
      execution: { mode: 'manual', status: 'cancelled', writerMemberKey: null, reviewerMemberKey: null, errorMessage: null }
    }));
    render(<CreationWorkspacePage bookId="book-1" focus="chapter" onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '停止任务' }));
    expect(screen.getByRole('group', { name: '确认停止任务' })).toBeVisible();
    expect(screen.getByText('已完成的内容会保留。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '保留成果并停止' }));
    await waitFor(() => expect(mockedCreation.cancelCreationWorkflow).toHaveBeenCalledWith('book-1', 'workflow-1'));
  });

  it('正常资料回写不会误报已经停止，并明确完成后会自动继续', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({
      stage: 'settlement', status: 'working', message: '正文已经定稿，正在更新后续资料。',
      actors: [{
        memberKey: 'continuity-deepseek-v4-pro', memberName: '裴文心', role: 'settlement_editor',
        status: 'completed', message: '本章结算已经完成。', emoji: '✍️'
      }],
      execution: { mode: 'managed', status: 'active', writerMemberKey: 'writer-kimi-k3', reviewerMemberKey: null, errorMessage: null }
    }));
    mockedCreation.fetchCreationWriteBack.mockResolvedValue({
      workflowId: 'workflow-1', total: 13, completed: 12, pending: 1, failed: 0, unknown: 0,
      tasks: [{ taskId: 'planning-1', task: '更新实际规划', status: 'working', message: '正在整理。', attempts: 1, updatedAt: '2026-08-29T12:00:00.000Z' }]
    });
    render(<CreationWorkspacePage bookId="book-1" focus="chapter" onNavigate={vi.fn()} />);
    expect(await screen.findByText('正文已安全保存，正在更新故事进度')).toBeVisible();
    expect(screen.getByText('正在把本章变化更新到后续创作资料，完成后会自动继续。')).toBeVisible();
    expect(screen.queryByText(/已停止继续写作/u)).not.toBeInTheDocument();
  });

  it('停止续写后仍如实显示已经开始的本章资料整理，不假报编辑部空闲', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({
      stage: 'settlement', status: 'cancelled', message: '作者停止了继续写作。',
      actors: [{
        memberKey: 'continuity-deepseek-v4-pro', memberName: '裴文心', role: 'settlement_editor',
        status: 'completed', message: '旧快照显示完成。', emoji: '✍️'
      }],
      execution: { mode: 'manual', status: 'cancelled', writerMemberKey: null, reviewerMemberKey: null, errorMessage: null }
    }));
    mockedCreation.fetchCreationWriteBack.mockResolvedValue({
      workflowId: 'workflow-1', total: 13, completed: 12, pending: 1, failed: 0, unknown: 0,
      tasks: [{ taskId: 'planning-1', task: '更新实际规划', status: 'working', message: '正在整理。', attempts: 1, updatedAt: '2026-08-29T12:00:00.000Z' }]
    });
    render(<CreationWorkspacePage bookId="book-1" focus="chapter" onNavigate={vi.fn()} />);
    expect((await screen.findAllByText('裴文心 · 记录编辑'))[0]).toBeVisible();
    expect(screen.getByText('已停止续写，正在完成本章资料整理')).toBeVisible();
    expect(screen.queryByText('编辑部当前空闲')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '正在完成本章整理…' })).toBeDisabled();
  });

  it('资料整理失败后在原页保留失败说明并允许重新开始本卷', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({
      stage: 'context_selection', status: 'failed', options: [], completedOptions: 0,
      message: '对不起，这次资料没有整理完成。', errorMessage: '对不起，这次资料没有整理完成。'
    }));
    render(<CreationWorkspacePage bookId="book-1" focus="volume" onNavigate={vi.fn()} />);
    expect(await screen.findByText('这次没有完成')).toBeVisible();
    expect(screen.getByText('选择要开始的卷')).toBeVisible();
    expect(screen.getByRole('button', { name: '请编辑部设计本卷' })).toBeEnabled();
  });

  it('成员失败时先道歉并保留重新托管和换成员入口', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({
      status: 'failed', message: '对不起，这次没有完成。红玉没有交回可用正文。', errorMessage: '对不起，这次没有完成。红玉没有交回可用正文。',
      execution: { mode: 'managed', status: 'failed', writerMemberKey: 'writer-kimi-k3', reviewerMemberKey: 'review-glm-5-3', errorMessage: '对不起，这次没有完成。' },
      actors: [{ memberKey: 'writer-kimi-k3', memberName: '清照', role: 'lead_writer', status: 'failed', message: '对不起，这次没有完成，可以换一位成员继续。', emoji: '🙇' }]
    }));
    render(<CreationWorkspacePage bookId="book-1" focus="chapter" onNavigate={vi.fn()} />);
    expect(await screen.findByText(/对不起，这次没有完成。红玉没有交回可用正文/u)).toBeVisible();
    expect(screen.getByText('选择主笔与审校（可不选）')).toBeVisible();
    expect(screen.getByRole('button', { name: /确认托管，写完本链/u })).toBeEnabled();
  });

  it('卷方案缺一套时保留已有方案并允许页内补位', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({
      stage: 'volume_options', status: 'failed', completedOptions: 2, options: [planningOption(1), planningOption(2)],
      chiefReview: null, message: '编辑部已经保留两套方案。', errorMessage: '对不起，本轮只完成了2套，三套齐全后才能交给您选择。'
    }));
    render(<CreationWorkspacePage bookId="book-1" focus="volume" onNavigate={vi.fn()} />);
    expect(await screen.findByText('还差1套方案')).toBeVisible();
    expect(screen.getByText('结构递进一')).toBeVisible();
    expect(screen.getByText('结构递进二')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '只补失败方案' }));
    await waitFor(() => expect(mockedCreation.retryCreationOptions).toHaveBeenCalledWith('book-1', 'workflow-1'));
  });

  it('三套方案已齐但点评失败时只提示主编继续点评', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({
      stage: 'volume_options', status: 'failed', completedOptions: 3,
      options: [planningOption(1), planningOption(2), planningOption(3)], chiefReview: null,
      message: '对不起，这次没有完成。主编点评格式无效',
      errorMessage: '对不起，这次没有完成。主编点评格式无效'
    }));
    render(<CreationWorkspacePage bookId="book-1" focus="volume" onNavigate={vi.fn()} />);
    expect(await screen.findByText('方案已保留，正在整理结果')).toBeVisible();
    expect(screen.queryByText('还差0套方案')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续整理' }));
    await waitFor(() => expect(mockedCreation.retryCreationOptions).toHaveBeenCalledWith('book-1', 'workflow-1'));
  });

  it('旧整批重做意见不再清空成功方案或开启新一轮', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({
      stage: 'volume_options', status: 'failed', options: [planningOption(1), planningOption(2), planningOption(3)],
      chiefReview: null,
      optionRevision: {
        memberKey: 'chief-deepseek-v4-pro', memberName: '貂蝉',
        publicSummary: '三套路径过于接近，关键转折和代价需要真正分开。',
        risks: ['三套都沿用同一条事件链。'], authorDecisions: ['下一轮必须改变关键转折和对手反应。']
      }
    }));
    render(<CreationWorkspacePage bookId="book-1" focus="volume" onNavigate={vi.fn()} />);
    expect(await screen.findByText('方案已保留，正在整理结果')).toBeVisible();
    expect(screen.getByText('结构递进一')).toBeVisible();
    expect(screen.getByText('结构递进二')).toBeVisible();
    expect(screen.getByText('结构递进三')).toBeVisible();
    expect(screen.queryByRole('button', { name: /重新设计三案/u })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续整理' }));
    await waitFor(() => expect(mockedCreation.retryCreationOptions).toHaveBeenCalledWith('book-1', 'workflow-1'));
  });

  it('三套方案已齐但点评失败时只提示主编继续点评', async () => {
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({
      stage: 'volume_options', status: 'failed', completedOptions: 3,
      options: [planningOption(1), planningOption(2), planningOption(3)], chiefReview: null,
      message: '对不起，这次没有完成。主编点评格式无效',
      errorMessage: '对不起，这次没有完成。主编点评格式无效'
    }));
    render(<CreationWorkspacePage bookId="book-1" focus="volume" onNavigate={vi.fn()} />);
    expect(await screen.findByText('方案已保留，正在整理结果')).toBeVisible();
    expect(screen.queryByText('还差0套方案')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续整理' }));
    await waitFor(() => expect(mockedCreation.retryCreationOptions).toHaveBeenCalledWith('book-1', 'workflow-1'));
  });

  it('三套卷方案完整展示主编差异和可展开的全案', async () => {
    const options = [planningOption(1), planningOption(2), planningOption(3)];
    mockedCreation.fetchLatestCreationWorkflow.mockResolvedValue(workflow({
      stage: 'volume_decision', status: 'waiting_for_you', completedOptions: 3, options,
      chiefReview: {
        memberKey: 'chief-1', memberName: '貂蝉', summary: '三套都完整，第一套卷间因果最稳。',
        recommendedOptionId: options[0]!.optionId,
        differences: options.map((option, index) => ({ optionId: option.optionId, difference: `第${index + 1}套的剧情抓力不同。` })),
        risks: ['第二套中段可能偏慢。'], authorDecisions: ['采用后每三章安排一次小回报。']
      }
    }));
    render(<CreationWorkspacePage bookId="book-1" focus="volume" onNavigate={vi.fn()} />);
    expect(await screen.findByText('貂蝉主编的建议')).toBeVisible();
    expect(screen.getByText('第1套的剧情抓力不同。')).toBeVisible();
    fireEvent.click(screen.getByText('查看主编提醒'));
    expect(screen.getByText('第二套中段可能偏慢。')).toBeVisible();
    expect(screen.getByText('采用后每三章安排一次小回报。')).toBeVisible();
    const details = screen.getAllByText('查看完整卷方案')[0]!.closest('details');
    expect(details).not.toBeNull();
    fireEvent.click(details!.querySelector('summary')!);
    expect(screen.getAllByText('军营立足')[0]).toBeVisible();
    expect(screen.getByRole('button', { name: '采用主编推荐' })).toBeEnabled();
  });

  it('卷目录可以切换到其他分卷并读取该卷已保存骨架', async () => {
    mockedOpening.fetchPlanningTree.mockImplementation(async (_bookId, treeKind, scopeId) => {
      if (treeKind === 'book') return bookTree(true);
      if (treeKind === 'volume' && scopeId === 'volume-2') return volumeTreeTwo();
      if (treeKind === 'volume') return volumeTree();
      return chainTree();
    });
    mockedCreation.fetchCreationLibrary.mockResolvedValue({ volumes: [
      { volumeScopeId: 'volume-1', status: 'working', latestWorkflowId: 'workflow-1', chains: [] },
      { volumeScopeId: 'volume-2', status: 'completed', latestWorkflowId: 'workflow-2', chains: [] }
    ] });
    render(<CreationWorkspacePage bookId="book-1" focus="volume" onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /第二卷/u }));
    expect(await screen.findByText('北境决战')).toBeVisible();
    expect(screen.getByText('正在查看已保存的分卷')).toBeVisible();
    expect(window.location.search).toContain('volumeId=volume-2');
  });

  it('链目录可以切换到已完成单元链并查看对应章纲', async () => {
    mockedOpening.fetchPlanningTree.mockImplementation(async (_bookId, treeKind, scopeId) =>
      treeKind === 'book' ? bookTree() : treeKind === 'volume' ? volumeTree() : scopeId === 'chain-2' ? chainTreeTwo() : chainTree()
    );
    mockedCreation.fetchCreationLibrary.mockResolvedValue(libraryWithHistory());
    const onNavigate = vi.fn();
    render(<CreationWorkspacePage bookId="book-1" focus="chain" onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByRole('button', { name: /粮序初立/u }));
    expect(await screen.findByText('粮仓反击')).toBeVisible();
    expect(screen.getByText('已按章节展开，正文请到章页查看。')).toBeVisible();
    expect(window.location.search).toContain('chainId=chain-2');
    fireEvent.click(screen.getByRole('button', { name: '查看本链正文' }));
    expect(onNavigate).toHaveBeenCalledWith('chapter', { chapter: 4 });
  });

  it('链目录切换到旧版单字符串列表时仍能完整展示，不会白屏', async () => {
    window.history.replaceState({}, '', '/?view=chain&bookId=book-1&volumeId=volume-1&chainId=chain-2');
    mockedOpening.fetchPlanningTree.mockImplementation(async (_bookId, treeKind, scopeId) =>
      treeKind === 'book' ? bookTree() : treeKind === 'volume' ? volumeTree() : scopeId === 'chain-1' ? legacyStringListChainTree() : chainTreeTwo()
    );
    render(<CreationWorkspacePage bookId="book-1" focus="chain" onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /军营立足/u }));
    expect(await screen.findByText(/旧仓簿是一项历史原因/u)).toBeVisible();
    expect(screen.getByText(/守住粮仓会带来新的影响/u)).toBeVisible();
    expect(screen.getByText(/缺页账册是一条历史伏笔/u)).toBeVisible();
    expect(screen.getByText(/谁改过旧账是待回答问题/u)).toBeVisible();
    expect(window.location.search).toContain('chainId=chain-1');
  });

  it('章目录可以打开历史章节并显示完整正文', async () => {
    mockedCreation.fetchCreationLibrary.mockResolvedValue(libraryWithHistory());
    render(<CreationWorkspacePage bookId="book-1" focus="chapter" onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByText('粮序初立'));
    const chapterButton = (await screen.findByText('粮仓反击')).closest('button');
    expect(chapterButton).not.toBeNull();
    fireEvent.click(chapterButton!);
    expect(await screen.findByText('张三顶着风雪推开粮仓。')).toBeVisible();
    expect(mockedCreation.fetchCreationManuscript).toHaveBeenCalledWith('book-1', 'manuscript-1', expect.any(AbortSignal));
    expect(window.location.search).toContain('chapter=4');
  });
});

function planningOption(index: 1 | 2 | 3): creation.CreationWorkflowView['options'][number] {
  return {
    optionId: `option-${index}`, seat: `方案${['一', '二', '三'][index - 1]}` as '方案一' | '方案二' | '方案三',
    memberKey: `writer-${index}`, memberName: ['红玉', '幼薇', '清照'][index - 1]!,
    name: `结构递进${['一', '二', '三'][index - 1]}`, summary: '张三靠主动选择改变军中处境。',
    readerExperience: '承压后得到明确回报。', coreConflict: '小卒求生与军中旧规冲突。',
    protagonistChoice: '张三先保住同袍，再追查粮册。', priceAndChange: '暴露能力，也赢得信任。',
    payoff: '张三获得第一批愿意追随他的同袍。', strengths: ['主角主动'], risks: ['不能让名将替主角完成选择'],
    steps: [{ sequence: 1, title: '军营立足', summary: '从被排挤到获得初步信任。', majorEvents: ['保住同袍', '发现粮册异常'],
      protagonistChange: '开始承担同袍责任。', emotion: '压迫后释放', experience: '主角主动改变处境', outcome: '获得信任',
      nextStep: '追查粮册', wordTarget: 30_000, chapterRange: [1, 10] }]
  };
}

function workflow(overrides: Partial<creation.CreationWorkflowView> = {}): creation.CreationWorkflowView {
  return {
    workflowId: 'workflow-1', bookId: 'book-1', stage: 'manuscript', status: 'waiting_for_you',
    message: '红玉已经准备好，可以继续写第2章。', firstVolume: true, volumeScopeId: 'volume-1', chainScopeId: 'chain-1',
    completedOptions: 3, expectedOptions: 3, options: [], chiefReview: null, optionRevision: null,
    outline: { sequenceId: 'outline-1', revision: 1, status: 'confirmed', memberKey: 'planner-kimi-k3', reviewerMemberKey: null, review: null, content: {
      publicSummary: '三章完成一次明确回报。', chapterStart: 1, chapterEnd: 3,
      chapters: [1, 2, 3].map((chapterNumber) => ({ chapterNumber, title: `第${chapterNumber}章`, objective: '改变当前处境', openingHook: '军法官点名。', sceneSetup: '军营。', protagonistChoice: '张三主动选择。', opposition: '军法与饥饿。', turn: '粮册出现异常。', emotionalMovement: '承压后释放。', payoff: '赢得信任。', continuity: '承接上章。', openQuestions: ['谁改了粮册？'], nextChapterInterface: '继续追查。' }))
    } },
    manuscript: null, progress: { completedChapters: 1, totalChapters: 3, percent: 33, nextChapterNumber: 2 },
    remainingChains: [], volumeComplete: false,
    actors: [{ memberKey: 'writer-kimi-k3', memberName: '清照', role: 'lead_writer', status: 'waiting', message: '我在这儿，随时可以接单。', emoji: '🌿' }],
    execution: { mode: 'manual', status: 'inactive', writerMemberKey: null, reviewerMemberKey: null, errorMessage: null },
    errorMessage: null,
    ...overrides
  };
}

function members(): creation.CreationMember[] {
  return [
    { memberKey: 'planner-deepseek-v4-pro', name: '红玉', roleKey: 'planning_writer', role: 'planning_writer', defaultForRole: true },
    { memberKey: 'planner-glm-5-3', name: '幼薇', roleKey: 'planning_writer', role: 'planning_writer', defaultForRole: false },
    { memberKey: 'planner-kimi-k3', name: '苏映棠', roleKey: 'planning_writer', role: 'planning_writer', defaultForRole: false },
    { memberKey: 'chief-deepseek-v4-pro', name: '貂蝉', roleKey: 'chief_editor', role: 'chief_editor', defaultForRole: true },
    { memberKey: 'writer-kimi-k3', name: '清照', roleKey: 'lead_writer', role: 'lead_writer', defaultForRole: true },
    { memberKey: 'writer-deepseek-v4-pro', name: '司马相如', roleKey: 'lead_writer', role: 'lead_writer', defaultForRole: false },
    { memberKey: 'review-glm-5-3', name: '顾清辞', roleKey: 'independent_reviewer', role: 'independent_reviewer', defaultForRole: true }
  ];
}

function bookTree(includeSecond = false): opening.PlanningTreeView {
  return { treeKind: 'book', scopeId: 'book-1', revision: 1, status: 'confirmed', title: '全书方向', root: node('book-root', 'book', '全书方向', null, [node('volume-1', 'volume', '第一卷', { treeKind: 'volume', scopeId: 'volume-1' }, []), ...(includeSecond ? [node('volume-2', 'volume', '第二卷', { treeKind: 'volume', scopeId: 'volume-2' }, [])] : [])]) };
}

function chainTree(): opening.PlanningTreeView {
  return { treeKind: 'chain', scopeId: 'chain-1', revision: 1, status: 'confirmed', title: '单元链方向', root: node('chain-1', 'chain', '军营立足', null, [
    node('event-1', 'event', '粮册异常', null, [])
  ]) };
}

function chainTreeTwo(): opening.PlanningTreeView {
  return { treeKind: 'chain', scopeId: 'chain-2', revision: 1, status: 'confirmed', title: '粮仓反击', root: node('chain-2', 'chain', '粮仓反击', null, []) };
}

function legacyStringListChainTree(): opening.PlanningTreeView {
  const tree = chainTree();
  for (const entry of [tree.root, ...tree.root.children]) {
    Object.assign(entry.causality, {
      causes: '旧仓簿是一项历史原因。',
      consequences: '守住粮仓会带来新的影响。'
    });
    Object.assign(entry.threads, {
      foreshadowing: '缺页账册是一条历史伏笔。',
      openQuestions: '谁改过旧账是待回答问题？'
    });
  }
  return tree;
}

function volumeTree(): opening.PlanningTreeView {
  return { treeKind: 'volume', scopeId: 'volume-1', revision: 1, status: 'confirmed', title: '第一卷详细骨架', root: node('volume-1', 'volume', '柳林求生', null, [
    node('chain-1', 'chain', '军营立足', { treeKind: 'chain', scopeId: 'chain-1' }, []),
    node('chain-2', 'chain', '粮序初立', { treeKind: 'chain', scopeId: 'chain-2' }, [])
  ]) };
}

function volumeTreeTwo(): opening.PlanningTreeView {
  return { treeKind: 'volume', scopeId: 'volume-2', revision: 1, status: 'confirmed', title: '第二卷详细骨架', root: node('volume-2', 'volume', '北境决战', null, [
    node('chain-3', 'chain', '北境集结', { treeKind: 'chain', scopeId: 'chain-3' }, [])
  ]) };
}

function libraryWithHistory(): creation.CreationLibraryView {
  const active = workflow();
  const firstChapter = { ...active.outline!.content.chapters[0]!, chapterNumber: 4, title: '粮仓反击' };
  return { volumes: [{
    volumeScopeId: 'volume-1', status: 'working', latestWorkflowId: 'workflow-1', chains: [{
      chainScopeId: 'chain-2', workflowId: 'workflow-2', status: 'completed', outline: {
        sequenceId: 'outline-2', revision: 1, status: 'confirmed', memberKey: 'planner-glm-5-3',
        reviewerMemberKey: 'chief-deepseek-v4-pro', review: null,
        content: { publicSummary: '粮仓危机完成一次阶段回报。', chapterStart: 4, chapterEnd: 4, chapters: [firstChapter] },
        chapters: [{ chapter: firstChapter, manuscript: {
          manuscriptVersionId: 'manuscript-1', revision: 1, status: 'final', memberKey: 'writer-kimi-k3',
          reviewerMemberKey: 'review-glm-5-3', review: null
        } }]
      }
    }]
  }] };
}

function node(key: string, kind: opening.PlanningTreeNodeView['kind'], title: string, linkedTree: opening.PlanningTreeNodeView['linkedTree'], children: opening.PlanningTreeNodeView[]): opening.PlanningTreeNodeView {
  return { key, kind, sequence: 1, title, story: { summary: '张三在军营站稳脚跟。', majorEvents: ['站稳脚跟'], protagonistChange: '承担责任', outcome: '获得信任', nextStep: '继续追查' }, emotion: { publicSummary: '承压后释放', openingEmotion: '紧张', pressureMovement: '加压', releaseEmotion: '释放', intensity: 'strong' }, experience: { publicSummary: '主角主动改变处境', pressureRhythm: '逐步加压', payoffCadence: '及时回报', informationRhythm: '逐步揭示', contrastWithPrevious: '压力升级', designReason: '保持追读' }, causality: { trigger: '被点名', causes: ['粮册异常'], coreConflict: '小卒与军规', turningPoint: '主动举证', consequences: ['获得信任'] }, threads: { foreshadowing: [], openQuestions: [] }, budget: { wordTarget: 120_000, chapterRange: [1, 40] }, linkedTree, actual: null, children };
}
