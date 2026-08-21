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

const coreKeys = ['world-stage', 'protagonist-situation', 'rules-costs', 'boundaries-blanks'] as const;
const labels: Record<string, string> = {
  'world-stage': '世界舞台',
  'protagonist-situation': '主角底板',
  'rules-costs': '规矩与代价',
  'boundaries-blanks': '边界与留白',
  'story-kernel': '长期吸引力'
};

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  api.fetchSettingQualityReport.mockResolvedValue({ fresh: false, report: null, taskStatus: null });
  api.fetchSettingReadiness.mockResolvedValue(readiness(false));
  api.fetchSettingOutlineWorkspace.mockResolvedValue([
    ...coreKeys.map((key, index) => outline(key, '待讨论', index)),
    outline('story-kernel', '待讨论', 4)
  ]);
  api.initializeSettingOutlineWorkspace.mockImplementation(async (_bookId: string, items: unknown[]) => items);
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

    expect(screen.getByRole('button', { name: '先确认选择范围' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /我已查看完整设定库/u }));
    expect(screen.getByRole('button', { name: '准备开始设计' })).toBeEnabled();
  });

  it('选择范围变化会要求重新确认，正式开始前必须经过二次确认', async () => {
    renderCatalog();

    const libraryButton = screen.getByRole('button', { name: /完整设定库/u });
    fireEvent.click(libraryButton);
    await screen.findByRole('region', { name: '其他设定' });

    const reviewed = screen.getByRole('checkbox', { name: /我已查看完整设定库/u });
    fireEvent.click(reviewed);
    expect(screen.getByRole('button', { name: '准备开始设计' })).toBeEnabled();

    const other = screen.getByRole('region', { name: '其他设定' });
    const firstCategory = within(other).getAllByRole('group')[0];
    if (firstCategory !== undefined) fireEvent.click(within(firstCategory).getByText(/项$/u));
    const optionalCheck = within(other).getAllByRole('checkbox')[0];
    if (optionalCheck !== undefined) {
      fireEvent.click(optionalCheck);
      expect(screen.getByRole('button', { name: '先确认选择范围' })).toBeDisabled();
      fireEvent.click(screen.getByRole('checkbox', { name: /我已查看完整设定库/u }));
    }

    fireEvent.click(screen.getByRole('button', { name: '准备开始设计' }));
    const dialog = screen.getByRole('dialog', { name: '确认开始逐项设计？' });
    expect(within(dialog).getByText(/开始后完整设定库会收成一个按钮/u)).toBeInTheDocument();
    expect(screen.queryByTestId('setting-collaboration-panel')).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '返回检查' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('setting-collaboration-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '准备开始设计' }));
    fireEvent.click(screen.getByRole('button', { name: '确认并开始设计' }));
    const panel = await screen.findByTestId('setting-collaboration-panel');
    expect(panel).toHaveAttribute('data-item-key', 'world-stage');
    expect(screen.getAllByTestId('setting-collaboration-panel')).toHaveLength(1);
    expect(libraryButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('逐项设计未完成时主编审查禁用，最后一项确认后才开放', async () => {
    api.fetchSettingOutlineWorkspace.mockResolvedValue([
      ...coreKeys.map((key, index) => outline(
        key,
        key === 'boundaries-blanks' ? '待讨论' : '已确认',
        index,
        key === 'boundaries-blanks' ? null : labels[key] + '已经形成正式内容。'
      )),
      outline('story-kernel', '已确认', 4, '长期吸引力已经确认。')
    ]);

    renderCatalog();
    fireEvent.click(screen.getByRole('button', { name: /完整设定库/u }));
    await screen.findByText('边界与留白');
    fireEvent.click(screen.getByRole('checkbox', { name: /我已查看完整设定库/u }));
    fireEvent.click(screen.getByRole('button', { name: '准备开始设计' }));
    fireEvent.click(screen.getByRole('button', { name: '确认并开始设计' }));

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
      outline('story-kernel', '已确认', 4, '长期吸引力已经确认。')
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
    fireEvent.click(screen.getByRole('checkbox', { name: /我已查看完整设定库/u }));
    fireEvent.click(screen.getByRole('button', { name: '准备开始设计' }));
    fireEvent.click(screen.getByRole('button', { name: '确认并开始设计' }));
    fireEvent.click(await screen.findByRole('button', { name: '模拟确认当前项' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '主编当前不可用' })).toBeDisabled());
    expect(screen.getByText(/主编当前不可用：创作模型尚未连接/u)).toBeInTheDocument();
    expect(api.startSettingQualityAudit).not.toHaveBeenCalled();
    expect(api.confirmSettingBaseline).not.toHaveBeenCalled();
  });
});
function renderCatalog(workspace: WorkspaceData | null = null): void {
  render(<SettingCatalog
    bookId="book-setting-catalog"
    workspace={workspace}
    planningState={{ version: 3 } as never}
    onPlanningStateChanged={vi.fn(async () => undefined)}
  />);
}

type OutlineStatus = '待讨论' | '讨论中' | '候选待确认' | '已确认' | '稍后补充' | '刻意留白' | '不适用';

function outline(itemKey: string, status: OutlineStatus, sortOrder: number, content: string | null = null) {
  return {
    itemKey,
    groupTitle: coreKeys.includes(itemKey as typeof coreKeys[number]) ? '核心设定' : '作品方向',
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
    recommended: ['story-kernel'],
    profileKey: 'common',
    profileLabel: '通用故事',
    hasCanonChapters: false
  };
}