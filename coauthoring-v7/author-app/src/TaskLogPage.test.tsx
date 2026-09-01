import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskLogPage } from './TaskLogPage';
import * as opening from './opening-api';
import * as creation from './creation-api';

vi.mock('./AuthorAccountBoundary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./AuthorAccountBoundary')>();
  return { ...actual, useAuthorAccount: () => ({ account: { userId: 'task-log-test-user' } }) };
});
vi.mock('./opening-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./opening-api')>();
  return {
    ...actual,
    fetchOpeningTasks: vi.fn(), fetchDesignTasks: vi.fn(), fetchPlanningTasks: vi.fn(), fetchSettingTasks: vi.fn(),
    abandonOpeningTask: vi.fn(), abandonAllOpeningTasks: vi.fn(),
    cancelPlanningRouteRun: vi.fn(), cancelPlanningTreeGeneration: vi.fn()
  };
});
vi.mock('./creation-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./creation-api')>();
  return { ...actual, fetchCreationTasks: vi.fn(), cancelCreationWorkflow: vi.fn() };
});

const mockedOpening = vi.mocked(opening);
const mockedCreation = vi.mocked(creation);

describe('V7统一任务中心', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedOpening.fetchOpeningTasks.mockResolvedValue([]);
    mockedOpening.fetchDesignTasks.mockResolvedValue([]);
    mockedOpening.fetchSettingTasks.mockResolvedValue([]);
    mockedCreation.fetchCreationTasks.mockResolvedValue([]);
    mockedOpening.fetchPlanningTasks.mockResolvedValue([planningTask()]);
    mockedOpening.cancelPlanningRouteRun.mockResolvedValue({} as opening.PlanningRouteRunView);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('显示规划成员头像与真实进度，并可恢复或停止长任务', async () => {
    const openPlanning = vi.fn();
    render(<TaskLogPage onOpenTask={vi.fn()} onOpenBook={vi.fn()} onOpenPlanning={openPlanning} />);
    expect(await screen.findByText(/主编正在比较三套全书路线/u)).toBeVisible();
    expect(screen.getByTitle('貂蝉')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /继续处理/u }));
    expect(openPlanning).toHaveBeenCalledWith('book-1');
    fireEvent.click(screen.getByRole('button', { name: '停止任务' }));
    expect(screen.getByText(/已经完成的路线会保留/u)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '保留成果并停止' }));
    await waitFor(() => expect(mockedOpening.cancelPlanningRouteRun).toHaveBeenCalledWith('book-1', 'route-1'));
    expect(screen.getByText(/任务已停止，已经完成的内容仍然保留/u)).toBeVisible();
  });

  it('全书路线失败时先道歉，同时保留已有结果说明和恢复入口', async () => {
    const openPlanning = vi.fn();
    mockedOpening.fetchPlanningTasks.mockResolvedValue([{
      ...planningTask(), status: 'failed', message: '当前进度已经保存。',
      memberKey: 'deputy-glm-5-3', memberName: '西施', canStop: false
    }]);
    render(<TaskLogPage onOpenTask={vi.fn()} onOpenBook={vi.fn()} onOpenPlanning={openPlanning} />);

    expect(await screen.findByText('🙇 西施：对不起，这次没有完成。当前进度已经保存。')).toBeVisible();
    expect(screen.getByText('本轮未完成')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /继续处理/u }));
    expect(openPlanning).toHaveBeenCalledWith('book-1');
  });

  it('同一规划范围只有最新任务计入待处理，旧失败进入历史', async () => {
    mockedOpening.fetchPlanningTasks.mockResolvedValue([
      { ...planningTask(), taskId: 'route-new', status: 'working', actionable: true, updatedAt: '2026-08-27T02:00:00.000Z' },
      { ...planningTask(), taskId: 'route-old', status: 'failed', actionable: false, canStop: false, updatedAt: '2026-08-27T01:00:00.000Z' }
    ]);
    render(<TaskLogPage onOpenTask={vi.fn()} onOpenBook={vi.fn()} onOpenPlanning={vi.fn()} />);

    expect(await screen.findByText('全书路线与框架')).toBeVisible();
    expect(screen.getByText('全书规划历史')).toBeVisible();
    expect(document.querySelector('.task-log-summary > strong')).toHaveTextContent('1');
    expect(screen.getAllByRole('button', { name: /继续处理/u })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /查看当前进度/u })).toBeEnabled();
    expect(screen.getByText('历史记录')).toBeVisible();
  });

  it('已完成任务不沿用成员的旧工作中快照，并按全局身份合并重复工位', async () => {
    mockedOpening.fetchPlanningTasks.mockResolvedValue([]);
    mockedCreation.fetchCreationTasks.mockResolvedValue([completedCreationTask()]);
    render(<TaskLogPage onOpenTask={vi.fn()} onOpenBook={vi.fn()} />);
    expect((await screen.findAllByText('本轮工作已经完成。'))[0]).toBeVisible();
    expect(screen.queryByText('旧快照仍说正在写作')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.task-member-stack i')).toHaveLength(1);
    expect(screen.getByTitle('清照')).toBeVisible();
  });

  it('章纲生成与确认任务回到链页，不误入正文页', async () => {
    const onOpenCreation = vi.fn();
    mockedOpening.fetchPlanningTasks.mockResolvedValue([]);
    mockedCreation.fetchCreationTasks.mockResolvedValue([
      completedCreationTask({ stage: 'chapter_outline_confirmation', status: 'waiting_for_you', message: '章纲等您确认。' })
    ]);
    render(<TaskLogPage onOpenTask={vi.fn()} onOpenBook={vi.fn()} onOpenCreation={onOpenCreation} />);
    fireEvent.click(await screen.findByRole('button', { name: /继续处理/u }));
    expect(onOpenCreation).toHaveBeenCalledWith('book-1', 'chain');
  });

  it('部分失败仍留在待处理区，并显示耗时、成员详情和恢复入口', async () => {
    mockedOpening.fetchPlanningTasks.mockResolvedValue([]);
    mockedCreation.fetchCreationTasks.mockResolvedValue([completedCreationTask({
      stage: 'volume_options', status: 'partially_failed', message: '已有两套方案，第三套没有完成。',
      completedOptions: 2, expectedOptions: 3,
      timing: { createdAt: '2026-08-31T00:00:00.000Z', lastActivityAt: '2026-08-31T00:02:00.000Z', elapsedSeconds: 120, idleSeconds: 20, state: 'normal' },
      actors: [{ memberKey: 'writer-kimi-k3', memberName: '清照', role: 'planning_writer', status: 'failed', message: '第三套没有完成。', emoji: '🙇' }]
    })]);
    render(<TaskLogPage onOpenTask={vi.fn()} onOpenBook={vi.fn()} />);
    expect(await screen.findByText('卷、链与正文')).toBeVisible();
    expect(screen.queryByText('卷与正文历史')).not.toBeInTheDocument();
    expect(screen.getAllByText(/对不起/u)[0]).toBeVisible();
    fireEvent.click(screen.getByText('查看任务详情'));
    expect(screen.getByText(/清照 · 策划编剧/u)).toBeVisible();
    expect(screen.getByRole('button', { name: /继续处理/u })).toBeEnabled();
  });

  it('失败的开书任务留在待处理区并先道歉', async () => {
    mockedOpening.fetchPlanningTasks.mockResolvedValue([]);
    mockedOpening.fetchOpeningTasks.mockResolvedValue([failedOpeningTask()]);
    render(<TaskLogPage onOpenTask={vi.fn()} onOpenBook={vi.fn()} />);

    expect(await screen.findByText('进行中与待确认')).toBeVisible();
    expect(screen.queryByText('最近记录')).not.toBeInTheDocument();
    expect(screen.getByText('项工作正在进行或等您确认')).toBeVisible();
    expect(screen.getByText(/对不起/u)).toBeVisible();
    expect(screen.getByRole('button', { name: '查看详情' })).toBeEnabled();
  });

  it('设定统一整理失败计入待处理，并一步返回对应书籍的恢复位置', async () => {
    const onOpenSetting = vi.fn();
    mockedOpening.fetchPlanningTasks.mockResolvedValue([]);
    mockedOpening.fetchSettingTasks.mockResolvedValue([failedSettingTask()]);
    render(<TaskLogPage onOpenTask={vi.fn()} onOpenBook={vi.fn()} onOpenSetting={onOpenSetting} />);

    expect(await screen.findByText('设定工作')).toBeVisible();
    expect(document.querySelector('.task-log-summary > strong')).toHaveTextContent('1');
    expect(screen.getByText('本轮未完成')).toBeVisible();
    expect(screen.getByText(/对不起/u)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /继续处理/u }));
    expect(onOpenSetting).toHaveBeenCalledWith('book-1', 'final-review');
  });

  it('长开书想法在任务列表只显示短摘要，不淹没状态和操作', async () => {
    mockedOpening.fetchPlanningTasks.mockResolvedValue([]);
    const longIdea = '长'.repeat(160);
    mockedOpening.fetchOpeningTasks.mockResolvedValue([{ ...failedOpeningTask(), idea: longIdea }]);
    render(<TaskLogPage onOpenTask={vi.fn()} onOpenBook={vi.fn()} />);

    expect(await screen.findByText(`${'长'.repeat(48)}…`)).toBeVisible();
    expect(screen.queryByText(longIdea)).not.toBeInTheDocument();
    expect(screen.getByText(/对不起/u)).toBeVisible();
    expect(screen.getByRole('button', { name: '查看详情' })).toBeEnabled();
  });
});

function failedOpeningTask(): opening.OpeningTaskView {
  return {
    taskId: 'opening-failed-1', idea: '北宋小卒求生', publishingPlatform: 'qidian',
    status: 'failed', phase: 'package_design', statusText: '本轮没有完成，已有结果已经保留',
    phaseText: '编剧正在设计开书资料包', isRunning: false, needsAuthorDecision: false, retired: false,
    selectedMembers: {
      chiefEditor: { memberKey: 'chief-deepseek-v4-pro', displayName: '貂蝉' },
      screenwriter: { memberKey: 'writer-glm-5-3', displayName: '幼薇' }
    },
    candidates: [], errorMessage: '资料包结构未通过校验。', resultBookId: null,
    progress: { currentStep: 1, totalSteps: 2, percent: 35 },
    createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:01:00.000Z'
  };
}

function planningTask(): opening.PlanningTaskView {
  return {
    taskId: 'route-1', taskKind: 'planning_route', bookId: 'book-1', bookTitle: '北宋小卒',
    status: 'working', message: '主编正在比较三套全书路线。', progress: 86,
    memberKey: 'planning-chief-deepseek-v4-pro', memberName: '貂蝉', treeKind: null, scopeId: null,
    actionable: true, canStop: true, updatedAt: '2026-08-27T01:00:00.000Z'
  };
}

function failedSettingTask(): opening.SettingTaskView {
  return {
    taskId: 'setting-final-1', bookId: 'book-1', bookTitle: '北宋小卒',
    taskKind: 'batch_final_review', status: 'failed',
    statusText: '本周期创作算力已用完，升级会员或等待额度恢复后再继续。', progress: 100,
    member: { memberKey: 'planning-chief-deepseek-v4-pro', displayName: '貂蝉' },
    retryable: true, restartable: false,
    createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:02:00.000Z'
  };
}

function completedCreationTask(overrides: Partial<creation.CreationWorkflowView> = {}): creation.CreationWorkflowView {
  return {
    workflowId: 'creation-1', bookId: 'book-1', stage: 'completed', status: 'completed', message: '本链已经完成。',
    firstVolume: true, volumeScopeId: 'volume-1', chainScopeId: 'chain-1', completedOptions: 3, expectedOptions: 3,
    options: [], chiefReview: null, optionRevision: null, outline: null, manuscript: null,
    progress: { completedChapters: 3, totalChapters: 3, percent: 100, nextChapterNumber: null },
    remainingChains: [], volumeComplete: false,
    actors: [
      { memberKey: 'writer-kimi-k3', memberName: '清照', role: 'lead_writer', status: 'working', message: '旧快照仍说正在写作', emoji: '✍️' },
      { memberKey: 'creation-writer-kimi-k3', memberName: '清照', role: 'outline_writer', status: 'working', message: '重复的旧工位快照', emoji: '✍️' }
    ],
    execution: { mode: 'managed', status: 'completed', writerMemberKey: 'writer-kimi-k3', reviewerMemberKey: null, errorMessage: null },
    errorMessage: null,
    ...overrides
  };
}
