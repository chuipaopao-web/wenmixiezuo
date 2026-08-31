// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentGovernancePage } from './AgentGovernancePage';

const governance = {
  revision: 7,
  summary: { roleCount: 7, memberCount: 22, onDutyCount: 22, leaveCount: 0 },
  credentials: { codingPlan: true, agentPlan: true, image: true },
  modelProfiles: [{ profileKey: 'glm-5.3', publicName: 'GLM 5.3' }, { profileKey: 'deepseek-v4-pro', publicName: 'DeepSeek V4 Pro' }],
  roles: [{
    roleKey: 'lead_writer', publicName: '主笔', publicResponsibility: '完成正式正文。',
    capabilities: ['正文写作'], tools: ['正式资料包'], outputContract: '只交付正文。', failureContract: '失败时道歉并交接。',
    authorSelectable: true, allowedModelProfileKeys: ['glm-5.3', 'deepseek-v4-pro'],
    members: [{ memberKey: 'writer-glm-5-3', displayName: '曹雪芹', modelProfileKey: 'glm-5.3', modelName: 'GLM 5.3',
      provider: 'volcengine-ark-coding-plan', plan: 'coding', enabled: true, defaultForRole: true, fallbackPriority: 1,
      temperatureAdjustment: 0, promptInstruction: '', credentialReady: true, status: 'on_duty' }]
  }, {
    roleKey: 'independent_reviewer', publicName: '独立审查', publicResponsibility: '独立审查正文。',
    capabilities: ['连续性审查'], tools: ['正文'], outputContract: '交付结论。', failureContract: '失败时交接。',
    authorSelectable: true, allowedModelProfileKeys: ['glm-5.3', 'deepseek-v4-pro'],
    members: [{ memberKey: 'review-deepseek-v4-pro', displayName: '陆观澜', modelProfileKey: 'deepseek-v4-pro', modelName: 'DeepSeek V4 Pro',
      provider: 'volcengine-ark-coding-plan', plan: 'coding', enabled: true, defaultForRole: true, fallbackPriority: 1,
      temperatureAdjustment: 0, promptInstruction: '', credentialReady: true, status: 'on_duty' }]
  }],
  taskPolicies: [{ taskKind: 'manuscript', publicName: '正文写作', defaultTemperature: .72, minimumTemperature: .55, maximumTemperature: .82, rationale: '保持创意与稳定。', revision: 1 }]
};

describe('V7统一成员治理后台', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  afterEach(() => cleanup());
  beforeEach(() => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/admin/v7/agent-governance') && init?.method === undefined) return json(governance);
      if (url.includes('/agent-governance/members/') && init?.method === 'PATCH') return json({ ...governance, revision: 8 });
      if (url.includes('/agent-governance/task-policies/') && init?.method === 'PATCH') return json({ ...governance, revision: 8 });
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('统一显示固定主笔、独立审查和按任务温度', async () => {
    render(<AgentGovernancePage/>);
    expect(await screen.findByRole('heading', { name: 'V7创作团队' })).toBeVisible();
    expect(screen.getByText('曹雪芹')).toBeVisible();
    expect(screen.getByText('陆观澜')).toBeVisible();
    expect(screen.getByText('性能与温度')).toBeVisible();
  });

  it('成员页只管理身份模型与可用性，并携带全局版本保存模型', async () => {
    render(<AgentGovernancePage/>);
    const card = (await screen.findByText('曹雪芹')).closest('article');
    expect(card).not.toBeNull();
    expect(screen.queryByText('成员补充提示')).not.toBeInTheDocument();
    expect(screen.getByText(/成员只长期绑定模型与可用性/)).toBeVisible();
    expect(screen.getByText(/资料策划 Agent 签发本轮题材身份/)).toBeVisible();
    fireEvent.change(within(card!).getByLabelText('绑定模型'), { target: { value: 'deepseek-v4-pro' } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/members/writer-glm-5-3') && init?.method === 'PATCH')).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/members/writer-glm-5-3'));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ expectedRevision: 7, modelProfileKey: 'deepseek-v4-pro' });
  });
});

function json(data: unknown): Response { return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }); }
