import { newActionKey, request, type PlanningTreeView } from './opening-api';

export type CreationRoleKey =
  | 'chief_editor' | 'deputy_editor' | 'planning_writer'
  | 'lead_writer' | 'independent_reviewer' | 'continuity_editor' | 'visual_renderer';

export type CreationMemberSelectionKey = CreationRoleKey | 'option_1' | 'option_2' | 'option_3';

export interface CreationMember {
  memberKey: string;
  name: string;
  roleKey: CreationRoleKey;
  role: string;
  defaultForRole: boolean;
}

export interface CreationWorkflowView {
  workflowId: string;
  bookId: string;
  stage: 'context_selection' | 'volume_options' | 'volume_decision' | 'volume_tree_confirmation'
    | 'chain_options' | 'chain_decision' | 'chain_tree_confirmation' | 'chapter_outlines'
    | 'chapter_outline_confirmation' | 'manuscript' | 'manuscript_confirmation' | 'settlement' | 'completed';
  status: 'waiting' | 'working' | 'waiting_for_you' | 'completed' | 'failed' | 'partially_failed' | 'cancelled';
  message: string;
  firstVolume: boolean;
  volumeScopeId: string;
  chainScopeId: string | null;
  completedOptions: number;
  expectedOptions: number;
  options: Array<{
    optionId: string; seat: '方案一' | '方案二' | '方案三'; memberKey: string; memberName: string;
    name: string; summary: string; designRationale?: string; readerExperience: string; coreConflict: string; protagonistChoice: string;
    priceAndChange: string; payoff: string; strengths: string[]; risks: string[];
    steps: Array<{
      sequence: number; title: string; summary: string; majorEvents: string[]; protagonistChange: string;
      emotion: string; experience: string; outcome: string; nextStep: string;
      wordTarget: number | null; chapterRange: readonly [number, number] | null;
    }>;
  }>;
  chiefReview: null | {
    memberKey: string; memberName: string; summary: string; recommendedOptionId: string;
    differences: Array<{ optionId: string; difference: string }>; risks: string[]; authorDecisions: string[];
  };
  optionRevision: null | {
    memberKey: string; memberName: string; publicSummary: string; risks: string[]; authorDecisions: string[];
  };
  expectedOutlines?: number;
  outlines?: Array<{
    candidateId: string; seat: '方案一' | '方案二' | '方案三'; status: string; memberKey: string;
    reviewerMemberKey: string | null;
    review: null | {
      passed: boolean; publicSummary: string;
      hardConflicts: Array<{ evidence: string; impact: string; action: string }>;
      continuityRisks: Array<{ evidence: string; impact: string; action: string }>;
      qualitySuggestions: Array<{ evidence: string; impact: string; action: string }>;
      rewriteInstructions: string[];
    };
    content: {
      publicSummary: string; chapterStart: number; chapterEnd: number;
      chapters: Array<{
        chapterNumber: number; title: string; objective: string; openingHook: string; sceneSetup: string;
        protagonistChoice: string; opposition: string; turn: string; emotionalMovement: string; payoff: string;
        continuity: string; openQuestions: string[]; nextChapterInterface: string;
      }>;
    };
  }>;
  outline: null | {
    sequenceId: string; revision: number; status: string; memberKey: string;
    reviewerMemberKey: string | null;
    review: null | {
      passed: boolean; publicSummary: string;
      hardConflicts: Array<{ evidence: string; impact: string; action: string }>;
      continuityRisks: Array<{ evidence: string; impact: string; action: string }>;
      qualitySuggestions: Array<{ evidence: string; impact: string; action: string }>;
      rewriteInstructions: string[];
    };
    content: {
      publicSummary: string; chapterStart: number; chapterEnd: number;
      chapters: Array<{
        chapterNumber: number; title: string; objective: string; openingHook: string; sceneSetup: string;
        protagonistChoice: string; opposition: string; turn: string; emotionalMovement: string; payoff: string;
        continuity: string; openQuestions: string[]; nextChapterInterface: string;
      }>;
    };
  };
  manuscript: null | {
    manuscriptVersionId: string; chapterNumber: number; revision: number; status: 'draft' | 'reviewed' | 'final';
    memberKey: string; reviewerMemberKey: string | null; content: string;
    review: null | {
      passed: boolean; publicSummary: string;
      hardConflicts: Array<{ evidence: string; impact: string; action: string }>;
      continuityRisks: Array<{ evidence: string; impact: string; action: string }>;
      qualitySuggestions: Array<{ evidence: string; impact: string; action: string }>;
      rewriteInstructions: string[];
    };
  };
  progress: { completedChapters: number; totalChapters: number; percent: number; nextChapterNumber: number | null };
  remainingChains: Array<{ scopeId: string; title: string; summary: string }>;
  volumeComplete: boolean;
  actors: Array<{
    memberKey: string; memberName: string; role: string;
    status: 'working' | 'completed' | 'handed_over' | 'waiting' | 'failed'; message: string; emoji: string;
  }>;
  execution: {
    mode: 'manual' | 'managed';
    status: 'inactive' | 'active' | 'paused' | 'completed' | 'failed' | 'unknown' | 'cancelled';
    writerMemberKey: string | null;
    reviewerMemberKey: string | null;
    errorMessage: string | null;
  };
  timing?: {
    createdAt: string; lastActivityAt: string; elapsedSeconds: number; idleSeconds: number;
    state: 'normal' | 'slow' | 'overdue';
  };
  errorMessage: string | null;
}

export type CreationChapterOutline = NonNullable<CreationWorkflowView['outline']>['content']['chapters'][number];
export type CreationChapterReview = NonNullable<NonNullable<CreationWorkflowView['manuscript']>['review']>;

export interface CreationLibraryView {
  volumes: Array<{
    volumeScopeId: string;
    status: CreationWorkflowView['status'];
    latestWorkflowId: string;
    chains: Array<{
      chainScopeId: string;
      workflowId: string;
      status: CreationWorkflowView['status'];
      outline: null | {
        sequenceId: string;
        revision: number;
        status: string;
        memberKey: string;
        reviewerMemberKey: string | null;
        review: CreationChapterReview | null;
        content: { publicSummary: string; chapterStart: number; chapterEnd: number; chapters: CreationChapterOutline[] };
        chapters: Array<{
          chapter: CreationChapterOutline;
          manuscript: null | {
            manuscriptVersionId: string;
            revision: number;
            status: 'draft' | 'reviewed' | 'final';
            memberKey: string;
            reviewerMemberKey: string | null;
            review: CreationChapterReview | null;
          };
        }>;
      };
    }>;
  }>;
}

export interface TimeMachineProgressView {
  finalizedChapterCount: number;
  latestFinalChapter: null | {
    chapterNumber: number;
  };
  latestConfirmedChain: PlanningTreeView | null;
  latestConfirmedChainState?: 'loaded' | 'missing' | 'failed';
}

export interface StoryStateItemView {
  kind: 'story_line' | 'foreshadowing' | 'open_question';
  stableKey: string;
  title: string;
  state: string;
  revision: number;
  detail: unknown;
  evidenceRefs: unknown;
  updatedAt: string;
}

export interface CreationManuscriptView {
  manuscriptVersionId: string;
  workflowId: string;
  sequenceId: string;
  chapterNumber: number;
  revision: number;
  status: 'draft' | 'reviewed' | 'final';
  memberKey: string;
  reviewerMemberKey: string | null;
  content: string;
  review: CreationChapterReview | null;
  createdAt: string;
  finalizedAt: string | null;
}

export function fetchCreationMembers(signal?: AbortSignal): Promise<CreationMember[]> {
  return request('/api/v1/v7/editorial/creation-members', signal === undefined ? undefined : { signal });
}

export function fetchLatestCreationWorkflow(bookId: string, signal?: AbortSignal): Promise<CreationWorkflowView | null> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-workflows/latest`, signal === undefined ? undefined : { signal });
}

export function fetchCreationLibrary(bookId: string, signal?: AbortSignal): Promise<CreationLibraryView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-library`, signal === undefined ? undefined : { signal });
}

export function fetchTimeMachineProgress(bookId: string, signal?: AbortSignal): Promise<TimeMachineProgressView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/time-machine-progress`, signal === undefined ? undefined : { signal });
}

export function fetchStoryState(bookId: string, signal?: AbortSignal): Promise<StoryStateItemView[]> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/story-state`, signal === undefined ? undefined : { signal });
}

export function fetchCreationManuscript(
  bookId: string,
  manuscriptVersionId: string,
  signal?: AbortSignal
): Promise<CreationManuscriptView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/manuscripts/${encodeURIComponent(manuscriptVersionId)}`,
    signal === undefined ? undefined : { signal });
}

export function fetchCreationWorkflow(bookId: string, workflowId: string, signal?: AbortSignal): Promise<CreationWorkflowView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-workflows/${encodeURIComponent(workflowId)}`, signal === undefined ? undefined : { signal });
}

export function fetchCreationTasks(signal?: AbortSignal): Promise<CreationWorkflowView[]> {
  return request('/api/v1/v7/creation-tasks?limit=50', signal === undefined ? undefined : { signal });
}

export function createCreationWorkflow(
  bookId: string,
  volumeScopeId: string,
  authorGoal: string,
  candidateCount: number,
  memberPreferences: Record<string, string>
): Promise<CreationWorkflowView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-workflows`, {
    method: 'POST',
    body: JSON.stringify({ volumeScopeId, authorGoal, candidateCount, memberPreferences, idempotencyKey: newActionKey('creation-workflow') })
  });
}

export function chooseCreationOption(bookId: string, workflowId: string, kind: 'volume' | 'chain', optionId: string, authorNote: string): Promise<{ treeKind: 'volume' | 'chain'; scopeId: string; treeVersionId: string }> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-workflows/${encodeURIComponent(workflowId)}/options/choose`, {
    method: 'POST', body: JSON.stringify({ kind, optionId, authorNote, idempotencyKey: newActionKey(`choose-${kind}`) })
  });
}

export function continueCreationToChain(
  bookId: string,
  workflowId: string,
  chainScopeId: string,
  candidateCount = 1,
  memberPreferences: Record<string, string> = {}
): Promise<CreationWorkflowView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-workflows/${encodeURIComponent(workflowId)}/continue-to-chain`, {
    method: 'POST', body: JSON.stringify({ chainScopeId, candidateCount, memberPreferences })
  });
}

export function continueCreationToNextChain(
  bookId: string,
  workflowId: string,
  chainScopeId?: string,
  candidateCount = 1,
  memberPreferences: Record<string, string> = {}
): Promise<{
  volumeComplete: boolean;
  workflow: CreationWorkflowView | null;
}> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-workflows/${encodeURIComponent(workflowId)}/continue-to-next-chain`, {
    method: 'POST',
    body: JSON.stringify({
      ...(chainScopeId === undefined ? {} : { chainScopeId }),
      candidateCount,
      memberPreferences,
      idempotencyKey: newActionKey('continue-next-chain')
    })
  });
}

export function generateCreationOutlines(bookId: string, workflowId: string, input: {
  maximumChapters: number; candidateCount?: 1 | 2 | 3; memberKey?: string; memberKeys?: string[];
  replaceCandidateId?: string; regenerate?: boolean;
}): Promise<unknown> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-workflows/${encodeURIComponent(workflowId)}/outlines`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function confirmCreationOutline(bookId: string, workflowId: string, sequenceId: string): Promise<unknown> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-workflows/${encodeURIComponent(workflowId)}/outlines/confirm`, {
    method: 'POST', body: JSON.stringify({ sequenceId, idempotencyKey: newActionKey('confirm-outline') })
  });
}

export function generateCreationManuscript(bookId: string, workflowId: string, input: { chapterNumber: number; writerMemberKey?: string; reviewerMemberKey?: string; resumeExistingDraft?: boolean }): Promise<unknown> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-workflows/${encodeURIComponent(workflowId)}/manuscripts`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function activateManagedCreation(bookId: string, workflowId: string, input: { writerMemberKey?: string; reviewerMemberKey?: string }): Promise<CreationWorkflowView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-workflows/${encodeURIComponent(workflowId)}/managed/activate`, {
    method: 'POST', body: JSON.stringify(input)
  });
}

export function finalizeCreationManuscript(bookId: string, workflowId: string, manuscriptVersionId: string): Promise<unknown> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-workflows/${encodeURIComponent(workflowId)}/manuscripts/finalize`, {
    method: 'POST', body: JSON.stringify({ manuscriptVersionId, idempotencyKey: newActionKey('finalize-manuscript') })
  });
}

export function chooseCreationMember(bookId: string, workflowId: string, selectionKey: CreationMemberSelectionKey, memberKey: string): Promise<CreationWorkflowView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-workflows/${encodeURIComponent(workflowId)}/member`, {
    method: 'POST', body: JSON.stringify({ selectionKey, memberKey })
  });
}

export function retryCreationOptions(bookId: string, workflowId: string): Promise<CreationWorkflowView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-workflows/${encodeURIComponent(workflowId)}/options/retry`, {
    method: 'POST', body: JSON.stringify({})
  });
}

export function cancelCreationWorkflow(bookId: string, workflowId: string): Promise<CreationWorkflowView> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-workflows/${encodeURIComponent(workflowId)}/cancel`, {
    method: 'POST', body: JSON.stringify({ reason: '作者停止了这项未完成工作。', idempotencyKey: newActionKey('cancel-creation') })
  });
}

export function fetchCreationWriteBack(bookId: string, workflowId: string, signal?: AbortSignal): Promise<{
  workflowId: string; total: number; completed: number; pending: number; failed: number; unknown: number;
  tasks: Array<{ taskId: string; task: string; status: string; message: string; attempts: number; updatedAt: string }>;
}> {
  return request(`/api/v1/v7/books/${encodeURIComponent(bookId)}/creation-workflows/${encodeURIComponent(workflowId)}/write-back`, signal === undefined ? undefined : { signal });
}
