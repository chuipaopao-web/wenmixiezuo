import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { DiscussionService } from '../discussions/discussion-service.js';
import { TaskService } from '../tasks/task-service.js';
import { SettingCollaborationRepository } from '../../infrastructure/db/repositories/setting-collaboration-repository.js';
import { SettingGuidanceService, type SettingGuidanceSnapshot } from './setting-guidance-service.js';

interface CommandResult {
  taskId: string;
  discussionId: string;
  status: string;
  reused: boolean;
}

interface EditorLease {
  agentId: string;
  editorEpoch: number;
}

export class SettingCollaborationCommandService {
  private readonly repository: SettingCollaborationRepository;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.repository = new SettingCollaborationRepository(database);
  }

  public start(
    scope: BookScope,
    itemKey: string,
    input: { authorInputId?: string | null; idempotencyKey: string }
  ): CommandResult {
    assertBookScope(scope);
    const existing = this.repository.latestPanel(scope, itemKey);
    if (existing !== undefined && !['failed', 'cancelled', 'interrupted'].includes(existing.task_status)) {
      return { taskId: existing.task_id, discussionId: existing.discussion_id, status: existing.task_status, reused: true };
    }
    const guidance = this.requireGuidance(scope, itemKey);
    const authorText = this.authorInputText(scope, itemKey, input.authorInputId ?? null);
    return this.schedule(scope, {
      type: 'collaborative',
      purpose: 'setting_proposal_panel',
      itemKey,
      scopeText: buildProposalScope(guidance, authorText),
      authorInputIds: input.authorInputId == null ? [] : [input.authorInputId],
      idempotencyKey: 'setting-proposal:' + itemKey + ':' + normalizeKey(input.idempotencyKey),
      includeScreenwriters: true
    });
  }

  public synthesize(
    scope: BookScope,
    itemKey: string,
    input: { proposalIds: string[]; authorInputId?: string | null; idempotencyKey: string }
  ): CommandResult {
    assertBookScope(scope);
    const guidance = this.requireGuidance(scope, itemKey, true);
    const panel = this.repository.latestPanel(scope, itemKey);
    if (panel === undefined || panel.task_status !== 'succeeded') {
      throw new DomainError(errorCodes.operationIncomplete, '三份独立方案尚未完成，暂时不能整理', {}, false, 409);
    }
    const proposals = this.repository.proposals(scope, panel.discussion_id);
    const uniqueIds = [...new Set(input.proposalIds)];
    if (uniqueIds.length === 0 || uniqueIds.length !== input.proposalIds.length) {
      throw new DomainError(errorCodes.validation, '请至少选择一份方案，并且不要重复选择');
    }
    const selected = uniqueIds.map((proposalId) => {
      const proposal = proposals.find((candidate) => candidate.proposal_id === proposalId);
      if (proposal === undefined) {
        throw new DomainError(errorCodes.validation, '所选方案不存在或不属于当前设定项');
      }
      return { proposalId, memberName: proposal.member_name ?? '未知成员', content: proposal.content };
    });
    return this.scheduleSynthesis(scope, guidance, {
      authorInputId: input.authorInputId ?? null,
      idempotencyKey: input.idempotencyKey,
      selected,
      instruction: '只依据作者明确选中的方案和补充；有冲突时说明取舍，不引入未选方案。'
    });
  }

  public revise(
    scope: BookScope,
    itemKey: string,
    input: { authorInputId: string; idempotencyKey: string }
  ): CommandResult {
    assertBookScope(scope);
    const guidance = this.requireGuidance(scope, itemKey, true);
    if (guidance.previousCandidate === null) {
      throw new DomainError(errorCodes.operationIncomplete, '当前没有可修改的设定候选', {}, false, 409);
    }
    return this.scheduleSynthesis(scope, guidance, {
      authorInputId: input.authorInputId,
      idempotencyKey: input.idempotencyKey,
      selected: [],
      instruction: '只按现有候选和作者本轮原话修改；保留作者未要求改变的内容，不向外发散。'
    });
  }

  private scheduleSynthesis(
    scope: BookScope,
    guidance: SettingGuidanceSnapshot,
    input: {
      authorInputId: string | null;
      idempotencyKey: string;
      selected: Array<{ proposalId: string; memberName: string; content: string }>;
      instruction: string;
    }
  ): CommandResult {
    const authorText = this.authorInputText(scope, guidance.itemKey, input.authorInputId);
    const itemJson = JSON.stringify([{ itemKey: guidance.itemKey, label: guidance.label, prompt: guidance.prompt }]);
    const scopeText = [
      '【设定成组讨论资料包】',
      '本批设定项JSON：' + itemJson,
      '作品定位摘要：' + guidance.positioningSummary,
      '故事方向参考：' + guidance.storyDirectionReference,
      '已经确认的前置设定：' + JSON.stringify(guidance.confirmedContext),
      '现有候选：' + (guidance.previousCandidate ?? '暂无'),
      '作者选中的独立方案：' + JSON.stringify(input.selected),
      '作者本轮原话：' + (authorText || '没有额外补充'),
      input.instruction,
      '只生成当前设定项的一份待确认版本；不得生成卷纲、事件、章纲或正文。'
    ].join('\n');
    return this.schedule(scope, {
      type: 'quick',
      purpose: 'setting_synthesis',
      itemKey: guidance.itemKey,
      scopeText,
      authorInputIds: input.authorInputId === null ? [] : [input.authorInputId],
      idempotencyKey: 'setting-synthesis:' + guidance.itemKey + ':' + normalizeKey(input.idempotencyKey),
      includeScreenwriters: false
    });
  }

  private schedule(
    scope: BookScope,
    input: {
      type: 'quick' | 'collaborative';
      purpose: 'setting_proposal_panel' | 'setting_synthesis';
      itemKey: string;
      scopeText: string;
      authorInputIds: string[];
      idempotencyKey: string;
      includeScreenwriters: boolean;
    }
  ): CommandResult {
    const existing = this.repository.taskByIdempotencyKey(scope, input.idempotencyKey);
    if (existing !== undefined) {
      const brief = JSON.parse(existing.task_brief_json) as { discussionId: string };
      return { taskId: existing.task_id, discussionId: brief.discussionId, status: existing.status, reused: true };
    }

    const lease = this.requireEditorLease(scope);
    const participants = [{
      agentId: lease.agentId,
      reason: input.includeScreenwriters ? '活动主编主持独立提案' : '活动主编按作者选择整理待确认版本'
    }];
    if (input.includeScreenwriters) {
      const screenwriters = this.repository.screenwriterAgentIds(scope);
      if (screenwriters.length !== 2) throw new Error('设定独立提案需要两名可用编剧');
      participants.push(...screenwriters.map((agentId) => ({
        agentId,
        reason: '编剧独立构思，不查看其他成员答案'
      })));
    }

    const budgetId = this.repository.activeBudgetId(scope);
    if (budgetId === undefined) throw new Error('当前书籍没有活动预算');
    const discussion = new DiscussionService(this.database, this.ids, this.clock).create(scope, {
      type: input.type,
      scopeText: input.scopeText,
      createdByAgentId: lease.agentId,
      participants
    });

    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    const task = tasks.create(scope, {
      taskId: this.ids.next(),
      taskType: 'discussion',
      assignedAgentId: lease.agentId,
      idempotencyKey: input.idempotencyKey,
      budgetId,
      requiredEditorEpoch: lease.editorEpoch,
      initialPhase: 'collecting',
      brief: {
        discussionId: discussion.discussionId,
        scopeText: input.scopeText,
        purpose: input.purpose,
        settingItemKey: input.itemKey,
        authorInputIds: input.authorInputIds,
        requestedChapterCount: null
      }
    });
    const queued = task.status === 'pending' ? tasks.queue(scope, task.taskId) : task;
    return { taskId: queued.taskId, discussionId: discussion.discussionId, status: queued.status, reused: false };
  }

  private requireGuidance(scope: BookScope, itemKey: string, allowCandidate = false): SettingGuidanceSnapshot {
    const guidance = new SettingGuidanceService(this.database, this.ids, this.clock).ensureInitialized(scope);
    if (guidance === null || guidance.itemKey !== itemKey) {
      throw new DomainError(errorCodes.operationIncomplete, '当前设定项已变化，请刷新后重试', {}, true, 409);
    }
    if (!allowCandidate && guidance.phase === 'revise') {
      throw new DomainError(errorCodes.operationIncomplete, '当前设定项已有待确认版本', {}, false, 409);
    }
    return guidance;
  }

  private authorInputText(scope: BookScope, itemKey: string, authorInputId: string | null): string {
    if (authorInputId === null) return '';
    const originalText = this.repository.authorInputText(scope, itemKey, authorInputId);
    if (originalText === undefined) {
      throw new DomainError(errorCodes.validation, '作者想法不存在、已撤回或不属于当前设定项');
    }
    return originalText.trim();
  }

  private requireEditorLease(scope: BookScope): EditorLease {
    const row = this.repository.editorLease(scope);
    if (row === undefined) throw new Error('当前书籍没有活动主编租约');
    return { agentId: row.agent_id, editorEpoch: row.editor_epoch };
  }
}

function buildProposalScope(guidance: SettingGuidanceSnapshot, authorText: string): string {
  return [
    '【设定项目三席独立提案】',
    '当前设定项编号：' + guidance.itemKey,
    '当前设定项：' + guidance.label,
    '当前问题：' + guidance.prompt,
    '作品定位摘要：' + guidance.positioningSummary,
    '故事方向参考：' + guidance.storyDirectionReference,
    '已经确认的前置设定：' + JSON.stringify(guidance.confirmedContext),
    '作者本轮原话：' + (authorText || '没有额外补充'),
    '任务：活动主编和两名编剧分别独立思考，互不查看、讨论或综合其他成员答案。每人只提交一份自己真正推荐、可供作者选择的明确设定方案。',
    '故事方向只是参考；只讨论当前设定项，不得生成卷纲、事件、章纲或正文。内容不会自动合并，也不会自动确认。'
  ].join('\n');
}

function normalizeKey(value: string): string {
  const key = value.trim();
  if (key.length < 8 || key.length > 200) {
    throw new DomainError(errorCodes.validation, '幂等键长度必须为8到200个字符');
  }
  return key;
}
