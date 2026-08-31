// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentGovernancePage } from './AgentGovernancePage';

const members = [
  ['setting-chief-1', '一号主编', 'chief_editor', 'deepseek-v4-pro', 'coding'],
  ['setting-deputy-1', '一号副编', 'deputy_editor', 'glm-5.3', 'coding'],
  ...Array.from({ length: 7 }, (_, index) => [`setting-writer-${index + 1}`, `${index + 1}号编剧`, 'screenwriter', index === 6 ? 'kimi-k3' : `model-${index + 1}`, index === 6 ? 'agent' : 'coding'])
].map(([memberKey, displayName, roleKey, modelId, plan], index) => ({
  memberKey, displayName, roleKey, publicResponsibility: roleKey === 'chief_editor' ? '最终审查' : roleKey === 'deputy_editor' ? '按需资料转译' : '设计设定条目',
  enabledByDefault: true, fallbackPriority: index + 1, model: { provider: 'ark', modelId, plan }, enabled: true, revision: 1, credentialReady: true
}));

const openingGovernance = {
  summary: { roleCount: 2, memberCount: 2, enabledMemberCount: 2, unavailableMemberCount: 0 },
  credentials: { codingPlanConfigured: true, agentPlanConfigured: true },
  roles: [{
    roleKey: 'chief_editor', publicName: '主编', responsibility: '理解作者想法并最终审查',
    revision: 1, updatedAt: '2026-08-25T10:00:00.000Z',
    members: [{
      memberKey: 'chief-kimi-k3', displayName: '沈知微', modelId: 'kimi-k3', plan: 'agent',
      planName: 'Agent Plan', enabled: true, defaultForRole: true, fallbackPriority: 1,
      credential: { configured: true, message: '已配置' },
      basePrompt: '忠实理解作者原话，锁定明确主角，并审查开书资料。', promptInstruction: ''
    }]
  }, {
    roleKey: 'screenwriter', publicName: '编剧', responsibility: '完成结构化开书资料',
    revision: 1, updatedAt: '2026-08-25T10:00:00.000Z',
    members: [{
      memberKey: 'screenwriter-deepseek-v4-pro', displayName: '红玉', modelId: 'deepseek-v4-pro', plan: 'coding',
      planName: 'Coding Plan', enabled: true, defaultForRole: true, fallbackPriority: 1,
      credential: { configured: true, message: '已配置' },
      basePrompt: '按固定结构设计完整开书资料，不留空。', promptInstruction: ''
    }]
  }]
};

describe.skip('已被统一成员治理替代的旧分页面', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  afterEach(() => cleanup());
  beforeEach(() => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/admin/v7/setting-agent/members') && init?.method !== 'PATCH') return json(members);
      if (url.endsWith('/setting-writer-2') && init?.method === 'PATCH') return json({ ...members.find((member) => member.memberKey === 'setting-writer-2'), enabled: false, revision: 2 });
      if (url.endsWith('/api/v1/admin/v7/opening-agent/members') && init?.method !== 'PATCH') return json(openingGovernance);
      if (url.endsWith('/api/v1/admin/v7/visual-agent/members')) return json({
        credentials: { agentPlanConfigured: true, imageCapabilityConfigured: true },
        members: [{
          memberKey: 'visual-seedream', displayName: '绘真', roleName: '封面画师',
          responsibility: '交付可下载封面', modelId: 'doubao-seedream-5-0-260128', planName: 'Agent Plan · Seedream',
          credentialReady: true, status: 'on_duty'
        }]
      });
      if (url.endsWith('/chief-kimi-k3') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { promptInstruction?: string };
        return json({
          ...openingGovernance,
          roles: openingGovernance.roles.map((role) => role.roleKey !== 'chief_editor' ? role : {
            ...role, revision: 2,
            members: role.members.map((member) => ({ ...member, promptInstruction: body.promptInstruction ?? '' }))
          })
        });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('默认显示主编、副编与七名编剧，并用请假/返岗管理成员', async () => {
    render(<AgentGovernancePage />);
    expect(await screen.findByRole('heading', { name: '设定编辑部' })).toBeVisible();
    expect(screen.getByText('一号主编')).toBeVisible();
    expect(screen.getByText('一号副编')).toBeVisible();
    expect(screen.getByText('7号编剧')).toBeVisible();
    const writer = screen.getByText('2号编剧').closest('article');
    expect(writer).not.toBeNull();
    fireEvent.click(within(writer!).getByRole('button', { name: '请假' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/setting-writer-2'), expect.objectContaining({ method: 'PATCH' })));
    expect(await within(writer!).findByText('请假中')).toBeVisible();
  });

  it('开书团队可查看基础提示词并保存每名成员的补充提示词', async () => {
    render(<AgentGovernancePage />);
    fireEvent.click(screen.getByRole('button', { name: '开书团队' }));
    expect(await screen.findByRole('heading', { name: '开书创作团队' })).toBeVisible();
    const chiefCard = screen.getByText('沈知微').closest('article');
    expect(chiefCard).not.toBeNull();
    fireEvent.click(within(chiefCard!).getByText('查看与配置提示词'));
    expect(within(chiefCard!).getByDisplayValue('忠实理解作者原话，锁定明确主角，并审查开书资料。')).toHaveAttribute('readonly');
    fireEvent.change(within(chiefCard!).getByPlaceholderText(/可补充这名成员/u), {
      target: { value: '优先给出具体、直给、能看懂卖点的番茄风格书名。' }
    });
    fireEvent.click(within(chiefCard!).getByRole('button', { name: '保存补充提示' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).endsWith('/chief-kimi-k3') && init?.method === 'PATCH'
    )).toBe(true));
    const promptCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).endsWith('/chief-kimi-k3') && init?.method === 'PATCH'
    );
    expect(JSON.parse(String(promptCall?.[1]?.body))).toMatchObject({
      expectedRevision: 1,
      promptInstruction: '优先给出具体、直给、能看懂卖点的番茄风格书名。'
    });
  });

  it('封面编辑部只显示真正执行出图的封面画师', async () => {
    render(<AgentGovernancePage />);
    fireEvent.click(screen.getByRole('button', { name: '封面编辑部' }));
    expect(await screen.findByRole('heading', { name: '封面编辑部' })).toBeVisible();
    expect(screen.getByText('绘真')).toBeVisible();
    expect(screen.getByText('doubao-seedream-5-0-260128')).toBeVisible();
    expect(screen.getAllByText('在岗')).toHaveLength(1);
    expect(screen.queryByText('请假中')).not.toBeInTheDocument();
  });
});

function json(data: unknown): Response { return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } }); }
