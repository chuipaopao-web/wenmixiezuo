// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createAuthorPlanningInput: vi.fn(),
  fetchSettingCollaboration: vi.fn(),
  redesignSettingCollaborationMember: vi.fn(),
  resumeTask: vi.fn(),
  retryTask: vi.fn(),
  saveSettingOutlineItem: vi.fn(),
  startSettingCollaboration: vi.fn(),
  restartSettingCollaboration: vi.fn(),
  retrySettingCollaborationMember: vi.fn()
}));

vi.mock('../../../apps/web/src/lib/api/client', () => api);

import { SettingCollaborationPanel } from '../../../apps/web/src/features/planning/SettingCollaborationPanel';

const item = {
  itemKey: 'creative-concept', groupTitle: '作品策划', label: '核心看点',
  prompt: '这本书为什么值得持续写下去？', sourceLabel: '通用',
  status: '讨论中' as const, custom: false, sortOrder: 0, content: null,
  pendingCandidate: null, confirmedAt: null
};

const workspaceItem = {
  ...item,
  sourceDiscussionId: null,
  sourceDecisionId: null,
  candidateAt: null,
  confirmedAt: null,
  updatedAt: '2026-08-08T00:00:00.000Z'
};
const screenwriters = [
  { agentId: 'agent-1', memberName: '婉儿', roleKey: 'lead_screenwriter', availability: 'available', availabilityReason: null, highCompute: false },
  { agentId: 'agent-2', memberName: '红玉', roleKey: 'second_screenwriter', availability: 'available', availabilityReason: null, highCompute: false },
  { agentId: 'agent-3', memberName: '幼薇', roleKey: 'third_screenwriter', availability: 'available', availabilityReason: null, highCompute: false },
  { agentId: 'agent-4', memberName: '清照', roleKey: 'senior_screenwriter', availability: 'available', availabilityReason: null, highCompute: true }
];

beforeEach(() => {
  api.createAuthorPlanningInput.mockResolvedValue({ authorInputId: 'idea-1' });
  api.resumeTask.mockResolvedValue({});
  api.redesignSettingCollaborationMember.mockResolvedValue({ taskId: 'task-member-redesign', discussionId: 'discussion-member-redesign', status: 'queued' });
  api.retryTask.mockResolvedValue({});
  api.startSettingCollaboration.mockResolvedValue({ taskId: 'task-1', discussionId: 'discussion-1', status: 'queued' });
  api.restartSettingCollaboration.mockResolvedValue({ taskId: 'task-9', discussionId: 'discussion-9', status: 'queued' });
  api.retrySettingCollaborationMember.mockResolvedValue({ taskId: 'task-r', discussionId: 'discussion-1', status: 'queued' });
  api.fetchSettingCollaboration.mockResolvedValue({
    item: workspaceItem,
    screenwriters,
    panel: {
      taskId: 'task-1', discussionId: 'discussion-1', taskStatus: 'succeeded',
      discussionStatus: 'awaiting_boss', errorCode: null,
      createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z',
      proposals: [
        proposal(1, '婉儿', '方案一强调人物选择与可持续代价。'),
        proposal(2, '红玉', '方案二强调世界规则与身份错位。'),
        proposal(3, '幼薇', '方案三强调关系变化与现实压力。')
      ],
      members: []
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
  it('每份方案下方可让原编剧按最新资料重新设计，不需要重新选席', async () => {
    render(<SettingCollaborationPanel bookId="book-1" item={item} onSnapshot={vi.fn()} />);

    const firstCard = (await screen.findByText('方案一强调人物选择与可持续代价。')).closest('article');
    if (firstCard === null) throw new Error('没有找到第一份方案卡片');
    fireEvent.click(within(firstCard).getByRole('button', { name: '重新设计' }));

    await waitFor(() => expect(api.redesignSettingCollaborationMember).toHaveBeenCalledWith(
      'book-1',
      'creative-concept',
      'lead_screenwriter',
      { proposalId: 'proposal-1', idempotencyKey: expect.any(String) }
    ));
    expect(api.restartSettingCollaboration).not.toHaveBeenCalled();
  });
  it('把已有设定原文保留为作者参考并只交给作者选择的全能编剧', async () => {
    api.fetchSettingCollaboration.mockResolvedValue({
      item: workspaceItem, panel: null, revisionTask: null, historyCount: 0, fusionDraft: null,
      screenwriters,
      impact: { changesCanon: false, changesManuscript: false, formalVersionTiming: 'setting_baseline_confirmation' }
    });
    render(<SettingCollaborationPanel bookId="book-1" item={item} onSnapshot={vi.fn()} />);

    fireEvent.click(await screen.findByText('我已有现成内容（参考建议）'));
    fireEvent.click(screen.getByRole('button', { name: /婉儿/u }));
    fireEvent.change(screen.getByRole('textbox', { name: '已有设定原文' }), {
      target: { value: '雾钟只能展示未来一天，而且每次使用都会遗忘一段私人记忆。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '请 1 位编剧出方案' }));

    await waitFor(() => expect(api.createAuthorPlanningInput).toHaveBeenCalledWith('book-1', expect.objectContaining({
      surface: 'setting', subjectType: 'setting_module', subjectId: 'creative-concept',
      originalText: '雾钟只能展示未来一天，而且每次使用都会遗忘一段私人记忆。',
      intentStrength: 'preference', idempotencyKey: expect.any(String)
    })));
    expect(api.startSettingCollaboration).toHaveBeenCalledWith('book-1', 'creative-concept', {
      authorInputId: 'idea-1', idempotencyKey: expect.any(String),
      screenwriterRoleKeys: ['lead_screenwriter']
    });
  });
  it('从当前页继续暂停任务并复用已有检查点', async () => {
    api.fetchSettingCollaboration.mockResolvedValue({
      item: workspaceItem,
      panel: {
        taskId: 'task-paused', discussionId: 'discussion-paused', taskStatus: 'paused',
        discussionStatus: 'failed', errorCode: null,
        createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z', proposals: [], members: []
      },
      screenwriters,
      revisionTask: null, historyCount: 1,
      fusionDraft: null,
      impact: { changesCanon: false, changesManuscript: false, formalVersionTiming: 'setting_baseline_confirmation' }
    });
    render(<SettingCollaborationPanel bookId="book-1" item={item} onSnapshot={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '继续这项任务' }));
    await waitFor(() => expect(api.resumeTask).toHaveBeenCalledWith('book-1', 'task-paused'));
  });

  it('在当前页选择多份独立方案后直接组合成作者可编辑稿，不提前调用主编', async () => {
    render(<SettingCollaborationPanel bookId="book-1" item={item} onSnapshot={vi.fn()} />);

    fireEvent.click((await screen.findAllByRole('button', { name: '整份选用' }))[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: '整份选用' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: '整理成可编辑稿' }));

    const editor = screen.getByRole('textbox', { name: '待确认设定内容' });
    expect(editor).toHaveValue('方案一强调人物选择与可持续代价。\n\n方案二强调世界规则与身份错位。');
    expect(screen.getByText(/这里不调用主编/u)).toBeInTheDocument();
    expect(api.createAuthorPlanningInput).not.toHaveBeenCalled();
  });
  it('接口未返回新版编剧数组时，兼容席位仍可正常选择并启动', async () => {
    api.fetchSettingCollaboration.mockResolvedValue({
      item: workspaceItem, panel: null, revisionTask: null, historyCount: 0, fusionDraft: null,
      screenwriters: [],
      impact: { changesCanon: false, changesManuscript: false, formalVersionTiming: 'setting_baseline_confirmation' }
    });
    render(<SettingCollaborationPanel bookId="book-1" item={item} onSnapshot={vi.fn()} />);

    const writer = await screen.findByRole('button', { name: /婉儿/u });
    fireEvent.click(writer);
    expect(writer).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '请 1 位编剧出方案' }));

    await waitFor(() => expect(api.startSettingCollaboration).toHaveBeenCalledWith(
      'book-1', 'creative-concept', expect.objectContaining({ screenwriterRoleKeys: ['lead_screenwriter'] })
    ));
  });

  it('自己写一份和先留白均可展开、关闭并恢复输入', async () => {
    api.fetchSettingCollaboration.mockResolvedValue({
      item: workspaceItem, panel: null, revisionTask: null, historyCount: 0, fusionDraft: null,
      screenwriters,
      impact: { changesCanon: false, changesManuscript: false, formalVersionTiming: 'setting_baseline_confirmation' }
    });
    render(<SettingCollaborationPanel bookId="book-1" item={item} onSnapshot={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '自己写一份' }));
    const editor = screen.getByRole('textbox', { name: '待确认设定内容' });
    fireEvent.change(editor, { target: { value: '作者暂存的自写内容。' } });
    fireEvent.click(screen.getByRole('button', { name: '收起自己写一份' }));
    expect(screen.queryByRole('textbox', { name: '待确认设定内容' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '自己写一份' }));
    expect(screen.getByRole('textbox', { name: '待确认设定内容' })).toHaveValue('作者暂存的自写内容。');
    fireEvent.click(screen.getByRole('button', { name: '先留白，以后再定' }));
    expect(screen.queryByRole('textbox', { name: '待确认设定内容' })).not.toBeInTheDocument();
    const blankPanel = screen.getByRole('group', { name: '先留白，以后再定' });
    fireEvent.click(within(blankPanel).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('group', { name: '先留白，以后再定' })).not.toBeInTheDocument();
  });

  it('不可用编剧明确禁用并显示原因', async () => {
    api.fetchSettingCollaboration.mockResolvedValue({
      item: workspaceItem,
      screenwriters: screenwriters.map((member) => member.roleKey === 'senior_screenwriter'
        ? { ...member, availability: 'unavailable', availabilityReason: '模型路线缺少可用凭证' }
        : member),
      panel: null, revisionTask: null, historyCount: 0, fusionDraft: null,
      impact: { changesCanon: false, changesManuscript: false, formalVersionTiming: 'setting_baseline_confirmation' }
    });
    render(<SettingCollaborationPanel bookId="book-1" item={item} onSnapshot={vi.fn()} />);

    const senior = await screen.findByRole('button', { name: /清照/u });
    expect(senior).toBeDisabled();
    expect(senior).toHaveTextContent('不可用');
    expect(senior).toHaveTextContent('模型路线缺少可用凭证');
  });

  it('单席失败保留成功方案并只重试失败编剧', async () => {
    api.fetchSettingCollaboration.mockResolvedValue({
      item: workspaceItem,
      screenwriters,
      panel: {
        taskId: 'task-partial', discussionId: 'discussion-partial', taskStatus: 'succeeded',
        discussionStatus: 'collecting', errorCode: null,
        createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z',
        proposals: [proposal(1, '婉儿', '已完成且必须保留的成功方案。')],
        members: [
          {
            agentId: 'agent-1', memberName: '婉儿', roleKey: 'lead_screenwriter',
            status: 'completed', contextSummary: '最小资料', outputSummary: '成功方案',
            errorSummary: null, retryable: false, lastAttemptedAt: '2026-08-08T00:00:00.000Z'
          },
          {
            agentId: 'agent-2', memberName: '红玉', roleKey: 'second_screenwriter',
            status: 'unavailable', contextSummary: '最小资料', outputSummary: null,
            errorSummary: '模型服务暂时不可用', retryable: true, lastAttemptedAt: '2026-08-08T00:00:00.000Z'
          }
        ]
      },
      revisionTask: null, historyCount: 1, fusionDraft: null,
      impact: { changesCanon: false, changesManuscript: false, formalVersionTiming: 'setting_baseline_confirmation' }
    });
    render(<SettingCollaborationPanel bookId="book-1" item={item} onSnapshot={vi.fn()} />);

    expect(await screen.findByText('已完成且必须保留的成功方案。')).toBeInTheDocument();
    expect(screen.getByText('模型服务暂时不可用')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '只重试这位' }));
    await waitFor(() => expect(api.retrySettingCollaborationMember).toHaveBeenCalledWith(
      'book-1', 'creative-concept', 'second_screenwriter', expect.any(String)
    ));
  });

  it('允许作者直接编辑候选稿并在当前页确认', async () => {
    const candidate = {
      ...workspaceItem,
      status: '候选待确认' as const,
      content: '城市公开运行高等级技术，但医疗分配仍受身份和信用限制。',
      candidateAt: '2026-08-08T00:02:00.000Z'
    };
    api.fetchSettingCollaboration.mockResolvedValue({
      screenwriters,
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
    roleKey: number === 1 ? 'lead_screenwriter' : number === 2 ? 'second_screenwriter' : 'third_screenwriter',
    modelProvider: `provider-${number}`, modelId: `model-${number}`, content,
    decisionId: 'decision-1', createdAt: '2026-08-08T00:00:00.000Z', fragments: []
  };
}
