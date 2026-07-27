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
  created_at: string;
  updated_at: string;
}

export class SettingOutlineWorkspaceRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public list(scope: BookScope): SettingOutlineWorkspaceRow[] {
    return this.database.prepare(`
      SELECT item_key, group_title, label, prompt, source_label, item_status,
        is_custom, sort_order, created_at, updated_at
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
    now: string;
  }): void {
    this.database.prepare(`
      INSERT INTO setting_outline_workspace (
        owner_id, book_id, item_key, group_title, label, prompt, source_label,
        item_status, is_custom, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner_id, book_id, item_key) DO UPDATE SET
        group_title = excluded.group_title,
        label = excluded.label,
        prompt = excluded.prompt,
        source_label = excluded.source_label,
        item_status = excluded.item_status,
        is_custom = excluded.is_custom,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `).run(
      scope.ownerId, scope.bookId, input.itemKey, input.groupTitle, input.label,
      input.prompt, input.sourceLabel, input.itemStatus, input.isCustom ? 1 : 0,
      input.sortOrder, input.now, input.now
    );
  }
}
