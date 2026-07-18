export type KnowledgeLayer = 'temporary' | 'candidate' | 'canon' | 'derived';
export type KnowledgeAuthorityGrade = 'A' | 'B' | 'C' | 'D';
export type EpistemicStatus = 'objective' | 'claim' | 'belief' | 'lie' | 'dream' | 'plan' | 'counterfactual' | 'ambiguous' | 'conflicted';
export type KnowledgeRevisionStatus = 'active' | 'dormant' | 'promoted' | 'rejected' | 'superseded' | 'archived';

export interface TemporalScopeInput {
  worldTimeStart?: string | null;
  worldTimeEnd?: string | null;
  knowledgeSubjectType?: string | null;
  knowledgeSubjectId?: string | null;
  knowledgeTimeStart?: string | null;
  knowledgeTimeEnd?: string | null;
  recordedAt?: string;
  canonRevision: number;
  narrativeChapterStart?: number | null;
  narrativeChapterEnd?: number | null;
  calendarKey?: string | null;
  completeness: 'complete' | 'partial' | 'unknown';
}

export interface KnowledgeRevisionRecord {
  knowledgeRevisionId: string;
  knowledgeItemId: string;
  revision: number;
  layer: KnowledgeLayer;
  authorityGrade: KnowledgeAuthorityGrade;
  epistemicStatus: EpistemicStatus;
  negated: boolean;
  viewpointEntityId: string | null;
  temporalScopeId: string;
  content: unknown;
  contentText: string;
  contentHash: string;
  evidence: unknown[];
  sourceType: string;
  sourceId: string;
  sourceHash: string | null;
  sourceLocator: Record<string, unknown>;
  canonRevision: number;
  status: KnowledgeRevisionStatus;
  createdAt: string;
}

export interface KnowledgePromotionRecord {
  promotionId: string;
  candidateRevisionId: string;
  canonRevisionId: string;
  decisionType: 'boss_confirmed' | 'graded_settlement' | 'chief_editor_approved';
  status: 'committed';
}

export interface TemporalScopeRecord {
  temporalScopeId: string;
  worldTimeStart: string | null;
  worldTimeEnd: string | null;
  knowledgeSubjectId: string | null;
  knowledgeTimeStart: string | null;
  knowledgeTimeEnd: string | null;
  recordedAt: string;
  canonRevision: number;
  completeness: 'complete' | 'partial' | 'unknown';
}
