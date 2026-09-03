export interface AdminAccount {
  userId: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  status: 'active' | 'suspended';
}

export interface PlatformDashboard {
  overview: {
    failedTasksToday: number;
    apiCashMicrosToday: number;
    activeMembers: number;
    computeToday: number;
    imageUnitsToday: number;
    reservedImageUnits: number;
    openIssues: number;
    revenueCashMicros: number;
    monthRevenueCashMicros: number;
  };
  business: {
    registeredUsers: number;
    cumulativePaidUsers: number;
    cumulativePaidRate: number | null;
    newUsers30d: number;
    firstPaidUsers30d: number;
    firstPaidRate30d: number | null;
    activePaidUsers: number;
    recordedMembershipRevenueCashMicros: number;
  };
  trend: Array<{ day: string; cashMicros: number; compute: number; imageUnits: number; calls: number; revenueCashMicros: number }>;
  topUsers: Array<{ userId: string; displayName: string; email: string; compute: number; cashMicros: number; imageUnits: number; calls: number }>;
  expiring: Array<{ userId: string; displayName: string; email: string; plan: string; periodEnd: string; daysRemaining: number }>;
}

export interface UserOperation {
  userId: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  membership: { plan?: string; status?: string; periodEnd?: string } | null;
  bookCount: number;
  activeBookCount: number;
  archivedBookCount: number;
  today: { day: string; taskCount: number; failed: boolean; failureCount: number };
  books: Array<{
    bookId: string;
    title: string;
    status: string;
    workflowStage: string;
    currentVolume: number | null;
    currentEvent: number | null;
    currentChapter: number | null;
    latestManuscriptAt: string | null;
    latestSettlementAt: string | null;
    latestTaskId: string | null;
    latestTaskStatus: string | null;
    latestTaskAt: string | null;
  }>;
  failures: Array<{
    taskId: string;
    bookId: string;
    bookTitle: string;
    taskType: string;
    workflowNode: string;
    status: string;
    errorCode: string | null;
    occurredAt: string;
    frontEndPage: string;
    errorSummary: string;
    recoveryKey: string;
  }>;
}

export interface PlatformUser {
  userId: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  status: 'active' | 'suspended';
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface PlatformUsage {
  totalTokens: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCashMicros: number;
  totalImageUnits: number;
  totalReservedImageUnits: number;
  totalCalls: number;
  perUser: Array<{ userId: string; email: string; displayName: string; role: string; status: string; books: number; tokens: number; calls: number; cashMicros?: number; imageUnits: number; reservedImageUnits: number }>;
  perModel: Array<{ provider: string; modelId: string; calls: number; tokens: number; inputTokens?: number; outputTokens?: number; cashMicros?: number; imageUnits: number }>;
  daily: Array<{ day: string; tokens: number; calls: number; cashMicros?: number; imageUnits: number }>;
}

export interface PlatformIssue {
  sourceType: 'failed_task' | 'feedback';
  sourceId: string;
  taskId: string | null;
  bookId: string | null;
  bookTitle: string;
  userId: string | null;
  displayName: string;
  email: string;
  category: string;
  detail: string;
  errorCode: string | null;
  pagePath: string;
  occurredAt: string;
  status: 'open' | 'in_progress' | 'resolved' | 'ignored';
  severity: 'low' | 'medium' | 'high' | 'critical';
  note: string;
}

export interface MembershipStats {
  summary: {
    activeMembers: number;
    totalRevenueCashMicros: number;
    monthRevenueCashMicros: number;
    renewals: number;
    expiringIn30Days: number;
  };
  byPlan: Array<{ plan: string; members: number }>;
  transactions: Array<{
    transactionId: string;
    eventType: string;
    plan: string;
    amountCashMicros: number;
    periodStart: string;
    periodEnd: string;
    note: string;
    createdAt: string;
    userId: string;
    displayName: string;
    email: string;
  }>;
}

export type MembershipPlan = 'bronze' | 'silver' | 'gold' | 'diamond';

export interface MembershipUser {
  userId: string;
  displayName: string;
  email: string;
  role: 'admin' | 'user';
  accountStatus: 'active' | 'suspended';
  membership: {
    plan: MembershipPlan;
    planLabel: string;
    status: 'active' | 'revoked';
    tokenQuota: number;
    periodTokens: number;
    totalTokens: number;
    periodStart: string;
    periodEnd: string;
    expired: boolean;
  } | null;
  totalTokens: number;
}

export type AdminFeatureBaseline = 'previous-production' | 'stable-baseline';
export type AdminFeatureStatus = 'added' | 'retained' | 'relocated' | 'replaced' | 'retired' | 'suspected_missing';
export type AdminFeatureSurface = 'author' | 'admin' | 'system';

export interface AdminFeatureCapability {
  id: string;
  moduleId: string;
  moduleName: string;
  surface: AdminFeatureSurface;
  name: string;
  description: string;
  status: AdminFeatureStatus;
  currentAvailable: boolean;
  currentEntry: string | null;
  evidence: string[];
  previousEntry?: string;
  replacement?: string;
  decision?: string;
  impact?: string;
  recommendation?: string;
}

export interface AdminFeatureCapabilitiesData {
  registry: {
    version: string;
    updatedAt: string;
    current: { label: string; revision: string };
    baseline: { key: AdminFeatureBaseline; label: string; revision: string; purpose: string };
    availableBaselines: Array<{ key: AdminFeatureBaseline; label: string; revision: string; purpose: string }>;
    statusLabels: Record<AdminFeatureStatus, string>;
    surfaceLabels: Record<AdminFeatureSurface, string>;
  };
  summary: {
    modules: number;
    capabilities: number;
    currentAvailable: number;
    filteredCapabilities: number;
    statuses: Record<AdminFeatureStatus, number>;
  };
  moduleOptions: Array<{ id: string; name: string; surface: AdminFeatureSurface }>;
  modules: Array<{
    id: string;
    name: string;
    surface: AdminFeatureSurface;
    capabilities: AdminFeatureCapability[];
  }>;
  losses: AdminFeatureCapability[];
}

export interface V7OpeningAgentGovernance {
  summary: {
    roleCount: number;
    memberCount: number;
    enabledMemberCount: number;
    unavailableMemberCount: number;
  };
  credentials: {
    codingPlanConfigured: boolean;
    agentPlanConfigured: boolean;
  };
  roles: Array<{
    roleKey: string;
    publicName: string;
    responsibility: string;
    revision: number;
    updatedAt: string;
    members: Array<{
      memberKey: string;
      displayName: string;
      modelId: string;
      plan: 'coding' | 'agent';
      planName: 'Coding Plan' | 'Agent Plan';
      enabled: boolean;
      defaultForRole: boolean;
      fallbackPriority: number;
      credential: { configured: boolean; message: string };
      basePrompt: string;
      promptInstruction: string;
    }>;
  }>;
}

export interface V7SettingAgentMember {
  memberKey: string;
  displayName: string;
  roleKey: 'chief_editor' | 'deputy_editor' | 'screenwriter';
  publicResponsibility: string;
  fallbackPriority: number;
  model: { provider: string; modelId: string; plan: 'coding' | 'agent' };
  enabled: boolean;
  revision: number;
  credentialReady: boolean;
}

export interface V7VisualAgentGovernance {
  credentials: { agentPlanConfigured: boolean; imageCapabilityConfigured: boolean };
  members: Array<{
    memberKey: string;
    displayName: string;
    roleName: string;
    responsibility: string;
    modelId: string;
    planName: string;
    credentialReady: boolean;
    status: 'on_duty' | 'on_leave';
  }>;
}

export interface V7UnifiedAgentGovernance {
  revision: number;
  summary: { roleCount: number; memberCount: number; onDutyCount: number; leaveCount: number };
  credentials: { codingPlan: boolean; agentPlan: boolean; image: boolean };
  modelProfiles: Array<{ profileKey: string; publicName: string }>;
  roles: Array<{
    roleKey: string; publicName: string; publicResponsibility: string; capabilities: string[]; tools: string[];
    outputContract: string; failureContract: string; authorSelectable: boolean; allowedModelProfileKeys: string[];
    members: Array<{
      memberKey: string; displayName: string; modelProfileKey: string; modelName: string; provider: string; plan: 'coding' | 'agent' | 'image';
      enabled: boolean; defaultForRole: boolean; fallbackPriority: number; temperatureAdjustment: number;
      credentialReady: boolean; status: 'on_duty' | 'on_leave';
    }>;
  }>;
  taskPolicies: Array<{
    taskKind: string; publicName: string; defaultTemperature: number; minimumTemperature: number;
    maximumTemperature: number; rationale: string; revision: number;
  }>;
}

export type V7PromptAssetKind = 'role_prompt' | 'workstation_prompt' | 'genre_persona' | 'skill';
export type V7PromptAssetStatus = 'draft' | 'published' | 'retired';

export interface V7PromptContextSummary {
  revision: number;
  assetKeyCount: number;
  versionCount: number;
  draftCount: number;
  publishedCount: number;
  retiredCount: number;
  genreProfileCount: number;
  taskContractCount: number;
  contextPackCount: number;
  manifestCount: number;
  safeguards: {
    immutableHistory: boolean;
    optimisticRevision: boolean;
    secretPersistenceBlocked: boolean;
    hiddenReasoningPersistenceBlocked: boolean;
    runtimeBundleScopeBound: boolean;
  };
}

export interface V7PromptAssetSummary {
  assetKey: string;
  kind: V7PromptAssetKind;
  latestVersion: number;
  published: V7PromptAssetVersion | null;
  latestDraft: V7PromptAssetVersion | null;
  versionCount: number;
}

export interface V7PromptAssetVersion {
  assetId: string;
  assetKey: string;
  kind: V7PromptAssetKind;
  version: number;
  status: V7PromptAssetStatus;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  contentHash: string;
  basedOnVersion: number | null;
  basedOnAssetId: string | null;
  governanceRevision: number;
  createdAt: string;
  createdBy: string;
  publishedBy: string | null;
  publishedAt: string | null;
  retiredBy: string | null;
  retiredAt: string | null;
}

export interface V7PromptAssetPreview {
  asset: Pick<V7PromptAssetVersion,
    'assetId' | 'assetKey' | 'kind' | 'version' | 'status' | 'title' | 'summary' | 'contentHash' | 'basedOnAssetId'>;
  preview: {
    contextMode: 'historical' | 'simulated';
    contextLabel: string;
    baseManifestId: string | null;
    compiledPrompt: string;
    compiledPromptHash: string | null;
    characterCount: number;
    estimatedTokens: number;
    checks: Array<{ key: string; passed: boolean }>;
    limitations: string[];
  };
}

export interface V7PromptManifestSummary {
  manifestId: string;
  ownerId: string;
  bookId: string;
  taskId: string;
  memberKey: string;
  roleKey: string;
  workstationKey: string;
  taskKind: string;
  operationMode: string;
  modelProfileKey: string;
  governanceRevision: number;
  compiledPromptHash: string;
  lifecycleStatus: string;
  createdAt: string;
  execution: V7PromptExecution;
}

export interface V7PromptExecution {
  state: 'working' | 'succeeded' | 'failed' | 'unknown' | 'not_linked';
  summary: string;
  completedAt: string | null;
  sourceKind: string | null;
  artifactType: string;
}

export interface V7PromptManifestRebuildVerification {
  manifestId: string;
  matched: boolean;
  storedHash: string | null;
  rebuiltHash: string | null;
  checkedAt: string;
  summary: string;
  components: {
    taskContract: string;
    contextPack: string;
    rolePrompt: string;
    workstationPrompt: string;
    skills: string;
    genreProfile: string;
  };
}

export interface V7PromptManifestDetail {
  manifest: Omit<V7PromptManifestSummary, 'execution'> & {
    rolePromptVersionId: string;
    workstationPromptVersionId: string;
    genreProfileId: string | null;
    genreProfileVersion: number | null;
    skillVersionIds: string[];
    taskContractId: string;
    taskContractVersion: number;
    contextPackId: string;
    contextPackHash: string;
    temperature: number;
    allowedTools: string[];
    compiledBlocks: Record<string, unknown>;
    compiledPrompt: string;
  };
  execution: V7PromptExecution;
  taskContract: null | {
    contractId: string;
    version: number;
    ownerId: string;
    bookId: string;
    taskId: string;
    taskKind: string;
    workstationKey: string;
    objective: string;
    operationMode: string;
    mustPreserve: string[];
    allowedChanges: string[];
    forbiddenChanges: string[];
    successCriteria: string[];
    outputContract: Record<string, unknown>;
    authorInstructionVersion: number | null;
    basedOnTaskId: string | null;
    lifecycleStatus: string;
    contentHash: string;
    createdAt: string;
  };
  contextPack: null | {
    contextPackId: string;
    ownerId: string;
    bookId: string;
    taskId: string;
    policyVersion: string;
    tokenBudget: number;
    estimatedTokens: number;
    content: Record<string, unknown>;
    contentHash: string;
    lifecycleStatus: string;
    createdAt: string;
    sources: Array<{
      ownerId: string;
      bookId: string;
      sourceKey: string;
      sourceType: string;
      sourceId: string;
      sourceVersion: string;
      authority: string;
      decision: 'included' | 'excluded';
      reason: string;
      contentHash: string;
      estimatedTokens: number;
    }>;
  };
  promptAssets: {
    rolePrompt: V7PromptAssetVersion | null;
    workstationPrompt: V7PromptAssetVersion | null;
    skills: V7PromptAssetVersion[];
  };
  genreProfile: null | {
    profileId: string;
    ownerId: string;
    bookId: string;
    version: number;
    status: string;
    primaryGenreKey: string;
    supportingGenreKeys: string[];
    sourceAssetVersionIds: string[];
    sourceBookVersion: number;
    publicLabel: string;
    workingIdentity: string;
    primaryPromise: string;
    supportingFunctions: string[];
    writingPriorities: string[];
    authenticityChecks: string[];
    avoidPatterns: string[];
    conflictResolutions: string[];
    compiledByTaskId: string;
    contentHash: string;
    createdAt: string;
  };
}

export interface V7PlanningRuntimeAudit {
  run: { run_id: string; status: string; current_phase: string; error_message: string | null; created_at: string; updated_at: string };
  snapshot: { snapshotId?: string; sources?: unknown[]; excludedSources?: unknown[] };
  methodSearches: Array<{ seat_key: string; member_key: string; assetMenu: { allowedKeys?: unknown[]; menuText?: string } | null; request: unknown }>;
  methodProposals: Array<{ seat_key: string; member_key: string; proposal: unknown }>;
  storyRoutes: Array<{ route_id: string; member_key: string; route: unknown }>;
  routeReview: null | { member_key: string; review: unknown };
  confirmedRoutes: Array<{ route_version_id: string; revision: number; lifecycle: string; created_by: string }>;
  routeDecisions: Array<{ decision_kind: string; author_note: string; created_at: string }>;
  modelCalls: Array<{ member_key: string; model_id: string; state: string; input_tokens: number | null; output_tokens: number | null; failure_message: string | null }>;
}

export interface V7CreationAdminTask {
  workflowId: string; ownerId: string; bookId: string; bookTitle: string;
  volumeScopeId: string; chainScopeId: string | null; stage: string; status: string;
  modelCalls: number; failedCalls: number; inputTokens: number; outputTokens: number; cashMicros: number;
  pendingUpdates: number; failedUpdates: number; memberKeys: string[]; createdAt: string; updatedAt: string;
}

export interface V7CreationAdminAudit {
  creation: {
    requestedCandidateCount?: number;
    counts: {
      contextPacks: number; options: number; optionReviews: number; decisions: number;
      outlineDraftCandidates: number; outlines: number; manuscripts: number;
      manuscriptReviews: number; settlements: number; modelCalls: number; outbox: number;
      finalizeReceipts: number; taskControls: number;
    };
    contextPacks?: Array<{
      context_pack_id: string; task_kind: string; task_id: string; status: string;
      assigned_member_key: string; content_characters: number; error_message: string | null; updated_at: string;
      context_summary?: {
        taskPersona: { publicLabel: string; workingIdentity: string; priorities: string[]; authenticityChecks: string[]; avoidPatterns: string[] };
        taskResponsibilities: string[];
        creativeSpace: string[];
        methodPlan: {
          mode: 'asset' | 'combined' | 'original' | 'none'; publicSummary: string;
          assetMenuVersion: string | null; assetMenuChars: number;
        };
        selectedSources: Array<{ sourceKey: string; sourceKind: string; authority: string; label: string }>;
        excludedSources: Array<{ sourceKey: string; reason: string }>;
        openQuestions: string[];
        characterCount: number; budgetChars: number; estimatedTokens: number;
      };
    }>;
    options?: Array<{
      option_id: string; option_kind: string; scope_id: string; seat_key: string; member_key: string; created_at: string;
    }>;
    outlineCandidates?: Array<{
      candidate_id: string; chain_scope_id: string; seat_key: string; lifecycle: string; member_key: string;
      review_member_key: string | null; reviewed_at: string | null; selected_at: string | null; created_at: string;
    }>;
    calls?: Array<{
      request_id: string; run_kind: string; node_key: string; member_key: string; provider: string; model_id: string;
      state: string; temperature: number; input_tokens: number | null; output_tokens: number | null;
      cash_micros: number | null; failure_message: string | null; started_at: string; completed_at: string | null;
    }>;
  };
  writeBack: {
    total: number; completed: number; pending: number; failed: number; unknown: number;
    tasks: Array<{ taskId: string; task: string; status: string; message: string; attempts: number; updatedAt: string }>;
  };
}

export interface V7PlanningAdminTask {
  taskId: string; taskKind: 'planning_route' | 'planning_tree'; ownerId: string;
  bookId: string; bookTitle: string; status: string; message: string; progress: number;
  memberKey: string | null; memberName: string | null;
  treeKind: 'book' | 'volume' | 'chain' | null; scopeId: string | null;
  modelCalls: number; canStop: boolean; updatedAt: string;
}

export interface V7PlanningAdminAudit {
  run: Record<string, unknown>;
  contextPlan?: null | {
    request?: {
      publicGoal?: string;
      taskPersona?: { publicLabel?: string; workingIdentity?: string; priorities?: string[]; authenticityChecks?: string[]; avoidPatterns?: string[] };
      taskResponsibilities?: string[];
      creativeSpace?: string[];
    };
    assetMenu?: { allowedKeys?: unknown[] } | null;
  };
  calls: Array<{ member_key: string; model_id: string; state: string; input_tokens: number | null; output_tokens: number | null; failure_message: string | null }>;
}

interface ApiEnvelope<T> {
  data?: T;
  error?: { message?: string };
}

const configuredOrigin = import.meta.env.VITE_API_ORIGIN?.trim();
const API_ORIGIN = configuredOrigin && configuredOrigin.length > 0
  ? configuredOrigin.replace(/\/$/u, '')
  : '';

export const ADMIN_AUTHENTICATION_REQUIRED_EVENT = 'wenmi:v7-admin-authentication-required';
export const AUTHOR_SITE_ORIGIN = resolveAuthorSiteOrigin(import.meta.env.VITE_PUBLIC_ORIGIN);

export async function platformRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers
    }
  });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (response.status === 401 && path !== '/api/v1/auth/login' && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ADMIN_AUTHENTICATION_REQUIRED_EVENT));
  }
  if (!response.ok || payload.data === undefined) {
    throw new Error(safeMessage(payload.error?.message, response.status));
  }
  return payload.data;
}

export async function fetchCurrentAccount(signal?: AbortSignal): Promise<AdminAccount | null> {
  const response = await fetch(`${API_ORIGIN}/api/v1/auth/me`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
    ...(signal === undefined ? {} : { signal })
  });
  if (response.status === 401) return null;
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<AdminAccount>;
  if (!response.ok || payload.data === undefined) throw new Error(safeMessage(payload.error?.message, response.status));
  return payload.data;
}

export function loginAccount(input: { email: string; password: string }): Promise<{ account: AdminAccount; expiresInSeconds: number }> {
  return platformRequest('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(input) });
}

export function logoutAccount(): Promise<{ loggedOut: boolean }> {
  return platformRequest('/api/v1/auth/logout', { method: 'POST', body: '{}' });
}

export const fetchPlatformDashboard = (signal?: AbortSignal): Promise<PlatformDashboard> =>
  platformRequest('/api/v1/admin/dashboard', signal === undefined ? {} : { signal });

export const fetchUserOperations = (signal?: AbortSignal): Promise<{ timezone: 'Asia/Shanghai'; day: string; items: UserOperation[] }> =>
  platformRequest('/api/v1/admin/user-operations', signal === undefined ? {} : { signal });

export function fetchPlatformUsers(query = '', signal?: AbortSignal): Promise<{ items: PlatformUser[]; total: number }> {
  const params = new URLSearchParams({ limit: '100' });
  if (query.trim().length > 0) params.set('query', query.trim());
  return platformRequest(`/api/v1/admin/users?${params.toString()}`, signal === undefined ? {} : { signal });
}

export function setPlatformUserStatus(userId: string, status: PlatformUser['status']): Promise<PlatformUser> {
  return platformRequest(`/api/v1/admin/users/${encodeURIComponent(userId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  });
}

export const fetchPlatformUsage = (signal?: AbortSignal): Promise<PlatformUsage> =>
  platformRequest('/api/v1/admin/usage', signal === undefined ? {} : { signal });

export const fetchPlatformIssues = (signal?: AbortSignal): Promise<{ items: PlatformIssue[]; total: number }> =>
  platformRequest('/api/v1/admin/issues?limit=100', signal === undefined ? {} : { signal });

export function updatePlatformIssue(
  issue: Pick<PlatformIssue, 'sourceType' | 'sourceId'>,
  input: Pick<PlatformIssue, 'status' | 'severity' | 'note'>
): Promise<unknown> {
  return platformRequest(`/api/v1/admin/issues/${issue.sourceType}/${encodeURIComponent(issue.sourceId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export const fetchMembershipStats = (signal?: AbortSignal): Promise<MembershipStats> =>
  platformRequest('/api/v1/admin/membership-stats', signal === undefined ? {} : { signal });

export function fetchFeatureCapabilities(
  filters: {
    baseline?: AdminFeatureBaseline;
    status?: AdminFeatureStatus;
    moduleId?: string;
    query?: string;
  } = {},
  signal?: AbortSignal
): Promise<AdminFeatureCapabilitiesData> {
  const query = new URLSearchParams();
  if (filters.baseline !== undefined) query.set('baseline', filters.baseline);
  if (filters.status !== undefined) query.set('status', filters.status);
  if (filters.moduleId !== undefined && filters.moduleId.length > 0) query.set('moduleId', filters.moduleId);
  if (filters.query !== undefined && filters.query.length > 0) query.set('query', filters.query);
  const suffix = query.size === 0 ? '' : `?${query.toString()}`;
  return platformRequest(`/api/v1/admin/feature-capabilities${suffix}`, signal === undefined ? {} : { signal });
}

export function fetchMembershipUsers(query = '', signal?: AbortSignal): Promise<{ items: MembershipUser[]; total: number }> {
  const params = new URLSearchParams({ limit: '100' });
  if (query.trim().length > 0) params.set('query', query.trim());
  return platformRequest(`/api/v1/admin/memberships?${params.toString()}`, signal === undefined ? {} : { signal });
}

export function grantMembership(
  userId: string,
  input: { plan: MembershipPlan; amountCny: number; note: string; idempotencyKey: string }
): Promise<unknown> {
  return platformRequest(`/api/v1/admin/memberships/${encodeURIComponent(userId)}`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function revokeMembership(userId: string, idempotencyKey: string): Promise<{ revoked: boolean }> {
  return platformRequest(`/api/v1/admin/memberships/${encodeURIComponent(userId)}/revoke`, {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey })
  });
}

export function newPlatformActionKey(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export const fetchV7OpeningAgentGovernance = (signal?: AbortSignal): Promise<V7OpeningAgentGovernance> =>
  platformRequest('/api/v1/admin/v7/opening-agent/members', signal === undefined ? {} : { signal });

export function updateV7OpeningAgentMember(
  memberKey: string,
  input: {
    expectedRevision: number;
    enabled?: boolean;
    defaultForRole?: boolean;
    fallbackPriority?: number;
    promptInstruction?: string;
    reason?: string;
  }
): Promise<V7OpeningAgentGovernance> {
  return platformRequest(`/api/v1/admin/v7/opening-agent/members/${encodeURIComponent(memberKey)}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export const fetchV7SettingAgentMembers = (signal?: AbortSignal): Promise<V7SettingAgentMember[]> =>
  platformRequest('/api/v1/admin/v7/setting-agent/members', signal === undefined ? {} : { signal });

export const fetchV7VisualAgentGovernance = (signal?: AbortSignal): Promise<V7VisualAgentGovernance> =>
  platformRequest('/api/v1/admin/v7/visual-agent/members', signal === undefined ? {} : { signal });

export const fetchV7UnifiedAgentGovernance = (signal?: AbortSignal): Promise<V7UnifiedAgentGovernance> =>
  platformRequest('/api/v1/admin/v7/agent-governance', signal === undefined ? {} : { signal });

export function updateV7UnifiedAgentMember(memberKey: string, input: Record<string, unknown>): Promise<V7UnifiedAgentGovernance> {
  return platformRequest(`/api/v1/admin/v7/agent-governance/members/${encodeURIComponent(memberKey)}`, {
    method: 'PATCH', body: JSON.stringify(input)
  });
}

export function updateV7UnifiedTaskPolicy(taskKind: string, input: Record<string, unknown>): Promise<V7UnifiedAgentGovernance> {
  return platformRequest(`/api/v1/admin/v7/agent-governance/task-policies/${encodeURIComponent(taskKind)}`, {
    method: 'PATCH', body: JSON.stringify(input)
  });
}

export const fetchV7PromptContextSummary = (signal?: AbortSignal): Promise<V7PromptContextSummary> =>
  platformRequest('/api/v1/admin/v7/prompt-context/summary', signal === undefined ? {} : { signal });

export function fetchV7PromptAssets(
  filters: { kind?: V7PromptAssetKind; search?: string } = {},
  signal?: AbortSignal
): Promise<V7PromptAssetSummary[]> {
  const query = new URLSearchParams();
  if (filters.kind !== undefined) query.set('kind', filters.kind);
  if (filters.search !== undefined && filters.search.length > 0) query.set('search', filters.search);
  const suffix = query.size === 0 ? '' : `?${query.toString()}`;
  return platformRequest(`/api/v1/admin/v7/prompt-context/assets${suffix}`, signal === undefined ? {} : { signal });
}

export const fetchV7PromptAssetVersions = (assetKey: string, signal?: AbortSignal): Promise<V7PromptAssetVersion[]> =>
  platformRequest(`/api/v1/admin/v7/prompt-context/assets/${encodeURIComponent(assetKey)}/versions`, signal === undefined ? {} : { signal });

export function saveV7PromptAssetDraft(assetKey: string, input: {
  expectedRevision: number;
  basedOnAssetId?: string;
  kind?: V7PromptAssetKind;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  reason?: string;
}): Promise<V7PromptAssetVersion> {
  return platformRequest(`/api/v1/admin/v7/prompt-context/assets/${encodeURIComponent(assetKey)}/drafts`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function previewV7PromptAssetVersion(
  assetKey: string,
  assetId: string,
  manifestId?: string
): Promise<V7PromptAssetPreview> {
  return platformRequest(`/api/v1/admin/v7/prompt-context/assets/${encodeURIComponent(assetKey)}/preview`, {
    method: 'POST', body: JSON.stringify({ assetId, ...(manifestId === undefined ? {} : { manifestId }) })
  });
}

export function publishV7PromptAssetVersion(
  assetKey: string,
  input: { assetId: string; expectedRevision: number; reason?: string }
): Promise<V7PromptAssetVersion> {
  return platformRequest(`/api/v1/admin/v7/prompt-context/assets/${encodeURIComponent(assetKey)}/publish`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function restoreV7PromptAssetDraft(
  assetKey: string,
  input: { sourceAssetId: string; expectedRevision: number; reason?: string }
): Promise<V7PromptAssetVersion> {
  return platformRequest(`/api/v1/admin/v7/prompt-context/assets/${encodeURIComponent(assetKey)}/restore-draft`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function fetchV7PromptManifests(
  filters: { ownerId?: string; bookId?: string; taskId?: string; limit?: number } = {},
  signal?: AbortSignal
): Promise<V7PromptManifestSummary[]> {
  const query = new URLSearchParams();
  if (filters.ownerId !== undefined && filters.ownerId.length > 0) query.set('ownerId', filters.ownerId);
  if (filters.bookId !== undefined && filters.bookId.length > 0) query.set('bookId', filters.bookId);
  if (filters.taskId !== undefined && filters.taskId.length > 0) query.set('taskId', filters.taskId);
  query.set('limit', String(filters.limit ?? 100));
  return platformRequest(`/api/v1/admin/v7/prompt-context/manifests?${query.toString()}`, signal === undefined ? {} : { signal });
}

export const fetchV7PromptManifest = (manifestId: string, signal?: AbortSignal): Promise<V7PromptManifestDetail> =>
  platformRequest(`/api/v1/admin/v7/prompt-context/manifests/${encodeURIComponent(manifestId)}`, signal === undefined ? {} : { signal });

export const verifyV7PromptManifestRebuild = (
  manifestId: string
): Promise<V7PromptManifestRebuildVerification> => platformRequest(
  `/api/v1/admin/v7/prompt-context/manifests/${encodeURIComponent(manifestId)}/verify-rebuild`,
  { method: 'POST', body: '{}' }
);

export function fetchV7PlanningRuntimeAudit(ownerId: string, bookId: string, runId: string): Promise<V7PlanningRuntimeAudit> {
  const query = new URLSearchParams({ ownerId, bookId });
  return platformRequest(`/api/v1/admin/v7/planning-runtime/recipe/${encodeURIComponent(runId)}?${query.toString()}`);
}

export const fetchV7CreationAdminTasks = (signal?: AbortSignal): Promise<V7CreationAdminTask[]> =>
  platformRequest('/api/v1/v7/admin/creation-workflows?limit=100', signal === undefined ? {} : { signal });

export const fetchV7PlanningAdminTasks = (signal?: AbortSignal): Promise<V7PlanningAdminTask[]> =>
  platformRequest('/api/v1/v7/admin/planning-tasks?limit=100', signal === undefined ? {} : { signal });

export function fetchV7PlanningAdminAudit(task: V7PlanningAdminTask, signal?: AbortSignal): Promise<V7PlanningAdminAudit> {
  const query = new URLSearchParams({ ownerId: task.ownerId, bookId: task.bookId });
  const runKind = task.taskKind === 'planning_route' ? 'recipe' : 'tree';
  return platformRequest(`/api/v1/admin/v7/planning-runtime/${runKind}/${encodeURIComponent(task.taskId)}?${query.toString()}`,
    signal === undefined ? {} : { signal });
}

export function fetchV7CreationAdminAudit(task: V7CreationAdminTask, signal?: AbortSignal): Promise<V7CreationAdminAudit> {
  const query = new URLSearchParams({ ownerId: task.ownerId });
  return platformRequest(`/api/v1/v7/admin/books/${encodeURIComponent(task.bookId)}/creation-workflows/${encodeURIComponent(task.workflowId)}/audit?${query.toString()}`,
    signal === undefined ? {} : { signal });
}

export function updateV7SettingAgentMember(memberKey: string, input: { expectedRevision: number; enabled: boolean }): Promise<V7SettingAgentMember> {
  return platformRequest(`/api/v1/admin/v7/setting-agent/members/${encodeURIComponent(memberKey)}`, {
    method: 'PATCH', body: JSON.stringify(input)
  });
}

function resolveAuthorSiteOrigin(value: string | undefined): string {
  const fallback = 'https://wenmixiezuo.com/';
  if (value === undefined || value.trim().length === 0) return fallback;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? `${url.origin}/` : fallback;
  } catch {
    return fallback;
  }
}

function safeMessage(message: string | undefined, status: number): string {
  if (typeof message !== 'string' || message.length === 0 || message.length > 300) return `请求没有成功（${status}）`;
  return /(?:\bSQL\b|sqlite|stack|\\private\\|node_modules|Bearer\s|\b(?:sk|ak)-[A-Za-z0-9_-]{8,})/iu.test(message)
    ? `请求没有成功（${status}）`
    : message;
}
