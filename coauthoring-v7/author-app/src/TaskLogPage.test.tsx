import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskLogPage } from './TaskLogPage';
import * as opening from './opening-api';
import * as creation from './creation-api';

vi.mock('./opening-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./opening-api')>();
  return {
    ...actual,
    fetchOpeningTasks: vi.fn(), fetchDesignTasks: vi.fn(), fetchPlanningTasks: vi.fn(),
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

  it('已完成任务不沿用成员的旧工作中快照，并按全局身份合并重复工位', async () => {
    mockedOpening.fetchPlanningTasks.mockResolvedValue([]);
    mockedCreation.fetchCreationTasks.mockResolvedValue([completedCreationTask()]);
    render(<TaskLogPage onOpenTask={vi.fn()} onOpenBook={vi.fn()} />);
    expect(await screen.findByText('本轮工作已经完成。')).toBeVisible();
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
});

function planningTask(): opening.PlanningTaskView {
  return {
    taskId: 'route-1', taskKind: 'planning_route', bookId: 'book-1', bookTitle: '北宋小卒',
    status: 'working', message: '主编正在比较三套全书路线。', progress: 86,
    memberKey: 'planning-chief-deepseek-v4-pro', memberName: '貂蝉', treeKind: null, scopeId: null,
    canStop: true, updatedAt: '2026-08-27T01:00:00.000Z'
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
