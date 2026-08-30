import { describe, expect, test } from 'vitest';
import {
  buildCrossVolumeExperienceCurve,
  buildHistoricalHegemonyPlanningDemo,
  compileLayeredPlanningTask,
  validateLayeredPlanningRecipe
} from './layered-planning-engine.js';
import {
  PLANNING_LAYERS,
  V7_METHOD_EXECUTION_PROFILES,
  validateMethodExecutionProfiles
} from './method-asset-profiles.js';

describe('V7 分层规划领域能力', () => {
  test('146 个叙事方法都有可调用执行档案且保留创意许可', () => {
    expect(V7_METHOD_EXECUTION_PROFILES).toHaveLength(146);
    expect(validateMethodExecutionProfiles()).toEqual([]);
    expect(V7_METHOD_EXECUTION_PROFILES.every((profile) => profile.planningLayers.length > 0)).toBe(true);
    expect(V7_METHOD_EXECUTION_PROFILES.every((profile) => profile.creativityPolicy.some((item) => item.includes('软性创作参考')))).toBe(true);
  });

  test('规划器固定五层责任但不固定具体故事', () => {
    expect(PLANNING_LAYERS.map((item) => item.key)).toEqual([
      'book_backbone',
      'volume_distribution',
      'volume',
      'chain',
      'chapter_execution'
    ]);
    expect(PLANNING_LAYERS.every((item) => item.outputChecklist.length > 0 && item.defers.length > 0)).toBe(true);
  });

  test('300 万字历史争霸示范通过结构与篇幅校验', () => {
    const demo = buildHistoricalHegemonyPlanningDemo();
    const distribution = demo.recipe.root.children[0];
    expect(validateLayeredPlanningRecipe(demo.recipe)).toEqual([]);
    expect(demo.recipe.status).toBe('example');
    expect(distribution?.children).toHaveLength(8);
    expect(distribution?.children.reduce((sum, node) => sum + (node.budget?.wordTarget ?? 0), 0)).toBe(3_000_000);
    expect(distribution?.children.slice(1).every((node) => node.status === 'outline' && node.children.length === 0)).toBe(true);
    expect(buildCrossVolumeExperienceCurve(demo.recipe)).toHaveLength(8);
    expect(buildCrossVolumeExperienceCurve(demo.recipe).map((item) => item.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(buildCrossVolumeExperienceCurve(demo.recipe).every((item) => item.publicSummary.length > 0 && item.designReason.length > 0)).toBe(true);
  });

  test('当前单元链任务把正式事实、目标、方法和开放创意分开', () => {
    const demo = buildHistoricalHegemonyPlanningDemo();
    const task = demo.currentTask;
    expect(task.mode).toBe('admin_example');
    expect(task.nodeId).toBe('chain-1');
    expect(task.mustHold.join(' ')).toContain('主角必须是张三');
    expect(task.mustHold.join(' ')).toContain('不使用系统和超凡力量');
    expect(task.currentObjectives.join(' ')).toContain('第一次可信结果');
    expect(task.methodHints.map((item) => item.title)).toEqual(expect.arrayContaining(['承诺—进展—兑现', '压力与回报循环']));
    expect(task.creativeSpace.join(' ')).toContain('如何与岳飞相遇');
    expect(task.sourceRefs).toHaveLength(demo.sources.length);
    expect(task.expectedOutput).toContain('读者期待');
    expect(task.expectedOutput).not.toContain('全书进入状态');
    expect(task.expectedOutput).not.toContain('卷序与篇幅建议');
    expect(task.experienceTargets.map((item) => item.layer)).toEqual(['book_backbone', 'volume_distribution', 'volume', 'chain']);
    expect(JSON.stringify(task.experienceTargets)).not.toContain('第二卷');
  });

  test('每层体验字段必须完整，但系统不判断文学风格是否优秀', () => {
    const demo = buildHistoricalHegemonyPlanningDemo();
    const invalid = structuredClone(demo.recipe);
    invalid.root.readerExperience.payoffCadence = '';
    expect(validateLayeredPlanningRecipe(invalid)).toContain('book 的读者体验字段 payoffCadence 为空');
  });

  test('临时创新方法可以只用于当前作品，不需要先污染公共方法库', () => {
    const demo = buildHistoricalHegemonyPlanningDemo();
    const distribution = demo.recipe.root.children[0];
    expect(distribution?.methodGuidance[0]).toMatchObject({
      source: 'custom',
      customTitle: '多卷递进分配',
      strength: 'soft'
    });
  });

  test('编译不存在节点时明确失败', () => {
    const demo = buildHistoricalHegemonyPlanningDemo();
    expect(() => compileLayeredPlanningTask({ recipe: demo.recipe, nodeId: 'missing', sources: demo.sources })).toThrow('规划节点不存在');
  });
});
