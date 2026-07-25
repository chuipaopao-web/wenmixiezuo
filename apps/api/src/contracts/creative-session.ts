export type CreativeSessionStatus =
  | 'exploring'
  | 'awaiting_direction'
  | 'planning'
  | 'awaiting_plan'
  | 'ready'
  | 'paused'
  | 'closed'
  | 'superseded';

export type CreativeSessionMode = 'open_discussion' | 'creative_forecast' | 'trial_draft' | 'formal_production';

export type CreativeSessionAction =
  | 'continue_discussion'
  | 'request_dual_screenwriter_refresh'
  | 'lock_direction'
  | 'request_trial_draft'
  | 'pause_session';

export interface CreativeBlackboard {
  ownerMessages: string[];
  currentGoal: string;
  confirmedFacts: unknown[];
  candidates: unknown[];
  disagreements: unknown[];
  risks: unknown[];
  unknowns: unknown[];
  evidence: unknown[];
  lockedDirection?: { decisionId: string; summary: string };
  maturity: 'exploring' | 'comparing' | 'direction_ready' | 'planning' | 'ready';
  nextStep: string;
}

export interface CreativeBlackboardRevision {
  revision: number;
  payload: CreativeBlackboard;
  sourceFingerprint: string;
  contentHash: string;
}

export interface CreativeSessionRecord {
  sessionId: string;
  conversationId: string;
  status: CreativeSessionStatus;
  mode: CreativeSessionMode;
  activeTopic: string;
  currentBlackboardRevision: number;
  canonRevision: number;
  sessionEpoch: number;
  lockedDecisionId: string | null;
}

export interface NarrativeForecastRecord {
  forecastId: string;
  sessionId: string;
  status: 'active' | 'stale' | 'adopted' | 'rejected' | 'superseded';
  staleReason: string | null;
  canonRevision: number;
  blackboardRevision: number;
  sourceFingerprint: string;
  branchCount: number;
}

export interface NarrativeForecastBranchRecord {
  branchId: string;
  forecastId: string;
  ordinal: number;
  title: string;
  proposal: Record<string, unknown>;
  sourceAgentId: string | null;
}
