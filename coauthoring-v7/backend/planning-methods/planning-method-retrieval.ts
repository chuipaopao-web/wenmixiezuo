import {
  NARRATIVE_DIMENSIONS,
  V7_NARRATIVE_METHODS,
  type NarrativeDimension,
  type NarrativeMethodDefinition
} from '../narrative-methods/narrative-method-library.js';
import {
  PLANNING_LAYERS,
  getMethodExecutionProfile,
  type MethodExecutionProfile,
  type PlanningLayerKey
} from './method-asset-profiles.js';

export interface V7PlanningMethodSearchRequest {
  schema: 'v7-planning-method-search-v1';
  publicGoal: string;
  searchQueries: string[];
  planningLayers: PlanningLayerKey[];
  dimensions: NarrativeDimension[];
  desiredCount: number;
  scaleHint: string;
  avoidNotes: string[];
  relevantSettingSourceIds: string[];
  missingCriticalInputs: string[];
}

export interface V7PlanningMethodCandidate {
  methodKey: string;
  professionalName: string;
  publicExplanation: string;
  dimension: NarrativeDimension;
  kind: NarrativeMethodDefinition['kind'];
  recommendationTier: NarrativeMethodDefinition['recommendationTier'];
  exclusiveGroup: string | null;
  planningLayers: readonly PlanningLayerKey[];
  recommendedScale: readonly string[];
  fitSignals: readonly string[];
  cautionSignals: readonly string[];
  responsibilities: readonly string[];
  combinationGuidance: string;
}

export interface V7PlanningMethodRetrievalResult {
  request: V7PlanningMethodSearchRequest;
  candidates: V7PlanningMethodCandidate[];
  retrievalVersion: 'v7-method-retrieval-1';
}

const DEFAULT_METHOD_KEYS = [
  'story-completeness',
  'story-spine',
  'linear-chronology',
  'causal-chain',
  'promise-progress-payoff',
  'anticipation-pressure-release'
] as const;

export function planningMethodSearchContext(): unknown {
  return {
    planningLayers: PLANNING_LAYERS.map((layer) => ({
      key: layer.key,
      publicName: layer.publicName,
      responsibility: layer.responsibility,
      recommendedScale: layer.recommendedScale,
      defers: layer.defers
    })),
    dimensions: NARRATIVE_DIMENSIONS.map((dimension) => ({
      key: dimension.key,
      responsibility: dimension.responsibility,
      authorQuestion: dimension.authorQuestion
    }))
  };
}

export function parsePlanningMethodSearchRequest(output: string): V7PlanningMethodSearchRequest {
  const value = parseJsonObject(output);
  if (value.schema !== 'v7-planning-method-search-v1') throw new Error('方法检索请求格式不完整');
  const planningLayers = enumList(value.planningLayers, PLANNING_LAYERS.map((item) => item.key), '规划层级', 1, 3);
  const dimensions = enumList(value.dimensions, NARRATIVE_DIMENSIONS.map((item) => item.key), '方法维度', 2, 8);
  const desiredCount = integer(value.desiredCount, '候选方法数量', 8, 12);
  return {
    schema: 'v7-planning-method-search-v1',
    publicGoal: requiredText(value.publicGoal, '检索目标'),
    searchQueries: textList(value.searchQueries, '检索词', 2, 5),
    planningLayers,
    dimensions,
    desiredCount,
    scaleHint: requiredText(value.scaleHint, '篇幅提示'),
    avoidNotes: textList(value.avoidNotes, '避坑说明', 0, 8),
    relevantSettingSourceIds: uniqueTextList(value.relevantSettingSourceIds, '相关设定资料', 1, 24),
    missingCriticalInputs: criticalInputList(value.missingCriticalInputs, 0, 8)
  };
}

export function extractPlanningCriticalInputs(output: string): string[] {
  try {
    const value = parseJsonObject(output);
    return criticalInputList(value.missingCriticalInputs ?? [], 0, 8);
  } catch {
    // A truncated or otherwise malformed envelope must continue to the output
    // contract repair path. It is not evidence that the source package has a
    // semantic gap, and must not silently trigger a different member redo.
    return [];
  }
}

export function retrievePlanningMethodCandidates(request: V7PlanningMethodSearchRequest): V7PlanningMethodRetrievalResult {
  const queryTokens = request.searchQueries.flatMap(tokens);
  const scored = V7_NARRATIVE_METHODS
    .map((method) => {
      const profile = getMethodExecutionProfile(method.key);
      if (profile === null || !profile.planningLayers.some((layer) => request.planningLayers.includes(layer))) return null;
      const searchable = normalize([
        method.professionalName,
        method.publicExplanation,
        ...method.fitSignals,
        ...method.responsibilities,
        ...profile.recommendedScale
      ].join(' '));
      const queryScore = queryTokens.reduce((sum, token) => sum + (searchable.includes(token) ? 3 : 0), 0);
      const score = (request.dimensions.includes(method.dimension) ? 12 : 0)
        + queryScore
        + (method.recommendationTier === 'default' ? 3 : method.recommendationTier === 'recommended' ? 2 : 0)
        + (method.kind === 'foundation' ? 1 : 0);
      return { method, profile, score };
    })
    .filter((item): item is { method: NarrativeMethodDefinition; profile: MethodExecutionProfile; score: number } => item !== null)
    .toSorted((left, right) => right.score - left.score || left.method.key.localeCompare(right.method.key));

  const selected: typeof scored = [];
  const selectedKeys = new Set<string>();
  const add = (entry: (typeof scored)[number] | undefined): void => {
    if (entry === undefined || selectedKeys.has(entry.method.key) || selected.length >= request.desiredCount) return;
    selected.push(entry);
    selectedKeys.add(entry.method.key);
  };
  for (const dimension of request.dimensions) add(scored.find((entry) => entry.method.dimension === dimension));
  for (const key of DEFAULT_METHOD_KEYS) add(scored.find((entry) => entry.method.key === key));
  for (const entry of scored) add(entry);

  return {
    request,
    candidates: selected.map(({ method, profile }) => candidate(method, profile)),
    retrievalVersion: 'v7-method-retrieval-1'
  };
}

export function planningMethodSearchPrompt(input: {
  seatName: string;
  seatResponsibility: string;
  independentFocus: readonly string[];
  sourceSnapshot: unknown;
}): string {
  return [
    '你正在为一部长篇小说准备方法检索。只返回一个JSON对象，不要Markdown，不要思维过程。',
    `本次身份：${input.seatName}。责任：${input.seatResponsibility}`,
    `重点检查：${input.independentFocus.join('；')}`,
    '现在只决定“需要检索哪类方法”并筛选本席真正需要的设定资料，不要直接设计故事，也不要猜方法库里有哪些具体方法。',
    '检索必须覆盖全书顶层与跨卷分配；只选与本书真正相关的维度，避免把所有维度都要一遍。',
    '正式开书资料、作者本次目标、上级确认内容和正文实际必须保留；设定总账只负责导航，不要把总账sourceId填入relevantSettingSourceIds。已确认设定必须从schema="v7-setting-fact-source-v1"的逐项事实源中挑选本席确实需要的资料；relevantSettingSourceIds只能填写这些逐项事实源的sourceId，不得编造。',
    '如果缺少会导致商业全书路线无法可靠设计的硬信息，写入missingCriticalInputs。预计总字数是开书阶段唯一必须提前确定的规划尺度，默认按番茄连载场景工作，不要重复报缺。建议卷数、商业受众和追读定位是每席全书路线自己必须产出的结果，不是上游缺口。普通创作留白不是缺口，能在方案中合理创作的内容不要上报；信息齐全时返回空数组。不得自行脑补作者已经明确但本次资料中缺失的硬事实。',
    '输出字段：schema="v7-planning-method-search-v1",publicGoal,searchQueries,planningLayers,dimensions,desiredCount,scaleHint,avoidNotes,relevantSettingSourceIds,missingCriticalInputs。missingCriticalInputs每项优先写成一句可直接给作者看的大白话；如需说明影响和待确认内容，也可写成{issue,impact,needed}，系统会合并展示。',
    'searchQueries为2—5条大白话创作需求；desiredCount为8—12；dimensions为2—8项；relevantSettingSourceIds为1—24项。',
    `可检索的层级和维度：${JSON.stringify(planningMethodSearchContext())}`,
    `正式资料快照：${JSON.stringify(input.sourceSnapshot)}`
  ].join('\n\n');
}

function candidate(method: NarrativeMethodDefinition, profile: MethodExecutionProfile): V7PlanningMethodCandidate {
  return {
    methodKey: method.key,
    professionalName: method.professionalName,
    publicExplanation: method.publicExplanation,
    dimension: method.dimension,
    kind: method.kind,
    recommendationTier: method.recommendationTier,
    exclusiveGroup: method.exclusiveGroup,
    planningLayers: profile.planningLayers,
    recommendedScale: profile.recommendedScale,
    fitSignals: method.fitSignals,
    cautionSignals: method.cautionSignals,
    responsibilities: method.responsibilities,
    combinationGuidance: profile.combinationGuidance
  };
}

function tokens(value: string): string[] {
  return normalize(value).split(/[\s,，。；、:：/]+/u).filter((item) => item.length >= 2);
}

function normalize(value: string): string { return value.trim().toLocaleLowerCase('zh-CN'); }

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

function uniqueTextList(value: unknown, label: string, min: number, max: number): string[] {
  const values = textList(value, label, min, max);
  const unique = [...new Set(values)];
  if (unique.length < min || unique.length > max) throw new Error(`${label}数量无效`);
  return unique;
}

function criticalInputList(value: unknown, min: number, max: number): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error('缺失关键信息数量无效');
  const normalized = value.map((item) => {
    if (typeof item === 'string') return requiredText(item, '缺失关键信息');
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error('缺失关键信息格式无效');
    const entry = item as Record<string, unknown>;
    const issue = requiredText(entry.issue, '缺失关键信息');
    const impact = optionalText(entry.impact);
    const needed = optionalText(entry.needed);
    return [issue, impact === null ? null : `影响：${impact}`, needed === null ? null : `需要确认：${needed}`]
      .filter((part): part is string => part !== null)
      .join('；');
  });
  const unique = [...new Set(normalized)];
  if (unique.length < min || unique.length > max) throw new Error('缺失关键信息数量无效');
  return unique;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label}无效`);
  return Number(value);
}

function enumList<T extends string>(value: unknown, allowed: readonly T[], label: string, min: number, max: number): T[] {
  const values = textList(value, label, min, max);
  const result = values.map((item) => {
    if (!allowed.includes(item as T)) throw new Error(`${label}包含未知值：${item}`);
    return item as T;
  });
  const unique = [...new Set(result)];
  if (unique.length < min || unique.length > max) throw new Error(`${label}数量无效`);
  return unique;
}
