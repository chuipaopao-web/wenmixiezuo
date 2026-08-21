import type {
  AuthorInputSurface,
  AuthorPlanningInput,
  CreateAuthorPlanningInputCommand,
  DecideAuthorPlanningInputCommand,
  NarrativeTemplateCatalogView,
  CreationWorkflowStateView,
  PlanningTemplateInstance,
  PlanningScope,
  EventChainContent,
  FirstChapterLaunchContract,
  EventChainVersion,
  VolumeDirectionContent,
  VolumeRouteSelection,
  VolumePlanContent,
  StoryEventContent,
  ChapterOutlineContent,
  EventChapterChallengeContent,
  EventChapterSequenceContent
} from '@wenmi/contracts';
import { authorErrorMessage } from './author-error';
export { authorErrorFromUnknown } from './author-error';
import { membershipBlockReasonFromAction, membershipBlockReasonFromCode, raiseMembershipBlocked } from '../../features/shared/membership-gate';


export interface AuthAccountData {
  userId: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  status: 'active' | 'suspended';
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface AdminOverviewData {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  totalBooks: number;
  totalTokens: number;
}

export interface HealthData {
  service: string;
  status: string;
  releaseId: string;
  time: string;
}

export interface CapabilityData {
  releaseId: string;
  checkedAt: string;
  runtime: {
    platform: string;
    architecture: string;
    nodeVersion: string;
    logicalCpuCount: number;
    totalMemoryBytes: number;
    freeMemoryBytes: number;
    dataVolumeFreeBytes: number;
  };
  sqlite: { version: string; foreignKeys: boolean; trustedSchema: boolean; json: boolean; fts5: boolean };
  dependencies: Array<{ capability: string; packageName: string; status: 'available' | 'missing' }>;
  modelAssets: Array<{ assetId: string; kind: string; modelId: string; status: 'verified' | 'missing' | 'invalid' }>;
  modelRuntime: {
    requestedMode: 'deterministic' | 'subscription-plan';
    activeMode: 'deterministic' | 'subscription-plan';
    strictPlanOnly: boolean;
    cashFallbackAllowed: boolean;
    missingCredentials: Array<'coding-plan' | 'agent-plan'>;
    profiles: Array<{
      provider: string;
      modelId: string;
      plan: 'deterministic' | 'codex' | 'coding' | 'agent' | 'opencodego';
      roles: string[];
      credentialConfigured: boolean;
    }>;
  };
  degradation: { active: boolean; missingCapabilities: string[]; vectorSearchAvailable: boolean; localModelAssetsReady: boolean };
}

export interface BookData {
  bookId: string;
  title: string;
  status: string;
  version: number;
  canonRevision: number;
  positioningVersion: number;
  updatedAt: string;
}

export interface IdeationMemberData extends AgentData {
  host: boolean;
}

export interface IdeationRoundData {
  roundId: string;
  taskId: string;
  status: string;
  phase: string;
  errorCode: string | null;
  authorMessage: string;
  createdAt: string;
  updatedAt: string;
  responses: Array<{
    opinionId: string;
    agentId: string;
    memberName: string;
    roleKey: string;
    provider: string;
    modelId: string;
    content: string;
    createdAt: string;
  }>;
}

export interface SettingOutlineWorkspaceData {
  itemKey: string;
  groupTitle: string;
  label: string;
  prompt: string;
  sourceLabel: string;
  status: '待讨论' | '讨论中' | '候选待确认' | '已确认' | '稍后补充' | '刻意留白' | '不适用';
  custom: boolean;
  sortOrder: number;
  content: string | null;
  sourceDiscussionId: string | null;
  sourceDecisionId: string | null;
  candidateAt: string | null;
  confirmedAt: string | null;
  /** 已确认条目重新设计出的新方案：作者确认前挂在待定区，正式内容不变。 */
  pendingCandidate: string | null;
  pendingCandidateAt: string | null;
  updatedAt: string;
}

export interface SettingOutlineItemVersionData {
  itemKey: string;
  versionNo: number;
  content: string;
  sourceKind: 'manual' | 'guidance' | 'discussion';
  sourceDiscussionId: string | null;
  sourceDecisionId: string | null;
  createdAt: string;
}

export interface SettingCollaborationData {
  item: SettingOutlineWorkspaceData;
  screenwriters: Array<{
    agentId: string | null;
    memberName: string;
    roleKey: 'lead_screenwriter' | 'second_screenwriter' | 'third_screenwriter' | 'senior_screenwriter';
    availability: 'available' | 'unavailable';
    availabilityReason: string | null;
    highCompute: boolean;
  }>;
  panel: null | {
    recoveryKey: string;
    taskStatus: string;
    discussionStatus: string;
    createdAt: string;
    updatedAt: string;
    proposals: Array<{
      number: number;
      proposalId: string;
      agentId: string | null;
      memberName: string;
      roleKey: string | null;
      content: string;
      benefits: string[];
      costs: string[];
      createdAt: string;
      fragments: Array<{
        fragmentId: string;
        fragmentNo: number;
        text: string;
        implicit: boolean;
      }>;
    }>;
    members: Array<{
      agentId: string;
      memberName: string;
      roleKey: string;
      status: 'preparing' | 'working' | 'completed' | 'failed' | 'unavailable' | 'paused';
      contextSummary: string;
      outputSummary: string | null;
      errorSummary: string | null;
      retryable: boolean;
      lastAttemptedAt: string | null;
    }>;
  };
  revisionTask: null | {
    recoveryKey: string;
    status: string;
    updatedAt: string;
  };
  historyCount: number;
  fusionDraft: null | {
    selectedFragmentIds: string[];
    segments: Array<{
      text: string;
      source: 'fragment' | 'stitch';
      fragmentId: string | null;
      memberName: string | null;
    }>;
    content: string;
    createdAt: string;
  };
  impact: {
    changesCanon: false;
    changesManuscript: false;
    formalVersionTiming: 'setting_baseline_confirmation';
  };
}

export type OpeningChannel = 'male' | 'female';
export type BookCreationMode = 'new' | 'continuation';
export type ProtagonistRole = 'male_lead' | 'female_lead' | 'co_lead' | 'ensemble' | 'non_human'
  | 'male_support' | 'female_support' | 'male_villain' | 'female_villain';

export interface OpeningTaxonomyData {
  version: string;
  sourceLabel: string;
  sourceUrl: string;
  updatedAt: string;
  notice: string;
  categories: Array<{ key: string; name: string; channel: OpeningChannel; description: string; recommendedMainTags: string[]; tagPackKeys: string[] }>;
  mainTags: string[];
  auxiliaryTags: string[];
  storyTraits: string[];
  styleTones: string[];
  personalityOptions: string[];
  personalityGroups: Array<{ key: string; name: string; description: string; options: string[] }>;
  boundaryGroups: Array<{ name: string; description: string; options: string[] }>;
  subjects: Array<{ name: string; packKeys: string[] }>;
  tagGroups: Array<{
    key: string;
    name: string;
    description: string;
    packKeys: string[];
    mainTags: string[];
    auxiliaryTags: string[];
    storyTraits: string[];
  }>;
}

export interface OpeningBlueprintData {
  creationMode: BookCreationMode;
  taxonomyVersion: string;
  channel: OpeningChannel;
  categoryKey: string;
  auxiliaryCategoryKeys?: string[];
  targetAudience: string;
  protagonists: Array<{
    role: ProtagonistRole;
    name: string;
    age: string;
    background?: string;
    familyBackground?: string;
    careerBackground?: string;
    goldenFinger?: string;
    personalities: string[];
  }>;
  storyDirection: string;
  openingStart?: string;
  storyEnding?: string;
  stylePrimary?: string;
  styleSecondary?: string;
  worldBackground: string;
  openingBackground: string;
  stageOne: { start: string; development: string; end: string };
  fullBookOutline: string;
  mainTags: string[];
  auxiliaryTags: string[];
  storyTraits: string[];
  styleIntent: {
    languageTones: string[];
    emotionalTones: string[];
    pacingAndPayoff: string[];
    atmospheres: string[];
    custom: string[];
  };
  customTags: string[];
  initialMap: string;
  mustFollow: string[];
}

export interface BookProfileViewData {
  title: string;
  channel: string;
  category: string;
  subjects: string[];
  mainTags: string[];
  customTags: string[];
  protagonists: OpeningBlueprintData['protagonists'];
  synopsis: string;
  storyDirection: string;
  openingStart: string;
  storyEnding: string;
  stylePrimary: string;
  styleSecondary: string;
  mustFollow: string[];
  style: OpeningBlueprintData['styleIntent'];
  source: string;
  version: number;
  openingBlueprint: OpeningBlueprintData;
}

export interface PlanningStateData {
  version: number;
  stage: string;
  stageLabel: string;
  missing: string[];
  nextAction: string;
}

export type VolumePlanCandidateKind = 'candidate_a' | 'candidate_b' | 'author_edit' | 'fusion' | 'legacy';

export interface VolumePlanVersionData {
  volumePlanVersionId: string;
  volumePlanId: string;
  version: number;
  parentVersionId: string | null;
  status: 'candidate' | 'active' | 'superseded' | 'archived';
  candidateKind: VolumePlanCandidateKind;
  dependencies: CreationWorkflowStateView['frozenChapterOutlineRefs'];
  template: PlanningTemplateInstance;
  authorInputRefs: string[];
  content: VolumePlanContent;
  contentHash: string;
  sourceTaskId: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface VolumePlanData {
  volumePlanId: string;
  planNumber: number;
  physicalVolumeId: string | null;
  previousVolumePlanId: string | null;
  previousSettlementId: string | null;
  status: 'planning' | 'active' | 'completed' | 'archived';
  revision: number;
  activeVersionId: string | null;
  activeVersion: VolumePlanVersionData | null;
  createdAt: string;
  updatedAt: string;
}

export interface VolumePlanImpactData {
  volumePlanId: string;
  candidateVersionId: string;
  activeVersionId: string | null;
  changedFields: string[];
  downstreamDependencyCount: number;
  requiresDownstreamReview: boolean;
  note: string;
}

export interface AuthorGenerationStateData {
  stateText: string;
  phaseText: string;
  isRunning: boolean;
  isCompleted: boolean;
  canCancel: boolean;
  canResume: boolean;
  canRetry: boolean;
  errorMessage: string | null;
  members: Array<{ roleKey: string; displayName: string }>;
}

export interface VolumePlanGenerationData extends AuthorGenerationStateData {
  candidateVersionIds: { candidateA: string | null; candidateB: string | null; fusion: string | null };
  createdAt: string;
  updatedAt: string;
}
export interface VolumeDirectionVersionData {
  volumeDirectionVersionId: string;
  volumePlanId: string;
  legacyVolumePlanVersionId: string | null;
  version: number;
  proposalId: string;
  candidateKind: 'candidate_a' | 'candidate_b' | 'author_edit' | 'fusion' | 'legacy_projection';
  status: 'candidate' | 'active' | 'superseded' | 'archived';
  parentVersionId: string | null;
  sourceVersionIds: string[];
  authorInputRefs: string[];
  content: VolumeDirectionContent;
  contentHash: string;
  createdAt: string;
  confirmedAt: string | null;
}
export type StoryEventCandidateKind = 'candidate_a' | 'candidate_b' | 'author_edit' | 'fusion' | 'volume_seed';

export interface StoryEventVersionData {
  storyEventVersionId: string;
  eventId: string;
  version: number;
  parentVersionId: string | null;
  status: 'candidate' | 'active' | 'superseded' | 'archived';
  candidateKind: StoryEventCandidateKind;
  volumePlanVersionId: string;
  previousSettlementId: string | null;
  dependencies: CreationWorkflowStateView['frozenChapterOutlineRefs'];
  template: PlanningTemplateInstance;
  authorInputRefs: string[];
  content: StoryEventContent;
  contentHash: string;
  sourceTaskId: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface StoryEventData {
  eventId: string;
  volumePlanId: string;
  order: number;
  status: 'planning' | 'active' | 'settled' | 'archived';
  revision: number;
  previousEventId: string | null;
  activeVersionId: string | null;
  activeVersion: StoryEventVersionData | null;
  latestVersion: StoryEventVersionData | null;
  downstreamDependencyCount: number;
  createdAt: string;
  updatedAt: string;
}

export type EventOperationProposal =
  | { operationKind: 'reorder'; eventIds: string[] }
  | { operationKind: 'insert'; afterEventId: string | null; content: StoryEventContent }
  | { operationKind: 'split'; eventId: string; first: StoryEventContent; second: StoryEventContent }
  | { operationKind: 'merge'; eventIds: [string, string]; merged: StoryEventContent };

export interface EventOperationImpactData {
  affectedEventIds: string[];
  settledEventIds: string[];
  activeEventIds: string[];
  downstreamDependencyCount: number;
  resultingTitles: string[];
  blocked: boolean;
  note: string;
}

export interface EventOperationData {
  operationId: string;
  operationKind: EventOperationProposal['operationKind'];
  expectedSequenceRevision: number;
  resultSequenceRevision: number | null;
  proposal: EventOperationProposal;
  impact: EventOperationImpactData;
  status: 'previewed' | 'applied' | 'cancelled';
  createdAt: string;
  appliedAt: string | null;
}

export interface EventChainGenerationData extends AuthorGenerationStateData {
  candidateEventChainId: string | null;
}
export interface EventSequenceData {
  volumePlanId: string;
  volumePlanVersionId: string;
  revision: number;
  events: StoryEventData[];
  operations: EventOperationData[];
  updatedAt: string;
}

export interface StoryEventImpactData {
  eventId: string;
  candidateVersionId: string;
  activeVersionId: string | null;
  changedFields: string[];
  downstreamDependencyCount: number;
  requiresDownstreamReview: boolean;
  note: string;
}

export interface StoryEventGenerationData extends AuthorGenerationStateData {
  candidateVersionIds: { candidateA: string | null; candidateB: string | null; fusion: string | null };
  createdAt: string;
  updatedAt: string;
}
export interface ChapterOutlineV2Data {
  outlineSchema:'chapter_outline_v2';chapterNumber:number;title:string;chapterFunction:string;openingState:string;requiredEndingState:string;
  cast:Array<{name:string;objective:string;knowledgeBoundary:string;chapterRole:string;stateChange?:string}>;
  conflict:{surface:string;underlying?:string;oppositionGoal?:string;failureCost:string;successCost?:string};
  plotBeats:Array<{order:number;trigger:string;action:string;resistance?:string;turn?:string;result:string}>;
  experience?:{primaryTone?:string;emotionalCurve:string[];payoffPoints:string[];pressurePoints:string[];readerEffect?:string};
  ending:{result:string;stateChanges:string[];hook:string;nextChapterInterface:string};
  mustImplement:string[];mustNotViolate:string[];allowedCandidates:string[];creativeFreedom:string[];
  firstChapterLaunch?:FirstChapterLaunchContract;
}
export interface EventChapterSequenceVersionData {
  sequenceVersionId:string;sequenceId:string;version:number;parentVersionId:string|null;
  status:'candidate'|'active'|'superseded'|'archived';dependencies:CreationWorkflowStateView['frozenChapterOutlineRefs'];
  authorInputRefs:string[];content:EventChapterSequenceContent;contentHash:string;sourceTaskId:string|null;
  createdAt:string;confirmedAt:string|null;
}
export interface EventChapterOutlineVersionData {
  outlineVersionId:string;outlineId:string;version:number;parentVersionId:string|null;
  status:'candidate'|'frozen'|'superseded'|'archived';sequenceVersionId:string;
  dependencies:CreationWorkflowStateView['frozenChapterOutlineRefs'];authorInputRefs:string[];
  content:ChapterOutlineV2Data;contentHash:string;artifactVersionId:string|null;sourceTaskId:string|null;
  createdAt:string;frozenAt:string|null;
}
export interface EventChapterOutlineData {
  outlineId:string;eventId:string;chapterNumber:number;order:number;revision:number;
  status:'planned'|'candidate'|'frozen'|'settled'|'stale'|'archived';activeVersionId:string|null;
  planned:ChapterOutlineContent;activeVersion:EventChapterOutlineVersionData|null;
  versions:EventChapterOutlineVersionData[];createdAt:string;updatedAt:string;
}
export interface EventChapterSequenceData {
  sequenceId:string;eventId:string;eventVersionId:string;volumePlanVersionId:string;revision:number;
  status:'planning'|'active'|'completed'|'stale'|'archived';activeVersionId:string|null;
  activeVersion:EventChapterSequenceVersionData|null;versions:EventChapterSequenceVersionData[];
  outlines:EventChapterOutlineData[];nextChapterNumber:number;valid:boolean;createdAt:string;updatedAt:string;
}
export interface EventChapterGenerationData extends AuthorGenerationStateData {
  kind:'sequence'|'details'|'sequence_challenge'|'detail_challenge';
  challenge?:EventChapterChallengeContent;
  createdAt:string;
  updatedAt:string;
}export interface SettingGapData {
  gapId:string;scopeType:'volume'|'event'|'chapter';scopeId:string;question:string;whyNeeded:string;affectedObjects:string[];
  decision:'design_now'|'not_used_this_volume'|'keep_unknown'|null;status:'pending'|'needs_setting'|'decided';
  resolvedSettingVersionId:string|null;createdAt:string;updatedAt:string;
}
export interface StoryThreadData {
  threadId:string;threadKey:string;title:string;type:'promise'|'foreshadowing'|'question'|'relationship'|'inner_change'|'conflict'|'identity_resource_emotion';
  scopeType:'book'|'volume'|'event';scopeId:string;status:'planned'|'planted'|'advanced'|'due'|'resolved'|'abandoned_by_author';
  plannedWindow:Record<string,unknown>|null;actualEvidenceCount:number;abandonmentReason:string|null;revision:number;updatedAt:string;
}
export interface FirstVolumeLaunchProgressData {
  volumePlanId:string;volumeDirectionVersionId:string;totalEffectiveCharacters:number;latestSettledChapterNumber:number;
  climaxStatus:'planned'|'approaching'|'at_risk'|'completed'|'completed_late'|'overdue';climaxEventId:string|null;
  climaxCompletedAtEffectiveCharacters:number|null;prediction:Record<string,unknown>;
  actualEvidence:Record<string,unknown>|null;updatedAt:string;
}
export interface PlanningSettlementData {
  settlementId:string;stageKind:'event'|'volume';stageObjectId:string;planVersionId:string;version:number;
  chapterStart:number;chapterEnd:number;canonRevision:number;planned:unknown;actual:unknown;deviation:unknown;createdAt:string;
}
export interface SettlementPacingReportData {
  overallAssessment:string;payoffPlacement:string;climaxSpacing:string;pressureDuration:string;
  recoveryBeats:string;risks:string[];suggestions:string[];
}
export interface SettlementFollowUpData {
  taskId:string;status:string;currentPhase:string;errorCode:string|null;
  stageKind:'event'|'volume';stageObjectId:string;settlementId:string;
  pacingReport:SettlementPacingReportData|null;summary:string|null;
  pacingBy:{agentId:string;displayName:string}|null;summaryBy:{agentId:string;displayName:string}|null;
  createdAt:string;updatedAt:string;
}
export interface ExpressionProfileData {
  expressionProfileId:string;version:number;narrativePerson:'first'|'third'|'mixed'|null;
  viewpointDistance:'close'|'medium'|'distant'|'adaptive'|null;languageTone:unknown;
  textDensity:'light'|'balanced'|'dense'|'adaptive'|null;targetAudience:string|null;
  contentBoundaries:unknown;humorSeriousness:'humorous'|'balanced'|'serious'|'adaptive'|null;
  voiceEvidence:unknown;impactScope:unknown;status:'provisional'|'confirmed'|'superseded'|'archived';
}
export interface ChapterBatchData {
  batchId:string;chapterIds:string[];taskIds:string[];nextIndex:number;
  status:'pending'|'working'|'paused'|'failed'|'completed'|'cancelled';checkpoint:Record<string,unknown>;
}
export interface OpeningSynopsisAnalysisData {
  schemaVersion: 'opening-synopsis-suggestions-v1';
  analysisMode: 'local-deterministic';
  taxonomyVersion: string;
  synopsisLength: number;
  suggestions: {
    title: string | null;
    channel: OpeningChannel | null;
    categoryKey: string | null;
    protagonist: {
      role: ProtagonistRole;
      name: string;
      age: string | null;
      background: string | null;
      personalities: string[];
    } | null;
    worldBackground: string | null;
    openingBackground: string | null;
    stageOne: { start: string | null; development: string | null; end: string | null };
    fullBookOutline: string;
    initialMap: string | null;
    mainTags: string[];
    auxiliaryTags: string[];
    storyTraits: string[];
    mustFollow: string[];
  };
  recognizedFields: string[];
  unresolvedFields: string[];
  evidence: Array<{ field: string; excerpt: string }>;
}

export interface ChapterData {
  chapterId: string;
  volumeId?: string;
  chapterNumber: number;
  title: string;
  planStatus: string;
  generationStatus: string;
  settlementStatus: string;
  currentManuscriptVersionId: string | null;
  canonManuscriptVersionId: string | null;
}

export interface ContinuationImportChapterData {
  importChapterId: string;
  ordinal: number;
  detectedTitle: string;
  title: string;
  characterCount: number;
  contentHash: string;
  included: boolean;
  status: string;
  targetChapterNumber: number | null;
  targetChapterId: string | null;
  targetManuscriptVersionId: string | null;
}

export interface ContinuationImportData {
  importId: string;
  sourceName: string;
  sourceHash: string;
  parserVersion: string;
  status: 'parsed' | 'importing' | 'failed' | 'ready' | 'cancelled';
  sourceCharacterCount: number;
  includedChapterCount: number;
  importedChapterCount: number;
  lastCompletedOrdinal: number;
  warnings: string[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  chapters: ContinuationImportChapterData[];
  analysis: {
    status: 'not_started' | 'pending' | 'analyzing' | 'ready' | 'failed';
    analyzedChapterCount: number;
    totalChapterCount: number;
    summary: string | null;
    structuredData: Record<string, unknown> | null;
    activeTaskId: string | null;
    errorMessage: string | null;
  };
}

export interface VolumeData {
  volumeId: string;
  volumeNumber: number;
  title: string;
  status: string;
  chapterCount: number;
  settledCount: number;
}

export interface ChapterPageData {
  items: ChapterData[];
  total: number;
  offset: number;
  limit: number;
}

export interface AgentData {
  agentId: string;
  roleKey: string;
  roleName: string;
  displayName: string;
  category: 'core' | 'specialist';
  provider: string;
  modelId: string;
  activationState: string;
  availability?: 'available' | 'unavailable';
  availabilityReason?: string | null;
  publicSummary?: string;
  responsibilities?: string[];
  boundaries?: string[];
  retrievalFocus?: string[];
  outputKinds?: string[];
}

export interface AgentPromptPreferenceData {
  promptPreferenceId: string | null;
  agentId: string;
  version: number;
  content: string;
  createdAt: string | null;
}

export interface TeamMemberConfigData extends AgentData {
  roleStatement: string;
  promptPreference: AgentPromptPreferenceData;
}

export interface TeamConfigData {
  members: TeamMemberConfigData[];
  promptPolicy: {
    editableLabel: string;
    maxChars: number;
    priority: string;
    fullPromptAccess?: {
      configured: boolean;
      passwordProtected: true;
    };
  };
}

export interface TeamTemplateData {
  fullPromptAccess?: {
    configured: boolean;
    passwordProtected: true;
  };
  members: Array<{
    roleTemplateId: string;
    roleKey: string;
    memberName: string;
    shortTitle: string;
    category: 'core' | 'specialist';
    publicSummary: string;
    responsibilities: string[];
    boundaries: string[];
    retrievalFocus: string[];
    outputKinds: string[];
    defaultActivation: 'resident' | 'standby';
    defaultModel: { provider: string; modelId: string; plan: string };
    roleStatement: string;
  }>;
}

export interface ProtectedRolePromptData {
  roleKey: string;
  identity: string;
  note: string;
  variants: Array<{
    purpose: 'discussion' | 'novel_writer' | 'novel_reviewer' | 'review_synthesis';
    label: string;
    prompt: string;
  }>;
}

export interface TaskData {
  taskId: string;
  taskType: string;
  status: string;
  errorCode?: string | null;
  currentPhase: string;
  pauseRequested: boolean;
  cancelRequested: boolean;
  attemptCount: number;
  assignedAgentId: string | null;
  chapterId: string | null;
  brief: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
}

export interface WorkspaceData {
  book: BookData;
  volumes?: VolumeData[];
  chapters: ChapterData[];
  agents: AgentData[];
  tasks: TaskData[];
  budget: {
    mode: string;
    token_limit: number;
    spent_tokens: number;
    reserved_tokens: number;
    cash_limit_micros: number;
    spent_cash_micros: number;
    status: string;
  } | null;
  confirmations: {
    count: number;
    items: Array<{
      confirmationId: string;
      targetType: string;
      targetId: string;
      expectedCanonRevision: number;
      scope: unknown;
      impact: unknown;
      createdAt: string;
    }>;
  };
  localAssistant?: {
    displayName: string;
    roleName: string;
    status: 'ready' | 'degraded' | 'offline';
    summary: string;
  };
}

export interface TaskCenterBookData {
  book: BookData;
  chapters: ChapterData[];
  agents: AgentData[];
  settingItems?: Array<{ itemKey: string; label: string }>;
  tasks: TaskData[];
  budget: WorkspaceData['budget'];
  confirmations: WorkspaceData['confirmations'];
}

export interface TaskCenterData {
  books: TaskCenterBookData[];
}

export interface LibraryProfileValueData {
  value: unknown;
  sourceChapterNumber: number | null;
  sourceChapterTitle: string | null;
  storyTime: string | null;
}

export interface LibraryProfileFieldData {
  key: string;
  label: string;
  values: LibraryProfileValueData[];
}

export interface LibrarySemanticProfileData {
  entityId: string;
  entityType: string;
  name: string;
  aliases: string[];
  firstAppearance: LibraryProfileValueData | null;
  fields: LibraryProfileFieldData[];
}

export interface LibraryWorldMapData {
  authorDescription: string | null;
  nodes: Array<{
    nodeId: string;
    name: string;
    role: 'birthplace' | 'story_start' | 'location';
    chapterNumber: number | null;
    chapterTitle: string | null;
    direction: string | null;
  }>;
  edges: Array<{ fromNodeId: string; toNodeId: string; label: string; chapterNumber: number | null }>;
}

export interface LibraryData {
  canonRevision: number;
  entities: Array<Record<string, unknown>>;
  supportingCharacters?: Array<Record<string, unknown>>;
  supportingCharacterProfiles?: LibrarySemanticProfileData[];
  organizationProfiles?: LibrarySemanticProfileData[];
  locationProfiles?: LibrarySemanticProfileData[];
  itemResourceProfiles?: LibrarySemanticProfileData[];
  worldMap?: LibraryWorldMapData;
  effectiveRules?: Array<{ ruleKey: string; title: string; summary: string; sourceLabel: string; confirmedAt: string | null }>;
  facts: Array<Record<string, unknown>>;
  timeline: Array<{
    timeline_id: string;
    event_id?: string;
    sequence_order?: number;
    event_title?: string;
    planned_event_title?: string;
    story_time: string | null;
    display_time?: string;
    event: unknown;
    canonical_name?: string;
    source_chapter_number?: number | null;
    chapter_start?: number;
    chapter_end?: number;
    actual_summary?: string;
    source_label?: string;
    source_chapter_title: string | null;
    evidence?: unknown;
  }>;
  relations: Array<Record<string, unknown>>;
  tags: Array<Record<string, unknown>>;
  projections: Array<Record<string, unknown>>;
  gaps: Array<Record<string, unknown>>;
  settings: LibrarySettingData[];
  bookProfile: BookProfileViewData | null;
  protagonists?: ProtagonistDashboardData;
  attributeFormulas?: AttributeFormulaData[];
  summary: { entityCount: number; factCount: number; relationCount: number; timelineCount: number; tagCount: number; projectionCount: number; openGapCount: number };
}

export interface LibrarySettingData {
  itemKey: string;
  groupTitle: string;
  label: string;
  prompt: string;
  sourceLabel: string;
  status: '已确认';
  custom: boolean;
  sortOrder: number;
  content: string;
  sourceDiscussionId: string | null;
  sourceDecisionId: string | null;
  confirmedAt: string | null;
  updatedAt: string;
}

export interface ProtagonistStateData {
  entryId: string;
  profileId: string;
  category: string;
  logicalKey: string;
  label: string;
  storyTime: string | null;
  valueType: 'number' | 'text' | 'enum' | 'list' | 'resource' | 'derived';
  value: unknown;
  unit: string | null;
  stateStatus: 'active' | 'consumed' | 'lost' | 'dead' | 'retired' | 'archived';
  authorityLayer: 'candidate' | 'canon' | 'derived';
  effectiveChapterNumber: number | null;
  revision: number;
  note: string | null;
}

export interface ProtagonistProfileData {
  profileId: string;
  entityId: string | null;
  displayName: string;
  history?: ProtagonistStateData[];
  isPrimary: boolean;
  status: 'active' | 'archived';
  current: ProtagonistStateData[];
  pending: ProtagonistStateData[];
  historyCount: number;
}

export interface ProtagonistDashboardData { profiles: ProtagonistProfileData[] }

export interface AttributeFormulaData {
  formulaId: string;
  formulaKey: string;
  label: string;
  category: string;
  expression: string;
  variables: Array<{ key: string; label: string; defaultValue?: number }>;
  unit: string | null;
  version: number;
  status: 'active' | 'superseded' | 'archived';
}

export interface GraphWorkspaceData {
  relations: Array<Record<string, unknown>>;
  projections: Array<Record<string, unknown>>;
}

export interface TeamModelProfileData {
  provider: string;
  modelId: string;
  plan: 'deterministic' | 'codex' | 'coding' | 'agent' | 'opencodego';
}

export interface ModelBindingsData {
  active: Array<{ agentId: string; roleKey: string; memberName: string; shortTitle: string; provider: string; modelId: string; modelSnapshotId: string; plan: TeamModelProfileData['plan'] }>;
  revisions: Array<{ revisionId: string; version: number; effectiveFrom: string; reason: string; status: string; createdAt: string }>;
  contracts: Array<{ roleKey: string; memberName: string; shortTitle: string; publicSummary: string }>;
}

export interface OperationsStatusData {
  releaseId: string;
  schemaVersion: number;
  disk: { totalBytes: number; freeBytes: number };
  queue: { queued: number; working: number; blocked: number };
  projection: Record<string, unknown>;
  latestBackup: Record<string, unknown> | null;
  portability: { completed: number; failed: number };
  diagnostics: { telemetrySent: boolean; secretsIncluded: boolean; listeningHost: string };
}

export interface ArtifactVersionData {
  artifactVersionId: string;
  artifactId: string;
  version: number;
  parentVersionId: string | null;
  positioningVersion: number;
  content: Record<string, unknown>;
  contentHash: string;
  status: 'draft' | 'candidate' | 'selected' | 'superseded' | 'invalidated';
  createdAt: string;
}


export interface AuthorAttachmentData {
  attachmentId: string;
  originalName: string;
  mediaKind: 'image' | 'text' | 'pdf' | 'docx';
  mimeType: string;
  sizeBytes: number;
  parseStatus: 'parsed' | 'truncated' | 'preview_only' | 'no_text' | 'failed' | 'discarded';
  parsedCharCount: number;
  parseError: string | null;
  lifecycleLayer: 'temporary';
  createdAt: string;
}

export interface WorkerData {
  status: string;
  worker: null | { workerId: string; heartbeatAt: string; currentTaskId: string | null };
}

interface ApiResponse<T> {
  data: T;
  meta: { requestId: string; version: number };
}

// 显式配置优先；本机桌面模式（页面由 127.0.0.1 提供）走 API 端口；
// 公网部署（页面由 wenmixiezuo.com 提供）走同源反向代理。
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN
  ?? (typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/u.test(location.hostname) ? 'http://127.0.0.1:43111' : '');

// 429 说明请求在限流闸门口就被拒、业务根本没有执行，延迟重试是安全的。
// 限流窗口按分钟滑动，重试节奏逐步拉长；仍失败才把"请求太频繁"抛给页面。
const RATE_LIMIT_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

function waitBeforeRateLimitRetry(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) { reject(new DOMException('The operation was aborted.', 'AbortError')); return; }
    const onAbort = (): void => { clearTimeout(timer); reject(new DOMException('The operation was aborted.', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function performRequest(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (path.startsWith('/api/v1/') && !path.startsWith('/api/v1/admin/') && !path.startsWith('/api/v1/internal/')) {
    headers.set('x-wenmi-author-projection', 'clean-v1');
  }
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const send = (): Promise<Response> => fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: 'include',
    headers
  });
  let response = await send();
  for (const delay of RATE_LIMIT_RETRY_DELAYS_MS) {
    if (response.status !== 429) return response;
    await waitBeforeRateLimitRetry(delay, init.signal);
    response = await send();
  }
  return response;
}

/** 新版使用作者业务动作；code 只兼容未带干净投影头的旧前端缓存。 */
export class ApiRequestError extends Error {
  public constructor(
    message: string,
    public readonly code: string | null,
    public readonly action: string | null
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

const AUTHOR_CLIENT_ALIASES: Readonly<Record<string, string>> = {
  recoveryKey: 'taskId', recovery_key: 'task_id', recoveryKeys: 'taskIds', recovery_keys: 'task_ids',
  currentRecoveryKey: 'currentTaskId', current_recovery_key: 'current_task_id',
  collaborationKey: 'discussionId', collaboration_key: 'discussion_id',
  collaborationStatus: 'discussionStatus', collaboration_status: 'discussion_status',
  memberKey: 'agentId', member_key: 'agent_id',
  assignedMemberKey: 'assignedAgentId', assigned_member_key: 'assigned_agent_id',
  createdByMemberKey: 'createdByAgentId', created_by_member_key: 'created_by_agent_id',
  workKind: 'taskType', work_kind: 'task_type', workStatus: 'taskStatus', work_status: 'task_status',
  progressStage: 'currentPhase', progress_stage: 'current_phase', recoveryProgress: 'checkpoint',
  recoveryMessage: 'errorMessage', recovery_message: 'error_message'
};

/** 新版网络响应不含内部字段；这里只在浏览器内还原现有组件需要的兼容键，不向界面显示。 */
function restoreAuthorClientAliases(value: unknown, depth = 0): unknown {
  if (depth > 24 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => restoreAuthorClientAliases(item, depth + 1));
  if (typeof value !== 'object') return value;
  const restored: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    restored[AUTHOR_CLIENT_ALIASES[key] ?? key] = restoreAuthorClientAliases(item, depth + 1);
  }
  return restored;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    const response = await performRequest(path, init);
    const body = await response.json() as ApiResponse<T> | { error?: { message?: string; code?: string; action?: string } };
    if (!response.ok) {
      const errorBody = 'error' in body && body.error !== undefined ? body.error : undefined;
      const reason = membershipBlockReasonFromAction(errorBody?.action) ?? membershipBlockReasonFromCode(errorBody?.code);
      if (reason !== null) raiseMembershipBlocked(reason);
      throw new ApiRequestError(
        authorErrorMessage(errorBody?.message ?? '', response.status),
        errorBody?.code ?? null,
        errorBody?.action ?? null
      );
    }
    return restoreAuthorClientAliases((body as ApiResponse<T>).data) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof TypeError && /fetch|network|load failed/iu.test(error.message)) {
      throw new Error('无法连接文秘写作服务，请稍后再试。');
    }
    throw error;
  }
}

export async function fetchCurrentAccount(signal?: AbortSignal): Promise<AuthAccountData | null> {
  try {
    const response = await performRequest('/api/v1/auth/me', signal === undefined ? {} : { signal });
    if (response.status === 401) return null;
    const body = await response.json() as ApiResponse<AuthAccountData> | { error?: { message?: string } };
    if (!response.ok) {
      const message = 'error' in body ? body.error?.message : undefined;
      throw new Error(authorErrorMessage(message ?? '', response.status));
    }
    return (body as ApiResponse<AuthAccountData>).data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof TypeError && /fetch|network|load failed/iu.test(error.message)) {
      throw new Error('无法连接文秘写作服务，请稍后再试。');
    }
    throw error;
  }
}

export function registerAccount(input: { email: string; password: string; displayName: string }): Promise<{ account: AuthAccountData; expiresInSeconds: number }> {
  return request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(input) });
}

export function loginAccount(input: { email: string; password: string }): Promise<{ account: AuthAccountData; expiresInSeconds: number }> {
  return request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(input) });
}

export function logoutAccount(): Promise<{ loggedOut: boolean }> {
  return request('/api/v1/auth/logout', { method: 'POST', body: '{}' });
}

export function submitUserFeedback(input: {
  bookId?: string; taskId?: string; category: 'bug' | 'experience' | 'suggestion' | 'other';
  message: string; pagePath?: string; recoveryKey?: string;
}): Promise<{ feedbackId: string; received: boolean }> {
  return request('/api/v1/feedback', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchAdminOverview(signal?: AbortSignal): Promise<AdminOverviewData> {
  return request('/api/v1/admin/overview', signal === undefined ? {} : { signal });
}

export interface AdminUserPageData { items: AuthAccountData[]; total: number }

export function fetchAdminUsers(input: { query?: string; status?: string; offset?: number; limit?: number } = {}, signal?: AbortSignal): Promise<AdminUserPageData> {
  const query = new URLSearchParams();
  if (input.query) query.set('query', input.query);
  if (input.status) query.set('status', input.status);
  if (input.offset !== undefined) query.set('offset', String(input.offset));
  if (input.limit !== undefined) query.set('limit', String(input.limit));
  const suffix = query.size === 0 ? '' : `?${query.toString()}`;
  return request(`/api/v1/admin/users${suffix}`, signal === undefined ? {} : { signal });
}

export function updateAdminUserStatus(userId: string, status: 'active' | 'suspended'): Promise<AuthAccountData> {
  return request(`/api/v1/admin/users/${encodeURIComponent(userId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  });
}

export type MembershipPlanKey = 'bronze' | 'silver' | 'gold' | 'diamond';

export interface MembershipStatusData {
  isAdmin: boolean;
  membership: null | {
    plan: MembershipPlanKey;
    planLabel: string;
    planPrice: string;
    status: 'active' | 'revoked';
    /** 算力值口径（=真实消耗 × 2），前台直接展示，不出现 token 字眼。 */
    computeQuota: number;
    computeConsumed: number;
    computeRemaining: number;
    periodStart: string;
    periodEnd: string;
    expired: boolean;
  };
}

export interface AdminMembershipUserData {
  userId: string;
  displayName: string;
  email: string;
  role: 'admin' | 'user';
  accountStatus: 'active' | 'suspended';
  membership: null | {
    plan: MembershipPlanKey;
    planLabel: string;
    status: 'active' | 'revoked';
    tokenQuota: number;
    periodTokens: number;
    totalTokens: number;
    periodStart: string;
    periodEnd: string;
    expired: boolean;
  };
  totalTokens: number;
}

export function fetchMyMembership(signal?: AbortSignal): Promise<MembershipStatusData> {
  return request('/api/v1/membership/me', signal === undefined ? {} : { signal });
}

export interface AdminMembershipPageData { items: AdminMembershipUserData[]; total: number }

export function fetchAdminMemberships(input: { query?: string; status?: string; offset?: number; limit?: number } = {}, signal?: AbortSignal): Promise<AdminMembershipPageData> {
  const query = new URLSearchParams();
  if (input.query) query.set('query', input.query);
  if (input.status) query.set('status', input.status);
  if (input.offset !== undefined) query.set('offset', String(input.offset));
  if (input.limit !== undefined) query.set('limit', String(input.limit));
  const suffix = query.size === 0 ? '' : `?${query.toString()}`;
  return request(`/api/v1/admin/memberships${suffix}`, signal === undefined ? {} : { signal });
}

export function grantAdminMembership(userId: string, plan: MembershipPlanKey): Promise<MembershipStatusData> {
  return request(`/api/v1/admin/memberships/${encodeURIComponent(userId)}`, {
    method: 'POST',
    body: JSON.stringify({ plan })
  });
}

export function revokeAdminMembership(userId: string): Promise<{ revoked: boolean }> {
  return request(`/api/v1/admin/memberships/${encodeURIComponent(userId)}/revoke`, {
    method: 'POST',
    body: '{}'
  });
}

export interface AdminUsageUserRow {
  userId: string; email: string; displayName: string; role: 'admin' | 'user'; status: string;
  createdAt: string; lastLoginAt: string | null; books: number; tokens: number; calls: number;
}
export interface AdminUsageModelRow { provider: string; modelId: string; calls: number; tokens: number }
export interface AdminUsageDailyRow { day: string; tokens: number; calls: number }
export interface AdminUsageData {
  totalTokens: number; totalCashMicros: number; totalCalls: number;
  perUser: AdminUsageUserRow[]; perModel: AdminUsageModelRow[]; daily: AdminUsageDailyRow[];
}
export function fetchAdminUsage(signal?: AbortSignal): Promise<AdminUsageData> {
  return request('/api/v1/admin/usage', signal === undefined ? {} : { signal });
}

export interface AdminModelProfile { provider: string; modelId: string; plan: string }
export interface AdminSchemeMember { roleKey: string; memberName: string; shortTitle: string }
export interface AdminModelSchemeData {
  source: 'custom' | 'default'; updatedAt: string | null; updatedBy: string | null;
  profiles: Record<string, AdminModelProfile>;
  allowedModels: AdminModelProfile[];
  members: AdminSchemeMember[];
}
export function fetchAdminModelScheme(signal?: AbortSignal): Promise<AdminModelSchemeData> {
  return request('/api/v1/admin/model-scheme', signal === undefined ? {} : { signal });
}
export interface AdminModelSchemeSaveResult {
  updatedAt: string;
  convergence: { booksVisited: number; revisedBooks: number; updatedAgents: number };
}
export function saveAdminModelScheme(profiles: Record<string, AdminModelProfile>, reason?: string): Promise<AdminModelSchemeSaveResult> {
  return request('/api/v1/admin/model-scheme', {
    method: 'POST',
    body: JSON.stringify({ profiles, reason })
  });
}

export interface RuntimeEventData {
  eventSeq:number;eventId:string;eventType:string;ownerId:string;bookId:string|null;occurredAt:string;data:Record<string,unknown>;
}
export type RuntimeEventConnectionState='connecting'|'open'|'reconnecting'|'closed';
export function subscribeRuntimeEvents(input:{bookId?:string;onEvent:(event:RuntimeEventData)=>void;
  onState?:(state:RuntimeEventConnectionState)=>void}):()=>void{
  let stopped=false;let controller:AbortController|null=null;let reconnectTimer:ReturnType<typeof setTimeout>|null=null;
  // 全量订阅统一游标：无论调用方限定哪个 bookId 都连同一路事件流，避免按书游标分叉导致丢事件或重放。
  const cursorKey='wenmi-event-cursor';
  let cursor=readEventCursor(cursorKey);
  const pause=(ms:number)=>new Promise<void>(resolve=>{reconnectTimer=setTimeout(resolve,ms);});
  const run=async()=>{
    input.onState?.('connecting');
    let reconnectDelayMs=1_000;
    while(!stopped){
      controller=new AbortController();
      try{
        const query=new URLSearchParams({after:String(cursor)});
        let response=await fetch(`${API_ORIGIN}/api/v1/events?${query.toString()}`,{credentials:'include',signal:controller.signal,
          headers:{accept:'text/event-stream','last-event-id':String(cursor),'x-wenmi-author-projection':'clean-v1'}});        if(response.status===401){input.onState?.('closed');break;}
        // 被限流时降到15秒一连，避免每秒重连把自己持续锁在限流桶外。
        if(response.status===429){reconnectDelayMs=15_000;throw new Error('事件流被限流，稍后重连');}
        if(!response.ok||response.body===null)throw new Error('事件流连接失败');
        input.onState?.('open');reconnectDelayMs=1_000;
        const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
        while(!stopped){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true}).replace(/\r\n/gu,'\n');
          let boundary=buffer.indexOf('\n\n');while(boundary>=0){const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
            const event=parseSseBlock(block);if(event!==null&&event.eventSeq>cursor){cursor=event.eventSeq;writeEventCursor(cursorKey,cursor);
              if(input.bookId===undefined||input.bookId===event.bookId)input.onEvent(event);}
            boundary=buffer.indexOf('\n\n');}}
      }catch(error){if(stopped||error instanceof DOMException&&error.name==='AbortError')break;}
      if(!stopped){input.onState?.('reconnecting');await pause(reconnectDelayMs);}
    }
    input.onState?.('closed');
  };
  void run();
  return()=>{stopped=true;controller?.abort();if(reconnectTimer!==null)clearTimeout(reconnectTimer);input.onState?.('closed');};
}
function parseSseBlock(block:string):RuntimeEventData|null{
  const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
  if(data.length===0)return null;
  try{const parsed=restoreAuthorClientAliases(JSON.parse(data)) as Partial<RuntimeEventData>;return typeof parsed.eventSeq==='number'&&typeof parsed.eventType==='string'
    ?parsed as RuntimeEventData:null;}catch{return null;}
}
function readEventCursor(key:string):number{try{const value=Number(globalThis.localStorage?.getItem(key)??'0');return Number.isInteger(value)&&value>=0?value:0;}catch{return 0;}}
function writeEventCursor(key:string,value:number):void{try{const current=Number(globalThis.localStorage?.getItem(key)??'0');if(value>current)globalThis.localStorage?.setItem(key,String(value));}catch{}}
export function fetchHealth(signal?: AbortSignal): Promise<HealthData> {
  return request('/health', signal === undefined ? {} : { signal });
}

export function fetchCapabilities(signal?: AbortSignal): Promise<CapabilityData> {
  return request('/api/v1/capabilities', signal === undefined ? {} : { signal });
}

export function fetchTeamTemplate(signal?: AbortSignal): Promise<TeamTemplateData> {
  return request('/api/v1/team-template', signal === undefined ? {} : { signal });
}

export function fetchBooks(signal?: AbortSignal): Promise<BookData[]> {
  return request('/api/v1/books', signal === undefined ? {} : { signal });
}

export function fetchTaskCenter(signal?: AbortSignal): Promise<TaskCenterData> {
  return request('/api/v1/task-center', signal === undefined ? {} : { signal });
}

export function fetchOpeningTaxonomy(signal?: AbortSignal): Promise<OpeningTaxonomyData> {
  return request('/api/v1/opening-taxonomy', signal === undefined ? {} : { signal });
}

export interface OpeningDraftEnvelope {
  draft: Record<string, unknown> | null;
  updatedAt?: string;
}

export function fetchOpeningDraft(signal?: AbortSignal): Promise<OpeningDraftEnvelope> {
  return request('/api/v1/opening-draft', signal === undefined ? {} : { signal });
}

export function saveOpeningDraftToServer(draft: Record<string, unknown>): Promise<{ saved: boolean }> {
  return request('/api/v1/opening-draft', { method: 'PUT', body: JSON.stringify({ draft }) });
}

export function clearOpeningDraftOnServer(): Promise<{ cleared: boolean }> {
  return request('/api/v1/opening-draft', { method: 'DELETE' });
}

export function fetchPlanningTemplates(bookId: string, scope: PlanningScope, signal?: AbortSignal): Promise<NarrativeTemplateCatalogView> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/planning-templates?scope=${encodeURIComponent(scope)}`,
    signal === undefined ? {} : { signal }
  );
}
export function fetchCreationWorkflow(bookId: string, signal?: AbortSignal): Promise<CreationWorkflowStateView> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/workflow`, signal === undefined ? {} : { signal });
}

export function fetchSettingGaps(bookId:string,signal?:AbortSignal):Promise<SettingGapData[]>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-gaps`,signal===undefined?{}:{signal});
}
export function decideSettingGap(bookId:string,gapId:string,decision:'design_now'|'not_used_this_volume'|'keep_unknown',
  resolvedSettingVersionId?:string|null):Promise<SettingGapData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-gaps/${encodeURIComponent(gapId)}/decide`,
    {method:'POST',body:JSON.stringify({decision,resolvedSettingVersionId:resolvedSettingVersionId??null})});
}
export function fetchStoryThreads(bookId:string,signal?:AbortSignal):Promise<StoryThreadData[]>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/story-threads`,signal===undefined?{}:{signal});
}
export function abandonStoryThread(bookId:string,threadId:string,reason:string):Promise<StoryThreadData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/story-threads/${encodeURIComponent(threadId)}/abandon`,
    {method:'POST',body:JSON.stringify({reason})});
}
export function fetchFirstVolumeLaunchProgress(bookId:string,signal?:AbortSignal):Promise<FirstVolumeLaunchProgressData|null>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/first-volume-launch-progress`,signal===undefined?{}:{signal});
}
export function fetchExpressionProfile(bookId:string,signal?:AbortSignal):Promise<ExpressionProfileData|null>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/expression-profile`,signal===undefined?{}:{signal});
}
export function saveExpressionProfile(bookId:string,input:{
  narrativePerson?:'first'|'third'|'mixed'|null;viewpointDistance?:'close'|'medium'|'distant'|'adaptive'|null;
  languageTone?:string[];textDensity?:'light'|'balanced'|'dense'|'adaptive'|null;targetAudience?:string|null;
  contentBoundaries?:Record<string,unknown>;humorSeriousness?:'humorous'|'balanced'|'serious'|'adaptive'|null;
  voiceEvidence?:unknown[];impactScope?:Record<string,unknown>;confirm:boolean;
}):Promise<ExpressionProfileData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/expression-profile`,{method:'POST',body:JSON.stringify(input)});
}

export function fetchEventSettlement(bookId:string,eventId:string,signal?:AbortSignal):Promise<PlanningSettlementData|null>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/settlement`,signal===undefined?{}:{signal});
}
export function settleStoryEvent(bookId:string,eventId:string,expectedWorkflowVersion:number):Promise<PlanningSettlementData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/settle`,
    {method:'POST',body:JSON.stringify({expectedWorkflowVersion})});
}
export function fetchVolumeSettlement(bookId:string,volumePlanId:string,signal?:AbortSignal):Promise<PlanningSettlementData|null>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/settlement`,signal===undefined?{}:{signal});
}
export function settleVolumePlan(bookId:string,volumePlanId:string,expectedWorkflowVersion:number):Promise<PlanningSettlementData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/settle`,
    {method:'POST',body:JSON.stringify({expectedWorkflowVersion})});
}
export function fetchSettlementFollowUp(bookId:string,stageKind:'event'|'volume',stageObjectId:string,signal?:AbortSignal):Promise<SettlementFollowUpData|null>{
  const base=stageKind==='event'
    ?`/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(stageObjectId)}/settlement/follow-up`
    :`/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(stageObjectId)}/settlement/follow-up`;
  return request(base,signal===undefined?{}:{signal});
}
export function startSettlementFollowUp(bookId:string,stageKind:'event'|'volume',stageObjectId:string):Promise<SettlementFollowUpData>{
  const base=stageKind==='event'
    ?`/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(stageObjectId)}/settlement/follow-up`
    :`/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(stageObjectId)}/settlement/follow-up`;
  return request(base,{method:'POST',body:JSON.stringify({})});
}

export function fetchVolumePlans(bookId: string, signal?: AbortSignal): Promise<VolumePlanData[]> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/volume-plans`, signal === undefined ? {} : { signal });
}

export function createVolumePlan(bookId: string, input: {
  expectedWorkflowVersion: number;
  planNumber: number;
  physicalVolumeId?: string | null;
  idempotencyKey: string;
}): Promise<VolumePlanData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/volume-plans`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function fetchVolumePlanVersions(
  bookId: string,
  volumePlanId: string,
  signal?: AbortSignal
): Promise<VolumePlanVersionData[]> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/versions`,
    signal === undefined ? {} : { signal }
  );
}

export function fetchVolumePlanGeneration(
  bookId: string,
  volumePlanId: string,
  signal?: AbortSignal
): Promise<VolumePlanGenerationData | null> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/generation`,
    signal === undefined ? {} : { signal }
  );
}

export function startVolumePlanGeneration(bookId: string, volumePlanId: string, input: {
  expectedPlanRevision: number;
  expectedActiveVersionId?: string | null;
  expectedWorkflowVersion: number;
  template: PlanningTemplateInstance;
  authorInputRefs?: string[];
  selection?: VolumeRouteSelection;
  idempotencyKey: string;
}): Promise<VolumePlanGenerationData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/generate`,
    { method: 'POST', body: JSON.stringify(input) }
  );
}

export function actOnVolumePlanGeneration(bookId:string,volumePlanId:string,action:'cancel'|'retry'|'resume'):Promise<VolumePlanGenerationData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/generation/action`,
    {method:'POST',body:JSON.stringify({action})});
}
export function fetchVolumeDirections(
  bookId: string, volumePlanId: string, signal?: AbortSignal
): Promise<VolumeDirectionVersionData[]> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/directions`,
    signal === undefined ? {} : { signal }
  );
}

export function saveVolumeRouteSelection(
  bookId: string,
  volumePlanId: string,
  selection: VolumeRouteSelection,
  idempotencyKey: string
): Promise<VolumeRouteSelection> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/route-selection`,
    { method: 'POST', body: JSON.stringify({ selection, idempotencyKey }) }
  );
}

export function addVolumePlanVersion(bookId: string, volumePlanId: string, input: {
  expectedPlanRevision: number;
  candidateKind: VolumePlanCandidateKind;
  parentVersionId?: string | null;
  sourceTaskId?: string | null;
  authorInputRefs?: string[];
  template: PlanningTemplateInstance;
  content: VolumePlanContent;
  idempotencyKey: string;
}): Promise<VolumePlanVersionData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/versions`,
    { method: 'POST', body: JSON.stringify(input) }
  );
}

export function previewVolumePlanImpact(
  bookId: string,
  volumePlanId: string,
  volumePlanVersionId: string
): Promise<VolumePlanImpactData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/impact-preview`,
    { method: 'POST', body: JSON.stringify({ volumePlanVersionId }) }
  );
}

export function confirmVolumePlanVersion(bookId: string, volumePlanId: string, input: {
  volumePlanVersionId: string;
  expectedPlanRevision: number;
  expectedActiveVersionId?: string | null;
  expectedWorkflowVersion: number;
}): Promise<VolumePlanData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/confirm`,
    { method: 'POST', body: JSON.stringify(input) }
  );
}
export function fetchEventChains(
  bookId: string, volumePlanId: string, signal?: AbortSignal
): Promise<EventChainVersion[]> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/event-chains`,
    signal === undefined ? {} : { signal }
  );
}

export function fetchEventChainGeneration(
  bookId: string, volumePlanId: string, signal?: AbortSignal
): Promise<EventChainGenerationData | null> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/event-chains/generation`,
    signal === undefined ? {} : { signal }
  );
}

export function startEventChainGeneration(bookId: string, volumePlanId: string, input: {
  expectedWorkflowVersion: number; authorInputRefs?: string[]; idempotencyKey: string;
}): Promise<EventChainGenerationData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/event-chains/generate`,
    { method: 'POST', body: JSON.stringify(input) }
  );
}

export function actOnEventChainGeneration(bookId:string,volumePlanId:string,action:'cancel'|'retry'|'resume'):Promise<EventChainGenerationData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/event-chains/generation/action`,
    {method:'POST',body:JSON.stringify({action})});
}
export function addEventChainVersion(bookId: string, volumePlanId: string, input: {
  content: EventChainContent; parentVersionId?: string | null; idempotencyKey: string;
}): Promise<EventChainVersion> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/event-chains`,
    { method: 'POST', body: JSON.stringify(input) }
  );
}
export function confirmEventChain(
  bookId: string, volumePlanId: string, eventChainVersionId: string
): Promise<EventChainVersion> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/event-chains/${encodeURIComponent(eventChainVersionId)}/confirm`,
    { method: 'POST', body: '{}' }
  );
}

export function fetchEventSequence(
  bookId: string, volumePlanId: string, signal?: AbortSignal
): Promise<EventSequenceData | null> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/event-sequence`,
    signal === undefined ? {} : { signal }
  );
}

export function initializeEventSequence(bookId: string, volumePlanId: string, input: {
  expectedWorkflowVersion: number; idempotencyKey: string;
}): Promise<EventSequenceData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/event-sequence/initialize`,
    { method: 'POST', body: JSON.stringify(input) }
  );
}

export function fetchStoryEventVersions(
  bookId: string, eventId: string, signal?: AbortSignal
): Promise<StoryEventVersionData[]> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/versions`,
    signal === undefined ? {} : { signal }
  );
}

export function addStoryEventVersion(bookId: string, eventId: string, input: {
  expectedEventRevision: number;
  candidateKind: StoryEventCandidateKind;
  parentVersionId?: string | null;
  sourceTaskId?: string | null;
  authorInputRefs?: string[];
  template: PlanningTemplateInstance;
  content: StoryEventContent;
  idempotencyKey: string;
}): Promise<StoryEventVersionData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/versions`,
    { method: 'POST', body: JSON.stringify(input) }
  );
}

export function fetchStoryEventGeneration(
  bookId: string, eventId: string, signal?: AbortSignal
): Promise<StoryEventGenerationData | null> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/generation`,
    signal === undefined ? {} : { signal }
  );
}

export function startStoryEventGeneration(bookId: string, eventId: string, input: {
  expectedEventRevision: number;
  expectedActiveVersionId?: string | null;
  expectedWorkflowVersion: number;
  template: PlanningTemplateInstance;
  authorInputRefs?: string[];
  idempotencyKey: string;
}): Promise<StoryEventGenerationData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/generate`,
    { method: 'POST', body: JSON.stringify(input) }
  );
}

export function actOnStoryEventGeneration(bookId:string,eventId:string,action:'cancel'|'retry'|'resume'):Promise<StoryEventGenerationData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/generation/action`,
    {method:'POST',body:JSON.stringify({action})});
}
export function previewStoryEventImpact(
  bookId: string, eventId: string, versionId: string
): Promise<StoryEventImpactData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/impact-preview`,
    { method: 'POST', body: JSON.stringify({ versionId }) }
  );
}

export function confirmStoryEventVersion(bookId: string, eventId: string, input: {
  versionId: string; expectedEventRevision: number; expectedWorkflowVersion: number;
}): Promise<StoryEventData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/confirm`,
    { method: 'POST', body: JSON.stringify(input) }
  );
}

export function previewEventOperation(bookId: string, volumePlanId: string, input: {
  expectedSequenceRevision: number; proposal: EventOperationProposal; idempotencyKey: string;
}): Promise<EventOperationData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/event-sequence/operations/preview`,
    { method: 'POST', body: JSON.stringify(input) }
  );
}

export function applyEventOperation(bookId: string, volumePlanId: string, input: {
  operationId: string; expectedSequenceRevision: number;
}): Promise<EventSequenceData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/volume-plans/${encodeURIComponent(volumePlanId)}/event-sequence/operations/apply`,
    { method: 'POST', body: JSON.stringify(input) }
  );
}


export function fetchEventChapterSequence(bookId:string,eventId:string,signal?:AbortSignal):Promise<EventChapterSequenceData|null>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/chapter-sequence`,
    signal===undefined?{}:{signal});
}
export function initializeEventChapterSequence(bookId:string,eventId:string,input:{expectedWorkflowVersion:number;idempotencyKey:string}):
  Promise<EventChapterSequenceData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/chapter-sequence/initialize`,
    {method:'POST',body:JSON.stringify(input)});
}
export function fetchEventChapterGeneration(bookId:string,eventId:string,kind:'sequence'|'details'|'sequence_challenge'|'detail_challenge',signal?:AbortSignal):
  Promise<EventChapterGenerationData|null>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/chapter-sequence/generation?kind=${kind}`,
    signal===undefined?{}:{signal});
}
export function actOnEventChapterGeneration(bookId:string,eventId:string,kind:EventChapterGenerationData['kind'],
  action:'cancel'|'retry'|'resume'):Promise<EventChapterGenerationData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/chapter-sequence/generation/action`,
    {method:'POST',body:JSON.stringify({kind,action})});
}
export function startEventChapterSequenceGeneration(bookId:string,eventId:string,input:{expectedSequenceRevision:number;
  expectedWorkflowVersion:number;authorInputRefs?:string[];idempotencyKey:string}):Promise<EventChapterGenerationData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/chapter-sequence/generate`,
    {method:'POST',body:JSON.stringify(input)});
}
export function startEventChapterSequenceChallenge(bookId:string,eventId:string,sequenceVersionId:string,input:{
  expectedSequenceRevision:number;expectedWorkflowVersion:number;challengerRoleKey?:string;idempotencyKey:string}):Promise<EventChapterGenerationData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/chapter-sequence/versions/${encodeURIComponent(sequenceVersionId)}/challenge`,
    {method:'POST',body:JSON.stringify(input)});
}
export function confirmEventChapterSequence(bookId:string,eventId:string,input:{sequenceVersionId:string;
  expectedSequenceRevision:number;expectedWorkflowVersion:number}):Promise<EventChapterSequenceData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/chapter-sequence/confirm`,
    {method:'POST',body:JSON.stringify(input)});
}
export function startEventChapterDetailGeneration(bookId:string,eventId:string,input:{count:number;expectedSequenceRevision:number;
  expectedWorkflowVersion:number;authorInputRefs?:string[];idempotencyKey:string}):Promise<EventChapterGenerationData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/chapter-outlines/generate`,
    {method:'POST',body:JSON.stringify(input)});
}
export function startEventChapterDetailChallenge(bookId:string,eventId:string,outlineId:string,outlineVersionId:string,input:{
  expectedSequenceRevision:number;expectedWorkflowVersion:number;challengerRoleKey?:string;idempotencyKey:string}):Promise<EventChapterGenerationData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/event-chapter-outlines/${encodeURIComponent(outlineId)}/versions/${encodeURIComponent(outlineVersionId)}/challenge`,
    {method:'POST',body:JSON.stringify(input)});
}
export function freezeRecentEventChapterOutlines(bookId:string,eventId:string,input:{items:Array<{outlineId:string;
  outlineVersionId:string;expectedOutlineRevision:number}>;expectedWorkflowVersion:number}):Promise<EventChapterSequenceData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/story-events/${encodeURIComponent(eventId)}/chapter-outlines/freeze`,
    {method:'POST',body:JSON.stringify(input)});
}

export type AuthorPlanningInputData = AuthorPlanningInput;

export function fetchAuthorPlanningInputs(bookId: string, filter: {
  surface?: AuthorInputSurface; subjectType?: string; subjectId?: string;
} = {}, signal?: AbortSignal): Promise<AuthorPlanningInputData[]> {
  const query = new URLSearchParams();
  if (filter.surface !== undefined) query.set('surface', filter.surface);
  if (filter.subjectType !== undefined) query.set('subjectType', filter.subjectType);
  if (filter.subjectId !== undefined) query.set('subjectId', filter.subjectId);
  const suffix = query.size === 0 ? '' : `?${query.toString()}`;
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/author-planning-inputs${suffix}`,
    signal === undefined ? {} : { signal }
  );
}

export function createAuthorPlanningInput(
  bookId: string,
  input: CreateAuthorPlanningInputCommand,
  signal?: AbortSignal
): Promise<AuthorPlanningInputData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/author-planning-inputs`, {
    method: 'POST', body: JSON.stringify(input), ...(signal === undefined ? {} : { signal })
  });
}

export function decideAuthorPlanningInput(
  bookId: string,
  authorInputId: string,
  input: DecideAuthorPlanningInputCommand,
  signal?: AbortSignal
): Promise<AuthorPlanningInputData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/author-planning-inputs/${encodeURIComponent(authorInputId)}/decisions`,
    { method: 'POST', body: JSON.stringify(input), ...(signal === undefined ? {} : { signal }) }
  );
}

export function analyzeOpeningSynopsis(synopsis: string): Promise<OpeningSynopsisAnalysisData> {
  return request('/api/v1/opening-synopsis/analyze', {
    method: 'POST', body: JSON.stringify({ synopsis })
  });
}

export function fetchWorkspace(bookId: string, signal?: AbortSignal): Promise<WorkspaceData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/workspace`, signal === undefined ? {} : { signal });
}

export function fetchTeamConfig(bookId: string, signal?: AbortSignal): Promise<TeamConfigData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/team-config`, signal === undefined ? {} : { signal });
}

export function fetchProtectedRolePrompt(input: {
  password: string;
  roleKey: string;
  bookId?: string;
  agentId?: string;
}): Promise<ProtectedRolePromptData> {
  return request('/api/v1/prompt-view', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function saveAgentPromptPreference(
  bookId: string,
  agentId: string,
  expectedVersion: number,
  content: string
): Promise<AgentPromptPreferenceData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/agents/${encodeURIComponent(agentId)}/prompt-preference`, {
    method: 'PUT',
    body: JSON.stringify({ expectedVersion, content })
  });
}


export function fetchWorker(signal?: AbortSignal): Promise<WorkerData> {
  return request('/api/v1/runtime/worker', signal === undefined ? {} : { signal });
}

export async function createBook(input: {
  title: string; text: string; category?: string; classification?: string; targetAudience?: string;
  expectedScaleChars?: number; initialExpressionBaseline?: string; tags?: string[];
  openingBlueprint?: OpeningBlueprintData;
}): Promise<{ bookId: string; kickoffTaskId?: string }> {
  const draft = await request<{ draftId: string; version: number }>('/api/v1/books/drafts', {
    method: 'POST', body: JSON.stringify(input)
  });
  return request(`/api/v1/book-drafts/${encodeURIComponent(draft.draftId)}/confirm`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: draft.version })
  });
}

export function archiveBook(bookId: string, expectedVersion: number): Promise<BookData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/archive`, {
    method: 'POST', body: JSON.stringify({ expectedVersion })
  });
}

export function restoreBook(bookId: string, expectedVersion: number): Promise<BookData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/restore`, {
    method: 'POST', body: JSON.stringify({ expectedVersion })
  });
}

export function purgeBook(bookId: string, confirmationText: string): Promise<{ bookId: string; status: 'purged'; tombstoneWritten: boolean }> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/purge`, {
    method: 'POST', body: JSON.stringify({ confirmationText })
  });
}

export function uploadAuthorAttachment(bookId: string, file: File): Promise<AuthorAttachmentData> {
  const body = new FormData();
  body.append('file', file, file.name);
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/author-attachments`, { method: 'POST', body });
}

export function discardAuthorAttachment(bookId: string, attachmentId: string): Promise<AuthorAttachmentData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/author-attachments/${encodeURIComponent(attachmentId)}/discard`, {
    method: 'POST', body: JSON.stringify({})
  });
}


export function startWritingRun(bookId:string,input:{volumeTitle?:string;chapterTitle?:string}={}):Promise<ChapterBatchData>{
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/writing-runs`,{method:'POST',body:JSON.stringify(input)});
}

export function scheduleChapters(bookId: string, count: 1 | 3 | 4 | 5): Promise<{ batchId: string }> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/chapter-batches`, {
    method: 'POST', body: JSON.stringify({ count })
  });
}

export function cancelTask(bookId: string, taskId: string): Promise<TaskData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST', body: JSON.stringify({})
  });
}

export function retryTask(bookId: string, taskId: string): Promise<TaskData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/tasks/${encodeURIComponent(taskId)}/retry`, {
    method: 'POST', body: JSON.stringify({})
  });
}

export function resumeTask(bookId: string, taskId: string): Promise<TaskData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/tasks/${encodeURIComponent(taskId)}/resume`, {
    method: 'POST', body: JSON.stringify({})
  });
}

export interface TaskDetailData {
  task: TaskData;
  recovery: { hasFailureEvidence: boolean; message: string | null };
}

export function fetchTaskDetail(bookId: string, taskId: string, signal?: AbortSignal): Promise<TaskDetailData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/tasks/${encodeURIComponent(taskId)}`, signal === undefined ? {} : { signal });
}

export function resolveConfirmation(bookId: string, confirmationId: string, expectedCanonRevision: number, accept: boolean): Promise<unknown> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/confirmations/${encodeURIComponent(confirmationId)}/${accept ? 'accept' : 'reject'}`, {
    method: 'POST', body: JSON.stringify({ expectedCanonRevision })
  });
}

export function fetchChapterContent(bookId: string, chapterId: string, signal?: AbortSignal): Promise<{
  manuscriptVersionId: string;
  contentHash: string;
  totalLength: number;
  content: string;
}> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}/content`, signal === undefined ? {} : { signal });
}

export function previewContinuationImport(
  bookId: string,
  input: { sourceName: string; text: string }
): Promise<ContinuationImportData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/continuation-imports/preview`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function fetchContinuationImport(
  bookId: string,
  importId: string,
  signal?: AbortSignal
): Promise<ContinuationImportData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/continuation-imports/${encodeURIComponent(importId)}`,
    signal === undefined ? {} : { signal }
  );
}

export function fetchLatestContinuationImport(
  bookId: string,
  signal?: AbortSignal
): Promise<ContinuationImportData | null> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/continuation-imports/latest`,
    signal === undefined ? {} : { signal }
  );
}

export function confirmContinuationImport(
  bookId: string,
  importId: string,
  chapters: Array<{ importChapterId: string; title: string; included: boolean }>
): Promise<ContinuationImportData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/continuation-imports/${encodeURIComponent(importId)}/confirm`,
    { method: 'POST', body: JSON.stringify({ chapters }) }
  );
}

export function analyzeContinuationImport(
  bookId: string,
  importId: string
): Promise<ContinuationImportData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/continuation-imports/${encodeURIComponent(importId)}/analyze`,
    { method: 'POST', body: JSON.stringify({}) }
  );
}

export function fetchChapterDetail(bookId: string, chapterId: string, signal?: AbortSignal): Promise<{
  chapter: ChapterData;
  manuscripts: Array<Record<string, unknown>>;
  facts: Array<Record<string, unknown>>;
  reviews: Array<Record<string, unknown>>;
  production: {
    writingOrders: Array<Record<string, unknown>>;
    reviewPanels: Array<Record<string, unknown>>;
    reviewReports: Array<Record<string, unknown>>;
    approvalGates: Array<Record<string, unknown>>;
  };
}> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}`, signal === undefined ? {} : { signal });
}

export function saveOwnerManuscript(bookId: string, chapterId: string, input: {
  baseManuscriptVersionId: string | null; content: string; note?: string | null;
}): Promise<{ manuscriptVersionId: string; parentVersionId: string | null; contentHash: string; wordCount: number; status: 'candidate'; unchanged: boolean }> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}/manuscripts/owner-drafts`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function withdrawOwnerManuscript(
  bookId: string,
  chapterId: string,
  expectedManuscriptVersionId: string
): Promise<{
  withdrawnManuscriptVersionId: string;
  currentManuscriptVersionId: null;
  retainedInHistory: true;
}> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}/manuscripts/current/withdraw`, {
    method: 'POST', body: JSON.stringify({ expectedManuscriptVersionId })
  });
}

export function rewriteChapter(bookId: string, chapterId: string, manuscriptVersionId: string, instruction: string): Promise<{ taskId: string; operation: string; manuscriptVersionId: string }> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}/rewrite`, {
    method: 'POST', body: JSON.stringify({ manuscriptVersionId, instruction })
  });
}

export function finalizeChapter(bookId: string, chapterId: string, manuscriptVersionId: string): Promise<{ taskId: string; operation: string; confirmationId?: string }> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}/finalize`, {
    method: 'POST', body: JSON.stringify({ manuscriptVersionId })
  });
}

export function fetchArtifacts(bookId: string, signal?: AbortSignal): Promise<unknown[]> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/artifacts`, signal === undefined ? {} : { signal });
}

export function fetchArtifactVersions(bookId: string, artifactId: string): Promise<ArtifactVersionData[]> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/artifacts/${encodeURIComponent(artifactId)}/versions`);
}

export function addArtifactVersion(bookId: string, artifactId: string, content: Record<string, unknown>, parentVersionId: string | null): Promise<ArtifactVersionData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/artifacts/${encodeURIComponent(artifactId)}/versions`, {
    method: 'POST', body: JSON.stringify({ content, parentVersionId })
  });
}

export function selectArtifactVersion(bookId: string, artifactId: string, versionId: string): Promise<ArtifactVersionData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/artifacts/${encodeURIComponent(artifactId)}/select`, {
    method: 'POST', body: JSON.stringify({ versionId })
  });
}

export function rejectArtifactVersion(bookId: string, artifactId: string, versionId: string): Promise<ArtifactVersionData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/artifacts/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(versionId)}/reject`, {
    method: 'POST', body: JSON.stringify({})
  });
}

export function compareArtifactVersions(bookId: string, artifactId: string, left: string, right: string): Promise<{ same: boolean; changedTopLevelKeys: string[] }> {
  const query = new URLSearchParams({ left, right });
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/artifacts/${encodeURIComponent(artifactId)}/compare?${query.toString()}`);
}

export function fetchMemory(bookId: string, canonRevision: number, signal?: AbortSignal): Promise<unknown[]> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/memory?canonRevision=${canonRevision}`, signal === undefined ? {} : { signal });
}

export function fetchLibrary(bookId: string, signal?: AbortSignal): Promise<LibraryData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/library`, signal === undefined ? {} : { signal });
}

export async function fetchGraphWorkspace(bookId: string, signal?: AbortSignal): Promise<GraphWorkspaceData> {
  const [projections, library] = await Promise.all([
    fetchProjections(bookId, signal),
    fetchLibrary(bookId, signal)
  ]);
  return {
    relations: library.relations,
    projections: projections.filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value))
  };
}

export function createLibraryTag(bookId: string, input: { namespace: string; name: string; description?: string; appliesTo: string[]; color?: string | null }): Promise<{ tagId: string; status: 'proposed' | 'active' }> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/tags`, { method: 'POST', body: JSON.stringify(input) });
}

export function saveProtagonistProfile(bookId: string, input: { profileId?: string; displayName: string; entityId?: string | null; isPrimary?: boolean }): Promise<ProtagonistProfileData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/protagonists`, { method: 'POST', body: JSON.stringify(input) });
}

export function fetchProtagonists(bookId: string, signal?: AbortSignal): Promise<ProtagonistDashboardData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/protagonists`, signal === undefined ? {} : { signal });
}

export function fetchAttributeFormulas(bookId: string, signal?: AbortSignal): Promise<AttributeFormulaData[]> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/attribute-formulas`, signal === undefined ? {} : { signal });
}

export function fetchSettingOutlineWorkspace(bookId: string, signal?: AbortSignal): Promise<SettingOutlineWorkspaceData[]> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-outline-workspace`, signal === undefined ? {} : { signal });
}

export function fetchSettingOutlineVersions(
  bookId: string,
  itemKey: string,
  signal?: AbortSignal
): Promise<SettingOutlineItemVersionData[]> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/setting-outline-workspace/${encodeURIComponent(itemKey)}/versions`,
    signal === undefined ? {} : { signal }
  );
}

export function fetchSettingCollaboration(
  bookId: string,
  itemKey: string,
  signal?: AbortSignal
): Promise<SettingCollaborationData> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/setting-outline-workspace/${encodeURIComponent(itemKey)}/collaboration`,
    signal === undefined ? {} : { signal }
  );
}

export interface SettingCollaborationCommandData {
  taskId: string;
  discussionId: string;
  status: string;
  reused: boolean;
}

export function startSettingCollaboration(bookId: string, itemKey: string, input: {
  authorInputId?: string | null;
  idempotencyKey: string;
  screenwriterRoleKeys: string[];
}): Promise<SettingCollaborationCommandData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-outline-workspace/${encodeURIComponent(itemKey)}/collaboration/start`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function restartSettingCollaboration(bookId: string, itemKey: string, input: {
  authorInputId?: string | null;
  idempotencyKey: string;
  screenwriterRoleKeys: string[];
}): Promise<SettingCollaborationCommandData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-outline-workspace/${encodeURIComponent(itemKey)}/collaboration/restart`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function redesignSettingCollaborationMember(
  bookId: string,
  itemKey: string,
  roleKey: string,
  input: { proposalId: string; idempotencyKey: string }
): Promise<SettingCollaborationCommandData> {
  return request('/api/v1/books/' + encodeURIComponent(bookId) + '/setting-outline-workspace/' + encodeURIComponent(itemKey)
    + '/collaboration/members/' + encodeURIComponent(roleKey) + '/redesign', {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function retrySettingCollaborationMember(
  bookId: string,
  itemKey: string,
  roleKey: string,
  idempotencyKey: string
): Promise<SettingCollaborationCommandData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-outline-workspace/${encodeURIComponent(itemKey)}/collaboration/members/${encodeURIComponent(roleKey)}/retry`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey })
  });
}

export function fetchBookProfile(bookId: string, signal?: AbortSignal): Promise<BookProfileViewData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/book-profile`, signal === undefined ? {} : { signal });
}

export function updateBookProfile(bookId: string, input: {
  expectedVersion: number;
  title: string;
  openingBlueprint: OpeningBlueprintData;
}): Promise<BookProfileViewData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/book-profile`, {
    method: 'PUT',
    body: JSON.stringify(input)
  });
}

export type BookBrandingDesignKind = 'title' | 'synopsis';

export interface BookBrandingDesignData {
  designId: string;
  kind: BookBrandingDesignKind;
  status: 'working' | 'succeeded' | 'failed' | 'cancelled';
  taskId: string;
  taskStatus: string;
  currentPhase: string;
  errorCode: string | null;
  options: Array<{ text: string; note: string }>;
  member: { roleKey: string; agentId: string; displayName: string; provider: string; modelId: string } | null;
  createdAt: string;
  updatedAt: string;
}

export function startBrandingDesign(bookId: string, kind: BookBrandingDesignKind): Promise<BookBrandingDesignData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/branding-designs`, {
    method: 'POST',
    body: JSON.stringify({ kind, idempotencyKey: crypto.randomUUID() })
  });
}

export function fetchLatestBrandingDesign(
  bookId: string,
  kind: BookBrandingDesignKind,
  signal?: AbortSignal
): Promise<BookBrandingDesignData | null> {
  const query = `?kind=${encodeURIComponent(kind)}`;
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/branding-designs/latest${query}`,
    signal === undefined ? {} : { signal }
  );
}

export interface ChallengerReviewData {
  reviewId: string;
  chapterId: string;
  manuscriptVersionId: string;
  status: 'working' | 'succeeded' | 'failed' | 'cancelled';
  taskId: string;
  taskStatus: string;
  errorCode: string | null;
  report: {
    verdict: string;
    summary: string;
    issues: Array<{ location: string; issueType: string; severity: string; evidence: string; requiredAction: string }>;
    scores: Record<string, number>;
  } | null;
  member: { roleKey: string; agentId: string; displayName: string; provider: string; modelId: string } | null;
  createdAt: string;
  updatedAt: string;
}

export function startChallengerReview(bookId: string, chapterId: string): Promise<ChallengerReviewData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}/challenger-reviews`, {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID() })
  });
}

export function fetchLatestChallengerReview(
  bookId: string,
  chapterId: string,
  signal?: AbortSignal
): Promise<ChallengerReviewData | null> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/chapters/${encodeURIComponent(chapterId)}/challenger-reviews/latest`,
    signal === undefined ? {} : { signal }
  );
}

export function fetchPlanningState(bookId: string, signal?: AbortSignal): Promise<PlanningStateData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/planning-state`, signal === undefined ? {} : { signal });
}

export function fetchStyleBaseline(bookId: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/style-baseline`, signal === undefined ? {} : { signal });
}

export function fetchSettingReadiness(bookId: string): Promise<{
  ready: boolean;
  missing: string[];
  unresolved: string[];
  required: string[];
  recommended: string[];
  profileKey: string;
  profileLabel: string;
  hasCanonChapters: boolean;
}> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-baseline/readiness`);
}

export function clearSettingOutlineWorkspace(bookId: string, confirmText: string): Promise<{
  clearedItems: number;
  hasCanonChapters: boolean;
}> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-outline-workspace/clear`, {
    method: 'POST',
    body: JSON.stringify({ confirmText })
  });
}

export function confirmSettingBaseline(bookId: string, expectedPlanningVersion: number, acknowledgedIssueIds: string[] = []): Promise<{
  stage: string; version: number;
}> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-baseline/confirm`, {
    method: 'POST',
    body: JSON.stringify({ expectedPlanningVersion, acknowledgedIssueIds })
  });
}

export interface SettingQualityIssueData {
  id: string;
  severity: 'hard' | 'soft';
  itemKey: string;
  problem: string;
  suggestion: string;
  replacement: string;
  baseContentHash: string;
  applicable: boolean;
}

export interface SettingQualityReportView {
  report: {
    reportId: string;
    verdict: 'pass' | 'warn' | 'fail';
    summary: string;
    issues: SettingQualityIssueData[];
    createdAt: string;
  } | null;
  fresh: boolean;
  taskStatus: string | null;
}

export function fetchSettingQualityReport(bookId: string, signal?: AbortSignal): Promise<SettingQualityReportView> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-baseline/quality-report`, signal === undefined ? {} : { signal });
}

export function startSettingQualityAudit(bookId: string, idempotencyKey: string): Promise<{ taskId: string; status: string }> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-baseline/quality-audit`, {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey })
  });
}

export function applySettingQualitySuggestion(
  bookId: string,
  reportId: string,
  issueId: string
): Promise<SettingOutlineWorkspaceData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-baseline/quality-report/${encodeURIComponent(reportId)}/issues/${encodeURIComponent(issueId)}/apply`, {
    method: 'POST'
  });
}


export function confirmPlanningArtifact(
  bookId: string,
  expectedPlanningVersion: number,
  artifactVersionId: string,
  artifactType: 'master_outline' | 'chapter_outline'
): Promise<{ stage: string; version: number; artifactVersionId: string }> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/planning-artifacts/confirm`, {
    method: 'POST',
    body: JSON.stringify({ expectedPlanningVersion, artifactVersionId, artifactType })
  });
}

export function removeCurrentSettingOutlineItem(
  bookId: string,
  itemKey: string
): Promise<SettingOutlineWorkspaceData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-outline-workspace/${encodeURIComponent(itemKey)}/current`, {
    method: 'DELETE'
  });
}

export function saveSettingOutlineItem(
  bookId: string,
  item: Pick<
    SettingOutlineWorkspaceData,
    'itemKey' | 'groupTitle' | 'label' | 'prompt' | 'sourceLabel' | 'status' | 'custom' | 'sortOrder'
  > & {
    content?: string | null;
  }
): Promise<SettingOutlineWorkspaceData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-outline-workspace/${encodeURIComponent(item.itemKey)}`, {
    method: 'PUT',
    body: JSON.stringify({
      groupTitle: item.groupTitle,
      label: item.label,
      prompt: item.prompt,
      sourceLabel: item.sourceLabel,
      status: item.status,
      custom: item.custom,
      sortOrder: item.sortOrder,
      content: item.content ?? null
    })
  });
}

export function initializeSettingOutlineWorkspace(
  bookId: string,
  items: Array<Pick<
    SettingOutlineWorkspaceData,
    'itemKey' | 'groupTitle' | 'label' | 'prompt' | 'sourceLabel' | 'custom' | 'sortOrder'
  >>
): Promise<SettingOutlineWorkspaceData[]> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-outline-workspace/initialize`, {
    method: 'POST',
    body: JSON.stringify({ items })
  });
}

export function appendProtagonistState(bookId: string, profileId: string, input: {
  category: string; logicalKey: string; label: string; valueType: ProtagonistStateData['valueType']; value: unknown;
  unit?: string | null; stateStatus?: ProtagonistStateData['stateStatus']; confirmed?: boolean;
  effectiveChapterNumber?: number | null; note?: string | null;
}): Promise<ProtagonistStateData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/protagonists/${encodeURIComponent(profileId)}/state`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function archiveProtagonistState(bookId: string, entryId: string): Promise<ProtagonistStateData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/protagonist-state/${encodeURIComponent(entryId)}/archive`, {
    method: 'POST', body: JSON.stringify({})
  });
}

export function classifyProtagonistState(bookId: string, entryId: string, category: string): Promise<ProtagonistStateData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/protagonist-state/${encodeURIComponent(entryId)}/classify`, {
    method: 'POST', body: JSON.stringify({ category })
  });
}

export function createAttributeFormula(bookId: string, input: {
  formulaKey: string; label: string; category?: string; expression: string;
  variables: Array<{ key: string; label: string; defaultValue?: number }>; unit?: string | null;
}): Promise<AttributeFormulaData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/attribute-formulas`, { method: 'POST', body: JSON.stringify(input) });
}

export function evaluateAttributeFormula(bookId: string, formulaId: string, values: Record<string, number>): Promise<{
  formula: AttributeFormulaData; values: Record<string, number>; result: number;
}> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/attribute-formulas/${encodeURIComponent(formulaId)}/evaluate`, {
    method: 'POST', body: JSON.stringify({ values })
  });
}

export function fetchVolumeChapters(
  bookId: string,
  volumeId: string,
  options: { offset?: number; limit?: number; query?: string; status?: string; signal?: AbortSignal } = {}
): Promise<ChapterPageData> {
  const parameters = new URLSearchParams({
    offset: String(options.offset ?? 0),
    limit: String(options.limit ?? 80)
  });
  if (options.query?.trim()) parameters.set('query', options.query.trim());
  if (options.status?.trim()) parameters.set('status', options.status.trim());
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/volumes/${encodeURIComponent(volumeId)}/chapters?${parameters.toString()}`,
    options.signal === undefined ? {} : { signal: options.signal });
}

export function createManuscriptVolume(
  bookId: string,
  input: { volumeNumber: number; title: string }
): Promise<{ volumeId: string }> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/volumes`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function createManuscriptChapter(
  bookId: string,
  input: { volumeId: string; chapterNumber: number; title: string }
): Promise<ChapterData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/chapters`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function fetchModelBindings(bookId: string, signal?: AbortSignal): Promise<ModelBindingsData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/model-bindings`, signal === undefined ? {} : { signal });
}

export function previewModelBindings(bookId: string, profiles: Record<string, TeamModelProfileData>): Promise<unknown> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/model-bindings/preview`, {
    method: 'POST', body: JSON.stringify({ profiles })
  });
}

export function activateModelBindings(bookId: string, profiles: Record<string, TeamModelProfileData>, reason: string): Promise<unknown> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/model-bindings/activate`, {
    method: 'POST', body: JSON.stringify({ profiles, reason })
  });
}

export function restoreModelBindingRevision(bookId: string, revisionId: string): Promise<unknown> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/model-bindings/${encodeURIComponent(revisionId)}/restore`, {
    method: 'POST', body: JSON.stringify({})
  });
}

export function fetchOperationsStatus(signal?: AbortSignal): Promise<OperationsStatusData> {
  return request('/api/v1/operations/status', signal === undefined ? {} : { signal });
}

export function exportBookPackage(bookId: string): Promise<{ packageName: string; packagePath: string; manifestHash: string; rowCount: number; fileCount: number; byteCount: number }> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/export`, { method: 'POST', body: JSON.stringify({}) });
}

export function importBookCopy(packageName: string): Promise<{ bookId: string; title: string; sourceBookId: string; importedRows: number; importedFiles: number }> {
  return request('/api/v1/imports/copy', { method: 'POST', body: JSON.stringify({ packageName }) });
}

export function fetchProjections(bookId: string, signal?: AbortSignal): Promise<unknown[]> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/projections`, signal === undefined ? {} : { signal });
}

export function fetchIdeationMembers(bookId: string, signal?: AbortSignal): Promise<IdeationMemberData[]> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/ideation/members`, signal === undefined ? {} : { signal });
}

export function fetchIdeationRounds(bookId: string, signal?: AbortSignal): Promise<IdeationRoundData[]> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/ideation/rounds`, signal === undefined ? {} : { signal });
}

export function startIdeationRound(bookId: string, input: {
  message: string;
  participantAgentIds: string[];
  idempotencyKey: string;
}): Promise<IdeationRoundData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/ideation/rounds`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function promoteIdeationOpinion(bookId: string, roundId: string, input: {
  opinionId: string;
  surface: AuthorInputSurface;
  subjectType: string;
  subjectId?: string | null;
  intentStrength?: 'must' | 'strong_preference' | 'inspiration' | 'question';
  scopeNotes?: string | null;
  idempotencyKey: string;
}): Promise<AuthorPlanningInput> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/ideation/rounds/${encodeURIComponent(roundId)}/promote`, {
    method: 'POST', body: JSON.stringify(input)
  });
}
