import { describe, expect, it } from 'vitest';
import {
  extractPlanningCriticalInputs,
  parsePlanningMethodSearchRequest,
  planningMethodSearchPrompt
} from '../../coauthoring-v7/backend/planning-methods/planning-method-retrieval.js';
import {
  V7_PLANNING_MEMBERS,
  buildPlanningFallbackChain,
  validatePlanningEditorialRoster
} from '../../coauthoring-v7/backend/planning-methods/planning-editorial-runtime.js';

describe('V7规划资料策划合同', () => {
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

  it('搜索提示只签发事实筛选与任务身份，不把方法目录注入成员上下文', () => {
    const prompt = planningMethodSearchPrompt({
      seatName: '全案主编二席',
      seatResponsibility: '检查长篇容量和跨卷递进',
      independentFocus: ['跨卷职责', '中段避免重复'],
      sourceSnapshot: { book: { title: '北宋小卒' }, hardRules: ['主角必须是张三'] }
    });

    expect(prompt).toContain('只决定“本次设计需要哪些本书事实与设定”');
    expect(prompt).toContain('后台方法、配方和模式由系统按当前层确定性提供给设计成员');
    expect(prompt).toContain('正式资料快照');
    expect(prompt).not.toContain('三幕式结构');
    expect(prompt).not.toContain('拯救猫咪节拍表');
    expect(prompt).not.toContain('特鲁比22步');
    expect(prompt.length).toBeLessThan(12_000);
  });

  it('对上一版的方法检索意图字段容忍读取：老字段出现不报错也不进结果', () => {
    const request = parsePlanningMethodSearchRequest(JSON.stringify({
      schema: 'v7-planning-method-search-v1',
      publicGoal: '为三百万字历史争霸长篇寻找可持续的跨卷推进方式。',
      searchQueries: ['长篇跨卷递进', '历史争霸因果升级', '阶段回报避免拖沓'],
      planningLayers: ['book_backbone', 'volume_distribution'],
      dimensions: ['macro_architecture', 'causal_dynamics', 'serial_rhythm'],
      desiredCount: 6,
      scaleHint: '三百万字，约八卷。',
      avoidNotes: ['不使用系统或超凡力量'],
      relevantSettingSourceIds: ['setting-world-stage'],
      missingCriticalInputs: []
    }));

    expect(request.publicGoal).toBe('为三百万字历史争霸长篇寻找可持续的跨卷推进方式。');
    expect(request.relevantSettingSourceIds).toEqual(['setting-world-stage']);
    expect(request).not.toHaveProperty('searchQueries');
    expect(request).not.toHaveProperty('planningLayers');
    expect(request).not.toHaveProperty('dimensions');
    expect(request).not.toHaveProperty('desiredCount');
  });

  it('主编用问题、影响和待确认内容说明资料冲突时仍能被正常暂停处理', () => {
    const request = parsePlanningMethodSearchRequest(JSON.stringify({
      schema: 'v7-planning-method-search-v1', publicGoal: '检查全书规划资料。',
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
