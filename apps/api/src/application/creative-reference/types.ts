/** R209-B1 创作参考库领域类型。纯内容合同：不导入SQLite、HTTP或旧书籍对象。 */

export type AssetKind = 'method' | 'reference';

export const ASSET_KINDS: readonly AssetKind[] = ['method', 'reference'];

/** 展示编号前缀：方法=法，参考=参（总规格18.1）。 */
export function displayCodePrefix(kind: AssetKind): string {
  return kind === 'method' ? '法' : '参';
}

export type CardStatus = 'draft' | 'reviewed' | 'published' | 'retired';

export const CARD_STATUSES: readonly CardStatus[] = ['draft', 'reviewed', 'published', 'retired'];

/** legacy引用：来源命名空间+旧key+旧版本，保证旧任务可按原语义回读。 */
export interface LegacyRef {
  namespace: string;
  key: string;
  version?: number;
}

/** 参考卡内容沿总规格第8节合同（kind枚举放开为字符串：B1不裁定内容分类学）。 */
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

/** 方法卡：保留现有含义字段（title/instruction/boundary等），不重命名旧key。 */
export interface MethodContent {
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
  status: CardStatus;
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
  status: CardStatus;
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
  /** 冻结清单：条目为 internalId+revision；不可变。 */
  entries: ReadonlyArray<{ internalId: string; revision: number }>;
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

/** 写操作要求明确管理者上下文：服务层强制传入，禁止默认管理员。 */
export interface ManagerContext {
  role: 'manager';
  actorId: string;
}

export interface MemberContext {
  role: 'member';
  actorId: string;
}

export type ActorContext = ManagerContext | MemberContext;

/** 精确读取键：真实id / displayCode / legacy。 */
export type ExactKey =
  | { by: 'internalId'; internalId: string }
  | { by: 'displayCode'; displayCode: string }
  | { by: 'legacy'; legacy: LegacyRef };

export interface ExactReadOptions {
  /** 指定revision精确取该版；缺省取当前revision。 */
  revision?: number;
  /** 成员读取必须传冻结release；管理读取可不传（读工作区当前态）。 */
  releaseId?: string;
}

export interface AdminListFilter {
  assetKind?: AssetKind;
  usageTree?: string;
  layers?: string[];
  statuses?: CardStatus[];
  /** cursor绑定查询条件：条件不一致时返回cursorInvalid，让上层重新查询。 */
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
