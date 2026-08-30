import { describe, expect, test } from 'vitest';
import {
  ASSET_SUMMARY,
  PLANNING_DEMO,
  PLANNING_EXPERIENCE_CURVE,
  PLANNING_LAYERS,
  filterMethods,
  filterPatterns,
  filterRecipes,
  getCategoryLabel,
  getDimensionLabel,
  getGenreLabel
} from './asset-view-model.js';

describe('V7 创作资产管理台视图模型', () => {
  test('管理台统计来自真实 V7 注册表', () => {
    expect(ASSET_SUMMARY.methods.totalMethods).toBe(146);
    expect(ASSET_SUMMARY.patterns.totalPatterns).toBe(156);
    expect(ASSET_SUMMARY.recipes.totalRecipes).toBe(36);
    expect(ASSET_SUMMARY.planning.totalLayers).toBe(5);
    expect(ASSET_SUMMARY.planning.totalMethodProfiles).toBe(146);
  });

  test('叙事方法可按维度、层级和中文说明搜索', () => {
    const all = filterMethods({ query: '', dimension: 'all', scope: 'all' });
    const causal = filterMethods({ query: '', dimension: 'causal_dynamics', scope: 'all' });
    const scene = filterMethods({ query: '', dimension: 'all', scope: 'scene' });
    const search = filterMethods({ query: '因果', dimension: 'all', scope: 'all' });
    expect(all).toHaveLength(146);
    expect(causal.length).toBeGreaterThan(0);
    expect(causal.every((item) => item.dimension === 'causal_dynamics')).toBe(true);
    expect(scene.length).toBeGreaterThan(0);
    expect(scene.every((item) => item.applicableScopes.includes('scene'))).toBe(true);
    expect(search.some((item) => item.key === 'causal-chain')).toBe(true);
  });

  test('剧情模式按职责和题材筛选时保留跨题材通用项', () => {
    const all = filterPatterns({ query: '', category: 'all', genre: 'all' });
    const containers = filterPatterns({ query: '', category: 'container', genre: 'all' });
    const historicalMystery = filterPatterns({ query: '查案', category: 'all', genre: 'historical' });
    expect(all).toHaveLength(156);
    expect(containers).toHaveLength(48);
    expect(containers.every((item) => item.category === 'container')).toBe(true);
    expect(historicalMystery.some((item) => item.key === 'investigation-case')).toBe(true);
  });

  test('剧情配方可检索且每套显示五个标准阶段', () => {
    const all = filterRecipes({ query: '', genre: 'all' });
    const mystery = filterRecipes({ query: '查案', genre: 'mystery_detective' });
    expect(all).toHaveLength(36);
    expect(all.every((item) => item.stages.length === 5)).toBe(true);
    expect(mystery.some((item) => item.key === 'fair-case-investigation')).toBe(true);
  });

  test('管理台对内部枚举提供中文标签', () => {
    expect(getDimensionLabel('causal_dynamics')).toBe('因果结构');
    expect(getCategoryLabel('strategy')).toBe('主角策略');
    expect(getGenreLabel('alternate_history')).toBe('历史穿越与架空');
  });

  test('管理台示范来自后端规划器而不是页面硬编码', () => {
    expect(PLANNING_LAYERS).toHaveLength(5);
    expect(PLANNING_DEMO.recipe.status).toBe('example');
    expect(PLANNING_DEMO.notice).toContain('未调用模型');
    expect(PLANNING_DEMO.currentTask.mode).toBe('admin_example');
    expect(PLANNING_DEMO.currentTask.mustHold.join(' ')).toContain('张三');
    expect(PLANNING_EXPERIENCE_CURVE).toHaveLength(8);
    expect(PLANNING_EXPERIENCE_CURVE[5]?.contrastWithPrevious).toContain('落差');
  });
});
