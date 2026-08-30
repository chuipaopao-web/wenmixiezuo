import {
  NARRATIVE_DIMENSIONS,
  V7_NARRATIVE_METHODS,
  getNarrativeLibrarySummary,
  getNarrativeMethod,
  type NarrativeDimension,
  type NarrativeMethodDefinition,
  type NarrativeScope
} from '../../backend/narrative-methods/narrative-method-library.js';
import {
  GENRE_FAMILIES,
  PLOT_PATTERN_CATEGORY_DEFINITIONS,
  V7_PLOT_PATTERNS,
  getPlotPattern,
  getPlotPatternLibrarySummary,
  type GenreFamily,
  type PlotPatternCategory,
  type PlotPatternDefinition
} from '../../backend/plot-patterns/plot-pattern-library.js';
import {
  V7_PLOT_RECIPES,
  type PlotRecipeDefinition
} from '../../backend/plot-patterns/plot-recipe-library.js';
import {
  buildCrossVolumeExperienceCurve,
  buildHistoricalHegemonyPlanningDemo,
  type LayeredPlanningDemo
} from '../../backend/planning-methods/layered-planning-engine.js';
import {
  PLANNING_LAYERS,
  V7_METHOD_EXECUTION_PROFILES,
  getMethodExecutionProfile
} from '../../backend/planning-methods/method-asset-profiles.js';

export type AssetSection = 'overview' | 'methods' | 'patterns' | 'recipes' | 'planning';
export type AssetDetail =
  | { kind: 'method'; value: NarrativeMethodDefinition }
  | { kind: 'pattern'; value: PlotPatternDefinition }
  | { kind: 'recipe'; value: PlotRecipeDefinition };

export interface MethodFilters {
  query: string;
  dimension: NarrativeDimension | 'all';
  scope: NarrativeScope | 'all';
}

export interface PatternFilters {
  query: string;
  category: PlotPatternCategory | 'all';
  genre: GenreFamily | 'all';
}

export interface RecipeFilters {
  query: string;
  genre: GenreFamily | 'all';
}

export const ASSET_SUMMARY = Object.freeze({
  methods: getNarrativeLibrarySummary(),
  patterns: getPlotPatternLibrarySummary(),
  recipes: {
    version: '1.0.0',
    totalRecipes: V7_PLOT_RECIPES.length
  },
  planning: {
    version: '1.1.0',
    totalLayers: PLANNING_LAYERS.length,
    totalMethodProfiles: V7_METHOD_EXECUTION_PROFILES.length
  }
});

export const PLANNING_DEMO: LayeredPlanningDemo = buildHistoricalHegemonyPlanningDemo();
export const PLANNING_EXPERIENCE_CURVE = buildCrossVolumeExperienceCurve(PLANNING_DEMO.recipe);
export { PLANNING_LAYERS, getMethodExecutionProfile };

export const DIMENSION_OPTIONS = NARRATIVE_DIMENSIONS.map((item) => ({ key: item.key, label: item.internalLabel }));
export const CATEGORY_OPTIONS = PLOT_PATTERN_CATEGORY_DEFINITIONS.map((item) => ({ key: item.key, label: item.publicName }));
export const GENRE_OPTIONS = GENRE_FAMILIES.map((item) => ({ key: item.key, label: item.publicName }));

export const SCOPE_LABELS: Readonly<Record<NarrativeScope, string>> = {
  book: '全书', storyline: '故事线', volume: '分卷', event: '事件', scene: '场景', chapter: '章节'
};

export const TIER_LABELS = {
  default: '基础默认', recommended: '常用推荐', advanced: '进阶手法'
} as const;

export const KIND_LABELS = {
  foundation: '底层原则', framework: '组织框架', modifier: '增强方式', technique: '局部技巧'
} as const;

export function filterMethods(filters: MethodFilters): NarrativeMethodDefinition[] {
  const query = normalize(filters.query);
  return V7_NARRATIVE_METHODS.filter((item) => (
    (filters.dimension === 'all' || item.dimension === filters.dimension)
    && (filters.scope === 'all' || item.applicableScopes.includes(filters.scope))
    && (query.length === 0 || normalize([
      item.professionalName, item.key, item.publicExplanation,
      ...item.fitSignals, ...item.cautionSignals, ...item.responsibilities
    ].join(' ')).includes(query))
  ));
}

export function filterPatterns(filters: PatternFilters): PlotPatternDefinition[] {
  const query = normalize(filters.query);
  return V7_PLOT_PATTERNS.filter((item) => (
    (filters.category === 'all' || item.category === filters.category)
    && (filters.genre === 'all' || item.commonGenreFamilies.length === 0 || item.commonGenreFamilies.includes(filters.genre))
    && (query.length === 0 || normalize([
      item.professionalName, item.key, ...item.aliases, item.publicExplanation,
      item.irreversibleResult, item.caution, ...item.fitSignals
    ].join(' ')).includes(query))
  ));
}

export function filterRecipes(filters: RecipeFilters): PlotRecipeDefinition[] {
  const query = normalize(filters.query);
  return V7_PLOT_RECIPES.filter((item) => (
    (filters.genre === 'all' || item.commonGenreFamilies.length === 0 || item.commonGenreFamilies.includes(filters.genre))
    && (query.length === 0 || normalize([
      item.publicTitle, item.key, item.publicExplanation, item.caution, ...item.fitSignals,
      ...item.stages.flatMap((stage) => [stage.publicTitle, stage.responsibility, stage.requiredChange])
    ].join(' ')).includes(query))
  ));
}

export function getDimensionLabel(key: NarrativeDimension): string {
  return NARRATIVE_DIMENSIONS.find((item) => item.key === key)?.internalLabel ?? key;
}

export function getCategoryLabel(key: PlotPatternCategory): string {
  return PLOT_PATTERN_CATEGORY_DEFINITIONS.find((item) => item.key === key)?.publicName ?? key;
}

export function getGenreLabel(key: GenreFamily): string {
  return GENRE_FAMILIES.find((item) => item.key === key)?.publicName ?? key;
}

export function getNarrativeMethodName(key: string): string {
  return getNarrativeMethod(key)?.professionalName ?? key;
}

export function getPlotPatternName(key: string): string {
  return getPlotPattern(key)?.professionalName ?? key;
}

export function hasActiveFilters(section: AssetSection, methodFilters: MethodFilters, patternFilters: PatternFilters, recipeFilters: RecipeFilters): boolean {
  if (section === 'methods') return methodFilters.query.trim().length > 0 || methodFilters.dimension !== 'all' || methodFilters.scope !== 'all';
  if (section === 'patterns') return patternFilters.query.trim().length > 0 || patternFilters.category !== 'all' || patternFilters.genre !== 'all';
  if (section === 'recipes') return recipeFilters.query.trim().length > 0 || recipeFilters.genre !== 'all';
  return false;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN').replace(/[\s·—_／/]+/g, '');
}
