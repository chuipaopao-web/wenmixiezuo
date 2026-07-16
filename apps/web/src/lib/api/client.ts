export interface HealthData {
  service: string;
  status: string;
  releaseId: string;
  schemaVersion: number;
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
  chapterNumber: number;
  title: string;
  planStatus: string;
  generationStatus: string;
  settlementStatus: string;
  currentManuscriptVersionId: string | null;
  canonManuscriptVersionId: string | null;
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
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

export async function createBook(input: { title: string; text: string }): Promise<{ bookId: string }> {
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

export function fetchArtifacts(bookId: string, signal?: AbortSignal): Promise<unknown[]> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/artifacts`, signal === undefined ? {} : { signal });
}

export function fetchMemory(bookId: string, canonRevision: number, signal?: AbortSignal): Promise<unknown[]> {
  return request(`/api/v1/books/${encodeURIComponent(bookId)}/memory?canonRevision=${canonRevision}`, signal === undefined ? {} : { signal });
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
