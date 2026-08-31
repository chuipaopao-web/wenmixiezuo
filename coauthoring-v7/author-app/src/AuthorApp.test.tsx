import { fireEvent, render as testingRender, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorApp } from './AuthorApp';
import { AuthorAccountSessionProvider, type AuthorAccountSession } from './AuthorAccountBoundary';
import { AUTHOR_NAV_ITEMS, authorViewFromSearch, bookIdFromSearch, preserveCreationScopeInSearch, searchForAuthorView } from './navigation';
import { authorFacingReviewText, reviewFieldLabel } from './NewNovelPage';
import type { OpeningPackage, OpeningTaskView, OpeningTaxonomy } from './opening-api';

vi.mock('./CreationWorkspacePage', () => ({
  CreationWorkspacePage: ({ focus, onNavigate }: {
    focus: 'volume' | 'chain' | 'chapter';
    onNavigate: (next: 'volume' | 'chain' | 'chapter', scope?: { chapter?: number }) => void;
  }) => <section aria-label={`${focus}测试工作台`}>
    {focus === 'chain' && <button type="button" onClick={() => onNavigate('chapter', { chapter: 9 })}>查看历史第9章</button>}
  </section>
}));

const TAXONOMY: OpeningTaxonomy = {
  version: 'test-v1',
  categories: [{
    key: 'male-history-brain', name: '历史脑洞', channel: 'male', description: '历史架空',
    recommendedMainTags: ['成长', '权谋'], tagPackKeys: ['history']
  }],
  subjects: [{ name: '秦汉三国', packKeys: ['history'] }, { name: '穿越', packKeys: ['common'] }],
  mainTags: ['成长', '权谋', '智商在线', '群像'],
  personalityGroups: [{ key: 'surface', name: '外在性格', description: '角色给人的第一印象', options: ['谨慎', '果断'] }],
  boundaryGroups: [{ name: '内容边界', description: '作者明确不想出现的内容', options: ['不写后宫', '不要系统', '不要金手指'] }],
  tagGroups: [{
    key: 'common', name: '通用方向', description: '通用标签', packKeys: ['common'],
    mainTags: ['成长', '权谋'], auxiliaryTags: ['智商在线'], storyTraits: ['群像']
  }]
};

const PACKAGE: OpeningPackage = {
  title: '三国小卒问鼎路',
  positioning: {
    publishingPlatform: 'fanqie',
    channel: 'male', category: '历史脑洞', genres: ['秦汉三国', '穿越'],
    tags: ['成长', '权谋', '智商在线', '群像'], coreAppeal: '现代普通人从乱世小卒成长为一方主将。',
    targetReaders: '喜欢历史穿越、成长和智谋博弈的读者。',
    expectedTotalWords: 3_000_000,
    volumePlan: { minimum: 5, recommended: 6, maximum: 8 },
    retentionPositioning: '开篇尽快兑现乱世求生，卷内持续提供身份成长、智谋翻盘和班底扩张。'
  },
  backgrounds: {
    eraAndWorld: '东汉末年群雄割据的真实历史骨架与有限架空世界。',
    openingSituation: '黄巾余乱未平，主角所在流民队伍被官军强征。'
  },
  protagonists: [{
    name: '张三', age: '20岁', identity: '男主',
    background: '熟悉宏观历史，但不记得全部细节，只能靠判断和试错求生。',
    visualIdentity: { appearance: '五官硬朗、剑眉', build: '高挑、精壮', signatureFeature: '眉骨伤疤' },
    goal: '先活下去并保护同行家人，再逐步掌握自己的命运。',
    dilemma: '身份卑微且没有资源，任何历史知识都可能带来怀疑。',
    personality: ['理性', '敏锐', '重情重义'], boundary: '不能凭空全知，所有成长必须由行动与代价换来。'
  }],
  opening: {
    startingSituation: '张三醒在饥饿的流民队伍里，下一顿饭和身份都没有着落。',
    incitingIncident: '官军强征壮丁，张三被编入死亡率最高的先锋营。',
    immediateConflict: '他必须在第一次遭遇战前争取武器，并判断队伍里谁能信任。',
    readerPromise: '看一个没有无敌金手指的小人物靠判断、勇气和班底在乱世稳步崛起。'
  },
  longTermDirection: {
    centralConflict: '个人求生与乱世秩序重建之间不断扩大的责任冲突。',
    progression: '从流民、小卒、基层军官到能独当一面的统兵者。',
    relationshipDirection: '从互相提防的临时同伴发展为经受利益与生死考验的班底。',
    storyPotential: '军营求生、战役推进、势力博弈和治理选择可以逐卷升级。'
  },
  possibleEnding: {
    direction: '张三最终拥有决定一方百姓命运的权力，并建立更稳定的秩序。',
    price: '他必须失去部分私人生活，并承担曾经最讨厌的权力责任。',
    openness: '是否称帝、辅佐他人或退居幕后，留到后续蓝图与卷结算决定。'
  },
  authorNotes: ['确认主角最终更偏争霸还是辅臣。'],
  mustFollow: ['无额外限制']
};

const COMPLETE_TASK: OpeningTaskView = {
  taskId: 'task-opening-0001', status: 'awaiting_author_confirmation', phase: 'complete',
  idea: '张三穿越三国，从流民开始求生。',
  publishingPlatform: 'fanqie',
  statusText: '开书资料包已经完成，请您确认或修改', phaseText: '主编审查通过',
  isRunning: false, needsAuthorDecision: false, retired: false,
  selectedMembers: {
    chiefEditor: { memberKey: 'chief-kimi', displayName: '总编·月衡' },
    screenwriter: { memberKey: 'writer-ark', displayName: '编剧·青岚' }
  },
  candidates: [
    { candidateId: 'candidate-package-0001', kind: 'opening_package', version: 1, content: PACKAGE, createdBy: { memberKey: 'writer-ark', displayName: '编剧·青岚' }, sourceCandidateIds: [] },
    { candidateId: 'candidate-review-0001', kind: 'opening_review', version: 1, content: { verdict: 'pass', summary: '定位、人物、开局和长期空间相互支持。', issues: [], requiredChanges: [], authorDecisions: [] }, createdBy: { memberKey: 'chief-kimi', displayName: '总编·月衡' }, sourceCandidateIds: ['candidate-package-0001'] }
  ],
  errorMessage: null, resultBookId: null, progress: { currentStep: 2, totalSteps: 2, percent: 100 },
  createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:01Z'
};

const draftKey = (userId: string, mode: 'ai' | 'manual'): string =>
  `wenmi-v7-opening-draft-v2:${encodeURIComponent(userId)}:${mode}`;
const AI_DRAFT_KEY = draftKey('user-author-app', 'ai');
const MANUAL_DRAFT_KEY = draftKey('user-author-app', 'manual');
const decisionKey = (taskId: string, candidateId: string): string =>
  `wenmi-v7-opening-decisions-v2:user-author-app:${taskId}:${candidateId}`;

function createTestSession(): AuthorAccountSession {
  return {
    account: {
      userId: 'user-author-app', email: 'lin@example.com', displayName: '林老师',
      role: 'user', status: 'active'
    },
    membership: {
      isAdmin: false,
      membership: {
        plan: 'gold', planLabel: '黄金会员', planPrice: '¥199/月', status: 'active',
        computeQuota: 2_000_000, computeConsumed: 360_000, computeRemaining: 1_640_000,
        periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z', expired: false
      }
    },
    membershipState: 'ready',
    membershipError: null,
    signingOut: false,
    sessionNotice: null,
    refreshMembership: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    requireSignIn: vi.fn()
  };
}

let testSession = createTestSession();

function render(ui: ReactElement): ReturnType<typeof testingRender> {
  return testingRender(<AuthorAccountSessionProvider session={testSession}>{ui}</AuthorAccountSessionProvider>);
}

function response<T>(data: T, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data, meta: { requestId: 'test', version: 1 } }) } as Response;
}

function installFetch(overrides?: (url: string, init?: RequestInit) => Response | Promise<Response> | null): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const override = overrides?.(url, init);
    if (override !== null && override !== undefined) return override;
    if (url.endsWith('/api/v1/v7/books')) return response([]);
    if (url.includes('/api/v1/v7/books/') && url.endsWith('/creation-library')) return response({ volumes: [] });
    if (url.endsWith('/api/v1/v7/opening-agent/tasks?limit=50')) return response([]);
    if (url.endsWith('/api/v1/v7/design-tasks?limit=50')) return response([]);
    if (url.endsWith('/api/v1/v7/creation-tasks?limit=50')) return response([]);
    if (url.endsWith('/api/v1/v7/planning-tasks?limit=80')) return response([]);
    if (url.endsWith('/api/v1/v7/editorial/planning-members')) return response([]);
    if (url.includes('/planning-adjustment-suggestions')) return response([]);
    if (url.endsWith('/planning-routes/latest')) return response(null);
    if (url.endsWith('/generation-runs/latest')) return response(null);
    if (url.includes('/planning-trees/book/')) return response({ message: 'not found' }, 404);
    if (url.endsWith('/api/v1/v7/opening-taxonomy')) return response(TAXONOMY);
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('V7 author opening flow', () => {
  beforeEach(() => {
    testSession = createTestSession();
    window.history.replaceState({}, '', '/');
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the confirmed navigation and presents both creation entries', async () => {
    installFetch();
    render(<AuthorApp />);
    for (const label of AUTHOR_NAV_ITEMS.slice(0, 6)) expect(screen.getByRole('button', { name: label })).toBeDisabled();
    expect(screen.getByRole('button', { name: '任务' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '团队' })).toBeEnabled();
    expect(screen.getByText('创作小说')).toBeVisible();
    expect(screen.getByRole('button', { name: /团队设计/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /自己设计/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /创作剧本/ })).toBeDisabled();
    expect(screen.getByText('专业网文剧本设计平台：创作团队帮您设计骨架、大纲、剧情，书写正文，订制化设计原创作品。')).toBeVisible();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it('按 userId 隔离开书草稿，退出后切换账号不会看见前一位作者输入', async () => {
    const firstUserId = 'author-first';
    const secondUserId = 'author-second';
    localStorage.setItem(draftKey(firstUserId, 'ai'), JSON.stringify({
      idea: '第一位作者的未提交开书想法', taskId: null, mode: 'idea'
    }));
    installFetch();
    window.history.replaceState({}, '', '/?view=new-novel&entry=ai');

    testSession = {
      ...createTestSession(),
      account: { ...createTestSession().account, userId: firstUserId, displayName: '甲作者' }
    };
    const firstRender = render(<AuthorApp />);
    expect(await screen.findByLabelText('说说您想写什么')).toHaveValue('第一位作者的未提交开书想法');
    firstRender.unmount();

    testSession = {
      ...createTestSession(),
      account: { ...createTestSession().account, userId: secondUserId, displayName: '乙作者' }
    };
    const secondRender = render(<AuthorApp />);
    const secondIdea = await screen.findByLabelText('说说您想写什么');
    expect(secondIdea).toHaveValue('');
    fireEvent.change(secondIdea, { target: { value: '第二位作者自己的开书想法' } });
    await waitFor(() => expect(localStorage.getItem(draftKey(secondUserId, 'ai'))).toContain('第二位作者自己的开书想法'));
    expect(localStorage.getItem(draftKey(firstUserId, 'ai'))).toContain('第一位作者的未提交开书想法');
    secondRender.unmount();

    testSession = {
      ...createTestSession(),
      account: { ...createTestSession().account, userId: firstUserId, displayName: '甲作者' }
    };
    render(<AuthorApp />);
    expect(await screen.findByLabelText('说说您想写什么')).toHaveValue('第一位作者的未提交开书想法');
  });

  it('恢复自己设计的完整资料与所在步骤，并继续保存后续修改', async () => {
    const manualPackage: OpeningPackage = {
      ...PACKAGE,
      title: '手填未完稿',
      protagonists: [{ ...PACKAGE.protagonists[0]!, name: '未完稿主角' }],
      longTermDirection: { ...PACKAGE.longTermDirection, centralConflict: '作者尚未提交的故事方向。' }
    };
    localStorage.setItem(MANUAL_DRAFT_KEY, JSON.stringify({
      idea: '', taskId: null, mode: 'manual', publishingPlatform: 'qidian',
      openingPackage: manualPackage, baseCandidateId: null, adjustmentNote: '',
      selectedDesignerMemberKey: '', manualStep: 2
    }));
    installFetch();
    window.history.replaceState({}, '', '/?view=new-novel&entry=manual');

    const mounted = render(<AuthorApp />);
    expect(await screen.findByRole('button', { name: /2\s*边界与角色/ })).toHaveClass('active');
    const protagonistName = screen.getByLabelText('角色1姓名');
    expect(protagonistName).toHaveValue('未完稿主角');
    expect(screen.getByLabelText('故事方向（选填）')).toHaveValue('作者尚未提交的故事方向。');
    fireEvent.change(protagonistName, { target: { value: '继续修改后的主角' } });
    await waitFor(() => expect(localStorage.getItem(MANUAL_DRAFT_KEY)).toContain('继续修改后的主角'));

    mounted.unmount();
    render(<AuthorApp />);
    expect(await screen.findByLabelText('角色1姓名')).toHaveValue('继续修改后的主角');
  });

  it('恢复 AI 候选上的脏编辑、调整意见与当前步骤，不被迟到的候选覆盖', async () => {
    const longAdjustmentNote = '保留作者明确设定。'.repeat(110);
    const editedPackage: OpeningPackage = {
      ...PACKAGE,
      protagonists: [{ ...PACKAGE.protagonists[0]!, name: '作者改过的主角' }]
    };
    localStorage.setItem(AI_DRAFT_KEY, JSON.stringify({
      idea: COMPLETE_TASK.idea,
      taskId: COMPLETE_TASK.taskId,
      mode: 'ai',
      publishingPlatform: 'fanqie',
      openingPackage: editedPackage,
      baseCandidateId: 'candidate-package-0001',
      adjustmentNote: longAdjustmentNote,
      selectedDesignerMemberKey: 'planner-kimi-k3',
      manualStep: 2
    }));
    installFetch((url) => url.endsWith(`/api/v1/v7/opening-agent/tasks/${COMPLETE_TASK.taskId}`) ? response(COMPLETE_TASK) : null);
    window.history.replaceState({}, '', `/?view=new-novel&entry=ai&taskId=${COMPLETE_TASK.taskId}`);

    render(<AuthorApp />);
    expect(await screen.findByText('资料已经审查通过')).toBeVisible();
    expect(screen.getByRole('button', { name: /2\s*边界与角色/ })).toHaveClass('active');
    expect(screen.getByLabelText('角色1姓名')).toHaveValue('作者改过的主角');
    const adjustment = screen.getByLabelText('给主编的开书资料调整意见（可选）');
    expect(adjustment).toHaveAttribute('data-max-chars', '2000');
    expect(adjustment).toHaveValue(longAdjustmentNote);
    expect(screen.getByRole('button', { name: '请主编按选择更新资料' })).toBeEnabled();
    expect(localStorage.getItem(AI_DRAFT_KEY)).toContain('planner-kimi-k3');
  });

  it('shows the real account in the sidebar and opens the personal center on the same page', async () => {
    installFetch();
    render(<AuthorApp />);

    const accountButton = screen.getByRole('button', { name: /林老师.*个人中心.*作者/ });
    expect(accountButton).toBeVisible();
    expect(screen.queryByText('本地开发')).not.toBeInTheDocument();
    fireEvent.click(accountButton);

    expect(window.location.search).toBe('?view=account');
    const center = screen.getByRole('region', { name: '个人中心' });
    expect(within(center).getByText('lin@example.com')).toBeVisible();
    expect(within(center).getByText('黄金会员')).toBeVisible();
    fireEvent.click(within(center).getByRole('button', { name: '退出登录' }));
    expect(testSession.signOut).toHaveBeenCalledTimes(1);
  });

  it('shows an empty bookshelf only after the book request succeeds with no books', async () => {
    installFetch();
    render(<AuthorApp />);

    expect(screen.getByRole('status')).toHaveTextContent('正在加载书架…');
    expect(screen.queryByText('创建后会显示在这里')).not.toBeInTheDocument();
    expect(await screen.findByText('创建后会显示在这里')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('在当前页面归档并恢复书籍，保留内容且不提供永久删除入口', async () => {
    window.history.replaceState({}, '', '/?view=account&bookId=book-active');
    let activeStatus: 'active' | 'archived' = 'active';
    let oldStatus: 'active' | 'archived' = 'archived';
    const fetchMock = installFetch((url, init) => {
      if (url.endsWith('/api/v1/v7/books')) return response([
        { bookId: 'book-active', title: '正在写的书', status: activeStatus, version: activeStatus === 'active' ? 1 : 2, updatedAt: '2026-08-30T00:00:00Z' },
        { bookId: 'book-old', title: '暂时收起的书', status: oldStatus, version: oldStatus === 'archived' ? 3 : 4, updatedAt: '2026-08-29T00:00:00Z' }
      ]);
      if (url.endsWith('/api/v1/v7/books/book-active/archive') && init?.method === 'POST') {
        activeStatus = 'archived';
        return response({ bookId: 'book-active', title: '正在写的书', status: 'archived', version: 2, updatedAt: '2026-08-30T00:01:00Z' });
      }
      if (url.endsWith('/api/v1/v7/books/book-old/restore') && init?.method === 'POST') {
        oldStatus = 'active';
        return response({ bookId: 'book-old', title: '暂时收起的书', status: 'active', version: 4, updatedAt: '2026-08-30T00:02:00Z' });
      }
      return null;
    });
    render(<AuthorApp />);

    fireEvent.click(await screen.findByRole('button', { name: '归档当前书籍' }));
    expect(screen.getByText('归档后可以随时恢复，正文和资料都会保留。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认归档' }));
    expect(await screen.findByText('已归档 · 2')).toBeVisible();
    expect(screen.queryByText('永久删除')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('已归档 · 2'));
    const oldBookCard = screen.getByText('暂时收起的书').closest('article');
    fireEvent.click(within(oldBookCard!).getByRole('button', { name: '恢复' }));
    await waitFor(() => expect(screen.getByText('已归档 · 1')).toBeVisible());
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/api/v1/v7/books/book-active/archive')
      && JSON.parse(String(init?.body)).expectedVersion === 1)).toBe(true);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/api/v1/v7/books/book-old/restore')
      && JSON.parse(String(init?.body)).expectedVersion === 3)).toBe(true);
  });

  it('keeps the selected book scope on a failed shelf request and retries in place', async () => {
    window.history.replaceState({}, '', '/?view=library&bookId=book-still-there');
    let bookRequests = 0;
    installFetch((url) => {
      if (!url.endsWith('/api/v1/v7/books')) return null;
      bookRequests += 1;
      return bookRequests === 1
        ? response(null, 500)
        : response([{ bookId: 'book-still-there', title: '仍在创作的书', status: 'active', updatedAt: '2026-08-30T00:00:00Z' }]);
    });
    render(<AuthorApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent('抱歉，书架暂时没有加载出来。');
    expect(screen.queryByText('创建后会显示在这里')).not.toBeInTheDocument();
    expect(window.location.search).toBe('?view=library&bookId=book-still-there');

    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(await screen.findByRole('button', { name: /仍在创作的书.*当前书籍/ })).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(bookRequests).toBe(2);
    expect(window.location.search).toBe('?view=library&bookId=book-still-there');
  });

  it('returns home and clears the whole book scope only after a successful list confirms the URL book was deleted', async () => {
    window.history.replaceState({}, '', '/?view=library&bookId=deleted-book&volumeId=volume-2&chainId=chain-5&chapter=17');
    installFetch((url) => url.endsWith('/api/v1/v7/books') ? response([
      { bookId: 'another-book', title: '另一部作品', status: 'active', updatedAt: '2026-08-30T00:00:00Z' }
    ]) : null);
    render(<AuthorApp />);

    expect(await screen.findByRole('heading', { name: '今天，想创作什么？' })).toBeVisible();
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('');
    expect(screen.getByRole('button', { name: '信息' })).toBeDisabled();
  });

  it('uses the retained cover strategy for V7 books without reading the old bookshelf', async () => {
    installFetch((url) => url.endsWith('/api/v1/v7/books') ? response([
      { bookId: 'v7-book-shelf-1', title: '穿越三国从边军小卒开始问鼎天下第一', status: 'active', updatedAt: '2026-08-25T00:00:00Z' }
    ]) : null);
    render(<AuthorApp />);
    const book = await screen.findByRole('button', { name: /穿越三国从边军小卒开始问鼎天下第一.*创作中/ });
    expect(book.querySelector('.book-rail-cover')).not.toBeNull();
    expect(book.querySelector('.book-cover-title')).toHaveTextContent('…');
    expect(book.querySelector('.book-cover-status')).toHaveTextContent('创作中');
  });

  it('enables the time machine for a selected V7 book and opens its honest framework state', async () => {
    window.history.replaceState({}, '', '/?view=time-machine&bookId=v7-book-tree-1');
    installFetch((url) => url.endsWith('/api/v1/v7/books') ? response([
      { bookId: 'v7-book-tree-1', title: '汉末小卒', status: 'active', updatedAt: '2026-08-26T00:00:00Z' }
    ]) : null);
    render(<AuthorApp />);
    expect(screen.getByRole('button', { name: '时光机' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '时光机' })).toHaveClass('active');
    expect(await screen.findByRole('heading', { name: '先准备全书方向' })).toBeVisible();
    expect(screen.getByRole('button', { name: '开始规划全书' })).toBeEnabled();
    expect(screen.queryByText('v7-book-tree-1')).not.toBeInTheDocument();
  });

  it('opens the retained two-step form directly without repeating the opening idea', async () => {
    let bookCreated = false;
    installFetch((url, init) => {
      if (url.endsWith('/api/v1/v7/opening-books') && init?.method === 'POST') {
        bookCreated = true;
        return response({ bookId: 'v7-book-manual-0001', title: '八方姻缘', status: 'active', nextView: 'information' });
      }
      if (url.endsWith('/api/v1/v7/books')) return response(bookCreated
        ? [{ bookId: 'v7-book-manual-0001', title: '八方姻缘', status: 'active', updatedAt: '2026-08-30T00:00:00Z' }]
        : []);
      if (url.endsWith('/api/v1/v7/books/v7-book-manual-0001/book-profile')) return response({
        title: '八方姻缘', channel: '男频', category: '历史脑洞', subjects: [], mainTags: [], protagonists: [{ name: '张三', age: '青年', personalities: ['谨慎'] }],
        storyDirection: '', openingStart: '', storyEnding: '', openingBlueprint: { worldBackground: '', openingBackground: '' }
      });
      return null;
    });
    window.history.replaceState({}, '', '/?view=new-novel&entry=manual');
    render(<AuthorApp />);
    expect(screen.getByLabelText('自己设计开书资料')).toBeVisible();
    expect(screen.queryByRole('heading', { name: '创建一本新书' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('开书想法')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /团队设计/ })).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/v7/opening-taxonomy', expect.objectContaining({ credentials: 'include' })));
    expect(screen.getAllByText('未填写', { selector: '.opening-field-disclosure summary small' }).some((item) => item.offsetParent !== null || item.closest('details') !== null)).toBe(true);
    fireEvent.click(screen.getByText('书名', { selector: '.opening-field-disclosure summary strong' }));
    fireEvent.change(screen.getByLabelText(/书名/), { target: { value: '八方姻缘' } });
    fireEvent.click(screen.getByText('作品分类', { selector: '.opening-field-disclosure summary strong' }));
    fireEvent.click(await screen.findByRole('button', { name: /历史脑洞/ }));
    fireEvent.click(screen.getByText('本书标签', { selector: '.opening-field-disclosure summary strong' }));
    fireEvent.click(screen.getByRole('button', { name: '从标签库添加' }));
    fireEvent.change(screen.getByLabelText('搜索标签'), { target: { value: '群像' } });
    expect(screen.getByText('找到 1 个标签')).toBeVisible();
    expect(screen.getAllByRole('button', { name: '群像' }).some((item) => item.closest('.manual-tag-library') !== null)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    expect(screen.getByLabelText('搜索标签')).toHaveValue('');
    fireEvent.click(screen.getByText('预计总字数', { selector: '.opening-field-disclosure summary strong' }));
    fireEvent.click(screen.getByRole('button', { name: '150万字' }));
    expect(screen.queryByText('建议卷数', { selector: '.opening-field-disclosure summary strong' })).not.toBeInTheDocument();
    expect(screen.queryByText('商业受众', { selector: '.opening-field-disclosure summary strong' })).not.toBeInTheDocument();
    expect(screen.queryByText('追读定位', { selector: '.opening-field-disclosure summary strong' })).not.toBeInTheDocument();
    const next = screen.getByRole('button', { name: '下一步' });
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    fireEvent.click(screen.getByText('必须遵守', { selector: '.opening-field-disclosure summary strong' }));
    fireEvent.click(screen.getByText('内容边界'));
    expect(screen.getByRole('button', { name: '不要后宫' })).toBeVisible();
    expect(screen.getByRole('button', { name: '不要系统' })).toBeVisible();
    expect(screen.getByRole('button', { name: '不要金手指' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '无额外限制' }));
    fireEvent.click(screen.getByText('姓名', { selector: '.opening-field-disclosure summary strong' }));
    const roleName = screen.getByLabelText('角色1姓名');
    expect(screen.getByRole('button', { name: '取名助手' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取名助手' }));
    expect(screen.getByRole('dialog', { name: '角色取名助手' })).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: /填入名字/ })[0]!);
    expect(roleName).not.toHaveValue('');
    expect(screen.queryByRole('dialog', { name: '角色取名助手' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('角色1姓名'), { target: { value: '张三' } });
    fireEvent.click(screen.getByText('年龄', { selector: '.opening-field-disclosure summary strong' }));
    fireEvent.change(screen.getByLabelText('角色1年龄'), { target: { value: '青年' } });
    fireEvent.click(screen.getByText('角色背景', { selector: '.opening-field-disclosure summary strong' }));
    fireEvent.change(screen.getByLabelText(/角色背景/), { target: { value: '寒门出身，家人在战乱中失散。' } });
    const visualDetails = (await screen.findByText('外貌与形象（选填）')).closest('details');
    expect(visualDetails).not.toHaveAttribute('open');
    fireEvent.click(visualDetails!.querySelector('summary')!);
    const appearanceDetails = screen.getByText('外貌', { selector: 'strong' }).closest('details')!;
    fireEvent.click(appearanceDetails.querySelector('summary')!);
    const appearance = within(appearanceDetails);
    fireEvent.change(appearance.getByLabelText('搜索外貌标签'), { target: { value: '剑眉' } });
    expect(appearance.getByText('找到 1 个标签')).toBeVisible();
    fireEvent.click(appearance.getByRole('button', { name: '剑眉' }));
    fireEvent.change(appearance.getByLabelText('外貌自定义特征'), { target: { value: '银色睫毛' } });
    fireEvent.click(appearance.getByRole('button', { name: '添加' }));
    expect(appearance.getByRole('button', { name: '银色睫毛 ×' })).toBeVisible();
    fireEvent.click(screen.getByText('角色性格', { selector: '.opening-field-disclosure summary strong' }));
    fireEvent.click(screen.getByRole('button', { name: '谨慎' }));
    expect(screen.getByLabelText(/时代背景/)).toHaveAttribute('data-max-chars', '800');
    const confirm = screen.getByRole('button', { name: '确认开书资料，创建书籍' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(await screen.findByText('作者已确认')).toBeVisible();
  });

  it('keeps the AI entry to one 2000-character idea before team design', async () => {
    installFetch();
    window.history.replaceState({}, '', '/?view=new-novel&entry=ai');
    render(<AuthorApp />);
    expect(await screen.findByLabelText('填写开书想法')).toBeVisible();
    expect(screen.queryByRole('heading', { name: '创建一本新书' })).not.toBeInTheDocument();
    const input = screen.getByLabelText('说说您想写什么');
    expect(input).toHaveAttribute('data-max-chars', '2000');
    expect(screen.getByRole('button', { name: '开始设计' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '张三穿越三国，从流民开始求生。' } });
    expect(screen.getByRole('button', { name: '开始设计' })).toBeEnabled();
  });

  it('lets the author choose one strong opening designer and sends the selection with the task', async () => {
    const working = {
      ...COMPLETE_TASK,
      status: 'working', phase: 'package_design', isRunning: true, candidates: [],
      phaseText: '设计成员正在整理开书资料', statusText: '开书资料正在设计'
    } satisfies OpeningTaskView;
    const fetchMock = installFetch((url, init) => {
      if (url.endsWith('/api/v1/v7/editorial-department')) return response({
        summary: { memberCount: 3, readyCount: 3, workingCount: 0, leaveCount: 0, completedCount: 0 },
        departments: [{ departmentKey: 'planning_writer', name: '策划编剧组', members: [
          { memberKey: 'planner-deepseek-v4-pro', displayName: '红玉', role: '策划编剧', responsibility: '设计开书资料', capabilities: ['开书设计'], presence: 'ready', statusText: '当前空闲，可以接单。', currentWork: null, completedCount: 0 },
          { memberKey: 'planner-glm-5-3', displayName: '幼薇', role: '策划编剧', responsibility: '设计开书资料', capabilities: ['开书设计'], presence: 'ready', statusText: '当前空闲，可以接单。', currentWork: null, completedCount: 0 },
          { memberKey: 'planner-kimi-k3', displayName: '苏映棠', role: '策划编剧', responsibility: '设计开书资料', capabilities: ['开书设计'], presence: 'ready', statusText: '当前空闲，可以接单。', currentWork: null, completedCount: 0 }
        ] }]
      });
      if (url.endsWith('/api/v1/v7/opening-agent/tasks') && init?.method === 'POST') return response(working);
      if (url.endsWith(`/api/v1/v7/opening-agent/tasks/${working.taskId}`)) return response(working);
      return null;
    });
    window.history.replaceState({}, '', '/?view=new-novel&entry=ai');
    render(<AuthorApp />);

    fireEvent.click(await screen.findByText('选择开书设计成员（可不选）'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'planner-kimi-k3' } });
    fireEvent.change(screen.getByLabelText('说说您想写什么'), { target: { value: '张三穿越三国，从流民开始求生。' } });
    fireEvent.click(screen.getByRole('button', { name: '开始设计' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => {
      if (!String(input).endsWith('/api/v1/v7/opening-agent/tasks') || (init as RequestInit | undefined)?.method !== 'POST') return false;
      const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return body.selectedScreenwriterMemberKey === 'planner-kimi-k3';
    })).toBe(true));
  });

  it('hides deferred opening fields and translates chief review field paths', async () => {
    localStorage.setItem(AI_DRAFT_KEY, JSON.stringify({ idea: '张三穿越三国，从流民开始求生。', taskId: COMPLETE_TASK.taskId, mode: 'ai' }));
    installFetch((url) => url.endsWith(`/api/v1/v7/opening-agent/tasks/${COMPLETE_TASK.taskId}`) ? response(COMPLETE_TASK) : null);
    window.history.replaceState({}, '', '/?view=new-novel&entry=ai');
    render(<AuthorApp />);
    expect(await screen.findByLabelText('确认开书资料')).toBeVisible();
    expect(screen.getByRole('button', { name: /1\s*写什么题材/ })).toBeVisible();
    expect(screen.getByLabelText('书名')).not.toBeVisible();
    const titleDisclosure = screen.getByText('书名', { selector: '.opening-field-disclosure summary strong' }).closest('details')!;
    expect(within(titleDisclosure).getByText(PACKAGE.title)).toBeVisible();
    fireEvent.click(titleDisclosure.querySelector('summary')!);
    expect(screen.getByLabelText('书名')).toBeVisible();
    const reviewDetails = screen.getByText('资料已经审查通过').closest('details');
    expect(reviewDetails).not.toHaveAttribute('open');
    expect(screen.queryByLabelText('当前困境')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('开局处境')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('触发事件')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    const visualDetails = (await screen.findByText('外貌与形象（选填）')).closest('details');
    expect(visualDetails).not.toHaveAttribute('open');
    fireEvent.click(visualDetails!.querySelector('summary')!);
    fireEvent.click(screen.getByText('外貌', { selector: 'strong' }).closest('summary')!);
    expect(screen.getByRole('button', { name: '五官硬朗 ×' })).toBeVisible();
    fireEvent.click(screen.getByText('身形', { selector: 'strong' }).closest('summary')!);
    expect(screen.getByRole('button', { name: '精壮 ×' })).toBeVisible();
    expect(reviewFieldLabel('possibleEnding.price')).toBe('结局方向');
    expect(reviewFieldLabel('authorNotes.大小乘收服')).toBe('作者补充');
    expect(authorFacingReviewText('请检查 opening.immediateConflict 和 possibleEnding.price')).toBe('请检查 后续开局资料 和 结局方向');
  });

  it('submits structured chief decisions without copying them into a free-form note', async () => {
    const decisionTask: OpeningTaskView = {
      ...COMPLETE_TASK,
      status: 'awaiting_author_decision',
      needsAuthorDecision: true,
      candidates: [
        COMPLETE_TASK.candidates[0]!,
        {
          candidateId: 'candidate-review-decision-0001',
          kind: 'opening_review',
          version: 1,
          content: {
            verdict: 'author_decision',
            summary: '有一项方向需要您决定。',
            issues: [],
            requiredChanges: [],
            authorDecisions: [],
            decisions: [{
              decisionId: 'decision-1',
              field: 'possibleEnding.direction',
              question: '张三最后要不要称帝？',
              currentValue: PACKAGE.possibleEnding.direction,
              recommendation: '张三最终建立新朝并称帝。',
              reason: '这与统一全国的开书想法更一致。',
              impact: '会明确全书的终点，但不会提前锁死每一卷剧情。',
              required: true
            }]
          },
          createdBy: { memberKey: 'chief-kimi', displayName: '总编·月衡' },
          sourceCandidateIds: ['candidate-package-0001']
        }
      ]
    };
    let revisionBody: Record<string, unknown> | null = null;
    localStorage.setItem(AI_DRAFT_KEY, JSON.stringify({ idea: decisionTask.idea, taskId: decisionTask.taskId, mode: 'ai' }));
    localStorage.setItem(
      `wenmi-v7-opening-decisions-v2:another-author:${decisionTask.taskId}:candidate-review-decision-0001`,
      JSON.stringify({ 'decision-1': { decisionId: 'decision-1', action: 'reject' } })
    );
    installFetch((url, init) => {
      if (url.endsWith(`/api/v1/v7/opening-agent/tasks/${decisionTask.taskId}`)) return response(decisionTask);
      if (url.endsWith(`/api/v1/v7/opening-agent/tasks/${decisionTask.taskId}/revisions`) && init?.method === 'POST') {
        revisionBody = JSON.parse(String(init.body));
        return response({ ...decisionTask, status: 'working', phase: 'package_revision', isRunning: true, phaseText: '主编正在按您的选择更新开书资料' });
      }
      return null;
    });
    window.history.replaceState({}, '', '/?view=new-novel&entry=ai');
    render(<AuthorApp />);
    expect(await screen.findByText('张三最后要不要称帝？')).toBeVisible();
    expect(screen.getByText('结局方向')).toBeVisible();
    expect(screen.queryByText('possibleEnding.direction')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '采纳建议' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '采纳建议' }));
    expect(screen.getByRole('button', { name: '已采纳' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('已选择采纳，尚未提交给主编。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '暂不采纳' }));
    expect(screen.getByRole('button', { name: '已暂不采纳' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '修改后采纳' }));
    expect(screen.getByRole('button', { name: '正在修改后采纳' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByPlaceholderText('只写这一项希望怎样调整')).toBeVisible();
    expect(screen.getByRole('button', { name: '请填写修改方案' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('只写这一项希望怎样调整'), { target: { value: '先保留辅政身份。' } });
    expect(screen.getByText('您的修改方案已保存，尚未提交给主编。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '采纳全部建议' }));
    expect(screen.getByRole('button', { name: '已采纳全部（1）' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('已处理 1/1 项')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '请主编按选择更新资料' }));
    await waitFor(() => expect(revisionBody).not.toBeNull());
    expect(revisionBody).toMatchObject({
      decisionResolutions: [{ decisionId: 'decision-1', action: 'accept' }],
      adjustmentNote: ''
    });
    expect(localStorage.getItem(decisionKey(decisionTask.taskId, 'candidate-review-decision-0001'))).toContain('decision-1');
  });

  it('silently clears a missing saved task while preserving the opening idea', async () => {
    localStorage.setItem(AI_DRAFT_KEY, JSON.stringify({ idea: '一个男人有八个老婆。', taskId: 'missing-task-0001', mode: 'ai' }));
    installFetch((url) => url.endsWith('/api/v1/v7/opening-agent/tasks/missing-task-0001') ? response(null, 404) : null);
    window.history.replaceState({}, '', '/?view=new-novel&entry=ai');
    render(<AuthorApp />);
    expect(await screen.findByLabelText('说说您想写什么')).toHaveValue('一个男人有八个老婆。');
    expect(screen.queryByText(/上次任务已不存在/)).not.toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(AI_DRAFT_KEY)).not.toContain('missing-task-0001'));
  });

  it('shows truthful team stages and persists the task for refresh recovery', async () => {
    const working: OpeningTaskView = { ...COMPLETE_TASK, status: 'working', phase: 'package_design', statusText: 'AI团队正在设计', phaseText: '编剧正在设计开书资料包', isRunning: true, candidates: [] };
    const projectedWorking = {
      ...working,
      taskId: undefined,
      recoveryKey: working.taskId,
      errorMessage: undefined,
      recoveryMessage: null
    };
    installFetch((url, init) => {
      if (url.endsWith('/api/v1/v7/opening-agent/tasks') && init?.method === 'POST') return response(projectedWorking);
      if (url.endsWith('/api/v1/v7/opening-agent/tasks/task-opening-0001')) return response(projectedWorking);
      return null;
    });
    window.history.replaceState({}, '', '/?view=new-novel&entry=ai');
    render(<AuthorApp />);
    fireEvent.change(await screen.findByLabelText('说说您想写什么'), { target: { value: '张三穿越三国，从流民开始求生。' } });
    fireEvent.click(screen.getByRole('button', { name: '开始设计' }));
    expect(await screen.findByLabelText('编辑部工作进度')).toBeVisible();
    expect(screen.getByText('编剧正在设计开书资料包')).toBeVisible();
    expect(screen.getByText('直接设计')).toBeVisible();
    expect(screen.getByText('审查点评')).toBeVisible();
    expect(screen.queryByText('主编理解')).not.toBeInTheDocument();
    expect(screen.queryByText('编剧设计')).not.toBeInTheDocument();
    expect(screen.queryByText('主编审查')).not.toBeInTheDocument();
    expect(localStorage.getItem(AI_DRAFT_KEY)).toContain('task-opening-0001');
  });

  it('历史未完成开书任务只显示当前流程的失败恢复', async () => {
    const retiredTask = {
      ...COMPLETE_TASK,
      status: 'working', phase: 'retired_phase', isRunning: true,
      workflowStyle: 'retired_workflow',
      candidates: [{
        candidateId: 'retired-candidate-1', kind: 'retired_candidate', version: 1, content: {},
        createdBy: { memberKey: 'retired-member', displayName: '历史成员' }, sourceCandidateIds: []
      }]
    };
    localStorage.setItem(AI_DRAFT_KEY, JSON.stringify({ idea: retiredTask.idea, taskId: retiredTask.taskId, mode: 'ai' }));
    installFetch((url) => url.endsWith(`/api/v1/v7/opening-agent/tasks/${retiredTask.taskId}`)
      ? response(retiredTask)
      : null);
    window.history.replaceState({}, '', '/?view=new-novel&entry=ai');

    render(<AuthorApp />);

    expect(await screen.findByText('对不起，这项未完成任务已经停止，请按当前流程重新开始。')).toBeVisible();
    expect(screen.getByRole('button', { name: '按当前流程重新开始' })).toBeVisible();
    expect(screen.queryByLabelText('编辑部工作进度')).not.toBeInTheDocument();
    expect(screen.queryByText('主编理解')).not.toBeInTheDocument();
  });

  it('recovers a reviewed package, confirms it once, and opens the persisted information page', async () => {
    localStorage.setItem(AI_DRAFT_KEY, JSON.stringify({ idea: '张三穿越三国，从流民开始求生。', taskId: COMPLETE_TASK.taskId, mode: 'ai' }));
    let bookCreated = false;
    installFetch((url, init) => {
      if (url.endsWith(`/api/v1/v7/opening-agent/tasks/${COMPLETE_TASK.taskId}`)) return response(COMPLETE_TASK);
      if (url.endsWith('/api/v1/v7/opening-books') && init?.method === 'POST') {
        bookCreated = true;
        return response({ bookId: 'v7-book-0001', title: PACKAGE.title, status: 'active', nextView: 'information' });
      }
      if (url.endsWith('/api/v1/v7/books')) return response(bookCreated
        ? [{ bookId: 'v7-book-0001', title: PACKAGE.title, status: 'active', updatedAt: '2026-08-30T00:00:00Z' }]
        : []);
      if (url.endsWith('/api/v1/v7/books/v7-book-0001/book-profile')) return response({
        title: PACKAGE.title, channel: '男频', category: '历史脑洞', subjects: ['秦汉三国', '穿越'], mainTags: PACKAGE.positioning.tags,
        protagonists: [{ name: '张三', age: '20岁', familyBackground: PACKAGE.protagonists[0]!.background, careerBackground: PACKAGE.protagonists[0]!.identity, personalities: PACKAGE.protagonists[0]!.personality }],
        storyDirection: PACKAGE.longTermDirection.centralConflict, openingStart: PACKAGE.opening.startingSituation,
        storyEnding: PACKAGE.possibleEnding.direction, openingBlueprint: { worldBackground: PACKAGE.backgrounds.eraAndWorld, openingBackground: PACKAGE.backgrounds.openingSituation }
      });
      return null;
    });
    window.history.replaceState({}, '', '/?view=new-novel&entry=ai');
    render(<AuthorApp />);
    expect(await screen.findByText('资料已经审查通过')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    const confirm = screen.getByRole('button', { name: '确认开书资料，创建书籍' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(await screen.findByText('作者已确认')).toBeVisible();
    expect(screen.getByRole('heading', { name: PACKAGE.title })).toBeVisible();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    fireEvent.click(screen.getByRole('button', { name: '取名助手' }));
    expect(screen.getByRole('heading', { name: '取名助手' })).toBeVisible();
    for (const group of ['人物', '地点', '势力', '物品', '生灵', '能力']) {
      expect(screen.getByRole('tab', { name: group })).toBeVisible();
    }
    fireEvent.change(screen.getByLabelText('字数或题材语感（可选）'), { target: { value: '两个字' } });
    const copyButton = screen.getAllByRole('button', { name: /复制名字/ })[0]!;
    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(window.location.search).toBe('?view=information&bookId=v7-book-0001');
    expect(localStorage.getItem(AI_DRAFT_KEY)).toBeNull();
  });

  it('offers the same visible naming assistant while editing an AI-designed protagonist', async () => {
    localStorage.setItem(AI_DRAFT_KEY, JSON.stringify({ idea: '张三穿越三国，从流民开始求生。', taskId: COMPLETE_TASK.taskId, mode: 'ai' }));
    installFetch((url) => url.endsWith(`/api/v1/v7/opening-agent/tasks/${COMPLETE_TASK.taskId}`) ? response(COMPLETE_TASK) : null);
    window.history.replaceState({}, '', '/?view=new-novel&entry=ai');
    render(<AuthorApp />);
    expect(await screen.findByText('资料已经审查通过')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    const nameField = await screen.findByLabelText(/姓名/);
    const originalName = (nameField as HTMLInputElement).value;
    fireEvent.click(screen.getByRole('button', { name: '取名助手' }));
    expect(screen.getByRole('dialog', { name: '角色取名助手' })).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: /填入名字/ })[0]!);
    expect(nameField).not.toHaveValue(originalName);
    expect(screen.queryByRole('dialog', { name: '角色取名助手' })).not.toBeInTheDocument();
  });

  it('requires chief re-review after the author edits an AI candidate', async () => {
    localStorage.setItem(AI_DRAFT_KEY, JSON.stringify({ idea: '张三穿越三国，从流民开始求生。', taskId: COMPLETE_TASK.taskId, mode: 'ai' }));
    installFetch((url, init) => {
      if (url.endsWith(`/api/v1/v7/opening-agent/tasks/${COMPLETE_TASK.taskId}`)) return response(COMPLETE_TASK);
      if (url.endsWith(`/api/v1/v7/opening-agent/tasks/${COMPLETE_TASK.taskId}/revisions`) && init?.method === 'POST') return response({ ...COMPLETE_TASK, status: 'working', phase: 'package_revision', isRunning: true, phaseText: '编剧正在按意见重新设计开书资料' });
      return null;
    });
    window.history.replaceState({}, '', '/?view=new-novel&entry=ai');
    render(<AuthorApp />);
    const title = await screen.findByLabelText(/书名/);
    fireEvent.change(title, { target: { value: '三国小卒新篇' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.queryByRole('button', { name: '确认开书资料，创建书籍' })).not.toBeInTheDocument();
    const reviewButton = screen.getByRole('button', { name: '请主编按选择更新资料' });
    expect(reviewButton).toBeEnabled();
    fireEvent.click(reviewButton);
    expect(await screen.findByLabelText('编辑部工作进度')).toBeVisible();
    expect(screen.getByText('编剧正在按意见重新设计开书资料')).toBeVisible();
  });

  it('submits only one replacement task when a failed task retry is clicked repeatedly', async () => {
    const failed: OpeningTaskView = {
      ...COMPLETE_TASK,
      status: 'failed', phase: 'package_design', isRunning: false,
      candidates: [], errorMessage: '资料包结构未通过校验。'
    };
    localStorage.setItem(AI_DRAFT_KEY, JSON.stringify({
      idea: '张三穿越三国，从流民开始求生。', taskId: failed.taskId, mode: 'ai'
    }));
    const pending = new Promise<Response>(() => undefined);
    const fetchMock = installFetch((url, init) => {
      if (url.endsWith(`/api/v1/v7/opening-agent/tasks/${failed.taskId}`)) return response(failed);
      if (url.endsWith('/api/v1/v7/opening-agent/tasks') && init?.method === 'POST') return pending;
      return null;
    });
    window.history.replaceState({}, '', '/?view=new-novel&entry=ai');
    render(<AuthorApp />);
    const retry = await screen.findByRole('button', { name: '重新交给创作团队' });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => (
      String(url).endsWith('/api/v1/v7/opening-agent/tasks') && (init as RequestInit | undefined)?.method === 'POST'
    ))).toHaveLength(1));
    expect(screen.getByRole('button', { name: '正在重新提交…' })).toBeDisabled();
  });

  it('stops polling an outcome-unknown task and offers an explicit new-task retry', async () => {
    const interrupted: OpeningTaskView = {
      ...COMPLETE_TASK,
      status: 'interrupted', phase: 'package_design', isRunning: false,
      candidates: [], errorMessage: '模型结果仍未知，已保留检查点等待调和。'
    };
    localStorage.setItem(AI_DRAFT_KEY, JSON.stringify({
      idea: '张三穿越三国，从流民开始求生。', taskId: interrupted.taskId, mode: 'ai'
    }));
    const fetchMock = installFetch((url) => (
      url.endsWith(`/api/v1/v7/opening-agent/tasks/${interrupted.taskId}`) ? response(interrupted) : null
    ));
    window.history.replaceState({}, '', '/?view=new-novel&entry=ai');
    render(<AuthorApp />);
    expect(await screen.findByText('本轮连接结果未知')).toBeVisible();
    expect(screen.getByRole('button', { name: '重新交给创作团队' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '重新填写想法' })).toBeEnabled();
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes(`/tasks/${interrupted.taskId}`))).toHaveLength(1);
  });

  it('maps only the independent V7 local routes', () => {
    expect(authorViewFromSearch('?view=new-novel')).toBe('new-novel');
    expect(authorViewFromSearch('?view=information&bookId=book-1')).toBe('information');
    expect(authorViewFromSearch('?stage=setting')).toBe('home');
    expect(authorViewFromSearch('?view=tasks')).toBe('tasks');
    expect(authorViewFromSearch('?view=team')).toBe('team');
    expect(authorViewFromSearch('?view=account')).toBe('account');
    expect(bookIdFromSearch('?view=information&bookId=book-1')).toBe('book-1');
    expect(searchForAuthorView('new-novel')).toBe('?view=new-novel');
    expect(searchForAuthorView('information', 'book-1')).toBe('?view=information&bookId=book-1');
    expect(searchForAuthorView('account', 'book-1')).toBe('?view=account&bookId=book-1');
    expect(preserveCreationScopeInSearch(
      '?view=volume&bookId=book-1&volumeId=volume-2&chainId=chain-5&chapter=17',
      '?view=account&bookId=book-1'
    )).toBe('?view=account&bookId=book-1&volumeId=volume-2&chainId=chain-5&chapter=17');
    expect(preserveCreationScopeInSearch(
      '?view=account&bookId=book-1&volumeId=volume-2&chainId=chain-5&chapter=17',
      '?view=chapter&bookId=book-1'
    )).toBe('?view=chapter&bookId=book-1&volumeId=volume-2&chainId=chain-5&chapter=17');
    expect(searchForAuthorView('home')).toBe('/');
  });

  it('链页打开历史章节时由父级一次写入章节范围再切到章页', async () => {
    installFetch((url) => url.endsWith('/api/v1/v7/books') ? response([
      { bookId: 'book-1', title: '历史测试书', status: 'active', updatedAt: '2026-08-30T00:00:00Z' }
    ]) : null);
    window.history.replaceState({}, '', '/?view=chain&bookId=book-1&volumeId=volume-1&chainId=chain-2');
    render(<AuthorApp />);

    fireEvent.click(await screen.findByRole('button', { name: '查看历史第9章' }));

    expect(window.location.search).toBe('?view=chapter&bookId=book-1&volumeId=volume-1&chainId=chain-2&chapter=9');
  });

  it('returns an expired running session to the V7 sign-in boundary without an old-version link', async () => {
    installFetch((url, init) => {
      if (url.endsWith('/api/v1/v7/opening-agent/tasks') && init?.method === 'POST') {
        return response(null, 401);
      }
      return null;
    });
    window.history.replaceState({}, '', '/?view=new-novel&entry=ai');
    render(<AuthorApp />);

    fireEvent.change(await screen.findByLabelText('说说您想写什么'), { target: { value: '张三穿越三国，从小卒开始求生。' } });
    fireEvent.click(screen.getByRole('button', { name: '开始设计' }));

    await waitFor(() => expect(testSession.requireSignIn).toHaveBeenCalledTimes(1));
    expect(document.body.textContent).not.toContain('打开登录页面');
    expect(document.body.textContent).not.toContain('43110');
  });

  it('recovers the newest account task even when the local task number is missing', async () => {
    const working: OpeningTaskView = {
      ...COMPLETE_TASK,
      status: 'working', phase: 'package_design', isRunning: true, candidates: [],
      phaseText: '编剧正在设计开书资料包', progress: { currentStep: 2, totalSteps: 3, percent: 50 }
    };
    installFetch((url) => {
      if (url.endsWith('/api/v1/v7/opening-agent/tasks?limit=50')) return response([working]);
      if (url.endsWith(`/api/v1/v7/opening-agent/tasks/${working.taskId}`)) return response(working);
      return null;
    });
    window.history.replaceState({}, '', '/?view=new-novel&entry=ai');
    render(<AuthorApp />);
    expect(await screen.findByLabelText('编辑部工作进度')).toBeVisible();
    fireEvent.click(screen.getByText('看看本轮开书想法'));
    expect(screen.getByText(working.idea)).toBeVisible();
    expect(localStorage.getItem(AI_DRAFT_KEY)).toContain(working.taskId);
  });

  it('opens a real task log and returns to the selected task', async () => {
    installFetch((url) => {
      if (url.endsWith('/api/v1/v7/opening-agent/tasks?limit=50')) return response([COMPLETE_TASK]);
      if (url.endsWith(`/api/v1/v7/opening-agent/tasks/${COMPLETE_TASK.taskId}`)) return response(COMPLETE_TASK);
      return null;
    });
    render(<AuthorApp />);
    fireEvent.click(screen.getByRole('button', { name: '任务' }));
    expect(await screen.findByText('进行中与待确认')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '查看进度' }));
    expect(await screen.findByLabelText('确认开书资料')).toBeVisible();
    expect(screen.getByText('资料已经审查通过')).toBeVisible();
    expect(window.location.search).toContain(`taskId=${COMPLETE_TASK.taskId}`);
  });

  it('shows saved title and cover work in the account task log', async () => {
    installFetch((url) => {
      if (url.endsWith('/api/v1/v7/design-tasks?limit=50')) return response([
        { taskId: 'cover-design-1', taskKind: 'cover_design', bookId: 'book-design-1', bookTitle: '边军起势', status: 'working', statusText: '主编和封面画师正在制作封面。', memberNames: ['貂蝉', '绘真'], createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:01Z' },
        { taskId: 'title-design-1', taskKind: 'title_design', bookId: 'book-design-1', bookTitle: '边军起势', status: 'failed', statusText: '这轮书名设计没有完成，工作记录已经保留。', memberNames: ['貂蝉'], createdAt: '2026-08-24T00:00:00Z', updatedAt: '2026-08-24T00:00:01Z' }
      ]);
      return null;
    });
    render(<AuthorApp />);
    fireEvent.click(screen.getByRole('button', { name: '任务' }));
    expect(await screen.findByText('书名与封面制作中')).toBeVisible();
    expect(screen.getByText('书名与封面历史')).toBeVisible();
    expect(screen.getByText('主编和视觉编剧正在制作封面。')).toBeVisible();
    expect(screen.getByText('这轮书名设计没有完成，工作记录已经保留。')).toBeVisible();
    expect(screen.getAllByText('边军起势')).toHaveLength(2);
  });

  it('keeps successful task categories visible when one task source is temporarily unavailable', async () => {
    installFetch((url) => {
      if (url.endsWith('/api/v1/v7/opening-agent/tasks?limit=50')) return response(null, 500);
      if (url.endsWith('/api/v1/v7/design-tasks?limit=50')) return response([
        { taskId: 'cover-partial-1', taskKind: 'cover_design', bookId: 'book-partial-1', bookTitle: '乱世问鼎', status: 'working', statusText: '封面正在制作。', memberNames: ['绘真'], createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:01Z' }
      ]);
      return null;
    });
    render(<AuthorApp />);
    fireEvent.click(screen.getByRole('button', { name: '任务' }));
    expect(await screen.findByText('部分工作记录暂时没有加载出来，编辑部会自动重试。')).toBeVisible();
    expect(screen.getByText('乱世问鼎')).toBeVisible();
    expect(screen.getByText('部分工作记录正在重新整理')).toBeVisible();
    expect(screen.queryByText('还没有工作记录')).not.toBeInTheDocument();
    expect(screen.queryByText('编辑部当前没有待处理工作')).not.toBeInTheDocument();
  });

  it('archives an unfinished opening task without deleting its history from the server', async () => {
    installFetch((url, init) => {
      if (url.endsWith('/api/v1/v7/opening-agent/tasks?limit=50')) return response([COMPLETE_TASK]);
      if (url.endsWith(`/api/v1/v7/opening-agent/tasks/${COMPLETE_TASK.taskId}/abandon`) && init?.method === 'POST') {
        return response({ ...COMPLETE_TASK, status: 'archived', statusText: '这项任务已经放弃' });
      }
      return null;
    });
    render(<AuthorApp />);
    fireEvent.click(screen.getByRole('button', { name: '任务' }));
    expect(await screen.findByRole('button', { name: '放弃任务' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '放弃任务' }));
    expect(screen.getByText('任务会移出列表，历史资料不会永久删除。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认放弃' }));
    expect(await screen.findByText('还没有工作记录')).toBeVisible();
    expect(screen.getByText('编辑部当前没有待处理工作')).toBeVisible();
  });

  it('clears every unbuilt incomplete opening task in one action while preserving created books', async () => {
    const incompleteTask = { ...COMPLETE_TASK, status: 'failed', statusText: '本轮没有完成', errorMessage: '这项任务未完成', candidates: [] };
    const builtTask = { ...COMPLETE_TASK, taskId: 'built-task-0001', idea: '已经建成书籍的任务', resultBookId: 'v7-book-0001' };
    installFetch((url, init) => {
      if (url.endsWith('/api/v1/v7/opening-agent/tasks?limit=50')) return response([incompleteTask, builtTask]);
      if (url.endsWith('/api/v1/v7/opening-agent/tasks/abandon-all') && init?.method === 'POST') {
        return response({ archivedCount: 1, skippedCreatedCount: 1 });
      }
      return null;
    });
    render(<AuthorApp />);
    fireEvent.click(screen.getByRole('button', { name: '任务' }));
    expect(await screen.findByRole('button', { name: '清理未完成任务' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '清理未完成任务' }));
    expect(screen.getByText('只移走尚未建成书籍的未完成任务，书籍与历史方案都会保留。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认清理' }));
    expect(await screen.findByRole('button', { name: '打开书籍' })).toBeVisible();
    expect(screen.queryByText(incompleteTask.idea)).not.toBeInTheDocument();
  });

  it('hides recoverably archived tasks returned by an older local API process', async () => {
    const archivedFromOldApi = {
      ...COMPLETE_TASK,
      status: 'failed',
      isRunning: false,
      errorMessage: null,
      resultBookId: null
    };
    installFetch((url) => url.endsWith('/api/v1/v7/opening-agent/tasks?limit=50')
      ? response([archivedFromOldApi])
      : null);
    render(<AuthorApp />);
    fireEvent.click(screen.getByRole('button', { name: '任务' }));
    expect(await screen.findByText('还没有工作记录')).toBeVisible();
    expect(screen.queryByText(archivedFromOldApi.idea)).not.toBeInTheDocument();
  });

  it('does not hijack a new book with failed or interrupted old tasks', async () => {
    const interrupted = { ...COMPLETE_TASK, status: 'interrupted', isRunning: false, candidates: [] };
    installFetch((url) => url.endsWith('/api/v1/v7/opening-agent/tasks?limit=50') ? response([interrupted]) : null);
    render(<AuthorApp />);
    fireEvent.click(screen.getByRole('button', { name: /团队设计/ }));
    expect(await screen.findByLabelText('说说您想写什么')).toHaveValue('');
    expect(screen.queryByText(interrupted.idea)).not.toBeInTheDocument();
  });

  it('shows the account editorial department without exposing model terms', async () => {
    installFetch((url) => url.endsWith('/api/v1/v7/editorial-department') ? response({
      summary: { memberCount: 3, readyCount: 1, workingCount: 2, leaveCount: 0, completedCount: 7 },
      departments: [
        { departmentKey: 'chief_editor', name: 'internal_chief_department', members: [
          { memberKey: 'chief-doubao-seed-2.0-coding', displayName: '貂蝉', role: 'chief_editor', responsibility: 'model=doubao；prompt=internal', capabilities: ['opening', 'setting', 'route'], presence: 'working', statusText: '我正在处理审查开书资料，完成后会马上交稿。', currentWork: '审查开书资料', completedCount: 3 }
        ] },
        { departmentKey: 'planning_writer', name: 'internal_planning_department', members: [
          { memberKey: 'planner-glm-5.3', displayName: '红玉', role: 'structure_planner', responsibility: 'internal seat', capabilities: ['structure'], presence: 'ready', statusText: '我现在待命，有任务会马上接手。', currentWork: null, completedCount: 1 },
          { memberKey: 'creation-outline-glm-5.3', displayName: '红玉', role: 'outline_writer', responsibility: 'duplicate internal seat', capabilities: ['outline'], presence: 'working', statusText: '错误的重复工位状态', currentWork: null, completedCount: 1 }
        ] }
      ]
    }) : null);
    render(<AuthorApp />);
    fireEvent.click(screen.getByRole('button', { name: '团队' }));
    expect(await screen.findByText('主编室')).toBeVisible();
    expect(screen.getAllByText('审查开书资料')).toHaveLength(1);
    expect(screen.getByText('策划编剧组')).toBeVisible();
    expect(screen.getByText('2', { selector: '.team-overview-strip strong' })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/模型|provider|Coding Plan|Agent Plan|doubao|prompt|internal/u);
    expect(document.body.textContent).not.toMatch(/structure_planner|outline_writer|opening|setting|route/u);
  });
});
