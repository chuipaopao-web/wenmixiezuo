import type { V7MemberModelBinding } from '../agents/agent-roster.js';

export type V7SettingRoleKey = 'chief_editor' | 'deputy_editor' | 'screenwriter';
export type V7SettingMemberPresence = 'ready' | 'working' | 'leave';
export type V7SettingItemState = 'queued' | 'working' | 'chief_review' | 'needs_author' | 'confirmed' | 'failed';

export interface V7SettingMemberDefinition {
  memberKey: string;
  displayName: string;
  roleKey: V7SettingRoleKey;
  publicResponsibility: string;
  enabledByDefault: boolean;
  fallbackPriority: number;
  model: V7MemberModelBinding;
}

export interface V7SettingCatalogItem {
  key: string;
  label: string;
  prompt: string;
  source: string;
  groupKey: string;
  groupTitle: string;
  required: boolean;
  deputyPolicy: 'never' | 'conditional';
}

export interface V7SettingContextSource {
  sourceType: 'opening_profile' | 'confirmed_setting' | 'author_note' | 'catalog_contract';
  sourceId: string;
  version: number;
  hash: string;
}

export interface V7SettingContextPack {
  ownerId: string;
  bookId: string;
  itemKey: string;
  openingVersion: number;
  openingSummary: string;
  confirmedSettings: Array<{ itemKey: string; label: string; content: string; revision: number }>;
  authorNote: string;
  itemContract: { label: string; prompt: string };
  sources: V7SettingContextSource[];
  contextPolicyVersion: 'layered-setting-v2';
  characterCount: number;
  budgetChars: 12_000;
  hash: string;
}

export interface V7DeputyBrief {
  verifiedFacts: string[];
  uncertainPoints: string[];
  usableBoundaries: string[];
  translationForWriter: string;
}

export interface V7WriterProposal {
  content: string;
  designRationale: string;
  /** 由设计成员生成的下游检索摘要，避免后续重复读取完整正文。 */
  contextSummary?: string;
  /** 从content逐条摘出的硬事实，不得新增推断。 */
  factEntries?: string[];
  storyConsequences: string[];
  dependencies: string[];
  risks: string[];
}

export interface V7ChiefReview {
  verdict: 'pass' | 'needs_author';
  finalContent: string;
  summary: string;
  /** 给下游成员检索的短摘要，不替代作者确认的完整设定。 */
  contextSummary: string;
  /** 逐条、可核对的硬事实投影；每条都来自 finalContent。 */
  factEntries: string[];
  issues: Array<{ problem: string; impact: string; suggestion: string }>;
  suggestions: string[];
}

export interface V7SettingMemberPublicView {
  memberKey: string;
  displayName: string;
  role: '主编' | '副编' | '编剧';
  presence: V7SettingMemberPresence;
  statusText: string;
  currentItem: string | null;
  handoffTo: string | null;
  completedCount: number;
}

export interface V7SettingItemView {
  itemKey: string;
  label: string;
  groupTitle: string;
  state: V7SettingItemState;
  stateText: string;
  assignedMemberKey: string | null;
  content: string | null;
  designRationale: string | null;
  storyConsequences: string[];
  issues: V7ChiefReview['issues'];
  suggestions: string[];
  revision: number;
}

export interface V7SettingBatchView {
  batchId: string;
  status: 'queued' | 'working' | 'awaiting_author' | 'completed' | 'partially_failed';
  statusText: string;
  progress: { completed: number; total: number; percent: number };
  members: V7SettingMemberPublicView[];
  items: V7SettingItemView[];
  createdAt: string;
  updatedAt: string;
}

export interface V7SettingFinalReviewResult {
  verdict: 'pass' | 'needs_author';
  summary: string;
  contextSummary: string;
  factLedger: Array<{ itemKey: string; label: string; facts: string[] }>;
  groupSummaries: Array<{ groupTitle: string; summary: string; itemKeys: string[] }>;
  unifiedDecisions: Array<{ topic: string; decision: string; reason: string }>;
  conflicts: Array<{ itemKeys: string[]; problem: string; decision: string; impact: string }>;
  patchedItemKeys: string[];
}

export interface V7SettingFinalReviewView {
  taskId: string;
  status: 'queued' | 'working' | 'ready' | 'failed';
  statusText: string;
  progress: number;
  member: { memberKey: string; displayName: string } | null;
  result: V7SettingFinalReviewResult | null;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface V7SettingCatalogRecommendation {
  requiredKeys: string[];
  suggestedKeys: string[];
  excludedKeys: string[];
  summary: string;
}

export interface V7SettingCatalogRecommendationView {
  taskId: string;
  status: 'queued' | 'working' | 'ready' | 'failed';
  statusText: string;
  phase: 'preparing' | 'understanding' | 'organizing' | 'validating' | 'handoff' | 'ready' | 'failed';
  phaseText: string;
  progress: number;
  member: { memberKey: string; displayName: string } | null;
  attemptedMembers: Array<{ memberKey: string; displayName: string }>;
  result: V7SettingCatalogRecommendation | null;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
}
