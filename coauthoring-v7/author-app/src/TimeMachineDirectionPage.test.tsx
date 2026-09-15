import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { TimeMachineDirectionEntry } from './TimeMachineDirectionPage';
import { AuthorAccountSessionProvider, type AuthorAccountSession } from './AuthorAccountBoundary';
import type { TimeMachineStateView } from './time-machine-direction-api';

// 真实会话Provider（AuthorAccountBoundary导出）+已验证userId；不再伪造localStorage身份键。
function sessionOf(userId: string): AuthorAccountSession {
  return {
    account: { userId, email: `${userId}@example.com`, displayName: '测试作者', role: 'user', status: 'active' },
    membership: null,
    membershipState: 'ready',
    membershipError: null,
    signingOut: false,
    sessionNotice: null,
    refreshMembership: async () => {},
    signOut: async () => {},
    requireSignIn: () => {}
  };
}
function renderPage(ui: React.ReactElement, userId = 'author-test'): ReturnType<typeof render> {
  return render(<AuthorAccountSessionProvider session={sessionOf(userId)}>{ui}</AuthorAccountSessionProvider>);
}

function response<T>(data: T, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ data, meta: { requestId: 'test', version: 1 } }) } as Response;
}

function planFixture(baseline: string) {
  return {
    baseline,
    ending: '机甲和无灵根的人获得公平生存机会。',
    openingHooks: ['开头约300字：工坊收回倒计时与神秘机甲同场', '第一章：危险订单成立，读者想知道能否完成', '前三章：无灵根者与机甲伙伴的立足之战',] as [string, string, string],
    words: { target: 500000, min: null, max: null, hard: false, policy: 'chars-v1' },
    lines: [
      { id: 'main', role: 'main' as const, title: '工坊主线', goal: '立足', answer: '建立工坊', process: '从修理接单到建立工坊', parentIds: [], milestones: [{ id: 'ms1', summary: '第一台自装机甲', suggestedVolumes: ['v1'], importance: 'flexible' as const }] },
      { id: 'sub', role: 'through' as const, title: '伙伴支线', goal: '信任', answer: '互相信任', process: '从戒备到并肩', parentIds: [], milestones: [] }
    ],
    expectations: [{ id: 'promise', opening: '无灵根能否立足', change: '看到技术与伙伴替代灵根', answer: '以机甲立足', lineIds: ['main'] }],
    relations: [],
    anchors: [
      { id: 'v1-in', ownerEntityId: 'v1', kind: 'entry' as const, summary: '店铺濒临倒闭', span: '本卷开篇', conditions: [{ summary: '订单危机已经成立', subjectIds: ['main'] }], logic: 'all' as const, importance: 'required' as const, fallback: '未达成需修订开场', keywords: [], aliases: [] },
      { id: 'v1-out', ownerEntityId: 'v1', kind: 'exit' as const, summary: '订单交付工坊立足', span: '本卷收束', conditions: [{ summary: '订单交付完成', subjectIds: ['main'] }], logic: 'all' as const, importance: 'required' as const, fallback: '全书结束', keywords: [], aliases: [] }
    ],
    volumes: [
      { id: 'v1', title: '工坊危机', start: '濒临倒闭', goal: '完成订单', conflict: '封锁', beat: '起', turningPoint: '新机甲成功', gain: '伙伴', loss: null, arc: '从修理者到组织者', payoff: null, hook: null, mood: null, ending: '订单交付', handoff: '引出扩张', words: { target: 300000, min: null, max: null, hard: false, policy: 'chars-v1' }, duties: [{ lineId: 'main', action: 'close' as const, result: '工坊成立', anchorIds: ['v1-out'], strength: 'required' as const, reason: '主线起点' }] },
      { id: 'v2', title: '扩张', start: '工坊起步', goal: '打开新市场', conflict: '竞争', beat: '起', turningPoint: '联合取胜', gain: null, loss: null, arc: null, payoff: null, hook: null, mood: null, ending: '新市场立足', handoff: '', words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' }, duties: [{ lineId: 'sub', action: 'advance' as const, result: '信任加深', anchorIds: [], strength: 'flexible' as const, reason: '可后移' }] }
    ]
  };
}

function designResult(memberName: string, baseline: string, pass: boolean) {
  return { candidateId: `cand-${memberName}`, revision: 1, member: { id: `writer-${memberName}`, name: memberName }, plan: planFixture(baseline), review: { pass, issues: pass ? [] : ['v1转折空泛'], suggestions: ['可减少相似损失'] }, selfCheck: { pass: true, issues: [] } };
}

function stateFixture(partial: Partial<TimeMachineStateView> & { runs?: TimeMachineStateView['runs'] }): TimeMachineStateView {
  return { enabled: true, preparation:partial.preparation??{ready:true,message:'已准备',version:'confirmed-v1'},runs: partial.runs ?? [], adopted: partial.adopted ?? null, planRevision: partial.planRevision ?? 0, storylineMaterial: partial.storylineMaterial ?? null };
}

function recommendRun(status: 'working' | 'succeeded' | 'failed', id = 'rec-1') {
  return {
    id, kind: 'recommend' as const, scheme: null, roundKey: null, state: status, updatedAt: '2026-09-11T10:00:00Z',
    member: status === 'working' ? { id: 'chief', name: '貂蝉' } : null, progress: status === 'working' ? '正在推荐故事线' : status === 'failed' ? '未完成' : '已完成',
    result: status === 'succeeded'
      ? { greeting: '老板，我们现在设计全书骨架。', lines: [
          { id: 'growth', role: 'main' as const, title: '成长线', description: '林舟建立工坊', recommended: true },
          { id: 'partner', role: 'through' as const, title: '机甲伙伴线', description: '机甲的自主选择', recommended: false }
        ], structure: 'single' as const, reason: '聚焦修理工成长' }
      : null,
    message: status === 'failed' ? '本期剩余创作额度不足，推荐已暂停。' : null,
    // S1-A：服务端计算的成功推荐哈希与来源版本；页面原样带回。
    recommendationHash: status === 'succeeded' ? 'hash-rec-1' : null,
    preparationVersion: status === 'succeeded' ? 'confirmed-v1' : null
  };
}

function designRun(scheme: 'A' | 'B' | 'C', state: 'working' | 'succeeded' | 'failed', memberName: string, baseline: string, pass = true) {
  return {
    id: `design-${scheme}`, kind: 'design' as const, scheme, roundKey: 'round-1', state, updatedAt: `2026-09-11T10:0${scheme === 'A' ? 1 : scheme === 'B' ? 2 : 3}:00Z`,
    member: state === 'working' ? { id: `writer-${memberName}`, name: memberName } : null,
    // 72c3a62f复核第5项：进行中统一显示"正在工作"，member=实际接手成员（服务端投影合同）
    progress: state === 'working' ? '正在工作' : state === 'succeeded' ? '已完成' : '未完成',
    result: state === 'succeeded' ? designResult(memberName, baseline, pass) : null,
    message: state === 'failed' ? '本次工作尚未完成，已保存的步骤会保留。' : null
  };
}

const legacyRouteRun = {
  runId: 'legacy-run-1', status: 'waiting_for_you', phase: 'waiting_for_you', message: '请选一个方向。',
  progress: { completed: 7, total: 7, percent: 100 }, sourceIssues: [], canDecide: true, errorMessage: null, actors: [],
  routes: [], chiefReview: null
};

// jsdom未实现原生dialog的showModal/close，补最小行为供交互测试。
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };

describe('time machine direction page', () => {
  it('blocks early recommendations until settings are confirmed and consolidated',async()=>{
    const fetcher=vi.fn(async()=>response(stateFixture({preparation:{ready:false,message:'请先完成设定设计',version:null},runs:[recommendRun('succeeded')]})));
    vi.stubGlobal('fetch',fetcher);const open=vi.fn();renderPage(<TimeMachineDirectionEntry bookId="bk-1" onOpenSettings={open}/>);
    expect(await screen.findByText('先完成本书设定')).toBeVisible();
    expect(screen.queryByText('为本书推荐')).not.toBeInTheDocument();
    expect(fetcher.mock.calls).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'返回设定'}));expect(open).toHaveBeenCalledOnce();
  });
  it('welcomes the author, starts recommendation automatically and never starts a design without confirmation', async()=>{
    let recommendations=0,designs=0;let current=stateFixture({runs:[]});
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
      if(String(input).endsWith('/state'))return response(current);
      if(String(input).endsWith('/recommendation-runs')){recommendations++;current=stateFixture({runs:[recommendRun('working')]});return response({id:'rec-1'});}
      if(String(input).endsWith('/design-runs'))designs++;
      throw Error('Unexpected request');
    }));
    renderPage(<TimeMachineDirectionEntry bookId="bk-1"/>);
    expect(await screen.findByText('正在整理本书故事线，请您耐心等待。')).toBeVisible();
    // 72c3a62f复核第5项：已持久化的推荐任务附可离开说明
    expect(screen.getByText(/推荐在后台进行，你可以离开本页/)).toBeVisible();
    await waitFor(()=>expect(recommendations).toBe(1));expect(designs).toBe(0);
  });
  it('adds a custom story and carries author requests into chief recommendations',async()=>{
    let sent='';const state=stateFixture({runs:[recommendRun('succeeded')]});
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      if(String(input).endsWith('/state'))return response(state);
      if(String(input).endsWith('/recommendation-runs')){sent=JSON.parse(String(init?.body)).intent;return response({id:'new'});}
      throw Error('Unexpected request');
    }));
    renderPage(<TimeMachineDirectionEntry bookId="bk-1"/>);
    fireEvent.click(await screen.findByRole('button',{name:'＋ 添加其他故事线'}));
    fireEvent.change(screen.getByLabelText('故事线名称'),{target:{value:'重建家园'}});
    fireEvent.change(screen.getByLabelText('想写怎样的故事'),{target:{value:'林舟与伙伴让流民有家可归'}});
    fireEvent.click(screen.getByRole('button',{name:'加入故事线'}));
    expect(screen.getByText('已选 2 条故事线')).toBeVisible();
    fireEvent.change(screen.getByLabelText('故事线补充要求'),{target:{value:'希望更温暖'}});
    fireEvent.click(screen.getByRole('button',{name:'请主编重新推荐'}));
    await waitFor(()=>expect(sent).toContain('林舟与伙伴让流民有家可归'));expect(sent).toContain('希望更温暖');
  });
  beforeEach(() => { vi.unstubAllGlobals(); window.sessionStorage.clear(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('allows deselecting every recommendation and sends the structured selection', async () => {
    let body='';const state=stateFixture({runs:[recommendRun('succeeded')]});
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      if(String(input).endsWith('/state'))return response(state);
      if(String(input).endsWith('/design-runs')){body=String(init?.body);return response({runs:[]});}
      throw Error('Unexpected request');
    }));
    renderPage(<TimeMachineDirectionEntry bookId="bk-1"/>);
    await screen.findByText('已选 1 条故事线');
    const boxes=screen.getAllByRole('checkbox') as HTMLInputElement[];
    const growth=boxes.find(box=>box.closest('label')?.textContent?.includes('成长线'))!;
    fireEvent.click(growth);expect(await screen.findByText('已选 0 条故事线')).toBeVisible();
    fireEvent.click(growth);fireEvent.click(screen.getByRole('button',{name:'确认故事线，设计全书方向'}));
    await waitFor(()=>{
      const parsed=JSON.parse(body) as {selection:{recommendationRunId:string;recommendationHash:string;preparationVersion:string;selectedLineIds:string[]}};
      expect(parsed.selection.recommendationRunId).toBe('rec-1');
      expect(parsed.selection.recommendationHash).toBe('hash-rec-1');
      expect(parsed.selection.preparationVersion).toBe('confirmed-v1');
      expect(parsed.selection.selectedLineIds).toEqual(['growth']);
    });
  });

  it('keeps scheme selection after adoption and lets the author re-confirm storylines (S1-A redesign)', async () => {
    const plan=planFixture('当前方案');plan.relations=[{from:'sub',to:'main',kind:'push',effect:'伙伴的选择推动工坊改变'}] as never;
    let posted=0;
    const state=stateFixture({runs:[recommendRun('succeeded'),{...designRun('A','succeeded','红玉','候选A'),selection:{recommendationRunId:'rec-1',selectedLineIds:['growth'],addedLines:[],shape:'auto',ensemble:true,authorNote:''}},designRun('B','succeeded','幼薇','候选B')],adopted:{revision:2,member:{id:'writer-a',name:'红玉'},plan,numbering:{volumes:[{localId:'v1',code:'C'},{localId:'v2',code:'D'}],mainLines:['主线4'],branchLines:['支线7']}}});
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);
      if(url.endsWith('/state'))return response(state);
      if(url.endsWith('/design-runs')){posted++;return response({runs:[]});}
      throw Error('Unexpected request');
    }));
    renderPage(<TimeMachineDirectionEntry bookId="bk-1"/>);
    fireEvent.click(await screen.findByText('查看已采用的全书方向'));
    expect(await screen.findByText('主线4')).toBeVisible();expect(screen.getByText('支线7 → 主线4')).toBeVisible();
    expect(screen.getByRole('button',{name:/方案B/})).toBeEnabled();
    fireEvent.click(screen.getByRole('button',{name:'重新设计全书方向'}));
    // S1-A：重新设计回到故事线确认页，不重复提交旧intent；作者再次确认才发起新设计
    expect(await screen.findByText('老板，我们来设计全书骨架。')).toBeVisible();
    expect(posted).toBe(0);
    // 刷新恢复：已保存选择投影恢复了勾选（不为空）
    expect(screen.getByText('已选 1 条故事线')).toBeVisible();
  });

  it('detects a fresh book, auto-starts the recommendation once and begins a three-scheme round', async () => {
    let state = stateFixture({ runs: [] });
    let posted = { recommend: 0, design: 0 };
    let designStarted = false;
    let designSelection: { shape?: string; ensemble?: boolean; selectedLineIds?: string[]; addedLines?: { title: string; description: string }[] } = {};
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/time-machine/books/bk-1/state')) return response(state);
      if (url.endsWith('/recommendation-runs') && url.includes('/api/time-machine/')) { posted.recommend += 1; state = stateFixture({ runs: [recommendRun('succeeded')] }); return response({ id: 'rec-1', state: 'succeeded' }); }
      if (url.endsWith('/design-runs')) { posted.design += 1; designStarted = true; designSelection = typeof init?.body === 'string' ? (JSON.parse(init.body) as { selection: typeof designSelection }).selection : {}; state = stateFixture({ runs: [recommendRun('succeeded'), designRun('A', 'working', '红玉', 'x'), designRun('B', 'working', '幼薇', 'x'), designRun('C', 'working', '苏映棠', 'x')] }); return response({ runs: [{ id: 'design-A', scheme: 'A', state: 'queued' }, { id: 'design-B', scheme: 'B', state: 'queued' }, { id: 'design-C', scheme: 'C', state: 'queued' }] }); }
      if (url.endsWith('/planning-routes/latest')) return response(null);
      if (url.endsWith('/generation-runs/latest')) return response(null);
      throw new Error(`Unexpected request: ${url}`);
    }));
    renderPage(<TimeMachineDirectionEntry bookId="bk-1" />);
    await waitFor(() => { expect(posted.recommend).toBe(1); }, { timeout: 4000 });
    expect(await screen.findByText('老板，我们来设计全书骨架。')).toBeVisible();
    expect(screen.getByText('这是我推荐的故事线，您看看，还想加入哪些？')).toBeVisible();
    expect(screen.getByText(/成长线/)).toBeVisible();
    expect(screen.getByText(/机甲伙伴线/)).toBeVisible();
    expect(screen.getByText('你希望故事怎样展开？')).toBeVisible();
    expect(screen.getByText('还有想加入的故事吗？')).toBeVisible();
    expect(screen.getByText('已选 1 条故事线')).toBeVisible();
    fireEvent.click(screen.getByRole('radio', { name: /集中讲一个核心故事/ }));
    // 原型“＋ 添加其他故事线”弹窗：加入一条预设线后计入已选计数并进入结构化选择。
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加其他故事线' }));
    expect(await screen.findByRole('dialog', { name: '添加你想写的故事' })).toBeVisible();
    expect(screen.getByLabelText('故事线名称')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /感情线/ }));
    expect(await screen.findByText('已选 2 条故事线')).toBeVisible();
    // 弹窗关闭后DOM仍保留预设项，用数量断言加入的线卡已渲染。
    expect(screen.getAllByText(/与拥有独立追求的伴侣/).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: '确认故事线，设计全书方向' }));
    await waitFor(() => { expect(posted.design).toBe(1); });
    expect(designSelection.shape).toBe('single');
    expect(designSelection.ensemble).toBe(true);
    expect(designSelection.selectedLineIds).toEqual(['growth']);
    expect(designSelection.addedLines).toEqual([{ title: '感情线', description: '与拥有独立追求的伴侣，在合作与分歧中发展感情。' }]);
    expect(await screen.findByText('方案A')).toBeVisible();
    expect(screen.getByText('方案B')).toBeVisible();
    expect(screen.getByText('方案C')).toBeVisible();
    expect(screen.getByText('红玉')).toBeVisible();
    expect(screen.getByText('幼薇')).toBeVisible();
    expect(screen.getByText('苏映棠')).toBeVisible();
    // 72c3a62f复核第5项：工作态统一"正在工作"，成员=实际接手成员，附可离开说明
    expect(screen.getAllByText('正在工作')).toHaveLength(3);
    expect(screen.getByText(/方案设计在后台进行，你可以离开本页/)).toBeVisible();
    expect(designStarted).toBe(true);
  }, 20000);

  it('keeps showing a succeeded recommendation when a later restart failed, and renders an honest failure with restart when none succeeded', async () => {
    const succeeded = recommendRun('succeeded');
    const failedRestart = { ...recommendRun('failed', 'rec-2'), updatedAt: '2026-09-11T11:00:00Z' };
    let state = stateFixture({ runs: [succeeded, failedRestart] });
    let restarted = 0;
    const renderWith = () => {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/state')) return response(state);
        if (url.endsWith('/recommendation-runs')) { restarted += 1; return response({ id: 'rec-3', state: 'queued' }); }
        if (url.endsWith('/planning-routes/latest')) return response(null);
        if (url.endsWith('/generation-runs/latest')) return response(null);
        throw new Error(`Unexpected request: ${url}`);
      }));
      renderPage(<TimeMachineDirectionEntry bookId="bk-1" />);
    };
    // 失败的重启不掩盖已成功的推荐：欢迎页照常显示，不出现"未完成"大字。
    renderWith();
    expect(await screen.findByText('老板，我们来设计全书骨架。')).toBeVisible();
    expect(screen.queryByText('重新开始推荐')).toBeNull();
    cleanup();
    // 没有成功推荐时诚实展示失败原因与重试入口。
    state = stateFixture({ runs: [failedRestart] });
    renderWith();
    expect(await screen.findByText('本期剩余创作额度不足，推荐已暂停。')).toBeVisible();
    expect(screen.getByText('开书资料和已确认设定仍然保留，无需重新填写。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重新开始推荐' }));
    await waitFor(() => { expect(restarted).toBe(1); });
  }, 20000);

  it('shows scheme detail with volume budget and anchors, lets a failed scheme retry without blocking others', async () => {
    let state = stateFixture({ runs: [recommendRun('succeeded'), designRun('A', 'succeeded', '红玉', '轻快成长'), designRun('B', 'succeeded', '幼薇', '厚重群像'), designRun('C', 'failed', '苏映棠', '')] });
    let retried = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/state')) return response(state);
      if (url.endsWith('/retry')) { retried = true; return response({ id: 'design-C' }); }
      if (url.endsWith('/planning-routes/latest')) return response(null);
      if (url.endsWith('/generation-runs/latest')) return response(null);
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
    }));
    renderPage(<TimeMachineDirectionEntry bookId="bk-1" />);
    // 已有设计轮刷新后恢复到全书方向，避免误以为需要重新选线。
    expect(await screen.findByRole('button', { name: '全书' })).toHaveAttribute('aria-pressed','true');
    expect(await screen.findByText('方案A')).toBeVisible();
    expect(screen.getByText('方案C')).toBeVisible();
    expect(screen.getByText('未完成')).toBeVisible();
    fireEvent.click(screen.getAllByText('续做')[0]!);
    await waitFor(() => { expect(retried).toBe(true); });
    expect(screen.getByText('轻快成长')).toBeVisible();
    expect(screen.getByText('约30万字')).toBeVisible();
    expect(screen.getAllByText('卷A').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('卷B').length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getAllByText(/工坊危机/)[0]!.closest('details')!.querySelector('summary')!);
    expect(screen.getByText(/订单危机已经成立/)).toBeInTheDocument();
    expect(screen.getByText('采用本方案')).toBeEnabled();
  }, 20000);

  it('blocks adoption for unresolved review, saves an author edit as a new revision, then adopts with numbering', async () => {
    let state = stateFixture({ runs: [recommendRun('succeeded'), designRun('A', 'succeeded', '红玉', '待调整的基线', false), designRun('B', 'succeeded', '幼薇', '厚重群像'), designRun('C', 'succeeded', '苏映棠', '第三种味道')] });
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/state')) return response(state);
      if (url.endsWith('/revisions')) {
        bodies.push(JSON.parse(String(init?.body)));
        state = stateFixture({ runs: [recommendRun('succeeded'), { ...designRun('A', 'succeeded', '红玉', '作者改过的基线', true), result: { ...designResult('红玉', '作者改过的基线', true), revision: 2 } }, designRun('B', 'succeeded', '幼薇', '厚重群像'), designRun('C', 'succeeded', '苏映棠', '第三种味道')] });
        return response({ revision: 2 });
      }
      if (url.endsWith('/adoptions')) {
        state = stateFixture({ planRevision: 1, runs: state.runs, adopted: { revision: 1, member: { id: 'writer-红玉', name: '红玉' }, plan: planFixture('作者改过的基线'), numbering: { volumes: [{ localId: 'v1', code: 'A' }, { localId: 'v2', code: 'B' }], mainLines: ['主线1'], branchLines: ['支线1'] } } });
        return response({ id: 'adopt-1', revision: 1 });
      }
      if (url.endsWith('/planning-routes/latest')) return response(null);
      if (url.endsWith('/generation-runs/latest')) return response(null);
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
    }));
    renderPage(<TimeMachineDirectionEntry bookId="bk-1" />);
    await screen.findByRole('button', { name: '全书' });
    expect(await screen.findByText(/方案仍有待核对的问题/)).toBeVisible();
    expect(screen.getByRole('button', { name: '采用本方案' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /修改方案/ }));
    const baselineField = screen.getByDisplayValue('待调整的基线');
    fireEvent.change(baselineField, { target: { value: '作者改过的基线' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => { expect(bodies).toHaveLength(1); });
    expect((bodies[0] as { expectedRevision: number }).expectedRevision).toBe(1);
    await waitFor(() => { expect(screen.getByRole('button', { name: '采用本方案' })).toBeEnabled(); });
    expect(screen.getByRole('heading', { name: /第2版/ })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '采用本方案' }));
    expect(await screen.findByText(/已采用 · 红玉 的方案/)).toBeVisible();
    expect(screen.getByText(/卷A、卷B；主线1、支线1/)).toBeVisible();
    expect(screen.getByRole('button', { name: '重新设计全书方向' })).toBeEnabled();
  }, 20000);

  // 6ad621dd F3：重新设计页编辑自添/备注后，两次后台刷新（每次state都是新对象）不覆盖作者输入
  it('keeps author-added lines and note on the redesign page across two background refreshes', async () => {
    vi.useFakeTimers();
    try {
      let refreshes = 0;
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/state')) {
          // 每次轮询都返回全新state对象：restoredSelection/restoredRecommendation身份每次都变
          refreshes += 1;
          return response(stateFixture({ runs: [recommendRun('succeeded'), { ...designRun('A', 'succeeded', '红玉', '候选A'), selection: { recommendationRunId: 'rec-1', selectedLineIds: ['growth'], addedLines: [], shape: 'auto', ensemble: true, authorNote: '' } }] }));
        }
        throw new Error(`Unexpected request: ${url}`);
      }));
      renderPage(<TimeMachineDirectionEntry bookId="bk-1" />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(refreshes).toBe(1);
      // 已有设计轮先进方案页，再回故事线确认（重新设计）
      fireEvent.click(screen.getByRole('button', { name: '‹ 返回故事线推荐' }));
      expect(screen.getByText('老板，我们来设计全书骨架。')).toBeVisible();
      expect(screen.getByText('已选 1 条故事线')).toBeVisible();
      // 作者编辑：真实输入事件（置dirty）+自添一条预设线
      fireEvent.input(screen.getByLabelText('故事线补充要求'), { target: { value: '希望更热血' } });
      fireEvent.click(screen.getByRole('button', { name: '＋ 添加其他故事线' }));
      fireEvent.click(screen.getByRole('button', { name: /感情线/ }));
      expect(screen.getByText('已选 2 条故事线')).toBeVisible();
      // 两次后台刷新（非进行中15秒周期）
      await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
      expect(refreshes).toBe(3);
      // 作者输入仍在：恢复effect不因新对象重灌
      expect(screen.getByText('已选 2 条故事线')).toBeVisible();
      expect((screen.getByLabelText('故事线补充要求') as HTMLTextAreaElement).value).toBe('希望更热血');
    } finally { vi.useRealTimers(); }
  }, 20000);

  // 6ad621dd F4：服务端已创建但响应丢失→刷新→不重复开任务；state中roundKey即可确定成功并清除未决记录
  it('treats an existing round after a lost design response as confirmed success without resending', async () => {
    try {
      let state = stateFixture({ runs: [recommendRun('succeeded')] });
      const designPosts: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/state')) return response(state);
        if (url.endsWith('/design-runs')) {
          const key = (JSON.parse(String(init?.body)) as { idempotencyKey: string }).idempotencyKey;
          designPosts.push(key);
          if (designPosts.length === 1) {
            // 首次提交：服务端已建轮（三方案共享该roundKey），响应在网络中丢失
            const round = [{ ...designRun('A', 'working', '红玉', 'x'), roundKey: key, selection: { recommendationRunId: 'rec-1', selectedLineIds: ['growth'], addedLines: [], shape: 'auto', ensemble: true, authorNote: '' } }, { ...designRun('B', 'working', '幼薇', 'x'), roundKey: key }, { ...designRun('C', 'working', '苏映棠', 'x'), roundKey: key }];
            state = stateFixture({ runs: [recommendRun('succeeded'), ...round] });
            throw new TypeError('network went away');
          }
          return response({ runs: [{ id: 'design-A', scheme: 'A', state: 'queued' }] });
        }
        throw new Error(`Unexpected request: ${url}`);
      }));
      renderPage(<TimeMachineDirectionEntry bookId="bk-1" />, 'owner-1');
      await screen.findByText('已选 1 条故事线');
      fireEvent.click(screen.getByRole('button', { name: '确认故事线，设计全书方向' }));
      await waitFor(() => { expect(designPosts).toHaveLength(1); });
      // 作者刷新页面：sessionStorage未决记录仍在，但state已含该轮=确定成功
      cleanup();
      renderPage(<TimeMachineDirectionEntry bookId="bk-1" />, 'owner-1');
      expect(await screen.findByText('方案A')).toBeVisible();
      expect(screen.getByText('方案B')).toBeVisible();
      expect(screen.getByText('方案C')).toBeVisible();
      await new Promise(resolve => { setTimeout(resolve, 50); });
      // 不自动重发：实际提交仍只有一次（服务端一轮三方案，任务数仍一轮）
      expect(designPosts).toHaveLength(1);
      expect(window.sessionStorage.getItem('wenmi:design-pending:owner-1:bk-1')).toBeNull();
    } finally { window.sessionStorage.clear(); }
  }, 20000);

  // 6ad621dd F4：请求未到达服务端→刷新→回填作者输入并用原请求原键重试一次，不要求重新填字
  it('restores the pending selection after refresh and retries the same request with the same key', async () => {
    try {
      let state = stateFixture({ runs: [recommendRun('succeeded')] });
      const designPosts: { key: string; body: string }[] = [];
      let releaseRetry: ((value: Response) => void) | null = null;
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/state')) return response(state);
        if (url.endsWith('/design-runs')) {
          const raw = String(init?.body);
          designPosts.push({ key: (JSON.parse(raw) as { idempotencyKey: string }).idempotencyKey, body: raw });
          if (designPosts.length === 1) throw new TypeError('network went away'); // 首次请求根本没到服务端
          const key = designPosts[1]!.key;
          state = stateFixture({ runs: [recommendRun('succeeded'), { ...designRun('A', 'working', '红玉', 'x'), roundKey: key }, { ...designRun('B', 'working', '幼薇', 'x'), roundKey: key }, { ...designRun('C', 'working', '苏映棠', 'x'), roundKey: key }] });
          // 挂起重试响应：先断言回填的作者输入，再放行成功回执
          return new Promise<Response>(resolve => { releaseRetry = resolve; });
        }
        throw new Error(`Unexpected request: ${url}`);
      }));
      renderPage(<TimeMachineDirectionEntry bookId="bk-1" />, 'owner-2');
      await screen.findByText('已选 1 条故事线');
      fireEvent.input(screen.getByLabelText('故事线补充要求'), { target: { value: '希望更热血' } });
      fireEvent.click(screen.getByRole('button', { name: '＋ 添加其他故事线' }));
      fireEvent.click(screen.getByRole('button', { name: /感情线/ }));
      expect(await screen.findByText('已选 2 条故事线')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: '确认故事线，设计全书方向' }));
      await waitFor(() => { expect(designPosts).toHaveLength(1); });
      const first = designPosts[0]!;
      // 刷新：未决记录回填作者输入（无需重新填字），自动用原请求原键重试一次
      cleanup();
      renderPage(<TimeMachineDirectionEntry bookId="bk-1" />, 'owner-2');
      expect(await screen.findByText('已选 2 条故事线')).toBeVisible();
      expect((screen.getByLabelText('故事线补充要求') as HTMLTextAreaElement).value).toBe('希望更热血');
      await waitFor(() => { expect(designPosts).toHaveLength(2); });
      expect(designPosts[1]!.key).toBe(first.key);
      expect(designPosts[1]!.body).toBe(first.body);
      // 放行成功回执：state出现该轮=确定成功，清除未决记录
      releaseRetry!(response({ runs: [{ id: 'design-A', scheme: 'A', state: 'queued' }, { id: 'design-B', scheme: 'B', state: 'queued' }, { id: 'design-C', scheme: 'C', state: 'queued' }] }));
      await waitFor(() => { expect(window.sessionStorage.getItem('wenmi:design-pending:owner-2:bk-1')).toBeNull(); });
    } finally { window.sessionStorage.clear(); }
  }, 20000);

  // 3a84dc98补齐1：切换账号不读另一账号的未决记录——不回填旧输入、不自动重发、旧记录不被误清
  it('switching accounts does not read or resend another account pending request', async () => {
    try {
      const state = stateFixture({ runs: [recommendRun('succeeded')] });
      const designPosts: { key: string; body: string }[] = [];
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/state')) return response(state);
        if (url.endsWith('/design-runs')) {
          const raw = String(init?.body);
          designPosts.push({ key: (JSON.parse(raw) as { idempotencyKey: string }).idempotencyKey, body: raw });
          throw new TypeError('network went away'); // 账号A的请求结果未知
        }
        throw new Error(`Unexpected request: ${url}`);
      }));
      renderPage(<TimeMachineDirectionEntry bookId="bk-1" />, 'owner-a');
      await screen.findByText('已选 1 条故事线');
      fireEvent.input(screen.getByLabelText('故事线补充要求'), { target: { value: '账号A的补充' } });
      fireEvent.click(screen.getByRole('button', { name: '＋ 添加其他故事线' }));
      fireEvent.click(screen.getByRole('button', { name: /感情线/ }));
      expect(await screen.findByText('已选 2 条故事线')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: '确认故事线，设计全书方向' }));
      await waitFor(() => { expect(designPosts).toHaveLength(1); });
      // 未决记录已落在账号A+书籍的隔离键下
      expect(window.sessionStorage.getItem('wenmi:design-pending:owner-a:bk-1')).not.toBeNull();
      cleanup();
      // 同一浏览器换账号B登录：不读A的记录——输入回到推荐默认、不自动重发、A的记录不被误清
      renderPage(<TimeMachineDirectionEntry bookId="bk-1" />, 'owner-b');
      expect(await screen.findByText('已选 1 条故事线')).toBeVisible();
      expect((screen.getByLabelText('故事线补充要求') as HTMLTextAreaElement).value).toBe('');
      await new Promise(resolve => { setTimeout(resolve, 100); });
      expect(designPosts).toHaveLength(1);
      expect(window.sessionStorage.getItem('wenmi:design-pending:owner-a:bk-1')).not.toBeNull();
      expect(window.sessionStorage.getItem('wenmi:design-pending:owner-b:bk-1')).toBeNull();
    } finally { window.sessionStorage.clear(); }
  }, 20000);

  // —— S1-A阶段二（第25节）：二级导航四项与故事线资料页 ——
  function storylineMaterialFixture(overrides: Record<string, unknown> = {}) {
    const { content: contentOverride, ...rest } = overrides;
    return {
      revision: 1,
      content: {
        recommendationRunId: 'rec-1', recommendationHash: 'hash-rec-1', preparationVersion: 'confirmed-v1',
        selectedLineIds: ['growth'],
        // 72c3a62f复核第1项：材料自含勾选线正文（服务端回填/保存），页面不依赖最新推荐
        selectedLines: [{ id: 'growth', role: 'main' as const, title: '成长线', description: '林舟建立工坊' }],
        addedLines: [{ title: '宿敌线', description: '对手改变彼此' }],
        shape: 'auto' as const, ensemble: true, authorNote: '想多写伙伴的成长',
        ...((contentOverride ?? {}) as Record<string, unknown>)
      },
      createdBy: 'selection-confirm' as const, createdAt: '2026-09-15T10:00:00Z',
      versions: [{ revision: 1, contentHash: 'h1', createdBy: 'selection-confirm', createdAt: '2026-09-15T10:00:00Z' }],
      draft: null,
      ...rest
    };
  }

  it('secondary nav is 全书｜时光树｜轨迹｜资料; 资料 page honestly shows not-created when no material exists', async () => {
    const state = stateFixture({ runs: [recommendRun('succeeded')] });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/state')) return response(state);
      throw new Error(`Unexpected request: ${String(input)}`);
    }));
    renderPage(<TimeMachineDirectionEntry bookId="bk-1" />);
    const nav = await screen.findByRole('navigation', { name: '时光机功能' });
    const buttons = Array.from(nav.querySelectorAll('button'));
    expect(buttons.map(button => button.textContent)).toEqual(['全书', '时光树', '轨迹', '资料']);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    expect((buttons[2] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '资料' }));
    expect(await screen.findByText('本书还没有故事线资料。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '去确认故事线' }));
    expect(await screen.findByText('为本书推荐')).toBeVisible();
  });

  it('material page shows the confirmed storyline material expanded by default with read-only source references', async () => {
    const state = stateFixture({ runs: [recommendRun('succeeded')], storylineMaterial: storylineMaterialFixture() });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/state')) return response(state);
      throw new Error(`Unexpected request: ${String(input)}`);
    }));
    renderPage(<TimeMachineDirectionEntry bookId="bk-1" />);
    fireEvent.click(await screen.findByRole('button', { name: '资料' }));
    expect(await screen.findByText(/第1版 · 作者确认形成/)).toBeVisible();
    // 主要内容默认展开：故事线清单/展开方式/作者补充/来源引用直接可读
    expect(screen.getByText('已确认的故事线（2条）')).toBeVisible();
    expect(screen.getByText('成长线')).toBeVisible();
    expect(screen.getAllByText('宿敌线').length).toBeGreaterThan(0);
    expect(screen.getByText('想多写伙伴的成长')).toBeVisible();
    expect(screen.getByText('来源引用（只读）')).toBeVisible();
    expect(screen.getByText('hash-rec-1')).toBeVisible();
    // 全书工作摘要折叠存在
    expect(screen.getByText('全书工作摘要（主编推荐语）')).toBeVisible();
    fireEvent.click(screen.getByText('全书工作摘要（主编推荐语）'));
    expect(screen.getByText('老板，我们现在设计全书骨架。')).toBeVisible();
  });

  it('material edit: cancel discards; draft restores unsaved changes; save asks preview then exact confirm wording', async () => {
    const draftContent = {
      recommendationRunId: 'rec-1', recommendationHash: 'hash-rec-1', preparationVersion: 'confirmed-v1',
      selectedLineIds: ['growth', 'partner'], addedLines: [], shape: 'multiple' as const, ensemble: false, authorNote: '草稿里的想法'
    };
    let current = stateFixture({ runs: [recommendRun('succeeded')], storylineMaterial: storylineMaterialFixture({ draft: { content: draftContent, baseRevision: 1, updatedAt: '2026-09-15T11:00:00Z' } }) });
    let previewPosts = 0; let savePosts = 0; let draftPosts = 0; let saveBody = '';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/state')) return response(current);
      if (url.endsWith('/storyline-material/preview')) { previewPosts++; return response({ currentRevision: 1, unchanged: false, revisionMatch: true, affectedBaseline: true, affectedRuns: [{ id: 'design-A', scheme: 'A', roundKey: 'round-1', state: 'succeeded', alreadyMarked: false }], affectedInFlight: 0, downstream: { volumeOutlines: 2, volumes: 'not-created', chains: 'not-created', chapters: 'not-created' }, signature: 'sig-1' }); }
      if (url.endsWith('/storyline-material/draft')) { draftPosts++; return response({ baseRevision: 1, updatedAt: '2026-09-15T12:00:00Z' }); }
      if (url.endsWith('/storyline-material')) {
        savePosts++;
        saveBody = String(init?.body);
        const body = JSON.parse(saveBody) as { content: { authorNote: string } };
        current = stateFixture({ runs: [recommendRun('succeeded')], storylineMaterial: storylineMaterialFixture({ revision: 2, createdBy: 'author-edit', content: { ...draftContent, authorNote: body.content.authorNote } }) });
        return response({ projection: storylineMaterialFixture({ revision: 2, createdBy: 'author-edit', content: { ...draftContent, authorNote: body.content.authorNote } }), markedRuns: 1, unchanged: false, replayed: false });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    renderPage(<TimeMachineDirectionEntry bookId="bk-1" />);
    fireEvent.click(await screen.findByRole('button', { name: '资料' }));
    expect(await screen.findByText(/有一份未保存的草稿/)).toBeVisible();
    // 进入编辑：从草稿恢复
    fireEvent.click(screen.getByRole('button', { name: /修改故事线资料/ }));
    expect(await screen.findByText(/正在继续上次未保存的草稿/)).toBeVisible();
    expect((screen.getByLabelText('资料作者补充要求') as HTMLTextAreaElement).value).toBe('草稿里的想法');
    // 取消：丢弃未保存改动回到展示
    fireEvent.change(screen.getByLabelText('资料作者补充要求'), { target: { value: '改成别的' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(await screen.findByText('想多写伙伴的成长')).toBeVisible();
    // 再次进入仍是草稿内容；保存草稿不失效
    fireEvent.click(screen.getByRole('button', { name: /修改故事线资料/ }));
    expect((screen.getByLabelText('资料作者补充要求') as HTMLTextAreaElement).value).toBe('草稿里的想法');
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(draftPosts).toBe(1));
    expect(await screen.findByText(/草稿已保存；正式资料与后续设计不受影响/)).toBeVisible();
    // 保存修改→预览→确认弹窗（逐字文案）→确认保存
    fireEvent.change(screen.getByLabelText('资料作者补充要求'), { target: { value: '最终确定的补充' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(previewPosts).toBe(1));
    expect(await screen.findByText('保存此修改后，基于旧版故事线资料的全书基线，以及后续卷、链、章规划将需要重新设计。已有正文会保留，不会自动覆盖。')).toBeVisible();
    expect(screen.getByText('卷概要：已采用方案含2卷概要，重新设计后更新')).toBeVisible();
    expect(screen.getByText('卷、链、章规划：尚未实现独立卷设计（如实标注）')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '保存修改并标记重设' }));
    await waitFor(() => expect(savePosts).toBe(1));
    // 72c3a62f复核第3项：确认保存原样带回预览签名，服务端事务内重算
    expect((JSON.parse(saveBody) as { previewSignature?: string }).previewSignature).toBe('sig-1');
    expect(await screen.findByText(/已保存为第2版故事线资料/)).toBeVisible();
    expect(await screen.findByText(/第2版 · 作者修改形成/)).toBeVisible();
  });

  it('stale runs and adopted baseline show 需重新设计 and block adopt/edit after material change', async () => {
    const staleA = { ...designRun('A', 'succeeded', '青鸾', '甲方案', true), needsRedesign: true };
    const state = stateFixture({
      runs: [recommendRun('succeeded'), staleA, designRun('B', 'succeeded', '白泽', '乙方案', true)],
      adopted: { revision: 1, member: { id: 'writer-青鸾', name: '青鸾' }, plan: planFixture('甲方案'), numbering: null, needsRedesign: true },
      planRevision: 1,
      storylineMaterial: storylineMaterialFixture({ revision: 2, createdBy: 'author-edit' })
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/state')) return response(state);
      throw new Error(`Unexpected request: ${String(input)}`);
    }));
    renderPage(<TimeMachineDirectionEntry bookId="bk-1" />);
    expect(await screen.findAllByText(/基于旧版故事线资料，需重新设计/).then(items => items.length)).toBeGreaterThan(0);
    // 已采用基线条幅
    expect(screen.getByText(/已采用的规划保留可查看，不会自动覆盖/)).toBeVisible();
    // 方案A标记需重新设计且采用/修改禁用
    expect(screen.getAllByText('需重新设计').length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: '采用本方案' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /修改方案/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  // 72c3a62f复核第1项：资料页可直接编辑每条已确认故事线的标题/描述，稳定id随材料保存
  it('material edit lets the author rewrite a confirmed storyline title and description in place', async () => {
    let saveBody = '';
    const current = stateFixture({ runs: [recommendRun('succeeded')], storylineMaterial: storylineMaterialFixture() });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/state')) return response(current);
      if (url.endsWith('/storyline-material/preview')) return response({ currentRevision: 1, unchanged: false, revisionMatch: true, affectedBaseline: false, affectedRuns: [], affectedInFlight: 0, downstream: { volumeOutlines: 0, volumes: 'not-created', chains: 'not-created', chapters: 'not-created' }, signature: 'sig-edit' });
      if (url.endsWith('/storyline-material')) { saveBody = String(init?.body); return response({ projection: storylineMaterialFixture({ revision: 2, createdBy: 'author-edit' }), markedRuns: 0, unchanged: false, replayed: false }); }
      throw new Error(`Unexpected request: ${url}`);
    }));
    renderPage(<TimeMachineDirectionEntry bookId="bk-1" />);
    fireEvent.click(await screen.findByRole('button', { name: '资料' }));
    fireEvent.click(await screen.findByRole('button', { name: /修改故事线资料/ }));
    // 推荐线正文以输入框直接呈现（自含于材料，不依赖最新推荐）
    const titleField = (await screen.findByLabelText('推荐故事线1名称')) as HTMLInputElement;
    const descField = screen.getByLabelText('推荐故事线1描述') as HTMLTextAreaElement;
    expect(titleField.value).toBe('成长线');
    expect(descField.value).toBe('林舟建立工坊');
    fireEvent.change(titleField, { target: { value: '成长线·星际版' } });
    fireEvent.change(descField, { target: { value: '林舟建立星际工坊' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    fireEvent.click(await screen.findByRole('button', { name: '保存修改并标记重设' }));
    await waitFor(() => expect(saveBody).not.toBe(''));
    const saved = JSON.parse(saveBody) as { content: { selectedLines: { id: string; title: string; description: string }[] }; previewSignature?: string };
    expect(saved.content.selectedLines).toEqual([{ id: 'growth', title: '成长线·星际版', description: '林舟建立星际工坊' }]);
    expect(saved.previewSignature).toBe('sig-edit');
  });

  // 72c3a62f复核第2项：全书页确认与正式资料一致时，设计直接带当前资料版本，不新建材料版本
  it('landing confirmation matching the material starts design with the current material revision and no material write', async () => {
    let designBody = ''; let previewPosts = 0;
    const state = stateFixture({ runs: [recommendRun('succeeded')], storylineMaterial: storylineMaterialFixture() });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/state')) return response(state);
      if (url.endsWith('/storyline-material/preview')) { previewPosts++; return response({ currentRevision: 1, unchanged: true, revisionMatch: true, affectedBaseline: false, affectedRuns: [], affectedInFlight: 0, downstream: { volumeOutlines: 0, volumes: 'not-created', chains: 'not-created', chapters: 'not-created' }, signature: 'sig-x' }); }
      if (url.endsWith('/design-runs')) { designBody = String(init?.body); return response({ runs: [] }); }
      throw new Error(`Unexpected request: ${url}`);
    }));
    renderPage(<TimeMachineDirectionEntry bookId="bk-1" />);
    // 材料初始化恢复勾选+自添+备注（与正式资料一致）
    expect(await screen.findByText('已选 2 条故事线')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认故事线，设计全书方向' }));
    await waitFor(() => expect(designBody).not.toBe(''));
    const parsed = JSON.parse(designBody) as { expectedMaterialRevision?: number; selection: { selectedLines?: { id: string; title: string; description: string }[]; authorNote: string } };
    expect(parsed.expectedMaterialRevision).toBe(1);
    expect(parsed.selection.selectedLines).toEqual([{ id: 'growth', title: '成长线', description: '林舟建立工坊' }]);
    expect(parsed.selection.authorNote).toBe('想多写伙伴的成长');
    expect(previewPosts).toBe(0);
  });

  // 72c3a62f复核第2项：全书页确认与正式资料不一致时，先保存材料新版本（预览+确认），再用新版本自动开始设计
  it('landing confirmation diverging from the material saves a new material revision first, then auto-starts design on it', async () => {
    const calls: string[] = [];
    let saveBody = ''; let designBody = '';
    let current = stateFixture({ runs: [recommendRun('succeeded')], storylineMaterial: storylineMaterialFixture() });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/state')) return response(current);
      if (url.endsWith('/storyline-material/preview')) { calls.push('preview'); return response({ currentRevision: 1, unchanged: false, revisionMatch: true, affectedBaseline: false, affectedRuns: [], affectedInFlight: 0, downstream: { volumeOutlines: 0, volumes: 'not-created', chains: 'not-created', chapters: 'not-created' }, signature: 'sig-2' }); }
      if (url.endsWith('/storyline-material')) {
        calls.push('save'); saveBody = String(init?.body);
        current = stateFixture({ runs: [recommendRun('succeeded')], storylineMaterial: storylineMaterialFixture({ revision: 2, createdBy: 'author-edit' }) });
        return response({ projection: storylineMaterialFixture({ revision: 2, createdBy: 'author-edit' }), markedRuns: 0, unchanged: false, replayed: false });
      }
      if (url.endsWith('/design-runs')) { calls.push('design'); designBody = String(init?.body); return response({ runs: [] }); }
      throw new Error(`Unexpected request: ${url}`);
    }));
    renderPage(<TimeMachineDirectionEntry bookId="bk-1" />);
    expect(await screen.findByText('已选 2 条故事线')).toBeVisible();
    fireEvent.change(screen.getByLabelText('故事线补充要求'), { target: { value: '改成全新的方向' } });
    fireEvent.click(screen.getByRole('button', { name: '确认故事线，设计全书方向' }));
    // 先走材料保存流：预览→确认弹窗，尚不允许直接开设计
    await waitFor(() => expect(calls).toEqual(['preview']));
    expect(await screen.findByText('保存此修改后，基于旧版故事线资料的全书基线，以及后续卷、链、章规划将需要重新设计。已有正文会保留，不会自动覆盖。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '保存修改并标记重设' }));
    await waitFor(() => expect(calls).toEqual(['preview', 'save', 'design']));
    const saved = JSON.parse(saveBody) as { expectedRevision: number; previewSignature: string };
    expect(saved.expectedRevision).toBe(1);
    expect(saved.previewSignature).toBe('sig-2');
    const design = JSON.parse(designBody) as { expectedMaterialRevision: number; selection: { authorNote: string; selectedLines?: { id: string; title: string; description: string }[] } };
    expect(design.expectedMaterialRevision).toBe(2);
    expect(design.selection.authorNote).toBe('改成全新的方向');
    expect(design.selection.selectedLines).toEqual([{ id: 'growth', title: '成长线', description: '林舟建立工坊' }]);
  }, 20000);

  // 72c3a62f复核第3项：保存时预览已变化（409）→零写入，页面刷新后重新生成预览并请作者再次确认
  it('re-previews and asks again when the material save reports the preview changed (409), then saves on re-confirm', async () => {
    let previewPosts = 0; const saveBodies: string[] = [];
    let current = stateFixture({ runs: [recommendRun('succeeded')], storylineMaterial: storylineMaterialFixture() });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/state')) return response(current);
      if (url.endsWith('/storyline-material/preview')) { previewPosts++; return response({ currentRevision: 1, unchanged: false, revisionMatch: true, affectedBaseline: false, affectedRuns: [], affectedInFlight: 0, downstream: { volumeOutlines: 0, volumes: 'not-created', chains: 'not-created', chapters: 'not-created' }, signature: `sig-${previewPosts}` }); }
      if (url.endsWith('/storyline-material')) {
        saveBodies.push(String(init?.body));
        if (saveBodies.length === 1) return { ok: false, status: 409, json: async () => ({ error: { message: '影响预览已变化，请按最新预览确认', retryable: false } }) } as Response;
        current = stateFixture({ runs: [recommendRun('succeeded')], storylineMaterial: storylineMaterialFixture({ revision: 2, createdBy: 'author-edit' }) });
        return response({ projection: storylineMaterialFixture({ revision: 2, createdBy: 'author-edit' }), markedRuns: 0, unchanged: false, replayed: false });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    renderPage(<TimeMachineDirectionEntry bookId="bk-1" />);
    fireEvent.click(await screen.findByRole('button', { name: '资料' }));
    fireEvent.click(await screen.findByRole('button', { name: /修改故事线资料/ }));
    fireEvent.change(await screen.findByLabelText('推荐故事线1名称'), { target: { value: '成长线·改' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(previewPosts).toBe(1));
    fireEvent.click(await screen.findByRole('button', { name: '保存修改并标记重设' }));
    await waitFor(() => expect(saveBodies).toHaveLength(1));
    expect((JSON.parse(saveBodies[0]!) as { previewSignature?: string }).previewSignature).toBe('sig-1');
    // 409零写入：页面如实提示，并重新预览后再次打开确认弹窗
    expect(await screen.findByText(/影响范围刚刚发生变化/)).toBeVisible();
    await waitFor(() => expect(previewPosts).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: '保存修改并标记重设' }));
    await waitFor(() => expect(saveBodies).toHaveLength(2));
    expect((JSON.parse(saveBodies[1]!) as { previewSignature?: string }).previewSignature).toBe('sig-2');
    expect(await screen.findByText(/已保存为第2版故事线资料/)).toBeVisible();
  }, 20000);
});
