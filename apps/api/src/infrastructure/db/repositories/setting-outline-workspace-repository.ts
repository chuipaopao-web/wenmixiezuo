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
        candidate_at, confirmed_at, created_at, updated_at
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
        candidate_at, confirmed_at, created_at, updated_at
      FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ? AND source_discussion_id = ?
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, discussionId) as SettingOutlineWorkspaceRow | undefined;
  }

  public listByDiscussion(scope: BookScope, discussionId: string): SettingOutlineWorkspaceRow[] {
    return this.database.prepare(`
      SELECT item_key, group_title, label, prompt, source_label, item_status,
        is_custom, sort_order, content_text, source_discussion_id, source_decision_id,
        candidate_at, confirmed_at, created_at, updated_at
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
        candidate_at, confirmed_at, created_at, updated_at
      FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ? AND group_title = ? AND label = ?
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, groupTitle, label) as SettingOutlineWorkspaceRow | undefined;
  }

  public prefillContentIfEmpty(scope: BookScope, itemKey: string, contentText: string, now: string): void {
    this.database.prepare(`
      UPDATE setting_outline_workspace
      SET content_text = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND item_key = ? AND content_text IS NULL
    `).run(contentText, now, scope.ownerId, scope.bookId, itemKey);
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
    return row.next_no;
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
