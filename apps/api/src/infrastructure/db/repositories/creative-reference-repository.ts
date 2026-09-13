/**
 * R209-B1 SQLite适配（返修版）。
 * 关键不变量：新revision必入draft；published revision不可变；卡可用状态独立（retired不破旧release）；
 * 幂等保存不可变请求指纹；发布用canonical manifest+乐观锁；同实体多别名同编号。
 */
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ConflictError, CursorInvalidError, NotFoundError, ValidationError } from '../../../application/creative-reference/errors.js';
import type {
  AdminListFilter, AdminListPage, CardAvailability, CardPayload, CardRecord,
  LegacyRef, RelationRecord, RelationType, ReleaseSnapshot, RevisionRecord, RevisionStatus
} from '../../../application/creative-reference/types.js';
import { displayCodePrefix } from '../../../application/creative-reference/types.js';
import { assertAssetKindMatches, validateLegacyRef, validatePayload } from '../../../application/creative-reference/validation.js';
import type {
  CreateCardInput, CreativeReferenceRepository, LegacyMappingEntry, PublishReleaseInput, ReviewInput, UpdateCardInput
} from '../../../application/creative-reference/repository.js';

interface CardRow {
  internal_id: string; asset_kind: 'method' | 'reference'; display_code: string;
  legacy_namespace: string | null; legacy_key: string | null; legacy_version: number | null;
  current_revision: number | null; status: CardAvailability;
  idempotency_key: string | null; create_request_fingerprint: string | null;
  created_at: string; updated_at: string;
}

interface RevisionRow {
  internal_id: string; revision: number; asset_kind: 'method' | 'reference'; schema_version: number;
  payload_json: string; content_hash: string; display_code: string; short_phrase: string; summary: string;
  status: RevisionStatus; author_actor: string; review_actor: string | null; created_at: string;
}

interface AliasRow { namespace: string; alias_key: string; alias_version: number | null; source_view: string }

const SCHEMA_VERSION = 1;

function hashStable(value: unknown): string {
  // canonical化：键排序后序列化，数组保持业务顺序（清单顺序不一致视为不同清单）。
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function fingerprintCreate(input: CreateCardInput): string {
  return hashStable({ assetKind: input.assetKind, payload: input.payload, legacy: input.legacy });
}

function toCard(row: CardRow): CardRecord {
  return {
    internalId: row.internal_id, assetKind: row.asset_kind, displayCode: row.display_code,
    legacy: row.legacy_namespace === null ? null : { namespace: row.legacy_namespace, key: row.legacy_key!, ...(row.legacy_version === null ? {} : { version: row.legacy_version }) },
    currentRevision: row.current_revision, availability: row.status,
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
    if (input.legacy !== null) validateLegacyRef(input.legacy);
    const fingerprint = fingerprintCreate(input);
    // 幂等按不可变请求指纹：编辑卡不影响原create的重放判定。
    const existing = await this.findByIdempotencyKey(input.assetKind, input.idempotencyKey);
    if (existing !== null) {
      const saved = this.database.prepare('SELECT create_request_fingerprint FROM creative_reference_cards WHERE internal_id=?')
        .get(existing.internalId) as { create_request_fingerprint: string | null };
      if (saved?.create_request_fingerprint === fingerprint) return existing;
      throw new ConflictError(`幂等键已用于不同内容：${input.idempotencyKey}`);
    }
    const internalId = randomUUID();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      // 事务内重检：并发同键竞态在这里落定，避免裸唯一约束误报。
      const raced = this.database.prepare('SELECT internal_id, create_request_fingerprint FROM creative_reference_cards WHERE asset_kind=? AND idempotency_key=?')
        .get(input.assetKind, input.idempotencyKey) as { internal_id: string; create_request_fingerprint: string | null } | undefined;
      if (raced !== undefined) {
        this.database.exec('ROLLBACK');
        if (raced.create_request_fingerprint === fingerprint) return (await this.findCardByInternalId(raced.internal_id))!;
        throw new ConflictError(`幂等键已用于不同内容（并发）：${input.idempotencyKey}`);
      }
      const number = this.allocateNumber(input.assetKind);
      const displayCode = `${displayCodePrefix(input.assetKind)}${String(number).padStart(3, '0')}`;
      const revision: RevisionRecord = {
        internalId, revision: 1, assetKind: input.assetKind, schemaVersion: SCHEMA_VERSION,
        payload: input.payload, contentHash: hashStable(input.payload), displayCode,
        shortPhrase: input.payload.shortPhrase, summary: input.payload.summary,
        status: 'draft', authorActor: input.authorActor, reviewActor: null, createdAt: now
      };
      this.database.prepare(`INSERT INTO creative_reference_cards
        (internal_id, asset_kind, display_code, legacy_namespace, legacy_key, legacy_version, current_revision, status, idempotency_key, create_request_fingerprint, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(internalId, input.assetKind, displayCode,
          input.legacy?.namespace ?? null, input.legacy?.key ?? null, input.legacy?.version ?? null,
          1, 'draft', input.idempotencyKey, fingerprint, now, now);
      this.insertRevisionRow(revision);
      this.database.exec('COMMIT');
      return (await this.findCardByInternalId(internalId))!;
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* 已回滚 */ }
      throw error;
    }
  }

  private allocateNumber(kind: 'method' | 'reference'): number {
    this.database.prepare('INSERT OR IGNORE INTO creative_reference_counters(asset_kind, next_number) VALUES (?, 1)').run(kind);
    const row = this.database.prepare('SELECT next_number FROM creative_reference_counters WHERE asset_kind=?').get(kind) as { next_number: number };
    this.database.prepare('UPDATE creative_reference_counters SET next_number = next_number + 1 WHERE asset_kind=?').run(kind);
    return row.next_number;
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
    validateLegacyRef(legacy);
    const versionClause = legacy.version === undefined ? 'IS' : '=';
    const params = legacy.version === undefined ? [legacy.namespace, legacy.key] : [legacy.namespace, legacy.key, legacy.version];
    const main = this.database.prepare(`SELECT * FROM creative_reference_cards
      WHERE legacy_namespace=? AND legacy_key=? AND legacy_version ${versionClause} ?`).all(...(legacy.version === undefined ? [...params.slice(0, 2), null] : params)) as CardRow[];
    const aliasRows = this.database.prepare(`SELECT internal_id FROM creative_reference_aliases
      WHERE namespace=? AND alias_key=? AND alias_version ${versionClause} ?`).all(...(legacy.version === undefined ? [legacy.namespace, legacy.key, null] : params)) as Array<{ internal_id: string }>;
    const byId = new Map<string, CardRow>();
    for (const row of main) byId.set(row.internal_id, row);
    for (const alias of aliasRows) {
      const card = this.database.prepare('SELECT * FROM creative_reference_cards WHERE internal_id=?').get(alias.internal_id) as CardRow | undefined;
      if (card !== undefined) byId.set(card.internal_id, card);
    }
    return [...byId.values()].map(toCard);
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
    const card = await this.requireCard(input.internalId);
    if (card.availability === 'retired') throw new ConflictError('已退役条目不能修改；退役不回收编号。');
    assertAssetKindMatches(input.payload, card.assetKind);
    if (card.currentRevision === null) throw new ConflictError('条目没有可更新的版本。');
    const next = card.currentRevision + 1;
    // 新内容必进draft：即使当前已published，新revision也要重新审核。
    const revision: RevisionRecord = {
      internalId: card.internalId, revision: next, assetKind: card.assetKind, schemaVersion: SCHEMA_VERSION,
      payload: input.payload, contentHash: hashStable(input.payload), displayCode: card.displayCode,
      shortPhrase: input.payload.shortPhrase, summary: input.payload.summary,
      status: 'draft', authorActor: input.actor, reviewActor: null, createdAt: now
    };
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const guard = this.database.prepare('UPDATE creative_reference_cards SET current_revision=?, status=?, updated_at=? WHERE internal_id=? AND current_revision=?')
        .run(next, 'draft', now, card.internalId, input.expectedRevision);
      if (guard.changes !== 1) throw new ConflictError(`并发更新冲突：期望revision ${input.expectedRevision}未命中。`);
      this.insertRevisionRow(revision);
      this.database.exec('COMMIT');
      return revision;
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* 已回滚 */ }
      throw error;
    }
  }

  public async reviewRevision(input: ReviewInput, now: string): Promise<RevisionRecord> {
    const revision = await this.getRevision(input.internalId, input.expectedRevision);
    if (revision === null) throw new NotFoundError(`revision ${input.expectedRevision} 不存在。`);
    if (revision.status === 'published') throw new ConflictError('已发布revision不可变更。');
    if (revision.status === 'reviewed') throw new ConflictError('该revision已审核。');
    const guard = this.database.prepare(`UPDATE creative_reference_revisions SET status='reviewed', review_actor=?, created_at=?
      WHERE internal_id=? AND revision=? AND status='draft'`).run(input.reviewActor, now, input.internalId, input.expectedRevision);
    if (guard.changes !== 1) throw new ConflictError('审核并发冲突：revision已不是draft。');
    this.database.prepare('UPDATE creative_reference_cards SET status=?, updated_at=? WHERE internal_id=? AND current_revision=?')
      .run('reviewed', now, input.internalId, input.expectedRevision);
    return (await this.getRevision(input.internalId, input.expectedRevision))!;
  }

  /** 卡可用状态独立于revision：retired只禁新选择，不动任何revision行。 */
  public async setAvailability(internalId: string, availability: CardAvailability, now: string): Promise<CardRecord> {
    const card = await this.requireCard(internalId);
    if (card.availability === 'retired') throw new ConflictError('已退役条目不能变更可用状态。');
    this.database.prepare('UPDATE creative_reference_cards SET status=?, updated_at=? WHERE internal_id=?').run(availability, now, internalId);
    return (await this.findCardByInternalId(internalId))!;
  }

  private async requireCard(internalId: string): Promise<CardRecord> {
    const card = await this.findCardByInternalId(internalId);
    if (card === null) throw new NotFoundError('条目不存在。');
    return card;
  }

  public async listAdmin(filter: AdminListFilter): Promise<AdminListPage> {
    const fingerprint = this.filterFingerprint(filter);
    if (filter.cursor !== null && filter.cursor !== undefined && filter.cursor.filterFingerprint !== fingerprint) {
      throw new CursorInvalidError('分页cursor与当前过滤条件不匹配；请重新查询。');
    }
    // 用途/层级按目标revision的结构化字段过滤：join当前revision，JSON提取明确字段，不LIKE全文。
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.assetKind !== undefined) { conditions.push('c.asset_kind=?'); params.push(filter.assetKind); }
    if (filter.availabilities !== undefined && filter.availabilities.length > 0) {
      conditions.push(`c.status IN (${filter.availabilities.map(() => '?').join(',')})`);
      params.push(...filter.availabilities);
    }
    if (filter.layers !== undefined && filter.layers.length > 0) {
      // applicableLayers是JSON数组：json_each精确匹配元素，不匹配描述文字。
      conditions.push(`EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(r.payload_json,'$.method.applicableLayers'), json_extract(r.payload_json,'$.reference.stages'), '[]')) je WHERE je.value IN (${filter.layers.map(() => '?').join(',')}))`);
      params.push(...filter.layers);
    }
    if (filter.usageTree !== undefined) {
      conditions.push("json_extract(r.payload_json,'$.method.usageTree')=?");
      params.push(filter.usageTree);
    }
    const cursorInternalId = filter.cursor === null || filter.cursor === undefined ? null : filter.cursor.lastInternalId;
    if (cursorInternalId !== null) { conditions.push('c.internal_id > ?'); params.push(cursorInternalId); }
    const where = conditions.length === 0 ? '' : 'WHERE ' + conditions.join(' AND ');
    const limit = Math.min(Math.max(filter.limit ?? 20, 1), 100);
    const rows = this.database.prepare(`SELECT c.* FROM creative_reference_cards c
      LEFT JOIN creative_reference_revisions r ON r.internal_id=c.internal_id AND r.revision=c.current_revision
      ${where} ORDER BY c.internal_id ASC LIMIT ?`).all(...params, limit + 1) as CardRow[];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toCard);
    return { items, nextCursor: hasMore && items.length > 0 ? { lastInternalId: items[items.length - 1]!.internalId, filterFingerprint: fingerprint } : null };
  }

  private filterFingerprint(filter: AdminListFilter): string {
    return JSON.stringify({
      assetKind: filter.assetKind ?? null,
      usageTree: filter.usageTree ?? null,
      layers: [...(filter.layers ?? [])].sort(),
      availabilities: [...(filter.availabilities ?? [])].sort()
    });
  }

  public async publishRelease(input: PublishReleaseInput, now: string): Promise<ReleaseSnapshot> {
    if (input.entries.length === 0) throw new ValidationError('发布清单不能为空。');
    // 条目去重与revision冲突预检
    const seen = new Set<string>();
    for (const entry of input.entries) {
      const key = entry.internalId;
      if (seen.has(key)) throw new ValidationError(`清单条目重复：${key}。`);
      seen.add(key);
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      // 乐观锁：active指针必须匹配预期，否则并发发布冲突。
      const active = this.database.prepare('SELECT release_id FROM creative_reference_releases WHERE active=1').get() as { release_id: string } | undefined;
      const currentActiveId = active === undefined ? null : active.release_id;
      if (currentActiveId !== input.expectedActiveReleaseId) {
        throw new ConflictError(`active指针与预期不符：期望${input.expectedActiveReleaseId ?? '无active'}，实际${currentActiveId ?? '无active'}。`);
      }
      for (const entry of input.entries) {
        const rev = await this.getRevision(entry.internalId, entry.revision);
        if (rev === null) throw new NotFoundError(`清单引用不存在：${entry.internalId}@${entry.revision}`);
        // reviewed=首次发布；published=已发布内容进入新release（合法重发布）。draft不可发布。
        if (rev.status !== 'reviewed' && rev.status !== 'published') {
          throw new ValidationError(`清单包含未审核revision：${rev.displayCode}@${rev.revision}（status=${rev.status}，须先reviewed）`);
        }
      }
      // 关系两端必须都在本release内
      const entryIds = new Set(input.entries.map((e) => e.internalId));
      for (const rel of input.relations) {
        if (!entryIds.has(rel.fromId) || !entryIds.has(rel.toId)) {
          throw new ValidationError('关系两端必须都在本release清单内。');
        }
      }
      // 发布即把清单内reviewed revision打为published（审核完成→发布的证据）；已published保持不变。
      for (const entry of input.entries) {
        this.database.prepare(`UPDATE creative_reference_revisions SET status='published' WHERE internal_id=? AND revision=? AND status='reviewed'`)
          .run(entry.internalId, entry.revision);
        this.database.prepare(`UPDATE creative_reference_cards SET status='published', updated_at=? WHERE internal_id=? AND current_revision=?`)
          .run(now, entry.internalId, entry.revision);
      }
      // canonical manifest：条目按internalId排序+关系按自然键排序，消除数组顺序差异。
      const canonicalEntries = [...input.entries].sort((a, b) => (a.internalId < b.internalId ? -1 : a.internalId > b.internalId ? 1 : 0));
      const canonicalRelations = [...input.relations].sort((a, b) =>
        (a.fromId + a.fromRevision + a.toId + a.toRevision + a.relationType).localeCompare(b.fromId + String(b.fromRevision) + b.toId + String(b.toRevision) + b.relationType));
      const manifest = { entries: canonicalEntries, relations: canonicalRelations };
      const canonicalJson = JSON.stringify(manifest);
      const manifestHash = hashStable(manifest);
      const dup = this.database.prepare('SELECT release_id FROM creative_reference_releases WHERE canonical_manifest=?').get(canonicalJson) as { release_id: string } | undefined;
      if (dup !== undefined) throw new ConflictError('相同清单（canonical）已发布。');
      const releaseId = randomUUID();
      this.database.prepare('UPDATE creative_reference_releases SET active=0 WHERE active=1').run();
      for (const rel of canonicalRelations) {
        const relationId = randomUUID();
        this.database.prepare(`INSERT INTO creative_reference_relations(relation_id, from_id, from_revision, to_id, to_revision, relation_type, created_at)
          VALUES (?,?,?,?,?,?,?)`).run(relationId, rel.fromId, rel.fromRevision, rel.toId, rel.toRevision, rel.relationType, now);
        this.database.prepare(`INSERT INTO creative_reference_release_relations(release_id, relation_id) VALUES (?,?)`).run(releaseId, relationId);
      }
      this.database.prepare(`INSERT INTO creative_reference_releases(release_id, canonical_manifest, manifest_hash, manifest_json, active, created_at, published_by)
        VALUES (?,?,?,?,?,?,?)`).run(releaseId, canonicalJson, manifestHash, canonicalJson, 1, now, input.publishedBy);
      this.database.exec('COMMIT');
      return { releaseId, manifestHash, entries: canonicalEntries, relations: canonicalRelations, active: true, createdAt: now, publishedBy: input.publishedBy };
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* 已回滚 */ }
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
    const manifest = JSON.parse(row.manifest_json) as {
      entries: Array<{ internalId: string; revision: number }>;
      relations: Array<{ fromId: string; fromRevision: number; toId: string; toRevision: number; relationType: RelationType }>;
    };
    return { releaseId: row.release_id, manifestHash: row.manifest_hash, entries: manifest.entries, relations: manifest.relations, active: row.active === 1, createdAt: row.created_at, publishedBy: row.published_by };
  }

  public async getRevisionInRelease(releaseId: string, internalId: string): Promise<RevisionRecord | null> {
    const release = await this.getRelease(releaseId);
    if (release === null) return null;
    const entry = release.entries.find((item) => item.internalId === internalId);
    if (entry === undefined) return null;
    const revision = await this.getRevision(internalId, entry.revision);
    // 冻结资格只看发布时状态快照：清单内revision即使后续卡被retired，其发布身份保留（发布时不可能是非published以外状态后又被改，因为published不可变）。
    return revision;
  }

  public async listRelationsInRelease(releaseId: string): Promise<RelationRecord[]> {
    const rows = this.database.prepare(`SELECT r.* FROM creative_reference_relations r
      JOIN creative_reference_release_relations rr ON rr.relation_id=r.relation_id
      WHERE rr.release_id=?`).all(releaseId) as Array<{ relation_id: string; from_id: string; from_revision: number; to_id: string; to_revision: number; relation_type: RelationRecord['relationType']; created_at: string }>;
    return rows.map((row) => ({ relationId: row.relation_id, fromId: row.from_id, fromRevision: row.from_revision, toId: row.to_id, toRevision: row.to_revision, relationType: row.relation_type, createdAt: row.created_at }));
  }

  public async listRelations(cardId: string): Promise<RelationRecord[]> {
    const rows = this.database.prepare('SELECT * FROM creative_reference_relations WHERE from_id=? OR to_id=? ORDER BY created_at').all(cardId, cardId) as Array<{ relation_id: string; from_id: string; from_revision: number; to_id: string; to_revision: number; relation_type: RelationRecord['relationType']; created_at: string }>;
    return rows.map((row) => ({ relationId: row.relation_id, fromId: row.from_id, fromRevision: row.from_revision, toId: row.to_id, toRevision: row.to_revision, relationType: row.relation_type, createdAt: row.created_at }));
  }

  public async attachAlias(internalId: string, legacy: LegacyRef, sourceView: string, now: string): Promise<void> {
    await this.requireCard(internalId);
    validateLegacyRef(legacy);
    this.database.prepare(`INSERT INTO creative_reference_aliases(alias_id, internal_id, namespace, alias_key, alias_version, source_view, created_at)
      VALUES (?,?,?,?,?,?,?)`).run(randomUUID(), internalId, legacy.namespace, legacy.key, legacy.version ?? null, sourceView, now);
  }

  public async listAliases(internalId: string): Promise<Array<{ legacy: LegacyRef; sourceView: string }>> {
    const rows = this.database.prepare('SELECT namespace, alias_key, alias_version, source_view FROM creative_reference_aliases WHERE internal_id=?').all(internalId) as AliasRow[];
    return rows.map((row) => ({ legacy: { namespace: row.namespace, key: row.alias_key, ...(row.alias_version === null ? {} : { version: row.alias_version }) }, sourceView: row.source_view }));
  }

  public async importLegacyMapping(entries: ReadonlyArray<LegacyMappingEntry>, idempotencyPrefix: string, actor: string, now: string): Promise<CardRecord[]> {
    const result: CardRecord[] = [];
    for (const entry of entries) {
      const idempotencyKey = `${idempotencyPrefix}:${entry.sourceView}:${entry.legacy.namespace}:${entry.legacy.key}`;
      if (entry.canonicalInternalId !== undefined) {
        // 显式canonical：别名挂到既有目标卡，不建新卡不占新号。
        await this.requireCard(entry.canonicalInternalId);
        const alreadyRun = await this.findByIdempotencyKey(entry.payload.assetKind, idempotencyKey);
        if (alreadyRun === null) {
          // 记录幂等标记但不落卡：写入一个仅作重放判定的"空记录"不可行（cards表即实体），
          // 改为以alias表存在性判定重放：alias已挂即幂等成功。
          const existingAlias = this.database.prepare('SELECT 1 FROM creative_reference_aliases WHERE namespace=? AND alias_key=? AND alias_version IS ?')
            .get(entry.legacy.namespace, entry.legacy.key, entry.legacy.version ?? null);
          if (existingAlias === undefined) {
            await this.attachAlias(entry.canonicalInternalId, entry.legacy, entry.sourceView, now);
          }
        }
        result.push((await this.findCardByInternalId(entry.canonicalInternalId))!);
        continue;
      }
      const card = await this.createCard(
        { assetKind: entry.payload.assetKind, payload: entry.payload, legacy: null, idempotencyKey, authorActor: actor },
        now
      );
      const existingAlias = this.database.prepare('SELECT 1 FROM creative_reference_aliases WHERE namespace=? AND alias_key=? AND alias_version IS ?')
        .get(entry.legacy.namespace, entry.legacy.key, entry.legacy.version ?? null);
      if (existingAlias === undefined) {
        await this.attachAlias(card.internalId, entry.legacy, entry.sourceView, now);
      }
      result.push(card);
    }
    return result;
  }
}
