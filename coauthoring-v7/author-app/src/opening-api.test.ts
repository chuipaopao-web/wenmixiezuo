// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { AUTHOR_AUTHENTICATION_REQUIRED_EVENT } from './account-api';
import {
  createSettingFinalReview,
  createSettingRecommendation,
  fetchPlanningTasks,
  fetchSettingDepartment
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
