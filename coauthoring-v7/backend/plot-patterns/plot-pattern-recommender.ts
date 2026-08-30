import {
  V7_PLOT_PATTERN_LIBRARY_VERSION,
  V7_PLOT_PATTERNS,
  getPlotPattern,
  type GenreFamily,
  type PlotPatternCategory,
  type PlotPatternDefinition
} from './plot-pattern-library.js';
import {
  V7_PLOT_RECIPE_LIBRARY_VERSION,
  V7_PLOT_RECIPES,
  getPlotRecipe,
  type PlotRecipeDefinition,
  type PlotRecipeStageDefinition
} from './plot-recipe-library.js';

export type PlotPlanningScope = 'volume' | 'event';
export type PlotComplexity = 'light' | 'standard' | 'complex';

export interface PlotPatternRecommendationRequest {
  taskId: string;
  scope: PlotPlanningScope;
  genreFamilies: readonly GenreFamily[];
  currentGoal: string;
  authorIdeas?: string;
  confirmedActualSummary?: string;
  signals?: readonly string[];
  preferredRecipeKey?: string;
  preferredPatternKeys?: readonly string[];
  excludedPatternKeys?: readonly string[];
  recentPatternKeys?: readonly string[];
  requestedUnitCount?: number;
  complexity?: PlotComplexity;
}

export interface PublicPlotRecipeRecommendation {
  recipeKey: string;
  publicTitle: string;
  publicExplanation: string;
  reason: string;
  standardUnitCount: 5;
  selectableUnitRange: readonly [3, 7];
}

export interface PlotUnitBlueprint {
  order: number;
  publicTitle: string;
  responsibility: string;
  publicPatternEffects: readonly string[];
  requiredChange: string;
  nextTrigger: string;
  guardrails: readonly string[];
  internalPatternKeys: readonly string[];
}

export interface PlotPatternAIPack {
  contractVersion: 1;
  taskId: string;
  scope: PlotPlanningScope;
  patternLibraryVersion: string;
  recipeLibraryVersion: string;
  selectedRecipeKey: string;
  selectedRecipeTitle: string;
  unitCount: number;
  units: readonly PlotUnitBlueprint[];
  planningInputs: {
    currentGoal: string;
    authorIdeas: string | null;
  };
  confirmedActualSummary: string | null;
  generationPrompt: string;
  internalReferences: {
    recipeKey: string;
    patternKeys: readonly string[];
    narrativeMethodKeys: readonly string[];
  };
}

interface Ranked<T> {
  item: T;
  score: number;
  reasons: string[];
}

export function recommendPlotRecipes(
  request: PlotPatternRecommendationRequest,
  limit = 3
): PublicPlotRecipeRecommendation[] {
  validateRequest(request);
  if (!Number.isInteger(limit) || limit < 1 || limit > 6) throw new Error('剧情配方候选数量必须在 1—6 之间。');
  const ranked = rankRecipes(request).slice(0, limit);
  return ranked.map(({ item, reasons }) => ({
    recipeKey: item.key,
    publicTitle: item.publicTitle,
    publicExplanation: item.publicExplanation,
    reason: reasons.length > 0 ? reasons.join('；') : '这套推进能承接当前目标，并允许后续自由调整。',
    standardUnitCount: 5,
    selectableUnitRange: [3, 7]
  }));
}

export function buildPlotPatternAIPack(request: PlotPatternRecommendationRequest): PlotPatternAIPack {
  validateRequest(request);
  const recipe = selectRecipe(request);
  const targetUnitCount = resolveUnitCount(request);
  const stagePlans = resizeStages(recipe.stages, targetUnitCount);
  const used = new Set<string>();
  const units = stagePlans.map((stageValue, index) => {
    const patterns = selectPatternsForStage(stageValue, request, used);
    for (const pattern of patterns) used.add(pattern.key);
    const nextTrigger = index === stagePlans.length - 1
      ? '把本单元的真实结果结算后，再决定下一卷或下一事件；不要把计划写成已经发生。'
      : `下一单元必须承接“${stageValue.requiredChange}”形成的新状态，不得恢复到本单元开始前。`;
    return {
      order: index + 1,
      publicTitle: stageValue.publicTitle,
      responsibility: stageValue.responsibility,
      publicPatternEffects: patterns.map((pattern) => pattern.publicExplanation),
      requiredChange: stageValue.requiredChange,
      nextTrigger,
      guardrails: unique([recipe.caution, ...patterns.map((pattern) => pattern.caution)]),
      internalPatternKeys: patterns.map((pattern) => pattern.key)
    } satisfies PlotUnitBlueprint;
  });
  const allPatternKeys = unique(units.flatMap((unit) => unit.internalPatternKeys));
  const patternMethods = allPatternKeys.flatMap((key) => getPlotPattern(key)?.narrativeMethodKeys ?? []);
  const planningInputs = {
    currentGoal: request.currentGoal.trim(),
    authorIdeas: normalizeNullable(request.authorIdeas)
  };
  const actual = normalizeNullable(request.confirmedActualSummary);
  return {
    contractVersion: 1,
    taskId: request.taskId,
    scope: request.scope,
    patternLibraryVersion: V7_PLOT_PATTERN_LIBRARY_VERSION,
    recipeLibraryVersion: V7_PLOT_RECIPE_LIBRARY_VERSION,
    selectedRecipeKey: recipe.key,
    selectedRecipeTitle: recipe.publicTitle,
    unitCount: units.length,
    units,
    planningInputs,
    confirmedActualSummary: actual,
    generationPrompt: compileGenerationPrompt(request.scope, recipe, units, planningInputs, actual),
    internalReferences: {
      recipeKey: recipe.key,
      patternKeys: allPatternKeys,
      narrativeMethodKeys: unique([...recipe.narrativeMethodKeys, ...patternMethods])
    }
  };
}

function selectRecipe(request: PlotPatternRecommendationRequest): PlotRecipeDefinition {
  if (request.preferredRecipeKey !== undefined) {
    const preferred = getPlotRecipe(request.preferredRecipeKey);
    if (preferred === null) throw new Error(`剧情配方不存在：${request.preferredRecipeKey}`);
    return preferred;
  }
  const first = rankRecipes(request)[0];
  if (first === undefined) throw new Error('没有找到可用的剧情配方。');
  return first.item;
}

function rankRecipes(request: PlotPatternRecommendationRequest): Ranked<PlotRecipeDefinition>[] {
  const signalText = normalize([
    request.currentGoal,
    request.authorIdeas ?? '',
    ...(request.signals ?? [])
  ].join(' '));
  const preferredPatterns = new Set(request.preferredPatternKeys ?? []);
  return V7_PLOT_RECIPES.map((item, index) => {
    let score = item.commonGenreFamilies.length === 0 ? 3 : 0;
    const reasons: string[] = [];
    const genreMatches = item.commonGenreFamilies.filter((genre) => request.genreFamilies.includes(genre));
    if (genreMatches.length > 0) {
      score += genreMatches.length * 7;
      reasons.push('与当前题材常见需求相合');
    }
    const matchedSignals = item.fitSignals.filter((signal) => signalText.includes(normalize(signal)));
    if (matchedSignals.length > 0) {
      score += matchedSignals.length * 5;
      reasons.push(`回应了“${matchedSignals.slice(0, 2).join('、')}”方向`);
    }
    const recipePatterns = item.stages.flatMap((stageValue) => stageValue.preferredPatternKeys);
    const preferenceMatches = recipePatterns.filter((key) => preferredPatterns.has(key));
    if (preferenceMatches.length > 0) {
      score += preferenceMatches.length * 8;
      reasons.push('包含作者指定的剧情效果');
    }
    return { item, score: score - index / 10_000, reasons };
  }).sort((left, right) => right.score - left.score || left.item.key.localeCompare(right.item.key));
}

function selectPatternsForStage(
  stageValue: PlotRecipeStageDefinition,
  request: PlotPatternRecommendationRequest,
  used: ReadonlySet<string>
): PlotPatternDefinition[] {
  const excluded = new Set(request.excludedPatternKeys ?? []);
  const preferred = new Set(request.preferredPatternKeys ?? []);
  const recent = new Set(request.recentPatternKeys ?? []);
  const selected: PlotPatternDefinition[] = [];
  for (const category of unique(stageValue.requiredCategories)) {
    const candidates = V7_PLOT_PATTERNS.filter((item) => item.category === category && !excluded.has(item.key));
    const ranked = candidates.map((item) => ({
      item,
      score: scorePattern(item, request, preferred, recent, used, stageValue),
      reasons: []
    })).sort((left, right) => right.score - left.score || left.item.key.localeCompare(right.item.key));
    const chosen = ranked[0]?.item;
    if (chosen === undefined) throw new Error(`阶段“${stageValue.publicTitle}”没有可用的${category}模式。`);
    if (!selected.some((item) => item.key === chosen.key)) selected.push(chosen);
  }
  for (const key of stageValue.preferredPatternKeys) {
    const pattern = getPlotPattern(key);
    if (pattern !== null && !excluded.has(key) && preferred.has(key) && !selected.some((item) => item.key === key)) {
      selected.push(pattern);
    }
  }
  return selected.slice(0, 3);
}

function scorePattern(
  item: PlotPatternDefinition,
  request: PlotPatternRecommendationRequest,
  preferred: ReadonlySet<string>,
  recent: ReadonlySet<string>,
  used: ReadonlySet<string>,
  stageValue: PlotRecipeStageDefinition
): number {
  let score = 0;
  if (stageValue.preferredPatternKeys.includes(item.key)) score += 40;
  if (preferred.has(item.key)) score += 70;
  if (item.commonGenreFamilies.length === 0) score += 2;
  score += item.commonGenreFamilies.filter((genre) => request.genreFamilies.includes(genre)).length * 6;
  const signalText = normalize([
    request.currentGoal, request.authorIdeas ?? '', ...(request.signals ?? []),
    stageValue.publicTitle, stageValue.responsibility, stageValue.requiredChange
  ].join(' '));
  score += item.fitSignals.reduce((total, signal) => {
    const normalizedSignal = normalize(signal);
    if (normalizedSignal.length > 0 && signalText.includes(normalizedSignal)) return total + 6;
    return total + (cjkBigrams(normalizedSignal).some((part) => signalText.includes(part)) ? 1 : 0);
  }, 0);
  if (recent.has(item.key) && !preferred.has(item.key)) score -= 60;
  if (used.has(item.key)) score -= 24;
  return score;
}

function resizeStages(stages: readonly PlotRecipeStageDefinition[], unitCount: number): PlotRecipeStageDefinition[] {
  if (stages.length !== 5) throw new Error('剧情配方标准阶段必须为 5 个。');
  if (unitCount === 5) return stages.map(cloneStage);
  if (unitCount === 3) return [
    mergeStages('opening', '进入与第一次推进', stages.slice(0, 2)),
    mergeStages('pressure-turn', '压力升级与关键转向', stages.slice(2, 4)),
    cloneStage(stages[4]!)
  ];
  if (unitCount === 4) return [
    cloneStage(stages[0]!),
    cloneStage(stages[1]!),
    mergeStages('pressure-turn', '压力升级与关键转向', stages.slice(2, 4)),
    cloneStage(stages[4]!)
  ];
  const complication: PlotRecipeStageDefinition = {
    key: 'added-complication', publicTitle: '后果扩大',
    responsibility: '让上一项进展产生新的资源、关系或信息后果，使旧办法不能重复使用。',
    requiredChange: '局面扩大，并迫使人物改变下一步方法。',
    preferredPatternKeys: ['success-triggers-crisis', 'resource-scarcity'],
    requiredCategories: ['pressure', 'turn']
  };
  if (unitCount === 6) return [
    cloneStage(stages[0]!), cloneStage(stages[1]!), cloneStage(stages[2]!),
    complication, cloneStage(stages[3]!), cloneStage(stages[4]!)
  ];
  const consequence: PlotRecipeStageDefinition = {
    key: 'added-consequence', publicTitle: '人物与资源余波',
    responsibility: '短暂结算第一次推进造成的关系、资源与外界反应，再让这些结果进入下一轮压力。',
    requiredChange: '至少一项关系、资源或公开认知被更新。',
    preferredPatternKeys: ['resource-settlement', 'world-reaction'],
    requiredCategories: ['bridge']
  };
  return [
    cloneStage(stages[0]!), cloneStage(stages[1]!), consequence,
    cloneStage(stages[2]!), complication, cloneStage(stages[3]!), cloneStage(stages[4]!)
  ];
}

function mergeStages(key: string, title: string, values: readonly PlotRecipeStageDefinition[]): PlotRecipeStageDefinition {
  return {
    key,
    publicTitle: title,
    responsibility: values.map((item) => item.responsibility).join(' '),
    requiredChange: values.map((item) => item.requiredChange).join(' '),
    preferredPatternKeys: unique(values.flatMap((item) => item.preferredPatternKeys)),
    requiredCategories: unique(values.flatMap((item) => item.requiredCategories))
  };
}

function cloneStage(value: PlotRecipeStageDefinition): PlotRecipeStageDefinition {
  return {
    ...value,
    preferredPatternKeys: [...value.preferredPatternKeys],
    requiredCategories: [...value.requiredCategories]
  };
}

function resolveUnitCount(request: PlotPatternRecommendationRequest): number {
  if (request.requestedUnitCount !== undefined) return request.requestedUnitCount;
  if (request.complexity === 'light') return 3;
  if (request.complexity === 'complex') return 7;
  return 5;
}

function validateRequest(request: PlotPatternRecommendationRequest): void {
  if (request.taskId.trim().length === 0) throw new Error('taskId 不能为空。');
  if (request.currentGoal.trim().length === 0) throw new Error('当前目标不能为空。');
  if (request.genreFamilies.length === 0) throw new Error('至少提供一个题材家族。');
  if (request.requestedUnitCount !== undefined && (
    !Number.isInteger(request.requestedUnitCount)
    || request.requestedUnitCount < 3
    || request.requestedUnitCount > 7
  )) throw new Error('剧情单元数量必须是 3—7 的整数。');
  const excluded = new Set(request.excludedPatternKeys ?? []);
  for (const key of unique([
    ...(request.preferredPatternKeys ?? []),
    ...(request.excludedPatternKeys ?? []),
    ...(request.recentPatternKeys ?? [])
  ])) {
    if (getPlotPattern(key) === null) throw new Error(`剧情模式不存在：${key}`);
  }
  for (const key of request.preferredPatternKeys ?? []) {
    if (excluded.has(key)) throw new Error(`剧情模式不能同时指定和排除：${key}`);
  }
  if (request.preferredRecipeKey !== undefined && getPlotRecipe(request.preferredRecipeKey) === null) {
    throw new Error(`剧情配方不存在：${request.preferredRecipeKey}`);
  }
}

function compileGenerationPrompt(
  scope: PlotPlanningScope,
  recipe: PlotRecipeDefinition,
  units: readonly PlotUnitBlueprint[],
  planningInputs: PlotPatternAIPack['planningInputs'],
  actual: string | null
): string {
  const scopeLabel = scope === 'volume' ? '本卷' : '本事件';
  const actualBlock = actual === null
    ? '没有提供已确认的前情事实；不得自行把候选设想写成已经发生。'
    : `已确认发生的前情事实：${actual}`;
  const ideaBlock = planningInputs.authorIdeas === null ? '作者没有补充额外想法。' : `作者补充想法：${planningInputs.authorIdeas}`;
  const unitBlocks = units.map((unit) => [
    `${unit.order}. ${unit.publicTitle}`,
    `职责：${unit.responsibility}`,
    `需要发生的变化：${unit.requiredChange}`,
    `可采用的剧情效果：${unit.publicPatternEffects.join('；')}`,
    `衔接要求：${unit.nextTrigger}`,
    `避免：${unit.guardrails.join('；')}`
  ].join('\n')).join('\n\n');
  return [
    `你正在设计${scopeLabel}的剧情草案，不是在续写正文，也不是在汇报已经发生的事实。`,
    actualBlock,
    `当前规划目标：${planningInputs.currentGoal}`,
    ideaBlock,
    `整体推进方向：${recipe.publicExplanation}`,
    '请用当前书籍中的人物、地点、势力、资源和已确认设定，把下面责任改写成前后有因果的具体剧情单元。',
    '每个单元必须写：进入状态、主要冲突、人物主动选择、不可逆结果、下一单元触发。相邻单元必须承接上一单元结果，禁止随机拼贴。',
    '不知道的角色、结局、秘密或事实保持未定，不得伪造。不要在输出中解释内部模板或专业方法。',
    unitBlocks
  ].join('\n\n');
}

function normalizeNullable(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length === 0 ? null : normalized;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN').replace(/[\s·—_／/]+/g, '');
}

function cjkBigrams(value: string): string[] {
  const cjk = [...value].filter((char) => /[\u3400-\u9fff]/u.test(char));
  const values: string[] = [];
  for (let index = 0; index < cjk.length - 1; index += 1) values.push(`${cjk[index]}${cjk[index + 1]}`);
  return values;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
