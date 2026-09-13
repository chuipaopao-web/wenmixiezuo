/**
 * R209-B2 创作库管理API客户端：全部走platformRequest（同源凭据、统一envelope与错误文案）。
 * 只声明浏览器需要的类型合同；不导入任何服务器运行代码。
 */
import { platformRequest } from './platform-api';

export type CreativeAssetKind = 'method' | 'reference';
export type CreativeAvailability = 'draft' | 'reviewed' | 'published' | 'retired';
export type CreativeRevisionStatus = 'draft' | 'reviewed' | 'published';

export interface CreativeMethodContent {
  relatedPurposes?: string[];
  methodKind?: 'technique' | 'story_container' | 'action_strategy' | 'story_beat' | 'combination' | 'checklist';
  conditionalUses?: Array<{stage: string; condition: string; use: string}>;
  title: string;
  instruction: string;
  boundary?: string;
  usageTree: string;
  applicableLayers: string[];
  aliases: string[];
}

export interface CreativeReferenceContent {
  kind: string;
  facets: { genres: string[]; mechanisms: string[]; experiences: string[]; purposes: string[] };
  stages?: string[];
  useWhen?: string[];
  questions?: string[];
  possibilities?: string[];
  imbalanceChecks?: string[];
  examples?: Array<{ premise: string; direction: string; boundary: string }>;
  relatedCards?: string[];
  methodRefs?: string[];
  evidence: { kind: 'editorial_heuristic' | 'cited_research' | 'observed_evaluation'; refs: string[]; limitations: string };
}

export interface CreativeCardPayload {
  assetKind: CreativeAssetKind;
  name: string;
  shortPhrase: string;
  summary: string;
  aliases: string[];
  method?: CreativeMethodContent;
  reference?: CreativeReferenceContent;
}

export interface CreativeCardSummary {
  internalId: string;
  assetKind: CreativeAssetKind;
  displayCode: string;
  name: string;
  shortPhrase: string;
  summary: string;
  usageTree: string | null;
  applicableLayers: string[];
  genres: string[];
  mechanisms: string[];
  experiences: string[];
  aliases: string[];
  currentRevision: number | null;
  revisionStatus: CreativeRevisionStatus | null;
  availability: CreativeAvailability;
  updatedAt: string;
}

export interface CreativeCardListFilter {
  assetKind?: CreativeAssetKind;
  keyword?: string;
  usageTree?: string;
  layers?: string[];
  availabilities?: CreativeAvailability[];
  genre?: string;
  mechanism?: string;
  experience?: string;
  cursor?: string | null;
  limit?: number;
}

export interface CreativeCardListPage {
  items: CreativeCardSummary[];
  nextCursor: string | null;
}

export interface CreativeCardDetail {
  card: { internalId: string; assetKind: CreativeAssetKind; displayCode: string; currentRevision: number | null; availability: CreativeAvailability; createdAt: string; updatedAt: string };
  revision: { internalId: string; revision: number; payload: CreativeCardPayload; shortPhrase: string; summary: string; status: CreativeRevisionStatus; authorActor: string; reviewActor: string | null; createdAt: string } | null;
  aliases: Array<{ legacy: { namespace: string; key: string; version?: number }; sourceView: string }>;
  audit: CreativeAuditEntry[];
}

export interface CreativeAuditEntry {
  action: 'create' | 'revise' | 'review' | 'retire' | 'restore' | 'publish';
  actorId: string;
  opinion: string | null;
  createdAt: string;
  targetRevision: number | null;
}

export interface CreativeRevisionSummary {
  revision: number;
  status: CreativeRevisionStatus;
  shortPhrase: string;
  summary: string;
  authorActor: string;
  reviewActor: string | null;
  reviewOpinion: string | null;
  createdAt: string;
}

export interface CreativeReleaseSummary {
  releaseId: string;
  manifestHash: string;
  active: boolean;
  createdAt: string;
  publishedBy: string;
  entryCount: number;
  relationCount: number;
}

export interface CreativeReleaseDetail {
  release: {
    releaseId: string;
    manifestHash: string;
    active: boolean;
    createdAt: string;
    publishedBy: string;
    relations: CreativeRelationInput[];
  };
  relations: CreativeRelationInput[];
}

export interface CreativeRelationInput {
  fromId: string;
  fromRevision: number;
  toId: string;
  toRevision: number;
  relationType: 'supplement' | 'fusion' | 'synonym' | 'replacement' | 'related_method';
}

export function fetchCreativeCards(filter: CreativeCardListFilter, signal?: AbortSignal): Promise<CreativeCardListPage> {
  const query = new URLSearchParams();
  if (filter.assetKind !== undefined) query.set('assetKind', filter.assetKind);
  if (filter.keyword !== undefined && filter.keyword.trim().length > 0) query.set('keyword', filter.keyword.trim());
  if (filter.usageTree !== undefined && filter.usageTree.length > 0) query.set('usageTree', filter.usageTree);
  if (filter.layers !== undefined && filter.layers.length > 0) query.set('layers', filter.layers.join(','));
  if (filter.availabilities !== undefined && filter.availabilities.length > 0) query.set('status', filter.availabilities.join(','));
  if (filter.genre !== undefined && filter.genre.length > 0) query.set('genre', filter.genre);
  if (filter.mechanism !== undefined && filter.mechanism.length > 0) query.set('mechanism', filter.mechanism);
  if (filter.experience !== undefined && filter.experience.length > 0) query.set('experience', filter.experience);
  if (filter.cursor !== undefined && filter.cursor !== null) query.set('cursor', filter.cursor);
  query.set('limit', String(filter.limit ?? 20));
  return platformRequest(`/api/v1/admin/creative-reference/cards?${query.toString()}`, signal === undefined ? {} : { signal });
}

export function fetchCreativeCardDetail(internalId: string, signal?: AbortSignal): Promise<CreativeCardDetail> {
  return platformRequest(`/api/v1/admin/creative-reference/cards/${encodeURIComponent(internalId)}`, signal === undefined ? {} : { signal });
}

export function createCreativeCard(input: { payload: CreativeCardPayload; legacy: { namespace: string; key: string; version?: number } | null; idempotencyKey: string }): Promise<{ card: CreativeCardDetail['card'] }> {
  return platformRequest('/api/v1/admin/creative-reference/cards', { method: 'POST', body: JSON.stringify(input) });
}

export function saveCreativeCardRevision(internalId: string, input: { payload: CreativeCardPayload; expectedRevision: number }): Promise<{ revision: { revision: number; status: CreativeRevisionStatus } }> {
  return platformRequest(`/api/v1/admin/creative-reference/cards/${encodeURIComponent(internalId)}/revisions`, { method: 'POST', body: JSON.stringify(input) });
}

export function fetchCreativeRevisions(internalId: string, signal?: AbortSignal): Promise<{ items: CreativeRevisionSummary[]; total: number; nextOffset: number | null }> {
  return platformRequest(`/api/v1/admin/creative-reference/cards/${encodeURIComponent(internalId)}/revisions?limit=20`, signal === undefined ? {} : { signal });
}

export interface CreativeRevisionSnapshot {
  revision: number;
  payload: CreativeCardPayload;
  shortPhrase: string;
  summary: string;
  status: CreativeRevisionStatus;
  authorActor: string;
  reviewActor: string | null;
  createdAt: string;
}

export function fetchCreativeRevisionSnapshot(internalId: string, revision: number, signal?: AbortSignal): Promise<{ revision: CreativeRevisionSnapshot; reviewOpinion: string | null }> {
  return platformRequest(`/api/v1/admin/creative-reference/cards/${encodeURIComponent(internalId)}/revisions/${revision}`, signal === undefined ? {} : { signal });
}

export function reviewCreativeCard(internalId: string, input: { expectedRevision: number; opinion?: string | null }): Promise<{ revision: { revision: number; status: CreativeRevisionStatus }; reviewOpinion: string | null }> {
  return platformRequest(`/api/v1/admin/creative-reference/cards/${encodeURIComponent(internalId)}/review`, { method: 'POST', body: JSON.stringify(input) });
}

export function setCreativeAvailability(internalId: string, input: { action: 'retire' | 'restore'; seenAvailability: CreativeAvailability; seenRevision: number; reason?: string | null }): Promise<{ card: CreativeCardDetail['card'] }> {
  return platformRequest(`/api/v1/admin/creative-reference/cards/${encodeURIComponent(internalId)}/availability`, { method: 'POST', body: JSON.stringify(input) });
}

export function fetchCreativeReleases(signal?: AbortSignal): Promise<{ items: CreativeReleaseSummary[]; total: number; activeReleaseId: string | null; nextOffset: number | null }> {
  return platformRequest('/api/v1/admin/creative-reference/releases?limit=20', signal === undefined ? {} : { signal });
}

export function fetchCreativeReleaseDetail(releaseId: string, signal?: AbortSignal): Promise<CreativeReleaseDetail> {
  return platformRequest(`/api/v1/admin/creative-reference/releases/${encodeURIComponent(releaseId)}`, signal === undefined ? {} : { signal });
}

/** 冻结清单条目分页：游标绑定该release，跨release/畸形由服务端拒绝；需要完整清单时按固定releaseId遍历。 */
export function fetchCreativeReleaseEntries(releaseId: string, options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {}): Promise<{ items: Array<{ internalId: string; revision: number }>; nextCursor: string | null }> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 100) });
  if (options.cursor !== undefined && options.cursor !== null) query.set('cursor', options.cursor);
  return platformRequest(`/api/v1/admin/creative-reference/releases/${encodeURIComponent(releaseId)}/entries?${query.toString()}`, options.signal === undefined ? {} : { signal: options.signal });
}

export function publishCreativeRelease(input: {
  entries: Array<{ internalId: string; revision: number }>;
  relations: CreativeRelationInput[];
  expectedActiveReleaseId: string | null;
  idempotencyKey: string;
}): Promise<{ release: CreativeReleaseDetail['release']; replayed: boolean }> {
  return platformRequest('/api/v1/admin/creative-reference/releases', { method: 'POST', body: JSON.stringify(input) });
}
