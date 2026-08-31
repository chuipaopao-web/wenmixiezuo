import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  chapterReviewRepairPrompt,
  chapterSequencePrompt,
  creationFallbackChain,
  manuscriptPrompt,
  outlineReviewPrompt,
  optionReviewPrompt,
  optionReviewRepairPrompt,
  parseChainOption,
  parseChapterReview,
  parseChapterSequence,
  parseOptionReview,
  parseVolumeOption,
  planningOptionRepairPrompt,
  planningOptionPrompt,
  reviewPrompt,
  type PlanningTreeDocument,
  type V7ChainOption,
  type V7ChapterOutline,
  type V7ChapterReview,
  type V7ChapterSequence,
  type V7ContextSourceTrace,
  type V7CreationContextPack,
  type V7CreationMemberDefinition,
  type V7PlanningOptionReview,
  type V7VolumeOption,
  type V7WorkstationKey
} from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import {
  V7CreationRuntimeRepository,
  type V7CreationActorCallRow,
  type V7ChapterOutlineSequenceRow,
  type V7ChapterOutlineDraftCandidateRow,
  type V7CreationModelCallRow,
  type V7CreationOptionRow,
  type V7CreationWorkflowRow,
  type V7ManuscriptVersionRow
} from '../../infrastructure/db/repositories/v7-creation-runtime-repository.js';
import { V7PlanningRuntimeRepository } from '../../infrastructure/db/repositories/v7-planning-runtime-repository.js';
import { V7PlanningTreeRepository } from '../../infrastructure/db/repositories/v7-planning-tree-repository.js';
import {
  V7CreationModelError,
  V7CreationModelGateway,
  type V7CreationModelAdapterResolver
} from '../../infrastructure/models/v7-creation-model-gateway.js';
import { V7PlanningTreeService } from '../planning/v7-planning-tree-service.js';
import { V7CreationContextCompiler } from './v7-creation-context-compiler.js';

type OptionKind = 'volume' | 'chain';
type OptionSeatKey = 'option_1' | 'option_2' | 'option_3';
type CreationSelectionKey = V7CreationMemberDefinition['roleKey'] | OptionSeatKey;

interface OptionRevisionFeedback {
  memberKey: string;
  memberName: string;
  publicSummary: string;
  risks: string[];
  authorDecisions: string[];
}

export interface V7CreationWorkflowView {
  workflowId: string;
  bookId: string;
  stage: V7CreationWorkflowRow['stage'];
  status: 'waiting' | 'working' | 'waiting_for_you' | 'completed' | 'failed' | 'partially_failed' | 'cancelled';
  message: string;
  firstVolume: boolean;
  volumeScopeId: string;
  chainScopeId: string | null;
  completedOptions: number;
  expectedOptions: number;
  options: Array<{
    optionId: string;
    seat: '方案一' | '方案二' | '方案三';
    memberKey: string;
    memberName: string;
    name: string;
    summary: string;
    designRationale: string;
    readerExperience: string;
    coreConflict: string;
    protagonistChoice: string;
    priceAndChange: string;
    payoff: string;
    strengths: string[];
    risks: string[];
    steps: Array<{
      sequence: number;
      title: string;
      summary: string;
      majorEvents: string[];
      protagonistChange: string;
      emotion: string;
      experience: string;
      outcome: string;
      nextStep: string;
      wordTarget: number | null;
      chapterRange: readonly [number, number] | null;
    }>;
  }>;
  chiefReview: null | {
    memberKey: string;
    memberName: string;
    summary: string;
    recommendedOptionId: string;
    differences: V7PlanningOptionReview['differences'];
    risks: string[];
    authorDecisions: string[];
  };
  optionRevision: OptionRevisionFeedback | null;
  expectedOutlines: number;
  outlines: Array<{
    candidateId: string; seat: '方案一' | '方案二' | '方案三'; status: string; memberKey: string;
    reviewerMemberKey: string | null; review: V7ChapterReview | null; content: V7ChapterSequence;
  }>;
  outline: null | {
    sequenceId: string; revision: number; status: string; memberKey: string;
    reviewerMemberKey: string | null; review: V7ChapterReview | null; content: V7ChapterSequence;
  };
  manuscript: null | {
    manuscriptVersionId: string;
    chapterNumber: number;
    revision: number;
    status: V7ManuscriptVersionRow['lifecycle'];
    memberKey: string;
    reviewerMemberKey: string | null;
    content: string;
    review: V7ChapterReview | null;
  };
  progress: {
    completedChapters: number;
    totalChapters: number;
    percent: number;
    nextChapterNumber: number | null;
  };
  remainingChains: Array<{ scopeId: string; title: string; summary: string }>;
  volumeComplete: boolean;
  actors: Array<{
    memberKey: string;
    memberName: string;
    role: string;
    status: 'working' | 'completed' | 'handed_over' | 'waiting' | 'failed';
    message: string;
    emoji: string;
  }>;
  execution: {
    mode: 'manual' | 'managed';
    status: 'inactive' | 'active' | 'paused' | 'completed' | 'failed' | 'unknown' | 'cancelled';
    writerMemberKey: string | null;
    reviewerMemberKey: string | null;
    errorMessage: string | null;
  };
  timing: {
    createdAt: string;
    lastActivityAt: string;
    elapsedSeconds: number;
    idleSeconds: number;
    state: 'normal' | 'slow' | 'overdue';
  };
  errorMessage: string | null;
}

type V7PublicCreationStatus = V7CreationWorkflowView['status'];

export interface V7CreationLibraryView {
  volumes: Array<{
    volumeScopeId: string;
    status: V7PublicCreationStatus;
    latestWorkflowId: string;
    chains: Array<{
      chainScopeId: string;
      workflowId: string;
      status: V7PublicCreationStatus;
      outline: null | {
        sequenceId: string;
        revision: number;
        status: V7ChapterOutlineSequenceRow['lifecycle'];
        memberKey: string;
        reviewerMemberKey: string | null;
        review: V7ChapterReview | null;
        content: V7ChapterSequence;
        chapters: Array<{
          chapter: V7ChapterOutline;
          manuscript: null | {
            manuscriptVersionId: string;
            revision: number;
            status: V7ManuscriptVersionRow['lifecycle'];
            memberKey: string;
            reviewerMemberKey: string | null;
            review: V7ChapterReview | null;
          };
        }>;
      };
    }>;
  }>;
}

export interface V7CreationManuscriptView {
  manuscriptVersionId: string;
  workflowId: string;
  sequenceId: string;
  chapterNumber: number;
  revision: number;
  status: V7ManuscriptVersionRow['lifecycle'];
  memberKey: string;
  reviewerMemberKey: string | null;
  content: string;
  review: V7ChapterReview | null;
  createdAt: string;
  finalizedAt: string | null;
}

export class V7CreationWorkflowService {
  private readonly repository: V7CreationRuntimeRepository;
  private readonly planning: V7PlanningRuntimeRepository;
  private readonly treeRepository: V7PlanningTreeRepository;
  private readonly trees: V7PlanningTreeService;
  private readonly contexts: V7CreationContextCompiler;
  private readonly models: V7CreationModelGateway;
  private readonly activeRuns = new Set<string>();

  public constructor(
    private readonly database: DatabaseSync,
    adapters: V7CreationModelAdapterResolver,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly memberRoster: () => readonly V7CreationMemberDefinition[]
  ) {
    this.repository = new V7CreationRuntimeRepository(database);
    this.planning = new V7PlanningRuntimeRepository(database);
    this.treeRepository = new V7PlanningTreeRepository(database);
    this.trees = new V7PlanningTreeService(database, ids, clock);
    this.contexts = new V7CreationContextCompiler(database, adapters, ids, clock, memberRoster);
    this.models = new V7CreationModelGateway(database, adapters, clock);
  }

  public create(ownerId: string, bookId: string, input: {
    volumeScopeId?: unknown;
    authorGoal?: unknown;
    candidateCount?: unknown;
    idempotencyKey?: unknown;
    memberPreferences?: unknown;
  }): V7CreationWorkflowView {
    const volumeScopeId = key(input.volumeScopeId, '本卷编号');
    const authorGoal = optionalText(input.authorGoal, '本卷想法', 2_000);
    const candidateCount = planningCandidateCount(input.candidateCount);
    const idempotencyKey = actionKey(input.idempotencyKey);
    this.assertDistinctPlanningPreferences(input.memberPreferences);
    const bookTree = this.requireConfirmedTree(ownerId, bookId, 'book', bookId);
    assertLinkedTree(bookTree, 'volume', volumeScopeId, '这一本卷不在已确认全书树中。');
    const firstVolume = this.planning.confirmedTrees(ownerId, bookId, 'volume').length === 0;
    const requestHash = sha256(stableJson({
      volumeScopeId,
      authorGoal,
      candidateCount,
      firstVolume,
      bookTreeVersion: bookTree.tree_version_id
    }));
    const existing = this.repository.workflowByIdempotency(ownerId, bookId, idempotencyKey);
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash) throw conflict('本次操作编号已经用于另一项创作。');
      this.saveMemberPreferences(ownerId, bookId, existing.workflow_id, input.memberPreferences);
      this.start(existing);
      return this.view(existing);
    }
    const run = this.repository.createWorkflow({
      workflowId: this.ids.next(), ownerId, bookId, volumeScopeId, firstVolume,
      authorGoal, requestedCandidateCount: candidateCount, idempotencyKey, requestHash, now: this.now()
    });
    this.saveMemberPreferences(ownerId, bookId, run.workflow_id, input.memberPreferences);
    this.start(run);
    return this.view(run);
  }

  public latest(ownerId: string, bookId: string): V7CreationWorkflowView | null {
    const run = this.repository.latestWorkflow(ownerId, bookId);
    return run === undefined ? null : this.view(run);
  }

  /**
   * 给作者端提供轻量目录。这里只投影既有正式章纲和正文版本，不启动 Agent，
   * 也不把整本正文塞进目录响应；正文由 manuscript() 按需读取。
   */
  public library(ownerId: string, bookId: string): V7CreationLibraryView {
    const workflows = this.repository.workflowsForBook(ownerId, bookId);
    const completedVolumes = new Set(this.repository.stageSettlements(ownerId, bookId, 'volume').map((row) => row.scope_id));
    const completedChains = new Set(this.repository.stageSettlements(ownerId, bookId, 'chain').map((row) => row.scope_id));
    // 章节号由创作服务按全书连续分配。目录按章节号关联，可以兼容历史数据中
    // “章纲候选正式化后换了 sequence_id、正文仍保留原版本血缘”的情况。
    const chosenManuscripts = preferredManuscripts(this.repository.manuscriptsForBook(ownerId, bookId));
    const volumeRuns = new Map<string, V7CreationWorkflowRow[]>();
    for (const run of workflows) {
      const current = volumeRuns.get(run.volume_scope_id) ?? [];
      current.push(run);
      volumeRuns.set(run.volume_scope_id, current);
    }
    return {
      volumes: [...volumeRuns.entries()].map(([volumeScopeId, runs]) => {
        const latestVolumeRun = latestRun(runs);
        const chainRuns = new Map<string, V7CreationWorkflowRow[]>();
        for (const run of runs) {
          if (run.chain_scope_id === null) continue;
          const current = chainRuns.get(run.chain_scope_id) ?? [];
          current.push(run);
          chainRuns.set(run.chain_scope_id, current);
        }
        return {
          volumeScopeId,
          status: completedVolumes.has(volumeScopeId) ? 'completed' : publicStatus(latestVolumeRun.status),
          latestWorkflowId: latestVolumeRun.workflow_id,
          chains: [...chainRuns.entries()].map(([chainScopeId, scopedRuns]) => {
            const latestChainRun = latestRun(scopedRuns);
            const outline = this.repository.confirmedOutline(ownerId, bookId, chainScopeId);
            if (outline === undefined) {
              return {
                chainScopeId, workflowId: latestChainRun.workflow_id,
                status: completedChains.has(chainScopeId) ? 'completed' : publicStatus(latestChainRun.status),
                outline: null
              };
            }
            const content = JSON.parse(outline.content_json) as V7ChapterSequence;
            return {
              chainScopeId, workflowId: latestChainRun.workflow_id,
              status: completedChains.has(chainScopeId) ? 'completed' : publicStatus(latestChainRun.status),
              outline: {
                sequenceId: outline.sequence_id,
                revision: outline.revision,
                status: outline.lifecycle,
                memberKey: outline.member_key,
                reviewerMemberKey: outline.review_member_key,
                review: outline.review_json === null ? null : JSON.parse(outline.review_json) as V7ChapterReview,
                content,
                chapters: content.chapters.map((chapter) => {
                  const manuscript = chosenManuscripts.get(chapter.chapterNumber);
                  const review = manuscript === undefined ? undefined : this.repository.manuscriptReview(
                    ownerId, bookId, manuscript.manuscript_version_id
                  );
                  return {
                    chapter,
                    manuscript: manuscript === undefined ? null : {
                      manuscriptVersionId: manuscript.manuscript_version_id,
                      revision: manuscript.revision,
                      status: manuscript.lifecycle,
                      memberKey: manuscript.member_key,
                      reviewerMemberKey: review?.member_key ?? null,
                      review: review === undefined ? null : JSON.parse(review.review_json) as V7ChapterReview
                    }
                  };
                })
              }
            };
          })
        };
      })
    };
  }

  public manuscript(ownerId: string, bookId: string, manuscriptVersionId: string): V7CreationManuscriptView {
    const manuscript = this.repository.manuscript(ownerId, bookId, manuscriptVersionId);
    if (manuscript === undefined) throw missing('正文不存在或不属于本书。');
    const review = this.repository.manuscriptReview(ownerId, bookId, manuscriptVersionId);
    return {
      manuscriptVersionId: manuscript.manuscript_version_id,
      workflowId: manuscript.workflow_id,
      sequenceId: manuscript.sequence_id,
      chapterNumber: manuscript.chapter_number,
      revision: manuscript.revision,
      status: manuscript.lifecycle,
      memberKey: manuscript.member_key,
      reviewerMemberKey: review?.member_key ?? null,
      content: manuscript.content_text,
      review: review === undefined ? null : JSON.parse(review.review_json) as V7ChapterReview,
      createdAt: manuscript.created_at,
      finalizedAt: manuscript.finalized_at
    };
  }

  public tasks(ownerId: string, limit = 50): V7CreationWorkflowView[] {
    return this.repository.workflowsByOwner(ownerId, Math.max(1, Math.min(limit, 100))).map((run) => this.view(run));
  }

  public adminTasks(limit = 100): unknown[] {
    return this.repository.adminWorkflowSummaries(Math.max(1, Math.min(limit, 200))).map((row) => ({
      workflowId: row.workflow_id,
      ownerId: row.owner_id,
      bookId: row.book_id,
      bookTitle: row.book_title,
      volumeScopeId: row.volume_scope_id,
      chainScopeId: row.chain_scope_id,
      stage: row.stage,
      status: row.status,
      modelCalls: row.model_calls,
      failedCalls: row.failed_calls,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cashMicros: row.cash_micros,
      pendingUpdates: row.pending_updates,
      failedUpdates: row.failed_updates,
      memberKeys: row.member_keys === null || row.member_keys.length === 0 ? [] : row.member_keys.split(','),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  public members(): Array<{ memberKey: string; name: string; roleKey: V7CreationMemberDefinition['roleKey']; role: string; defaultForRole: boolean }> {
    return this.memberRoster().filter((member) => member.enabledByDefault).map((member) => ({
      memberKey: member.memberKey,
      name: member.displayName,
      roleKey: member.roleKey,
      role: roleName(member.roleKey),
      defaultForRole: member.defaultForRole
    }));
  }

  public cancel(ownerId: string, bookId: string, workflowId: string, input: {
    reason?: unknown; idempotencyKey?: unknown;
  }): V7CreationWorkflowView {
    const reason = optionalText(input.reason, '停止原因', 300) ?? '任务已按您的要求停止，已完成的内容仍会保留。';
    const idempotencyKey = actionKey(input.idempotencyKey);
    const requestHash = sha256(stableJson({ workflowId, reason, action: 'cancel' }));
    const row = this.repository.cancelWorkflow({
      controlId: this.ids.next(), ownerId, bookId, workflowId, publicReason: reason,
      idempotencyKey, requestHash, now: this.now()
    });
    if (row === undefined) throw missing('创作任务不存在或不属于本书。');
    this.activeRuns.delete(workflowId);
    this.contexts.cancelWorkflow(workflowId);
    this.models.cancelWorkflow(workflowId);
    this.repository.cancelManagedRun(ownerId, bookId, workflowId, this.now());
    return this.view(row);
  }

  public chooseMember(ownerId: string, bookId: string, workflowId: string, input: {
    selectionKey?: unknown; roleKey?: unknown; memberKey?: unknown;
  }): V7CreationWorkflowView {
    const run = this.requireWorkflow(ownerId, bookId, workflowId);
    if (run.status === 'cancelled' || run.status === 'completed') throw conflict('这项任务已经结束。');
    const selectionKey = creationSelectionKey(input.selectionKey ?? input.roleKey);
    const memberKey = key(input.memberKey, '成员编号');
    const roleKey = isOptionSeatKey(selectionKey) ? 'planning_writer' : selectionKey;
    const member = this.memberRoster().find((item) => item.memberKey === memberKey && item.roleKey === roleKey && item.enabledByDefault);
    if (member === undefined) throw conflict('这位成员不负责当前岗位或正在请假。');
    if (isOptionSeatKey(selectionKey)) {
      const selectedMemberKeys = this.repository.optionMemberPreferences(ownerId, bookId, workflowId)
        .filter((item) => item.option_seat_key !== selectionKey)
        .map((item) => item.member_key);
      if (selectedMemberKeys.includes(member.memberKey)) throw conflict('多套方案需要由不同成员完成，请换一位成员。');
      this.repository.saveOptionMemberPreference({ ownerId, bookId, workflowId, optionSeatKey: selectionKey, memberKey, now: this.now() });
    } else {
      this.repository.saveMemberPreference({ ownerId, bookId, workflowId, roleKey, memberKey, now: this.now() });
    }
    return this.view(run);
  }

  public retryOptions(ownerId: string, bookId: string, workflowId: string): V7CreationWorkflowView {
    const run = this.requireWorkflow(ownerId, bookId, workflowId);
    if (!['volume_options', 'chain_options', 'volume_decision', 'chain_decision'].includes(run.stage)) throw conflict('当前没有需要恢复的方案。');
    const kind: OptionKind = run.stage.startsWith('chain_') ? 'chain' : 'volume';
    const options = this.repository.options(ownerId, bookId, workflowId, kind);
    const completedOptions = options.length;
    const expectedOptions = requestedCandidateCount(run);
    const review = this.repository.optionReview(ownerId, bookId, workflowId, kind);
    const reviewIsValid = review !== undefined && validStoredOptionReview(review.review_json, options.map((option) => option.option_id));
    const comparisonReady = expectedOptions === 1 || reviewIsValid;
    if (!['failed', 'partially_failed'].includes(run.status) && completedOptions >= expectedOptions && comparisonReady) {
      throw conflict('当前方案已经可以选择，不需要重新安排成员。');
    }
    const retryStage = kind === 'volume' ? 'volume_options' : 'chain_options';
    const checkpoint = json(run.checkpoint_json) as Record<string, unknown>;
    this.repository.updateWorkflow({
      ownerId, bookId, workflowId, stage: retryStage, status: 'queued',
      checkpoint: {
        ...checkpoint,
        retryRequestedAt: this.now(),
        retryTarget: completedOptions >= expectedOptions ? 'chief_review' : 'missing_options'
      },
      errorMessage: null,
      now: this.now()
    });
    const updated = this.requireWorkflow(ownerId, bookId, workflowId);
    this.start(updated);
    return this.view(updated);
  }

  public redesignOptions(ownerId: string, bookId: string, workflowId: string, input: {
    idempotencyKey?: unknown;
  }): V7CreationWorkflowView {
    const run = this.requireWorkflow(ownerId, bookId, workflowId);
    const checkpoint = json(run.checkpoint_json) as { optionRevision?: unknown };
    const optionRevision = optionRevisionFeedback(checkpoint.optionRevision);
    if (optionRevision === null || run.status !== 'failed') throw conflict('当前没有需要按主编意见重做的方案。');
    const idempotencyKey = actionKey(input.idempotencyKey);
    const kind: OptionKind = run.chain_scope_id === null ? 'volume' : 'chain';
    const requestHash = sha256(stableJson({ action: 'redesign_options', parentWorkflowId: workflowId, kind, optionRevision }));
    const replay = this.repository.workflowByIdempotency(ownerId, bookId, idempotencyKey);
    if (replay !== undefined) {
      if (replay.request_hash !== requestHash) throw conflict('本次操作编号已经用于另一项创作。');
      this.start(replay);
      return this.view(replay);
    }
    const now = this.now();
    const next = kind === 'volume'
      ? this.repository.createWorkflow({
          workflowId: this.ids.next(), ownerId, bookId, volumeScopeId: run.volume_scope_id,
          firstVolume: run.first_volume === 1, authorGoal: run.author_goal,
          requestedCandidateCount: requestedCandidateCount(run),
          idempotencyKey, requestHash, now
        })
      : this.repository.createChainWorkflow({
          workflowId: this.ids.next(), ownerId, bookId, volumeScopeId: run.volume_scope_id,
          chainScopeId: run.chain_scope_id!, firstVolume: run.first_volume === 1,
          authorGoal: run.author_goal, parentWorkflowId: workflowId,
          requestedCandidateCount: requestedCandidateCount(run),
          idempotencyKey, requestHash, now
        });
    this.repository.updateWorkflow({
      ownerId, bookId, workflowId: next.workflow_id, stage: next.stage, status: 'queued',
      checkpoint: { parentWorkflowId: workflowId, optionRevision }, errorMessage: null, now
    });
    const prepared = this.requireWorkflow(ownerId, bookId, next.workflow_id);
    this.start(prepared);
    return this.view(prepared);
  }

  public get(ownerId: string, bookId: string, workflowId: string): V7CreationWorkflowView {
    const run = this.requireWorkflow(ownerId, bookId, workflowId);
    this.start(run);
    return this.view(this.requireWorkflow(ownerId, bookId, workflowId));
  }

  public chooseOption(ownerId: string, bookId: string, workflowId: string, input: {
    kind?: unknown;
    optionId?: unknown;
    authorNote?: unknown;
    idempotencyKey?: unknown;
  }): { treeKind: OptionKind; scopeId: string; treeVersionId: string; nextStep: 'confirm_tree' } {
    const run = this.requireWorkflow(ownerId, bookId, workflowId);
    const kind = optionKind(input.kind);
    const expectedStage = kind === 'volume' ? 'volume_decision' : 'chain_decision';
    if (run.stage !== expectedStage || run.status !== 'awaiting_author') throw conflict('方案还没有准备好，或已经进入下一步。');
    const optionId = key(input.optionId, '方案编号');
    const option = this.repository.option(ownerId, bookId, optionId);
    if (option === undefined || option.workflow_id !== workflowId || option.option_kind !== kind) throw missing('没有找到这份方案。');
    const authorNote = optionalText(input.authorNote, '补充意见', 2_000);
    const idempotencyKey = actionKey(input.idempotencyKey);
    const requestHash = sha256(stableJson({ kind, optionId, authorNote }));
    const replay = this.repository.decisionByIdempotency(ownerId, bookId, idempotencyKey);
    if (replay !== undefined) {
      if (replay.request_hash !== requestHash || replay.workflow_id !== workflowId) throw conflict('本次操作编号已经用于另一项确认。');
      const head = this.treeRepository.head(ownerId, bookId, kind, option.scope_id);
      if (head?.candidate_version_id === null || head?.candidate_version_id === undefined) throw conflict('已选择方案对应的规划树不存在。');
      return { treeKind: kind, scopeId: option.scope_id, treeVersionId: head.candidate_version_id, nextStep: 'confirm_tree' };
    }
    const existingDecision = this.repository.decision(
      ownerId,
      bookId,
      workflowId,
      kind === 'volume' ? 'volume_option' : 'chain_option'
    );
    if (existingDecision !== undefined) {
      if (existingDecision.target_id !== optionId) throw conflict('这个阶段已经选择过其他方案，不能重复改写已确认方向。');
      const head = this.treeRepository.head(ownerId, bookId, kind, option.scope_id);
      if (head?.candidate_version_id === null || head?.candidate_version_id === undefined) throw conflict('已选择方案对应的规划树不存在。');
      return { treeKind: kind, scopeId: option.scope_id, treeVersionId: head.candidate_version_id, nextStep: 'confirm_tree' };
    }
    const document = JSON.parse(option.option_json) as V7VolumeOption | V7ChainOption;
    const context = this.repository.contextPack(ownerId, bookId, option.context_pack_id);
    if (context?.content_json === null || context?.content_json === undefined) throw conflict('这份方案的资料包已经失效。');
    const pack = JSON.parse(context.content_json) as V7CreationContextPack;
    const head = this.treeRepository.head(ownerId, bookId, kind, option.scope_id);
    const saved = this.trees.saveGeneratedCandidate({
      ownerId, bookId, treeKind: kind, scopeId: option.scope_id,
      expectedRevision: head?.revision ?? 0,
      document: document.tree,
      sourceRefs: pack.sourceRefs,
      idempotencyKey: `creation-tree:${workflowId}:${kind}:${optionId}`,
      createdBy: option.member_key
    });
    this.repository.saveDecision({
      decisionId: this.ids.next(), ownerId, bookId, workflowId,
      kind: kind === 'volume' ? 'volume_option' : 'chain_option', targetId: optionId,
      authorNote, decision: { action: 'select', optionId, treeVersionId: saved.versionId },
      idempotencyKey, requestHash, now: this.now()
    });
    this.repository.updateWorkflow({
      ownerId, bookId, workflowId,
      stage: kind === 'volume' ? 'volume_tree_confirmation' : 'chain_tree_confirmation',
      status: 'awaiting_author',
      checkpoint: { selectedOptionId: optionId, candidateTreeVersionId: saved.versionId },
      now: this.now()
    });
    return { treeKind: kind, scopeId: option.scope_id, treeVersionId: saved.versionId, nextStep: 'confirm_tree' };
  }

  public continueToChain(ownerId: string, bookId: string, workflowId: string, input: {
    chainScopeId?: unknown;
    candidateCount?: unknown;
    memberPreferences?: unknown;
  }): V7CreationWorkflowView {
    const run = this.requireWorkflow(ownerId, bookId, workflowId);
    if (run.stage !== 'volume_tree_confirmation') throw conflict('当前还不能开始设计单元链。');
    const volumeTree = this.requireConfirmedTree(ownerId, bookId, 'volume', run.volume_scope_id);
    const chainScopeId = key(input.chainScopeId, '单元链编号');
    const candidateCount = planningCandidateCount(input.candidateCount);
    this.assertDistinctPlanningPreferences(input.memberPreferences);
    assertLinkedTree(volumeTree, 'chain', chainScopeId, '这条单元链不在已确认本卷树中。');
    this.saveMemberPreferences(ownerId, bookId, workflowId, input.memberPreferences);
    this.repository.updateWorkflow({
      ownerId, bookId, workflowId, stage: 'chain_options', status: 'queued', chainScopeId,
      checkpoint: {
        confirmedVolumeTreeVersionId: volumeTree.tree_version_id,
        requestedCandidateCount: candidateCount
      }, now: this.now()
    });
    const updated = this.requireWorkflow(ownerId, bookId, workflowId);
    this.start(updated);
    return this.view(updated);
  }

  public continueToNextChain(ownerId: string, bookId: string, workflowId: string, input: {
    chainScopeId?: unknown;
    candidateCount?: unknown;
    memberPreferences?: unknown;
    idempotencyKey?: unknown;
  }): { volumeComplete: boolean; workflow: V7CreationWorkflowView | null } {
    const requestedRun = this.requireWorkflow(ownerId, bookId, workflowId);
    const cancelledCheckpoint = requestedRun.status === 'cancelled'
      ? json(requestedRun.checkpoint_json) as { parentWorkflowId?: unknown }
      : null;
    const resumableParentId = typeof cancelledCheckpoint?.parentWorkflowId === 'string'
      ? cancelledCheckpoint.parentWorkflowId
      : null;
    // 停止一条尚未完成的子链后，作者仍应能从已完成的上一链继续。
    // 这里仅沿已持久化的父任务编号恢复，不复活已取消调用，也不覆盖其审计记录。
    const parent = resumableParentId === null
      ? requestedRun
      : this.requireWorkflow(ownerId, bookId, resumableParentId);
    if (parent.status !== 'completed' || parent.stage !== 'completed') throw conflict('请先完成当前单元链。');
    const volumeTree = this.requireConfirmedTree(ownerId, bookId, 'volume', parent.volume_scope_id);
    const available = linkedTrees(volumeTree, 'chain');
    const requested = optionalText(input.chainScopeId, '单元链编号', 128);
    if (requested !== null && !available.some((item) => item.scopeId === requested)) {
      throw conflict('这条单元链不在已确认本卷方向中。');
    }
    const existingRuns = this.repository.workflowsForVolume(ownerId, bookId, parent.volume_scope_id);
    const existingForRequested = requested === null
      ? undefined
      : existingRuns.find((item) => item.chain_scope_id === requested && item.status !== 'cancelled');
    if (existingForRequested !== undefined) {
      this.start(existingForRequested);
      return { volumeComplete: false, workflow: this.view(existingForRequested) };
    }
    const started = new Set(existingRuns
      .filter((item) => item.status !== 'cancelled')
      .map((item) => item.chain_scope_id)
      .filter((value): value is string => value !== null));
    const next = requested === null
      ? available.find((item) => !started.has(item.scopeId))
      : available.find((item) => item.scopeId === requested);
    if (next === undefined) return { volumeComplete: true, workflow: null };
    const candidateCount = planningCandidateCount(input.candidateCount);
    this.assertDistinctPlanningPreferences(input.memberPreferences);
    const idempotencyKey = actionKey(input.idempotencyKey);
    const requestHash = sha256(stableJson({
      action: 'continue_chain', parentWorkflowId: parent.workflow_id, chainScopeId: next.scopeId, candidateCount
    }));
    const replay = this.repository.workflowByIdempotency(ownerId, bookId, idempotencyKey);
    if (replay !== undefined) {
      if (replay.request_hash !== requestHash) throw conflict('本次操作编号已经用于另一项创作。');
      this.start(replay);
      return { volumeComplete: false, workflow: this.view(replay) };
    }
    const child = this.repository.createChainWorkflow({
      workflowId: this.ids.next(), ownerId, bookId, volumeScopeId: parent.volume_scope_id,
      chainScopeId: next.scopeId, firstVolume: parent.first_volume === 1,
      authorGoal: parent.author_goal, parentWorkflowId: parent.workflow_id,
      requestedCandidateCount: candidateCount,
      idempotencyKey, requestHash, now: this.now()
    });
    for (const preference of this.repository.memberPreferences(ownerId, bookId, parent.workflow_id)) {
      const roleKey = preference.role_key === 'outline_writer' ? 'planning_writer' : preference.role_key;
      this.repository.saveMemberPreference({
        ownerId, bookId, workflowId: child.workflow_id,
        roleKey, memberKey: preference.member_key, now: this.now()
      });
    }
    for (const preference of this.repository.optionMemberPreferences(ownerId, bookId, parent.workflow_id)) {
      this.repository.saveOptionMemberPreference({
        ownerId, bookId, workflowId: child.workflow_id,
        optionSeatKey: preference.option_seat_key, memberKey: preference.member_key, now: this.now()
      });
    }
    this.saveMemberPreferences(ownerId, bookId, child.workflow_id, input.memberPreferences);
    this.start(child);
    return { volumeComplete: false, workflow: this.view(child) };
  }

  public async generateOutlines(ownerId: string, bookId: string, workflowId: string, input: {
    chapterStart?: unknown;
    maximumChapters?: unknown;
    memberKey?: unknown;
    memberKeys?: unknown;
    candidateCount?: unknown;
    replaceCandidateId?: unknown;
    regenerate?: unknown;
  }): Promise<{ candidates: V7CreationWorkflowView['outlines']; expectedOutlines: number }> {
    const run = this.requireWorkflow(ownerId, bookId, workflowId);
    if (!['chain_tree_confirmation', 'chapter_outline_confirmation'].includes(run.stage) || run.chain_scope_id === null) {
      throw conflict('请先确认当前单元链。');
    }
    this.requireConfirmedTree(ownerId, bookId, 'chain', run.chain_scope_id);
    const expectedChapterStart = this.repository.nextBookChapterNumber(ownerId, bookId);
    const chapterStart = input.chapterStart === undefined
      ? expectedChapterStart
      : positiveInteger(input.chapterStart, '起始章节');
    if (chapterStart !== expectedChapterStart) throw conflict(`本链应从第${expectedChapterStart}章开始。`);
    const maximumChapters = rangedInteger(input.maximumChapters, '本链最多章节', 2, 30);
    const requestedCount = planningCandidateCount(input.candidateCount);
    const rawMemberKeys = input.memberKeys ?? (input.memberKey === undefined ? undefined : [input.memberKey]);
    const selectedMembers = this.outlineCandidateMembers(rawMemberKeys, requestedCount);
    const context = await this.contexts.compile({
      ownerId, bookId, workflowId, taskKind: 'outline', taskId: run.chain_scope_id,
      taskBrief: '把已确认单元链拆成紧凑、可执行、每章有变化和回报的章纲。', firstVolume: run.first_volume === 1,
      authorInput: run.author_goal, requiredTree: { treeKind: 'chain', scopeId: run.chain_scope_id }
    });
    const replaceCandidateId = optionalKey(input.replaceCandidateId, '待替换章纲方案编号');
    const currentCandidates = this.repository.outlineDraftCandidates(ownerId, bookId, workflowId, run.chain_scope_id);
    const replacedCandidate = replaceCandidateId === null
      ? undefined
      : currentCandidates.find((candidate) => candidate.candidate_id === replaceCandidateId);
    if (replaceCandidateId !== null && replacedCandidate === undefined) throw conflict('待重新设计的章纲方案不存在或已经变化。');
    const expectedOutlines = replacedCandidate === undefined ? requestedCount : Math.max(1, currentCandidates.length);
    const seats = (['option_1', 'option_2', 'option_3'] as const).slice(0, requestedCount);
    const workSeats = replacedCandidate === undefined
      ? seats.filter((seat) => !currentCandidates.some((candidate) => candidate.seat_key === seat))
      : [replacedCandidate.seat_key];
    this.repository.updateWorkflow({ ownerId, bookId, workflowId, stage: 'chapter_outlines', status: 'working', now: this.now() });
    const generationFailures: string[] = [];
    const usedMembers = new Set(currentCandidates.map((candidate) => candidate.member_key));
    for (const [index, seat] of workSeats.entries()) {
      const preferred = selectedMembers[index] ?? this.outlineCandidateMembers(undefined, requestedCount)
        .find((member) => !usedMembers.has(member.memberKey));
      const memberCandidates = creationFallbackChain('planning_writer', preferred?.memberKey, this.memberRoster())
        .filter((member) => member.memberKey === preferred?.memberKey || !usedMembers.has(member.memberKey));
      try {
        const nodeKey = `${run.chain_scope_id}:${seat}`;
        const recoverable = replacedCandidate === undefined
          ? this.repository.modelCallsForWorkflow(ownerId, bookId, workflowId)
            .filter((call) => call.run_kind === 'outline' && call.node_key === nodeKey
              && call.state === 'succeeded' && call.output_text !== null)
            .at(-1)
          : undefined;
        const recoveredMember = recoverable === undefined
          ? undefined
          : this.memberRoster().find((member) => member.memberKey === recoverable.member_key);
        if (recoverable !== undefined && recoverable.output_text !== null && recoveredMember !== undefined) {
          const content = parseChapterSequence(recoverable.output_text, run.chain_scope_id, chapterStart, 30);
          this.repository.saveOutlineDraftCandidate({
            candidateId: this.ids.next(), ownerId, bookId, workflowId, chainScopeId: run.chain_scope_id,
            seatKey: seat, contextPackId: context.contextPackId, content, contentHash: sha256(stableJson(content)),
            memberKey: recoveredMember.memberKey, memberSnapshot: memberSnapshot(recoveredMember),
            requestId: recoverable.request_id, now: this.now()
          });
          usedMembers.add(recoveredMember.memberKey);
          continue;
        }
        const result = await this.runWithFallback({
          ownerId, bookId, workflowId, role: 'planning_writer', runKind: 'outline', nodeKey,
          // 一条链的章纲只展开当前四至十二章，完整 JSON 实测约 4k 字符。
          // 5k 可见输出足够，并让套餐模型走有边界的直出合同；8k 会额外开启
          // 4k 隐藏思考，真实四章章纲因此多消耗约 4.5k Token 和近一分钟。
          workstationKey: 'chapter_outline', purpose: 'structured_planning', maxOutputTokens: 5_000, temperature: 0.5,
          operationMode: replacedCandidate === undefined ? 'fresh' : 'revise', basedOnTaskId: replacedCandidate?.request_id ?? null,
          authorInstructionVersion: null, sourceTraces: context.sourceTraces, memberCandidates,
          requestPrefix: `creation-outline:${workflowId}:${run.chain_scope_id}:${context.sourceFingerprint}:${seat}:chapters-${maximumChapters}:${replaceCandidateId ?? 'initial'}`,
          prompt: chapterSequencePrompt({
            chainScopeId: run.chain_scope_id,
            chapterStart,
            chapterCount: maximumChapters,
            contextPack: context.content,
            ...(replacedCandidate === undefined ? {} : {
              priorSequence: JSON.parse(replacedCandidate.content_json) as V7ChapterSequence,
              rewriteInstructions: replacedCandidate.review_json === null
                ? []
                : (JSON.parse(replacedCandidate.review_json) as V7ChapterReview).rewriteInstructions
            })
          })
        });
        this.ensureActive(ownerId, bookId, workflowId);
        const content = parseChapterSequence(result.output, run.chain_scope_id, chapterStart, maximumChapters);
        this.repository.saveOutlineDraftCandidate({
          candidateId: this.ids.next(), ownerId, bookId, workflowId, chainScopeId: run.chain_scope_id,
          seatKey: seat, contextPackId: context.contextPackId, content, contentHash: sha256(stableJson(content)),
          memberKey: result.member.memberKey, memberSnapshot: memberSnapshot(result.member), requestId: result.requestId,
          now: this.now(), ...(replacedCandidate === undefined ? {} : { replacesCandidateId: replacedCandidate.candidate_id })
        });
        usedMembers.add(result.member.memberKey);
      } catch (error) {
        generationFailures.push(error instanceof Error ? error.message : String(error));
      }
    }
    const candidatesToReview = this.repository.outlineDraftCandidates(ownerId, bookId, workflowId, run.chain_scope_id);
    const reviewFailures: string[] = [];
    for (const candidate of candidatesToReview.filter((item) => item.review_json === null)) {
      try {
        const writer = this.memberRoster().find((member) => member.memberKey === candidate.member_key);
        const writerModelSignature = modelSignature(writer);
        let reviewed = await this.runWithFallback({
          ownerId, bookId, workflowId, role: 'chief_editor', runKind: 'review', nodeKey: `outline-draft:${candidate.candidate_id}`,
          workstationKey: 'chapter_outline', purpose: 'novel_reviewer', maxOutputTokens: 3_000, temperature: 0.16,
          operationMode: 'fresh', basedOnTaskId: null, authorInstructionVersion: null,
          sourceTraces: context.sourceTraces,
          requestPrefix: `creation-outline-review:${workflowId}:${candidate.candidate_id}`,
          ...(writerModelSignature === undefined ? {} : { excludeModelSignature: writerModelSignature }),
          prompt: outlineReviewPrompt({ sequence: JSON.parse(candidate.content_json) as V7ChapterSequence, contextPack: context.content })
        });
        let review: V7ChapterReview;
        try {
          review = parseChapterReview(reviewed.output);
        } catch (validationError) {
          reviewed = await this.runWithFallback({
            ownerId, bookId, workflowId, role: 'chief_editor', runKind: 'review',
            nodeKey: `outline-draft:${candidate.candidate_id}:repair`, workstationKey: 'chapter_outline',
            purpose: 'novel_reviewer', maxOutputTokens: 3_000, temperature: 0.1,
            operationMode: 'repair', basedOnTaskId: reviewed.requestId, authorInstructionVersion: null,
            sourceTraces: context.sourceTraces,
            requestPrefix: `creation-outline-review-repair:${workflowId}:${candidate.candidate_id}:${sha256(reviewed.output)}`,
            prompt: chapterReviewRepairPrompt({
              invalidOutput: reviewed.output,
              validationMessage: publicFailure(validationError),
              reviewTarget: '章纲'
            }),
            memberCandidates: [reviewed.member]
          });
          review = parseChapterReview(reviewed.output);
        }
        this.repository.saveOutlineDraftReview({
          ownerId, bookId, candidateId: candidate.candidate_id, memberKey: reviewed.member.memberKey,
          memberSnapshot: memberSnapshot(reviewed.member), review, requestId: reviewed.requestId, now: this.now()
        });
      } catch (error) { reviewFailures.push(error instanceof Error ? error.message : String(error)); }
    }
    const completed = this.repository.outlineDraftCandidates(ownerId, bookId, workflowId, run.chain_scope_id);
    const partial = completed.length < expectedOutlines || completed.some((candidate) => candidate.review_json === null);
    this.repository.updateWorkflow({
      ownerId, bookId, workflowId, stage: 'chapter_outline_confirmation', status: 'awaiting_author',
      checkpoint: {
        ...(json(run.checkpoint_json) as Record<string, unknown>), expectedOutlineCount: expectedOutlines, maximumChapters,
        outlineCandidateIds: completed.map((candidate) => candidate.candidate_id)
      },
      errorMessage: partial
        ? '对不起，有一份章纲或点评没有完成。已完成方案仍然保留，继续时只补缺少的部分。'
        : null,
      now: this.now()
    });
    if (completed.length === 0) throw conflict(generationFailures[0] ?? reviewFailures[0] ?? '对不起，这次章纲没有完成。');
    return { candidates: completed.map(outlineDraftView), expectedOutlines };
  }

  public confirmOutline(ownerId: string, bookId: string, workflowId: string, input: {
    sequenceId?: unknown;
    idempotencyKey?: unknown;
  }): { sequenceId: string; status: 'confirmed'; nextStep: 'manuscript' } {
    const run = this.requireWorkflow(ownerId, bookId, workflowId);
    if (run.stage !== 'chapter_outline_confirmation') throw conflict('当前没有等待确认的章纲。');
    const sequenceId = key(input.sequenceId, '章纲编号');
    const idempotencyKey = actionKey(input.idempotencyKey);
    const requestHash = sha256(stableJson({ sequenceId }));
    const replay = this.repository.decisionByIdempotency(ownerId, bookId, idempotencyKey);
    if (replay !== undefined) {
      if (replay.request_hash !== requestHash) throw conflict('本次操作编号已经用于另一份章纲。');
      return { sequenceId: replay.target_id, status: 'confirmed', nextStep: 'manuscript' };
    }
    const draft = this.repository.outlineDraftCandidate(ownerId, bookId, sequenceId);
    let row = this.repository.outline(ownerId, bookId, sequenceId);
    if (draft !== undefined) {
      if (draft.workflow_id !== workflowId || draft.lifecycle !== 'candidate') throw conflict('章纲方案不存在、已过期或已经确认。');
      if (draft.review_json === null || (JSON.parse(draft.review_json) as V7ChapterReview).passed !== true) {
        throw conflict('这份章纲还有明确问题，请只重新设计这一案，其他成功方案不会受影响。');
      }
      row = this.repository.saveOutline({
        sequenceId: this.ids.next(), ownerId, bookId, workflowId, chainScopeId: draft.chain_scope_id,
        contextPackId: draft.context_pack_id, content: JSON.parse(draft.content_json) as V7ChapterSequence,
        contentHash: draft.content_hash, memberKey: draft.member_key, requestId: draft.request_id, now: this.now()
      });
      this.repository.saveOutlineReview({
        ownerId, bookId, sequenceId: row.sequence_id, memberKey: draft.review_member_key!,
        memberSnapshot: JSON.parse(draft.review_member_snapshot_json!),
        review: JSON.parse(draft.review_json) as V7ChapterReview,
        requestId: draft.review_request_id!, now: this.now()
      });
      row = this.repository.outline(ownerId, bookId, row.sequence_id);
    }
    if (row === undefined || row.workflow_id !== workflowId || row.lifecycle !== 'candidate') throw conflict('章纲不存在、已过期或已经确认。');
    if (row.review_json === null || (JSON.parse(row.review_json) as V7ChapterReview).passed !== true) {
      throw conflict('这份章纲还没有通过主编审查，请先重新设计。');
    }
    const confirmed = this.repository.confirmOutlineWithDecision({
      decisionId: this.ids.next(), ownerId, bookId, workflowId, sequenceId: row.sequence_id,
      idempotencyKey, requestHash, now: this.now()
    });
    if (confirmed?.lifecycle !== 'confirmed') throw conflict('章纲没有确认成功。');
    if (draft !== undefined) this.repository.selectOutlineDraft({ ownerId, bookId, workflowId, chainScopeId: draft.chain_scope_id, candidateId: draft.candidate_id, now: this.now() });
    this.repository.updateWorkflow({
      ownerId, bookId, workflowId, stage: 'manuscript', status: 'awaiting_author',
      checkpoint: { sequenceId: row.sequence_id }, now: this.now()
    });
    return { sequenceId: row.sequence_id, status: 'confirmed', nextStep: 'manuscript' };
  }

  public async generateManuscript(ownerId: string, bookId: string, workflowId: string, input: {
    chapterNumber?: unknown;
    writerMemberKey?: unknown;
    reviewerMemberKey?: unknown;
    resumeExistingDraft?: unknown;
  }): Promise<{ manuscriptVersionId: string; lifecycle: V7ManuscriptVersionRow['lifecycle']; review: V7ChapterReview }> {
    const run = this.requireWorkflow(ownerId, bookId, workflowId);
    if (run.chain_scope_id === null || !['manuscript', 'manuscript_confirmation'].includes(run.stage)) throw conflict('请先确认章纲。');
    const sequence = this.repository.confirmedOutline(ownerId, bookId, run.chain_scope_id);
    if (sequence === undefined) throw conflict('没有已确认的章纲。');
    const chapterNumber = positiveInteger(input.chapterNumber, '章节序号');
    const resumeExistingDraft = input.resumeExistingDraft === true;
    this.savePreferredMember(ownerId, bookId, workflowId, 'lead_writer', input.writerMemberKey);
    this.savePreferredMember(ownerId, bookId, workflowId, 'independent_reviewer', input.reviewerMemberKey);
    const sequenceContent = JSON.parse(sequence.content_json) as V7ChapterSequence;
    const outline = sequenceContent.chapters.find((item) => item.chapterNumber === chapterNumber);
    if (outline === undefined) throw missing('这份章纲中没有该章节。');
    const outlineSource = exactOutlineSource(sequence, outline);
    const workflowCheckpoint = json(run.checkpoint_json) as { acknowledgedUnknownRequestId?: unknown };
    const acknowledgedUnknownRequestId = typeof workflowCheckpoint.acknowledgedUnknownRequestId === 'string'
      ? workflowCheckpoint.acknowledgedUnknownRequestId
      : null;
    this.repository.updateWorkflow({
      ownerId, bookId, workflowId, stage: 'manuscript', status: 'working',
      checkpoint: { ...workflowCheckpoint, activeChapterNumber: chapterNumber },
      errorMessage: null, now: this.now()
    });
    try {
    const context = await this.contexts.compile({
      ownerId, bookId, workflowId, taskKind: 'manuscript', taskId: `${sequence.sequence_id}:${chapterNumber}`,
      taskBrief: `按照已确认章纲完成第${chapterNumber}章正文，保持连续性和人物知情边界。`,
      firstVolume: run.first_volume === 1
    });
    let priorText: string | undefined;
    let basedOnVersionId: string | null = null;
    let rewriteInstructions: string[] | undefined;
    let latestReview: V7ChapterReview | null = null;
    const chapterDrafts = this.repository.manuscriptsForSequence(ownerId, bookId, sequence.sequence_id)
      .filter((item) => item.chapter_number === chapterNumber);
    let latestManuscript: V7ManuscriptVersionRow | null = resumeExistingDraft
      ? chapterDrafts.toReversed().find((item) => item.lifecycle === 'draft'
        && this.repository.manuscriptReview(ownerId, bookId, item.manuscript_version_id) === undefined) ?? null
      : null;
    if (resumeExistingDraft && latestManuscript === null) throw conflict('没有等待审校的正文，请重新写这一章。');
    const priorAttempts = chapterDrafts.length;
    for (let pass = 1; pass <= 2; pass += 1) {
      const reuseSavedDraft = pass === 1 && resumeExistingDraft && latestManuscript !== null;
      if (!reuseSavedDraft) {
        const basedOnTaskId = latestManuscript?.request_id ?? null;
        const written = await this.runWithFallback({
        ownerId, bookId, workflowId, role: 'lead_writer', runKind: 'manuscript', nodeKey: `chapter:${chapterNumber}:pass:${pass}`,
        workstationKey: 'manuscript',
        purpose: 'novel_writer', maxOutputTokens: 18_000, temperature: 0.72,
        operationMode: pass === 1 ? 'fresh' : 'repair',
        basedOnTaskId,
        authorInstructionVersion: null,
        sourceTraces: [...context.sourceTraces, explicitSourceTrace(ownerId, bookId, outlineSource)],
        acknowledgedUnknownRequestId,
        requestPrefix: `creation-manuscript:${workflowId}:${sequence.sequence_id}:${chapterNumber}:attempt:${priorAttempts + 1}:pass:${pass}`,
        prompt: manuscriptPrompt({
          outline,
          contextPack: context.content,
          ...(priorText === undefined ? {} : { priorText }),
          ...(rewriteInstructions === undefined ? {} : { rewriteInstructions })
        })
        });
        this.ensureActive(ownerId, bookId, workflowId);
        assertCleanManuscript(written.output);
        latestManuscript = this.repository.manuscriptByRequest(ownerId, bookId, written.requestId) ?? this.repository.saveManuscript({
          manuscriptVersionId: this.ids.next(), ownerId, bookId, workflowId, sequenceId: sequence.sequence_id,
          chapterNumber, outlineRevision: sequence.revision, contentText: written.output.trim(),
          contentHash: sha256(written.output.trim()), contextPackId: context.contextPackId,
          memberKey: written.member.memberKey, basedOnVersionId, requestId: written.requestId, now: this.now()
        });
      }
      if (latestManuscript === null) throw new Error('正文工作没有产生可审校草稿');
      const reviewContext = await this.contexts.compile({
        ownerId, bookId, workflowId, taskKind: 'review', taskId: latestManuscript.manuscript_version_id,
        taskBrief: `独立审查第${chapterNumber}章是否符合正式资料、人物连续性、章纲责任和阅读质量。`,
        firstVolume: run.first_volume === 1
      });
      const writerSignature = modelSignature(this.memberRoster().find((member) => member.memberKey === latestManuscript!.member_key));
      const reviewAttempt = this.repository.modelCallsForWorkflow(ownerId, bookId, workflowId)
        .filter((call) => call.run_kind === 'review'
          && call.node_key.startsWith(latestManuscript!.manuscript_version_id)).length + 1;
      let reviewed = await this.runWithFallback({
        ownerId, bookId, workflowId, role: 'independent_reviewer', runKind: 'review',
        nodeKey: latestManuscript.manuscript_version_id, workstationKey: 'review',
        purpose: 'novel_reviewer', maxOutputTokens: 2_400, temperature: 0.12,
        operationMode: 'fresh', basedOnTaskId: null, authorInstructionVersion: null,
        sourceTraces: [...reviewContext.sourceTraces, explicitSourceTrace(ownerId, bookId, outlineSource)],
        requestPrefix: `creation-review:${workflowId}:${latestManuscript.manuscript_version_id}:attempt:${reviewAttempt}`,
        ...(writerSignature === undefined ? {} : { excludeModelSignature: writerSignature }),
        prompt: reviewPrompt({ outline, contextPack: reviewContext.content, manuscript: latestManuscript.content_text })
      });
      this.ensureActive(ownerId, bookId, workflowId);
      try {
        latestReview = parseChapterReview(reviewed.output);
      } catch (validationError) {
        reviewed = await this.runWithFallback({
          ownerId, bookId, workflowId, role: 'independent_reviewer', runKind: 'review',
          nodeKey: `${latestManuscript.manuscript_version_id}:repair`, workstationKey: 'review',
          purpose: 'novel_reviewer', maxOutputTokens: 2_000, temperature: 0.08,
          operationMode: 'repair', basedOnTaskId: reviewed.requestId, authorInstructionVersion: null,
          sourceTraces: [...reviewContext.sourceTraces, explicitSourceTrace(ownerId, bookId, outlineSource)],
          requestPrefix: `creation-review-repair:${workflowId}:${latestManuscript.manuscript_version_id}:attempt:${reviewAttempt}:${sha256(reviewed.output)}`,
          prompt: chapterReviewRepairPrompt({
            invalidOutput: reviewed.output,
            validationMessage: publicFailure(validationError),
            reviewTarget: '正文'
          }),
          memberCandidates: [reviewed.member]
        });
        latestReview = parseChapterReview(reviewed.output);
      }
      if (this.repository.manuscriptReview(ownerId, bookId, latestManuscript.manuscript_version_id) === undefined) {
        this.repository.saveManuscriptReview({
          reviewId: this.ids.next(), ownerId, bookId, workflowId,
          manuscriptVersionId: latestManuscript.manuscript_version_id, memberKey: reviewed.member.memberKey,
          memberSnapshot: memberSnapshot(reviewed.member), review: latestReview,
          reviewHash: sha256(stableJson(latestReview)), requestId: reviewed.requestId, now: this.now()
        });
      }
      if (latestReview.passed) break;
      priorText = latestManuscript.content_text;
      basedOnVersionId = latestManuscript.manuscript_version_id;
      rewriteInstructions = latestReview.rewriteInstructions;
    }
    if (latestManuscript === null || latestReview === null) throw new Error('正文工作没有产生结果');
    const finalRow = this.repository.manuscript(ownerId, bookId, latestManuscript.manuscript_version_id)!;
    this.repository.updateWorkflow({
      ownerId, bookId, workflowId, stage: 'manuscript_confirmation',
      status: latestReview.passed ? 'awaiting_author' : 'partially_failed',
      checkpoint: { manuscriptVersionId: finalRow.manuscript_version_id, reviewPassed: latestReview.passed },
      errorMessage: latestReview.passed ? null : '对不起，这一章复核后仍有问题，已保留正文和修改意见。', now: this.now()
    });
    return { manuscriptVersionId: finalRow.manuscript_version_id, lifecycle: finalRow.lifecycle, review: latestReview };
    } catch (error) {
      const current = this.requireWorkflow(ownerId, bookId, workflowId);
      if (current.status !== 'cancelled') {
        const latestSaved = this.repository.manuscriptsForSequence(ownerId, bookId, sequence.sequence_id)
          .filter((item) => item.chapter_number === chapterNumber)
          .at(-1);
        const outcomeUnknown = error instanceof V7CreationModelError && error.outcomeUnknown;
        this.repository.updateWorkflow({
          ownerId, bookId, workflowId,
          stage: latestSaved === undefined ? 'manuscript' : 'manuscript_confirmation',
          status: outcomeUnknown ? 'unknown' : 'partially_failed',
          checkpoint: {
            ...(json(current.checkpoint_json) as Record<string, unknown>),
            ...(latestSaved === undefined ? {} : { manuscriptVersionId: latestSaved.manuscript_version_id }),
            reviewPassed: false
          },
          errorMessage: outcomeUnknown
            ? '对不起，这次结果还不能确认。已保存此前成果，请换一位成员继续。'
            : `对不起，这次没有完成。${publicFailure(error)}`,
          now: this.now()
        });
      }
      throw error;
    }
  }

  public finalizeManuscript(ownerId: string, bookId: string, workflowId: string, input: {
    manuscriptVersionId?: unknown;
    idempotencyKey?: unknown;
  }): { manuscriptVersionId: string; status: 'final'; nextStep: 'settlement' } {
    const manuscriptVersionId = key(input.manuscriptVersionId, '正文版本');
    const idempotencyKey = actionKey(input.idempotencyKey);
    const requestHash = sha256(stableJson({ manuscriptVersionId, action: 'finalize' }));
    const replay = this.repository.finalizeReceiptByIdempotency(ownerId, bookId, idempotencyKey);
    if (replay !== undefined) {
      if (replay.workflow_id !== workflowId || replay.manuscript_version_id !== manuscriptVersionId
        || replay.request_hash !== requestHash) {
        throw conflict('本次操作编号已经用于另一份正文。');
      }
      const final = this.repository.finalManuscript(ownerId, bookId, manuscriptVersionId);
      if (final === undefined) throw conflict('已确认的定稿正文不存在。');
      return { manuscriptVersionId, status: 'final', nextStep: 'settlement' };
    }
    const run = this.requireWorkflow(ownerId, bookId, workflowId);
    if (run.stage !== 'manuscript_confirmation') throw conflict('当前没有可以定稿的正文。');
    const finalized = this.repository.finalizeManuscript({
      ownerId, bookId, workflowId, manuscriptVersionId, decisionId: this.ids.next(),
      idempotencyKey, requestHash, eventId: this.ids.next(), now: this.now()
    });
    if (finalized?.lifecycle !== 'final') throw conflict('正文必须先通过独立审查，才能定稿。');
    this.repository.updateWorkflow({
      ownerId, bookId, workflowId, stage: 'settlement', status: 'working',
      checkpoint: { manuscriptVersionId, formalizationQueued: true }, now: this.now()
    });
    return { manuscriptVersionId, status: 'final', nextStep: 'settlement' };
  }

  public adminAudit(ownerId: string, bookId: string, workflowId: string): unknown {
    this.requireWorkflow(ownerId, bookId, workflowId);
    return this.repository.audit(ownerId, bookId, workflowId);
  }

  private start(run: V7CreationWorkflowRow): void {
    const canStart = run.status === 'queued';
    if (!canStart || !['context_selection', 'volume_options', 'chain_options'].includes(run.stage)) return;
    if (this.activeRuns.has(run.workflow_id)) return;
    this.activeRuns.add(run.workflow_id);
    void this.executeOptions(run).catch((error) => {
      const current = this.repository.workflow(run.owner_id, run.book_id, run.workflow_id);
      // A provider response may arrive after the author has stopped the task.
      // Terminal author decisions are authoritative and must never be
      // overwritten by a late parse/provider failure from the detached run.
      if (current === undefined || ['awaiting_author', 'cancelled', 'completed'].includes(current.status)) return;
      this.repository.updateWorkflow({
        ownerId: run.owner_id, bookId: run.book_id, workflowId: run.workflow_id,
        stage: current.stage, status: error instanceof V7CreationModelError && error.outcomeUnknown ? 'unknown' : 'failed',
        checkpoint: json(current.checkpoint_json), errorMessage: `对不起，这次没有完成。${publicFailure(error)}`, now: this.now()
      });
    }).finally(() => this.activeRuns.delete(run.workflow_id));
  }

  private async executeOptions(run: V7CreationWorkflowRow): Promise<void> {
    const kind: OptionKind = run.stage === 'chain_options' ? 'chain' : 'volume';
    const scopeId = kind === 'volume' ? run.volume_scope_id : run.chain_scope_id;
    if (scopeId === null) throw new Error('单元链范围不存在');
    const runCheckpoint = json(run.checkpoint_json) as { optionRevision?: unknown };
    const expectedOptions = requestedCandidateCount(run);
    const revisionFeedback = optionRevisionFeedback(runCheckpoint.optionRevision);
    const taskBrief = kind === 'volume'
      ? run.first_volume === 1
        ? '设计第一卷：尽快建立处境、核心卖点、前三章责任和首次回报，同时承担全书第一阶段推进。'
        : '设计下一卷：承接上一卷正文实际，推进全书方向，并提供不同于上一卷的阅读体验。'
      : '设计当前单元链：在有限章节内形成触发、阻力升级、人物选择、变化和明确回报。';
    const context = await this.contexts.compile({
      ownerId: run.owner_id, bookId: run.book_id, workflowId: run.workflow_id,
      taskKind: kind, taskId: scopeId, taskBrief, firstVolume: run.first_volume === 1,
      authorInput: [run.author_goal, revisionFeedback === null ? null : [
        `主编要求重新设计：${revisionFeedback.publicSummary}`,
        ...revisionFeedback.risks.map((risk) => `需要解决：${risk}`),
        ...revisionFeedback.authorDecisions.map((decision) => `本轮必须做到：${decision}`)
      ].join('\n')].filter((item): item is string => item !== null && item.length > 0).join('\n\n') || null,
      requiredTree: kind === 'volume' ? { treeKind: 'book', scopeId: run.book_id } : { treeKind: 'volume', scopeId: run.volume_scope_id }
    });
    this.ensureActive(run.owner_id, run.book_id, run.workflow_id);
    this.repository.updateWorkflow({
      ownerId: run.owner_id, bookId: run.book_id, workflowId: run.workflow_id,
      stage: kind === 'volume' ? 'volume_options' : 'chain_options', status: 'working',
      checkpoint: {
        ...runCheckpoint,
        requestedCandidateCount: expectedOptions,
        contextPackId: context.contextPackId,
        completedSeats: this.repository.options(run.owner_id, run.book_id, run.workflow_id, kind)
          .map((item) => persistedOptionSeat(item.seat_key))
      }, now: this.now()
    });
    const existing = this.repository.options(run.owner_id, run.book_id, run.workflow_id, kind);
    const seats = (['option_1', 'option_2', 'option_3'] as const).slice(0, expectedOptions);
    const missingSeats = seats.filter((seat) => !existing.some((item) => persistedOptionSeat(item.seat_key) === seat));
    const attemptMarker = String(this.repository.modelCallsForWorkflow(run.owner_id, run.book_id, run.workflow_id)
      .filter((call) => call.run_kind === 'option' && call.node_key.startsWith(`${kind}:${scopeId}:`)).length);
    const assignments = this.distinctInitialAssignments(run, missingSeats, existing);
    const failures: string[] = [];
    const outcomes = await Promise.allSettled(missingSeats.map(async (seat) => {
      const member = assignments.get(seat);
      if (member === undefined) throw new Error('没有找到可用的规划成员。');
      await this.runOptionSeat(run, context, kind, scopeId, seat, [member], attemptMarker);
    }));
    this.ensureActive(run.owner_id, run.book_id, run.workflow_id);
    for (const outcome of outcomes) if (outcome.status === 'rejected') failures.push(publicFailure(outcome.reason));

    for (const seat of seats) {
      let completed = this.repository.options(run.owner_id, run.book_id, run.workflow_id, kind);
      if (completed.some((item) => persistedOptionSeat(item.seat_key) === seat)) continue;
      const usedMemberKeys = new Set(completed.map((item) => item.member_key));
      const triedMembers = new Set(this.repository.modelCallsForWorkflow(run.owner_id, run.book_id, run.workflow_id)
        .filter((call) => call.run_kind === 'option' && call.node_key === `${kind}:${scopeId}:${seat}`)
        .map((call) => call.member_key));
      let fallback = this.optionMemberCandidates(run, seat)
        .filter((member) => !usedMemberKeys.has(member.memberKey) && !triedMembers.has(member.memberKey));
      // 只补当前失败席。优先使用尚未参与本轮的不同模型；若该席已经真实失败并
      // 穷尽可用成员，再允许已完成其他席的强模型补位，不能重跑已成功方案。
      if (fallback.length === 0) {
        const callCounts = new Map<string, number>();
        for (const call of this.repository.modelCallsForWorkflow(run.owner_id, run.book_id, run.workflow_id)) {
          if (call.run_kind !== 'option') continue;
          callCounts.set(call.member_key, (callCounts.get(call.member_key) ?? 0) + 1);
        }
        fallback = this.optionMemberCandidates(run, seat)
          .filter((member) => !triedMembers.has(member.memberKey))
          .sort((left, right) => (callCounts.get(left.memberKey) ?? 0) - (callCounts.get(right.memberKey) ?? 0));
      }
      if (fallback.length === 0) continue;
      try {
        await this.runOptionSeat(run, context, kind, scopeId, seat, fallback, attemptMarker);
      } catch (error) {
        failures.push(publicFailure(error));
      }
      completed = this.repository.options(run.owner_id, run.book_id, run.workflow_id, kind);
      if (completed.some((item) => persistedOptionSeat(item.seat_key) === seat)) continue;
    }

    const options = this.repository.options(run.owner_id, run.book_id, run.workflow_id, kind);
    this.ensureActive(run.owner_id, run.book_id, run.workflow_id);
    if (options.length < expectedOptions) {
      this.repository.updateWorkflow({
        ownerId: run.owner_id, bookId: run.book_id, workflowId: run.workflow_id,
        stage: kind === 'volume' ? 'volume_options' : 'chain_options',
        status: options.length === 0 ? 'failed' : 'partially_failed',
        checkpoint: {
          ...runCheckpoint,
          requestedCandidateCount: expectedOptions,
          contextPackId: context.contextPackId,
          completedSeats: options.map((item) => persistedOptionSeat(item.seat_key))
        },
        errorMessage: `对不起，本轮需要${expectedOptions}套，目前完成了${options.length}套。已完成方案不会重做，您可以稍后只补失败的方案。${failures.at(-1) ?? ''}`,
        now: this.now()
      });
      return;
    }
    let reviewId: string | null = null;
    let comparisonMessage: string | null = null;
    if (expectedOptions >= 2) {
      const storedReview = this.repository.optionReview(run.owner_id, run.book_id, run.workflow_id, kind);
      try {
        const review = storedReview !== undefined && validStoredOptionReview(storedReview.review_json, options.map((item) => item.option_id))
          ? storedReview
          : await this.runChiefReview(run, context, kind, scopeId, options);
        reviewId = review.review_id;
      } catch (error) {
        // 比较点评只是帮助作者选择，不是候选方案的准入门禁。点评失败时保留所有
        // 已完成方案并直接交给作者，绝不能触发整批返工。
        comparisonMessage = `抱歉，方案已经完成，但这次比较点评没有完成。您仍可直接查看并选择。${publicFailure(error)}`;
      }
    }
    this.ensureActive(run.owner_id, run.book_id, run.workflow_id);
    this.repository.updateWorkflow({
      ownerId: run.owner_id, bookId: run.book_id, workflowId: run.workflow_id,
      stage: kind === 'volume' ? 'volume_decision' : 'chain_decision', status: 'awaiting_author',
      checkpoint: {
        ...runCheckpoint,
        requestedCandidateCount: expectedOptions,
        contextPackId: context.contextPackId,
        completedSeats: options.map((item) => persistedOptionSeat(item.seat_key)),
        reviewId
      },
      errorMessage: comparisonMessage, now: this.now()
    });
  }

  private async runOptionSeat(
    run: V7CreationWorkflowRow,
    context: Awaited<ReturnType<V7CreationContextCompiler['compile']>>,
    kind: OptionKind,
    scopeId: string,
    seat: OptionSeatKey,
    candidates: readonly V7CreationMemberDefinition[],
    attemptMarker: string
  ): Promise<void> {
    const role = 'planning_writer' as const;
    const failures: string[] = [];
    for (const member of candidates) {
      try {
        let result = await this.runWithFallback({
          ownerId: run.owner_id, bookId: run.book_id, workflowId: run.workflow_id, role,
          runKind: 'option', nodeKey: `${kind}:${scopeId}:${seat}`, workstationKey: kind,
          purpose: 'structured_planning',
          maxOutputTokens: kind === 'volume' ? 8_000 : 5_000,
          temperature: seat === 'option_2' ? 0.68 : 0.58,
          operationMode: 'fresh', basedOnTaskId: null, authorInstructionVersion: null,
          sourceTraces: context.sourceTraces,
          requestPrefix: `creation-option:${run.workflow_id}:${kind}:${scopeId}:${seat}:${context.sourceFingerprint}:${attemptMarker}`,
          prompt: planningOptionPrompt({
            kind,
            scopeId,
            contextPack: context.content,
            variation: seat,
            firstVolume: run.first_volume === 1
          }),
          memberCandidates: [member]
        });
        this.ensureActive(run.owner_id, run.book_id, run.workflow_id);
        let option: V7VolumeOption | V7ChainOption;
        try {
          option = kind === 'volume' ? parseVolumeOption(result.output, scopeId) : parseChainOption(result.output, scopeId);
        } catch (validationError) {
          result = await this.runWithFallback({
            ownerId: run.owner_id, bookId: run.book_id, workflowId: run.workflow_id, role,
            runKind: 'option', nodeKey: `${kind}:${scopeId}:${seat}:repair`, workstationKey: kind,
            // 这是封闭的 JSON 合同修复，不是第二次策划。关闭发散思考，
            // 只补结构；不得为几个技术字段再消耗一轮完整规划预算。
            purpose: 'novel_reviewer', maxOutputTokens: kind === 'volume' ? 8_000 : 5_000, temperature: 0.12,
            operationMode: 'repair', basedOnTaskId: result.requestId, authorInstructionVersion: null,
            sourceTraces: context.sourceTraces,
            requestPrefix: `creation-option-repair:${run.workflow_id}:${kind}:${scopeId}:${seat}:${sha256(result.output)}`,
            prompt: planningOptionRepairPrompt({
              kind, scopeId, invalidOutput: result.output, validationMessage: publicFailure(validationError)
            }),
            memberCandidates: [result.member]
          });
          this.ensureActive(run.owner_id, run.book_id, run.workflow_id);
          option = kind === 'volume' ? parseVolumeOption(result.output, scopeId) : parseChainOption(result.output, scopeId);
        }
        const optionHash = sha256(stableJson(option));
        const existing = this.repository.options(run.owner_id, run.book_id, run.workflow_id, kind);
        if (existing.some((item) => item.option_hash === optionHash)) throw new Error('这份结果与已有方案完全相同，已请其他编剧重做。');
        this.repository.saveOption({
          optionId: this.ids.next(), ownerId: run.owner_id, bookId: run.book_id, workflowId: run.workflow_id,
          kind, scopeId, seatKey: legacyOptionSeat(seat), memberKey: result.member.memberKey, memberSnapshot: memberSnapshot(result.member),
          contextPackId: context.contextPackId, option, optionHash, requestId: result.requestId, now: this.now()
        });
        return;
      } catch (error) {
        if (error instanceof V7CreationModelError && error.outcomeUnknown) throw error;
        failures.push(publicFailure(error));
      }
    }
    throw new DomainError(errorCodes.agentCapabilityUnavailable, `对不起，这套方案没有完成。${failures.at(-1) ?? '编剧没有交回完整结果。'}`, {}, true, 503);
  }

  private async runChiefReview(
    run: V7CreationWorkflowRow,
    context: Awaited<ReturnType<V7CreationContextCompiler['compile']>>,
    kind: OptionKind,
    scopeId: string,
    rows: V7CreationOptionRow[]
  ) {
    const options = rows.map((row) => ({ optionId: row.option_id, option: JSON.parse(row.option_json) as V7VolumeOption | V7ChainOption }));
    let result = await this.runWithFallback({
      ownerId: run.owner_id, bookId: run.book_id, workflowId: run.workflow_id, role: 'chief_editor',
      runKind: 'option_review', nodeKey: `${kind}:${scopeId}:chief`, workstationKey: kind,
      purpose: 'novel_reviewer',
      maxOutputTokens: 6_000, temperature: 0.18,
      operationMode: 'fresh', basedOnTaskId: null, authorInstructionVersion: null,
      sourceTraces: context.sourceTraces,
      requestPrefix: `creation-option-review:${run.workflow_id}:${kind}:${scopeId}:${sha256(stableJson(options.map((item) => item.optionId)))}`,
      prompt: optionReviewPrompt({ options, contextPack: context.content })
    });
    this.ensureActive(run.owner_id, run.book_id, run.workflow_id);
    let review: V7PlanningOptionReview;
    try {
      review = parseOptionReview(result.output, options.map((item) => item.optionId));
    } catch (validationError) {
      result = await this.runWithFallback({
        ownerId: run.owner_id, bookId: run.book_id, workflowId: run.workflow_id, role: 'chief_editor',
        runKind: 'option_review', nodeKey: `${kind}:${scopeId}:chief:repair`, workstationKey: kind,
        purpose: 'novel_reviewer', maxOutputTokens: 4_000, temperature: 0.12,
        operationMode: 'repair', basedOnTaskId: result.requestId, authorInstructionVersion: null,
        sourceTraces: context.sourceTraces,
        requestPrefix: `creation-option-review-repair-v2:${run.workflow_id}:${kind}:${scopeId}:${sha256(result.output)}`,
        prompt: optionReviewRepairPrompt({
          invalidOutput: result.output,
          validationMessage: publicFailure(validationError),
          optionIds: options.map((item) => item.optionId),
          optionLabels: rows.map((row) => {
            const option = JSON.parse(row.option_json) as V7VolumeOption | V7ChainOption;
            return { optionId: row.option_id, label: seatName(row.seat_key), name: option.publicName };
          })
        }),
        memberCandidates: [result.member]
      });
      this.ensureActive(run.owner_id, run.book_id, run.workflow_id);
      review = parseOptionReview(result.output, options.map((item) => item.optionId));
    }
    this.repository.saveOptionReview({
      reviewId: this.ids.next(), ownerId: run.owner_id, bookId: run.book_id, workflowId: run.workflow_id,
      kind, scopeId, optionIds: options.map((item) => item.optionId), memberKey: result.member.memberKey,
      memberSnapshot: memberSnapshot(result.member), review, reviewHash: sha256(stableJson(review)),
      requestId: result.requestId, now: this.now()
    });
    return this.repository.optionReview(run.owner_id, run.book_id, run.workflow_id, kind)!;
  }

  private async runWithFallback(input: {
    ownerId: string; bookId: string; workflowId: string; role: V7CreationMemberDefinition['roleKey'];
    runKind: 'option' | 'option_review' | 'outline' | 'manuscript' | 'review'; nodeKey: string;
    workstationKey: V7WorkstationKey;
    purpose: 'structured_planning' | 'novel_writer' | 'novel_reviewer'; prompt: string;
    operationMode: 'fresh' | 'revise' | 'fusion' | 'repair';
    basedOnTaskId: string | null; authorInstructionVersion: number | null;
    sourceTraces: readonly V7ContextSourceTrace[];
    acknowledgedUnknownRequestId?: string | null;
    maxOutputTokens: number; temperature: number; requestPrefix: string;
    excludeModelSignature?: string;
    memberCandidates?: readonly V7CreationMemberDefinition[];
  }): Promise<{ output: string; requestId: string; member: V7CreationMemberDefinition }> {
    const failures: string[] = [];
    const preferred = this.repository.memberPreference(input.ownerId, input.bookId, input.workflowId, input.role)?.member_key;
    const eligibleRoster = input.excludeModelSignature === undefined ? this.memberRoster()
      : this.memberRoster().filter((member) => modelSignature(member) !== input.excludeModelSignature);
    const eligiblePreferred = eligibleRoster.some((member) => member.memberKey === preferred) ? preferred : undefined;
    const candidates = input.memberCandidates ?? creationFallbackChain(input.role, eligiblePreferred, eligibleRoster);
    for (const member of candidates) {
      this.ensureActive(input.ownerId, input.bookId, input.workflowId);
      const requestId = `${input.requestPrefix}:${member.memberKey}`;
      try {
        const result = await this.models.generate({
          requestId, ownerId: input.ownerId, bookId: input.bookId, workflowId: input.workflowId,
          runKind: input.runKind, nodeKey: input.nodeKey, workstationKey: input.workstationKey,
          member, purpose: input.purpose,
          operationMode: input.operationMode,
          basedOnTaskId: input.basedOnTaskId,
          authorInstructionVersion: input.authorInstructionVersion,
          sourceTraces: input.sourceTraces,
          ...(input.acknowledgedUnknownRequestId === undefined
            ? {}
            : { acknowledgedUnknownRequestId: input.acknowledgedUnknownRequestId }),
          prompt: input.prompt, maxOutputTokens: input.maxOutputTokens, temperature: input.temperature
        });
        this.ensureActive(input.ownerId, input.bookId, input.workflowId);
        return { output: result.output, requestId, member };
      } catch (error) {
        if (error instanceof V7CreationModelError && error.outcomeUnknown) throw error;
        failures.push(publicFailure(error));
      }
    }
    throw new DomainError(errorCodes.agentCapabilityUnavailable, `对不起，这次没有完成。${failures.at(-1) ?? '成员均未交回可用结果。'}`, {}, true, 503);
  }

  private view(run: V7CreationWorkflowRow): V7CreationWorkflowView {
    const kind: OptionKind = run.chain_scope_id !== null && !['volume_options', 'volume_decision', 'volume_tree_confirmation'].includes(run.stage)
      ? 'chain'
      : 'volume';
    const options = this.repository.options(run.owner_id, run.book_id, run.workflow_id, kind);
    const review = this.repository.optionReview(run.owner_id, run.book_id, run.workflow_id, kind);
    const outline = run.chain_scope_id === null ? undefined : this.repository.latestOutline(run.owner_id, run.book_id, run.chain_scope_id);
    const outlineDrafts = run.chain_scope_id === null ? [] : this.repository.outlineDraftCandidates(
      run.owner_id, run.book_id, run.workflow_id, run.chain_scope_id
    );
    const checkpoint = json(run.checkpoint_json) as {
      manuscriptVersionId?: unknown; optionRevision?: unknown; expectedOutlineCount?: unknown;
    };
    const currentOptionRevision = optionRevisionFeedback(checkpoint.optionRevision);
    const manuscriptId = typeof checkpoint.manuscriptVersionId === 'string' ? checkpoint.manuscriptVersionId : null;
    const manuscript = manuscriptId === null ? undefined : this.repository.manuscript(run.owner_id, run.book_id, manuscriptId);
    const manuscriptReview = manuscript === undefined ? undefined : this.repository.manuscriptReview(run.owner_id, run.book_id, manuscript.manuscript_version_id);
    const sequenceContent = outline === undefined
      ? outlineDrafts[0] === undefined ? null : JSON.parse(outlineDrafts[0].content_json) as V7ChapterSequence
      : JSON.parse(outline.content_json) as V7ChapterSequence;
    const finalManuscripts = outline === undefined ? [] : this.repository.finalManuscriptsForSequence(run.owner_id, run.book_id, outline.sequence_id);
    const completedNumbers = new Set(finalManuscripts.map((item) => item.chapter_number));
    const nextChapter = sequenceContent?.chapters.find((chapter) => !completedNumbers.has(chapter.chapterNumber))?.chapterNumber ?? null;
    const totalChapters = sequenceContent?.chapters.length ?? 0;
    const calls = this.repository.modelCallsForWorkflow(run.owner_id, run.book_id, run.workflow_id);
    const actors = actorViews([
      ...calls,
      ...this.repository.maintenanceActorCalls(run.owner_id, run.book_id, run.workflow_id)
    ], run, this.memberRoster());
    const remainingChains = this.remainingChains(run);
    const managed = this.repository.managedRun(run.owner_id, run.book_id, run.workflow_id);
    const timing = workflowTiming(run, this.clock.now(), calls);
    return {
      workflowId: run.workflow_id,
      bookId: run.book_id,
      stage: run.stage,
      status: publicStatus(run.status),
      message: publicMessage(run),
      firstVolume: run.first_volume === 1,
      volumeScopeId: run.volume_scope_id,
      chainScopeId: run.chain_scope_id,
      completedOptions: options.length,
      expectedOptions: requestedCandidateCount(run),
      options: options.map((row) => {
        const option = JSON.parse(row.option_json) as V7VolumeOption | V7ChainOption;
        return {
          optionId: row.option_id, seat: seatName(row.seat_key), memberKey: row.member_key, memberName: memberName(row.member_snapshot_json),
          name: option.publicName, summary: option.publicSummary, designRationale: option.designRationale,
          readerExperience: option.readerExperience,
          coreConflict: option.coreConflict, protagonistChoice: option.protagonistChoice,
          priceAndChange: option.priceAndChange, payoff: option.payoff,
          strengths: option.strengths, risks: option.risks,
          steps: option.tree.root.children.map((node) => ({
            sequence: node.sequence,
            title: node.title,
            summary: node.story.summary,
            majorEvents: node.story.majorEvents,
            protagonistChange: node.story.protagonistChange,
            emotion: node.emotion.publicSummary,
            experience: node.experience.publicSummary,
            outcome: node.story.outcome,
            nextStep: node.story.nextStep,
            wordTarget: node.budget.wordTarget,
            chapterRange: node.budget.chapterRange
          }))
        };
      }),
      chiefReview: review === undefined || !validStoredOptionReview(review.review_json, options.map((option) => option.option_id)) ? null : (() => {
        const value = parseOptionReview(review.review_json, options.map((option) => option.option_id));
        return {
          memberKey: review.member_key, memberName: memberName(review.member_snapshot_json), summary: value.publicSummary,
          recommendedOptionId: value.recommendedOptionId, differences: value.differences,
          risks: value.risks, authorDecisions: value.authorDecisions
        };
      })(),
      optionRevision: currentOptionRevision,
      expectedOutlines: Number.isInteger(Number(checkpoint.expectedOutlineCount))
        ? Math.max(1, Math.min(3, Number(checkpoint.expectedOutlineCount)))
        : Math.max(1, outlineDrafts.length),
      outlines: outlineDrafts.length > 0
        ? outlineDrafts.map(outlineDraftView)
        : outline === undefined ? [] : [{
            candidateId: outline.sequence_id, seat: '方案一', status: outline.lifecycle,
            memberKey: outline.member_key, reviewerMemberKey: outline.review_member_key,
            review: outline.review_json === null ? null : JSON.parse(outline.review_json) as V7ChapterReview,
            content: JSON.parse(outline.content_json) as V7ChapterSequence
          }],
      outline: outline === undefined ? outlineDrafts[0] === undefined ? null : {
        sequenceId: outlineDrafts[0].candidate_id, revision: 0, status: outlineDrafts[0].lifecycle,
        memberKey: outlineDrafts[0].member_key,
        reviewerMemberKey: outlineDrafts[0].review_member_key,
        review: outlineDrafts[0].review_json === null ? null : JSON.parse(outlineDrafts[0].review_json) as V7ChapterReview,
        content: JSON.parse(outlineDrafts[0].content_json) as V7ChapterSequence
      } : {
        sequenceId: outline.sequence_id, revision: outline.revision, status: outline.lifecycle,
        memberKey: outline.member_key,
        reviewerMemberKey: outline.review_member_key,
        review: outline.review_json === null ? null : JSON.parse(outline.review_json) as V7ChapterReview,
        content: JSON.parse(outline.content_json) as V7ChapterSequence
      },
      manuscript: manuscript === undefined ? null : {
        manuscriptVersionId: manuscript.manuscript_version_id, chapterNumber: manuscript.chapter_number,
        revision: manuscript.revision, status: manuscript.lifecycle, memberKey: manuscript.member_key,
        reviewerMemberKey: manuscriptReview?.member_key ?? null, content: manuscript.content_text,
        review: manuscriptReview === undefined ? null : JSON.parse(manuscriptReview.review_json) as V7ChapterReview
      },
      progress: {
        completedChapters: finalManuscripts.length,
        totalChapters,
        percent: totalChapters === 0 ? 0 : Math.min(100, Math.round((finalManuscripts.length / totalChapters) * 100)),
        nextChapterNumber: nextChapter
      },
      remainingChains,
      volumeComplete: run.status === 'completed' && remainingChains.length === 0,
      actors,
      execution: managed === undefined ? {
        mode: 'manual', status: 'inactive', writerMemberKey: null, reviewerMemberKey: null, errorMessage: null
      } : {
        mode: managed.mode,
        status: managed.status,
        writerMemberKey: managed.writer_member_key,
        reviewerMemberKey: managed.reviewer_member_key,
        errorMessage: managed.error_message
      },
      timing,
      errorMessage: run.error_message
    };
  }

  private requireWorkflow(ownerId: string, bookId: string, workflowId: string): V7CreationWorkflowRow {
    const run = this.repository.workflow(ownerId, bookId, workflowId);
    if (run === undefined) throw missing('创作任务不存在或不属于本书。');
    return run;
  }

  private ensureActive(ownerId: string, bookId: string, workflowId: string): void {
    const run = this.requireWorkflow(ownerId, bookId, workflowId);
    if (run.status === 'cancelled') throw conflict('任务已经停止，已完成的内容仍然保留。');
  }

  private savePreferredMember(
    ownerId: string,
    bookId: string,
    workflowId: string,
    roleKey: V7CreationMemberDefinition['roleKey'],
    rawMemberKey: unknown
  ): void {
    if (rawMemberKey === undefined || rawMemberKey === null || rawMemberKey === '') return;
    const memberKey = key(rawMemberKey, '成员编号');
    const member = this.memberRoster().find((item) => item.memberKey === memberKey && item.roleKey === roleKey && item.enabledByDefault);
    if (member === undefined) throw conflict('这位成员不负责当前岗位或正在请假。');
    this.repository.saveMemberPreference({ ownerId, bookId, workflowId, roleKey, memberKey, now: this.now() });
  }

  private saveMemberPreferences(ownerId: string, bookId: string, workflowId: string, raw: unknown): void {
    if (raw === undefined || raw === null) return;
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new DomainError(errorCodes.validation, '成员选择无效。');
    for (const [rawSelection, rawMember] of Object.entries(raw as Record<string, unknown>)) {
      const selection = creationSelectionKey(rawSelection);
      if (isOptionSeatKey(selection)) {
        if (rawMember === undefined || rawMember === null || rawMember === '') continue;
        const memberKey = key(rawMember, '成员编号');
        const member = this.memberRoster().find((item) => item.memberKey === memberKey && item.roleKey === 'planning_writer' && item.enabledByDefault);
        if (member === undefined) throw conflict('这位成员不负责策划编剧岗位或正在请假。');
        this.repository.saveOptionMemberPreference({ ownerId, bookId, workflowId, optionSeatKey: selection, memberKey, now: this.now() });
      } else {
        this.savePreferredMember(ownerId, bookId, workflowId, selection, rawMember);
      }
    }
  }

  private assertDistinctPlanningPreferences(raw: unknown): void {
    if (raw === undefined || raw === null) return;
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new DomainError(errorCodes.validation, '成员选择无效。');
    const memberKeys: string[] = [];
    for (const [rawSelection, rawMember] of Object.entries(raw as Record<string, unknown>)) {
      if (!isOptionSeatKey(rawSelection) || rawMember === undefined || rawMember === null || rawMember === '') continue;
      const memberKey = key(rawMember, '成员编号');
      const member = this.memberRoster().find((item) => item.memberKey === memberKey && item.roleKey === 'planning_writer' && item.enabledByDefault);
      if (member === undefined) throw conflict('这位成员不负责当前岗位或正在请假。');
      memberKeys.push(member.memberKey);
    }
    if (new Set(memberKeys).size !== memberKeys.length) throw conflict('多套方案需要由不同成员完成，请不要重复选择同一位成员。');
  }

  private outlineCandidateMembers(raw: unknown, count: 1 | 2 | 3): V7CreationMemberDefinition[] {
    const requestedKeys = raw === undefined || raw === null
      ? []
      : Array.isArray(raw)
        ? raw.map((value) => key(value, '章纲成员编号'))
        : [key(raw, '章纲成员编号')];
    if (requestedKeys.length > count) throw conflict(`本轮只设计${count}套章纲，请不要多选成员。`);
    if (new Set(requestedKeys).size !== requestedKeys.length) throw conflict('多套章纲需要由不同成员完成。');
    const available = creationFallbackChain('planning_writer', undefined, this.memberRoster());
    const selected = requestedKeys.map((memberKey) => {
      const member = available.find((candidate) => candidate.memberKey === memberKey);
      if (member === undefined) throw conflict('这位成员不负责章纲或正在请假。');
      return member;
    });
    for (const member of available) {
      if (selected.length >= count) break;
      if (!selected.some((candidate) => candidate.memberKey === member.memberKey)) selected.push(member);
    }
    if (selected.length < count) throw conflict('当前没有足够的不同强模型成员完成章纲，请减少方案数量或稍后重试。');
    return selected;
  }

  private optionMemberCandidates(run: V7CreationWorkflowRow, seat: OptionSeatKey): V7CreationMemberDefinition[] {
    const preferred = this.repository.optionMemberPreference(run.owner_id, run.book_id, run.workflow_id, seat)?.member_key;
    return creationFallbackChain('planning_writer', preferred, this.memberRoster());
  }

  private distinctInitialAssignments(
    run: V7CreationWorkflowRow,
    seats: readonly OptionSeatKey[],
    existing: readonly V7CreationOptionRow[]
  ): Map<OptionSeatKey, V7CreationMemberDefinition> {
    const assignments = new Map<OptionSeatKey, V7CreationMemberDefinition>();
    const usedMemberKeys = new Set(existing.map((item) => item.member_key));
    const usedModels = new Set(existing.map((item) => memberModelSignature(item.member_snapshot_json)).filter((value): value is string => value !== null));
    for (const seat of seats) {
      const candidates = this.optionMemberCandidates(run, seat).filter((member) => !usedMemberKeys.has(member.memberKey));
      const selected = candidates.find((member) => {
        const signature = modelSignature(member);
        return signature !== undefined && !usedModels.has(signature);
      }) ?? candidates[0];
      if (selected === undefined) throw conflict('当前没有足够的不同规划成员完成本轮，请减少方案数量或稍后重试。');
      assignments.set(seat, selected);
      usedMemberKeys.add(selected.memberKey);
      const selectedSignature = modelSignature(selected);
      if (selectedSignature !== undefined) usedModels.add(selectedSignature);
    }
    return assignments;
  }

  private requireConfirmedTree(ownerId: string, bookId: string, treeKind: 'book' | 'volume' | 'chain', scopeId: string): ConfirmedTreeRecord {
    const row = this.planning.confirmedTree(ownerId, bookId, treeKind, scopeId) as unknown as ConfirmedTreeRecord | undefined;
    if (row === undefined) throw conflict(treeKind === 'book' ? '请先确认全书方向树。' : treeKind === 'volume' ? '请先确认本卷方向树。' : '请先确认当前单元链。');
    return row;
  }

  private remainingChains(run: V7CreationWorkflowRow): Array<{ scopeId: string; title: string; summary: string }> {
    let volumeTree: ConfirmedTreeRecord;
    try { volumeTree = this.requireConfirmedTree(run.owner_id, run.book_id, 'volume', run.volume_scope_id); }
    catch { return []; }
    const started = new Set(this.repository.workflowsForVolume(run.owner_id, run.book_id, run.volume_scope_id)
      .filter((item) => item.status !== 'cancelled')
      .map((item) => item.chain_scope_id)
      .filter((value): value is string => value !== null));
    return linkedTrees(volumeTree, 'chain').filter((item) => !started.has(item.scopeId));
  }

  private now(): string { return this.clock.now().toISOString(); }
}

function workflowTiming(
  run: V7CreationWorkflowRow,
  now: Date,
  calls: readonly V7CreationModelCallRow[]
): V7CreationWorkflowView['timing'] {
  const activeCall = calls.filter((call) => call.state === 'working').at(-1);
  const stageStartedAt = activeCall?.started_at ?? (run.status === 'queued' || run.status === 'working' ? run.updated_at : run.created_at);
  const created = Date.parse(stageStartedAt);
  // A workflow may span several chapters, so its row can be much older than the
  // model call that is actually visible to the author.  Use the active call as
  // the activity clock; otherwise a brand-new review is immediately reported as
  // overdue merely because the surrounding chain started earlier.
  const lastActivityAt = activeCall?.updated_at ?? activeCall?.started_at ?? run.updated_at;
  const updated = Date.parse(lastActivityAt);
  const current = now.getTime();
  const elapsedSeconds = Number.isFinite(created) ? Math.max(0, Math.floor((current - created) / 1_000)) : 0;
  const idleSeconds = Number.isFinite(updated) ? Math.max(0, Math.floor((current - updated) / 1_000)) : 0;
  const active = run.status === 'queued' || run.status === 'working';
  return {
    createdAt: run.created_at,
    lastActivityAt,
    elapsedSeconds,
    idleSeconds,
    state: !active || idleSeconds < 300 ? 'normal' : idleSeconds < 900 ? 'slow' : 'overdue'
  };
}

function modelSignature(member: V7CreationMemberDefinition | undefined): string | undefined {
  return member === undefined ? undefined : `${member.model.provider}:${member.model.modelId}:${member.model.plan}`;
}

interface ConfirmedTreeRecord {
  tree_version_id: string;
  tree_kind: 'book' | 'volume' | 'chain';
  scope_id: string;
  revision: number;
  content_json: string;
  content_hash: string;
}

function exactOutlineSource(sequence: { sequence_id: string; revision: number }, outline: V7ChapterOutline) {
  const contentHash = sha256(stableJson(outline));
  return {
    sourceKey: `formal:outline:${sequence.sequence_id}:${outline.chapterNumber}`,
    sourceKind: 'planning_tree' as const,
    sourceId: sequence.sequence_id,
    sourceVersion: String(sequence.revision),
    authority: 'formal' as const,
    label: `已确认第${outline.chapterNumber}章章纲`,
    content: outline,
    contentHash,
    required: true,
    includedReason: '这是作者已经确认、当前正文必须完成的章纲责任。'
  };
}

function explicitSourceTrace(
  ownerId: string,
  bookId: string,
  source: ReturnType<typeof exactOutlineSource>
): V7ContextSourceTrace {
  return {
    ownerId,
    bookId,
    sourceKey: source.sourceKey,
    sourceType: source.sourceKind,
    sourceId: source.sourceId,
    sourceVersion: source.sourceVersion,
    authority: 'confirmed',
    decision: 'included',
    reason: source.includedReason,
    contentHash: source.contentHash,
    estimatedTokens: Math.max(1, Math.ceil(Array.from(stableJson(source.content)).length / 2.5))
  };
}

function assertLinkedTree(row: ConfirmedTreeRecord, treeKind: 'volume' | 'chain', scopeId: string, message: string): void {
  const document = JSON.parse(row.content_json) as PlanningTreeDocument;
  const stack = [document.root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node.linkedTree?.treeKind === treeKind && node.linkedTree.scopeId === scopeId) return;
    stack.push(...node.children);
  }
  throw conflict(message);
}

function linkedTrees(row: ConfirmedTreeRecord, treeKind: 'volume' | 'chain'): Array<{ scopeId: string; title: string; summary: string }> {
  const document = JSON.parse(row.content_json) as PlanningTreeDocument;
  const result: Array<{ scopeId: string; title: string; summary: string }> = [];
  const stack = [document.root];
  while (stack.length > 0) {
    const node = stack.shift();
    if (node === undefined) break;
    if (node.linkedTree?.treeKind === treeKind) {
      result.push({ scopeId: node.linkedTree.scopeId, title: node.title, summary: node.story.summary });
    }
    stack.unshift(...node.children);
  }
  return result;
}

function assertCleanManuscript(value: string): void {
  const text = value.trim();
  if (Array.from(text).length < 500) throw new DomainError(errorCodes.validation, '正文过短，未达到可审阅标准。', {}, true, 409);
  if (['任务资料包', '以下是正文', '作为AI', '作为 AI', '章纲要求'].some((token) => text.includes(token))) {
    throw new DomainError(errorCodes.validation, '正文混入了创作过程说明，已停止保存。', {}, true, 409);
  }
}

function memberSnapshot(member: V7CreationMemberDefinition): unknown {
  return {
    memberKey: member.memberKey, displayName: member.displayName, roleKey: member.roleKey,
    provider: member.model.provider, modelId: member.model.modelId, plan: member.model.plan,
    fallbackPriority: member.fallbackPriority
  };
}

function memberName(snapshotJson: string): string {
  const value = JSON.parse(snapshotJson) as { displayName?: unknown };
  return typeof value.displayName === 'string' && value.displayName.length > 0 ? value.displayName : '编辑部成员';
}

function seatName(value: V7CreationOptionRow['seat_key']): '方案一' | '方案二' | '方案三' {
  return ({ structure: '方案一', commercial: '方案二', character: '方案三' } as const)[value];
}

function publicStatus(status: V7CreationWorkflowRow['status']): V7CreationWorkflowView['status'] {
  if (status === 'queued') return 'waiting';
  if (status === 'working') return 'working';
  if (status === 'awaiting_author') return 'waiting_for_you';
  if (status === 'completed') return 'completed';
  if (status === 'partially_failed') return 'partially_failed';
  if (status === 'cancelled') return 'cancelled';
  return 'failed';
}

function publicMessage(run: V7CreationWorkflowRow): string {
  if (run.status === 'awaiting_author') return run.error_message ?? '方案已经整理好，请您选一个继续。';
  if (run.status === 'completed') return '本轮工作已经完成。';
  if (run.status === 'cancelled') return run.error_message ?? '任务已经停止，已完成的内容仍然保留。';
  if (run.status === 'partially_failed') {
    return run.error_message ?? '对不起，这一章没有通过复核。正文和审校意见都已保留，您可以换成员重写这一章。';
  }
  if (run.status === 'failed' || run.status === 'unknown') return run.error_message ?? '对不起，这次没有完成，可以稍后继续。';
  if (run.stage === 'settlement') {
    const checkpoint = json(run.checkpoint_json) as { chainSettlement?: unknown; volumeSettlement?: unknown };
    if (checkpoint.volumeSettlement === 'pending' || checkpoint.volumeSettlement === 'working') {
      return '本卷正文已经安全定稿，编辑部正在汇总整卷实际结果。';
    }
    if (checkpoint.chainSettlement === 'pending' || checkpoint.chainSettlement === 'working') {
      return '本链正文已经安全定稿，编辑部正在汇总这条链的实际结果。';
    }
    return '正文已经安全定稿，编辑部正在整理本章实际变化。';
  }
  if (run.stage === 'manuscript') return '主笔正在写正文，请耐心等待。';
  return '编辑部正在加紧整理，完成后会请您决定。';
}

function actorViews(calls: V7CreationActorCallRow[], run: V7CreationWorkflowRow, roster: readonly V7CreationMemberDefinition[]): V7CreationWorkflowView['actors'] {
  const latestByMember = new Map<string, V7CreationActorCallRow>();
  for (const call of calls) latestByMember.set(call.member_key, call);
  if (latestByMember.size === 0) {
    const chief = roster.find((member) => member.roleKey === 'chief_editor' && member.defaultForRole)!;
    return [{
      memberKey: chief.memberKey,
      memberName: chief.displayName,
      role: roleName(chief.roleKey),
      status: run.status === 'failed' || run.status === 'unknown' ? 'failed' : 'waiting',
      message: run.status === 'failed' || run.status === 'unknown'
        ? '对不起，这次没有完成，您可以换一位成员继续。'
        : '资料已经收到，我会安排合适的成员接手。',
      emoji: run.status === 'failed' || run.status === 'unknown' ? '🙇' : '📚'
    }];
  }
  return [...latestByMember.values()].map((call) => {
    const member = roster.find((item) => item.memberKey === compatibleCreationMemberKey(call.member_key));
    const handedOver = call.state === 'failed' && calls.some((other) => other.node_key === call.node_key && other.started_at > call.started_at);
    const status = call.state === 'working'
      ? 'working'
      : call.state === 'succeeded'
        ? 'completed'
        : handedOver
          ? 'handed_over'
          : 'failed';
    return {
      memberKey: call.member_key,
      memberName: member?.displayName ?? '编辑部成员',
      role: member === undefined ? '编辑部成员' : roleName(member.roleKey),
      status,
      message: status === 'working'
        ? workingMessage(call.run_kind)
        : status === 'completed'
          ? '这部分已经完成，我把结果交给下一位同事啦。'
          : status === 'handed_over'
            ? '对不起，我这次没能完成，工作已经交给同事继续。'
            : '对不起，这次没有完成，您可以换一位成员继续。',
      emoji: status === 'working' ? '✍️' : status === 'completed' ? '✅' : status === 'handed_over' ? '🤝' : '🙇'
    };
  });
}

function workingMessage(kind: V7CreationModelCallRow['run_kind']): string {
  if (kind === 'context') return '我正在核对资料，很快把最有用的内容整理出来。';
  if (kind === 'option') return '我正在设计一条不同的故事方向，请稍等一下。';
  if (kind === 'option_review') return '几个方向我都在看，马上给您一份主编建议。';
  if (kind === 'outline') return '我正在把单元链拆成紧凑章纲，快整理好了。';
  if (kind === 'manuscript') return '我正在认真写这一章，写完马上交给审校。';
  if (kind === 'review') return '我正在逐段检查正文，避免人物和事实写偏。';
  return '我正在整理正文里真正发生的变化，请稍等。';
}

function roleName(role: V7CreationMemberDefinition['roleKey']): string {
  return ({
    context_editor: '资料编审',
    chief_editor: '主编',
    planning_writer: '策划编剧',
    outline_writer: '章纲编剧',
    lead_writer: '主笔',
    independent_reviewer: '审校',
    settlement_editor: '结算编审'
  } as const)[role];
}

function compatibleCreationMemberKey(memberKey: string): string {
  return ({
    'creation-outline-glm-5-3': 'planner-glm-5-3',
    'creation-outline-deepseek-v4-pro': 'planner-deepseek-v4-pro',
    'creation-outline-kimi-k3': 'planner-kimi-k3'
  } as Record<string, string>)[memberKey] ?? memberKey;
}

function memberModelSignature(snapshotJson: string): string | null {
  try {
    const value = JSON.parse(snapshotJson) as { provider?: unknown; modelId?: unknown; plan?: unknown };
    return typeof value.provider === 'string' && typeof value.modelId === 'string' && typeof value.plan === 'string'
      ? `${value.provider}:${value.modelId}:${value.plan}`
      : null;
  } catch {
    return null;
  }
}

function creationRole(value: unknown): V7CreationMemberDefinition['roleKey'] {
  // 旧客户端可能仍传 outline_writer，但新选择和新偏好只保存固定岗位。
  if (value === 'outline_writer') return 'planning_writer';
  const roles: V7CreationMemberDefinition['roleKey'][] = [
    'context_editor', 'chief_editor', 'planning_writer',
    'lead_writer', 'independent_reviewer', 'settlement_editor'
  ];
  if (typeof value === 'string' && roles.includes(value as V7CreationMemberDefinition['roleKey'])) {
    return value as V7CreationMemberDefinition['roleKey'];
  }
  throw new DomainError(errorCodes.validation, '成员岗位无效。');
}

function creationSelectionKey(value: unknown): CreationSelectionKey {
  return isOptionSeatKey(value) ? value : creationRole(value);
}

function isOptionSeatKey(value: unknown): value is OptionSeatKey {
  return value === 'option_1' || value === 'option_2' || value === 'option_3';
}

function legacyOptionSeat(value: OptionSeatKey): V7CreationOptionRow['seat_key'] {
  return ({ option_1: 'structure', option_2: 'commercial', option_3: 'character' } as const)[value];
}

function persistedOptionSeat(value: V7CreationOptionRow['seat_key']): OptionSeatKey {
  return ({ structure: 'option_1', commercial: 'option_2', character: 'option_3' } as const)[value];
}

function planningCandidateCount(value: unknown): 1 | 2 | 3 {
  if (value === undefined || value === null || value === '') return 1;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 3) {
    throw new DomainError(errorCodes.validation, '方案数量应为1到3套。');
  }
  return number as 1 | 2 | 3;
}

function outlineDraftView(row: V7ChapterOutlineDraftCandidateRow): V7CreationWorkflowView['outlines'][number] {
  return {
    candidateId: row.candidate_id,
    seat: row.seat_key === 'option_1' ? '方案一' : row.seat_key === 'option_2' ? '方案二' : '方案三',
    status: row.lifecycle,
    memberKey: row.member_key,
    reviewerMemberKey: row.review_member_key,
    review: row.review_json === null ? null : JSON.parse(row.review_json) as V7ChapterReview,
    content: JSON.parse(row.content_json) as V7ChapterSequence
  };
}

function requestedCandidateCount(run: V7CreationWorkflowRow): 1 | 2 | 3 {
  try {
    const checkpoint = json(run.checkpoint_json) as { requestedCandidateCount?: unknown };
    const count = Number(checkpoint.requestedCandidateCount);
    if (Number.isInteger(count) && count >= 1 && count <= 3) return count as 1 | 2 | 3;
  } catch {
    // Historical workflows were always three-plan tasks. Preserve that fact
    // when their old checkpoint has no explicit count.
  }
  return 3;
}

function latestRun(runs: readonly V7CreationWorkflowRow[]): V7CreationWorkflowRow {
  if (runs.length === 0) throw new Error('创作目录缺少任务记录');
  return runs.reduce((latest, run) => run.updated_at > latest.updated_at ? run : latest, runs[0]!);
}

function preferredManuscripts(rows: readonly V7ManuscriptVersionRow[]): Map<number, V7ManuscriptVersionRow> {
  const chosen = new Map<number, V7ManuscriptVersionRow>();
  const lifecycleWeight = { draft: 1, reviewed: 2, final: 3 } as const;
  for (const row of rows) {
    const current = chosen.get(row.chapter_number);
    if (current === undefined
      || lifecycleWeight[row.lifecycle] > lifecycleWeight[current.lifecycle]
      || (lifecycleWeight[row.lifecycle] === lifecycleWeight[current.lifecycle] && row.revision > current.revision)) {
      chosen.set(row.chapter_number, row);
    }
  }
  return chosen;
}

function optionKind(value: unknown): OptionKind {
  if (value === 'volume' || value === 'chain') return value;
  throw new DomainError(errorCodes.validation, '方案类型无效。');
}

function key(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/u.test(value)) throw new DomainError(errorCodes.validation, `${label}无效。`);
  return value;
}

function optionalKey(value: unknown, label: string): string | null {
  return value === undefined || value === null || value === '' ? null : key(value, label);
}

function actionKey(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw new DomainError(errorCodes.validation, '操作编号无效。');
  return value;
}

function optionalText(value: unknown, label: string, maximum: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || Array.from(value.trim()).length > maximum) throw new DomainError(errorCodes.validation, `${label}最多${maximum}字。`);
  return value.trim() || null;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new DomainError(errorCodes.validation, `${label}无效。`);
  return Number(value);
}

function rangedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  const number = positiveInteger(value, label);
  if (number < minimum || number > maximum) throw new DomainError(errorCodes.validation, `${label}应在${minimum}到${maximum}之间。`);
  return number;
}

function json(value: string): unknown { return JSON.parse(value) as unknown; }

function validStoredOptionReview(reviewJson: string, optionIds: readonly string[]): boolean {
  try {
    parseOptionReview(reviewJson, optionIds);
    return true;
  } catch {
    return false;
  }
}

function optionRevisionFeedback(value: unknown): OptionRevisionFeedback | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.memberKey !== 'string' || typeof record.memberName !== 'string'
    || typeof record.publicSummary !== 'string' || !Array.isArray(record.risks)
    || !Array.isArray(record.authorDecisions)
    || record.risks.some((item) => typeof item !== 'string')
    || record.authorDecisions.some((item) => typeof item !== 'string')) return null;
  return {
    memberKey: record.memberKey,
    memberName: record.memberName,
    publicSummary: record.publicSummary,
    risks: record.risks as string[],
    authorDecisions: record.authorDecisions as string[]
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function conflict(message: string): DomainError { return new DomainError(errorCodes.validation, message, {}, false, 409); }
function missing(message: string): DomainError { return new DomainError(errorCodes.validation, message, {}, false, 404); }
function publicFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 240 ? `${message.slice(0, 237)}…` : message;
}
