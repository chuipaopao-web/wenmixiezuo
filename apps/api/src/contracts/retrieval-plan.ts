export type RetrievalChannel = 'structured' | 'fts' | 'vector' | 'relation';
export type EvidenceLane = 'H' | 'E' | 'I';
export type RetrievalMode = 'open_discussion' | 'creative_exploration' | 'drafting' | 'formal_production' | 'review';

export interface EntitySeed { entityId: string; entityType: string; canonicalName: string; matchedText: string; verified: boolean }
export interface EntityAmbiguity { matchedText: string; candidates: Array<Omit<EntitySeed, 'matchedText' | 'verified'>> }

export interface RetrievalPlan {
  planId: string;
  roleKey: string;
  mode: RetrievalMode;
  originalQuery: string;
  normalizedQuery: string;
  intents: string[];
  entitySeeds: EntitySeed[];
  ambiguities: EntityAmbiguity[];
  channels: RetrievalChannel[];
  canonRevision: number;
  worldTime: string | null;
  knowledgeTime: string | null;
  viewpointEntityId: string | null;
  policyVersion: string;
  blocked: boolean;
  blockReason: string | null;
}

export interface RetrievalCandidate {
  candidateId: string;
  channel: RetrievalChannel;
  channelRank: number;
  lane: EvidenceLane;
  sourceType: string;
  sourceId: string;
  sourceVersion: string | null;
  sourceHash: string | null;
  sourceLocator: Record<string, unknown>;
  provenanceKey: string;
  assertionKey: string | null;
  content: string;
  authorityGrade: 'A' | 'B' | 'C' | 'D' | null;
  lifecycleLayer: 'temporary' | 'candidate' | 'canon' | 'derived';
  epistemicStatus: string;
  negated: boolean;
  conflictGroup: string | null;
  metadata: Record<string, unknown>;
}

export interface EvidenceCluster {
  clusterId: string;
  clusterKey: string;
  lane: EvidenceLane;
  primary: RetrievalCandidate;
  candidates: RetrievalCandidate[];
  channelRanks: Partial<Record<RetrievalChannel, number>>;
  rrfScore: number;
  conflictGroup: string | null;
  adopted: boolean;
  adoptionReason: string;
}

export interface EvidenceClosure {
  clusterId: string;
  result: 'closed' | 'degraded' | 'conflicted' | 'unknown';
  sourceResolved: boolean;
  hashVerified: boolean;
  canonVerified: boolean;
  timeVerified: boolean;
  viewpointVerified: boolean;
  negationChecked: boolean;
  epistemicChecked: boolean;
  reasons: string[];
}
