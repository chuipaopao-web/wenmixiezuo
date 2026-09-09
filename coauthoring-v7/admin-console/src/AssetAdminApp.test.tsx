// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetAdminApp } from './AssetAdminApp';
import { DEFAULT_RHYTHM_POLICY } from '../../backend/planning-methods/rhythm-policy';
vi.mock('./platform-api',async(importOriginal)=>({...await importOriginal<typeof import('./platform-api')>(),fetchRhythmPolicy:vi.fn(async()=>({version:1,policy:structuredClone(DEFAULT_RHYTHM_POLICY),enabled:true,history:[],usage:[]}))}));

vi.mock('./RebuildControlCenter', () => ({ RebuildControlCenter: ({ mode }: { mode: string }) => <div>产品管理入口：{mode}</div> }));

describe('V7 分层规划后台', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/?section=planning');
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(cleanup);

  it('功能与AI流程合并管理，成员模型与其他管理能力保留', () => {
    window.history.replaceState({}, '', '/v7/');
    render(<AssetAdminApp account={{ userId: 'admin-1', email: 'admin@example.com', displayName: '管理员', role: 'admin', status: 'active' }} onSignOut={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByText('产品管理入口：map')).toBeVisible();
    for (const name of ['功能与AI流程', '资产方法论', '成员与模型', '创作运行', '现有能力对照', '数据中控', '用户与书籍', '算力与成本', '问题记录', '会员与收入']) {
      expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole('button',{name:'提示词与上下文'})).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '配置中心' })[0]!);
    expect(screen.getByText('产品管理入口：configuration')).toBeVisible();
  });

  it('旧资产链接进入分层方法，模板独立可查，避免多套管理入口', async () => {
    render(<AssetAdminApp
      account={{ userId: 'admin-1', email: 'admin@example.com', displayName: '管理员', role: 'admin', status: 'active' }}
      onSignOut={vi.fn().mockResolvedValue(undefined)}
    />);

    expect(await screen.findByRole('heading',{name:'分层方法库'})).toBeVisible();
    expect(screen.getByRole('navigation', { name: '资产分类' })).toBeVisible();
    expect(screen.getByRole('button', { name: '分层方法' })).toHaveAttribute('aria-current','page');
    for(const name of ['时光机','卷','事件链','章'])expect(screen.getByRole('button',{name})).toBeVisible();
    expect(screen.queryByRole('button',{name:'阶段与分卷'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'信息短卡模板'}));
    expect(screen.getByRole('heading',{name:'全书信息短卡'})).toBeVisible();
    expect(screen.getByRole('heading',{name:'主角与起点'})).toBeVisible();
    expect(screen.queryByRole('button',{name:'叙事方法'})).not.toBeInTheDocument();
  });
});
