// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformPage } from './PlatformPages';
import * as api from './platform-api';
import type {
  MembershipStats,
  MembershipUser,
  PlatformDashboard,
  PlatformIssue,
  PlatformUsage,
  PlatformUser,
  UserOperation
} from './platform-api';

vi.mock('./platform-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./platform-api')>();
  return {
    ...actual,
    fetchPlatformDashboard: vi.fn(),
    fetchPlatformUsage: vi.fn(),
    fetchPlatformUsers: vi.fn(),
    fetchUserOperations: vi.fn(),
    setPlatformUserStatus: vi.fn(),
    fetchPlatformIssues: vi.fn(),
    updatePlatformIssue: vi.fn(),
    fetchMembershipStats: vi.fn(),
    fetchMembershipUsers: vi.fn(),
    grantMembership: vi.fn(),
    revokeMembership: vi.fn()
  };
});

const mockedApi = vi.mocked(api);

const dashboard: PlatformDashboard = {
  overview: {
    failedTasksToday: 0,
    apiCashMicrosToday: 1_250_000,
    activeMembers: 8,
    computeToday: 2_400,
    imageUnitsToday: 4,
    reservedImageUnits: 2,
    openIssues: 1,
    revenueCashMicros: 8_800_000,
    monthRevenueCashMicros: 6_600_000
  },
  business: {
    registeredUsers: 20,
    cumulativePaidUsers: 8,
    cumulativePaidRate: 0.4,
    newUsers30d: 3,
    firstPaidUsers30d: 1,
    firstPaidRate30d: 1 / 3,
    activePaidUsers: 8,
    recordedMembershipRevenueCashMicros: 8_800_000
  },
  trend: [{ day: '2026-08-30', cashMicros: 1_250_000, compute: 2_400, imageUnits: 1, calls: 3, revenueCashMicros: 2_500_000 }],
  topUsers: [{ userId: 'user-1', displayName: '作者甲', email: 'author@example.com', compute: 1_600, cashMicros: 800_000, imageUnits: 3, calls: 2 }],
  expiring: []
};

const usage: PlatformUsage = {
  totalTokens: 2_000,
  totalInputTokens: 1_200,
  totalOutputTokens: 800,
  totalCashMicros: 1_500_000,
  totalImageUnits: 6,
  totalReservedImageUnits: 2,
  totalCalls: 5,
  perUser: [{
    userId: 'user-1', email: 'author@example.com', displayName: '作者甲', role: 'user', status: 'active',
    books: 1, tokens: 1_500, calls: 4, cashMicros: 1_200_000, imageUnits: 5, reservedImageUnits: 2
  }],
  perModel: [{ provider: 'image-provider', modelId: 'cover-model', calls: 4, tokens: 1_500, cashMicros: 1_200_000, imageUnits: 5 }],
  daily: [{ day: '2026-08-30', tokens: 1_500, calls: 4, cashMicros: 1_200_000, imageUnits: 5 }]
};

const platformUser: PlatformUser = {
  userId: 'user-1', email: 'author@example.com', displayName: '作者甲', role: 'user', status: 'active',
  createdAt: '2026-08-01T09:00:00.000Z', lastLoginAt: '2026-08-30T08:00:00.000Z'
};

const userOperation: UserOperation = {
  userId: 'user-1', email: 'author@example.com', displayName: '作者甲', status: 'active',
  createdAt: '2026-08-01T09:00:00.000Z', lastLoginAt: '2026-08-30T08:00:00.000Z', lastActivityAt: '2026-08-30T09:00:00.000Z',
  membership: null, bookCount: 1, activeBookCount: 1, archivedBookCount: 0,
  today: { day: '2026-08-30', taskCount: 2, failed: false, failureCount: 0 },
  books: [{
    bookId: 'book-1', title: '第一本书', status: 'active', workflowStage: 'chapter', currentVolume: 1,
    currentEvent: 2, currentChapter: 3, latestManuscriptAt: null, latestSettlementAt: null,
    latestTaskId: 'task-1', latestTaskStatus: 'completed', latestTaskAt: '2026-08-30T09:00:00.000Z'
  }],
  failures: []
};

const issue: PlatformIssue = {
  sourceType: 'feedback', sourceId: 'feedback-1', taskId: null, bookId: 'book-1', bookTitle: '第一本书',
  userId: 'user-1', displayName: '作者甲', email: 'author@example.com', category: '页面问题', detail: '章节按钮无法点击',
  errorCode: null, pagePath: '/books/book-1/chapters', occurredAt: '2026-08-30T09:30:00.000Z',
  status: 'open', severity: 'medium', note: ''
};

const membershipStats: MembershipStats = {
  summary: { activeMembers: 0, totalRevenueCashMicros: 0, monthRevenueCashMicros: 0, renewals: 0, expiringIn30Days: 0 },
  byPlan: [],
  transactions: []
};

const membershipUser: MembershipUser = {
  userId: 'user-1', displayName: '作者甲', email: 'author@example.com', role: 'user', accountStatus: 'active',
  membership: null, totalTokens: 1_000
};

const activeMembershipUser: MembershipUser = {
  ...membershipUser,
  membership: {
    plan: 'silver', planLabel: '白银会员', status: 'active', tokenQuota: 20_000_000, periodTokens: 1_000,
    totalTokens: 1_000, periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2027-08-01T00:00:00.000Z', expired: false
  }
};

const bronzeMembershipUser: MembershipUser = {
  ...membershipUser,
  membership: {
    plan: 'bronze', planLabel: '青铜会员', status: 'active', tokenQuota: 200_000, periodTokens: 0,
    totalTokens: 0, periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2099-12-31T00:00:00.000Z', expired: false
  }
};

describe('V7 独立后台平台页面', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    mockedApi.fetchPlatformDashboard.mockResolvedValue(dashboard);
    mockedApi.fetchPlatformUsage.mockResolvedValue(usage);
    mockedApi.fetchPlatformUsers.mockResolvedValue({ items: [platformUser], total: 1 });
    mockedApi.fetchUserOperations.mockResolvedValue({ timezone: 'Asia/Shanghai', day: '2026-08-30', items: [userOperation] });
    mockedApi.setPlatformUserStatus.mockResolvedValue(platformUser);
    mockedApi.fetchPlatformIssues.mockResolvedValue({ items: [issue], total: 1 });
    mockedApi.updatePlatformIssue.mockResolvedValue({});
    mockedApi.fetchMembershipStats.mockResolvedValue(membershipStats);
    mockedApi.fetchMembershipUsers.mockResolvedValue({ items: [membershipUser], total: 1 });
    mockedApi.grantMembership.mockResolvedValue({});
    mockedApi.revokeMembership.mockResolvedValue({ revoked: true });
  });

  afterEach(cleanup);

  it('运营总览区分今日已制作图片与仍在制作中的占用', async () => {
    render(<PlatformPage section="operations" />);
    expect(await screen.findByText('平台运营总览')).toBeVisible();

    const completed = screen.getByText('今日图片已制作').closest('article');
    const reserved = screen.getByText('图片制作中占用').closest('article');
    expect(completed).not.toBeNull();
    expect(reserved).not.toBeNull();
    expect(within(completed as HTMLElement).getByText('4 张')).toBeVisible();
    expect(within(reserved as HTMLElement).getByText('2 张')).toBeVisible();
    expect(screen.getByText(/图片 1 张/u)).toBeVisible();

    const highUsage = screen.getByText('近期高用量用户').closest('section');
    expect(highUsage).not.toBeNull();
    expect(within(highUsage as HTMLElement).getByText('3 张')).toBeVisible();
  });

  it('用量页展示图片累计完成、制作中占用和必要的用户模型明细', async () => {
    render(<PlatformPage section="usage" />);
    expect(await screen.findByText('算力、图片与 API 成本')).toBeVisible();

    const completed = screen.getByText('图片已制作', { selector: '.platform-metric span' }).closest('article');
    const reserved = screen.getByText('制作中占用', { selector: '.platform-metric span' }).closest('article');
    expect(within(completed as HTMLElement).getByText('6 张')).toBeVisible();
    expect(within(reserved as HTMLElement).getByText('2 张')).toBeVisible();
    expect(screen.getByText('5 张已制作')).toBeVisible();
    expect(screen.getByText('2 张制作中占用')).toBeVisible();
    expect(screen.queryByText(/imageUnits|reservedImageUnits/u)).not.toBeInTheDocument();
  });

  it('390px 下原位暂停用户并在写入后重新读取权威数据', async () => {
    render(<PlatformPage section="users" currentAccountId="admin-1" />);
    expect(await screen.findByText('用户与书籍活动')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    expect(screen.getByRole('region', { name: '作者甲 用户管理' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '暂停账号' }));
    expect(screen.getByRole('button', { name: '确认暂停账号' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认暂停账号' }));

    await waitFor(() => expect(mockedApi.setPlatformUserStatus).toHaveBeenCalledWith('user-1', 'suspended'));
    await waitFor(() => expect(mockedApi.fetchPlatformUsers).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/已暂停 作者甲 的账号/u)).toBeVisible();
  });

  it('已暂停用户的恢复主操作在原位可达', async () => {
    mockedApi.fetchPlatformUsers.mockResolvedValue({ items: [{ ...platformUser, status: 'suspended' }], total: 1 });
    render(<PlatformPage section="users" currentAccountId="admin-1" />);
    expect(await screen.findByText('用户与书籍活动')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '管理' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复账号' }));

    await waitFor(() => expect(mockedApi.setPlatformUserStatus).toHaveBeenCalledWith('user-1', 'active'));
    await waitFor(() => expect(mockedApi.fetchUserOperations).toHaveBeenCalledTimes(2));
  });

  it('390px 下原位办理会员并同时刷新用户与流水', async () => {
    render(<PlatformPage section="memberships" />);
    expect(await screen.findByText('会员与收入')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '办理' }));
    expect(screen.getByRole('region', { name: '为 作者甲 办理会员' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('会员套餐'), { target: { value: 'gold' } });
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '线下转账' } });
    fireEvent.click(screen.getByRole('button', { name: '开通并记录收入' }));

    await waitFor(() => expect(mockedApi.grantMembership).toHaveBeenCalledWith('user-1', {
      plan: 'gold', amountCny: 198, note: '线下转账', idempotencyKey: expect.stringMatching(/^membership-/u)
    }));
    await waitFor(() => expect(mockedApi.fetchMembershipUsers).toHaveBeenCalledTimes(2));
    expect(mockedApi.fetchMembershipStats).toHaveBeenCalledTimes(2);
  });

  it('青铜用户办理时默认升级白银，并明确付费周期从当天开始', async () => {
    mockedApi.fetchMembershipUsers.mockResolvedValue({ items: [bronzeMembershipUser], total: 1 });
    render(<PlatformPage section="memberships" />);
    expect(await screen.findByText('会员与收入')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '办理' }));
    expect(screen.getByLabelText('会员套餐')).toHaveValue('silver');
    expect(screen.getByLabelText('本次实收金额（元）')).toHaveValue(98);
    expect(screen.getByRole('button', { name: '升级并记录收入' })).toBeVisible();
    expect(screen.getByText(/从办理当天开始计算12个月/u)).toBeVisible();
    expect(screen.getByRole('option', { name: '青铜 · 20万算力' })).toBeDisabled();
  });

  it('会员写入失败时保留原位输入并提供可重试错误', async () => {
    mockedApi.grantMembership.mockRejectedValue(new Error('本次会员办理没有完成'));
    render(<PlatformPage section="memberships" />);
    expect(await screen.findByText('会员与收入')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '办理' }));
    fireEvent.change(screen.getByLabelText('备注'), { target: { value: '保留这段备注' } });
    fireEvent.click(screen.getByRole('button', { name: '开通并记录收入' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('本次会员办理没有完成');
    expect(screen.getByLabelText('备注')).toHaveValue('保留这段备注');
    expect(mockedApi.fetchMembershipUsers).toHaveBeenCalledTimes(1);
  });

  it('刷新后已展开的办理区同步最新会员状态', async () => {
    mockedApi.fetchMembershipUsers
      .mockResolvedValueOnce({ items: [membershipUser], total: 1 })
      .mockResolvedValueOnce({ items: [activeMembershipUser], total: 1 });
    render(<PlatformPage section="memberships" />);
    expect(await screen.findByText('会员与收入')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '办理' }));
    const editor = screen.getByRole('region', { name: '为 作者甲 办理会员' });
    expect(within(editor).getByText('未开通')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));

    await waitFor(() => expect(mockedApi.fetchMembershipUsers).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const refreshedEditor = screen.getByRole('region', { name: '为 作者甲 办理会员' });
      expect(within(refreshedEditor).getByText('白银会员')).toBeVisible();
      expect(within(refreshedEditor).getByRole('button', { name: '续费并记录收入' })).toBeVisible();
      expect(within(refreshedEditor).getByRole('option', { name: '青铜 · 20万算力' })).toBeDisabled();
    });
  });

  it('有效会员采用原位二次确认撤销并写后刷新', async () => {
    mockedApi.fetchMembershipUsers.mockResolvedValue({ items: [activeMembershipUser], total: 1 });
    render(<PlatformPage section="memberships" />);
    expect(await screen.findByText('会员与收入')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '办理' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销会员' }));
    expect(screen.getByRole('button', { name: '确认撤销会员' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认撤销会员' }));

    await waitFor(() => expect(mockedApi.revokeMembership).toHaveBeenCalledWith('user-1', expect.stringMatching(/^membership-revoke-/u)));
    await waitFor(() => expect(mockedApi.fetchMembershipUsers).toHaveBeenCalledTimes(2));
    expect(mockedApi.fetchMembershipStats).toHaveBeenCalledTimes(2);
  });

  it('390px 下原位更新问题字段并在写入后刷新列表', async () => {
    render(<PlatformPage section="issues" />);
    expect(await screen.findByText('问题记录')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '处理' }));
    expect(screen.getByRole('region', { name: '问题处理' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('严重度'), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('处理状态'), { target: { value: 'resolved' } });
    fireEvent.change(screen.getByLabelText('处理记录'), { target: { value: '已在新版本修复' } });
    fireEvent.click(screen.getByRole('button', { name: '保存处理结果' }));

    await waitFor(() => expect(mockedApi.updatePlatformIssue).toHaveBeenCalledWith(issue, {
      status: 'resolved', severity: 'high', note: '已在新版本修复'
    }));
    await waitFor(() => expect(mockedApi.fetchPlatformIssues).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('问题处理结果已保存。')).toBeVisible();
  });
});
