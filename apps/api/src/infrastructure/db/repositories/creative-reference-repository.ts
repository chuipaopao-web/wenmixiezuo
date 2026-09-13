/**
 * R209-B1 SQLite适配：实现CreativeReferenceRepository。
 * 编号分配与卡创建在BEGIN IMMEDIATE事务中；唯一性由数据库约束保证。
 */
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  ConflictError, CursorInvalidError, NotFoundError, ValidationError
} from '../../../application/creative-reference/errors.js';
import type {
  AdminListFilter, AdminListPage, CardPayload, CardRecord, CardStatus,
  LegacyRef, RelationRecord, ReleaseSnapshot, RevisionRecord
} from '../../../application/creative-reference/types.js';
import { displayCodePrefix } from '../../../application/creative-reference/types.js';
import { validatePayload } from '../../../application/creative-reference/validation.js';
import type {
  CreateCardInput, CreativeReferenceRepository, LegacyMappingEntry, PublishReleaseInput, UpdateCardInput
} from '../../../application/creative-reference/repository.js';

interface CardRow {
  internal_id: string; asset_kind: 'method' | 'reference'; display_code: string;
  legacy_namespace: string | null; legacy_key: string | null; legacy_version: number | null;
  current_revision: number | null; status: CardStatus;
  idempotency_key: string | null; created_at: string; updated_at: string;
}

interface RevisionRow {
  internal_id: string; revision: number; asset_kind: 'method' | 'reference'; schema_version: number;
  payload_json: string; content_hash: string; display_code: string; short_phrase: string; summary: string;
  status: CardStatus; author_actor: string; review_actor: string | null; created_at: string;
}

const SCHEMA_VERSION = 1;

function hashPayload(payload: CardPayload): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function toCard(row: CardRow): CardRecord {
  return {
    internalId: row.internal_id, assetKind: row.asset_kind, displayCode: row.display_code,
    legacy: row.legacy_namespace === null ? null : { namespace: row.legacy_namespace, key: row.legacy_key!, ...(row.legacy_version === null ? {} : { version: row.legacy_version }) },
    currentRevision: row.current_revision, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function toRevision(row: RevisionRow): RevisionRecord {
  return {
    internalId: row.internal_id, revision: row.revision, assetKind: row.asset_kind,
    schemaVersion: row.schema_version, payload: JSON.parse(row.payload_json) as CardPayload,
    contentHash: row.content_hash, displayCode: row.display_code,
    shortPhrase: row.short_phrase, summary: row.summary, status: row.status,
    authorActor: row.author_actor, reviewActor: row.review_actor, createdAt: row.created_at
  };
}

export class SqliteCreativeReferenceRepository implements CreativeReferenceRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public async createCard(input: CreateCardInput, now: string): Promise<CardRecord> {
    validatePayload(input.payload);
    const existing = await this.findByIdempotencyKey(input.assetKind, input.idempotencyKey);
    if (existing !== null) {
      const current = existing.currentRevision === null ? null : await this.getRevision(existing.internalId, existing.currentRevision);
      if (current !== null && current.contentHash === hashPayload(input.payload)) return existing;
      throw new ConflictError(`幂等键已用于不同内容：${input.idempotencyKey}`);
    }
    const internalId = randomUUID();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const number = this.allocateNumber(input.assetKind);
      const displayCode = `${displayCodePrefix(input.assetKind)}${String(number).padStart(3, '0')}`;
      const revision: RevisionRecord = {
        internalId, revision: 1, assetKind: input.assetKind, schemaVersion: SCHEMA_VERSION,
        payload: input.payload, contentHash: hashPayload(input.payload), displayCode,
        shortPhrase: input.payload.shortPhrase, summary: input.payload.summary,
        status: 'draft', authorActor: input.authorActor, reviewActor: null, createdAt: now
      };
      this.insertCardRow(internalId, input, displayCode, now);
      this.insertRevisionRow(revision);
      this.database.exec('COMMIT');
      return (await this.findCardByInternalId(internalId))!;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /** 事务内分配递增编号；计数器行先插后更，UNIQUE约束兜底重号。 */
  private allocateNumber(kind: 'method' | 'reference'): number {
    this.database.prepare('INSERT OR IGNORE INTO creative_reference_counters(asset_kind, next_number) VALUES (?, 1)').run(kind);
    const row = this.database.prepare('SELECT next_number FROM creative_reference_counters WHERE asset_kind=?').get(kind) as { next_number: number };
    this.database.prepare('UPDATE creative_reference_counters SET next_number = next_number + 1 WHERE asset_kind=?').run(kind);
    return row.next_number;
  }

  private insertCardRow(internalId: string, input: CreateCardInput, displayCode: string, now: string): void {
    this.database.prepare(`INSERT INTO creative_reference_cards
      (internal_id, asset_kind, display_code, legacy_namespace, legacy_key, legacy_version, current_revision, status, idempotency_key, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(internalId, input.assetKind, displayCode,
        input.legacy?.namespace ?? null, input.legacy?.key ?? null, input.legacy?.version ?? null,
        1, 'draft', input.idempotencyKey, now, now);
  }

  private insertRevisionRow(revision: RevisionRecord): void {
    this.database.prepare(`INSERT INTO creative_reference_revisions
      (internal_id, revision, asset_kind, schema_version, payload_json, content_hash, display_code, short_phrase, summary, status, author_actor, review_actor, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(revision.internalId, revision.revision, revision.assetKind, revision.schemaVersion,
        JSON.stringify(revision.payload), revision.contentHash, revision.displayCode,
        revision.shortPhrase, revision.summary, revision.status, revision.authorActor, revision.reviewActor, revision.createdAt);
  }

  public async findByIdempotencyKey(kind: 'method' | 'reference', key: string): Promise<CardRecord | null> {
    const row = this.database.prepare('SELECT * FROM creative_reference_cards WHERE asset_kind=? AND idempotency_key=?').get(kind, key) as CardRow | undefined;
    return row === undefined ? null : toCard(row);
  }

  public async findCardByInternalId(internalId: string): Promise<CardRecord | null> {
    const row = this.database.prepare('SELECT * FROM creative_reference_cards WHERE internal_id=?').get(internalId) as CardRow | undefined;
    return row === undefined ? null : toCard(row);
  }

  public async findCardsByLegacy(legacy: LegacyRef): Promise<CardRecord[]> {
    const rows = this.database.prepare(`SELECT * FROM creative_reference_cards
      WHERE legacy_namespace=? AND legacy_key=? ${legacy.version === undefined ? '' : 'AND legacy_version=?'}`).all(...(legacy.version === undefined ? [legacy.namespace, legacy.key] : [legacy.namespace, legacy.key, legacy.version])) as CardRow[];
    return rows.map(toCard);
  }

  public async findCardsByDisplayCode(code: string): Promise<CardRecord[]> {
    const rows = this.database.prepare('SELECT * FROM creative_reference_cards WHERE display_code=?').all(code) as CardRow[];
    return rows.map(toCard);
  }

  public async getRevision(internalId: string, revision: number): Promise<RevisionRecord | null> {
    const row = this.database.prepare('SELECT * FROM creative_reference_revisions WHERE internal_id=? AND revision=?').get(internalId, revision) as RevisionRow | undefined;
    return row === undefined ? null : toRevision(row);
  }

  public async getCurrentRevision(internalId: string): Promise<RevisionRecord | null> {
    const card = await this.findCardByInternalId(internalId);
    if (card === null || card.currentRevision === null) return null;
    return this.getRevision(internalId, card.currentRevision);
  }

  public async updateCard(input: UpdateCardInput, now: string): Promise<RevisionRecord> {
    validatePayload(input.payload);
    const card = await this.findCardByInternalId(input.internalId);
    if (card === null) throw new NotFoundError('条目不存在。');
    if (card.status === 'retired') throw new ConflictError('已退役条目不能修改；退役不回收编号。');
    if (card.currentRevision === null) throw new ConflictError('条目没有可更新的版本。');
    if (card.currentRevision !== input.expectedRevision) {
      throw new ConflictError(`版本冲突：期望${input.expectedRevision}，当前${card.currentRevision}。请重新读取。`);
    }
    const next = card.currentRevision + 1;
    const revision: RevisionRecord = {
      internalId: card.internalId, revision: next, assetKind: card.assetKind, schemaVersion: SCHEMA_VERSION,
      payload: input.payload, contentHash: hashPayload(input.payload), displayCode: card.displayCode,
      shortPhrase: input.payload.shortPhrase, summary: input.payload.summary,
      status: card.status, authorActor: input.actor, reviewActor: null, createdAt: now
    };
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const guard = this.database.prepare('UPDATE creative_reference_cards SET current_revision=?, updated_at=? WHERE internal_id=? AND current_revision=?')
        .run(next, now, card.internalId, input.expectedRevision);
      if (guard.changes !== 1) throw new ConflictError('并发更新冲突：条件更新未命中。');
      this.insertRevisionRow(revision);
      this.database.exec('COMMIT');
      return revision;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public async setStatus(internalId: string, status: CardStatus, actor: string, now: string): Promise<CardRecord> {
    const card = await this.findCardByInternalId(internalId);
    if (card === null) throw new NotFoundError('条目不存在。');
    if (card.status === 'retired') throw new ConflictError('已退役条目不能变更状态。');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('UPDATE creative_reference_cards SET status=?, updated_at=? WHERE internal_id=?').run(status, now, internalId);
      // 状态是元数据不是内容：只更新当前revision行的status，不产生新revision（内容不可变）。
      if (card.currentRevision !== null) {
        this.database.prepare('UPDATE creative_reference_revisions SET status=? WHERE internal_id=? AND revision=?')
          .run(status, internalId, card.currentRevision);
      }
      this.database.exec('COMMIT');
      return (await this.findCardByInternalId(internalId))!;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public async listAdmin(filter: AdminListFilter): Promise<AdminListPage> {
    const fingerprint = this.filterFingerprint(filter);
    if (filter.cursor !== null && filter.cursor !== undefined && filter.cursor.filterFingerprint !== fingerprint) {
      throw new CursorInvalidError('分页cursor与当前过滤条件不匹配；请重新查询。');
    }
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.assetKind !== undefined) { conditions.push('asset_kind=?'); params.push(filter.assetKind); }
    if (filter.statuses !== undefined && filter.statuses.length > 0) {
      conditions.push(`status IN (${filter.statuses.map(() => '?').join(',')})`);
      params.push(...filter.statuses);
    }
    if (filter.layers !== undefined && filter.layers.length > 0) {
      // 层级多选只是适用信息：LIKE匹配payload中的层级字段，不复制实体。
      const layerLike = filter.layers.map(() => 'payload_json LIKE ?').join(' OR ');
      conditions.push(`(${layerLike})`);
      params.push(...filter.layers.map(layer => `%"${layer}"%`));
    }
    if (filter.usageTree !== undefined) { conditions.push('payload_json LIKE ?'); params.push(`%"usageTree":"${filter.usageTree}"%`); }
    const where = conditions.length === 0 ? '' : 'WHERE ' + conditions.join(' AND ');
    const cursorInternalId = filter.cursor === null || filter.cursor === undefined ? null : filter.cursor.lastInternalId;
    if (cursorInternalId !== null) { conditions.push('internal_id > ?'); params.push(cursorInternalId); }
    const where2 = conditions.length === 0 ? '' : 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(filter.limit ?? 20, 1), 100);
    const rows = this.database.prepare(`SELECT * FROM creative_reference_cards ${where2} ORDER BY internal_id ASC LIMIT ?`).all(...params, limit + 1) as CardRow[];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toCard);
    return { items, nextCursor: hasMore && items.length > 0 ? { lastInternalId: items[items.length - 1]!.internalId, filterFingerprint: fingerprint } : null };
  }

  private filterFingerprint(filter: AdminListFilter): string {
    return JSON.stringify({
      assetKind: filter.assetKind ?? null,
      usageTree: filter.usageTree ?? null,
      layers: [...(filter.layers ?? [])].sort(),
      statuses: [...(filter.statuses ?? [])].sort()
    });
  }

  public async publishRelease(input: PublishReleaseInput, now: string): Promise<ReleaseSnapshot> {
    if (input.entries.length === 0) throw new ValidationError('发布清单不能为空。');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const entry of input.entries) {
        const rev = await this.getRevision(entry.internalId, entry.revision);
        if (rev === null) throw new NotFoundError(`发布清单引用不存在：${entry.internalId}@${entry.revision}`);
        if (rev.status !== 'published') throw new ValidationError(`发布清单包含未发布revision：${rev.displayCode}@${rev.revision}（status=${rev.status}）`);
      }
      for (const rel of input.relations) {
        const from = await this.getRevision(rel.fromId, rel.fromRevision);
        const to = await this.getRevision(rel.toId, rel.toRevision);
        if (from === null || to === null) throw new NotFoundError('关系引用不存在的revision。');
      }
      const releaseId = randomUUID();
      const manifest = { entries: input.entries, relations: input.relations };
      const manifestJson = JSON.stringify(manifest);
      const manifestHash = createHash('sha256').update(manifestJson).digest('hex');
      const dup = this.database.prepare('SELECT release_id FROM creative_reference_releases WHERE manifest_hash=?').get(manifestHash) as { release_id: string } | undefined;
      if (dup !== undefined) throw new ConflictError('相同清单已发布。');
      this.database.prepare('UPDATE creative_reference_releases SET active=0 WHERE active=1').run();
      for (const rel of input.relations) {
        this.database.prepare(`INSERT INTO creative_reference_relations(relation_id, from_id, from_revision, to_id, to_revision, relation_type, created_at)
          VALUES (?,?,?,?,?,?,?)`)
          .run(randomUUID(), rel.fromId, rel.fromRevision, rel.toId, rel.toRevision, rel.relationType, now);
      }
      this.database.prepare(`INSERT INTO creative_reference_releases(release_id, manifest_hash, manifest_json, active, created_at, published_by)
        VALUES (?,?,?,?,?,?)`).run(releaseId, manifestHash, manifestJson, 1, now, input.publishedBy);
      this.database.exec('COMMIT');
      return { releaseId, manifestHash, entries: input.entries, active: true, createdAt: now, publishedBy: input.publishedBy };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public async getActiveRelease(): Promise<ReleaseSnapshot | null> {
    return this.releaseByWhere('SELECT * FROM creative_reference_releases WHERE active=1');
  }

  public async getRelease(releaseId: string): Promise<ReleaseSnapshot | null> {
    return this.releaseByWhere('SELECT * FROM creative_reference_releases WHERE release_id=?', releaseId);
  }

  private async releaseByWhere(sql: string, ...params: unknown[]): Promise<ReleaseSnapshot | null> {
    const row = this.database.prepare(sql).get(...params) as { release_id: string; manifest_hash: string; manifest_json: string; active: 0 | 1; created_at: string; published_by: string } | undefined;
    if (row === undefined) return null;
    const manifest = JSON.parse(row.manifest_json) as { entries: Array<{ internalId: string; revision: number }> };
    return { releaseId: row.release_id, manifestHash: row.manifest_hash, entries: manifest.entries, active: row.active === 1, createdAt: row.created_at, publishedBy: row.published_by };
  }

  public async getRevisionInRelease(releaseId: string, internalId: string): Promise<RevisionRecord | null> {
    const release = await this.getRelease(releaseId);
    if (release === null) return null;
    const entry = release.entries.find((item) => item.internalId === internalId);
    if (entry === undefined) return null;
    return this.getRevision(internalId, entry.revision);
  }

  public async listRelations(cardId: string): Promise<RelationRecord[]> {
    const rows = this.database.prepare('SELECT * FROM creative_reference_relations WHERE from_id=? OR to_id=?').all(cardId, cardId) as Array<{ relation_id: string; from_id: string; from_revision: number; to_id: string; to_revision: number; relation_type: RelationRecord['relationType']; created_at: string }>;
    return rows.map((row) => ({ relationId: row.relation_id, fromId: row.from_id, fromRevision: row.from_revision, toId: row.to_id, toRevision: row.to_revision, relationType: row.relation_type, createdAt: row.created_at }));
  }

  public async importLegacyMapping(entries: ReadonlyArray<LegacyMappingEntry>, idempotencyPrefix: string, actor: string, now: string): Promise<CardRecord[]> {
    const created: CardRecord[] = [];
    for (const entry of entries) {
      const card = await this.createCard(
        { assetKind: entry.payload.assetKind, payload: entry.payload, legacy: entry.legacy,
          idempotencyKey: `${idempotencyPrefix}:${entry.sourceView}:${entry.legacy.namespace}:${entry.legacy.key}`,
          authorActor: actor },
        now
      );
      created.push(card);
    }
    return created;
  }
}
