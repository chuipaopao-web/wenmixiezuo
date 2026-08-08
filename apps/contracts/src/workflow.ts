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
  attachmentRefs: string[];
  scopeNotes: string | null;
  status: AuthorInputStatus;
  appliedToRefs: VersionReference[];
  handlingReason: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface AuthorPlanningInputDraft {
  surface: AuthorInputSurface;
  subjectType: string;
  subjectId: string | null;
  intentStrength: AuthorIntentStrength;
  originalText: string;
  attachmentRefs: string[];
  scopeNotes: string | null;
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

function requireOneOf<const T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw new Error(`${field}不是支持的值。`);
  }
  return value as T[number];
}