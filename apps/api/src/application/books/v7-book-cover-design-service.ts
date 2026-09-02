import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import {
  modelProfileKeyForBinding,
  parseStructuredObject,
  V7_VISUAL_MEMBERS,
  type V7OpeningMemberDefinition,
  type V7VisualMemberDefinition
} from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import {
  type V7BookCoverDesignRow,
  type V7CoverWorkOrder,
  V7BookCoverDesignRepository
} from '../../infrastructure/db/repositories/v7-book-cover-design-repository.js';
import { resolveInside, safeSegment } from '../../infrastructure/files/file-utils.js';
import type { V7OpeningModelAdapterResolver } from '../../infrastructure/models/v7-opening-agent-model-gateway.js';
import { ModelAdapterError } from '../../infrastructure/models/model-adapter.js';
import {
  V7CoverImageGatewayError,
  type V7CoverImageGateway
} from '../../infrastructure/models/volcengine-ark-image-gateway.js';
import { thinkingTokenAllowance } from '../../infrastructure/models/model-runtime-config.js';
import { assertMembershipAllowsGeneration } from '../../infrastructure/security/membership-service.js';
import { SupplementalAccountUsageRepository } from '../../infrastructure/security/account-usage-service.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { BookProfileViewService, type BookProfileView } from './book-profile-view-service.js';
import type { V7DesignTaskView } from './v7-design-task-view.js';
import { resolveV7TaskPolicy } from '../agents/v7-agent-runtime-policy.js';
import { compileV7RuntimePrompt } from '../agents/v7-runtime-prompt-compiler.js';
import { V7PromptGovernanceRepository } from '../../infrastructure/db/repositories/v7-prompt-governance-repository.js';

export interface V7BookCoverDesignView {
  designId: string;
  status: 'working' | 'succeeded' | 'failed';
  statusText: string;
  adopted: boolean;
  chiefName: string;
  visualMembers: Array<{ memberKey: string; displayName: string; roleName: string; responsibility: string; avatarPath: string }>;
  workOrder: Omit<V7CoverWorkOrder, 'imagePrompt'> | null;
  imageUrl: string | null;
  downloadUrl: string | null;
  createdAt: string;
}

export interface V7BookCoverStudioView {
  visualMembers: Array<{
    memberKey: string;
    displayName: string;
    roleName: string;
    responsibility: string;
    avatarPath: string;
    status: 'on_duty' | 'on_leave';
    statusText: string;
  }>;
  designs: V7BookCoverDesignView[];
}

export interface V7BookCoverDesignInput {
  idempotencyKey?: unknown;
  platformStyle?: unknown;
  visualStyle?: unknown;
  compositionStyle?: unknown;
  paletteStyle?: unknown;
  atmosphereStyle?: unknown;
  elements?: unknown;
  avoidElements?: unknown;
  authorDirection?: unknown;
}

export class V7BookCoverDesignService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly repository: V7BookCoverDesignRepository,
    private readonly textAdapters: V7OpeningModelAdapterResolver,
    private readonly images: V7CoverImageGateway,
    private readonly dataDir: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly openingRoster: () => readonly V7OpeningMemberDefinition[],
    private readonly credentials: Readonly<{ codingPlan: boolean; agentPlan: boolean }>,
    private readonly visualRoster: () => readonly V7VisualMemberDefinition[] = () => V7_VISUAL_MEMBERS
  ) {}

  public studio(ownerId: string, bookId: string): V7BookCoverStudioView {
    return {
      visualMembers: this.visualMemberViews(),
      designs: this.repository.list(ownerId, bookId).map((row) => this.view(row))
    };
  }

  public tasks(ownerId: string, limit: number): V7DesignTaskView[] {
    const roster = this.openingRoster();
    return this.repository.listForOwner(ownerId, limit).map((row) => {
      const chiefName = roster.find((member) => member.memberKey === row.chief_member_key)?.displayName ?? '主编';
      const visualNames = this.visualRoster().map((member) => member.displayName);
      return {
        designId: row.design_id,
        taskKind: 'cover_design',
        bookId: row.book_id,
        bookTitle: row.book_title,
        status: row.state,
        statusText: row.state === 'working'
          ? '主编和封面画师正在制作封面，您可以先离开，任务会继续保存。'
          : row.state === 'succeeded'
            ? '封面已经制作完成，可以打开书籍查看和下载。'
            : '这轮封面制作没有完成，工作记录已经保留，可以重新设计。',
        memberNames: [...new Set([chiefName, ...visualNames])],
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });
  }

  public async design(ownerId: string, bookId: string, input: V7BookCoverDesignInput): Promise<V7BookCoverDesignView> {
    const idempotencyKey = actionKey(input.idempotencyKey);
    const preferences = coverPreferences(input);
    const profile = new BookProfileViewService(this.database).get({ ownerId, bookId });
    const authorPenName = resolveCoverPenName(this.repository, ownerId);
    const requestHash = createHash('sha256').update(JSON.stringify({ bookId, version: profile.version, blueprint: profile.openingBlueprint, preferences })).digest('hex');
    const existing = this.repository.findByAction(ownerId, bookId, idempotencyKey);
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash) throw new DomainError(errorCodes.validation, '本次封面编号已经用于旧版资料，请重新设计。', {}, false, 409);
      if (existing.state === 'succeeded') return this.view(existing);
      if (existing.state === 'working') return this.view(existing);
      throw new DomainError(errorCodes.operationIncomplete, '对不起，视觉编辑部这次没有完成，您可以重新发起一次封面设计。', {}, true, 409);
    }
    const renderer = this.visualMember('visual_renderer');
    if (!this.images.configured || !renderer.enabledByDefault) {
      throw new DomainError(errorCodes.operationIncomplete, '对不起，视觉编辑部这次未能开始制作，开书资料不受影响。', {}, true, 409);
    }
    const chiefs = this.availableChiefs();
    if (chiefs.length === 0) throw new DomainError(errorCodes.operationIncomplete, '主编当前都在请假，暂时无法下达封面制作工单。', {}, true, 409);
    const designId = this.ids.next();
    const now = this.clock.now().toISOString();
    const chiefPolicy = resolveV7TaskPolicy(this.database, chiefs[0]!.memberKey, 'cover_brief');
    const renderPolicy = resolveV7TaskPolicy(this.database, renderer.memberKey, 'cover_render');
    this.repository.create({
      designId, ownerId, bookId, idempotencyKey, requestHash, sourceVersion: profile.version,
      chiefMemberKey: chiefs[0]!.memberKey, visualMemberKey: renderer.memberKey,
      governanceRevision: Math.max(chiefPolicy.governanceRevision, renderPolicy.governanceRevision),
      chiefTemperature: chiefPolicy.temperature, visualTemperature: renderPolicy.temperature, now
    });

    let workOrder: V7CoverWorkOrder | null = null;
    let actualChief: V7OpeningMemberDefinition | null = null;
    for (const chief of chiefs) {
      const assignedAt = this.clock.now().toISOString();
      this.repository.assignChief(ownerId, bookId, designId, chief.memberKey, assignedAt);
      try {
        workOrder = await this.createWorkOrder(ownerId, bookId, designId, chief, profile, preferences);
        actualChief = chief;
        break;
      } catch {
        // 当前主编没有交付合法工单，直接交接给下一位，不把内部故障暴露给作者。
      }
    }
    if (workOrder === null || actualChief === null) {
      const failedAt = this.clock.now().toISOString();
      this.repository.fail(ownerId, bookId, designId, '所有主编均未交付合法封面工单', failedAt);
      throw new DomainError(errorCodes.operationIncomplete, '对不起，主编这次没有完成封面工单，请稍后再试。', {}, true, 503);
    }

    try {
      const renderCreatedAt = this.clock.now().toISOString();
      const promptGovernance = new V7PromptGovernanceRepository(this.database);
      promptGovernance.ensureSourceRegistrySeeded(renderCreatedAt);
      const renderRequestId = `${designId}-${renderer.memberKey}-render`;
      const renderManifest = compileV7RuntimePrompt({
        requestId: renderRequestId,
        ownerId,
        bookId,
        taskId: renderRequestId,
        memberKey: renderer.memberKey,
        runtimeRoleKey: renderer.roleKey,
        modelProfileKey: modelProfileKeyForBinding({
          provider: renderer.provider,
          modelId: renderer.defaultModelId,
          plan: renderer.plan
        }),
        taskKind: 'cover_render',
        workstationKey: 'cover_render',
        sourcePrompt: workOrder.imagePrompt,
        promptAssets: promptGovernance.publishedAssets(),
        genreProfile: promptGovernance.activeBookGenreProfile(ownerId, bookId),
        governanceRevision: promptGovernance.summary().revision,
        temperature: renderPolicy.temperature,
        createdAt: renderCreatedAt
      });
      promptGovernance.saveRuntimeBundle(renderManifest);
      const accountUsage = new SupplementalAccountUsageRepository(this.database);
      accountUsage.start({
        sourceKind: 'v7_cover_image', sourceId: designId, ownerId, bookId,
        provider: 'volcengine-ark-image', modelId: this.images.modelId,
        reservedUnits: 1, startedAt: renderCreatedAt
      });
      let image: Awaited<ReturnType<V7CoverImageGateway['generate']>>;
      try {
        image = await this.images.generate({ requestId: designId, prompt: renderManifest.manifest.compiledPrompt });
        accountUsage.succeed({
          sourceKind: 'v7_cover_image', sourceId: designId,
          consumedUnits: 1, completedAt: this.clock.now().toISOString()
        });
      } catch (error) {
        const failedAt = this.clock.now().toISOString();
        if (error instanceof V7CoverImageGatewayError && error.outcomeUnknown) {
          accountUsage.markUnknown('v7_cover_image', designId, failedAt);
        } else {
          accountUsage.fail('v7_cover_image', designId, failedAt);
        }
        throw error;
      }
      const finishedImage = await composeFinalCover(image.buffer, profile.title, authorPenName);
      const extension = '.png';
      const safeBookId = safeSegment(bookId, '书籍编号');
      const safeDesignId = safeSegment(designId, '封面编号');
      const relativePath = `books/${safeBookId}/covers/${safeDesignId}${extension}`;
      const finalPath = resolveInside(this.dataDir, relativePath);
      const temporaryPath = `${finalPath}.working`;
      mkdirSync(dirname(finalPath), { recursive: true });
      writeFileSync(temporaryPath, finishedImage.buffer, { flag: 'wx' });
      renameSync(temporaryPath, finalPath);
      const completedAt = this.clock.now().toISOString();
      try {
        new UnitOfWork(this.database).run(() => {
          const operationId = this.ids.next();
          this.repository.recordSucceededArtifact({
            operationId,
            fileId: this.ids.next(),
            ownerId,
            bookId,
            designId,
            visualMemberKeys: [renderer.memberKey],
            sourceVersion: profile.version,
            authorPenName,
            preferences,
            relativePath,
            contentHash: finishedImage.contentHash,
            sizeBytes: finishedImage.buffer.length,
            completedAt
          });
          this.repository.succeed({
            ownerId, bookId, designId, workOrder, promptHash: renderManifest.manifest.compiledPromptHash,
            provider: image.provider, modelId: image.modelId, mimeType: finishedImage.mimeType,
            contentHash: finishedImage.contentHash, sizeBytes: finishedImage.buffer.length, relativePath, completedAt
          });
        });
      } catch (error) {
        rmSync(finalPath, { force: true });
        throw error;
      }
      return this.view(this.repository.require(ownerId, bookId, designId), actualChief.displayName);
    } catch (error) {
      const failedAt = this.clock.now().toISOString();
      this.repository.fail(ownerId, bookId, designId, error instanceof Error ? error.message : '封面制作失败', failedAt);
      throw new DomainError(errorCodes.operationIncomplete, '对不起，视觉编辑部这次没有完成制作，您可以重新发起。', {}, true, 503);
    }
  }

  public adopt(ownerId: string, bookId: string, designId: string): V7BookCoverDesignView {
    const row = new UnitOfWork(this.database).run(() => this.repository.adopt(ownerId, bookId, designId, this.clock.now().toISOString()));
    return this.view(row);
  }

  public readImage(ownerId: string, bookId: string, designId: string): { mimeType: string; buffer: Buffer } {
    const row = this.repository.require(ownerId, bookId, designId);
    if (row.state !== 'succeeded' || row.image_relative_path === null || row.image_mime_type === null) {
      throw new DomainError(errorCodes.validation, '这张封面还没有制作完成', {}, false, 409);
    }
    const path = resolveInside(this.dataDir, row.image_relative_path);
    const buffer = readFileSync(path);
    const hash = createHash('sha256').update(buffer).digest('hex');
    if (hash !== row.image_content_hash) throw new DomainError(errorCodes.operationIncomplete, '封面文件校验失败，请重新设计。', {}, true, 503);
    return { mimeType: row.image_mime_type, buffer };
  }

  private availableChiefs(): V7OpeningMemberDefinition[] {
    return this.openingRoster().filter((member) => member.roleKey === 'chief_editor' && member.enabledByDefault && (
      member.model.plan === 'coding' ? this.credentials.codingPlan : this.credentials.agentPlan
    )).toSorted((left, right) => Number(right.defaultForRole) - Number(left.defaultForRole) || left.fallbackPriority - right.fallbackPriority);
  }

  private async createWorkOrder(
    ownerId: string,
    bookId: string,
    designId: string,
    chief: V7OpeningMemberDefinition,
    profile: BookProfileView,
    preferences: CoverPreferences
  ): Promise<V7CoverWorkOrder> {
    const prompt = coverWorkOrderPrompt(profile, preferences);
    const runtimePolicy = resolveV7TaskPolicy(this.database, chief.memberKey, 'cover_brief');
    const createdAt = this.clock.now().toISOString();
    const promptGovernance = new V7PromptGovernanceRepository(this.database);
    promptGovernance.ensureSourceRegistrySeeded(createdAt);
    const requestId = `${designId}-${chief.memberKey}`;
    const compiled = compileV7RuntimePrompt({
      requestId,
      ownerId,
      bookId,
      taskId: requestId,
      memberKey: chief.memberKey,
      runtimeRoleKey: chief.roleKey,
      modelProfileKey: modelProfileKeyForBinding(chief.model),
      taskKind: 'cover_brief',
      workstationKey: 'cover_brief',
      sourcePrompt: prompt,
      promptAssets: promptGovernance.publishedAssets(),
      genreProfile: promptGovernance.activeBookGenreProfile(ownerId, bookId),
      governanceRevision: promptGovernance.summary().revision,
      temperature: runtimePolicy.temperature,
      createdAt
    });
    promptGovernance.saveRuntimeBundle(compiled);
    const maxOutputTokens = 1_600;
    const reserved = Math.max(8_000, compiled.manifest.compiledPrompt.length + maxOutputTokens + thinkingTokenAllowance(chief.model.modelId, 'structured_planning', maxOutputTokens, compiled.manifest.compiledPrompt.length));
    assertMembershipAllowsGeneration(this.database, ownerId, createdAt, reserved);
    const accountUsage = new SupplementalAccountUsageRepository(this.database);
    accountUsage.start({
      sourceKind: 'v7_cover_text', sourceId: requestId, ownerId, bookId,
      provider: chief.model.provider, modelId: chief.model.modelId,
      reservedTokens: reserved, startedAt: createdAt
    });
    try {
      const adapter = this.textAdapters.resolve(chief.model.provider, chief.model.modelId, 'structured_planning');
      const result = await adapter.generate({
        requestId, taskId: `v7-cover-work-order-${designId}`,
        ownerId, bookId, agentId: chief.memberKey, prompt: compiled.manifest.compiledPrompt,
        maxOutputTokens, temperature: runtimePolicy.temperature
      });
      accountUsage.succeed({
        sourceKind: 'v7_cover_text', sourceId: requestId,
        inputTokens: Math.max(0, result.inputTokens), outputTokens: Math.max(0, result.outputTokens),
        cashMicros: Math.max(0, Math.round(result.cashCostCny * 1_000_000)),
        completedAt: this.clock.now().toISOString()
      });
      return parseCoverWorkOrder(result.output, preferences, '主编已经把题材、人物和作者选择整理进制作单。');
    } catch (error) {
      const failedAt = this.clock.now().toISOString();
      if (error instanceof ModelAdapterError && error.outcomeUnknown) {
        accountUsage.markUnknown('v7_cover_text', requestId, failedAt);
      } else {
        accountUsage.fail('v7_cover_text', requestId, failedAt);
      }
      throw error;
    }
  }

  private view(row: V7BookCoverDesignRow, chiefName?: string): V7BookCoverDesignView {
    const order = row.state === 'succeeded' ? storedWorkOrder(JSON.parse(row.work_order_json)) : null;
    const chief = chiefName ?? this.openingRoster().find((item) => item.memberKey === row.chief_member_key)?.displayName ?? '主编';
    const publicOrder = order === null ? null : publicWorkOrder(order);
    return {
      designId: row.design_id, status: row.state,
      statusText: row.state === 'working'
        ? '主人耐心等待，主编和封面画师正在加急制作，快好啦～'
        : row.state === 'failed'
          ? '这次制作没有完成，工作已经交接，您可以重新设计一张。'
          : row.adopted === 1 ? '这张已经是当前封面' : '封面已经制作完成',
      adopted: row.adopted === 1, chiefName: chief,
      visualMembers: this.visualRoster().map((member) => ({
        memberKey: member.memberKey, displayName: member.displayName, roleName: member.publicRoleName,
        responsibility: member.publicResponsibility, avatarPath: member.avatarPath
      })),
      workOrder: publicOrder,
      imageUrl: row.state === 'succeeded' ? `/api/v1/v7/books/${encodeURIComponent(row.book_id)}/cover-designs/${encodeURIComponent(row.design_id)}/image` : null,
      downloadUrl: row.state === 'succeeded' ? `/api/v1/v7/books/${encodeURIComponent(row.book_id)}/cover-designs/${encodeURIComponent(row.design_id)}/download` : null,
      createdAt: row.created_at
    };
  }

  private visualMemberViews(): V7BookCoverStudioView['visualMembers'] {
    return this.visualRoster().map((member) => {
      const onDuty = member.enabledByDefault && this.images.configured;
      return {
        memberKey: member.memberKey, displayName: member.displayName, roleName: member.publicRoleName,
        responsibility: member.publicResponsibility, avatarPath: member.avatarPath,
        status: onDuty ? 'on_duty' : 'on_leave',
        statusText: onDuty ? '我在这儿，随时可以开始制作封面' : '对不起，我现在无法出图，请稍后再试。'
      };
    });
  }

  private visualMember(roleKey: V7VisualMemberDefinition['roleKey']): V7VisualMemberDefinition {
    const member = this.visualRoster().find((candidate) => candidate.roleKey === roleKey);
    if (member === undefined) throw new DomainError(errorCodes.operationIncomplete, '视觉编辑部岗位暂时没有安排好。', {}, true, 503);
    return member;
  }
}

interface CoverPreferences {
  platformStyle: V7CoverWorkOrder['platformStyle'];
  visualStyle: V7CoverWorkOrder['visualStyle'];
  compositionStyle: V7CoverWorkOrder['compositionStyle'];
  paletteStyle: V7CoverWorkOrder['paletteStyle'];
  atmosphereStyle: V7CoverWorkOrder['atmosphereStyle'];
  elements: string[];
  avoidElements: string[];
  authorDirection: string;
}

function coverWorkOrderPrompt(profile: BookProfileView, preferences: CoverPreferences): string {
  return JSON.stringify({
    operation: 'v7_cover_work_order', language: 'zh-CN',
    book: {
      title: profile.title, channel: profile.channel, category: profile.category,
      subjects: profile.subjects, tags: [...profile.mainTags, ...profile.customTags],
      protagonists: profile.protagonists.map((item) => ({
        name: item.name, role: item.role, age: item.age, background: item.background,
        visualIdentity: item.visualIdentity, personalities: item.personalities
      })),
      world: profile.openingBlueprint.worldBackground, opening: profile.openingStart,
      direction: profile.storyDirection, ending: profile.storyEnding, mustFollow: profile.mustFollow
    },
    authorChoice: preferences,
    instructions: [
      '你是本书主编，只制定一份可执行的封面制作工单，不修改开书资料。',
      '画面优先表达主角、题材、时代和核心卖点；必须在手机缩略图尺寸仍有明确主体和强色彩对比。',
      '起点风偏重题材辨识、人物气势和世界质感；番茄风偏重强冲突、强情绪、明亮对比和一眼可懂；主流通用兼顾二者。',
      '严格落实作者选择的平台倾向、画面风格、构图、色彩、氛围、主体元素、避开元素和补充想法；封面底图不生成书名或任何文字，服务端会统一排版。',
      '不得补造与资料冲突的容貌、服饰、能力、人物关系或剧情事实；资料未定处保持概括。',
      'imagePrompt必须能直接交给中文图片模型，明确竖版网文封面、主体、环境、构图、光线、色彩和禁项。',
      '只输出JSON：{"composition":"构图","visualFocus":"视觉重点","atmosphere":"氛围","palette":"色彩","mustKeep":["必须保留"],"mustAvoid":["禁止项"],"plannerReview":"一句检查结论","imagePrompt":"完整出图提示"}。不要Markdown或内部思考。'
    ]
  });
}

function parseCoverWorkOrder(output: string, preferences: CoverPreferences, reviewFallback: string): V7CoverWorkOrder {
  const value = parseStructuredObject(output, '封面制作工单');
  const mustAvoid = textList(value.mustAvoid, '禁止项', 12);
  return {
    ...preferences,
    composition: text(value.composition, '构图', 800),
    visualFocus: text(value.visualFocus, '视觉重点', 800),
    atmosphere: text(value.atmosphere, '氛围', 800),
    palette: text(value.palette, '色彩', 800),
    mustKeep: textList(value.mustKeep, '必须保留', 12),
    mustAvoid: [...new Set([...mustAvoid, '任何文字', '水印', '平台标志', '人物肢体错误'])],
    plannerReview: optionalText(value.plannerReview, reviewFallback, 800),
    imagePrompt: `${text(value.imagePrompt, '出图提示', 8_000)}\n平台倾向：${platformStyleLabel(preferences.platformStyle)}；画面风格：${visualStyleLabel(preferences.visualStyle)}；构图：${compositionStyleLabel(preferences.compositionStyle)}；色彩：${paletteStyleLabel(preferences.paletteStyle)}；氛围：${atmosphereStyleLabel(preferences.atmosphereStyle)}。${preferences.elements.length ? `希望出现：${preferences.elements.join('、')}。` : ''}${preferences.avoidElements.length ? `不要出现：${preferences.avoidElements.join('、')}。` : ''}${preferences.authorDirection ? `作者补充：${preferences.authorDirection}。` : ''}\n禁止：任何文字、字母、数字、书名、水印、平台标志；避免人物肢体错误。`
  };
}

function storedWorkOrder(value: unknown): V7CoverWorkOrder {
  const row = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const preferences: CoverPreferences = {
    platformStyle: platformStyle(row.platformStyle),
    visualStyle: visualStyle(row.visualStyle),
    compositionStyle: compositionStyle(row.compositionStyle),
    paletteStyle: paletteStyle(row.paletteStyle),
    atmosphereStyle: atmosphereStyle(row.atmosphereStyle),
    elements: optionalTextList(row.elements, 12),
    avoidElements: optionalTextList(row.avoidElements, 12),
    authorDirection: optionalText(row.authorDirection, '', 800)
  };
  return parseCoverWorkOrder(JSON.stringify(row), preferences, '这张封面沿用较早的制作单，尚未单独保存视觉检查说明。');
}

function coverPreferences(input: V7BookCoverDesignInput): CoverPreferences {
  return {
    platformStyle: platformStyle(input.platformStyle),
    visualStyle: visualStyle(input.visualStyle),
    compositionStyle: compositionStyle(input.compositionStyle),
    paletteStyle: paletteStyle(input.paletteStyle),
    atmosphereStyle: atmosphereStyle(input.atmosphereStyle),
    elements: optionalTextList(input.elements, 12),
    avoidElements: optionalTextList(input.avoidElements, 12),
    authorDirection: optionalText(input.authorDirection, '', 800)
  };
}

function platformStyle(value: unknown): CoverPreferences['platformStyle'] {
  return value === 'qidian' || value === 'fanqie' || value === 'mainstream' ? value : 'mainstream';
}

function visualStyle(value: unknown): CoverPreferences['visualStyle'] {
  return value === 'vivid' || value === 'realistic' || value === 'abstract' || value === 'guofeng' || value === 'cinematic' || value === 'warm'
    || value === 'illustration' || value === 'anime' || value === 'ink' || value === 'retro' || value === 'scifi' || value === 'suspense' || value === 'romance'
    ? value : 'vivid';
}

function compositionStyle(value: unknown): CoverPreferences['compositionStyle'] {
  return value === 'character-closeup' || value === 'character-scene' || value === 'duality' || value === 'ensemble' || value === 'grand-scene' || value === 'symbolic' ? value : 'character-scene';
}

function paletteStyle(value: unknown): CoverPreferences['paletteStyle'] {
  return value === 'high-contrast' || value === 'warm' || value === 'cool' || value === 'dark' || value === 'golden' || value === 'pastel' ? value : 'high-contrast';
}

function atmosphereStyle(value: unknown): CoverPreferences['atmosphereStyle'] {
  return value === 'intense' || value === 'epic' || value === 'suspense' || value === 'romantic' || value === 'healing' || value === 'lonely' ? value : 'intense';
}

function platformStyleLabel(value: CoverPreferences['platformStyle']): string {
  return ({ qidian: '起点风，题材辨识强、人物气势足、世界质感清楚', fanqie: '番茄风，冲突直接、情绪强、颜色醒目', mainstream: '主流通用，兼顾质感与点击欲' })[value];
}

function visualStyleLabel(value: CoverPreferences['visualStyle']): string {
  return ({ vivid: '鲜艳醒目', realistic: '现实质感', abstract: '抽象创意', guofeng: '国风绘卷', cinematic: '电影感', warm: '温暖治愈', illustration: '商业插画', anime: '动漫风', ink: '水墨留白', retro: '复古质感', scifi: '科幻未来', suspense: '悬疑暗调', romance: '浪漫唯美' })[value];
}

function compositionStyleLabel(value: CoverPreferences['compositionStyle']): string {
  return ({ 'character-closeup': '人物近景', 'character-scene': '人物与场景', duality: '双人对照', ensemble: '群像构图', 'grand-scene': '宏大场景', symbolic: '意象主体' })[value];
}

function paletteStyleLabel(value: CoverPreferences['paletteStyle']): string {
  return ({ 'high-contrast': '高对比醒目', warm: '暖色热烈', cool: '冷色克制', dark: '深色压迫', golden: '金色史诗', pastel: '柔和彩色' })[value];
}

function atmosphereStyleLabel(value: CoverPreferences['atmosphereStyle']): string {
  return ({ intense: '热血紧张', epic: '史诗恢宏', suspense: '神秘悬疑', romantic: '浪漫暧昧', healing: '轻松治愈', lonely: '孤独苍凉' })[value];
}

function publicWorkOrder(order: V7CoverWorkOrder): Omit<V7CoverWorkOrder, 'imagePrompt'> {
  const { imagePrompt: _hiddenPrompt, ...publicOrder } = order;
  return publicOrder;
}

async function composeFinalCover(source: Buffer, title: string, authorPenName: string | null): Promise<{ mimeType: 'image/png'; buffer: Buffer; contentHash: string }> {
  const titleSvg = coverOverlaySvg(title, authorPenName);
  const buffer = await sharp(source)
    .rotate()
    .resize(1_024, 1_536, { fit: 'cover', position: 'attention' })
    .composite([{ input: Buffer.from(titleSvg) }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  return { mimeType: 'image/png', buffer, contentHash: createHash('sha256').update(buffer).digest('hex') };
}

export function resolveCoverPenName(
  repositoryOrDatabase: V7BookCoverDesignRepository | DatabaseSync,
  ownerId: string
): string | null {
  const repository = repositoryOrDatabase instanceof V7BookCoverDesignRepository
    ? repositoryOrDatabase
    : new V7BookCoverDesignRepository(repositoryOrDatabase);
  const row = repository.resolveAuthorPenName(ownerId);
  return normalizeCoverPenName(row?.accountDisplayName) ?? normalizeCoverPenName(row?.ownerDisplayName);
}

export function coverOverlaySvg(title: string, authorPenName: string | null): string {
  const lines = titleLines(title);
  const fontSize = lines.length === 1 ? 104 : lines.length === 2 ? 88 : 72;
  const lineHeight = Math.round(fontSize * 1.22);
  const firstBaseline = 1_536 - 178 - (lines.length - 1) * lineHeight;
  const byline = authorPenName === null ? '' : `<text x="512" y="1484" text-anchor="middle" fill="#ffffff" fill-opacity="0.78" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="26" letter-spacing="8">${escapeXml(authorPenName)}</text>`;
  return `<svg width="1024" height="1536" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#102019" stop-opacity="0"/><stop offset="1" stop-color="#102019" stop-opacity="0.88"/></linearGradient></defs>
    <rect x="0" y="820" width="1024" height="716" fill="url(#shade)"/>
    ${lines.map((line, index) => `<text x="512" y="${firstBaseline + index * lineHeight}" text-anchor="middle" fill="#fff" stroke="#162820" stroke-width="3" paint-order="stroke" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="${fontSize}" font-weight="800" letter-spacing="5">${escapeXml(line)}</text>`).join('')}
    ${byline}
  </svg>`;
}

function normalizeCoverPenName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length === 0) return null;
  return Array.from(normalized).slice(0, 20).join('');
}

function titleLines(value: string): string[] {
  const characters = Array.from(value.trim()).slice(0, 24);
  const perLine = characters.length <= 8 ? 8 : characters.length <= 16 ? Math.ceil(characters.length / 2) : Math.ceil(characters.length / 3);
  const lines: string[] = [];
  for (let index = 0; index < characters.length; index += perLine) lines.push(characters.slice(index, index + perLine).join(''));
  return lines.length > 0 ? lines.slice(0, 3) : ['未命名作品'];
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function optionalTextList(value: unknown, maximum: number): string[] {
  return value === undefined || value === null ? [] : textList(value, '封面选择', maximum);
}

function optionalText(value: unknown, fallback: string, maximum: number): string {
  if (value === undefined || value === null || value === '') return fallback;
  return text(value, '作者补充想法', maximum);
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是文字`);
  const normalized = value.trim();
  if (normalized.length === 0 || Array.from(normalized).length > maximum) throw new Error(`${label}长度无效`);
  return normalized;
}

function textList(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`);
  const normalized = value.map((item) => text(item, `${label}条目`, 500));
  if (normalized.length > maximum) throw new Error(`${label}最多${maximum}项`);
  return [...new Set(normalized)];
}

function actionKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9_-]{8,128}$/u.test(key)) throw new DomainError(errorCodes.validation, '封面设计编号无效，请重新操作。');
  return key;
}
