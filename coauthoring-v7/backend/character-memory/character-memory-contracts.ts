import type { V7MemberModelBinding } from '../agents/agent-roster.js';

export type CharacterNarrativeTier = 'core' | 'important' | 'supporting' | 'cameo' | 'unknown';
export type CharacterProfileAuthority = 'candidate' | 'confirmed_reference' | 'canon_derived';
export type CharacterContextField = 'profile' | 'state' | 'relationships' | 'knowledge' | 'history' | 'open_questions';

export interface CharacterProfileDocument {
  schema: 'v7-character-profile-v1';
  displayName: string;
  aliases: string[];
  dramaticFunction: string;
  coreDesire: string;
  longTermGoal: string;
  fearOrWeakness: string;
  personalityTraits: string[];
  voiceAndBehavior: string;
  visualAnchor: string;
  hardBoundaries: string[];
  openQuestions: string[];
  publicSummary: string;
}

export interface CharacterContextSelection {
  schema: 'v7-character-context-selection-v1';
  selected: Array<{
    entityId: string;
    fields: CharacterContextField[];
    reason: string;
  }>;
  excludedSummary: string;
  openQuestions: string[];
}

export type CharacterReviewKind = 'hard_conflict' | 'continuity_risk' | 'creative_quality' | 'open_question';
export type CharacterReviewSeverity = 'blocking' | 'important' | 'advisory';

export interface CharacterReviewIssue {
  kind: CharacterReviewKind;
  severity: CharacterReviewSeverity;
  entityId: string;
  publicSummary: string;
  evidenceRefs: string[];
  suggestedAction: string;
}

export interface CharacterChangeCandidate {
  kind: 'profile_update' | 'canon_gap';
  entityId: string;
  fieldPath: string;
  proposedValue: unknown;
  publicSummary: string;
  reason: string;
  evidenceRefs: string[];
}

export interface CharacterMaintenanceOutput {
  schema: 'v7-character-maintenance-v1';
  publicSummary: string;
  affectedEntityIds: string[];
  changes: CharacterChangeCandidate[];
  issues: CharacterReviewIssue[];
}

export type V7CharacterRoleKey = 'character_curator';

export interface V7CharacterMemberDefinition {
  memberKey: string;
  displayName: string;
  roleKey: V7CharacterRoleKey;
  enabledByDefault: boolean;
  defaultForRole: boolean;
  fallbackPriority: number;
  model: V7MemberModelBinding;
  promptInstruction: string;
}

