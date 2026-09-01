import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  V7_CREATION_MEMBERS,
  buildPlanningFallbackChain,
  buildPlanningLayerReferencePack,
  creationFallbackChain,
  compileLayeredPlanningTask,
  compilePlanningTreeGenerationTask,
  extractPlanningCriticalInputs,
  parsePlanningMethodSearchRequest,
  parsePlanningTreeOutput,
  planningMethodSearchPrompt,
  planningTreeGenerationPrompt,
  planningTreeRepairPrompt,
  retrievePlanningMethodCandidates,
  type LayeredPlanningRecipe,
  type LayeredRecipeNode,
  type PlanningSourceItem,
  type PlanningLayerKey,
  type PlanningTreeKind,
  type PlanningTreeSourceRef,
  type V7CreationMemberDefinition,
  type V7PlanningMethodCandidate,
  type V7PlanningMethodSearchRequest,
  V7_PLANNING_MEMBERS,
  validatePlanningEditorialRoster,
  type V7PlanningMemberDefinition
} from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import {
  V7PlanningRuntimeRepository,
  type V7PlanningGenerationRunRow
} from '../../infrastructure/db/repositories/v7-planning-runtime-repository.js';
import { V7PlanningTreeRepository } from '../../infrastructure/db/repositories/v7-planning-tree-repository.js';
import {
  V7PlanningModelCallInProgressError,
  V7PlanningModelError,
  V7PlanningModelGateway,
  type V7PlanningModelAdapterResolver
} from '../../infrastructure/models/v7-planning-model-gateway.js';
import {
  V7PlanningSourceCompiler,
  planningSnapshotSourceTraces,
  type V7PlanningCompiledSnapshot
} from './v7-planning-source-compiler.js';
import { V7PlanningTreeService } from './v7-planning-tree-service.js';
import type { V7PlanningTaskView } from './v7-planning-route-service.js';
import {
  resolveFrozenCreationMembers,
  resolveFrozenPlanningMembers
} from './v7-planning-task-roster-snapshot.js';

export interface V7PlanningTreeGenerationView {
  runId: string;
  treeKind: PlanningTreeKind;
  scopeId: string;
  status: 'waiting' | 'working' | 'ready' | 'failed' | 'result_unknown';
  message: string;
  member: { memberKey: string; name: string };
  candidateTreeVersionId: string | null;
  canOpenCandidate: boolean;
  errorMessage: string | null;
  timing: {
    createdAt: string;
    lastActivityAt: string;
    elapsedSeconds: number;
    idleSeconds: number;
    state: 'normal' | 'slow' | 'overdue';
  };
}

type PlanningMemberSource = readonly V7PlanningMemberDefinition[] | (() => readonly V7PlanningMemberDefinition[]);
type ContextMemberSource = readonly V7CreationMemberDefinition[] | (() => readonly V7CreationMemberDefinition[]);
type StoredGenerationRoster = {
  fallback: V7PlanningMemberDefinition[];
  contextFallback: V7CreationMemberDefinition[];
  contextMember?: V7CreationMemberDefinition;
  contextPlan?: {
    request: V7PlanningMethodSearchRequest;
    candidates: V7PlanningMethodCandidate[];
  };
  stage?: 'context_planning' | 'tree_design';
};

const READ_ONLY_TREE_MESSAGE = '对不起，这项规划树任务不能继续执行。已有结果保留，请按当前流程重新设计。';

export class V7PlanningTreeGenerationService {
  private readonly runtime: V7PlanningRuntimeRepository;
  private readonly trees: V7PlanningTreeRepository;
  private readonly treeService: V7PlanningTreeService;
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
    this.runtime = new V7PlanningRuntimeRepository(database);
    this.trees = new V7PlanningTreeRepository(database);
    this.treeService = new V7PlanningTreeService(database, ids, clock);
    this.sources = new V7PlanningSourceCompiler(database, ids, clock);
    this.models = new V7PlanningModelGateway(database, adapters, clock);
    assertRoster(this.members());
    this.contextMembers();
  }

  public create(ownerId: string, bookId: string, treeKindValue: unknown, scopeIdValue: unknown, input: {
    selectedMemberKey?: unknown;
    idempotencyKey?: unknown;
  }): V7PlanningTreeGenerationView {
    const treeKind = treeKindOf(treeKindValue);
    const scopeId = text(scopeIdValue, '规划范围', 1, 128, /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u);
    const idempotencyKey = text(input.idempotencyKey, '操作编号', 8, 128, /^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/u);
    const selectedMemberKey = optionalText(input.selectedMemberKey, '规划成员', 128);
    const recipe = this.runtime.activeRecipe(ownerId, bookId, 'confirmed');
    if (recipe === undefined) throw conflict('请先确认全书方法配方，再开始设计规划树。');
    const route = this.runtime.activeRoute(ownerId, bookId, 'confirmed');
    if (treeKind === 'book' && (route === undefined || route.recipe_version_id !== recipe.recipe_version_id)) {
      throw conflict('请先从三套全书路线中确认一套方向，再开始设计正式全书框架。');
    }
    const snapshot = this.sources.compile({ ownerId, bookId, treeKind, scopeId, purpose: 'tree_generation' });
    const fallback = buildPlanningFallbackChain('planning_writer', {
      ...(selectedMemberKey === null ? {} : { selectedMemberKey }),
      members: this.members()
    });
    const contextFallback = creationFallbackChain('context_editor', undefined, this.contextMembers());
    const requestHash = sha256(stableJson({
      treeKind, scopeId, recipeVersionId: recipe.recipe_version_id,
      routeVersionId: route?.route_version_id ?? null,
      snapshotId: snapshot.snapshotId, selectedMemberKey
    }));
    const existing = this.runtime.generationByKey(ownerId, bookId, idempotencyKey);
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash) throw conflict('本次操作编号已经用于另一棵规划树。');
      this.start(existing);
      return this.view(existing);
    }
    const run = this.runtime.createGeneration({
      generationRunId: this.ids.next(), ownerId, bookId, treeKind, scopeId,
      recipeVersionId: recipe.recipe_version_id, sourceSnapshotId: snapshot.snapshotId,
      parentTreeVersionId: parentTreeVersion(snapshot), routeVersionId: route?.route_version_id ?? null,
      assignedMemberKey: fallback[0]!.memberKey,
      memberSnapshot: {
        fallback: fallback.map(memberSnapshot),
        contextFallback: contextFallback.map(memberSnapshot)
      }, idempotencyKey, requestHash,
      now: this.clock.now().toISOString()
    });
    if (run.request_hash !== requestHash) throw conflict('本次操作编号已经用于另一棵规划树。');
    this.start(run);
    return this.view(run);
  }

  public continueRouteToTree(ownerId: string, bookId: string, routeRunId: string, input: {
    selectedMemberKey?: unknown;
  }): V7PlanningTreeGenerationView {
    const routeRun = this.runtime.recipeRun(ownerId, bookId, routeRunId);
    if (routeRun === undefined) throw new DomainError(errorCodes.validation, '全书方向任务不存在或不属于本书。', {}, false, 404);
    const decision = this.runtime.currentConfirmedRouteDecision(ownerId, bookId, routeRunId);
    if (decision === undefined) {
      if (routeRun.status !== 'completed') throw conflict('请先确认当前全书方向，再继续设计正式全书框架。');
      throw conflict('这轮全书方向已经不是当前正式方案，请从当前全书方向继续。');
    }
    const existing = this.runtime.firstBookTreeGenerationForRoute(ownerId, bookId, decision.route_version_id);
    if (existing !== undefined) {
      this.start(existing);
      return this.view(existing);
    }
    return this.create(ownerId, bookId, 'book', bookId, {
      selectedMemberKey: input.selectedMemberKey,
      idempotencyKey: `route-to-book-tree:${sha256(`${ownerId}:${bookId}:${routeRunId}`)}`
    });
  }

  private members(): readonly V7PlanningMemberDefinition[] {
    const members = typeof this.memberSource === 'function' ? this.memberSource() : this.memberSource;
    assertRoster(members);
    return members;
  }

  private contextMembers(): readonly V7CreationMemberDefinition[] {
    const members = typeof this.contextMemberSource === 'function' ? this.contextMemberSource() : this.contextMemberSource;
    creationFallbackChain('context_editor', undefined, members);
    return members;
  }

  public get(ownerId: string, bookId: string, runId: string): V7PlanningTreeGenerationView {
    const run = this.requireRun(ownerId, bookId, runId);
    this.start(run);
    return this.view(this.requireRun(ownerId, bookId, runId));
  }

  public latest(ownerId: string, bookId: string, treeKindValue: unknown, scopeIdValue: unknown): V7PlanningTreeGenerationView | null {
    const treeKind = treeKindOf(treeKindValue);
    const scopeId = text(scopeIdValue, '规划范围', 1, 128, /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u);
    const run = this.runtime.latestGeneration(ownerId, bookId, treeKind, scopeId);
    if (run === undefined) return null;
    this.start(run);
    return this.view(this.requireRun(ownerId, bookId, run.generation_run_id));
  }

  public listTasks(ownerId: string, limit = 50): V7PlanningTaskView[] {
    return this.taskViews(this.runtime.planningGenerationTasks(ownerId, Math.max(1, Math.min(100, limit))));
  }

  public adminTasks(limit = 100): V7PlanningTaskView[] {
    return this.taskViews(this.runtime.adminPlanningGenerationTasks(Math.max(1, Math.min(200, limit))));
  }

  private taskViews(runs: ReturnType<V7PlanningRuntimeRepository['planningGenerationTasks']>): V7PlanningTaskView[] {
    return runs.map((run) => {
      const view = this.view(run);
      const resultLifecycle = run.result_lifecycle;
      const resultAlreadyResolved = view.status === 'ready'
        && resultLifecycle !== null
        && resultLifecycle !== 'candidate';
      const resolvedMessage = resultLifecycle === 'confirmed'
        ? '正式框架已经确认，任务已完成。'
        : '该轮方案已由新版方案接替，历史结果已经保留。';
      return {
        taskId: run.generation_run_id, taskKind: 'planning_tree', ownerId: run.owner_id, bookId: run.book_id, bookTitle: run.book_title,
        status: run.status === 'cancelled' ? 'cancelled'
          : resultAlreadyResolved ? 'completed'
            : view.status === 'ready' ? 'waiting_for_you'
            : view.status === 'result_unknown' ? 'failed' : view.status,
        message: resultAlreadyResolved ? resolvedMessage : view.message,
        progress: view.status === 'ready' ? 100 : view.status === 'working' ? 70 : view.status === 'waiting' ? 10 : 0,
        memberKey: view.member.memberKey, memberName: view.member.name,
        treeKind: run.tree_kind, scopeId: run.scope_id, modelCalls: run.model_calls,
        canStop: view.status === 'waiting' || view.status === 'working', updatedAt: run.updated_at
      };
    });
  }

  public cancel(ownerId: string, bookId: string, runId: string): V7PlanningTreeGenerationView {
    const run = this.requireRun(ownerId, bookId, runId);
    this.requireExecutableRoster(run);
    return this.view(this.runtime.cancelGeneration(ownerId, bookId, run.generation_run_id, this.clock.now().toISOString()));
  }

  public retry(ownerId: string, bookId: string, runId: string): V7PlanningTreeGenerationView {
    const run = this.requireRun(ownerId, bookId, runId);
    this.requireExecutableRoster(run);
    if (run.status === 'unknown' || this.runtime.modelCallsForRun(ownerId, bookId, runId)
      .some((call) => call.state === 'unknown' || call.state === 'working')) {
      throw conflict('这次结果还没有确认，为避免重复扣量不能重新发送。请先刷新查看结果。');
    }
    if (run.status !== 'failed') throw conflict('只有明确失败的规划树任务可以续跑。');
    const retried = this.runtime.retryGeneration(ownerId, bookId, runId, this.clock.now().toISOString());
    if (retried === undefined) throw conflict('任务状态已经变化，请刷新后重试。');
    this.start(retried);
    return this.view(retried);
  }

  public adminRun(ownerId: string, bookId: string, runId: string): unknown {
    const run = this.requireRun(ownerId, bookId, runId);
    return {
      run: { ...run, memberSnapshot: JSON.parse(run.member_snapshot_json) },
      snapshot: this.sources.require(ownerId, bookId, run.source_snapshot_id)
    };
  }

  private executableRoster(run: V7PlanningGenerationRunRow): StoredGenerationRoster | null {
    const stored = readStoredGenerationRoster(run);
    if (stored === null) return null;
    try {
      const fallback = resolveFrozenPlanningMembers(stored.fallback, this.members(), ['planning_writer']);
      const contextFallback = resolveFrozenCreationMembers(
        stored.contextFallback,
        this.contextMembers(),
        ['context_editor']
      );
      let contextMember: V7CreationMemberDefinition | undefined;
      if (stored.contextMember !== undefined) {
        const resolved = resolveFrozenCreationMembers([stored.contextMember], this.contextMembers(), ['context_editor'])[0]!;
        const frozen = contextFallback.find((member) => member.memberKey === resolved.memberKey);
        if (frozen === undefined || !sameMemberBinding(frozen, resolved)) return null;
        contextMember = resolved;
      }
      return {
        fallback,
        contextFallback,
        ...(contextMember === undefined ? {} : { contextMember }),
        ...(stored.contextPlan === undefined ? {} : { contextPlan: stored.contextPlan }),
        ...(stored.stage === undefined ? {} : { stage: stored.stage })
      };
    } catch {
      return null;
    }
  }

  private requireExecutableRoster(run: V7PlanningGenerationRunRow): StoredGenerationRoster {
    const roster = this.executableRoster(run);
    if (roster === null) throw conflict(READ_ONLY_TREE_MESSAGE);
    return roster;
  }

  private markReadOnlyFailure(run: V7PlanningGenerationRunRow): void {
    const current = this.requireRun(run.owner_id, run.book_id, run.generation_run_id);
    if (!['queued', 'working'].includes(current.status)) return;
    this.runtime.markGeneration({
      ownerId: run.owner_id,
      bookId: run.book_id,
      generationRunId: run.generation_run_id,
      status: 'failed',
      errorMessage: READ_ONLY_TREE_MESSAGE,
      now: this.clock.now().toISOString()
    });
  }

  private start(run: V7PlanningGenerationRunRow): void {
    if (!['queued', 'working'].includes(run.status) || this.activeRuns.has(run.generation_run_id)) return;
    if (this.executableRoster(run) === null) {
      this.markReadOnlyFailure(run);
      return;
    }
    this.activeRuns.add(run.generation_run_id);
    void this.execute(run).catch((error) => {
      if (error instanceof V7PlanningModelCallInProgressError) return;
      const current = this.runtime.generation(run.owner_id, run.book_id, run.generation_run_id);
      if (current === undefined || current.status === 'succeeded' || current.status === 'cancelled') return;
      this.runtime.markGeneration({
        ownerId: run.owner_id, bookId: run.book_id, generationRunId: run.generation_run_id,
        status: error instanceof V7PlanningModelError && error.outcomeUnknown ? 'unknown' : 'failed',
        errorMessage: publicFailure(error), now: this.clock.now().toISOString()
      });
    }).finally(() => this.activeRuns.delete(run.generation_run_id));
  }

  private async execute(run: V7PlanningGenerationRunRow): Promise<void> {
    this.ensureActive(run);
    const frozenRoster = this.requireExecutableRoster(run);
    const recipeRow = this.runtime.recipeVersion(run.owner_id, run.book_id, run.recipe_version_id);
    const activeRecipe = this.runtime.activeRecipe(run.owner_id, run.book_id, 'confirmed');
    if (recipeRow === undefined || activeRecipe?.recipe_version_id !== recipeRow.recipe_version_id) {
      throw conflict('全书方法配方已经更新，请重新设计这棵树。');
    }
    const routeRow = run.route_version_id === null ? undefined
      : this.runtime.routeVersion(run.owner_id, run.book_id, run.route_version_id);
    const activeRoute = this.runtime.activeRoute(run.owner_id, run.book_id, 'confirmed');
    if (run.tree_kind === 'book' && (routeRow === undefined
      || activeRoute?.route_version_id !== routeRow.route_version_id
      || routeRow.recipe_version_id !== recipeRow.recipe_version_id)) {
      throw conflict('全书方向已经更新，请重新设计正式全书框架。');
    }
    const snapshot = this.sources.require(run.owner_id, run.book_id, run.source_snapshot_id);
    const latestSnapshot = this.sources.compile({
      ownerId: run.owner_id, bookId: run.book_id, treeKind: run.tree_kind,
      scopeId: run.scope_id, purpose: 'tree_generation'
    });
    if (latestSnapshot.sourceFingerprint !== snapshot.sourceFingerprint) {
      throw conflict('开书资料、设定或上层规划已经更新，请重新设计这棵树。');
    }
    const contextPlan = await this.ensureContextPlan(run, snapshot, frozenRoster);
    const focusedSnapshot = focusedPlanningTreeSnapshot(snapshot, contextPlan.request);
    const recipe = JSON.parse(recipeRow.recipe_json) as LayeredPlanningRecipe;
    const recipeNodeId = selectRecipeNode(recipe, run.tree_kind, run.scope_id).nodeId;
    const layeredTask = compileLayeredPlanningTask({
      recipe, nodeId: recipeNodeId, sources: planningSources(focusedSnapshot), mode: 'runtime'
    });
    const sourceRefs = treeSourceRefs(focusedSnapshot);
    const generationTask = compilePlanningTreeGenerationTask({
      treeKind: run.tree_kind, scopeId: run.scope_id, sourceRefs,
      parentDirection: parentDirection(focusedSnapshot)
    });
    const referencePack = buildPlanningLayerReferencePack(run.tree_kind, contextPlan.candidates);
    const prompt = planningTreeGenerationPrompt({
      treeKind: run.tree_kind, scopeId: run.scope_id,
      sourceSnapshot: {
        ...publicSnapshot(focusedSnapshot),
        ...(routeRow === undefined ? {} : { confirmedStoryRoute: JSON.parse(routeRow.route_json) })
      },
      contextPlan: planningTaskContextPlan(contextPlan.request),
      layeredTask, generationTask, referencePack
    });
    const roster = this.requireExecutableRoster(this.requireRun(run.owner_id, run.book_id, run.generation_run_id));
    let lastError: unknown;
    for (const [index, member] of roster.fallback.entries()) {
      this.ensureActive(run);
      this.markWorking(
        run,
        member.memberKey,
        { ...roster, fallback: roster.fallback.map(memberSnapshot), stage: 'tree_design' }
      );
      const logicalTaskId = `${run.generation_run_id}:tree:${index + 1}`;
      const attempt = this.modelAttempt(run, logicalTaskId);
      try {
        const result = await this.models.generate({
          ...attempt, ownerId: run.owner_id, bookId: run.book_id, runId: run.generation_run_id,
          runKind: 'tree', nodeKey: `${run.tree_kind}:${run.scope_id}`, member,
          taskKind: 'planning_tree',
          failFastOnGenreProfileLease: true,
          workstationKey: run.tree_kind === 'volume' ? 'volume' : run.tree_kind === 'chain' ? 'chain' : 'full_book_route',
          operationMode: 'fresh', basedOnTaskId: null, authorInstructionVersion: null,
          sourceTraces: planningSnapshotSourceTraces(focusedSnapshot),
          prompt, maxOutputTokens: treeOutputLimit(run.tree_kind), temperature: 0.66
        });
        this.ensureActive(run);
        let acceptedRequestId = result.requestId;
        let document: ReturnType<typeof parsePlanningTreeOutput>;
        try {
          document = parsePlanningTreeOutput(result.output, run.tree_kind, run.scope_id, referencePack);
        } catch (contractError) {
          const repairLogicalTaskId = `${logicalTaskId}:repair`;
          const repairAttempt = this.modelAttempt(run, repairLogicalTaskId);
          const repaired = await this.models.generate({
            ...repairAttempt, ownerId: run.owner_id, bookId: run.book_id, runId: run.generation_run_id,
            runKind: 'tree', nodeKey: `${run.tree_kind}:${run.scope_id}:repair`, member,
            taskKind: 'planning_tree',
            failFastOnGenreProfileLease: true,
            workstationKey: run.tree_kind === 'volume' ? 'volume' : run.tree_kind === 'chain' ? 'chain' : 'full_book_route',
            operationMode: 'repair', basedOnTaskId: result.requestId, authorInstructionVersion: null,
            sourceTraces: planningSnapshotSourceTraces(focusedSnapshot),
            prompt: planningTreeRepairPrompt({
              treeKind: run.tree_kind,
              scopeId: run.scope_id,
              invalidOutput: result.output,
              validationMessage: errorMessage(contractError)
            }),
            maxOutputTokens: treeOutputLimit(run.tree_kind), temperature: 0.22
          });
          this.ensureActive(run);
          document = parsePlanningTreeOutput(repaired.output, run.tree_kind, run.scope_id, referencePack);
          acceptedRequestId = repaired.requestId;
        }
        const stillActive = this.runtime.activeRecipe(run.owner_id, run.book_id, 'confirmed');
        const stillActiveRoute = this.runtime.activeRoute(run.owner_id, run.book_id, 'confirmed');
        const currentSnapshot = this.sources.compile({
          ownerId: run.owner_id, bookId: run.book_id, treeKind: run.tree_kind,
          scopeId: run.scope_id, purpose: 'tree_generation'
        });
        if (stillActive?.recipe_version_id !== run.recipe_version_id
          || (run.tree_kind === 'book' && stillActiveRoute?.route_version_id !== run.route_version_id)
          || currentSnapshot.sourceFingerprint !== snapshot.sourceFingerprint) {
          throw conflict('设计期间上层资料已经变化，本次结果没有写入。');
        }
        const expectedRevision = this.trees.head(run.owner_id, run.book_id, run.tree_kind, run.scope_id)?.revision ?? 0;
        const saved = this.treeService.saveGeneratedCandidate({
          ownerId: run.owner_id, bookId: run.book_id, treeKind: run.tree_kind, scopeId: run.scope_id,
          expectedRevision, document, sourceRefs, idempotencyKey: `tree-generation:${run.generation_run_id}`,
          createdBy: member.memberKey
        });
        this.ensureActive(run);
        this.runtime.markGeneration({
          ownerId: run.owner_id, bookId: run.book_id, generationRunId: run.generation_run_id,
          status: 'succeeded', requestId: acceptedRequestId, candidateTreeVersionId: saved.versionId,
          assignedMemberKey: member.memberKey, errorMessage: null, now: this.clock.now().toISOString()
        });
        return;
      } catch (error) {
        if (error instanceof V7PlanningModelError && error.outcomeUnknown) throw error;
        if (error instanceof DomainError) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new Error('没有规划成员完成这棵树');
  }

  private async ensureContextPlan(
    run: V7PlanningGenerationRunRow,
    snapshot: V7PlanningCompiledSnapshot,
    frozenRoster: StoredGenerationRoster
  ): Promise<NonNullable<StoredGenerationRoster['contextPlan']>> {
    let roster = frozenRoster;
    if (roster.contextPlan !== undefined) return roster.contextPlan;
    const failures: string[] = [];
    for (const member of roster.contextFallback) {
      const logicalTaskId = `${run.generation_run_id}:context:${member.memberKey}`;
      const attempt = this.modelAttempt(run, logicalTaskId);
      roster = { ...roster, contextMember: member, stage: 'context_planning' };
      this.markWorking(run, member.memberKey, roster);
      try {
        this.ensureActive(run);
        const result = await this.models.generate({
          ...attempt, ownerId: run.owner_id, bookId: run.book_id, runId: run.generation_run_id,
          runKind: 'tree', nodeKey: 'context_plan', member,
          taskKind: 'planning_context', workstationKey: planningWorkstation(run.tree_kind),
          failFastOnGenreProfileLease: true,
          operationMode: 'fresh', basedOnTaskId: null, authorInstructionVersion: null,
          sourceTraces: planningSnapshotSourceTraces(snapshot),
          prompt: planningMethodSearchPrompt({
            seatName: `${planningTreeName(run.tree_kind)}资料策划`,
            seatResponsibility: `只为本次${planningTreeName(run.tree_kind)}选择最小充分资料、准确方法范围、临时题材身份和创意边界。`,
            independentFocus: [
              '岗位没有固定专业人设，只按本书融合题材和当前任务形成临时工作身份',
              '只选择会改变当前层设计的正式设定，已确认上层方向和正文实际必须保留',
              '方法可以复用到不同层级，但本轮只能按当前层责任检索，不能把整库方法塞给执行成员',
              '保留成员组合、忽略候选方法和原创设计的空间'
            ],
            allowedPlanningLayers: allowedTreePlanningLayers(run.tree_kind),
            sourceSnapshot: planningMethodSearchSnapshot(snapshot)
          }),
          maxOutputTokens: 2_500,
          temperature: 0.28
        });
        this.ensureActive(run);
        const missing = extractPlanningCriticalInputs(result.output);
        if (missing.length > 0) throw new Error(`资料仍有关键缺口：${missing.join('；')}`);
        const request = normalizePlanningSettingSourceIds(
          snapshot,
          parsePlanningMethodSearchRequest(result.output, { requireTaskProfile: true })
        );
        validateTreePlanningLayers(run.tree_kind, request);
        focusedPlanningTreeSnapshot(snapshot, request);
        const retrieval = retrievePlanningMethodCandidates(request);
        const contextPlan = { request, candidates: retrieval.candidates };
        roster = { ...roster, contextMember: member, contextPlan, stage: 'tree_design' };
        this.runtime.markGeneration({
          ownerId: run.owner_id, bookId: run.book_id, generationRunId: run.generation_run_id,
          status: 'working', assignedMemberKey: roster.fallback[0]!.memberKey, memberSnapshot: roster,
          errorMessage: null, now: this.clock.now().toISOString()
        });
        return contextPlan;
      } catch (error) {
        if (error instanceof DomainError) throw error;
        failures.push(`${member.displayName}：${errorMessage(error)}`);
        if (error instanceof V7PlanningModelError && error.outcomeUnknown) throw error;
      }
    }
    throw new Error(`资料策划没有完成。${failures.join('；')}`);
  }

  private modelAttempt(
    run: V7PlanningGenerationRunRow,
    logicalTaskId: string
  ): { requestId: string; logicalTaskId?: string; technicalRetry?: true } {
    let latest: ReturnType<V7PlanningRuntimeRepository['modelCall']> = undefined;
    let latestAttempt = -1;
    for (let attempt = 0; attempt <= run.retry_count; attempt += 1) {
      const requestId = attempt === 0 ? logicalTaskId : `${logicalTaskId}:retry:${attempt}`;
      const call = this.runtime.modelCall(requestId);
      if (call !== undefined) {
        latest = call;
        latestAttempt = attempt;
      }
    }
    if (latest?.state === 'succeeded' || latest?.state === 'working') return { requestId: latest.request_id };
    if (latest?.state === 'unknown') {
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

  private requireRun(ownerId: string, bookId: string, runId: string): V7PlanningGenerationRunRow {
    const run = this.runtime.generation(ownerId, bookId, runId);
    if (run === undefined) throw new DomainError(errorCodes.validation, '规划树任务不存在或不属于本书。', {}, false, 404);
    return run;
  }

  private markWorking(run: V7PlanningGenerationRunRow, assignedMemberKey: string, memberSnapshotValue: unknown): void {
    const current = this.requireRun(run.owner_id, run.book_id, run.generation_run_id);
    if (current.status === 'working') return;
    if (current.status === 'queued') {
      const changed = this.runtime.markGenerationWorking({
        ownerId: run.owner_id,
        bookId: run.book_id,
        generationRunId: run.generation_run_id,
        assignedMemberKey,
        memberSnapshot: memberSnapshotValue,
        now: this.clock.now().toISOString()
      });
      if (changed) return;
    }
    const latest = this.requireRun(run.owner_id, run.book_id, run.generation_run_id);
    if (latest.status === 'working') return;
    if (latest.status === 'unknown') {
      throw new V7PlanningModelError('上一次调用结果尚未确认，已停止重复扣量。', true);
    }
    throw new V7PlanningModelCallInProgressError('规划任务进度已经由另一服务实例接手。');
  }

  private ensureActive(run: V7PlanningGenerationRunRow): void {
    if (this.requireRun(run.owner_id, run.book_id, run.generation_run_id).status === 'cancelled') {
      throw conflict('任务已停止，已经完成的内容仍然保留。');
    }
  }

  private view(run: V7PlanningGenerationRunRow): V7PlanningTreeGenerationView {
    const stored = readStoredGenerationRoster(run);
    const roster = this.executableRoster(run);
    const displayRoster = roster ?? stored;
    const member = displayRoster?.contextMember?.memberKey === run.assigned_member_key
      ? displayRoster.contextMember
      : displayRoster?.fallback.find((candidate) => candidate.memberKey === run.assigned_member_key)
        ?? displayRoster?.fallback[0]
        ?? { memberKey: run.assigned_member_key, displayName: '历史规划成员' };
    const readOnly = roster === null;
    // Retiring a frozen member/model binding only removes execution authority.
    // It must not rewrite an already-succeeded generation with a persisted
    // candidate into a failure: Time Machine reads this view alongside the
    // confirmed tree, and that contradiction used to hide valid book history.
    const preservedReadOnlyResult = readOnly
      && run.status === 'succeeded'
      && run.candidate_tree_version_id !== null;
    const status = preservedReadOnlyResult ? 'ready' : readOnly ? 'failed' : publicStatus(run.status);
    const head = run.candidate_tree_version_id === null
      ? undefined
      : this.trees.head(run.owner_id, run.book_id, run.tree_kind, run.scope_id);
    const canOpenCandidate = run.status === 'succeeded'
      && run.candidate_tree_version_id !== null
      && head?.candidate_version_id === run.candidate_tree_version_id;
    return {
      runId: run.generation_run_id, treeKind: run.tree_kind, scopeId: run.scope_id, status,
      message: preservedReadOnlyResult ? '方案已经完成并安全保留，可以继续查看正式框架。'
        : readOnly ? READ_ONLY_TREE_MESSAGE
        : status === 'ready' ? '方案已经设计好，等您查看和确认。'
        : status === 'failed' ? (run.error_message ?? '对不起，这次没有完成，您可以重新下单。')
          : status === 'result_unknown' ? '抱歉，这次结果还没有确认，为避免重复消耗已经暂停。'
            : status === 'working' && roster.stage === 'context_planning'
              ? `${member.displayName}正在整理本次真正需要的资料和方法，完成后会自动继续。`
              : status === 'working' ? `${member.displayName}正在认真设计，完成后会自动保存。`
              : '任务已经保存，马上开始设计。',
      member: { memberKey: member.memberKey, name: member.displayName },
      candidateTreeVersionId: run.candidate_tree_version_id,
      canOpenCandidate,
      errorMessage: preservedReadOnlyResult ? null : readOnly ? READ_ONLY_TREE_MESSAGE : run.error_message,
      timing: planningGenerationTiming(run, this.clock.now())
    };
  }
}

function planningGenerationTiming(run: V7PlanningGenerationRunRow, now: Date): V7PlanningTreeGenerationView['timing'] {
  const current = now.getTime();
  const created = Date.parse(run.created_at);
  const updated = Date.parse(run.updated_at);
  const elapsedSeconds = Number.isFinite(created) ? Math.max(0, Math.floor((current - created) / 1_000)) : 0;
  const idleSeconds = Number.isFinite(updated) ? Math.max(0, Math.floor((current - updated) / 1_000)) : 0;
  const active = run.status === 'queued' || run.status === 'working';
  return {
    createdAt: run.created_at,
    lastActivityAt: run.updated_at,
    elapsedSeconds,
    idleSeconds,
    state: !active || idleSeconds < 300 ? 'normal' : idleSeconds < 900 ? 'slow' : 'overdue'
  };
}

function readStoredGenerationRoster(run: V7PlanningGenerationRunRow): StoredGenerationRoster | null {
  try {
    const parsed = JSON.parse(run.member_snapshot_json) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const value = parsed as Partial<StoredGenerationRoster>;
    if (!Array.isArray(value.fallback) || !Array.isArray(value.contextFallback)) return null;
    return {
      fallback: value.fallback,
      contextFallback: value.contextFallback,
      ...(value.contextMember === undefined ? {} : { contextMember: value.contextMember }),
      ...(value.contextPlan === undefined ? {} : { contextPlan: value.contextPlan }),
      ...(value.stage === 'context_planning' || value.stage === 'tree_design' ? { stage: value.stage } : {})
    } as StoredGenerationRoster;
  } catch {
    return null;
  }
}

function planningTreeName(treeKind: PlanningTreeKind): string {
  if (treeKind === 'book') return '全书方向树';
  if (treeKind === 'volume') return '单卷树';
  return '单元链树';
}

function allowedTreePlanningLayers(treeKind: PlanningTreeKind): readonly PlanningLayerKey[] {
  if (treeKind === 'book') return ['book_backbone', 'volume_distribution'];
  return [treeKind];
}

function planningWorkstation(treeKind: PlanningTreeKind): 'full_book_route' | 'volume' | 'chain' {
  return treeKind === 'book' ? 'full_book_route' : treeKind;
}

function validateTreePlanningLayers(treeKind: PlanningTreeKind, request: V7PlanningMethodSearchRequest): void {
  const allowed = new Set<PlanningLayerKey>(allowedTreePlanningLayers(treeKind));
  if (request.planningLayers.some((layer) => !allowed.has(layer))) {
    throw new Error(`资料策划检索了不属于${planningTreeName(treeKind)}的方法层级`);
  }
  const required = treeKind === 'book' ? 'book_backbone' : treeKind;
  if (!request.planningLayers.includes(required)) throw new Error(`资料策划遗漏了${planningTreeName(treeKind)}的核心方法层级`);
}

function focusedPlanningTreeSnapshot(
  snapshot: V7PlanningCompiledSnapshot,
  request: V7PlanningMethodSearchRequest
): V7PlanningCompiledSnapshot {
  if (request.missingCriticalInputs.length > 0) throw new Error(`资料仍有关键缺口：${request.missingCriticalInputs.join('；')}`);
  const settingSources = snapshot.sources.filter((source) => source.sourceKind === 'setting');
  const ledgers = settingSources.filter(isSettingLedgerSource);
  const itemSources = settingSources.filter((source) => !isSettingLedgerSource(source));
  const allowed = new Set(itemSources.map((source) => source.sourceId));
  const requested = new Set(request.relevantSettingSourceIds);
  const unknown = [...requested].filter((sourceId) => !allowed.has(sourceId));
  if (unknown.length > 0) throw new Error('资料策划选择了不属于本书的设定资料');
  const selectedItems = itemSources.filter((source) => requested.has(source.sourceId));
  if (selectedItems.length === 0) throw new Error('资料策划没有选出本任务需要的正式设定资料');
  const selectedSources = snapshot.sources.filter((source) => source.sourceKind !== 'setting'
    || ledgers.some((ledger) => ledger.sourceId === source.sourceId)
    || requested.has(source.sourceId));
  const excluded = itemSources.filter((source) => !requested.has(source.sourceId)).map((source) => ({
    sourceKind: source.sourceKind,
    sourceId: source.sourceId,
    sourceVersion: source.sourceVersion,
    authority: source.authority,
    label: source.label,
    contentHash: source.contentHash,
    reason: `${source.label}与本次${planningTreeName(snapshot.treeKind)}没有直接关系，本轮不注入。`
  }));
  return {
    ...snapshot,
    sources: selectedSources,
    excludedSources: [...snapshot.excludedSources, ...excluded.map((source) => source.reason)],
    excludedSourceDecisions: [...snapshot.excludedSourceDecisions, ...excluded]
  };
}

/**
 * 早期树任务没有把逐项事实的 sourceId 交给资料策划，模型只能引用同一
 * 正式事实源 content 中的 itemKey。只在当前冻结快照内存在唯一一对一
 * 对应时做标识归一；未知、重复或跨书值继续交给严格校验拒绝。
 */
function normalizePlanningSettingSourceIds(
  snapshot: V7PlanningCompiledSnapshot,
  request: V7PlanningMethodSearchRequest
): V7PlanningMethodSearchRequest {
  const itemSources = snapshot.sources.filter((source) => source.sourceKind === 'setting' && !isSettingLedgerSource(source));
  const sourceIds = new Set(itemSources.map((source) => source.sourceId));
  const aliases = new Map<string, string | null>();
  for (const source of itemSources) {
    const itemKey = planningSettingItemKey(source);
    if (itemKey === null) continue;
    if (aliases.has(itemKey)) aliases.set(itemKey, null);
    else aliases.set(itemKey, source.sourceId);
  }
  const normalized = request.relevantSettingSourceIds.map((reference) => {
    if (sourceIds.has(reference)) return reference;
    const sourceId = aliases.get(reference);
    return sourceId === undefined || sourceId === null ? reference : sourceId;
  });
  return { ...request, relevantSettingSourceIds: [...new Set(normalized)] };
}

function planningSettingItemKey(source: V7PlanningCompiledSnapshot['sources'][number]): string | null {
  if (source.sourceKind !== 'setting' || source.content === null
    || typeof source.content !== 'object' || Array.isArray(source.content)) return null;
  const content = source.content as { schema?: unknown; itemKey?: unknown };
  return content.schema === 'v7-setting-fact-source-v1'
    && typeof content.itemKey === 'string' && content.itemKey.length > 0
    ? content.itemKey
    : null;
}

function isSettingLedgerSource(source: V7PlanningCompiledSnapshot['sources'][number]): boolean {
  if (source.sourceKind !== 'setting' || source.content === null
    || typeof source.content !== 'object' || Array.isArray(source.content)) return false;
  return (source.content as { schema?: unknown }).schema === 'v7-compact-setting-ledger-v1';
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

function selectRecipeNode(recipe: LayeredPlanningRecipe, treeKind: PlanningTreeKind, scopeId: string): LayeredRecipeNode {
  const nodes: LayeredRecipeNode[] = [];
  const visit = (node: LayeredRecipeNode): void => { nodes.push(node); node.children.forEach(visit); };
  visit(recipe.root);
  const exact = nodes.find((node) => node.nodeId === scopeId);
  if (exact !== undefined) return exact;
  if (treeKind === 'book') return recipe.root;
  if (treeKind === 'volume') return nodes.find((node) => node.layer === 'volume')
    ?? nodes.find((node) => node.layer === 'volume_distribution') ?? recipe.root;
  return nodes.find((node) => node.layer === 'chain')
    ?? nodes.find((node) => node.layer === 'volume')
    ?? nodes.find((node) => node.layer === 'volume_distribution') ?? recipe.root;
}

function planningSources(snapshot: V7PlanningCompiledSnapshot): PlanningSourceItem[] {
  return snapshot.sources.map((source) => ({
    sourceId: source.sourceId,
    kind: source.authority === 'goal' ? 'goal' : 'formal',
    label: source.label,
    content: JSON.stringify(source.content),
    version: source.sourceVersion
  }));
}

function treeSourceRefs(snapshot: V7PlanningCompiledSnapshot): PlanningTreeSourceRef[] {
  return snapshot.sources.map((source) => ({
    sourceKind: source.sourceKind,
    sourceId: source.sourceId,
    version: source.sourceVersion
  }));
}

function parentTreeVersion(snapshot: V7PlanningCompiledSnapshot): string | null {
  return snapshot.sources.find((source) => source.sourceKind === 'confirmed_tree')?.sourceId ?? null;
}

function parentDirection(snapshot: V7PlanningCompiledSnapshot): string | null {
  const parent = snapshot.sources.find((source) => source.sourceKind === 'confirmed_tree');
  return parent === undefined ? null : JSON.stringify(parent.content);
}

function publicSnapshot(snapshot: V7PlanningCompiledSnapshot): Record<string, unknown> {
  return {
    treeKind: snapshot.treeKind, scopeId: snapshot.scopeId,
    sources: snapshot.sources.map((source) => ({
      authority: source.authority, label: source.label, content: source.content, includedReason: source.includedReason
    })),
    excludedSources: snapshot.excludedSources
  };
}

function planningMethodSearchSnapshot(snapshot: V7PlanningCompiledSnapshot): Record<string, unknown> {
  return {
    treeKind: snapshot.treeKind,
    scopeId: snapshot.scopeId,
    sources: snapshot.sources.map((source) => ({
      sourceKind: source.sourceKind,
      sourceId: source.sourceId,
      sourceVersion: source.sourceVersion,
      authority: source.authority,
      label: source.label,
      content: source.content,
      includedReason: source.includedReason
    })),
    excludedSources: snapshot.excludedSources
  };
}

function memberSnapshot<T extends V7PlanningMemberDefinition | V7CreationMemberDefinition>(member: T): T {
  return { ...member, model: { ...member.model } };
}

function sameMemberBinding(
  left: V7PlanningMemberDefinition | V7CreationMemberDefinition,
  right: V7PlanningMemberDefinition | V7CreationMemberDefinition
): boolean {
  return left.memberKey === right.memberKey
    && left.roleKey === right.roleKey
    && left.model.provider === right.model.provider
    && left.model.modelId === right.model.modelId
    && left.model.plan === right.model.plan;
}

function publicStatus(status: V7PlanningGenerationRunRow['status']): V7PlanningTreeGenerationView['status'] {
  if (status === 'queued') return 'waiting';
  if (status === 'working') return 'working';
  if (status === 'succeeded') return 'ready';
  if (status === 'unknown') return 'result_unknown';
  return 'failed';
}

function treeKindOf(value: unknown): PlanningTreeKind {
  if (value === 'book' || value === 'volume' || value === 'chain') return value;
  throw new DomainError(errorCodes.validation, '规划树类型无效。');
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return text(value, label, 1, max);
}

function text(value: unknown, label: string, min: number, max: number, pattern?: RegExp): string {
  if (typeof value !== 'string') throw new DomainError(errorCodes.validation, `${label}无效。`);
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < min || length > max || (pattern !== undefined && !pattern.test(normalized))) {
    throw new DomainError(errorCodes.validation, `${label}无效。`);
  }
  return normalized;
}

function conflict(message: string): DomainError {
  return new DomainError(errorCodes.planningTreeVersionConflict, message, {}, false, 409);
}

function publicFailure(error: unknown): string {
  return `对不起，这次没有完成。${errorMessage(error).slice(0, 300)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function treeOutputLimit(treeKind: PlanningTreeKind): number {
  if (treeKind === 'book') return 18_000;
  if (treeKind === 'volume') return 14_000;
  return 10_000;
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

function assertRoster(members: readonly V7PlanningMemberDefinition[]): void {
  const errors = validatePlanningEditorialRoster(members);
  if (errors.length > 0) throw new Error(`V7规划成员名册无效：${errors.join('；')}`);
}
