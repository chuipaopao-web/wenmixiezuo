import { describe, expect, it } from 'vitest';
import {
  V7_CREATION_CONTEXT_PLANNER_CHAR_BUDGETS,
  type V7CreationSourceCandidate,
  type V7CreationTaskKind
} from '@wenmi/v7-backend';
import {
  assertCreationContextPlannerInputBudget,
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

  it('必要正式源加最小目录仍超限时真实失败，不静默删除正式资料', () => {
    const required = requiredCandidate();
    required.content = { ...(required.content as Record<string, unknown>), exact: '硬'.repeat(12_000) };
    expect(() => compileCreationContextPlannerPrompt({
      taskKind: 'outline',
      taskBrief: '承接当前正式规划。',
      candidates: [required, characterCandidate(0)],
      maximumSources: 12
    })).toThrow('超过本步骤12000字的安全范围');
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
