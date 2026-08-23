import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { BOOK_TITLE_MAX_CHARACTERS, bookTitleCharacterCount, limitBookTitle } from '@wenmi/contracts';
import type { TeamModelProfile } from '../../contracts/agent-team-v2.js';
import {
  OPENING_TAXONOMY,
  type OpeningChannel,
  type OpeningProtagonistInput,
  type ProtagonistRole
} from '../../contracts/opening-blueprint.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertOwnerScope, type OwnerScope } from '../../domain/scope.js';
import { assertMembershipAllowsGeneration } from '../../infrastructure/security/membership-service.js';
import { ModelAdapterError } from '../../infrastructure/models/model-adapter.js';
import { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { thinkingTokenAllowance } from '../../infrastructure/models/model-runtime-config.js';
import {
  PrebookOpeningDesignRepository,
  type PrebookOpeningDesignCallRow
} from '../../infrastructure/db/repositories/prebook-opening-design-repository.js';

const OUTPUT_TOKEN_LIMIT = 6_000;
const MAX_TECHNICAL_TRIES = 2;
const STALE_WORKING_MS = 30 * 60 * 1_000;
const MEMBER = { roleKey: 'chief_editor' as const, displayName: '貂蝉' };

export interface PrebookOpeningDesignData {
  title: string;
  channel: OpeningChannel;
  categoryKey: string;
  auxiliaryTags: string[];
  mainTags: string[];
  storyTraits: string[];
  customTags: string[];
  targetAudience: string;
  protagonists: OpeningProtagonistInput[];
  worldBackground: string;
  openingBackground: string;
  openingStart: string;
  storyDirection: string;
  storyEnding: string;
  mustFollow: string[];
}

export interface PrebookOpeningDesignView {
  idempotencyKey: string;
  status: 'working' | 'succeeded' | 'failed';
  member: typeof MEMBER;
  design: PrebookOpeningDesignData | null;
  errorMessage: string | null;
  updatedAt: string;
}

export class PrebookOpeningDesignService {
  private readonly calls: PrebookOpeningDesignRepository;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly modelAdapters: ModelAdapterFactory,
    private readonly chiefProfile: TeamModelProfile
  ) {
    this.calls = new PrebookOpeningDesignRepository(database);
  }

  public start(scope: OwnerScope, input: { idea: string; idempotencyKey: string }): {
    view: PrebookOpeningDesignView;
    started: boolean;
  } {
    assertOwnerScope(scope);
    const idea = normalizeIdea(input.idea);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const inputHash = hashIdea(idea);
    this.expireStale(scope);
    const existing = this.rows(scope, idempotencyKey);
    if (existing.length > 0) {
      this.assertSameInput(existing, inputHash);
      return { view: this.viewFromRows(idempotencyKey, existing), started: false };
    }
    const prompt = buildPrebookOpeningPrompt(idea);
    const reservedTokens = reservationCeiling(prompt, this.chiefProfile.modelId);
    const now = this.clock.now().toISOString();
    this.calls.inImmediateTransaction(() => {
      assertMembershipAllowsGeneration(this.database, scope.ownerId, now, reservedTokens);
      this.insertAttempt(scope, idempotencyKey, inputHash, 1, reservedTokens, now);
    });
    return { view: this.inspect(scope, idempotencyKey), started: true };
  }

  public inspect(scope: OwnerScope, idempotencyKeyValue: string): PrebookOpeningDesignView {
    assertOwnerScope(scope);
    const idempotencyKey = normalizeIdempotencyKey(idempotencyKeyValue);
    this.expireStale(scope);
    const rows = this.rows(scope, idempotencyKey);
    if (rows.length === 0) {
      throw new DomainError(errorCodes.operationIncomplete, '没有找到这次开书设计。', {}, false, 404);
    }
    return this.viewFromRows(idempotencyKey, rows);
  }

  public async execute(scope: OwnerScope, input: { idea: string; idempotencyKey: string }): Promise<void> {
    assertOwnerScope(scope);
    const idea = normalizeIdea(input.idea);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const inputHash = hashIdea(idea);
    const basePrompt = buildPrebookOpeningPrompt(idea);
    let validationFailure: string | null = null;
    for (let attemptNo = 1; attemptNo <= MAX_TECHNICAL_TRIES; attemptNo += 1) {
      const row = this.rows(scope, idempotencyKey).find((item) => item.attempt_no === attemptNo);
      if (row === undefined || row.state !== 'working') return;
      this.assertSameInput([row], inputHash);
      const prompt = validationFailure === null
        ? basePrompt
        : `${basePrompt}\n\n上一份输出没有通过页面合同校验：${validationFailure}\n请重新输出完整JSON，不要解释。`;
      const adapter = this.modelAdapters.resolve(
        this.chiefProfile.provider,
        this.chiefProfile.modelId,
        'discussion',
        MEMBER.roleKey
      );
      const startedAt = Date.now();
      try {
        const result = await adapter.generate({
          requestId: row.call_id,
          taskId: `prebook-opening-${idempotencyKey}`,
          ownerId: scope.ownerId,
          bookId: 'prebook-opening-design',
          agentId: 'prebook-chief-editor',
          prompt,
          maxOutputTokens: OUTPUT_TOKEN_LIMIT
        });
        if (result.provider !== adapter.provider || result.modelId !== adapter.modelId) {
          throw new Error('模型返回来源与已验证适配器不一致');
        }
        const durationMs = Math.max(0, Date.now() - startedAt);
        try {
          const design = parsePrebookOpeningDesign(result.output);
          this.markSucceeded(scope, row.call_id, result, durationMs, design, null);
          return;
        } catch (error) {
          validationFailure = error instanceof Error ? error.message : '主编设计JSON无效';
          this.markSucceeded(scope, row.call_id, result, durationMs, null, validationFailure);
          if (attemptNo >= MAX_TECHNICAL_TRIES) return;
          this.createRepairAttempt(scope, idempotencyKey, inputHash, attemptNo + 1, prompt);
        }
      } catch (error) {
        const interrupted = error instanceof ModelAdapterError && error.outcomeUnknown;
        this.markFailed(scope, row.call_id, interrupted ? 'interrupted' : 'failed', error);
        return;
      }
    }
  }

  private createRepairAttempt(
    scope: OwnerScope,
    idempotencyKey: string,
    inputHash: string,
    attemptNo: number,
    prompt: string
  ): void {
    const now = this.clock.now().toISOString();
    const reservedTokens = reservationCeiling(prompt, this.chiefProfile.modelId);
    this.calls.inImmediateTransaction(() => {
      assertMembershipAllowsGeneration(this.database, scope.ownerId, now, reservedTokens);
      this.insertAttempt(scope, idempotencyKey, inputHash, attemptNo, reservedTokens, now);
    });
  }

  private insertAttempt(
    scope: OwnerScope,
    idempotencyKey: string,
    inputHash: string,
    attemptNo: number,
    reservedTokens: number,
    now: string
  ): void {
    this.calls.insertAttempt({
      callId: this.ids.next(), ownerId: scope.ownerId, idempotencyKey, attemptNo, inputHash,
      memberName: MEMBER.displayName, provider: this.chiefProfile.provider,
      modelId: this.chiefProfile.modelId, reservedTokens, now
    });
  }

  private markSucceeded(
    scope: OwnerScope,
    callId: string,
    result: { inputTokens: number; outputTokens: number; cashCostCny: number },
    durationMs: number,
    design: PrebookOpeningDesignData | null,
    validationFailure: string | null
  ): void {
    const now = this.clock.now().toISOString();
    const updated = this.calls.markSucceeded({
      ownerId: scope.ownerId, callId,
      inputTokens: Math.max(0, result.inputTokens), outputTokens: Math.max(0, result.outputTokens),
      cashMicros: Math.max(0, Math.round(result.cashCostCny * 1_000_000)), durationMs,
      resultJson: design === null ? null : JSON.stringify(design),
      errorClass: validationFailure === null ? null : 'invalid_output',
      errorDetail: validationFailure?.slice(0, 1_000) ?? null, now
    });
    if (updated !== 1) throw new Error('开书设计调用状态已经变化，拒绝重复结算');
  }

  private markFailed(
    scope: OwnerScope,
    callId: string,
    state: 'failed' | 'interrupted',
    error: unknown
  ): void {
    const now = this.clock.now().toISOString();
    const detail = error instanceof Error ? error.message : String(error);
    const errorClass = error instanceof ModelAdapterError ? error.failureClass : 'technical_failure';
    this.calls.markFailed({
      ownerId: scope.ownerId, callId, state, errorClass,
      errorDetail: detail.slice(0, 1_000), now
    });
  }

  private expireStale(scope: OwnerScope): void {
    const now = this.clock.now();
    const cutoff = new Date(now.getTime() - STALE_WORKING_MS).toISOString();
    const nowIso = now.toISOString();
    this.calls.expireStale(scope.ownerId, cutoff, nowIso);
  }

  private rows(scope: OwnerScope, idempotencyKey: string): PrebookOpeningDesignCallRow[] {
    return this.calls.rows(scope.ownerId, idempotencyKey);
  }

  private assertSameInput(rows: PrebookOpeningDesignCallRow[], inputHash: string): void {
    if (rows.some((row) => row.input_hash !== inputHash)) {
      throw new DomainError(errorCodes.validation, '这次设计编号已经用于另一段开书思路，请重新发起。', {}, false, 409);
    }
  }

  private viewFromRows(idempotencyKey: string, rows: PrebookOpeningDesignCallRow[]): PrebookOpeningDesignView {
    const succeeded = [...rows].reverse().find((row) => row.state === 'succeeded' && row.result_json !== null);
    if (succeeded?.result_json !== null && succeeded?.result_json !== undefined) {
      return {
        idempotencyKey,
        status: 'succeeded',
        member: MEMBER,
        design: JSON.parse(succeeded.result_json) as PrebookOpeningDesignData,
        errorMessage: null,
        updatedAt: succeeded.updated_at
      };
    }
    const working = [...rows].reverse().find((row) => row.state === 'working');
    if (working !== undefined) {
      return {
        idempotencyKey,
        status: 'working',
        member: MEMBER,
        design: null,
        errorMessage: null,
        updatedAt: working.updated_at
      };
    }
    const latest = rows.at(-1)!;
    return {
      idempotencyKey,
      status: 'failed',
      member: MEMBER,
      design: null,
      errorMessage: latest.state === 'interrupted'
        ? '主编连接中断，结果状态暂时无法确认。请稍后用新的设计请求重试。'
        : latest.error_class === 'invalid_output'
          ? '主编返回的信息没有通过完整性检查，请重新设计。'
          : '主编这次没有完成设计，开书思路已经保留，可以重试。',
      updatedAt: latest.updated_at
    };
  }
}

export function buildPrebookOpeningPrompt(idea: string): string {
  return JSON.stringify({
    operation: 'prebook_opening_design_v1',
    language: 'zh-CN',
    seat: { roleKey: MEMBER.roleKey, displayName: MEMBER.displayName, mode: 'opening_chief_editor' },
    authorIdea: idea,
    taxonomy: {
      version: OPENING_TAXONOMY.version,
      categories: OPENING_TAXONOMY.categories.map((item) => ({
        key: item.key,
        name: item.name,
        channel: item.channel,
        recommendedMainTags: item.recommendedMainTags
      })),
      subjects: OPENING_TAXONOMY.subjects.map((item) => item.name),
      personalityExamples: OPENING_TAXONOMY.personalityOptions
    },
    instructions: [
      '你是本书专门负责开书的主编。尊重作者核心创意，在不改变主角、穿越方向和核心脑洞的前提下，一次性补齐页面需要的开书信息。',
      '判断频道和唯一作品分类；融合题材通常2至3个；本书标签4至8个。分类key、题材和推荐标签优先使用给定目录中的原词。',
      `书名不超过${BOOK_TITLE_MAX_CHARACTERS}个汉字，要有题材信号和辨识度，不直接模仿已知作品名。`,
      '时代背景要说清年代或朝代、社会环境，以及历史、架空、高武或现代等性质。角色背景要说清原来身份、来源、到达地点与当前身份。',
      '开局必须同时包含主角处境、触发事件和眼前危机，足以支持前三章；故事方向要说明持续看点、成长线和主要矛盾，但不要提前设计完整设定、第一卷事件或章节。',
      '结局只是可修改方向，不是不可变正史。作者没有提出禁区时，mustFollow返回["无额外限制"]，不得替作者创造限制。',
      '字段之间必须一致。不要输出备选方案、讨论过程、解释、Markdown、模型术语或内部思考。',
      '只输出一个JSON对象，严格使用outputSchema里的字段。'
    ],
    outputSchema: {
      title: '2至15字书名',
      channel: 'male或female',
      categoryKey: '目录中的分类key',
      auxiliaryTags: ['目录中的融合题材'],
      mainTags: ['目录中的本书标签'],
      storyTraits: ['可留空'],
      targetAudience: '一句话目标读者',
      protagonists: [{
        role: 'male_lead/female_lead/co_lead/ensemble/non_human之一',
        name: '姓名', age: '数字年龄', background: '角色整体背景',
        familyBackground: '家庭与出身', careerBackground: '职业或当前身份',
        goldenFinger: '没有则留空', personalities: ['1至6个性格词']
      }],
      worldBackground: '时代背景',
      openingBackground: '故事开始前的直接背景',
      openingStart: '开局',
      storyDirection: '可持续的故事方向',
      storyEnding: '可修改的结局方向',
      mustFollow: ['作者明确限制；没有则只写无额外限制']
    }
  });
}

export function parsePrebookOpeningDesign(output: string): PrebookOpeningDesignData {
  const candidates: unknown[] = [];
  try { candidates.push(JSON.parse(output) as unknown); } catch { /* inspect embedded JSON below */ }
  for (const value of extractCompleteJsonObjects(output)) {
    try { candidates.push(JSON.parse(value) as unknown); } catch { /* continue */ }
  }
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try { return normalizeDesign(candidate); } catch (error) {
      lastError = error instanceof Error ? error : new Error('开书设计格式无效');
    }
  }
  throw lastError ?? new Error('输出缺少完整、合法的开书设计JSON');
}

function normalizeDesign(value: unknown): PrebookOpeningDesignData {
  if (!isRecord(value)) throw new Error('开书设计必须是JSON对象');
  const title = limitBookTitle(text(value.title, 80));
  if (bookTitleCharacterCount(title) < 2) throw new Error('书名至少需要2个字');
  const channel: OpeningChannel = value.channel === 'male' || value.channel === 'female'
    ? value.channel
    : (() => { throw new Error('频道必须是male或female'); })();
  const rawCategory = text(value.categoryKey, 120);
  const category = OPENING_TAXONOMY.categories.find((item) => item.key === rawCategory || item.name === rawCategory);
  if (category === undefined || category.channel !== channel) throw new Error('作品分类不在当前频道目录中');
  const allowedSubjects = new Set(OPENING_TAXONOMY.subjects.map((item) => item.name));
  const subjectCandidates = uniqueTexts(value.auxiliaryTags, 8, 40).filter((item) => allowedSubjects.has(item));
  const matchingSubjectFallbacks = OPENING_TAXONOMY.subjects.filter((item) => (
    item.packKeys.includes('common') || item.packKeys.some((pack) => category.tagPackKeys.includes(pack))
  )).map((item) => item.name);
  const auxiliaryTags = [...new Set([...subjectCandidates, ...matchingSubjectFallbacks])].slice(0, 3);
  const allowedMainTags = new Set(OPENING_TAXONOMY.mainTags);
  const rawMainTags = uniqueTexts(value.mainTags, 12, 40);
  const matchingTagFallbacks = OPENING_TAXONOMY.tagGroups.filter((group) => (
    group.key === 'common' || group.packKeys.some((pack) => category.tagPackKeys.includes(pack))
  )).flatMap((group) => group.mainTags);
  const mainTags = [...new Set([
    ...rawMainTags.filter((item) => allowedMainTags.has(item)),
    ...category.recommendedMainTags.filter((item) => allowedMainTags.has(item)),
    ...matchingTagFallbacks.filter((item) => allowedMainTags.has(item))
  ])].filter((item) => item !== category.name && !auxiliaryTags.includes(item)).slice(0, 8);
  if (mainTags.length < 4) throw new Error('本书标签不足4个有效目录词');
  const customTags = rawMainTags.filter((item) => !allowedMainTags.has(item)).slice(0, 5);
  const allowedTraits = new Set(OPENING_TAXONOMY.storyTraits);
  const storyTraits = uniqueTexts(value.storyTraits, 8, 40).filter((item) => allowedTraits.has(item));
  const protagonists = normalizeProtagonists(value.protagonists, channel);
  const worldBackground = requiredText(value.worldBackground, '时代背景', 2_000, 8);
  const openingStart = requiredText(value.openingStart, '开局', 300, 4);
  const storyDirection = requiredText(value.storyDirection, '故事方向', 300, 8);
  const storyEnding = requiredText(value.storyEnding, '结局', 300, 2);
  const openingBackground = text(value.openingBackground, 2_000) || openingStart;
  const mustFollow = uniqueTexts(value.mustFollow, 15, 500);
  return {
    title,
    channel,
    categoryKey: category.key,
    auxiliaryTags,
    mainTags,
    storyTraits,
    customTags,
    targetAudience: text(value.targetAudience, 500),
    protagonists,
    worldBackground,
    openingBackground,
    openingStart,
    storyDirection,
    storyEnding,
    mustFollow: mustFollow.length === 0 ? ['无额外限制'] : mustFollow
  };
}

function normalizeProtagonists(value: unknown, channel: OpeningChannel): OpeningProtagonistInput[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('至少需要一位主角');
  const validRoles = new Set<ProtagonistRole>([
    'male_lead', 'female_lead', 'co_lead', 'ensemble', 'non_human',
    'male_support', 'female_support', 'male_villain', 'female_villain'
  ]);
  return value.slice(0, 2).map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`第${index + 1}位主角格式无效`);
    const requestedRole = text(raw.role, 40) as ProtagonistRole;
    const role = validRoles.has(requestedRole)
      ? requestedRole
      : channel === 'male' ? 'male_lead' : 'female_lead';
    const background = requiredText(raw.background, `第${index + 1}位主角背景`, 2_000, 4);
    const familyBackground = text(raw.familyBackground, 2_000) || background;
    const age = text(raw.age, 20).replace(/[^0-9]/gu, '').slice(0, 5);
    if (age.length === 0) throw new Error(`第${index + 1}位主角年龄必须是数字`);
    const personalities = uniqueTexts(raw.personalities, 6, 40);
    if (personalities.length === 0) throw new Error(`第${index + 1}位主角至少需要一个性格词`);
    return {
      role,
      name: requiredText(raw.name, `第${index + 1}位主角姓名`, 80, 1),
      age,
      background,
      familyBackground,
      careerBackground: text(raw.careerBackground, 2_000),
      goldenFinger: text(raw.goldenFinger, 2_000),
      personalities
    };
  });
}

function normalizeIdea(value: unknown): string {
  const idea = typeof value === 'string' ? value.trim() : '';
  if (idea.length < 4) throw new DomainError(errorCodes.validation, '请至少用4个字说清开书思路。');
  if (idea.length > 1_000) throw new DomainError(errorCodes.validation, '开书思路最多1000字，请先保留最核心的想法。');
  return idea;
}

function normalizeIdempotencyKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9_-]{8,128}$/u.test(key)) {
    throw new DomainError(errorCodes.validation, '开书设计编号无效，请重新发起。');
  }
  return key;
}

function hashIdea(idea: string): string {
  return createHash('sha256').update(idea).digest('hex');
}

function reservationCeiling(prompt: string, modelId: string): number {
  return Math.max(8_000, prompt.length + OUTPUT_TOKEN_LIMIT + thinkingTokenAllowance(modelId));
}

function requiredText(value: unknown, label: string, maximum: number, minimum: number): string {
  const result = text(value, maximum);
  if (result.length < minimum) throw new Error(`${label}内容不足`);
  return result;
}

function text(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function uniqueTexts(value: unknown, maximumItems: number, maximumLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, maximumLength)).filter(Boolean))].slice(0, maximumItems);
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
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        results.push(value.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return results;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
