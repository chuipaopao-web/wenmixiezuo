import { describe, expect, it } from 'vitest';
import {
  V7_CREATION_CONTEXT_PLANNER_CHAR_BUDGETS,
  type V7CreationSourceCandidate,
  type V7CreationTaskKind
} from '@wenmi/v7-backend';
import {
  assertCreationContextPlannerInputBudget,
  boundProjectionTexts,
  compileCreationContextPlannerPrompt
} from '../../apps/api/src/application/creation/v7-creation-context-compiler.js';

describe('V7创作资料策划输入预算', () => {
  it.each(Object.entries(V7_CREATION_CONTEXT_PLANNER_CHAR_BUDGETS) as Array<[V7CreationTaskKind, number]>)(
    '%s在调用模型前按字符硬限阻断超大候选包',
    (taskKind, budgetChars) => {
      expect(assertCreationContextPlannerInputBudget(taskKind, '资'.repeat(budgetChars))).toBe(budgetChars);
      expect(() => assertCreationContextPlannerInputBudget(taskKind, '资'.repeat(budgetChars + 1)))
        .toThrow(`超过本步骤${budgetChars}字的安全范围`);
    }
  );

  it('大量人物和活跃线路使用逐项最小目录，仍保留全部真实来源键并落在单次调用硬限内', () => {
    const candidates = [
      requiredCandidate(),
      ...Array.from({ length: 18 }, (_, index) => characterCandidate(index)),
      ...Array.from({ length: 18 }, (_, index) => storyStateCandidate(index))
    ];
    const prompt = compileCreationContextPlannerPrompt({
      taskKind: 'outline',
      taskBrief: '设计下一章章纲并承接当前人物与线路。',
      candidates,
      maximumSources: 12
    });
    expect(Array.from(prompt).length).toBeLessThanOrEqual(V7_CREATION_CONTEXT_PLANNER_CHAR_BUDGETS.outline);
    const directory = JSON.parse(prompt.split('候选资料：').at(-1)!) as Array<{
      sourceKey: string;
      content: Record<string, unknown>;
    }>;
    expect(directory.map((item) => item.sourceKey)).toEqual(candidates.map((item) => item.sourceKey));
    expect(directory.find((item) => item.sourceKey === 'actual:character:profile-0')?.content)
      .toMatchObject({
        id: 'entity-0',
        name: '人物0',
        status: 'active_with_state'
      });
    expect(directory.find((item) => item.sourceKey === 'actual:story-state:state-0')?.content)
      .toMatchObject({
        kind: 'story_line',
        id: 'line-0',
        name: '线路0',
        status: 'active'
      });
    expect(prompt).not.toContain('不应进入资料策划目录的精确人物内容');
    expect(prompt).not.toContain('不应进入资料策划目录的精确线路证据');
  });

  it('必要正式源在第三层超限时降到第四层最小目录，仍成功编译且不泄漏精确内容', () => {
    const required = requiredCandidate();
    required.content = { ...(required.content as Record<string, unknown>), exact: '硬'.repeat(12_000) };
    const prompt = compileCreationContextPlannerPrompt({
      taskKind: 'outline',
      taskBrief: '承接当前正式规划。',
      candidates: [required, characterCandidate(0)],
      maximumSources: 12
    });
    expect(Array.from(prompt).length).toBeLessThanOrEqual(V7_CREATION_CONTEXT_PLANNER_CHAR_BUDGETS.outline);
    const directory = JSON.parse(prompt.split('候选资料：').at(-1)!) as Array<{
      sourceKey: string;
      required: boolean;
      content: Record<string, unknown>;
    }>;
    const requiredEntry = directory.find((item) => item.sourceKey === 'formal:tree:chain:current');
    expect(requiredEntry).toMatchObject({ required: true, content: { kind: 'planning_tree', name: '当前单元链' } });
    expect(prompt).not.toContain('硬'.repeat(50));
  });

  it('四层降级后仍超限时真实失败，不再要求作者缩小资料范围', () => {
    const candidates = Array.from({ length: 600 }, (_, index) => characterCandidate(index))
      .concat(Array.from({ length: 600 }, (_, index) => storyStateCandidate(index)));
    try {
      compileCreationContextPlannerPrompt({
        taskKind: 'outline',
        taskBrief: '承接当前正式规划。',
        candidates,
        maximumSources: 12
      });
      throw new Error('应当因超过预算而失败');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('超过本步骤12000字的安全范围');
      expect((error as Error).message).not.toContain('缩小');
      expect((error as Error).message).toContain('反馈');
    }
  });

  it('限长助手只封顶字符串字段并完整保留结构、条目与非字符串值', () => {
    const value = {
      a: '字'.repeat(300),
      b: ['短', '长'.repeat(260)],
      c: { d: [{ e: '好'.repeat(250) }] },
      n: 5,
      keep: null
    };
    const bounded = boundProjectionTexts(value, 200) as {
      a: string; b: string[]; c: { d: Array<{ e: string }> }; n: number; keep: null;
    };
    expect(Array.from(bounded.a)).toHaveLength(200);
    expect(bounded.a.endsWith('…')).toBe(true);
    expect(bounded.b[0]).toBe('短');
    expect(Array.from(bounded.b[1]!)).toHaveLength(200);
    expect(bounded.c.d[0]!.e.endsWith('…')).toBe(true);
    expect(bounded.n).toBe(5);
    expect(bounded.keep).toBeNull();
    expect(JSON.stringify(bounded).length).toBeLessThan(JSON.stringify(value).length);
  });
});

function requiredCandidate(): V7CreationSourceCandidate {
  return {
    sourceKey: 'formal:tree:chain:current',
    sourceKind: 'planning_tree',
    sourceId: 'tree-current',
    sourceVersion: '3',
    authority: 'formal',
    label: '当前单元链',
    content: { scopeId: 'current', title: '当前单元链', responsibility: '完成本链责任' },
    contentHash: 'tree-hash',
    required: true,
    includedReason: '当前章必须承接。'
  };
}

function characterCandidate(index: number): V7CreationSourceCandidate {
  return {
    sourceKey: `actual:character:profile-${index}`,
    sourceKind: 'character',
    sourceId: `profile-version-${index}`,
    sourceVersion: `2:${index}`,
    authority: 'actual',
    label: `当前人物：人物${index}`,
    content: {
      profileId: `profile-${index}`,
      entityId: `entity-${index}`,
      displayName: `人物${index}`,
      stableProfile: { privateDetail: '不应进入资料策划目录的精确人物内容'.repeat(100) },
      relationships: [],
      knowledge: []
    },
    selectionContent: {
      schema: 'v7-character-context-index-v2',
      profileId: `profile-${index}`,
      entityId: `entity-${index}`,
      displayName: `人物${index}`,
      narrativeTier: 'supporting',
      publicSummary: '会被确定性压缩的候选简介'.repeat(80),
      hasCurrentState: true
    },
    contentHash: `character-hash-${index}`,
    required: false,
    includedReason: '按任务需要选择。'
  };
}

function storyStateCandidate(index: number): V7CreationSourceCandidate {
  return {
    sourceKey: `actual:story-state:state-${index}`,
    sourceKind: 'story_state',
    sourceId: `line-${index}`,
    sourceVersion: '2',
    authority: 'actual',
    label: `当前故事线：线路${index}`,
    content: {
      kind: 'story_line',
      stableKey: `line-${index}`,
      title: `线路${index}`,
      state: 'active',
      evidenceRefs: ['不应进入资料策划目录的精确线路证据'.repeat(100)]
    },
    selectionContent: {
      schema: 'v7-story-state-context-index-v2',
      kind: 'story_line',
      stableKey: `line-${index}`,
      title: `线路${index}`,
      state: 'active',
      summary: '会被确定性压缩的线路简介'.repeat(80)
    },
    contentHash: `story-hash-${index}`,
    required: false,
    includedReason: '按任务需要选择。'
  };
}
