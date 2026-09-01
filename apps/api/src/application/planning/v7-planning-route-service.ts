import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  V7_CREATION_MEMBERS,
  V7_PLANNING_MEMBERS,
  buildPlanningFallbackChain,
  creationFallbackChain,
  fullCasePlanningSeat,
  extractPlanningCriticalInputs,
  materializePlanningRecipe,
  parsePlanningMethodSearchRequest,
  parsePlanningRouteFusion,
  parsePlanningRouteReview,
  parseStoredProgressivePlanningBrief,
  planningMethodSearchPrompt,
  planningRouteFusionPrompt,
  planningRouteReviewPrompt,
  planningDirectStoryRoutePrompt,
  planningDirectStoryRouteRepairPrompt,
  retrievePlanningMethodCandidates,
  validateProgressivePlanningBriefCandidates,
  validatePlanningEditorialRoster,
  type LayeredPlanningRecipe,
  type V7CreationMemberDefinition,
  type V7PlanningMemberDefinition,
  type V7PlanningMethodCandidate,
  type V7PlanningMethodSearchRequest,
  type V7ProgressivePlanningBrief,
  type V7PlanningRouteReview,
  type V7PlanningStoryRoute
} from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import {
  V7PlanningRuntimeRepository,
  type V7PlanningMethodSearchRow,
  type V7PlanningRecipeProposalRow,
  type V7PlanningRecipeRunRow,
  type V7PlanningRouteCandidateRow
} from '../../infrastructure/db/repositories/v7-planning-runtime-repository.js';
import {
  V7PlanningModelError,
  V7PlanningModelGateway,
  type V7PlanningModelAdapterResolver
} from '../../infrastructure/models/v7-planning-model-gateway.js';
import {
  V7PlanningSourceCompiler,
  planningSnapshotSourceTraces,
  requirePlanningScaleProfile,
  type V7PlanningScaleProfile,
  type V7PlanningCompiledSnapshot
} from './v7-planning-source-compiler.js';
import {
  resolveFrozenCreationMembers,
  resolveFrozenPlanningMembers
} from './v7-planning-task-roster-snapshot.js';

type MethodSeat = 'chief_editor' | 'structure_deputy' | 'commercial_deputy';
type RouteDecisionKind = 'select' | 'adjust' | 'merge';

export interface V7PlanningRouteRunView {
  runId: string;
  status: 'waiting' | 'working' | 'waiting_for_you' | 'completed' | 'failed';
  phase: 'preparing' | 'choosing_methods' | 'designing_routes' | 'chief_review' | 'waiting_for_you' | 'completed' | 'failed';
  message: string;
  progress: { completed: number; total: number; percent: number };
  actors: Array<{
    memberKey: string;
    memberName: string;
    role: string;
    status: 'working' | 'completed' | 'waiting' | 'failed';
    message: string;
    emoji: string;
  }>;
  routes: Array<{
    routeId: string;
    memberKey: string;
    memberName: string;
    title: string;
    oneLinePromise: string;
    summary: string;
    designRationale: string;
    readingExperience: string;
    protagonistJourney: string;
    targetWords: number;
    targetVolumes: number;
    commercialAudience: string;
    retentionPositioning: string;
    volumes: V7PlanningStoryRoute['volumeRoadmap'];
    firstVolumeFocus: string[];
    sellingPoints: string[];
    risks: string[];
    openQuestions: string[];
  }>;
  chiefReview: null | {
    memberKey: string;
    memberName: string;
    summary: string;
    recommendedRouteId: string;
    routeReviews: V7PlanningRouteReview['routeReviews'];
    commonRisks: string[];
    authorDecisions: string[];
  };
  sourceIssues: string[];
  expectedRoutes: number;
  canDecide: boolean;
  canContinueTree: boolean;
  nextStepPending: boolean;
  errorMessage: string | null;
  timing: {
    createdAt: string;
    lastActivityAt: string;
    elapsedSeconds: number;
    idleSeconds: number;
    state: 'normal' | 'slow' | 'overdue';
  };
}

export interface V7PlanningTaskView {
  taskId: string;
  taskKind: 'planning_route' | 'planning_tree';
  ownerId: string;
  bookId: string;
  bookTitle: string;
  status: 'waiting' | 'working' | 'waiting_for_you' | 'completed' | 'failed' | 'cancelled';
  message: string;
  progress: number;
  memberKey: string | null;
  memberName: string | null;
  treeKind: 'book' | 'volume' | 'chain' | null;
  scopeId: string | null;
  modelCalls: number;
  actionable: boolean;
  canStop: boolean;
  updatedAt: string;
}

type PlanningMemberSource = readonly V7PlanningMemberDefinition[] | (() => readonly V7PlanningMemberDefinition[]);
type ContextMemberSource = readonly V7CreationMemberDefinition[] | (() => readonly V7CreationMemberDefinition[]);
type StoredPlanningMember = {
  memberKey: string;
  displayName: string;
  roleKey: string;
  provider?: string;
  modelId?: string;
  plan?: string;
  fallbackPriority?: number;
};

type StoredRouteRoster = {
  workflowStyle: 'three-chief-direct-v1' | 'read-only';
  directChiefs: StoredPlanningMember[];
  directFallbacks: StoredPlanningMember[];
  routeReviewers: StoredPlanningMember[];
  routeFusionEditors: StoredPlanningMember[];
  contextEditors: StoredPlanningMember[];
  methodSeats: Array<{ seatKey: string; fallback: StoredPlanningMember[] }>;
  routeWriters: StoredPlanningMember[];
};

type ExecutableRouteRoster = {
  directChiefs: V7PlanningMemberDefinition[];
  directFallbacks: V7PlanningMemberDefinition[];
  routeReviewers: V7PlanningMemberDefinition[];
  routeFusionEditors: V7PlanningMemberDefinition[];
  contextEditors: V7CreationMemberDefinition[];
};

const READ_ONLY_ROUTE_MESSAGE = '对不起，这项全书路线不能继续执行。已有结果保留，请按当前流程重新设计。';

export class V7PlanningRouteService {
  private readonly repository: V7PlanningRuntimeRepository;
  private readonly sources: V7PlanningSourceCompiler;
  private readonly models: V7PlanningModelGateway;
  private readonly activeRuns = new Set<string>();

  public constructor(
    database: DatabaseSync,
    adapters: V7PlanningModelAdapterResolver,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly memberSource: PlanningMemberSource = V7_PLANNING_MEMBERS,
    private readonly contextMemberSource: ContextMemberSource = V7_CREATION_MEMBERS
  ) {
    this.repository = new V7PlanningRuntimeRepository(database);
    this.sources = new V7PlanningSourceCompiler(database, ids, clock);
    this.models = new V7PlanningModelGateway(database, adapters, clock);
    this.members();
    this.contextMembers();
  }

  public create(ownerId: string, bookId: string, input: {
    authorGoal?: unknown;
    candidateCount?: unknown;
    memberKeys?: unknown;
    idempotencyKey?: unknown;
  }): V7PlanningRouteRunView {
    const idempotencyKey = actionKey(input.idempotencyKey);
    const authorGoal = optionalText(input.authorGoal, '本次规划想法', 2_000);
    const candidateCount = routeCandidateCount(input.candidateCount);
    const snapshot = this.sources.compile({
      ownerId, bookId, treeKind: 'book', scopeId: bookId, purpose: 'recipe_design',
      ...(authorGoal === null ? {} : { authorGoal })
    });
    const selectedChiefs = selectedPlanningChiefs(input.memberKeys, candidateCount, this.members());
    const frozenChiefFallbacks = buildPlanningFallbackChain('chief_editor', { members: this.members() });
    const frozenContextEditors = creationFallbackChain('context_editor', undefined, this.contextMembers());
    const requestHash = sha256(stableJson({
      workflow: 'story-routes-v3-on-demand', snapshotId: snapshot.snapshotId, authorGoal,
      candidateCount, memberKeys: selectedChiefs.map((member) => member.memberKey)
    }));
    const existing = this.repository.recipeRunByKey(ownerId, bookId, idempotencyKey);
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash) throw conflict('本次操作编号已经用于另一份规划，请重新操作。');
      this.start(existing);
      return this.view(existing);
    }
    const run = this.repository.createRecipeRun({
      runId: this.ids.next(), ownerId, bookId, snapshotId: snapshot.snapshotId,
      idempotencyKey, requestHash,
      roster: {
        workflowStyle: 'three-chief-direct-v1',
        directChiefs: selectedChiefs.map(memberSnapshot),
        directFallbacks: frozenChiefFallbacks.map(memberSnapshot),
        routeReviewers: frozenChiefFallbacks.map(memberSnapshot),
        routeFusionEditors: frozenChiefFallbacks.map(memberSnapshot),
        contextEditors: frozenContextEditors.map(memberSnapshot)
      },
      now: this.clock.now().toISOString()
    });
    this.start(run);
    return this.view(run);
  }

  public get(ownerId: string, bookId: string, runId: string): V7PlanningRouteRunView {
    const run = this.requireRun(ownerId, bookId, runId);
    this.start(run);
    return this.view(this.requireRun(ownerId, bookId, runId));
  }

  public latest(ownerId: string, bookId: string): V7PlanningRouteRunView | null {
    const run = this.repository.latestPlanningRouteRun(ownerId, bookId);
    if (run === undefined) return null;
    this.start(run);
    return this.view(this.requireRun(ownerId, bookId, run.run_id));
  }

  public publicMembers(): Array<{
    memberKey: string; name: string; roleKey: V7PlanningMemberDefinition['roleKey']; role: string; defaultForRole: boolean;
  }> {
    return this.members().filter((member) => member.enabledByDefault && (
      member.roleKey === 'planning_writer' || member.roleKey === 'chief_editor'
    )).map((member) => ({
      memberKey: member.memberKey,
      name: member.displayName,
      roleKey: member.roleKey,
      role: planningRoleName(member.roleKey),
      defaultForRole: member.defaultForRole
    }));
  }

  public listTasks(ownerId: string, limit = 50): V7PlanningTaskView[] {
    return this.taskViews(this.repository.planningRouteTasks(ownerId, Math.max(1, Math.min(100, limit))));
  }

  public adminTasks(limit = 100): V7PlanningTaskView[] {
    return this.taskViews(this.repository.adminPlanningRouteTasks(Math.max(1, Math.min(200, limit))));
  }

  private taskViews(runs: ReturnType<V7PlanningRuntimeRepository['planningRouteTasks']>): V7PlanningTaskView[] {
    const latestByScope = new Map<string, string | null>();
    for (const run of runs) {
      const scopeKey = `${run.owner_id}:${run.book_id}:planning_route`;
      if (!latestByScope.has(scopeKey)) latestByScope.set(
        scopeKey,
        this.repository.latestPlanningRouteRun(run.owner_id, run.book_id)?.run_id ?? null
      );
    }
    return runs.map((run) => {
      const view = this.view(run);
      const active = view.actors.find((actor) => actor.status === 'working') ?? view.actors[0];
      const actionable = latestByScope.get(`${run.owner_id}:${run.book_id}:planning_route`) === run.run_id;
      return {
        taskId: run.run_id, taskKind: 'planning_route', ownerId: run.owner_id, bookId: run.book_id, bookTitle: run.book_title,
        status: run.status === 'cancelled' ? 'cancelled' : view.status,
        message: view.message, progress: view.progress.percent,
        memberKey: active?.memberKey ?? null, memberName: active?.memberName ?? null,
        treeKind: null, scopeId: null, modelCalls: run.model_calls,
        actionable,
        canStop: actionable && (view.status === 'waiting' || view.status === 'working'), updatedAt: run.updated_at
      };
    });
  }

  public cancel(ownerId: string, bookId: string, runId: string): V7PlanningRouteRunView {
    const run = this.requireRun(ownerId, bookId, runId);
    this.requireExecutableRoster(run);
    const cancelled = this.repository.cancelRecipeRun(ownerId, bookId, run.run_id, this.clock.now().toISOString());
    return this.view(cancelled);
  }

  public retryMissing(ownerId: string, bookId: string, runId: string): V7PlanningRouteRunView {
    const run = this.requireRun(ownerId, bookId, runId);
    const frozenRoster = this.requireExecutableRoster(run);
    if (checkpointSourceIssues(run.checkpoint_json).length > 0) {
      throw conflict('请先统一主编指出的正式资料，再重新设计全书路线。');
    }
    const expected = frozenRoster.directChiefs.length;
    const completed = this.repository.routeCandidates(ownerId, bookId, runId).length;
    const comparisonReady = expected === 1 || this.repository.routeReview(ownerId, bookId, runId) !== undefined;
    if (completed >= expected && comparisonReady) throw conflict('本轮路线已经可以选择，不需要补做。');
    if (run.status === 'cancelled' || run.status === 'completed') throw conflict('这项任务已经结束。');
    if (this.repository.modelCallsForRun(ownerId, bookId, runId)
      .some((call) => call.state === 'unknown' || call.state === 'working')) {
      throw conflict('这次结果还没有确认，为避免重复扣量不能补做。请先刷新查看结果。');
    }
    const updated = this.repository.retryRecipeRun(ownerId, bookId, runId, this.clock.now().toISOString());
    if (updated === undefined) throw conflict('任务状态已经变化，请刷新后重试。');
    this.start(updated);
    return this.view(updated);
  }

  public async decide(ownerId: string, bookId: string, runId: string, input: {
    mode?: unknown; routeIds?: unknown; authorNote?: unknown; idempotencyKey?: unknown;
  }): Promise<{ routeVersionId: string; recipeVersionId: string; status: 'confirmed'; nextStep: 'book_tree' }> {
    const mode = decisionKind(input.mode);
    const routeIds = routeIdList(input.routeIds, mode);
    const authorNote = optionalText(input.authorNote, '作者调整意见', 2_000) ?? '';
    if (mode !== 'select' && authorNote.length === 0) throw validation('请先写下需要调整或融合的方向。');
    const idempotencyKey = actionKey(input.idempotencyKey);
    const run = this.requireRun(ownerId, bookId, runId);
    const frozenRoster = this.requireExecutableRoster(run);
    const prior = this.repository.routeDecisionByKey(ownerId, bookId, idempotencyKey);
    if (prior !== undefined) {
      if (prior.run_id !== runId || prior.decision_kind !== mode || prior.author_note !== authorNote
        || stableJson(JSON.parse(prior.source_route_ids_json)) !== stableJson(routeIds)) {
        throw conflict('本次操作编号已经用于另一项路线决定，请重新操作。');
      }
      return { routeVersionId: prior.route_version_id, recipeVersionId: prior.recipe_version_id, status: 'confirmed', nextStep: 'book_tree' };
    }
    if (run.status !== 'awaiting_author') throw conflict('故事路线还没有准备好。');
    const routeRows = this.repository.routeCandidates(ownerId, bookId, runId);
    const selected = routeIds.map((routeId) => {
      const row = routeRows.find((candidate) => candidate.route_id === routeId);
      if (row === undefined) throw validation('所选故事路线不存在或不属于本次任务。');
      return row;
    });
    const proposals = this.repository.recipeProposals(ownerId, bookId, runId);
    let finalRoute: V7PlanningStoryRoute;
    let finalRecipe: LayeredPlanningRecipe;
    let createdBy: string;
    if (mode === 'select') {
      const route = selected[0]!;
      const proposal = requireProposal(proposals, route.recipe_proposal_id);
      finalRoute = JSON.parse(route.route_json) as V7PlanningStoryRoute;
      const brief = parseStoredProgressivePlanningBrief(JSON.parse(proposal.proposal_json), proposal.seat_key as MethodSeat);
      finalRecipe = materializePlanningRecipe({
        brief,
        route: finalRoute,
        recipeId: `${run.run_id}:author-final`,
        status: 'accepted'
      });
      createdBy = route.member_key;
    } else {
      const fused = await this.fuse(
        run,
        selected,
        proposals,
        mode,
        authorNote,
        idempotencyKey,
        frozenRoster.routeFusionEditors
      );
      finalRoute = fused.route;
      finalRecipe = materializePlanningRecipe({
        brief: fused.brief,
        route: finalRoute,
        recipeId: `${run.run_id}:author-final`,
        status: 'accepted'
      });
      createdBy = fused.memberKey;
    }
    const result = this.repository.confirmPlanningRoute({
      decisionId: this.ids.next(), routeVersionId: this.ids.next(), recipeVersionId: this.ids.next(),
      ownerId, bookId, runId, idempotencyKey, decisionKind: mode, authorNote,
      sourceRouteIds: routeIds, route: finalRoute, routeHash: sha256(stableJson(finalRoute)),
      recipe: finalRecipe, recipeHash: sha256(stableJson(finalRecipe)), sourceSnapshotId: run.snapshot_id,
      sourceProposalIds: selected.map((row) => row.recipe_proposal_id), createdBy, now: this.clock.now().toISOString()
    });
    return {
      routeVersionId: result.route.route_version_id,
      recipeVersionId: result.recipe.recipe_version_id,
      status: 'confirmed',
      nextStep: 'book_tree'
    };
  }

  public admin(ownerId: string, bookId: string, runId: string): unknown {
    const run = this.requireRun(ownerId, bookId, runId);
    const searches = this.repository.methodSearches(ownerId, bookId, runId);
    const proposals = this.repository.recipeProposals(ownerId, bookId, runId);
    const routes = this.repository.routeCandidates(ownerId, bookId, runId);
    const review = this.repository.routeReview(ownerId, bookId, runId);
    return {
      run: { ...run, roster: JSON.parse(run.roster_json), checkpoint: JSON.parse(run.checkpoint_json) },
      snapshot: this.sources.require(ownerId, bookId, run.snapshot_id),
      methodSearches: searches.map((row) => ({
        ...row, memberSnapshot: JSON.parse(row.member_snapshot_json),
        request: JSON.parse(row.search_request_json), candidates: JSON.parse(row.candidate_methods_json)
      })),
      methodProposals: proposals.map((row) => ({ ...row, proposal: JSON.parse(row.proposal_json) })),
      storyRoutes: routes.map((row) => ({ ...row, memberSnapshot: JSON.parse(row.member_snapshot_json), route: JSON.parse(row.route_json) })),
      chiefReview: review === undefined ? null : { ...review, memberSnapshot: JSON.parse(review.member_snapshot_json), review: JSON.parse(review.review_json) },
      modelCalls: this.repository.modelCallsForRun(ownerId, bookId, runId)
    };
  }

  private requireExecutableRoster(run: V7PlanningRecipeRunRow): ExecutableRouteRoster {
    const roster = storedRouteRoster(run);
    const executable = executableRouteRoster(roster, this.members(), this.contextMembers());
    if (executable === null) throw conflict(READ_ONLY_ROUTE_MESSAGE);
    return executable;
  }

  private markReadOnlyFailure(run: V7PlanningRecipeRunRow): void {
    const current = this.requireRun(run.owner_id, run.book_id, run.run_id);
    if (!['queued', 'working'].includes(current.status)) return;
    this.repository.markRecipeRun({
      ownerId: run.owner_id,
      bookId: run.book_id,
      runId: run.run_id,
      status: 'failed',
      phase: 'failed',
      checkpoint: this.checkpoint(run),
      errorMessage: READ_ONLY_ROUTE_MESSAGE,
      now: this.clock.now().toISOString()
    });
  }

  private start(run: V7PlanningRecipeRunRow): void {
    // A partially failed run has already exhausted the frozen fallback roster.
    // Re-reading the page must not make a finished failure look active or
    // repeatedly replay the same failed seats. The author can start a new run
    // with a fresh idempotency key after changing the goal or member roster.
    if (!['queued', 'working'].includes(run.status) || this.activeRuns.has(run.run_id)) return;
    if (executableRouteRoster(storedRouteRoster(run), this.members(), this.contextMembers()) === null) {
      this.markReadOnlyFailure(run);
      return;
    }
    this.activeRuns.add(run.run_id);
    void this.execute(run).catch((error) => {
      const current = this.repository.recipeRun(run.owner_id, run.book_id, run.run_id);
      if (current === undefined || ['awaiting_author', 'completed', 'cancelled'].includes(current.status)) return;
      this.repository.markRecipeRun({
        ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id, status: 'failed', phase: 'failed',
        checkpoint: this.checkpoint(run), errorMessage: publicFailure(error), now: this.clock.now().toISOString()
      });
    }).finally(() => {
      this.activeRuns.delete(run.run_id);
    });
  }

  private async execute(run: V7PlanningRecipeRunRow): Promise<void> {
    if (['awaiting_author', 'completed', 'cancelled'].includes(this.requireRun(run.owner_id, run.book_id, run.run_id).status)) return;
    const roster = executableRouteRoster(storedRouteRoster(run), this.members(), this.contextMembers());
    if (roster === null) {
      this.markReadOnlyFailure(run);
      return;
    }
    const snapshot = this.sources.require(run.owner_id, run.book_id, run.snapshot_id);
    await this.executeDirectChiefRoutes(run, snapshot, roster);
  }

  private async executeDirectChiefRoutes(
    run: V7PlanningRecipeRunRow,
    snapshot: ReturnType<V7PlanningSourceCompiler['require']>,
    roster: ExecutableRouteRoster
  ): Promise<void> {
    const frozenChiefs = roster.directChiefs;
    this.ensureActive(run);
    this.mark(run, 'method_search');
    let sharedContextSearch: V7PlanningMethodSearchRow;
    try {
      sharedContextSearch = await this.ensureDirectContextPlan(run, snapshot, roster.contextEditors);
    } catch (error) {
      if (error instanceof PlanningSourceIssuesError) {
        this.pauseForSourceIssues(run, [{ status: 'rejected', reason: error }]);
        return;
      }
      throw error;
    }
    this.mark(run, 'route_design');
    const seatKeys = (['chief_editor', 'structure_deputy', 'commercial_deputy'] as const).slice(0, frozenChiefs.length);
    const expectedRoutes = seatKeys.length;
    // 先让第一位主编检查并出案；若她发现正式资料相互冲突，立即停下，
    // 不再让另外两位重复消耗。资料无冲突后，余下两案才并行生成。
    const first = await Promise.allSettled([
      this.runDirectChiefRoute(
        run, snapshot, sharedContextSearch, seatKeys[0]!, frozenChiefs[0]!, roster.directFallbacks, 0
      )
    ]);
    if (this.pauseForSourceIssues(run, first)) return;
    const rest = await Promise.allSettled(seatKeys.slice(1).map((seatKey, offset) => (
      this.runDirectChiefRoute(
        run, snapshot, sharedContextSearch, seatKey, frozenChiefs[offset + 1]!, roster.directFallbacks, offset + 1
      )
    )));
    if (this.pauseForSourceIssues(run, rest)) return;
    const results = [...first, ...rest];
    const routes = this.repository.routeCandidates(run.owner_id, run.book_id, run.run_id);
    this.ensureActive(run);
    if (routes.length < expectedRoutes) return this.partial(run, 'route_design', results, '还有全书路线没有完成');
    let comparisonError: string | null = null;
    if (expectedRoutes >= 2) {
      this.mark(run, 'chief_route_review');
      if (this.repository.routeReview(run.owner_id, run.book_id, run.run_id) === undefined) {
        try {
          await this.review(run, snapshot, routes, roster.routeReviewers);
        } catch (error) {
          comparisonError = `抱歉，路线都已完成，但这次比较点评没有完成。您仍可直接查看并选择。${publicFailure(error)}`;
        }
      }
    }
    this.ensureActive(run);
    this.repository.markRecipeRun({
      ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id, status: 'awaiting_author',
      phase: 'route_selection', checkpoint: this.checkpoint(run), errorMessage: comparisonError, now: this.clock.now().toISOString()
    });
  }

  private async runDirectChiefRoute(
    run: V7PlanningRecipeRunRow,
    snapshot: ReturnType<V7PlanningSourceCompiler['require']>,
    sharedContextSearch: V7PlanningMethodSearchRow,
    seatKey: MethodSeat,
    frozenChief: V7PlanningMemberDefinition,
    frozenFallbacks: readonly V7PlanningMemberDefinition[],
    index: number
  ): Promise<void> {
    const existingProposal = this.repository.recipeProposals(run.owner_id, run.book_id, run.run_id)
      .find((proposal) => proposal.seat_key === seatKey);
    if (existingProposal !== undefined && this.repository.routeCandidates(run.owner_id, run.book_id, run.run_id)
      .some((route) => route.recipe_proposal_id === existingProposal.proposal_id)) return;
    const seat = fullCasePlanningSeat(seatKey);
    const attempted = new Set<string>();
    const failures: string[] = [];
    for (const member of frozenFallbackChain(frozenFallbacks, frozenChief.memberKey)) {
      if (attempted.has(member.memberKey)) continue;
      attempted.add(member.memberKey);
      try {
        this.ensureActive(run);
        const search = sharedContextSearch;
        const request = storedMethodSearchRequest(search);
        const focusedSnapshot = focusedPlanningSnapshot(snapshot, request);
        const candidates = JSON.parse(search.candidate_methods_json) as V7PlanningMethodCandidate[];
        const logicalTaskId = `planning-route:${run.run_id}:direct:${seatKey}:${member.memberKey}`;
        const attempt = this.modelAttempt(run, logicalTaskId);
        const result = await this.models.generate({
          ...attempt, ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id,
          runKind: 'recipe', nodeKey: `direct_story_route:${seatKey}`, member,
          taskKind: 'planning_recipe', workstationKey: 'full_book_route',
          operationMode: 'fresh', basedOnTaskId: null, authorInstructionVersion: null,
          sourceTraces: planningSnapshotSourceTraces(focusedSnapshot),
          prompt: planningDirectStoryRoutePrompt({
            sourceSnapshot: focusedSnapshot,
            contextPlan: planningTaskContextPlan(request),
            seatKey,
            routeLabel: seat.routeLabel,
            explorationOpening: seat.explorationOpening,
            candidates
          }),
          maxOutputTokens: member.model.modelId.startsWith('glm-5.3') ? 14_000 : 10_000,
          temperature: 0.68 + index * 0.03
        });
        this.ensureActive(run);
        const sourceIssues = extractPlanningCriticalInputs(result.output);
        if (sourceIssues.length > 0) throw new PlanningSourceIssuesError(sourceIssues);
        let acceptedRequestId = result.requestId;
        let direct: ReturnType<typeof parsePlanningRouteFusion>;
        try {
          direct = parsePlanningRouteFusion(
            result.output,
            [],
            candidates.map((candidate) => candidate.methodKey),
            seatKey
          );
          validateProgressivePlanningBriefCandidates(direct.brief, candidates);
          validatePlanningRouteScale(direct.route, requirePlanningScaleProfile(snapshot));
        } catch (contractError) {
          const repairLogicalTaskId = `${logicalTaskId}:repair`;
          const repairAttempt = this.modelAttempt(run, repairLogicalTaskId);
          const repaired = await this.models.generate({
            ...repairAttempt, ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id,
            runKind: 'recipe', nodeKey: `direct_story_route_repair:${seatKey}`, member,
            taskKind: 'planning_recipe', workstationKey: 'full_book_route',
            operationMode: 'repair', basedOnTaskId: result.requestId, authorInstructionVersion: null,
            sourceTraces: planningSnapshotSourceTraces(focusedSnapshot),
            prompt: planningDirectStoryRouteRepairPrompt({
              sourceSnapshot: focusedSnapshot,
              contextPlan: planningTaskContextPlan(request),
              seatKey,
              candidates,
              invalidOutput: result.output,
              validationMessage: message(contractError)
            }),
            maxOutputTokens: member.model.modelId.startsWith('glm-5.3') ? 14_000 : 10_000,
            temperature: 0.24
          });
          this.ensureActive(run);
          direct = parsePlanningRouteFusion(
            repaired.output,
            [],
            candidates.map((candidate) => candidate.methodKey),
            seatKey
          );
          validateProgressivePlanningBriefCandidates(direct.brief, candidates);
          validatePlanningRouteScale(direct.route, requirePlanningScaleProfile(snapshot));
          acceptedRequestId = repaired.requestId;
        }
        const proposalId = this.ids.next();
        this.repository.saveRecipeProposal({
          proposalId, ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id,
          seatKey, memberKey: member.memberKey, memberSnapshot: memberSnapshot(member), sourceSnapshotId: run.snapshot_id,
          proposal: direct.brief, proposalHash: sha256(stableJson(direct.brief)), sourceProposalIds: [],
          requestId: acceptedRequestId, now: this.clock.now().toISOString()
        });
        this.repository.saveRouteCandidate({
          routeId: this.ids.next(), ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id,
          recipeProposalId: proposalId, methodSearchId: search.search_id,
          memberKey: member.memberKey, memberSnapshot: memberSnapshot(member), route: direct.route,
          routeHash: sha256(stableJson(direct.route)), requestId: acceptedRequestId, now: this.clock.now().toISOString()
        });
        return;
      } catch (error) {
        if (error instanceof PlanningSourceIssuesError) throw error;
        failures.push(`${member.displayName}：${message(error)}`);
        if (error instanceof V7PlanningModelError && error.outcomeUnknown) break;
      }
    }
    throw new Error(`对不起，${seat.routeLabel}这次没有完成。${failures.join('；')}`);
  }

  private async ensureDirectContextPlan(
    run: V7PlanningRecipeRunRow,
    snapshot: ReturnType<V7PlanningSourceCompiler['require']>,
    frozenContextEditors: readonly V7CreationMemberDefinition[]
  ): Promise<V7PlanningMethodSearchRow> {
    const existing = this.repository.methodSearches(run.owner_id, run.book_id, run.run_id)[0];
    if (existing !== undefined) return existing;
    const failures: string[] = [];
    for (const member of frozenContextEditors) {
      const logicalTaskId = `planning-route:${run.run_id}:context:${member.memberKey}`;
      const attempt = this.modelAttempt(run, logicalTaskId);
      try {
        this.ensureActive(run);
        const result = await this.models.generate({
          ...attempt, ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id,
          runKind: 'recipe', nodeKey: 'shared_context_plan', member,
          taskKind: 'planning_context', workstationKey: 'full_book_route',
          operationMode: 'fresh', basedOnTaskId: null, authorInstructionVersion: null,
          sourceTraces: planningSnapshotSourceTraces(snapshot),
          prompt: planningMethodSearchPrompt({
            seatName: '全书路线资料策划',
            seatResponsibility: '为本书全书路线选择最小充分设定、准确的方法检索范围、任务期题材身份和可自由创新的边界。',
            independentFocus: [
              '只保留会改变全书方向的正式资料和作者原话',
              '通用方法按全书与跨卷层级召回，不预先替主编选答案',
              '把融合题材身份翻译成当前任务的大白话责任并保留原创空间'
            ],
            allowedPlanningLayers: ['book_backbone', 'volume_distribution'],
            sourceSnapshot: snapshot
          }),
          maxOutputTokens: 2_500,
          temperature: 0.28
        });
        this.ensureActive(run);
        const sourceIssues = extractPlanningCriticalInputs(result.output);
        if (sourceIssues.length > 0) throw new PlanningSourceIssuesError(sourceIssues);
        const request = parsePlanningMethodSearchRequest(result.output, { requireTaskProfile: true });
        focusedPlanningSnapshot(snapshot, request);
        const retrieval = retrievePlanningMethodCandidates(request);
        return this.repository.saveMethodSearch({
          searchId: this.ids.next(), ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id,
          seatKey: 'chief_editor', memberKey: member.memberKey, memberSnapshot: memberSnapshot(member),
          sourceSnapshotId: run.snapshot_id, searchRequest: request, candidateMethods: retrieval.candidates,
          searchHash: sha256(stableJson(retrieval)), retrievalVersion: retrieval.retrievalVersion,
          requestId: result.requestId, now: this.clock.now().toISOString()
        });
      } catch (error) {
        if (error instanceof PlanningSourceIssuesError) throw error;
        failures.push(`${member.displayName}：${message(error)}`);
        if (error instanceof V7PlanningModelError && error.outcomeUnknown) break;
      }
    }
    throw new Error(`对不起，这次资料策划没有完成。${failures.join('；')}`);
  }

  private async review(
    run: V7PlanningRecipeRunRow,
    snapshot: ReturnType<V7PlanningSourceCompiler['require']>,
    routes: V7PlanningRouteCandidateRow[],
    frozenReviewers: readonly V7PlanningMemberDefinition[]
  ): Promise<void> {
    const reviewSnapshot = planningRunSnapshot(snapshot, this.repository.methodSearches(run.owner_id, run.book_id, run.run_id));
    const routeInput = routes.map((row) => ({
      routeId: row.route_id, memberName: memberName(row.member_snapshot_json),
      route: JSON.parse(row.route_json) as V7PlanningStoryRoute
    }));
    const failures: string[] = [];
    for (const member of frozenReviewers) {
      const logicalTaskId = `planning-route:${run.run_id}:review:${member.memberKey}`;
      const attempt = this.modelAttempt(run, logicalTaskId);
      try {
        this.ensureActive(run);
        const result = await this.models.generate({
          ...attempt, ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id,
          runKind: 'recipe', nodeKey: 'route_review', member,
          taskKind: 'planning_review', workstationKey: 'full_book_route',
          operationMode: 'fresh', basedOnTaskId: null, authorInstructionVersion: null,
          sourceTraces: planningSnapshotSourceTraces(reviewSnapshot),
          prompt: planningRouteReviewPrompt({ sourceSnapshot: reviewSnapshot, routes: routeInput }),
          maxOutputTokens: 5_000, temperature: 0.4
        });
        this.ensureActive(run);
        const review = parsePlanningRouteReview(result.output, routes.map((route) => route.route_id));
        this.repository.saveRouteReview({
          reviewId: this.ids.next(), ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id,
          memberKey: member.memberKey, memberSnapshot: memberSnapshot(member), routeIds: routes.map((route) => route.route_id),
          review, reviewHash: sha256(stableJson(review)), requestId: result.requestId, now: this.clock.now().toISOString()
        });
        return;
      } catch (error) {
        failures.push(`${member.displayName}：${message(error)}`);
        if (error instanceof V7PlanningModelError && error.outcomeUnknown) break;
      }
    }
    throw new Error(`对不起，主编这次没有完成路线点评。${failures.join('；')}`);
  }

  private async fuse(
    run: V7PlanningRecipeRunRow,
    rows: V7PlanningRouteCandidateRow[],
    proposals: V7PlanningRecipeProposalRow[],
    mode: Exclude<RouteDecisionKind, 'select'>,
    authorNote: string,
    idempotencyKey: string,
    frozenFusionEditors: readonly V7PlanningMemberDefinition[]
  ): Promise<{ route: V7PlanningStoryRoute; brief: V7ProgressivePlanningBrief; memberKey: string }> {
    const snapshot = this.sources.require(run.owner_id, run.book_id, run.snapshot_id);
    const focusedSnapshot = planningRunSnapshot(snapshot, this.repository.methodSearches(run.owner_id, run.book_id, run.run_id));
    const selected = rows.map((row) => ({
      routeId: row.route_id, route: JSON.parse(row.route_json) as V7PlanningStoryRoute,
      brief: parseStoredProgressivePlanningBrief(
        JSON.parse(requireProposal(proposals, row.recipe_proposal_id).proposal_json),
        requireProposal(proposals, row.recipe_proposal_id).seat_key as MethodSeat
      )
    }));
    const allCandidates = uniqueCandidates(this.repository.methodSearches(run.owner_id, run.book_id, run.run_id)
      .flatMap((row) => JSON.parse(row.candidate_methods_json) as V7PlanningMethodCandidate[]));
    const candidates = uniqueCandidates(selected.flatMap((item) => methodsUsedByBrief(item.brief, allCandidates)));
    const failures: string[] = [];
    for (const member of frozenFusionEditors) {
      const requestId = `planning-route:${run.run_id}:fusion:${idempotencyKey}:${member.memberKey}`;
      try {
        const result = await this.models.generate({
          requestId, ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id,
          runKind: 'recipe', nodeKey: 'route_fusion', member,
          taskKind: 'planning_review', workstationKey: 'full_book_route',
          operationMode: mode === 'merge' ? 'fusion' : 'revise',
          basedOnTaskId: mode === 'adjust' ? rows[0]!.request_id : null,
          authorInstructionVersion: null,
          sourceTraces: planningSnapshotSourceTraces(focusedSnapshot),
          prompt: planningRouteFusionPrompt({ sourceSnapshot: focusedSnapshot, selected, authorNote, candidateMethods: candidates }),
          maxOutputTokens: 8_000, temperature: 0.56
        });
        const fusion = parsePlanningRouteFusion(
          result.output,
          rows.map((row) => row.route_id),
          candidates.map((candidate) => candidate.methodKey),
          selected[0]!.brief.seatKey
        );
        validateProgressivePlanningBriefCandidates(fusion.brief, candidates);
        validatePlanningRouteScale(fusion.route, requirePlanningScaleProfile(snapshot));
        return { route: fusion.route, brief: fusion.brief, memberKey: member.memberKey };
      } catch (error) {
        failures.push(`${member.displayName}：${message(error)}`);
        if (error instanceof V7PlanningModelError && error.outcomeUnknown) break;
      }
    }
    throw new Error(`对不起，主编这次没有完成路线整理。${failures.join('；')}`);
  }

  private mark(run: V7PlanningRecipeRunRow, phase: string): void {
    this.ensureActive(run);
    this.repository.markRecipeRun({
      ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id, status: 'working', phase,
      checkpoint: this.checkpoint(run), errorMessage: null, now: this.clock.now().toISOString()
    });
  }

  private partial(run: V7PlanningRecipeRunRow, phase: string, outcomes: PromiseSettledResult<unknown>[], fallback: string): void {
    if (this.repository.recipeRun(run.owner_id, run.book_id, run.run_id)?.status === 'cancelled') return;
    const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    const completedRoutes = this.repository.routeCandidates(run.owner_id, run.book_id, run.run_id).length;
    this.repository.markRecipeRun({
      ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id,
      status: completedRoutes > 0 ? 'awaiting_author' : 'partially_failed',
      phase: completedRoutes > 0 ? 'route_selection' : phase,
      checkpoint: this.checkpoint(run),
      errorMessage: rejected === undefined
        ? `对不起，${fallback}，已保留完成内容。`
        : `对不起，有路线没有完成；已完成的${completedRoutes}套仍可直接选择，也可以只补失败路线。${publicFailure(rejected.reason)}`,
      now: this.clock.now().toISOString()
    });
  }

  private pauseForSourceIssues(run: V7PlanningRecipeRunRow, outcomes: PromiseSettledResult<unknown>[]): boolean {
    const issues = [...new Set(outcomes.flatMap((outcome) => outcome.status === 'rejected' && outcome.reason instanceof PlanningSourceIssuesError
      ? outcome.reason.issues
      : []))];
    if (issues.length === 0) return false;
    if (this.repository.recipeRun(run.owner_id, run.book_id, run.run_id)?.status === 'cancelled') return true;
    this.repository.markRecipeRun({
      ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id, status: 'awaiting_author', phase: 'source_decision',
      checkpoint: this.checkpoint(run, issues), errorMessage: null, now: this.clock.now().toISOString()
    });
    return true;
  }

  private checkpoint(run: V7PlanningRecipeRunRow, sourceIssues: string[] = []): unknown {
    return {
      searchIds: this.repository.methodSearches(run.owner_id, run.book_id, run.run_id).map((row) => row.search_id),
      proposalIds: this.repository.recipeProposals(run.owner_id, run.book_id, run.run_id).map((row) => row.proposal_id),
      routeIds: this.repository.routeCandidates(run.owner_id, run.book_id, run.run_id).map((row) => row.route_id),
      reviewId: this.repository.routeReview(run.owner_id, run.book_id, run.run_id)?.review_id ?? null,
      sourceIssues
    };
  }

  private modelAttempt(
    run: V7PlanningRecipeRunRow,
    logicalTaskId: string
  ): { requestId: string; logicalTaskId?: string; technicalRetry?: true } {
    let latest: ReturnType<V7PlanningRuntimeRepository['modelCall']> = undefined;
    let latestAttempt = -1;
    for (let attempt = 0; attempt <= run.retry_count; attempt += 1) {
      const requestId = attempt === 0 ? logicalTaskId : `${logicalTaskId}:retry:${attempt}`;
      const call = this.repository.modelCall(requestId);
      if (call !== undefined) {
        latest = call;
        latestAttempt = attempt;
      }
    }
    if (latest?.state === 'succeeded') return { requestId: latest.request_id };
    if (latest?.state === 'unknown' || latest?.state === 'working') {
      throw new V7PlanningModelError('上一次调用结果尚未确认，已停止重复扣量。', true);
    }
    if (latest?.state === 'failed' && latestAttempt < run.retry_count) {
      return {
        requestId: `${logicalTaskId}:retry:${run.retry_count}`,
        logicalTaskId,
        technicalRetry: true
      };
    }
    if (latest?.state === 'failed') return { requestId: latest.request_id };
    return { requestId: logicalTaskId };
  }

  private ensureActive(run: V7PlanningRecipeRunRow): void {
    if (this.requireRun(run.owner_id, run.book_id, run.run_id).status === 'cancelled') {
      throw conflict('任务已停止，已经完成的内容仍然保留。');
    }
  }

  private view(run: V7PlanningRecipeRunRow): V7PlanningRouteRunView {
    const proposals = this.repository.recipeProposals(run.owner_id, run.book_id, run.run_id);
    const proposalRationales = new Map(proposals.map((proposal) => [
      proposal.proposal_id,
      planningProposalRationale(proposal.proposal_json)
    ]));
    const routes = this.repository.routeCandidates(run.owner_id, run.book_id, run.run_id);
    const reviewRow = this.repository.routeReview(run.owner_id, run.book_id, run.run_id);
    const review = reviewRow === undefined ? null : JSON.parse(reviewRow.review_json) as V7PlanningRouteReview;
    const sourceIssues = checkpointSourceIssues(run.checkpoint_json);
    const frozenRoster = storedRouteRoster(run);
    const readOnlyWorkflow = executableRouteRoster(frozenRoster, this.members(), this.contextMembers()) === null;
    // A retired frozen roster blocks future execution, but a route the author
    // already confirmed is still a completed historical fact. Presenting that
    // terminal result as failed makes Time Machine override the confirmed tree.
    const preservedReadOnlyResult = readOnlyWorkflow && run.status === 'completed';
    const showReadOnlyFailure = readOnlyWorkflow && !preservedReadOnlyResult;
    const expectedRoutes = Math.max(1, frozenRoster.directChiefs.length || frozenRoster.routeWriters.length || routes.length || 3);
    const total = expectedRoutes * 2 + (expectedRoutes >= 2 ? 1 : 0);
    const completed = Math.min(total, proposals.length + routes.length + (review === null ? 0 : 1));
    const currentDecision = run.status === 'completed'
      ? this.repository.currentConfirmedRouteDecision(run.owner_id, run.book_id, run.run_id)
      : undefined;
    const existingTreeRun = currentDecision === undefined
      ? undefined
      : this.repository.latestBookTreeGenerationForRoute(run.owner_id, run.book_id, currentDecision.route_version_id);
    return {
      runId: run.run_id,
      status: showReadOnlyFailure ? 'failed' : publicStatus(run.status),
      phase: showReadOnlyFailure ? 'failed' : publicPhase(run),
      message: showReadOnlyFailure ? READ_ONLY_ROUTE_MESSAGE : publicMessage(run, completed, sourceIssues, expectedRoutes),
      progress: { completed, total, percent: Math.round(completed / total * 100) },
      actors: planningActors(run, this.repository.modelCallsForRun(run.owner_id, run.book_id, run.run_id), showReadOnlyFailure),
      routes: routes.map((row) => {
        const route = JSON.parse(row.route_json) as V7PlanningStoryRoute;
        return {
          routeId: row.route_id, memberKey: row.member_key, memberName: memberName(row.member_snapshot_json), title: route.routeTitle,
          oneLinePromise: route.oneLinePromise, summary: route.publicSummary,
          designRationale: proposalRationales.get(row.recipe_proposal_id) ?? route.publicSummary,
          readingExperience: route.readingExperience,
          protagonistJourney: route.protagonistJourney, targetWords: route.targetWords, targetVolumes: route.targetVolumes,
          commercialAudience: route.commercialAudience, retentionPositioning: route.retentionPositioning,
          volumes: route.volumeRoadmap, firstVolumeFocus: route.firstVolumeFocus, sellingPoints: route.sellingPoints,
          risks: route.risks, openQuestions: route.openQuestions
        };
      }),
      chiefReview: review === null || reviewRow === undefined ? null : {
        memberKey: reviewRow.member_key, memberName: memberName(reviewRow.member_snapshot_json), summary: review.publicSummary,
        recommendedRouteId: review.recommendedRouteId, routeReviews: review.routeReviews,
        commonRisks: review.commonRisks, authorDecisions: review.authorDecisions
      },
      sourceIssues,
      expectedRoutes,
      canDecide: !readOnlyWorkflow && run.status === 'awaiting_author' && sourceIssues.length === 0 && routes.length > 0
        && (routes.length < expectedRoutes || expectedRoutes === 1 || review !== null || run.error_message !== null),
      canContinueTree: currentDecision !== undefined,
      nextStepPending: currentDecision !== undefined && existingTreeRun === undefined,
      errorMessage: preservedReadOnlyResult ? null : showReadOnlyFailure ? READ_ONLY_ROUTE_MESSAGE : run.error_message,
      timing: planningTaskTiming(
        run.created_at,
        run.updated_at,
        !readOnlyWorkflow && ['queued', 'working'].includes(run.status),
        this.clock.now()
      )
    };
  }

  private members(): readonly V7PlanningMemberDefinition[] {
    const members = typeof this.memberSource === 'function' ? this.memberSource() : this.memberSource;
    const errors = validatePlanningEditorialRoster(members);
    if (errors.length > 0) throw new Error(`V7规划成员名册无效：${errors.join('；')}`);
    return members;
  }

  private contextMembers(): readonly V7CreationMemberDefinition[] {
    const members = typeof this.contextMemberSource === 'function' ? this.contextMemberSource() : this.contextMemberSource;
    creationFallbackChain('context_editor', undefined, members);
    return members;
  }

  private requireRun(ownerId: string, bookId: string, runId: string): V7PlanningRecipeRunRow {
    const run = this.repository.recipeRun(ownerId, bookId, runId);
    if (run === undefined) throw new DomainError(errorCodes.validation, '全书路线任务不存在或不属于本书。', {}, false, 404);
    return run;
  }
}

function planningTaskTiming(createdAt: string, updatedAt: string, active: boolean, now: Date): V7PlanningRouteRunView['timing'] {
  const created = Date.parse(createdAt);
  const updated = Date.parse(updatedAt);
  const current = now.getTime();
  const elapsedSeconds = Number.isFinite(created) ? Math.max(0, Math.floor((current - created) / 1_000)) : 0;
  const idleSeconds = Number.isFinite(updated) ? Math.max(0, Math.floor((current - updated) / 1_000)) : 0;
  return {
    createdAt,
    lastActivityAt: updatedAt,
    elapsedSeconds,
    idleSeconds,
    state: !active || idleSeconds < 300 ? 'normal' : idleSeconds < 900 ? 'slow' : 'overdue'
  };
}

function planningProposalRationale(value: string): string {
  try {
    const proposal = JSON.parse(value) as { publicSummary?: unknown };
    return typeof proposal.publicSummary === 'string' && proposal.publicSummary.trim().length > 0
      ? proposal.publicSummary.trim()
      : '';
  } catch {
    return '';
  }
}

function planningActors(
  run: V7PlanningRecipeRunRow,
  modelCalls: readonly Record<string, unknown>[] = [],
  readOnlyWorkflow = false
): V7PlanningRouteRunView['actors'] {
  const roster = storedRouteRoster(run);
  const directChiefs = roster.directChiefs.map(normalizeStoredPlanningMember);
  const reviewChiefKey = directChiefs[0]?.memberKey ?? null;
  const methodMembers = roster.methodSeats.flatMap((seat) => seat.fallback.slice(0, 1))
    .map(normalizeStoredPlanningMember);
  const routeWriters = roster.routeWriters.map(normalizeStoredPlanningMember);
  const phase = readOnlyWorkflow ? 'failed' : publicPhase(run);
  const latestCallStateByMember = new Map<string, string>();
  for (const call of modelCalls) {
    if (typeof call.memberKey === 'string' && typeof call.state === 'string') {
      latestCallStateByMember.set(call.memberKey, call.state);
    }
  }
  const membersByName = new Map<string, Array<(typeof methodMembers)[number]>>();
  for (const member of [...directChiefs, ...methodMembers, ...routeWriters]) {
    const bindings = membersByName.get(member.displayName) ?? [];
    bindings.push(member);
    membersByName.set(member.displayName, bindings);
  }
  const members = [...membersByName.values()].map((bindings) => actorBindingForPhase(bindings, phase));
  const planningActors = members.map((member) => {
    const isDirectChief = roster.workflowStyle === 'three-chief-direct-v1' && member.roleKey === 'chief_editor';
    const isMethod = member.roleKey !== 'planning_writer';
    const callState = latestCallStateByMember.get(member.memberKey);
    const directRuntimePhase = isDirectChief && (phase === 'designing_routes' || phase === 'chief_review');
    const waitingForSharedContext = roster.workflowStyle === 'three-chief-direct-v1' && phase === 'choosing_methods';
    const failed = phase === 'failed' || (directRuntimePhase && (callState === 'failed' || callState === 'unknown'));
    const working = !failed && !waitingForSharedContext && (directRuntimePhase
      ? callState === 'working'
      : (
      (phase === 'choosing_methods' && isMethod)
      || (phase === 'designing_routes' && !isMethod)
      || (phase === 'chief_review' && member.roleKey === 'chief_editor' && member.memberKey === reviewChiefKey)
    ));
    const completed = !failed && (directRuntimePhase
      ? callState === 'succeeded'
      : (
      phase === 'waiting_for_you' || phase === 'completed'
      || (phase === 'designing_routes' && isMethod)
      || (phase === 'chief_review' && (isMethod || member.roleKey === 'planning_writer'))
    ));
    const status = failed ? 'failed' as const : working ? 'working' as const : completed ? 'completed' as const : 'waiting' as const;
    return {
      memberKey: member.memberKey,
      memberName: member.displayName,
      role: planningRoleName(member.roleKey),
      status,
      message: status === 'failed'
        ? '对不起，这轮没有完成，已经保留现有成果，您可以重新安排。'
        : status === 'working'
          ? member.roleKey === 'chief_editor' && phase === 'chief_review'
              ? '几套方向我正在逐一比较，马上给您建议。'
            : member.roleKey === 'planning_writer' || isDirectChief
              ? '我正在独立设计一套全书方向，很快交稿啦。'
              : '我正在筛选适合这本书的少量方法，请稍等一下。'
          : status === 'completed'
            ? '我负责的部分已经整理好，交给下一位同事继续啦。'
            : '我在这里待命，需要时马上接手。',
      emoji: status === 'failed' ? '🙇' : status === 'working' ? '✍️' : status === 'completed' ? '✅' : '🌿'
    };
  });
  if (roster.workflowStyle !== 'three-chief-direct-v1') return planningActors;
  const contextCall = [...modelCalls].reverse().find((call) => call.nodeKey === 'shared_context_plan');
  if (contextCall === undefined || typeof contextCall.memberKey !== 'string') return planningActors;
  const contextMember = V7_CREATION_MEMBERS.find((member) => member.memberKey === contextCall.memberKey);
  const contextState = contextCall.state;
  const contextStatus = contextState === 'failed' || contextState === 'unknown'
    ? 'failed' as const
    : contextState === 'working'
      ? 'working' as const
      : 'completed' as const;
  return [{
    memberKey: contextCall.memberKey,
    memberName: contextMember?.displayName ?? '资料策划',
    role: '资料策划',
    status: contextStatus,
    message: contextStatus === 'failed'
      ? '对不起，这次资料没有整理完成，您可以重新开始。'
      : contextStatus === 'working'
        ? '我正在筛选本次真正需要的资料和方法，请稍等一下。'
        : '本次资料和方法已经整理好，交给主编继续设计。',
    emoji: contextStatus === 'failed' ? '🙇' : contextStatus === 'working' ? '✍️' : '✅'
  }, ...planningActors];
}

function normalizeStoredPlanningMember<T extends { memberKey: string; displayName: string; roleKey: string }>(
  member: T
): Omit<T, 'roleKey'> & { roleKey: V7PlanningMemberDefinition['roleKey'] } {
  return { ...member, roleKey: planningRuntimeRole(member.roleKey) };
}

function storedRouteRoster(run: V7PlanningRecipeRunRow): StoredRouteRoster {
  let value: Record<string, unknown>;
  try {
    const parsed = JSON.parse(run.roster_json) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return readOnlyRouteRoster();
    value = parsed as Record<string, unknown>;
  } catch {
    return readOnlyRouteRoster();
  }
  const member = (input: unknown): StoredPlanningMember | null => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
    const row = input as Record<string, unknown>;
    if (typeof row.memberKey !== 'string' || typeof row.displayName !== 'string' || typeof row.roleKey !== 'string') return null;
    if (row.memberKey.trim().length === 0 || row.displayName.trim().length === 0 || !storedPlanningRole(row.roleKey)) return null;
    return {
      memberKey: row.memberKey,
      displayName: row.displayName,
      roleKey: row.roleKey,
      ...(typeof row.provider === 'string' ? { provider: row.provider } : {}),
      ...(typeof row.modelId === 'string' ? { modelId: row.modelId } : {}),
      ...(typeof row.plan === 'string' ? { plan: row.plan } : {}),
      ...(typeof row.fallbackPriority === 'number' ? { fallbackPriority: row.fallbackPriority } : {})
    };
  };
  const directChiefInputs = Array.isArray(value.directChiefs) ? value.directChiefs : [];
  const directChiefs = directChiefInputs.length > 0
    ? directChiefInputs.map(member).filter((item): item is StoredPlanningMember => item !== null)
    : [];
  const directFallbackInputs = Array.isArray(value.directFallbacks) ? value.directFallbacks : [];
  const directFallbacks = directFallbackInputs.map(member).filter((item): item is StoredPlanningMember => item !== null);
  const routeReviewerInputs = Array.isArray(value.routeReviewers) ? value.routeReviewers : [];
  const routeReviewers = routeReviewerInputs.map(member).filter((item): item is StoredPlanningMember => item !== null);
  const routeFusionInputs = Array.isArray(value.routeFusionEditors) ? value.routeFusionEditors : [];
  const routeFusionEditors = routeFusionInputs.map(member).filter((item): item is StoredPlanningMember => item !== null);
  const contextEditorInputs = Array.isArray(value.contextEditors) ? value.contextEditors : [];
  const contextEditors = contextEditorInputs.map(member).filter((item): item is StoredPlanningMember => item !== null);
  const methodSeats = Array.isArray(value.methodSeats) ? value.methodSeats.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.seatKey !== 'string' || !Array.isArray(row.fallback)) return [];
    return [{
      seatKey: row.seatKey,
      fallback: row.fallback.map(member).filter((item): item is StoredPlanningMember => item !== null)
    }];
  }) : [];
  const routeWriters = Array.isArray(value.routeWriters)
    ? value.routeWriters.map(member).filter((item): item is StoredPlanningMember => item !== null)
    : [];
  const currentStructure = value.workflowStyle === 'three-chief-direct-v1'
    && directChiefInputs.length >= 1
    && directChiefInputs.length <= 3
    && directChiefs.length === directChiefInputs.length
    && directChiefs.every((item) => item.roleKey === 'chief_editor'
      && typeof item.provider === 'string'
      && typeof item.modelId === 'string'
      && typeof item.plan === 'string')
    && new Set(directChiefs.map((item) => item.memberKey)).size === directChiefs.length
    && frozenRosterInputIsComplete(directFallbackInputs, directFallbacks, 'chief_editor')
    && frozenRosterInputIsComplete(routeReviewerInputs, routeReviewers, 'chief_editor')
    && frozenRosterInputIsComplete(routeFusionInputs, routeFusionEditors, 'chief_editor')
    && frozenRosterInputIsComplete(contextEditorInputs, contextEditors, 'context_editor')
    && directChiefs.every((chief) => directFallbacks.some((fallback) => fallback.memberKey === chief.memberKey));
  return {
    workflowStyle: currentStructure ? 'three-chief-direct-v1' : 'read-only',
    directChiefs,
    directFallbacks,
    routeReviewers,
    routeFusionEditors,
    contextEditors,
    methodSeats,
    routeWriters
  };
}

function readOnlyRouteRoster(): StoredRouteRoster {
  return {
    workflowStyle: 'read-only',
    directChiefs: [],
    directFallbacks: [],
    routeReviewers: [],
    routeFusionEditors: [],
    contextEditors: [],
    methodSeats: [],
    routeWriters: []
  };
}

function frozenRosterInputIsComplete(
  inputs: readonly unknown[],
  members: readonly StoredPlanningMember[],
  roleKey: string
): boolean {
  return inputs.length > 0
    && members.length === inputs.length
    && members.every((member) => member.roleKey === roleKey
      && typeof member.provider === 'string'
      && typeof member.modelId === 'string'
      && (member.plan === 'coding' || member.plan === 'agent'))
    && new Set(members.map((member) => member.memberKey)).size === members.length;
}

function storedPlanningRole(value: string): boolean {
  return value === 'context_editor'
    || value === 'chief_editor'
    || value === 'structure_deputy'
    || value === 'commercial_deputy'
    || value === 'planning_writer'
    || value === 'continuity_editor'
    || value === 'planning_maintainer';
}

function executableRouteRoster(
  roster: StoredRouteRoster,
  currentPlanning: readonly V7PlanningMemberDefinition[],
  currentContext: readonly V7CreationMemberDefinition[]
): ExecutableRouteRoster | null {
  if (roster.workflowStyle !== 'three-chief-direct-v1') return null;
  try {
    const directChiefs = resolveFrozenPlanningMembers(roster.directChiefs, currentPlanning, ['chief_editor']);
    const directFallbacks = resolveFrozenPlanningMembers(roster.directFallbacks, currentPlanning, ['chief_editor']);
    const routeReviewers = resolveFrozenPlanningMembers(roster.routeReviewers, currentPlanning, ['chief_editor']);
    const routeFusionEditors = resolveFrozenPlanningMembers(roster.routeFusionEditors, currentPlanning, ['chief_editor']);
    const contextEditors = resolveFrozenCreationMembers(roster.contextEditors, currentContext, ['context_editor']);
    if (!directChiefs.every((chief) => directFallbacks.some((fallback) => fallback.memberKey === chief.memberKey))) {
      return null;
    }
    return { directChiefs, directFallbacks, routeReviewers, routeFusionEditors, contextEditors };
  } catch {
    return null;
  }
}

function planningRuntimeRole(roleKey: string): V7PlanningMemberDefinition['roleKey'] {
  if (roleKey === 'chief_editor' || roleKey === 'structure_deputy' || roleKey === 'commercial_deputy') return 'chief_editor';
  if (roleKey === 'planning_writer') return 'planning_writer';
  if (roleKey === 'continuity_editor' || roleKey === 'planning_maintainer') return 'continuity_editor';
  throw new Error(`规划历史成员岗位无法识别：${roleKey}`);
}

function planningRoleName(roleKey: V7PlanningMemberDefinition['roleKey']): string {
  return ({
    chief_editor: '全案规划主编', planning_writer: '路线设计', continuity_editor: '记录编辑'
  } as const)[roleKey];
}

function actorBindingForPhase<T extends { roleKey: V7PlanningMemberDefinition['roleKey'] }>(
  bindings: T[],
  phase: V7PlanningRouteRunView['phase']
): T {
  const preferred = phase === 'designing_routes'
    ? bindings.find((member) => member.roleKey === 'planning_writer')
    : phase === 'choosing_methods'
      ? bindings.find((member) => member.roleKey !== 'planning_writer')
      : phase === 'chief_review'
        ? bindings.find((member) => member.roleKey === 'chief_editor')
        : bindings.find((member) => member.roleKey !== 'planning_writer');
  return preferred ?? bindings[0]!;
}

function availableChiefEditors(members: readonly V7PlanningMemberDefinition[]): V7PlanningMemberDefinition[] {
  return members.filter((member) => member.roleKey === 'chief_editor' && member.enabledByDefault)
    .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority);
}

function frozenFallbackChain(
  members: readonly V7PlanningMemberDefinition[],
  selectedMemberKey: string
): V7PlanningMemberDefinition[] {
  const selected = members.find((member) => member.memberKey === selectedMemberKey);
  if (selected === undefined) throw new Error('冻结主编不在本任务的direct fallback名册中');
  return [selected, ...members.filter((member) => member.memberKey !== selectedMemberKey)]
    .map((member) => ({ ...member, model: { ...member.model } }));
}

function routeCandidateCount(value: unknown): 1 | 2 | 3 {
  if (value === undefined || value === null || value === '') return 1;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 3) throw validation('全书路线数量应为1到3套。');
  return count as 1 | 2 | 3;
}

function selectedPlanningChiefs(
  rawMemberKeys: unknown,
  candidateCount: 1 | 2 | 3,
  members: readonly V7PlanningMemberDefinition[]
): V7PlanningMemberDefinition[] {
  const available = availableChiefEditors(members);
  const requested = rawMemberKeys === undefined || rawMemberKeys === null
    ? []
    : Array.isArray(rawMemberKeys)
      ? rawMemberKeys.map((value) => text(value, '主编成员', 1, 128))
      : (() => { throw validation('主编成员选择无效。'); })();
  if (requested.length > candidateCount) throw validation(`本轮只需要选择${candidateCount}位主编。`);
  if (new Set(requested).size !== requested.length) throw validation('多套路线需要由不同主编完成。');
  const selected = requested.map((memberKey) => {
    const member = available.find((candidate) => candidate.memberKey === memberKey);
    if (member === undefined) throw validation('所选主编不在岗或不负责全书规划。');
    return member;
  });
  for (const member of available) {
    if (selected.length >= candidateCount) break;
    if (!selected.some((candidate) => candidate.memberKey === member.memberKey)) selected.push(member);
  }
  if (selected.length < candidateCount) throw validation('当前没有足够的强模型主编，请减少方案数量或稍后重试。');
  return selected;
}

function storedMethodSearchRequest(row: V7PlanningMethodSearchRow): V7PlanningMethodSearchRequest {
  const value = JSON.parse(row.search_request_json) as Partial<V7PlanningMethodSearchRequest>;
  if (value.schema !== 'v7-planning-method-search-v1') throw new Error('方法检索记录格式不完整');
  return {
    ...(value as V7PlanningMethodSearchRequest),
    relevantSettingSourceIds: Array.isArray(value.relevantSettingSourceIds)
      ? value.relevantSettingSourceIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
    missingCriticalInputs: Array.isArray(value.missingCriticalInputs)
      ? value.missingCriticalInputs.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
  };
}
function planningTaskContextPlan(
  request: V7PlanningMethodSearchRequest
): Pick<V7PlanningMethodSearchRequest, 'publicGoal' | 'taskPersona' | 'taskResponsibilities' | 'creativeSpace'> {
  if (request.taskPersona === undefined || request.taskResponsibilities === undefined || request.creativeSpace === undefined) {
    throw new Error('资料策划记录缺少任务期题材身份、任务责任或创意空间');
  }
  return {
    publicGoal: request.publicGoal,
    taskPersona: request.taskPersona,
    taskResponsibilities: request.taskResponsibilities,
    creativeSpace: request.creativeSpace
  };
}
function focusedPlanningSnapshot(
  snapshot: V7PlanningCompiledSnapshot,
  request: V7PlanningMethodSearchRequest
): V7PlanningCompiledSnapshot {
  if (request.missingCriticalInputs.length > 0) {
    throw new PlanningSourceIssuesError(request.missingCriticalInputs);
  }
  const settingSources = snapshot.sources.filter((source) => source.sourceKind === 'setting');
  const settingLedgers = settingSources.filter(isSettingLedgerSource);
  const itemSources = settingSources.filter((source) => !isSettingLedgerSource(source));
  const allowed = new Set(itemSources.map((source) => source.sourceId));
  const requested = new Set(request.relevantSettingSourceIds);
  if (requested.size === 0) {
    // 兼容升级前已经开始的任务；新任务的模型输出合同要求至少选择一项。
    return snapshot;
  }
  const unknown = [...requested].filter((sourceId) => !allowed.has(sourceId));
  if (unknown.length > 0) throw new Error('主编选择了不属于本书的设定资料');
  const selectedSources = snapshot.sources.filter((source) => source.sourceKind !== 'setting'
    || isSettingLedgerSource(source)
    || requested.has(source.sourceId));
  if (!selectedSources.some((source) => source.sourceKind === 'setting' && !isSettingLedgerSource(source))) {
    throw new Error('主编没有选出可用于规划的正式设定资料');
  }
  const excluded = itemSources.filter((source) => !requested.has(source.sourceId)).map((source) => ({
    sourceKind: source.sourceKind,
    sourceId: source.sourceId,
    sourceVersion: source.sourceVersion,
    authority: source.authority,
    label: source.label,
    contentHash: source.contentHash,
    reason: `${source.label}与本席全书路线设计无直接关系，本轮不注入。`
  }));
  return {
    ...snapshot,
    sources: selectedSources,
    excludedSources: [...snapshot.excludedSources, ...excluded.map((source) => source.reason)],
    excludedSourceDecisions: [...snapshot.excludedSourceDecisions, ...excluded]
  };
}

function isSettingLedgerSource(source: V7PlanningCompiledSnapshot['sources'][number]): boolean {
  if (source.sourceKind !== 'setting' || source.content === null || typeof source.content !== 'object' || Array.isArray(source.content)) return false;
  return (source.content as { schema?: unknown }).schema === 'v7-compact-setting-ledger-v1';
}
function planningRunSnapshot(
  snapshot: V7PlanningCompiledSnapshot,
  rows: readonly V7PlanningMethodSearchRow[]
): V7PlanningCompiledSnapshot {
  const requests = rows.map(storedMethodSearchRequest);
  if (requests.length === 0 || requests.some((request) => request.relevantSettingSourceIds.length === 0)) return snapshot;
  const relevantSettingIds = new Set(requests.flatMap((request) => request.relevantSettingSourceIds));
  return focusedPlanningSnapshot(snapshot, {
    ...requests[0]!,
    relevantSettingSourceIds: [...relevantSettingIds],
    missingCriticalInputs: [...new Set(requests.flatMap((request) => request.missingCriticalInputs))]
  });
}
function validatePlanningRouteScale(route: V7PlanningStoryRoute, profile: V7PlanningScaleProfile): void {
  if (route.targetWords !== profile.expectedTotalWords) {
    throw new Error(`全书路线目标字数必须使用作者确认的${profile.expectedTotalWords}字`);
  }
}
function memberSnapshot(member: V7PlanningMemberDefinition | V7CreationMemberDefinition): unknown {
  return { memberKey: member.memberKey, displayName: member.displayName, roleKey: member.roleKey, provider: member.model.provider, modelId: member.model.modelId, plan: member.model.plan, fallbackPriority: member.fallbackPriority };
}
function memberName(json: string): string {
  const value = JSON.parse(json) as { displayName?: unknown };
  return typeof value.displayName === 'string' ? value.displayName : '规划成员';
}
function requireProposal(rows: V7PlanningRecipeProposalRow[], proposalId: string): V7PlanningRecipeProposalRow {
  const row = rows.find((candidate) => candidate.proposal_id === proposalId);
  if (row === undefined) throw new Error('故事路线对应的方法方案不存在');
  return row;
}
function uniqueCandidates(values: V7PlanningMethodCandidate[]): V7PlanningMethodCandidate[] { return [...new Map(values.map((value) => [value.methodKey, value])).values()]; }
function methodsUsedByBrief(brief: V7ProgressivePlanningBrief, candidates: readonly V7PlanningMethodCandidate[]): V7PlanningMethodCandidate[] {
  const keys = new Set(brief.selectedStrategies.flatMap((strategy) => strategy.source === 'library' && strategy.methodKey !== undefined
    ? [strategy.methodKey] : []));
  return candidates.filter((candidate) => keys.has(candidate.methodKey));
}
function decisionKind(value: unknown): RouteDecisionKind {
  if (value === 'select' || value === 'adjust' || value === 'merge') return value;
  throw validation('请选择采用、调整或融合。');
}
function routeIdList(value: unknown, mode: RouteDecisionKind): string[] {
  if (!Array.isArray(value)) throw validation('请选择故事路线。');
  const ids = [...new Set(value.map((item) => text(item, '故事路线', 1, 128)))];
  if (mode === 'merge' ? ids.length < 2 || ids.length > 3 : ids.length !== 1) throw validation(mode === 'merge' ? '请选择两到三套路线融合。' : '请选择一套路线。');
  return ids;
}
function publicStatus(status: V7PlanningRecipeRunRow['status']): V7PlanningRouteRunView['status'] {
  if (status === 'awaiting_author') return 'waiting_for_you';
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'cancelled' || status === 'partially_failed') return 'failed';
  return status === 'queued' ? 'waiting' : 'working';
}
function publicPhase(run: V7PlanningRecipeRunRow): V7PlanningRouteRunView['phase'] {
  if (run.status === 'completed') return 'completed';
  if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'partially_failed') return 'failed';
  if (run.status === 'awaiting_author') return 'waiting_for_you';
  if (run.current_phase === 'method_search') return 'choosing_methods';
  if (run.current_phase === 'route_design') return 'designing_routes';
  if (run.current_phase === 'chief_route_review') return 'chief_review';
  return 'preparing';
}
function publicMessage(run: V7PlanningRecipeRunRow, completed: number, sourceIssues: string[], expectedRoutes: number): string {
  if (run.status === 'awaiting_author' && sourceIssues.length > 0) return '主编发现几处会影响全书规划的资料，请先统一后再继续。';
  if (run.status === 'awaiting_author') return run.error_message ?? (expectedRoutes === 1
    ? '全书路线已经准备好了，请确认或写下调整意见。'
    : '全书路线已经准备好了，请选一套、调整一套或融合几套。');
  if (run.status === 'completed') return '全书方向已经确认，可以生成正式框架树。';
  if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'partially_failed') {
    return run.error_message === null
      ? '对不起，这次没有完成，您可以重新开始。'
      : publicFailure(new Error(run.error_message));
  }
  if (run.current_phase === 'route_design') return `${expectedRoutes}位全案主编正在独立设计全书路线，当前完成${completed}项。`;
  if (run.current_phase === 'chief_route_review') return '路线已经完成，主编正在逐一比较优点和风险。';
  return `${expectedRoutes}位全案主编正在筛选少量方法，并为这本书创造长期方向，请耐心等一下。`;
}

class PlanningSourceIssuesError extends Error {
  public constructor(public readonly issues: string[]) {
    super(`本书还缺少会影响全书路线的信息：${issues.join('、')}`);
    this.name = 'PlanningSourceIssuesError';
  }
}

function checkpointSourceIssues(checkpointJson: string): string[] {
  try {
    const checkpoint = JSON.parse(checkpointJson) as { sourceIssues?: unknown };
    return Array.isArray(checkpoint.sourceIssues)
      ? checkpoint.sourceIssues.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}
function optionalText(value: unknown, label: string, max: number): string | null { return value === undefined || value === null || value === '' ? null : text(value, label, 1, max); }
function actionKey(value: unknown): string { return text(value, '本次操作编号', 8, 128); }
function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string') throw validation(`${label}无效。`);
  const result = value.trim();
  if (Array.from(result).length < min || Array.from(result).length > max) throw validation(`${label}无效。`);
  return result;
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function publicFailure(error: unknown): string {
  const value = message(error).trim();
  // The exact adapter/parser failure remains available in the protected
  // per-call audit. Authors only need an honest outcome and a recovery path.
  if (/\b(?:json|syntax|typeerror|referenceerror|expected|unexpected|undefined|provider|model|token|position|column|stack|parse)\b|[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*/iu.test(value)) {
    return '对不起，这次没有完成。成员交回的方案不完整，已经保留完成内容，您可以重新开始。';
  }
  return value.startsWith('对不起') || value.startsWith('抱歉')
    ? value.slice(0, 500)
    : `对不起，这次没有完成。${value.slice(0, 400)}`;
}
function validation(messageValue: string): DomainError { return new DomainError(errorCodes.validation, messageValue); }
function conflict(messageValue: string): DomainError { return new DomainError(errorCodes.planningTreeVersionConflict, messageValue, {}, false, 409); }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
