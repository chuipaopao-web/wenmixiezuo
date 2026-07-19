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
  canonRevision: number;
  positioningVersion: number;
  updatedAt: string;
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
  publicSummary?: string;
  responsibilities?: string[];
  boundaries?: string[];
  retrievalFocus?: string[];
  outputKinds?: string[];
}

export interface TaskData {
  taskId: string;
  taskType: string;
  status: string;
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
  localAssistant?: {
    displayName: string;
    roleName: string;
    status: 'ready' | 'degraded' | 'offline';
    sessionCount: number;
    summary: string;
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
  summary: { entityCount: number; factCount: number; relationCount: number; tagCount: number; projectionCount: number; openGapCount: number };
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
  return fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init.headers }
  });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    throw new Error(message ?? `本地接口请求失败：${response.status}`);
  }
  return (body as ApiResponse<T>).data;
}

export function fetchHealth(signal?: AbortSignal): Promise<HealthData> {
  return request('/health', signal === undefined ? {} : { signal });
}

export function fetchCapabilities(signal?: AbortSignal): Promise<CapabilityData> {
  return request('/api/v1/capabilities', signal === undefined ? {} : { signal });
}

export function fetchBooks(signal?: AbortSignal): Promise<BookData[]> {
  return request('/api/v1/books', signal === undefined ? {} : { signal });
}

export function fetchWorkspace(bookId: string, signal?: AbortSignal): Promise<WorkspaceData> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/workspace`, signal === undefined ? {} : { signal });
}

export function fetchMessages(bookId: string, signal?: AbortSignal): Promise<MessageData[]> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/messages?limit=500`, signal === undefined ? {} : { signal });
}

export function fetchWorker(signal?: AbortSignal): Promise<WorkerData> {
  return request('/api/v1/runtime/worker', signal === undefined ? {} : { signal });
}

export async function createBook(input: { title: string; text: string; category?: string; classification?: string; targetAudience?: string; expectedScaleChars?: number; initialExpressionBaseline?: string }): Promise<{ bookId: string }> {
  const draft = await request<{ draftId: string; version: number }>('/api/v1/books/drafts', {
    method: 'POST', body: JSON.stringify(input)
  });
  return request(`/api/v1/book-drafts/${encodeURIComponent(draft.draftId)}/confirm`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: draft.version })
  });
}

export function sendMessage(bookId: string, content: string): Promise<{ messageId: string; action: Record<string, unknown> }> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/messages`, {
    method: 'POST', body: JSON.stringify({ content })
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

export function createLibraryTag(bookId: string, input: { namespace: string; name: string; description?: string; appliesTo: string[]; color?: string | null }): Promise<{ tagId: string; status: 'proposed' | 'active' }> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/tags`, { method: 'POST', body: JSON.stringify(input) });
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
  return [{ section: '版权隔离', data: copyright }, { section: '研究来源', data: sources }, { section: '候选主张', data: claims }];
}
