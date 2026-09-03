import { describe, expect, it } from 'vitest';
import {
  PLOT_PATTERN_CATEGORY_DEFINITIONS,
  V7_PLOT_PATTERNS
} from '../plot-patterns/plot-pattern-library.js';
import { V7_PLOT_RECIPES } from '../plot-patterns/plot-recipe-library.js';
import {
  buildLayerAssetMenu,
  buildStoredLayerAssetMenu,
  layerAssetEntries,
  layerAssetKeySet,
  parseStoredLayerAssetMenu,
  renderLayerAssetMenuText,
  validateLayerAssetMenus
} from './layer-asset-menu.js';

describe('V7层资产菜单', () => {
  it('全部层的菜单完整性校验通过', () => {
    expect(validateLayerAssetMenus()).toEqual([]);
  });

  it('每层供给规则：全书两层有形态卡，卷/链有配方卡，链/章有模式名册', () => {
    const book = buildLayerAssetMenu('book_backbone');
    expect(book.macroFrameworkCards.length).toBeGreaterThanOrEqual(3);
    expect(book.bookTopologyCards.length).toBeGreaterThan(0);
    expect(book.recipeCards).toHaveLength(0);
    expect(book.patternRoster).toHaveLength(0);
    expect(book.methodRoster.length).toBeGreaterThan(0);

    const volume = buildLayerAssetMenu('volume');
    expect(volume.bookTopologyCards).toHaveLength(0);
    expect(volume.recipeCards).toHaveLength(V7_PLOT_RECIPES.length);
    expect(volume.patternRoster).toHaveLength(0);

    const chain = buildLayerAssetMenu('chain');
    expect(chain.recipeCards).toHaveLength(V7_PLOT_RECIPES.length);
    expect(chain.patternRoster).toHaveLength(PLOT_PATTERN_CATEGORY_DEFINITIONS.length);
    expect(chain.patternRoster.reduce((sum, group) => sum + group.names.length, 0)).toBe(V7_PLOT_PATTERNS.length);

    const chapter = buildLayerAssetMenu('chapter_execution');
    expect(chapter.macroFrameworkCards.length).toBeGreaterThanOrEqual(3);
    expect(chapter.recipeCards).toHaveLength(0);
    expect(chapter.patternRoster).toHaveLength(PLOT_PATTERN_CATEGORY_DEFINITIONS.length);
  });

  it('全书形态提名卡只在全书两层供给', () => {
    expect(buildLayerAssetMenu('volume_distribution').bookTopologyCards.length).toBeGreaterThan(0);
    expect(buildLayerAssetMenu('volume').bookTopologyCards).toHaveLength(0);
    expect(buildLayerAssetMenu('chain').bookTopologyCards).toHaveLength(0);
    expect(buildLayerAssetMenu('chapter_execution').bookTopologyCards).toHaveLength(0);
  });

  it('题材过滤只影响配方卡组：过滤后剩下通用配方或该题材配方', () => {
    const all = buildLayerAssetMenu('volume');
    const filtered = buildLayerAssetMenu('volume', ['eastern_fantasy']);
    expect(filtered.recipeCards.length).toBeLessThan(all.recipeCards.length);
    const recipesByKey = new Map(V7_PLOT_RECIPES.map((recipe) => [recipe.key, recipe]));
    for (const card of filtered.recipeCards) {
      const recipe = recipesByKey.get(card.key);
      expect(recipe).toBeDefined();
      expect(
        recipe!.commonGenreFamilies.length === 0 || recipe!.commonGenreFamilies.includes('eastern_fantasy')
      ).toBe(true);
    }
  });

  it('菜单内卡组与名册各自不重复', () => {
    for (const layer of ['book_backbone', 'volume_distribution', 'volume', 'chain', 'chapter_execution'] as const) {
      const menu = buildLayerAssetMenu(layer);
      const cardKeys = [...menu.macroFrameworkCards, ...menu.bookTopologyCards, ...menu.recipeCards]
        .map((card) => card.key);
      expect(new Set(cardKeys).size).toBe(cardKeys.length);
      const rosterNames = [...menu.methodRoster, ...menu.patternRoster].flatMap((group) => group.names);
      expect(new Set(rosterNames).size).toBe(rosterNames.length);
    }
  });

  it('引用名册：条目带类型与本层标注，key 集合唯一且与条目数一致', () => {
    const chainEntries = layerAssetEntries('chain');
    const keys = chainEntries.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(chainEntries.some((entry) => entry.assetType === 'narrative_method')).toBe(true);
    expect(chainEntries.some((entry) => entry.assetType === 'plot_recipe')).toBe(true);
    expect(chainEntries.some((entry) => entry.assetType === 'plot_pattern')).toBe(true);
    for (const entry of chainEntries.filter((item) => item.assetType !== 'narrative_method')) {
      expect(entry.planningLayers).toContain('chain');
    }
    expect(layerAssetKeySet('chain').size).toBe(chainEntries.length);
    expect(layerAssetKeySet('book_backbone').size).toBe(layerAssetEntries('book_backbone').length);
  });

  it('菜单文本渲染包含分组标题，存档菜单可无损往返', () => {
    const menu = buildLayerAssetMenu('chain');
    const text = renderLayerAssetMenuText(menu);
    expect(text).toContain('【主节奏框架提名卡】');
    expect(text).toContain('【剧情配方提名卡】');
    expect(text).toContain('【剧情模式名册】');
    expect(text).toContain('【叙事方法名册】');
    expect(menu.estimatedChars).toBe(text.length);

    const stored = buildStoredLayerAssetMenu('volume', []);
    expect(parseStoredLayerAssetMenu(JSON.stringify(stored))).toEqual(stored);
    expect(stored.allowedKeys.length).toBeGreaterThan(0);
    expect(() => parseStoredLayerAssetMenu('{"schema":"old"}')).toThrow('资产菜单快照格式不完整');
  });
});
