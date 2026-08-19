import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { CreativeRoleKey } from '../../contracts/agent-team-v2.js';
import { parseProductionReview, type ProductionReview } from '../../contracts/production-review.js';
import { composeStyleToneText } from '../../contracts/opening-blueprint.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { resolveInside } from '../../infrastructure/files/file-utils.js';
import { ChapterChallengerReviewRepository } from '../../infrastructure/db/repositories/chapter-challenger-review-repository.js';
import { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { thinkingTokenAllowance } from '../../infrastructure/models/model-runtime-config.js';
import type { BudgetService } from '../budget/budget-service.js';
import type { ModelCallService } from '../calls/model-call-service.js';
import { ContextPackService, estimateTokens } from '../memory/context-pack-service.js';
import { TaskService, type TaskLeaseFence, type TaskRecord } from '../tasks/task-service.js';
import {
  enforceReviewerResponsibilityBoundary,
  groundProductionReviewEvidence,
  removeDeterministicLengthIssues
} from './production-review-service.js';
import type { ChapterChallengerReviewBrief } from './chapter-challenger-review-service.js';

const CHALLENGER_OUTPUT_TOKEN_LIMIT = 6_000;

export interface ChapterChallengerReviewResult {
  taskId: string;
  status: 'succeeded' | 'cancelled';
  reviewId: string;
}

/**
 * 挑剔读者妙玉的按需找茬（DEC-CURRENT-067）：不进入每章固定审校面板，
 * 结果只给作者参考，不参与定稿门禁。
 */
export class ChapterChallengerReviewPipelineService {
  public constructor(
    private readonly dataDir: string,
    private readonly repository: ChapterChallengerReviewRepository,
    private readonly tasks: TaskService,
    private readonly budgets: BudgetService,
    private readonly calls: ModelCallService,
    private readonly contextPacks: ContextPackService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly modelAdapters: ModelAdapterFactory
  ) {}

  public async executeClaimed(
    scope: BookScope,
    taskId: string,
    workerId: string,
    leaseFence?: TaskLeaseFence
  ): Promise<ChapterChallengerReviewResult> {
    const task = this.tasks.require(scope, taskId);
    this.assertClaim(task, workerId, leaseFence);
    const brief = task.brief as unknown as ChapterChallengerReviewBrief;
    const review = this.repository.findById(scope, brief.reviewId);
    if (review === undefined) throw new Error('挑剔读者找茬记录不存在。');
    if (review.status === 'succeeded') {
      return { taskId, status: 'succeeded', reviewId: review.review_id };
    }
    try {
      const content = this.loadManuscript(scope, brief.manuscriptVersionId);
      const confirmedSettings = this.confirmedSettingItems(scope);
      const volumeTone = this.currentVolumeTone(scope, brief.chapterId);
      const revisions = this.repository.bookRevisions(scope);
      const hardSources = [
        {
          sourceType: 'current_manuscript', sourceId: brief.manuscriptVersionId, content,
          reason: '挑剔读者逐段阅读的同一不可变完整正文', priority: 100
        },
        ...(confirmedSettings.length === 0 ? [] : [{
          sourceType: 'setting_confirmed_items', sourceId: `setting-confirmed:${scope.bookId}`,
          content: clipText(JSON.stringify(confirmedSettings), 4_000),
          reason: '作者逐项确认的设定内容；找茬时据此判断读者是否会出戏', priority: 99
        }]),
        ...(volumeTone.length === 0 ? [] : [{
          sourceType: 'volume_style_tone', sourceId: `volume-tone:${scope.bookId}:${brief.chapterId}`,
          content: volumeTone, reason: '当前卷确认的本卷基调与写作倾向', priority: 98
        }])
      ];
      const pack = this.contextPacks.build(scope, {
        taskId: task.taskId,
        agentId: brief.seat.agentId,
        chapterId: brief.chapterId,
        canonRevision: revisions.canonRevision,
        positioningVersion: revisions.positioningVersion,
        tokenBudget: 12_000,
        characterBudget: 30_000,
        policyVersion: 'chapter-challenger-review-context-v1',
        hardSources,
        optionalSources: []
      });
      const report = await this.callForValidReport(scope, task, brief, pack.contextPackId, content);
      const now = this.clock.now().toISOString();
      const reportJson = JSON.stringify(report);
      this.repository.markSucceeded(scope, review.review_id, {
        reportJson,
        reportHash: createHash('sha256').update(reportJson).digest('hex'),
        agentId: brief.seat.agentId,
        modelSnapshotId: brief.seat.modelSnapshotId,
        inputTokens: estimateTokens(content),
        now
      });
      this.tasks.checkpoint(scope, taskId, workerId, 'report_ready', {
        reviewId: review.review_id,
        issueCount: report.issues.length
      }, leaseFence);
      this.tasks.complete(scope, taskId, workerId, leaseFence);
      return { taskId, status: 'succeeded', reviewId: review.review_id };
    } catch (error) {
      const current = this.tasks.require(scope, taskId);
      const now = this.clock.now().toISOString();
      if (current.cancelRequested) {
        this.repository.markCancelled(scope, review.review_id, now);
        this.tasks.complete(scope, taskId, workerId, leaseFence);
        return { taskId, status: 'cancelled', reviewId: review.review_id };
      }
      const failureCode = 'CHALLENGER_REVIEW_FAILED';
      this.tasks.fail(scope, taskId, workerId, failureCode, leaseFence);
      this.repository.markFailed(scope, review.review_id, failureCode, now);
      throw error;
    }
  }

  private async callForValidReport(
    scope: BookScope,
    task: TaskRecord,
    brief: ChapterChallengerReviewBrief,
    contextPackId: string,
    content: string
  ): Promise<ProductionReview> {
    if (task.budgetId === null) throw new Error('挑剔读者找茬任务缺少冻结预算。');
    const adapter = this.modelAdapters.resolve(
      brief.seat.provider,
      brief.seat.modelId,
      'novel_reviewer',
      brief.seat.roleKey as CreativeRoleKey
    );
    const deterministic = brief.seat.provider.startsWith('local-deterministic');
    const basePrompt = buildPrompt(brief, content, deterministic);
    let validationFailure: string | null = null;
    let lastError: unknown;
    for (let technicalTry = 1; technicalTry <= 2; technicalTry += 1) {
      const prompt = validationFailure === null
        ? basePrompt
        : JSON.stringify({
            operation: 'repair_challenger_review_json',
            validationError: validationFailure,
            invalidOutput: '',
            instruction: '严格按上次要求重新输出完整JSON：verdict只允许pass|rewrite|blocked，issues每项只含location、issueType、severity、evidence、requiredAction，evidence必须逐字复制正文原句。只输出一个JSON对象。',
            originalRequest: JSON.parse(basePrompt) as unknown
          });
      const requestId = this.ids.next();
      const estimatedInputCeiling = Math.max(
        Math.ceil(prompt.length / 2),
        Math.ceil(estimateTokens(prompt) * 1.35)
      );
      const reservationId = this.budgets.reserve(
        scope,
        task.budgetId,
        requestId,
        Math.max(8_000, estimatedInputCeiling + CHALLENGER_OUTPUT_TOKEN_LIMIT + thinkingTokenAllowance(brief.seat.modelId)),
        0
      );
      try {
        const result = await this.calls.execute(scope, {
          requestId,
          taskId: task.taskId,
          phaseKey: `chapter-challenger-review:attempt-${task.currentAttemptNo}:try-${technicalTry}`,
          agentId: brief.seat.agentId,
          modelSnapshotId: brief.seat.modelSnapshotId,
          provider: brief.seat.provider,
          modelId: brief.seat.modelId,
          input: prompt,
          parameters: JSON.stringify({
            maxOutputTokens: CHALLENGER_OUTPUT_TOKEN_LIMIT,
            planOnly: !deterministic,
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
          agentId: brief.seat.agentId,
          prompt,
          maxOutputTokens: CHALLENGER_OUTPUT_TOKEN_LIMIT
        });
        try {
          return parseAndGround(result.output, brief, content);
        } catch (error) {
          validationFailure = error instanceof Error ? error.message : '挑剔读者报告JSON无效';
          lastError = error;
        }
      } catch (error) {
        lastError = error;
        if (!this.repository.hasUnresolvedModelCall(scope, requestId)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('挑剔读者没有返回有效的找茬报告。');
  }

  private loadManuscript(scope: BookScope, manuscriptVersionId: string): string {
    const relativePath = this.repository.manuscriptRelativePath(scope, manuscriptVersionId);
    if (relativePath === undefined) throw new Error('正文文件不存在或越权');
    return readFileSync(resolveInside(this.dataDir, relativePath), 'utf8');
  }

  private confirmedSettingItems(scope: BookScope): Array<{ itemKey: string; label: string; content: string }> {
    return this.repository.confirmedSettingItems(scope)
      .map((row) => ({ ...row, content: clipText(row.content.trim(), 600) }))
      .filter((row) => row.content.length > 0);
  }

  private currentVolumeTone(scope: BookScope, chapterId: string): string {
    const contentJson = this.repository.volumeToneContentJson(scope, chapterId);
    if (contentJson === undefined) return '';
    try {
      const content = JSON.parse(contentJson) as { stylePrimary?: unknown; styleSecondary?: unknown; focusExpression?: unknown };
      return composeStyleToneText(
        typeof content.stylePrimary === 'string' ? content.stylePrimary : null,
        typeof content.styleSecondary === 'string' ? content.styleSecondary : null,
        typeof content.focusExpression === 'string' ? content.focusExpression : null
      );
    } catch { return ''; }
  }

  private assertClaim(task: TaskRecord, workerId: string, leaseFence?: TaskLeaseFence): void {
    if (
      task.taskType !== 'chapter_challenger_review'
      || task.status !== 'working'
      || task.leaseOwner !== workerId
      || (leaseFence !== undefined
        && (task.leaseToken !== leaseFence.leaseToken || task.currentAttemptNo !== leaseFence.attemptNo))
    ) throw new Error('挑剔读者找茬任务未由指定Worker持有。');
  }
}

function buildPrompt(brief: ChapterChallengerReviewBrief, content: string, deterministic: boolean): string {
  return JSON.stringify({
    operation: 'chapter_challenger_review_v1',
    language: 'zh-CN',
    reviewerRole: 'challenger',
    manuscriptVersionId: brief.manuscriptVersionId,
    modelSnapshotId: brief.seat.modelSnapshotId,
    contract: '以挑剔老白读者立场找毒点、弃读风险和逻辑吐槽，每条给出具体位置和读者原话式表达，最多返回8条。这份报告只给作者参考，不参与定稿。',
    severityRubric: [
      'pass只能包含minor或observation；存在major必须为rewrite；存在不能自动修复的blocker必须为blocked。',
      '你是最挑剔的老白读者：专找毒点、逻辑吐槽点和弃读风险，每条给出具体位置和读者原话式吐槽。',
      'major只用于确实会让目标读者弃读或大面积吐槽的真毒点；口味差异、个人偏好和风格选择最多记observation，不为挑刺而挑刺。',
      '若requiredAction只需补充、删除或替换一两句，则severity最高只能是minor且verdict应为pass。',
      '人物姓名、人数、身份、正史、时间线、知识边界是否冲突由事实席独立裁决；你只记录读者是否会因此出戏。',
      '政治和情色合规风险由体验席独立评估；你不重复评级，只记录读者反应。'
    ],
    requiredSchema: {
      type: 'object',
      onlyTheseTopLevelFields: true,
      required: {
        reviewerRole: { const: 'challenger' },
        manuscriptVersionId: { const: brief.manuscriptVersionId },
        modelSnapshotId: { const: brief.seat.modelSnapshotId },
        verdict: { enum: ['pass', 'rewrite', 'blocked'], note: '必须使用英文枚举；pass不得包含major或blocker' },
        summary: '非空字符串',
        issues: {
          type: 'array', maxItems: 8,
          items: {
            location: '正文位置', issueType: '问题类型',
            severity: { enum: ['blocker', 'major', 'minor', 'observation'] },
            evidence: '只填当前完整正文中逐字复制的一段连续原句，不得解释、改写或引用章纲、旧稿、作者要求',
            requiredAction: '可执行修改要求'
          }
        },
        scores: { note: '至少一个0至100的有限数值；键名可按职责命名' }
      }
    },
    ...(deterministic ? { content } : {})
  });
}

function parseAndGround(
  raw: string,
  brief: ChapterChallengerReviewBrief,
  content: string
): ProductionReview {
  const parsed = parseProductionReview(raw, {
    reviewerRole: 'challenger',
    manuscriptVersionId: brief.manuscriptVersionId,
    modelSnapshotId: brief.seat.modelSnapshotId
  }, {
    normalizeRepairedVerdict: true,
    normalizeMalformedJsonStrings: true,
    normalizeIssueLocations: true,
    normalizeIssueLimit: true,
    normalizeScoreArray: true
  });
  const bounded = enforceReviewerResponsibilityBoundary(removeDeterministicLengthIssues(parsed));
  return groundProductionReviewEvidence(bounded, content, { allowDroppingUngroundedIssues: true });
}

function clipText(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit);
}
