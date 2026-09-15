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
  /** S1-A阶段二：该轮基于旧版故事线资料，结果保留可读但不可采用/修订（第25节）。 */
  needsRedesign?: boolean;
  /** S1-A：成功推荐的服务端规范哈希与来源版本；作者原样带回、服务端再验证，前端不可伪造。 */
  recommendationHash?: string | null;
  preparationVersion?: string | null;
  /** S1-A：设计轮的最小选择投影，用于刷新后恢复当次实际选择；不回传完整快照或内部成员配置。 */
  selection?: StorylineSelectionProjection | null;
}

export interface StorylineSelectionProjection {
  recommendationRunId: string | null;
  selectedLineIds: string[];
  addedLines: { title: string; description: string }[];
  shape: 'auto' | 'single' | 'multiple';
  ensemble: boolean;
  authorNote: string;
}

/** S1-A：作者对推荐的结构化确认（发给后端；勾选/自添/备注都由服务端按来源校验）。 */
export interface StorylineSelectionRequest {
  recommendationRunId: string;
  recommendationHash: string;
  preparationVersion: string;
  selectedLineIds: string[];
  /** 72c3a62f复核第1项：勾选推荐线的正文快照，作者可编辑标题/描述；role由服务端按推荐裁定，前端不必回传。 */
  selectedLines?: { id: string; title: string; description: string }[];
  addedLines: { title: string; description: string }[];
  shape: 'auto' | 'single' | 'multiple';
  ensemble: boolean;
  authorNote: string;
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
  /** S1-A阶段二：已采用基线基于旧版故事线资料，需重新设计（第25节）。 */
  needsRedesign?: boolean;
}

/** S1-A阶段二（第25节）：故事线资料——作者确认故事线后的正式版本对象。 */
export interface StorylineMaterialLineView {
  id: string;
  role: 'main' | 'through' | 'stage';
  title: string;
  description: string;
}

export interface StorylineMaterialContentView {
  recommendationRunId: string;
  recommendationHash: string;
  preparationVersion: string;
  selectedLineIds: string[];
  /** 72c3a62f复核第1项：材料自含勾选线正文（可直接阅读/编辑）；旧版本材料由服务端从原推荐回填。 */
  selectedLines: StorylineMaterialLineView[];
  addedLines: { title: string; description: string }[];
  shape: 'auto' | 'single' | 'multiple';
  ensemble: boolean;
  authorNote: string;
}

export interface StorylineMaterialView {
  revision: number;
  content: StorylineMaterialContentView;
  createdBy: 'selection-confirm' | 'author-edit';
  createdAt: string;
  versions: { revision: number; contentHash: string; createdBy: string; createdAt: string }[];
  draft: { content: unknown; baseRevision: number; updatedAt: string } | null;
}

/** 客户端提交的材料内容：勾选线正文的role由服务端按原推荐裁定，提交时不带（72c3a62f复核第1项）。 */
export type StorylineMaterialContentInput = Omit<StorylineMaterialContentView, 'selectedLines'> & {
  selectedLines: { id: string; title: string; description: string }[];
};

export interface StorylineMaterialPreviewView {
  currentRevision: number;
  unchanged: boolean;
  revisionMatch: boolean;
  affectedBaseline: boolean;
  affectedRuns: { id: string; scheme: string | null; roundKey: string | null; state: string; alreadyMarked: boolean }[];
  affectedInFlight: number;
  /** 已采用基线的真实卷概要数；卷/链/章三级对象尚未实现，如实标注 not-created。 */
  downstream: { volumeOutlines: number; volumes: 'not-created'; chains: 'not-created'; chapters: 'not-created' };
  /** 72c3a62f复核第3项：预览签名绑定下游版本，确认保存时原样带回，服务端事务内重算校验。 */
  signature: string;
}

export interface TimeMachineStateView {
  preparation?: {ready:boolean;message:string;version:string|null};
  enabled: boolean;
  runs: TimeMachineRunView[];
  adopted: TimeMachineAdoptedView | null;
  planRevision: number;
  /** S1-A阶段二：本书故事线资料（未确认过故事线的书为null/缺省，页面如实显示尚未创建）。 */
  storylineMaterial?: StorylineMaterialView | null;
}

export async function fetchTimeMachineDirectionState(bookId: string, signal?: AbortSignal): Promise<TimeMachineStateView> {
  return request<TimeMachineStateView>(`/api/time-machine/books/${encodeURIComponent(bookId)}/state`, signal === undefined ? undefined : { signal });
}

export async function startTimeMachineRecommendation(bookId: string, idempotencyKey: string, intent = ''): Promise<{ id: string; state: string }> {
  return request<{ id: string; state: string }>(`/api/time-machine/books/${encodeURIComponent(bookId)}/recommendation-runs`, {
    method: 'POST',
    body: JSON.stringify({ intent, idempotencyKey })
  });
}

export async function startTimeMachineDesignRound(bookId: string, selection: StorylineSelectionRequest, idempotencyKey: string, expectedMaterialRevision?: number): Promise<{ runs: { id: string; scheme: string; state: string }[] }> {
  return request<{ runs: { id: string; scheme: string; state: string }[] }>(`/api/time-machine/books/${encodeURIComponent(bookId)}/design-runs`, {
    method: 'POST',
    body: JSON.stringify({ selection, idempotencyKey, ...(expectedMaterialRevision !== undefined ? { expectedMaterialRevision } : {}) })
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

/** S1-A阶段二（第25.3节）：故事线资料的影响预览/草稿/确认保存。 */
export async function previewStorylineMaterial(bookId: string, content: StorylineMaterialContentInput, expectedRevision: number): Promise<StorylineMaterialPreviewView> {
  return request<StorylineMaterialPreviewView>(`/api/time-machine/books/${encodeURIComponent(bookId)}/storyline-material/preview`, {
    method: 'POST',
    body: JSON.stringify({ content, expectedRevision })
  });
}

export async function saveStorylineMaterialDraft(bookId: string, content: StorylineMaterialContentInput, baseRevision: number): Promise<{ baseRevision: number; updatedAt: string }> {
  return request<{ baseRevision: number; updatedAt: string }>(`/api/time-machine/books/${encodeURIComponent(bookId)}/storyline-material/draft`, {
    method: 'PUT',
    body: JSON.stringify({ content, baseRevision })
  });
}

export async function saveStorylineMaterial(bookId: string, input: { content: StorylineMaterialContentInput; expectedRevision: number; previewSignature: string; idempotencyKey: string }): Promise<{ projection: StorylineMaterialView; markedRuns: number; unchanged: boolean; replayed: boolean }> {
  return request<{ projection: StorylineMaterialView; markedRuns: number; unchanged: boolean; replayed: boolean }>(`/api/time-machine/books/${encodeURIComponent(bookId)}/storyline-material`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function timeMachineRunBusy(run: TimeMachineRunView): boolean {
  return run.state === 'queued' || run.state === 'working';
}

export { AuthorApiError };
