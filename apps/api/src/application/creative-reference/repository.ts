/** R209-B1 Repository接口（R209-B2二次返修：同步签名）：SQLite适配实现此接口；应用层只依赖本接口。
 * 全部方法同步完成（node:sqlite单连接同步语句），这是事务工作单元可证明正确的前提：
 * 事务内不存在await边界，独立请求不可能互相并入未提交事务。调用方对返回值await仍合法。 */
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
  createCard(input: CreateCardInput, now: string): CardRecord;
  findByIdempotencyKey(kind: 'method' | 'reference', key: string): CardRecord | null;
  findCardByInternalId(internalId: string): CardRecord | null;
  /** legacy查询：主legacy列+alias表联合；歧义候选由调用层判定。 */
  findCardsByLegacy(legacy: LegacyRef): CardRecord[];
  findCardsByDisplayCode(code: string): CardRecord[];
  getRevision(internalId: string, revision: number): RevisionRecord | null;
  getCurrentRevision(internalId: string): RevisionRecord | null;
  /** 新内容必进draft：expectedRevision CAS+新revision状态draft。 */
  updateCard(input: UpdateCardInput, now: string): RevisionRecord;
  /** draft→reviewed：需reviewActor；published不可改。 */
  reviewRevision(input: ReviewInput, now: string): RevisionRecord;
  /** 卡可用状态（含retired）；不改任何revision内容状态。 */
  setAvailability(internalId: string, availability: CardAvailability, now: string): CardRecord;
  listAdmin(filter: AdminListFilter): AdminListPage;
  publishRelease(input: PublishReleaseInput, now: string): ReleaseSnapshot;
  getActiveRelease(): ReleaseSnapshot | null;
  getRelease(releaseId: string): ReleaseSnapshot | null;
  getRevisionInRelease(releaseId: string, internalId: string): RevisionRecord | null;
  /** release内冻结图谱。 */
  listRelationsInRelease(releaseId: string): RelationRecord[];
  /** 冻结release分页：manifest条目序，游标带releaseId，失配拒绝，末页nextCursor=null。 */
  listReleaseEntries(releaseId: string, cursor: ReleaseEntriesCursor | null, limit: number): ReleaseEntriesPage;
  listRelations(cardId: string): RelationRecord[];
  /** 同实体多别名挂同一canonical卡；确认同实体一个编号。 */
  attachAlias(internalId: string, legacy: LegacyRef, sourceView: string, now: string): void;
  listAliases(internalId: string): Array<{ legacy: LegacyRef; sourceView: string }>;
  importLegacyMapping(entries: ReadonlyArray<LegacyMappingEntry>, idempotencyPrefix: string, actor: string, now: string): CardRecord[];
}

/**
 * 同步事务工作单元（R209-B2二次返修）：operation必须同步完成且不得返回Promise；
 * BEGIN失败在置位前抛出（不污染状态），成功后任意一步失败整体ROLLBACK。
 * 同一同步调用栈内嵌套调用并入外层事务；由于不存在await边界，独立请求不可能共享未提交事务。
 */
export interface CreativeReferenceTransactionUnit {
  runInTransaction<T>(operation: () => T): T;
}
