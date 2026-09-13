/** R209-B1 Repository接口：SQLite适配实现此接口；应用层只依赖本接口。 */
import type {
  AdminListFilter, AdminListPage, CardPayload, CardRecord, CardStatus, LegacyRef,
  RelationRecord, RelationType, ReleaseSnapshot, RevisionRecord
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

export interface PublishReleaseInput {
  /** 冻结清单：internalId+revision。 */
  entries: ReadonlyArray<{ internalId: string; revision: number }>;
  relations: ReadonlyArray<{ fromId: string; fromRevision: number; toId: string; toRevision: number; relationType: RelationType }>;
  publishedBy: string;
}

export interface LegacyMappingEntry {
  legacy: LegacyRef;
  payload: CardPayload;
  /** 明确映射来源视图（如audited-v4/complete-v3）；不同含义不因同名合并。 */
  sourceView: string;
}

export interface CreativeReferenceRepository {
  createCard(input: CreateCardInput, now: string): Promise<CardRecord>;
  /** 幂等重放：同幂等键返回既有卡（内容一致时）。 */
  findByIdempotencyKey(kind: 'method' | 'reference', key: string): Promise<CardRecord | null>;
  findCardByInternalId(internalId: string): Promise<CardRecord | null>;
  findCardsByLegacy(legacy: LegacyRef): Promise<CardRecord[]>;
  findCardsByDisplayCode(code: string): Promise<CardRecord[]>;
  getRevision(internalId: string, revision: number): Promise<RevisionRecord | null>;
  getCurrentRevision(internalId: string): Promise<RevisionRecord | null>;
  updateCard(input: UpdateCardInput, now: string): Promise<RevisionRecord>;
  setStatus(internalId: string, status: CardStatus, actor: string, now: string): Promise<CardRecord>;
  listAdmin(filter: AdminListFilter): Promise<AdminListPage>;
  publishRelease(input: PublishReleaseInput, now: string): Promise<ReleaseSnapshot>;
  getActiveRelease(): Promise<ReleaseSnapshot | null>;
  getRelease(releaseId: string): Promise<ReleaseSnapshot | null>;
  /** release内精确读取成员可见的已发布revision。 */
  getRevisionInRelease(releaseId: string, internalId: string): Promise<RevisionRecord | null>;
  listRelations(cardId: string): Promise<RelationRecord[]>;
  /** legacy明确映射导入：仅导入给定映射，不自动合并全库。 */
  importLegacyMapping(entries: ReadonlyArray<LegacyMappingEntry>, idempotencyPrefix: string, actor: string, now: string): Promise<CardRecord[]>;
}
