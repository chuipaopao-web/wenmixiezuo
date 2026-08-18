import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { DiscussionService } from '../discussions/discussion-service.js';
import { TaskService } from '../tasks/task-service.js';
import { SettingCollaborationRepository } from '../../infrastructure/db/repositories/setting-collaboration-repository.js';
import { SettingGuidanceService, type SettingGuidanceSnapshot } from './setting-guidance-service.js';
import { prepareEffectiveOutput } from '../presentation/author-output-service.js';
import { EditorLeaseService } from '../editors/editor-lease-service.js';

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
    this.preferChiefWhenSafe(scope);
    const panelLease = this.ensureDistinctPanelModels(scope);
    const existing = this.repository.latestPanel(scope, itemKey);
    const existingModels = existing === undefined
      ? []
      : existing.task_status === 'succeeded'
        ? this.repository.proposals(scope, existing.discussion_id)
          .map((proposal) => `${proposal.model_provider}/${proposal.model_id}`)
        : this.repository.panelMembers(scope, existing.discussion_id)
          .map((member) => `${member.model_provider}/${member.model_id}`);
    const existingHasDistinctModels = existingModels.length === 3
      && new Set(existingModels).size === 3;
    if (existing !== undefined && existingHasDistinctModels
      && !['failed', 'cancelled', 'interrupted'].includes(existing.task_status)) {
      return { taskId: existing.task_id, discussionId: existing.discussion_id, status: existing.task_status, reused: true };
    }
    const guidance = this.requireGuidance(scope, itemKey);
    const authorText = this.authorInputText(scope, itemKey, input.authorInputId ?? null);
    return this.schedule(scope, {
      type: 'collaborative',
      purpose: 'setting_proposal_panel',
      itemKey,
      scopeText: buildProposalScope(guidance, authorIdeaLine(authorText)),
      authorInputIds: input.authorInputId == null ? [] : [input.authorInputId],
      idempotencyKey: 'setting-proposal:' + itemKey + ':' + normalizeKey(input.idempotencyKey)
        + (existing === undefined ? '' : `:distinct-model-recovery-${panelLease.editorEpoch}-${existing.discussion_id}`),
      includeScreenwriters: true
    });
  }

  /**
   * 重新设计：作者对本轮三份方案都不满意时，放弃复用旧讨论，
   * 召集三席围绕当前问题全新提案一轮。旧讨论与旧方案保留可追溯，
   * 前端始终展示最新一轮。上一轮任务仍在进行时拒绝，避免同项两轮并行。
   */
  public restart(
    scope: BookScope,
    itemKey: string,
    input: { authorInputId?: string | null; idempotencyKey: string }
  ): CommandResult {
    assertBookScope(scope);
    this.preferChiefWhenSafe(scope);
    this.ensureDistinctPanelModels(scope);
    const existing = this.repository.latestPanel(scope, itemKey);
    if (existing !== undefined && ['pending', 'queued', 'working'].includes(existing.task_status)) {
      throw new DomainError(errorCodes.operationIncomplete, '这一轮设计还在进行中，等它结束后才能重新设计', {}, false, 409);
    }
    const guidance = this.requireGuidance(scope, itemKey);
    const authorText = this.authorInputText(scope, itemKey, input.authorInputId ?? null);
    return this.schedule(scope, {
      type: 'collaborative',
      purpose: 'setting_proposal_panel',
      itemKey,
      scopeText: buildProposalScope(guidance, authorIdeaLine(authorText)),
      authorInputIds: input.authorInputId == null ? [] : [input.authorInputId],
      idempotencyKey: 'setting-proposal-redesign:' + itemKey + ':' + normalizeKey(input.idempotencyKey),
      includeScreenwriters: true
    });
  }

  public synthesize(
    scope: BookScope,
    itemKey: string,
    input: { proposalIds: string[]; fragmentIds?: string[]; authorInputId?: string | null; idempotencyKey: string }
  ): CommandResult {
    assertBookScope(scope);
    this.preferChiefWhenSafe(scope);
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
      return {
        proposalId,
        memberName: proposal.member_name ?? '未知成员',
        content: compactProposalForSynthesis(proposal.content)
      };
    });
    const distinctModels = new Set(selected.map((proposal) => {
      const source = proposals.find((candidate) => candidate.proposal_id === proposal.proposalId)!;
      return `${source.model_provider}/${source.model_id}`;
    }));
    if (selected.length === 3 && distinctModels.size !== 3) {
      throw new DomainError(errorCodes.agentCapabilityUnavailable,
        '三份方案没有来自三种不同模型，不能当作三种独立意见进入融合。请重新召集成员。', {
          selectedCount: selected.length,
          distinctModelCount: distinctModels.size
        }, false, 409);
    }
    const fragmentIds = [...new Set(input.fragmentIds ?? [])];
    const selectedFragments = fragmentIds.length === 0 ? [] : this.repository.fragmentsByIds(scope, fragmentIds).map((row) => {
      if (row.discussion_id !== panel.discussion_id || row.item_key !== itemKey) {
        throw new DomainError(errorCodes.validation, '勾选的碎片不存在、已过期或不属于当前设定项');
      }
      return { fragmentId: row.fragment_id, memberName: row.member_name, text: row.fragment_text };
    });
    if (fragmentIds.length > 0 && selectedFragments.length !== fragmentIds.length) {
      throw new DomainError(errorCodes.validation, '勾选的碎片不存在、已过期或不属于当前设定项');
    }
    return this.scheduleSynthesis(scope, guidance, {
      authorInputId: input.authorInputId ?? null,
      idempotencyKey: input.idempotencyKey,
      selected,
      selectedFragments,
      instruction: selectedFragments.length > 0
        ? '只依据作者勾选的碎片和补充原话融合；每条碎片的原意必须保留；碎片之间缺衔接时由你补写最短衔接，并逐段标注来源。'
        : '只依据作者明确选中的方案和补充；有冲突时说明取舍，不引入未选方案。'
    });
  }

  public revise(
    scope: BookScope,
    itemKey: string,
    input: { authorInputId: string; idempotencyKey: string }
  ): CommandResult {
    assertBookScope(scope);
    this.preferChiefWhenSafe(scope);
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
      selectedFragments?: Array<{ fragmentId: string; memberName: string; text: string }>;
      instruction: string;
    }
  ): CommandResult {
    const authorText = this.authorInputText(scope, guidance.itemKey, input.authorInputId);
    const itemJson = JSON.stringify([{ itemKey: guidance.itemKey, label: guidance.label, prompt: guidance.prompt }]);
    const scopeText = [
      '【设定成组讨论资料包】',
      '本批设定项JSON：' + itemJson,
      '本书完整开书信息（作者已填写，优先级高于AI推测）：' + guidance.openingBookCore,
      '作品定位摘要：' + guidance.positioningSummary,
      '故事方向参考：' + guidance.storyDirectionReference,
      '已经确认的前置设定：' + JSON.stringify(guidance.confirmedContext),
      '现有候选：' + (guidance.previousCandidate ?? '暂无'),
      '作者选中的独立方案：' + JSON.stringify(input.selected),
      '作者勾选的碎片：' + JSON.stringify(input.selectedFragments ?? []),
      authorIdeaLine(authorText),
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
      includeScreenwriters: false,
      selectedFragmentIds: (input.selectedFragments ?? []).map((fragment) => fragment.fragmentId)
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
      selectedFragmentIds?: string[];
    }
  ): CommandResult {
    let resolvedIdempotencyKey = input.idempotencyKey;
    let existing = this.repository.taskByIdempotencyKey(scope, resolvedIdempotencyKey);
    while (existing !== undefined && ['failed', 'cancelled', 'interrupted'].includes(existing.status)) {
      resolvedIdempotencyKey = `setting-retry:${input.itemKey}:${existing.task_id}`;
      existing = this.repository.taskByIdempotencyKey(scope, resolvedIdempotencyKey);
    }
    if (existing !== undefined) {
      const brief = JSON.parse(existing.task_brief_json) as { discussionId: string };
      return { taskId: existing.task_id, discussionId: brief.discussionId, status: existing.status, reused: true };
    }

    const lease = this.requireEditorLease(scope);
    // 提案三席是编剧A（强冲突）、编剧B（重因果）与设定（规则严谨）；
    // 活动主编不提交提案，只在作者勾选后负责融合。
    const participants = input.includeScreenwriters
      ? this.repository.proposalPanelAgentIds(scope).map((seat) => ({
        agentId: seat.agentId,
        reason: '提案席独立构思，不查看其他成员答案'
      }))
      : [{
        agentId: lease.agentId,
        reason: '活动主编按作者选择整理待确认版本'
      }];
    if (input.includeScreenwriters && participants.length !== 3) {
      throw new Error('设定独立提案需要编剧A、编剧B与设定三席都可用');
    }

    const budgetId = this.repository.activeBudgetId(scope);
    if (budgetId === undefined) throw new Error('当前书籍没有活动预算');
    const discussion = new DiscussionService(this.database, this.ids, this.clock).create(scope, {
      type: input.type,
      scopeText: input.scopeText,
      createdByAgentId: input.includeScreenwriters && participants.length > 0 ? participants[0]!.agentId : lease.agentId,
      participants
    });

    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    const task = tasks.create(scope, {
      taskId: this.ids.next(),
      taskType: 'discussion',
      assignedAgentId: lease.agentId,
      idempotencyKey: resolvedIdempotencyKey,
      budgetId,
      requiredEditorEpoch: lease.editorEpoch,
      initialPhase: 'collecting',
      brief: {
        discussionId: discussion.discussionId,
        scopeText: input.scopeText,
        purpose: input.purpose,
        settingItemKey: input.itemKey,
        authorInputIds: input.authorInputIds,
        selectedFragmentIds: input.selectedFragmentIds ?? [],
        requestedChapterCount: null
      }
    });
    const queued = task.status === 'pending' ? tasks.queue(scope, task.taskId) : task;
    return { taskId: queued.taskId, discussionId: discussion.discussionId, status: queued.status, reused: false };
  }

  private requireGuidance(scope: BookScope, itemKey: string, allowCandidate = false): SettingGuidanceSnapshot {
    const guidanceService = new SettingGuidanceService(this.database, this.ids, this.clock);
    const guided = guidanceService.ensureInitialized(scope);
    const guidance = guided !== null && guided.itemKey === itemKey ? guided : guidanceService.snapshotFor(scope, itemKey);
    if (guidance === null) {
      throw new DomainError(errorCodes.operationIncomplete, '当前设定项不存在或尚未就绪，请刷新后重试', {}, true, 409);
    }
    if (!allowCandidate && guidance.phase === 'revise') {
      throw new DomainError(errorCodes.operationIncomplete, '当前设定项已有待确认版本', {}, false, 409);
    }
    return guidance;
  }

  private authorInputText(scope: BookScope, itemKey: string, authorInputId: string | null): { text: string; intent: string } | null {
    if (authorInputId === null) return null;
    const idea = this.repository.authorInputText(scope, itemKey, authorInputId);
    if (idea === undefined) {
      throw new DomainError(errorCodes.validation, '作者想法不存在、已撤回或不属于当前设定项');
    }
    return { text: idea.text.trim(), intent: idea.intent };
  }

  private requireEditorLease(scope: BookScope): EditorLease {
    const row = this.repository.editorLease(scope);
    if (row === undefined) throw new Error('当前书籍没有活动主编租约');
    return { agentId: row.agent_id, editorEpoch: row.editor_epoch };
  }

  private preferChiefWhenSafe(scope: BookScope): EditorLease {
    const lease = this.requireEditorLease(scope);
    const chiefAgentId = this.repository.chiefEditorAgentId(scope);
    if (chiefAgentId !== undefined && chiefAgentId !== lease.agentId) {
      new EditorLeaseService(this.database, this.ids, this.clock).safeRevertToChief(scope, chiefAgentId);
    }
    return this.requireEditorLease(scope);
  }

  private ensureDistinctPanelModels(scope: BookScope): EditorLease {
    const proposalSeats = this.repository.proposalPanelAgentIds(scope);
    if (proposalSeats.length !== 3) {
      throw new DomainError(errorCodes.agentCapabilityUnavailable, '团队成员暂时没到齐，请稍后再试。', {}, false, 409);
    }
    const seatIds = proposalSeats.map((seat) => seat.agentId);
    const modelProfiles = () => this.repository.agentModelProfiles(scope, seatIds);
    let lease = this.requireEditorLease(scope);
    const activeProfiles = modelProfiles();
    // 纯确定性测试运行时只有一个本地假模型。它用于验证业务编排，不得伪装成生产模型独立性证据；
    // 真实订阅模型（以及测试中显式构造的非本地模型）则必须严格满足三模型独立。
    if (activeProfiles.length === 3
      && activeProfiles.every((profile) => profile.provider.startsWith('local-deterministic')
        && profile.plan_type === 'deterministic')) {
      return lease;
    }
    const distinctCount = (): number => new Set(
      modelProfiles().map((profile) => `${profile.provider}/${profile.model_id}`)
    ).size;
    if (distinctCount() === 3) return lease;
    const chiefAgentId = this.repository.chiefEditorAgentId(scope);
    if (chiefAgentId !== undefined && chiefAgentId !== lease.agentId) {
      new EditorLeaseService(this.database, this.ids, this.clock).safeRevertToChief(scope, chiefAgentId);
      lease = this.requireEditorLease(scope);
    }
    if (distinctCount() !== 3) {
      throw new DomainError(errorCodes.agentCapabilityUnavailable,
        '团队正在休整，暂时没法开始设计，请稍后再试。', {
          activeEditorAgentId: lease.agentId,
          editorEpoch: lease.editorEpoch
        }, false, 409);
    }
    return lease;
  }
}

function buildProposalScope(guidance: SettingGuidanceSnapshot, authorLine: string): string {
  return [
    '【设定项目三席独立提案】',
    '当前设定项编号：' + guidance.itemKey,
    '当前设定项：' + guidance.label,
    '当前问题：' + guidance.prompt,
    '本书完整开书信息（作者已填写，优先级高于AI推测）：' + guidance.openingBookCore,
    '作品定位摘要：' + guidance.positioningSummary,
    '故事方向参考：' + guidance.storyDirectionReference,
    '已经确认的前置设定：' + JSON.stringify(guidance.confirmedContext),
    authorLine,
    '任务：编剧A、编剧B与设定成员分别独立思考，互不查看、讨论或综合其他成员答案。每人只提交一份自己真正推荐、可供作者选择的明确设定方案，并拆成作者可逐条勾选的碎片。',
    '故事方向只是参考；只讨论当前设定项，不得生成卷纲、事件、章纲或正文。内容不会自动合并，也不会自动确认。'
  ].join('\n');
}

function authorIdeaLine(idea: { text: string; intent: string } | null): string {
  if (idea === null || idea.text.length === 0) return '作者本轮原话：没有额外补充';
  switch (idea.intent) {
    case 'must':
      return `作者本轮要求（必须遵守，方案不得与之冲突）：${idea.text}`;
    case 'question':
      return `作者本轮疑问（方案里顺带回答它）：${idea.text}`;
    case 'inspiration':
      return `作者本轮灵感（只是启发，可采用也可不采用）：${idea.text}`;
    default:
      return `作者本轮想法（仅供参考融合：你是专业设计者，方案必须由你主导；方案中符合作者想法的观点保持两到五成，最多不超过一半，不得把作者想法照抄当成结论；开书信息里的"必须遵守"条目仍是硬边界）：${idea.text}`;
  }
}

function normalizeKey(value: string): string {
  const key = value.trim();
  if (key.length < 8 || key.length > 200) {
    throw new DomainError(errorCodes.validation, '幂等键长度必须为8到200个字符');
  }
  return key;
}

export function compactProposalForSynthesis(raw: string): string {
  const visible = prepareEffectiveOutput(raw).visibleContent.trim();
  // 融合读取方案的明确主张、规则与后果；“为什么这样安排”、备选写法、
  // 风险提醒和下一步仍保存在原方案中按 proposalId 可追溯，但不重复占用
  // 融合硬资料预算。不能使用简单首尾拼接，否则会把主方案中段的规则切断。
  const core = visible.split(/\n(?=(?:#{1,4}\s*)?(?:为什么这样安排|还可以这样写|要留意|接下来)[:：]?)/u)[0]?.trim() ?? visible;
  if (core.length <= 1_200) return core;
  const sentenceBoundary = core.lastIndexOf('。', 1_200);
  const end = sentenceBoundary >= 800 ? sentenceBoundary + 1 : 1_200;
  return `${core.slice(0, end).trim()}\n（其余展开说明已省略，原方案仍保留可追溯。）`;
}
