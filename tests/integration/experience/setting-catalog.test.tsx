// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  applySettingQualitySuggestion: vi.fn(),
  clearSettingOutlineWorkspace: vi.fn(),
  confirmSettingBaseline: vi.fn(),
  fetchSettingOutlineWorkspace: vi.fn(),
  fetchSettingQualityReport: vi.fn(),
  fetchSettingReadiness: vi.fn(),
  initializeSettingOutlineWorkspace: vi.fn(),
  removeCurrentSettingOutlineItem: vi.fn(),
  saveSettingOutlineItem: vi.fn(),
  startSettingQualityAudit: vi.fn()
}));

vi.mock('../../../apps/web/src/lib/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../apps/web/src/lib/api/client')>(),
  ...api
}));

vi.mock('../../../apps/web/src/features/planning/SettingCollaborationPanel', () => ({
  SettingCollaborationPanel: ({ item, onSnapshot }: {
    item: Record<string, unknown> & { itemKey: string; label: string };
    onSnapshot: (snapshot: Record<string, unknown>) => void;
  }) => (
    <div data-testid="setting-collaboration-panel" data-item-key={item.itemKey}>
      {item.label}
      <button type="button" onClick={() => onSnapshot({
        ...item, status: '已确认', content: `${item.label}已经确认。`, pendingCandidate: null,
        confirmedAt: '2026-08-21T08:10:00.000Z'
      })}>模拟确认当前项</button>
    </div>
  )
}));


import { SettingCatalog } from '../../../apps/web/src/features/planning/PlanningWorkspace';
import type { WorkspaceData } from '../../../apps/web/src/lib/api/client';

const coreKeys = ['world-stage', 'social-order', 'rules-costs', 'boundaries-blanks'] as const;
const labels: Record<string, string> = {
  'world-stage': '世界舞台',
  'social-order': '社会运行与秩序',
  'rules-costs': '规矩与代价',
  'boundaries-blanks': '边界与留白',
  geography: '地理地图与交通边界',
  opposition: '对立面'
};

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  api.fetchSettingQualityReport.mockResolvedValue({ fresh: false, report: null, taskStatus: null });
  api.fetchSettingReadiness.mockResolvedValue(readiness(false));
  api.confirmSettingBaseline.mockResolvedValue({});
  api.startSettingQualityAudit.mockResolvedValue({});
  api.fetchSettingOutlineWorkspace.mockResolvedValue([
    ...coreKeys.map((key, index) => outline(key, '待讨论', index)),
    outline('geography', '待讨论', 4)
  ]);
  api.initializeSettingOutlineWorkspace.mockImplementation(async (_bookId: string, items: unknown[]) => items);
  api.removeCurrentSettingOutlineItem.mockImplementation(async (_bookId: string, itemKey: string) => ({
    ...outline(itemKey, '待讨论', 99), content: null, pendingCandidate: null, confirmedAt: null
  }));
  api.saveSettingOutlineItem.mockImplementation(async (_bookId: string, item: Record<string, unknown>) => ({
    ...outline(String(item.itemKey), String(item.status) as OutlineStatus, Number(item.sortOrder ?? 0)),
    ...item
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('折叠设定资料库与逐项设计', () => {
  it('初始只显示完整设定库入口，打开后核心与推荐默认勾选，确认范围前不能开始', async () => {
    renderCatalog();

    const libraryButton = screen.getByRole('button', { name: /完整设定库/u });
    expect(libraryButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: '核心设定' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('setting-collaboration-panel')).not.toBeInTheDocument();

    expect(screen.getByText('设定骨架—勾选所需条目，请勿乱选')).toBeInTheDocument();
    expect(screen.queryByText('本轮设计范围')).not.toBeInTheDocument();
    fireEvent.click(libraryButton);
    expect(libraryButton).toHaveAttribute('aria-expanded', 'true');

    const core = await screen.findByRole('region', { name: '核心设定' });
    const coreChecks = within(core).getAllByRole('checkbox');
    expect(coreChecks).toHaveLength(4);
    coreChecks.forEach((checkbox) => {
      expect(checkbox).toBeChecked();
      expect(checkbox).toHaveAttribute('readonly');
    });

    const recommended = screen.getByRole('region', { name: '推荐设定' });
    const recommendedChecks = within(recommended).getAllByRole('checkbox');
    expect(recommendedChecks).toHaveLength(1);
    expect(recommendedChecks[0]).toBeChecked();

    expect(screen.getByRole('button', { name: '请先确认勾选' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /我已确认勾选完毕/u }));
    expect(screen.getByRole('button', { name: '开始设计' })).toBeEnabled();
  });

  it('选择范围变化会要求重新确认，确认后不弹窗并直接进入第一项', async () => {
    renderCatalog();

    const libraryButton = screen.getByRole('button', { name: /完整设定库/u });
    fireEvent.click(libraryButton);
    await screen.findByRole('region', { name: '其他设定' });

    const reviewed = screen.getByRole('checkbox', { name: /我已确认勾选完毕/u });
    fireEvent.click(reviewed);
    expect(screen.getByRole('button', { name: '开始设计' })).toBeEnabled();

    const other = screen.getByRole('region', { name: '其他设定' });
    const firstCategory = within(other).getAllByRole('group')[0];
    if (firstCategory !== undefined) fireEvent.click(within(firstCategory).getByText(/项$/u));
    const optionalCheck = within(other).getAllByRole('checkbox')[0];
    if (optionalCheck !== undefined) {
      fireEvent.click(optionalCheck);
      expect(screen.getByRole('button', { name: '请先确认勾选' })).toBeDisabled();
      fireEvent.click(screen.getByRole('checkbox', { name: /我已确认勾选完毕/u }));
    }

    fireEvent.click(screen.getByRole('button', { name: '开始设计' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const panel = await screen.findByTestId('setting-collaboration-panel');
    expect(panel).toHaveAttribute('data-item-key', 'world-stage');
    expect(screen.getAllByTestId('setting-collaboration-panel')).toHaveLength(1);
    expect(libraryButton).toHaveAttribute('aria-expanded', 'false');
  });
  it('早期内容可取消或确认移除，确认后卡片消失且历史保留提示明确', async () => {
    api.fetchSettingOutlineWorkspace.mockResolvedValue([
      ...coreKeys.map((key, index) => outline(key, '待讨论', index)),
      outline('geography', '待讨论', 4),
      outline('opposition', '已确认', 90, '旧版对立方向仍在当前设定中。')
    ]);

    renderCatalog();
    fireEvent.click(screen.getByRole('button', { name: /完整设定库/u }));
    fireEvent.click(await screen.findByText('早期设定内容'));

    const removeButton = screen.getByRole('button', { name: '移除当前内容' });
    fireEvent.click(removeButton);
    const confirmGroup = screen.getByRole('group', { name: '确认移除对立面' });
    expect(within(confirmGroup).getByText(/历史版本与正文仍保留/u)).toBeInTheDocument();

    fireEvent.click(within(confirmGroup).getByRole('button', { name: '取消' }));
    expect(api.removeCurrentSettingOutlineItem).not.toHaveBeenCalled();
    expect(screen.getByText('旧版对立方向仍在当前设定中。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '移除当前内容' }));
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }));

    await waitFor(() => expect(api.removeCurrentSettingOutlineItem)
      .toHaveBeenCalledWith('book-setting-catalog', 'opposition'));
    expect(screen.queryByText('旧版对立方向仍在当前设定中。')).not.toBeInTheDocument();
    expect(screen.getByText(/已从当前设定和临时资料包移除“对立面”/u)).toBeInTheDocument();
  });

  it('早期内容移除失败时保留卡片并允许重试', async () => {
    api.fetchSettingOutlineWorkspace.mockResolvedValue([
      ...coreKeys.map((key, index) => outline(key, '待讨论', index)),
      outline('geography', '待讨论', 4),
      outline('opposition', '已确认', 90, '不能静默消失的旧内容。')
    ]);
    api.removeCurrentSettingOutlineItem.mockRejectedValueOnce(new Error('网络失败'));

    renderCatalog();
    fireEvent.click(screen.getByRole('button', { name: /完整设定库/u }));
    fireEvent.click(await screen.findByText('早期设定内容'));
    fireEvent.click(screen.getByRole('button', { name: '移除当前内容' }));
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }));

    await waitFor(() => expect(screen.getByText('不能静默消失的旧内容。')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '确认移除' })).toBeEnabled();
  });

  it('逐项设计未完成时主编审查禁用，最后一项确认后才开放', async () => {
    api.fetchSettingOutlineWorkspace.mockResolvedValue([
      ...coreKeys.map((key, index) => outline(
        key,
        key === 'boundaries-blanks' ? '待讨论' : '已确认',
        index,
        key === 'boundaries-blanks' ? null : labels[key] + '已经形成正式内容。'
      )),
      outline('geography', '已确认', 4, '地理交通边界已经确认。')
    ]);

    renderCatalog();
    fireEvent.click(screen.getByRole('button', { name: /完整设定库/u }));
    await screen.findByText('边界与留白');
    fireEvent.click(screen.getByRole('checkbox', { name: /我已确认勾选完毕/u }));
    fireEvent.click(screen.getByRole('button', { name: '开始设计' }));

    expect(await screen.findByTestId('setting-collaboration-panel')).toHaveAttribute('data-item-key', 'boundaries-blanks');
    expect(screen.getByRole('button', { name: '完成逐项设计后再审查' })).toBeDisabled();
    expect(api.startSettingQualityAudit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '模拟确认当前项' }));
    await waitFor(() => expect(screen.queryByTestId('setting-collaboration-panel')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '请主编审查' })).toBeEnabled();
  });

  it('全部完成但主编不可用时保留设定并明确禁用审查', async () => {
    api.fetchSettingOutlineWorkspace.mockResolvedValue([
      ...coreKeys.map((key, index) => outline(
        key,
        key === 'boundaries-blanks' ? '待讨论' : '已确认',
        index,
        key === 'boundaries-blanks' ? null : labels[key] + '已经形成正式内容。'
      )),
      outline('geography', '已确认', 4, '地理交通边界已经确认。')
    ]);
    const unavailableWorkspace = {
      agents: [{
        agentId: 'chief-1', roleKey: 'chief_editor', roleName: '主编', displayName: '貂蝉',
        category: 'core', provider: 'kimi', modelId: 'kimi-k3', activationState: 'disabled',
        availability: 'unavailable', availabilityReason: '创作模型尚未连接'
      }],
      tasks: []
    } as unknown as WorkspaceData;

    renderCatalog(unavailableWorkspace);
    fireEvent.click(screen.getByRole('button', { name: /完整设定库/u }));
    await screen.findByText('边界与留白');
    fireEvent.click(screen.getByRole('checkbox', { name: /我已确认勾选完毕/u }));
    fireEvent.click(screen.getByRole('button', { name: '开始设计' }));
    fireEvent.click(await screen.findByRole('button', { name: '模拟确认当前项' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '主编当前不可用' })).toBeDisabled());
    expect(screen.getByText(/主编当前不可用：创作模型尚未连接/u)).toBeInTheDocument();
    expect(api.startSettingQualityAudit).not.toHaveBeenCalled();
    expect(api.confirmSettingBaseline).not.toHaveBeenCalled();
  });
  it('主编确认正式设定后自动进入分卷', async () => {
    api.fetchSettingOutlineWorkspace.mockResolvedValue([
      ...coreKeys.map((key, index) => outline(key, '已确认', index, labels[key] + '已经确认。')),
      outline('geography', '已确认', 4, '地理交通边界已经确认。')
    ]);
    api.fetchSettingReadiness.mockResolvedValue(readiness(true));
    const onOpenVolumes = vi.fn();

    renderCatalog(null, onOpenVolumes);
    fireEvent.click(screen.getByRole('button', { name: /完整设定库/u }));
    await screen.findByText('边界与留白');
    fireEvent.click(screen.getByRole('checkbox', { name: /我已确认勾选完毕/u }));
    fireEvent.click(screen.getByRole('button', { name: '开始设计' }));
    fireEvent.click(await screen.findByRole('button', { name: '请主编审查' }));

    await waitFor(() => expect(api.confirmSettingBaseline).toHaveBeenCalled());
    expect(onOpenVolumes).toHaveBeenCalledTimes(1);
  });
});
function renderCatalog(workspace: WorkspaceData | null = null, onOpenVolumes = vi.fn()): void {
  render(<SettingCatalog
    bookId="book-setting-catalog"
    workspace={workspace}
    planningState={{ version: 3 } as never}
    onPlanningStateChanged={vi.fn(async () => undefined)}
    onOpenVolumes={onOpenVolumes}
  />);
}

type OutlineStatus = '待讨论' | '讨论中' | '候选待确认' | '已确认' | '稍后补充' | '刻意留白' | '不适用';

function outline(itemKey: string, status: OutlineStatus, sortOrder: number, content: string | null = null) {
  return {
    itemKey,
    groupTitle: coreKeys.includes(itemKey as typeof coreKeys[number]) ? '核心设定' : '世界与环境',
    label: labels[itemKey] ?? itemKey,
    prompt: `${labels[itemKey] ?? itemKey}应该怎样设计？`,
    sourceLabel: '通用',
    status,
    custom: false,
    sortOrder,
    content,
    pendingCandidate: null,
    sourceDiscussionId: null,
    sourceDecisionId: null,
    candidateAt: null,
    confirmedAt: status === '已确认' ? '2026-08-21T08:00:00.000Z' : null,
    updatedAt: '2026-08-21T08:00:00.000Z'
  };
}

function readiness(ready: boolean) {
  return {
    ready,
    missing: ready ? [] : [...coreKeys],
    unresolved: [],
    required: [...coreKeys],
    recommended: ['geography'],
    profileKey: 'common',
    profileLabel: '通用故事',
    hasCanonChapters: false
  };
}