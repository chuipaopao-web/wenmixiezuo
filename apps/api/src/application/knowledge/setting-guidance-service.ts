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
import { SettingOutlineWorkspaceService, parseSettingOutlineDeposit } from './setting-outline-workspace-service.js';

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
  confirmedContext: Array<{ itemKey: string; label: string; content: string }>;
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

interface SettingGuidanceContext {
  template: SettingOutlineTemplateItem[];
  positioningSummary: string;
  storyDirectionReference: string;
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

  public ensureInitialized(scope: BookScope, suppliedBlueprint?: OpeningBlueprintInput): SettingGuidanceSnapshot | null {
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
    return this.current(scope, suppliedBlueprint);
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
    const confirmed = required
      .map((item) => byKey.get(item.itemKey))
      .filter((item): item is NonNullable<typeof item> => item?.status === '已确认' && item.content !== null)
      .slice(-3)
      .map((item) => ({ itemKey: item.itemKey, label: item.label, content: clip(item.content!, 400) }));
    return {
      phase: target.status === '候选待确认' ? 'revise' : 'ask',
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
      confirmedContext: confirmed,
      previousCandidate: target.content === null ? null : clip(target.content, 1_200),
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
    if (blueprint !== null) {
      const category = OPENING_TAXONOMY.categories.find((item) => item.key === blueprint.categoryKey)?.name
        ?? blueprint.categoryKey;
      return {
        template: resolveSettingOutlineTemplate(blueprint),
        positioningSummary: clip([
          `频道：${blueprint.channel === 'male' ? '男频' : '女频'}`,
          `主分类：${category}`,
          `题材：${(blueprint.auxiliaryTags ?? []).join('、') || '未填写'}`,
          `主要标签：${(blueprint.mainTags ?? []).join('、') || '未填写'}`,
          `作品特点：${(blueprint.storyTraits ?? []).join('、') || '未填写'}`,
          `主角：${(blueprint.protagonists ?? []).map((item) => `${item.name}（${item.age}）`).join('、') || '未填写'}`,
          `必须遵守：${(blueprint.mustFollow ?? []).join('；') || '无额外要求'}`
        ].join('\n'), 900),
        storyDirectionReference: clip((blueprint.storyDirection ?? '').trim(), 500)
      };
    }
    const baseline = this.continuations.latestReadyBaseline(scope);
    if (baseline === undefined) return null;
    return {
      template: resolveContinuationSettingOutlineTemplate(),
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
