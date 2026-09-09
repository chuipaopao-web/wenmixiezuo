// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RebuildControlData, RebuildUnit } from '../../backend/admin/rebuild-control-types.js';
import { RebuildControlCenter, unitStage } from './RebuildControlCenter';
import { fetchRebuildControl } from './platform-api';

vi.mock('./platform-api', () => ({ fetchRebuildControl: vi.fn(), fetchV7PromptAssets: vi.fn().mockResolvedValue([]), fetchV7UnifiedAgentGovernance: vi.fn().mockResolvedValue({roles:[]}) }));
const unit: RebuildUnit = { id: 'RB-01', name: '注册页', order: 2, stage: '账号与书架', dependencies: [],
  design: '待讨论', frontend: '未开始', backend: '未开始', acceptance: '未验证', deployment: '未发布', evidence: '待建立',
  details: [{ label: '讨论', text: '注册账号，保留已有用户身份。' }, { label: '后端逐项实现', text: '验证并发唯一身份。' }], sourceFeatures: [], taskKinds: [] };
const data: RebuildControlData = {
  source: { version: '1.2', updatedAt: '2026-09-05T01:00:00Z', digest: 'a'.repeat(64), path: 'docs/REBUILD_EXECUTION_PLAN.md',
    currentBatch: '第122批：保留功能接入与分批发布', currentWork: '后台路线状态与发布闭包更新' },
  units: [{ ...unit, id: 'RB-00.1', order: 1, name: '后台功能地图与配置中心', stage: '先做后台', design: '已定', frontend: '开发中' }, unit,
    { ...unit, id: 'RB-02', name: '登录页', order: 3, dependencies: ['RB-01'] }],
  sourceFeatures: [], configurations: [
    { id: 'agents', name: '模型配置', description: '现有模型与成员配置', scope: '按版本生效', section: 'agents', unitIds: ['RB-48'] },
    { id: 'future', name: '自动发布', description: '后续开发', scope: '尚不可用', section: null, unitIds: ['RB-56'] }
  ],
  runtime: { checkedAt: '2026-09-05T01:00:00Z', origin: '隔离测试服务', releaseId: 'test-build', database: 'responding',
    worker: 'stale_or_missing', heartbeatAt: null, windowStart: '2026-09-04T01:00:00Z', taskCount: 0, sampledCount: 0, taskSignals: [], openIssueCount: 0 }
};
const mockedFetch = vi.mocked(fetchRebuildControl);
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/v7/?section=rebuild&mapView=all');
  Element.prototype.scrollIntoView = vi.fn();
  mockedFetch.mockResolvedValue(data);
});
afterEach(cleanup);

describe('功能地图与配置中心', () => {
  it('采用当前核查状态，已合并不在待完成列表，失败不能被状态记录覆盖', async () => {
    const partial = {...unit, frontend:'开发中' as const, details:[{label:'收尾·进度状态',text:'部分实现·待接入'}]};
    expect(unitStage(partial)).toBe('部分实现·待接入');
    expect(unitStage({...partial,acceptance:'未通过'})).toBe('需要处理');
    expect(unitStage({...partial,deployment:'已回退'})).toBe('已回退·待处理');
    const merged = {...partial,id:'RB-08',name:'手动开书',details:[{label:'收尾·进度状态',text:'已合并'}]};
    mockedFetch.mockResolvedValue({...data,units:[partial,merged]});
    render(<RebuildControlCenter mode="map" onNavigate={vi.fn()} />);
    await screen.findByRole('region',{name:'功能详情'});
    expect(within(screen.getByRole('region',{name:'功能详情'})).getByText('部分实现',{exact:true})).toBeVisible();
    fireEvent.change(screen.getByLabelText('按重构进度筛选'),{target:{value:'active'}});
    expect(within(screen.getByRole('region',{name:'按顺序排列的功能地图'})).queryByText('手动开书')).not.toBeInTheDocument();
  });
  it('线上交付与重构验收分开，回退和失败不伪装已上线', () => {
    expect(unitStage({ ...unit, deployment: '已发布', acceptance: '验收中' })).toBe('已上线·待收尾');
    expect(unitStage({ ...unit, deployment: '已发布', frontend: '开发中' })).toBe('已上线·待收尾');
    expect(unitStage({ ...unit, deployment: '试用中' })).toBe('试用中·待验收');
    expect(unitStage({ ...unit, deployment: '已回退', acceptance: '通过' })).toBe('已回退·待处理');
    expect(unitStage({ ...unit, deployment: '已发布', acceptance: '未通过' })).toBe('需要处理');
  });

  it('功能详情优先显示线上能力、剩余工作，旧代码条件折叠且不重复', async () => {
    mockedFetch.mockResolvedValue({ ...data, units: [{ ...unit, deployment: '已发布', acceptance: '验收中', details: [
      {label:'收尾·线上现状',text:'现有登录可以使用。'},
      {label:'收尾·剩余工作',text:'独立身份迁移未完成。'},
      {label:'收尾·执行归属',text:'现有账号服务。'},
      {label:'收尾·旧实现退出',text:'新身份切换并验证后退出。'}
    ] }] });
    render(<RebuildControlCenter mode="map" onNavigate={vi.fn()} />);
    const scope = await screen.findByRole('region', {name:'当前交付与收尾'});
    expect(within(scope).getByText('现有登录可以使用。',{exact:false})).toBeVisible();
    expect(within(scope).getByText('独立身份迁移未完成。',{exact:false})).toBeVisible();
    const details = scope.querySelector('details')!;
    expect(details.open).toBe(false);
    fireEvent.click(within(scope).getByText('查看执行归属与旧代码退出条件'));
    expect(details.open).toBe(true);
    expect(screen.getAllByText('现有账号服务。',{exact:false})).toHaveLength(1);
  });

  it('默认进入统一功能管理，开发路线可独立切换并刷新恢复', async () => {
    window.history.replaceState({}, '', '/v7/?section=rebuild');
    mockedFetch.mockResolvedValue({ ...data, units: [...data.units, { ...unit, id:'RB-17', details:[{label:'设计·异常：知道缺哪份资料',text:'系统直接读取，不调用资料编辑。'}] }] });
    const mounted = render(<RebuildControlCenter mode="map" onNavigate={vi.fn()} />);
    expect(await screen.findByRole('button',{name:'功能管理'})).toHaveAttribute('aria-pressed','true');
    expect(screen.queryByLabelText('搜索功能地图')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'开发路线'}));
    expect(window.location.search).toContain('mapView=all');
    mounted.unmount();
    render(<RebuildControlCenter mode="map" onNavigate={vi.fn()} />);
    expect(await screen.findByRole('button',{name:'开发路线'})).toHaveAttribute('aria-pressed','true');
    expect(screen.getByLabelText('搜索功能地图')).toBeVisible();
  });
  it('导图使用文档职责并跳转到对应功能，保留未归类设计说明', async () => {
    mockedFetch.mockResolvedValueOnce({ ...data, units: [{ ...unit, details: [...unit.details,
      { label: '管理·功能介绍', text: '系统直接读取当前版本，不调用AI。' }, { label: '设计·系统直供', text: '系统直接读取当前版本，不调用AI。' },
      { label: '设计·资料编辑介入', text: '不介入：系统直供。' }, { label: '设计·执行成员', text: '系统保存。' }, { label: '设计·复查成员', text: '作者确认。' },
      { label: '设计·已确认方案', text: '已确认保留身份。' }, { label: '补充记录', text: '不能隐藏这条设计记录。' }
    ] }] });
    render(<RebuildControlCenter mode="map" onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '功能管理' }));
    const guide = screen.getByRole('region', { name: '按功能统一管理' });
    expect(within(guide).getByText('系统直接读取当前版本，不调用AI。')).toBeVisible();
    fireEvent.click(within(guide).getByRole('button', { name: '开发路线与变更说明' }));
    expect(screen.queryByRole('region', { name: '按功能统一管理' })).not.toBeInTheDocument();
    expect(screen.getByText('已确认保留身份。')).toBeVisible();
    expect(screen.getByText('不能隐藏这条设计记录。')).toBeVisible();
    expect(window.location.search).toContain('unit=RB-01');
  });

  it('没有导图登记时说明缺失，不臆造成员介入', async () => {
    render(<RebuildControlCenter mode="map" onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '功能管理' }));
    expect(screen.getByText(/当前版本尚未登记功能管理档案/)).toBeVisible();
  });
  it('显示登记的当前批次，按开发顺序筛选、查看技术路线与前置功能', async () => {
    render(<RebuildControlCenter mode="map" onNavigate={vi.fn()} />);
    expect(await screen.findByText('当前批次：第122批：保留功能接入与分批发布')).toBeVisible();
    expect(screen.getByText('当前工作：后台路线状态与发布闭包更新')).toBeVisible();
    expect(within(screen.getByRole('region', { name: '重构进度' })).getByText('已开始待完成')).toBeVisible();
    expect(screen.queryByText(/当前：RB-00\.1/u)).not.toBeInTheDocument();
    expect(screen.getByText('Worker心跳缺失或过期')).toBeVisible();
    expect(screen.getByText('尚无本功能的完整运行证据，未验证。')).toBeVisible();
    fireEvent.change(screen.getByLabelText('搜索功能地图'), { target: { value: '登录页' } });
    const map = screen.getByRole('region', { name: '按顺序排列的功能地图' });
    expect(within(map).queryByText('注册页')).not.toBeInTheDocument();
    fireEvent.click(within(map).getByRole('button', { name: /登录页/ }));
    const detail = screen.getByRole('region', { name: '功能详情' });
    expect(within(detail).getByText('验证并发唯一身份。')).toBeVisible();
    fireEvent.click(within(detail).getByRole('button', { name: /RB-01 注册页/ }));
    expect(within(detail).getByRole('heading', { name: '注册页' })).toBeVisible();
    expect(window.location.search).toContain('unit=RB-01');
  });

  it('无搜索结果可以恢复，进度筛选不把未验证算作通过', async () => {
    render(<RebuildControlCenter mode="map" onNavigate={vi.fn()} />);
    await screen.findByText('每一步，都看得清楚');
    fireEvent.change(screen.getByLabelText('按重构进度筛选'), { target: { value: 'accepted' } });
    expect(screen.getByText('没有符合条件的功能。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByText('3 项结果')).toBeVisible();
    expect(unitStage({ ...unit, frontend: '已实现', backend: '已实现' })).toBe('待验收');
    expect(unitStage({ ...unit, frontend: '已实现', backend: '未开始' })).toBe('部分实现');
    expect(unitStage({ ...unit, acceptance: '通过' })).toBe('本地验收通过');
  });

  it('首次读取失败有恢复操作，后续刷新失败保留旧结果并明确过期', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('offline'));
    render(<RebuildControlCenter mode="map" onNavigate={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('功能地图暂时没有读取成功');
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
    await screen.findByText('每一步，都看得清楚');
    mockedFetch.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: '刷新状态' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保留上次读取结果');
    expect(screen.getByText('当前批次：第122批：保留功能接入与分批发布')).toBeVisible();
  });

  it('旧接口未返回当前批次字段时明确显示未登记，不按开发中推导', async () => {
    mockedFetch.mockResolvedValueOnce({ ...data, source: { version: '1.2', updatedAt: '2026-09-05T01:00:00Z', digest: 'a'.repeat(64), path: 'docs/REBUILD_EXECUTION_PLAN.md' } });
    render(<RebuildControlCenter mode="map" onNavigate={vi.fn()} />);
    expect(await screen.findByText('当前批次：未登记')).toBeVisible();
    expect(screen.getByText('当前工作：未登记')).toBeVisible();
    expect(screen.queryByText(/当前：RB-00\.1/u)).not.toBeInTheDocument();
  });

  it('离开页面取消请求，配置按钮只打开真实入口', async () => {
    const onNavigate = vi.fn();
    const { unmount } = render(<RebuildControlCenter mode="configuration" onNavigate={onNavigate} />);
    await screen.findByText('模型配置');
    fireEvent.click(screen.getByRole('button', { name: '打开管理' }));
    expect(onNavigate).toHaveBeenCalledWith('agents');
    expect(screen.getByText('尚不可配置')).toBeVisible();
    const signal = mockedFetch.mock.calls[0]?.[0];
    act(unmount);
    expect(signal?.aborted).toBe(true);
  });
});
