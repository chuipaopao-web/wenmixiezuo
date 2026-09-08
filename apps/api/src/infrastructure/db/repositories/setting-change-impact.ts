import type { DatabaseSync } from 'node:sqlite';

export interface SettingChangeImpact {
  planning: Array<{ kind: string; name: string }>;
  finishedChapters: number;
}

/** Owner-scoped reference queries for impact preview; not semantic conflict detection. */
export function settingChangeImpact(database: DatabaseSync, ownerId: string, bookId: string, itemKey: string): SettingChangeImpact {
  const planning = database.prepare(`SELECT t.tree_kind AS kind,
      COALESCE(json_extract(t.content_json,'$.title'), CASE t.tree_kind WHEN 'book' THEN '全书方向' WHEN 'volume' THEN '卷规划' ELSE '单元链' END) AS name
    FROM v7_planning_tree_versions t
    WHERE t.owner_id=? AND t.book_id=? AND t.lifecycle IN ('confirmed','candidate')
      AND EXISTS (SELECT 1 FROM json_each(t.source_refs_json) ref
        JOIN v7_setting_item_versions s ON s.version_id=json_extract(ref.value,'$.sourceId')
        WHERE s.owner_id=t.owner_id AND s.book_id=t.book_id AND s.item_key=? AND s.status='confirmed')
    GROUP BY t.tree_kind,t.scope_id ORDER BY t.tree_kind,t.scope_id`).all(ownerId, bookId, itemKey) as Array<{kind: string; name: string}>;
  const chapters = database.prepare(`SELECT COUNT(DISTINCT m.sequence_id || ':' || m.chapter_number) AS count
    FROM v7_manuscript_versions m JOIN v7_creation_context_packs p
      ON p.context_pack_id=m.context_pack_id AND p.owner_id=m.owner_id AND p.book_id=m.book_id
    WHERE m.owner_id=? AND m.book_id=? AND m.lifecycle='final'
      AND EXISTS (SELECT 1 FROM json_each(p.content_json,'$.sourceRefs') ref
        JOIN v7_setting_item_versions s ON s.version_id=json_extract(ref.value,'$.sourceId')
        WHERE s.owner_id=m.owner_id AND s.book_id=m.book_id AND s.item_key=? AND s.status='confirmed')`
  ).get(ownerId, bookId, itemKey) as {count: number};
  return { planning, finishedChapters: chapters.count };
}
