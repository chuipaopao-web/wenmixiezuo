import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { OpeningBlueprintInput } from '../../contracts/opening-blueprint.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { DiscussionService } from '../discussions/discussion-service.js';
import { TaskService } from '../tasks/task-service.js';
import { SettingCollaborationRepository } from '../../infrastructure/db/repositories/setting-collaboration-repository.js';
import { compileMacroOpeningBookCore, SettingGuidanceService, type SettingGuidanceSnapshot, type TemporarySettingContextPack } from './setting-guidance-service.js';
import { EditorLeaseService } from '../editors/editor-lease-service.js';
import { SettingOutlineWorkspaceService } from './setting-outline-workspace-service.js';
import { PlanningWorkflowRepository } from '../../infrastructure/db/repositories/planning-workflow-repository.js';
import { hashConfirmedSettings, SETTING_QUALITY_AUDIT_INSTRUCTION } from './setting-quality-shared.js';
import { isMacroSettingItem } from './setting-outline-profile.js';

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
const selectableScreenwriterRoleKeys = [
  'lead_screenwriter', 'second_screenwriter', 'third_screenwriter', 'senior_screenwriter'
] as const;
type SelectableScreenwriterRoleKey = typeof selectableScreenwriterRoleKeys[number];


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
    input: { authorInputId?: string | null; idempotencyKey: string; screenwriterRoleKeys: string[] }
  ): CommandResult {
    assertBookScope(scope);
    this.preferChiefWhenSafe(scope);
    const selectedRoleKeys = this.normalizeSelectedScreenwriters(input.screenwriterRoleKeys);
    this.ensureDistinctPanelModels(scope, selectedRoleKeys);
    const guidance = this.requireGuidance(scope, itemKey);
    const existing = this.repository.latestPanel(scope, itemKey);
    if (existing !== undefined) {
      const existingProposals = this.repository.proposals(scope, existing.discussion_id);
      const distinctExistingModels = new Set(existingProposals.map((proposal) => `${proposal.model_provider}/${proposal.model_id}`));
      const completedPanelIsPolluted = existing.task_status === 'succeeded'
        && existingProposals.length > 1
        && distinctExistingModels.size !== existingProposals.length;
      const existingScope = this.repository.discussionScopeText(scope, existing.discussion_id);
      const usesCurrentTemporaryPack = existingScope !== undefined
        && temporaryPackHashFromScope(existingScope) === guidance.temporaryContextPack.contentHash;
      if (!completedPanelIsPolluted && usesCurrentTemporaryPack) {
        return { taskId: existing.task_id, discussionId: existing.discussion_id, status: existing.task_status, reused: true };
      }
    }
    const authorText = this.authorInputText(scope, itemKey, input.authorInputId ?? null);
    return this.schedule(scope, {
      type: selectedRoleKeys.length <= 3 ? 'quick' : 'collaborative',
      purpose: 'setting_proposal_panel',
      itemKey,
      scopeText: buildProposalScope(guidance, authorIdeaLine(authorText), selectedRoleKeys.length),
      authorInputIds: input.authorInputId == null ? [] : [input.authorInputId],
      idempotencyKey: 'setting-proposal:' + itemKey + ':' + guidance.temporaryContextPack.contentHash.slice(0, 16) + ':' + normalizeKey(input.idempotencyKey),
      includeScreenwriters: true,
      selectedRoleKeys
    });
  }

  /**
   * 重新设计：作者对本轮方案不满意时，放弃复用旧讨论，
   * 按作者新选择的编剧全新提案一轮。旧讨论与旧方案保留可追溯，
   * 前端始终展示最新一轮。上一轮任务仍在进行时拒绝，避免同项两轮并行。
   */
  public restart(
    scope: BookScope,
    itemKey: string,
    input: { authorInputId?: string | null; idempotencyKey: string; screenwriterRoleKeys: string[] }
  ): CommandResult {
    assertBookScope(scope);
    this.preferChiefWhenSafe(scope);
    const selectedRoleKeys = this.normalizeSelectedScreenwriters(input.screenwriterRoleKeys);
    this.ensureDistinctPanelModels(scope, selectedRoleKeys);
    const existing = this.repository.latestPanel(scope, itemKey);
    if (existing !== undefined && ['pending', 'queued', 'working'].includes(existing.task_status)) {
      throw new DomainError(errorCodes.operationIncomplete, '这一轮设计还在进行中，等它结束后才能重新设计', {}, false, 409);
    }
    const guidance = this.requireGuidance(scope, itemKey, true);
    const authorText = this.authorInputText(scope, itemKey, input.authorInputId ?? null);
    return this.schedule(scope, {
      type: selectedRoleKeys.length <= 3 ? 'quick' : 'collaborative',
      purpose: 'setting_proposal_panel',
      itemKey,
      scopeText: buildProposalScope(guidance, authorIdeaLine(authorText), selectedRoleKeys.length),
      authorInputIds: input.authorInputId == null ? [] : [input.authorInputId],
      idempotencyKey: 'setting-proposal-redesign:' + itemKey + ':' + guidance.temporaryContextPack.contentHash.slice(0, 16) + ':' + normalizeKey(input.idempotencyKey),
      includeScreenwriters: true,
      selectedRoleKeys
    });
  }

  public redesignMember(
    scope: BookScope,
    itemKey: string,
    input: { roleKey: string; proposalId: string; idempotencyKey: string }
  ): CommandResult {
    assertBookScope(scope);
    this.preferChiefWhenSafe(scope);
    const roleKey = this.normalizeSelectedScreenwriters([input.roleKey])[0]!;
    this.ensureDistinctPanelModels(scope, [roleKey]);
    const existing = this.repository.latestPanel(scope, itemKey);
    if (existing !== undefined && ['pending', 'queued', 'working'].includes(existing.task_status)) {
      throw new DomainError(errorCodes.operationIncomplete, '这一轮设计还在进行中，等它结束后才能重新设计', {}, false, 409);
    }
    const prior = this.repository.latestProposalsByRole(scope, itemKey)
      .find((proposal) => proposal.proposal_id === input.proposalId && proposal.role_key === roleKey);
    if (prior === undefined) {
      throw new DomainError(errorCodes.operationIncomplete, '待重做的编剧方案已经变化，请刷新后再试', {}, true, 409);
    }
    const guidance = this.requireGuidance(scope, itemKey, true);
    const priorHash = createHash('sha256').update(prior.content).digest('hex');
    const scopeText = buildProposalScope(guidance, '作者本轮原话：没有额外补充', 1)
      + '\n' + buildMemberRedesignConstraint(prior.member_name, prior.content, priorHash);
    return this.schedule(scope, {
      type: 'quick',
      purpose: 'setting_proposal_panel',
      itemKey,
      scopeText,
      authorInputIds: [],
      idempotencyKey: 'setting-proposal-member-redesign:' + itemKey + ':' + roleKey + ':'
        + guidance.temporaryContextPack.contentHash.slice(0, 16) + ':' + priorHash.slice(0, 16) + ':'
        + normalizeKey(input.idempotencyKey),
      includeScreenwriters: true,
      selectedRoleKeys: [roleKey]
    });
  }

  public retryMember(
    scope: BookScope,
    itemKey: string,
    input: { roleKey: string; idempotencyKey: string }
  ): CommandResult {
    assertBookScope(scope);
    this.preferChiefWhenSafe(scope);
    const roleKey = this.normalizeSelectedScreenwriters([input.roleKey])[0]!;
    this.ensureDistinctPanelModels(scope, [roleKey]);
    const panel = this.repository.latestPanel(scope, itemKey);
    if (panel === undefined || panel.discussion_status !== 'collecting') {
      throw new DomainError(errorCodes.operationIncomplete, '当前没有可以单独补写的编剧席位', {}, false, 409);
    }
    const member = this.repository.panelMembers(scope, panel.discussion_id)
      .find((candidate) => candidate.role_key === roleKey);
    if (member === undefined || !['failed', 'unavailable'].includes(member.run_status)) {
      throw new DomainError(errorCodes.operationIncomplete, '这名编剧当前不需要补写', {}, false, 409);
    }
    const now = this.clock.now().toISOString();
    if (!this.repository.resetPanelMemberForRetry(scope, panel.discussion_id, member.agent_id, now)) {
      throw new DomainError(errorCodes.operationIncomplete, '编剧状态已经变化，请刷新后再试', {}, true, 409);
    }
    const discussionScopeText = this.repository.discussionScopeText(scope, panel.discussion_id);
    if (discussionScopeText === undefined) throw new Error('设定讨论不存在或不属于当前书籍');
    const guidance = this.requireGuidance(scope, itemKey, true);
    const refreshedScopeText = replaceTemporaryPackInScope(
      discussionScopeText, guidance.temporaryContextPack
    );
    const budgetId = this.repository.activeBudgetId(scope);
    if (budgetId === undefined) throw new Error('当前书籍没有活动预算');
    const lease = this.requireEditorLease(scope);
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    const task = tasks.create(scope, {
      taskId: this.ids.next(),
      taskType: 'discussion',
      assignedAgentId: lease.agentId,
      idempotencyKey: 'setting-member-retry:' + itemKey + ':' + roleKey + ':' + guidance.temporaryContextPack.contentHash.slice(0, 16) + ':' + normalizeKey(input.idempotencyKey),
      budgetId,
      requiredEditorEpoch: lease.editorEpoch,
      initialPhase: 'collecting',
      brief: {
        discussionId: panel.discussion_id,
        scopeText: refreshedScopeText,
        purpose: 'setting_proposal_panel',
        settingItemKey: itemKey,
        authorInputIds: [],
        selectedFragmentIds: [],
        targetAgentIds: [member.agent_id],
        requestedChapterCount: null
      }
    });
    const queued = task.status === 'pending' ? tasks.queue(scope, task.taskId) : task;
    return { taskId: queued.taskId, discussionId: panel.discussion_id, status: queued.status, reused: false };
  }
  /**
   * 整份设定质检：活动主编独立苛刻检查全部已确认设定。
   * 幂等键带内容指纹：内容没变时重复点击复用同一任务，不产生双倍调用。
   */
  public audit(scope: BookScope, input: { idempotencyKey: string }): CommandResult {
    assertBookScope(scope);
    this.preferChiefWhenSafe(scope);
    const workspace = new SettingOutlineWorkspaceService(this.database, this.clock);
    const confirmed = workspace.list(scope)
      .filter((item) => isMacroSettingItem(item) && item.status === '已确认' && item.content !== null);
    if (confirmed.length === 0) {
      throw new DomainError(errorCodes.operationIncomplete, '还没有已确认的设定，先完成至少一项再让主编检查', {}, false, 409);
    }
    const fingerprint = hashConfirmedSettings(confirmed);
    const rawBlueprint = new PlanningWorkflowRepository(this.database).openingBlueprint(scope) ?? '{}';
    let macroOpeningBookCore = '{}';
    try {
      macroOpeningBookCore = compileMacroOpeningBookCore(JSON.parse(rawBlueprint) as OpeningBlueprintInput);
    } catch { /* 历史坏数据由其他门禁处理；质检资料包不扩散。 */ }
    const scopeText = [
      '【整份设定质检资料包】',
      '【质检内容指纹】' + fingerprint,
      '本书宏观开书信息（只含世界背景、初始地图、题材风格和作者硬边界）：' + macroOpeningBookCore,
      '全部已确认设定：' + JSON.stringify(confirmed.map((item) => ({
        itemKey: item.itemKey, label: item.label, content: item.content
      }))),
      SETTING_QUALITY_AUDIT_INSTRUCTION,
      '只输出质检报告JSON，不改写设定内容，不生成剧情、卷纲或正文。'
    ].join('\n');
    return this.schedule(scope, {
      type: 'quick',
      purpose: 'setting_quality_audit',
      itemKey: '__whole_setting__',
      scopeText,
      authorInputIds: [],
      idempotencyKey: 'setting-quality-audit:' + fingerprint + ':' + normalizeKey(input.idempotencyKey),
      includeScreenwriters: false
    });
  }

  private schedule(
    scope: BookScope,
    input: {
      type: 'quick' | 'collaborative';
      purpose: 'setting_proposal_panel' | 'setting_quality_audit';
      itemKey: string;
      scopeText: string;
      authorInputIds: string[];
      idempotencyKey: string;
      includeScreenwriters: boolean;
      selectedFragmentIds?: string[];
      selectedRoleKeys?: SelectableScreenwriterRoleKey[];
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
    // 编剧全部是通用完整方案席；只召集作者本次明确选中的成员。
    const participants = input.includeScreenwriters
      ? this.repository.proposalPanelAgentIds(scope, input.selectedRoleKeys ?? []).map((seat) => ({
        agentId: seat.agentId,
        reason: '提案席独立构思，不查看其他成员答案'
      }))
      : [{
        agentId: lease.agentId,
        reason: '活动主编执行整份设定审查'
      }];
    if (input.includeScreenwriters && participants.length !== (input.selectedRoleKeys?.length ?? 0)) {
      throw new DomainError(errorCodes.agentCapabilityUnavailable,
        '所选编剧中有成员当前不可用，请刷新成员状态后重新选择。',
        { selectedRoleKeys: input.selectedRoleKeys ?? [] }, false, 409);
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
        targetAgentIds: input.includeScreenwriters ? participants.map((participant) => participant.agentId) : [],
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

  private normalizeSelectedScreenwriters(values: string[]): SelectableScreenwriterRoleKey[] {
    const selected = [...new Set(values)];
    if (selected.length < 1 || selected.length > selectableScreenwriterRoleKeys.length
      || selected.some((value) => !(selectableScreenwriterRoleKeys as readonly string[]).includes(value))) {
      throw new DomainError(errorCodes.validation, '请选择一至四名可用编剧');
    }
    return selected as SelectableScreenwriterRoleKey[];
  }

  private ensureDistinctPanelModels(
    scope: BookScope,
    roleKeys: SelectableScreenwriterRoleKey[]
  ): EditorLease {
    const proposalSeats = this.repository.proposalPanelAgentIds(scope, roleKeys);
    if (proposalSeats.length !== roleKeys.length) {
      const available = new Set(proposalSeats.map((seat) => seat.roleKey));
      throw new DomainError(errorCodes.agentCapabilityUnavailable,
        '所选编剧中有成员当前不可用，请刷新成员状态后重新选择。',
        { unavailableRoleKeys: roleKeys.filter((roleKey) => !available.has(roleKey)) }, false, 409);
    }
    const profiles = this.repository.agentModelProfiles(scope, proposalSeats.map((seat) => seat.agentId));
    const lease = this.requireEditorLease(scope);
    if (profiles.length === roleKeys.length && profiles.every((profile) =>
      profile.provider.startsWith('local-deterministic') && profile.plan_type === 'deterministic')) {
      return lease;
    }
    const signatures = new Set(profiles.map((profile) => `${profile.provider}/${profile.model_id}`));
    if (profiles.length !== roleKeys.length || signatures.size !== roleKeys.length) {
      throw new DomainError(errorCodes.agentCapabilityUnavailable,
        '所选编剧没有形成独立模型席位，请减少重复成员或在后台修正模型绑定。',
        { selectedRoleKeys: roleKeys, distinctModelCount: signatures.size }, false, 409);
    }
    return lease;
  }
}

function buildProposalScope(guidance: SettingGuidanceSnapshot, authorLine: string, selectedCount: number): string {
  return [
    '【设定项目作者选席独立提案】',
    '当前设定项编号：' + guidance.itemKey,
    '当前设定项：' + guidance.label,
    '当前问题：' + guidance.prompt,
    '本书宏观开书信息（只含世界背景、初始地图、题材风格和作者硬边界）：' + guidance.openingBookCore,
    '作品定位摘要：' + guidance.positioningSummary,
    '宏观证据参考：' + guidance.storyDirectionReference,
    temporaryPackScopeBlock(guidance.temporaryContextPack),
    authorLine,
    `任务：作者本轮选择了${selectedCount}名通用编剧。每名编剧都能独立完成整个框架，必须分别独立思考，互不查看、讨论或综合其他成员答案；每人只提交一份真正推荐、可供作者选择的完整设定方案，并拆成作者可逐条勾选的碎片。`,
    '只讨论不依赖具体人物和剧情也成立的世界规则。不得设计主角、配角、反派、人物关系、剧情对手、事件目标或情感进展；不得生成卷纲、事件、章纲或正文。内容不会自动合并，也不会自动确认。'
  ].join('\n');
}

function buildMemberRedesignConstraint(
  memberName: string | null,
  priorContent: string,
  priorHash: string
): string {
  const compactPrior = priorContent.replace(/\s+/gu, ' ').trim().slice(0, 1_200);
  return [
    '【单席重新设计排除依据】',
    '上一方案编剧：' + (memberName?.trim() || '当前编剧'),
    '上一方案指纹：' + priorHash,
    '上一方案摘要：' + compactPrior,
    '这是一次新的设计任务。必须使用上方调用时重新编译的临时设定资料包，但不能复述、换词改写或沿用上一方案的核心机制、因果组织、关键限制组合与表达结构。',
    '新方案至少在世界机制、约束与代价、可写性后果三个方面形成实质不同的选择；若仍有相同硬边界，必须说明它来自资料包而非沿用旧方案。'
  ].join('\n');
}

const temporaryPackStartMarker = '【临时设定资料包开始】';
const temporaryPackEndMarker = '【临时设定资料包结束】';

function temporaryPackScopeBlock(pack: TemporarySettingContextPack): string {
  return [
    temporaryPackStartMarker,
    '资料包性质：作者已逐项确认、但尚未经过主编审查；它只是本轮设定设计的临时约束，不属于正史。',
    '临时资料包指纹：' + pack.contentHash,
    '已确认条目数量：' + pack.itemCount,
    '已确认条目简要概述：' + JSON.stringify(pack.items),
    temporaryPackEndMarker
  ].join('\n');
}

function temporaryPackHashFromScope(scopeText: string): string | null {
  const match = scopeText.match(/^临时资料包指纹：([a-f0-9]{64})$/mu);
  return match?.[1] ?? null;
}

function replaceTemporaryPackInScope(
  scopeText: string,
  pack: TemporarySettingContextPack
): string {
  const start = scopeText.indexOf(temporaryPackStartMarker);
  const end = scopeText.indexOf(temporaryPackEndMarker);
  const next = temporaryPackScopeBlock(pack);
  if (start < 0 || end < start) return scopeText + '\n' + next;
  return scopeText.slice(0, start) + next
    + scopeText.slice(end + temporaryPackEndMarker.length);
}
function authorIdeaLine(idea: { text: string; intent: string } | null): string {
  if (idea === null || idea.text.length === 0) return '作者本轮原话：没有额外补充';
  switch (idea.intent) {
    case 'must':
      return `作者本轮要求（必须遵守，方案不得与之冲突）：${idea.text}`;
    case 'question':
      return `作者本轮疑问（只回答和标明未知，不得把问题本身自动写成正式设定）：${idea.text}`;
    case 'inspiration':
      return `作者本轮灵感（只是启发，可采用也可不采用）：${idea.text}`;
    default:
      return `作者本轮强烈偏好（优先照顾，但不是已确认事实；你是专业设计者，方案必须由你主导；方案中符合作者想法的观点保持两到五成，最多不超过一半，不得把作者想法照抄当成结论；开书信息里的"必须遵守"条目仍是硬边界）：${idea.text}`;
  }
}

function normalizeKey(value: string): string {
  const key = value.trim();
  if (key.length < 8 || key.length > 200) {
    throw new DomainError(errorCodes.validation, '幂等键长度必须为8到200个字符');
  }
  return key;
}
