import type { DatabaseSync } from 'node:sqlite';
import type { BookScope } from '../../../domain/scope.js';

export interface PlanningStateRow {
  version: number;
  stage: string;
  active_style_version_id: string | null;
  setting_baseline_version_id: string | null;
  master_outline_version_id: string | null;
  volume_outline_version_id: string | null;
}

export class PlanningWorkflowRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public openingProfile(scope: BookScope) {
    return this.database.prepare(`
      SELECT b.title, o.version, o.channel, o.category_name, o.blueprint_json
      FROM books b
      JOIN book_opening_blueprints o ON o.owner_id = b.owner_id AND o.book_id = b.book_id
      WHERE b.owner_id = ? AND b.book_id = ? AND o.status = 'active'
      ORDER BY o.version DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) as {
      title: string; version: number; channel: string; category_name: string; blueprint_json: string;
    } | undefined;
  }

  public openingBlueprint(scope: BookScope): string | undefined {
    const row = this.database.prepare(`
      SELECT blueprint_json FROM book_opening_blueprints
      WHERE owner_id = ? AND book_id = ? AND status = 'active'
      ORDER BY version DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { blueprint_json: string } | undefined;
    return row?.blueprint_json;
  }

  public planningState(scope: BookScope): PlanningStateRow | undefined {
    return this.database.prepare(`
      SELECT version, stage, active_style_version_id, setting_baseline_version_id,
        master_outline_version_id, volume_outline_version_id
      FROM book_planning_states WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as PlanningStateRow | undefined;
  }

  public selectedStyle(scope: BookScope) {
    return this.database.prepare(`
      SELECT style_version_id, version, content_json, source_kind, status, created_at
      FROM book_style_versions
      WHERE owner_id = ? AND book_id = ? AND status = 'selected' LIMIT 1
    `).get(scope.ownerId, scope.bookId) as {
      style_version_id: string; version: number; content_json: string; source_kind: string;
      status: string; created_at: string;
    } | undefined;
  }

  public confirmStyle(scope: BookScope, expectedVersion: number, id: string, content: string, now: string): void {
    const version = (this.database.prepare(`
      SELECT COALESCE(MAX(version), 0) + 1 AS version
      FROM book_style_versions WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { version: number }).version;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (this.planningState(scope)?.version !== expectedVersion) throw new Error('规划状态已经变化，请刷新后重试');
      this.database.prepare(`
        UPDATE book_style_versions SET status = 'superseded'
        WHERE owner_id = ? AND book_id = ? AND status = 'selected'
      `).run(scope.ownerId, scope.bookId);
      this.database.prepare(`
        INSERT INTO book_style_versions
          (style_version_id, owner_id, book_id, version, content_json, source_kind, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'owner', 'selected', ?)
      `).run(id, scope.ownerId, scope.bookId, version, content, now);
      const result = this.database.prepare(`
        UPDATE book_planning_states
        SET version = version + 1, stage = 'setting_in_progress', active_style_version_id = ?, updated_at = ?
        WHERE owner_id = ? AND book_id = ? AND version = ?
      `).run(id, now, scope.ownerId, scope.bookId, expectedVersion);
      if (result.changes !== 1) throw new Error('规划状态已经变化，请刷新后重试');
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public settingStatuses(scope: BookScope) {
    return this.database.prepare(`
      SELECT item_key, item_status FROM setting_outline_workspace WHERE owner_id = ? AND book_id = ?
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ item_key: string; item_status: string }>;
  }

  public activeArtifactVersion(scope: BookScope, type: string): string | undefined {
    const row = this.database.prepare(`
      SELECT v.artifact_version_id FROM artifacts a
      JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = ?
      ORDER BY v.created_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, type) as { artifact_version_id: string } | undefined;
    return row?.artifact_version_id;
  }

  public advanceSetting(scope: BookScope, expected: number, id: string, now: string): boolean {
    return this.database.prepare(`
      UPDATE book_planning_states SET version = version + 1, stage = 'setting_ready',
        setting_baseline_version_id = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND version = ?
    `).run(id, now, scope.ownerId, scope.bookId, expected).changes === 1;
  }

  public synchronizeCreationWorkflowAfterSetting(scope: BookScope, now: string): void {
    this.database.prepare(`
      INSERT INTO creation_workflow_states (
        owner_id, book_id, planning_version, stage, frozen_chapter_outline_refs_json, updated_at
      ) VALUES (?, ?, 1, 'setting_confirmed', '[]', ?)
      ON CONFLICT(owner_id, book_id) DO UPDATE SET
        planning_version = CASE
          WHEN creation_workflow_states.stage IN (
            'book_profile_draft', 'book_profile_confirmed', 'setting_in_progress'
          ) THEN creation_workflow_states.planning_version + 1
          ELSE creation_workflow_states.planning_version
        END,
        stage = CASE
          WHEN creation_workflow_states.stage IN (
            'book_profile_draft', 'book_profile_confirmed', 'setting_in_progress'
          ) THEN 'setting_confirmed'
          ELSE creation_workflow_states.stage
        END,
        blocking_reason = NULL,
        updated_at = excluded.updated_at
    `).run(scope.ownerId, scope.bookId, now);
  }

  public artifactVersion(scope: BookScope, id: string) {
    return this.database.prepare(`
      SELECT a.artifact_type, v.status FROM artifact_versions v
      JOIN artifacts a ON a.artifact_id = v.artifact_id AND a.owner_id = v.owner_id AND a.book_id = v.book_id
      WHERE v.owner_id = ? AND v.book_id = ? AND v.artifact_version_id = ?
    `).get(scope.ownerId, scope.bookId, id) as { artifact_type: string; status: string } | undefined;
  }

  public advanceArtifact(
    scope: BookScope,
    expected: number,
    stage: string,
    column: 'master_outline_version_id' | null,
    id: string,
    now: string
  ): boolean {
    if (column === null) {
      return this.database.prepare(`
        UPDATE book_planning_states SET version = version + 1, stage = ?, updated_at = ?
        WHERE owner_id = ? AND book_id = ? AND version = ?
      `).run(stage, now, scope.ownerId, scope.bookId, expected).changes === 1;
    }
    const sql = `UPDATE book_planning_states SET version = version + 1, stage = ?,
        master_outline_version_id = ?, updated_at = ?
       WHERE owner_id = ? AND book_id = ? AND version = ?`;
    return this.database.prepare(sql).run(stage, id, now, scope.ownerId, scope.bookId, expected).changes === 1;
  }
}
