import {
  V7_NARRATIVE_METHODS,
  V7_NARRATIVE_METHOD_LIBRARY_VERSION,
  compileNarrativeResponsibilities,
  getNarrativeMethod,
  validateNarrativeSelection,
  type NarrativeDimension,
  type NarrativeMethodDefinition,
  type NarrativeScope
} from './narrative-method-library.js';

export type NarrativeProductionTask =
  | 'book_blueprint'
  | 'storyline_design'
  | 'volume_plan'
  | 'event_plan'
  | 'scene_plan'
  | 'chapter_outline'
  | 'chapter_draft';

export interface NarrativeTaskProfile {
  task: NarrativeProductionTask;
  scope: NarrativeScope;
  publicTaskLabel: string;
  priorityDimensions: readonly NarrativeDimension[];
  defaultMethodKeys: readonly string[];
  maxMethods: number;
}

export interface NarrativeMethodRecommendationRequest {
  task: NarrativeProductionTask;
  signalText?: string;
  preferredMethodKeys?: readonly string[];
  excludedMethodKeys?: readonly string[];
  maxMethods?: number;
}

export interface RecommendedNarrativeMethod {
  key: string;
  professionalName: string;
  dimension: NarrativeDimension;
  reason: string;
  score: number;
}

export interface NarrativeMethodRecommendation {
  task: NarrativeProductionTask;
  scope: NarrativeScope;
  selected: RecommendedNarrativeMethod[];
  warnings: string[];
}

export interface NarrativeMethodPack {
  libraryVersion: string;
  task: NarrativeProductionTask;
  scope: NarrativeScope;
  methodReferences: RecommendedNarrativeMethod[];
  authorGuidance: string[];
  generationInstructions: string[];
  guardrails: string[];
  generationPrompt: string;
  warnings: string[];
}

export const NARRATIVE_TASK_PROFILES: Readonly<Record<NarrativeProductionTask, NarrativeTaskProfile>> = {
  book_blueprint: profile(
    'book_blueprint', 'book', '全书方向设计',
    ['story_form', 'macro_architecture', 'causal_dynamics', 'character_arc', 'serial_rhythm', 'theme_meaning'],
    ['single-core-line', 'four-act', 'causal-chain', 'positive-growth-arc', 'promise-progress-payoff', 'thematic-question'],
    6
  ),
  storyline_design: profile(
    'storyline_design', 'storyline', '故事线设计',
    ['macro_architecture', 'causal_dynamics', 'character_arc', 'information_design', 'serial_rhythm', 'closure_payoff'],
    ['story-spine', 'goal-action-consequence', 'want-need-gap', 'central-dramatic-question', 'promise-progress-payoff', 'closure-hierarchy'],
    6
  ),
  volume_plan: profile(
    'volume_plan', 'volume', '本卷方向设计',
    ['macro_architecture', 'causal_dynamics', 'conflict_pressure', 'emotional_rhythm', 'serial_rhythm', 'closure_payoff'],
    ['four-act', 'causal-chain', 'direct-opposition', 'tension-relief', 'arc-close-next-open', 'closure-hierarchy'],
    6
  ),
  event_plan: profile(
    'event_plan', 'event', '事件设计',
    ['macro_architecture', 'causal_dynamics', 'conflict_pressure', 'information_design', 'emotional_rhythm', 'closure_payoff'],
    ['story-completeness', 'goal-action-consequence', 'direct-opposition', 'central-dramatic-question', 'anticipation-pressure-release', 'denouement'],
    6
  ),
  scene_plan: profile(
    'scene_plan', 'scene', '场景设计',
    ['scene_structure', 'causal_dynamics', 'conflict_pressure', 'information_design', 'emotional_rhythm'],
    ['scene-goal-conflict-turn-result', 'yes-but-no-and', 'direct-opposition', 'setup-payoff', 'emotional-contrast'],
    5
  ),
  chapter_outline: profile(
    'chapter_outline', 'chapter', '章纲设计',
    ['serial_rhythm', 'scene_structure', 'information_design', 'pacing_control', 'viewpoint_voice'],
    ['chapter-micro-arc', 'action-reaction-balance', 'partial-answer-new-question', 'scene-summary-balance', 'limited-viewpoint'],
    5
  ),
  chapter_draft: profile(
    'chapter_draft', 'chapter', '正文写作',
    ['viewpoint_voice', 'scene_structure', 'pacing_control', 'information_design', 'serial_rhythm'],
    ['limited-viewpoint', 'motivation-reaction-unit', 'scene-summary-balance', 'suspense-pressure', 'chapter-micro-arc'],
    5
  )
};

export function recommendNarrativeMethods(
  request: NarrativeMethodRecommendationRequest
): NarrativeMethodRecommendation {
  const taskProfile = NARRATIVE_TASK_PROFILES[request.task];
  const preferredKeys = unique(request.preferredMethodKeys ?? []);
  const excludedKeys = new Set(unique(request.excludedMethodKeys ?? []));
  const requestedLimit = request.maxMethods ?? taskProfile.maxMethods;
  const maxMethods = Math.min(Math.max(requestedLimit, 1), 6);
  const warnings: string[] = [];

  if (requestedLimit > 6) warnings.push('单次生产资料包最多使用6项方法，已自动收敛到6项。');
  for (const methodKey of excludedKeys) {
    if (getNarrativeMethod(methodKey) === null) throw new Error(`排除的叙事方法不存在：${methodKey}`);
  }
  for (const methodKey of preferredKeys) {
    if (excludedKeys.has(methodKey)) throw new Error(`叙事方法不能同时指定和排除：${methodKey}`);
  }
  if (preferredKeys.length > maxMethods) {
    throw new Error(`作者指定了${preferredKeys.length}项方法，超过当前资料包上限${maxMethods}项`);
  }
  const preferredValidation = validateNarrativeSelection(taskProfile.scope, preferredKeys);
  if (!preferredValidation.valid) throw new Error(preferredValidation.errors.join('；'));

  const normalizedSignalText = normalize(request.signalText ?? '');
  const defaultKeys = new Set(taskProfile.defaultMethodKeys);
  const selected = preferredKeys.map((methodKey) => {
    const value = requireMethod(methodKey);
    return recommendation(value, 10_000, '作者明确指定');
  });

  const ranked = V7_NARRATIVE_METHODS
    .filter((item) => item.applicableScopes.includes(taskProfile.scope) && !excludedKeys.has(item.key))
    .map((item, index) => rank(item, index, taskProfile, defaultKeys, normalizedSignalText))
    .filter((item) => item.method.recommendationTier !== 'advanced' || item.signalMatches.length > 0 || defaultKeys.has(item.method.key))
    .sort((left, right) => right.score - left.score || left.registryIndex - right.registryIndex);

  for (const dimension of taskProfile.priorityDimensions) {
    if (selected.length >= maxMethods) break;
    if (selected.some((item) => item.dimension === dimension)) continue;
    const candidate = ranked.find((item) => item.method.dimension === dimension && canSelect(item.method, selected));
    if (candidate === undefined) continue;
    selected.push(recommendation(
      candidate.method,
      candidate.score,
      candidate.signalMatches.length > 0
        ? `匹配作品信息：${candidate.signalMatches.join('、')}`
        : '该创作任务的基础职责'
    ));
  }

  for (const candidate of ranked) {
    if (selected.length >= maxMethods) break;
    if (candidate.signalMatches.length === 0) continue;
    if (selected.some((item) => item.key === candidate.method.key || item.dimension === candidate.method.dimension)) continue;
    if (!canSelect(candidate.method, selected)) continue;
    selected.push(recommendation(candidate.method, candidate.score, `匹配作品信息：${candidate.signalMatches.join('、')}`));
  }

  const finalValidation = validateNarrativeSelection(taskProfile.scope, selected.map((item) => item.key));
  if (!finalValidation.valid) throw new Error(finalValidation.errors.join('；'));
  warnings.push(...finalValidation.warnings);
  return { task: request.task, scope: taskProfile.scope, selected, warnings: unique(warnings) };
}

export function buildNarrativeMethodPack(request: NarrativeMethodRecommendationRequest): NarrativeMethodPack {
  const recommendationValue = recommendNarrativeMethods(request);
  const compiled = compileNarrativeResponsibilities(
    recommendationValue.scope,
    recommendationValue.selected.map((item) => item.key)
  );
  const taskLabel = NARRATIVE_TASK_PROFILES[request.task].publicTaskLabel;
  const generationPrompt = [
    `当前任务：${taskLabel}。只完成当前层级，不把规划写成已经发生的正文事实。`,
    '请执行以下叙事责任：',
    ...compiled.responsibilities.map((item) => `- ${item}`),
    ...(compiled.guardrails.length === 0 ? [] : ['风险护栏：', ...compiled.guardrails.map((item) => `- ${item}`)]),
    '允许人物作出意外但符合动机与既有事实的选择；不要为了结构整齐机械打卡。'
  ].join('\n');
  return {
    libraryVersion: V7_NARRATIVE_METHOD_LIBRARY_VERSION,
    task: request.task,
    scope: recommendationValue.scope,
    methodReferences: recommendationValue.selected,
    authorGuidance: compiled.publicExplanations,
    generationInstructions: compiled.responsibilities,
    guardrails: compiled.guardrails,
    generationPrompt,
    warnings: unique([...recommendationValue.warnings, ...compiled.warnings])
  };
}

function profile(
  task: NarrativeProductionTask,
  scope: NarrativeScope,
  publicTaskLabel: string,
  priorityDimensions: readonly NarrativeDimension[],
  defaultMethodKeys: readonly string[],
  maxMethods: number
): NarrativeTaskProfile {
  return { task, scope, publicTaskLabel, priorityDimensions, defaultMethodKeys, maxMethods };
}

function rank(
  method: NarrativeMethodDefinition,
  registryIndex: number,
  taskProfile: NarrativeTaskProfile,
  defaultKeys: ReadonlySet<string>,
  normalizedSignalText: string
): { method: NarrativeMethodDefinition; registryIndex: number; score: number; signalMatches: string[] } {
  const signalMatches = method.fitSignals.filter((signal) => {
    const normalizedSignal = normalize(signal);
    return normalizedSignal.length > 0 && normalizedSignalText.includes(normalizedSignal);
  });
  const tierScore = method.recommendationTier === 'default' ? 4 : method.recommendationTier === 'recommended' ? 2 : 0;
  const score = signalMatches.length * 12
    + (defaultKeys.has(method.key) ? 6 : 0)
    + (method.primaryScope === taskProfile.scope ? 2 : 0)
    + (taskProfile.priorityDimensions.includes(method.dimension) ? 2 : 0)
    + tierScore;
  return { method, registryIndex, score, signalMatches };
}

function canSelect(method: NarrativeMethodDefinition, selected: readonly RecommendedNarrativeMethod[]): boolean {
  if (selected.some((item) => item.key === method.key)) return false;
  if (method.exclusiveGroup === null) return true;
  return selected.every((item) => {
    const selectedMethod = requireMethod(item.key);
    return selectedMethod.exclusiveGroup !== method.exclusiveGroup;
  });
}

function recommendation(
  method: NarrativeMethodDefinition,
  score: number,
  reason: string
): RecommendedNarrativeMethod {
  return {
    key: method.key,
    professionalName: method.professionalName,
    dimension: method.dimension,
    reason,
    score
  };
}

function requireMethod(methodKey: string): NarrativeMethodDefinition {
  const value = getNarrativeMethod(methodKey);
  if (value === null) throw new Error(`叙事方法不存在：${methodKey}`);
  return value;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/[\s\-_/／—，。；：、,.!?！？]+/gu, '');
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
