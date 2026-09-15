import type {DatabaseSync} from 'node:sqlite';

/** S1-A阶段二（TIMEMACHINE_STORY_DESIGN第25节）：故事线资料正式版本、作者草稿与失效标记的持久化查询。
 * application-database-boundary：DB访问归infrastructure，应用层经本仓储读写。 */

export interface StorylineMaterialRow {
  id: string;
  revision: number;
  content_json: string;
  content_hash: string;
  created_by: 'selection-confirm' | 'author-edit';
  created_at: string;
}

export interface StorylineMaterialVersionRow {
  revision: number;
  content_hash: string;
  created_by: 'selection-confirm' | 'author-edit';
  created_at: string;
}

export interface StorylineMaterialDraftRow {
  content_json: string;
  base_revision: number;
  updated_at: string;
}

export interface StaleRunRow {
  id: string;
  scheme: string | null;
  round_key: string | null;
  state: string;
  needs_redesign: number;
}

const MATERIAL_COLUMNS = 'id,revision,content_json,content_hash,created_by,created_at';

export class StorylineMaterialRepository {
  constructor(private readonly db: DatabaseSync) {}

  current(ownerId: string, bookId: string): StorylineMaterialRow | undefined {
    return this.db.prepare(`SELECT ${MATERIAL_COLUMNS} FROM tm2_storyline_materials WHERE owner=? AND book=? ORDER BY revision DESC LIMIT 1`).get(ownerId, bookId) as StorylineMaterialRow | undefined;
  }

  listVersions(ownerId: string, bookId: string): StorylineMaterialVersionRow[] {
    return this.db.prepare('SELECT revision,content_hash,created_by,created_at FROM tm2_storyline_materials WHERE owner=? AND book=? ORDER BY revision DESC').all(ownerId, bookId) as unknown as StorylineMaterialVersionRow[];
  }

  findByIdempotencyKey(ownerId: string, bookId: string, key: string): StorylineMaterialRow | undefined {
    return this.db.prepare(`SELECT ${MATERIAL_COLUMNS} FROM tm2_storyline_materials WHERE owner=? AND book=? AND idempotency_key=?`).get(ownerId, bookId, key) as StorylineMaterialRow | undefined;
  }

  /** Caller owns the transaction. revision must be current max+1（应用层CAS后计算）。 */
  insert(ownerId: string, bookId: string, row: {id: string; revision: number; contentJson: string; contentHash: string; createdBy: 'selection-confirm' | 'author-edit'; idempotencyKey: string; createdAt: string}): void {
    this.db.prepare('INSERT INTO tm2_storyline_materials(owner,book,id,revision,content_json,content_hash,created_by,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(ownerId, bookId, row.id, row.revision, row.contentJson, row.contentHash, row.createdBy, row.idempotencyKey, row.createdAt);
  }

  getDraft(ownerId: string, bookId: string): StorylineMaterialDraftRow | undefined {
    return this.db.prepare('SELECT content_json,base_revision,updated_at FROM tm2_storyline_material_drafts WHERE owner=? AND book=?').get(ownerId, bookId) as StorylineMaterialDraftRow | undefined;
  }

  /** 覆盖式草稿：保存草稿不失效任何后续（第25.2节）。 */
  upsertDraft(ownerId: string, bookId: string, contentJson: string, baseRevision: number, updatedAt: string): void {
    this.db.prepare('INSERT INTO tm2_storyline_material_drafts(owner,book,content_json,base_revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner,book) DO UPDATE SET content_json=excluded.content_json,base_revision=excluded.base_revision,updated_at=excluded.updated_at').run(ownerId, bookId, contentJson, baseRevision, updatedAt);
  }

  /** 作者编辑保存生效的同事务内：把所有选择哈希≠新内容哈希的设计轮标记为需重新设计（第25.2节）。
   * 只标记带结构化选择快照的设计轮；无selection的旧轮不属于本合同范围。 */
  markStaleRuns(ownerId: string, bookId: string, newContentHash: string, markedAt: string): number {
    const result = this.db.prepare("UPDATE tm2_design_runs SET needs_redesign=1,updated_at=? WHERE owner_id=? AND book_id=? AND kind='design' AND needs_redesign=0 AND json_extract(snapshot_json,'$.selection.requestHash') IS NOT NULL AND json_extract(snapshot_json,'$.selection.requestHash')<>?").run(markedAt, ownerId, bookId, newContentHash);
    return Number(result.changes);
  }

  /** 影响预览：选择哈希≠目标哈希（或已被标记）的设计轮真实清单，含在途状态。 */
  listStaleRuns(ownerId: string, bookId: string, targetContentHash: string): StaleRunRow[] {
    return this.db.prepare("SELECT id,scheme,round_key,state,needs_redesign FROM tm2_design_runs WHERE owner_id=? AND book_id=? AND kind='design' AND (needs_redesign=1 OR (json_extract(snapshot_json,'$.selection.requestHash') IS NOT NULL AND json_extract(snapshot_json,'$.selection.requestHash')<>?)) ORDER BY created_at DESC").all(ownerId, bookId, targetContentHash) as unknown as StaleRunRow[];
  }

  runNeedsRedesign(ownerId: string, bookId: string, runId: string): boolean {
    const row = this.db.prepare('SELECT needs_redesign FROM tm2_design_runs WHERE owner_id=? AND book_id=? AND id=?').get(ownerId, bookId, runId) as {needs_redesign: number} | undefined;
    return row !== undefined && Number(row.needs_redesign) === 1;
  }

  /** 已采用基线对应的候选运行ID（无采用时undefined）。 */
  adoptedCandidateId(ownerId: string, bookId: string): string | undefined {
    const row = this.db.prepare('SELECT a.candidate AS candidate FROM tm2_books b JOIN tm2_adoptions a ON a.owner=b.owner AND a.book=b.book AND a.id=b.adoption WHERE b.owner=? AND b.book=?').get(ownerId, bookId) as {candidate: string} | undefined;
    return row?.candidate;
  }

  /** 影响预览签名用：已采用的候选、候选修订与采用修订（72c3a62f复核第3项）。 */
  adoptedCandidate(ownerId: string, bookId: string): {candidate: string; candidateRevision: number; adoptionRevision: number} | undefined {
    const row = this.db.prepare('SELECT a.candidate AS candidate, a.candidate_revision AS candidateRevision, a.revision AS adoptionRevision FROM tm2_books b JOIN tm2_adoptions a ON a.owner=b.owner AND a.book=b.book AND a.id=b.adoption WHERE b.owner=? AND b.book=?').get(ownerId, bookId) as {candidate: string; candidateRevision: number; adoptionRevision: number} | undefined;
    return row === undefined ? undefined : {candidate: row.candidate, candidateRevision: Number(row.candidateRevision), adoptionRevision: Number(row.adoptionRevision)};
  }
}
