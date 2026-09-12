import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { TimeMachineDirectionEntry } from './TimeMachineDirectionPage';
import type { TimeMachineStateView } from './time-machine-direction-api';

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
  return { enabled: true, runs: partial.runs ?? [], adopted: partial.adopted ?? null, planRevision: partial.planRevision ?? 0 };
}

function recommendRun(status: 'working' | 'succeeded') {
  return {
    id: 'rec-1', kind: 'recommend' as const, scheme: null, roundKey: null, state: status, updatedAt: '2026-09-11T10:00:00Z',
    member: status === 'working' ? { id: 'chief', name: '貂蝉' } : null, progress: status === 'working' ? '正在推荐故事线' : '已完成',
    result: status === 'succeeded'
      ? { greeting: '老板，我们现在设计全书骨架。', lines: [
          { id: 'growth', role: 'main' as const, title: '成长线', description: '林舟建立工坊', recommended: true },
          { id: 'partner', role: 'through' as const, title: '机甲伙伴线', description: '机甲的自主选择', recommended: false }
        ], structure: 'single' as const, reason: '聚焦修理工成长' }
      : null,
    message: null
  };
}

function designRun(scheme: 'A' | 'B' | 'C', state: 'working' | 'succeeded' | 'failed', memberName: string, baseline: string, pass = true) {
  return {
    id: `design-${scheme}`, kind: 'design' as const, scheme, roundKey: 'round-1', state, updatedAt: `2026-09-11T10:0${scheme === 'A' ? 1 : scheme === 'B' ? 2 : 3}:00Z`,
    member: state === 'working' ? { id: `writer-${memberName}`, name: memberName } : null,
    progress: state === 'working' ? '正在设计全书骨架' : state === 'succeeded' ? '已完成' : '未完成',
    result: state === 'succeeded' ? designResult(memberName, baseline, pass) : null,
    message: state === 'failed' ? '本次工作尚未完成，已保存的步骤会保留。' : null
  };
}

const legacyRouteRun = {
  runId: 'legacy-run-1', status: 'waiting_for_you', phase: 'waiting_for_you', message: '请选一个方向。',
  progress: { completed: 7, total: 7, percent: 100 }, sourceIssues: [], canDecide: true, errorMessage: null, actors: [],
  routes: [], chiefReview: null
};

describe('time machine direction page', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('detects a fresh book, auto-starts the recommendation once and begins a three-scheme round', async () => {
    let state = stateFixture({ runs: [] });
    let posted = { recommend: 0, design: 0 };
    let designStarted = false;
    let designIntent = '';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/time-machine/books/bk-1/state')) return response(state);
      if (url.endsWith('/recommendation-runs') && url.includes('/api/time-machine/')) { posted.recommend += 1; state = stateFixture({ runs: [recommendRun('succeeded')] }); return response({ id: 'rec-1', state: 'succeeded' }); }
      if (url.endsWith('/design-runs')) { posted.design += 1; designStarted = true; designIntent = typeof init?.body === 'string' ? ((JSON.parse(init.body) as { intent?: string }).intent ?? '') : ''; state = stateFixture({ runs: [recommendRun('succeeded'), designRun('A', 'working', '红玉', 'x'), designRun('B', 'working', '幼薇', 'x'), designRun('C', 'working', '苏映棠', 'x')] }); return response({ runs: [{ id: 'design-A', scheme: 'A', state: 'queued' }, { id: 'design-B', scheme: 'B', state: 'queued' }, { id: 'design-C', scheme: 'C', state: 'queued' }] }); }
      if (url.endsWith('/planning-routes/latest')) return response(null);
      if (url.endsWith('/generation-runs/latest')) return response(null);
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<TimeMachineDirectionEntry bookId="bk-1" />);
    await waitFor(() => { expect(posted.recommend).toBe(1); }, { timeout: 4000 });
    expect(await screen.findByText('老板，我们来设计全书骨架。')).toBeVisible();
    expect(screen.getByText('这是我推荐的故事线，您看看，还想加入哪些？')).toBeVisible();
    expect(screen.getByText(/成长线/)).toBeVisible();
    expect(screen.getByText(/机甲伙伴线/)).toBeVisible();
    expect(screen.getByText('你希望故事怎样展开?')).toBeVisible();
    fireEvent.click(screen.getByRole('radio', { name: /集中讲一个核心故事/ }));
    // 原型默认勾选配角完整故事；直接沿用默认勾选状态。
    fireEvent.click(screen.getByRole('button', { name: '开始设计（三位编剧各出一套方案）' }));
    await waitFor(() => { expect(posted.design).toBe(1); });
    expect(designIntent).toContain('故事展开方式：集中讲一个核心故事');
    expect(designIntent).toContain('也希望配角拥有自己的完整故事');
    expect(await screen.findByText('方案A')).toBeVisible();
    expect(screen.getByText('方案B')).toBeVisible();
    expect(screen.getByText('方案C')).toBeVisible();
    expect(screen.getByText('红玉')).toBeVisible();
    expect(screen.getByText('幼薇')).toBeVisible();
    expect(screen.getByText('苏映棠')).toBeVisible();
    expect(designStarted).toBe(true);
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
    render(<TimeMachineDirectionEntry bookId="bk-1" />);
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
    render(<TimeMachineDirectionEntry bookId="bk-1" />);
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
});
