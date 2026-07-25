import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface QualitySnapshotRow {
  snapshotId: string;
  manuscriptVersionId: string;
  dimensionsJson: string;
  hardBlocked: boolean;
}

export class ManuscriptQualitySnapshotRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public findByPanel(scope: BookScope, manuscriptVersionId: string, reviewPanelId: string): QualitySnapshotRow | null {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT manuscript_quality_snapshot_id, manuscript_version_id, dimensions_json, hard_blocked
      FROM manuscript_quality_snapshots
      WHERE owner_id = ? AND book_id = ? AND manuscript_version_id = ? AND review_panel_id = ?
    `).get(scope.ownerId, scope.bookId, manuscriptVersionId, reviewPanelId) as SnapshotSqlRow | undefined;
    return row === undefined ? null : mapSnapshot(row);
  }

  public best(scope: BookScope, chapterId: string): QualitySnapshotRow | null {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT manuscript_quality_snapshot_id, manuscript_version_id, dimensions_json, hard_blocked
      FROM manuscript_quality_snapshots
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND is_best = 1
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, chapterId) as SnapshotSqlRow | undefined;
    return row === undefined ? null : mapSnapshot(row);
  }

  public insert(scope: BookScope, input: {
    snapshotId: string;
    chapterId: string;
    manuscriptVersionId: string;
    reviewPanelId: string;
    parentSnapshotId: string | null;
    dimensionsJson: string;
    hardBlocked: boolean;
    policyVersion: string;
    now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`
      INSERT INTO manuscript_quality_snapshots (
        manuscript_quality_snapshot_id, owner_id, book_id, chapter_id,
        manuscript_version_id, review_panel_id, parent_snapshot_id,
        dimensions_json, hard_blocked, is_best, policy_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      input.snapshotId, scope.ownerId, scope.bookId, input.chapterId,
      input.manuscriptVersionId, input.reviewPanelId, input.parentSnapshotId,
      input.dimensionsJson, input.hardBlocked ? 1 : 0, input.policyVersion, input.now
    );
  }

  public selectBest(scope: BookScope, chapterId: string, snapshotId: string): void {
    assertBookScope(scope);
    this.database.prepare(`
      UPDATE manuscript_quality_snapshots SET is_best = 0
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND is_best = 1
    `).run(scope.ownerId, scope.bookId, chapterId);
    const selected = this.database.prepare(`
      UPDATE manuscript_quality_snapshots SET is_best = 1
      WHERE manuscript_quality_snapshot_id = ? AND owner_id = ? AND book_id = ? AND chapter_id = ?
    `).run(snapshotId, scope.ownerId, scope.bookId, chapterId);
    if (selected.changes !== 1) throw new Error('待选质量快照不存在或不属于当前书籍章节');
  }

  public restoreBest(scope: BookScope, input: {
    chapterId: string;
    rejectedVersionId: string;
    bestVersionId: string;
    pipelineRunId: string;
    now: string;
  }): void {
    assertBookScope(scope);
    const best = this.database.prepare(`
      SELECT 1 FROM manuscript_versions
      WHERE manuscript_version_id = ? AND owner_id = ? AND book_id = ? AND chapter_id = ?
    `).get(input.bestVersionId, scope.ownerId, scope.bookId, input.chapterId);
    if (best === undefined) throw new Error('上一最佳稿不存在或不属于当前书籍章节');
    this.database.prepare(`
      UPDATE manuscript_versions SET status = 'rejected'
      WHERE manuscript_version_id = ? AND owner_id = ? AND book_id = ? AND chapter_id = ?
        AND status NOT IN ('approved', 'canon')
    `).run(input.rejectedVersionId, scope.ownerId, scope.bookId, input.chapterId);
    this.database.prepare(`
      UPDATE revision_orders SET status = 'cancelled'
      WHERE manuscript_version_id = ? AND owner_id = ? AND book_id = ? AND status = 'active'
    `).run(input.rejectedVersionId, scope.ownerId, scope.bookId);
    const chapter = this.database.prepare(`
      UPDATE chapters SET current_manuscript_version_id = ?, generation_status = 'completed',
        updated_at = ?, version = version + 1
      WHERE chapter_id = ? AND owner_id = ? AND book_id = ?
    `).run(input.bestVersionId, input.now, input.chapterId, scope.ownerId, scope.bookId);
    const pipeline = this.database.prepare(`
      UPDATE chapter_pipeline_runs SET current_manuscript_version_id = ?, updated_at = ?
      WHERE pipeline_run_id = ? AND owner_id = ? AND book_id = ?
    `).run(input.bestVersionId, input.now, input.pipelineRunId, scope.ownerId, scope.bookId);
    if (chapter.changes !== 1 || pipeline.changes !== 1) {
      throw new Error('最佳稿恢复目标不存在、越权或状态已经变化');
    }
  }
}

interface SnapshotSqlRow {
  manuscript_quality_snapshot_id: string;
  manuscript_version_id: string;
  dimensions_json: string;
  hard_blocked: number;
}

function mapSnapshot(row: SnapshotSqlRow): QualitySnapshotRow {
  return {
    snapshotId: row.manuscript_quality_snapshot_id,
    manuscriptVersionId: row.manuscript_version_id,
    dimensionsJson: row.dimensions_json,
    hardBlocked: row.hard_blocked === 1
  };
}
