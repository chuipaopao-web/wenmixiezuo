import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeMachinePage } from './TimeMachinePage';
import * as api from './opening-api';

vi.mock('./opening-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./opening-api')>();
  return {
    ...actual,
    fetchPlanningTree: vi.fn(), fetchLatestPlanningRouteRun: vi.fn(), fetchLatestPlanningTreeGeneration: vi.fn(), fetchPlanningMembers: vi.fn(), fetchPlanningAdjustmentSuggestions: vi.fn(),
    createPlanningRouteRun: vi.fn(), fetchPlanningRouteRun: vi.fn(), decidePlanningRoute: vi.fn(),
    createPlanningTreeGeneration: vi.fn(), fetchPlanningTreeGeneration: vi.fn(), confirmPlanningTree: vi.fn(),
    cancelPlanningRouteRun: vi.fn(), cancelPlanningTreeGeneration: vi.fn()
  };
});

const mocked = vi.mocked(api);

describe('V7时光机真实规划闭环', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.fetchPlanningTree.mockRejectedValue(new api.AuthorApiError('还没有正式框架', false, 404));
    mocked.fetchLatestPlanningRouteRun.mockResolvedValue(null);
    mocked.fetchLatestPlanningTreeGeneration.mockResolvedValue(null);
    mocked.fetchPlanningMembers.mockResolvedValue([]);
    mocked.fetchPlanningAdjustmentSuggestions.mockResolvedValue([]);
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
    mocked.fetchPlanningTree.mockImplementation((_bookId, _treeKind, _scopeId, signal) => {
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
    mocked.fetchPlanningTree.mockRejectedValue(new api.AuthorApiError('暂时连接不上文秘写作服务，请检查本地服务后重试。', true));

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时连接不上文秘写作服务');
  });

  it('把安全的前置条件原话告诉作者，不用笼统失败掩盖处理办法', async () => {
    mocked.fetchPlanningTree.mockRejectedValue(new api.AuthorApiError('请先确认至少一项设定，再开始规划全书。', false, 409));

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('请先确认至少一项设定，再开始规划全书。');
  });

  it('恢复失败的全书任务时明确道歉并提供页内重新规划', async () => {
    mocked.fetchLatestPlanningRouteRun.mockResolvedValue({
      ...routeRun(), status: 'failed', phase: 'failed', routes: [], chiefReview: null, canDecide: false,
      message: '对不起，这次没有完成。已经完成的内容会保留，您可以重新开始。',
      errorMessage: '对不起，这次没有完成。已经完成的内容会保留，您可以重新开始。'
    });
    mocked.createPlanningRouteRun.mockResolvedValue({
      ...routeRun(), status: 'working', phase: 'choosing_methods', routes: [], chiefReview: null, canDecide: false,
      message: '资料策划正在筛选本次真正需要的资料。', errorMessage: null
    });

    render(<TimeMachinePage bookId="book-1" />);

    expect(await screen.findByText('对不起，这次没有完成。已经完成的内容会保留，您可以重新开始。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重新规划全书' }));
    await waitFor(() => expect(mocked.createPlanningRouteRun).toHaveBeenCalledWith('book-1', '', 1, []));
  });

  it('恢复三条真实路线，作者选择后才生成正式框架', async () => {
    const run = routeRun();
    mocked.fetchLatestPlanningRouteRun.mockResolvedValue(run);
    mocked.decidePlanningRoute.mockResolvedValue({ routeVersionId: 'route-version-1', recipeVersionId: 'recipe-version-1', status: 'confirmed', nextStep: 'book_tree' });
    mocked.fetchPlanningRouteRun.mockResolvedValue({ ...run, status: 'completed', phase: 'completed', canDecide: false });
    mocked.createPlanningTreeGeneration.mockResolvedValue(generation());

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
    expect(mocked.createPlanningTreeGeneration).toHaveBeenCalledWith('book-1', 'book', 'book-1', undefined);
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
    fireEvent.click(screen.getByRole('button', { name: '确认采用框架' }));
    await waitFor(() => expect(mocked.confirmPlanningTree).toHaveBeenCalledWith('book-1', 'book', 'book-1', 1));
  });

  it('正式框架保留页内调整入口，并允许重新选择一到三位主编', async () => {
    mocked.fetchPlanningTree.mockResolvedValue({ ...treeView(), status: 'confirmed' });
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
