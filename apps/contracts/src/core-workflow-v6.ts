export const CORE_WORKFLOW_V6_CONTRACT_VERSION = 1 as const;

export const coreWorkflowStages = ['setting', 'storyline', 'volume', 'event', 'chapter'] as const;
export type CoreWorkflowStage = typeof coreWorkflowStages[number];

export const storylineTopologyTypes = ['core_with_branches', 'dual_core', 'multi_core', 'unit_stories'] as const;
export type StorylineTopologyType = typeof storylineTopologyTypes[number];
export const storylineLifecycleStatuses = ['ideation', 'active', 'paused', 'completed', 'abandoned'] as const;
export type StorylineLifecycleStatus = typeof storylineLifecycleStatuses[number];
export const storylineVolumeParticipationStatuses = ['leading', 'important', 'foreshadow', 'paused', 'unrelated'] as const;
export type StorylineVolumeParticipationStatus = typeof storylineVolumeParticipationStatuses[number];

export interface StorylineTopologyContent {
  topologyType: StorylineTopologyType;
  plainLanguageReason: string;
  lineResponsibilities: string[];
  authorNotes: string | null;
}

export interface StorylineContent {
  title: string;
  lineKind: 'core' | 'branch' | 'unit';
  coreQuestion: string;
  stageGoal: string;
  expectedStages: string[];
  associatedCharacterIds: string[];
  foreshadowingKeys: string[];
  rhythmMethodVersionId: string | null;
}

export interface StorylineVersionView {
  storylineVersionId: string;
  version: number;
  status: 'candidate' | 'active' | 'superseded' | 'archived';
  baseVersion: number;
  parentVersionId: string | null;
  sourceVersionIds: string[];
  authorInputRefs: string[];
  content: StorylineContent;
  contentHash: string;
  createdAt: string;
  confirmedAt: string | null;
}

export interface StorylineView {
  storylineId: string;
  sortOrder: number;
  lifecycleStatus: StorylineLifecycleStatus;
  activeVersionId: string | null;
  activeVersion: StorylineVersionView | null;
  versions: StorylineVersionView[];
}

export interface StorylineRelationView {
  storylineRelationId: string;
  fromStorylineId: string;
  toStorylineId: string;
  relationType: 'serves' | 'constrains' | 'mirrors' | 'intersects';
  description: string;
  status: 'active' | 'archived';
}

export interface StorylineVolumeParticipationView {
  storylineVolumeParticipationId: string;
  storylineId: string;
  volumePlanId: string;
  participationStatus: StorylineVolumeParticipationStatus;
  responsibility: string | null;
  sourceStorylineVersionId: string;
  status: 'active' | 'stale' | 'archived';
}

export interface CharacterCardContent {
  name: string;
  roleSummary: string;
  desire: string;
  currentState: string;
  boundaries: string[];
  storylineInfluences: Array<{ storylineId: string; influence: string }>;
}

export interface CharacterCardView {
  characterId: string;
  characterKind: 'protagonist' | 'existing' | 'volume_new' | 'temporary';
  lifecycleStatus: 'draft' | 'active' | 'retired' | 'archived';
  activeVersionId: string | null;
  promotedFromCharacterId: string | null;
  version: number;
  content: CharacterCardContent | null;
}

export interface EventRoleAssignmentView {
  eventRoleAssignmentId: string;
  eventChainVersionId: string;
  eventNodeId: string;
  roleFunctionKey: string;
  roleFunctionLabel: string;
  requirement: Record<string, unknown>;
  assignedCharacterId: string | null;
  assignmentStatus: 'placeholder' | 'assigned' | 'needs_review';
  sourceCharacterVersionId: string | null;
}

export const creativeLedgerTypes = ['storyline', 'relationship', 'world_state', 'causality', 'foreshadow', 'settlement'] as const;
export type CreativeLedgerType = typeof creativeLedgerTypes[number];
export interface CreativeLedgerEntryView {
  ledgerEntryId: string;
  ledgerType: CreativeLedgerType;
  truthStatus: 'planned' | 'actual';
  scopeType: 'book' | 'volume' | 'event' | 'chapter';
  scopeId: string;
  subjectKey: string;
  entryStatus: 'planned' | 'active' | 'advanced' | 'resolved' | 'abandoned' | 'superseded';
  content: Record<string, unknown>;
  sourceKind: 'topology' | 'storyline' | 'volume_plan' | 'event_plan' | 'chapter_outline' | 'manuscript' | 'chapter_settlement' | 'event_settlement' | 'volume_settlement';
  sourceVersionId: string;
  sourceLocator: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuthorObjectDraftView {
  authorObjectDraftId: string;
  objectType: 'topology' | 'storyline' | 'volume_direction' | 'expression' | 'event_chain' | 'event' | 'character' | 'chapter_sequence' | 'chapter_outline' | 'manuscript';
  objectId: string;
  baseVersion: number;
  draftRevision: number;
  draft: Record<string, unknown>;
  authorInputVersion: number;
  status: 'active' | 'confirmed' | 'superseded' | 'conflicted' | 'archived';
  updatedAt: string;
}

export interface WorkflowInvalidationView {
  invalidationId: string;
  upstreamObjectType: string;
  upstreamObjectId: string;
  upstreamVersionId: string;
  downstreamObjectType: string;
  downstreamObjectId: string;
  resolution: 'stale' | 'recompile_required' | 'review_required' | 'resolved' | 'not_affected';
  impact: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
}

export interface CoreWorkflowV6View {
  contractVersion: typeof CORE_WORKFLOW_V6_CONTRACT_VERSION;
  stage: CoreWorkflowStage;
  stateVersion: number;
  blockingReason: string | null;
  topology: {
    active: { topologyVersionId: string; version: number; topologyType: StorylineTopologyType; content: StorylineTopologyContent; contentHash: string } | null;
    candidates: Array<{ topologyVersionId: string; version: number; topologyType: StorylineTopologyType; content: StorylineTopologyContent; contentHash: string }>;
  };
  storylines: StorylineView[];
  relations: StorylineRelationView[];
  volumeParticipations: StorylineVolumeParticipationView[];
  characters: CharacterCardView[];
  eventRoleAssignments: EventRoleAssignmentView[];
  ledgers: Record<CreativeLedgerType, { planned: CreativeLedgerEntryView[]; actual: CreativeLedgerEntryView[] }>;
  drafts: AuthorObjectDraftView[];
  invalidations: WorkflowInvalidationView[];
}

export const internalMethodScopes = ['book_topology', 'storyline_rhythm', 'volume_rhythm', 'event_rhythm', 'content_type'] as const;
export type InternalMethodScope = typeof internalMethodScopes[number];
export interface InternalStructureMethodScopeView {
  methodVersionId: string;
  primaryScope: InternalMethodScope;
  applicableScopes: InternalMethodScope[];
  publicMapping: Record<string, string>;
}