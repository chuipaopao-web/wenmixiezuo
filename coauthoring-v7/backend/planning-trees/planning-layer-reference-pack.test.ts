import { describe, expect, it } from 'vitest';
import { buildPlanningLayerReferencePack, type V7PlanningLayerReferencePack } from './planning-layer-reference-pack.js';
import { parsePlanningTreeOutput } from './planning-tree-agent-runtime.js';
import { projectPlanningTreeForChild } from './planning-tree-context-projection.js';

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

  it('候选包之外的引用被确定性丢弃，剧情与原创策略不受影响', () => {
    const pack = buildPlanningLayerReferencePack('chain');
    const document = treeDocument();
    document.designStrategy!.libraryRefs = [{
      assetType: 'plot_pattern', key: 'not-in-pack', applicationNote: '错误引用'
    }];
    const parsed = parsePlanningTreeOutput(JSON.stringify(document), 'chain', 'chain-1', pack);
    expect(parsed.designStrategy?.libraryRefs).toEqual([]);
    expect(parsed.designStrategy?.originalStrategies[0]?.title).toBe('军粮账本反向追责');
    expect(parsed.root.story.summary).toBe('发生具体行动。');
  });

  it('libraryRefs 缺失或非数组时按合同视为零引用', () => {
    const source = treeDocument();
    const missing = { ...source, designStrategy: { ...source.designStrategy } };
    delete (missing.designStrategy as Record<string, unknown>).libraryRefs;
    expect(parsePlanningTreeOutput(JSON.stringify(missing), 'chain', 'chain-1', buildPlanningLayerReferencePack('chain'))
      .designStrategy?.libraryRefs).toEqual([]);
    const malformed = {
      ...source,
      designStrategy: { ...source.designStrategy, libraryRefs: '照抄上层引用' }
    };
    expect(parsePlanningTreeOutput(JSON.stringify(malformed), 'chain', 'chain-1', buildPlanningLayerReferencePack('chain'))
      .designStrategy?.libraryRefs).toEqual([]);
  });

  it('按复合键归一引用，类型名漂移但 key 唯一时仍能匹配', () => {
    const pack = packWithCards([
      { assetType: 'narrative_method', key: 'ledger-pressure', title: '账本压力法', explanation: '以账目细节持续施压。', caution: '只在适合时使用。' }
    ]);
    const document = treeDocument();
    document.designStrategy!.libraryRefs = [
      { assetType: 'plot_recipe', key: 'ledger-pressure', applicationNote: '用账本细节持续给克扣者压力。' }
    ];
    const parsed = parsePlanningTreeOutput(JSON.stringify(document), 'chain', 'chain-1', pack);
    expect(parsed.designStrategy?.libraryRefs).toEqual([
      { assetType: 'narrative_method', key: 'ledger-pressure', applicationNote: '用账本细节持续给克扣者压力。' }
    ]);
  });

  it('重复引用去重、超出 libraryUseLimit 保留前 N 项、缺使用说明的引用丢弃', () => {
    const pack = packWithCards([
      { assetType: 'narrative_method', key: 'method-1', title: '方法一', explanation: 'e1', caution: 'c1' },
      { assetType: 'narrative_method', key: 'method-2', title: '方法二', explanation: 'e2', caution: 'c2' },
      { assetType: 'plot_recipe', key: 'recipe-1', title: '配方一', explanation: 'e3', caution: 'c3' },
      { assetType: 'plot_pattern', key: 'pattern-1', title: '模式一', explanation: 'e4', caution: 'c4' },
      { assetType: 'plot_pattern', key: 'pattern-2', title: '模式二', explanation: 'e5', caution: 'c5' },
      { assetType: 'plot_pattern', key: 'pattern-3', title: '模式三', explanation: 'e6', caution: 'c6' }
    ]);
    const document = treeDocument();
    document.designStrategy!.libraryRefs = [
      { assetType: 'narrative_method', key: 'method-1', applicationNote: 'a1' },
      { assetType: 'narrative_method', key: 'method-1', applicationNote: '重复引用' },
      { assetType: 'plot_recipe', key: 'recipe-1', applicationNote: 'a3' },
      { assetType: 'plot_pattern', key: 'pattern-1', applicationNote: 'a4' },
      { assetType: 'plot_pattern', key: 'pattern-2', applicationNote: '   ' },
      { assetType: 'plot_pattern', key: 'pattern-3', applicationNote: 'a6' },
      { assetType: 'plot_pattern', key: 'pattern-2', applicationNote: 'a2-again' },
      { assetType: 'narrative_method', key: 'method-2', applicationNote: 'a7' }
    ];
    const parsed = parsePlanningTreeOutput(JSON.stringify(document), 'chain', 'chain-1', pack);
    expect(parsed.designStrategy?.libraryRefs).toEqual([
      { assetType: 'narrative_method', key: 'method-1', applicationNote: 'a1' },
      { assetType: 'plot_recipe', key: 'recipe-1', applicationNote: 'a3' },
      { assetType: 'plot_pattern', key: 'pattern-1', applicationNote: 'a4' },
      { assetType: 'plot_pattern', key: 'pattern-3', applicationNote: 'a6' },
      { assetType: 'plot_pattern', key: 'pattern-2', applicationNote: 'a2-again' }
    ]);
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

  it('下层只接收当前责任、相邻位置和上层方法/伏笔交接', () => {
    const source = treeDocument();
    const current = node('chain-1-node', 'chain', 1, null, []);
    current.linkedTree = { treeKind: 'chain', scopeId: 'chain-1' } as any;
    current.threads.foreshadowing = ['军粮旧账要在本链加深'];
    const adjacent = node('chain-2-node', 'chain', 2, null, []);
    adjacent.linkedTree = { treeKind: 'chain', scopeId: 'chain-2' } as any;
    const parent = {
      ...source,
      treeKind: 'volume' as const,
      scopeId: 'volume-1',
      root: { ...source.root, kind: 'volume' as const, children: [current, adjacent] }
    };
    const projection = projectPlanningTreeForChild(parent as any, 'chain-1') as any;
    expect(projection.designStrategy.originalStrategies[0].applicationNote).toContain('军营处境');
    expect(projection.root.children[0]).toMatchObject({
      title: 'chain-1-node',
      experience: { payoffCadence: '链内兑现' },
      threads: { foreshadowing: ['军粮旧账要在本链加深'] }
    });
    expect(projection.root.children[1]).toMatchObject({
      title: 'chain-2-node',
      story: { outcome: '局面改变。' }
    });
    expect(projection.root.children[1].threads).toBeUndefined();
  });
});

function packWithCards(cards: Array<{
  assetType: 'narrative_method' | 'plot_recipe' | 'plot_pattern';
  key: string; title: string; explanation: string; caution: string;
}>): V7PlanningLayerReferencePack {
  return {
    schema: 'v7-planning-layer-reference-pack-v1',
    treeKind: 'chain',
    policy: {
      candidateOnly: true,
      libraryUseLimit: 5,
      originalStrategyRequired: true,
      instruction: '测试候选包。'
    },
    narrativeMethods: cards.filter((card) => card.assetType === 'narrative_method'),
    plotRecipes: cards.filter((card) => card.assetType === 'plot_recipe'),
    plotPatterns: cards.filter((card) => card.assetType === 'plot_pattern')
  };
}

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
