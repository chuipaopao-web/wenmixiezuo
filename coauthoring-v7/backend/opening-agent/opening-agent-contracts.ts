import type { V7AgentFailureClass } from '../agents/agent-failure-policy.js';
import type { V7OpeningMemberDefinition, V7OpeningRoleKey } from '../agents/agent-roster.js';
import type { V7OpeningNodeKey } from '../agents/agent-tools.js';
import type { V7AgentTaskKind } from '../agent-governance/index.js';
import type {
  V7ContextSourceTrace,
  V7TaskOperationMode,
  V7WorkstationKey
} from '../prompt-governance/index.js';

export type OpeningAgentTaskKind = Extract<V7AgentTaskKind, 'opening_design' | 'opening_review'>;
export type OpeningAgentWorkstationKey = Extract<V7WorkstationKey, 'opening'>;
export type OpeningAgentOperationMode = Extract<V7TaskOperationMode, 'fresh' | 'revise' | 'repair'>;

export type OpeningCandidateKind = 'work_order' | 'opening_package' | 'opening_review';
export type OpeningPublishingPlatform = 'fanqie' | 'qidian' | 'mainstream';
export type OpeningTaskStatus =
  | 'working'
  | 'awaiting_author_decision'
  | 'awaiting_author_confirmation'
  | 'failed'
  | 'interrupted';
export type OpeningTaskPhase =
  | 'work_order'
  | 'package_design'
  | 'package_review'
  | 'package_revision'
  | 'package_re_review'
  | 'complete';

export interface OpeningWorkOrder {
  corePremise: string;
  mustKeep: string[];
  preferences: string[];
  openDecisions: string[];
  intendedExperience: string;
  designResponsibilities: string[];
  prohibitions: string[];
}

export interface OpeningProtagonist {
  name: string;
  age: string;
  identity: string;
  background: string;
  familyBackground?: string;
  careerBackground?: string;
  goldenFinger?: string;
  /** 封面、角色形象与后续设定共用的稳定视觉锚点；不是完整人物卡。 */
  visualIdentity?: {
    appearance: string;
    build: string;
    signatureFeature: string;
  };
  goal: string;
  dilemma: string;
  personality: string[];
  boundary: string;
}

export interface OpeningPackage {
  title: string;
  positioning: {
    publishingPlatform: OpeningPublishingPlatform;
    channel: 'male' | 'female' | 'general';
    category: string;
    genres: string[];
    tags: string[];
    coreAppeal: string;
    expectedTotalWords: number;
    /** 旧版开书候选兼容字段；新路线由全案策划重新判断。 */
    targetReaders?: string;
    /** 旧版开书候选兼容字段；新路线由全案策划重新规划。 */
    volumePlan?: {
      minimum: number;
      recommended: number;
      maximum: number;
    };
    /** 旧版开书候选兼容字段；新路线由全案策划重新判断。 */
    retentionPositioning?: string;
  };
  backgrounds: {
    eraAndWorld: string;
    openingSituation: string;
  };
  protagonists: OpeningProtagonist[];
  opening: {
    startingSituation: string;
    incitingIncident: string;
    immediateConflict: string;
    readerPromise: string;
  };
  longTermDirection: {
    centralConflict: string;
    progression: string;
    relationshipDirection: string;
    storyPotential: string;
  };
  possibleEnding: {
    direction: string;
    price: string;
    openness: string;
  };
  authorNotes: string[];
  /** 自己设计沿用历史开书表单时保存的全书硬边界。 */
  mustFollow?: string[];
  /** 作者直接修改资料后附带的调整要求；始终作为作者来源保留，不由模型静默清空。 */
  authorInstructions?: string[];
  /** 仅存在于作者提交给编辑部的中间候选；编剧交稿时必须移除。 */
  revisionDirective?: {
    allowedFields: string[];
    authorMessages: string[];
  };
}

export interface OpeningTaxonomyReference {
  version: string;
  categories: Array<{
    key: string;
    name: string;
    channel: 'male' | 'female';
    description: string;
    recommendedTags: string[];
  }>;
  subjects: string[];
  /** 只给模型少量高频/相关词，避免把完整标签库塞进上下文。 */
  tagSuggestions: string[];
  /** 只用于确定性输出校验，不进入模型提示词。 */
  allowedTags: string[];
}

export interface OpeningReviewIssue {
  field: string;
  evidence: string;
  impact: string;
  requiredAction: string;
}

export const OPENING_DECISION_FIELDS = [
  'title',
  'positioning.coreAppeal',
  'positioning.expectedTotalWords',
  // 只用于恢复旧V7任务；新主编审查合同不再产生这三类开书决定。
  'positioning.volumePlan',
  'positioning.commercialAudience',
  'positioning.retentionPositioning',
  'positioning.targetReaders',
  // 只用于恢复旧V7任务；新主编审查合同不再产生这三类开书决定。
  'positioning.volumePlan',
  'positioning.commercialAudience',
  'positioning.retentionPositioning',
  'positioning.targetReaders',
  'backgrounds.eraAndWorld',
  'longTermDirection.centralConflict',
  'longTermDirection.progression',
  'longTermDirection.relationshipDirection',
  'longTermDirection.storyPotential',
  'possibleEnding.direction',
  'possibleEnding.price',
  'possibleEnding.openness',
  'protagonists.0.age',
  'protagonists.0.background',
  'protagonists.0.familyBackground',
  'protagonists.0.careerBackground',
  'protagonists.0.goldenFinger',
  'protagonists.0.visualIdentity.appearance',
  'protagonists.0.visualIdentity.build',
  'protagonists.0.visualIdentity.signatureFeature',
  'protagonists.1.age',
  'protagonists.1.background',
  'protagonists.1.familyBackground',
  'protagonists.1.careerBackground',
  'protagonists.1.goldenFinger',
  'protagonists.1.visualIdentity.appearance',
  'protagonists.1.visualIdentity.build',
  'protagonists.1.visualIdentity.signatureFeature'
] as const;

export type OpeningDecisionField = typeof OPENING_DECISION_FIELDS[number];

export interface OpeningReviewDecision {
  decisionId: string;
  field: OpeningDecisionField;
  question: string;
  currentValue: string;
  recommendation: string;
  reason: string;
  impact: string;
  required: boolean;
}

export interface OpeningReview {
  verdict: 'pass' | 'revise' | 'author_decision';
  summary: string;
  issues: OpeningReviewIssue[];
  requiredChanges: string[];
  authorDecisions: string[];
  /** 新审查使用的作者决定卡；authorDecisions仅为旧候选兼容字段。 */
  decisions?: OpeningReviewDecision[];
}

export type OpeningCandidateContent = OpeningWorkOrder | OpeningPackage | OpeningReview;

export interface OpeningSavedCandidate<T extends OpeningCandidateContent = OpeningCandidateContent> {
  candidateId: string;
  kind: OpeningCandidateKind;
  version: number;
  content: T;
  createdByMemberKey: string;
  modelRequestId: string;
  sourceCandidateIds: string[];
}

export interface OpeningModelAttempt {
  requestId: string;
  nodeKey: V7OpeningNodeKey;
  phase: OpeningTaskPhase;
  memberKey: string;
  status: 'working' | 'succeeded' | 'failed' | 'unknown';
  failureClass: V7AgentFailureClass | null;
  failureMessage: string | null;
  /** 新任务冻结显式合同；历史检查点缺少这些字段时由节点规格兼容恢复。 */
  taskKind?: OpeningAgentTaskKind;
  workstationKey?: OpeningAgentWorkstationKey;
  operationMode?: OpeningAgentOperationMode;
  basedOnTaskId?: string | null;
  authorInstructionVersion?: number | null;
}

export interface OpeningAgentTaskState {
  taskId: string;
  ownerId: string;
  ideaVersion: number;
  ideaHash: string;
  status: OpeningTaskStatus;
  phase: OpeningTaskPhase;
  selectedChiefMemberKey: string | null;
  selectedScreenwriterMemberKey: string | null;
  workOrderCandidateId: string | null;
  activePackageCandidateId: string | null;
  activeReviewCandidateId: string | null;
  editorialRevisionCount: number;
  automaticMemberSwitches: number;
  structureRepairs: Partial<Record<OpeningTaskPhase, number>>;
  attemptedMemberKeys: Partial<Record<OpeningTaskPhase, string[]>>;
  attempts: OpeningModelAttempt[];
  requestSequence: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface OpeningIdeaSnapshot {
  text: string;
  version: number;
  hash: string;
  publishingPlatform: OpeningPublishingPlatform;
}

export interface OpeningInternalReference {
  source: 'narrative_method' | 'plot_recipe';
  sourceKey: string;
  libraryVersion: string;
  responsibility: string;
  risk: string;
}

export interface OpeningReferencePack {
  references: OpeningInternalReference[];
  excludedReason: string;
}

export interface OpeningModelRequest {
  requestId: string;
  taskId: string;
  ownerId: string;
  nodeKey: V7OpeningNodeKey;
  taskKind: OpeningAgentTaskKind;
  workstationKey: OpeningAgentWorkstationKey;
  operationMode: OpeningAgentOperationMode;
  basedOnTaskId: string | null;
  authorInstructionVersion: number | null;
  sourceTraces: readonly V7ContextSourceTrace[];
  member: V7OpeningMemberDefinition;
  prompt: string;
  maxOutputTokens: number;
}

export interface OpeningReconciliationRequest {
  requestId: string;
  ownerId: string;
  taskId: string;
  nodeKey: V7OpeningNodeKey;
  memberKey: string;
}

export interface OpeningModelResult {
  requestId: string;
  provider: string;
  modelId: string;
  output: string;
  inputTokens: number;
  outputTokens: number;
}

export type OpeningReconciliation =
  | { status: 'succeeded'; result: OpeningModelResult }
  | { status: 'failed'; failureClass: V7AgentFailureClass; message: string }
  | { status: 'unknown' };

export interface OpeningAgentModelGateway {
  generate(request: OpeningModelRequest): Promise<OpeningModelResult>;
  reconcile(request: OpeningReconciliationRequest): Promise<OpeningReconciliation>;
}

export interface OpeningCandidateCommit<T extends OpeningCandidateContent> {
  candidateId: string;
  kind: OpeningCandidateKind;
  content: T;
  createdByMemberKey: string;
  modelRequestId: string;
  sourceCandidateIds: string[];
  nextState: OpeningAgentTaskState;
}

/**
 * 这里是V7执行器所需的最小持久化边界。平台批次必须把commitCandidate实现成
 * 同一事务内“追加候选＋推进检查点”，避免崩溃后重复调用或候选丢失。
 */
export interface OpeningAgentToolGateway {
  readOpeningIdea(ownerId: string, taskId: string): Promise<OpeningIdeaSnapshot>;
  loadTask(ownerId: string, taskId: string): Promise<OpeningAgentTaskState | null>;
  createTask(state: OpeningAgentTaskState): Promise<OpeningAgentTaskState>;
  saveTask(state: OpeningAgentTaskState): Promise<void>;
  readCandidate<T extends OpeningCandidateContent>(
    ownerId: string,
    taskId: string,
    candidateId: string
  ): Promise<OpeningSavedCandidate<T>>;
  commitCandidate<T extends OpeningCandidateContent>(
    ownerId: string,
    taskId: string,
    commit: OpeningCandidateCommit<T>
  ): Promise<OpeningSavedCandidate<T>>;
}

export class OpeningAgentModelError extends Error {
  public constructor(
    message: string,
    public readonly failureClass: V7AgentFailureClass,
    public readonly outcomeUnknown = false,
    public readonly taskErrorCode: string | null = null
  ) {
    super(message);
    this.name = 'OpeningAgentModelError';
  }
}

export class OpeningAgentStoppedError extends Error {
  public constructor(
    message: string,
    public readonly state: OpeningAgentTaskState
  ) {
    super(message);
    this.name = 'OpeningAgentStoppedError';
  }
}

export interface OpeningStructuredGeneration<T extends OpeningCandidateContent> {
  content: T;
  member: V7OpeningMemberDefinition;
  result: OpeningModelResult;
}

export interface OpeningNodeSpecification<T extends OpeningCandidateContent> {
  roleKey: V7OpeningRoleKey;
  nodeKey: V7OpeningNodeKey;
  taskKind: OpeningAgentTaskKind;
  workstationKey: OpeningAgentWorkstationKey;
  kind: OpeningCandidateKind;
  parse: (output: string) => T;
  maxOutputTokens: number;
}
