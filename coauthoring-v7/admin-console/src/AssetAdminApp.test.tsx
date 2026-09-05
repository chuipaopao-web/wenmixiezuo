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

  it('默认替换为功能地图，旧后台全部14个能力仍有导航，配置中心可打开', () => {
    window.history.replaceState({}, '', '/v7/');
    render(<AssetAdminApp account={{ userId: 'admin-1', email: 'admin@example.com', displayName: '管理员', role: 'admin', status: 'active' }} onSignOut={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByText('产品管理入口：map')).toBeVisible();
    for (const name of ['资产总览', '叙事方法', '剧情模式', '剧情配方', '分层规划', '创作成员', '提示词与上下文', '创作运行', '现有能力对照', '运营总览', '用户与书籍', '算力与成本', '问题记录', '会员与收入']) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
    fireEvent.click(screen.getAllByRole('button', { name: '配置中心' })[0]!);
    expect(screen.getByText('产品管理入口：configuration')).toBeVisible();
  });

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
