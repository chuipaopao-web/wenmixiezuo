import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { modelProfileKeyForBinding, type V7OpeningMemberDefinition } from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { V7OpeningModelAdapterResolver } from '../../infrastructure/models/v7-opening-agent-model-gateway.js';
import { ModelAdapterError } from '../../infrastructure/models/model-adapter.js';
import { thinkingTokenAllowance } from '../../infrastructure/models/model-runtime-config.js';
import {
  type V7BookTitleDesignRow,
  V7BookTitleDesignRepository
} from '../../infrastructure/db/repositories/v7-book-title-design-repository.js';
import { assertMembershipAllowsGeneration } from '../../infrastructure/security/membership-service.js';
import { SupplementalAccountUsageRepository } from '../../infrastructure/security/account-usage-service.js';
import { parseBrandingOptions } from './book-branding-pipeline-service.js';
import type { BookBrandingOption } from './book-branding-design-service.js';
import { BookProfileViewService, type BookProfileView } from './book-profile-view-service.js';
import type { V7DesignTaskView } from './v7-design-task-view.js';
import { resolveV7TaskPolicy } from '../agents/v7-agent-runtime-policy.js';
import { compileV7RuntimePrompt } from '../agents/v7-runtime-prompt-compiler.js';
import { V7PromptGovernanceRepository } from '../../infrastructure/db/repositories/v7-prompt-governance-repository.js';

export interface V7BookTitleDesignView {
  designId: string;
  status: 'working' | 'succeeded' | 'failed';
  statusText: string;
  memberName: string;
  options: BookBrandingOption[];
  createdAt: string;
  updatedAt: string;
}

export interface V7BookTitleStudioView { designs: V7BookTitleDesignView[]; }

export interface V7BookTitleDesignInput {
  idempotencyKey?: unknown;
  platformStyle?: unknown;
  titleFlavor?: unknown;
  authorDirection?: unknown;
}

export class V7BookTitleDesignService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly repository: V7BookTitleDesignRepository,
    private readonly adapters: V7OpeningModelAdapterResolver,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly roster: () => readonly V7OpeningMemberDefinition[],
    private readonly credentials: Readonly<{ codingPlan: boolean; agentPlan: boolean }>
  ) {}

  public studio(ownerId: string, bookId: string): V7BookTitleStudioView {
    return { designs: this.repository.list(ownerId, bookId).map((row) => this.view(row)) };
  }

  public tasks(ownerId: string, limit: number): V7DesignTaskView[] {
    return this.repository.listForOwner(ownerId, limit).map((row) => ({
      designId: row.design_id,
      taskKind: 'title_design',
      bookId: row.book_id,
      bookTitle: row.book_title,
      status: row.state,
      statusText: titleStatusText(row.state),
      memberNames: [this.roster().find((member) => member.memberKey === row.member_key)?.displayName ?? '主编'],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  public async design(ownerId: string, bookId: string, input: V7BookTitleDesignInput): Promise<V7BookTitleDesignView> {
    const idempotencyKey = actionKey(input.idempotencyKey);
    const preferences = titlePreferences(input);
    const profile = new BookProfileViewService(this.database).get({ ownerId, bookId });
    const requestHash = createHash('sha256').update(JSON.stringify({ bookId, version: profile.version, profile: profile.openingBlueprint, preferences })).digest('hex');
    const existing = this.repository.find(ownerId, bookId, idempotencyKey);
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash) throw new DomainError(errorCodes.validation, '本次书名设计编号已经用于旧版本，请重新设计。', {}, false, 409);
      if (existing.state === 'succeeded') return this.view(existing);
      if (existing.state === 'working') return this.view(existing);
      throw new DomainError(errorCodes.operationIncomplete, '对不起，主编这次没有完成书名设计，请重新设计一组。', {}, true, 409);
    }

    const member = this.chief();
    const prompt = titlePrompt(profile, preferences);
    const designId = this.ids.next();
    const now = this.clock.now().toISOString();
    const runtimePolicy = resolveV7TaskPolicy(this.database, member.memberKey, 'title_design');
    const promptGovernance = new V7PromptGovernanceRepository(this.database);
    promptGovernance.ensureSourceRegistrySeeded(now);
    const compiled = compileV7RuntimePrompt({
      requestId: designId,
      ownerId,
      bookId,
      taskId: designId,
      memberKey: member.memberKey,
      runtimeRoleKey: member.roleKey,
      modelProfileKey: modelProfileKeyForBinding(member.model),
      taskKind: 'title_design',
      workstationKey: 'title',
      sourcePrompt: prompt,
      promptAssets: promptGovernance.publishedAssets(),
      genreProfile: promptGovernance.activeBookGenreProfile(ownerId, bookId),
      governanceRevision: promptGovernance.summary().revision,
      temperature: runtimePolicy.temperature,
      createdAt: now
    });
    promptGovernance.saveRuntimeBundle(compiled);
    this.repository.create({
      designId, ownerId, bookId, idempotencyKey, requestHash, sourceVersion: profile.version,
      memberKey: member.memberKey, promptHash: compiled.manifest.compiledPromptHash,
      governanceRevision: runtimePolicy.governanceRevision, temperature: runtimePolicy.temperature, now
    });

    const maxOutputTokens = 1_200;
    const reserved = Math.max(8_000, compiled.manifest.compiledPrompt.length + maxOutputTokens + thinkingTokenAllowance(member.model.modelId, 'structured_planning', maxOutputTokens));
    const accountUsage = new SupplementalAccountUsageRepository(this.database);
    try {
      assertMembershipAllowsGeneration(this.database, ownerId, now, reserved);
      accountUsage.start({
        sourceKind: 'v7_title', sourceId: designId, ownerId, bookId,
        provider: member.model.provider, modelId: member.model.modelId,
        reservedTokens: reserved, startedAt: now
      });
      const adapter = this.adapters.resolve(member.model.provider, member.model.modelId, 'structured_planning');
      const result = await adapter.generate({
        requestId: designId, taskId: `v7-title-${designId}`, ownerId, bookId, agentId: member.memberKey,
        prompt: compiled.manifest.compiledPrompt, maxOutputTokens, temperature: runtimePolicy.temperature
      });
      const modelCompletedAt = this.clock.now().toISOString();
      accountUsage.succeed({
        sourceKind: 'v7_title', sourceId: designId,
        inputTokens: Math.max(0, result.inputTokens), outputTokens: Math.max(0, result.outputTokens),
        cashMicros: Math.max(0, Math.round(result.cashCostCny * 1_000_000)), completedAt: modelCompletedAt
      });
      const options = parseBrandingOptions(result.output, 'title').filter((option) => Array.from(option.text).length <= 15);
      if (options.length < 3) throw new Error('书名候选不足三项');
      const completedAt = this.clock.now().toISOString();
      this.repository.succeed({
        designId, ownerId, bookId, provider: result.provider, modelId: result.modelId,
        inputTokens: Math.max(0, result.inputTokens), outputTokens: Math.max(0, result.outputTokens),
        cashMicros: Math.max(0, Math.round(result.cashCostCny * 1_000_000)),
        options: options.slice(0, 5), completedAt
      });
      return this.view(this.repository.find(ownerId, bookId, idempotencyKey)!);
    } catch (error) {
      const failedAt = this.clock.now().toISOString();
      if (error instanceof ModelAdapterError && error.outcomeUnknown) {
        accountUsage.markUnknown('v7_title', designId, failedAt);
      } else {
        accountUsage.fail('v7_title', designId, failedAt);
      }
      this.repository.fail({
        designId, ownerId, bookId,
        message: error instanceof Error ? error.message : '书名设计失败',
        failedAt
      });
      throw new DomainError(errorCodes.operationIncomplete, '对不起，主编这次没有完成书名设计。开书资料没有受到影响，请重新设计。', {}, true, 503);
    }
  }

  private chief(): V7OpeningMemberDefinition {
    const available = this.roster().filter((member) => member.roleKey === 'chief_editor' && member.enabledByDefault && (
      member.model.plan === 'coding' ? this.credentials.codingPlan : this.credentials.agentPlan
    )).sort((left, right) => Number(right.defaultForRole) - Number(left.defaultForRole) || left.fallbackPriority - right.fallbackPriority);
    const member = available[0];
    if (member === undefined) throw new DomainError(errorCodes.operationIncomplete, '主编当前都在请假，请稍后再试。', {}, true, 409);
    return member;
  }

  private view(row: V7BookTitleDesignRow): V7BookTitleDesignView {
    const member = this.roster().find((entry) => entry.memberKey === row.member_key);
    const options = row.state === 'succeeded' ? JSON.parse(row.options_json) as BookBrandingOption[] : [];
    return {
      designId: row.design_id,
      status: row.state,
      statusText: titleStatusText(row.state),
      memberName: member?.displayName ?? '主编',
      options,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

function titleStatusText(state: V7BookTitleDesignRow['state']): string {
  if (state === 'working') return '主编正在加急设计书名，您可以先离开，任务会继续保存。';
  if (state === 'succeeded') return '书名候选已经设计完成，请选择喜欢的一项。';
  return '这轮书名设计没有完成，工作记录已经保留，可以重新设计。';
}

interface TitlePreferences {
  platformStyle: 'qidian' | 'fanqie' | 'mainstream';
  titleFlavor: 'high-concept' | 'strong-conflict' | 'identity-gap' | 'suspense' | 'epic';
  authorDirection: string;
}

function titlePrompt(profile: BookProfileView, preferences: TitlePreferences): string {
  return JSON.stringify({
    operation: 'v7_book_title_design',
    language: 'zh-CN',
    book: {
      currentTitle: profile.title,
      channel: profile.channel,
      category: profile.category,
      subjects: profile.subjects,
      tags: [...profile.mainTags, ...profile.customTags],
      protagonists: profile.protagonists,
      world: profile.openingBlueprint.worldBackground,
      opening: profile.openingStart,
      direction: profile.storyDirection,
      ending: profile.storyEnding
    },
    authorChoice: preferences,
    instructions: [
      '你是这本书的主编。只设计书名，不修改其他开书资料。',
      '给出5个真正不同的中文书名，每个2至15字；好记、吸睛、有脑洞，符合频道和题材，不照搬知名作品。',
      '起点风：短、稳、有题材辨识和升级想象；番茄风：冲突或反差一眼可懂，卖点更直接；主流通用：兼顾质感和点击欲。',
      '严格落实作者选择的平台倾向、吸睛方式和补充想法。五个候选至少覆盖三种不同命名结构，禁止全部使用“地名+身份”“时代+职业”这种平淡拼接。',
      '书名必须钩住本书独有的人物处境、核心冲突、能力反差或长期野心，不能只换近义词，也不能使用“某年某人”“某地小卒”式占位感名称。',
      '吸睛不能牺牲词义、人物状态和时代事实的准确性；不得用“尸体、亡者、帝王”等已经成立的身份指代尚未成为该身份的活人，也不得为了夸张虚构资料包里不存在的能力、系统、后宫或结局。',
      '每个候选附一句大白话说明，说明读者为什么会想点开，以及它抓住了本书哪个独有卖点。',
      '只输出JSON：{"options":[{"text":"书名","note":"一句说明"}]}。不要Markdown或内部思考。'
    ]
  });
}

function titlePreferences(input: V7BookTitleDesignInput): TitlePreferences {
  return {
    platformStyle: input.platformStyle === 'qidian' || input.platformStyle === 'fanqie' || input.platformStyle === 'mainstream' ? input.platformStyle : 'mainstream',
    titleFlavor: input.titleFlavor === 'high-concept' || input.titleFlavor === 'strong-conflict' || input.titleFlavor === 'identity-gap' || input.titleFlavor === 'suspense' || input.titleFlavor === 'epic' ? input.titleFlavor : 'high-concept',
    authorDirection: optionalDirection(input.authorDirection)
  };
}

function optionalDirection(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (Array.from(text).length > 800) throw new DomainError(errorCodes.validation, '书名补充想法最多800字。');
  return text;
}

function actionKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9_-]{8,128}$/u.test(key)) throw new DomainError(errorCodes.validation, '书名设计编号无效，请重新操作。');
  return key;
}
