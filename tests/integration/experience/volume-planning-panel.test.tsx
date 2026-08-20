// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    if (path.endsWith('/directions') && method === 'GET') return apiResponse([]);
    if (path.endsWith('/versions') && method === 'GET') return apiResponse(versions);
    if (path.endsWith('/versions') && method === 'POST') {
      const version = volumeVersion(body!);
      versions.push(version);
      return apiResponse(version);
    }
    if (path.endsWith('/impact-preview') && method === 'POST') return apiResponse({
      volumePlanId: 'plan-1', candidateVersionId: 'plan-version-1', activeVersionId: null,
      changedFields: ['title', 'coreGoal'], downstreamDependencyCount: 0,
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
  expect(await screen.findByRole('heading', { name: '分卷' })).toBeInTheDocument();
  expect(screen.queryByText('当前卷工作台')).not.toBeInTheDocument();
  expect(screen.queryByText(/卷规划只约束目标/u)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '开始规划第一卷' }));
  expect(await screen.findByRole('heading', { name: '我的卷规划草案' })).toBeInTheDocument();
  change('卷标题', '雾城守夜卷');
  change('开卷时人物与局面', '张三仍是边军小卒，只掌握一条未经证实的预见线索。');
  change('这一卷必须完成什么', '让张三证明预见并非幻觉，同时决定是否承担守城责任。');
  change('最主要的对抗', '边军纪律与迫近灾难同时挤压张三。');
  change('失败会失去什么', '雾城失守，张三也会被当作扰乱军心者处决。');
  change('人物要发生的变化（每行一条）', '张三从只求自保变为主动承担后果');
  change('卷末留下什么局面', '雾城暂时守住，但预见指向更大的灾难。');
  change('怎样自然引出下一卷', '敌军撤退路线暴露了王都内部的接应者。');
  fireEvent.click(screen.getByRole('button', { name: '保存为新候选版' }));

  expect(await screen.findByLabelText('改动影响预览')).toBeInTheDocument();
  expect(screen.getByText('卷标题、本卷目标')).toBeInTheDocument();
  expect(screen.queryByText('第一个事件种子')).not.toBeInTheDocument();
  const versionRequest = requests.find((request) => request.path.endsWith('/versions') && request.method === 'POST');
  expect(versionRequest?.body).toMatchObject({
    expectedPlanRevision: 1,
    candidateKind: 'author_edit',
    template: { selectionMode: 'none', templateKey: null, scope: 'volume' },
    content: { title: '雾城守夜卷' }
  });

  fireEvent.click(screen.getByRole('button', { name: '确认这份稿' }));
  expect(await screen.findByText('已确认第1稿')).toBeInTheDocument();
  await waitFor(() => expect(requests.find((request) => request.path.endsWith('/confirm') && request.method === 'POST')?.body).toMatchObject({
    volumePlanVersionId: 'plan-version-1', expectedPlanRevision: 1,
    expectedActiveVersionId: null, expectedWorkflowVersion: 3
  }));
  expect(versions).toHaveLength(1);
});

it('用自然语言显示真实卷规划进度，隐藏模型内部编号，并把当前卷作者原话交给本轮任务', async () => {
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
    if (path.endsWith('/workflow')) return apiResponse(workflowView('volume_plan_in_progress', 3, 'plan-1'));
    if (path.endsWith('/planning-templates')) return apiResponse(templateCatalog());
    if (path.endsWith('/author-planning-inputs')) return apiResponse(ideas);
    if (path.endsWith('/volume-plans') && method === 'GET') return apiResponse([plan]);
    if (path.endsWith('/directions') && method === 'GET') return apiResponse([]);
    if (path.endsWith('/versions') && method === 'GET') return apiResponse([]);
    if (path.endsWith('/generation') && method === 'GET') return apiResponse(generation);
    if (path.endsWith('/generate') && method === 'POST') {
      generation = {        stateText: '本轮方案已经准备好', phaseText: '融合方案已准备好', isRunning: false, isCompleted: true,
        canCancel: false, canResume: false, canRetry: false, errorMessage: null,
        members: [
          { roleKey: 'lead_screenwriter', displayName: '婉儿' },
          { roleKey: 'second_screenwriter', displayName: '红玉' },
          { roleKey: 'main_editor', displayName: '昭昭' }
        ],
        candidateVersionIds: { candidateA: 'version-a', candidateB: 'version-b', fusion: 'version-fusion' },
        createdAt: '2026-08-08T12:00:00.000Z', updatedAt: '2026-08-08T12:01:00.000Z'
      };
      return apiResponse(generation);
    }
    return new Response(JSON.stringify({ error: { message: `未配置测试接口 ${method} ${path}` } }), { status: 404 });
  }));

  render(<VolumePlanningPanel bookId="book-volume-ui" />);
  expect(await screen.findByRole('heading', { name: '团队设计' })).toBeInTheDocument();
  expect(await screen.findByText('希望主角靠承担代价解决问题。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '让团队开始设计' }));

  expect(await screen.findByText(/本轮方案已经准备好.*融合方案已准备好/u)).toBeInTheDocument();
  expect(screen.queryByText(/候选版本|本地确定性|local-deterministic|fixture-/u)).not.toBeInTheDocument();
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

it('在手机宽度下用两条具体故事路线完成分段选择，融合请求只携带作者选中部分且不泄漏专业术语', async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  const plan = volumePlan(null, 1);
  const directions = [
    volumeDirection('direction-a', 'proposal-a', 'candidate_a', '主动守城路线', '主角发现城门异动，主动违令查证。', '守住侧门并证明判断。'),
    volumeDirection('direction-b', 'proposal-b', 'candidate_b', '关系失衡路线', '主角被同伴误解后卷入军令冲突。', '在公开审判中揭开真正内应。')
  ];
  let generation: Record<string, unknown> = {    stateText: '本轮方案已经准备好', phaseText: '两份故事路线已经准备好', isRunning: false, isCompleted: true,
    canCancel: false, canResume: false, canRetry: false, errorMessage: null,
    members: [
      { roleKey: 'lead_screenwriter', displayName: '婉儿' },
      { roleKey: 'second_screenwriter', displayName: '红玉' },
      { roleKey: 'main_editor', displayName: '昭昭' }
    ],
    candidateVersionIds: { candidateA: 'legacy-a', candidateB: 'legacy-b', fusion: null },
    createdAt: '2026-08-20T08:00:00.000Z', updatedAt: '2026-08-20T08:01:00.000Z'
  };
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> | null }> = [];

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1');
    const path = url.pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({ path, method, body });
    if (path.endsWith('/workflow')) return apiResponse(workflowView('volume_plan_in_progress', 3, 'plan-1'));
    if (path.endsWith('/author-planning-inputs')) return apiResponse([]);
    if (path.endsWith('/volume-plans') && method === 'GET') return apiResponse([plan]);
    if (path.endsWith('/versions') && method === 'GET') return apiResponse([]);
    if (path.endsWith('/directions') && method === 'GET') return apiResponse(directions);
    if (path.endsWith('/generation') && method === 'GET') return apiResponse(generation);
    if (path.endsWith('/generate') && method === 'POST') {
      generation = {
        ...generation, stateText: '本轮方案已经准备好', phaseText: '融合方案已准备好',
        candidateVersionIds: { candidateA: 'legacy-a', candidateB: 'legacy-b', fusion: 'legacy-fusion' }
      };
      return apiResponse(generation);
    }
    return new Response(JSON.stringify({ error: { message: `未配置测试接口 ${method} ${path}` } }), { status: 404 });
  }));

  render(<VolumePlanningPanel bookId="book-volume-ui" />);
  expect(await screen.findByRole('heading', { name: '这卷故事可以这样走' })).toBeInTheDocument();
  expect(screen.queryByText('第一个事件种子')).not.toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/拯救猫咪|三幕式|五幕式|三幕九线|节拍/u);

  const routeOne = screen.getByRole('heading', { name: '主动守城路线' }).closest('article');
  const routeTwo = screen.getByRole('heading', { name: '关系失衡路线' }).closest('article');
  expect(routeOne).not.toBeNull();
  expect(routeTwo).not.toBeNull();
  fireEvent.click(within(routeOne!).getAllByRole('button', { name: '选这部分' })[0]!);
  fireEvent.click(within(routeTwo!).getAllByRole('button', { name: '选这部分' })[8]!);
  expect(screen.getByText('已选 2 部分')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '请主编只融合已选部分' }));

  await waitFor(() => {
    const request = requests.find((item) => item.path.endsWith('/generate') && item.method === 'POST');
    expect(request?.body).toMatchObject({
      selection: {
        selectionMode: 'fragments',
        fragments: [
          { fragmentId: 'proposal-a:openingSituation', field: 'openingSituation', sourceProposalId: 'proposal-a', sourceVersionId: 'direction-a' },
          { fragmentId: 'proposal-b:climaxResponsibility', field: 'climaxResponsibility', sourceProposalId: 'proposal-b', sourceVersionId: 'direction-b' }
        ]
      }
    });
  });
  expect(await screen.findByText(/融合方案已准备好/u)).toBeInTheDocument();
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

function volumeDirection(
  id: string,
  proposalId: string,
  candidateKind: 'candidate_a' | 'candidate_b',
  title: string,
  openingSituation: string,
  climaxResponsibility: string
): Record<string, unknown> {
  return {
    volumeDirectionVersionId: id, volumePlanId: 'plan-1',
    legacyVolumePlanVersionId: candidateKind === 'candidate_a' ? 'legacy-a' : 'legacy-b',
    version: candidateKind === 'candidate_a' ? 1 : 2, proposalId, candidateKind, status: 'candidate',
    parentVersionId: null, sourceVersionIds: ['setting-active'], authorInputRefs: [],
    content: {
      title, openingSituation, protagonistDrive: '主角必须在军令和亲眼所见之间作出选择。',
      volumeGoal: '让这次选择真正改变雾城局面。', centralOpposition: '军令秩序、内应和时间压力同时阻拦。',
      escalationPath: ['先找到异常证据', '公开行动后承担问责', '在局面失控前逼出真正对手'],
      majorChoices: ['是否违令关闭侧门'], relationshipMovement: ['主角与同伴从互信走向裂痕再重建'],
      expressionFocus: ['紧迫感', '选择的代价'], climaxResponsibility,
      costAndConsequence: '即使守住城门，主角也失去原有身份和退路。',
      closingState: '雾城暂时安全，主角被迫进入更大的权力冲突。',
      benefits: ['人物行动清楚', '结果会留下真实后果'], risks: ['避免连续使用同一种误会'],
      openSpaces: ['内应的真实动机留到事件设计时决定']
    },
    contentHash: `sha256:${candidateKind === 'candidate_a' ? 'a'.repeat(64) : 'b'.repeat(64)}`,
    createdAt: '2026-08-20T08:00:00.000Z', confirmedAt: null
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
  const base = {
    templateKey: 'volume-escalating-goals', templateVersion: 1, contentHash: `sha256:${'2'.repeat(64)}`,
    scope: 'volume', sourceLabel: '递进结构', publicTitle: '解决一个麻烦，又引出更大的目标',
    publicExplanation: '每次解决都改变人物状态并暴露更大的问题。', fitConditions: ['持续推进'],
    knownRisks: ['不能只换更强敌人'], authorQuestions: ['这次结果改变了什么？'],
    beats: [{ beatId: 'cause', publicFunction: '先解决眼前问题', expectedChange: '人物状态发生变化', optional: false, order: 1 }],
    previewPrompt: '按因果推进', recommended: true
  };
  const alternatives = ['让关系变化推动主线', '让局势分段升级', '先得后失再重建'].map((title, index) => ({
    ...base, templateKey: `volume-extra-${index + 1}`, contentHash: `sha256:${String(index + 4).repeat(64)}`,
    sourceLabel: '其他叙事方法', publicTitle: title, recommended: false,
    beats: [{ ...base.beats[0], beatId: `extra-${index + 1}` }]
  }));
  return {
    contractVersion: 1, registryVersion: 1, registryHash: `sha256:${'1'.repeat(64)}`, scope: 'volume',
    templates: [base, ...alternatives],
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
