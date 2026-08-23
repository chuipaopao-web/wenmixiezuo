export type AdminSection = 'dashboard' | 'users' | 'compute' | 'api' | 'models' | 'issues' | 'templates' | 'prompts' | 'memberships';

export interface AdminDashboardData {
  overview: {
    failedTasksToday: number; apiCashMicrosToday: number; activeMembers: number; computeToday: number;
    openIssues: number; revenueCashMicros: number; monthRevenueCashMicros: number;
  };
  business: {
    registeredUsers: number; cumulativePaidUsers: number; cumulativePaidRate: number | null;
    newUsers30d: number; firstPaidUsers30d: number; firstPaidRate30d: number | null; activePaidUsers: number;
    recordedMembershipRevenueCashMicros: number;
    definitions: { cumulativePaidRate: string; firstPaidRate30d: string; revenue: string };
  };
  trend: Array<{ day: string; cashMicros: number; compute: number; calls: number; revenueCashMicros: number }>;
  topUsers: Array<{ userId: string; displayName: string; email: string; compute: number; cashMicros: number; calls: number }>;
  expiring: Array<{ userId: string; displayName: string; email: string; plan: string; periodEnd: string; daysRemaining: number }>;
}

export interface AdminUser {
  userId: string; email: string; displayName: string; role: 'admin' | 'user'; status: 'active' | 'suspended';
  createdAt?: string; lastLoginAt?: string | null;
}

export interface AdminUserOperation {
  userId: string; email: string; displayName: string; status: string; createdAt: string; lastLoginAt: string | null; lastActivityAt: string | null;
  membership: { plan?: string; status?: string; periodEnd?: string } | null;
  bookCount: number; activeBookCount: number; archivedBookCount: number;
  today: { day: string; taskCount: number; failed: boolean; failureCount: number };
  books: Array<{ bookId: string; title: string; status: string; workflowStage: string; currentVolume: number | null;
    currentEvent: number | null; currentChapter: number | null; latestManuscriptAt: string | null;
    latestSettlementAt: string | null; latestTaskId: string | null; latestTaskStatus: string | null; latestTaskAt: string | null }>;
  failures: Array<{ taskId: string; bookId: string; bookTitle: string; taskType: string; workflowNode: string;
    status: string; errorCode: string | null; occurredAt: string; memberName?: string | null; memberRole?: string | null;
    frontEndPage: string; errorSummary: string; recoveryKey: string; retainedResults: number;
    failedSeats: Array<{ memberName: string; roleKey: string; error: string }> }>;
}

export interface AdminUserOperationsData { timezone: 'Asia/Shanghai'; day: string; items: AdminUserOperation[] }

export interface AdminAiGovernanceData {
  initialMemberCount: number; roleCategoryCount: number; books?: Array<{ bookId: string; title: string }>;
  storylineQuality?: { candidateCount: number; acceptedCount: number; rejectedCount: number; observingCount: number;
    duplicateCount: number; noEvidenceCount: number; incorrectFactMixCount: number; adoptionRate: number | null;
    continueObservingRate: number | null; duplicateRate: number | null; noEvidenceRate: number | null;
    definitions: { adoption: string; duplicate: string; noEvidence: string; incorrectFactMix: string } };
  actualMembers: Array<{ bookId: string; bookTitle: string; agentId: string; displayName: string; roleKey: string;
    enabled: number; activationState: string; supplierCompany: string; costTier: string; provider: string; modelId: string;
    latestTaskStatus: string | null; updatedAt: string }>;
  codeSkills: Array<{ skillVersionId: string; layer: string; roleKey: string | null; nodeKind: string | null;
    version: number; content: Record<string, unknown>; contentHash: string }>;
  storedSkills: Array<{ skillVersionId: string; layer: string; roleKey: string | null; nodeKind: string | null;
    version: number; contentJson: string; contentHash: string; status: string; createdAt: string }>;
  templates: Array<{ templateVersionId: string; templateKey: string; targetObject: string; version: number;
    schemaJson: string; promptContractJson: string; contentHash: string; status: string; rolloutPercent: number; createdAt: string }>;
  batches: Array<{ batchId: string; bookId: string; bookTitle: string; nodeKind: string; roleKey: string; status: string;
    contextPackId: string; contextPackHash: string; coreSkillVersionId: string; roleSkillVersionId: string;
    nodeSkillVersionId: string; templateVersion: string; templateVersionId: string | null; templateHash: string | null;
    members: number; distinctContextHashes: number; distinctModelSignatures: number; createdAt: string }>;
  calls: PromptCall[];
}
export interface AdminMembershipRecord {
  plan: 'bronze' | 'silver' | 'gold' | 'diamond'; planLabel: string; status: 'active' | 'revoked';
  tokenQuota: number; periodTokens: number; totalTokens: number; periodStart: string; periodEnd: string; expired: boolean;
}

export interface AdminMembershipUser {
  userId: string; displayName: string; email: string; role: 'admin' | 'user'; accountStatus: 'active' | 'suspended';
  membership: AdminMembershipRecord | null; totalTokens: number;
}

export interface AdminUsageData {
  totalTokens: number; totalInputTokens?: number; totalOutputTokens?: number; totalCashMicros: number; totalCalls: number;
  perUser: Array<{ userId: string; email: string; displayName: string; role: string; status: string; books: number; tokens: number; calls: number; cashMicros?: number }>;
  perModel: Array<{ provider: string; modelId: string; calls: number; tokens: number; inputTokens?: number; outputTokens?: number; cashMicros?: number }>;
  daily: Array<{ day: string; tokens: number; calls: number; cashMicros?: number }>;
}

export interface AdminIssue {
  sourceType: 'failed_task' | 'feedback'; sourceId: string; taskId: string | null; bookId: string | null; bookTitle: string;
  userId: string | null; displayName: string; email: string; category: string; detail: string; errorCode: string | null;
  pagePath: string; occurredAt: string; status: 'open' | 'in_progress' | 'resolved' | 'ignored';
  severity: 'low' | 'medium' | 'high' | 'critical'; note: string;
}

export interface AdminModelScheme {
  source: 'custom' | 'default'; updatedAt: string | null; updatedBy: string | null;
  profiles: Record<string, { provider: string; modelId: string; plan: string }>;
  allowedModels: Array<{ provider: string; modelId: string; plan: string }>;
  members: Array<{ roleKey: string; memberName: string; shortTitle: string }>;
}

export interface NarrativeMethodContent {
  internalLabel: string; suitableProblems: string[]; organization: string[]; fitLengths: string[]; fitGenres: string[];
  routineRisks: string[]; adaptability: { movable: boolean; mergeable: boolean; deletable: boolean; note: string };
}

export interface NarrativeMethod {
  methodKey: string; category: string; builtInVersion: string; content: NarrativeMethodContent; enabled: boolean;
  activeOverrideVersion: number | null; updatedAt: string | null;
}

export interface PromptCatalogData {
  triggers: Array<{ triggerKey: string; surface: string; authorActions: string[]; interventionTiming: string; taskPurpose: string; memberRoles: string[]; contextPackages: string[]; output: string }>;
  members: Array<{ roleKey: string; memberName: string; shortTitle: string }>;
  purposes: string[];
  overrides: Array<{ promptOverrideId: string; triggerKey: string; roleKey: string; phaseKey: string; version: number; content: string; createdAt: string }>;
}

export interface PromptCall {
  requestId: string; taskType: string; roleKey: string; phaseKey: string; promptOverrideId: string | null; createdAt: string;
  state: string; provider: string; modelId: string; inputTokens: number | null; outputTokens: number | null; cashMicros: number | null;
  displayName: string | null; bookTitle: string;
}

export interface MembershipStats {
  summary: { activeMembers: number; totalRevenueCashMicros: number; monthRevenueCashMicros: number; renewals: number; expiringIn30Days: number };
  byPlan: Array<{ plan: string; members: number }>;
  transactions: Array<{ transactionId: string; eventType: string; plan: string; amountCashMicros: number; periodStart: string; periodEnd: string; note: string; createdAt: string; userId: string; displayName: string; email: string }>;
}

interface ApiEnvelope<T> { data?: T; error?: { message?: string } }

const ADMIN_API_ORIGIN = import.meta.env.VITE_API_ORIGIN
  ?? (typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/u.test(location.hostname)
    ? 'http://127.0.0.1:43111' : '');

export async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${ADMIN_API_ORIGIN}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers
    }
  });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message ?? `请求失败（${response.status}）`);
  return payload.data;
}

export const fetchDashboard = (signal?: AbortSignal) => adminRequest<AdminDashboardData>('/api/v1/admin/dashboard', signal === undefined ? {} : { signal });
export const fetchUserOperations = (day = '', signal?: AbortSignal) => {
  const query = day ? `?day=${encodeURIComponent(day)}` : '';
  return adminRequest<AdminUserOperationsData>(`/api/v1/admin/user-operations${query}`, signal === undefined ? {} : { signal });
};
export const fetchAiGovernance = (signal?: AbortSignal) => adminRequest<AdminAiGovernanceData>('/api/v1/admin/ai-governance', signal === undefined ? {} : { signal });
export const addAdminAiMember = (bookId: string, input: { roleKey: string; displayName: string; provider: string; modelId: string;
  supplierCompany: string; costTier: string }) => adminRequest(`/api/v1/admin/books/${encodeURIComponent(bookId)}/ai-members`, {
    method: 'POST', body: JSON.stringify(input)
  });
export const updateAdminAiMember = (bookId: string, agentId: string, input: { enabled?: boolean; provider?: string; modelId?: string;
  supplierCompany?: string; costTier?: string }) => adminRequest(`/api/v1/admin/books/${encodeURIComponent(bookId)}/ai-members/${encodeURIComponent(agentId)}`, {
    method: 'PATCH', body: JSON.stringify(input)
  });
export const createCreativeTemplateVersion = (templateKey: string, input: { targetObject: string; schema: Record<string, unknown>;
  promptContract: Record<string, unknown>; rolloutPercent: number }) => adminRequest(`/api/v1/admin/creative-templates/${encodeURIComponent(templateKey)}/versions`, {
    method: 'POST', body: JSON.stringify(input)
  });
export const activateCreativeTemplateVersion = (templateVersionId: string, rolloutPercent: number) =>
  adminRequest(`/api/v1/admin/creative-templates/${encodeURIComponent(templateVersionId)}/activate`, {
    method: 'POST', body: JSON.stringify({ rolloutPercent })
  });
export const setCreativeTemplateRollout = (templateVersionId: string, rolloutPercent: number) =>
  adminRequest(`/api/v1/admin/creative-templates/${encodeURIComponent(templateVersionId)}/rollout`, {
    method: 'PATCH', body: JSON.stringify({ rolloutPercent })
  });export const fetchAdminUsersPage = (query = '', status = '', signal?: AbortSignal) => {
  const params = new URLSearchParams({ limit: '100' });
  if (query) params.set('query', query);
  if (status) params.set('status', status);
  return adminRequest<{ items: AdminUser[]; total: number }>(`/api/v1/admin/users?${params}`, signal === undefined ? {} : { signal });
};
export const setAdminUserStatus = (userId: string, status: 'active' | 'suspended') => adminRequest<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(userId)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
export const fetchMembershipUsers = (query = '', status = '', signal?: AbortSignal) => {
  const params = new URLSearchParams({ limit: '100' });
  if (query) params.set('query', query);
  if (status) params.set('status', status);
  return adminRequest<{ items: AdminMembershipUser[]; total: number }>(`/api/v1/admin/memberships?${params}`, signal === undefined ? {} : { signal });
};
export const grantMembership = (userId: string, plan: string, amountCny: number, note = '') => adminRequest(`/api/v1/admin/memberships/${encodeURIComponent(userId)}`, { method: 'POST', body: JSON.stringify({ plan, amountCny, note }) });
export const revokeMembership = (userId: string) => adminRequest(`/api/v1/admin/memberships/${encodeURIComponent(userId)}/revoke`, { method: 'POST', body: '{}' });
export const fetchUsage = (signal?: AbortSignal) => adminRequest<AdminUsageData>('/api/v1/admin/usage', signal === undefined ? {} : { signal });
export const fetchIssues = (filters: { query?: string; status?: string; source?: string } = {}, signal?: AbortSignal) => {
  const params = new URLSearchParams({ limit: '100' });
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  return adminRequest<{ items: AdminIssue[]; total: number }>(`/api/v1/admin/issues?${params}`, signal === undefined ? {} : { signal });
};
export const updateIssue = (issue: AdminIssue, input: { status: string; severity: string; note: string }) => adminRequest(`/api/v1/admin/issues/${issue.sourceType}/${encodeURIComponent(issue.sourceId)}`, { method: 'PATCH', body: JSON.stringify(input) });
export const fetchModelScheme = (signal?: AbortSignal) => adminRequest<AdminModelScheme>('/api/v1/admin/model-scheme', signal === undefined ? {} : { signal });
export const saveModelScheme = (profiles: AdminModelScheme['profiles'], reason: string) => adminRequest<{ updatedAt: string; convergence: { booksVisited: number; revisedBooks: number; updatedAgents: number } }>('/api/v1/admin/model-scheme', { method: 'POST', body: JSON.stringify({ profiles, reason }) });
export const fetchNarrativeMethods = (signal?: AbortSignal) => adminRequest<{ items: NarrativeMethod[] }>('/api/v1/admin/narrative-methods', signal === undefined ? {} : { signal });
export const saveNarrativeMethod = (methodKey: string, content: NarrativeMethodContent, enabled: boolean) => adminRequest(`/api/v1/admin/narrative-methods/${encodeURIComponent(methodKey)}`, { method: 'PUT', body: JSON.stringify({ content, enabled }) });
export const fetchPromptCatalog = (signal?: AbortSignal) => adminRequest<PromptCatalogData>('/api/v1/admin/prompt-catalog', signal === undefined ? {} : { signal });
export const fetchRuntimeSystemPrompt = (roleKey: string, purpose: string) => adminRequest<{ roleKey: string; purpose: string; systemPrompt: string }>(`/api/v1/admin/runtime-system-prompt?roleKey=${encodeURIComponent(roleKey)}&purpose=${encodeURIComponent(purpose)}`);
export const savePromptOverride = (input: { triggerKey: string; roleKey: string; phaseKey: string; content: string }) => adminRequest('/api/v1/admin/prompt-overrides', { method: 'POST', body: JSON.stringify(input) });
export const archivePromptOverride = (id: string) => adminRequest(`/api/v1/admin/prompt-overrides/${encodeURIComponent(id)}/archive`, { method: 'POST', body: '{}' });
export const fetchPromptCalls = (signal?: AbortSignal) => adminRequest<{ items: PromptCall[] }>('/api/v1/admin/prompt-calls?limit=100', signal === undefined ? {} : { signal });
export const fetchPromptCall = (requestId: string) => adminRequest<Record<string, unknown>>(`/api/v1/admin/prompt-calls/${encodeURIComponent(requestId)}`);
export const fetchMembershipStats = (signal?: AbortSignal) => adminRequest<MembershipStats>('/api/v1/admin/membership-stats', signal === undefined ? {} : { signal });
