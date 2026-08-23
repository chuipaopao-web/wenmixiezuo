// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EventRoleWorkspace } from '../../../apps/web/src/features/core-workflow/EventRoleWorkspace';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('按事件功能绑定已有角色，并把作者输入的新名字创建为待完善角色卡后绑定', async () => {
  const assignments: Array<Record<string, unknown>> = [];
  const characters: Array<Record<string, unknown>> = [{
    characterId: 'character-existing', characterKind: 'existing', lifecycleStatus: 'active',
    activeVersionId: 'character-existing-v1', promotedFromCharacterId: null, version: 1,
    content: { name: '林岚', roleSummary: '调查者', desire: '查明真相', currentState: '仍在观望', boundaries: [],
      storylineInfluences: [{ storylineId: 'line-main', influence: '推动调查线' }] }
  }];
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> | null }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1');
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? null : JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({ path: url.pathname, method, body });
    if (url.pathname.endsWith('/core-workflow')) return response(coreView(characters, assignments));
    if (url.pathname.endsWith('/volume-plans')) return response([volumePlan()]);
    if (url.pathname.endsWith('/event-chains')) return response([eventChain()]);
    if (url.pathname.endsWith('/editorial-team')) return response({ pools: [{ roleKey: 'screenwriter', members: [] }] });
    if (url.pathname.endsWith('/core-workflow/characters') && method === 'POST') {
      const content = body?.content as Record<string, unknown>;
      characters.push({ characterId: 'character-pending', characterKind: 'volume_new', lifecycleStatus: 'active',
        activeVersionId: 'character-pending-v1', promotedFromCharacterId: null, version: 1, content });
      return response({ characterId: 'character-pending', versionId: 'character-pending-v1' });
    }
    if (url.pathname.endsWith('/event-role-assignments') && method === 'PUT') {
      const roleKey = String(body?.roleFunctionKey);
      const next = {
        eventRoleAssignmentId: `assignment-${roleKey}`, eventChainVersionId: 'chain-active', eventNodeId: 'event-node-1',
        roleFunctionKey: roleKey, roleFunctionLabel: String(body?.roleFunctionLabel), requirement: body?.requirement,
        assignedCharacterId: body?.assignedCharacterId ?? null,
        assignmentStatus: body?.assignedCharacterId == null ? 'placeholder' : 'assigned', sourceCharacterVersionId: null
      };
      const index = assignments.findIndex((item) => item.roleFunctionKey === roleKey);
      if (index < 0) assignments.push(next); else assignments[index] = next;
      return response({ assignmentId: next.eventRoleAssignmentId });
    }
    return new Response(JSON.stringify({ error: { message: `未配置 ${method} ${url.pathname}` } }), { status: 404 });
  }));

  render(<EventRoleWorkspace bookId="book-event-roles" />);
  expect(await screen.findByRole('heading', { name: '先定功能，再决定由谁承担' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /核心对手.*待匹配角色/u }));
  fireEvent.change(screen.getByLabelText('优先匹配'), { target: { value: 'character-existing' } });
  fireEvent.click(screen.getByRole('button', { name: '绑定这个角色' }));
  await waitFor(() => expect(requests.some((item) => item.path.endsWith('/event-role-assignments')
    && item.body?.assignedCharacterId === 'character-existing')).toBe(true));
  expect(await screen.findByRole('button', { name: /核心对手.*林岚.*已绑定/u })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /线索提供者.*待匹配角色/u }));
  fireEvent.change(screen.getByPlaceholderText('输入作者指定的角色名'), { target: { value: '周砚' } });
  fireEvent.click(screen.getByRole('button', { name: '创建待完善角色卡并绑定' }));
  await waitFor(() => expect(requests.some((item) => item.path.endsWith('/core-workflow/characters')
    && (item.body?.content as Record<string, unknown>)?.name === '周砚')).toBe(true));
  expect(await screen.findByRole('button', { name: /线索提供者.*周砚.*已绑定/u })).toBeInTheDocument();
  expect(screen.getByText('全部角色功能已绑定')).toBeInTheDocument();
});

function coreView(characters: Array<Record<string, unknown>>, assignments: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    contractVersion: 1, stage: 'event', stateVersion: 4, blockingReason: null, relations: [], volumeParticipations: [],
    storylines: [{ storylineId: 'line-main', sortOrder: 1, lifecycleStatus: 'active', activeVersionId: 'line-main-v1',
      activeVersion: { storylineVersionId: 'line-main-v1', version: 1, status: 'active', baseVersion: 0,
        parentVersionId: null, sourceVersionIds: [], authorInputRefs: [],
        content: { title: '调查真相', lineKind: 'core', coreQuestion: '谁改写了档案？', stageGoal: '取得证据',
          expectedStages: ['发现'], associatedCharacterIds: [], foreshadowingKeys: [], rhythmMethodVersionId: 'method-1' },
        contentHash: 'sha256:' + '1'.repeat(64), createdAt: '2026-08-22T00:00:00.000Z', confirmedAt: '2026-08-22T00:00:00.000Z' },
      versions: [] }],
    characters, eventRoleAssignments: assignments,
    ledgers: Object.fromEntries(['storyline', 'relationship', 'world_state', 'causality', 'foreshadow', 'settlement']
      .map((key) => [key, { planned: [], actual: [] }])), drafts: [], invalidations: []
  };
}

function volumePlan(): Record<string, unknown> {
  return { volumePlanId: 'volume-1', planNumber: 1, status: 'active', revision: 2, activeVersionId: 'volume-v1',
    activeVersion: { volumePlanVersionId: 'volume-v1', content: { title: '第一卷' } } };
}

function eventChain(): Record<string, unknown> {
  return { id: 'chain-active', bookId: 'book-event-roles', volumePlanId: 'volume-1', version: 1, status: 'active',
    sourceVersionIds: [], contentHash: 'sha256:' + '2'.repeat(64), createdAt: '2026-08-22T00:00:00.000Z', confirmedAt: '2026-08-22T00:00:00.000Z',
    content: { volumeDirectionVersionId: 'direction-v1', coverage: [{ responsibility: 'volume_goal', eventNodeIds: ['event-node-1'], status: 'covered' }],
      events: [{ nodeId: 'event-node-1', order: 1, title: '档案馆封锁', volumeResponsibility: '取得第一份证据',
        entryState: '主角尚未掌握证据', protagonistAction: '主角进入档案馆核验', oppositionEscalation: '封锁升级',
        stagePayoffOrCost: '拿到证据但暴露身份', exitState: '调查转为公开冲突', leadsToNext: null,
        leadingStorylineId: 'line-main', supportingStorylineIds: [], intersectionNote: null,
        roleFunctions: [
          { roleFunctionKey: 'opponent', roleFunctionLabel: '核心对手', requirement: '封锁证据并逼主角公开选择', importance: 'core' },
          { roleFunctionKey: 'clue-holder', roleFunctionLabel: '线索提供者', requirement: '交出可验证线索并承担风险', importance: 'supporting' }
        ], plantThreadIds: [], payoffThreadIds: [], consequenceThreadIds: [], firstVolumeResponsibilities: [] }] }
  };
}

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: 'event-role-test', version: 1 } }),
    { status: 200, headers: { 'content-type': 'application/json' } });
}
