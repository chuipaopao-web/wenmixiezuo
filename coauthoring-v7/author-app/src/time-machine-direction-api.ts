import { AuthorApiError, request } from './opening-api';

/** 新时光机（tm2）全书方向 API。规划是作者采用的未来方案，不是正文事实。 */

export interface TimeMachineLineView {
  id: string;
  role: 'main' | 'through' | 'stage';
  title: string;
  goal: string;
  answer: string;
  process: string;
  parentIds: string[];
  milestones: { id: string; summary: string; suggestedVolumes: string[]; importance: 'required' | 'flexible' }[];
}

export interface TimeMachineAnchorView {
  id: string;
  ownerEntityId: string;
  kind: 'entry' | 'exit' | 'milestone';
  summary: string;
  span: string;
  conditions: { summary: string; subjectIds: string[] }[];
  logic: 'all' | 'any' | 'ordered';
  importance: 'required' | 'flexible';
  fallback: string;
}

export interface TimeMachineVolumeView {
  id: string;
  title: string;
  beat: string;
  start: string;
  goal: string;
  conflict: string;
  turningPoint: string;
  gain: string | null;
  loss: string | null;
  arc: string | null;
  payoff: string | null;
  hook: string | null;
  mood: string | null;
  ending: string;
  handoff: string;
  words: { target: number; min: number | null; max: number | null; hard: boolean; policy: string };
  duties: { lineId: string; action: 'start' | 'advance' | 'pause' | 'close'; result: string; anchorIds: string[]; strength: 'required' | 'flexible'; reason: string }[];
}

export interface TimeMachinePlanView {
  baseline: string;
  ending: string;
  openingHooks: [string, string, string];
  words: { target: number; min: number | null; max: number | null; hard: boolean; policy: string };
  lines: TimeMachineLineView[];
  expectations: { id: string; opening: string; change: string; answer: string; lineIds: string[] }[];
  relations: { from: string; to: string; kind: string; effect: string }[];
  anchors: TimeMachineAnchorView[];
  volumes: TimeMachineVolumeView[];
}

export interface TimeMachineRecommendationView {
  greeting: string;
  lines: { id: string; role: 'main' | 'through' | 'stage'; title: string; description: string; recommended: boolean }[];
  structure: 'single' | 'multiple';
  reason: string;
}

export interface TimeMachineDesignResultView {
  candidateId: string;
  revision: number;
  member: { id: string; name: string };
  plan: TimeMachinePlanView;
  review: { pass: boolean; issues: string[]; suggestions: string[] };
  selfCheck: { pass: boolean; issues: string[] } | null;
}

export interface TimeMachineRunView {
  intent?: string;
  id: string;
  kind: 'recommend' | 'design';
  scheme: string | null;
  roundKey: string | null;
  state: 'queued' | 'working' | 'failed' | 'succeeded';
  updatedAt: string;
  member: { id: string; name: string } | null;
  progress: string;
  result: TimeMachineRecommendationView | TimeMachineDesignResultView | null;
  message: string | null;
}

export interface TimeMachineAdoptionNumbering {
  volumes: { localId: string; code: string }[];
  mainLines: string[];
  branchLines: string[];
}

export interface TimeMachineAdoptedView {
  revision: number;
  member: { id: string; name: string };
  plan: TimeMachinePlanView;
  numbering: TimeMachineAdoptionNumbering | null;
}

export interface TimeMachineStateView {
  enabled: boolean;
  runs: TimeMachineRunView[];
  adopted: TimeMachineAdoptedView | null;
  planRevision: number;
}

export async function fetchTimeMachineDirectionState(bookId: string, signal?: AbortSignal): Promise<TimeMachineStateView> {
  return request<TimeMachineStateView>(`/api/time-machine/books/${encodeURIComponent(bookId)}/state`, signal === undefined ? undefined : { signal });
}

export async function startTimeMachineRecommendation(bookId: string, idempotencyKey: string): Promise<{ id: string; state: string }> {
  return request<{ id: string; state: string }>(`/api/time-machine/books/${encodeURIComponent(bookId)}/recommendation-runs`, {
    method: 'POST',
    body: JSON.stringify({ intent: '', idempotencyKey })
  });
}

export async function startTimeMachineDesignRound(bookId: string, intent: string, idempotencyKey: string): Promise<{ runs: { id: string; scheme: string; state: string }[] }> {
  return request<{ runs: { id: string; scheme: string; state: string }[] }>(`/api/time-machine/books/${encodeURIComponent(bookId)}/design-runs`, {
    method: 'POST',
    body: JSON.stringify({ intent, idempotencyKey })
  });
}

export async function retryTimeMachineRun(bookId: string, runId: string): Promise<{ id: string }> {
  return request<{ id: string }>(`/api/time-machine/books/${encodeURIComponent(bookId)}/runs/${encodeURIComponent(runId)}/retry`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export async function saveTimeMachineCandidateRevision(bookId: string, candidateId: string, plan: TimeMachinePlanView, expectedRevision: number): Promise<{ revision: number }> {
  return request<{ revision: number }>(`/api/time-machine/books/${encodeURIComponent(bookId)}/candidates/${encodeURIComponent(candidateId)}/revisions`, {
    method: 'POST',
    body: JSON.stringify({ plan, expectedRevision })
  });
}

export async function adoptTimeMachinePlan(bookId: string, input: { candidateId: string; revision: number; expectedRevision: number; idempotencyKey: string }): Promise<{ id: string; revision: number }> {
  return request<{ id: string; revision: number }>(`/api/time-machine/books/${encodeURIComponent(bookId)}/adoptions`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function timeMachineRunBusy(run: TimeMachineRunView): boolean {
  return run.state === 'queued' || run.state === 'working';
}

export { AuthorApiError };
