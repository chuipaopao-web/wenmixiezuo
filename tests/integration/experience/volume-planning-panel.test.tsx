// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VolumePlanningPanel } from '../../../apps/web/src/features/planning/VolumePlanningPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('在原页面完成建卷、作者候选、影响预览和确认，不覆盖历史版本', async () => {
  let workflow = workflowView('setting_confirmed', 2, null);
  const plans: Array<Record<string, unknown>> = [];
  const versions: Array<Record<string, unknown>> = [];
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> | null }> = [];

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1');
    const path = url.pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({ path, method, body });
    if (path === '/api/v1/runtime/session') return apiResponse({ authenticated: true, expiresInSeconds: 1800 });
    if (path.endsWith('/workflow')) return apiResponse(workflow);
    if (path.endsWith('/planning-templates')) return apiResponse(templateCatalog());
    if (path.endsWith('/author-planning-inputs')) return apiResponse([]);
    if (path.endsWith('/generation') && method === 'GET') return apiResponse(null);
    if (path.endsWith('/volume-plans') && method === 'GET') return apiResponse(plans);
    if (path.endsWith('/volume-plans') && method === 'POST') {
      const plan = volumePlan(null, 1);
      plans.push(plan);
      workflow = workflowView('volume_plan_in_progress', 3, 'plan-1');
      return apiResponse(plan);
    }
    if (path.endsWith('/versions') && method === 'GET') return apiResponse(versions);
    if (path.endsWith('/versions') && method === 'POST') {
      const version = volumeVersion(body!);
      versions.push(version);
      return apiResponse(version);
    }
    if (path.endsWith('/impact-preview') && method === 'POST') return apiResponse({
      volumePlanId: 'plan-1', candidateVersionId: 'plan-version-1', activeVersionId: null,
      changedFields: ['title', 'coreGoal', 'eventSequence'], downstreamDependencyCount: 0,
      requiresDownstreamReview: false, note: '当前没有已确认的下游内容，切换后可继续设计事件。'
    });
    if (path.endsWith('/confirm') && method === 'POST') {
      versions[0] = { ...versions[0], status: 'active', confirmedAt: '2026-08-08T13:00:00.000Z' };
      plans[0] = volumePlan(versions[0]!, 2);
      workflow = workflowView('volume_plan_confirmed', 4, 'plan-1');
      return apiResponse(plans[0]);
    }
    return new Response(JSON.stringify({ error: { message: `未配置测试接口 ${method} ${path}` } }), { status: 404 });
  }));

  render(<VolumePlanningPanel bookId="book-volume-ui" />);
  expect(await screen.findByRole('heading', { name: '先确定这一卷要改变什么，再拆事件' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '开始规划第一卷' }));
  expect(await screen.findByRole('heading', { name: '我的卷规划草案' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /解决一个麻烦，又引出更大的目标/u }));

  change('卷标题', '雾城守夜卷');
  change('开卷时人物与局面', '张三仍是边军小卒，只掌握一条未经证实的预见线索。');
  change('这一卷必须完成什么', '让张三证明预见并非幻觉，同时决定是否承担守城责任。');
  change('最主要的对抗', '边军纪律与迫近灾难同时挤压张三。');
  change('失败会失去什么', '雾城失守，张三也会被当作扰乱军心者处决。');
  change('人物要发生的变化（每行一条）', '张三从只求自保变为主动承担后果');
  change('卷末留下什么局面', '雾城暂时守住，但预见指向更大的灾难。');
  change('怎样自然引出下一卷', '敌军撤退路线暴露了王都内部的接应者。');
  change('事件名称', '钟响前的误报');
  change('它为本卷承担什么任务', '让张三第一次为预见承担公开风险。');
  change('从什么状态进入', '无人相信张三。');
  change('什么事情触发它', '城外斥候失联。');
  change('人物采取什么行动', '张三违令关闭侧门并寻找证据。');
  change('行动造成什么结果', '伏兵暴露，但张三被押去问罪。');
  fireEvent.click(screen.getByRole('button', { name: '保存为新候选版' }));

  expect(await screen.findByLabelText('版本影响预览')).toBeInTheDocument();
  expect(screen.getByText('卷标题、本卷目标、事件链')).toBeInTheDocument();
  const versionRequest = requests.find((request) => request.path.endsWith('/versions') && request.method === 'POST');
  expect(versionRequest?.body).toMatchObject({
    expectedPlanRevision: 1,
    candidateKind: 'author_edit',
    template: { selectionMode: 'template', templateKey: 'volume-escalating-goals' },
    content: { title: '雾城守夜卷', eventSequence: [{ title: '钟响前的误报' }] }
  });

  fireEvent.click(screen.getByRole('button', { name: '确认此版本' }));
  expect(await screen.findByText('已确认第1版')).toBeInTheDocument();
  await waitFor(() => expect(requests.find((request) => request.path.endsWith('/confirm') && request.method === 'POST')?.body).toMatchObject({
    volumePlanVersionId: 'plan-version-1', expectedPlanRevision: 1,
    expectedActiveVersionId: null, expectedWorkflowVersion: 3
  }));
  expect(versions).toHaveLength(1);
});

it('只显示真实卷规划任务和模型来源，并把当前卷作者原话交给本轮任务', async () => {
  const plan = volumePlan(null, 1);
  let generation: Record<string, unknown> | null = null;
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> | null; query: string }> = [];
  const ideas = [{
    ownerId: 'owner-volume-ui', bookId: 'book-volume-ui', authorInputId: 'idea-volume-1',
    surface: 'volume_plan', subjectType: 'volume_plan', subjectId: 'plan-1', intentStrength: 'preference',
    originalText: '希望主角靠承担代价解决问题。', originalTextHash: 'hash', attachmentRefs: [],
    mentionedAgentIds: [], scopeNotes: null, status: 'new', appliedToRefs: [], handlingReason: null,
    links: [], createdAt: '2026-08-08T12:00:00.000Z', updatedAt: '2026-08-08T12:00:00.000Z', decidedAt: null
  }];

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1');
    const path = url.pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({ path, method, body, query: url.search });
    if (path === '/api/v1/runtime/session') return apiResponse({ authenticated: true, expiresInSeconds: 1800 });
    if (path.endsWith('/workflow')) return apiResponse(workflowView('volume_plan_in_progress', 3, 'plan-1'));
    if (path.endsWith('/planning-templates')) return apiResponse(templateCatalog());
    if (path.endsWith('/author-planning-inputs')) return apiResponse(ideas);
    if (path.endsWith('/volume-plans') && method === 'GET') return apiResponse([plan]);
    if (path.endsWith('/versions') && method === 'GET') return apiResponse([]);
    if (path.endsWith('/generation') && method === 'GET') return apiResponse(generation);
    if (path.endsWith('/generate') && method === 'POST') {
      generation = {
        taskId: 'task-volume-ai', status: 'succeeded', currentPhase: 'fusion_complete', errorCode: null,
        checkpoint: { awaitingAuthorChoice: true }, modelDiversityVerified: false,
        members: [
          { roleKey: 'lead_screenwriter', agentId: 'agent-a', displayName: '婉儿', provider: 'local-deterministic', modelId: 'fixture-a' },
          { roleKey: 'second_screenwriter', agentId: 'agent-b', displayName: '红玉', provider: 'local-deterministic', modelId: 'fixture-b' },
          { roleKey: 'main_editor', agentId: 'agent-editor', displayName: '昭昭', provider: 'local-deterministic', modelId: 'fixture-editor' }
        ],
        candidateVersionIds: { candidateA: 'version-a', candidateB: 'version-b', fusion: 'version-fusion' },
        createdAt: '2026-08-08T12:00:00.000Z', updatedAt: '2026-08-08T12:01:00.000Z'
      };
      return apiResponse(generation);
    }
    return new Response(JSON.stringify({ error: { message: `未配置测试接口 ${method} ${path}` } }), { status: 404 });
  }));

  render(<VolumePlanningPanel bookId="book-volume-ui" />);
  expect(await screen.findByRole('heading', { name: '两位编剧独立设计，主编最后融合' })).toBeInTheDocument();
  expect(await screen.findByText('希望主角靠承担代价解决问题。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '让团队开始设计' }));

  expect(await screen.findByText('三个方案已完成')).toBeInTheDocument();
  expect(screen.getByText('3/3 个候选版本')).toBeInTheDocument();
  expect(screen.getByText(/只验证任务、上下文和版本流程/u)).toBeInTheDocument();
  expect(screen.getByText('婉儿')).toBeInTheDocument();
  expect(screen.getByText('红玉')).toBeInTheDocument();
  expect(screen.getByText('昭昭')).toBeInTheDocument();
  const generated = requests.find((request) => request.path.endsWith('/generate') && request.method === 'POST');
  expect(generated?.body).toMatchObject({
    expectedPlanRevision: 1,
    expectedActiveVersionId: null,
    expectedWorkflowVersion: 3,
    authorInputRefs: ['idea-volume-1'],
    template: { selectionMode: 'none', scope: 'volume' }
  });
  expect(requests.some((request) => request.path.endsWith('/author-planning-inputs')
    && request.query.includes('subjectType=volume_plan')
    && request.query.includes('subjectId=plan-1'))).toBe(true);
});

function change(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function workflowView(stage: string, planningVersion: number, activeVolumePlanId: string | null): Record<string, unknown> {
  return {
    ownerId: 'owner-volume-ui', bookId: 'book-volume-ui', stage, planningVersion,
    activeVolumePlanRef: activeVolumePlanId === null ? null : { volumePlanId: activeVolumePlanId, volumePlanVersionId: null },
    activeEventRef: null, frozenChapterOutlineRefs: [], waitingTaskId: null, blockingReason: null,
    updatedAt: '2026-08-08T12:00:00.000Z'
  };
}

function volumePlan(activeVersion: Record<string, unknown> | null, revision: number): Record<string, unknown> {
  return {
    volumePlanId: 'plan-1', planNumber: 1, physicalVolumeId: null, previousVolumePlanId: null,
    previousSettlementId: null, status: activeVersion === null ? 'planning' : 'active', revision,
    activeVersionId: activeVersion?.volumePlanVersionId ?? null, activeVersion,
    createdAt: '2026-08-08T12:00:00.000Z', updatedAt: '2026-08-08T12:00:00.000Z'
  };
}

function volumeVersion(body: Record<string, unknown>): Record<string, unknown> {
  return {
    volumePlanVersionId: 'plan-version-1', volumePlanId: 'plan-1', version: 1,
    parentVersionId: null, status: 'candidate', candidateKind: body.candidateKind,
    dependencies: [], template: body.template, authorInputRefs: body.authorInputRefs,
    content: body.content, contentHash: `sha256:${'3'.repeat(64)}`, sourceTaskId: null,
    createdAt: '2026-08-08T12:30:00.000Z', confirmedAt: null
  };
}

function templateCatalog(): Record<string, unknown> {
  return {
    contractVersion: 1, registryVersion: 1, registryHash: `sha256:${'1'.repeat(64)}`, scope: 'volume',
    templates: [{
      templateKey: 'volume-escalating-goals', templateVersion: 1, contentHash: `sha256:${'2'.repeat(64)}`,
      scope: 'volume', publicTitle: '解决一个麻烦，又引出更大的目标',
      publicExplanation: '每次解决都改变人物状态并暴露更大的问题。', fitConditions: ['持续推进'],
      knownRisks: ['不能只换更强敌人'], authorQuestions: ['这次结果改变了什么？'],
      beats: [{ beatId: 'cause', publicFunction: '先解决眼前问题', expectedChange: '人物状态发生变化', optional: false, order: 1 }],
      previewPrompt: '按因果推进', recommended: true
    }],
    alternativeChoices: [
      { mode: 'custom', publicTitle: '按我的想法推进', publicExplanation: '不套系统节奏。' },
      { mode: 'none', publicTitle: '暂时不选', publicExplanation: '让因果自然决定。' }
    ]
  };
}

function apiResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: 'request-volume-ui', version: 1 } }), {
    status: 200, headers: { 'content-type': 'application/json' }
  });
}
