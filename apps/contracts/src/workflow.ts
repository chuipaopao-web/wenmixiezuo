export const CREATION_WORKFLOW_CONTRACT_VERSION = 1 as const;

export const authorInputSurfaces = [
  'book_profile', 'setting', 'volume_plan', 'event', 'chapter_outline', 'manuscript'
] as const;
export type AuthorInputSurface = typeof authorInputSurfaces[number];

/**
 * 作者界面的正式功能名称。功能键和数据库 surface 保持稳定，显示名称可独立演进。
 * 这份共享合同由 Web 和 API 共同使用，禁止在各端再维护第二套名称表。
 */
export const workspaceFunctionLabels = {
  framework: '信息',
  basic: '设定',
  master: '分卷',
  event: '规划',
  chapter: '章纲',
  manuscript: '正文',
  library: '资料库',
  naming: '取名',
  team: '团队',
  tasks: '任务',
  ideas: '灵感',
  settings: '设置'
} as const;

export const workspacePrimaryFunctionKeys = [
  'framework', 'basic', 'master', 'event', 'chapter', 'manuscript', 'library', 'naming'
] as const;
export const workspaceUtilityFunctionKeys = ['team', 'tasks', 'ideas', 'settings'] as const;
export type WorkspacePrimaryFunctionKey = typeof workspacePrimaryFunctionKeys[number];
export type WorkspaceUtilityFunctionKey = typeof workspaceUtilityFunctionKeys[number];
export type WorkspaceFunctionKey = WorkspacePrimaryFunctionKey | WorkspaceUtilityFunctionKey;

export const workspaceFunctionAuthorInputSurfaces: Partial<Record<WorkspacePrimaryFunctionKey, AuthorInputSurface>> = {
  framework: 'book_profile',
  basic: 'setting',
  master: 'volume_plan',
  event: 'event',
  chapter: 'chapter_outline',
  manuscript: 'manuscript'
};

export function workspaceFunctionLabel(key: WorkspaceFunctionKey): string {
  return workspaceFunctionLabels[key];
}

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
  kind: 'book_profile' | 'setting' | 'volume_plan' | 'story_event' | 'event_chapter_sequence' | 'chapter_outline' | 'chapter' | 'settlement' | 'canon_revision';
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

export interface PlanningTemplateReference {
  templateKey: string;
  templateVersion: number;
  templateHash: string;
}

export interface PlanningTemplateInstance {
  selectionMode: TemplateSelectionMode;
  templateKey: string | null;
  templateVersion: number | null;
  templateHash: string | null;
  templateRefs?: PlanningTemplateReference[];
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

export interface EventChapterClosureCoverage {
  endingCondition: string;
  evidenceChapterNumber: number;
}

export interface EventChapterSequenceContent {
  eventTitle: string;
  startChapterNumber: number;
  chapters: ChapterOutlineContent[];
  eventEndingConditions: string[];
  closureCoverage: EventChapterClosureCoverage[];
  flexibilityNotes: string[];
}

export const chapterChallengeFocusValues = [
  'chapter_structure', 'opening_pressure', 'core_conflict', 'choice_and_cost', 'turning_point', 'ending_hook', 'next_chapter_interface'
] as const;
export type ChapterChallengeFocus = typeof chapterChallengeFocusValues[number];
export interface ChapterChallengeSuggestion {
  focus: ChapterChallengeFocus;
  alternative: string;
  benefit: string;
  tradeoff: string;
  downstreamImpact: string;
}
export interface EventChapterChallengeContent {
  targetKind: 'sequence' | 'detail';
  targetId: string;
  targetVersionId: string;
  summary: string;
  suggestions: ChapterChallengeSuggestion[];
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

export function parseStoryEventContent(input: unknown): StoryEventContent {
  const value = requireRecord(input, '事件规划');
  return {
    title: requireText(value.title, '事件标题'),
    volumeResponsibility: requireText(value.volumeResponsibility, '事件对本卷的作用'),
    startingState: requireText(value.startingState, '事件开始状态'),
    trigger: requireText(value.trigger, '事件触发条件'),
    participants: requireUniqueTextArray(value.participants, '参与人物'),
    characterGoals: requireUniqueTextArray(value.characterGoals, '人物目标'),
    obstacles: requireUniqueTextArray(value.obstacles, '主要阻力'),
    choicesAndCosts: requireUniqueTextArray(value.choicesAndCosts, '选择与代价'),
    informationMoves: requireUniqueTextArray(value.informationMoves, '信息推进'),
    localProgression: requireUniqueTextArray(value.localProgression, '事件内部推进'),
    requiredResult: requireText(value.requiredResult, '事件必须得到的结果'),
    flexibleExecution: requireUniqueTextArray(value.flexibleExecution, '自由发挥空间'),
    endingConditions: requireUniqueTextArray(value.endingConditions, '事件结束条件'),
    nextEventImpact: requireText(value.nextEventImpact, '下一事件接口'),
    characterArcImpact: requireText(value.characterArcImpact, '人物变化作用'),
    volumeClimaxImpact: requireText(value.volumeClimaxImpact, '卷高潮作用'),
    estimatedChapterRange: parseEstimatedChapterRange(value.estimatedChapterRange),
    uncertaintyNotes: requireUniqueTextArray(value.uncertaintyNotes, '未知与待确认')
  };
}
export function parseChapterOutlineContent(input: unknown): ChapterOutlineContent {
  const value = requireRecord(input, '章纲');
  const chapterNumber = requirePositiveInteger(value.chapterNumber, '章号');
  const storyBeats = requireUniqueTextArray(value.storyBeats, '剧情推进节点');
  const creativeFreedom = requireUniqueTextArray(value.creativeFreedom, '自由创作区');
  if (storyBeats.length === 0) throw new Error('章纲至少需要一个推进节点。');
  if (creativeFreedom.length === 0) throw new Error('章纲必须保留自由创作空间。');
  return {
    chapterNumber,
    title: requireText(value.title, '章节标题'),
    eventResponsibility: requireText(value.eventResponsibility, '本章对事件的作用'),
    openingState: requireText(value.openingState, '开章状态'),
    characterGoals: requireUniqueTextArray(value.characterGoals, '人物目标'),
    conflicts: requireUniqueTextArray(value.conflicts, '冲突与阻力'),
    choicesAndCosts: requireUniqueTextArray(value.choicesAndCosts, '选择与代价'),
    informationChanges: requireUniqueTextArray(value.informationChanges, '信息变化'),
    storyBeats,
    endingState: requireText(value.endingState, '章末状态'),
    nextChapterInterface: requireText(value.nextChapterInterface, '下一章接口'),
    softSuggestions: requireUniqueTextArray(value.softSuggestions, '软建议'),
    creativeFreedom
  };
}

export function parseEventChapterSequenceContent(input: unknown): EventChapterSequenceContent {
  const value = requireRecord(input, '事件章纲序列');
  const startChapterNumber = requirePositiveInteger(value.startChapterNumber, '事件起始章号');
  if (!Array.isArray(value.chapters) || value.chapters.length === 0 || value.chapters.length > 50) {
    throw new Error('事件章纲序列必须包含一至五十章。');
  }
  const chapters = value.chapters.map(parseChapterOutlineContent);
  chapters.forEach((chapter, index) => {
    if (chapter.chapterNumber !== startChapterNumber + index) throw new Error('事件章号必须从起始章连续递增。');
  });
  const eventEndingConditions = requireUniqueTextArray(value.eventEndingConditions, '事件结束条件');
  if (eventEndingConditions.length === 0) throw new Error('事件章纲序列必须保留事件结束条件。');
  if (!Array.isArray(value.closureCoverage)) throw new Error('事件闭环说明必须是列表。');
  const closureCoverage = value.closureCoverage.map((item) => {
    const coverage = requireRecord(item, '事件闭环说明');
    return {
      endingCondition: requireText(coverage.endingCondition, '闭环条件'),
      evidenceChapterNumber: requirePositiveInteger(coverage.evidenceChapterNumber, '闭环发生章')
    };
  });
  if (new Set(closureCoverage.map((item) => item.endingCondition)).size !== closureCoverage.length) {
    throw new Error('每项事件结束条件只能登记一次闭环位置。');
  }
  if (closureCoverage.some((item) => item.evidenceChapterNumber < startChapterNumber
    || item.evidenceChapterNumber >= startChapterNumber + chapters.length)) {
    throw new Error('事件闭环位置必须属于当前事件章纲序列。');
  }
  return {
    eventTitle: requireText(value.eventTitle, '事件名称'),
    startChapterNumber,
    chapters,
    eventEndingConditions,
    closureCoverage,
    flexibilityNotes: requireUniqueTextArray(value.flexibilityNotes, '序列弹性说明')
  };
}

export function parseEventChapterChallengeContent(input: unknown): EventChapterChallengeContent {
  const value = requireRecord(input, '章纲挑战意见');
  if (!Array.isArray(value.suggestions) || value.suggestions.length < 1 || value.suggestions.length > 3) {
    throw new Error('章纲挑战意见必须包含一至三条关键建议。');
  }
  const suggestions = value.suggestions.map((item) => {
    const suggestion = requireRecord(item, '章纲挑战建议');
    return {
      focus: requireOneOf(suggestion.focus, chapterChallengeFocusValues, '挑战重点'),
      alternative: requireText(suggestion.alternative, '另一种走法'),
      benefit: requireText(suggestion.benefit, '可能收益'),
      tradeoff: requireText(suggestion.tradeoff, '需要承担的代价'),
      downstreamImpact: requireText(suggestion.downstreamImpact, '对后文的影响')
    };
  });
  if (new Set(suggestions.map((item) => item.focus)).size !== suggestions.length) {
    throw new Error('同一挑战重点只能提出一次。');
  }
  return {
    targetKind: requireOneOf(value.targetKind, ['sequence', 'detail'] as const, '挑战目标类型'),
    targetId: requireText(value.targetId, '挑战目标'),
    targetVersionId: requireText(value.targetVersionId, '挑战目标版本'),
    summary: requireText(value.summary, '挑战意见摘要'),
    suggestions
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
  const templateRefs = requireRecordArray(value.templateRefs ?? [], '混合推进参考').map((item) => ({
    templateKey: requireText(item.templateKey, '混合推进参考标识'),
    templateVersion: requirePositiveInteger(item.templateVersion, '混合推进参考版本'),
    templateHash: requireHash(item.templateHash, '混合推进参考哈希')
  }));
  if (new Set(templateRefs.map((item) => item.templateKey)).size !== templateRefs.length) {
    throw new Error('混合推进参考不能重复。');
  }
  if (selectionMode === 'template' && (templateKey === null || templateVersion === null || templateHash === null)) {
    throw new Error('选择系统推进参考时，必须记录模板标识、版本和哈希。');
  }
  if (selectionMode !== 'template' && (templateKey !== null || templateVersion !== null || templateHash !== null)) {
    throw new Error('自定义或不使用推进参考时，不应绑定系统模板版本。');
  }
  if (selectionMode !== 'template' && templateRefs.length > 0) {
    throw new Error('自定义或不使用推进参考时，不应绑定混合模板。');
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
    ...(templateRefs.length > 0 ? { templateRefs } : {}),
    scope,
    beats,
    customDirection: optionalText(value.customDirection, '自定义推进方向')
  };
}

export function parseVersionReferences(input: unknown): VersionReference[] {
  const values = requireRecordArray(input, '依赖版本').map((item) => ({
    kind: requireOneOf(item.kind, [
      'book_profile', 'setting', 'volume_plan', 'story_event', 'event_chapter_sequence', 'chapter_outline', 'chapter', 'settlement', 'canon_revision'
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
