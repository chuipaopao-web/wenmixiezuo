// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VolumeExpressionWorkspace } from '../../../apps/web/src/features/core-workflow/VolumeExpressionWorkspace';

function api(data: unknown): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: 'request-expression', version: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const content = {
  title: '雾城卷', openingState: '主角没有退路', coreGoal: '取得行动资格', coreConflict: '旧规则阻止调查', failureCost: '盟友受损',
  characterChanges: ['开始承担选择'], eventSequence: [], informationPlan: ['逐层揭示规则'], escalationAndRecovery: ['压力升级后短暂恢复'],
  endingState: '主角站稳脚跟', openThreads: ['钟声来源'], nextVolumeTrigger: '幕后人出手',
  boundaries: { mustAchieve: ['选择改变局面'], mustNotViolate: ['不能无代价变强'], creativeFreedom: ['对白自由'], openQuestions: [] },
  expressionPlan: {
    narrativeOrder: '先结果后追因', pointOfView: '主角限知视角', emotionalTone: '压抑逐步转燃',
    proseStyle: '短句推动动作，选择处放慢', informationRelease: '只揭示足以改变选择的一层', transitions: '以动作结果切场',
    coordinatedBy: 'writer', sampleText: null, sampleDisclaimer: null
  }
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('V6分卷表达方案', () => {
  it('六维方案可编辑、按需示例、保存影响预览并确认后开放事件', async () => {
    let revision = 2;
    const onConfirmed = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/volume-plans') && (init?.method ?? 'GET') === 'GET') return api([{ volumePlanId: 'plan-1', planNumber: 1,
        physicalVolumeId: null, previousVolumePlanId: null, previousSettlementId: null, status: 'planning', revision,
        activeVersionId: 'version-1', activeVersion: { volumePlanVersionId: 'version-1', volumePlanId: 'plan-1', version: 1,
          parentVersionId: null, status: 'active', candidateKind: 'author_edit', dependencies: [],
          template: { templateId: 'volume-route', templateVersion: '1', methodVersionIds: [] }, authorInputRefs: [], content,
          contentHash: 'hash-1', sourceTaskId: null, createdAt: '2026-08-22T00:00:00.000Z', confirmedAt: '2026-08-22T00:01:00.000Z' },
        createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:01:00.000Z' }]);
      if (path.endsWith('/workflow')) return api({ planningVersion: 3 });
      if (path.endsWith('/editorial-team')) return api({ pools: [{ roleKey: 'writer', roleLabel: '主笔', desiredCount: 2, enabled: true, revision: 1,
        members: [{ memberId: 'writer-1', displayName: '秋香', roleKey: 'writer', roleLabel: '主笔', supplierCompany: 'OpenAI', baseCostTier: 'medium', status: 'available', avatarKey: 'writer', enabled: true },
          { memberId: 'writer-2', displayName: '湘君', roleKey: 'writer', roleLabel: '主笔', supplierCompany: '火山引擎', baseCostTier: 'medium', status: 'available', avatarKey: 'writer', enabled: true }] }] });
      if (path.endsWith('/volume-plans/plan-1/versions') && init?.method === 'POST') { revision = 3; return api({ volumePlanVersionId: 'version-2' }); }
      if (path.endsWith('/impact-preview')) return api({ candidateVersionId: 'version-2', note: '事件链需按新表达方案复核', invalidations: [] });
      if (path.endsWith('/confirm')) return api({ volumePlanId: 'plan-1' });
      return new Response(JSON.stringify({ error: { message: `未配置 ${path}` } }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<VolumeExpressionWorkspace bookId="book-1" onConfirmed={onConfirmed} />);

    expect(await screen.findByText('确定这一卷怎样讲出来')).toBeInTheDocument();
    expect(screen.getByDisplayValue('先结果后追因')).toBeInTheDocument();
    expect(screen.getByDisplayValue('主角限知视角')).toBeInTheDocument();
    expect(screen.getByDisplayValue('压抑逐步转燃')).toBeInTheDocument();
    expect(screen.getByDisplayValue('短句推动动作，选择处放慢')).toBeInTheDocument();
    expect(screen.getByDisplayValue('只揭示足以改变选择的一层')).toBeInTheDocument();
    expect(screen.getByDisplayValue('以动作结果切场')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('以动作结果切场'), { target: { value: '用因果结果自然切场' } });

    fireEvent.click(screen.getByRole('button', { name: /按需生成 200—500 字示例/ }));
    expect(screen.getByText('生成同一场景责任的表达示例')).toBeInTheDocument();
    expect(screen.getByText(/不进入正文或结算/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /保存表达方案并预览影响/ }));
    expect(await screen.findByText('事件链需按新表达方案复核')).toBeInTheDocument();
    const saved = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith('/plan-1/versions') && init?.method === 'POST');
    expect(JSON.parse(String(saved?.[1]?.body))).toMatchObject({ content: { expressionPlan: { transitions: '用因果结果自然切场' } } });

    fireEvent.click(screen.getByRole('button', { name: /确认卷方向与表达方案/ }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledOnce());
  });
});
