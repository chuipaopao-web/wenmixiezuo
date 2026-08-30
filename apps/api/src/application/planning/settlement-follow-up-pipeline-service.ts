import { parseSettlementPacingReport, type SettlementPacingReport, type StorylineGrowthCandidateContent } from '@wenmi/contracts';
import type { CreativeRoleKey } from '../../contracts/agent-team-v2.js';
import { DomainError } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { SettlementFollowUpRepository } from '../../infrastructure/db/repositories/settlement-follow-up-repository.js';
import type { VolumePlanGenerationSeat } from '../../infrastructure/db/repositories/volume-plan-generation-repository.js';
import type { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { thinkingTokenAllowance } from '../../infrastructure/models/model-runtime-config.js';
import type { BudgetService } from '../budget/budget-service.js';
import type { ModelCallService } from '../calls/model-call-service.js';
import { estimateTokens, type ContextPackService, type ContextSource } from '../memory/context-pack-service.js';
import { TaskService, type TaskLeaseFence, type TaskRecord } from '../tasks/task-service.js';
import type { SettlementFollowUpBrief } from './settlement-follow-up-service.js';
import type { CoreWorkflowService } from './core-workflow-service.js';

type FollowUpStep = 'pacing_check' | 'plain_summary' | 'storyline_growth';

interface StorylineGrowthOutput {
  candidates: Array<{
    candidateKind: 'emerging_line' | 'next_direction';
    storylineId: string | null;
    title: string;
    content: StorylineGrowthCandidateContent;
  }>;
}

export interface SettlementFollowUpResult {
  taskId: string;
  status: 'succeeded' | 'cancelled';
  pacingReady: boolean;
  summaryReady: boolean;
  storylineGrowthReady: boolean;
}

/**
 * 结算后续管线：主编对刚完成的结算做节奏体检，副编把结算结果写成大白话摘要。
 * 两份产物分别落库，失败可从已保存的检查点继续；结算本身不依赖本任务。
 */
export class SettlementFollowUpPipelineService {
  public constructor(
    private readonly repository: SettlementFollowUpRepository,
    private readonly tasks: TaskService,
    private readonly budgets: BudgetService,
    private readonly calls: ModelCallService,
    private readonly contextPacks: ContextPackService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly modelAdapters: ModelAdapterFactory,
    private readonly coreWorkflow: CoreWorkflowService
  ) {}

  public async executeClaimed(
    scope: BookScope,
    taskId: string,
    workerId: string,
    leaseFence?: TaskLeaseFence
  ): Promise<SettlementFollowUpResult> {
    const task = this.tasks.require(scope, taskId);
    this.assertClaim(task, workerId, leaseFence);
    const brief = parseBrief(task.brief);
    const row = this.repository.byTask(scope, taskId);
    if (row === undefined) throw new Error('结算后续记录不存在。');
    const pacingSeat = brief.seats.find((seat) => seat.editor);
    const summarySeat = brief.seats.find((seat) => seat.roleKey === 'deputy_editor');
    if (pacingSeat === undefined || summarySeat === undefined) {
      throw new Error('结算后续任务缺少主编或副编席位快照。');
    }
    try {
      this.throwIfCancelled(scope, taskId);
      if (row.pacing_report_json === null) {
        const report = await this.callStructured<SettlementPacingReport>(
          scope, task, brief, pacingSeat, 'pacing_check', parsePacingOutput
        );
        this.repository.savePacing(scope, taskId, {
          report,
          agentId: pacingSeat.agentId,
          modelSnapshotId: pacingSeat.modelSnapshotId,
          now: this.clock.now().toISOString()
        });
      }
      this.tasks.checkpoint(scope, taskId, workerId, 'pacing_complete', {
        pacingProducedBy: pacingSeat.agentId
      }, leaseFence);
      this.throwIfCancelled(scope, taskId);
      const current = this.repository.byTask(scope, taskId)!;
      if (current.summary_text === null) {
        const summary = await this.callStructured<{ summary: string }>(
          scope, task, brief, summarySeat, 'plain_summary', parseSummaryOutput
        );
        this.repository.saveSummary(scope, taskId, {
          summary: summary.summary,
          agentId: summarySeat.agentId,
          modelSnapshotId: summarySeat.modelSnapshotId,
          now: this.clock.now().toISOString()
        });
      }
      this.tasks.checkpoint(scope, taskId, workerId, 'summary_complete', {
        summaryProducedBy: summarySeat.agentId
      }, leaseFence);
      this.throwIfCancelled(scope, taskId);
      const evidenceRefs = [{
        sourceKind: `${brief.stageKind}_settlement`,
        sourceVersionId: brief.settlementId,
        locator: `第${brief.chapterStart}-${brief.chapterEnd}章`
      }];
      const projectedLedgerIds = this.coreWorkflow.projectSettlementToStorylines(scope, {
        stageKind: brief.stageKind,
        stageObjectId: brief.stageObjectId,
        settlementId: brief.settlementId,
        actual: brief.actual
      });
      const growthRoundId = this.coreWorkflow.createStorylineGrowthRound(scope, {
        triggerKind: brief.stageKind === 'volume' ? 'volume_settlement' : 'event_settlement',
        triggerObjectId: brief.stageObjectId,
        triggerVersionId: brief.settlementId,
        evidenceRefs,
        idempotencyKey: `settlement-growth:${brief.stageKind}:${brief.stageObjectId}:${brief.settlementId}`
      });
      const existingCandidates = this.coreWorkflow.view(scope).growth.candidates
        .filter((candidate) => candidate.growthRoundId === growthRoundId);
      const growth = existingCandidates.length > 0
        ? null
        : await this.callStructured<StorylineGrowthOutput>(
          scope, task, brief, pacingSeat, 'storyline_growth', parseStorylineGrowthOutput
        );
      if (growth !== null) {
        for (const candidate of growth.candidates) {
          this.coreWorkflow.addStorylineGrowthCandidate(scope, {
            growthRoundId,
            candidateKind: candidate.candidateKind,
            storylineId: candidate.storylineId,
            title: candidate.title,
            content: candidate.content,
            evidenceRefs,
            basedOnVersionIds: [brief.settlementId]
          });
        }
      }
      this.tasks.checkpoint(scope, taskId, workerId, 'storyline_growth_complete', {
        growthRoundId,
        projectedStorylineCount: projectedLedgerIds.length,
        candidateCount: growth?.candidates.length ?? existingCandidates.length
      }, leaseFence);
      this.tasks.complete(scope, taskId, workerId, leaseFence);
      return { taskId, status: 'succeeded', pacingReady: true, summaryReady: true, storylineGrowthReady: true };
    } catch (error) {
      const latest = this.tasks.require(scope, taskId);
      if (latest.cancelRequested) {
        this.tasks.complete(scope, taskId, workerId, leaseFence);
        return {
          taskId,
          status: 'cancelled',
          pacingReady: this.repository.byTask(scope, taskId)?.pacing_report_json !== null,
          summaryReady: this.repository.byTask(scope, taskId)?.summary_text !== null,
          storylineGrowthReady: false
        };
      }
      this.tasks.fail(
        scope, taskId, workerId,
        error instanceof DomainError ? error.code : 'SETTLEMENT_FOLLOW_UP_FAILED',
        leaseFence
      );
      throw error;
    }
  }

  private async callStructured<T>(
    scope: BookScope,
    task: TaskRecord,
    brief: SettlementFollowUpBrief,
    seat: VolumePlanGenerationSeat,
    step: FollowUpStep,
    parse: (output: string) => T
  ): Promise<T> {
    if (task.budgetId === null) throw new Error('结算后续任务缺少冻结预算。');
    const adapter = this.modelAdapters.resolve(
      seat.provider, seat.modelId, 'discussion', seat.roleKey as CreativeRoleKey
    );
    const pack = this.contextPacks.build(scope, {
      taskId: task.taskId,
      agentId: seat.agentId,
      canonRevision: 0,
      positioningVersion: 0,
      tokenBudget: 16_000,
      characterBudget: 40_000,
      policyVersion: 'settlement-follow-up-context-v1',
      hardSources: buildSources(brief),
      optionalSources: []
    });
    const basePrompt = buildPrompt(brief, seat, step, pack.sources.map((source) => ({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      reason: source.reason,
      content: source.content
    })));
    let validationFailure: string | null = null;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const prompt = validationFailure === null
        ? basePrompt
        : `${basePrompt}\n\n上一份输出未通过结构校验：${validationFailure}\n请重新输出完整JSON，不要解释。`;
      const requestId = this.ids.next();
      const maxOutputTokens = step === 'pacing_check' ? 4_000 : 6_000;
      const estimatedInputCeiling = Math.max(
        Math.ceil(prompt.length / 2),
        Math.ceil(estimateTokens(prompt) * 1.35)
      );
      const reservationId = this.budgets.reserve(
        scope, task.budgetId, requestId,
        Math.max(6_000, estimatedInputCeiling + maxOutputTokens + thinkingTokenAllowance(seat.modelId)), 0
      );
      try {
        const result = await this.calls.execute(scope, {
          requestId,
          taskId: task.taskId,
          phaseKey: `${step}:${seat.roleKey}:attempt-${task.currentAttemptNo}:try-${attempt}`,
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
          contextPackId: pack.contextPackId,
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
          return parse(result.output);
        } catch (error) {
          validationFailure = error instanceof Error ? error.message : '结算后续JSON无效';
          lastError = error;
        }
      } catch (error) {
        lastError = error;
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('模型没有返回有效的结算后续产物。');
  }

  private assertClaim(task: TaskRecord, workerId: string, leaseFence?: TaskLeaseFence): void {
    if (
      task.taskType !== 'settlement_follow_up'
      || task.status !== 'working'
      || task.leaseOwner !== workerId
      || (leaseFence !== undefined
        && (task.leaseToken !== leaseFence.leaseToken || task.currentAttemptNo !== leaseFence.attemptNo))
    ) throw new Error('结算后续任务未由指定Worker持有。');
  }

  private throwIfCancelled(scope: BookScope, taskId: string): void {
    if (this.tasks.require(scope, taskId).cancelRequested) {
      throw new DOMException('结算后续任务已取消。', 'AbortError');
    }
  }
}

function buildSources(brief: SettlementFollowUpBrief): ContextSource[] {
  const sources: ContextSource[] = [
    {
      sourceType: 'settlement:planned',
      sourceId: `planned:${brief.stageObjectId}`,
      content: JSON.stringify(brief.planned),
      reason: '当时确认的规划，只用于对照，不代表实际发生',
      priority: 100, truthStatus: 'planned', knowledgeZone: 'author_plan', constraintStrength: 'soft_reference'
    },
    {
      sourceType: 'settlement:actual',
      sourceId: brief.settlementId,
      content: JSON.stringify(brief.actual),
      reason: '结算记录的正史实际结果，是节奏体检的唯一事实依据',
      priority: 100, truthStatus: 'actual', knowledgeZone: 'hard_fact', constraintStrength: 'hard_fact'
    },
    {
      sourceType: 'settlement:deviation',
      sourceId: `deviation:${brief.stageObjectId}`,
      content: JSON.stringify(brief.deviation),
      reason: '计划与实际的差异对照',
      priority: 90, truthStatus: 'actual', knowledgeZone: 'hard_fact', constraintStrength: 'hard_fact'
    }
  ];
  if (brief.genreBrief !== null) {
    sources.push({
      sourceType: 'planning:genre_brief',
      sourceId: `genre:${brief.stageObjectId}`,
      content: brief.genreBrief,
      reason: '作者确认的题材定位；节奏评价必须贴合本书题材',
      priority: 100, truthStatus: 'planned', knowledgeZone: 'author_plan', constraintStrength: 'soft_reference'
    });
  }
  return sources;
}

function buildPrompt(
  brief: SettlementFollowUpBrief,
  seat: VolumePlanGenerationSeat,
  step: FollowUpStep,
  sources: Array<{ sourceType: string; sourceId: string; reason: string; content: string }>
): string {
  const stageLabel = brief.stageKind === 'event' ? '事件' : '卷';
  const mode = step === 'pacing_check'
    ? 'chief_editor_pacing_check'
    : step === 'plain_summary'
      ? 'deputy_editor_summary'
      : 'chief_editor_storyline_growth';
  const instructions = step === 'pacing_check' ? [
    `你正在对刚完成结算的${stageLabel}《${brief.title}》做节奏体检。`,
    '只依据结算记录的实际结果评价节奏，不回头改写规划，不替作者做决定。',
    '逐项检查爽点与付费点位置、高潮间隔、连续压抑时长和恢复节拍。',
    '发现的问题必须指出大致章节区间或事件位置，建议必须可执行并说明预期收益。',
    '只输出一个JSON对象，不要Markdown、解释或内部思考。'
  ] : step === 'plain_summary' ? [
    `你正在把刚完成结算的${stageLabel}《${brief.title}》写成作者一眼能看懂的大白话摘要。`,
    '说清实际发生了什么、谁的状态变了、哪些问题解决了、哪些线索还悬着。',
    '用大白话，不用术语，不复述计划，不超过六句话。',
    '只输出一个JSON对象，不要Markdown、解释或内部思考。'
  ] : [
    `你是主编，正在根据刚完成结算的${stageLabel}《${brief.title}》提炼故事线下一段。`,
    '正文和结算实际结果是事实；规划只用于对照。不得把推断写成已经发生。',
    '只推荐下一卷到未来两卷看得见的范围，不要求全书故事线或最终结局。',
    '给出2到3个目标、冲突或代价真正不同的方向；证据不足时可把其中一项写为继续观察。',
    '每项必须说明自然延伸证据、主角卷入原因、核心问题、未知点和误判风险。',
    '只有跨事件持续出现且证据充分的矛盾才可标为 emerging_line；否则使用 next_direction。',
    '只输出一个JSON对象，不要Markdown、解释或内部思考。'
  ];
  const outputContract = step === 'pacing_check' ? {
    overallAssessment: '节奏总评，一两句', payoffPlacement: '爽点与付费点位置评价',
    climaxSpacing: '高潮间隔评价', pressureDuration: '压抑时长评价', recoveryBeats: '恢复节拍评价',
    risks: ['按严重度排序的节奏风险，每条带位置'], suggestions: ['可执行建议与预期收益']
  } : step === 'plain_summary' ? {
    summary: '大白话摘要，不超过六句话'
  } : {
    candidates: [{
      candidateKind: 'next_direction 或 emerging_line', storylineId: null,
      title: '候选方向标题',
      content: {
        summary: '下一段可能怎么走或继续观察', continuationReason: '从哪些结算事实自然延伸',
        protagonistInvolvement: '主角为什么继续卷入', coreQuestion: '下一段核心问题',
        pushesStorylineIds: [], mayCreateStoryline: false,
        inferences: ['明确标为推断、尚未发生的内容'], unknowns: ['仍未决定的问题'],
        misreadRisk: '误判风险', recommendedHorizonVolumes: 1
      }
    }]
  };
  return JSON.stringify({
    operation: 'settlement_follow_up_v1', language: 'zh-CN',
    seat: { roleKey: seat.roleKey, displayName: seat.displayName, mode },
    subject: { stageKind: brief.stageKind, title: brief.title,
      chapterRange: { start: brief.chapterStart, end: brief.chapterEnd } },
    instructions, sources, outputContract
  });
}
export function parsePacingOutput(output: string): SettlementPacingReport {
  for (const candidate of jsonCandidates(output)) {
    try {
      return parseSettlementPacingReport(candidate);
    } catch { /* try next */ }
  }
  throw new Error('输出缺少合法的节奏体检JSON。');
}

export function parseStorylineGrowthOutput(output: string): StorylineGrowthOutput {
  for (const candidate of jsonCandidates(output)) {
    if (!isRecord(candidate) || !Array.isArray(candidate.candidates)) continue;
    const rows = candidate.candidates;
    if (rows.length < 1 || rows.length > 3) continue;
    const parsed: StorylineGrowthOutput['candidates'] = [];
    let valid = true;
    for (const row of rows) {
      if (!isRecord(row) || !['emerging_line', 'next_direction'].includes(String(row.candidateKind))
        || typeof row.title !== 'string' || row.title.trim() === '' || !isRecord(row.content)) { valid = false; break; }
      const content = row.content;
      const requiredText = ['summary', 'continuationReason', 'protagonistInvolvement', 'coreQuestion', 'misreadRisk']
        .every((key) => typeof content[key] === 'string' && String(content[key]).trim() !== '');
      const requiredArrays = ['pushesStorylineIds', 'inferences', 'unknowns']
        .every((key) => Array.isArray(content[key]) && content[key].every((item) => typeof item === 'string'));
      if (!requiredText || !requiredArrays || typeof content.mayCreateStoryline !== 'boolean'
        || !Number.isInteger(content.recommendedHorizonVolumes)
        || Number(content.recommendedHorizonVolumes) < 1 || Number(content.recommendedHorizonVolumes) > 2) { valid = false; break; }
      parsed.push({
        candidateKind: row.candidateKind as 'emerging_line' | 'next_direction',
        storylineId: typeof row.storylineId === 'string' && row.storylineId.trim() !== '' ? row.storylineId : null,
        title: row.title.trim(),
        content: content as unknown as StorylineGrowthCandidateContent
      });
    }
    if (valid) return { candidates: parsed };
  }
  throw new Error('输出缺少合法的故事线提炼候选JSON。');
}
export function parseSummaryOutput(output: string): { summary: string } {
  for (const candidate of jsonCandidates(output)) {
    if (
      typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
      && typeof (candidate as Record<string, unknown>).summary === 'string'
      && ((candidate as Record<string, unknown>).summary as string).trim().length > 0
    ) {
      return { summary: ((candidate as Record<string, unknown>).summary as string).trim() };
    }
  }
  throw new Error('输出缺少合法的大白话摘要JSON。');
}

function jsonCandidates(output: string): unknown[] {
  const candidates: unknown[] = [];
  try { candidates.push(JSON.parse(output) as unknown); } catch { /* inspect embedded objects */ }
  for (let start = 0; start < output.length; start += 1) {
    if (output[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let index = start; index < output.length; index += 1) {
      const char = output[index]!;
      if (inString) {
        if (escape) escape = false;
        else if (char === '\\') escape = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try { candidates.push(JSON.parse(output.slice(start, index + 1)) as unknown); } catch { /* continue */ }
          start = index;
          break;
        }
      }
    }
  }
  return candidates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseBrief(value: Record<string, unknown>): SettlementFollowUpBrief {
  const brief = value as unknown as SettlementFollowUpBrief;
  if (
    brief.schema !== 'settlement-follow-up-v1'
    || typeof brief.stageObjectId !== 'string'
    || !Array.isArray(brief.seats)
  ) throw new Error('结算后续任务资料格式无效。');
  return brief;
}
