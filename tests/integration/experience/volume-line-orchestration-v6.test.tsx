// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreWorkflowV6View } from '@wenmi/contracts';
import { VolumeLineOrchestration } from '../../../apps/web/src/features/core-workflow/VolumeLineOrchestration';

vi.mock('../../../apps/web/src/features/core-workflow/V6Shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../apps/web/src/features/core-workflow/V6Shared')>();
  return { ...original, AiNodePanel: (props: { source: { content: string; reason: string } }) =>
    <pre data-testid="volume-ai-source">{props.source.reason}\n{props.source.content}</pre> };
});

const emptyLedgers: CoreWorkflowV6View['ledgers'] = {
  storyline: { planned: [], actual: [] }, relationship: { planned: [], actual: [] },
  world_state: { planned: [], actual: [] }, causality: { planned: [], actual: [] },
  foreshadow: { planned: [], actual: [] }, settlement: { planned: [], actual: [] }
};

const workflow: CoreWorkflowV6View = {
  contractVersion: 2, stage: 'volume', stateVersion: 2, blockingReason: null, growth: { frontiers: [], openQuestions: [], candidates: [], decisions: [] },
  storylines: [], relations: [], volumeParticipations: [], eventRoleAssignments: [], ledgers: emptyLedgers, drafts: [], invalidations: [],
  characters: [{ characterId: 'character-1', characterKind: 'protagonist', lifecycleStatus: 'active',
    activeVersionId: 'character-version-1', promotedFromCharacterId: null, version: 1, content: {
      name: '沈砚', roleSummary: '宗门杂役', desire: '查清师父失踪真相', currentState: '刚从禁地逃出',
      personalityTraits: ['冷静', '护短'], sourceOpeningVersion: 1, boundaries: ['不能无证据指控掌门'], storylineInfluences: []
    } }]
};

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: 'volume-source', version: 1 } }),
    { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('下一卷因果桥', () => {
  it('第一卷零故事线时从原人物卡与开局状态出发，不要求先补全书路线', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/core-workflow')) return response(workflow);
      if (path.endsWith('/volume-plans')) return response([{ volumePlanId: 'volume-plan-1', planNumber: 1,
        previousVolumePlanId: null, status: 'planning', activeVersion: { volumePlanVersionId: 'volume-version-1', content: {
          title: '禁地余波', openingState: '沈砚刚从禁地逃出', coreConflict: '宗门追查与师父线索同时逼近',
          coreGoal: '决定先保住证据还是营救同伴', endingState: '保住第一份可验证线索'
        } } }]);
      return new Response(JSON.stringify({ error: { message: `未配置 ${path}` } }), { status: 404 });
    }));

    render(<VolumeLineOrchestration bookId="book-1" bookTitle="阵骨问天" />);
    expect(await screen.findByText('第一卷从开局自然出发')).toBeInTheDocument();
    expect(screen.getByText('本卷暂不挂靠正式故事线')).toBeInTheDocument();
    const source = screen.getByTestId('volume-ai-source');
    expect(source).toHaveTextContent('沈砚');
    expect(source).toHaveTextContent('冷静');
    expect(source).toHaveTextContent('刚从禁地逃出');
    expect(source).toHaveTextContent('不要求全书故事线');
  });
});
