import { describe, expect, it } from 'vitest';
import { buildPlanningLayerReferencePack } from './planning-layer-reference-pack.js';
import { parsePlanningTreeOutput } from './planning-tree-agent-runtime.js';

describe('V7分层候选工具包', () => {
  it('全书不重复灌入剧情资产，卷和链只收到少量候选', () => {
    const book = buildPlanningLayerReferencePack('book');
    const volume = buildPlanningLayerReferencePack('volume');
    const chain = buildPlanningLayerReferencePack('chain');
    expect(book.narrativeMethods).toHaveLength(0);
    expect(book.plotRecipes).toHaveLength(0);
    expect(volume.narrativeMethods.length).toBeLessThanOrEqual(10);
    expect(volume.plotRecipes.length).toBeLessThanOrEqual(6);
    expect(volume.plotPatterns).toHaveLength(0);
    expect(chain.plotPatterns.length).toBeLessThanOrEqual(12);
    expect(chain.policy.originalStrategyRequired).toBe(true);
  });

  it('拒绝成员引用本轮候选包之外的资产', () => {
    const pack = buildPlanningLayerReferencePack('chain');
    const document = treeDocument();
    document.designStrategy!.libraryRefs = [{
      assetType: 'plot_pattern', key: 'not-in-pack', applicationNote: '错误引用'
    }];
    expect(() => parsePlanningTreeOutput(JSON.stringify(document), 'chain', 'chain-1', pack))
      .toThrow('未提供的后台资产');
  });

  it('允许完全不套后台资产、只采用本书原创推进', () => {
    const document = treeDocument();
    expect(parsePlanningTreeOutput(
      JSON.stringify(document), 'chain', 'chain-1', buildPlanningLayerReferencePack('chain')
    ).designStrategy?.originalStrategies[0]?.title).toBe('军粮账本反向追责');
  });

  it('只归一服务端已知外壳和明确格式，不丢弃成员的五项原创策略', () => {
    const source = treeDocument();
    const root = structuredClone(source.root) as Record<string, any>;
    delete root.key;
    delete root.sequence;
    delete root.children[0].key;
    delete root.children[0].sequence;
    const drifted = {
      designStrategy: {
        ...source.designStrategy,
        originalStrategies: ['策略一', '策略二', '策略三', '策略四', '策略五']
      },
      root: { ...root, budget: { ...root.budget, chapterRange: '约第1-4章' } }
    };
    const parsed = parsePlanningTreeOutput(
      JSON.stringify(drifted), 'chain', 'chain-1', buildPlanningLayerReferencePack('chain')
    );
    expect(parsed).toMatchObject({
      schema: 'v7-planning-tree-v1', treeKind: 'chain', scopeId: 'chain-1', title: 'chain-root'
    });
    expect(parsed.root.budget.chapterRange).toEqual([1, 4]);
    expect(parsed.root.key).toBe('chain-1');
    expect(parsed.root.sequence).toBe(1);
    expect(parsed.root.children[0]).toMatchObject({ key: 'chain-1:event:1', sequence: 1 });
    expect(parsed.designStrategy?.originalStrategies).toHaveLength(5);
    expect(parsed.designStrategy?.originalStrategies[4]).toEqual({ title: '本书原创策略5', applicationNote: '策略五' });
  });

  it('把等价容器和缺失技术字段无损归一，不为此重做整份方案', () => {
    const source = treeDocument();
    const root = structuredClone(source.root) as Record<string, any>;
    delete root.title;
    delete root.linkedTree;
    delete root.children[0].title;
    root.children[0].causality.causes = '人物处境';
    root.children[0].causality.consequences = '形成新状态';
    root.children[0].threads.foreshadowing = [{ title: '旧账', summary: '旧账仍未查清。', state: 'open' }];
    root.children[0].threads.openQuestions = [{ question: '谁改过旧账？', state: 'open', answer: null }];
    const parsed = parsePlanningTreeOutput(JSON.stringify({ ...source, root }), 'chain', 'chain-1');
    expect(parsed.root.title).toBe('军营求生链');
    expect(parsed.root.linkedTree).toBeNull();
    expect(parsed.root.children[0]).toMatchObject({
      title: '第1段推进',
      causality: { causes: ['人物处境'], consequences: ['形成新状态'] },
      threads: { foreshadowing: ['旧账：旧账仍未查清。'], openQuestions: ['谁改过旧账？'] }
    });
  });

  it('保留成员给出的本书具体情绪强弱变化说明', () => {
    const document = treeDocument();
    document.root.emotion.intensity = '从压抑逐步增强，到阶段回报时短暂释放';
    expect(parsePlanningTreeOutput(
      JSON.stringify(document), 'chain', 'chain-1', buildPlanningLayerReferencePack('chain')
    ).root.emotion.intensity).toBe('从压抑逐步增强，到阶段回报时短暂释放');
  });
});

function treeDocument() {
  return {
    schema: 'v7-planning-tree-v1' as const,
    treeKind: 'chain' as const,
    scopeId: 'chain-1',
    title: '军营求生链',
    designStrategy: {
      libraryRefs: [],
      originalStrategies: [{ title: '军粮账本反向追责', applicationNote: '利用本书军营处境，让张三用账本证据把追责压力反推给克扣者。' }],
      decisionNote: '当前人物和军粮因果已经足够形成独特推进，不套公共剧情模板。'
    },
    root: node('chain-root', 'chain', 1, null, [node('event-1', 'event', 1, null, [])])
  };
}

function node(key: string, kind: 'chain' | 'event', sequence: number, linkedTree: null, children: any[]) {
  return {
    key, kind, sequence, title: key,
    story: { summary: '发生具体行动。', majorEvents: ['张三主动行动'], protagonistChange: '张三承担后果。', outcome: '局面改变。', nextStep: '结果触发下一步。' },
    emotion: { publicSummary: '先压后放。', openingEmotion: '紧张', pressureMovement: '逐步加压', releaseEmotion: '明确释放', intensity: 'moderate' as const },
    experience: { publicSummary: '读者看见真实进展。', pressureRhythm: '逐步加压', payoffCadence: '链内兑现', informationRhythm: '按行动揭示', contrastWithPrevious: '问题性质改变', designReason: '避免重复' },
    causality: { trigger: '旧结果触发', causes: ['人物处境'], coreConflict: '目标与阻力冲突', turningPoint: '主动选择', consequences: ['形成新状态'] },
    threads: { foreshadowing: [], openQuestions: [] },
    budget: { wordTarget: 10_000, chapterRange: [1, 4] as const },
    linkedTree, children
  };
}
