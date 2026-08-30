import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNarrativeLibrarySummary, getNarrativeMethod } from '../narrative-methods/narrative-method-library.js';
import {
  GENRE_FAMILY_KEYS,
  PLOT_PATTERN_CATEGORIES,
  V7_PLOT_PATTERNS,
  getPlotPatternLibrarySummary,
  listPlotPatterns,
  validatePlotPatternRegistry
} from './plot-pattern-library.js';
import {
  LEGACY_MIGRATED_TEMPLATE_KEYS,
  LEGACY_PLOT_RECIPE_MAP,
  V7_PLOT_RECIPES,
  validatePlotRecipeRegistry
} from './plot-recipe-library.js';
import { buildPlotPatternAIPack, recommendPlotRecipes } from './plot-pattern-recommender.js';

const historicalMysteryRequest = {
  taskId: 'plot-test-001',
  scope: 'volume' as const,
  genreFamilies: ['alternate_history', 'mystery_detective'] as const,
  currentGoal: '张三穿越三国后调查军粮失踪案，并借此在军中站稳脚跟',
  authorIdeas: '希望有公平线索、身份压力和一次公开证明，不要只靠武力。',
  confirmedActualSummary: '张三已经以流民身份被征入先锋营，尚未获得军职。',
  signals: ['三国', '查案', '军中', '成长'],
  preferredRecipeKey: 'fair-case-investigation',
  preferredPatternKeys: ['investigation-case', 'public-demonstration']
};

test('基础剧情模式注册表完整、唯一并覆盖六类职责', () => {
  assert.deepEqual(validatePlotPatternRegistry(), []);
  const summary = getPlotPatternLibrarySummary();
  assert.equal(summary.totalPatterns, 156);
  assert.deepEqual(summary.categoryCounts, {
    container: 48,
    strategy: 24,
    pressure: 24,
    turn: 20,
    payoff: 24,
    bridge: 16
  });
  for (const category of PLOT_PATTERN_CATEGORIES) assert.ok(summary.categoryCounts[category] > 0);
  for (const genre of GENRE_FAMILY_KEYS) assert.ok(summary.genreCoverage[genre] >= 70, `${genre} 覆盖不足`);
});

test('题材只改变排序，不阻断跨题材剧情模式', () => {
  const historical = listPlotPatterns({ genreFamily: 'alternate_history' });
  assert.equal(historical.length, V7_PLOT_PATTERNS.length);
  assert.ok(historical.some((item) => item.key === 'investigation-case'));
  assert.ok(historical.some((item) => item.key === 'science-discovery-cycle') === false);
  assert.equal(listPlotPatterns({ genreFamily: 'modern_romance', query: '副本' })[0]?.key, 'dungeon-expedition');
});

test('跨单元配方完整迁移历史版本的 15 项有效责任且不复制结构模板', () => {
  assert.deepEqual(validatePlotRecipeRegistry(), []);
  assert.equal(V7_PLOT_RECIPES.length, 36);
  assert.equal(Object.keys(LEGACY_PLOT_RECIPE_MAP).length, 15);
  for (const key of LEGACY_MIGRATED_TEMPLATE_KEYS) assert.ok(LEGACY_PLOT_RECIPE_MAP[key], `${key} 未迁移`);
  assert.ok(!V7_PLOT_RECIPES.some((item) => ['three-act', 'five-act', 'save-the-cat'].includes(item.key)));
});

test('所有模式和配方引用的叙事方法都存在，现有方法库语义数量不变', () => {
  assert.equal(getNarrativeLibrarySummary().totalMethods, 146);
  for (const pattern of V7_PLOT_PATTERNS) {
    for (const key of pattern.narrativeMethodKeys) assert.ok(getNarrativeMethod(key), `${pattern.key}/${key}`);
  }
  for (const recipe of V7_PLOT_RECIPES) {
    for (const key of recipe.narrativeMethodKeys) assert.ok(getNarrativeMethod(key), `${recipe.key}/${key}`);
  }
});

test('推荐候选可供作者选择并保持确定性', () => {
  const { preferredRecipeKey: _ignoredRecipeKey, ...autoRequest } = historicalMysteryRequest;
  const first = recommendPlotRecipes(autoRequest, 3);
  const second = recommendPlotRecipes(autoRequest, 3);
  assert.deepEqual(first, second);
  assert.equal(first.length, 3);
  assert.equal(first[0]?.recipeKey, 'fair-case-investigation');
  for (const item of first) {
    assert.ok(item.publicTitle.length > 0);
    assert.ok(item.reason.length > 0);
    assert.deepEqual(item.selectableUnitRange, [3, 7]);
  }
});

test('全部题材家族都能生成候选与标准五单元资料包', () => {
  for (const genre of GENRE_FAMILY_KEYS) {
    const request = {
      taskId: `genre-${genre}`,
      scope: 'volume' as const,
      genreFamilies: [genre],
      currentGoal: `围绕当前人物完成一段有冲突、有变化、有结果的${genre}剧情`,
      signals: [genre]
    };
    const choices = recommendPlotRecipes(request, 3);
    assert.equal(choices.length, 3, `${genre} 无足量候选`);
    const pack = buildPlotPatternAIPack({ ...request, preferredRecipeKey: choices[0]!.recipeKey });
    assert.equal(pack.unitCount, 5, `${genre} 标准单元数错误`);
    assert.ok(pack.internalReferences.patternKeys.length >= 5, `${genre} 资料包不足`);
  }
});

test('标准资料包默认五单元，支持三至七单元并保持因果接口', () => {
  const standard = buildPlotPatternAIPack(historicalMysteryRequest);
  const light = buildPlotPatternAIPack({ ...historicalMysteryRequest, requestedUnitCount: 3 });
  const complex = buildPlotPatternAIPack({ ...historicalMysteryRequest, requestedUnitCount: 7 });
  assert.equal(standard.unitCount, 5);
  assert.equal(light.unitCount, 3);
  assert.equal(complex.unitCount, 7);
  for (const pack of [standard, light, complex]) {
    assert.equal(pack.units.length, pack.unitCount);
    for (const [index, unit] of pack.units.entries()) {
      assert.equal(unit.order, index + 1);
      assert.ok(unit.responsibility.length > 0);
      assert.ok(unit.requiredChange.length > 0);
      assert.ok(unit.nextTrigger.length > 0);
      assert.ok(unit.internalPatternKeys.length >= 1 && unit.internalPatternKeys.length <= 3);
    }
  }
  assert.throws(() => buildPlotPatternAIPack({ ...historicalMysteryRequest, requestedUnitCount: 2 }), /3—7/);
  assert.throws(() => buildPlotPatternAIPack({ ...historicalMysteryRequest, requestedUnitCount: 8 }), /3—7/);
});

test('作者指定、排除和近期重复抑制均可执行', () => {
  const preferred = buildPlotPatternAIPack(historicalMysteryRequest);
  assert.ok(preferred.internalReferences.patternKeys.includes('investigation-case'));
  assert.ok(preferred.internalReferences.patternKeys.includes('public-demonstration'));
  const excluded = buildPlotPatternAIPack({
    ...historicalMysteryRequest,
    preferredPatternKeys: [],
    excludedPatternKeys: ['investigation-case']
  });
  assert.ok(!excluded.internalReferences.patternKeys.includes('investigation-case'));
  const recent = buildPlotPatternAIPack({
    ...historicalMysteryRequest,
    preferredPatternKeys: [],
    recentPatternKeys: ['investigation-case', 'evidence-sting', 'unreliable-intelligence', 'culprit-reversal', 'justice-enforced']
  });
  assert.ok(!recent.internalReferences.patternKeys.includes('investigation-case'));
  assert.throws(() => buildPlotPatternAIPack({
    ...historicalMysteryRequest,
    excludedPatternKeys: ['investigation-case']
  }), /同时指定和排除/);
});

test('AI 资料包只注入当前任务所需模式并严格区分规划与事实', () => {
  const pack = buildPlotPatternAIPack(historicalMysteryRequest);
  assert.ok(pack.internalReferences.patternKeys.length < 20);
  assert.ok(pack.generationPrompt.includes('已确认发生的前情事实'));
  assert.ok(pack.generationPrompt.includes('当前规划目标'));
  assert.ok(pack.generationPrompt.includes('不要把计划写成已经发生'));
  assert.ok(!pack.generationPrompt.includes('investigation-case'));
  assert.ok(!pack.generationPrompt.includes('fair-case-investigation'));
  assert.ok(!pack.generationPrompt.includes('professionalName'));
  assert.ok(!pack.generationPrompt.includes('时间循环困局'));
  assert.ok(pack.generationPrompt.length < 9_000);
});
