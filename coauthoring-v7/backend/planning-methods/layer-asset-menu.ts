import {
  NARRATIVE_DIMENSIONS,
  V7_NARRATIVE_METHODS,
  type NarrativeMethodDefinition,
  type NarrativeScope
} from '../narrative-methods/narrative-method-library.js';
import {
  getMethodNominationCard,
  getRecipeNominationCard,
  nominationCardText
} from '../narrative-methods/method-nomination-cards.js';
import {
  PLOT_PATTERN_CATEGORY_DEFINITIONS,
  V7_PLOT_PATTERNS,
  type GenreFamily,
  type PlotPatternDefinition
} from '../plot-patterns/plot-pattern-library.js';
import { V7_PLOT_RECIPES, type PlotRecipeDefinition } from '../plot-patterns/plot-recipe-library.js';
import { getMethodExecutionProfile, type PlanningLayerKey } from './method-asset-profiles.js';

export const V7_LAYER_ASSET_MENU_VERSION = '1.0.0';

/** 第86批配置开关：WENMI_V7_ASSET_MENU=1 时菜单注入任务输入；默认关闭（灰度对比后再开）。 */
export function v7AssetMenuEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WENMI_V7_ASSET_MENU === '1';
}

export type LayerMenuTreeKind = 'book' | 'volume' | 'chain';

/** 规划树种类 → 菜单供给层。全书树取全书顶层（含全书形态卡组）。 */
export function planningLayerForTreeKind(treeKind: LayerMenuTreeKind): PlanningLayerKey {
  if (treeKind === 'book') return 'book_backbone';
  return treeKind;
}

/**
 * 第86批：菜单式资产供给（替代资料策划的语义检索召回）。
 * 系统按层确定性过滤三库资产，成员在单次调用内从本层菜单自选；
 * 资产只是参考，成员可组合、忽略或完全原创（candidateOnly 原则不变）。
 *
 * 供给规则（工单 3.3 定稿，每层含章/事件层都供给完整菜单）：
 * - 主节奏框架提名卡组：macro-framework 组且本层可用，每层供给；
 *   全书两层（book_backbone/volume_distribution）另加 book-topology 形态组。
 * - 配方提名卡组：按本书题材确定性过滤，卷/链层供给。
 * - 模式名册：全部剧情模式只列名字、按 6 类节奏角色分组，链/章层供给。
 * - 方法名册：其余本层可用方法只列专业名、按 16 维度分组，每层供给。
 */

export interface AssetMenuCard {
  key: string;
  name: string;
  /** 完整提名卡文本：名字：分段节奏线。注意：防误读。 */
  text: string;
}

export interface AssetMenuRosterGroup {
  key: string;
  label: string;
  names: readonly string[];
}

export interface V7LayerAssetMenu {
  schema: 'v7-layer-asset-menu-v1';
  version: string;
  layer: PlanningLayerKey;
  genreFamilies: readonly GenreFamily[];
  macroFrameworkCards: readonly AssetMenuCard[];
  bookTopologyCards: readonly AssetMenuCard[];
  recipeCards: readonly AssetMenuCard[];
  patternRoster: readonly AssetMenuRosterGroup[];
  methodRoster: readonly AssetMenuRosterGroup[];
  /** 渲染后菜单总字符数，供资料包预算核算。 */
  estimatedChars: number;
}

/** 与 method-asset-profiles 的 layersForScopes 严格互逆：层 → 该层可见的叙事层级标签。 */
const LAYER_SCOPES: Readonly<Record<PlanningLayerKey, readonly NarrativeScope[]>> = Object.freeze({
  book_backbone: ['book'],
  volume_distribution: ['book', 'storyline'],
  volume: ['volume'],
  chain: ['event'],
  chapter_execution: ['chapter', 'scene']
});

const BOOK_LAYERS: readonly PlanningLayerKey[] = ['book_backbone', 'volume_distribution'];
const RECIPE_LAYERS: readonly PlanningLayerKey[] = ['volume', 'chain'];
const PATTERN_ROSTER_LAYERS: readonly PlanningLayerKey[] = ['chain', 'chapter_execution'];

const MACRO_FRAMEWORK_GROUP = 'macro-framework';
const BOOK_TOPOLOGY_GROUP = 'book-topology';

export function buildLayerAssetMenu(
  layer: PlanningLayerKey,
  genreFamilies: readonly GenreFamily[] = []
): V7LayerAssetMenu {
  const available = V7_NARRATIVE_METHODS.filter((method) => methodAvailableAtLayer(method, layer));
  const macroFrameworkCards = available
    .filter((method) => method.exclusiveGroup === MACRO_FRAMEWORK_GROUP)
    .map((method) => methodCard(method));
  const bookTopologyCards = BOOK_LAYERS.includes(layer)
    ? available.filter((method) => method.exclusiveGroup === BOOK_TOPOLOGY_GROUP).map((method) => methodCard(method))
    : [];
  const cardedKeys = new Set([...macroFrameworkCards, ...bookTopologyCards].map((cardItem) => cardItem.key));

  const recipeCards = RECIPE_LAYERS.includes(layer)
    ? V7_PLOT_RECIPES.filter((recipe) => recipeFitsGenres(recipe, genreFamilies)).map((recipe) => recipeCard(recipe))
    : [];

  const patternRoster = PATTERN_ROSTER_LAYERS.includes(layer) ? buildPatternRoster(genreFamilies) : [];
  const methodRoster = buildMethodRoster(available.filter((method) => !cardedKeys.has(method.key)));

  const menu: V7LayerAssetMenu = {
    schema: 'v7-layer-asset-menu-v1',
    version: V7_LAYER_ASSET_MENU_VERSION,
    layer,
    genreFamilies: [...genreFamilies],
    macroFrameworkCards,
    bookTopologyCards,
    recipeCards,
    patternRoster,
    methodRoster,
    estimatedChars: 0
  };
  menu.estimatedChars = renderLayerAssetMenuText(menu).length;
  return menu;
}

export type LayerAssetType = 'narrative_method' | 'plot_recipe' | 'plot_pattern';

/** 引用校验用的扁平资产条目：key + 类型 + 可用规划层。 */
export interface LayerAssetEntry {
  assetType: LayerAssetType;
  key: string;
  title: string;
  planningLayers: readonly PlanningLayerKey[];
}

/** 本层菜单内全部可引用资产（引用校验按名册判定用：存在、本层已标注、类型归一）。 */
export function layerAssetEntries(
  layer: PlanningLayerKey,
  genreFamilies: readonly GenreFamily[] = []
): LayerAssetEntry[] {
  const entries: LayerAssetEntry[] = [];
  for (const method of V7_NARRATIVE_METHODS) {
    if (!methodAvailableAtLayer(method, layer)) continue;
    const profile = getMethodExecutionProfile(method.key);
    entries.push({
      assetType: 'narrative_method',
      key: method.key,
      title: method.professionalName,
      planningLayers: profile?.planningLayers ?? [layer]
    });
  }
  if (RECIPE_LAYERS.includes(layer)) {
    for (const recipe of V7_PLOT_RECIPES) {
      if (!recipeFitsGenres(recipe, genreFamilies)) continue;
      entries.push({ assetType: 'plot_recipe', key: recipe.key, title: recipe.publicTitle, planningLayers: [...RECIPE_LAYERS] });
    }
  }
  if (PATTERN_ROSTER_LAYERS.includes(layer)) {
    for (const pattern of V7_PLOT_PATTERNS) {
      entries.push({ assetType: 'plot_pattern', key: pattern.key, title: pattern.professionalName, planningLayers: [...PATTERN_ROSTER_LAYERS] });
    }
  }
  return entries;
}

/** 本层菜单内全部可引用资产 key。 */
export function layerAssetKeySet(
  layer: PlanningLayerKey,
  genreFamilies: readonly GenreFamily[] = []
): Set<string> {
  return new Set(layerAssetEntries(layer, genreFamilies).map((entry) => entry.key));
}

/** 存入规划运行档案的菜单快照（确定性重建，不含模型输出）。 */
export interface StoredLayerAssetMenu {
  schema: 'v7-layer-asset-menu-v1';
  layer: PlanningLayerKey;
  genreFamilies: readonly GenreFamily[];
  menuText: string;
  allowedKeys: readonly string[];
}

export function buildStoredLayerAssetMenu(
  layer: PlanningLayerKey,
  genreFamilies: readonly GenreFamily[] = []
): StoredLayerAssetMenu {
  const menu = buildLayerAssetMenu(layer, genreFamilies);
  return {
    schema: 'v7-layer-asset-menu-v1',
    layer,
    genreFamilies: [...genreFamilies],
    menuText: renderLayerAssetMenuText(menu),
    allowedKeys: [...layerAssetKeySet(layer, genreFamilies)]
  };
}

export function parseStoredLayerAssetMenu(raw: string): StoredLayerAssetMenu {
  const value = JSON.parse(raw) as Partial<StoredLayerAssetMenu>;
  if (value?.schema !== 'v7-layer-asset-menu-v1'
    || typeof value.layer !== 'string'
    || typeof value.menuText !== 'string'
    || !Array.isArray(value.allowedKeys)) {
    throw new Error('资产菜单快照格式不完整');
  }
  return value as StoredLayerAssetMenu;
}

/** 渲染为注入任务输入的菜单文本（确定性，无模型调用）。 */
export function renderLayerAssetMenuText(menu: V7LayerAssetMenu): string {
  const sections: string[] = [];
  const cardSection = (title: string, cards: readonly AssetMenuCard[]): void => {
    if (cards.length === 0) return;
    sections.push(`【${title}】（候选参考，可组合、改写或完全不用）\n${cards.map((cardItem) => `- ${cardItem.text}`).join('\n')}`);
  };
  cardSection('主节奏框架提名卡', menu.macroFrameworkCards);
  cardSection('全书形态提名卡', menu.bookTopologyCards);
  cardSection('剧情配方提名卡', menu.recipeCards);
  if (menu.patternRoster.length > 0) {
    sections.push(`【剧情模式名册】（按节奏角色分组，只列名字；可自取也可完全自创）\n${menu.patternRoster.map((group) => `- ${group.label}：${group.names.join('、')}`).join('\n')}`);
  }
  if (menu.methodRoster.length > 0) {
    sections.push(`【叙事方法名册】（按维度分组，只列名字；资产只是参考，不限制原创）\n${menu.methodRoster.map((group) => `- ${group.label}：${group.names.join('、')}`).join('\n')}`);
  }
  return sections.join('\n\n');
}

export function validateLayerAssetMenus(): string[] {
  const errors: string[] = [];
  const layers = Object.keys(LAYER_SCOPES) as PlanningLayerKey[];
  for (const layer of layers) {
    const menu = buildLayerAssetMenu(layer);
    if (menu.macroFrameworkCards.length === 0) errors.push(`${layer} 层缺少主节奏框架提名卡`);
    for (const cardItem of [...menu.macroFrameworkCards, ...menu.bookTopologyCards, ...menu.recipeCards]) {
      if (cardItem.text.length > 100) errors.push(`${layer} 层提名卡超 100 字：${cardItem.key}`);
    }
    // 菜单完整性：本层每个可用方法必须恰好在提名卡组或名册出现一次。
    const available = V7_NARRATIVE_METHODS.filter((method) => methodAvailableAtLayer(method, layer));
    const carded = new Set([...menu.macroFrameworkCards, ...menu.bookTopologyCards].map((cardItem) => cardItem.key));
    const rosterNames = new Set(menu.methodRoster.flatMap((group) => group.names));
    for (const method of available) {
      if (!carded.has(method.key) && !rosterNames.has(method.professionalName)) {
        errors.push(`${layer} 层菜单遗漏方法：${method.key}`);
      }
    }
  }
  // 自相似防断链：章层必须保有足够宏观框架候选（第86批补标后的回归闸）。
  const chapterMenu = buildLayerAssetMenu('chapter_execution');
  if (chapterMenu.macroFrameworkCards.length < 3) {
    errors.push(`章层宏观框架候选不足（${chapterMenu.macroFrameworkCards.length} 条），自相似链条断裂`);
  }
  // 全书两层必须拿到完整形态组。
  for (const layer of BOOK_LAYERS) {
    const menu = buildLayerAssetMenu(layer);
    if (menu.bookTopologyCards.length === 0) errors.push(`${layer} 层缺少全书形态提名卡`);
  }
  // 卷/链层配方：无题材过滤时必须全量供给。
  for (const layer of RECIPE_LAYERS) {
    const menu = buildLayerAssetMenu(layer);
    if (menu.recipeCards.length !== V7_PLOT_RECIPES.length) {
      errors.push(`${layer} 层无题材过滤时配方应为 ${V7_PLOT_RECIPES.length} 条，实际 ${menu.recipeCards.length} 条`);
    }
  }
  // 链/章层模式名册：6 类节奏角色齐全且总数等于模式库总量。
  for (const layer of PATTERN_ROSTER_LAYERS) {
    const menu = buildLayerAssetMenu(layer);
    if (menu.patternRoster.length !== PLOT_PATTERN_CATEGORY_DEFINITIONS.length) {
      errors.push(`${layer} 层模式名册分组数不对：${menu.patternRoster.length}`);
    }
    const total = menu.patternRoster.reduce((sum, group) => sum + group.names.length, 0);
    if (total !== V7_PLOT_PATTERNS.length) {
      errors.push(`${layer} 层模式名册总数 ${total} 与模式库 ${V7_PLOT_PATTERNS.length} 不一致`);
    }
  }
  return errors;
}

function methodAvailableAtLayer(method: NarrativeMethodDefinition, layer: PlanningLayerKey): boolean {
  const scopes = LAYER_SCOPES[layer];
  return method.applicableScopes.some((scope) => scopes.includes(scope));
}

function methodCard(method: NarrativeMethodDefinition): AssetMenuCard {
  const nomination = getMethodNominationCard(method.key);
  if (nomination === null) throw new Error(`方法 ${method.key} 属于配卡组但缺少提名卡`);
  return { key: method.key, name: method.professionalName, text: nominationCardText(method.professionalName, nomination) };
}

function recipeCard(recipe: PlotRecipeDefinition): AssetMenuCard {
  const nomination = getRecipeNominationCard(recipe.key);
  if (nomination === null) throw new Error(`配方 ${recipe.key} 缺少提名卡`);
  return { key: recipe.key, name: recipe.publicTitle, text: nominationCardText(recipe.publicTitle, nomination) };
}

function recipeFitsGenres(recipe: PlotRecipeDefinition, genreFamilies: readonly GenreFamily[]): boolean {
  if (genreFamilies.length === 0 || recipe.commonGenreFamilies.length === 0) return true;
  return recipe.commonGenreFamilies.some((family) => genreFamilies.includes(family));
}

function buildPatternRoster(genreFamilies: readonly GenreFamily[]): AssetMenuRosterGroup[] {
  return PLOT_PATTERN_CATEGORY_DEFINITIONS.map((category) => {
    const patterns = V7_PLOT_PATTERNS
      .filter((pattern) => pattern.category === category.key)
      .sort((left, right) => patternGenreFit(right, genreFamilies) - patternGenreFit(left, genreFamilies)
        || left.key.localeCompare(right.key));
    return { key: category.key, label: category.publicName, names: patterns.map((pattern) => pattern.professionalName) };
  });
}

function patternGenreFit(pattern: PlotPatternDefinition, genreFamilies: readonly GenreFamily[]): number {
  if (genreFamilies.length === 0 || pattern.commonGenreFamilies.length === 0) return 0;
  return pattern.commonGenreFamilies.some((family) => genreFamilies.includes(family)) ? 1 : 0;
}

function buildMethodRoster(methods: readonly NarrativeMethodDefinition[]): AssetMenuRosterGroup[] {
  const groups: AssetMenuRosterGroup[] = [];
  for (const dimension of NARRATIVE_DIMENSIONS) {
    const names = methods
      .filter((method) => method.dimension === dimension.key)
      .map((method) => method.professionalName);
    if (names.length > 0) groups.push({ key: dimension.key, label: dimension.internalLabel, names });
  }
  return groups;
}
