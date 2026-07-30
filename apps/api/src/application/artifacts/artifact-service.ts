import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { hashJson } from '../books/adaptation-rules.js';
import { validateArtifactContent } from '../../domain/artifact-schemas.js';
import type { ArtifactType } from '../../domain/artifact-schemas.js';
export type { ArtifactType } from '../../domain/artifact-schemas.js';

export interface ArtifactVersionRecord {
  artifactVersionId: string;
  artifactId: string;
  version: number;
  parentVersionId: string | null;
  positioningVersion: number;
  adaptationSnapshotId: string;
  content: Record<string, unknown>;
  contentHash: string;
  status: 'draft' | 'candidate' | 'selected' | 'superseded' | 'invalidated';
  createdAt: string;
}

interface VersionRow {
  artifact_version_id: string;
  artifact_id: string;
  version: number;
  parent_version_id: string | null;
  positioning_version: number;
  adaptation_snapshot_id: string;
  content_json: string;
  content_hash: string;
  status: ArtifactVersionRecord['status'];
  created_at: string;
}

export class ArtifactService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public create(scope: BookScope, type: ArtifactType, title: string, content: Record<string, unknown>, status: 'draft' | 'candidate' = 'draft'): ArtifactVersionRecord {
    assertBookScope(scope);
    validateArtifactContent(type, content);
    const book = this.database.prepare('SELECT positioning_version FROM books WHERE owner_id = ? AND book_id = ?')
      .get(scope.ownerId, scope.bookId) as { positioning_version: number } | undefined;
    if (book === undefined) throw new Error('书籍不存在或越权');
    const adaptation = this.database.prepare(`
      SELECT adaptation_snapshot_id FROM adaptation_snapshots
      WHERE owner_id = ? AND book_id = ? AND active = 1
    `).get(scope.ownerId, scope.bookId) as { adaptation_snapshot_id: string } | undefined;
    if (adaptation === undefined) throw new Error('缺少活动题材适配快照');
    const artifactId = this.ids.next();
    const versionId = this.ids.next();
    const now = this.clock.now().toISOString();
    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO artifacts (
          artifact_id, owner_id, book_id, artifact_type, title, status, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'draft', 1, ?, ?)
      `).run(artifactId, scope.ownerId, scope.bookId, type, title, now, now);
      this.insertVersion(scope, artifactId, versionId, 1, null, book.positioning_version, adaptation.adaptation_snapshot_id, content, status, now);
      if (ownsTransaction) this.database.exec('COMMIT');
    } catch (error) {
      if (ownsTransaction && this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
    return this.requireVersion(scope, versionId);
  }

  public addVersion(scope: BookScope, artifactId: string, content: Record<string, unknown>, parentVersionId: string | null = null): ArtifactVersionRecord {
    const artifact = this.requireArtifact(scope, artifactId);
    validateArtifactContent(artifact.artifact_type, content);
    const book = this.database.prepare('SELECT positioning_version FROM books WHERE owner_id = ? AND book_id = ?')
      .get(scope.ownerId, scope.bookId) as { positioning_version: number };
    const adaptation = this.database.prepare(`SELECT adaptation_snapshot_id FROM adaptation_snapshots WHERE owner_id = ? AND book_id = ? AND active = 1`)
      .get(scope.ownerId, scope.bookId) as { adaptation_snapshot_id: string };
    const next = this.database.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM artifact_versions WHERE artifact_id = ?')
      .get(artifactId) as { next: number };
    const versionId = this.ids.next();
    const now = this.clock.now().toISOString();
    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
      this.insertVersion(scope, artifactId, versionId, next.next, parentVersionId ?? artifact.active_version_id, book.positioning_version, adaptation.adaptation_snapshot_id, content, 'candidate', now);
      this.database.prepare('UPDATE artifacts SET version = version + 1, updated_at = ? WHERE artifact_id = ? AND owner_id = ? AND book_id = ?')
        .run(now, artifactId, scope.ownerId, scope.bookId);
      if (ownsTransaction) this.database.exec('COMMIT');
    } catch (error) {
      if (ownsTransaction && this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
    return this.requireVersion(scope, versionId);
  }

  public select(scope: BookScope, artifactId: string, versionId: string): ArtifactVersionRecord {
    const artifact = this.requireArtifact(scope, artifactId);
    const version = this.requireVersion(scope, versionId);
    if (version.artifactId !== artifactId) throw new Error('成果版本不属于指定成果');
    const now = this.clock.now().toISOString();
    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare("UPDATE artifact_versions SET status = 'superseded' WHERE artifact_id = ? AND status = 'selected'").run(artifactId);
      this.database.prepare("UPDATE artifact_versions SET status = 'selected' WHERE artifact_version_id = ? AND owner_id = ? AND book_id = ?")
        .run(versionId, scope.ownerId, scope.bookId);
      this.database.prepare("UPDATE artifacts SET active_version_id = ?, status = 'active', updated_at = ? WHERE artifact_id = ? AND owner_id = ? AND book_id = ?")
        .run(versionId, now, artifactId, scope.ownerId, scope.bookId);
      this.synchronizePlanningStateAfterSelection(scope, artifactId, artifact.artifact_type, versionId, now);
      if (ownsTransaction) this.database.exec('COMMIT');
    } catch (error) {
      if (ownsTransaction && this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
    return this.requireVersion(scope, versionId);
  }

  private synchronizePlanningStateAfterSelection(
    scope: BookScope,
    artifactId: string,
    artifactType: ArtifactType,
    versionId: string,
    now: string
  ): void {
    if (artifactType === 'story_bible') {
      this.database.prepare(`
        UPDATE book_planning_states
        SET version = version + 1, stage = 'setting_ready',
            setting_baseline_version_id = ?, master_outline_version_id = NULL,
            volume_outline_version_id = NULL, updated_at = ?
        WHERE owner_id = ? AND book_id = ?
          AND setting_baseline_version_id IN (
            SELECT artifact_version_id FROM artifact_versions WHERE artifact_id = ?
          )
      `).run(versionId, now, scope.ownerId, scope.bookId, artifactId);
      return;
    }
    if (artifactType === 'master_outline') {
      this.database.prepare(`
        UPDATE book_planning_states
        SET version = version + 1, stage = 'master_outline_ready',
            master_outline_version_id = ?, volume_outline_version_id = NULL, updated_at = ?
        WHERE owner_id = ? AND book_id = ?
          AND master_outline_version_id IN (
            SELECT artifact_version_id FROM artifact_versions WHERE artifact_id = ?
          )
      `).run(versionId, now, scope.ownerId, scope.bookId, artifactId);
      return;
    }
    if (artifactType === 'volume_outline') {
      this.database.prepare(`
        UPDATE book_planning_states
        SET version = version + 1, stage = 'volume_outline_ready',
            volume_outline_version_id = ?, updated_at = ?
        WHERE owner_id = ? AND book_id = ?
          AND volume_outline_version_id IN (
            SELECT artifact_version_id FROM artifact_versions WHERE artifact_id = ?
          )
      `).run(versionId, now, scope.ownerId, scope.bookId, artifactId);
    }
  }

  public revert(scope: BookScope, artifactId: string, historicalVersionId: string): ArtifactVersionRecord {
    const historical = this.requireVersion(scope, historicalVersionId);
    if (historical.artifactId !== artifactId) throw new Error('历史版本不属于指定成果');
    return this.addVersion(scope, artifactId, historical.content, historicalVersionId);
  }

  public compare(scope: BookScope, leftVersionId: string, rightVersionId: string): { same: boolean; leftHash: string; rightHash: string; changedTopLevelKeys: string[] } {
    const left = this.requireVersion(scope, leftVersionId);
    const right = this.requireVersion(scope, rightVersionId);
    const keys = new Set([...Object.keys(left.content), ...Object.keys(right.content)]);
    const changedTopLevelKeys = [...keys].filter((key) => JSON.stringify(left.content[key]) !== JSON.stringify(right.content[key])).sort();
    return { same: left.contentHash === right.contentHash, leftHash: left.contentHash, rightHash: right.contentHash, changedTopLevelKeys };
  }

  public reject(scope: BookScope, artifactId: string, versionId: string): ArtifactVersionRecord {
    const artifact = this.requireArtifact(scope, artifactId);
    const version = this.requireVersion(scope, versionId);
    if (version.artifactId !== artifactId) throw new Error('成果版本不属于指定成果');
    if (artifact.active_version_id === versionId || version.status === 'selected') throw new Error('活动正式版本不能直接否决，请先选定其他版本');
    const result = this.database.prepare(`UPDATE artifact_versions SET status = 'invalidated'
      WHERE artifact_version_id = ? AND artifact_id = ? AND owner_id = ? AND book_id = ? AND status IN ('draft', 'candidate')`)
      .run(versionId, artifactId, scope.ownerId, scope.bookId);
    if (result.changes !== 1) throw new Error('该成果版本当前不能否决');
    return this.requireVersion(scope, versionId);
  }

  public versions(scope: BookScope, artifactId: string): ArtifactVersionRecord[] {
    this.requireArtifact(scope, artifactId);
    const rows = this.database.prepare(`
      SELECT artifact_version_id, artifact_id, version, parent_version_id, positioning_version,
             adaptation_snapshot_id, content_json, content_hash, status, created_at
      FROM artifact_versions WHERE artifact_id = ? AND owner_id = ? AND book_id = ? ORDER BY version
    `).all(artifactId, scope.ownerId, scope.bookId) as unknown as VersionRow[];
    return rows.map(mapVersion);
  }

  public requireVersion(scope: BookScope, versionId: string): ArtifactVersionRecord {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT artifact_version_id, artifact_id, version, parent_version_id, positioning_version,
             adaptation_snapshot_id, content_json, content_hash, status, created_at
      FROM artifact_versions WHERE artifact_version_id = ? AND owner_id = ? AND book_id = ?
    `).get(versionId, scope.ownerId, scope.bookId) as VersionRow | undefined;
    if (row === undefined) throw new Error('成果版本不存在或越权');
    return mapVersion(row);
  }

  private requireArtifact(scope: BookScope, artifactId: string): { active_version_id: string | null; artifact_type: ArtifactType } {
    assertBookScope(scope);
    const row = this.database.prepare('SELECT active_version_id, artifact_type FROM artifacts WHERE artifact_id = ? AND owner_id = ? AND book_id = ?')
      .get(artifactId, scope.ownerId, scope.bookId) as { active_version_id: string | null; artifact_type: ArtifactType } | undefined;
    if (row === undefined) throw new Error('成果不存在或越权');
    return row;
  }

  private insertVersion(
    scope: BookScope,
    artifactId: string,
    versionId: string,
    version: number,
    parentVersionId: string | null,
    positioningVersion: number,
    adaptationSnapshotId: string,
    content: Record<string, unknown>,
    status: 'draft' | 'candidate',
    now: string
  ): void {
    this.database.prepare(`
      INSERT INTO artifact_versions (
        artifact_version_id, artifact_id, owner_id, book_id, version, parent_version_id,
        positioning_version, adaptation_snapshot_id, schema_version, content_json,
        content_hash, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      versionId, artifactId, scope.ownerId, scope.bookId, version, parentVersionId,
      positioningVersion, adaptationSnapshotId, JSON.stringify(content), hashJson(content), status, now
    );
  }
}

function mapVersion(row: VersionRow): ArtifactVersionRecord {
  return {
    artifactVersionId: row.artifact_version_id,
    artifactId: row.artifact_id,
    version: row.version,
    parentVersionId: row.parent_version_id,
    positioningVersion: row.positioning_version,
    adaptationSnapshotId: row.adaptation_snapshot_id,
    content: JSON.parse(row.content_json) as Record<string, unknown>,
    contentHash: row.content_hash,
    status: row.status,
    createdAt: row.created_at
  };
}
