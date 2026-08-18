// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createAuthorPlanningInput: vi.fn(),
  fetchSettingCollaboration: vi.fn(),
  resumeTask: vi.fn(),
  retryTask: vi.fn(),
  saveSettingOutlineItem: vi.fn(),
  startSettingCollaboration: vi.fn(),
  restartSettingCollaboration: vi.fn(),
  synthesizeSettingCollaboration: vi.fn(),
  reviseSettingCollaboration: vi.fn()
}));

vi.mock('../../../apps/web/src/lib/api/client', () => api);

import { SettingCollaborationPanel } from '../../../apps/web/src/features/planning/SettingCollaborationPanel';

const item = {
  itemKey: 'creative-concept', groupTitle: '作品策划', label: '核心看点',
  prompt: '这本书为什么值得持续写下去？', sourceLabel: '通用',
  status: '讨论中' as const, custom: false, sortOrder: 0, content: null
};

const workspaceItem = {
  ...item,
  sourceDiscussionId: null,
  sourceDecisionId: null,
  candidateAt: null,
  confirmedAt: null,
  updatedAt: '2026-08-08T00:00:00.000Z'
};

beforeEach(() => {
  api.createAuthorPlanningInput.mockResolvedValue({ authorInputId: 'idea-1' });
  api.resumeTask.mockResolvedValue({});
  api.retryTask.mockResolvedValue({});
  api.startSettingCollaboration.mockResolvedValue({ taskId: 'task-1', discussionId: 'discussion-1', status: 'queued' });
  api.restartSettingCollaboration.mockResolvedValue({ taskId: 'task-9', discussionId: 'discussion-9', status: 'queued' });
  api.synthesizeSettingCollaboration.mockResolvedValue({ taskId: 'task-2', discussionId: 'discussion-2', status: 'queued' });
  api.reviseSettingCollaboration.mockResolvedValue({ taskId: 'task-3', discussionId: 'discussion-3', status: 'queued' });
  api.fetchSettingCollaboration.mockResolvedValue({
    item: workspaceItem,
    panel: {
      taskId: 'task-1', discussionId: 'discussion-1', taskStatus: 'succeeded',
      discussionStatus: 'awaiting_boss', errorCode: null,
      createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z',
      proposals: [
        proposal(1, '主编甲', '方案一强调人物选择与可持续代价。'),
        proposal(2, '编剧甲', '方案二强调世界规则与身份错位。'),
        proposal(3, '编剧乙', '方案三强调关系变化与现实压力。')
      ]
    },
    revisionTask: null,
    historyCount: 1,
    fusionDraft: null,
    impact: { changesCanon: false, changesManuscript: false, formalVersionTiming: 'setting_baseline_confirmation' }
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('设定页内协作', () => {
  it('三份方案都不满意时可以重新设计：发起新一轮而不是复用旧讨论', async () => {
    render(<SettingCollaborationPanel bookId="book-1" item={item} onSnapshot={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '重新设计' }));

    await waitFor(() => expect(api.restartSettingCollaboration).toHaveBeenCalledWith('book-1', 'creative-concept', {
      authorInputId: null, idempotencyKey: expect.any(String)
    }));
    expect(api.startSettingCollaboration).not.toHaveBeenCalled();
  });
  it('把已有设定原文保留为作者参考并随本轮最小资料交给三名成员', async () => {
    api.fetchSettingCollaboration.mockResolvedValue({
      item: workspaceItem, panel: null, revisionTask: null, historyCount: 0, fusionDraft: null,
      impact: { changesCanon: false, changesManuscript: false, formalVersionTiming: 'setting_baseline_confirmation' }
    });
    render(<SettingCollaborationPanel bookId="book-1" item={item} onSnapshot={vi.fn()} />);

    fireEvent.change(await screen.findByRole('textbox', { name: '已有设定原文' }), {
      target: { value: '雾钟只能展示未来一天，而且每次使用都会遗忘一段私人记忆。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '团队设计' }));

    await waitFor(() => expect(api.createAuthorPlanningInput).toHaveBeenCalledWith('book-1', expect.objectContaining({
      surface: 'setting', subjectType: 'setting_module', subjectId: 'creative-concept',
      originalText: '雾钟只能展示未来一天，而且每次使用都会遗忘一段私人记忆。',
      intentStrength: 'preference', idempotencyKey: expect.any(String)
    })));
    expect(api.startSettingCollaboration).toHaveBeenCalledWith('book-1', 'creative-concept', {
      authorInputId: 'idea-1', idempotencyKey: expect.any(String)
    });
  });
  it('从当前页继续暂停任务并复用已有检查点', async () => {
    api.fetchSettingCollaboration.mockResolvedValue({
      item: workspaceItem,
      panel: {
        taskId: 'task-paused', discussionId: 'discussion-paused', taskStatus: 'paused',
        discussionStatus: 'failed', errorCode: null,
        createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z', proposals: []
      },
      revisionTask: null, historyCount: 1,
      fusionDraft: null,
      impact: { changesCanon: false, changesManuscript: false, formalVersionTiming: 'setting_baseline_confirmation' }
    });
    render(<SettingCollaborationPanel bookId="book-1" item={item} onSnapshot={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '继续这项任务' }));
    await waitFor(() => expect(api.resumeTask).toHaveBeenCalledWith('book-1', 'task-paused'));
  });

  it('在当前页选择多份独立方案、保存作者原话并交给主编整理', async () => {
    const onSnapshot = vi.fn();
    render(<SettingCollaborationPanel bookId="book-1" item={item} onSnapshot={onSnapshot} />);

    fireEvent.click((await screen.findAllByRole('button', { name: '整份选用' }))[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: '整份选用' })[0]!);
    fireEvent.change(screen.getByRole('textbox', { name: '你的补充想法' }), {
      target: { value: '保留方案一的代价，同时采用方案二的身份错位。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '按我的勾选融合' }));

    await waitFor(() => expect(api.createAuthorPlanningInput).toHaveBeenCalledTimes(1));
    expect(api.createAuthorPlanningInput).toHaveBeenCalledWith('book-1', expect.objectContaining({
      surface: 'setting', subjectType: 'setting_module', subjectId: 'creative-concept',
      originalText: '保留方案一的代价，同时采用方案二的身份错位。',
      intentStrength: 'preference', idempotencyKey: expect.any(String)
    }));
    expect(api.synthesizeSettingCollaboration).toHaveBeenCalledWith('book-1', 'creative-concept', {
      proposalIds: ['proposal-1', 'proposal-2'], authorInputId: 'idea-1', idempotencyKey: expect.any(String)
    });
    expect(screen.getByText(/不会改写已写正文或已确认内容/u)).toBeInTheDocument();
  });

  it('允许作者直接编辑主编候选并在当前页确认', async () => {
    const candidate = {
      ...workspaceItem,
      status: '候选待确认' as const,
      content: '城市公开运行高等级技术，但医疗分配仍受身份和信用限制。',
      candidateAt: '2026-08-08T00:02:00.000Z'
    };
    api.fetchSettingCollaboration.mockResolvedValue({
      item: candidate, panel: null,
      revisionTask: { taskId: 'task-2', status: 'succeeded', errorCode: null, updatedAt: '2026-08-08T00:02:00.000Z' },
      fusionDraft: null,
      historyCount: 1,
      impact: { changesCanon: false, changesManuscript: false, formalVersionTiming: 'setting_baseline_confirmation' }
    });
    const confirmed = { ...candidate, status: '已确认' as const, confirmedAt: '2026-08-08T00:03:00.000Z' };
    api.saveSettingOutlineItem.mockResolvedValue(confirmed);
    const onSnapshot = vi.fn();
    render(<SettingCollaborationPanel bookId="book-1" item={{ ...item, status: '候选待确认', content: candidate.content }} onSnapshot={onSnapshot} />);

    const editor = await screen.findByRole('textbox', { name: '待确认设定内容' });
    fireEvent.change(editor, { target: { value: '城市技术高度公开，但医疗分配仍受信用限制，并允许申诉。' } });
    fireEvent.click(screen.getByRole('button', { name: '确认这一项' }));

    await waitFor(() => expect(api.saveSettingOutlineItem).toHaveBeenCalledWith('book-1', expect.objectContaining({
      itemKey: 'creative-concept', status: '已确认',
      content: '城市技术高度公开，但医疗分配仍受信用限制，并允许申诉。'
    })));
    expect(onSnapshot).toHaveBeenCalledWith(confirmed);
    expect(await screen.findByRole('status')).toHaveTextContent('不会改写正文或已确认内容');
  });
});

function proposal(number: number, memberName: string, content: string) {
  return {
    number, proposalId: `proposal-${number}`, agentId: `agent-${number}`, memberName,
    roleKey: number === 1 ? 'lead_screenwriter' : number === 2 ? 'second_screenwriter' : 'setting',
    modelProvider: `provider-${number}`, modelId: `model-${number}`, content,
    decisionId: 'decision-1', createdAt: '2026-08-08T00:00:00.000Z', fragments: []
  };
}
