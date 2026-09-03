import type { PlanningTreeDocument, PlanningTreeSourceRef } from '../planning-trees/planning-tree-contracts.js';
import type { V7PlanningMethodSearchRequest } from '../planning-methods/index.js';

export const V7_CREATION_CONTEXT_SCHEMA = 'v7-creation-context-v1' as const;
export const V7_VOLUME_OPTION_SCHEMA = 'v7-volume-option-v1' as const;
export const V7_CHAIN_OPTION_SCHEMA = 'v7-chain-option-v1' as const;
export const V7_CHAPTER_SEQUENCE_SCHEMA = 'v7-chapter-sequence-v1' as const;
export const V7_CHAPTER_REVIEW_SCHEMA = 'v7-chapter-review-v1' as const;
export const V7_CHAPTER_SETTLEMENT_SCHEMA = 'v7-chapter-settlement-v1' as const;
export const V7_STAGE_SETTLEMENT_SCHEMA = 'v7-stage-settlement-v1' as const;

export type V7CreationStage =
  | 'context_selection'
  | 'volume_options'
  | 'volume_decision'
  | 'volume_tree_confirmation'
  | 'chain_options'
  | 'chain_decision'
  | 'chain_tree_confirmation'
  | 'chapter_outlines'
  | 'chapter_outline_confirmation'
  | 'manuscript'
  | 'manuscript_confirmation'
  | 'settlement'
  | 'completed';

export type V7CreationRunStatus =
  | 'queued'
  | 'working'
  | 'awaiting_author'
  | 'completed'
  | 'partially_failed'
  | 'failed'
  | 'unknown'
  | 'cancelled';

export type V7CreationSourceAuthority = 'formal' | 'actual' | 'goal' | 'reference';

export type V7CreationTaskKind = 'volume' | 'chain' | 'outline' | 'manuscript' | 'review' | 'settlement';

/**
 * Hard input budgets are measured from the exact serialized ContextPack sent to
 * a model.  They are deliberately expressed in characters because every
 * provider tokenizes Chinese differently; the model gateway continues to keep
 * the provider-specific token budget as a second independent guard.
 */
export const V7_CREATION_CONTEXT_CHAR_BUDGETS: Readonly<Record<V7CreationTaskKind, number>> = {
  volume: 12_000,
  chain: 8_000,
  outline: 6_000,
  manuscript: 6_000,
  // 审校是有边界的裁决，不是重新理解整本书。正文和当前章纲会在
  // ContextPack 之外单独发送；这里仅保留直接相关的正式事实与最近实际。
  // 预算低于写作工位，迫使超长来源使用上游 Agent 已签发的轻量索引，
  // 避免审校模型把无关设定和远期规划当成无限找茬素材。
  review: 6_000,
  // 定稿结算只需要当前链责任、活跃人物/线路索引与当前章纲；正文会在
  // ContextPack之外单独发送。禁止把整本开书、设定和所有历史再次搬运。
  settlement: 6_000
};

/**
 * The context-planning Agent first receives control instructions plus compact
 * source indexes.  Keep that whole prompt bounded independently from the exact
 * ContextPack sent to the executor: six thousand characters cover the fixed
 * selection contract and catalogue wrappers, while the remaining task-specific
 * allowance mirrors the executor's exact-pack budget.  This is a transport
 * limit, never a relevance
 * rule; callers must fail truthfully instead of guessing which candidate to
 * remove when the compact catalogue itself is still too large.
 */
export const V7_CREATION_CONTEXT_PLANNER_CHAR_BUDGETS: Readonly<Record<V7CreationTaskKind, number>> = {
  volume: 18_000,
  chain: 14_000,
  outline: 12_000,
  manuscript: 12_000,
  review: 12_000,
  settlement: 12_000
};

export interface V7CreationSourceCandidate {
  sourceKey: string;
  sourceKind: 'opening' | 'setting' | 'planning_tree' | 'planning_actual' | 'chapter_settlement' | 'character' | 'story_state' | 'author_input' | 'method';
  sourceId: string;
  sourceVersion: string;
  authority: V7CreationSourceAuthority;
  label: string;
  content: unknown;
  /**
   * Compact, semantically-authored projection used only while deciding whether
   * the exact source is relevant.  It is never substituted for `content` in a
   * compiled pack and therefore cannot silently become canon.
   */
  selectionContent?: unknown;
  contentHash: string;
  required: boolean;
  includedReason: string;
}

export interface V7CreationContextSelection {
  schema: typeof V7_CREATION_CONTEXT_SCHEMA;
  publicSummary: string;
  selectedSourceKeys: string[];
  selectionReasons: Array<{ sourceKey: string; reason: string }>;
  excludedSourceKeys: string[];
  openQuestions: string[];
  taskPersona: V7CreationTaskPersona;
  taskResponsibilities: string[];
  creativeSpace: string[];
  methodStrategy: V7CreationMethodStrategy;
}

/**
 * 只属于“当前书 + 当前任务”的临时执行身份。它随资料包冻结，不写入成员、
 * 岗位或长期偏好，任何接手同一任务的成员都读取同一份身份说明。
 */
export interface V7CreationTaskPersona {
  publicLabel: string;
  workingIdentity: string;
  priorities: string[];
  authenticityChecks: string[];
  avoidPatterns: string[];
}

export type V7CreationMethodMode = 'asset' | 'combined' | 'original' | 'none';

export interface V7CreationMethodStrategy {
  mode: V7CreationMethodMode;
  publicSummary: string;
  searchRequest: V7PlanningMethodSearchRequest | null;
}

/**
 * 第86批：方法计划不再携带资料策划召回的候选方法卡，改为系统按当前任务层
 * 确定性生成的资产菜单文本（提名卡 + 名册）。mode=none 或菜单开关关闭时为 null。
 */
export interface V7CreationMethodPlan extends V7CreationMethodStrategy {
  assetMenu: string | null;
  assetMenuVersion: 'v7-layer-asset-menu-v1' | null;
  policy: {
    candidateOnly: true;
    executorMayCombine: true;
    executorMayIgnore: true;
    originalDesignAllowed: true;
  };
}

export interface V7CreationContextPack {
  schema: typeof V7_CREATION_CONTEXT_SCHEMA;
  taskKind: V7CreationTaskKind;
  taskId: string;
  taskBrief: string;
  firstVolume: boolean;
  selectedSources: V7CreationSourceCandidate[];
  excludedSources: Array<{ sourceKey: string; reason: string }>;
  openQuestions: string[];
  taskPersona: V7CreationTaskPersona;
  taskResponsibilities: string[];
  creativeSpace: string[];
  methodPlan: V7CreationMethodPlan;
  sourceRefs: PlanningTreeSourceRef[];
  contextPolicyVersion: 'layered-context-v2' | 'layered-context-v3' | 'layered-context-v4';
  characterCount: number;
  budgetChars: number;
  estimatedTokens: number;
}

/**
 * 交给创作成员的最小资料视图。来源标识、版本、哈希、排除理由和证据引用
 * 保留在完整ContextPack与调用审计中，不重复占用模型注意力。
 */
export function creationPromptContext(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const pack = value as Partial<V7CreationContextPack>;
  if (pack.schema !== V7_CREATION_CONTEXT_SCHEMA || !Array.isArray(pack.selectedSources)) return value;
  return {
    schema: 'v7-creation-prompt-context-v1',
    taskKind: pack.taskKind,
    taskBrief: pack.taskBrief,
    firstVolume: pack.firstVolume,
    taskPersona: pack.taskPersona,
    taskResponsibilities: pack.taskResponsibilities ?? [],
    creativeSpace: pack.creativeSpace ?? [],
    methodPlan: pack.methodPlan === undefined ? undefined : {
      mode: pack.methodPlan.mode,
      publicSummary: pack.methodPlan.publicSummary,
      assetMenu: pack.methodPlan.assetMenu,
      policy: pack.methodPlan.policy
    },
    sources: pack.selectedSources.map((source) => ({
      sourceKey: source.sourceKey,
      sourceKind: source.sourceKind,
      authority: source.authority,
      label: source.label,
      content: source.content
    })),
    openQuestions: pack.openQuestions ?? []
  };
}

export interface V7PlanningOption<TKind extends 'volume' | 'chain'> {
  schema: TKind extends 'volume' ? typeof V7_VOLUME_OPTION_SCHEMA : typeof V7_CHAIN_OPTION_SCHEMA;
  optionKind: TKind;
  publicName: string;
  publicSummary: string;
  designRationale: string;
  readerExperience: string;
  coreConflict: string;
  protagonistChoice: string;
  priceAndChange: string;
  payoff: string;
  strengths: string[];
  risks: string[];
  tree: PlanningTreeDocument;
}

export type V7VolumeOption = V7PlanningOption<'volume'>;
export type V7ChainOption = V7PlanningOption<'chain'>;

export interface V7PlanningOptionReview {
  schema: 'v7-planning-option-review-v1';
  publicSummary: string;
  recommendedOptionId: string;
  differences: Array<{ optionId: string; difference: string }>;
  risks: string[];
  authorDecisions: string[];
}

export interface V7ChapterOutline {
  chapterNumber: number;
  title: string;
  objective: string;
  openingHook: string;
  sceneSetup: string;
  protagonistChoice: string;
  opposition: string;
  turn: string;
  emotionalMovement: string;
  payoff: string;
  continuity: string;
  openQuestions: string[];
  nextChapterInterface: string;
}

export interface V7ChapterSequence {
  schema: typeof V7_CHAPTER_SEQUENCE_SCHEMA;
  chainScopeId: string;
  publicSummary: string;
  chapterStart: number;
  chapterEnd: number;
  chapters: V7ChapterOutline[];
  sourceRefs: PlanningTreeSourceRef[];
}

export interface V7ChapterReview {
  schema: typeof V7_CHAPTER_REVIEW_SCHEMA;
  passed: boolean;
  publicSummary: string;
  hardConflicts: Array<{ evidence: string; impact: string; action: string }>;
  continuityRisks: Array<{ evidence: string; impact: string; action: string }>;
  qualitySuggestions: Array<{ evidence: string; impact: string; action: string }>;
  rewriteInstructions: string[];
}

export interface V7StoryLineChange {
  stableKey: string;
  title: string;
  state: 'introduced' | 'advancing' | 'paused' | 'intersected' | 'completed' | 'abandoned';
  summary: string;
  evidenceRefs: string[];
}

export interface V7ForeshadowingChange {
  stableKey: string;
  title: string;
  state: 'planted' | 'deepened' | 'partially_revealed' | 'resolved' | 'retired';
  summary: string;
  evidenceRefs: string[];
}

export interface V7OpenQuestionChange {
  stableKey: string;
  question: string;
  state: 'open' | 'answered' | 'retired';
  answer: string | null;
  evidenceRefs: string[];
}

export interface V7TreeActualChange {
  treeKind: 'book' | 'volume' | 'chain';
  scopeId: string;
  nodeKey: string;
  state: 'partial' | 'completed' | 'deviated';
  summary: string;
  emotionResult: string;
  experienceResult: string;
  outcome: string;
  evidenceRefs: string[];
}

export interface V7ChapterSettlement {
  schema: typeof V7_CHAPTER_SETTLEMENT_SCHEMA;
  publicSummary: string;
  irreversibleResults: unknown[];
  entityStates: unknown[];
  relationshipChanges: unknown[];
  knowledgeChanges: unknown[];
  resourceChanges: unknown[];
  ruleChanges: unknown[];
  storyLines: V7StoryLineChange[];
  foreshadowing: V7ForeshadowingChange[];
  openQuestions: V7OpenQuestionChange[];
  treeActuals: V7TreeActualChange[];
}

export interface V7StageSettlement {
  schema: typeof V7_STAGE_SETTLEMENT_SCHEMA;
  settlementKind: 'chain' | 'volume';
  scopeId: string;
  publicSummary: string;
  irreversibleResults: unknown[];
  entityStates: unknown[];
  closedThreads: unknown[];
  openThreads: unknown[];
  relationshipChanges: unknown[];
  knowledgeChanges: unknown[];
  resourceChanges: unknown[];
  ruleChanges: unknown[];
  protagonistChange: string;
  outcome: string;
  nextStep: string;
  evidenceRefs: string[];
}

export interface V7CreationMemberDefinition {
  memberKey: string;
  displayName: string;
  roleKey:
    | 'context_editor'
    | 'chief_editor'
    | 'planning_writer'
    | 'lead_writer'
    | 'independent_reviewer'
    | 'settlement_editor';
  fallbackPriority: number;
  defaultForRole: boolean;
  enabledByDefault: boolean;
  model: { provider: string; modelId: string; plan: 'coding' | 'agent' };
  promptInstruction: string;
}
