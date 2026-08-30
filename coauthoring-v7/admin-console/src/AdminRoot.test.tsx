// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRoot } from './AdminRoot';
import * as api from './platform-api';

vi.mock('./AssetAdminApp', () => ({
  AssetAdminApp: ({ account }: { account: api.AdminAccount }) => <div data-testid="admin-app">{account.displayName} 的后台</div>
}));

vi.mock('./platform-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./platform-api')>();
  return {
    ...actual,
    fetchCurrentAccount: vi.fn(),
    loginAccount: vi.fn(),
    logoutAccount: vi.fn()
  };
});

const mockedApi = vi.mocked(api);
const administrator: api.AdminAccount = {
  userId: 'admin-1', email: 'admin@example.com', displayName: '管理员', role: 'admin', status: 'active'
};

describe('V7 独立后台认证壳', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.logoutAccount.mockResolvedValue({ loggedOut: true });
  });

  afterEach(cleanup);

  it('任一业务请求触发认证失效事件后回到 V7 登录页', async () => {
    mockedApi.fetchCurrentAccount.mockResolvedValue(administrator);
    render(<AdminRoot />);
    expect(await screen.findByTestId('admin-app')).toHaveTextContent('管理员 的后台');

    act(() => window.dispatchEvent(new Event(api.ADMIN_AUTHENTICATION_REQUIRED_EVENT)));

    expect(await screen.findByRole('heading', { name: '登录管理后台' })).toBeVisible();
    expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
  });

  it('普通账号停在权限拒绝页，返回配置化作者主站而不是后台域根目录', async () => {
    mockedApi.fetchCurrentAccount.mockResolvedValue({ ...administrator, userId: 'user-1', role: 'user', displayName: '普通作者' });
    render(<AdminRoot />);

    expect(await screen.findByRole('heading', { name: '当前账号没有管理权限' })).toBeVisible();
    expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
    const authorLink = screen.getByRole('link', { name: '返回作者创作台' });
    expect(authorLink).toHaveAttribute('href', api.AUTHOR_SITE_ORIGIN);
    expect(api.AUTHOR_SITE_ORIGIN).toBe('https://wenmixiezuo.com/');
    expect(authorLink).not.toHaveAttribute('href', '/');
  });
});
