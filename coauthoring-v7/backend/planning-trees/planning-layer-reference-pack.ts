import type { V7PlanningMethodCandidate } from '../planning-methods/planning-method-retrieval.js';
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
 * The context-planning Agent has already selected the semantic retrieval
 * request. This deterministic mapper only trims and reshapes those retrieved
 * candidates for the tree contract; it never performs a second broad recall.
 */
export function buildPlanningLayerReferencePack(
  treeKind: PlanningTreeKind,
  candidates: readonly V7PlanningMethodCandidate[] = []
): V7PlanningLayerReferencePack {
  const candidateLimit = treeKind === 'book' ? 6 : 8;
  const libraryUseLimit = treeKind === 'book' ? 3 : treeKind === 'volume' ? 4 : 5;
  const narrativeMethods = candidates.slice(0, candidateLimit).map((method) => ({
    assetType: 'narrative_method' as const,
    key: method.methodKey,
    title: method.professionalName,
    explanation: method.publicExplanation,
    caution: method.cautionSignals.slice(0, 2).join('；') || '只在适合当前人物与局势时使用。'
  }));
  return pack(treeKind, narrativeMethods, [], [], libraryUseLimit,
    '这些只是资料策划按本任务召回的候选方法。成员可以组合、忽略或完全原创，但必须说明本书当前层的具体取舍。');
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
