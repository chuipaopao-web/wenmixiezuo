// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentGovernancePage } from './AgentGovernancePage';

const governance = {
  openingEvaluation: {version:'fixture',testedAt:'2026-09-06T14:00:00Z',scope:'合成开书样本，不能代替上岗验证。',rows:[
    {profileKey:'deepseek-v4-pro',node:'design',milliseconds:64000,structurePassed:true,quality:'passed',assessment:'保留作者明确约束。',outputTokens:3600},
    {profileKey:'glm-5.3',node:'review',milliseconds:180000,structurePassed:false,quality:'unverified',assessment:'超时，暂不上岗。',outputTokens:null}
  ]},
  revision: 7,
  summary: { roleCount: 7, memberCount: 22, onDutyCount: 22, leaveCount: 0 },
  credentials: { codingPlan: true, agentPlan: true, image: true },
  modelProfiles: [{ profileKey: 'glm-5.3', publicName: 'GLM 5.3' }, { profileKey: 'deepseek-v4-pro', publicName: 'DeepSeek V4 Pro' }],
  roles: [{
    roleKey: 'lead_writer', publicName: '主笔', publicResponsibility: '完成正式正文。',
    capabilities: ['正文写作'], tools: ['正式资料包'], outputContract: '只交付正文。', failureContract: '失败时道歉并交接。',
    authorSelectable: true, allowedModelProfileKeys: ['glm-5.3', 'deepseek-v4-pro'],
    members: [{ memberKey: 'writer-glm-5-3', displayName: '林黛玉', modelProfileKey: 'glm-5.3', modelName: 'GLM 5.3',
      provider: 'volcengine-ark-coding-plan', plan: 'coding', enabled: true, defaultForRole: true, fallbackPriority: 1,
      temperatureAdjustment: 0, promptInstruction: '', credentialReady: true, status: 'on_duty' }]
  }, {
    roleKey: 'independent_reviewer', publicName: '独立审查', publicResponsibility: '独立审查正文。',
    capabilities: ['连续性审查'], tools: ['正文'], outputContract: '交付结论。', failureContract: '失败时交接。',
    authorSelectable: true, allowedModelProfileKeys: ['glm-5.3', 'deepseek-v4-pro'],
    members: [{ memberKey: 'review-deepseek-v4-pro', displayName: '陆婉宁', modelProfileKey: 'deepseek-v4-pro', modelName: 'DeepSeek V4 Pro',
      provider: 'volcengine-ark-coding-plan', plan: 'coding', enabled: true, defaultForRole: true, fallbackPriority: 1,
      temperatureAdjustment: 0, promptInstruction: '', credentialReady: true, status: 'on_duty' }]
  }],
  taskPolicies: [{ taskKind: 'manuscript', publicName: '正文写作', defaultTemperature: .72, minimumTemperature: .55, maximumTemperature: .82, rationale: '保持创意与稳定。', revision: 1 }]
};

describe('V7统一成员治理后台', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  afterEach(() => cleanup());
  beforeEach(() => {
    history.replaceState({},'', '/v7/?section=agents');
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/admin/v7/agent-governance') && init?.method === undefined) return json(governance);
      if (url.includes('/agent-governance/members/') && init?.method === 'PATCH') return json({ ...governance, revision: 8 });
      if (url.includes('/agent-governance/task-policies/') && init?.method === 'PATCH') return json({ ...governance, revision: 8 });
      if(url.includes('/prompt-context/assets')||url.includes('/prompt-context/manifests?'))return json([]);
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('统一显示固定主笔、独立审查和按任务温度', async () => {
    render(<AgentGovernancePage/>);
    expect(await screen.findByRole('heading', { name: '成员与上下文' })).toBeVisible();
    expect(screen.getByText('林黛玉')).toBeVisible();
    expect(screen.getByText('陆婉宁')).toBeVisible();
    fireEvent.change(screen.getByLabelText('查找成员或模型'), { target: { value: 'DeepSeek' } });
    expect(screen.queryByText('林黛玉')).not.toBeInTheDocument();
    expect(screen.getByText('陆婉宁')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '任务参数' }));
    expect(screen.getByText('性能与温度')).toBeVisible();
  });

  it('将节点耗时、结构、内容和上岗边界分别显示', async () => {
    render(<AgentGovernancePage/>);
    fireEvent.click(await screen.findByRole('tab', { name: '开书速度与准入' }));
    const report=await screen.findByRole('region',{name:'开书节点评测'});
    expect(within(report).getByText('开书设计 · 64秒')).toBeVisible();
    expect(within(report).getByText('开书审查 · 180秒')).toBeVisible();
    expect(within(report).getByText('字段结构通过 · 内容样本通过')).toBeVisible();
    expect(within(report).getByText('未正常交付 · 内容未验证')).toBeVisible();
    expect(within(report).getByRole('region',{name:'开书设计速度榜'})).toBeVisible();
    expect(within(report).getByRole('region',{name:'开书审查速度榜'})).toBeVisible();
    expect(within(report).getByText(/第1名/)).toBeVisible();
  });

  it('成员独立页按成员读取资料，并携带全局版本保存模型', async () => {
    render(<AgentGovernancePage/>);
    fireEvent.click(await screen.findByRole('button',{name:'管理林黛玉的资料与工位'}));
    expect(new URL(location.href).searchParams.get('member')).toBe('writer-glm-5-3');
    expect(await screen.findByText(/还没有可展示的调用记录/)).toBeVisible();
    expect(fetchMock.mock.calls.some(([url])=>String(url).includes('memberKey=writer-glm-5-3'))).toBe(true);
    fireEvent.click(screen.getByRole('tab',{name:'模型与状态'}));
    const card = screen.getByLabelText('绑定模型').closest('article');
    expect(card).not.toBeNull();
    expect(screen.queryByText('成员补充提示')).not.toBeInTheDocument();
    fireEvent.change(within(card!).getByLabelText('绑定模型'), { target: { value: 'deepseek-v4-pro' } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/members/writer-glm-5-3') && init?.method === 'PATCH')).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/members/writer-glm-5-3'));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ expectedRevision: 7, modelProfileKey: 'deepseek-v4-pro' });
  });
});

function json(data: unknown): Response { return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }); }
