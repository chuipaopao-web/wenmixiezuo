// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetAdminApp } from './AssetAdminApp';

describe('V7 分层规划后台', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/?section=planning');
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(cleanup);

  it('区分资料策划、全书三席与卷链可选方案数', () => {
    render(<AssetAdminApp
      account={{ userId: 'admin-1', email: 'admin@example.com', displayName: '管理员', role: 'admin', status: 'active' }}
      onSignOut={vi.fn().mockResolvedValue(undefined)}
    />);

    expect(screen.getByText(/每个新任务先由资料策划 Agent/)).toBeVisible();
    expect(screen.getByRole('heading', { name: '全书路线三席' })).toBeVisible();
    expect(screen.getByText(/卷和链默认只请一名强模型成员设计/)).toBeVisible();
    expect(screen.getByText(/其他层级的资料包和临时身份在“创作运行”查看/)).toBeVisible();
    expect(screen.queryByRole('heading', { name: '三名强模型全案主编' })).not.toBeInTheDocument();
  });
});
