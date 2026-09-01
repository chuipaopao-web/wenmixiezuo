import { createHash, randomUUID } from 'node:crypto';
import {
  OpeningAgentEngine,
  OpeningAgentStoppedError,
  V7_GLOBAL_MEMBERS,
  V7_OPENING_MEMBERS,
  allowedModelProfilesForRole,
  modelProfileKeyForBinding,
  validateEffectiveOpeningAgentRoster,
  type OpeningAgentTaskState,
  type OpeningPackage,
  type OpeningPublishingPlatform,
  type OpeningReview,
  type OpeningReviewDecision,
  type OpeningSavedCandidate,
  type V7OpeningMemberDefinition,
  type V7OpeningRoleKey
} from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import {
  V7OpeningAgentRepository,
  type V7OpeningTaskRow
} from '../../infrastructure/db/repositories/v7-opening-agent-repository.js';
import { V7OpeningAgentModelGateway } from '../../infrastructure/models/v7-opening-agent-model-gateway.js';
import {
  publicV7OpeningPackage,
  V7_OPENING_TAXONOMY_REFERENCE,
  validateV7OpeningRevisionDraft
} from './v7-opening-package-contract.js';

const LEASE_MS = 2 * 60 * 1_000;
const LEASE_HEARTBEAT_MS = 30 * 1_000;

export interface CreateV7OpeningAgentTaskInput {
  idea: unknown;
  idempotencyKey: unknown;
  selectedChiefMemberKey?: unknown;
  selectedScreenwriterMemberKey?: unknown;
  publishingPlatform?: unknown;
}

export interface ReviseV7OpeningAgentTaskInput {
  baseCandidateId: unknown;
  openingPackage: unknown;
  adjustmentNote?: unknown;
  decisionResolutions?: unknown;
  idempotencyKey: unknown;
}

export interface V7OpeningAgentTaskView {
  taskId: string;
  idea: string;
  publishingPlatform: OpeningPublishingPlatform;
  status: string;
  phase: string;
  statusText: string;
  phaseText: string;
  isRunning: boolean;
  needsAuthorDecision: boolean;
  workflowStyle: 'direct_design_review' | 'retired_read_only';
  selectedMembers: {
    chiefEditor: { memberKey: string; displayName: string } | null;
    screenwriter: { memberKey: string; displayName: string } | null;
    designer: { memberKey: string; displayName: string } | null;
    reviewer: { memberKey: string; displayName: string } | null;
  };
  candidates: Array<{
    candidateId: string;
    kind: string;
    version: number;
    content: unknown;
    createdBy: { memberKey: string; displayName: string };
    sourceCandidateIds: string[];
  }>;
  errorMessage: string | null;
  recoveryAction: 'open_membership_required' | 'open_membership_quota' | 'open_membership_expired' | null;
  resultBookId: string | null;
  progress: { currentStep: number; totalSteps: number; percent: number };
  createdAt: string;
  updatedAt: string;
}

export class V7OpeningAgentService {
  private readonly engine: OpeningAgentEngine;

  public constructor(
    private readonly repository: V7OpeningAgentRepository,
    modelGateway: V7OpeningAgentModelGateway,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly governance: { effectiveRoster(): V7OpeningMemberDefinition[] }
  ) {
    this.engine = new OpeningAgentEngine(modelGateway, repository, V7_OPENING_TAXONOMY_REFERENCE);
  }

  public create(ownerId: string, input: CreateV7OpeningAgentTaskInput): V7OpeningAgentTaskView {
    const idea = normalizeIdea(input.idea);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    // 当前商业入口统一按番茄小说工作。请求字段只为旧客户端兼容保留，
    // 不再让作者端决定平台，也不允许旧草稿改变新任务的平台策略。
    const publishingPlatform: OpeningPublishingPlatform = 'fanqie';
    // 历史治理表曾允许给成员保存永久补充提示。新任务只冻结成员身份、
    // 模型与派单顺序；真正指令必须来自版本化岗位、工位、Skill和任务合同。
    // 旧任务快照仍原样可追溯，但不能把旧补充提示带入新的开书任务。
    const memberRoster = this.governance.effectiveRoster().map((member) => ({
      ...member,
      model: { ...member.model },
      promptInstruction: ''
    }));
    const selectedChiefMemberKey = normalizeMember(input.selectedChiefMemberKey, 'chief_editor', memberRoster);
    const selectedScreenwriterMemberKey = normalizeMember(
      input.selectedScreenwriterMemberKey,
      'screenwriter',
      memberRoster
    );
    const requestHash = createHash('sha256').update(JSON.stringify({
      idea,
      publishingPlatform,
      selectedChiefMemberKey,
      selectedScreenwriterMemberKey
    })).digest('hex');
    const now = this.clock.now().toISOString();
    const result = this.repository.createShell({
      taskId: this.ids.next(),
      ownerId,
      idempotencyKey,
      requestHash,
      ideaText: idea,
      ideaHash: createHash('sha256').update(idea).digest('hex'),
      publishingPlatform,
      selectedChiefMemberKey,
      selectedScreenwriterMemberKey,
      memberRoster,
      now
    });
    if (result.row.request_hash !== requestHash) {
      throw new DomainError(
        errorCodes.validation,
        '这个任务编号已经用于另一份开书思路或成员选择，请重新发起。',
        {},
        false,
        409
      );
    }
    if ((result.created || canResume(result.row.status)) && isCurrentV7OpeningTask(result.row)) {
      this.start(ownerId, result.row.task_id);
    }
    return this.view(result.row, this.repository.listCandidates(ownerId, result.row.task_id));
  }

  public get(ownerId: string, taskId: string): V7OpeningAgentTaskView {
    const row = this.repository.byTaskId(ownerId, taskId);
    if (row === undefined) {
      throw new DomainError(errorCodes.validation, '开书任务不存在', {}, false, 404);
    }
    if (canResume(row.status) && isCurrentV7OpeningTask(row)) this.start(ownerId, taskId);
    return this.view(row, this.repository.listCandidates(ownerId, taskId));
  }

  public list(ownerId: string, limitValue?: unknown): V7OpeningAgentTaskView[] {
    const limit = normalizeListLimit(limitValue);
    return this.repository.listByOwner(ownerId, limit).map((row) => this.view(
      row,
      this.repository.listCandidates(ownerId, row.task_id)
    ));
  }

  public abandon(ownerId: string, taskId: string): V7OpeningAgentTaskView {
    const row = this.repository.byTaskId(ownerId, taskId);
    if (row === undefined) throw new DomainError(errorCodes.validation, '开书任务不存在', {}, false, 404);
    if (!isCurrentV7OpeningTask(row)) {
      throw new DomainError(
        errorCodes.validation,
        '这项历史开书任务只能查看，已有结果已经保留。请按当前流程重新提交开书想法。',
        {},
        false,
        409
      );
    }
    const resultBookId = this.repository.confirmedBookForDraft(ownerId, openingDraftId(ownerId, taskId));
    if (resultBookId !== null) {
      throw new DomainError(errorCodes.validation, '这项任务已经正式建书，不能再放弃。', {}, false, 409);
    }
    if (row.status === 'queued' || row.status === 'working') {
      throw new DomainError(errorCodes.validation, '编辑部正在工作，请等本轮完成后再放弃。', {}, false, 409);
    }
    const archived = this.repository.archive(ownerId, taskId, this.clock.now().toISOString());
    if (archived === undefined) throw new DomainError(errorCodes.validation, '开书任务不存在', {}, false, 404);
    if (archived.error_code !== 'archived_by_author') {
      throw new DomainError(errorCodes.validation, '任务状态刚刚发生变化，请刷新后重试。', {}, true, 409);
    }
    return this.view(archived, this.repository.listCandidates(ownerId, taskId));
  }

  public abandonAll(ownerId: string): { archivedCount: number; skippedCreatedCount: number } {
    let archivedCount = 0;
    let skippedCreatedCount = 0;
    const now = this.clock.now().toISOString();
    for (const row of this.repository.listArchivableByOwner(ownerId)) {
      const resultBookId = this.repository.confirmedBookForDraft(ownerId, openingDraftId(ownerId, row.task_id));
      if (resultBookId !== null) {
        skippedCreatedCount += 1;
        continue;
      }
      const archived = this.repository.archive(ownerId, row.task_id, now);
      if (archived?.error_code === 'archived_by_author') archivedCount += 1;
    }
    return { archivedCount, skippedCreatedCount };
  }

  public async revise(
    ownerId: string,
    taskId: string,
    input: ReviseV7OpeningAgentTaskInput
  ): Promise<V7OpeningAgentTaskView> {
    const row = this.repository.byTaskId(ownerId, taskId);
    if (row === undefined) throw new DomainError(errorCodes.validation, '开书任务不存在', {}, false, 404);
    if (!isCurrentV7OpeningTask(row)) {
      throw new DomainError(
        errorCodes.validation,
        '这项历史开书任务只能查看，已有结果已经保留。请按当前流程重新提交开书想法。',
        {},
        false,
        409
      );
    }
    if (row.status !== 'awaiting_author_confirmation' && row.status !== 'awaiting_author_decision') {
      throw new DomainError(errorCodes.validation, '创作团队还没有完成本轮资料，暂时不能提交修改。', {}, false, 409);
    }
    const state = parseTaskState(row);
    const baseCandidateId = normalizeCandidateId(input.baseCandidateId);
    if (state.activePackageCandidateId !== baseCandidateId) {
      throw new DomainError(errorCodes.validation, '开书资料已经更新，请刷新后再修改最新版本。', {}, true, 409);
    }
    const base = await this.repository.readCandidate<OpeningPackage>(ownerId, taskId, baseCandidateId);
    if (base.kind !== 'opening_package') {
      throw new DomainError(errorCodes.validation, '当前版本不是可修改的开书资料。', {}, false, 409);
    }
    const activeReview = state.activeReviewCandidateId === null
      ? null
      : await this.repository.readCandidate<OpeningReview>(ownerId, taskId, state.activeReviewCandidateId);
    const adjustmentNote = normalizeAdjustmentNote(input.adjustmentNote);
    const resolutions = normalizeDecisionResolutions(input.decisionResolutions, activeReview?.content ?? null);
    const authorDraft = validateSubmittedRevisionDraft(input.openingPackage, base.content, [], []);
    const authorChangedFields = changedOpeningFields(base.content, authorDraft);
    const resolvedDraft = applyDecisionResolutions(authorDraft, resolutions);
    const changedFields = changedOpeningFields(base.content, resolvedDraft);
    const decisionFields = resolutions
      .filter((item) => item.action !== 'reject' && item.definition.field !== null)
      .map((item) => item.definition.field!);
    const legacySemanticRevision = resolutions.some((item) => (
      item.definition.field === null && (item.action === 'accept' || item.action === 'custom')
    ));
    const requiresModelRevision = adjustmentNote.length > 0
      || authorChangedFields.length > 0
      || legacySemanticRevision;
    const allowedFields = [...new Set([
      ...changedFields,
      ...decisionFields,
      ...(adjustmentNote.length === 0 && !legacySemanticRevision ? [] : REVISION_EDITABLE_FIELDS)
    ])];
    const authorMessages = [
      ...resolutions.map(decisionInstruction),
      ...(adjustmentNote.length === 0 ? [] : [adjustmentNote])
    ].slice(0, 8);
    if (allowedFields.length === 0 && authorMessages.length === 0) {
      throw new DomainError(errorCodes.validation, '请先处理主编决定，或修改一项开书资料后再提交。');
    }
    const openingPackage = validateSubmittedRevisionDraft(
      resolvedDraft,
      base.content,
      authorMessages,
      allowedFields
    );
    const actionKey = normalizeIdempotencyKey(input.idempotencyKey);
    const modelRequestId = `author-revision-${taskId}-${actionKey}`;
    const sourceCandidateIds = [...new Set([
      baseCandidateId,
      ...(state.activeReviewCandidateId === null ? [] : [state.activeReviewCandidateId])
    ])];
    const existing = this.repository.candidateByRequestId(ownerId, taskId, modelRequestId);
    if (existing !== undefined) {
      if (
        existing.kind !== 'opening_package'
        || JSON.stringify(existing.content) !== JSON.stringify(openingPackage)
        || JSON.stringify(existing.sourceCandidateIds) !== JSON.stringify(sourceCandidateIds)
      ) {
        throw new DomainError(errorCodes.validation, '这次修改编号已经用于另一份内容，请重新提交。', {}, false, 409);
      }
      if (canResume(row.status) && isCurrentV7OpeningTask(row)) this.start(ownerId, taskId);
      return this.view(row, this.repository.listCandidates(ownerId, taskId));
    }
    const candidateId = `candidate-${modelRequestId}`;
    const nextState: OpeningAgentTaskState = {
      ...state,
      status: 'working',
      phase: requiresModelRevision ? 'package_revision' : 'package_re_review',
      activePackageCandidateId: candidateId,
      activeReviewCandidateId: state.activeReviewCandidateId,
      editorialRevisionCount: 0,
      structureRepairs: {
        ...state.structureRepairs,
        package_revision: 0,
        package_re_review: 0
      },
      attemptedMemberKeys: {
        ...state.attemptedMemberKeys,
        package_revision: [],
        package_re_review: []
      },
      errorCode: null,
      errorMessage: null
    };
    await this.repository.commitCandidate(ownerId, taskId, {
      candidateId,
      kind: 'opening_package',
      content: openingPackage,
      createdByMemberKey: 'author',
      modelRequestId,
      sourceCandidateIds,
      nextState
    });
    this.start(ownerId, taskId);
    const current = this.repository.byTaskId(ownerId, taskId)!;
    return this.view(current, this.repository.listCandidates(ownerId, taskId));
  }

  private start(ownerId: string, taskId: string): void {
    void this.execute(ownerId, taskId).catch(() => {
      // execute已经把可公开的失败状态写回任务；后台Promise不再制造未处理拒绝。
    });
  }

  private async execute(ownerId: string, taskId: string): Promise<void> {
    const leaseToken = randomUUID();
    const now = this.clock.now();
    const claimed = this.repository.claim(
      ownerId,
      taskId,
      leaseToken,
      new Date(now.getTime() + LEASE_MS).toISOString(),
      now.toISOString()
    );
    if (!claimed) return;
    const leaseHeartbeat = setInterval(() => {
      const heartbeatAt = this.clock.now();
      this.repository.renewLease(
        ownerId,
        taskId,
        leaseToken,
        new Date(heartbeatAt.getTime() + LEASE_MS).toISOString(),
        heartbeatAt.toISOString()
      );
    }, LEASE_HEARTBEAT_MS);
    leaseHeartbeat.unref();
    try {
      const row = this.repository.byTaskId(ownerId, taskId);
      if (row === undefined) return;
      await this.engine.run({
        ownerId,
        taskId,
        memberRoster: parseMemberRoster(row.member_roster_json),
        ...(row.selected_chief_member_key === null ? {} : { selectedChiefMemberKey: row.selected_chief_member_key }),
        ...(row.selected_screenwriter_member_key === null
          ? {}
          : { selectedScreenwriterMemberKey: row.selected_screenwriter_member_key })
      });
    } catch (error) {
      if (!(error instanceof OpeningAgentStoppedError)) {
        this.repository.markUnexpectedFailure(
          ownerId,
          taskId,
          error instanceof Error ? error.message : String(error),
          this.clock.now().toISOString()
        );
      }
    } finally {
      clearInterval(leaseHeartbeat);
      this.repository.release(ownerId, taskId, leaseToken, this.clock.now().toISOString());
    }
  }

  private view(row: V7OpeningTaskRow, candidates: OpeningSavedCandidate[]): V7OpeningAgentTaskView {
    // Historical task pages must remain readable even if a later governance
    // revision introduced stricter priority rules. Execution still uses the
    // strict parser above, so an invalid frozen roster can never be resumed.
    const roster = parseMemberRoster(row.member_roster_json, false);
    const state = row.state_json === null ? null : JSON.parse(row.state_json) as OpeningAgentTaskState;
    const chiefKey = row.selected_chief_member_key
      ?? latestAttemptedMember(state, 'chief_editor', roster)
      ?? roster.find((member) => member.roleKey === 'chief_editor' && member.defaultForRole)?.memberKey
      ?? null;
    const screenwriterKey = row.selected_screenwriter_member_key
      ?? latestAttemptedMember(state, 'screenwriter', roster)
      ?? roster.find((member) => member.roleKey === 'screenwriter' && member.defaultForRole)?.memberKey
      ?? null;
    const retiredWorkflow = !isCurrentV7OpeningTask(row);
    const storedStatus = row.error_code === 'archived_by_author' ? 'archived' : row.status;
    const status = retiredWorkflow && canResume(storedStatus) ? 'failed' : storedStatus;
    const workflowStyle = retiredWorkflow ? 'retired_read_only' : 'direct_design_review';
    const chief = publicMember(chiefKey, roster);
    const screenwriter = publicMember(screenwriterKey, roster);
    return {
      taskId: row.task_id,
      idea: row.idea_text,
      publishingPlatform: row.publishing_platform,
      status,
      phase: row.phase,
      statusText: statusText(status),
      phaseText: retiredWorkflow ? '请按当前流程重新开始' : phaseText(row.phase, status),
      isRunning: !retiredWorkflow && (status === 'queued' || status === 'working'),
      needsAuthorDecision: status === 'awaiting_author_decision',
      workflowStyle,
      selectedMembers: {
        chiefEditor: chief,
        screenwriter,
        designer: screenwriter,
        reviewer: chief
      },
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        kind: candidate.kind,
        version: candidate.version,
        content: publicCandidateContent(candidate),
        createdBy: candidate.createdByMemberKey === 'author' ? {
          memberKey: 'author',
          displayName: '作者'
        } : publicMember(candidate.createdByMemberKey, roster) ?? {
          memberKey: candidate.createdByMemberKey,
          displayName: '创作成员'
        },
        sourceCandidateIds: candidate.sourceCandidateIds
      })),
      errorMessage: status === 'archived'
        ? null
        : retiredWorkflow
          ? '对不起，这项历史开书任务不能继续执行。已有结果已经保留，请按当前流程重新提交开书想法。'
          : row.error_message,
      recoveryAction: retiredWorkflow || status === 'archived' ? null : openingRecoveryAction(row.error_code),
      resultBookId: this.repository.confirmedBookForDraft(row.owner_id, openingDraftId(row.owner_id, row.task_id)),
      progress: retiredWorkflow
        ? { currentStep: 0, totalSteps: 2, percent: 0 }
        : progressFor(row.phase, status),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

function openingRecoveryAction(
  errorCode: string | null
): V7OpeningAgentTaskView['recoveryAction'] {
  if (errorCode === errorCodes.membershipRequired) return 'open_membership_required';
  if (errorCode === errorCodes.membershipQuotaExhausted) return 'open_membership_quota';
  if (errorCode === errorCodes.membershipExpired) return 'open_membership_expired';
  return null;
}

function validateSubmittedRevisionDraft(
  value: unknown,
  fallback: OpeningPackage,
  authorInstructions: string[],
  allowedFields: string[]
): OpeningPackage {
  try {
    return validateV7OpeningRevisionDraft(value, fallback, authorInstructions, allowedFields);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      errorCodes.validation,
      error instanceof Error ? error.message : '开书调整资料格式无效。'
    );
  }
}

function publicCandidateContent(candidate: OpeningSavedCandidate): unknown {
  if (candidate.kind !== 'opening_package' || candidate.content === null || typeof candidate.content !== 'object' || Array.isArray(candidate.content)) {
    return candidate.content;
  }
  return publicV7OpeningPackage(candidate.content as OpeningPackage);
}

type DecisionAction = 'accept' | 'reject' | 'custom';
interface NormalizedDecisionResolution {
  definition: { decisionId: string; field: string | null; question: string; recommendation: string; required: boolean };
  action: DecisionAction;
  customValue: string;
}

const REVISION_EDITABLE_FIELDS = [
  'title', 'positioning.publishingPlatform', 'positioning.channel', 'positioning.category',
  'positioning.genres', 'positioning.tags', 'positioning.coreAppeal', 'positioning.expectedTotalWords',
  // 保留旧任务的恢复能力；新开书不会产生这些决定。
  'positioning.targetReaders', 'positioning.volumePlan', 'positioning.commercialAudience', 'positioning.retentionPositioning',
  'backgrounds.eraAndWorld', 'longTermDirection.centralConflict', 'longTermDirection.progression',
  'longTermDirection.relationshipDirection', 'longTermDirection.storyPotential',
  'possibleEnding.direction', 'possibleEnding.price', 'possibleEnding.openness', 'mustFollow',
  ...[0, 1].flatMap((index) => [
    `protagonists.${index}.name`, `protagonists.${index}.age`, `protagonists.${index}.identity`,
    `protagonists.${index}.background`, `protagonists.${index}.familyBackground`,
    `protagonists.${index}.careerBackground`, `protagonists.${index}.goldenFinger`,
    `protagonists.${index}.visualIdentity.appearance`, `protagonists.${index}.visualIdentity.build`,
    `protagonists.${index}.visualIdentity.signatureFeature`, `protagonists.${index}.personality`
  ])
];

function normalizeDecisionResolutions(value: unknown, review: OpeningReview | null): NormalizedDecisionResolution[] {
  if (value === undefined || value === null) value = [];
  if (!Array.isArray(value)) throw new DomainError(errorCodes.validation, '主编决定格式无效。');
  if (value.length > 12) throw new DomainError(errorCodes.validation, '主编决定最多12项。');
  const definitions = [
    ...(review?.decisions ?? []).map((item: OpeningReviewDecision) => ({
      decisionId: item.decisionId, field: item.field as string, question: item.question,
      recommendation: item.recommendation, required: item.required
    })),
    ...(review?.decisions?.length ? [] : (
      (review?.authorDecisions?.length ?? 0) > 0 ? review!.authorDecisions : (review?.requiredChanges ?? [])
    ).map((item, index) => ({
      decisionId: `saved-${index + 1}`, field: null, question: item, recommendation: item, required: true
    })))
  ];
  const byId = new Map(definitions.map((item) => [item.decisionId, item]));
  const seen = new Set<string>();
  const result: NormalizedDecisionResolution[] = value.map((entry, index): NormalizedDecisionResolution => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new DomainError(errorCodes.validation, `第${index + 1}个主编决定格式无效。`);
    }
    const row = entry as { decisionId?: unknown; action?: unknown; customValue?: unknown };
    const decisionId = typeof row.decisionId === 'string' ? row.decisionId.trim() : '';
    const definition = byId.get(decisionId);
    if (definition === undefined || seen.has(decisionId)) throw new DomainError(errorCodes.validation, '主编决定已经更新，请刷新后重新选择。', {}, true, 409);
    seen.add(decisionId);
    if (row.action !== 'accept' && row.action !== 'reject' && row.action !== 'custom') {
      throw new DomainError(errorCodes.validation, '请选择采纳、暂不采纳或修改后采纳。');
    }
    const customValue = typeof row.customValue === 'string' ? row.customValue.trim() : '';
    if (row.action === 'custom' && customValue.length === 0) throw new DomainError(errorCodes.validation, '修改后采纳需要填写您的方案。');
    if (Array.from(customValue).length > 800) throw new DomainError(errorCodes.validation, '单项决定最多800字。');
    return { definition, action: row.action, customValue };
  });
  const unresolved = definitions.filter((item) => item.required && !seen.has(item.decisionId));
  if (unresolved.length > 0) throw new DomainError(errorCodes.validation, '请先处理全部必须决定的主编建议。');
  return result;
}

function applyDecisionResolutions(
  draft: OpeningPackage,
  resolutions: NormalizedDecisionResolution[]
): OpeningPackage {
  const next = JSON.parse(JSON.stringify(draft)) as OpeningPackage;
  for (const item of resolutions) {
    if (item.action === 'reject' || item.definition.field === null) continue;
    setOpeningField(next, item.definition.field, item.action === 'custom' ? item.customValue : item.definition.recommendation);
  }
  return next;
}

function decisionInstruction(item: NormalizedDecisionResolution): string {
  if (item.action === 'reject') return `作者决定暂不采纳“${item.definition.question}”，保持当前方案。`;
  const value = item.action === 'custom' ? item.customValue : item.definition.recommendation;
  return `作者已${item.action === 'custom' ? '修改后采纳' : '采纳'}“${item.definition.question}”：${value}`;
}

function changedOpeningFields(base: OpeningPackage, next: OpeningPackage): string[] {
  return REVISION_EDITABLE_FIELDS.filter((field) => JSON.stringify(readOpeningField(base, field)) !== JSON.stringify(readOpeningField(next, field)));
}

function readOpeningField(value: OpeningPackage, field: string): unknown {
  return field.split('.').reduce<unknown>((current, segment) => {
    if (typeof current !== 'object' || current === null) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function setOpeningField(value: OpeningPackage, field: string, nextValue: string): void {
  const segments = field.split('.');
  let current: unknown = value;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (typeof current !== 'object' || current === null) throw new DomainError(errorCodes.validation, '主编建议对应的资料项暂时不存在。');
    current = (current as Record<string, unknown>)[segments[index]!];
  }
  if (typeof current !== 'object' || current === null) throw new DomainError(errorCodes.validation, '主编建议对应的资料项暂时不存在。');
  const normalizedValue = field === 'positioning.expectedTotalWords'
    ? parseExpectedTotalWordsDecision(nextValue)
    : nextValue;
  (current as Record<string, unknown>)[segments.at(-1)!] = normalizedValue;
}

function parseExpectedTotalWordsDecision(value: string): number {
  const compact = value.trim().replaceAll(',', '').replaceAll('，', '');
  const tenThousands = compact.match(/^(\d+(?:\.\d+)?)\s*万(?:字)?$/u);
  const parsed = tenThousands === null ? Number(compact) : Number(tenThousands[1]) * 10_000;
  if (!Number.isInteger(parsed) || parsed < 100_000 || parsed > 10_000_000) {
    throw new DomainError(errorCodes.validation, '主编建议的预计总字数无效，请修改后采纳。');
  }
  return parsed;
}

function normalizeListLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return 50;
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new DomainError(errorCodes.validation, '任务记录数量应为1至100。');
  }
  return parsed;
}

function openingDraftId(ownerId: string, taskId: string): string {
  const stableHash = createHash('sha256').update(`${ownerId}\nagent-${taskId}`).digest('hex').slice(0, 32);
  return `v7-opening-draft-${stableHash}`;
}

function progressFor(phase: string, status: string): V7OpeningAgentTaskView['progress'] {
  if (status === 'awaiting_author_confirmation' || status === 'awaiting_author_decision') {
    return { currentStep: 2, totalSteps: 2, percent: 100 };
  }
  const phaseStep: Record<string, { currentStep: number; percent: number }> = {
    package_design: { currentStep: 1, percent: 35 },
    package_revision: { currentStep: 1, percent: 45 },
    package_review: { currentStep: 2, percent: 75 },
    package_re_review: { currentStep: 2, percent: 85 },
    complete: { currentStep: 2, percent: 100 }
  };
  const current = phaseStep[phase] ?? { currentStep: 1, percent: 10 };
  return { ...current, totalSteps: 2 };
}

function normalizeIdea(value: unknown): string {
  const idea = typeof value === 'string' ? value.trim() : '';
  if (Array.from(idea).length < 4) throw new DomainError(errorCodes.validation, '请至少用4个字说清开书思路。');
  if (Array.from(idea).length > 2_000) throw new DomainError(errorCodes.validation, '开书思路最多2000字。');
  return idea;
}

function normalizeIdempotencyKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9_-]{8,128}$/u.test(key)) {
    throw new DomainError(errorCodes.validation, '开书任务编号无效，请重新发起。');
  }
  return key;
}

function normalizeCandidateId(value: unknown): string {
  const candidateId = typeof value === 'string' ? value.trim() : '';
  if (candidateId.length < 8 || candidateId.length > 300) {
    throw new DomainError(errorCodes.validation, '开书资料版本无效，请刷新后重试。');
  }
  return candidateId;
}

function normalizeAdjustmentNote(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new DomainError(errorCodes.validation, '调整意见格式无效。');
  const note = value.trim();
  if (Array.from(note).length > 2_000) throw new DomainError(errorCodes.validation, '调整意见最多2000字。');
  return note;
}

function parseTaskState(row: V7OpeningTaskRow): OpeningAgentTaskState {
  if (row.state_json === null) throw new DomainError(errorCodes.validation, '开书任务尚未建立检查点。', {}, true, 409);
  return JSON.parse(row.state_json) as OpeningAgentTaskState;
}

function latestAttemptedMember(
  state: OpeningAgentTaskState | null,
  roleKey: V7OpeningRoleKey,
  roster: readonly V7OpeningMemberDefinition[]
): string | null {
  if (state === null) return null;
  const attempts = [...state.attempts].reverse();
  const attempt = attempts.find((item) => {
    const member = roster.find((candidate) => candidate.memberKey === item.memberKey);
    return member?.roleKey === roleKey;
  });
  return attempt?.memberKey ?? null;
}

function normalizeMember(
  value: unknown,
  roleKey: V7OpeningRoleKey,
  roster: readonly V7OpeningMemberDefinition[]
): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new DomainError(errorCodes.validation, '创作成员选择无效。');
  const member = roster.find((candidate) => candidate.memberKey === value && candidate.roleKey === roleKey);
  if (member === undefined || !member.enabledByDefault) {
    throw new DomainError(errorCodes.validation, '选择的创作成员未上岗或岗位不匹配。');
  }
  return member.memberKey;
}

/**
 * 当前任务只能执行创建时冻结的完整成员快照。旧任务的轻量名册仍可
 * 在只读页面显示，但绝不能借当前成员表或旧模型表重新绑定后恢复调用。
 */
export function parseMemberRoster(value: string | null, strict = true): V7OpeningMemberDefinition[] {
  if (value === null) {
    if (strict) throw new Error('历史开书任务缺少完整成员快照，不能按当前流程继续执行');
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error('V7任务成员快照格式无效');
  const hasFullSnapshot = parsed.every((candidate) => candidate !== null && typeof candidate === 'object'
    && !Array.isArray(candidate) && typeof (candidate as { roleKey?: unknown }).roleKey === 'string'
    && typeof (candidate as { displayName?: unknown }).displayName === 'string'
    && typeof (candidate as { model?: unknown }).model === 'object');
  if (hasFullSnapshot) {
    const roster = parsed.map(parseFullSnapshotMember);
    const errors = strict ? validateEffectiveOpeningAgentRoster(roster) : [];
    if (errors.length > 0) throw new Error(`V7任务成员快照无效：${errors.join('；')}`);
    return roster;
  }
  if (strict) throw new Error('历史开书任务使用旧成员快照，不能按当前流程继续执行');
  const parsedMemberKeys = parsed.map((candidate) => (
    candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
      && typeof (candidate as { memberKey?: unknown }).memberKey === 'string'
      ? (candidate as { memberKey: string }).memberKey
      : null
  ));
  if (parsedMemberKeys.some((memberKey) => memberKey === null)) {
    throw new Error('V7任务成员快照缺少成员编号');
  }
  const roster: V7OpeningMemberDefinition[] = parsed.map((item, index): V7OpeningMemberDefinition => {
    const memberKey = parsedMemberKeys[index]!;
    const definition = readOnlyHistoricalOpeningMember(memberKey);
    const governance = item as {
      enabled?: unknown;
      defaultForRole?: unknown;
      fallbackPriority?: unknown;
      promptInstruction?: unknown;
    };
    if (
      typeof governance.enabled !== 'boolean'
      || typeof governance.defaultForRole !== 'boolean'
      || typeof governance.fallbackPriority !== 'number'
      || !Number.isInteger(governance.fallbackPriority)
      || (governance.promptInstruction !== undefined && typeof governance.promptInstruction !== 'string')
    ) {
      throw new Error(`V7任务成员快照字段无效：${memberKey}`);
    }
    return definition === null ? {
      ...readOnlyHistoricalOpeningMember('unknown-opening-member')!,
      memberKey,
      displayName: '历史创作成员',
      roleKey: memberKey.startsWith('chief-') ? 'chief_editor' as const : 'screenwriter' as const,
      fallbackPriority: governance.fallbackPriority
    } : {
      ...definition,
      model: { ...definition.model },
      enabledByDefault: false,
      defaultForRole: governance.defaultForRole,
      fallbackPriority: governance.fallbackPriority,
      promptInstruction: ''
    };
  });
  return roster;
}

function readOnlyHistoricalOpeningMember(memberKey: string): V7OpeningMemberDefinition | null {
  const identity = ({
    'screenwriter-deepseek-v4-pro': ['红玉', 'screenwriter'],
    'screenwriter-doubao-seed-2-1-turbo': ['幼薇', 'screenwriter'],
    'screenwriter-kimi-k3': ['清照', 'screenwriter'],
    'unknown-opening-member': ['历史创作成员', 'screenwriter']
  } as const)[memberKey];
  const current = V7_OPENING_MEMBERS.find((member) => member.memberKey === memberKey);
  if (identity === undefined && current !== undefined) return { ...cloneMember(current), enabledByDefault: false };
  if (identity === undefined) return null;
  const safeModel = V7_OPENING_MEMBERS.find((member) => member.roleKey === identity[1])?.model
    ?? V7_OPENING_MEMBERS[0]!.model;
  return {
    memberKey,
    displayName: identity[0],
    roleKey: identity[1],
    enabledByDefault: false,
    defaultForRole: false,
    fallbackPriority: 99,
    model: { ...safeModel },
    promptInstruction: ''
  };
}

function parseFullSnapshotMember(value: unknown): V7OpeningMemberDefinition {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('V7任务成员快照字段无效');
  const item = value as Record<string, unknown>;
  const model = item.model as Record<string, unknown> | undefined;
  if (typeof item.memberKey !== 'string' || typeof item.displayName !== 'string'
    || (item.roleKey !== 'chief_editor' && item.roleKey !== 'screenwriter')
    || model === undefined || typeof model.provider !== 'string' || typeof model.modelId !== 'string'
    || (model.plan !== 'coding' && model.plan !== 'agent')
    || typeof item.enabled !== 'boolean' || typeof item.defaultForRole !== 'boolean'
    || typeof item.fallbackPriority !== 'number' || !Number.isInteger(item.fallbackPriority)
    || (item.promptInstruction !== undefined && typeof item.promptInstruction !== 'string')) {
    throw new Error('V7任务成员快照字段无效');
  }
  return {
    memberKey: item.memberKey,
    displayName: item.displayName,
    roleKey: item.roleKey,
    model: { provider: model.provider as V7OpeningMemberDefinition['model']['provider'], modelId: model.modelId, plan: model.plan },
    enabledByDefault: item.enabled,
    defaultForRole: item.defaultForRole,
    fallbackPriority: item.fallbackPriority,
    promptInstruction: typeof item.promptInstruction === 'string' ? item.promptInstruction.slice(0, 4_000) : ''
  };
}

function cloneMember(member: V7OpeningMemberDefinition): V7OpeningMemberDefinition {
  return { ...member, model: { ...member.model }, promptInstruction: member.promptInstruction };
}

function publicMember(memberKey: string | null, roster: readonly V7OpeningMemberDefinition[]): { memberKey: string; displayName: string } | null {
  if (memberKey === null) return null;
  const member = roster.find((candidate) => candidate.memberKey === memberKey);
  return member === undefined ? null : { memberKey: member.memberKey, displayName: member.displayName };
}

function canResume(status: string): boolean {
  return status === 'queued' || status === 'working' || status === 'interrupted';
}

export function isCurrentV7OpeningTask(row: V7OpeningTaskRow): boolean {
  if (row.phase === 'work_order' || row.member_roster_json === null) return false;
  try {
    const roster = parseMemberRoster(row.member_roster_json);
    if (!roster.every((member) => {
      const registered = V7_GLOBAL_MEMBERS.find((candidate) => candidate.memberKey === member.memberKey);
      if (registered === undefined) return false;
      const expectedRole = registered.fixedRoleKey === 'chief_editor'
        ? 'chief_editor'
        : registered.fixedRoleKey === 'planning_writer'
          ? 'screenwriter'
          : null;
      if (expectedRole === null || member.roleKey !== expectedRole) return false;
      const profileKey = modelProfileKeyForBinding(member.model);
      return allowedModelProfilesForRole(registered.fixedRoleKey).includes(profileKey);
    })) return false;
    if (row.state_json === null) return true;
    const state = JSON.parse(row.state_json) as OpeningAgentTaskState;
    return state.phase !== 'work_order' && state.workOrderCandidateId === null;
  } catch {
    return false;
  }
}

function statusText(status: string): string {
  const labels: Record<string, string> = {
    queued: '创作团队正在准备',
    working: '亲爱的，创作团队正在加急设计中',
    awaiting_author_confirmation: '开书资料包已经完成，请您确认或修改',
    awaiting_author_decision: '主编发现需要您决定的问题',
    failed: '本轮没有完成，已有结果已经保留',
    interrupted: '连接暂时中断，系统正在安全核对结果',
    archived: '这项任务已经放弃，历史候选仍被安全保留'
  };
  return labels[status] ?? '正在处理';
}

function phaseText(phase: string, status: string): string {
  if (status === 'archived') return '这项任务已放弃';
  if (status === 'awaiting_author_confirmation') return '主编审查通过';
  if (status === 'awaiting_author_decision') return '等待作者决定';
  const labels: Record<string, string> = {
    package_design: '编剧正在设计开书资料包',
    package_review: '主编正在审查资料包',
    package_revision: '编剧正在按审查意见调整',
    package_re_review: '主编正在复审调整结果',
    complete: '本轮设计已经完成'
  };
  return labels[phase] ?? '创作团队正在处理';
}
