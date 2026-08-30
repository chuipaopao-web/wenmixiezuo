import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  creationFallbackChain,
  parseChapterSettlement,
  settlementPrompt,
  type PlanningTreeDocument,
  type V7ChapterOutline,
  type V7ChapterSequence,
  type V7ChapterSettlement,
  type V7ContextSourceTrace,
  type V7StageSettlement,
  type V7CreationMemberDefinition,
  type V7CharacterMemberDefinition,
  type V7PlanningMemberDefinition
} from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { LongformContinuityRepository } from '../../infrastructure/db/repositories/longform-continuity-repository.js';
import {
  V7CreationRuntimeRepository,
  type V7CreationStageJobRow,
  type V7FormalizationEventRow
} from '../../infrastructure/db/repositories/v7-creation-runtime-repository.js';
import { V7PlanningRuntimeRepository } from '../../infrastructure/db/repositories/v7-planning-runtime-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import {
  V7CreationModelError,
  V7CreationModelGateway,
  type V7CreationModelAdapterResolver
} from '../../infrastructure/models/v7-creation-model-gateway.js';
import { StageSettlementService } from '../continuity/stage-settlement-service.js';
import { V7CharacterMemoryService } from '../characters/v7-character-memory-service.js';
import { V7PlanningMaintenanceService } from '../planning/v7-planning-maintenance-service.js';
import { V7CreationContextCompiler } from './v7-creation-context-compiler.js';

const LEASE_MILLISECONDS = 60_000;
const CHILD_STATUS_WAIT_MILLISECONDS = 55_000;
const CHILD_STATUS_POLL_MILLISECONDS = 200;
type CharacterMemberSource = readonly V7CharacterMemberDefinition[] | (() => readonly V7CharacterMemberDefinition[]);
type PlanningMemberSource = readonly V7PlanningMemberDefinition[] | (() => readonly V7PlanningMemberDefinition[]);

export interface V7FormalizationSummary {
  processed: number;
  completed: number;
  failed: number;
  unknown: number;
}

type FormalizationOutcome = V7FormalizationSummary;

class FormalizationDeferredError extends Error {}

function addFormalizationOutcome(summary: V7FormalizationSummary, outcome: FormalizationOutcome): void {
  summary.processed += outcome.processed;
  summary.completed += outcome.completed;
  summary.failed += outcome.failed;
  summary.unknown += outcome.unknown;
}

/**
 * 定稿后的可靠事件消费者。系统只负责租约、顺序和持久化；
 * 结算语义由结算编辑完成，后续人物/规划语义继续交给各自成员。
 */
export class V7CreationFormalizationService {
  private readonly repository: V7CreationRuntimeRepository;
  private readonly continuity: LongformContinuityRepository;
  private readonly settlements: StageSettlementService;
  private readonly contexts: V7CreationContextCompiler;
  private readonly models: V7CreationModelGateway;
  private readonly characters: V7CharacterMemoryService;
  private readonly planning: V7PlanningMaintenanceService;
  private readonly planningRuntime: V7PlanningRuntimeRepository;
  private inFlight: Promise<V7FormalizationSummary> | null = null;

  public constructor(
    database: DatabaseSync,
    adapters: V7CreationModelAdapterResolver,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly members: () => readonly V7CreationMemberDefinition[],
    characterMembers: CharacterMemberSource,
    planningMembers: PlanningMemberSource
  ) {
    this.repository = new V7CreationRuntimeRepository(database);
    this.continuity = new LongformContinuityRepository(database);
    this.settlements = new StageSettlementService(this.continuity, new UnitOfWork(database), ids, clock);
    this.contexts = new V7CreationContextCompiler(database, adapters, ids, clock, members);
    this.models = new V7CreationModelGateway(database, adapters, clock);
    this.characters = new V7CharacterMemoryService(database, adapters, ids, clock, characterMembers);
    this.planning = new V7PlanningMaintenanceService(database, adapters, ids, clock, planningMembers);
    this.planningRuntime = new V7PlanningRuntimeRepository(database);
  }

  /** 只启动后台追赶，不要求HTTP请求等待模型完成。 */
  public kick(): void {
    void this.processPending(24);
  }

  public async processPending(limit = 24): Promise<V7FormalizationSummary> {
    if (this.inFlight !== null) return this.inFlight;
    const operation = this.processBatch(limit);
    this.inFlight = operation;
    try { return await operation; }
    finally { if (this.inFlight === operation) this.inFlight = null; }
  }

  private async processBatch(limit = 24): Promise<V7FormalizationSummary> {
    const events = this.repository.pendingEvents(Math.max(1, Math.min(limit, 100)));
    const summary: V7FormalizationSummary = { processed: 0, completed: 0, failed: 0, unknown: 0 };
    // 结算正文是另外三项维护的唯一上游，必须先顺序完成；已经存在的
    // 人物维护与规划维护彼此独立，使用同一份冻结结算并行执行，避免每章
    // 多等待一个完整模型往返。故事状态只做确定性落库，也无需占用模型队列。
    const upstream = events.filter((event) => event.event_kind === 'settle_chapter');
    const maintenance = events.filter((event) => event.event_kind !== 'settle_chapter');
    for (const event of upstream) addFormalizationOutcome(summary, await this.processLeasedEvent(event));
    const outcomes = await Promise.all(maintenance.map((event) => this.processLeasedEvent(event)));
    outcomes.forEach((outcome) => addFormalizationOutcome(summary, outcome));
    // 每轮最多推进一个无模型调用的阶段聚合任务，避免长循环阻塞作者操作。
    const stageJob = this.repository.pendingStageJobs(1)[0];
    if (stageJob !== undefined && summary.processed < Math.max(1, Math.min(limit, 100))) {
      const leaseToken = this.ids.next();
      const now = this.now();
      if (this.repository.leaseStageJob({
        jobId: stageJob.job_id,
        leaseToken,
        expiresAt: new Date(Date.parse(now) + LEASE_MILLISECONDS).toISOString(),
        now
      })) {
        summary.processed += 1;
        try {
          this.processStageJob(stageJob);
          this.repository.finishStageJob({ jobId: stageJob.job_id, leaseToken, status: 'completed', message: null, now: this.now() });
          summary.completed += 1;
        } catch (error) {
          this.repository.finishStageJob({ jobId: stageJob.job_id, leaseToken, status: 'failed', message: publicFailure(error), now: this.now() });
          summary.failed += 1;
        }
        this.refreshWorkflow(stageJob.owner_id, stageJob.book_id, stageJob.workflow_id);
      }
    }
    return summary;
  }

  private async processLeasedEvent(event: V7FormalizationEventRow): Promise<FormalizationOutcome> {
    const leaseToken = this.ids.next();
    const now = this.now();
    if (!this.repository.leaseEvent({
      eventId: event.event_id,
      leaseToken,
      expiresAt: new Date(Date.parse(now) + LEASE_MILLISECONDS).toISOString(),
      now
    })) return { processed: 0, completed: 0, failed: 0, unknown: 0 };
    try {
      await this.processEvent(event);
      this.repository.finishEvent({ eventId: event.event_id, leaseToken, status: 'completed', message: null, now: this.now() });
      return { processed: 1, completed: 1, failed: 0, unknown: 0 };
    } catch (error) {
      if (error instanceof FormalizationDeferredError) {
        this.repository.deferEvent(event.event_id, leaseToken, this.now());
        return { processed: 1, completed: 0, failed: 0, unknown: 0 };
      }
      const unknown = error instanceof V7CreationModelError && error.outcomeUnknown;
      this.repository.finishEvent({
        eventId: event.event_id,
        leaseToken,
        status: unknown ? 'unknown' : 'failed',
        message: publicFailure(error),
        now: this.now()
      });
      return { processed: 1, completed: 0, failed: unknown ? 0 : 1, unknown: unknown ? 1 : 0 };
    } finally {
      this.refreshWorkflow(event.owner_id, event.book_id, event.workflow_id);
    }
  }

  public status(ownerId: string, bookId: string, workflowId: string): unknown {
    const rows = this.repository.eventsForWorkflow(ownerId, bookId, workflowId);
    return {
      workflowId,
      total: rows.length,
      completed: rows.filter((item) => item.status === 'completed').length,
      pending: rows.filter((item) => ['pending', 'working'].includes(item.status)).length,
      failed: rows.filter((item) => item.status === 'failed').length,
      unknown: rows.filter((item) => item.status === 'unknown').length,
      tasks: rows.map(publicEvent)
        .concat(this.repository.stageJobsForWorkflow(ownerId, bookId, workflowId).map(publicStageJob))
    };
  }

  public retryFailed(ownerId: string, bookId: string, workflowId: string): number {
    const retried = this.repository.retryFailedEvents(ownerId, bookId, workflowId, this.now());
    // 任务可能在作者暂停期间已经由晚到的安全写后维护完成。此时没有失败项
    // 可以重新入队，但仍必须重新计算工作流断点，否则页面会永远停在旧的
    // “仍在整理”快照，无法进入下一章。
    this.refreshWorkflow(ownerId, bookId, workflowId);
    return retried;
  }

  public storyState(ownerId: string, bookId: string): unknown[] {
    return this.repository.storyState(ownerId, bookId).map((row) => ({
      kind: row.item_kind,
      stableKey: row.stable_key,
      title: row.title,
      state: row.state,
      revision: row.revision,
      detail: parseMaybeJson(row.content_json),
      evidenceRefs: parseMaybeJson(row.evidence_refs_json),
      updatedAt: row.created_at
    }));
  }

  private async processEvent(event: V7FormalizationEventRow): Promise<void> {
    if (event.event_kind === 'settle_chapter') await this.settleChapter(event);
    else if (event.event_kind === 'maintain_story_state') this.maintainStoryState(event);
    else if (event.event_kind === 'maintain_characters') await this.maintainCharacters(event);
    else await this.maintainPlanning(event);
  }

  private async settleChapter(event: V7FormalizationEventRow): Promise<void> {
    const payload = json(event.payload_json) as { manuscriptVersionId?: unknown };
    const manuscriptVersionId = typeof payload.manuscriptVersionId === 'string' ? payload.manuscriptVersionId : event.source_id;
    const manuscript = this.repository.finalManuscript(event.owner_id, event.book_id, manuscriptVersionId);
    if (manuscript === undefined || manuscript.workflow_id !== event.workflow_id) throw conflict('定稿正文不存在或不属于本次创作。');
    const existing = this.repository.settlement(event.owner_id, event.book_id, manuscriptVersionId);
    let settlementRow = existing;
    if (settlementRow === undefined) {
      const sequence = this.repository.outline(event.owner_id, event.book_id, manuscript.sequence_id);
      if (sequence === undefined || sequence.lifecycle !== 'confirmed') throw conflict('定稿正文缺少对应的确认章纲。');
      const sequenceContent = json(sequence.content_json) as V7ChapterSequence;
      const outline = sequenceContent.chapters.find((item) => item.chapterNumber === manuscript.chapter_number);
      if (outline === undefined) throw conflict('定稿正文与确认章纲无法对应。');
      const workflow = this.repository.workflow(event.owner_id, event.book_id, event.workflow_id);
      if (workflow === undefined || workflow.chain_scope_id === null) throw conflict('创作任务缺少当前单元链。');
      const evidenceRef = `manuscript:${manuscript.manuscript_version_id}:${manuscript.content_hash}`;
      const context = await this.contexts.compile({
        ownerId: event.owner_id,
        bookId: event.book_id,
        workflowId: event.workflow_id,
        taskKind: 'settlement',
        taskId: manuscript.manuscript_version_id,
        taskBrief: `只从第${manuscript.chapter_number}章定稿正文提取真实变化，为下一章更新资料。`,
        firstVolume: workflow.first_volume === 1,
        requiredTree: { treeKind: 'chain', scopeId: workflow.chain_scope_id },
        extraSources: [outlineSource(sequence.sequence_id, sequence.revision, outline)]
      });
      const result = await this.runSettlementWithFallback({
        ownerId: event.owner_id,
        bookId: event.book_id,
        workflowId: event.workflow_id,
        manuscriptVersionId: manuscript.manuscript_version_id,
        sourceTraces: context.sourceTraces,
        prompt: settlementPrompt({
          manuscriptVersionId: manuscript.manuscript_version_id,
          manuscript: manuscript.content_text,
          outline,
          contextPack: context.content,
          evidenceRef
        })
      });
      const settlement = parseChapterSettlement(result.output, [evidenceRef]);
      settlementRow = this.repository.saveSettlementAndEvents({
        settlementId: this.ids.next(),
        ownerId: event.owner_id,
        bookId: event.book_id,
        workflowId: event.workflow_id,
        manuscriptVersionId: manuscript.manuscript_version_id,
        manuscriptHash: manuscript.content_hash,
        settlement,
        settlementHash: sha256(stableJson(settlement)),
        evidenceRefs: [evidenceRef],
        memberKey: result.member.memberKey,
        requestId: result.requestId,
        events: [
          { eventId: this.ids.next(), eventKind: 'maintain_story_state' },
          { eventId: this.ids.next(), eventKind: 'maintain_characters' },
          { eventId: this.ids.next(), eventKind: 'maintain_planning' }
        ],
        now: this.now()
      });
    }
    this.ensureStageSettlement(event, manuscript, settlementRow.settlement_id, json(settlementRow.settlement_json) as V7ChapterSettlement);
  }

  private ensureStageSettlement(
    event: V7FormalizationEventRow,
    manuscript: { manuscript_version_id: string; manuscript_hash?: string; content_hash: string; chapter_number: number },
    settlementId: string,
    settlement: V7ChapterSettlement
  ): string {
    const scope = { ownerId: event.owner_id, bookId: event.book_id };
    const stageKey = `v7:${settlementId}`;
    const existing = this.continuity.activeSettlement(scope, 'chapter', stageKey);
    if (existing !== null) return existing.id;
    const opened = settlement.openQuestions.filter((item) => item.state === 'open');
    const activeLines = settlement.storyLines.filter((item) => !['completed', 'abandoned'].includes(item.state));
    const activeForeshadowing = settlement.foreshadowing.filter((item) => !['resolved', 'retired'].includes(item.state));
    const closed = [
      ...settlement.storyLines.filter((item) => ['completed', 'abandoned'].includes(item.state)),
      ...settlement.foreshadowing.filter((item) => ['resolved', 'retired'].includes(item.state)),
      ...settlement.openQuestions.filter((item) => ['answered', 'retired'].includes(item.state))
    ];
    const built = this.settlements.build(scope, {
      stageType: 'chapter',
      stageKey,
      chapterStart: manuscript.chapter_number,
      chapterEnd: manuscript.chapter_number,
      canonRevision: this.continuity.latestCanonRevision(scope),
      payload: {
        irreversibleResults: settlement.irreversibleResults,
        entityStates: settlement.entityStates,
        closedThreads: closed,
        openThreads: [...opened, ...activeLines, ...activeForeshadowing],
        relationshipChanges: settlement.relationshipChanges,
        knowledgeChanges: settlement.knowledgeChanges,
        resourceChanges: settlement.resourceChanges,
        ruleChanges: settlement.ruleChanges,
        exclusions: ['未定稿正文', '章纲预测', '规划候选', '没有定稿正文证据的推断']
      },
      sources: [{
        sourceType: 'confirmed_v7_manuscript',
        sourceId: manuscript.manuscript_version_id,
        sourceHash: manuscript.content_hash,
        locator: { manuscriptVersionId: manuscript.manuscript_version_id, chapterNumber: manuscript.chapter_number }
      }],
      probes: [
        { type: 'source', expected: manuscript.content_hash, actual: manuscript.content_hash, passed: true },
        { type: 'state', expected: settlementId, actual: settlementId, passed: true },
        { type: 'negative', expected: 'confirmed_v7_manuscript', actual: 'confirmed_v7_manuscript', passed: true }
      ]
    });
    if (!built.activated) throw new Error('本章结算证据检查未通过');
    return built.settlementId;
  }

  private maintainStoryState(event: V7FormalizationEventRow): void {
    const payload = json(event.payload_json) as { settlementId?: unknown };
    const settlementId = typeof payload.settlementId === 'string' ? payload.settlementId : event.source_id;
    const row = this.repository.settlementById(event.owner_id, event.book_id, settlementId);
    if (row === undefined) throw conflict('本章结算不存在。');
    const settlement = json(row.settlement_json) as V7ChapterSettlement;
    const entries = [
      ...settlement.storyLines.map((item) => ({ kind: 'story_line' as const, stableKey: item.stableKey, title: item.title, state: item.state, content: item, evidenceRefs: item.evidenceRefs })),
      ...settlement.foreshadowing.map((item) => ({ kind: 'foreshadowing' as const, stableKey: item.stableKey, title: item.title, state: item.state, content: item, evidenceRefs: item.evidenceRefs })),
      ...settlement.openQuestions.map((item) => ({ kind: 'open_question' as const, stableKey: item.stableKey, title: item.question, state: item.state, content: item, evidenceRefs: item.evidenceRefs }))
    ];
    this.repository.applyStoryState({
      ownerId: event.owner_id,
      bookId: event.book_id,
      settlementId,
      items: entries.map((item) => ({
        itemId: this.ids.next(),
        stateVersionId: this.ids.next(),
        kind: item.kind,
        stableKey: item.stableKey,
        title: item.title,
        state: item.state,
        content: item.content,
        contentHash: sha256(stableJson(item.content)),
        evidenceRefs: item.evidenceRefs
      })),
      now: this.now()
    });
  }

  private async maintainCharacters(event: V7FormalizationEventRow): Promise<void> {
    const stageSettlementId = this.requireStageSettlement(event);
    const payload = json(event.payload_json) as { settlementId?: unknown };
    const settlementId = typeof payload.settlementId === 'string' ? payload.settlementId : event.source_id;
    const settlementRow = this.repository.settlementById(event.owner_id, event.book_id, settlementId);
    if (settlementRow === undefined) throw conflict('本章结算不存在。');
    const settlement = json(settlementRow.settlement_json) as V7ChapterSettlement;
    const candidateEntityIds = knownSettlementEntityIds(
      settlement,
      this.characters.listProfiles(event.owner_id, event.book_id, false) as Array<{ entityId: string; displayName: string }>
    );
    let current = this.characters.triggerMaintenance(event.owner_id, event.book_id, {
      sourceKind: 'chapter_settlement',
      sourceVersionId: stageSettlementId,
      ...(candidateEntityIds.length > 0 ? { candidateEntityIds } : {})
    }) as CharacterMaintenanceStatus;
    if (current.status === 'failed' && event.attempt_count > 0) {
      current = this.characters.retryMaintenance(event.owner_id, event.book_id, current.runId) as CharacterMaintenanceStatus;
    }
    const deadline = Date.now() + CHILD_STATUS_WAIT_MILLISECONDS;
    while (['waiting', 'working'].includes(current.status) && Date.now() < deadline) {
      await delay(CHILD_STATUS_POLL_MILLISECONDS);
      current = this.characters.getMaintenance(event.owner_id, event.book_id, current.runId) as CharacterMaintenanceStatus;
    }
    if (current.status === 'completed' || current.status === 'needs_review') return;
    if (current.status === 'result_unknown') throw new V7CreationModelError('人物资料更新结果还不能确认。', true);
    if (['waiting', 'working'].includes(current.status)) throw new FormalizationDeferredError('人物资料更新仍在进行');
    throw new Error(current.errorMessage ?? '人物资料更新没有完成。');
  }

  private async maintainPlanning(event: V7FormalizationEventRow): Promise<void> {
    const stageSettlementId = this.requireStageSettlement(event);
    const payload = json(event.payload_json) as { settlementId?: unknown };
    const settlementId = typeof payload.settlementId === 'string' ? payload.settlementId : event.source_id;
    const settlementRow = this.repository.settlementById(event.owner_id, event.book_id, settlementId);
    if (settlementRow === undefined) throw conflict('本章结算不存在。');
    const settlement = json(settlementRow.settlement_json) as V7ChapterSettlement;
    let current = this.planning.recordChapterActuals(
      event.owner_id,
      event.book_id,
      stageSettlementId,
      settlement.treeActuals,
      settlementRow.member_key
    );
    if (current.status === 'failed' && event.attempt_count > 0) {
      current = this.planning.retry(event.owner_id, event.book_id, current.runId);
    }
    const deadline = Date.now() + CHILD_STATUS_WAIT_MILLISECONDS;
    while (['waiting', 'working'].includes(current.status) && Date.now() < deadline) {
      await delay(CHILD_STATUS_POLL_MILLISECONDS);
      current = this.planning.get(event.owner_id, event.book_id, current.runId);
    }
    if (current.status === 'completed') return;
    if (current.status === 'result_unknown') throw new V7CreationModelError('故事进度更新结果还不能确认。', true);
    if (['waiting', 'working'].includes(current.status)) throw new FormalizationDeferredError('故事进度更新仍在进行');
    throw new Error(current.errorMessage ?? '故事进度更新没有完成。');
  }

  private requireStageSettlement(event: V7FormalizationEventRow): string {
    const payload = json(event.payload_json) as { settlementId?: unknown };
    const settlementId = typeof payload.settlementId === 'string' ? payload.settlementId : event.source_id;
    const active = this.continuity.activeSettlement(
      { ownerId: event.owner_id, bookId: event.book_id },
      'chapter',
      `v7:${settlementId}`
    );
    if (active === null) throw conflict('正式章节结算还没有准备好。');
    return active.id;
  }

  private async runSettlementWithFallback(input: {
    ownerId: string; bookId: string; workflowId: string; manuscriptVersionId: string;
    sourceTraces: readonly V7ContextSourceTrace[]; prompt: string;
  }): Promise<{ output: string; requestId: string; member: V7CreationMemberDefinition }> {
    let lastError: unknown;
    const preferred = this.repository.memberPreference(input.ownerId, input.bookId, input.workflowId, 'settlement_editor')?.member_key;
    const members = this.members();
    const boundedDefault = preferred ?? members.find((candidate) =>
      candidate.roleKey === 'settlement_editor' && candidate.enabledByDefault && candidate.model.modelId === 'kimi-k3'
    )?.memberKey;
    for (const member of creationFallbackChain('settlement_editor', boundedDefault, members)) {
      const requestId = `creation-settlement:${input.workflowId}:${input.manuscriptVersionId}:${member.memberKey}`;
      try {
        const result = await this.models.generate({
          requestId,
          ownerId: input.ownerId,
          bookId: input.bookId,
          workflowId: input.workflowId,
          runKind: 'settlement',
          nodeKey: input.manuscriptVersionId,
          workstationKey: 'continuity_record',
          member,
          // 本章结算是有停止条件的正文证据提取，不是开放式规划。Kimi K3
          // 在 novel_reviewer 路由关闭隐藏思考，避免为一章实际变化长时间推演。
          purpose: 'novel_reviewer',
          operationMode: 'fresh',
          basedOnTaskId: null,
          authorInstructionVersion: null,
          sourceTraces: input.sourceTraces,
          prompt: input.prompt,
          maxOutputTokens: 4_000,
          temperature: 0.12
        });
        return { output: result.output, requestId, member };
      } catch (error) {
        if (error instanceof V7CreationModelError && error.outcomeUnknown) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new Error('没有结算成员完成本章整理');
  }

  /**
   * 阶段结算不再次理解正文，只无损聚合已经由结算成员提取并带证据的正式下层结果。
   * 这样不会把程序规则伪装成文学判断，也不会为同一正文重复消耗模型调用。
   */
  private processStageJob(job: V7CreationStageJobRow): void {
    const sources = job.settlement_kind === 'chain'
      ? this.repository.chapterSettlementsForWorkflow(job.owner_id, job.book_id, job.workflow_id).map((row) => ({
          evidenceRef: `chapter-settlement:${row.settlement_id}:${row.settlement_hash}`,
          sourceId: row.settlement_id,
          sourceHash: row.settlement_hash,
          chapterStart: row.chapter_number,
          chapterEnd: row.chapter_number,
          content: json(row.settlement_json) as V7ChapterSettlement
        }))
      : this.volumeChainSources(job.owner_id, job.book_id, job.scope_id);
    if (sources.length === 0) throw conflict('下层正式结算还没有准备完整。');
    if (sha256(stableJson(sources.map((item) => item.evidenceRef))) !== job.source_fingerprint) {
      throw conflict('下层正式结算已经变化，请重新建立阶段结算任务。');
    }
    const stage = aggregateStageSettlement(job.settlement_kind, job.scope_id, sources);
    const requestId = `creation-stage-aggregate:${job.settlement_kind}:${job.scope_id}:${job.source_fingerprint}`;
    this.repository.saveStageSettlement({
      stageSettlementId: this.ids.next(), ownerId: job.owner_id, bookId: job.book_id,
      workflowId: job.workflow_id, settlementKind: job.settlement_kind, scopeId: job.scope_id,
      content: stage, evidenceRefs: sources.map((item) => item.evidenceRef),
      memberKey: 'system-evidence-aggregator', requestId, now: this.now()
    });
    const scope = { ownerId: job.owner_id, bookId: job.book_id };
    const stageType = job.settlement_kind === 'chain' ? 'story_arc' : 'volume';
    const stageKey = `v7-${job.settlement_kind}:${job.scope_id}`;
    if (this.continuity.activeSettlement(scope, stageType, stageKey) !== null) return;
    const chapterStart = Math.min(...sources.map((item) => item.chapterStart));
    const chapterEnd = Math.max(...sources.map((item) => item.chapterEnd));
    const built = this.settlements.build(scope, {
      stageType, stageKey, chapterStart, chapterEnd,
      canonRevision: this.continuity.latestCanonRevision(scope),
      payload: {
        ...stage,
        exclusions: ['未定稿正文', '未确认规划', '题材常识推断', '没有下层结算证据的内容']
      },
      sources: sources.map((item) => ({
        sourceType: job.settlement_kind === 'chain' ? 'v7_chapter_settlement' : 'v7_chain_settlement',
        sourceId: item.sourceId, sourceHash: item.sourceHash,
        locator: { settlementKind: job.settlement_kind, scopeId: job.scope_id, evidenceRef: item.evidenceRef }
      })),
      probes: [
        { type: 'source', expected: sources.length, actual: stage.evidenceRefs.length, passed: sources.length === stage.evidenceRefs.length },
        { type: 'causality', expected: [chapterStart, chapterEnd], actual: [chapterStart, chapterEnd], passed: chapterEnd >= chapterStart }
      ]
    });
    if (!built.activated) throw new Error('阶段结算证据检查未通过');
  }

  private volumeChainSources(ownerId: string, bookId: string, volumeScopeId: string): StageAggregateSource[] {
    const expected = this.expectedChainScopes(ownerId, bookId, volumeScopeId);
    const rows = this.repository.stageSettlements(ownerId, bookId, 'chain').filter((row) => expected.includes(row.scope_id));
    if (expected.length === 0 || rows.length !== expected.length) return [];
    return expected.map((scopeId) => {
      const row = rows.find((item) => item.scope_id === scopeId)!;
      const content = json(row.content_json) as V7StageSettlement;
      const workflow = this.repository.workflow(row.owner_id, row.book_id, row.workflow_id);
      const outline = workflow?.chain_scope_id === null || workflow?.chain_scope_id === undefined
        ? undefined : this.repository.confirmedOutline(ownerId, bookId, workflow.chain_scope_id);
      const manuscripts = outline === undefined ? [] : this.repository.finalManuscriptsForSequence(ownerId, bookId, outline.sequence_id);
      if (manuscripts.length === 0) throw conflict('单元链缺少定稿正文范围。');
      const sourceHash = sha256(stableJson(content));
      return {
        evidenceRef: `chain-settlement:${row.stage_settlement_id}:${sourceHash}`,
        sourceId: row.stage_settlement_id,
        sourceHash,
        chapterStart: Math.min(...manuscripts.map((item) => item.chapter_number)),
        chapterEnd: Math.max(...manuscripts.map((item) => item.chapter_number)),
        content
      };
    });
  }

  private expectedChainScopes(ownerId: string, bookId: string, volumeScopeId: string): string[] {
    const row = this.planningRuntime.confirmedTree(ownerId, bookId, 'volume', volumeScopeId);
    if (row === undefined || typeof row.content_json !== 'string') return [];
    const tree = json(row.content_json) as PlanningTreeDocument;
    const scopes = new Set<string>();
    const visit = (node: PlanningTreeDocument['root']): void => {
      if (node.linkedTree?.treeKind === 'chain') scopes.add(node.linkedTree.scopeId);
      node.children.forEach(visit);
    };
    visit(tree.root);
    return [...scopes];
  }

  private refreshWorkflow(ownerId: string, bookId: string, workflowId: string): void {
    const workflow = this.repository.workflow(ownerId, bookId, workflowId);
    if (workflow === undefined || workflow.stage !== 'settlement' || workflow.status === 'cancelled') return;
    const events = this.repository.eventsForWorkflow(ownerId, bookId, workflowId);
    const pending = events.filter((item) => ['pending', 'working'].includes(item.status));
    const failed = events.filter((item) => item.status === 'failed');
    const unknown = events.filter((item) => item.status === 'unknown');
    const allCompleted = events.length >= 4 && events.every((item) => item.status === 'completed');
    const outline = workflow.chain_scope_id === null
      ? undefined
      : this.repository.confirmedOutline(ownerId, bookId, workflow.chain_scope_id);
    const sequence = outline === undefined ? null : json(outline.content_json) as V7ChapterSequence;
    const completedChapters = outline === undefined
      ? []
      : this.repository.finalManuscriptsForSequence(ownerId, bookId, outline.sequence_id);
    const completedNumbers = new Set(completedChapters.map((item) => item.chapter_number));
    const nextChapterNumber = sequence?.chapters.find((chapter) => !completedNumbers.has(chapter.chapterNumber))?.chapterNumber ?? null;
    const continueWriting = allCompleted && nextChapterNumber !== null;
    let stageStatus: 'pending' | 'working' | 'completed' | 'failed' | 'unknown' | null = null;
    let volumeStageStatus: 'pending' | 'working' | 'completed' | 'failed' | 'unknown' | null = null;
    if (allCompleted && nextChapterNumber === null && workflow.chain_scope_id !== null) {
      const chapterSettlements = this.repository.chapterSettlementsForWorkflow(ownerId, bookId, workflowId);
      const refs = chapterSettlements.map((item) => `chapter-settlement:${item.settlement_id}:${item.settlement_hash}`);
      if (chapterSettlements.length === completedChapters.length && refs.length > 0) {
        const stageJob = this.repository.enqueueStageJob({
          jobId: this.ids.next(), ownerId, bookId, workflowId, settlementKind: 'chain',
          scopeId: workflow.chain_scope_id, sourceFingerprint: sha256(stableJson(refs)), now: this.now()
        });
        stageStatus = stageJob.status;
        if (stageJob.status === 'completed') {
          const volumeSources = this.volumeChainSources(ownerId, bookId, workflow.volume_scope_id);
          if (volumeSources.length > 0) {
            const volumeJob = this.repository.enqueueStageJob({
              jobId: this.ids.next(), ownerId, bookId, workflowId, settlementKind: 'volume',
              scopeId: workflow.volume_scope_id,
              sourceFingerprint: sha256(stableJson(volumeSources.map((item) => item.evidenceRef))), now: this.now()
            });
            volumeStageStatus = volumeJob.status;
          }
        }
      }
    }
    const stageFailed = stageStatus === 'failed' || volumeStageStatus === 'failed';
    const stageUnknown = stageStatus === 'unknown' || volumeStageStatus === 'unknown';
    const stagePending = stageStatus === 'pending' || stageStatus === 'working'
      || volumeStageStatus === 'pending' || volumeStageStatus === 'working';
    const stageCompleted = stageStatus === 'completed' && (volumeStageStatus === null || volumeStageStatus === 'completed');
    this.repository.updateWorkflow({
      ownerId,
      bookId,
      workflowId,
      stage: continueWriting ? 'manuscript' : stageCompleted ? 'completed' : 'settlement',
      status: continueWriting ? 'awaiting_author'
        : stageCompleted ? 'completed'
          : stageUnknown || unknown.length > 0 ? 'unknown'
            : stageFailed || failed.length > 0 ? 'partially_failed'
              : stagePending || allCompleted ? 'working' : 'working',
      checkpoint: {
        totalMaintenance: events.length,
        completedMaintenance: events.filter((item) => item.status === 'completed').length,
        pendingMaintenance: pending.length,
        failedMaintenance: failed.length,
        unknownMaintenance: unknown.length,
        completedChapters: completedChapters.length,
        totalChapters: sequence?.chapters.length ?? 0,
        nextChapterNumber,
        chainSettlement: stageStatus,
        volumeSettlement: volumeStageStatus
      },
      errorMessage: stageUnknown || unknown.length > 0
        ? '对不起，有一项更新结果还不能确认，系统已停止重复下单。'
        : stageFailed || failed.length > 0
          ? '对不起，有一项写后更新没有完成，正文已经安全保存，可以继续追赶。'
          : null,
      now: this.now()
    });
  }

  private now(): string { return this.clock.now().toISOString(); }
}

function outlineSource(sequenceId: string, revision: number, outline: V7ChapterOutline) {
  const contentHash = sha256(stableJson(outline));
  return {
    sourceKey: `formal:outline:${sequenceId}:${outline.chapterNumber}`,
    sourceKind: 'planning_tree' as const,
    sourceId: sequenceId,
    sourceVersion: String(revision),
    authority: 'formal' as const,
    label: `第${outline.chapterNumber}章确认章纲`,
    content: outline,
    contentHash,
    required: true,
    includedReason: '只用于核对正文责任，不能冒充正文实际。'
  };
}

function publicEvent(row: V7FormalizationEventRow): unknown {
  const labels = {
    settle_chapter: '整理本章实际变化',
    maintain_characters: '更新人物资料',
    maintain_planning: '更新故事进度',
    maintain_story_state: '更新故事线与伏笔'
  } as const;
  const messages = {
    pending: '已经排好工作，马上开始。',
    working: '正在认真整理，请稍等。',
    completed: '已经整理完成。',
    failed: '对不起，这次没有完成，系统会继续追赶。',
    unknown: '对不起，这次结果还不能确认，已停止重复下单。'
  } as const;
  return {
    taskId: row.event_id,
    task: labels[row.event_kind],
    status: row.status,
    message: messages[row.status],
    attempts: row.attempt_count,
    updatedAt: row.updated_at
  };
}

function publicStageJob(row: V7CreationStageJobRow): unknown {
  const messages = {
    pending: '下层内容已经完成，马上整理本阶段实际结果。',
    working: '正在汇总已经确认的实际结果，请稍等。',
    completed: '本阶段实际结果已经整理完成。',
    failed: '对不起，这次阶段整理没有完成，已保留全部下层正式结果。',
    unknown: '对不起，这次结果还不能确认，已停止重复处理。'
  } as const;
  return {
    taskId: row.job_id,
    task: row.settlement_kind === 'chain' ? '整理本链实际结果' : '整理本卷实际结果',
    status: row.status,
    message: messages[row.status],
    attempts: row.attempt_count,
    updatedAt: row.updated_at
  };
}

function json(value: string): unknown { return JSON.parse(value) as unknown; }
function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function conflict(message: string): DomainError { return new DomainError(errorCodes.validation, message, {}, false, 409); }
function publicFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const clean = message.replace(/[\r\n\t]+/gu, ' ').slice(0, 260);
  return /^(?:对不起|抱歉)/u.test(clean) ? clean : `对不起，这次没有完成。${clean}`;
}
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function knownSettlementEntityIds(
  settlement: V7ChapterSettlement,
  profiles: ReadonlyArray<{ entityId: string; displayName: string }>
): string[] {
  const byName = new Map(profiles.map((profile) => [profile.displayName.trim(), profile.entityId]));
  const knownIds = new Set(profiles.map((profile) => profile.entityId));
  const result = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value !== 'object' || value === null) return;
    const item = value as Record<string, unknown>;
    for (const key of ['entityId', 'fromEntityId', 'toEntityId']) {
      const entityId = item[key];
      if (typeof entityId === 'string' && knownIds.has(entityId)) result.add(entityId);
    }
    for (const key of ['name', 'displayName', 'from', 'to', 'knower']) {
      const name = item[key];
      if (typeof name !== 'string') continue;
      const entityId = byName.get(name.trim());
      if (entityId !== undefined) result.add(entityId);
    }
  };
  visit(settlement.entityStates);
  visit(settlement.relationshipChanges);
  visit(settlement.knowledgeChanges);
  return [...result];
}

interface CharacterMaintenanceStatus {
  runId: string;
  status: 'waiting' | 'working' | 'completed' | 'needs_review' | 'failed' | 'result_unknown' | 'outdated';
  errorMessage: string | null;
}

interface StageAggregateSource {
  evidenceRef: string;
  sourceId: string;
  sourceHash: string;
  chapterStart: number;
  chapterEnd: number;
  content: V7ChapterSettlement | V7StageSettlement;
}

function aggregateStageSettlement(
  settlementKind: 'chain' | 'volume',
  scopeId: string,
  sources: readonly StageAggregateSource[]
): V7StageSettlement {
  const chapters = sources.map((source) => source.content).filter(isChapterSettlement);
  const stages = sources.map((source) => source.content).filter(isStageSettlement);
  const closedThreads = chapters.flatMap((item) => [
    ...item.storyLines.filter((line) => ['completed', 'abandoned'].includes(line.state)),
    ...item.foreshadowing.filter((thread) => ['resolved', 'retired'].includes(thread.state)),
    ...item.openQuestions.filter((question) => ['answered', 'retired'].includes(question.state))
  ]);
  const openThreads = chapters.flatMap((item) => [
    ...item.storyLines.filter((line) => !['completed', 'abandoned'].includes(line.state)),
    ...item.foreshadowing.filter((thread) => !['resolved', 'retired'].includes(thread.state)),
    ...item.openQuestions.filter((question) => question.state === 'open')
  ]);
  const summaries = sources.map((source) => source.content.publicSummary);
  const latest = sources.at(-1)!.content;
  const protagonistChanges = chapters.flatMap((item) => item.treeActuals.map((actual) => actual.summary))
    .concat(stages.map((item) => item.protagonistChange));
  return {
    schema: 'v7-stage-settlement-v1', settlementKind, scopeId,
    publicSummary: summaries.join('；'),
    irreversibleResults: uniqueJson(sources.flatMap((source) => source.content.irreversibleResults)),
    entityStates: structuredClone(latest.entityStates),
    closedThreads: uniqueJson([...closedThreads, ...stages.flatMap((item) => item.closedThreads)]),
    openThreads: uniqueJson([...openThreads, ...stages.flatMap((item) => item.openThreads)]),
    relationshipChanges: uniqueJson(sources.flatMap((source) => source.content.relationshipChanges)),
    knowledgeChanges: uniqueJson(sources.flatMap((source) => source.content.knowledgeChanges)),
    resourceChanges: uniqueJson(sources.flatMap((source) => source.content.resourceChanges)),
    ruleChanges: uniqueJson(sources.flatMap((source) => source.content.ruleChanges)),
    protagonistChange: protagonistChanges.join('；') || '本阶段没有提取到可核实的人物变化。',
    outcome: isStageSettlement(latest) ? latest.outcome : latest.publicSummary,
    nextStep: isStageSettlement(latest) ? latest.nextStep : '下一阶段方向尚未确认。',
    evidenceRefs: sources.map((source) => source.evidenceRef)
  };
}

function isChapterSettlement(value: V7ChapterSettlement | V7StageSettlement): value is V7ChapterSettlement {
  return value.schema === 'v7-chapter-settlement-v1';
}

function isStageSettlement(value: V7ChapterSettlement | V7StageSettlement): value is V7StageSettlement {
  return value.schema === 'v7-stage-settlement-v1';
}

function uniqueJson(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = stableJson(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
