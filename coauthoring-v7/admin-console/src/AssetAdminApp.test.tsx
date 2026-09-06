// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetAdminApp } from './AssetAdminApp';

vi.mock('./RebuildControlCenter', () => ({ RebuildControlCenter: ({ mode }: { mode: string }) => <div>产品管理入口：{mode}</div> }));

describe('V7 分层规划后台', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/?section=planning');
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(cleanup);

  it('成员和上下文合并为单个导航，其他管理能力保留', () => {
    window.history.replaceState({}, '', '/v7/');
    render(<AssetAdminApp account={{ userId: 'admin-1', email: 'admin@example.com', displayName: '管理员', role: 'admin', status: 'active' }} onSignOut={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByText('产品管理入口：map')).toBeVisible();
    for (const name of ['资产方法论', '成员与上下文', '创作运行', '现有能力对照', '运营总览', '用户与书籍', '算力与成本', '问题记录', '会员与收入']) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole('button',{name:'提示词与上下文'})).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '配置中心' })[0]!);
    expect(screen.getByText('产品管理入口：configuration')).toBeVisible();
  });

  it('资产顶部分类兼容旧链接，不把三名主编固定为流程', () => {
    render(<AssetAdminApp
      account={{ userId: 'admin-1', email: 'admin@example.com', displayName: '管理员', role: 'admin', status: 'active' }}
      onSignOut={vi.fn().mockResolvedValue(undefined)}
    />);

    expect(screen.getByText(/系统冻结本次正式资料与配置版本/)).toBeVisible();
    expect(screen.getByRole('navigation', { name: '资产分类' })).toBeVisible();
    expect(screen.getByRole('button', { name: '分层应用' })).toHaveAttribute('aria-current','page');
    fireEvent.click(screen.getByRole('button', { name: '叙事方法' }));
    expect(screen.getByRole('button', { name: '叙事方法' })).toHaveAttribute('aria-current','page');
    fireEvent.click(screen.getByRole('button', { name: '分层应用' }));
    expect(screen.getByRole('link', { name: '打开创作成员' })).toHaveAttribute('href', '?section=agents');
    expect(screen.queryByRole('heading', { name: '全书路线三席' })).not.toBeInTheDocument();
    expect(screen.getByText(/卷和链默认只请一名强模型成员设计/)).toBeVisible();
    expect(screen.getByText(/其他层级的资料包和临时身份在“创作运行”查看/)).toBeVisible();
    expect(screen.queryByRole('heading', { name: '三名强模型全案主编' })).not.toBeInTheDocument();
  });
});
