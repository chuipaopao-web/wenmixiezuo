import { describe, expect, it } from 'vitest';
import {
  applyPlanningTreeOperations,
  buildAuthorPlanningTreeView,
  compilePlanningTreeGenerationTask,
  validatePlanningTree,
  type PlanningTreeDocument,
  type PlanningTreeNode
} from './index.js';

describe('V7三棵综合规划树领域合同', () => {
  it('接受全书、单卷和单元链三种完整树，并拒绝额外树层级', () => {
    expect(validatePlanningTree(bookTree())).toEqual([]);
    expect(validatePlanningTree(volumeTree())).toEqual([]);
    expect(validatePlanningTree(chainTree())).toEqual([]);

    const invalid = bookTree();
    invalid.root.children[0]!.kind = 'event';
    expect(validatePlanningTree(invalid)).toContain('book树不能包含event节点');
  });

  it('要求卷与链节点提供稳定下层树引用', () => {
    const invalidBook = bookTree();
    invalidBook.root.children[0]!.linkedTree = null;
    expect(validatePlanningTree(invalidBook)).toContain('卷节点volume-1缺少对应单卷树');

    const invalidVolume = volumeTree();
    invalidVolume.root.children[0]!.linkedTree = { treeKind: 'volume', scopeId: 'wrong' };
    expect(validatePlanningTree(invalidVolume)).toContain('链节点chain-1缺少对应单元链树');
  });

  it('在同一棵树内局部修改、增加、删除和重排并重新生成连续顺序', () => {
    const source = volumeTree();
    const extra = node('chain-2', 'chain', '第二链·军中立足', { treeKind: 'chain', scopeId: 'chain-2' });
    const added = applyPlanningTreeOperations(source, [
      { kind: 'update_node', nodeKey: 'chain-1', changes: { title: '第一链·乱世求生' } },
      { kind: 'add_child', parentKey: 'volume-1', position: 1, node: extra },
      { kind: 'reorder_children', parentKey: 'volume-1', orderedNodeKeys: ['chain-2', 'chain-1'] }
    ]);
    expect(added.root.children.map((item) => [item.key, item.sequence])).toEqual([['chain-2', 1], ['chain-1', 2]]);
    expect(added.root.children[1]!.title).toBe('第一链·乱世求生');
    expect(source.root.children).toHaveLength(1);

    const removed = applyPlanningTreeOperations(added, [{ kind: 'remove_node', nodeKey: 'chain-1' }]);
    expect(removed.root.children.map((item) => item.key)).toEqual(['chain-2']);
    expect(removed.root.children[0]!.sequence).toBe(1);
  });

  it('拒绝删除根节点、重复重排键和不完整节点', () => {
    expect(() => applyPlanningTreeOperations(volumeTree(), [{ kind: 'remove_node', nodeKey: 'volume-1' }]))
      .toThrow('不能删除规划树根节点');
    expect(() => applyPlanningTreeOperations(volumeTree(), [{
      kind: 'reorder_children', parentKey: 'volume-1', orderedNodeKeys: ['chain-1', 'chain-1']
    }])).toThrow('重排节点数量不一致');

    const invalid = chainTree();
    invalid.root.children[0]!.experience.publicSummary = '';
    expect(validatePlanningTree(invalid)).toContain('节点event-1缺少阅读体验publicSummary');

    const missing = chainTree() as unknown as { root: { children: Array<{ emotion: { intensity?: string } }> } };
    delete missing.root.children[0]!.emotion.intensity;
    expect(() => validatePlanningTree(missing as unknown as PlanningTreeDocument)).not.toThrow();
    expect(validatePlanningTree(missing as unknown as PlanningTreeDocument)).toContain('节点event-1缺少情绪强度');
  });

  it('公开投影把正文实际挂到同一节点，但不改写未来规划', () => {
    const document = chainTree();
    const before = structuredClone(document);
    const view = buildAuthorPlanningTreeView({
      document,
      revision: 4,
      status: 'confirmed',
      actuals: [{
        nodeKey: 'event-1',
        state: 'deviated',
        summary: '正文中张三没有直接告警，而是先救下同袍再取得证据。',
        emotionResult: '紧张之后获得一次短促释放。',
        experienceResult: '事件回报比计划稍晚，但因果更可信。',
        outcome: '张三获得小队初步信任。',
        sourceKind: 'event_settlement',
        sourceVersionId: 'settlement-v2',
        evidenceRefs: ['chapter-3-v1', 'chapter-4-v1'],
        recordedAt: '2026-08-26T12:00:00.000Z'
      }]
    });
    expect(view.root.children[0]!.actual?.state).toBe('deviated');
    expect(view.root.children[0]!.story.summary).toBe(before.root.children[0]!.story.summary);
    expect(document).toEqual(before);
  });

  it('为Agent编译只含来源版本和三树输出责任的任务合同', () => {
    const task = compilePlanningTreeGenerationTask({
      treeKind: 'book',
      scopeId: 'book-a',
      sourceRefs: [
        { sourceKind: 'opening', sourceId: 'opening-a', version: '3' },
        { sourceKind: 'setting', sourceId: 'setting-a', version: '7' }
      ]
    });
    expect(task.sourceRefs).toHaveLength(2);
    expect(task.requiredNodeContents).toContain('读者的主要情绪变化与释放位置');
    expect(task.truthBoundary).toContain('这是未来规划，不得写成正文已经发生。');
  });
});

function bookTree(): PlanningTreeDocument {
  return {
    schema: 'v7-planning-tree-v1', treeKind: 'book', scopeId: 'book-a', title: '张三的北宋成长路线',
    root: {
      ...node('book-a', 'book', '从乱世小卒到重建秩序', null),
      children: [
        node('volume-1', 'volume', '第一卷·乱世入局', { treeKind: 'volume', scopeId: 'volume-1' }),
        node('ending', 'ending', '可能结局·完成统一', null, 2)
      ]
    }
  };
}

function volumeTree(): PlanningTreeDocument {
  return {
    schema: 'v7-planning-tree-v1', treeKind: 'volume', scopeId: 'volume-1', title: '第一卷·乱世入局',
    root: {
      ...node('volume-1', 'volume', '第一卷·乱世入局', { treeKind: 'volume', scopeId: 'volume-1' }),
      linkedTree: null,
      children: [node('chain-1', 'chain', '第一链·流民求生', { treeKind: 'chain', scopeId: 'chain-1' })]
    }
  };
}

function chainTree(): PlanningTreeDocument {
  return {
    schema: 'v7-planning-tree-v1', treeKind: 'chain', scopeId: 'chain-1', title: '第一链·流民求生',
    root: {
      ...node('chain-1', 'chain', '第一链·流民求生', { treeKind: 'chain', scopeId: 'chain-1' }),
      linkedTree: null,
      children: [node('event-1', 'event', '事件一·发现伏击', null)]
    }
  };
}

function node(
  key: string,
  kind: PlanningTreeNode['kind'],
  title: string,
  linkedTree: PlanningTreeNode['linkedTree'],
  sequence = 1
): PlanningTreeNode {
  return {
    key, kind, sequence, title,
    story: {
      summary: `${title}具体推进本层故事。`,
      majorEvents: [`${title}发生一次改变局势的大事。`],
      protagonistChange: '张三从被动应对变为主动承担。',
      outcome: '当前阶段形成明确结果。',
      nextStep: '结果自然引出下一阶段。'
    },
    emotion: {
      publicSummary: '先紧张受压，再获得一次清楚释放。',
      openingEmotion: '不安', pressureMovement: '逐步升高', releaseEmotion: '振奋', intensity: 'strong'
    },
    experience: {
      publicSummary: '推进明快，读者能持续看到变化。',
      pressureRhythm: '压力逐步增加，不长时间原地受挫。',
      payoffCadence: '阶段结束时兑现一次明确回报。',
      informationRhythm: '跟随张三逐步知道真相。',
      contrastWithPrevious: '比上一阶段承担更大的责任。',
      designReason: '让长期成长和当前事件都能被读者感知。'
    },
    causality: {
      trigger: '现有局面迫使张三采取行动。',
      causes: ['上一阶段留下的问题继续发酵。'],
      coreConflict: '张三的目标受到现实阻力阻挡。',
      turningPoint: '张三作出不能撤回的选择。',
      consequences: ['选择改变了身份与下一阶段处境。']
    },
    threads: { foreshadowing: [], openQuestions: [] },
    budget: { wordTarget: 100_000, chapterRange: [1, 40] },
    linkedTree,
    children: []
  };
}
