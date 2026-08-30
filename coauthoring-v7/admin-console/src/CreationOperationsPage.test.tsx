// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreationOperationsPage } from './CreationOperationsPage';
import * as api from './platform-api';

vi.mock('./platform-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./platform-api')>();
  return {
    ...actual,
    fetchV7CreationAdminTasks: vi.fn(),
    fetchV7PlanningAdminTasks: vi.fn(),
    fetchV7CreationAdminAudit: vi.fn(),
    fetchV7PlanningAdminAudit: vi.fn()
  };
});

const mockedApi = vi.mocked(api);

describe('V7独立后台创作运行', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.fetchV7PlanningAdminTasks.mockResolvedValue([]);
    mockedApi.fetchV7CreationAdminTasks.mockResolvedValue([{
      workflowId: 'workflow-1', ownerId: 'owner-1', bookId: 'book-1', bookTitle: '张三北宋行',
      volumeScopeId: 'volume-1', chainScopeId: 'chain-1', stage: 'manuscript', status: 'partially_failed',
      modelCalls: 8, failedCalls: 1, inputTokens: 1200, outputTokens: 2400, cashMicros: 0,
      pendingUpdates: 1, failedUpdates: 1, memberKeys: ['红玉', '昭君'],
      createdAt: '2026-08-27T01:00:00.000Z', updatedAt: '2026-08-27T02:00:00.000Z'
    }]);
    mockedApi.fetchV7CreationAdminAudit.mockResolvedValue({
      creation: {
        requestedCandidateCount: 2,
        counts: {
          contextPacks: 1, options: 2, optionReviews: 1, decisions: 0, outlineDraftCandidates: 0,
          outlines: 0, manuscripts: 1, manuscriptReviews: 1, settlements: 0, modelCalls: 2,
          outbox: 4, finalizeReceipts: 0, taskControls: 0
        },
        contextPacks: [{
          context_pack_id: 'pack-1', task_kind: 'chain', task_id: 'chain-1', status: 'active',
          assigned_member_key: '红玉', content_characters: 8600, error_message: null, updated_at: '2026-08-27T02:00:00.000Z'
        }],
        options: [
          { option_id: 'option-1', option_kind: 'chain', scope_id: 'chain-1', seat_key: 'structure', member_key: '红玉', created_at: '2026-08-27T01:00:00.000Z' },
          { option_id: 'option-2', option_kind: 'chain', scope_id: 'chain-1', seat_key: 'commercial', member_key: '昭君', created_at: '2026-08-27T01:01:00.000Z' }
        ],
        outlineCandidates: [],
        calls: [
          { request_id: 'call-1', run_kind: 'option', node_key: 'chain-1', member_key: '红玉', provider: 'test', model_id: 'model-a', state: 'succeeded', temperature: 0.7, input_tokens: 1200, output_tokens: 800, cash_micros: 0, failure_message: null, started_at: '2026-08-27T01:00:00.000Z', completed_at: '2026-08-27T01:01:00.000Z' },
          { request_id: 'call-2', run_kind: 'review', node_key: 'chapter-1', member_key: '昭君', provider: 'test', model_id: 'model-b', state: 'failed', temperature: 0.2, input_tokens: 400, output_tokens: 0, cash_micros: 0, failure_message: '审查返回不完整', started_at: '2026-08-27T01:02:00.000Z', completed_at: '2026-08-27T01:03:00.000Z' }
        ]
      },
      writeBack: {
        total: 4, completed: 3, pending: 0, failed: 1, unknown: 0,
        tasks: [{ taskId: 'task-1', task: '人物状态更新', status: 'failed', message: '对不起，这次没有完成，已经交接给下一位成员。', attempts: 2, updatedAt: '2026-08-27T02:00:00.000Z' }]
      }
    });
  });

  afterEach(cleanup);

  it('显示真实失败、用量、成员和写后积压并可展开审计', async () => {
    render(<CreationOperationsPage />);
    expect(await screen.findByText('张三北宋行')).toBeVisible();
    expect(screen.getByText('部分失败')).toBeVisible();
    expect(screen.getByText('红玉、昭君')).not.toBeVisible();
    fireEvent.click(screen.getByText('张三北宋行'));
    await waitFor(() => expect(mockedApi.fetchV7CreationAdminAudit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('红玉、昭君')).toBeVisible();
    expect(screen.getByText(/请求 2 套 · 卷链方案 2 套 · 章纲方案 0 套/u)).toBeVisible();
    expect(screen.getByText(/1 份 · 8,600 字符/u)).toBeVisible();
    expect(screen.getByText(/2 次 · 2,400 Token/u)).toBeVisible();
    expect(screen.getByText(/3\/4 已完成/u)).toBeVisible();
    expect(screen.getByText(/对不起，这次没有完成，已经交接给下一位成员/u)).toBeVisible();
  });

  it('页面重挂载取消旧请求时不向管理员显示技术错误', async () => {
    mockedApi.fetchV7CreationAdminTasks.mockRejectedValue(new Error('signal is aborted without reason'));
    const view = render(<CreationOperationsPage />);
    view.unmount();
    expect(screen.queryByText(/signal is aborted/u)).not.toBeInTheDocument();
  });

  it('API尚未重启时兼容旧版审计响应，不让后台白屏', async () => {
    mockedApi.fetchV7CreationAdminAudit.mockResolvedValue({
      creation: { counts: { contextPacks: 1, options: 1, optionReviews: 0, decisions: 0, outlineDraftCandidates: 0, outlines: 0, manuscripts: 0, manuscriptReviews: 0, settlements: 0, modelCalls: 1, outbox: 0, finalizeReceipts: 0, taskControls: 0 } },
      writeBack: { total: 0, completed: 0, pending: 0, failed: 0, unknown: 0, tasks: [] }
    });
    render(<CreationOperationsPage />);
    fireEvent.click(await screen.findByText('张三北宋行'));
    expect(await screen.findByText(/请求 1 套 · 卷链方案 0 套 · 章纲方案 0 套/u)).toBeVisible();
    expect(screen.getByText(/0\/0 已完成/u)).toBeVisible();
  });
});
