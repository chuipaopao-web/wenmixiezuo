/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from '../../../apps/web/src/features/admin-console/AdminApp';

const mocks = vi.hoisted(() => ({
  fetchCurrentAccount: vi.fn(), loginAccount: vi.fn(), logoutAccount: vi.fn(),
  fetchDashboard: vi.fn(), fetchIssues: vi.fn()
}));
const { fetchCurrentAccount, loginAccount, logoutAccount, fetchDashboard, fetchIssues } = mocks;

vi.mock('../../../apps/web/src/lib/api/client', () => ({
  fetchCurrentAccount: mocks.fetchCurrentAccount,
  loginAccount: mocks.loginAccount,
  logoutAccount: mocks.logoutAccount
}));

vi.mock('../../../apps/web/src/features/admin-console/admin-api', () => ({
  fetchDashboard: mocks.fetchDashboard,
  fetchIssues: mocks.fetchIssues,
  fetchAdminUsersPage: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  fetchMembershipUsers: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  fetchMembershipStats: vi.fn().mockResolvedValue({ summary: { activeMembers: 0, totalRevenueCashMicros: 0, monthRevenueCashMicros: 0, renewals: 0, expiringIn30Days: 0 }, byPlan: [], transactions: [] }),
  fetchModelScheme: vi.fn().mockResolvedValue({ source: 'default', updatedAt: null, updatedBy: null, profiles: {}, allowedModels: [], members: [] }),
  fetchNarrativeMethods: vi.fn().mockResolvedValue({ items: [] }),
  fetchPromptCatalog: vi.fn().mockResolvedValue({ triggers: [], members: [], purposes: [], overrides: [] }),
  fetchPromptCalls: vi.fn().mockResolvedValue({ items: [] }),
  fetchUsage: vi.fn().mockResolvedValue({ totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCashMicros: 0, totalCalls: 0, perUser: [], perModel: [], daily: [] }),
  setAdminUserStatus: vi.fn(), grantMembership: vi.fn(), revokeMembership: vi.fn(), saveModelScheme: vi.fn(),
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
    topUsers: [], expiring: []
  });
  fetchIssues.mockResolvedValue({ items: [], total: 0 });
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
  it('管理员在独立壳层中看到九个模块和真实运营总览，并能切换问题中心', async () => {
    render(<AdminApp />);
    expect(await screen.findByRole('heading', { name: '运营总览' })).toBeInTheDocument();
    expect(screen.getByText('今日真实API支出')).toBeInTheDocument();
    expect(screen.getAllByText('¥1.50').length).toBeGreaterThan(0);
    for (const label of ['用户', '算力', 'API消耗', '模型', '问题记录', '创作模板', '提示词', '会员']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('navigation', { name: '手机后台导航' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '问题记录' })[0]!);
    await waitFor(() => expect(fetchIssues).toHaveBeenCalled());
    expect((await screen.findAllByRole('heading', { name: '问题记录' })).length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe('/');
    expect(new URL(window.location.href).searchParams.get('section')).toBe('issues');
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
