import { createHash } from 'node:crypto';
import {
  parseVolumePlanContent,
  type VolumePlanContent
} from '@wenmi/contracts';
import type { CreativeRoleKey } from '../../contracts/agent-team-v2.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import {
  VolumePlanGenerationRepository,
  type VolumePlanGenerationSeat,
  type VolumePlanGenerationSourceSnapshot
} from '../../infrastructure/db/repositories/volume-plan-generation-repository.js';
import type { BudgetService } from '../budget/budget-service.js';
import type { ModelCallService } from '../calls/model-call-service.js';
import { estimateTokens, type ContextPackService, type ContextSource } from '../memory/context-pack-service.js';
import type { RetrievalContextSourceService } from '../memory/retrieval-context-source-service.js';
import { TaskService, type TaskLeaseFence, type TaskRecord } from '../tasks/task-service.js';
import {
  type VolumePlanGenerationBrief,
  volumePlanSourceFingerprint
} from './volume-plan-generation-service.js';
import { VolumePlanService } from './volume-plan-service.js';

type CandidateKind = 'candidate_a' | 'candidate_b' | 'fusion';

export interface VolumePlanGenerationResult {
  taskId: string;
  status: 'succeeded' | 'cancelled';
  candidateAId: string | null;
  candidateBId: string | null;
  fusionId: string | null;
}

interface GeneratedCandidate {
  versionId: string;
  content: VolumePlanContent;
}

export class VolumePlanGenerationPipelineService {
  public constructor(
    private readonly repository: VolumePlanGenerationRepository,
    private readonly volumePlans: VolumePlanService,
    private readonly tasks: TaskService,
    private readonly budgets: BudgetService,
    private readonly calls: ModelCallService,
    private readonly contextPacks: ContextPackService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly modelAdapters: ModelAdapterFactory,
    private readonly retrieval?: RetrievalContextSourceService
  ) {}

  public async executeClaimed(
    scope: BookScope,
    taskId: string,
    workerId: string,
    leaseFence?: TaskLeaseFence
  ): Promise<VolumePlanGenerationResult> {
    const claimed = this.tasks.require(scope, taskId);
    this.assertClaim(claimed, workerId, leaseFence);
    const brief = parseBrief(claimed.brief);
    const snapshot = this.requireCurrentSnapshot(scope, brief);
    const lead = requiredSeat(brief.seats, 'lead_screenwriter');
    const second = requiredSeat(brief.seats, 'second_screenwriter');
    const editor = brief.seats.find((seat) => seat.editor);
    if (editor === undefined) throw new Error('卷规划任务缺少冻结的主编席快照。');
    try {
      this.throwIfCancelled(scope, taskId);
      const candidateResults = await Promise.allSettled([
        this.generateAndStore(scope, claimed, brief, snapshot, lead, 'candidate_a', []),
        this.generateAndStore(scope, claimed, brief, snapshot, second, 'candidate_b', [])
      ]);
      const candidateA = candidateResults[0].status === 'fulfilled' ? candidateResults[0].value : null;
      const candidateB = candidateResults[1].status === 'fulfilled' ? candidateResults[1].value : null;
      this.tasks.checkpoint(scope, taskId, workerId, 'screenwriter_candidates', {
        candidateAId: candidateA?.versionId ?? null,
        candidateBId: candidateB?.versionId ?? null,
        independent: true,
        crossReviewUsed: false
      }, leaseFence);
      const rejected = candidateResults.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (rejected !== undefined) throw rejected.reason;
      this.throwIfCancelled(scope, taskId);
      const fusion = await this.generateAndStore(
        scope,
        claimed,
        brief,
        snapshot,
        editor,
        'fusion',
        [candidateA!.content, candidateB!.content]
      );
      this.tasks.checkpoint(scope, taskId, workerId, 'fusion_complete', {
        candidateAId: candidateA!.versionId,
        candidateBId: candidateB!.versionId,
        fusionId: fusion.versionId,
        awaitingAuthorChoice: true
      }, leaseFence);
      this.tasks.complete(scope, taskId, workerId, leaseFence);
      this.repository.clearWaitingTask(scope, taskId, this.clock.now().toISOString());
      return {
        taskId,
        status: 'succeeded',
        candidateAId: candidateA!.versionId,
        candidateBId: candidateB!.versionId,
        fusionId: fusion.versionId
      };
    } catch (error) {
      const current = this.tasks.require(scope, taskId);
      if (current.cancelRequested) {
        this.tasks.complete(scope, taskId, workerId, leaseFence);
        this.repository.clearWaitingTask(scope, taskId, this.clock.now().toISOString());
        return {
          taskId,
          status: 'cancelled',
          ...this.storedIds(scope, brief.volumePlanId, taskId)
        };
      }
      const resultUnknown = this.repository.hasUnresolvedModelCall(scope, taskId);
      const failureCode = resultUnknown
        ? errorCodes.modelCallInterrupted
        : error instanceof DomainError ? error.code : 'VOLUME_PLAN_GENERATION_FAILED';
      this.tasks.fail(scope, taskId, workerId, failureCode, leaseFence);
      this.repository.markFailed(
        scope,
        taskId,
        resultUnknown ? '模型调用结果暂时无法确认，已停止自动重试。' : '卷规划团队设计未完成，可从已保存的候选检查点重试。',
        this.clock.now().toISOString()
      );
      throw error;
    }
  }

  private async generateAndStore(
    scope: BookScope,
    task: TaskRecord,
    brief: VolumePlanGenerationBrief,
    snapshot: VolumePlanGenerationSourceSnapshot,
    seat: VolumePlanGenerationSeat,
    candidateKind: CandidateKind,
    peerCandidates: VolumePlanContent[]
  ): Promise<GeneratedCandidate> {
    const stored = this.repository.candidateByTask(scope, brief.volumePlanId, task.taskId, candidateKind);
    if (stored !== undefined) {
      return {
        versionId: stored.volume_plan_version_id,
        content: parseVolumePlanContent(JSON.parse(stored.content_json) as unknown)
      };
    }
    const retrieved = this.retrieval === undefined ? { hardSources: [], optionalSources: [] }
      : await this.retrieval.collect(scope, {
          query: retrievalQuery(snapshot, brief, candidateKind),
          roleKey: seat.roleKey as CreativeRoleKey,
          mode: 'creative_exploration',
          canonRevision: snapshot.canonRevision,
          taskId: task.taskId,
          sourceTypes: ['fact', 'manuscript', 'outline', 'setting', 'wiki', 'voice'],
          limit: candidateKind === 'fusion' ? 12 : 9
        });
    const hardSources = buildHardSources(snapshot, brief, peerCandidates);
    const pack = this.contextPacks.build(scope, {
      taskId: task.taskId,
      agentId: seat.agentId,
      canonRevision: snapshot.canonRevision,
      positioningVersion: snapshot.positioningVersion,
      tokenBudget: candidateKind === 'fusion' ? 32_000 : 24_000,
      characterBudget: candidateKind === 'fusion' ? 76_000 : 58_000,
      policyVersion: 'volume-plan-context-v1',
      hardSources: [...hardSources, ...retrieved.hardSources],
      optionalSources: retrieved.optionalSources
    });
    const basePrompt = buildPrompt({
      seat,
      candidateKind,
      snapshot,
      brief,
      sources: pack.sources.map((source) => ({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        reason: source.reason,
        content: source.content
      })),
      peerCandidates
    });
    const content = await this.callForValidContent(scope, task, seat, candidateKind, basePrompt, pack.contextPackId);
    const version = this.volumePlans.addVersion(scope, brief.volumePlanId, {
      expectedPlanRevision: brief.expectedPlanRevision,
      candidateKind,
      parentVersionId: brief.expectedActiveVersionId,
      sourceTaskId: task.taskId,
      authorInputRefs: brief.authorInputRefs,
      template: brief.template,
      content,
      idempotencyKey: `${task.taskId}:${candidateKind}`
    });
    return { versionId: version.volumePlanVersionId, content: version.content };
  }

  private async callForValidContent(
    scope: BookScope,
    task: TaskRecord,
    seat: VolumePlanGenerationSeat,
    candidateKind: CandidateKind,
    basePrompt: string,
    contextPackId: string
  ): Promise<VolumePlanContent> {
    if (task.budgetId === null) throw new Error('卷规划任务缺少冻结预算。');
    const adapter = this.modelAdapters.resolve(
      seat.provider,
      seat.modelId,
      'discussion',
      seat.roleKey as CreativeRoleKey
    );
    let validationFailure: string | null = null;
    let lastError: unknown;
    for (let technicalTry = 1; technicalTry <= 2; technicalTry += 1) {
      const prompt = validationFailure === null
        ? basePrompt
        : `${basePrompt}\n\n上一份输出未通过结构校验：${validationFailure}\n请重新输出完整JSON，不要解释。`;
      const inputHash = createHash('sha256').update(prompt).digest('hex');
      const reusable = this.repository.succeededModelResult(scope, {
        taskId: task.taskId,
        agentId: seat.agentId,
        modelSnapshotId: seat.modelSnapshotId,
        inputHash
      });
      if (reusable !== undefined) {
        try {
          return parseVolumePlanModelOutput(reusable.output_text);
        } catch (error) {
          validationFailure = error instanceof Error ? error.message : '卷规划JSON无效';
          lastError = error;
          continue;
        }
      }
      const maxOutputTokens = 6_000;
      const protocolOverhead = adapter.provider === 'openai-codex-subscription' ? 24_000 : 0;
      const estimatedInputCeiling = Math.max(
        Math.ceil(prompt.length / 2),
        Math.ceil(estimateTokens(prompt) * 1.35)
      );
      const requestId = this.ids.next();
      const reservationId = this.budgets.reserve(
        scope,
        task.budgetId,
        requestId,
        Math.max(12_000, estimatedInputCeiling + maxOutputTokens + protocolOverhead),
        0
      );
      try {
        const result = await this.calls.execute(scope, {
          requestId,
          taskId: task.taskId,
          phaseKey: `${candidateKind}:attempt-${task.currentAttemptNo}:try-${technicalTry}`,
          agentId: seat.agentId,
          modelSnapshotId: seat.modelSnapshotId,
          provider: seat.provider,
          modelId: seat.modelId,
          input: prompt,
          parameters: JSON.stringify({
            maxOutputTokens,
            planOnly: !seat.provider.startsWith('local-deterministic'),
            cashFallbackAllowed: false
          }),
          reservationId,
          contextPackId,
          leaseToken: task.leaseToken,
          attemptNo: task.currentAttemptNo
        }, adapter, {
          requestId,
          taskId: task.taskId,
          ownerId: scope.ownerId,
          bookId: scope.bookId,
          agentId: seat.agentId,
          prompt,
          maxOutputTokens
        });
        try {
          return parseVolumePlanModelOutput(result.output);
        } catch (error) {
          validationFailure = error instanceof Error ? error.message : '卷规划JSON无效';
          lastError = error;
        }
      } catch (error) {
        lastError = error;
        if (this.repository.hasUnresolvedModelCall(scope, task.taskId)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('模型没有返回有效的卷规划。');
  }

  private requireCurrentSnapshot(
    scope: BookScope,
    brief: VolumePlanGenerationBrief
  ): VolumePlanGenerationSourceSnapshot {
    const snapshot = this.repository.sourceSnapshot(scope, brief.volumePlanId);
    if (snapshot === undefined) throw new Error('卷规划资料包依赖已经失效。');
    if (
      snapshot.planRevision !== brief.expectedPlanRevision
      || snapshot.activeVersionId !== brief.expectedActiveVersionId
      || volumePlanSourceFingerprint(snapshot) !== brief.sourceFingerprint
    ) {
      throw new DomainError(
        errorCodes.bookVersionConflict,
        '开书资料、设定、上一卷结算或当前卷版本已经变化，请重新生成候选。',
        {},
        false,
        409
      );
    }
    const workflow = this.volumePlans.workflow(scope);
    if (workflow.planningVersion !== brief.expectedWorkflowVersion) {
      throw new DomainError(
        errorCodes.bookVersionConflict,
        '创作流程已经变化，请重新生成候选。',
        {},
        false,
        409
      );
    }
    return snapshot;
  }

  private assertClaim(task: TaskRecord, workerId: string, leaseFence?: TaskLeaseFence): void {
    if (
      task.taskType !== 'volume_plan_generation'
      || task.status !== 'working'
      || task.leaseOwner !== workerId
      || (leaseFence !== undefined
        && (task.leaseToken !== leaseFence.leaseToken || task.currentAttemptNo !== leaseFence.attemptNo))
    ) throw new Error('卷规划任务未由指定Worker持有。');
  }

  private throwIfCancelled(scope: BookScope, taskId: string): void {
    if (this.tasks.require(scope, taskId).cancelRequested) {
      throw new DOMException('卷规划任务已取消。', 'AbortError');
    }
  }

  private storedIds(scope: BookScope, volumePlanId: string, taskId: string): {
    candidateAId: string | null;
    candidateBId: string | null;
    fusionId: string | null;
  } {
    return {
      candidateAId: this.repository.candidateByTask(scope, volumePlanId, taskId, 'candidate_a')?.volume_plan_version_id ?? null,
      candidateBId: this.repository.candidateByTask(scope, volumePlanId, taskId, 'candidate_b')?.volume_plan_version_id ?? null,
      fusionId: this.repository.candidateByTask(scope, volumePlanId, taskId, 'fusion')?.volume_plan_version_id ?? null
    };
  }
}

export function parseVolumePlanModelOutput(output: string): VolumePlanContent {
  const candidates: unknown[] = [];
  try { candidates.push(JSON.parse(output) as unknown); } catch { /* inspect embedded objects below */ }
  for (const value of extractCompleteJsonObjects(output)) {
    try { candidates.push(JSON.parse(value) as unknown); } catch { /* continue */ }
  }
  for (const candidate of candidates) {
    for (const value of unwrapCandidates(candidate)) {
      try { return parseVolumePlanContent(value); } catch { /* try the next shape */ }
    }
  }
  throw new Error('输出缺少完整、合法的卷规划JSON。');
}

function unwrapCandidates(value: unknown): unknown[] {
  if (!isRecord(value)) return [value];
  const nested = [
    value,
    value.content,
    value.volumePlan,
    value.payload,
    isRecord(value.workflowArtifact) ? value.workflowArtifact.payload : undefined,
    isRecord(value.fields) ? value.fields.content : undefined,
    isRecord(value.fields) && isRecord(value.fields.workflowArtifact)
      ? value.fields.workflowArtifact.payload
      : undefined
  ];
  return nested.filter((candidate) => candidate !== undefined);
}

function buildHardSources(
  snapshot: VolumePlanGenerationSourceSnapshot,
  brief: VolumePlanGenerationBrief,
  peerCandidates: VolumePlanContent[]
): ContextSource[] {
  const sources: ContextSource[] = [
    {
      sourceType: 'planning:opening_blueprint',
      sourceId: snapshot.opening.id,
      version: snapshot.opening.version,
      content: boundedSource(snapshot.opening.content, 14_000),
      reason: '作者确认的开书信息；未确认的故事方向只作为软参考',
      priority: 100
    },
    {
      sourceType: 'planning:setting_baseline',
      sourceId: snapshot.setting.id,
      version: snapshot.setting.version,
      content: boundedSource(snapshot.setting.content, 20_000),
      reason: '已确认设定基线；事实与能力边界必须遵守',
      priority: 100
    },
    {
      sourceType: 'planning:template_instance',
      sourceId: `template:${brief.volumePlanId}`,
      content: JSON.stringify(brief.template),
      reason: '作者本轮选择的大白话推进参考；是可调整脚手架，不是公式',
      priority: 100
    },
    {
      sourceType: 'owner:volume_ideas',
      sourceId: `author-ideas:${brief.volumePlanId}`,
      content: JSON.stringify(brief.authorIdeas),
      reason: '作者原话；must必须执行，preference与inspiration用于创意取向',
      priority: 100
    }
  ];
  if (snapshot.previousVolume !== null) {
    sources.push({
      sourceType: 'planning:previous_volume',
      sourceId: snapshot.previousVolume.id,
      version: snapshot.previousVolume.version,
      content: boundedSource(snapshot.previousVolume.content, 16_000),
      reason: '上一卷确认规划，仅用于理解承接责任',
      priority: 100
    });
  }
  if (snapshot.previousSettlement !== null) {
    sources.push({
      sourceType: 'planning:previous_volume_settlement',
      sourceId: snapshot.previousSettlement.id,
      version: snapshot.previousSettlement.version,
      content: boundedSource(snapshot.previousSettlement.content, 16_000),
      reason: '上一卷实际结算；下一卷必须从真实结束状态出发',
      priority: 100
    });
  }
  if (peerCandidates.length > 0) {
    sources.push({
      sourceType: 'planning:independent_volume_candidates',
      sourceId: `candidates:${brief.volumePlanId}`,
      content: JSON.stringify(peerCandidates),
      reason: '两位编剧独立完成的候选；模型来源以任务快照为准，主编可取舍但不得抹平真实差异',
      priority: 100
    });
  }
  return sources;
}

function buildPrompt(input: {
  seat: VolumePlanGenerationSeat;
  candidateKind: CandidateKind;
  snapshot: VolumePlanGenerationSourceSnapshot;
  brief: VolumePlanGenerationBrief;
  sources: Array<{ sourceType: string; sourceId: string; reason: string; content: string }>;
  peerCandidates: VolumePlanContent[];
}): string {
  const fusion = input.candidateKind === 'fusion';
  return JSON.stringify({
    operation: 'volume_plan_generation_v1',
    language: 'zh-CN',
    seat: {
      roleKey: input.seat.roleKey,
      displayName: input.seat.displayName,
      mode: fusion ? 'chief_editor_fusion' : 'independent_screenwriter'
    },
    book: {
      title: input.snapshot.bookTitle,
      volumeNumber: input.snapshot.planNumber
    },
    instructions: fusion ? [
      '只基于两份独立候选、作者原话和冻结资料包，形成一个可执行的融合候选。',
      '不要平均拼接。明确选择更有因果力量的路径，保留真正有价值的分歧和不确定项。',
      '卷规划约束目标、冲突、人物变化、事件因果与卷末接口，不锁死场景、对白和局部反转。',
      '事件之间必须由上一事件结果和人物新状态自然触发，不用巧合强行串联。',
      '只输出一个JSON对象，不要Markdown、解释、评分或内部思考。'
    ] : [
      '你与另一位编剧互相看不到答案。独立提出一条真正值得写、因果成立且结构有辨识度的卷路线。',
      input.seat.roleKey === 'lead_screenwriter'
        ? '优先从人物欲望、阻力、选择、代价和后果推演，不套固定爽点清单。'
        : '主动挑战最直觉的前提，寻找被忽略的关系、代价或结构路径，但反转必须能由前文因果支持。',
      '推进模板只是大白话脚手架，可以移动、合并或舍弃可选节点；不要在输出中使用猫咪、三幕、五幕等术语。',
      '卷规划约束目标、冲突、人物变化、事件因果与卷末接口，不锁死场景、对白和局部反转。',
      '只输出一个JSON对象，不要Markdown、解释、评分或内部思考。'
    ],
    sourcePolicy: {
      confirmedSettingIsFact: true,
      authorMustIsHard: true,
      authorPreferenceAndInspirationAreSoft: true,
      unsupportedCoreSettingAction: 'put the question into boundaries.openQuestions instead of inventing it'
    },
    sources: input.sources,
    outputContract: {
      title: '卷标题',
      openingState: '开卷时人物和局面',
      coreGoal: '本卷必须完成什么',
      coreConflict: '贯穿本卷的主要对抗',
      failureCost: '失败会失去什么',
      characterChanges: ['人物在本卷要发生的可见变化'],
      eventSequence: [{
        eventId: '本候选内唯一稳定标识',
        order: 1,
        title: '事件名称',
        responsibility: '为本卷承担什么任务',
        entryState: '从什么人物与局面状态进入',
        trigger: '什么因果触发事件',
        action: '人物采取什么行动',
        result: '行动造成什么新状态',
        leadsToNext: '如何自然触发下一事件；最后一个事件可为null',
        estimatedChapterRange: { minimum: null, likely: null, maximum: null }
      }],
      informationPlan: ['信息如何逐步释放'],
      escalationAndRecovery: ['压力如何升级以及人物如何获得喘息'],
      endingState: '卷末真实状态',
      openThreads: ['卷末仍开放的线索'],
      nextVolumeTrigger: '如何自然引出下一卷',
      boundaries: {
        mustAchieve: ['必须完成'],
        mustNotViolate: ['不能违反'],
        creativeFreedom: ['留给规划、章纲和主笔的自由'],
        openQuestions: ['需要作者以后确认或可继续探索']
      }
    }
  });
}

function retrievalQuery(
  snapshot: VolumePlanGenerationSourceSnapshot,
  brief: VolumePlanGenerationBrief,
  candidateKind: CandidateKind
): string {
  const authorText = brief.authorIdeas.flatMap((idea) => [
    idea.originalText,
    idea.scopeNotes ?? '',
    ...idea.attachmentExcerpts.map((attachment) => attachment.excerpt)
  ]).join(' ');
  return [
    snapshot.bookTitle,
    `第${snapshot.planNumber}卷规划`,
    candidateKind === 'fusion' ? '整合两个独立卷方案' : '人物目标 冲突 代价 因果 伏笔',
    authorText
  ].filter(Boolean).join(' ');
}

function boundedSource(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const half = Math.floor((limit - 120) / 2);
  return `${value.slice(0, half)}\n【中间内容未直接注入；需要时通过检索回查原始版本】\n${value.slice(-half)}`;
}

function parseBrief(value: Record<string, unknown>): VolumePlanGenerationBrief {
  const brief = value as unknown as VolumePlanGenerationBrief;
  if (
    brief.schema !== 'volume-plan-generation-v1'
    || typeof brief.volumePlanId !== 'string'
    || !Array.isArray(brief.seats)
    || !Array.isArray(brief.authorIdeas)
  ) throw new Error('卷规划任务资料包格式无效。');
  return brief;
}

function requiredSeat(seats: VolumePlanGenerationSeat[], roleKey: string): VolumePlanGenerationSeat {
  const seat = seats.find((candidate) => candidate.roleKey === roleKey);
  if (seat === undefined) throw new Error(`卷规划任务缺少冻结岗位：${roleKey}`);
  return seat;
}

function extractCompleteJsonObjects(value: string): string[] {
  const objects: string[] = [];
  for (let start = 0; start < value.length; start += 1) {
    if (value[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const character = value[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          objects.push(value.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }
  return objects;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
