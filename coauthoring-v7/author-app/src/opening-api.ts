import { notifyAuthorAuthenticationRequired } from './account-api';

export type OpeningChannel = 'male' | 'female';
export type OpeningPublishingPlatform = 'fanqie' | 'qidian' | 'mainstream';

export interface OpeningProtagonist {
  name: string;
  age: string;
  identity: string;
  background: string;
  familyBackground?: string;
  careerBackground?: string;
  goldenFinger?: string;
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
    channel: OpeningChannel | 'general';
    category: string;
    genres: string[];
    tags: string[];
    coreAppeal: string;
    targetReaders?: string;
    expectedTotalWords: number;
    volumePlan?: { minimum: number; recommended: number; maximum: number };
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
  mustFollow?: string[];
  authorInstructions?: string[];
}

export interface OpeningReview {
  verdict: 'pass' | 'revise' | 'author_decision';
  summary: string;
  issues: Array<{ field: string; evidence: string; impact: string; requiredAction: string }>;
  requiredChanges: string[];
  authorDecisions: string[];
  decisions?: Array<{
    decisionId: string;
    field: string;
    question: string;
    currentValue: string;
    recommendation: string;
    reason: string;
    impact: string;
    required: boolean;
  }>;
}

export interface OpeningDecisionResolution {
  decisionId: string;
  action: 'accept' | 'reject' | 'custom';
  customValue?: string;
}

export interface OpeningCandidate<T = unknown> {
  candidateId: string;
  kind: 'work_order' | 'opening_package' | 'opening_review';
  version: number;
  content: T;
  createdBy: { memberKey: string; displayName: string };
  sourceCandidateIds: string[];
}

export interface OpeningTaskView {
  taskId: string;
  idea: string;
  publishingPlatform: OpeningPublishingPlatform;
  status: string;
  phase: string;
  statusText: string;
  phaseText: string;
  isRunning: boolean;
  needsAuthorDecision: boolean;
  workflowStyle?: 'direct_design_review' | 'legacy_handoff';
  selectedMembers: {
    chiefEditor: { memberKey: string; displayName: string } | null;
    screenwriter: { memberKey: string; displayName: string } | null;
    designer?: { memberKey: string; displayName: string } | null;
    reviewer?: { memberKey: string; displayName: string } | null;
  };
  candidates: OpeningCandidate[];
  errorMessage: string | null;
  resultBookId: string | null;
  progress: { currentStep: number; totalSteps: number; percent: number };
  createdAt: string;
  updatedAt: string;
}

export interface EditorialDepartmentView {
  summary: { memberCount: number; readyCount: number; workingCount: number; leaveCount: number; completedCount: number };
  departments: Array<{
    departmentKey:
      | 'chief_editor'
      | 'deputy_editor'
      | 'planning_writer'
      | 'lead_writer'
      | 'independent_reviewer'
      | 'continuity_editor'
      | 'visual_renderer';
    name: string;
    members: Array<{
      memberKey: string;
      displayName: string;
      role: string;
      responsibility: string;
      capabilities: string[];
      presence: 'ready' | 'working' | 'leave';
      statusText: string;
      currentWork: string | null;
      completedCount: number;
    }>;
  }>;
}

interface OpeningTaskWireView extends Omit<OpeningTaskView, 'taskId' | 'errorMessage'> {
  taskId?: string;
  recoveryKey?: string;
  errorMessage?: string | null;
  recoveryMessage?: string | null;
}

export interface OpeningTaxonomy {
  version: string;
  categories: Array<{
    key: string;
    name: string;
    channel: OpeningChannel;
    description: string;
    recommendedMainTags: string[];
    tagPackKeys: string[];
  }>;
  subjects: Array<{ name: string; packKeys: string[] }>;
  mainTags: string[];
  personalityGroups?: Array<{
    key: string;
    name: string;
    description: string;
    options: string[];
  }>;
  boundaryGroups?: Array<{
    name: string;
    description: string;
    options: string[];
  }>;
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

export interface BookRecord {
  bookId: string;
  title: string;
  status: 'active' | 'archived';
  version: number;
  updatedAt: string;
}

export interface BookProfile {
  title: string;
  channel: '男频' | '女频';
  category: string;
  subjects: string[];
  mainTags: string[];
  customTags?: string[];
  protagonists: Array<{
    role?: string;
    name: string;
    age: string;
    background?: string;
    familyBackground?: string;
    careerBackground?: string;
    goldenFinger?: string;
    visualIdentity?: {
      appearance: string;
      build: string;
      signatureFeature: string;
    };
    personalities: string[];
  }>;
  synopsis?: string;
  storyDirection: string;
  openingStart: string;
  storyEnding: string;
  stylePrimary?: string;
  styleSecondary?: string;
  mustFollow?: string[];
  style?: {
    languageTones: string[];
    emotionalTones: string[];
    pacingAndPayoff: string[];
    atmospheres: string[];
    custom: string[];
  };
  source?: string;
  version?: number;
  openingBlueprint: {
    creationMode?: 'new' | 'continuation';
    openingIdea?: string;
    taxonomyVersion?: string;
    channel?: OpeningChannel;
    categoryKey?: string;
    auxiliaryCategoryKeys?: string[];
    targetAudience?: string;
    planningProfile?: {
      publishingPlatform: OpeningPublishingPlatform;
      expectedTotalWords: number;
      volumePlan?: { minimum: number; recommended: number; maximum: number };
      commercialAudience?: string;
      retentionPositioning?: string;
    };
    protagonists?: Array<{
      role: string;
      name: string;
      age: string;
      background?: string;
      familyBackground?: string;
      careerBackground?: string;
      goldenFinger?: string;
      visualIdentity?: {
        appearance: string;
        build: string;
        signatureFeature: string;
      };
      personalities: string[];
    }>;
    storyDirection?: string;
    openingStart?: string;
    storyEnding?: string;
    stylePrimary?: string;
    styleSecondary?: string;
    worldBackground: string;
    openingBackground: string;
    stageOne?: { start: string; development: string; end: string };
    fullBookOutline?: string;
    mainTags?: string[];
    auxiliaryTags?: string[];
    storyTraits?: string[];
    styleIntent?: {
      languageTones: string[];
      emotionalTones: string[];
      pacingAndPayoff: string[];
      atmospheres: string[];
      custom: string[];
    };
    customTags?: string[];
    initialMap?: string;
    mustFollow?: string[];
  };
}

export interface BookTitleDesignView {
  designId: string;
  status: 'working' | 'succeeded' | 'failed';
  statusText: string;
  memberName: string;
  options: Array<{ text: string; note: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface BookTitleStudioView { designs: BookTitleDesignView[]; }

export interface DesignTaskView {
  designId: string;
  taskKind: 'title_design' | 'cover_design';
  bookId: string;
  bookTitle: string;
  status: 'working' | 'succeeded' | 'failed';
  statusText: string;
  memberNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BookCoverDesignView {
  designId: string;
  status: 'working' | 'succeeded' | 'failed';
  statusText: string;
  adopted: boolean;
  chiefName: string;
  visualMembers: Array<{ memberKey: string; displayName: string; roleName: string; responsibility: string; avatarPath: string }>;
  workOrder: {
    platformStyle: 'qidian' | 'fanqie' | 'mainstream';
    visualStyle: 'vivid' | 'realistic' | 'abstract' | 'guofeng' | 'cinematic' | 'warm' | 'illustration' | 'anime' | 'ink' | 'retro' | 'scifi' | 'suspense' | 'romance';
    compositionStyle: 'character-closeup' | 'character-scene' | 'duality' | 'ensemble' | 'grand-scene' | 'symbolic';
    paletteStyle: 'high-contrast' | 'warm' | 'cool' | 'dark' | 'golden' | 'pastel';
    atmosphereStyle: 'intense' | 'epic' | 'suspense' | 'romantic' | 'healing' | 'lonely';
    elements: string[];
    avoidElements: string[];
    authorDirection: string;
    composition: string;
    visualFocus: string;
    atmosphere: string;
    palette: string;
    mustKeep: string[];
    mustAvoid: string[];
    plannerReview: string;
  } | null;
  imageUrl: string | null;
  downloadUrl: string | null;
  createdAt: string;
}

export interface BookCoverStudioView {
  visualMembers: Array<{
    memberKey: string;
    displayName: string;
    roleName: string;
    responsibility: string;
    avatarPath: string;
    status: 'on_duty' | 'on_leave';
    statusText: string;
  }>;
  designs: BookCoverDesignView[];
}

export class AuthorApiError extends Error {
  public constructor(message: string, public readonly retryable = false, public readonly status = 0) {
    super(message);
    this.name = 'AuthorApiError';
  }
}

const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.replace(/\/$/u, '') ?? '';

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'x-wenmi-author-projection': 'clean-v1',
        ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init?.headers
      }
    });
  } catch {
    throw new AuthorApiError('暂时连接不上文秘写作服务，请检查本地服务后重试。', true);
  }
  const body = await response.json().catch(() => null) as {
    data?: T;
    error?: { message?: string; retryable?: boolean };
  } | null;
  if (!response.ok || body?.data === undefined) {
    if (response.status === 401) notifyAuthorAuthenticationRequired();
    throw new AuthorApiError(
      body?.error?.message ?? `请求没有完成（${response.status}）`,
      body?.error?.retryable ?? response.status >= 500,
      response.status
    );
  }
  return body.data;
}

export function apiAssetUrl(path: string): string {
  return path.startsWith('/') ? `${API_ORIGIN}${path}` : path;
}

export function fetchOpeningTaxonomy(signal?: AbortSignal): Promise<OpeningTaxonomy> {
  return request('/api/v1/v7/opening-taxonomy', signal === undefined ? undefined : { signal });
}

export function createOpeningTask(
  idea: string,
  publishingPlatform: OpeningPublishingPlatform,
  idempotencyKey: string,
  selectedScreenwriterMemberKey?: string
): Promise<OpeningTaskView> {
  return request<OpeningTaskWireView>('/api/v1/v7/opening-agent/tasks', {
    method: 'POST',
    body: JSON.stringify({
      idea,
      publishingPlatform,
      idempotencyKey,
      ...(selectedScreenwriterMemberKey === undefined || selectedScreenwriterMemberKey.length === 0
        ? {}
        : { selectedScreenwriterMemberKey })
    })
  }).then(normalizeOpeningTaskView);
}

export function fetchOpeningTask(taskId: string, signal?: AbortSignal): Promise<OpeningTaskView> {
  return request<OpeningTaskWireView>(
    `/api/v1/v7/opening-agent/tasks/${encodeURIComponent(taskId)}`,
    signal === undefined ? undefined : { signal }
  ).then(normalizeOpeningTaskView);
}

export function fetchOpeningTasks(signal?: AbortSignal): Promise<OpeningTaskView[]> {
  return request<OpeningTaskWireView[]>(
    '/api/v1/v7/opening-agent/tasks?limit=50',
    signal === undefined ? undefined : { signal }
  ).then((items) => items.map(normalizeOpeningTaskView));
}

export function abandonOpeningTask(taskId: string): Promise<OpeningTaskView> {
  return request<OpeningTaskWireView>(`/api/v1/v7/opening-agent/tasks/${encodeURIComponent(taskId)}/abandon`, {
    method: 'POST',
    body: JSON.stringify({})
  }).then(normalizeOpeningTaskView);
}

export function abandonAllOpeningTasks(): Promise<{ archivedCount: number; skippedCreatedCount: number }> {
  return request('/api/v1/v7/opening-agent/tasks/abandon-all', {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export function fetchEditorialDepartment(signal?: AbortSignal): Promise<EditorialDepartmentView> {
  return request('/api/v1/v7/editorial-department', signal === undefined ? undefined : { signal });
}

export function reviseOpeningTask(input: {
  taskId: string;
  baseCandidateId: string;
  openingPackage: OpeningPackage;
  adjustmentNote: string;
  decisionResolutions: OpeningDecisionResolution[];
  idempotencyKey: string;
}): Promise<OpeningTaskView> {
  return request<OpeningTaskWireView>(`/api/v1/v7/opening-agent/tasks/${encodeURIComponent(input.taskId)}/revisions`, {
    method: 'POST',
    body: JSON.stringify({
      baseCandidateId: input.baseCandidateId,
      openingPackage: input.openingPackage,
      adjustmentNote: input.adjustmentNote,
      decisionResolutions: input.decisionResolutions,
      idempotencyKey: input.idempotencyKey
    })
  }).then(normalizeOpeningTaskView);
}

function normalizeOpeningTaskView(value: OpeningTaskWireView): OpeningTaskView {
  const taskId = typeof value.taskId === 'string' && value.taskId.length > 0
    ? value.taskId
    : typeof value.recoveryKey === 'string' && value.recoveryKey.length > 0
      ? value.recoveryKey
      : null;
  if (taskId === null) throw new AuthorApiError('任务已建立，但恢复编号缺失；请刷新后重试。', true);
  const {
    taskId: _internalTaskId,
    recoveryKey: _recoveryKey,
    errorMessage: internalErrorMessage,
    recoveryMessage,
    ...publicView
  } = value;
  return {
    ...publicView,
    taskId,
    errorMessage: internalErrorMessage ?? recoveryMessage ?? null
  };
}

export function confirmOpeningBook(input: {
  taskId?: string;
  candidateId?: string;
  openingIdea?: string;
  openingPackage: OpeningPackage;
  idempotencyKey: string;
}): Promise<{ bookId: string; title: string; status: 'active'; nextView: 'information' }> {
  return request('/api/v1/v7/opening-books', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchBooks(signal?: AbortSignal): Promise<BookRecord[]> {
  return request('/api/v1/v7/books', signal === undefined ? undefined : { signal });
}

export function archiveBook(bookId: string, expectedVersion: number): Promise<BookRecord> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/archive`, {
    method: 'POST', body: JSON.stringify({ expectedVersion })
  });
}

export function restoreBook(bookId: string, expectedVersion: number): Promise<BookRecord> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/restore`, {
    method: 'POST', body: JSON.stringify({ expectedVersion })
  });
}

export function submitAuthorFeedback(input: {
  category: 'bug' | 'experience' | 'suggestion' | 'other';
  message: string;
  bookId?: string;
  pagePath: string;
}): Promise<{ feedbackId: string; received: boolean }> {
  return request('/api/v1/feedback', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchBookProfile(bookId: string, signal?: AbortSignal): Promise<BookProfile> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/book-profile`, signal === undefined ? undefined : { signal });
}

export function updateBookProfile(bookId: string, input: { expectedVersion: number; title: string; openingBlueprint: BookProfile['openingBlueprint'] }): Promise<BookProfile> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/book-profile`, {
    method: 'PUT', body: JSON.stringify(input)
  });
}

export function designBookTitles(bookId: string, input: { idempotencyKey: string; platformStyle: 'qidian' | 'fanqie' | 'mainstream'; titleFlavor: 'high-concept' | 'strong-conflict' | 'identity-gap' | 'suspense' | 'epic'; authorDirection: string }): Promise<BookTitleDesignView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/title-designs`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function fetchBookTitleStudio(bookId: string, signal?: AbortSignal): Promise<BookTitleStudioView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/title-studio`, signal === undefined ? undefined : { signal });
}

export function fetchDesignTasks(signal?: AbortSignal): Promise<DesignTaskView[]> {
  return request('/api/v1/v7/design-tasks?limit=50', signal === undefined ? undefined : { signal });
}

export function fetchBookCoverStudio(bookId: string, signal?: AbortSignal): Promise<BookCoverStudioView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/cover-studio`, signal === undefined ? undefined : { signal });
}

export function designBookCover(bookId: string, input: {
  idempotencyKey: string;
  platformStyle: 'qidian' | 'fanqie' | 'mainstream';
  visualStyle: 'vivid' | 'realistic' | 'abstract' | 'guofeng' | 'cinematic' | 'warm' | 'illustration' | 'anime' | 'ink' | 'retro' | 'scifi' | 'suspense' | 'romance';
  compositionStyle: 'character-closeup' | 'character-scene' | 'duality' | 'ensemble' | 'grand-scene' | 'symbolic';
  paletteStyle: 'high-contrast' | 'warm' | 'cool' | 'dark' | 'golden' | 'pastel';
  atmosphereStyle: 'intense' | 'epic' | 'suspense' | 'romantic' | 'healing' | 'lonely';
  elements: string[];
  avoidElements: string[];
  authorDirection: string;
}): Promise<BookCoverDesignView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/cover-designs`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function adoptBookCover(bookId: string, designId: string): Promise<BookCoverDesignView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/cover-designs/${encodeURIComponent(designId)}/adopt`, {
    method: 'POST', body: JSON.stringify({})
  });
}

export function newActionKey(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`.replace(/[^a-zA-Z0-9_-]/gu, '').slice(0, 128);
}

export interface SettingCatalogItem {
  key: string; label: string; prompt: string; source: string; groupKey: string; groupTitle: string;
  required: boolean; deputyPolicy: 'never' | 'conditional';
}
export interface SettingMemberView {
  memberKey: string; displayName: string; role: '主编' | '副编' | '编剧'; presence: 'ready' | 'working' | 'leave';
  statusText: string; currentItem: string | null; handoffTo: string | null; completedCount: number;
}
export interface SettingIssue { problem: string; impact: string; suggestion: string; }
export interface SettingItemView {
  itemKey: string; label: string; groupTitle: string;
  state: 'queued' | 'working' | 'chief_review' | 'needs_author' | 'confirmed' | 'failed';
  stateText: string; assignedMemberKey: string | null; content: string | null; designRationale: string | null;
  storyConsequences: string[]; issues: SettingIssue[]; suggestions: string[]; revision: number;
}
export interface SettingBatchView {
  batchId: string; status: 'queued' | 'working' | 'awaiting_author' | 'completed' | 'partially_failed';
  statusText: string; progress: { completed: number; total: number; percent: number };
  members: SettingMemberView[]; items: SettingItemView[]; createdAt: string; updatedAt: string;
}
export interface SettingFinalReviewView {
  taskId: string;
  status: 'queued' | 'working' | 'ready' | 'failed';
  statusText: string;
  progress: number;
  member: { memberKey: string; displayName: string } | null;
  result: null | {
    verdict: 'pass' | 'needs_author';
    summary: string;
    unifiedDecisions: Array<{ topic: string; decision: string; reason: string }>;
    conflicts: Array<{ itemKeys: string[]; problem: string; decision: string; impact: string }>;
    patchedItemKeys: string[];
  };
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
}
interface SettingFinalReviewWireView extends Omit<SettingFinalReviewView, 'taskId'> {
  taskId?: string;
  recoveryKey?: string;
}
export interface SettingCatalogRecommendationView {
  taskId: string;
  status: 'queued' | 'working' | 'ready' | 'failed';
  statusText: string;
  phase: 'preparing' | 'understanding' | 'organizing' | 'validating' | 'handoff' | 'ready' | 'failed';
  phaseText: string;
  progress: number;
  member: { memberKey: string; displayName: string } | null;
  attemptedMembers: Array<{ memberKey: string; displayName: string }>;
  result: { requiredKeys: string[]; suggestedKeys: string[]; excludedKeys: string[]; summary: string } | null;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
}
interface SettingCatalogRecommendationWireView extends Omit<SettingCatalogRecommendationView, 'taskId'> {
  taskId?: string;
  recoveryKey?: string;
}
export interface SettingDepartmentView {
  catalog: SettingCatalogItem[]; recommendedKeys: string[]; confirmedItems: SettingItemView[];
  members: SettingMemberView[]; activeBatch: SettingBatchView | null;
  recommendation: SettingCatalogRecommendationView | null;
  finalReview: SettingFinalReviewView | null;
}
interface SettingDepartmentWireView extends Omit<SettingDepartmentView, 'recommendation' | 'finalReview'> {
  recommendation?: SettingCatalogRecommendationWireView | null;
  finalReview?: SettingFinalReviewWireView | null;
}
export interface SettingRedesignCandidate { outputId: string; memberKey: string; proposal: { content: string; designRationale: string; storyConsequences: string[]; dependencies: string[]; risks: string[] }; }

function settingTaskId(value: { taskId?: string; recoveryKey?: string }): string {
  const taskId = typeof value.taskId === 'string' && value.taskId.length > 0
    ? value.taskId
    : typeof value.recoveryKey === 'string' && value.recoveryKey.length > 0
      ? value.recoveryKey
      : null;
  if (taskId === null) throw new AuthorApiError('任务已建立，但恢复编号缺失；请刷新后重试。', true);
  return taskId;
}

function normalizeSettingCatalogRecommendationView(value: SettingCatalogRecommendationWireView): SettingCatalogRecommendationView {
  const taskId = settingTaskId(value);
  const { taskId: _taskId, recoveryKey: _recoveryKey, ...view } = value;
  return { ...view, taskId };
}

function normalizeSettingFinalReviewView(value: SettingFinalReviewWireView): SettingFinalReviewView {
  const taskId = settingTaskId(value);
  const { taskId: _taskId, recoveryKey: _recoveryKey, ...view } = value;
  return { ...view, taskId };
}

function normalizeSettingDepartmentView(value: SettingDepartmentWireView): SettingDepartmentView {
  return {
    ...value,
    recommendation: value.recommendation == null ? null : normalizeSettingCatalogRecommendationView(value.recommendation),
    finalReview: value.finalReview == null ? null : normalizeSettingFinalReviewView(value.finalReview)
  };
}

export function fetchSettingDepartment(bookId: string, signal?: AbortSignal): Promise<SettingDepartmentView> {
  return request<SettingDepartmentWireView>(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-department`, signal === undefined ? undefined : { signal })
    .then(normalizeSettingDepartmentView);
}
export function createSettingRecommendation(bookId: string): Promise<SettingCatalogRecommendationView> {
  return request<SettingCatalogRecommendationWireView>(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-recommendations`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey: newActionKey('setting-recommendation') })
  }).then(normalizeSettingCatalogRecommendationView);
}
export function fetchSettingRecommendation(bookId: string, taskId: string, signal?: AbortSignal): Promise<SettingCatalogRecommendationView> {
  return request<SettingCatalogRecommendationWireView>(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-recommendations/${encodeURIComponent(taskId)}`, signal === undefined ? undefined : { signal })
    .then(normalizeSettingCatalogRecommendationView);
}
export function fetchCurrentSettingRecommendation(bookId: string, signal?: AbortSignal): Promise<SettingCatalogRecommendationView> {
  return request<SettingCatalogRecommendationWireView>(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-recommendations/current`, signal === undefined ? undefined : { signal })
    .then(normalizeSettingCatalogRecommendationView);
}
export function retrySettingRecommendation(bookId: string): Promise<SettingCatalogRecommendationView> {
  return request<SettingCatalogRecommendationWireView>(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-recommendations/retry`, {
    method: 'POST', body: JSON.stringify({})
  }).then(normalizeSettingCatalogRecommendationView);
}
export function createSettingBatch(bookId: string, input: { selectedItemKeys: string[]; customItems: Array<{ label: string; prompt: string }>; authorNotes: Record<string, string>; }): Promise<SettingBatchView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-batches`, { method: 'POST', body: JSON.stringify({ ...input, idempotencyKey: newActionKey('setting-batch') }) });
}
export function fetchSettingBatch(bookId: string, batchId: string, signal?: AbortSignal): Promise<SettingBatchView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-batches/${encodeURIComponent(batchId)}`, signal === undefined ? undefined : { signal });
}
export function retrySettingBatch(bookId: string, batchId: string): Promise<SettingBatchView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-batches/${encodeURIComponent(batchId)}/retry`, { method: 'POST', body: JSON.stringify({}) });
}
export function createSettingFinalReview(bookId: string): Promise<SettingFinalReviewView> {
  return request<SettingFinalReviewWireView>(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-final-reviews`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey: newActionKey('setting-final-review') })
  }).then(normalizeSettingFinalReviewView);
}
export function fetchCurrentSettingFinalReview(bookId: string, signal?: AbortSignal): Promise<SettingFinalReviewView> {
  return request<SettingFinalReviewWireView>(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-final-reviews/current`, signal === undefined ? undefined : { signal })
    .then(normalizeSettingFinalReviewView);
}
export function retrySettingFinalReview(bookId: string, taskId: string): Promise<SettingFinalReviewView> {
  return request<SettingFinalReviewWireView>(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-final-reviews/${encodeURIComponent(taskId)}/retry`, {
    method: 'POST', body: JSON.stringify({})
  }).then(normalizeSettingFinalReviewView);
}
export function confirmSettingItem(bookId: string, itemKey: string, expectedRevision: number): Promise<SettingItemView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-items/${encodeURIComponent(itemKey)}/confirm`, { method: 'POST', body: JSON.stringify({ expectedRevision }) });
}
export function reviseSettingItem(bookId: string, itemKey: string, content: string): Promise<SettingItemView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-items/${encodeURIComponent(itemKey)}/revisions`, { method: 'POST', body: JSON.stringify({ content, idempotencyKey: newActionKey('setting-revision') }) });
}
export function createSettingItemReviewTask(bookId: string, itemKey: string, input: { content?: string; instruction?: string }): Promise<SettingBatchView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-items/${encodeURIComponent(itemKey)}/review-tasks`, {
    method: 'POST',
    body: JSON.stringify({ ...input, idempotencyKey: newActionKey('setting-review-task') })
  });
}
export function redesignSettingItem(bookId: string, itemKey: string, memberKeys: string[], authorNote: string): Promise<{ candidates: SettingRedesignCandidate[]; failedMemberKeys: string[] }> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-items/${encodeURIComponent(itemKey)}/redesigns`, { method: 'POST', body: JSON.stringify({ memberKeys, authorNote, idempotencyKey: newActionKey('setting-redesign') }) });
}
export function fuseSettingItem(bookId: string, itemKey: string, outputIds: string[], authorNote: string): Promise<SettingItemView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/setting-items/${encodeURIComponent(itemKey)}/fusions`, { method: 'POST', body: JSON.stringify({ outputIds, authorNote, idempotencyKey: newActionKey('setting-fusion') }) });
}

export interface PlanningRouteVolumeView {
  order: number;
  title: string;
  direction: string;
  protagonistChange: string;
  mainPressure: string;
  readerPayoff: string;
  targetWords: number;
  handoff: string;
}

export interface PlanningRouteView {
  routeId: string;
  memberKey: string;
  memberName: string;
  title: string;
  oneLinePromise: string;
  summary: string;
  designRationale?: string;
  readingExperience: string;
  protagonistJourney: string;
  targetWords: number;
  targetVolumes: number;
  commercialAudience: string;
  retentionPositioning: string;
  volumes: PlanningRouteVolumeView[];
  firstVolumeFocus: string[];
  sellingPoints: string[];
  risks: string[];
  openQuestions: string[];
}

export interface PlanningRouteRunView {
  runId: string;
  status: 'waiting' | 'working' | 'waiting_for_you' | 'completed' | 'failed';
  phase: 'preparing' | 'choosing_methods' | 'designing_routes' | 'chief_review' | 'waiting_for_you' | 'completed' | 'failed';
  message: string;
  progress: { completed: number; total: 7; percent: number };
  actors: Array<{
    memberKey: string; memberName: string; role: string;
    status: 'working' | 'completed' | 'waiting' | 'failed'; message: string; emoji: string;
  }>;
  routes: PlanningRouteView[];
  chiefReview: null | {
    memberKey: string;
    memberName: string;
    summary: string;
    recommendedRouteId: string;
    routeReviews: Array<{
      routeId: string;
      publicName: string;
      biggestStrength: string;
      mainRisk: string;
      suitableFor: string;
      keyDifference: string;
      volumeJudgement: string;
      audienceJudgement: string;
      retentionJudgement: string;
    }>;
    commonRisks: string[];
    authorDecisions: string[];
  };
  sourceIssues: string[];
  expectedRoutes?: number;
  canDecide: boolean;
  errorMessage: string | null;
  timing?: PlanningTaskTimingView;
}

export interface PlanningTaskTimingView {
  createdAt: string;
  lastActivityAt: string;
  elapsedSeconds: number;
  idleSeconds: number;
  state: 'normal' | 'slow' | 'overdue';
}

export interface PlanningMemberView {
  memberKey: string;
  name: string;
  roleKey: 'chief_editor' | 'deputy_editor' | 'planning_writer' | 'continuity_editor';
  role: string;
  defaultForRole: boolean;
}

export interface PlanningTreeNodeView {
  key: string;
  kind: 'book' | 'volume' | 'ending' | 'chain' | 'event';
  sequence: number;
  title: string;
  story: { summary: string; majorEvents: string[]; protagonistChange: string; outcome: string; nextStep: string };
  emotion: { publicSummary: string; openingEmotion: string; pressureMovement: string; releaseEmotion: string; intensity: string };
  experience: { publicSummary: string; pressureRhythm: string; payoffCadence: string; informationRhythm: string; contrastWithPrevious: string; designReason: string };
  causality: { trigger: string; causes: string[]; coreConflict: string; turningPoint: string; consequences: string[] };
  threads: { foreshadowing: string[]; openQuestions: string[] };
  budget: { wordTarget: number | null; chapterRange: readonly [number, number] | null };
  linkedTree: { treeKind: 'volume' | 'chain'; scopeId: string } | null;
  actual: null | { state: 'partial' | 'completed' | 'deviated'; summary: string; emotionResult: string; experienceResult: string; outcome: string; recordedAt: string };
  children: PlanningTreeNodeView[];
}

export interface PlanningTreeView {
  treeKind: 'book' | 'volume' | 'chain';
  scopeId: string;
  revision: number;
  status: 'candidate' | 'confirmed';
  title: string;
  designSummary?: null | {
    decisionNote: string;
    originalApproaches: Array<{ title: string; applicationNote: string }>;
  };
  root: PlanningTreeNodeView;
}

export interface PlanningTreeGenerationView {
  runId: string;
  treeKind: 'book' | 'volume' | 'chain';
  scopeId: string;
  status: 'waiting' | 'working' | 'ready' | 'failed' | 'result_unknown';
  message: string;
  member: { memberKey: string; name: string };
  candidateTreeVersionId: string | null;
  canOpenCandidate: boolean;
  errorMessage: string | null;
  timing?: PlanningTaskTimingView;
}

export interface PlanningTaskView {
  taskId: string;
  taskKind: 'planning_route' | 'planning_tree';
  bookId: string;
  bookTitle: string;
  status: 'waiting' | 'working' | 'waiting_for_you' | 'completed' | 'failed' | 'cancelled';
  message: string;
  progress: number;
  memberKey: string | null;
  memberName: string | null;
  treeKind: 'book' | 'volume' | 'chain' | null;
  scopeId: string | null;
  canStop: boolean;
  updatedAt: string;
}

interface PlanningTaskWireView extends Omit<PlanningTaskView, 'taskId'> {
  taskId?: string;
  recoveryKey?: string;
}

export interface PlanningAdjustmentSuggestionView {
  suggestionId: string;
  treeKind: 'book' | 'volume' | 'chain';
  scopeId: string;
  nodeKey: string;
  publicSummary: string;
  detail: { reason?: string; proposedChange?: string };
  createdAt: string;
}

export function createPlanningRouteRun(
  bookId: string,
  authorGoal: string,
  candidateCount = 1,
  memberKeys: string[] = []
): Promise<PlanningRouteRunView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/planning-routes/runs`, {
    method: 'POST', body: JSON.stringify({ authorGoal, candidateCount, memberKeys, idempotencyKey: newActionKey('planning-routes') })
  });
}

export function retryMissingPlanningRoutes(bookId: string, runId: string): Promise<PlanningRouteRunView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/planning-routes/runs/${encodeURIComponent(runId)}/retry-missing`, {
    method: 'POST', body: JSON.stringify({})
  });
}

export function fetchPlanningMembers(signal?: AbortSignal): Promise<PlanningMemberView[]> {
  return request('/api/v1/v7/editorial/planning-members', signal === undefined ? undefined : { signal });
}

export function fetchPlanningTasks(signal?: AbortSignal): Promise<PlanningTaskView[]> {
  return request<PlanningTaskWireView[]>('/api/v1/v7/planning-tasks?limit=80', signal === undefined ? undefined : { signal })
    .then((items) => items.map(normalizePlanningTaskView));
}

function normalizePlanningTaskView(value: PlanningTaskWireView): PlanningTaskView {
  const recoveryKey = typeof value.taskId === 'string' && value.taskId.length > 0
    ? value.taskId
    : typeof value.recoveryKey === 'string' && value.recoveryKey.length > 0
      ? value.recoveryKey
      : `${value.taskKind}:${value.bookId}:${value.scopeId ?? 'book'}:${value.updatedAt}`;
  const { taskId: _taskId, recoveryKey: _recoveryKey, ...task } = value;
  return {
    ...task,
    taskId: recoveryKey,
    canStop: (_taskId !== undefined || _recoveryKey !== undefined) && task.canStop
  };
}

export function fetchPlanningAdjustmentSuggestions(bookId: string, signal?: AbortSignal): Promise<PlanningAdjustmentSuggestionView[]> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/planning-adjustment-suggestions`, signal === undefined ? undefined : { signal });
}

export function decidePlanningAdjustmentSuggestion(bookId: string, suggestionId: string, decision: 'accept' | 'dismiss', authorNote = ''): Promise<{ suggestionId: string; state: 'accepted' | 'dismissed'; nextEffect: 'next_candidate_only' | 'none' }> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/planning-adjustment-suggestions/${encodeURIComponent(suggestionId)}/decision`, {
    method: 'POST', body: JSON.stringify({ decision, authorNote, idempotencyKey: newActionKey('planning-adjustment') })
  });
}

export function fetchLatestPlanningRouteRun(bookId: string, signal?: AbortSignal): Promise<PlanningRouteRunView | null> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/planning-routes/latest`, signal === undefined ? undefined : { signal });
}

export function fetchPlanningRouteRun(bookId: string, runId: string, signal?: AbortSignal): Promise<PlanningRouteRunView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/planning-routes/runs/${encodeURIComponent(runId)}`, signal === undefined ? undefined : { signal });
}

export function cancelPlanningRouteRun(bookId: string, runId: string): Promise<PlanningRouteRunView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/planning-routes/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST', body: JSON.stringify({})
  });
}

export function decidePlanningRoute(bookId: string, runId: string, input: {
  mode: 'select' | 'adjust' | 'merge';
  routeIds: string[];
  authorNote: string;
}): Promise<{ routeVersionId: string; recipeVersionId: string; status: 'confirmed'; nextStep: 'book_tree' }> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/planning-routes/runs/${encodeURIComponent(runId)}/decision`, {
    method: 'POST', body: JSON.stringify({ ...input, idempotencyKey: newActionKey('planning-route-decision') })
  });
}

export function fetchPlanningTree(bookId: string, treeKind: 'book' | 'volume' | 'chain', scopeId: string, signal?: AbortSignal): Promise<PlanningTreeView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/planning-trees/${treeKind}/${encodeURIComponent(scopeId)}`, signal === undefined ? undefined : { signal });
}

export function createPlanningTreeGeneration(
  bookId: string,
  treeKind: 'book' | 'volume' | 'chain',
  scopeId: string,
  selectedMemberKey?: string
): Promise<PlanningTreeGenerationView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/planning-trees/${treeKind}/${encodeURIComponent(scopeId)}/generation-runs`, {
    method: 'POST', body: JSON.stringify({
      ...(selectedMemberKey === undefined || selectedMemberKey.length === 0 ? {} : { selectedMemberKey }),
      idempotencyKey: newActionKey('planning-tree')
    })
  });
}

export function fetchLatestPlanningTreeGeneration(bookId: string, treeKind: 'book' | 'volume' | 'chain', scopeId: string, signal?: AbortSignal): Promise<PlanningTreeGenerationView | null> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/planning-trees/${treeKind}/${encodeURIComponent(scopeId)}/generation-runs/latest`, signal === undefined ? undefined : { signal });
}

export function fetchPlanningTreeGeneration(bookId: string, runId: string, signal?: AbortSignal): Promise<PlanningTreeGenerationView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/planning-tree-generation-runs/${encodeURIComponent(runId)}`, signal === undefined ? undefined : { signal });
}

export function retryPlanningTreeGeneration(bookId: string, runId: string): Promise<PlanningTreeGenerationView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/planning-tree-generation-runs/${encodeURIComponent(runId)}/retry`, {
    method: 'POST', body: JSON.stringify({})
  });
}

export function cancelPlanningTreeGeneration(bookId: string, runId: string): Promise<PlanningTreeGenerationView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/planning-tree-generation-runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST', body: JSON.stringify({})
  });
}

export function confirmPlanningTree(bookId: string, treeKind: 'book' | 'volume' | 'chain', scopeId: string, expectedRevision: number): Promise<PlanningTreeView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/planning-trees/${treeKind}/${encodeURIComponent(scopeId)}/confirm`, {
    method: 'POST', body: JSON.stringify({ expectedRevision, idempotencyKey: newActionKey('planning-tree-confirm') })
  });
}
