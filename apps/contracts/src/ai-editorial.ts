/** Shared editorial-agent contracts used by the current V7 runtime. */
export const editorialRoleKeys = [
  'chief_editor', 'deputy_editor', 'screenwriter', 'writer',
  'fact_reviewer', 'literary_reviewer', 'experience_reviewer'
] as const;
export type EditorialRoleKey = typeof editorialRoleKeys[number];
export type EditorialMemberStatus = 'available' | 'working' | 'completed' | 'failed' | 'unavailable';
export type CostTier = 'low' | 'medium' | 'high';

export interface EditorialMemberView {
  memberId: string;
  displayName: string;
  roleKey: EditorialRoleKey;
  roleLabel: string;
  supplierCompany: string;
  baseCostTier: CostTier;
  status: EditorialMemberStatus;
  avatarKey: string;
  enabled: boolean;
}

export interface EditorialRolePoolView {
  roleKey: EditorialRoleKey;
  roleLabel: string;
  desiredCount: number;
  enabled: boolean;
  revision: number;
  members: EditorialMemberView[];
}

export interface AiNodeCostEstimate {
  tier: CostTier;
  units: number;
  memberCount: number;
  incrementalUnits: number;
  multiplier: number;
  requiresConfirmation: boolean;
}

export interface AiNodeBatchMemberView {
  batchMemberId: string;
  member: EditorialMemberView;
  status: 'queued' | 'working' | 'completed' | 'failed' | 'unavailable' | 'replaced';
  attemptCount: number;
  failureMessage: string | null;
  result: {
    resultId: string;
    candidateKind: string;
    content: Record<string, unknown>;
    authorSummary: { preserved: string[]; adjusted: string[]; omitted: Array<{ item: string; reason: string }> };
  } | null;
}

export interface AiNodeBatchView {
  batchId: string;
  nodeKind: string;
  objectId: string;
  batchVersion: number;
  roleKey: EditorialRoleKey;
  status: 'queued' | 'working' | 'partial_success' | 'completed' | 'failed' | 'cancelled';
  contextPackId: string;
  contextPackHash: string;
  authorInputVersion: number;
  authorInputIncluded: boolean;
  skillVersions: { core: string; role: string; nodeProtocol: string; template: string; templateVersionId: string | null; templateHash: string | null };
  sourceVersionIds: string[];
  cost: AiNodeCostEstimate;
  progress: { completed: number; failed: number; total: number; percent: number };
  members: AiNodeBatchMemberView[];
  createdAt: string;
  updatedAt: string;
}
