/** R209-B1 Repository接口：SQLite适配实现此接口；应用层只依赖本接口。 */
import type {
  AdminListFilter, AdminListPage, CardAvailability, CardPayload, CardRecord, LegacyRef,
  RelationRecord, RelationType, ReleaseSnapshot, RevisionRecord, RevisionStatus
} from './types.js';

export interface CreateCardInput {
  assetKind: 'method' | 'reference';
  payload: CardPayload;
  legacy: LegacyRef | null;
  idempotencyKey: string;
  authorActor: string;
}

export interface UpdateCardInput {
  internalId: string;
  expectedRevision: number;
  payload: CardPayload;
  actor: string;
}

export interface ReviewInput {
  internalId: string;
  expectedRevision: number;
  reviewActor: string;
}

export interface PublishReleaseInput {
  entries: ReadonlyArray<{ internalId: string; revision: number }>;
  relations: ReadonlyArray<{ fromId: string; fromRevision: number; toId: string; toRevision: number; relationType: RelationType }>;
  publishedBy: string;
  /** 乐观锁：期望当前active releaseId（无active时传null）；不一致拒绝发布。 */
  expectedActiveReleaseId: string | null;
}

export interface LegacyMappingEntry {
  /** canonical目标：确认同实体后所有别名挂到这一张卡。 */
  canonicalInternalId?: string;
  legacy: LegacyRef;
  payload: CardPayload;
  sourceView: string;
}

/** 冻结release分页游标：releaseId绑定+可选过滤指纹+位置。 */
export interface ReleaseEntriesCursor {
  releaseId: string;
  lastInternalId: string;
  filterFingerprint: string | null;
}

export interface ReleaseEntriesPage {
  items: ReadonlyArray<{ internalId: string; revision: number }>;
  nextCursor: ReleaseEntriesCursor | null;
}

export interface CreativeReferenceRepository {
  createCard(input: CreateCardInput, now: string): Promise<CardRecord>;
  findByIdempotencyKey(kind: 'method' | 'reference', key: string): Promise<CardRecord | null>;
  findCardByInternalId(internalId: string): Promise<CardRecord | null>;
  /** legacy查询：主legacy列+alias表联合；歧义候选由调用层判定。 */
  findCardsByLegacy(legacy: LegacyRef): Promise<CardRecord[]>;
  findCardsByDisplayCode(code: string): Promise<CardRecord[]>;
  getRevision(internalId: string, revision: number): Promise<RevisionRecord | null>;
  getCurrentRevision(internalId: string): Promise<RevisionRecord | null>;
  /** 新内容必进draft：expectedRevision CAS+新revision状态draft。 */
  updateCard(input: UpdateCardInput, now: string): Promise<RevisionRecord>;
  /** draft→reviewed：需reviewActor；published不可改。 */
  reviewRevision(input: ReviewInput, now: string): Promise<RevisionRecord>;
  /** 卡可用状态（含retired）；不改任何revision内容状态。 */
  setAvailability(internalId: string, availability: CardAvailability, now: string): Promise<CardRecord>;
  listAdmin(filter: AdminListFilter): Promise<AdminListPage>;
  publishRelease(input: PublishReleaseInput, now: string): Promise<ReleaseSnapshot>;
  getActiveRelease(): Promise<ReleaseSnapshot | null>;
  getRelease(releaseId: string): Promise<ReleaseSnapshot | null>;
  getRevisionInRelease(releaseId: string, internalId: string): Promise<RevisionRecord | null>;
  /** release内冻结图谱。 */
  listRelationsInRelease(releaseId: string): Promise<RelationRecord[]>;
  /** 冻结release分页：manifest条目序，游标带releaseId，失配拒绝，末页nextCursor=null。 */
  listReleaseEntries(releaseId: string, cursor: ReleaseEntriesCursor | null, limit: number): Promise<ReleaseEntriesPage>;
  listRelations(cardId: string): Promise<RelationRecord[]>;
  /** 同实体多别名挂同一canonical卡；确认同实体一个编号。 */
  attachAlias(internalId: string, legacy: LegacyRef, sourceView: string, now: string): Promise<void>;
  listAliases(internalId: string): Promise<Array<{ legacy: LegacyRef; sourceView: string }>>;
  importLegacyMapping(entries: ReadonlyArray<LegacyMappingEntry>, idempotencyPrefix: string, actor: string, now: string): Promise<CardRecord[]>;
}
