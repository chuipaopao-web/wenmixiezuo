// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { AUTHOR_AUTHENTICATION_REQUIRED_EVENT } from './account-api';
import {
  createSettingFinalReview,
  createSettingRecommendation,
  fetchOpeningTask,
  fetchPlanningTasks,
  fetchSettingDepartment,
  retryPlanningTreeGeneration
} from './opening-api';

afterEach(() => vi.unstubAllGlobals());

it('把作者投影中的恢复标识还原为任务页稳定标识', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    data: [{
      recoveryKey: 'route-1', taskKind: 'planning_route', bookId: 'book-1', bookTitle: '北宋小卒',
      status: 'waiting_for_you', message: '方案已经整理好。', progress: 100,
      memberKey: 'chief-1', memberName: '貂蝉', treeKind: null, scopeId: null,
      canStop: false, updatedAt: '2026-08-30T00:00:00.000Z'
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } })));

  const tasks = await fetchPlanningTasks();

  expect(tasks).toHaveLength(1);
  expect(tasks[0]?.taskId).toBe('route-1');
  expect(tasks[0]).not.toHaveProperty('recoveryKey');
});

it('把设定清单与统一整理的恢复标识还原为任务标识，包括编辑部嵌套结果', async () => {
  const recommendation = {
    recoveryKey: 'recommendation-recovery-1', status: 'working', statusText: '正在整理设定清单。',
    phase: 'organizing', phaseText: '正在分清轻重', progress: 72, member: null, attemptedMembers: [],
    result: null, retryable: true, createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:01.000Z'
  };
  const finalReview = {
    recoveryKey: 'final-review-recovery-1', status: 'working', statusText: '正在统一整理设定。',
    progress: 64, member: null, result: null, retryable: true,
    createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:01.000Z'
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    const data = path.endsWith('/setting-department')
      ? { catalog: [], recommendedKeys: [], confirmedItems: [], members: [], activeBatch: null, recommendation, finalReview }
      : path.endsWith('/setting-final-reviews')
        ? finalReview
        : recommendation;
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));

  const createdRecommendation = await createSettingRecommendation('book-1');
  const createdFinalReview = await createSettingFinalReview('book-1');
  const department = await fetchSettingDepartment('book-1');

  expect(createdRecommendation.taskId).toBe('recommendation-recovery-1');
  expect(createdFinalReview.taskId).toBe('final-review-recovery-1');
  expect(department.recommendation?.taskId).toBe('recommendation-recovery-1');
  expect(department.finalReview?.taskId).toBe('final-review-recovery-1');
  expect(createdRecommendation).not.toHaveProperty('recoveryKey');
  expect(createdFinalReview).not.toHaveProperty('recoveryKey');
  expect(department.recommendation).not.toHaveProperty('recoveryKey');
  expect(department.finalReview).not.toHaveProperty('recoveryKey');
});

it('所有作者接口遇到 401 都通知 V7 账号门禁接管', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: { message: '请先登录' }
  }), { status: 401, headers: { 'content-type': 'application/json' } })));
  const listener = vi.fn();
  window.addEventListener(AUTHOR_AUTHENTICATION_REQUIRED_EVENT, listener);

  try {
    await expect(fetchPlanningTasks()).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener(AUTHOR_AUTHENTICATION_REQUIRED_EVENT, listener);
  }
});

it('网络断开时只告诉作者检查网络，不暴露本地服务', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));

  await expect(fetchPlanningTasks()).rejects.toMatchObject({
    message: '暂时连接不上文秘写作，请检查网络后重试。',
    retryable: true,
    status: 0
  });
});

it('服务返回非 JSON 错误时不向作者显示 HTTP 状态码', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', {
    status: 502,
    headers: { 'content-type': 'text/html' }
  })));

  const request = fetchPlanningTasks();
  await expect(request).rejects.toMatchObject({
    message: '文秘写作暂时没有响应，请稍后重试。',
    retryable: true,
    status: 502
  });
  await expect(request).rejects.not.toThrow(/502|HTTP|bad gateway/iu);
});

it('历史开书任务只投影为已停止恢复状态，不把旧候选和流程字段交给页面', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {
    taskId: 'retired-opening-1', idea: '张三穿越三国。', publishingPlatform: 'fanqie',
    status: 'working', phase: 'retired_phase', statusText: '任务正在进行', phaseText: '旧阶段',
    isRunning: true, needsAuthorDecision: false, workflowStyle: 'retired_workflow',
    selectedMembers: { chiefEditor: null, screenwriter: null },
    candidates: [{
      candidateId: 'retired-candidate-1', kind: 'retired_candidate', version: 1, content: {},
      createdBy: { memberKey: 'retired-member', displayName: '历史成员' }, sourceCandidateIds: []
    }],
    errorMessage: null, resultBookId: null,
    progress: { currentStep: 1, totalSteps: 3, percent: 20 },
    createdAt: '2026-08-30T00:00:00.000Z', updatedAt: '2026-08-30T00:00:01.000Z'
  } }), { status: 200, headers: { 'content-type': 'application/json' } })));

  const task = await fetchOpeningTask('retired-opening-1');

  expect(task.retired).toBe(true);
  expect(task.isRunning).toBe(false);
  expect(task.candidates).toEqual([]);
  expect(task).not.toHaveProperty('workflowStyle');
});

it('框架失败恢复调用原运行的续跑接口，不创建新的生成任务', async () => {
  const view = {
    runId: 'generation-1', treeKind: 'book', scopeId: 'book-1', status: 'working',
    message: '正在继续未完成步骤。', member: { memberKey: 'planner-1', name: '幼薇' },
    candidateTreeVersionId: null, canOpenCandidate: false, errorMessage: null
  };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: view }), {
    status: 200, headers: { 'content-type': 'application/json' }
  }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(retryPlanningTreeGeneration('book-1', 'generation-1')).resolves.toEqual(view);

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/v1/v7/books/book-1/planning-tree-generation-runs/generation-1/retry',
    expect.objectContaining({ method: 'POST', body: '{}', credentials: 'include' })
  );
});
