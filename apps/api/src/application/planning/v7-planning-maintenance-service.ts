import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildPlanningFallbackChain,
  containsNode,
  parsePlanningMaintenanceOutput,
  planningMaintenancePrompt,
  V7_PLANNING_MEMBERS,
  validatePlanningEditorialRoster,
  type PlanningNodeActual,
  type PlanningTreeDocument,
  type V7ChapterSettlement,
  type V7PlanningMaintenanceOutput,
  type V7PlanningMemberDefinition
} from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import {
  V7PlanningRuntimeRepository,
  type V7PlanningMaintenanceRunRow
} from '../../infrastructure/db/repositories/v7-planning-runtime-repository.js';
import {
  V7PlanningModelError,
  V7PlanningModelGateway,
  type V7PlanningModelAdapterResolver
} from '../../infrastructure/models/v7-planning-model-gateway.js';
import { V7PlanningTreeService } from './v7-planning-tree-service.js';
import {
  readFrozenPlanningMembers,
  resolveFrozenPlanningMembers
} from './v7-planning-task-roster-snapshot.js';

type SettlementKind = V7PlanningMaintenanceRunRow['source_kind'];

interface VerifiedSettlement {
  sourceKind: SettlementKind;
  sourceVersionId: string;
  sourceHash: string;
  payload: Record<string, unknown>;
  evidenceRefs: string[];
}

interface ConfirmedTreeSnapshot {
  treeKind: 'book' | 'volume' | 'chain';
  scopeId: string;
  versionId: string;
  revision: number;
  contentHash: string;
  document: PlanningTreeDocument;
}

export interface V7PlanningMaintenanceView {
  runId: string;
  status: 'waiting' | 'working' | 'completed' | 'failed' | 'result_unknown';
  message: string;
  member: { memberKey: string; name: string };
  actualCount: number;
  suggestionCount: number;
  errorMessage: string | null;
}

type PlanningMemberSource = readonly V7PlanningMemberDefinition[] | (() => readonly V7PlanningMemberDefinition[]);
type StoredMaintenanceRoster = {
  fallback: V7PlanningMemberDefinition[];
  mode?: 'same_settlement_call';
};

const READ_ONLY_MAINTENANCE_MESSAGE = '对不起，这项规划维护任务不能继续执行。正式结算和已有结果均已保留。';

export class V7PlanningMaintenanceService {
  private readonly runtime: V7PlanningRuntimeRepository;
  private readonly treeService: V7PlanningTreeService;
  private readonly models: V7PlanningModelGateway;
  private readonly activeRuns = new Set<string>();

  public constructor(
    database: DatabaseSync,
    adapters: V7PlanningModelAdapterResolver,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly memberSource: PlanningMemberSource = V7_PLANNING_MEMBERS
  ) {
    this.runtime = new V7PlanningRuntimeRepository(database);
    this.treeService = new V7PlanningTreeService(database, ids, clock);
    this.models = new V7PlanningModelGateway(database, adapters, clock);
    assertRoster(this.members());
  }

  /** 只供正式结算成功后的内部流程调用。 */
  public trigger(ownerId: string, bookId: string, sourceKindValue: unknown, sourceVersionIdValue: unknown): V7PlanningMaintenanceView {
    const sourceKind = settlementKind(sourceKindValue);
    const sourceVersionId = text(sourceVersionIdValue, '结算版本', 1, 160);
    const settlement = this.verifiedSettlement(ownerId, bookId, sourceKind, sourceVersionId);
    const trees = this.confirmedTrees(ownerId, bookId);
    if (trees.length === 0) throw conflict('本书还没有已确认规划，不需要更新规划进度。');
    const existing = this.runtime.maintenanceBySource(ownerId, bookId, sourceKind, sourceVersionId);
    if (existing !== undefined) {
      if (existing.source_hash !== settlement.sourceHash) throw conflict('同一结算版本的正式内容已经变化，请先核查正史。');
      this.start(existing);
      return this.view(existing);
    }
    const fallback = buildPlanningFallbackChain('continuity_editor', { members: this.members() });
    const now = this.clock.now().toISOString();
    const run = this.runtime.createMaintenance({
      runId: this.ids.next(), ownerId, bookId, sourceKind, sourceVersionId,
      sourceHash: settlement.sourceHash, sourceSnapshot: settlement,
      confirmedTreeRefs: trees, assignedMemberKey: fallback[0]!.memberKey,
      memberSnapshot: { fallback: fallback.map(memberSnapshot) }, now
    });
    this.start(run);
    return this.view(run);
  }

  /**
   * 章节结算员已经在同一次正文证据提取中给出了带节点编号的 treeActuals。
   * 系统只核对这些编号确实属于当前确认树并幂等落库，不能再把整本树交给
   * 第二个模型重新理解一次。这样一章只做一次语义结算，规划更新是确定性分发。
   */
  public recordChapterActuals(
    ownerId: string,
    bookId: string,
    sourceVersionIdValue: unknown,
    actuals: V7ChapterSettlement['treeActuals'],
    settlementMemberKey: string
  ): V7PlanningMaintenanceView {
    const sourceVersionId = text(sourceVersionIdValue, '结算版本', 1, 160);
    const settlement = this.verifiedSettlement(ownerId, bookId, 'chapter_settlement', sourceVersionId);
    const trees = this.confirmedTrees(ownerId, bookId);
    if (trees.length === 0) throw conflict('本书还没有已确认规划，不需要更新规划进度。');
    const drafts: V7PlanningMaintenanceOutput['actuals'] = actuals.map((actual) => ({
      treeKind: actual.treeKind,
      scopeId: actual.scopeId,
      nodeKey: actual.nodeKey,
      state: actual.state,
      summary: actual.summary,
      emotionResult: actual.emotionResult,
      experienceResult: actual.experienceResult,
      outcome: actual.outcome
    }));
    const suggestions: V7PlanningMaintenanceOutput['suggestions'] = drafts
      .filter((actual) => actual.state === 'deviated')
      .map((actual) => ({
        treeKind: actual.treeKind,
        scopeId: actual.scopeId,
        nodeKey: actual.nodeKey,
        publicSummary: `正文实际已偏离“${actual.summary}”对应的原规划节点。`,
        reason: actual.outcome,
        proposedChange: '后续规划应以本章正式实际为起点重新计算，不得覆盖已定稿正文。'
      }));
    const output: V7PlanningMaintenanceOutput = {
      schema: 'v7-planning-maintenance-v1',
      publicSummary: drafts.length === 0 ? '本章没有需要更新的规划节点。' : '本章实际进度已经按正式结算记录。',
      actuals: drafts,
      suggestions
    };
    this.validateTargets(output, trees);
    const existing = this.runtime.maintenanceBySource(ownerId, bookId, 'chapter_settlement', sourceVersionId);
    if (existing !== undefined) {
      if (existing.source_hash !== settlement.sourceHash) throw conflict('同一结算版本的正式内容已经变化，请先核查正史。');
      if (existing.status === 'succeeded') return this.view(existing);
      if (existing.status === 'unknown' || existing.status === 'working') {
        throw conflict('原规划更新任务仍在处理或结果未确认，不能重复落库。');
      }
    }
    const fallback = existing === undefined
      ? buildPlanningFallbackChain('continuity_editor', {
          ...(this.members().some((member) => member.memberKey === settlementMemberKey
            && member.roleKey === 'continuity_editor' && member.enabledByDefault)
            ? { selectedMemberKey: settlementMemberKey }
            : {}),
          members: this.members()
        })
      : this.requireExecutableRoster(existing).fallback;
    const now = this.clock.now().toISOString();
    const run = existing ?? this.runtime.createMaintenance({
      runId: this.ids.next(), ownerId, bookId, sourceKind: 'chapter_settlement', sourceVersionId,
      sourceHash: settlement.sourceHash, sourceSnapshot: { ...settlement, treeActuals: actuals },
      confirmedTreeRefs: trees.map((tree) => ({
        treeKind: tree.treeKind, scopeId: tree.scopeId, versionId: tree.versionId,
        revision: tree.revision, contentHash: tree.contentHash
      })),
      assignedMemberKey: fallback[0]!.memberKey,
      memberSnapshot: { fallback: fallback.map(memberSnapshot), mode: 'same_settlement_call' }, now
    });
    for (const draft of drafts) {
      const actual: PlanningNodeActual = {
        ...draft,
        sourceKind: 'chapter_settlement',
        sourceVersionId,
        evidenceRefs: settlement.evidenceRefs,
        recordedAt: now
      };
      this.treeService.recordActual(ownerId, bookId, draft.treeKind, draft.scopeId, {
        actual,
        idempotencyKey: `actual:${run.maintenance_run_id}:${draft.treeKind}:${draft.scopeId}:${draft.nodeKey}`
      });
    }
    for (const suggestion of suggestions) {
      this.runtime.saveAdjustmentSuggestion({
        suggestionId: this.ids.next(), ownerId, bookId,
        treeKind: suggestion.treeKind, scopeId: suggestion.scopeId, nodeKey: suggestion.nodeKey,
        sourceKind: 'chapter_settlement', sourceVersionId,
        publicSummary: suggestion.publicSummary, suggestion, now
      });
    }
    this.runtime.markMaintenance({
      ownerId, bookId, runId: run.maintenance_run_id, status: 'succeeded',
      assignedMemberKey: fallback[0]!.memberKey,
      requestId: `embedded-settlement:${sourceVersionId}`,
      result: output, errorMessage: null, now
    });
    return this.view(this.requireRun(ownerId, bookId, run.maintenance_run_id));
  }

  private members(): readonly V7PlanningMemberDefinition[] {
    const members = typeof this.memberSource === 'function' ? this.memberSource() : this.memberSource;
    assertRoster(members);
    return members;
  }

  public get(ownerId: string, bookId: string, runId: string): V7PlanningMaintenanceView {
    const run = this.requireRun(ownerId, bookId, runId);
    this.start(run);
    return this.view(this.requireRun(ownerId, bookId, runId));
  }

  public retry(ownerId: string, bookId: string, runId: string): V7PlanningMaintenanceView {
    const row = this.requireRun(ownerId, bookId, runId);
    this.requireExecutableRoster(row);
    if (row.status === 'unknown' || this.runtime.modelCallsForRun(ownerId, bookId, runId)
      .some((call) => call.state === 'unknown' || call.state === 'working')) {
      throw conflict('上次结果还没确认，为避免重复扣量不能重试。');
    }
    if (row.status !== 'failed') throw conflict('只有明确失败的规划维护任务可以重试。');
    if (this.runtime.resetMaintenanceForRetry(ownerId, bookId, runId, this.clock.now().toISOString()) !== 1) {
      throw conflict('规划维护任务状态已经变化。');
    }
    const reset = this.requireRun(ownerId, bookId, runId);
    this.start(reset);
    return this.view(reset);
  }

  public pendingSuggestions(ownerId: string, bookId: string): unknown[] {
    return this.runtime.pendingAdjustmentSuggestions(ownerId, bookId).map((row) => ({
      suggestionId: row.suggestionId,
      treeKind: row.treeKind,
      scopeId: row.scopeId,
      nodeKey: row.nodeKey,
      publicSummary: row.publicSummary,
      detail: typeof row.suggestion === 'string' ? JSON.parse(row.suggestion) as unknown : row.suggestion,
      createdAt: row.createdAt
    }));
  }

  public decideSuggestion(ownerId: string, bookId: string, suggestionIdValue: unknown, input: {
    decision?: unknown;
    authorNote?: unknown;
    idempotencyKey?: unknown;
  }): { suggestionId: string; state: 'accepted' | 'dismissed'; nextEffect: 'next_candidate_only' | 'none' } {
    const suggestionId = text(suggestionIdValue, '规划建议', 1, 160);
    const decision = input.decision === 'accept' || input.decision === 'dismiss' ? input.decision : null;
    if (decision === null) throw new DomainError(errorCodes.validation, '请选择采纳或暂不采纳。');
    const authorNote = optionalText(input.authorNote, '作者补充意见', 2_000);
    const idempotencyKey = text(input.idempotencyKey, '操作编号', 8, 128);
    try {
      const row = this.runtime.decideAdjustmentSuggestion({
        decisionId: this.ids.next(), ownerId, bookId, suggestionId, idempotencyKey, decision,
        authorNote, now: this.clock.now().toISOString()
      });
      return {
        suggestionId: row.suggestion_id,
        state: row.state as 'accepted' | 'dismissed',
        nextEffect: row.state === 'accepted' ? 'next_candidate_only' : 'none'
      };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(errorCodes.validation, error instanceof Error ? error.message : '规划建议处理失败。', {}, false, 409);
    }
  }

  public adminRun(ownerId: string, bookId: string, runId: string): unknown {
    const run = this.requireRun(ownerId, bookId, runId);
    return {
      run: {
        ...run,
        sourceSnapshot: JSON.parse(run.source_snapshot_json),
        confirmedTreeRefs: JSON.parse(run.confirmed_tree_refs_json),
        memberSnapshot: JSON.parse(run.member_snapshot_json),
        result: run.result_json === null ? null : JSON.parse(run.result_json)
      }
    };
  }

  private executableRoster(run: V7PlanningMaintenanceRunRow): StoredMaintenanceRoster | null {
    const stored = readStoredMaintenanceRoster(run);
    if (stored === null) return null;
    try {
      return {
        fallback: resolveFrozenPlanningMembers(stored.fallback, this.members(), ['continuity_editor']),
        ...(stored.mode === undefined ? {} : { mode: stored.mode })
      };
    } catch {
      return null;
    }
  }

  private requireExecutableRoster(run: V7PlanningMaintenanceRunRow): StoredMaintenanceRoster {
    const roster = this.executableRoster(run);
    if (roster === null) throw conflict(READ_ONLY_MAINTENANCE_MESSAGE);
    return roster;
  }

  private markReadOnlyFailure(run: V7PlanningMaintenanceRunRow): void {
    const current = this.requireRun(run.owner_id, run.book_id, run.maintenance_run_id);
    if (!['queued', 'working'].includes(current.status)) return;
    this.runtime.markMaintenance({
      ownerId: run.owner_id,
      bookId: run.book_id,
      runId: run.maintenance_run_id,
      status: 'failed',
      errorMessage: READ_ONLY_MAINTENANCE_MESSAGE,
      now: this.clock.now().toISOString()
    });
  }

  private start(run: V7PlanningMaintenanceRunRow): void {
    if (!['queued', 'working'].includes(run.status) || this.activeRuns.has(run.maintenance_run_id)) return;
    if (this.executableRoster(run) === null) {
      this.markReadOnlyFailure(run);
      return;
    }
    this.activeRuns.add(run.maintenance_run_id);
    void this.execute(run).catch((error) => {
      const current = this.runtime.maintenance(run.owner_id, run.book_id, run.maintenance_run_id);
      if (current === undefined || current.status === 'succeeded') return;
      this.runtime.markMaintenance({
        ownerId: run.owner_id, bookId: run.book_id, runId: run.maintenance_run_id,
        status: error instanceof V7PlanningModelError && error.outcomeUnknown ? 'unknown' : 'failed',
        errorMessage: publicFailure(error), now: this.clock.now().toISOString()
      });
    }).finally(() => this.activeRuns.delete(run.maintenance_run_id));
  }

  private async execute(run: V7PlanningMaintenanceRunRow): Promise<void> {
    const roster = this.requireExecutableRoster(run);
    const settlement = this.verifiedSettlement(run.owner_id, run.book_id, run.source_kind, run.source_version_id);
    if (settlement.sourceHash !== run.source_hash) throw conflict('正式结算内容已经变化，本次更新已停止。');
    const frozenTrees = JSON.parse(run.confirmed_tree_refs_json) as ConfirmedTreeSnapshot[];
    const currentTrees = this.confirmedTrees(run.owner_id, run.book_id);
    if (treeFingerprint(currentTrees) !== treeFingerprint(frozenTrees)) {
      throw conflict('已确认规划已经更新，请基于新版本重新整理实际进展。');
    }
    const prompt = planningMaintenancePrompt({ settlement: settlement.payload, confirmedTrees: frozenTrees });
    let lastError: unknown;
    for (const [index, member] of roster.fallback.entries()) {
      this.runtime.markMaintenance({
        ownerId: run.owner_id, bookId: run.book_id, runId: run.maintenance_run_id,
        status: 'working', assignedMemberKey: member.memberKey, errorMessage: null,
        now: this.clock.now().toISOString()
      });
      const requestId = `${run.maintenance_run_id}:maintenance:${run.retry_count}:${index + 1}`;
      const logicalTaskId = `${run.maintenance_run_id}:maintenance:${index + 1}`;
      try {
        const result = await this.models.generate({
          requestId, logicalTaskId, technicalRetry: run.retry_count > 0,
          ownerId: run.owner_id, bookId: run.book_id, runId: run.maintenance_run_id,
          runKind: 'maintenance', nodeKey: `${run.source_kind}:${run.source_version_id}`, member,
          taskKind: 'planning_maintenance', workstationKey: 'continuity_record',
          // 维护运行是基于新的正式结算首次生成增量记录，不是修理某个已成功模型输出。
          operationMode: 'fresh', basedOnTaskId: null, authorInstructionVersion: null,
          // 旧维护任务只冻结聚合结算与规划快照，没有 Agent 级资料取舍证据。
          sourceTraces: [],
          prompt, maxOutputTokens: 6_000, temperature: 0.28
        });
        const output = parsePlanningMaintenanceOutput(result.output);
        this.validateTargets(output, frozenTrees);
        const now = this.clock.now().toISOString();
        for (const draft of output.actuals) {
          const actual: PlanningNodeActual = {
            nodeKey: draft.nodeKey, state: draft.state, summary: draft.summary,
            emotionResult: draft.emotionResult, experienceResult: draft.experienceResult,
            outcome: draft.outcome, sourceKind: run.source_kind, sourceVersionId: run.source_version_id,
            evidenceRefs: settlement.evidenceRefs, recordedAt: now
          };
          this.treeService.recordActual(run.owner_id, run.book_id, draft.treeKind, draft.scopeId, {
            actual,
            idempotencyKey: `actual:${run.maintenance_run_id}:${draft.treeKind}:${draft.scopeId}:${draft.nodeKey}`
          });
        }
        for (const suggestion of output.suggestions) {
          this.runtime.saveAdjustmentSuggestion({
            suggestionId: this.ids.next(), ownerId: run.owner_id, bookId: run.book_id,
            treeKind: suggestion.treeKind, scopeId: suggestion.scopeId, nodeKey: suggestion.nodeKey,
            sourceKind: run.source_kind, sourceVersionId: run.source_version_id,
            publicSummary: suggestion.publicSummary, suggestion, now
          });
        }
        this.runtime.markMaintenance({
          ownerId: run.owner_id, bookId: run.book_id, runId: run.maintenance_run_id,
          status: 'succeeded', assignedMemberKey: member.memberKey, requestId, result: output,
          errorMessage: null, now
        });
        return;
      } catch (error) {
        if (error instanceof V7PlanningModelError && error.outcomeUnknown) throw error;
        if (error instanceof DomainError) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new Error('没有规划维护员完成本次更新');
  }

  private validateTargets(output: V7PlanningMaintenanceOutput, trees: ConfirmedTreeSnapshot[]): void {
    for (const target of [...output.actuals, ...output.suggestions]) {
      const tree = trees.find((candidate) => candidate.treeKind === target.treeKind && candidate.scopeId === target.scopeId);
      if (tree === undefined || !containsNode(tree.document.root, target.nodeKey)) {
        throw new Error('规划维护员引用了不存在或未确认的规划节点');
      }
    }
  }

  private verifiedSettlement(ownerId: string, bookId: string, sourceKind: SettlementKind, sourceVersionId: string): VerifiedSettlement {
    const stageType = sourceKind === 'chapter_settlement' ? 'chapter'
      : sourceKind === 'event_settlement' ? 'story_arc' : 'volume';
    const row = this.runtime.activeSettlement(ownerId, bookId, sourceVersionId, stageType);
    if (row === undefined) throw new DomainError(errorCodes.validation, '正式结算不存在、尚未生效或不属于本书。', {}, false, 404);
    const sourceRows = this.runtime.settlementSources(ownerId, bookId, sourceVersionId);
    const payload = {
      sourceKind,
      settlementId: sourceVersionId,
      stageKey: row.stage_key,
      version: row.version,
      chapterRange: [row.chapter_start, row.chapter_end],
      canonRevision: row.canon_revision,
      irreversibleResults: json(row.irreversible_results_json),
      entityStates: json(row.entity_states_json),
      closedThreads: json(row.closed_threads_json),
      openThreads: json(row.open_threads_json),
      relationshipChanges: json(row.relationship_changes_json),
      knowledgeChanges: json(row.knowledge_changes_json),
      resourceChanges: json(row.resource_changes_json),
      ruleChanges: json(row.rule_changes_json),
      exclusions: json(row.exclusions_json),
      evidence: sourceRows.map((source) => ({
        type: source.source_type, id: source.source_id, hash: source.source_hash,
        locator: json(source.source_locator_json)
      }))
    };
    return {
      sourceKind, sourceVersionId, sourceHash: sha256(stableJson(payload)), payload,
      evidenceRefs: [sourceVersionId, ...sourceRows.map((source) => String(source.source_id))]
    };
  }

  private confirmedTrees(ownerId: string, bookId: string): ConfirmedTreeSnapshot[] {
    const rows = this.runtime.confirmedTrees(ownerId, bookId);
    return rows.map((row) => ({
      treeKind: row.tree_kind as ConfirmedTreeSnapshot['treeKind'], scopeId: String(row.scope_id),
      versionId: String(row.tree_version_id), revision: Number(row.revision), contentHash: String(row.content_hash),
      document: JSON.parse(String(row.content_json)) as PlanningTreeDocument
    }));
  }

  private requireRun(ownerId: string, bookId: string, runId: string): V7PlanningMaintenanceRunRow {
    const run = this.runtime.maintenance(ownerId, bookId, runId);
    if (run === undefined) throw new DomainError(errorCodes.validation, '规划维护任务不存在或不属于本书。', {}, false, 404);
    return run;
  }

  private view(run: V7PlanningMaintenanceRunRow): V7PlanningMaintenanceView {
    const stored = readStoredMaintenanceRoster(run);
    const roster = this.executableRoster(run);
    const member = (roster ?? stored)?.fallback.find((candidate) => candidate.memberKey === run.assigned_member_key)
      ?? (roster ?? stored)?.fallback[0]
      ?? { memberKey: run.assigned_member_key, displayName: '历史规划维护员' };
    const result = run.result_json === null ? null : JSON.parse(run.result_json) as V7PlanningMaintenanceOutput;
    const readOnly = roster === null;
    const status = readOnly ? 'failed'
      : run.status === 'queued' ? 'waiting' : run.status === 'working' ? 'working'
      : run.status === 'succeeded' ? 'completed' : run.status === 'unknown' ? 'result_unknown' : 'failed';
    return {
      runId: run.maintenance_run_id, status,
      message: readOnly ? READ_ONLY_MAINTENANCE_MESSAGE
        : status === 'completed' ? '正文实际已经记录，未来调整建议不会自动改动原规划。'
        : status === 'working' ? `${member.displayName}正在核对这次结算和规划进度。`
          : status === 'failed' ? (run.error_message ?? '对不起，这次没有完成，已保留正式结算。')
            : status === 'result_unknown' ? '抱歉，这次结果还没有确认，为避免重复消耗已经暂停。'
              : '任务已经保存，马上开始核对。',
      member: { memberKey: member.memberKey, name: member.displayName },
      actualCount: result?.actuals.length ?? 0,
      suggestionCount: result?.suggestions.length ?? 0,
      errorMessage: readOnly ? READ_ONLY_MAINTENANCE_MESSAGE : run.error_message
    };
  }
}

function readStoredMaintenanceRoster(run: V7PlanningMaintenanceRunRow): StoredMaintenanceRoster | null {
  try {
    const parsed = JSON.parse(run.member_snapshot_json) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const value = parsed as { fallback?: unknown; mode?: unknown };
    const fallback = readFrozenPlanningMembers(value.fallback, ['continuity_editor']);
    if (fallback === null) return null;
    return {
      fallback,
      ...(value.mode === 'same_settlement_call' ? { mode: value.mode } : {})
    };
  } catch {
    return null;
  }
}

function settlementKind(value: unknown): SettlementKind {
  if (value === 'chapter_settlement' || value === 'event_settlement' || value === 'volume_settlement') return value;
  throw new DomainError(errorCodes.validation, '结算类型无效。');
}

function treeFingerprint(trees: ConfirmedTreeSnapshot[]): string {
  return sha256(stableJson(trees.map((tree) => ({
    treeKind: tree.treeKind, scopeId: tree.scopeId, versionId: tree.versionId,
    revision: tree.revision, contentHash: tree.contentHash
  }))));
}

function memberSnapshot(member: V7PlanningMemberDefinition): unknown {
  return {
    memberKey: member.memberKey, displayName: member.displayName, roleKey: member.roleKey,
    model: member.model, promptInstruction: member.promptInstruction
  };
}

function json(value: unknown): unknown {
  return JSON.parse(String(value)) as unknown;
}

function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new DomainError(errorCodes.validation, `${label}无效。`);
  const result = value.trim();
  const length = Array.from(result).length;
  if (length < min || length > max) throw new DomainError(errorCodes.validation, `${label}无效。`);
  return result;
}

function optionalText(value: unknown, label: string, max: number): string {
  if (value === undefined || value === null || value === '') return '';
  return text(value, label, 1, max);
}

function conflict(message: string): DomainError {
  return new DomainError(errorCodes.planningTreeVersionConflict, message, {}, false, 409);
}

function publicFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `对不起，这次没有完成。${message.slice(0, 300)}`;
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
