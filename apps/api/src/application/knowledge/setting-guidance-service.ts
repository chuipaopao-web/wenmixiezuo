import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { OpeningBlueprintInput } from '../../contracts/opening-blueprint.js';
import { OPENING_TAXONOMY } from '../../contracts/opening-blueprint.js';
import { PlanningWorkflowRepository } from '../../infrastructure/db/repositories/planning-workflow-repository.js';
import { ContinuationImportRepository } from '../../infrastructure/db/repositories/continuation-import-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { SettingBaselineService } from './setting-baseline-service.js';
import {
  resolveContinuationSettingOutlineTemplate,
  resolveSettingOutlineTemplate,
  type SettingOutlineTemplateItem
} from './setting-outline-catalog.js';
import { SettingOutlineWorkspaceService, parseSettingOutlineDeposit, type SettingOutlineWorkspaceItem } from './setting-outline-workspace-service.js';
import { hashConfirmedSettings, hashSettingItemContent } from './setting-quality-shared.js';

export type SettingGuidancePhase = 'ask' | 'collect' | 'revise';
export type SettingGuidanceFeedbackMode =
  | 'initial'
  | 'numeric_selection'
  | 'specific_revision'
  | 'vague_dissatisfaction'
  | 'replace_direction';

export interface SettingGuidanceSnapshot {
  phase: SettingGuidancePhase;
  itemKey: string;
  groupTitle: string;
  label: string;
  prompt: string;
  sourceLabel: string;
  status: string;
  requiredIndex: number;
  requiredCount: number;
  positioningSummary: string;
  storyDirectionReference: string;
  openingBookCore: string;
  temporaryContextPack: TemporarySettingContextPack;
  previousCandidate: string | null;
  feedbackMode: SettingGuidanceFeedbackMode;
  dissatisfactionRound: number;
  proposalOptions?: Array<{
    number: number;
    memberName: string;
    content: string;
  }>;
  selectionNumbers?: number[];
}

export interface TemporarySettingContextPack {
  kind: 'temporary_non_canon';
  contentHash: string;
  itemCount: number;
  summaryCharacterBudget: number;
  items: Array<{
    itemKey: string;
    label: string;
    summary: string;
    sourceContentHash: string;
  }>;
}

interface SettingGuidanceContext {
  template: SettingOutlineTemplateItem[];
  positioningSummary: string;
  storyDirectionReference: string;
  openingBookCore: string;
}

export class SettingGuidanceService {
  private readonly planning: PlanningWorkflowRepository;
  private readonly continuations: ContinuationImportRepository;
  private readonly workspace: SettingOutlineWorkspaceService;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.planning = new PlanningWorkflowRepository(database);
    this.continuations = new ContinuationImportRepository(database);
    this.workspace = new SettingOutlineWorkspaceService(database, clock);
  }

  public ensureInitialized(scope: BookScope, suppliedBlueprint?: OpeningBlueprintInput, activateFirst = true): SettingGuidanceSnapshot | null {
    assertBookScope(scope);
    const context = this.guidanceContext(scope, suppliedBlueprint);
    if (context === null) return null;
    this.workspace.initialize(scope, context.template.map((item) => ({
      itemKey: item.itemKey,
      groupTitle: item.groupTitle,
      label: item.label,
      prompt: item.prompt,
      sourceLabel: item.sourceLabel,
      sortOrder: item.sortOrder
    })));
    // 建书时只初始化清单、不激活首项（activateFirst=false）：
    // “讨论中”状态代表真的开工了，作者点“开始设计”才激活。
    return activateFirst ? this.current(scope, suppliedBlueprint) : null;
  }

  public current(scope: BookScope, suppliedBlueprint?: OpeningBlueprintInput): SettingGuidanceSnapshot | null {
    assertBookScope(scope);
    const planningState = this.planning.planningState(scope);
    if (planningState === undefined || planningState.setting_baseline_version_id !== null
      || !['style_in_progress', 'style_ready', 'setting_in_progress'].includes(planningState.stage)) return null;
    const context = this.guidanceContext(scope, suppliedBlueprint);
    if (context === null) return null;
    const template = context.template;
    const required = template.filter((item) => item.required);
    const rows = this.workspace.list(scope);
    const byKey = new Map(rows.map((item) => [item.itemKey, item]));
    const targetTemplate = required.find((item) => byKey.get(item.itemKey)?.status !== '已确认');
    if (targetTemplate === undefined) return null;
    let target = byKey.get(targetTemplate.itemKey);
    if (target === undefined) return null;
    if (!['候选待确认', '讨论中'].includes(target.status)) {
      target = this.workspace.activateGuidanceItem(scope, target.itemKey);
    }
    const temporaryContextPack = compileTemporarySettingContextPack(rows, target.itemKey);
    return {
      phase: (target.status === '候选待确认' || target.pendingCandidate !== null) ? 'revise' : 'ask',
      itemKey: target.itemKey,
      groupTitle: target.groupTitle,
      label: target.label,
      prompt: target.prompt,
      sourceLabel: target.sourceLabel,
      status: target.status,
      requiredIndex: required.findIndex((item) => item.itemKey === target!.itemKey) + 1,
      requiredCount: required.length,
      positioningSummary: context.positioningSummary,
      storyDirectionReference: context.storyDirectionReference,
      openingBookCore: context.openingBookCore,
      temporaryContextPack,
      previousCandidate: target.pendingCandidate !== null
        ? clip(target.pendingCandidate, 1_200)
        : target.content === null ? null : clip(target.content, 1_200),
      feedbackMode: 'initial',
      dissatisfactionRound: 0
    };
  }

  /**
   * 为任意已在本书设定清单里的类目构建讨论资料快照。
   * 四项核心之外的题材包、资料库和自定义项也可以按需请团队出主意，
   * 不再要求它必须是逐项引导的当前项；未激活的项会被激活为讨论中。
   */
  public snapshotFor(scope: BookScope, itemKey: string): SettingGuidanceSnapshot | null {
    assertBookScope(scope);
    const context = this.guidanceContext(scope);
    if (context === null) return null;
    const rows = this.workspace.list(scope);
    let target = rows.find((item) => item.itemKey === itemKey);
    if (target === undefined) return null;
    if (!['候选待确认', '讨论中'].includes(target.status)) {
      target = this.workspace.activateGuidanceItem(scope, target.itemKey);
    }
    const required = context.template.filter((item) => item.required);
    const temporaryContextPack = compileTemporarySettingContextPack(rows, itemKey);
    return {
      phase: (target.status === '候选待确认' || target.pendingCandidate !== null) ? 'revise' : 'ask',
      itemKey: target.itemKey,
      groupTitle: target.groupTitle,
      label: target.label,
      prompt: target.prompt,
      sourceLabel: target.sourceLabel,
      status: target.status,
      requiredIndex: required.findIndex((item) => item.itemKey === itemKey) + 1,
      requiredCount: required.length,
      positioningSummary: context.positioningSummary,
      storyDirectionReference: context.storyDirectionReference,
      openingBookCore: context.openingBookCore,
      temporaryContextPack,
      previousCandidate: target.pendingCandidate !== null
        ? clip(target.pendingCandidate, 1_200)
        : target.content === null ? null : clip(target.content, 1_200),
      feedbackMode: 'initial',
      dissatisfactionRound: 0
    };
  }

  public recordCandidate(scope: BookScope, itemKey: string, rawOutput: string): void {
    const deposits = parseSettingOutlineDeposit(rawOutput);
    const deposit = deposits.find((item) => item.itemKey === itemKey);
    if (deposit === undefined) throw new Error(`主编没有按合同提交“${itemKey}”设定候选`);
    this.workspace.recordGuidanceCandidate(scope, itemKey, deposit.content);
  }

  public confirmCurrent(scope: BookScope): {
    confirmedItemKey: string;
    next: SettingGuidanceSnapshot | null;
    completed: boolean;
  } {
    const current = this.current(scope);
    if (current === null) throw new Error('当前没有等待确认的设定项');
    return new UnitOfWork(this.database).run(() => {
      this.workspace.confirmGuidanceCandidate(scope, current.itemKey);
      const baseline = new SettingBaselineService(this.database, this.ids, this.clock);
      const readiness = baseline.inspect(scope);
      if (readiness.ready) {
        const state = this.planning.planningState(scope);
        if (state === undefined) throw new Error('缺少规划状态');
        baseline.confirm(scope, state.version);
        return { confirmedItemKey: current.itemKey, next: null, completed: true };
      }
      return { confirmedItemKey: current.itemKey, next: this.current(scope), completed: false };
    });
  }

  private opening(scope: BookScope): OpeningBlueprintInput | null {
    const value = this.planning.openingBlueprint(scope);
    if (value === undefined) return null;
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.keys(parsed).length === 0 ? null : parsed as unknown as OpeningBlueprintInput;
  }

  private guidanceContext(scope: BookScope, suppliedBlueprint?: OpeningBlueprintInput): SettingGuidanceContext | null {
    const blueprint = suppliedBlueprint ?? this.opening(scope);
    const baseline = this.continuations.latestReadyBaseline(scope);
    if (blueprint?.creationMode === 'continuation') {
      if (baseline === undefined) return null;
      const category = OPENING_TAXONOMY.categories.find((item) => item.key === blueprint.categoryKey)?.name
        ?? blueprint.categoryKey;
      return {
        template: resolveContinuationSettingOutlineTemplate(),
        openingBookCore: compileOpeningBookCore(blueprint),
        positioningSummary: clip([
          '创作方式：已有正文续写',
          `频道：${blueprint.channel === 'male' ? '男频' : '女频'}`,
          `主分类：${category}`,
          `题材：${(blueprint.auxiliaryTags ?? []).join('、') || '未填写'}`,
          ...((blueprint.mainTags ?? []).length > 0 ? [`主要标签：${(blueprint.mainTags ?? []).join('、')}`] : []),
          `主角：${(blueprint.protagonists ?? []).map((item) => `${item.name}（${item.age}）`).join('、') || '以正文为准'}`,
          `必须遵守：${(blueprint.mustFollow ?? []).join('；') || '无额外要求'}`,
          `正文分析：已完成 ${baseline.analyzed_chapter_count}/${baseline.total_chapter_count} 章`,
          '事实边界：已导入正文和反向章纲优先；开书简介只提供定位和续写方向，不能覆盖正文事实'
        ].join('\n'), 1_200),
        storyDirectionReference: clip([
          `开书方向参考：${(blueprint.storyDirection ?? '').trim() || '未填写'}`,
          `正文反向分析：${(baseline.summary_text ?? '').trim() || '暂无总览'}`
        ].join('\n'), 1_000)
      };
    }
    if (blueprint !== null) {
      const category = OPENING_TAXONOMY.categories.find((item) => item.key === blueprint.categoryKey)?.name
        ?? blueprint.categoryKey;
      const styleTones = [blueprint.stylePrimary, blueprint.styleSecondary]
        .filter((tone) => typeof tone === 'string' && tone.trim().length > 0);
      return {
        template: resolveSettingOutlineTemplate(blueprint),
        openingBookCore: compileOpeningBookCore(blueprint),
        positioningSummary: clip([
          `频道：${blueprint.channel === 'male' ? '男频' : '女频'}`,
          `主分类：${category}`,
          `题材：${(blueprint.auxiliaryTags ?? []).join('、') || '未填写'}`,
          ...((blueprint.mainTags ?? []).length > 0 ? [`主要标签：${(blueprint.mainTags ?? []).join('、')}`] : []),
          ...((blueprint.storyTraits ?? []).length > 0 ? [`作品特点：${(blueprint.storyTraits ?? []).join('、')}`] : []),
          `开局：${(blueprint.openingStart ?? '').trim() || '未填写'}`,
          `结局：${(blueprint.storyEnding ?? '').trim() || '未填写'}`,
          ...(styleTones.length > 0 ? [`全书基调：${styleTones.join('＋')}`] : []),
          `主角：${(blueprint.protagonists ?? []).map((item) => `${item.name}（${item.age}）`).join('、') || '未填写'}`,
          `必须遵守：${(blueprint.mustFollow ?? []).join('；') || '无额外要求'}`
        ].join('\n'), 900),
        storyDirectionReference: clip((blueprint.storyDirection ?? '').trim() || '未填写', 500)
      };
    }
    if (baseline === undefined) return null;
    return {
      template: resolveContinuationSettingOutlineTemplate(),
      openingBookCore: '当前书籍没有结构化开书资料；只允许使用已导入正文与反向分析，不得猜测缺失字段。',
      positioningSummary: clip([
        '创作方式：已有正文续写',
        '开书分类：历史数据未记录，不作推断',
        `正文分析：已完成 ${baseline.analyzed_chapter_count}/${baseline.total_chapter_count} 章`,
        '事实边界：只依据已导入正文和反向章纲；正文无法证明的内容保持未知'
      ].join('\n'), 900),
      storyDirectionReference: clip((baseline.summary_text ?? '').trim(), 800)
    };
  }
}

function clip(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

/**
 * 逐项设定期间的临时资料包。它只从当前书活动工作区的已确认条目派生，
 * 不写入正式设定基线；修改或清空工作区后，下一次任务会得到新的指纹和摘要。
 */
export function compileTemporarySettingContextPack(
  rows: SettingOutlineWorkspaceItem[],
  targetItemKey: string,
  summaryCharacterBudget = 7_200
): TemporarySettingContextPack {
  const confirmed = rows
    .filter((item): item is SettingOutlineWorkspaceItem & { content: string } =>
      item.itemKey !== targetItemKey && item.status === '已确认' && item.content !== null)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.itemKey.localeCompare(right.itemKey));
  const perItemBudget = confirmed.length === 0
    ? 0
    : Math.max(64, Math.min(360, Math.floor(summaryCharacterBudget / confirmed.length)));
  return {
    kind: 'temporary_non_canon',
    contentHash: hashConfirmedSettings(confirmed),
    itemCount: confirmed.length,
    summaryCharacterBudget,
    items: confirmed.map((item) => ({
      itemKey: item.itemKey,
      label: item.label,
      summary: compressConfirmedSetting(item.content, perItemBudget),
      sourceContentHash: hashSettingItemContent(item.content)
    }))
  };
}

function compressConfirmedSetting(content: string, maximum: number): string {
  const normalized = content.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= maximum) return normalized;
  const sentences = normalized.match(/[^。！？；]+[。！？；]?/gu) ?? [normalized];
  const priority = /(?:必须|不得|不能|边界|规则|代价|主角|世界|关系|目标|冲突)/u;
  const selected: string[] = [];
  const candidates = [sentences[0], ...sentences.filter((sentence, index) => index > 0 && priority.test(sentence))]
    .filter((sentence): sentence is string => sentence !== undefined);
  for (const sentence of candidates) {
    if (selected.includes(sentence)) continue;
    const next = selected.join('').length + sentence.length;
    if (next > maximum - 1) continue;
    selected.push(sentence);
  }
  const summary = selected.join('').trim();
  if (summary.length > 0) return summary + '…';
  return normalized.slice(0, maximum - 1) + '…';
}
function compileOpeningBookCore(blueprint: OpeningBlueprintInput): string {
  // 设定是开书信息的第一次正式推演，必须收到作者填写的全部开书字段。
  // 排除其他书和未摘录灵感，但不以“节省上下文”为由裁掉作者已填写的内容。
  return JSON.stringify(blueprint);
}
