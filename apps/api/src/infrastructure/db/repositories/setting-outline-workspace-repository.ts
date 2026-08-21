import type { DatabaseSync } from 'node:sqlite';
import type { BookScope } from '../../../domain/scope.js';

export interface SettingOutlineWorkspaceRow {
  item_key: string;
  group_title: string;
  label: string;
  prompt: string;
  source_label: string;
  item_status: string;
  is_custom: number;
  sort_order: number;
  content_text: string | null;
  source_discussion_id: string | null;
  source_decision_id: string | null;
  candidate_at: string | null;
  confirmed_at: string | null;
  pending_candidate_text: string | null;
  pending_candidate_at: string | null;
  pending_source_discussion_id: string | null;
  pending_source_decision_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SettingOutlineItemVersionRow {
  item_key: string;
  version_no: number;
  content_text: string;
  source_kind: 'manual' | 'guidance' | 'discussion';
  source_discussion_id: string | null;
  source_decision_id: string | null;
  created_at: string;
}

export class SettingOutlineWorkspaceRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public list(scope: BookScope): SettingOutlineWorkspaceRow[] {
    return this.database.prepare(`
      SELECT item_key, group_title, label, prompt, source_label, item_status,
        is_custom, sort_order, content_text, source_discussion_id, source_decision_id,
        candidate_at, confirmed_at,
        pending_candidate_text, pending_candidate_at,
        pending_source_discussion_id, pending_source_decision_id, created_at, updated_at
      FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ?
      ORDER BY is_custom, sort_order, item_key
    `).all(scope.ownerId, scope.bookId) as unknown as SettingOutlineWorkspaceRow[];
  }

  public upsert(scope: BookScope, input: {
    itemKey: string;
    groupTitle: string;
    label: string;
    prompt: string;
    sourceLabel: string;
    itemStatus: string;
    isCustom: boolean;
    sortOrder: number;
    contentText?: string | null;
    sourceDiscussionId?: string | null;
    sourceDecisionId?: string | null;
    candidateAt?: string | null;
    confirmedAt?: string | null;
    now: string;
  }): void {
    this.database.prepare(`
      INSERT INTO setting_outline_workspace (
        owner_id, book_id, item_key, group_title, label, prompt, source_label,
        item_status, is_custom, sort_order, content_text, source_discussion_id,
        source_decision_id, candidate_at, confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner_id, book_id, item_key) DO UPDATE SET
        group_title = excluded.group_title,
        label = excluded.label,
        prompt = excluded.prompt,
        source_label = excluded.source_label,
        item_status = excluded.item_status,
        is_custom = excluded.is_custom,
        sort_order = excluded.sort_order,
        content_text = COALESCE(excluded.content_text, setting_outline_workspace.content_text),
        source_discussion_id = COALESCE(excluded.source_discussion_id, setting_outline_workspace.source_discussion_id),
        source_decision_id = COALESCE(excluded.source_decision_id, setting_outline_workspace.source_decision_id),
        candidate_at = COALESCE(excluded.candidate_at, setting_outline_workspace.candidate_at),
        confirmed_at = COALESCE(excluded.confirmed_at, setting_outline_workspace.confirmed_at),
        updated_at = excluded.updated_at
    `).run(
      scope.ownerId, scope.bookId, input.itemKey, input.groupTitle, input.label,
      input.prompt, input.sourceLabel, input.itemStatus, input.isCustom ? 1 : 0,
      input.sortOrder, input.contentText ?? null, input.sourceDiscussionId ?? null,
      input.sourceDecisionId ?? null, input.candidateAt ?? null, input.confirmedAt ?? null,
      input.now, input.now
    );
  }

  public insertIfMissing(scope: BookScope, input: {
    itemKey: string;
    groupTitle: string;
    label: string;
    prompt: string;
    sourceLabel: string;
    itemStatus: string;
    isCustom: boolean;
    sortOrder: number;
    now: string;
  }): void {
    this.database.prepare(`
      INSERT OR IGNORE INTO setting_outline_workspace (
        owner_id, book_id, item_key, group_title, label, prompt, source_label,
        item_status, is_custom, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      scope.ownerId, scope.bookId, input.itemKey, input.groupTitle, input.label,
      input.prompt, input.sourceLabel, input.itemStatus, input.isCustom ? 1 : 0,
      input.sortOrder, input.now, input.now
    );
  }

  public findByDiscussion(scope: BookScope, discussionId: string): SettingOutlineWorkspaceRow | undefined {
    return this.database.prepare(`
      SELECT item_key, group_title, label, prompt, source_label, item_status,
        is_custom, sort_order, content_text, source_discussion_id, source_decision_id,
        candidate_at, confirmed_at,
        pending_candidate_text, pending_candidate_at,
        pending_source_discussion_id, pending_source_decision_id, created_at, updated_at
      FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ? AND source_discussion_id = ?
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, discussionId) as SettingOutlineWorkspaceRow | undefined;
  }

  public listByDiscussion(scope: BookScope, discussionId: string): SettingOutlineWorkspaceRow[] {
    return this.database.prepare(`
      SELECT item_key, group_title, label, prompt, source_label, item_status,
        is_custom, sort_order, content_text, source_discussion_id, source_decision_id,
        candidate_at, confirmed_at,
        pending_candidate_text, pending_candidate_at,
        pending_source_discussion_id, pending_source_decision_id, created_at, updated_at
      FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ? AND source_discussion_id = ?
      ORDER BY sort_order, item_key
    `).all(scope.ownerId, scope.bookId, discussionId) as unknown as SettingOutlineWorkspaceRow[];
  }

  public findByGroupAndLabel(
    scope: BookScope,
    groupTitle: string,
    label: string
  ): SettingOutlineWorkspaceRow | undefined {
    return this.database.prepare(`
      SELECT item_key, group_title, label, prompt, source_label, item_status,
        is_custom, sort_order, content_text, source_discussion_id, source_decision_id,
        candidate_at, confirmed_at,
        pending_candidate_text, pending_candidate_at,
        pending_source_discussion_id, pending_source_decision_id, created_at, updated_at
      FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ? AND group_title = ? AND label = ?
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, groupTitle, label) as SettingOutlineWorkspaceRow | undefined;
  }


  /**
   * 已确认条目重新设计出的新候选：只挂在待定栏位，正式内容与“已确认”状态不动，
   * 下游创作继续读旧定稿，直到作者确认后才替换。
   */
  public setPendingCandidate(scope: BookScope, input: {
    itemKey: string;
    contentText: string;
    sourceDiscussionId?: string | null;
    sourceDecisionId?: string | null;
    now: string;
  }): void {
    this.database.prepare(`
      UPDATE setting_outline_workspace
      SET pending_candidate_text = ?, pending_candidate_at = ?,
        pending_source_discussion_id = ?, pending_source_decision_id = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND item_key = ?
    `).run(
      input.contentText, input.now,
      input.sourceDiscussionId ?? null, input.sourceDecisionId ?? null, input.now,
      scope.ownerId, scope.bookId, input.itemKey
    );
  }

  /** 作者确认待定候选：候选转正成为正式内容并清空待定栏位。 */
  public promotePendingCandidate(scope: BookScope, itemKey: string, now: string): void {
    this.database.prepare(`
      UPDATE setting_outline_workspace
      SET content_text = pending_candidate_text,
        candidate_at = pending_candidate_at,
        source_discussion_id = pending_source_discussion_id,
        source_decision_id = pending_source_decision_id,
        item_status = '已确认', confirmed_at = ?,
        pending_candidate_text = NULL, pending_candidate_at = NULL,
        pending_source_discussion_id = NULL, pending_source_decision_id = NULL,
        updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND item_key = ? AND pending_candidate_text IS NOT NULL
    `).run(now, now, scope.ownerId, scope.bookId, itemKey);
  }

  public clearPendingCandidate(scope: BookScope, itemKey: string, now: string): void {
    this.database.prepare(`
      UPDATE setting_outline_workspace
      SET pending_candidate_text = NULL, pending_candidate_at = NULL,
        pending_source_discussion_id = NULL, pending_source_decision_id = NULL, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND item_key = ?
    `).run(now, scope.ownerId, scope.bookId, itemKey);
  }

  /** 从活动工作区移除单项内容；版本历史不动，相关活动检索片段只做归档。 */
  public removeCurrent(scope: BookScope, itemKey: string, now: string): void {
    this.database.prepare(`
      UPDATE setting_outline_workspace
      SET item_status = '待讨论', content_text = NULL,
        source_discussion_id = NULL, source_decision_id = NULL,
        candidate_at = NULL, confirmed_at = NULL,
        pending_candidate_text = NULL, pending_candidate_at = NULL,
        pending_source_discussion_id = NULL, pending_source_decision_id = NULL,
        updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND item_key = ?
    `).run(now, scope.ownerId, scope.bookId, itemKey);
    const sourcePrefix = `setting-item:${itemKey}:v`;
    this.database.prepare(`
      UPDATE setting_clauses SET status = 'archived', updated_at = ?
      WHERE owner_id = ? AND book_id = ?
        AND substr(source_version_id, 1, length(?)) = ? AND status = 'active'
    `).run(now, scope.ownerId, scope.bookId, sourcePrefix, sourcePrefix);
  }

  public listByPendingDiscussion(scope: BookScope, discussionId: string): SettingOutlineWorkspaceRow[] {
    return this.database.prepare(`
      SELECT item_key, group_title, label, prompt, source_label, item_status,
        is_custom, sort_order, content_text, source_discussion_id, source_decision_id,
        candidate_at, confirmed_at,
        pending_candidate_text, pending_candidate_at,
        pending_source_discussion_id, pending_source_decision_id, created_at, updated_at
      FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ? AND pending_source_discussion_id = ?
      ORDER BY sort_order, item_key
    `).all(scope.ownerId, scope.bookId, discussionId) as unknown as SettingOutlineWorkspaceRow[];
  }

  public prefillContentIfEmpty(scope: BookScope, itemKey: string, contentText: string, now: string): void {
    this.database.prepare(`
      UPDATE setting_outline_workspace
      SET content_text = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND item_key = ? AND content_text IS NULL
    `).run(contentText, now, scope.ownerId, scope.bookId, itemKey);
  }

  /** 清空全部设定内容：条目保留、内容与状态归零，版本历史不动。 */
  public resetAll(scope: BookScope, now: string): number {
    this.database.prepare(`UPDATE setting_clauses SET status='archived',updated_at=?
      WHERE owner_id=? AND book_id=? AND status='active'`).run(now,scope.ownerId,scope.bookId);
    return Number(this.database.prepare(`
      UPDATE setting_outline_workspace
      SET item_status = '待讨论', content_text = NULL,
        source_discussion_id = NULL, source_decision_id = NULL,
        candidate_at = NULL, confirmed_at = NULL,
        pending_candidate_text = NULL, pending_candidate_at = NULL,
        pending_source_discussion_id = NULL, pending_source_decision_id = NULL,
        updated_at = ?
      WHERE owner_id = ? AND book_id = ?
    `).run(now, scope.ownerId, scope.bookId).changes);
  }

  public appendVersion(scope: BookScope, input: {
    itemKey: string;
    contentText: string;
    sourceKind: 'manual' | 'guidance' | 'discussion';
    sourceDiscussionId?: string | null;
    sourceDecisionId?: string | null;
    now: string;
  }): number {
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(version_no), 0) + 1 AS next_no
      FROM setting_outline_item_versions
      WHERE owner_id = ? AND book_id = ? AND item_key = ?
    `).get(scope.ownerId, scope.bookId, input.itemKey) as unknown as { next_no: number };
    this.database.prepare(`
      INSERT INTO setting_outline_item_versions (
        owner_id, book_id, item_key, version_no, content_text, source_kind,
        source_discussion_id, source_decision_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      scope.ownerId, scope.bookId, input.itemKey, row.next_no, input.contentText,
      input.sourceKind, input.sourceDiscussionId ?? null, input.sourceDecisionId ?? null,
      input.now
    );
    this.projectConfirmedClauses(scope,input.itemKey,row.next_no,input.contentText,input.now);
    return row.next_no;
  }

  private projectConfirmedClauses(scope:BookScope,itemKey:string,versionNo:number,contentText:string,now:string):void{
    const sourceVersionId=`setting-item:${itemKey}:v${versionNo}`;
    this.database.prepare(`UPDATE setting_clauses SET status='superseded',updated_at=?
      WHERE owner_id=? AND book_id=? AND source_version_id LIKE ? AND status='active'`)
      .run(now,scope.ownerId,scope.bookId,`setting-item:${itemKey}:v%`);
    const clauses=settingClauseParts(contentText);
    const insert=this.database.prepare(`INSERT INTO setting_clauses(setting_clause_id,owner_id,book_id,kind,statement,
      strength,truth_status,scope_type,scope_id,source_version_id,dependency_version_ids_json,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'confirmed','book',?,?, '[]','active',?,?)`);
    clauses.forEach((statement,index)=>{const classification=classifySettingClause(itemKey,statement);
      insert.run(`${scope.bookId}:setting:${itemKey}:${versionNo}:${index+1}`,scope.ownerId,scope.bookId,
        classification.kind,statement,classification.strength,scope.bookId,sourceVersionId,now,now);});
  }

  public listVersions(scope: BookScope, itemKey: string): SettingOutlineItemVersionRow[] {
    return this.database.prepare(`
      SELECT item_key, version_no, content_text, source_kind,
        source_discussion_id, source_decision_id, created_at
      FROM setting_outline_item_versions
      WHERE owner_id = ? AND book_id = ? AND item_key = ?
      ORDER BY version_no DESC
    `).all(scope.ownerId, scope.bookId, itemKey) as unknown as SettingOutlineItemVersionRow[];
  }
}

function settingClauseParts(content:string):string[]{
  const lines=content.split(/\r?\n|(?<=[。！？；])/u).map(item=>item.trim()).filter(Boolean);
  return lines.length>0?lines:[content.trim()];
}
function classifySettingClause(itemKey:string,statement:string):{kind:'fact'|'direction'|'boundary'|'blank';
  strength:'hard_fact'|'soft_reference'|'open_space'}{
  if(/留白|未知|未定|暂不|以后再|后文再|谜团|不解释/u.test(statement))return{kind:'blank',strength:'open_space'};
  if(itemKey==='boundaries-blanks'||itemKey==='rules-costs'||/禁止|不能|不可|绝不|必须|代价|限制|边界/u.test(statement))
    return{kind:'boundary',strength:'hard_fact'};
  if(['world-stage','social-order'].includes(itemKey))return{kind:'fact',strength:'hard_fact'};
  return{kind:'direction',strength:'soft_reference'};
}
