import type {
  AiNodeBatchView,
  AiNodeCostEstimate,
  CoreWorkflowStage,
  CoreWorkflowV6View,
  CharacterCardContent,
  CharacterCardView,
  EditorialRoleKey,
  EditorialRolePoolView,
  StorylineContent,
  StorylineGrowthCandidateContent,
  StorylineGrowthCandidateView,
  StorylineFrontierView,
  StorylineOpenQuestionView,
  StorylineLifecycleStatus,
  StorylineRelationView,
  StorylineVolumeParticipationStatus
} from '@wenmi/contracts';
import { request } from '../../lib/api/client';

export interface ContextSourceInput {
  sourceType: string;
  sourceId: string;
  content: string;
  reason: string;
  priority: number;
  version?: number | string;
  constraintStrength?: 'hard_fact' | 'current_task' | 'soft_reference' | 'open_space';
  truthStatus?: 'planned' | 'confirmed' | 'actual';
  knowledgeZone?: 'hard_fact' | 'author_plan' | 'open_question' | 'ai_candidate';
  scopeType?: 'book' | 'volume' | 'event' | 'chapter' | 'scene' | 'task';
  scopeId?: string;
  dependencies?: string[];
  componentKind?: 'BookCorePack' | 'SettingConstraintPack' | 'BookStorySpinePack' | 'VolumeResponsibilityPack'
    | 'EventResponsibilityPack' | 'ChapterTaskPack' | 'RecentActualStatePack' | 'StoryThreadPack';
}

export interface CreateAiNodeBatchInput {
  nodeKind: string;
  objectId: string;
  roleKey: EditorialRoleKey;
  taskDescription: string;
  templateVersion: string;
  sourceVersionIds: string[];
  hardSources: ContextSourceInput[];
  optionalSources: ContextSourceInput[];
  preferredMemberIds?: string[];
  tokenBudget?: number;
  outputTokenBudget?: number;
  reasoningLevel?: 'light' | 'standard' | 'deep';
  roundCount?: number;
  exampleCount?: number;
  characterBudget?: number;
  confirmHighCost?: boolean;
  idempotencyKey: string;
}

const bookPath = (bookId: string): string => `/api/v1/books/${encodeURIComponent(bookId)}`;

export function fetchCoreWorkflow(bookId: string, signal?: AbortSignal): Promise<CoreWorkflowV6View> {
  return request(`${bookPath(bookId)}/core-workflow`, signal === undefined ? {} : { signal });
}



export function createStoryline(bookId: string, content: StorylineContent, sortOrder?: number): Promise<{ storylineId: string; versionId: string }> {
  return request(`${bookPath(bookId)}/core-workflow/storylines`, {
    method: 'POST', body: JSON.stringify({ content, ...(sortOrder === undefined ? {} : { sortOrder }) })
  });
}

export function saveStorylineVersion(bookId: string, storylineId: string, content: StorylineContent): Promise<{ versionId: string }> {
  return request(`${bookPath(bookId)}/core-workflow/storylines/${encodeURIComponent(storylineId)}/versions`, {
    method: 'POST', body: JSON.stringify({ content })
  });
}

export function confirmStoryline(bookId: string, storylineId: string, versionId: string, expectedActiveVersionId: string | null): Promise<{ confirmed: true }> {
  return request(`${bookPath(bookId)}/core-workflow/storylines/${encodeURIComponent(storylineId)}/versions/${encodeURIComponent(versionId)}/confirm`, {
    method: 'POST', body: JSON.stringify({ expectedActiveVersionId })
  });
}

export function saveStorylineFrontier(bookId: string, input: { storylineId?: string | null; summary: string;
  targetVolumeNumber?: number | null; stageEnding?: string | null; fullBookEndingKnown?: boolean;
  expectedActiveVersionId?: string | null; sourceVersionIds?: string[] }): Promise<StorylineFrontierView> {
  return request(`${bookPath(bookId)}/core-workflow/storyline-frontier`, { method: 'PUT', body: JSON.stringify(input) });
}

export function addStorylineOpenQuestion(bookId: string, input: { storylineId?: string | null; question: string;
  sourceVersionId?: string | null }): Promise<StorylineOpenQuestionView> {
  return request(`${bookPath(bookId)}/core-workflow/storyline-open-questions`, { method: 'POST', body: JSON.stringify(input) });
}

export function resolveStorylineOpenQuestion(bookId: string, openQuestionId: string, resolution: string): Promise<{ resolved: true }> {
  return request(`${bookPath(bookId)}/core-workflow/storyline-open-questions/${encodeURIComponent(openQuestionId)}/resolve`, {
    method: 'POST', body: JSON.stringify({ resolution })
  });
}

export function createStorylineGrowthRound(bookId: string, input: { triggerKind: 'author_request' | 'event_settlement' | 'volume_settlement';
  triggerObjectId: string; triggerVersionId: string; evidenceRefs: StorylineGrowthCandidateView['evidenceRefs'];
  idempotencyKey: string }): Promise<{ growthRoundId: string }> {
  return request(`${bookPath(bookId)}/core-workflow/storyline-growth-rounds`, { method: 'POST', body: JSON.stringify(input) });
}

export function addStorylineGrowthCandidate(bookId: string, growthRoundId: string, input: {
  candidateKind: StorylineGrowthCandidateView['candidateKind']; storylineId?: string | null; title: string;
  content: StorylineGrowthCandidateContent; evidenceRefs: StorylineGrowthCandidateView['evidenceRefs'];
  sourceBatchId?: string | null; sourceBatchMemberId?: string | null; basedOnVersionIds?: string[]
}): Promise<StorylineGrowthCandidateView> {
  return request(`${bookPath(bookId)}/core-workflow/storyline-growth-rounds/${encodeURIComponent(growthRoundId)}/candidates`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function decideStorylineGrowthCandidate(bookId: string, candidateId: string, input: {
  decision: 'accepted' | 'rejected' | 'observing'; editedContent?: StorylineGrowthCandidateContent | null;
  idempotencyKey: string; expectedStatus: 'candidate'
}): Promise<{ decisionId: string; createdStorylineId: string | null; createdFrontierVersionId: string | null }> {
  return request(`${bookPath(bookId)}/core-workflow/storyline-growth-candidates/${encodeURIComponent(candidateId)}/decision`, {
    method: 'POST', body: JSON.stringify(input)
  });
}
export function reorderStorylines(bookId: string, storylineIds: string[]): Promise<{ reordered: true }> {
  return request(`${bookPath(bookId)}/core-workflow/storylines/order`, {
    method: 'PUT', body: JSON.stringify({ storylineIds })
  });
}

export function upsertStorylineRelation(bookId: string, input: { fromStorylineId: string; toStorylineId: string;
  relationType: StorylineRelationView['relationType']; description: string }): Promise<{ relationId: string }> {
  return request(`${bookPath(bookId)}/core-workflow/storyline-relations`, { method: 'POST', body: JSON.stringify(input) });
}

export function upsertVolumeParticipation(bookId: string, input: { storylineId: string; volumePlanId: string;
  participationStatus: StorylineVolumeParticipationStatus; responsibility?: string | null }): Promise<{ participationId: string }> {
  return request(`${bookPath(bookId)}/core-workflow/volume-participations`, { method: 'PUT', body: JSON.stringify(input) });
}

export function createCharacterCard(bookId: string, input: { characterKind: CharacterCardView['characterKind'];
  content: CharacterCardContent; promotedFromCharacterId?: string | null }): Promise<{ characterId: string; versionId: string }> {
  return request(`${bookPath(bookId)}/core-workflow/characters`, { method: 'POST', body: JSON.stringify(input) });
}

export function updateCharacterCard(bookId: string, characterId: string, input: { content: CharacterCardContent;
  expectedActiveVersionId: string; sourceOpeningVersion?: number | null }): Promise<{ versionId: string; version: number }> {
  return request(`${bookPath(bookId)}/core-workflow/characters/${encodeURIComponent(characterId)}/versions`, {
    method: 'POST', body: JSON.stringify(input)
  });
}
export function upsertEventRoleAssignment(bookId: string, input: { eventChainVersionId: string; eventNodeId: string;
  roleFunctionKey: string; roleFunctionLabel: string; requirement: Record<string, unknown>;
  assignedCharacterId?: string | null }): Promise<{ assignmentId: string }> {
  return request(`${bookPath(bookId)}/core-workflow/event-role-assignments`, { method: 'PUT', body: JSON.stringify(input) });
}

export function updateStorylineLifecycle(bookId: string, storylineId: string, status: StorylineLifecycleStatus): Promise<{ updated: true }> {
  return request(`${bookPath(bookId)}/core-workflow/storylines/${encodeURIComponent(storylineId)}/lifecycle`, {
    method: 'PATCH', body: JSON.stringify({ status })
  });
}

export function setCoreWorkflowStage(bookId: string, stage: CoreWorkflowStage, expectedStateVersion: number, activeObjectId?: string | null): Promise<{ stateVersion: number }> {
  return request(`${bookPath(bookId)}/core-workflow/state`, {
    method: 'PUT', body: JSON.stringify({ stage, expectedStateVersion, activeObjectId: activeObjectId ?? null })
  });
}

export function fetchEditorialTeam(bookId: string, signal?: AbortSignal): Promise<{ pools: EditorialRolePoolView[] }> {
  return request(`${bookPath(bookId)}/editorial-team`, signal === undefined ? {} : { signal });
}

export function saveAiNodeAuthorInput(bookId: string, nodeKind: string, objectId: string, contentText: string): Promise<{ id: string; version: number; contentHash: string }> {
  return request(`${bookPath(bookId)}/ai-nodes/author-input`, {
    method: 'PUT', body: JSON.stringify({ nodeKind, objectId, contentText })
  });
}

export function estimateAiNodeCost(bookId: string, input: Pick<CreateAiNodeBatchInput,
  'roleKey' | 'hardSources' | 'optionalSources' | 'preferredMemberIds' | 'tokenBudget' | 'outputTokenBudget' | 'reasoningLevel' | 'roundCount' | 'exampleCount'>): Promise<AiNodeCostEstimate> {
  return request(`${bookPath(bookId)}/ai-nodes/estimate`, { method: 'POST', body: JSON.stringify(input) });
}

export function createAiNodeBatch(bookId: string, input: CreateAiNodeBatchInput): Promise<AiNodeBatchView> {
  return request(`${bookPath(bookId)}/ai-nodes/batches`, { method: 'POST', body: JSON.stringify(input) });
}

export function fetchAiNodeBatch(bookId: string, batchId: string, signal?: AbortSignal): Promise<AiNodeBatchView> {
  return request(`${bookPath(bookId)}/ai-nodes/batches/${encodeURIComponent(batchId)}`, signal === undefined ? {} : { signal });
}

export function addAiNodeMember(bookId: string, batchId: string, memberId: string, confirmHighCost = false): Promise<AiNodeBatchView> {
  return request(`${bookPath(bookId)}/ai-nodes/batches/${encodeURIComponent(batchId)}/members`, {
    method: 'POST', body: JSON.stringify({ memberId, confirmHighCost })
  });
}

export function retryAiNodeMember(bookId: string, batchId: string, batchMemberId: string): Promise<AiNodeBatchView> {
  return request(`${bookPath(bookId)}/ai-nodes/batches/${encodeURIComponent(batchId)}/members/${encodeURIComponent(batchMemberId)}/retry`, {
    method: 'POST', body: '{}'
  });
}

export function replaceAiNodeMember(bookId: string, batchId: string, batchMemberId: string, replacementMemberId: string, confirmHighCost = false): Promise<AiNodeBatchView> {
  return request(`${bookPath(bookId)}/ai-nodes/batches/${encodeURIComponent(batchId)}/members/${encodeURIComponent(batchMemberId)}/replace`, {
    method: 'POST', body: JSON.stringify({ replacementMemberId, confirmHighCost })
  });
}
