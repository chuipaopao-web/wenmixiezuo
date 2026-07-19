import type { EvidenceClosure, EvidenceCluster } from './retrieval-plan.js';

export interface RoleContextInput {
  roleKey: string;
  mode: 'open_discussion' | 'creative_exploration' | 'drafting' | 'formal_production' | 'review';
  inputTokenBudget: number;
  clusters: EvidenceCluster[];
  closures: EvidenceClosure[];
  taskInstruction: string;
  expressionBaseline?: string | null;
}

export interface RoleContextPack {
  hard: EvidenceCluster[];
  evidence: EvidenceCluster[];
  inspiration: EvidenceCluster[];
  excluded: Array<{ clusterId: string; reason: string }>;
  selectedTokens: number;
  creativeFreedom: string;
  warnings: string[];
}
