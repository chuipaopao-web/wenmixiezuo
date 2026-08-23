/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from '../../../apps/web/src/features/admin-console/AdminApp';

const mocks = vi.hoisted(() => ({
  fetchCurrentAccount: vi.fn(), loginAccount: vi.fn(), logoutAccount: vi.fn(),
  fetchDashboard: vi.fn(), fetchIssues: vi.fn(), fetchAiGovernance: vi.fn(), fetchFeatureCapabilities: vi.fn()
}));
const { fetchCurrentAccount, loginAccount, logoutAccount, fetchDashboard, fetchIssues, fetchAiGovernance, fetchFeatureCapabilities } = mocks;

vi.mock('../../../apps/web/src/lib/api/client', () => ({
  fetchCurrentAccount: mocks.fetchCurrentAccount,
  loginAccount: mocks.loginAccount,
  logoutAccount: mocks.logoutAccount
}));

vi.mock('../../../apps/web/src/features/admin-console/admin-api', () => ({
  fetchDashboard: mocks.fetchDashboard,
  fetchIssues: mocks.fetchIssues,
  fetchAiGovernance: mocks.fetchAiGovernance,
  fetchFeatureCapabilities: mocks.fetchFeatureCapabilities,
  fetchUserOperations: vi.fn().mockResolvedValue({ timezone: 'Asia/Shanghai', day: '2026-08-23', items: [] }),
  fetchAdminUsersPage: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  fetchMembershipUsers: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  fetchMembershipStats: vi.fn().mockResolvedValue({ summary: { activeMembers: 0, totalRevenueCashMicros: 0, monthRevenueCashMicros: 0, renewals: 0, expiringIn30Days: 0 }, byPlan: [], transactions: [] }),
  fetchModelScheme: vi.fn().mockResolvedValue({ source: 'default', updatedAt: null, updatedBy: null, profiles: {}, allowedModels: [], members: [] }),
  fetchNarrativeMethods: vi.fn().mockResolvedValue({ items: [] }),
  fetchPromptCatalog: vi.fn().mockResolvedValue({ triggers: [], members: [], purposes: [], overrides: [] }),
  fetchPromptCalls: vi.fn().mockResolvedValue({ items: [] }),
  fetchUsage: vi.fn().mockResolvedValue({ totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCashMicros: 0, totalCalls: 0, perUser: [], perModel: [], daily: [] }),
  setAdminUserStatus: vi.fn(), grantMembership: vi.fn(), revokeMembership: vi.fn(), saveModelScheme: vi.fn(),
  addAdminAiMember: vi.fn(), updateAdminAiMember: vi.fn(), createCreativeTemplateVersion: vi.fn(),
  activateCreativeTemplateVersion: vi.fn(), setCreativeTemplateRollout: vi.fn(),
  saveNarrativeMethod: vi.fn(), fetchRuntimeSystemPrompt: vi.fn(), savePromptOverride: vi.fn(),
  archivePromptOverride: vi.fn(), fetchPromptCall: vi.fn(), updateIssue: vi.fn()
}));

const account = {
  userId: 'admin-1', ownerId: 'owner-1', email: 'admin@example.com', displayName: '老板', role: 'admin' as const,
  status: 'active' as const, createdAt: '2026-08-21T00:00:00.000Z', lastLoginAt: null
};

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  fetchCurrentAccount.mockResolvedValue(account);
  fetchDashboard.mockResolvedValue({
    overview: { failedTasksToday: 2, apiCashMicrosToday: 1_500_000, activeMembers: 8, computeToday: 42_000,
      openIssues: 3, revenueCashMicros: 20_000_000, monthRevenueCashMicros: 10_000_000 },
    trend: [{ day: '2026-08-21', cashMicros: 1_500_000, compute: 42_000, calls: 4, revenueCashMicros: 0 }],
    business: { registeredUsers: 20, cumulativePaidUsers: 5, cumulativePaidRate: 0.25, newUsers30d: 4,
      firstPaidUsers30d: 1, firstPaidRate30d: 0.25, activePaidUsers: 4, recordedMembershipRevenueCashMicros: 20_000_000,
      definitions: { cumulativePaidRate: '累计曾付费普通用户 / 累计注册普通用户', firstPaidRate30d: '近30天首次付费普通用户 / 近30天新注册普通用户', revenue: '当前未接支付平台回调，不代表渠道实收。' } },
    topUsers: [], expiring: []
  });
  fetchIssues.mockResolvedValue({ items: [], total: 0 });
  fetchAiGovernance.mockResolvedValue({
    initialMemberCount: 25, roleCategoryCount: 7, books: [{ bookId: 'book-1', title: '测试书' }], actualMembers: [], storedSkills: [], templates: [], batches: [], calls: [],
    storylineQuality: { candidateCount: 0, acceptedCount: 0, rejectedCount: 0, observingCount: 0, duplicateCount: 0, noEvidenceCount: 0,
      incorrectFactMixCount: 0, adoptionRate: null, continueObservingRate: null, duplicateRate: null, noEvidenceRate: null,
      definitions: { adoption: '采纳率', duplicate: '重复率', noEvidence: '无证据率', incorrectFactMix: '事实混入率' } },
    codeSkills: [{ skillVersionId: 'skill-v6-core-2', layer: 'core', roleKey: null, nodeKind: null, version: 2, content: { name: '长篇创作核心' }, contentHash: 'a'.repeat(64) }]
  });
  const losses = [
    { id: 'book-branding-title-design', moduleId: 'opening-profile', moduleName: '开书资料与接续', surface: 'author',
      name: '主编设计书名', description: '生成书名候选', status: 'suspected_missing', currentAvailable: false, currentEntry: null,
      previousEntry: '信息页 → 书名 → 主编设计', decision: '后端仍在，前端入口缺失。', impact: '作者无法使用已有闭环。',
      recommendation: '恢复到修改开书资料。', evidence: ['apps/api/src/application/books/book-branding-design-service.ts'] },
    { id: 'book-branding-synopsis-design', moduleId: 'opening-profile', moduleName: '开书资料与接续', surface: 'author',
      name: '主编设计书籍简介', description: '生成简介候选', status: 'suspected_missing', currentAvailable: false, currentEntry: null,
      previousEntry: '信息页 → 简介 → 主编设计', decision: '后端仍在，前端入口缺失。', impact: '作者无法使用已有闭环。',
      recommendation: '恢复到修改开书资料。', evidence: ['apps/api/src/application/books/book-branding-pipeline-service.ts'] }
  ];
  fetchFeatureCapabilities.mockResolvedValue({
    registry: { version: 'feature-capability-registry-v1', updatedAt: '2026-08-23', current: { label: '当前代码', revision: 'current' },
      baseline: { key: 'stable-baseline', label: '早期稳定版本', revision: '61cb87b', purpose: '追查遗失' },
      availableBaselines: [
        { key: 'previous-production', label: '上一生产版本', revision: 'd98dc81', purpose: '检查升级' },
        { key: 'stable-baseline', label: '早期稳定版本', revision: '61cb87b', purpose: '追查遗失' }
      ],
      statusLabels: { added: '新增', retained: '保留', relocated: '迁移', replaced: '替代', retired: '明确下线', suspected_missing: '疑似遗失' },
      surfaceLabels: { author: '作者端', admin: '独立后台', system: '系统能力' } },
    summary: { modules: 33, capabilities: 130, currentAvailable: 122, filteredCapabilities: 2,
      statuses: { added: 30, retained: 92, relocated: 2, replaced: 3, retired: 1, suspected_missing: 2 } },
    moduleOptions: [{ id: 'opening-profile', name: '开书资料与接续', surface: 'author' }],
    modules: [{ id: 'opening-profile', name: '开书资料与接续', surface: 'author', capabilities: losses }],
    losses
  });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('独立管理后台前端', () => {
  it('生产入口按admin子域加载后台，主域不再使用/admin作为后台入口', () => {
    const source = readFileSync(resolve(process.cwd(), 'apps/web/src/main.tsx'), 'utf8');
    expect(source).toContain("hostname === 'admin.wenmixiezuo.com'");
    expect(source).toContain("hostname.startsWith('admin.')");
    expect(source).toContain('isLocalAdminPath');
    expect(source).toContain('isAdminHost || isLocalAdminPath');
  });
  it('管理员在独立壳层中看到十个模块和真实运营总览，并能切换问题中心', async () => {
    render(<AdminApp />);
    expect(await screen.findByRole('heading', { name: '运营总览' })).toBeInTheDocument();
    expect(screen.getByText('今日真实API支出')).toBeInTheDocument();
    expect(screen.getAllByText('¥1.50').length).toBeGreaterThan(0);
    expect(screen.getByText('累计付费率')).toBeInTheDocument();
    expect(screen.getAllByText('25.0%').length).toBeGreaterThan(0);
    expect(screen.getByText('已记录会员收入')).toBeInTheDocument();
    expect(screen.getByText('当前未接支付平台回调，不代表渠道实收。')).toBeInTheDocument();
    for (const label of ['用户', '算力', 'API消耗', '模型', '问题记录', '创作模板', '提示词', '会员', '功能台账']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('navigation', { name: '手机后台导航' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '问题记录' })[0]!);
    await waitFor(() => expect(fetchIssues).toHaveBeenCalled());
    expect((await screen.findAllByRole('heading', { name: '问题记录' })).length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe('/');
    expect(new URL(window.location.href).searchParams.get('section')).toBe('issues');
  });

  it('功能台账显示所有模块统计、历史基线和可核查的疑似遗失清单', async () => {
    render(<AdminApp />);
    await screen.findByRole('heading', { name: '运营总览' });
    fireEvent.click(screen.getAllByRole('button', { name: '功能台账' })[0]!);
    expect(await screen.findByRole('heading', { name: '功能台账' })).toBeInTheDocument();
    expect(screen.getByText('33')).toBeInTheDocument();
    expect(screen.getByText('130')).toBeInTheDocument();
    const lossesRegion = screen.getByRole('region', { name: '疑似遗失功能' });
    expect(within(lossesRegion).getByText('主编设计书名')).toBeInTheDocument();
    expect(within(lossesRegion).getByText('主编设计书籍简介')).toBeInTheDocument();
    expect(screen.getByLabelText('对照版本')).toBeInTheDocument();
    expect(fetchFeatureCapabilities).toHaveBeenCalled();
    expect(new URL(window.location.href).searchParams.get('section')).toBe('capabilities');
  });

  it('功能台账在慢请求时显示加载状态，并在返回后展示完整页面', async () => {
    const fixture = await fetchFeatureCapabilities();
    let release: ((value: unknown) => void) | undefined;
    fetchFeatureCapabilities.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    window.history.replaceState({}, '', '/?section=capabilities');
    render(<AdminApp />);
    expect(await screen.findByText('正在核对功能资产…')).toBeInTheDocument();
    release?.(fixture);
    expect(await screen.findByRole('heading', { name: '功能台账' })).toBeInTheDocument();
  });

  it('功能台账失败时可重试，筛选为空时有明确空状态', async () => {
    const fixture = await fetchFeatureCapabilities();
    fetchFeatureCapabilities.mockRejectedValueOnce(new Error('台账暂时不可用'));
    window.history.replaceState({}, '', '/?section=capabilities');
    render(<AdminApp />);
    expect(await screen.findByText('功能台账暂时不可用')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /重新加载/u }));
    expect(await screen.findByRole('heading', { name: '功能台账' })).toBeInTheDocument();
    cleanup();

    fetchFeatureCapabilities.mockResolvedValueOnce({
      ...fixture,
      summary: { ...fixture.summary, filteredCapabilities: 0 },
      modules: []
    });
    window.history.replaceState({}, '', '/?section=capabilities');
    render(<AdminApp />);
    expect(await screen.findByText('没有符合条件的功能')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除筛选' })).toBeInTheDocument();
  });

  it('转化率分母为零时在原经营指标区显示破折号', async () => {
    const baseline = await fetchDashboard();
    fetchDashboard.mockResolvedValueOnce({ ...baseline, business: {
      registeredUsers: 0, cumulativePaidUsers: 0, cumulativePaidRate: null, newUsers30d: 0, firstPaidUsers30d: 0,
      firstPaidRate30d: null, activePaidUsers: 0, recordedMembershipRevenueCashMicros: 0,
      definitions: { cumulativePaidRate: '定义', firstPaidRate30d: '定义', revenue: '当前未接支付平台回调。' }
    } });
    render(<AdminApp />);
    const business = await screen.findByRole('region', { name: '经营转化指标' });
    expect(within(business).getAllByText('—')).toHaveLength(2);
  });

  it('创作模板保留原叙事方法板块，并在其后显示25名成员、Skill与版本治理', async () => {
    render(<AdminApp />);
    await screen.findByRole('heading', { name: '运营总览' });
    fireEvent.click(screen.getAllByRole('button', { name: '创作模板' })[0]!);
    expect(await screen.findByRole('heading', { name: '创作模板与叙事方法' })).toBeInTheDocument();
    const sectionHeadings = screen.getAllByRole('heading', { level: 2 });
    expect(sectionHeadings[0]).toHaveTextContent('0 种内部方法');
    expect(screen.getByText('skill-v6-core-2')).toBeInTheDocument();
    expect(screen.getByText('新增第 26 名及更多成员')).toBeInTheDocument();
    expect(screen.getByText('故事线候选采纳率')).toBeInTheDocument();
    expect(fetchAiGovernance).toHaveBeenCalled();
  });

  it('普通作者即使直接打开后台子域也只看到拒绝页，不能渲染后台数据', async () => {
    fetchCurrentAccount.mockResolvedValue({ ...account, userId: 'writer-1', role: 'user' });
    render(<AdminApp />);
    expect(await screen.findByRole('heading', { name: '这个入口只用于平台管理' })).toBeInTheDocument();
    expect(fetchDashboard).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: '返回创作台' })).toHaveAttribute('href', '/');
  });

  it('未登录访问只显示独立后台登录，不会进入作者创作界面', async () => {
    fetchCurrentAccount.mockResolvedValue(null);
    render(<AdminApp />);
    expect(await screen.findByRole('heading', { name: '登录独立管理后台' })).toBeInTheDocument();
    expect(screen.getByLabelText('管理员邮箱')).toBeInTheDocument();
    expect(screen.queryByText('我的书籍')).not.toBeInTheDocument();
    expect(fetchDashboard).not.toHaveBeenCalled();
  });
});
