// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreWorkflowV6View } from '@wenmi/contracts';
import { StorylineWorkspace } from '../../../apps/web/src/features/core-workflow/StorylineWorkspace';

const emptyLedgers: CoreWorkflowV6View['ledgers'] = {
  storyline: { planned: [], actual: [] }, relationship: { planned: [], actual: [] },
  world_state: { planned: [], actual: [] }, causality: { planned: [], actual: [] },
  foreshadow: { planned: [], actual: [] }, settlement: { planned: [], actual: [] }
};

function view(active = false): CoreWorkflowV6View {
  return {
    contractVersion: 2, stage: 'storyline', stateVersion: 1, blockingReason: null,
    growth: { frontiers: [], openQuestions: [], candidates: [], decisions: [] },
    storylines: active ? [{
      storylineId: 'line-1', sortOrder: 1, lifecycleStatus: 'active', activeVersionId: 'line-version-1',
      activeVersion: { storylineVersionId: 'line-version-1', version: 1, status: 'active', baseVersion: 0, parentVersionId: null,
        sourceVersionIds: ['topology-1'], authorInputRefs: [], content: {
          title: '寻找真相', lineKind: 'core', coreQuestion: '谁改写了档案？', stageGoal: '找到第一份伪造记录',
          expectedStages: ['发现', '追查'], associatedCharacterIds: [], foreshadowingKeys: ['钟声来源'], rhythmMethodVersionId: null
        }, contentHash: 'line-hash', createdAt: '2026-08-22T00:00:00.000Z', confirmedAt: '2026-08-22T00:01:00.000Z' },
      versions: []
    }] : [],
    relations: [], volumeParticipations: [],
    characters: active ? [{ characterId: 'character-1', characterKind: 'existing', lifecycleStatus: 'active', activeVersionId: 'character-version-1',
      promotedFromCharacterId: null, version: 1, content: { name: '林岚', roleSummary: '调查者', desire: '查明真相', currentState: '尚未信任盟友',
        boundaries: [], storylineInfluences: [] } }] : [],
    eventRoleAssignments: [], ledgers: emptyLedgers, drafts: [], invalidations: []
  };
}

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: 'request-storyline', version: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('V6故事线工作台', () => {
  it('零故事线时不再要求拓扑或全书结局，并可直接进入第一卷', async () => {
    const onNext = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/core-workflow') && (init?.method ?? 'GET') === 'GET') return response(view(false));
      if (path.endsWith('/editorial-team')) return response({ pools: [] });
      return new Response(JSON.stringify({ error: { message: `未配置 ${path}` } }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<StorylineWorkspace bookId="book-1" bookTitle="雾钟档案" onNext={onNext} />);

    expect(await screen.findByText('有完整想法就建立故事线，只有开局灵感也可以直接写第一卷')).toBeInTheDocument();
    expect(screen.queryByText(/拓扑|双核心线|完整全书/u)).not.toBeInTheDocument();
    expect(document.querySelector('.v6-storyline-board-body')?.children).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /只有开局灵感，进入第一卷/ }));
    expect(onNext).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('storyline-topology'))).toBe(false);
  });
  it('可编辑线路字段和关联角色，地图默认线路轨并显式确认后进入分卷', async () => {
    const onNext = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/core-workflow') && (init?.method ?? 'GET') === 'GET') return response(view(true));
      if (path.endsWith('/storylines/line-1/versions')) return response({ versionId: 'line-version-2' });
      if (path.endsWith('/storylines/line-1/versions/line-version-2/confirm')) return response({ confirmed: true });
      if (path.endsWith('/editorial-team')) return response({ pools: [] });
      return new Response(JSON.stringify({ error: { message: `未配置 ${path}` } }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<StorylineWorkspace bookId="book-1" bookTitle="雾钟档案" onNext={onNext} />);

    fireEvent.click(await screen.findByRole('button', { name: '编辑寻找真相' }));
    const character = screen.getByRole('checkbox', { name: '林岚' });
    fireEvent.click(character);
    fireEvent.click(screen.getByRole('button', { name: '保存并确认版本' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/line-1/versions') && init?.method === 'POST')).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: '查看故事地图' }));
    expect(screen.getByRole('tab', { name: '线路地图' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '推进轨道' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '伏笔轨道' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    fireEvent.click(screen.getByRole('button', { name: '进入分卷' }));
    expect(onNext).toHaveBeenCalledOnce();
  });
  it('保留原线路板块并在其后显示滚动状态，可编辑后采用主编建议', async () => {
    const workflow = view(true);
    workflow.growth.candidates = [{
      candidateId: 'candidate-1', growthRoundId: 'round-1', candidateKind: 'next_direction', storylineId: 'line-1', status: 'candidate',
      title: '追查第二份档案', content: { summary: '沿着伪造记录追查经手人', continuationReason: '第一份记录留下同批纸张',
        protagonistInvolvement: '林岚必须证明第一份证据不是孤证', coreQuestion: '谁在持续改写档案？', pushesStorylineIds: ['line-1'],
        mayCreateStoryline: false, inferences: ['同一人可能参与两次'], unknowns: ['经手人身份'], misreadRisk: '纸张也可能来自库存', recommendedHorizonVolumes: 1 },
      evidenceRefs: [{ sourceKind: 'volume_settlement', sourceVersionId: 'settlement-1', locator: '第一卷结算' }], evidenceHash: 'evidence-1',
      sourceBatchId: 'batch-1', sourceBatchMemberId: 'member-1', basedOnVersionIds: ['settlement-1'], staleReason: null,
      createdAt: '2026-08-22T00:02:00.000Z', decidedAt: null
    }];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/core-workflow') && (init?.method ?? 'GET') === 'GET') return response(workflow);
      if (path.endsWith('/storyline-growth-candidates/candidate-1/decision')) return response({ accepted: true });
      if (path.endsWith('/editorial-team')) return response({ pools: [] });
      return new Response(JSON.stringify({ error: { message: `未配置 ${path}` } }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<StorylineWorkspace bookId="book-1" bookTitle="雾钟档案" onNext={vi.fn()} />);

    expect((await screen.findAllByText('寻找真相')).length).toBeGreaterThan(0);
    const originalHead = document.querySelector('.v6-storyline-board-head');
    expect(originalHead?.textContent).toContain('起点');
    expect(originalHead?.textContent).toContain('发展');
    expect(originalHead?.textContent).toContain('转折');
    expect(originalHead?.textContent).toContain('收束');
    expect(screen.getByText('已经发生')).toBeInTheDocument();
    expect(screen.getByText('正在推进')).toBeInTheDocument();
    expect(screen.getAllByText('我目前想到这里').length).toBeGreaterThan(0);
    expect(screen.getAllByText('还没决定').length).toBeGreaterThan(0);
    expect(screen.getByText('主编推荐下一段')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '编辑后采用' }));
    const direction = screen.getByRole('textbox', { name: '下一段方向' });
    fireEvent.change(direction, { target: { value: '作者调整后的追查方向' } });
    fireEvent.click(screen.getByRole('button', { name: '保存为作者计划' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/storyline-growth-candidates/candidate-1/decision'));
      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ decision: 'accepted', editedContent: { summary: '作者调整后的追查方向' } });
    });
  });});
