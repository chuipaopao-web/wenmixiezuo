/** R209-B2 管理端仓储增量：列表摘要投影、版本历史、审核意见、发布请求幂等与审计。 */
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { ConflictError, CursorInvalidError, NotFoundError, ValidationError } from '../../../application/creative-reference/errors.js';
import type { CardAvailability, AssetKind, RevisionStatus } from '../../../application/creative-reference/types.js';
import { usageTreeTerms } from '../../../application/creative-reference/usage-tree.js';

export interface AdminCardListFilter {
  assetKind?: AssetKind;
  keyword?: string;
  usageTree?: string;
  layers?: string[];
  availabilities?: CardAvailability[];
  genre?: string;
  mechanism?: string;
  experience?: string;
  cursor?: { fingerprint: string; lastInternalId: string } | null;
  limit: number;
}

export interface AdminCardSummary {
  internalId: string;
  assetKind: AssetKind;
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
  revisionStatus: RevisionStatus | null;
  availability: CardAvailability;
  updatedAt: string;
}

export interface AdminCardListPage {
  items: AdminCardSummary[];
  nextCursor: { fingerprint: string; lastInternalId: string } | null;
}

export interface RevisionSummary {
  revision: number;
  status: RevisionStatus;
  shortPhrase: string;
  summary: string;
  authorActor: string;
  reviewActor: string | null;
  reviewOpinion: string | null;
  createdAt: string;
}

export interface AuditActionInput {
  action: 'create' | 'revise' | 'review' | 'retire' | 'restore' | 'publish';
  targetId: string | null;
  targetRevision: number | null;
  actorId: string;
  opinion?: string | null;
  resultRef?: string | null;
  idempotencyKey?: string | null;
  requestDigest?: string | null;
}

export class CreativeReferenceAdminRepository {
  public constructor(private readonly database: DatabaseSync) {}

  /** 摘要列表：绑定当前revision的JSON结构化字段过滤+关键词词法匹配；游标含指纹。 */
  public listSummaries(filter: AdminCardListFilter): AdminCardListPage {
    const fingerprint = this.fingerprint(filter);
    if (filter.cursor !== null && filter.cursor !== undefined && filter.cursor.fingerprint !== fingerprint) {
      throw new CursorInvalidError('游标与当前筛选条件不匹配；请重置筛选后重新查询。');
    }
    if (!Number.isSafeInteger(filter.limit) || filter.limit < 1 || filter.limit > 100) {
      throw new ValidationError('页大小必须在1至100之间。');
    }
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.assetKind !== undefined) { conditions.push('c.asset_kind=?'); params.push(filter.assetKind); }
    if (filter.availabilities !== undefined && filter.availabilities.length > 0) {
      conditions.push(`c.status IN (${filter.availabilities.map(() => '?').join(',')})`);
      params.push(...filter.availabilities);
    }
    if (filter.layers !== undefined && filter.layers.length > 0) {
      conditions.push(`EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(r.payload_json,'$.method.applicableLayers'), json_extract(r.payload_json,'$.reference.stages'), '[]')) je WHERE je.value IN (${filter.layers.map(() => '?').join(',')}))`);
      params.push(...filter.layers);
    }
    if (filter.usageTree !== undefined) {
      // 用途父子匹配（18.3）：method按usageTree、reference按facets.purposes，命中主类或其子类。
      const terms = usageTreeTerms(filter.usageTree);
      const placeholders = terms.map(() => '?').join(',');
      conditions.push(`((c.asset_kind='method' AND json_extract(r.payload_json,'$.method.usageTree') IN (${placeholders}))
        OR (c.asset_kind='reference' AND EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(r.payload_json,'$.reference.facets.purposes'),'[]')) pe WHERE pe.value IN (${placeholders}))))`);
      params.push(...terms, ...terms);
    }
    if (filter.keyword !== undefined && filter.keyword.trim().length > 0) {
      // 词法匹配：displayCode精确或名称/短语/摘要/别名LIKE，不做语义排序。
      const kw = `%${filter.keyword.trim()}%`;
      conditions.push(`(c.display_code=? OR json_extract(r.payload_json,'$.name') LIKE ? OR r.short_phrase LIKE ? OR r.summary LIKE ?
        OR EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(r.payload_json,'$.method.aliases'), json_extract(r.payload_json,'$.aliases'), '[]')) ka WHERE ka.value LIKE ?))`);
      params.push(filter.keyword.trim(), kw, kw, kw, kw);
    }
    if (filter.genre !== undefined && filter.genre.trim().length > 0) {
      conditions.push(`EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(r.payload_json,'$.reference.facets.genres'), '[]')) ge WHERE ge.value=? OR ge.value LIKE ?)`);
      params.push(filter.genre.trim(), `%${filter.genre.trim()}%`);
    }
    if (filter.mechanism !== undefined && filter.mechanism.trim().length > 0) {
      conditions.push(`EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(r.payload_json,'$.reference.facets.mechanisms'), '[]')) me WHERE me.value=? OR me.value LIKE ?)`);
      params.push(filter.mechanism.trim(), `%${filter.mechanism.trim()}%`);
    }
    if (filter.experience !== undefined && filter.experience.trim().length > 0) {
      conditions.push(`EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(r.payload_json,'$.reference.facets.experiences'), '[]')) ee WHERE ee.value=? OR ee.value LIKE ?)`);
      params.push(filter.experience.trim(), `%${filter.experience.trim()}%`);
    }
    if (filter.cursor !== null && filter.cursor !== undefined) { conditions.push('c.internal_id > ?'); params.push(filter.cursor.lastInternalId); }
    const where = conditions.length === 0 ? '' : 'WHERE ' + conditions.join(' AND ');
    const rows = this.database.prepare(`SELECT c.*, r.payload_json, r.status AS rev_status
      FROM creative_reference_cards c
      LEFT JOIN creative_reference_revisions r ON r.internal_id=c.internal_id AND r.revision=c.current_revision
      ${where} ORDER BY c.internal_id ASC LIMIT ?`).all(...params, filter.limit + 1) as Array<{
      internal_id: string; asset_kind: AssetKind; display_code: string; status: CardAvailability;
      current_revision: number | null; updated_at: string; payload_json: string | null; rev_status: RevisionStatus | null;
    }>;
    const hasMore = rows.length > filter.limit;
    const items = rows.slice(0, filter.limit).map((row) => this.toSummary(row));
    return { items, nextCursor: hasMore && items.length > 0 ? { fingerprint, lastInternalId: items[items.length - 1]!.internalId } : null };
  }

  private toSummary(row: { internal_id: string; asset_kind: AssetKind; display_code: string; status: CardAvailability; current_revision: number | null; updated_at: string; payload_json: string | null; rev_status: RevisionStatus | null }): AdminCardSummary {
    const payload = row.payload_json === null ? null : JSON.parse(row.payload_json) as Record<string, unknown>;
    const aliases = payload?.aliases;
    const method = payload?.method as Record<string, unknown> | undefined;
    const reference = payload?.reference as Record<string, unknown> | undefined;
    const facets = reference?.facets as Record<string, unknown> | undefined;
    return {
      internalId: row.internal_id, assetKind: row.asset_kind, displayCode: row.display_code,
      name: typeof payload?.name === 'string' ? payload.name : '',
      shortPhrase: typeof payload?.shortPhrase === 'string' ? payload.shortPhrase : '',
      summary: typeof payload?.summary === 'string' ? payload.summary : '',
      usageTree: typeof method?.usageTree === 'string' ? method.usageTree : null,
      applicableLayers: Array.isArray(method?.applicableLayers) ? method.applicableLayers.map(String) : Array.isArray(reference?.stages) ? reference.stages.map(String) : [],
      genres: Array.isArray(facets?.genres) ? facets.genres.map(String) : [],
      mechanisms: Array.isArray(facets?.mechanisms) ? facets.mechanisms.map(String) : [],
      experiences: Array.isArray(facets?.experiences) ? facets.experiences.map(String) : [],
      aliases: Array.isArray(aliases) ? aliases.map(String) : [],
      currentRevision: row.current_revision, revisionStatus: row.rev_status, availability: row.status, updatedAt: row.updated_at
    };
  }

  private fingerprint(filter: AdminCardListFilter): string {
    return JSON.stringify({
      assetKind: filter.assetKind ?? null, keyword: filter.keyword?.trim() ?? null, usageTree: filter.usageTree ?? null,
      layers: [...(filter.layers ?? [])].sort(), availabilities: [...(filter.availabilities ?? [])].sort(),
      genre: filter.genre?.trim() ?? null, mechanism: filter.mechanism?.trim() ?? null, experience: filter.experience?.trim() ?? null
    });
  }

  /** 版本历史（有界）：revision倒序摘要。 */
  public listRevisionSummaries(internalId: string, limit: number, offset: number): RevisionSummary[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ValidationError('页大小必须在1至100之间。');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ValidationError('offset必须为非负整数。');
    const rows = this.database.prepare(`SELECT revision, status, short_phrase, summary, author_actor, review_actor, created_at
      FROM creative_reference_revisions WHERE internal_id=? ORDER BY revision DESC LIMIT ? OFFSET ?`)
      .all(internalId, limit, offset) as Array<{ revision: number; status: RevisionStatus; short_phrase: string; summary: string; author_actor: string; review_actor: string | null; created_at: string }>;
    return rows.map((row) => ({ ...row, shortPhrase: row.short_phrase, summary: row.summary, authorActor: row.author_actor, reviewActor: row.review_actor, createdAt: row.created_at, reviewOpinion: null }));
  }

  public countRevisions(internalId: string): number {
    return (this.database.prepare('SELECT COUNT(*) c FROM creative_reference_revisions WHERE internal_id=?').get(internalId) as { c: number }).c;
  }

  /**
   * 恢复：管理端专属操作。B1域规则从retired拒绝任何变更；恢复由本仓在调用方已核验retired的前提下
   * 用条件UPDATE原子落定（并发重复恢复第二次changes=0→冲突），恢复后回draft需重新审核再发布。
   */
  public setAvailabilityForRestore(internalId: string, now: string): void {
    const result = this.database.prepare("UPDATE creative_reference_cards SET status='draft', updated_at=? WHERE internal_id=? AND status='retired'").run(now, internalId);
    if (result.changes !== 1) throw new ConflictError('条目未退役或已被并发恢复。');
  }

  public latestReviewOpinion(internalId: string, revision: number): string | null {
    const row = this.database.prepare(`SELECT opinion FROM creative_reference_admin_audit
      WHERE action='review' AND target_id=? AND target_revision=? AND opinion IS NOT NULL ORDER BY created_at DESC LIMIT 1`)
      .get(internalId, revision) as { opinion: string } | undefined;
    return row === undefined ? null : row.opinion;
  }

  public recordAudit(input: AuditActionInput, now: string): void {
    this.database.prepare(`INSERT INTO creative_reference_admin_audit(audit_id, action, target_id, target_revision, actor_id, opinion, result_ref, idempotency_key, request_digest, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), input.action, input.targetId, input.targetRevision, input.actorId, input.opinion ?? null, input.resultRef ?? null, input.idempotencyKey ?? null, input.requestDigest ?? null, now);
  }

  public listAudit(internalId: string, limit: number): Array<{ action: string; actorId: string; opinion: string | null; createdAt: string; targetRevision: number | null }> {
    const rows = this.database.prepare(`SELECT action, target_revision, actor_id, opinion, created_at
      FROM creative_reference_admin_audit WHERE target_id=? ORDER BY created_at DESC LIMIT ?`).all(internalId, limit) as Array<{ action: string; target_revision: number | null; actor_id: string; opinion: string | null; created_at: string }>;
    return rows.map((row) => ({ action: row.action, actorId: row.actor_id, opinion: row.opinion, createdAt: row.created_at, targetRevision: row.target_revision }));
  }

  /** 发布幂等：同requestKey同digest返回已建release；同键异digest冲突；结果未知重试不多建。 */
  public resolveReleaseRequest(requestKey: string, requestDigest: string, run: () => { releaseId: string }, now: string): { releaseId: string; replayed: boolean } {
    const existing = this.database.prepare('SELECT request_digest, release_id FROM creative_reference_release_requests WHERE request_key=?').get(requestKey) as { request_digest: string; release_id: string | null } | undefined;
    if (existing !== undefined) {
      if (existing.request_digest !== requestDigest) throw new ConflictError('发布请求键已用于不同内容。');
      if (existing.release_id !== null) return { releaseId: existing.release_id, replayed: true };
      // 结果未知（记录无release_id）：拒绝自动重跑，要求换键或等待确认，避免双发。
      throw new ConflictError('上次发布结果未知；请勿重复提交，稍后核对releases列表或更换请求键。');
    }
    const result = run();
    this.database.prepare('INSERT INTO creative_reference_release_requests(request_key, request_digest, release_id, created_at) VALUES (?,?,?,?)')
      .run(requestKey, requestDigest, result.releaseId, now);
    return { releaseId: result.releaseId, replayed: false };
  }

  /** 幂等请求只读查询：undefined=无记录；release_id为null表示上次结果未知。 */
  public findReleaseRequest(requestKey: string): { requestDigest: string; releaseId: string | null } | undefined {
    const row = this.database.prepare('SELECT request_digest, release_id FROM creative_reference_release_requests WHERE request_key=?').get(requestKey) as { request_digest: string; release_id: string | null } | undefined;
    return row === undefined ? undefined : { requestDigest: row.request_digest, releaseId: row.release_id };
  }

  /** 占位写入（release_id NULL=结果未知防护）；并发同键由主键唯一约束落定，调用方在事务内捕获后重查。 */
  public insertReleaseRequestPlaceholder(requestKey: string, requestDigest: string, now: string): void {
    this.database.prepare('INSERT INTO creative_reference_release_requests(request_key, request_digest, release_id, created_at) VALUES (?,?,NULL,?)').run(requestKey, requestDigest, now);
  }

  public completeReleaseRequest(requestKey: string, releaseId: string): void {
    this.database.prepare('UPDATE creative_reference_release_requests SET release_id=? WHERE request_key=?').run(releaseId, requestKey);
  }

  public listReleaseSummaries(limit: number, offset: number): Array<{ releaseId: string; manifestHash: string; active: boolean; createdAt: string; publishedBy: string; entryCount: number; relationCount: number }> {
    const rows = this.database.prepare(`SELECT release_id, manifest_hash, active, created_at, published_by,
        json_array_length(manifest_json, '$.entries') AS entry_count,
        (SELECT COUNT(*) FROM creative_reference_release_relations rr WHERE rr.release_id=creative_reference_releases.release_id) AS relation_count
      FROM creative_reference_releases ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(limit, offset) as Array<{
      release_id: string; manifest_hash: string; active: 0 | 1; created_at: string; published_by: string; entry_count: number; relation_count: number;
    }>;
    return rows.map((row) => ({ releaseId: row.release_id, manifestHash: row.manifest_hash, active: row.active === 1, createdAt: row.created_at, publishedBy: row.published_by, entryCount: row.entry_count, relationCount: row.relation_count }));
  }

  public countReleases(): number {
    return (this.database.prepare('SELECT COUNT(*) c FROM creative_reference_releases').get() as { c: number }).c;
  }

  public digest(value: unknown): string {
    const canonical = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(canonical);
      if (v !== null && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
      return v;
    };
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
  }

  public requireCardOrThrow(internalId: string): void {
    const row = this.database.prepare('SELECT 1 FROM creative_reference_cards WHERE internal_id=?').get(internalId);
    if (row === undefined) throw new NotFoundError('条目不存在。');
  }
}
