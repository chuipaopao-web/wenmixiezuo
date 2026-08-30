import { V7_NARRATIVE_METHODS } from '../narrative-methods/narrative-method-library.js';
import { getMethodExecutionProfile, type PlanningLayerKey } from '../planning-methods/method-asset-profiles.js';
import { V7_PLOT_PATTERNS } from '../plot-patterns/plot-pattern-library.js';
import { V7_PLOT_RECIPES } from '../plot-patterns/plot-recipe-library.js';
import type { PlanningTreeKind } from './planning-tree-contracts.js';

export interface V7PlanningReferenceCard {
  assetType: 'narrative_method' | 'plot_recipe' | 'plot_pattern';
  key: string;
  title: string;
  explanation: string;
  caution: string;
}

export interface V7PlanningLayerReferencePack {
  schema: 'v7-planning-layer-reference-pack-v1';
  treeKind: PlanningTreeKind;
  policy: {
    candidateOnly: true;
    libraryUseLimit: number;
    originalStrategyRequired: true;
    instruction: string;
  };
  narrativeMethods: V7PlanningReferenceCard[];
  plotRecipes: V7PlanningReferenceCard[];
  plotPatterns: V7PlanningReferenceCard[];
}

/**
 * This function only recalls a small, scope-compatible toolbox. It does not
 * decide semantic relevance. The planning Agent may ignore every card and
 * must record at least one book-specific original strategy.
 */
export function buildPlanningLayerReferencePack(treeKind: PlanningTreeKind): V7PlanningLayerReferencePack {
  if (treeKind === 'book') {
    return pack(treeKind, [], [], [], 0, '全书层沿用作者已经选中的方向依据，不再次检索剧情模板。');
  }
  const layer: PlanningLayerKey = treeKind === 'volume' ? 'volume' : 'chain';
  const narrativeMethods = balancedNarrativeCards(layer, treeKind === 'volume' ? 10 : 8);
  const plotRecipes = V7_PLOT_RECIPES
    .filter((item) => item.commonGenreFamilies.length === 0)
    .slice(0, treeKind === 'volume' ? 6 : 5)
    .map((item) => ({
      assetType: 'plot_recipe' as const,
      key: item.key,
      title: item.publicTitle,
      explanation: item.publicExplanation,
      caution: item.caution
    }));
  const plotPatterns = treeKind === 'chain' ? balancedPlotPatternCards(12) : [];
  return pack(
    treeKind,
    narrativeMethods,
    plotRecipes,
    plotPatterns,
    treeKind === 'volume' ? 4 : 5,
    treeKind === 'volume'
      ? '这些只是设计本卷事件链的候选工具。成员先依据本卷真实目标创造事件链，再决定是否借用少量资产。'
      : '这些只是设计当前链具体剧情的候选工具。成员必须创造至少一种只适合本书当前人物与局势的推进办法。'
  );
}

function pack(
  treeKind: PlanningTreeKind,
  narrativeMethods: V7PlanningReferenceCard[],
  plotRecipes: V7PlanningReferenceCard[],
  plotPatterns: V7PlanningReferenceCard[],
  libraryUseLimit: number,
  instruction: string
): V7PlanningLayerReferencePack {
  return {
    schema: 'v7-planning-layer-reference-pack-v1',
    treeKind,
    policy: {
      candidateOnly: true,
      libraryUseLimit,
      originalStrategyRequired: true,
      instruction
    },
    narrativeMethods,
    plotRecipes,
    plotPatterns
  };
}

function balancedNarrativeCards(layer: PlanningLayerKey, limit: number): V7PlanningReferenceCard[] {
  const candidates = V7_NARRATIVE_METHODS
    .filter((method) => getMethodExecutionProfile(method.key)?.planningLayers.includes(layer) === true)
    .toSorted((left, right) => tierScore(right.recommendationTier) - tierScore(left.recommendationTier)
      || left.key.localeCompare(right.key));
  const selected: typeof candidates = [];
  const dimensions = new Set<string>();
  for (const candidate of candidates) {
    if (dimensions.has(candidate.dimension)) continue;
    selected.push(candidate);
    dimensions.add(candidate.dimension);
    if (selected.length >= limit) break;
  }
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (selected.some((item) => item.key === candidate.key)) continue;
    selected.push(candidate);
  }
  return selected.map((method) => ({
    assetType: 'narrative_method' as const,
    key: method.key,
    title: method.professionalName,
    explanation: method.publicExplanation,
    caution: method.cautionSignals.slice(0, 2).join('；') || '只在适合当前人物与局势时使用。'
  }));
}

function balancedPlotPatternCards(limit: number): V7PlanningReferenceCard[] {
  const selected: typeof V7_PLOT_PATTERNS[number][] = [];
  for (const category of ['container', 'strategy', 'pressure', 'turn', 'payoff', 'bridge'] as const) {
    const candidates = V7_PLOT_PATTERNS.filter((pattern) => pattern.category === category
      && (pattern.applicableScopes.includes('unit') || pattern.applicableScopes.includes('event')));
    selected.push(...candidates.slice(0, 2));
  }
  return selected.slice(0, limit).map((pattern) => ({
    assetType: 'plot_pattern' as const,
    key: pattern.key,
    title: pattern.professionalName,
    explanation: pattern.publicExplanation,
    caution: pattern.caution
  }));
}

function tierScore(tier: 'default' | 'recommended' | 'optional' | 'advanced' | 'experimental'): number {
  return ({ default: 5, recommended: 4, optional: 3, advanced: 2, experimental: 1 } as const)[tier];
}
