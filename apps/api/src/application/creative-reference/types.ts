/** R209-B1 创作参考库领域类型。纯内容合同：不导入SQLite、HTTP或旧书籍对象。 */

export type AssetKind = 'method' | 'reference';

export const ASSET_KINDS: readonly AssetKind[] = ['method', 'reference'];

/** 展示编号前缀：方法=法，参考=参（总规格18.1）。 */
export function displayCodePrefix(kind: AssetKind): string {
  return kind === 'method' ? '法' : '参';
}

/**
 * revision内容状态机：draft→reviewed→published；retired只落在卡（当前可选状态）。
 * 已发布revision内容不可变；退役不使旧release内的published revision失效。
 */
export type RevisionStatus = 'draft' | 'reviewed' | 'published';

export const REVISION_STATUSES: readonly RevisionStatus[] = ['draft', 'reviewed', 'published'];

/** 卡的当前可选状态：retired禁止新选择，不影响历史release资格。 */
export type CardAvailability = 'draft' | 'reviewed' | 'published' | 'retired';

export const CARD_AVAILABILITIES: readonly CardAvailability[] = ['draft', 'reviewed', 'published', 'retired'];

export interface LegacyRef {
  namespace: string;
  key: string;
  version?: number;
}

export interface ReferenceContent {
  kind: string;
  facets: { genres: string[]; mechanisms: string[]; experiences: string[]; purposes: string[] };
  stages: string[];
  useWhen: string[];
  questions: string[];
  possibilities: string[];
  imbalanceChecks: string[];
  examples: Array<{ premise: string; direction: string; boundary: string }>;
  relatedCards: string[];
  methodRefs: Array<{ id: string; reason: string }>;
  evidence: { kind: 'editorial_heuristic' | 'cited_research' | 'observed_evaluation'; refs: string[]; limitations: string };
}

export interface MethodContent {
  relatedPurposes?: string[];
  methodKind?: 'technique' | 'story_container' | 'action_strategy' | 'story_beat' | 'combination' | 'checklist';
  conditionalUses?: Array<{stage: string; condition: string; use: string}>;
  title: string;
  instruction: string;
  boundary: string;
  usageTree: string;
  applicableLayers: string[];
  aliases: string[];
}

export type CardPayload =
  | { assetKind: 'reference'; name: string; shortPhrase: string; summary: string; aliases: string[]; reference: ReferenceContent }
  | { assetKind: 'method'; name: string; shortPhrase: string; summary: string; aliases: string[]; method: MethodContent };

export interface CardRecord {
  internalId: string;
  assetKind: AssetKind;
  displayCode: string;
  legacy: LegacyRef | null;
  currentRevision: number | null;
  availability: CardAvailability;
  createdAt: string;
  updatedAt: string;
}

export interface RevisionRecord {
  internalId: string;
  revision: number;
  assetKind: AssetKind;
  schemaVersion: number;
  payload: CardPayload;
  contentHash: string;
  displayCode: string;
  shortPhrase: string;
  summary: string;
  status: RevisionStatus;
  authorActor: string;
  reviewActor: string | null;
  createdAt: string;
}

export type RelationType = 'supplement' | 'fusion' | 'synonym' | 'replacement' | 'related_method';

export interface RelationRecord {
  relationId: string;
  fromId: string;
  fromRevision: number;
  toId: string;
  toRevision: number;
  relationType: RelationType;
  createdAt: string;
}

export interface ReleaseSnapshot {
  releaseId: string;
  manifestHash: string;
  /** 冻结清单：条目为 internalId+revision+关系边；不可变、canonical化。 */
  entries: ReadonlyArray<{ internalId: string; revision: number }>;
  relations: ReadonlyArray<{ fromId: string; fromRevision: number; toId: string; toRevision: number; relationType: RelationType }>;
  active: boolean;
  createdAt: string;
  publishedBy: string;
}

/** 三档投影（总规格18.2）：引用/短目录/详情。 */
export interface CitationProjection {
  tier: 'citation';
  displayCode: string;
  revision: number;
  shortPhrase: string;
}

export interface DigestProjection {
  tier: 'digest';
  displayCode: string;
  revision: number;
  shortPhrase: string;
  summary: string;
  usageTree?: string;
  applicableLayers?: string[];
}

export interface DetailProjection {
  tier: 'detail';
  displayCode: string;
  revision: number;
  shortPhrase: string;
  summary: string;
  payload: CardPayload;
}

export type Projection = CitationProjection | DigestProjection | DetailProjection;

export interface ManagerContext {
  role: 'manager';
  actorId: string;
}

export interface MemberContext {
  role: 'member';
  actorId: string;
}

export type ActorContext = ManagerContext | MemberContext;

export type ExactKey =
  | { by: 'internalId'; internalId: string }
  | { by: 'displayCode'; displayCode: string }
  | { by: 'legacy'; legacy: LegacyRef };

export interface ExactReadOptions {
  revision?: number;
  releaseId?: string;
}

export interface AdminListFilter {
  assetKind?: AssetKind;
  usageTree?: string;
  layers?: string[];
  availabilities?: CardAvailability[];
  cursor?: { lastInternalId: string; filterFingerprint: string } | null;
  limit?: number;
}

export interface AdminListPage {
  items: CardRecord[];
  nextCursor: { lastInternalId: string; filterFingerprint: string } | null;
}

export type LookupResult =
  | { outcome: 'found'; card: CardRecord; revision: RevisionRecord }
  | { outcome: 'notFound'; reason: string }
  | { outcome: 'ambiguous'; candidates: Array<{ internalId: string; displayCode: string; legacy: LegacyRef | null }>; reason: string };
