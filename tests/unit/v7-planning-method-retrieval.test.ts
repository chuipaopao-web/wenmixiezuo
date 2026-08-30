import { describe, expect, it } from 'vitest';
import {
  extractPlanningCriticalInputs,
  parsePlanningMethodSearchRequest,
  planningMethodSearchPrompt,
  retrievePlanningMethodCandidates
} from '../../coauthoring-v7/backend/planning-methods/planning-method-retrieval.js';
import {
  V7_PLANNING_MEMBERS,
  buildPlanningFallbackChain,
  validatePlanningEditorialRoster
} from '../../coauthoring-v7/backend/planning-methods/planning-editorial-runtime.js';
import { V7_NARRATIVE_METHODS } from '../../coauthoring-v7/backend/narrative-methods/narrative-method-library.js';

describe('V7规划方法最小检索', () => {
  it('同一轮默认方法检查和路线设计不会重复安排同一成员', () => {
    expect(validatePlanningEditorialRoster()).toEqual([]);
    expect(new Set(V7_PLANNING_MEMBERS.map((member) => member.memberKey)).size).toBe(V7_PLANNING_MEMBERS.length);
    expect(V7_PLANNING_MEMBERS.some((member) => (member.roleKey as string) === 'structure_deputy'
      || (member.roleKey as string) === 'commercial_deputy')).toBe(false);
    expect(new Set(V7_PLANNING_MEMBERS.map((member) => member.roleKey))).toEqual(new Set([
      'chief_editor', 'planning_writer', 'continuity_editor'
    ]));
    const methodMembers = (['chief_editor', 'structure_deputy', 'commercial_deputy'] as const)
      .map((seat) => buildPlanningFallbackChain(seat)[0]!);
    expect(methodMembers.every((member) => member.roleKey === 'chief_editor')).toBe(true);
    expect(buildPlanningFallbackChain('continuity_editor').every(
      (member) => member.roleKey === 'continuity_editor'
    )).toBe(true);
    const writers = V7_PLANNING_MEMBERS.filter((member) => member.enabledByDefault && member.roleKey === 'planning_writer')
      .toSorted((left, right) => left.fallbackPriority - right.fallbackPriority).slice(0, 3);
    const assignedNames = [...methodMembers, ...writers].map((member) => member.displayName);
    expect(new Set(assignedNames).size).toBe(assignedNames.length);
  });

  it('搜索提示只给层级和维度，不把完整方法目录注入成员上下文', () => {
    const prompt = planningMethodSearchPrompt({
      seatName: '全案主编二席',
      seatResponsibility: '检查长篇容量和跨卷递进',
      independentFocus: ['跨卷职责', '中段避免重复'],
      sourceSnapshot: { book: { title: '北宋小卒' }, hardRules: ['主角必须是张三'] }
    });

    expect(prompt).toContain('可检索的层级和维度');
    expect(prompt).toContain('正式资料快照');
    expect(prompt).not.toContain('三幕式结构');
    expect(prompt).not.toContain('拯救猫咪节拍表');
    expect(prompt).not.toContain('特鲁比22步');
    expect(prompt.length).toBeLessThan(12_000);
  });

  it('系统只召回少量候选，最终选择仍留给成员', () => {
    const request = parsePlanningMethodSearchRequest(JSON.stringify({
      schema: 'v7-planning-method-search-v1',
      publicGoal: '为三百万字历史争霸长篇寻找可持续的跨卷推进方式。',
      searchQueries: ['长篇跨卷递进', '历史争霸因果升级', '阶段回报避免拖沓'],
      planningLayers: ['book_backbone', 'volume_distribution'],
      dimensions: ['macro_architecture', 'causal_dynamics', 'serial_rhythm'],
      desiredCount: 12,
      scaleHint: '三百万字，约八卷。',
      avoidNotes: ['不使用系统或超凡力量'],
      relevantSettingSourceIds: ['setting-world-stage'],
      missingCriticalInputs: []
    }));
    const result = retrievePlanningMethodCandidates(request);

    expect(result.candidates).toHaveLength(12);
    expect(result.candidates.length).toBeLessThan(V7_NARRATIVE_METHODS.length);
    expect(new Set(result.candidates.map((candidate) => candidate.methodKey)).size).toBe(12);
    expect(result.candidates.every((candidate) => candidate.planningLayers.some(
      (layer) => request.planningLayers.includes(layer)
    ))).toBe(true);
    expect(result.candidates.every((candidate) => candidate.recommendedScale.length > 0)).toBe(true);
  });

  it('重复层级或维度不能冒充满足最小数量', () => {
    expect(() => parsePlanningMethodSearchRequest(JSON.stringify({
      schema: 'v7-planning-method-search-v1', publicGoal: '测试', searchQueries: ['长篇递进', '因果推进'],
      planningLayers: ['book_backbone'], dimensions: ['macro_architecture', 'macro_architecture'],
      desiredCount: 8, scaleHint: '长篇', avoidNotes: [],
      relevantSettingSourceIds: ['setting-world-stage'], missingCriticalInputs: []
    }))).toThrow(/方法维度数量无效/u);
  });

  it('主编用问题、影响和待确认内容说明资料冲突时仍能被正常暂停处理', () => {
    const request = parsePlanningMethodSearchRequest(JSON.stringify({
      schema: 'v7-planning-method-search-v1', publicGoal: '检查全书规划资料。',
      searchQueries: ['长篇规划资料一致性', '跨卷时间线'], planningLayers: ['book_backbone'],
      dimensions: ['macro_architecture', 'causal_dynamics'], desiredCount: 8,
      scaleHint: '一百二十万字', avoidNotes: [], relevantSettingSourceIds: ['setting-world-stage'],
      missingCriticalInputs: [{
        issue: '边城人口分别写成两万和四万。',
        impact: '会影响存粮、征兵和灾情规模。',
        needed: '请统一人口与驻军基准。'
      }]
    }));

    expect(request.missingCriticalInputs).toEqual([
      '边城人口分别写成两万和四万。；影响：会影响存粮、征兵和灾情规模。；需要确认：请统一人口与驻军基准。'
    ]);
  });

  it('资料冲突优先于非关键字段格式检查', () => {
    const issues = extractPlanningCriticalInputs(JSON.stringify({
      schema: 'v7-planning-method-search-v1',
      avoidNotes: '这里即使不是数组，也不能掩盖已经发现的资料冲突。',
      missingCriticalInputs: [{
        issue: '粮道里程存在两个版本。',
        impact: '会影响运粮和求援时间。',
        needed: '请统一里程与驿站数量。'
      }]
    }));

    expect(issues).toEqual([
      '粮道里程存在两个版本。；影响：会影响运粮和求援时间。；需要确认：请统一里程与驿站数量。'
    ]);
  });
});
