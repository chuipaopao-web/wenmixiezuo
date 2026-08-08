import type {
  AuthorInputSurface,
  AuthorPlanningInput,
  CreateAuthorPlanningInputCommand,
  DecideAuthorPlanningInputCommand,
  NarrativeTemplateCatalogView,
  PlanningScope
} from '@wenmi/contracts';
import { authorErrorMessage } from './author-error';

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
      plan: 'deterministic' | 'codex' | 'coding' | 'agent';
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

export interface ConversationReceptionData {
  kind:
    | 'guidance_scheduled'
    | 'guidance_in_progress'
    | 'guidance_available'
    | 'awaiting_confirmation'
    | 'guidance_paused'
    | 'guidance_failed'
    | 'guidance_cancelled'
    | 'setting_complete'
    | 'planning_next';
  headline: string;
  message: string;
  settingItemKey?: string;
  settingLabel?: string;
  taskId?: string;
  taskStatus?: string;
  editorAgentId?: string;
  editorName?: string;
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
  updatedAt: string;
}

export interface SettingCollaborationData {
  item: SettingOutlineWorkspaceData;
  panel: null | {
    taskId: string;
    discussionId: string;
    taskStatus: string;
    discussionStatus: string;
    errorCode: string | null;
    createdAt: string;
    updatedAt: string;
    proposals: Array<{
      number: number;
      messageId: string;
      agentId: string | null;
      memberName: string;
      roleKey: string | null;
      modelProvider: string | null;
      modelId: string | null;
      content: string;
      decisionId: string | null;
      createdAt: string;
    }>;
  };
  revisionTask: null | {
    taskId: string;
    status: string;
    errorCode: string | null;
    updatedAt: string;
  };
  historyCount: number;
  impact: {
    changesCanon: false;
    changesManuscript: false;
    formalVersionTiming: 'setting_baseline_confirmation';
  };
}

export type OpeningChannel = 'male' | 'female';
export type BookCreationMode = 'new' | 'continuation';
export type ProtagonistRole = 'male_lead' | 'female_lead' | 'co_lead' | 'ensemble' | 'non_human';

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
  personalityOptions: string[];
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
  protagonists: Array<{ role: ProtagonistRole; name: string; age: string; background: string; personalities: string[] }>;
  storyDirection: string;
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
  storyDirection: string;
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
  messageCount: number;
  creativeSession?: CreativeSessionData | null;
  localAssistant?: {
    displayName: string;
    roleName: string;
    status: 'ready' | 'degraded' | 'offline';
    sessionCount: number;
    summary: string;
  };
}

export interface TaskCenterBookData {
  book: BookData;
  chapters: ChapterData[];
  agents: AgentData[];
  tasks: TaskData[];
  budget: WorkspaceData['budget'];
  confirmations: WorkspaceData['confirmations'];
}

export interface TaskCenterData {
  books: TaskCenterBookData[];
}

export interface CreativeSessionData {
  sessionId: string;
  status: 'exploring' | 'awaiting_direction' | 'planning' | 'awaiting_plan' | 'ready' | 'paused';
  mode: 'open_discussion' | 'creative_forecast' | 'trial_draft' | 'formal_production';
  activeTopic: string;
  currentBlackboardRevision: number;
  canonRevision: number;
  blackboard: null | {
    revision: number;
    currentGoal: string;
    maturity: 'exploring' | 'comparing' | 'direction_ready' | 'planning' | 'ready';
    nextStep: string;
    candidates: unknown[];
    disagreements: unknown[];
    risks: unknown[];
    unknowns: unknown[];
    lockedDirection: null | { decisionId: string; summary: string };
  };
  activeForecast: null | {
    forecastId: string;
    status: string;
    staleReason: string | null;
    branchCount: number;
    branches: Array<{
      branchId: string;
      ordinal: number;
      title: string;
      proposal: Record<string, unknown>;
      sourceAgentId: string | null;
    }>;
  };
}

export interface LibraryData {
  canonRevision: number;
  entities: Array<Record<string, unknown>>;
  facts: Array<Record<string, unknown>>;
  relations: Array<Record<string, unknown>>;
  tags: Array<Record<string, unknown>>;
  projections: Array<Record<string, unknown>>;
  gaps: Array<Record<string, unknown>>;
  settings: LibrarySettingData[];
  bookProfile: BookProfileViewData | null;
  protagonists?: ProtagonistDashboardData;
  attributeFormulas?: AttributeFormulaData[];
  summary: { entityCount: number; factCount: number; relationCount: number; tagCount: number; projectionCount: number; openGapCount: number };
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
  plan: 'deterministic' | 'codex' | 'coding' | 'agent';
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

export interface MessageData {
  message_id: string;
  sender_type: 'boss' | 'agent' | 'system';
  sender_agent_id: string | null;
  role_key: string | null;
  model_provider: string | null;
  model_id: string | null;
  message_type: string;
  content: string;
  references_json: string;
  created_at: string;
}

export interface ChatAttachmentData {
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

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? 'http://127.0.0.1:43111';
let sessionPromise: Promise<void> | null = null;

async function establishRuntimeSession(): Promise<void> {
  const response = await fetch(`${API_ORIGIN}/api/v1/runtime/session`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  if (!response.ok) throw new Error('无法建立文秘写作本机会话');
}

function ensureRuntimeSession(): Promise<void> {
  sessionPromise ??= establishRuntimeSession().catch((error: unknown) => {
    sessionPromise = null;
    throw error;
  });
  return sessionPromise;
}

async function performRequest(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: 'include',
    headers
  });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    if (path.startsWith('/api/v1/')) await ensureRuntimeSession();
    let response = await performRequest(path, init);
    if (response.status === 401 && path.startsWith('/api/v1/')) {
      sessionPromise = null;
      await ensureRuntimeSession();
      response = await performRequest(path, init);
    }
    const body = await response.json() as ApiResponse<T> | { error?: { message?: string } };
    if (!response.ok) {
      const message = 'error' in body ? body.error?.message : undefined;
      throw new Error(authorErrorMessage(message ?? '', response.status));
    }
    return (body as ApiResponse<T>).data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof TypeError && /fetch|network|load failed/iu.test(error.message)) {
      throw new Error('无法连接文秘写作服务，请重新启动应用后再试。');
    }
    throw error;
  }
}

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

export function fetchPlanningTemplates(bookId: string, scope: PlanningScope, signal?: AbortSignal): Promise<NarrativeTemplateCatalogView> {
  return request(
    `/api/v1/books/${encodeURIComponent(bookId)}/planning-templates?scope=${encodeURIComponent(scope)}`,
    signal === undefined ? {} : { signal }
  );
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

export function fetchMessages(bookId: string, signal?: AbortSignal): Promise<MessageData[]> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/messages?limit=500`, signal === undefined ? {} : { signal });
}

export function enterConversation(bookId: string, signal?: AbortSignal): Promise<ConversationReceptionData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/conversation-entry`, {
    method: 'POST',
    body: JSON.stringify({}),
    ...(signal === undefined ? {} : { signal })
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

export function uploadChatAttachment(bookId: string, file: File): Promise<ChatAttachmentData> {
  const body = new FormData();
  body.append('file', file, file.name);
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/chat-attachments`, { method: 'POST', body });
}

export function discardChatAttachment(bookId: string, attachmentId: string): Promise<ChatAttachmentData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/chat-attachments/${encodeURIComponent(attachmentId)}/discard`, {
    method: 'POST', body: JSON.stringify({})
  });
}

export function chatAttachmentContentUrl(bookId: string, attachmentId: string): string {
  return `${API_ORIGIN}/api/v1/books/${encodeURIComponent(bookId)}/chat-attachments/${encodeURIComponent(attachmentId)}/content`;
}

export function sendMessage(bookId: string, content: string, attachmentIds: string[] = []): Promise<{ messageId: string; action: Record<string, unknown> }> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/messages`, {
    method: 'POST', body: JSON.stringify({ content, attachmentIds })
  });
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
}> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-baseline/readiness`);
}

export function confirmSettingBaseline(bookId: string, expectedPlanningVersion: number): Promise<{
  stage: string; version: number;
}> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/setting-baseline/confirm`, {
    method: 'POST',
    body: JSON.stringify({ expectedPlanningVersion })
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

export async function fetchRightsWorkspace(bookId: string, signal?: AbortSignal): Promise<unknown[]> {
  const options = signal === undefined ? {} : { signal };
  const [copyright, sources, claims] = await Promise.all([
    request(`/api/v1/books/${encodeURIComponent(bookId)}/copyright/summary`, options),
    request(`/api/v1/books/${encodeURIComponent(bookId)}/research/sources`, options),
    request(`/api/v1/books/${encodeURIComponent(bookId)}/research/claims`, options)
  ]);
  return [{ section: '版权隔离', data: copyright }, { section: '研究来源', data: sources }, { section: '待核对说法', data: claims }];
}
