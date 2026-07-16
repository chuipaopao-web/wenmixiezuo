import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { PositioningField, PositioningTag } from '../../domain/positioning.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { buildAdaptationRules, hashJson } from './adaptation-rules.js';

export class AdaptationService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public revisePositioning(scope: BookScope, expectedBookVersion: number, fields: PositioningField[], tags: PositioningTag[]): { positioningVersion: number; adaptationSnapshotId: string; invalidatedCount: number } {
    assertBookScope(scope);
    const book = this.database.prepare('SELECT version, positioning_version FROM books WHERE owner_id = ? AND book_id = ?')
      .get(scope.ownerId, scope.bookId) as { version: number; positioning_version: number } | undefined;
    if (book === undefined) throw new Error('书籍不存在或越权');
    if (book.version !== expectedBookVersion) throw new Error('书籍版本已经变化');
    const nextPositioning = book.positioning_version + 1;
    const positioningVersionId = this.ids.next();
    const adaptationSnapshotId = this.ids.next();
    const configVersionId = this.ids.next();
    const rules = buildAdaptationRules(fields, tags);
    const now = this.clock.now().toISOString();
    let invalidatedCount = 0;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO positioning_versions (
          positioning_version_id, owner_id, book_id, version, fields_json, tags_json,
          content_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(positioningVersionId, scope.ownerId, scope.bookId, nextPositioning, JSON.stringify(fields), JSON.stringify(tags), hashJson({ fields, tags }), now);
      this.database.prepare('UPDATE book_configs SET active = 0 WHERE owner_id = ? AND book_id = ? AND active = 1')
        .run(scope.ownerId, scope.bookId);
      this.database.prepare(`
        INSERT INTO book_configs (
          config_version_id, owner_id, book_id, version, positioning_version,
          budget_mode, preferences_json, active, created_at
        ) VALUES (?, ?, ?, ?, ?, 'standard', '{}', 1, ?)
      `).run(configVersionId, scope.ownerId, scope.bookId, nextPositioning, nextPositioning, now);
      this.database.prepare('UPDATE adaptation_snapshots SET active = 0 WHERE owner_id = ? AND book_id = ? AND active = 1')
        .run(scope.ownerId, scope.bookId);
      this.database.prepare(`
        INSERT INTO adaptation_snapshots (
          adaptation_snapshot_id, owner_id, book_id, version, positioning_version,
          rules_json, content_hash, active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(adaptationSnapshotId, scope.ownerId, scope.bookId, nextPositioning, nextPositioning, JSON.stringify(rules), hashJson(rules), now);
      this.insertTags(scope, nextPositioning, tags, now);
      const targets = this.database.prepare(`
        SELECT artifact_version_id AS target_id, 'artifact_version' AS target_type
        FROM artifact_versions WHERE owner_id = ? AND book_id = ? AND status IN ('draft', 'candidate', 'selected')
        UNION ALL
        SELECT task_id AS target_id, 'task' AS target_type
        FROM tasks WHERE owner_id = ? AND book_id = ? AND status IN ('pending', 'queued', 'paused')
      `).all(scope.ownerId, scope.bookId, scope.ownerId, scope.bookId) as unknown as Array<{ target_id: string; target_type: string }>;
      for (const target of targets) {
        this.database.prepare(`
          INSERT INTO invalidations (
            invalidation_id, owner_id, book_id, target_type, target_id, reason,
            source_positioning_version, created_at
          ) VALUES (?, ?, ?, ?, ?, 'POSITIONING_CHANGED', ?, ?)
        `).run(this.ids.next(), scope.ownerId, scope.bookId, target.target_type, target.target_id, nextPositioning, now);
        invalidatedCount += 1;
      }
      this.database.prepare(`UPDATE artifact_versions SET status = 'invalidated' WHERE owner_id = ? AND book_id = ? AND status IN ('draft', 'candidate', 'selected')`)
        .run(scope.ownerId, scope.bookId);
      this.database.prepare(`UPDATE tasks SET status = 'blocked', error_code = 'POSITIONING_CHANGED', updated_at = ? WHERE owner_id = ? AND book_id = ? AND status IN ('pending', 'queued', 'paused')`)
        .run(now, scope.ownerId, scope.bookId);
      const updated = this.database.prepare(`
        UPDATE books SET positioning_version = ?, version = version + 1, updated_at = ?
        WHERE owner_id = ? AND book_id = ? AND version = ?
      `).run(nextPositioning, now, scope.ownerId, scope.bookId, expectedBookVersion);
      if (updated.changes !== 1) throw new Error('书籍版本并发变化');
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return { positioningVersion: nextPositioning, adaptationSnapshotId, invalidatedCount };
  }

  private insertTags(scope: BookScope, version: number, tags: PositioningTag[], now: string): void {
    for (const tag of tags) {
      const tagId = `tag-${createHash('sha256').update(`${tag.category}:${tag.name}`).digest('hex').slice(0, 16)}`;
      this.database.prepare(`
        INSERT INTO classification_tags (tag_id, tag_key, display_name, category, dynamic, created_at)
        VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(tag_key) DO NOTHING
      `).run(tagId, tagId, tag.name, tag.category, now);
      this.database.prepare(`
        INSERT INTO positioning_tag_bindings (owner_id, book_id, positioning_version, tag_id, source_status)
        VALUES (?, ?, ?, ?, ?)
      `).run(scope.ownerId, scope.bookId, version, tagId, tag.sourceStatus);
    }
  }
}

