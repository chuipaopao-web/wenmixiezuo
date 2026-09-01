import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeMachinePage } from './TimeMachinePage';
import * as api from './opening-api';
import * as creationApi from './creation-api';

vi.mock('./opening-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./opening-api')>();
  return {
    ...actual,
    fetchPlanningTree: vi.fn(), fetchConfirmedPlanningTree: vi.fn(), fetchLatestPlanningRouteRun: vi.fn(), fetchLatestPlanningTreeGeneration: vi.fn(), fetchPlanningMembers: vi.fn(), fetchPlanningAdjustmentSuggestions: vi.fn(),
    createPlanningRouteRun: vi.fn(), retryMissingPlanningRoutes: vi.fn(), fetchPlanningRouteRun: vi.fn(), decidePlanningRoute: vi.fn(),
    continuePlanningRouteToTree: vi.fn(), createPlanningTreeGeneration: vi.fn(), fetchPlanningTreeGeneration: vi.fn(), confirmPlanningTree: vi.fn(),
    retryPlanningTreeGeneration: vi.fn(), cancelPlanningRouteRun: vi.fn(), cancelPlanningTreeGeneration: vi.fn()
  };
});

vi.mock('./creation-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./creation-api')>();
  return { ...actual, fetchTimeMachineProgress: vi.fn(), fetchStoryState: vi.fn() };
});

const mocked = vi.mocked(api);
const mockedCreation = vi.mocked(creationApi);

describe('V7时光机真实规划闭环', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.fetchPlanningTree.mockRejectedValue(new api.AuthorApiError('还没有正式框架', false, 404));
    mocked.fetchConfirmedPlanningTree.mockRejectedValue(new api.AuthorApiError('还没有已确认框架', false, 404));
    mocked.fetchLatestPlanningRouteRun.mockResolvedValue(null);
    mocked.fetchLatestPlanningTreeGeneration.mockResolvedValue(null);
    mocked.fetchPlanningMembers.mockResolvedValue([]);
    mocked.fetchPlanningAdjustmentSuggestions.mockResolvedValue([]);
    mockedCreation.fetchTimeMachineProgress.mockResolvedValue({ finalizedChapterCount: 0, latestFinalChapter: null, latestConfirmedChain: null });
    mockedCreation.fetchStoryState.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it('没有真实任务时默认准备一套并允许选择三位主编，不把示范冒充本书内容', async () => {
    mocked.fetchPlanningMembers.mockResolvedValue([
      { memberKey: 'chief-deepseek-v4-pro', name: '貂蝉', roleKey: 'chief_editor', role: 'chief_editor', defaultForRole: true },
      { memberKey: 'chief-glm-5-3', name: '顾承砚', roleKey: 'chief_editor', role: 'chief_editor', defaultForRole: false },
      { memberKey: 'chief-kimi-k3', name: '沈知微', roleKey: 'chief_editor', role: 'chief_editor', defaultForRole: false },
      { memberKey: 'planner-deepseek-v4-pro', name: '红玉', roleKey: 'planning_writer', role: 'planning_writer', defaultForRole: true },
      { memberKey: 'planner-glm-5-3', name: '幼薇', roleKey: 'planning_writer', role: 'planning_writer', defaultForRole: false }
    ]);
    render(<TimeMachinePage bookId="book-1" />);
    expect(await screen.findByRole('heading', { name: '先准备全书方向' })).toBeVisible();
    expect(screen.getByRole('button', { name: '开始规划全书' })).toBeVisible();
    const actionDock = screen.getByRole('group', { name: '当前步骤操作' });
    expect(actionDock).toHaveClass('workflow-action-dock-card');
    expect(actionDock.closest('.planning-start-card')).not.toBeNull();
    expect(screen.getByRole('button', { name: '1套' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '3套' })).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelectorAll('.planning-member-faces > span')).toHaveLength(3);
    expect(screen.getAllByText('貂蝉')).not.toHaveLength(0);
    expect(screen.getAllByText('顾承砚')).not.toHaveLength(0);
    expect(screen.getAllByText('沈知微')).not.toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/第一卷·乱世入局|八序列|methodKey|modelId/u);
  });

  it('开发模式取消旧请求时不误报服务断线', async () => {
    let treeRequest = 0;
    mocked.fetchConfirmedPlanningTree.mockImplementation((_bookId, _treeKind, _scopeId, signal) => {
      treeRequest += 1;
      if (treeRequest > 1) return Promise.reject(new api.AuthorApiError('还没有正式框架', false, 404));
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new api.AuthorApiError('暂时连接不上文秘写作服务，请检查本地服务后重试。', true)), { once: true });
      });
    });

    render(<StrictMode><TimeMachinePage bookId="book-1" /></StrictMode>);

    expect(await screen.findByRole('heading', { name: '先准备全书方向' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('真实接口失败仍然显示可恢复提示', async () => {
    mocked.fetchConfirmedPlanningTree.mockRejectedValue(new api.AuthorApiError('暂时连接不上文秘写作服务，请检查本地服务后重试。', true));

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时连接不上文秘写作服务');
  });

  it('核心规划503时不把失败冒充空白新书，重读后恢复正式框架', async () => {
    mocked.fetchConfirmedPlanningTree
      .mockRejectedValueOnce(new api.AuthorApiError('核心规划暂时不可用', true, 503))
      .mockResolvedValueOnce({ ...treeView(), status: 'confirmed' });
    mockedCreation.fetchTimeMachineProgress.mockResolvedValue(timeMachineProgressView());
    mockedCreation.fetchStoryState.mockResolvedValue([
      storyStateItem('story_line', 'survival', '乱世求生线', 'completed', '张三已经带队站稳脚跟。')
    ]);

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByText('已定稿6章 · 最新第6章')).toBeVisible();
    expect(screen.getByText('张三已经带队站稳脚跟。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始规划全书' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新读取核心规划' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '重新读取核心规划' }));

    expect(await screen.findByText('张三从小卒到改变时代')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('button', { name: '重新读取核心规划' })).not.toBeInTheDocument());
    expect(mocked.fetchConfirmedPlanningTree).toHaveBeenCalledTimes(2);
  });

  it('全书规划真实404时仍显示不可变正文和故事实际，并且只在此时允许新建', async () => {
    mockedCreation.fetchTimeMachineProgress.mockResolvedValue(timeMachineProgressView());
    mockedCreation.fetchStoryState.mockResolvedValue([
      storyStateItem('story_line', 'survival', '乱世求生线', 'completed', '张三已经带队站稳脚跟。')
    ]);

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByRole('button', { name: '开始规划全书' })).toBeEnabled();
    expect(screen.getByText('已定稿6章 · 最新第6章')).toBeVisible();
    expect(screen.getByText('张三已经带队站稳脚跟。')).toBeInTheDocument();
  });

  it('切换书籍后延迟返回的旧书响应不会覆盖或短暂展示到新书', async () => {
    let resolveBookA!: (value: api.PlanningTreeView) => void;
    const bookATree = { ...treeView(), title: 'A书旧方向', root: { ...treeView().root, title: 'A书旧方向' } };
    const bookBTree = { ...treeView(), scopeId: 'book-b', title: 'B书正式方向', root: { ...treeView().root, title: 'B书正式方向' } };
    mocked.fetchConfirmedPlanningTree.mockImplementation((currentBookId) => currentBookId === 'book-a'
      ? new Promise((resolve) => { resolveBookA = resolve; })
      : Promise.resolve(bookBTree));

    const view = render(<TimeMachinePage key="book-a" bookId="book-a" />);
    await waitFor(() => expect(mocked.fetchConfirmedPlanningTree).toHaveBeenCalledWith('book-a', 'book', 'book-a', expect.any(AbortSignal)));

    view.rerender(<TimeMachinePage key="book-b" bookId="book-b" />);
    expect(await screen.findByText('B书正式方向')).toBeVisible();

    await act(async () => { resolveBookA(bookATree); });

    expect(screen.getByText('B书正式方向')).toBeVisible();
    expect(screen.queryByText('A书旧方向')).not.toBeInTheDocument();
  });
  it('成员名单或未来建议暂时失败时，仍能进入全书方向主流程', async () => {
    mocked.fetchPlanningMembers.mockRejectedValue(new api.AuthorApiError('成员名单暂时不可用', true, 503));
    mocked.fetchPlanningAdjustmentSuggestions.mockRejectedValue(new api.AuthorApiError('建议暂时不可用', true, 503));

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByRole('heading', { name: '先准备全书方向' })).toBeVisible();
    expect(screen.getByRole('button', { name: '开始规划全书' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('正文实际读取缓慢时不阻塞已确认的全书方向', async () => {
    let resolveProgress!: (value: creationApi.TimeMachineProgressView) => void;
    let resolveStoryState!: (value: creationApi.StoryStateItemView[]) => void;
    mocked.fetchConfirmedPlanningTree.mockResolvedValue({ ...treeView(), status: 'confirmed' });
    mockedCreation.fetchTimeMachineProgress.mockReturnValue(new Promise((resolve) => { resolveProgress = resolve; }));
    mockedCreation.fetchStoryState.mockReturnValue(new Promise((resolve) => { resolveStoryState = resolve; }));

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByText('张三从小卒到改变时代')).toBeVisible();
    expect(screen.getByText('正在读取正文实际')).toBeVisible();
    resolveProgress({ finalizedChapterCount: 0, latestFinalChapter: null, latestConfirmedChain: null });
    resolveStoryState([]);
    await waitFor(() => expect(screen.queryByText('正在读取已经定稿的正文进度和故事变化…')).not.toBeInTheDocument());
    expect(screen.getByText(/目前还没有可结算的故事线数据/u)).toBeInTheDocument();
  });

  it('刷新时任务已经完成但框架稍后入库，会再次取回真实框架', async () => {
    mocked.fetchConfirmedPlanningTree.mockRejectedValue(new api.AuthorApiError('还没有正式框架', false, 404));
    mocked.fetchPlanningTree.mockResolvedValue(treeView());
    mocked.fetchLatestPlanningTreeGeneration.mockResolvedValue({
      ...generation(), status: 'ready', message: '正式框架已经完成。',
      candidateTreeVersionId: 'tree-version-1', canOpenCandidate: true
    });

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByText('张三从小卒到改变时代')).toBeVisible();
    expect(mocked.fetchConfirmedPlanningTree).toHaveBeenCalledTimes(1);
    expect(mocked.fetchPlanningTree).toHaveBeenCalledTimes(1);
  });

  it('历史成员已退役但成功框架仍按完成结果展示，不覆盖已确认全书方向', async () => {
    const confirmedTree = { ...treeView(), status: 'confirmed' as const, title: '当前正式全书方向', root: { ...treeView().root, title: '当前正式全书方向' } };
    mocked.fetchConfirmedPlanningTree.mockResolvedValue(confirmedTree);
    mocked.fetchLatestPlanningRouteRun.mockResolvedValue({
      ...routeRun(), status: 'completed', phase: 'completed', canDecide: false,
      message: '全书方向已经确认，可以生成正式框架树。', errorMessage: null
    });
    mocked.fetchLatestPlanningTreeGeneration.mockResolvedValue({
      ...generation(), status: 'ready', message: '方案已经完成并安全保留，可以继续查看正式框架。',
      candidateTreeVersionId: 'tree-version-1', canOpenCandidate: false, errorMessage: null
    });

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByText('当前正式全书方向')).toBeVisible();
    expect(screen.queryByText('框架草案已完成，等您确认')).not.toBeInTheDocument();
    expect(mocked.fetchPlanningTree).not.toHaveBeenCalled();
    expect(screen.queryByText(/规划树任务不能继续执行/u)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '继续未完成步骤' })).not.toBeInTheDocument();
  });

  it('没有确实可打开的ready候选时只读取正式树，不让残留候选覆盖', async () => {
    const confirmedTree = { ...treeView(), status: 'confirmed' as const, title: '作者已确认方向', root: { ...treeView().root, title: '作者已确认方向' } };
    const staleCandidate = { ...treeView(), title: '残留候选方向', root: { ...treeView().root, title: '残留候选方向' } };
    mocked.fetchConfirmedPlanningTree.mockResolvedValue(confirmedTree);
    mocked.fetchPlanningTree.mockResolvedValue(staleCandidate);
    mocked.fetchLatestPlanningTreeGeneration.mockResolvedValue({
      ...generation(), status: 'ready', message: '历史结果已经保存。',
      candidateTreeVersionId: 'historical-tree-version', canOpenCandidate: false
    });

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByText('作者已确认方向')).toBeVisible();
    expect(screen.queryByText('残留候选方向')).not.toBeInTheDocument();
    expect(mocked.fetchPlanningTree).not.toHaveBeenCalled();
  });

  it('把安全的前置条件原话告诉作者，不用笼统失败掩盖处理办法', async () => {
    mocked.fetchConfirmedPlanningTree.mockRejectedValue(new api.AuthorApiError('请先确认至少一项设定，再开始规划全书。', false, 409));

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('请先确认至少一项设定，再开始规划全书。');
  });

  it('恢复失败的全书任务时明确道歉并续跑原任务', async () => {
    const failedRun: api.PlanningRouteRunView = {
      ...routeRun(), status: 'failed', phase: 'failed', routes: [], chiefReview: null, canDecide: false,
      message: '对不起，这次没有完成。已经完成的内容会保留，您可以重新开始。',
      errorMessage: '对不起，这次没有完成。已经完成的内容会保留，您可以重新开始。'
    };
    mocked.fetchLatestPlanningRouteRun.mockResolvedValue(failedRun);
    mocked.retryMissingPlanningRoutes.mockResolvedValue({
      ...failedRun, status: 'working', phase: 'designing_routes',
      message: '正在继续未完成的路线。', errorMessage: null
    });

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByText('对不起，这次没有完成。已经完成的内容会保留，您可以重新开始。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '继续未完成步骤' }));
    await waitFor(() => expect(mocked.retryMissingPlanningRoutes).toHaveBeenCalledWith('book-1', 'route-run-1'));
    expect(mocked.createPlanningRouteRun).not.toHaveBeenCalled();
  });

  it('恢复三条真实路线，作者选择后才生成正式框架', async () => {
    const run = routeRun();
    mocked.fetchLatestPlanningRouteRun.mockResolvedValue(run);
    mocked.decidePlanningRoute.mockResolvedValue({ routeVersionId: 'route-version-1', recipeVersionId: 'recipe-version-1', status: 'confirmed', nextStep: 'book_tree' });
    mocked.fetchPlanningRouteRun.mockResolvedValue({
      ...run, status: 'completed', phase: 'completed', canDecide: false,
      canContinueTree: true, nextStepPending: true
    });
    mocked.continuePlanningRouteToTree.mockResolvedValue(generation());

    render(<TimeMachinePage bookId="book-1" />);
    expect(await screen.findByText('边军立足到新政破局')).toBeVisible();
    expect(screen.getByText('结盟岳飞北伐复国')).toBeVisible();
    expect(screen.getByText('民生经营到天下归心')).toBeVisible();
    expect(screen.getByText(/貂蝉主编的建议/u)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/methodKey|modelId|provider|temperature|prompt/u);

    fireEvent.click(screen.getAllByRole('button', { name: /选这套|已选择/u })[1]!);
    fireEvent.click(screen.getByRole('button', { name: '采用所选路线' }));
    await waitFor(() => expect(mocked.decidePlanningRoute).toHaveBeenCalledWith('book-1', 'route-run-1', expect.objectContaining({
      mode: 'select', routeIds: ['route-2']
    })));
    expect(mocked.continuePlanningRouteToTree).toHaveBeenCalledWith('book-1', 'route-run-1', undefined);
    expect(mocked.createPlanningTreeGeneration).not.toHaveBeenCalled();
  });

  it('刷新时已完成路线仍有待接续步骤，会在已有正式框架的编辑部内继续同一run', async () => {
    mocked.fetchConfirmedPlanningTree.mockResolvedValue({ ...treeView(), status: 'confirmed' });
    mocked.fetchLatestPlanningRouteRun.mockResolvedValue({
      ...routeRun(), status: 'completed', phase: 'completed', canDecide: false,
      canContinueTree: true, nextStepPending: true,
      message: '全书方向已经确认，等待展开正式框架。'
    });
    mocked.continuePlanningRouteToTree.mockResolvedValue(generation());

    render(<TimeMachinePage bookId="book-1" />);

    const editorial = (await screen.findByText('编辑部')).closest('details');
    expect(editorial).toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: '生成正式框架' }));

    await waitFor(() => expect(mocked.continuePlanningRouteToTree).toHaveBeenCalledWith('book-1', 'route-run-1', undefined));
    expect(mocked.createPlanningTreeGeneration).not.toHaveBeenCalled();
  });

  it('已完成路线不可续接时不显示重复生成或重新规划入口', async () => {
    mocked.fetchLatestPlanningRouteRun.mockResolvedValue({
      ...routeRun(), status: 'completed', phase: 'completed', canDecide: false,
      canContinueTree: false, nextStepPending: false,
      message: '全书方向已经完成。'
    });

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByText('这轮方向已经接续或不再允许重复生成正式框架，现有结果会继续保留。')).toBeVisible();
    expect(screen.queryByRole('button', { name: '生成正式框架' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始规划全书' })).not.toBeInTheDocument();
    expect(mocked.continuePlanningRouteToTree).not.toHaveBeenCalled();
    expect(mocked.createPlanningTreeGeneration).not.toHaveBeenCalled();
  });
  it('框架已知失败时续跑原任务，不会另建一条重复任务', async () => {
    const onOpenSettings = vi.fn();
    const failedGeneration: api.PlanningTreeGenerationView = {
      ...generation(), status: 'failed', message: '已经完成的资料整理会保留，您可以继续未完成步骤。',
      errorMessage: '已经完成的资料整理会保留，您可以继续未完成步骤。'
    };
    mocked.fetchLatestPlanningTreeGeneration.mockResolvedValue(failedGeneration);
    mocked.retryPlanningTreeGeneration.mockResolvedValue({ ...failedGeneration, status: 'working', message: '正在继续未完成步骤。', errorMessage: null });

    render(<TimeMachinePage bookId="book-1" onOpenSettings={onOpenSettings} />);

    expect(await screen.findByText('对不起，这次没有完成。已经完成的资料整理会保留，您可以继续未完成步骤。')).toBeVisible();
    expect(screen.getByRole('button', { name: '返回全书方向' })).toBeVisible();
    expect(screen.getByRole('button', { name: '返回设定修改' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '继续未完成步骤' }));

    await waitFor(() => expect(mocked.retryPlanningTreeGeneration).toHaveBeenCalledWith('book-1', 'generation-1'));
    expect(mocked.createPlanningTreeGeneration).not.toHaveBeenCalled();
  });

  it('框架结果未知时只核对原任务，不盲目重发模型调用', async () => {
    const unknownGeneration: api.PlanningTreeGenerationView = {
      ...generation(), status: 'result_unknown', message: '抱歉，这次结果还没有确认，为避免重复消耗已经暂停。',
      errorMessage: '抱歉，这次结果还没有确认，为避免重复消耗已经暂停。'
    };
    mocked.fetchLatestPlanningTreeGeneration.mockResolvedValue(unknownGeneration);
    mocked.fetchPlanningTreeGeneration.mockResolvedValue(unknownGeneration);

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByText('抱歉，这次结果还没有确认，为避免重复消耗已经暂停。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '核对这次结果' }));

    await waitFor(() => expect(mocked.fetchPlanningTreeGeneration).toHaveBeenCalledWith('book-1', 'generation-1'));
    expect(mocked.retryPlanningTreeGeneration).not.toHaveBeenCalled();
    expect(mocked.createPlanningTreeGeneration).not.toHaveBeenCalled();
  });

  it('失败时可以页内返回全书方向，也能直接返回设定修改', async () => {
    const onOpenSettings = vi.fn();
    mocked.fetchLatestPlanningTreeGeneration.mockResolvedValue({
      ...generation(), status: 'failed', message: '本次框架没有生成完成。', errorMessage: '本次框架没有生成完成。'
    });

    render(<TimeMachinePage bookId="book-1" onOpenSettings={onOpenSettings} />);

    fireEvent.click(await screen.findByRole('button', { name: '返回设定修改' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '返回全书方向' }));
    expect(await screen.findByRole('heading', { name: '先准备全书方向' })).toBeVisible();
    expect(mocked.createPlanningTreeGeneration).not.toHaveBeenCalled();
  });

  it('主编发现正式资料冲突时停止后续设计，并让作者直接返回设定处理', async () => {
    const onOpenSettings = vi.fn();
    mocked.fetchLatestPlanningRouteRun.mockResolvedValue({
      ...routeRun(), canDecide: false, routes: [], chiefReview: null,
      message: '主编发现几处会影响全书规划的资料，请先统一后再继续。',
      progress: { completed: 0, total: 7, percent: 0 },
      sourceIssues: ['总兵力在两项设定中分别为八千和三万，需要统一。'],
      actors: [{ memberKey: 'chief-deepseek-v4-pro', memberName: '貂蝉', role: '全案规划主编', status: 'completed', message: '我已经找到需要您决定的地方。', emoji: '✅' }]
    });

    render(<TimeMachinePage bookId="book-1" onOpenSettings={onOpenSettings} />);

    expect(await screen.findByText('貂蝉请您先定几件事')).toBeVisible();
    expect(screen.getByText('总兵力在两项设定中分别为八千和三万，需要统一。')).toBeVisible();
    expect(screen.queryByText(/开始规划全书/u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回设定处理' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('正式候选树按竖向节点显示，并由作者确认', async () => {
    const tree = treeView();
    mocked.fetchPlanningTree.mockResolvedValue(tree);
    mocked.fetchLatestPlanningTreeGeneration.mockResolvedValue({
      ...generation(), status: 'ready', message: '框架草案已经完成。',
      candidateTreeVersionId: 'tree-version-1', canOpenCandidate: true
    });
    mocked.confirmPlanningTree.mockResolvedValue({ ...tree, status: 'confirmed' });

    render(<TimeMachinePage bookId="book-1" />);
    expect(await screen.findByText('张三从小卒到改变时代')).toBeVisible();
    expect(screen.getByText('编辑部')).toBeVisible();
    expect(screen.getAllByText('全书方向')).not.toHaveLength(0);
    expect(screen.getByText('全书路线')).toBeVisible();
    expect(screen.getByText('故事动态')).toBeVisible();
    expect(screen.getByText('第一卷·边军立足')).toBeVisible();
    expect(screen.getByText('这一段要发生什么')).toBeVisible();
    expect(screen.getByText('主角有什么变化')).toBeVisible();
    expect(screen.getByText('读者会有什么感受')).toBeVisible();
    expect(screen.getByText('为什么会走到这里')).toBeVisible();
    expect(screen.getByText('阶段结果与下一步')).toBeVisible();
    expect(screen.getByText('这次为什么这样设计')).toBeVisible();
    expect(screen.getByText('让张三的主动选择持续产生新后果，不靠固定升级模板推进。')).toBeVisible();
    expect(screen.getByText('选择推动下一卷')).toBeVisible();
    expect(screen.getAllByText('正文定稿后自动整理')).not.toHaveLength(0);
    expect(screen.queryByText(/0%|85%|60%/u)).not.toBeInTheDocument();
    const dock = screen.getByRole('contentinfo', { name: '当前步骤操作' });
    expect(dock).toHaveTextContent('正式框架草案已经完成');
    expect(dock.querySelectorAll('.workflow-action-dock-primary > button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '确认采用框架' }));
    await waitFor(() => expect(mocked.confirmPlanningTree).toHaveBeenCalledWith('book-1', 'book', 'book-1', 1));
  });

  it('从不可变正文聚合和已确认链树显示真实写作进度，候选链不能覆盖正文实际', async () => {
    const bookTree = { ...treeView(), status: 'confirmed' as const };
    const candidateChainTree = { ...chainTreeView(), status: 'candidate' as const, title: '候选链不应展示', root: { ...chainTreeView().root, title: '候选链不应展示' } };
    mocked.fetchConfirmedPlanningTree.mockResolvedValue(bookTree);
    mocked.fetchPlanningTree.mockResolvedValue(candidateChainTree);
    mockedCreation.fetchTimeMachineProgress.mockResolvedValue(timeMachineProgressView());
    mockedCreation.fetchStoryState.mockResolvedValue([
      { kind: 'story_line', stableKey: 'survival', title: '乱世求生线', state: 'completed', revision: 6, detail: { summary: '张三已经带队站稳脚跟。' }, evidenceRefs: [], updatedAt: '2026-08-30T18:02:41.336Z' },
      { kind: 'foreshadowing', stableKey: 'merit-ledger', title: '军功簿疑点', state: 'deepened', revision: 3, detail: { summary: '军功簿的异常已经被张三记下。' }, evidenceRefs: [], updatedAt: '2026-08-30T18:02:41.336Z' },
      { kind: 'open_question', stableKey: 'next-mission', title: '西沟续探会遇到什么', state: 'open', revision: 1, detail: {}, evidenceRefs: [], updatedAt: '2026-08-30T18:02:41.336Z' }
    ]);

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByText('正文进度')).toBeVisible();
    expect(screen.getByText('已定稿6章 · 最新第6章')).toBeVisible();
    expect(screen.getByText('最近定稿链：溃兵归营')).toBeVisible();
    expect(screen.getByText('张三正式成为队率，并带队继续西沟任务。')).toBeVisible();
    expect(screen.getByText('张三已经带队站稳脚跟。')).toBeInTheDocument();
    expect(screen.getByText('军功簿的异常已经被张三记下。')).toBeInTheDocument();
    expect(screen.getByText('西沟续探会遇到什么 · 仍待回答')).toBeInTheDocument();
    expect(screen.queryByText('候选链不应展示')).not.toBeInTheDocument();
    expect(screen.queryByText('目前还没有可结算的故事线数据。')).not.toBeInTheDocument();
    expect(mocked.fetchConfirmedPlanningTree).toHaveBeenCalledWith('book-1', 'book', 'book-1', expect.any(AbortSignal));
    expect(mocked.fetchPlanningTree).not.toHaveBeenCalledWith('book-1', 'chain', expect.anything(), expect.anything());
  });

  it('故事状态先失败、重读时正文接口失败，仍保留上次成功的6章并显示新故事状态', async () => {
    mocked.fetchConfirmedPlanningTree.mockResolvedValue({ ...treeView(), status: 'confirmed' });
    mockedCreation.fetchTimeMachineProgress
      .mockResolvedValueOnce(timeMachineProgressView())
      .mockRejectedValueOnce(new api.AuthorApiError('正文进度本次刷新失败', true, 503));
    mockedCreation.fetchStoryState
      .mockRejectedValueOnce(new api.AuthorApiError('故事状态首次读取失败', true, 503))
      .mockResolvedValueOnce([
        storyStateItem('story_line', 'survival', '乱世求生线', 'completed', '张三已经带队站稳脚跟。')
      ]);

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByText('已定稿6章 · 最新第6章')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重新读取正文进度' }));

    expect(await screen.findByText('张三已经带队站稳脚跟。')).toBeInTheDocument();
    expect(screen.getByText('已定稿6章 · 最新第6章')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('已保留上次成功读取的内容');
    expect(screen.getByRole('alert')).toHaveTextContent('可能不是最新状态');
  });

  it('正文进度先失败、重读时故事接口失败，仍保留上次成功故事并补回6章', async () => {
    mocked.fetchConfirmedPlanningTree.mockResolvedValue({ ...treeView(), status: 'confirmed' });
    mockedCreation.fetchTimeMachineProgress
      .mockRejectedValueOnce(new api.AuthorApiError('正文进度首次读取失败', true, 503))
      .mockResolvedValueOnce(timeMachineProgressView());
    mockedCreation.fetchStoryState
      .mockResolvedValueOnce([
        storyStateItem('story_line', 'survival', '乱世求生线', 'completed', '张三已经带队站稳脚跟。')
      ])
      .mockRejectedValueOnce(new api.AuthorApiError('故事状态本次刷新失败', true, 503));

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByText('张三已经带队站稳脚跟。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新读取正文进度' }));

    expect(await screen.findByText('已定稿6章 · 最新第6章')).toBeVisible();
    expect(screen.getByText('张三已经带队站稳脚跟。')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('已保留上次成功读取的内容');
    expect(screen.getByRole('alert')).toHaveTextContent('可能不是最新状态');
  });
  it('正文实际接口失败时不冒充空数据，并能在原页重新读取', async () => {
    mocked.fetchConfirmedPlanningTree.mockResolvedValue({ ...treeView(), status: 'confirmed' });
    mockedCreation.fetchTimeMachineProgress
      .mockRejectedValueOnce(new api.AuthorApiError('正文进度暂时不可用', true, 503))
      .mockResolvedValueOnce(timeMachineProgressView());
    mockedCreation.fetchStoryState
      .mockRejectedValueOnce(new api.AuthorApiError('故事状态暂时不可用', true, 503))
      .mockResolvedValueOnce([]);

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('正文实际暂时没有完整读取成功');
    expect(screen.getByText('正文实际暂时没有读取成功。请使用页面上方的“重新读取正文进度”，这里不会把读取失败说成没有内容。')).toBeInTheDocument();
    expect(screen.queryByText('目前还没有可结算的故事线数据。')).not.toBeInTheDocument();
    expect(mocked.fetchConfirmedPlanningTree).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '重新读取正文进度' }));

    expect(await screen.findByText('已定稿6章 · 最新第6章')).toBeVisible();
    expect(mocked.fetchConfirmedPlanningTree).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(mockedCreation.fetchTimeMachineProgress).toHaveBeenCalledTimes(2);
  });

  it('正文进度响应直接携带已确认链，不再向作者端暴露定位键或二次读取链树', async () => {
    mocked.fetchConfirmedPlanningTree.mockResolvedValue({ ...treeView(), status: 'confirmed' });
    mockedCreation.fetchTimeMachineProgress.mockResolvedValue(timeMachineProgressView());

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByText('已定稿6章 · 最新第6章')).toBeVisible();
    expect(screen.getByText('最近定稿链：溃兵归营')).toBeVisible();
    expect(mocked.fetchConfirmedPlanningTree).toHaveBeenCalledTimes(1);
    expect(mocked.fetchConfirmedPlanningTree).not.toHaveBeenCalledWith('book-1', 'chain', expect.anything(), expect.anything());
    expect(JSON.stringify(timeMachineProgressView())).not.toMatch(/manuscriptVersionId|volumeScopeId|chainScopeId/u);
  });

  it('已确认框架后的新失败重规划仍显示真实失败并允许续跑', async () => {
    mocked.fetchConfirmedPlanningTree.mockResolvedValue({ ...treeView(), status: 'confirmed' });
    mocked.fetchLatestPlanningRouteRun.mockResolvedValue({
      ...routeRun(), status: 'completed', phase: 'completed', canDecide: false,
      message: '路线选择已经完成。', errorMessage: null
    });
    mocked.fetchLatestPlanningTreeGeneration.mockResolvedValue({
      ...generation(), status: 'failed', message: '这次重规划没有完成，已确认框架仍然保留。', errorMessage: '这次重规划没有完成，已确认框架仍然保留。'
    });

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByText('张三从小卒到改变时代')).toBeVisible();
    expect(screen.getByText('对不起，这次没有完成。这次重规划没有完成，已确认框架仍然保留。')).toBeVisible();
    expect(screen.getByRole('button', { name: '继续未完成步骤' })).toBeVisible();
    expect(screen.queryByText('本轮方向调整正在进行')).not.toBeInTheDocument();
    const editorial = screen.getByText('编辑部').closest('details');
    expect(editorial).toHaveAttribute('open');
  });
  it('正式框架保留页内调整入口，并允许重新选择一到三位主编', async () => {
    mocked.fetchConfirmedPlanningTree.mockResolvedValue({ ...treeView(), status: 'confirmed' });
    mocked.fetchPlanningMembers.mockResolvedValue([
      { memberKey: 'chief-deepseek-v4-pro', name: '貂蝉', roleKey: 'chief_editor', role: 'chief_editor', defaultForRole: true },
      { memberKey: 'chief-glm-5-3', name: '顾承砚', roleKey: 'chief_editor', role: 'chief_editor', defaultForRole: false },
      { memberKey: 'chief-kimi-k3', name: '沈知微', roleKey: 'chief_editor', role: 'chief_editor', defaultForRole: false }
    ]);

    render(<TimeMachinePage bookId="book-1" />);
    const editorialSummary = await screen.findByText('编辑部');
    fireEvent.click(editorialSummary.closest('summary')!);
    fireEvent.click(screen.getByRole('button', { name: '调整方向与成员' }));

    expect(await screen.findByRole('heading', { name: '先准备全书方向' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '3套' }));
    expect(screen.getByRole('button', { name: '3套' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('选择本轮主编（可不选）')).toBeVisible();
    expect(screen.getAllByText('貂蝉')).not.toHaveLength(0);
    expect(screen.getAllByText('顾承砚')).not.toHaveLength(0);
    expect(screen.getAllByText('沈知微')).not.toHaveLength(0);
  });

  it('长任务使用页内确认停止，失败状态如实道歉而不伪装工作中', async () => {
    const working: api.PlanningRouteRunView = {
      ...routeRun(), status: 'working', phase: 'choosing_methods', canDecide: false,
      message: '主编正在筛选少量方法。', progress: { completed: 1, total: 7, percent: 14 },
      actors: [
        { memberKey: 'chief-deepseek-v4-pro', memberName: '貂蝉', role: 'chief_editor', status: 'working', message: '我正在筛选方法。', emoji: '✍️' },
        { memberKey: 'planning-chief-deepseek-v4-pro', memberName: '貂蝉', role: 'structure_deputy', status: 'working', message: '重复的旧席位快照。', emoji: '✍️' }
      ]
    };
    mocked.fetchLatestPlanningRouteRun.mockResolvedValue(working);
    mocked.cancelPlanningRouteRun.mockResolvedValue({
      ...working, status: 'failed', phase: 'failed', message: '已经停止，完成内容会保留。', errorMessage: '已经停止，完成内容会保留。'
    });
    render(<TimeMachinePage bookId="book-1" />);
    fireEvent.click(await screen.findByText('查看成员状态'));
    expect(document.querySelectorAll('.planning-actor-strip article')).toHaveLength(1);
    expect(screen.getByText('貂蝉 · 主编')).toBeVisible();
    expect(document.body.textContent).not.toMatch(/chief_editor|structure_deputy/u);
    fireEvent.click(await screen.findByRole('button', { name: '停止这项工作' }));
    expect(screen.getByRole('group', { name: '确认停止规划' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '保留成果并停止' }));
    await waitFor(() => expect(mocked.cancelPlanningRouteRun).toHaveBeenCalledWith('book-1', 'route-run-1'));
    expect(await screen.findByText('对不起，这次没有完成。已经停止，完成内容会保留。')).toBeVisible();
    expect(screen.queryByText(/正在工作/u)).not.toBeInTheDocument();
  });

  it('框架生成没有真实百分比时显示不定进度，不伪造固定完成度', async () => {
    mocked.fetchLatestPlanningTreeGeneration.mockResolvedValue(generation());
    render(<TimeMachinePage bookId="book-1" />);
    expect(await screen.findByText('幼薇正在工作')).toBeVisible();
    expect(document.querySelector('.planning-progress.is-indeterminate')).toBeInTheDocument();
    expect(screen.queryByLabelText('已完成82%')).not.toBeInTheDocument();
  });
});

function routeRun(): api.PlanningRouteRunView {
  const titles = ['边军立足到新政破局', '结盟岳飞北伐复国', '民生经营到天下归心'];
  return {
    runId: 'route-run-1', status: 'waiting_for_you', phase: 'waiting_for_you', message: '请选一个方向。',
    progress: { completed: 7, total: 7, percent: 100 }, sourceIssues: [], canDecide: true, errorMessage: null, actors: [],
    routes: titles.map((title, index) => ({
      routeId: `route-${index + 1}`, memberKey: `planning-writer-${index + 1}`, memberName: `编剧${index + 1}`, title,
      oneLinePromise: `${title}的一句话看点`, summary: `${title}的全书方向。`, readingExperience: '节奏明快，每卷都有变化。',
      protagonistJourney: '张三从小卒成长为能承担天下后果的人。', targetWords: 2_400_000, targetVolumes: 8,
      commercialAudience: '喜欢历史逆袭、家国成长和局势博弈的读者。',
      retentionPositioning: '每卷让张三跨过一道身份门槛，并留下一个必须追下去的天下难题。',
      volumes: [{ order: 1, title: '第一卷', direction: '张三先在边军立足。', protagonistChange: '获得第一批同伴。', mainPressure: '身份低微。', readerPayoff: '第一次改变命运。', targetWords: 300_000, handoff: '进入更大局势。' }],
      firstVolumeFocus: ['尽快入局', '黄金三章兑现价值'], sellingPoints: ['主角主动改变局势'], risks: ['中段避免重复'], openQuestions: []
    })),
    chiefReview: {
      memberKey: 'planning-chief-deepseek-v4-pro', memberName: '貂蝉', summary: '三套都可写，第一套最稳，第二套目标最强，第三套经营感最好。',
      recommendedRouteId: 'route-1', commonRisks: ['岳飞不能替代张三'], authorDecisions: [],
      routeReviews: titles.map((title, index) => ({
        routeId: `route-${index + 1}`, publicName: title, biggestStrength: '方向清楚', mainRisk: '避免重复',
        suitableFor: '历史读者', keyDifference: '推进方式不同', volumeJudgement: '8卷能承接240万字。',
        audienceJudgement: '人群与核心卖点匹配。', retentionJudgement: '卷卷有身份跃迁和新难题。'
      }))
    }
  };
}

function generation(): api.PlanningTreeGenerationView {
  return { runId: 'generation-1', status: 'working', message: '正在展开正式框架。', treeKind: 'book', scopeId: 'book-1', canOpenCandidate: false, candidateTreeVersionId: null, errorMessage: null, member: { memberKey: 'planning-writer-glm-5-3', name: '规划编剧' } };
}

function treeView(): api.PlanningTreeView {
  return {
    treeKind: 'book', scopeId: 'book-1', status: 'candidate', revision: 1, title: '张三从小卒到改变时代',
    designSummary: {
      decisionNote: '让张三的主动选择持续产生新后果，不靠固定升级模板推进。',
      originalApproaches: [{ title: '选择推动下一卷', applicationNote: '每卷结尾都由张三的决定改变下一卷的问题性质。' }]
    },
    root: node('book-root', '张三从小卒到改变时代', [node('volume-1', '第一卷·边军立足', [])])
  };
}

function chainTreeView(): api.PlanningTreeView {
  const event = {
    ...node('rout-and-regroup-event-3', '押粮哨探，提为队率', []),
    kind: 'event' as const,
    budget: { wordTarget: 24_000, chapterRange: [5, 8] as const },
    actual: {
      state: 'completed' as const,
      summary: '张三正式成为队率，并带队继续西沟任务。',
      emotionResult: '压力后获得阶段确认。',
      experienceResult: '身份变化和下一步任务同时兑现。',
      outcome: '张三成为队率。',
      recordedAt: '2026-08-30T18:02:41.336Z'
    }
  };
  return {
    treeKind: 'chain', scopeId: 'rout-and-regroup', status: 'confirmed', revision: 2, title: '溃兵归营',
    root: {
      ...node('rout-and-regroup', '溃兵归营', [event]),
      kind: 'chain',
      budget: { wordTarget: 48_000, chapterRange: [1, 8] },
      actual: null
    }
  };
}

function storyStateItem(
  kind: creationApi.StoryStateItemView['kind'],
  stableKey: string,
  title: string,
  state: string,
  summary: string
): creationApi.StoryStateItemView {
  return {
    kind,
    stableKey,
    title,
    state,
    revision: 1,
    detail: { summary },
    evidenceRefs: [],
    updatedAt: '2026-08-30T18:02:41.336Z'
  };
}
function timeMachineProgressView(): creationApi.TimeMachineProgressView {
  return {
    finalizedChapterCount: 6,
    latestFinalChapter: { chapterNumber: 6 },
    latestConfirmedChain: chainTreeView()
  };
}
function node(key: string, title: string, children: api.PlanningTreeNodeView[]): api.PlanningTreeNodeView {
  return {
    key, kind: key.startsWith('book') ? 'book' : 'volume', sequence: 1, title,
    story: { summary: `${title}的方向。`, majorEvents: ['完成阶段变化'], protagonistChange: '张三承担更大责任。', outcome: '形成新局面。', nextStep: '进入下一阶段。' },
    emotion: { publicSummary: '先承压再兑现。', openingEmotion: '紧张', pressureMovement: '逐步增强', releaseEmotion: '阶段释放', intensity: 'strong' },
    experience: { publicSummary: '读者看到明确变化。', pressureRhythm: '逐步加压', payoffCadence: '阶段兑现', informationRhythm: '随行动揭示', contrastWithPrevious: '责任升级', designReason: '避免重复' },
    causality: { trigger: '局势迫使张三行动。', causes: ['身份低微'], coreConflict: '张三与旧秩序冲突。', turningPoint: '张三主动承担风险', consequences: ['进入更大局势'] },
    threads: { foreshadowing: [], openQuestions: [] }, budget: { wordTarget: 300_000, chapterRange: null }, linkedTree: null, actual: null, children
  };
}
