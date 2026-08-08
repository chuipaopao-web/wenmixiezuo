export const CREATION_WORKFLOW_CONTRACT_VERSION = 1 as const;

export const authorInputSurfaces = [
  'book_profile', 'setting', 'volume_plan', 'event', 'chapter_outline', 'manuscript'
] as const;
export type AuthorInputSurface = typeof authorInputSurfaces[number];

export const authorIntentStrengths = ['must', 'preference', 'inspiration', 'question'] as const;
export type AuthorIntentStrength = typeof authorIntentStrengths[number];

export const authorInputStatuses = [
  'new', 'adopted', 'adapted', 'parked', 'rejected', 'superseded', 'withdrawn'
] as const;
export type AuthorInputStatus = typeof authorInputStatuses[number];

export const authorPlanningDecisionStatuses = ['adopted', 'adapted', 'parked', 'rejected', 'withdrawn'] as const;
export type AuthorPlanningDecisionStatus = typeof authorPlanningDecisionStatuses[number];

export const planningVersionStatuses = [
  'draft', 'generating', 'candidate', 'waiting_confirmation', 'active', 'superseded', 'completed', 'archived'
] as const;
export type PlanningVersionStatus = typeof planningVersionStatuses[number];

export const creationWorkflowStages = [
  'book_profile_draft',
  'book_profile_confirmed',
  'setting_in_progress',
  'setting_confirmed',
  'volume_plan_in_progress',
  'volume_plan_confirmed',
  'event_sequence_in_progress',
  'event_in_progress',
  'event_confirmed',
  'chapter_outlines_in_progress',
  'next_chapters_ready',
  'manuscript_in_progress',
  'waiting_for_author',
  'chapter_settlement_in_progress',
  'event_settlement_in_progress',
  'volume_settlement_in_progress',
  'ready_for_next_volume'
] as const;
export type CreationWorkflowStage = typeof creationWorkflowStages[number];

export const planningTaskStates = [
  'pending', 'queued', 'preparing_context', 'working', 'waiting_confirmation',
  'blocked', 'failed', 'result_unknown', 'succeeded', 'cancelled'
] as const;
export type PlanningTaskState = typeof planningTaskStates[number];

export type PlanningScope = 'volume' | 'event';
export type TemplateSelectionMode = 'template' | 'custom' | 'none';

export interface VersionReference {
  kind: 'book_profile' | 'setting' | 'volume_plan' | 'story_event' | 'chapter_outline' | 'chapter' | 'settlement' | 'canon_revision';
  id: string;
  version: number;
  contentHash: string;
  required: boolean;
}

export interface SourceReference {
  sourceType: string;
  sourceId: string;
  sourceVersion?: number;
  sourceHash: string;
  locator?: Record<string, unknown>;
}

export interface PlanningTemplateBeatInstance {
  beatId: string;
  publicFunction: string;
  expectedChange: string;
  optional: boolean;
  order: number;
  authorIdeaRefs: string[];
  authorAdjustment?: string;
}

export interface PlanningTemplateInstance {
  selectionMode: TemplateSelectionMode;
  templateKey: string | null;
  templateVersion: number | null;
  templateHash: string | null;
  scope: PlanningScope;
  beats: PlanningTemplateBeatInstance[];
  customDirection: string | null;
}

export interface AuthorPlanningInput {
  ownerId: string;
  bookId: string;
  authorInputId: string;
  surface: AuthorInputSurface;
  subjectType: string;
  subjectId: string | null;
  intentStrength: AuthorIntentStrength;
  originalText: string;
  originalTextHash: string;
  attachmentRefs: string[];
  mentionedAgentIds: string[];
  scopeNotes: string | null;
  status: AuthorInputStatus;
  appliedToRefs: VersionReference[];
  handlingReason: string | null;
  links: AuthorPlanningInputLink[];
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
}

export interface AuthorPlanningInputDraft {
  surface: AuthorInputSurface;
  subjectType: string;
  subjectId: string | null;
  intentStrength: AuthorIntentStrength;
  originalText: string;
  attachmentRefs: string[];
  mentionedAgentIds: string[];
  scopeNotes: string | null;
}
export interface CreateAuthorPlanningInputCommand extends AuthorPlanningInputDraft {
  idempotencyKey: string;
}

export interface DecideAuthorPlanningInputCommand {
  expectedStatus: AuthorInputStatus;
  status: AuthorPlanningDecisionStatus;
  handlingReason: string;
  appliedToRefs: VersionReference[];
  idempotencyKey: string;
}

export interface AuthorPlanningInputLink {
  linkId: string;
  linkType: 'attachment' | 'mention' | 'application' | 'supersedes';
  sortOrder: number;
  targetType: string;
  targetId: string;
  targetVersion: number | null;
  targetHash: string | null;
  relation: 'attached' | 'mentioned' | 'adopted' | 'adapted' | 'supersedes';
  createdAt: string;
}

export interface CreativeBoundarySet {
  mustAchieve: string[];
  mustNotViolate: string[];
  creativeFreedom: string[];
  openQuestions: string[];
}

export interface EventSequenceItem {
  eventId: string;
  order: number;
  title: string;
  responsibility: string;
  entryState: string;
  trigger: string;
  action: string;
  result: string;
  leadsToNext: string | null;
  estimatedChapterRange: { minimum: number | null; likely: number | null; maximum: number | null };
}

export interface VolumePlanContent {
  title: string;
  openingState: string;
  coreGoal: string;
  coreConflict: string;
  failureCost: string;
  characterChanges: string[];
  eventSequence: EventSequenceItem[];
  informationPlan: string[];
  escalationAndRecovery: string[];
  endingState: string;
  openThreads: string[];
  nextVolumeTrigger: string;
  boundaries: CreativeBoundarySet;
}

export interface VolumePlanVersion {
  ownerId: string;
  bookId: string;
  volumePlanId: string;
  version: number;
  status: PlanningVersionStatus;
  physicalVolumeId: string | null;
  parentVersionId: string | null;
  dependencies: VersionReference[];
  template: PlanningTemplateInstance;
  authorInputRefs: string[];
  content: VolumePlanContent;
  contentHash: string;
  createdAt: string;
  confirmedAt: string | null;
}

export interface StoryEventContent {
  title: string;
  volumeResponsibility: string;
  startingState: string;
  trigger: string;
  participants: string[];
  characterGoals: string[];
  obstacles: string[];
  choicesAndCosts: string[];
  informationMoves: string[];
  localProgression: string[];
  requiredResult: string;
  flexibleExecution: string[];
  endingConditions: string[];
  nextEventImpact: string;
  characterArcImpact: string;
  volumeClimaxImpact: string;
  estimatedChapterRange: { minimum: number | null; likely: number | null; maximum: number | null };
  uncertaintyNotes: string[];
}

export interface StoryEventVersion {
  ownerId: string;
  bookId: string;
  eventId: string;
  volumePlanId: string;
  version: number;
  order: number;
  status: PlanningVersionStatus;
  parentVersionId: string | null;
  previousSettlementId: string | null;
  dependencies: VersionReference[];
  template: PlanningTemplateInstance;
  authorInputRefs: string[];
  content: StoryEventContent;
  contentHash: string;
  createdAt: string;
  confirmedAt: string | null;
}

export interface ChapterOutlineContent {
  chapterNumber: number;
  title: string;
  eventResponsibility: string;
  openingState: string;
  characterGoals: string[];
  conflicts: string[];
  choicesAndCosts: string[];
  informationChanges: string[];
  storyBeats: string[];
  endingState: string;
  nextChapterInterface: string;
  softSuggestions: string[];
  creativeFreedom: string[];
}

export interface ChapterOutlineVersion {
  ownerId: string;
  bookId: string;
  chapterOutlineId: string;
  eventId: string;
  version: number;
  status: PlanningVersionStatus;
  detailLevel: 'coarse' | 'frozen';
  dependencies: VersionReference[];
  authorInputRefs: string[];
  content: ChapterOutlineContent;
  contentHash: string;
  createdAt: string;
  confirmedAt: string | null;
}

export interface EventSettlementContent {
  goalOutcome: string;
  actualChanges: string[];
  revealedOrResolved: string[];
  remainingOpenThreads: string[];
  newOpenThreads: string[];
  deviations: string[];
  nextEventConsequences: string[];
}

export interface VolumeSettlementContent {
  actualStateChange: string;
  characterArcOutcomes: string[];
  conflictOutcome: string;
  climaxConsequences: string[];
  promiseChanges: string[];
  nextVolumeSeeds: string[];
}

export interface PlanningSettlement<TContent extends EventSettlementContent | VolumeSettlementContent> {
  ownerId: string;
  bookId: string;
  settlementId: string;
  subjectId: string;
  subjectVersion: number;
  canonRevision: number;
  chapterStart: number;
  chapterEnd: number;
  sources: SourceReference[];
  content: TContent;
  contentHash: string;
  createdAt: string;
}

export interface CreationWorkflowStateView {
  ownerId: string;
  bookId: string;
  stage: CreationWorkflowStage;
  planningVersion: number;
  activeVolumePlanRef: VersionReference | null;
  activeEventRef: VersionReference | null;
  frozenChapterOutlineRefs: VersionReference[];
  waitingTaskId: string | null;
  blockingReason: string | null;
  updatedAt: string;
}

export function parseVolumePlanContent(input: unknown): VolumePlanContent {
  const value = requireRecord(input, '卷规划');
  const eventSequence = requireRecordArray(value.eventSequence, '事件链').map((item) => ({
    eventId: requireText(item.eventId, '事件标识'),
    order: requirePositiveInteger(item.order, '事件顺序'),
    title: requireText(item.title, '事件标题'),
    responsibility: requireText(item.responsibility, '事件职责'),
    entryState: requireText(item.entryState, '事件进入状态'),
    trigger: requireText(item.trigger, '事件触发条件'),
    action: requireText(item.action, '事件行动'),
    result: requireText(item.result, '事件结果'),
    leadsToNext: optionalText(item.leadsToNext, '下一事件接口'),
    estimatedChapterRange: parseEstimatedChapterRange(item.estimatedChapterRange)
  }));
  if (eventSequence.length === 0) throw new Error('卷规划至少需要一个事件。');
  const orders = eventSequence.map((item) => item.order);
  if (new Set(orders).size !== orders.length) throw new Error('事件顺序不能重复。');
  const sortedOrders = [...orders].sort((left, right) => left - right);
  if (sortedOrders.some((order, index) => order !== index + 1)) throw new Error('事件顺序必须从1开始连续排列。');
  const eventIds = eventSequence.map((item) => item.eventId);
  if (new Set(eventIds).size !== eventIds.length) throw new Error('事件标识不能重复。');
  return {
    title: requireText(value.title, '卷标题'),
    openingState: requireText(value.openingState, '开卷状态'),
    coreGoal: requireText(value.coreGoal, '本卷核心目标'),
    coreConflict: requireText(value.coreConflict, '本卷核心冲突'),
    failureCost: requireText(value.failureCost, '失败代价'),
    characterChanges: requireUniqueTextArray(value.characterChanges, '人物变化'),
    eventSequence,
    informationPlan: requireUniqueTextArray(value.informationPlan, '信息推进'),
    escalationAndRecovery: requireUniqueTextArray(value.escalationAndRecovery, '压力升级与恢复'),
    endingState: requireText(value.endingState, '卷末状态'),
    openThreads: requireUniqueTextArray(value.openThreads, '卷末开放线索'),
    nextVolumeTrigger: requireText(value.nextVolumeTrigger, '下一卷接口'),
    boundaries: parseCreativeBoundarySet(value.boundaries)
  };
}

export function parsePlanningTemplateInstance(input: unknown, expectedScope?: PlanningScope): PlanningTemplateInstance {
  const value = requireRecord(input, '推进参考');
  const selectionMode = requireOneOf(value.selectionMode, ['template', 'custom', 'none'] as const, '推进参考选择方式');
  const scope = requireOneOf(value.scope, ['volume', 'event'] as const, '推进参考范围');
  if (expectedScope !== undefined && scope !== expectedScope) throw new Error('推进参考与当前规划层级不匹配。');
  const templateKey = optionalText(value.templateKey, '推进参考标识');
  const templateVersion = optionalPositiveInteger(value.templateVersion, '推进参考版本');
  const templateHash = optionalHash(value.templateHash, '推进参考哈希');
  if (selectionMode === 'template' && (templateKey === null || templateVersion === null || templateHash === null)) {
    throw new Error('选择系统推进参考时，必须记录模板标识、版本和哈希。');
  }
  if (selectionMode !== 'template' && (templateKey !== null || templateVersion !== null || templateHash !== null)) {
    throw new Error('自定义或不使用推进参考时，不应绑定系统模板版本。');
  }
  const beats = requireRecordArray(value.beats, '推进节点').map((item) => {
    const authorAdjustment = optionalText(item.authorAdjustment, '作者调整');
    return {
      beatId: requireText(item.beatId, '推进节点标识'),
      publicFunction: requireText(item.publicFunction, '推进节点作用'),
      expectedChange: requireText(item.expectedChange, '推进节点变化'),
      optional: requireBoolean(item.optional, '推进节点可选状态'),
      order: requirePositiveInteger(item.order, '推进节点顺序'),
      authorIdeaRefs: requireUniqueTextArray(item.authorIdeaRefs, '推进节点作者想法'),
      ...(authorAdjustment === null ? {} : { authorAdjustment })
    };
  });
  return {
    selectionMode,
    templateKey,
    templateVersion,
    templateHash,
    scope,
    beats,
    customDirection: optionalText(value.customDirection, '自定义推进方向')
  };
}

export function parseVersionReferences(input: unknown): VersionReference[] {
  const values = requireRecordArray(input, '依赖版本').map((item) => ({
    kind: requireOneOf(item.kind, [
      'book_profile', 'setting', 'volume_plan', 'story_event', 'chapter_outline', 'chapter', 'settlement', 'canon_revision'
    ] as const, '依赖类型'),
    id: requireText(item.id, '依赖标识'),
    version: requireNonNegativeInteger(item.version, '依赖版本'),
    contentHash: requireHash(item.contentHash, '依赖哈希'),
    required: requireBoolean(item.required, '必要依赖状态')
  }));
  const keys = values.map((item) => `${item.kind}:${item.id}:${item.version}`);
  if (new Set(keys).size !== keys.length) throw new Error('依赖版本不能重复。');
  return values;
}
export const AUTHOR_PLANNING_INPUT_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['surface', 'subjectType', 'subjectId', 'intentStrength', 'originalText', 'attachmentRefs', 'scopeNotes'],
  properties: {
    surface: { enum: authorInputSurfaces },
    subjectType: { type: 'string', minLength: 1 },
    subjectId: { type: ['string', 'null'] },
    intentStrength: { enum: authorIntentStrengths },
    originalText: { type: 'string', minLength: 1 },
    attachmentRefs: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
    mentionedAgentIds: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
    scopeNotes: { type: ['string', 'null'] }
  }
} as const;

export function parseAuthorPlanningInputDraft(input: unknown): AuthorPlanningInputDraft {
  const value = requireRecord(input, '作者想法');
  return {
    surface: requireOneOf(value.surface, authorInputSurfaces, '作者想法位置'),
    subjectType: requireText(value.subjectType, '目标类型'),
    subjectId: optionalText(value.subjectId, '目标ID'),
    intentStrength: requireOneOf(value.intentStrength, authorIntentStrengths, '意图强度'),
    originalText: requireText(value.originalText, '作者原话'),
    attachmentRefs: requireUniqueTextArray(value.attachmentRefs, '附件引用'),
    mentionedAgentIds: requireUniqueTextArray(value.mentionedAgentIds ?? [], '点名成员'),
    scopeNotes: optionalText(value.scopeNotes, '作用范围说明')
  };
}

export function isCreationWorkflowStage(value: unknown): value is CreationWorkflowStage {
  return typeof value === 'string' && (creationWorkflowStages as readonly string[]).includes(value);
}

export function isPlanningVersionStatus(value: unknown): value is PlanningVersionStatus {
  return typeof value === 'string' && (planningVersionStatuses as readonly string[]).includes(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field}必须是对象。`);
  return value as Record<string, unknown>;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field}不能为空。`);
  return value.trim();
}

function optionalText(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${field}必须是文字或留空。`);
  return value.trim().length === 0 ? null : value.trim();
}

function requireUniqueTextArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field}必须是列表。`);
  const items = value.map((item) => requireText(item, field));
  return [...new Set(items)];
}

function requireRecordArray(value: unknown, field: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error(`${field}必须是列表。`);
  return value.map((item) => requireRecord(item, field));
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field}必须是真或假。`);
  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${field}必须是大于0的整数。`);
  return Number(value);
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${field}必须是非负整数。`);
  return Number(value);
}

function optionalPositiveInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return requirePositiveInteger(value, field);
}

function requireHash(value: unknown, field: string): string {
  const hash = requireText(value, field);
  if (!/^(?:[a-f0-9]{64}|sha256:[a-f0-9]{64})$/u.test(hash)) throw new Error(`${field}格式无效。`);
  return hash;
}

function optionalHash(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return requireHash(value, field);
}

function parseEstimatedChapterRange(input: unknown): { minimum: number | null; likely: number | null; maximum: number | null } {
  const value = requireRecord(input, '预估章节范围');
  const result = {
    minimum: optionalPositiveInteger(value.minimum, '最少章节数'),
    likely: optionalPositiveInteger(value.likely, '常见章节数'),
    maximum: optionalPositiveInteger(value.maximum, '最多章节数')
  };
  const ordered = [result.minimum, result.likely, result.maximum].filter((item): item is number => item !== null);
  if (ordered.some((item, index) => index > 0 && item < ordered[index - 1]!)) {
    throw new Error('预估章节范围必须从少到多填写。');
  }
  return result;
}

function parseCreativeBoundarySet(input: unknown): CreativeBoundarySet {
  const value = requireRecord(input, '创作边界');
  return {
    mustAchieve: requireUniqueTextArray(value.mustAchieve, '必须达成'),
    mustNotViolate: requireUniqueTextArray(value.mustNotViolate, '不能违反'),
    creativeFreedom: requireUniqueTextArray(value.creativeFreedom, '自由发挥空间'),
    openQuestions: requireUniqueTextArray(value.openQuestions, '待探索问题')
  };
}
function requireOneOf<const T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw new Error(`${field}不是支持的值。`);
  }
  return value as T[number];
}