export const V7_PLANNING_TREE_SCHEMA = 'v7-planning-tree-v1' as const;

export type PlanningTreeKind = 'book' | 'volume' | 'chain';
export type PlanningNodeKind = 'book' | 'volume' | 'ending' | 'chain' | 'event';
export type PlanningTreeLifecycle = 'candidate' | 'confirmed';
export type PlanningActualState = 'partial' | 'completed' | 'deviated';

export interface PlanningTreeLink {
  treeKind: 'volume' | 'chain';
  scopeId: string;
}

export interface PlanningStoryFacet {
  summary: string;
  majorEvents: string[];
  protagonistChange: string;
  outcome: string;
  nextStep: string;
}

export interface PlanningEmotionFacet {
  publicSummary: string;
  openingEmotion: string;
  pressureMovement: string;
  releaseEmotion: string;
  /** 四档英文值与本书具体的强弱变化说明都可保留。 */
  intensity: string;
}

export interface PlanningExperienceFacet {
  publicSummary: string;
  pressureRhythm: string;
  payoffCadence: string;
  informationRhythm: string;
  contrastWithPrevious: string;
  designReason: string;
}

export interface PlanningCausalityFacet {
  trigger: string;
  causes: string[];
  coreConflict: string;
  turningPoint: string;
  consequences: string[];
}

export interface PlanningThreadFacet {
  foreshadowing: string[];
  openQuestions: string[];
}

export interface PlanningBudgetFacet {
  wordTarget: number | null;
  chapterRange: readonly [number, number] | null;
}

export interface PlanningTreeNode {
  key: string;
  kind: PlanningNodeKind;
  sequence: number;
  title: string;
  story: PlanningStoryFacet;
  emotion: PlanningEmotionFacet;
  experience: PlanningExperienceFacet;
  causality: PlanningCausalityFacet;
  threads: PlanningThreadFacet;
  budget: PlanningBudgetFacet;
  linkedTree: PlanningTreeLink | null;
  children: PlanningTreeNode[];
}

export interface PlanningTreeDocument {
  schema: typeof V7_PLANNING_TREE_SCHEMA;
  treeKind: PlanningTreeKind;
  scopeId: string;
  title: string;
  designStrategy?: {
    libraryRefs: Array<{
      assetType: 'narrative_method' | 'plot_recipe' | 'plot_pattern';
      key: string;
      applicationNote: string;
    }>;
    originalStrategies: Array<{ title: string; applicationNote: string }>;
    decisionNote: string;
  };
  root: PlanningTreeNode;
}

export interface PlanningTreeSourceRef {
  sourceKind: 'opening' | 'setting' | 'author_goal' | 'confirmed_tree' | 'settlement';
  sourceId: string;
  version: string;
}

export interface PlanningNodeActual {
  nodeKey: string;
  state: PlanningActualState;
  summary: string;
  emotionResult: string;
  experienceResult: string;
  outcome: string;
  sourceKind: 'chapter_settlement' | 'event_settlement' | 'volume_settlement';
  sourceVersionId: string;
  evidenceRefs: string[];
  recordedAt: string;
}

export interface AuthorPlanningNodeActual {
  state: PlanningActualState;
  summary: string;
  emotionResult: string;
  experienceResult: string;
  outcome: string;
  recordedAt: string;
}

export interface AuthorPlanningTreeNode extends PlanningTreeNode {
  actual: AuthorPlanningNodeActual | null;
  children: AuthorPlanningTreeNode[];
}

export interface AuthorPlanningTreeView {
  treeKind: PlanningTreeKind;
  scopeId: string;
  revision: number;
  status: PlanningTreeLifecycle;
  title: string;
  designSummary: null | {
    decisionNote: string;
    originalApproaches: Array<{ title: string; applicationNote: string }>;
  };
  root: AuthorPlanningTreeNode;
}

export type PlanningTreeOperation =
  | {
      kind: 'update_node';
      nodeKey: string;
      changes: Partial<Pick<PlanningTreeNode, 'title' | 'story' | 'emotion' | 'experience' | 'causality' | 'threads' | 'budget' | 'linkedTree'>>;
    }
  | { kind: 'add_child'; parentKey: string; position: number; node: PlanningTreeNode }
  | { kind: 'remove_node'; nodeKey: string }
  | { kind: 'reorder_children'; parentKey: string; orderedNodeKeys: string[] };

export interface PlanningTreeGenerationTask {
  schema: 'v7-planning-tree-generation-task-v1';
  treeKind: PlanningTreeKind;
  scopeId: string;
  sourceRefs: PlanningTreeSourceRef[];
  parentDirection: string | null;
  requiredNodeContents: string[];
  truthBoundary: string[];
}

export function expectedRootKind(treeKind: PlanningTreeKind): PlanningNodeKind {
  return treeKind;
}

export function expectedChildKinds(treeKind: PlanningTreeKind): readonly PlanningNodeKind[] {
  if (treeKind === 'book') return ['volume', 'ending'];
  if (treeKind === 'volume') return ['chain'];
  return ['event'];
}

export function compilePlanningTreeGenerationTask(input: {
  treeKind: PlanningTreeKind;
  scopeId: string;
  sourceRefs: readonly PlanningTreeSourceRef[];
  parentDirection?: string | null;
}): PlanningTreeGenerationTask {
  return {
    schema: 'v7-planning-tree-generation-task-v1',
    treeKind: input.treeKind,
    scopeId: input.scopeId,
    sourceRefs: input.sourceRefs.map((item) => ({ ...item })),
    parentDirection: input.parentDirection ?? null,
    requiredNodeContents: [
      '这一层具体发生什么以及承担什么推进责任',
      '本层最重要的大事件和主角变化',
      '读者的主要情绪变化与释放位置',
      '压力、回报和信息揭示的阅读体验',
      '事情为什么发生、造成什么结果、怎样连接下一步',
      '需要保留的伏笔和暂未解决的问题'
    ],
    truthBoundary: [
      '这是未来规划，不得写成正文已经发生。',
      '作者确认资料和正式设定是硬边界，不能静默改写。',
      '没有必要的伏笔或开放问题可以留空数组，不能为了填满字段硬造内容。',
      '如果新创意会改变上层已确认方向，必须提出调整建议，不能直接覆盖。'
    ]
  };
}
