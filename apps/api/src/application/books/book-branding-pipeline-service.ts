import { createHash } from 'node:crypto';
import { BOOK_TITLE_MAX_CHARACTERS, bookTitleCharacterCount } from '@wenmi/contracts';
import type { CreativeRoleKey } from '../../contracts/agent-team-v2.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { thinkingTokenAllowance } from '../../infrastructure/models/model-runtime-config.js';
import {
  BookBrandingDesignRepository,
  type BookBrandingDesignKind
} from '../../infrastructure/db/repositories/book-branding-design-repository.js';
import { VolumePlanGenerationRepository } from '../../infrastructure/db/repositories/volume-plan-generation-repository.js';
import type { BudgetService } from '../budget/budget-service.js';
import type { ModelCallService } from '../calls/model-call-service.js';
import { estimateTokens, type ContextPackService } from '../memory/context-pack-service.js';
import { TaskService, type TaskLeaseFence, type TaskRecord } from '../tasks/task-service.js';
import type { BookBrandingDesignBrief, BookBrandingOption } from './book-branding-design-service.js';

const BRANDING_OUTPUT_TOKEN_LIMIT = 4_000;
const MIN_OPTIONS = 3;
const MAX_OPTIONS = 8;
const SYNOPSIS_MIN_CHARACTERS = 30;
const SYNOPSIS_MAX_CHARACTERS = 2_000;

export interface BookBrandingDesignResult {
  taskId: string;
  status: 'succeeded' | 'cancelled';
  designId: string;
  optionCount: number;
}

export class BookBrandingDesignPipelineService {
  public constructor(
    private readonly repository: BookBrandingDesignRepository,
    private readonly generationRepository: VolumePlanGenerationRepository,
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
  ): Promise<BookBrandingDesignResult> {
    const task = this.tasks.require(scope, taskId);
    this.assertClaim(task, workerId, leaseFence);
    const brief = task.brief as unknown as BookBrandingDesignBrief;
    const design = this.repository.findById(scope, brief.designId);
    if (design === undefined) throw new Error('主编设计记录不存在。');
    if (design.status === 'succeeded') {
      return {
        taskId,
        status: 'succeeded',
        designId: design.design_id,
        optionCount: JSON.parse(design.options_json).length as number
      };
    }
    try {
      const snapshot = this.generationRepository.sourceSnapshot(scope, brief.volumePlanId);
      const firstVolume = this.repository.firstVolumePlan(scope);
      if (
        snapshot === undefined
        || firstVolume?.activeVersionContent === undefined
        || firstVolume?.activeVersionContent === null
      ) {
        throw new DomainError(
          errorCodes.operationIncomplete,
          '开书信息、设定基线或第一卷方案不完整，无法准备主编资料包。',
          {},
          false,
          409
        );
      }
      const fingerprint = createHash('sha256').update([
        brief.kind,
        snapshot.opening.hash,
        snapshot.setting.hash,
        firstVolume.activeVersionHash ?? '',
        brief.currentText
      ].join('\n')).digest('hex');
      if (fingerprint !== brief.sourceFingerprint) {
        throw new DomainError(
          errorCodes.bookVersionConflict,
          '开书资料、设定或第一卷方案已经变化，请重新让主编设计。',
          {},
          false,
          409
        );
      }
      const pack = this.contextPacks.build(scope, {
        taskId: task.taskId,
        agentId: brief.seat.agentId,
        canonRevision: snapshot.canonRevision,
        positioningVersion: snapshot.positioningVersion,
        tokenBudget: 12_000,
        characterBudget: 30_000,
        policyVersion: 'book-branding-context-v1',
        hardSources: [
          {
            sourceType: 'planning:opening_blueprint',
            sourceId: snapshot.opening.id,
            version: snapshot.opening.version,
            content: bounded(snapshot.opening.content, 10_000),
            reason: '作者确认的开书信息',
            priority: 100
          },
          {
            sourceType: 'planning:setting_baseline',
            sourceId: snapshot.setting.id,
            version: snapshot.setting.version,
            content: bounded(snapshot.setting.content, 12_000),
            reason: '已确认设定基线',
            priority: 100
          },
          {
            sourceType: 'planning:first_volume_plan',
            sourceId: firstVolume.activeVersionId ?? firstVolume.volumePlanId,
            content: bounded(firstVolume.activeVersionContent, 12_000),
            reason: '第一卷已确认方案，是书名与简介设计的主要依据',
            priority: 100
          }
        ],
        optionalSources: []
      });
      const options = await this.callForValidOptions(scope, task, brief, pack.contextPackId, {
        opening: bounded(snapshot.opening.content, 10_000),
        setting: bounded(snapshot.setting.content, 12_000),
        firstVolumePlan: bounded(firstVolume.activeVersionContent, 12_000)
      });
      const now = this.clock.now().toISOString();
      this.repository.markSucceeded(scope, design.design_id, JSON.stringify(options), now);
      this.tasks.checkpoint(scope, taskId, workerId, 'options_ready', {
        designId: design.design_id,
        kind: brief.kind,
        optionCount: options.length
      }, leaseFence);
      this.tasks.complete(scope, taskId, workerId, leaseFence);
      return { taskId, status: 'succeeded', designId: design.design_id, optionCount: options.length };
    } catch (error) {
      const current = this.tasks.require(scope, taskId);
      const now = this.clock.now().toISOString();
      if (current.cancelRequested) {
        this.repository.markCancelled(scope, design.design_id, now);
        this.tasks.complete(scope, taskId, workerId, leaseFence);
        return { taskId, status: 'cancelled', designId: design.design_id, optionCount: 0 };
      }
      const failureCode = error instanceof DomainError ? error.code : 'BOOK_BRANDING_DESIGN_FAILED';
      this.tasks.fail(scope, taskId, workerId, failureCode, leaseFence);
      this.repository.markFailed(scope, design.design_id, failureCode, now);
      throw error;
    }
  }

  private async callForValidOptions(
    scope: BookScope,
    task: TaskRecord,
    brief: BookBrandingDesignBrief,
    contextPackId: string,
    sources: { opening: string; setting: string; firstVolumePlan: string }
  ): Promise<BookBrandingOption[]> {
    if (task.budgetId === null) throw new Error('主编设计任务缺少冻结预算。');
    const adapter = this.modelAdapters.resolve(
      brief.seat.provider,
      brief.seat.modelId,
      'discussion',
      brief.seat.roleKey as CreativeRoleKey
    );
    const basePrompt = buildPrompt(brief, sources);
    let validationFailure: string | null = null;
    let lastError: unknown;
    for (let technicalTry = 1; technicalTry <= 2; technicalTry += 1) {
      const prompt = validationFailure === null
        ? basePrompt
        : `${basePrompt}\n\n上一份输出未通过结构校验：${validationFailure}\n请重新输出完整JSON，不要解释。`;
      const requestId = this.ids.next();
      const estimatedInputCeiling = Math.max(
        Math.ceil(prompt.length / 2),
        Math.ceil(estimateTokens(prompt) * 1.35)
      );
      const reservationId = this.budgets.reserve(
        scope,
        task.budgetId,
        requestId,
        Math.max(8_000, estimatedInputCeiling + BRANDING_OUTPUT_TOKEN_LIMIT + thinkingTokenAllowance(brief.seat.modelId)),
        0
      );
      try {
        const result = await this.calls.execute(scope, {
          requestId,
          taskId: task.taskId,
          phaseKey: `${brief.kind}:chief_editor:attempt-${task.currentAttemptNo}:try-${technicalTry}`,
          agentId: brief.seat.agentId,
          modelSnapshotId: brief.seat.modelSnapshotId,
          provider: brief.seat.provider,
          modelId: brief.seat.modelId,
          input: prompt,
          parameters: JSON.stringify({
            maxOutputTokens: BRANDING_OUTPUT_TOKEN_LIMIT,
            planOnly: !brief.seat.provider.startsWith('local-deterministic'),
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
          maxOutputTokens: BRANDING_OUTPUT_TOKEN_LIMIT
        });
        try {
          return parseBrandingOptions(result.output, brief.kind);
        } catch (error) {
          validationFailure = error instanceof Error ? error.message : '主编设计JSON无效';
          lastError = error;
        }
      } catch (error) {
        lastError = error;
        if (this.generationRepository.isUnresolvedModelCall(scope, requestId)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('主编没有返回有效的设计方案。');
  }

  private assertClaim(task: TaskRecord, workerId: string, leaseFence?: TaskLeaseFence): void {
    if (
      task.taskType !== 'book_branding_design'
      || task.status !== 'working'
      || task.leaseOwner !== workerId
      || (leaseFence !== undefined
        && (task.leaseToken !== leaseFence.leaseToken || task.currentAttemptNo !== leaseFence.attemptNo))
    ) throw new Error('主编设计任务未由指定Worker持有。');
  }
}

function buildPrompt(
  brief: BookBrandingDesignBrief,
  sources: { opening: string; setting: string; firstVolumePlan: string }
): string {
  const forTitle = brief.kind === 'title';
  return JSON.stringify({
    operation: 'book_branding_design_v1',
    language: 'zh-CN',
    kind: brief.kind,
    seat: {
      roleKey: brief.seat.roleKey,
      displayName: brief.seat.displayName,
      mode: 'chief_editor_branding'
    },
    book: { title: brief.kind === 'title' ? brief.currentText : undefined },
    current: { text: brief.currentText },
    instructions: [
      forTitle
        ? '你是这本书的主编。依据第一卷已确认的故事、已确认设定和开书信息，设计5个风格各异、都适合作者频道的书名候选。'
        : '你是这本书的主编。依据第一卷已确认的故事、已确认设定和开书信息，设计5个风格各异的书籍简介候选。',
      forTitle
        ? `每个书名不超过${BOOK_TITLE_MAX_CHARACTERS}个汉字，好记、有辨识度，不堆砌生僻词，不直接抄袭知名作品名。`
        : `每个简介${SYNOPSIS_MIN_CHARACTERS}到${SYNOPSIS_MAX_CHARACTERS}字，突出主角、核心冲突和爽点钩子，不剧透卷末结果，不用空泛宣传语。`,
      '每个候选附一句话设计说明，讲清它抓住的是故事的哪一面。',
      '候选之间必须有真实差异（视角、气味、卖点不同），不要换字凑数。',
      '只输出一个JSON对象：{"options":[{"text":"...","note":"..."},...]}，不要Markdown、解释或内部思考。'
    ],
    sources: {
      openingBlueprint: sources.opening,
      settingBaseline: sources.setting,
      firstVolumePlan: sources.firstVolumePlan
    }
  });
}

export function parseBrandingOptions(output: string, kind: BookBrandingDesignKind): BookBrandingOption[] {
  const candidates: unknown[] = [];
  try { candidates.push(JSON.parse(output) as unknown); } catch { /* inspect embedded objects below */ }
  for (const value of extractCompleteJsonObjects(output)) {
    try { candidates.push(JSON.parse(value) as unknown); } catch { /* continue */ }
  }
  for (const candidate of candidates) {
    const options = normalizeOptions(candidate, kind);
    if (options !== null) return options;
  }
  throw new Error('输出缺少完整、合法的主编设计JSON。');
}

function normalizeOptions(value: unknown, kind: BookBrandingDesignKind): BookBrandingOption[] | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const rawOptions = Array.isArray(record.options) ? record.options : null;
  if (rawOptions === null) return null;
  const seen = new Set<string>();
  const options: BookBrandingOption[] = [];
  for (const raw of rawOptions) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.text !== 'string') continue;
    const text = item.text.trim();
    const note = typeof item.note === 'string' ? item.note.trim() : '';
    if (!optionTextValid(text, kind)) continue;
    const key = text.toLocaleLowerCase('zh-CN');
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ text, note });
  }
  if (options.length < MIN_OPTIONS) return null;
  return options.slice(0, MAX_OPTIONS);
}

function optionTextValid(text: string, kind: BookBrandingDesignKind): boolean {
  if (kind === 'title') {
    return bookTitleCharacterCount(text) >= 2 && bookTitleCharacterCount(text) <= BOOK_TITLE_MAX_CHARACTERS;
  }
  return text.length >= SYNOPSIS_MIN_CHARACTERS && text.length <= SYNOPSIS_MAX_CHARACTERS;
}

function bounded(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n……（后续内容从略）`;
}

function extractCompleteJsonObjects(value: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        results.push(value.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return results;
}
