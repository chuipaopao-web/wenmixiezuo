import { V7_LAYERED_PLANNING_VERSION } from './method-asset-profiles.js';
import {
  validateLayeredPlanningRecipe,
  type LayeredMethodGuidance,
  type LayeredPlanningRecipe,
  type LayeredRecipeNode,
  type PlanningEditorialSeat,
  type ReaderExperienceTarget
} from './layered-planning-engine.js';
import type { LayerAssetEntry } from './layer-asset-menu.js';
import type { V7PlanningStoryRoute } from './planning-story-routes.js';

export type V7PlanningBriefSeatKey = PlanningEditorialSeat['seatKey'];
export type V7PlanningStrategySource = 'library' | 'agent_original';

export interface V7PlanningStrategyChoice {
  source: V7PlanningStrategySource;
  methodKey?: string;
  title: string;
  layer: 'book_backbone' | 'volume_distribution';
  applicationNote: string;
  caution: string;
}

/**
 * A compact planning contract. It intentionally stops before volumes, chains
 * and chapters. The selected route is materialized into the legacy layered
 * recipe only after the author confirms it.
 */
export interface V7ProgressivePlanningBrief {
  schema: 'v7-progressive-planning-brief-v2';
  seatKey: V7PlanningBriefSeatKey;
  publicSummary: string;
  centralPromise: string;
  causalSpine: string;
  protagonistArc: string;
  longFormCapacity: string;
  pressureRhythm: string;
  payoffCadence: string;
  informationRhythm: string;
  distinctiveness: string;
  selectedStrategies: V7PlanningStrategyChoice[];
  creativeOpenings: string[];
  strengths: string[];
  risks: string[];
  authorDecisions: string[];
}

export interface V7FullCasePlanningSeat {
  seatKey: V7PlanningBriefSeatKey;
  publicName: '全案规划主编';
  routeLabel: string;
  explorationOpening: string;
}

const FULL_CASE_SEATS: Readonly<Record<V7PlanningBriefSeatKey, V7FullCasePlanningSeat>> = {
  chief_editor: {
    seatKey: 'chief_editor',
    publicName: '全案规划主编',
    routeLabel: '路线一',
    explorationOpening: '先从最符合人物处境、因果可信且能长期展开的自然路线出发。'
  },
  structure_deputy: {
    seatKey: 'structure_deputy',
    publicName: '全案规划主编',
    routeLabel: '路线二',
    explorationOpening: '在完整质量不降级的前提下，主动寻找与常见同题材不同的长期转折和阶段组织。'
  },
  commercial_deputy: {
    seatKey: 'commercial_deputy',
    publicName: '全案规划主编',
    routeLabel: '路线三',
    explorationOpening: '在人物和因果成立的前提下，主动寻找卖点更早兑现、追读更强但不套路化的路线。'
  }
};

export function fullCasePlanningSeat(seatKey: V7PlanningBriefSeatKey): V7FullCasePlanningSeat {
  return FULL_CASE_SEATS[seatKey];
}

export function progressivePlanningBriefPrompt(input: {
  seatKey: V7PlanningBriefSeatKey;
  sourceSnapshot: unknown;
  assetMenuText: string;
}): string {
  const seat = fullCasePlanningSeat(input.seatKey);
  return [
    '你是文秘写作V7的一名全案规划主编。只返回一个JSON对象，不要Markdown，不要思维过程。',
    `你独立负责${seat.routeLabel}。${seat.explorationOpening}`,
    '你必须同时检查：作者原意、人物主动选择、因果可信、长篇容量、跨卷递进、商业追读、阶段回报、创意辨识度和中后期续航。不能只负责其中一项。',
    '你看不到另外两名主编的答案。不要先套常见题材路线，再替换人名；必须从本书人物、时代、限制和核心冲突推出方向。',
    '菜单里的方法只是候选工具箱，不是答案。可以少用、组合或全部不用；不得为了用完资产而改变人物合理选择。',
    'selectedStrategies总数4—6项，其中至少1项必须是agent_original：这是你为本书提出的原创推进策略，不得伪装成公共方法，也不要写回方法库。',
    'library项的methodKey必须来自本轮资产菜单；agent_original项不得填写methodKey。每项只写一句“本书怎么用”和一句主要风险。',
    '本轮只形成全书方向的精简设计依据，不生成分卷、单元链、事件或章纲。正式资料和正文实际不能改写，未来规划不能冒充已经发生。',
    '输出字段必须完整：schema="v7-progressive-planning-brief-v2",seatKey,publicSummary,centralPromise,causalSpine,protagonistArc,longFormCapacity,pressureRhythm,payoffCadence,informationRhythm,distinctiveness,selectedStrategies,creativeOpenings,strengths,risks,authorDecisions。',
    'selectedStrategies每项字段：source,methodKey(仅library),title,layer,applicationNote,caution。creativeOpenings写2—4条仍可自由发挥的空间，不是预设剧情。',
    `正式资料快照：${JSON.stringify(input.sourceSnapshot)}`,
    `本轮资产菜单：\n${input.assetMenuText}`
  ].join('\n\n');
}

export function parseProgressivePlanningBrief(
  output: string,
  seatKey: V7PlanningBriefSeatKey,
  allowedMethodKeys: readonly string[]
): V7ProgressivePlanningBrief {
  const value = parseJsonObject(output);
  if (value.schema !== 'v7-progressive-planning-brief-v2' || value.seatKey !== seatKey) {
    throw new Error('全案主编返回的方向依据格式不完整');
  }
  const selectedStrategies = strategyList(value.selectedStrategies, allowedMethodKeys);
  if (!selectedStrategies.some((strategy) => strategy.source === 'agent_original')) {
    throw new Error('全案主编没有提出本书原创策略');
  }
  return {
    schema: 'v7-progressive-planning-brief-v2',
    seatKey,
    publicSummary: requiredText(value.publicSummary, '方案说明'),
    centralPromise: requiredText(value.centralPromise, '全书核心承诺'),
    causalSpine: requiredText(value.causalSpine, '长期因果主轴'),
    protagonistArc: requiredText(value.protagonistArc, '主角长期变化'),
    longFormCapacity: requiredText(value.longFormCapacity, '长篇容量说明'),
    pressureRhythm: requiredText(value.pressureRhythm, '压力节奏'),
    payoffCadence: requiredText(value.payoffCadence, '回报节奏'),
    informationRhythm: requiredText(value.informationRhythm, '信息节奏'),
    distinctiveness: requiredText(value.distinctiveness, '作品辨识度'),
    selectedStrategies,
    creativeOpenings: textList(value.creativeOpenings, '自由创意空间', 2, 6),
    strengths: textList(value.strengths, '方案优势', 1, 6),
    risks: textList(value.risks, '方案风险', 1, 6),
    authorDecisions: textList(value.authorDecisions, '作者待决项', 0, 6)
  };
}

export function parseStoredProgressivePlanningBrief(
  value: unknown,
  fallbackSeatKey: V7PlanningBriefSeatKey
): V7ProgressivePlanningBrief {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('保存的规划方案不完整');
  const record = value as Record<string, unknown>;
  if (record.schema === 'v7-progressive-planning-brief-v2') {
    const methodKeys = Array.isArray(record.selectedStrategies)
      ? record.selectedStrategies.flatMap((item) => {
          if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
          const key = (item as Record<string, unknown>).methodKey;
          return typeof key === 'string' ? [key] : [];
        })
      : [];
    return parseProgressivePlanningBrief(JSON.stringify(record), fallbackSeatKey, methodKeys);
  }
  if (record.schema === 'v7-planning-recipe-proposal-v1' && isRecipe(record.recipe)) {
    return legacyRecipeToBrief(record, fallbackSeatKey);
  }
  throw new Error('保存的规划方案版本不受支持');
}

/**
 * 第86批：引用校验改按名册。菜单只收窄工具箱；这道闸防止成员把真实存在的
 * 资产用到资产库未标注的层。agent_original 策略仍可自由选择两个全书层级。
 */
export function validateProgressivePlanningBriefCandidates(
  brief: V7ProgressivePlanningBrief,
  allowedAssets: readonly LayerAssetEntry[]
): void {
  const assetByKey = new Map(allowedAssets.map((asset) => [asset.key, asset]));
  for (const strategy of brief.selectedStrategies) {
    if (strategy.source !== 'library') continue;
    const asset = strategy.methodKey === undefined ? undefined : assetByKey.get(strategy.methodKey);
    if (asset === undefined) throw new Error('全案主编引用了本轮资产菜单之外的方法');
    if (!asset.planningLayers.includes(strategy.layer)) {
      throw new Error(`方法“${asset.title}”不能用于${strategy.layer === 'book_backbone' ? '全书主骨架' : '分卷递进'}层`);
    }
  }
}

export function materializePlanningRecipe(input: {
  brief: V7ProgressivePlanningBrief;
  route: V7PlanningStoryRoute;
  recipeId: string;
  status?: LayeredPlanningRecipe['status'];
}): LayeredPlanningRecipe {
  const rootExperience = experience(
    input.route.readingExperience,
    input.brief.pressureRhythm,
    input.brief.payoffCadence,
    input.brief.informationRhythm,
    input.brief.distinctiveness,
    input.brief.publicSummary
  );
  const distributionExperience = experience(
    `每一卷都完成一次可见变化，合起来兑现“${input.brief.centralPromise}”。`,
    input.brief.pressureRhythm,
    input.brief.payoffCadence,
    input.brief.informationRhythm,
    '相邻卷必须改变矛盾形态、人物责任或解决问题的方法，不能只提高敌人强度。',
    input.brief.longFormCapacity
  );
  const volumeChildren = input.route.volumeRoadmap.map((volume) => volumeNode(volume, input.route));
  const recipe: LayeredPlanningRecipe = {
    recipeId: input.recipeId,
    version: 1,
    engineVersion: V7_LAYERED_PLANNING_VERSION,
    status: input.status ?? 'candidate',
    title: input.route.routeTitle,
    sourceSnapshotLabel: '作者确认的全书路线与对应设计依据',
    root: {
      nodeId: 'book',
      layer: 'book_backbone',
      title: input.route.routeTitle,
      responsibility: `${input.brief.centralPromise} ${input.brief.causalSpine}`,
      status: 'accepted',
      budget: { wordTarget: input.route.targetWords, volumeRange: [input.route.targetVolumes, input.route.targetVolumes] },
      hardRequirements: [],
      methodGuidance: strategyGuidance(input.brief.selectedStrategies, 'book_backbone'),
      readerExperience: rootExperience,
      creativeSpace: [...input.brief.creativeOpenings],
      expectedChanges: [input.route.protagonistJourney, input.brief.centralPromise],
      children: [{
        nodeId: 'distribution',
        layer: 'volume_distribution',
        title: `${input.route.targetVolumes}卷递进安排`,
        responsibility: '只冻结每卷方向、主角变化、主要压力、阶段回报和下一卷接口；卷内事件链进入该卷时再设计。',
        status: 'accepted',
        budget: { wordTarget: input.route.targetWords, volumeRange: [input.route.targetVolumes, input.route.targetVolumes] },
        hardRequirements: [],
        methodGuidance: strategyGuidance(input.brief.selectedStrategies, 'volume_distribution'),
        readerExperience: distributionExperience,
        creativeSpace: ['每卷的具体事件链、配角行动和实现方式留给进入该卷后的编剧。'],
        expectedChanges: input.route.volumeRoadmap.map((volume) => `${volume.title}：${volume.protagonistChange}`),
        children: volumeChildren
      }]
    }
  };
  const errors = validateLayeredPlanningRecipe(recipe);
  if (errors.length > 0) throw new Error(`确认路线无法形成分层执行合同：${errors.join('；')}`);
  return recipe;
}

function volumeNode(volume: V7PlanningStoryRoute['volumeRoadmap'][number], route: V7PlanningStoryRoute): LayeredRecipeNode {
  return {
    nodeId: `volume-${volume.order}`,
    layer: 'volume',
    title: volume.title,
    responsibility: volume.direction,
    status: volume.order === 1 ? 'ready' : 'outline',
    budget: { wordTarget: volume.targetWords, note: '这里只是本卷方向，事件链进入本卷时再设计。' },
    hardRequirements: [],
    methodGuidance: [],
    readerExperience: experience(
      volume.readerPayoff,
      volume.mainPressure,
      volume.readerPayoff,
      '只揭示完成本卷行动所需的信息，不提前讲透未来卷。',
      volume.order === 1 ? '首卷负责证明本书核心卖点能够落到真实行动。' : '必须承接上一卷结果，并改变本卷的主要问题或解决方式。',
      `服务全书路线“${route.routeTitle}”，但不锁死卷内事件。`
    ),
    creativeSpace: ['具体事件链、人物行动、场景和意外发展由本卷规划成员依据当时实际状态创造。'],
    expectedChanges: [volume.protagonistChange, volume.readerPayoff, volume.handoff],
    children: []
  };
}

function strategyGuidance(
  strategies: readonly V7PlanningStrategyChoice[],
  layer: V7PlanningStrategyChoice['layer']
): LayeredMethodGuidance[] {
  return strategies.filter((strategy) => strategy.layer === layer).slice(0, 6).map((strategy, index) => {
    if (strategy.source === 'library') {
      if (strategy.methodKey === undefined) throw new Error('公共方法策略缺少方法编号');
      return {
        source: 'library' as const,
        methodKey: strategy.methodKey,
        role: index === 0 ? 'primary' as const : 'support' as const,
        strength: 'soft' as const,
        adaptationNote: strategy.applicationNote
      };
    }
    return {
      source: 'custom' as const,
      customTitle: strategy.title,
      role: index === 0 ? 'primary' as const : 'support' as const,
      strength: 'soft' as const,
      adaptationNote: strategy.applicationNote
    };
  });
}

function legacyRecipeToBrief(
  record: Record<string, unknown>,
  seatKey: V7PlanningBriefSeatKey
): V7ProgressivePlanningBrief {
  const recipe = record.recipe as LayeredPlanningRecipe;
  const strategies: V7PlanningStrategyChoice[] = [];
  const visit = (node: LayeredRecipeNode): void => {
    if (node.layer === 'book_backbone' || node.layer === 'volume_distribution') {
      for (const guidance of node.methodGuidance) {
        strategies.push(guidance.source === 'library'
          ? {
              source: 'library', methodKey: guidance.methodKey!, title: guidance.methodKey ?? '已保存方法',
              layer: node.layer, applicationNote: guidance.adaptationNote, caution: '沿用旧任务的已保存软参考。'
            }
          : {
              source: 'agent_original', title: guidance.customTitle ?? '旧任务临时策略',
              layer: node.layer, applicationNote: guidance.adaptationNote, caution: '仅用于当前书籍。'
            });
      }
    }
    node.children.forEach(visit);
  };
  visit(recipe.root);
  if (!strategies.some((strategy) => strategy.source === 'agent_original')) {
    strategies.push({
      source: 'agent_original', title: '沿用旧任务的作品化调整', layer: 'book_backbone',
      applicationNote: '保留旧任务已经形成的作品方向，不把公共方法当成固定剧情。', caution: '进入下层时仍需依据实际状态重新创造。'
    });
  }
  return {
    schema: 'v7-progressive-planning-brief-v2', seatKey,
    publicSummary: requiredText(record.publicSummary, '旧方案说明'),
    centralPromise: recipe.root.responsibility,
    causalSpine: recipe.root.responsibility,
    protagonistArc: recipe.root.expectedChanges.join('；') || recipe.root.responsibility,
    longFormCapacity: recipe.root.readerExperience.designReason,
    pressureRhythm: recipe.root.readerExperience.pressureRhythm,
    payoffCadence: recipe.root.readerExperience.payoffCadence,
    informationRhythm: recipe.root.readerExperience.informationRhythm,
    distinctiveness: recipe.root.readerExperience.contrastWithPrevious,
    selectedStrategies: strategies.slice(0, 6),
    creativeOpenings: recipe.root.creativeSpace.length > 0 ? [...recipe.root.creativeSpace].slice(0, 4) : ['进入下层时依据实际状态继续创造。', '具体事件不由旧配方锁死。'],
    strengths: textList(record.strengths, '旧方案优势', 1, 6),
    risks: textList(record.risks, '旧方案风险', 1, 6),
    authorDecisions: Array.isArray(record.authorDecisions) ? textList(record.authorDecisions, '旧方案待决项', 0, 6) : []
  };
}

function strategyList(value: unknown, allowedMethodKeys: readonly string[]): V7PlanningStrategyChoice[] {
  if (!Array.isArray(value) || value.length < 4 || value.length > 6) throw new Error('全书策略必须为4至6项');
  const allowed = new Set(allowedMethodKeys);
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('全书策略格式无效');
    const record = item as Record<string, unknown>;
    const source = record.source;
    if (source !== 'library' && source !== 'agent_original') throw new Error('全书策略来源无效');
    const layer = record.layer;
    if (layer !== 'book_backbone' && layer !== 'volume_distribution') throw new Error('全书策略层级无效');
    const methodKey = source === 'library' ? requiredText(record.methodKey, '方法编号') : undefined;
    if (methodKey !== undefined && !allowed.has(methodKey)) throw new Error('全案主编引用了本轮没有召回的方法');
    if (source === 'agent_original' && typeof record.methodKey === 'string' && record.methodKey.trim().length > 0) {
      throw new Error('本书原创策略不能伪装成公共方法');
    }
    return {
      source,
      ...(methodKey === undefined ? {} : { methodKey }),
      title: requiredText(record.title, '策略名称'),
      layer,
      applicationNote: requiredText(record.applicationNote, '本书使用说明'),
      caution: requiredText(record.caution, '策略风险')
    };
  });
}

function experience(
  publicSummary: string,
  pressureRhythm: string,
  payoffCadence: string,
  informationRhythm: string,
  contrastWithPrevious: string,
  designReason: string
): ReaderExperienceTarget {
  return { publicSummary, pressureRhythm, payoffCadence, informationRhythm, contrastWithPrevious, designReason };
}

function isRecipe(value: unknown): value is LayeredPlanningRecipe {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (value as { root?: unknown }).root === 'object';
}

function parseJsonObject(output: string): Record<string, unknown> {
  const trimmed = output.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('模型没有返回JSON对象');
  const value = JSON.parse(trimmed.slice(first, last + 1)) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('模型返回内容不是JSON对象');
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label}不能为空`);
  return value.trim();
}

function textList(value: unknown, label: string, min: number, max: number): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label}数量无效`);
  return value.map((item) => requiredText(item, label));
}
