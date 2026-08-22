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
    contractVersion: 1, stage: 'storyline', stateVersion: 1, blockingReason: null,
    topology: { active: active ? {
      topologyVersionId: 'topology-1', version: 1, topologyType: 'core_with_branches', content: {
        topologyType: 'core_with_branches', plainLanguageReason: '核心问题牵引，支线服务核心线。',
        lineResponsibilities: ['核心线回答全书问题', '支线检验选择'], authorNotes: null
      }, contentHash: 'topology-hash'
    } : null, candidates: [] },
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
  it('默认只显示一个白话推荐，可展开四种拓扑并直接确认选择', async () => {
    let confirmed = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/core-workflow') && (init?.method ?? 'GET') === 'GET') return response(view(confirmed));
      if (path.endsWith('/storyline-topology/versions')) return response({ topologyVersionId: 'topology-1' });
      if (path.endsWith('/storyline-topology/versions/topology-1/confirm')) { confirmed = true; return response({ confirmed: true }); }
      if (path.endsWith('/editorial-team')) return response({ pools: [] });
      return new Response(JSON.stringify({ error: { message: `未配置 ${path}` } }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<StorylineWorkspace bookId="book-1" bookTitle="雾钟档案" onNext={() => undefined} />);

    expect(await screen.findByText('一条核心线 + 支线')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /双核心线/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '自己选择其他结构' }));
    expect(screen.getByRole('button', { name: /双核心线/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /双核心线/ }));
    fireEvent.click(screen.getByRole('button', { name: /直接接受/ }));
    expect(await screen.findByText(/全书结构已确认/)).toBeInTheDocument();
    const saved = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/storyline-topology/versions'));
    expect(JSON.parse(String(saved?.[1]?.body))).toMatchObject({ content: { topologyType: 'dual_core' } });
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/topology-1/confirm'))).toBe(true);
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

    fireEvent.click(screen.getByRole('button', { name: /确认故事线并进入分卷/ }));
    expect(onNext).toHaveBeenCalledOnce();
  });
});
