import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface CanonIndexManuscriptRow {
  manuscriptVersionId: string;
  contentHash: string;
  relativePath: string;
  chapterNumber: number;
  title: string;
}

export interface CanonIndexArtifactRow {
  artifactType: string;
  title: string;
  artifactVersionId: string;
  version: number;
  contentJson: string;
}

export interface CanonIndexFactRow {
  factId: string;
  relationKey: string;
  valueJson: string;
  grade: 'A' | 'B' | 'C' | 'D';
  canonicalName: string;
  epistemicStatus: 'objective' | 'claim' | 'belief' | 'lie' | 'dream' | 'plan' | 'counterfactual' | 'ambiguous' | 'conflicted';
  negated: number;
  viewpointName: string | null;
}

export interface CanonIndexManifestMember {
  membershipId: string;
  memberSnapshotId: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: string;
  sourceHash: string;
}

export class CanonIndexRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public requireClaimed(scope: BookScope, requestId: string, workerId: string): { canonRevision: number } {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT canon_revision AS canonRevision FROM canon_index_requests
      WHERE canon_index_request_id = ? AND owner_id = ? AND book_id = ?
        AND status = 'claimed' AND worker_id = ?
    `).get(requestId, scope.ownerId, scope.bookId, workerId) as { canonRevision: number } | undefined;
    if (row === undefined) throw new Error('正史索引请求未由指定Worker持有');
    return row;
  }

  public requireBookCanonRevision(scope: BookScope): number {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT canon_revision AS canonRevision FROM books WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { canonRevision: number } | undefined;
    if (row === undefined) throw new Error('书籍不存在或越权');
    return row.canonRevision;
  }

  public supersede(scope: BookScope, requestId: string, workerId: string, now: string): void {
    assertBookScope(scope);
    const result = this.database.prepare(`
      UPDATE canon_index_requests SET status = 'superseded', worker_id = NULL, claimed_at = NULL,
        updated_at = ?, completed_at = ?
      WHERE canon_index_request_id = ? AND owner_id = ? AND book_id = ?
        AND status = 'claimed' AND worker_id = ?
    `).run(now, now, requestId, scope.ownerId, scope.bookId, workerId);
    if (result.changes !== 1) throw new Error('正史索引请求状态冲突');
  }

  public findReadySnapshot(scope: BookScope, canonRevision: number): string | null {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT chunk_snapshot_id AS snapshotId FROM chunk_snapshots
      WHERE owner_id = ? AND book_id = ? AND canon_revision = ? AND status = 'ready'
        AND snapshot_kind IN ('manifest', 'materialized')
      ORDER BY CASE snapshot_kind WHEN 'manifest' THEN 0 ELSE 1 END, ready_at DESC, created_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, canonRevision) as { snapshotId: string } | undefined;
    return row?.snapshotId ?? null;
  }

  public findReusableSource(scope: BookScope, source: {
    sourceType: string; sourceId: string; sourceVersion: string; sourceHash: string;
    strategyVersion: string; normalizationVersion: string; embeddingTextPolicyVersion: string;
  }): string | null {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT s.chunk_snapshot_id AS memberSnapshotId
      FROM chunk_snapshot_sources s JOIN chunk_snapshots p
        ON p.chunk_snapshot_id = s.chunk_snapshot_id AND p.owner_id = s.owner_id AND p.book_id = s.book_id
      WHERE s.owner_id = ? AND s.book_id = ? AND s.source_type = ? AND s.source_id = ?
        AND s.source_version = ? AND s.source_hash = ? AND p.status = 'ready'
        AND p.snapshot_kind IN ('fragment', 'materialized')
        AND p.strategy_version = ? AND p.normalization_version = ? AND p.embedding_text_policy_version = ?
      ORDER BY p.ready_at DESC, p.created_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, source.sourceType, source.sourceId, source.sourceVersion, source.sourceHash,
      source.strategyVersion, source.normalizationVersion, source.embeddingTextPolicyVersion) as {
      memberSnapshotId: string;
    } | undefined;
    return row?.memberSnapshotId ?? null;
  }

  public createManifest(scope: BookScope, input: {
    snapshotId: string; canonRevision: number; members: CanonIndexManifestMember[]; now: string;
  }): void {
    assertBookScope(scope);
    if (input.members.length === 0) throw new Error('正史索引清单至少需要一个来源成员');
    const policy = this.database.prepare(`
      SELECT strategy_version, normalization_version, embedding_text_policy_version
      FROM chunk_snapshots WHERE owner_id = ? AND book_id = ? AND chunk_snapshot_id = ? AND status = 'ready'
    `).get(scope.ownerId, scope.bookId, input.members[0]!.memberSnapshotId) as {
      strategy_version: string; normalization_version: string; embedding_text_policy_version: string;
    } | undefined;
    if (policy === undefined) throw new Error('正史索引清单成员快照不可用');
    let nodeCount = 0;
    let chunkCount = 0;
    let sourceBytes = 0;
    let coveredBytes = 0;
    const coverageSources: Array<Record<string, unknown>> = [];
    for (const member of input.members) {
      const source = this.database.prepare(`
        SELECT source_bytes FROM chunk_snapshot_sources
        WHERE owner_id = ? AND book_id = ? AND chunk_snapshot_id = ?
          AND source_type = ? AND source_id = ? AND source_version = ? AND source_hash = ?
      `).get(scope.ownerId, scope.bookId, member.memberSnapshotId, member.sourceType, member.sourceId,
        member.sourceVersion, member.sourceHash) as { source_bytes: number } | undefined;
      if (source === undefined) throw new Error(`正史索引来源成员无效：${member.sourceType}/${member.sourceId}`);
      const nodes = this.database.prepare(`SELECT COUNT(*) AS count FROM content_nodes
        WHERE owner_id = ? AND book_id = ? AND chunk_snapshot_id = ? AND source_type = ? AND source_id = ? AND source_version = ?`)
        .get(scope.ownerId, scope.bookId, member.memberSnapshotId, member.sourceType, member.sourceId, member.sourceVersion) as { count: number };
      const chunks = this.database.prepare(`SELECT COUNT(*) AS count,
          COALESCE(SUM(byte_end - byte_start), 0) AS coveredBytes FROM content_chunks
        WHERE owner_id = ? AND book_id = ? AND chunk_snapshot_id = ? AND source_type = ? AND source_id = ? AND source_version = ?
          AND validation_status = 'valid'`)
        .get(scope.ownerId, scope.bookId, member.memberSnapshotId, member.sourceType, member.sourceId, member.sourceVersion) as {
          count: number; coveredBytes: number;
        };
      if (chunks.count === 0) throw new Error(`正史索引来源没有有效切片：${member.sourceType}/${member.sourceId}`);
      nodeCount += nodes.count;
      chunkCount += chunks.count;
      sourceBytes += source.source_bytes;
      coveredBytes += chunks.coveredBytes;
      coverageSources.push({ sourceType: member.sourceType, sourceId: member.sourceId,
        sourceVersion: member.sourceVersion, sourceBytes: source.source_bytes, coveredBytes: chunks.coveredBytes });
    }
    this.database.prepare(`
      INSERT INTO chunk_snapshots (
        chunk_snapshot_id, owner_id, book_id, strategy_version, normalization_version,
        embedding_text_policy_version, canon_revision, source_count, node_count, chunk_count,
        coverage_json, validation_json, status, created_at, validated_at, ready_at, snapshot_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, 'manifest')
    `).run(input.snapshotId, scope.ownerId, scope.bookId, policy.strategy_version, policy.normalization_version,
      policy.embedding_text_policy_version, input.canonRevision, input.members.length, nodeCount, chunkCount,
      JSON.stringify({ sourceBytes, coveredBytes, sources: coverageSources }),
      JSON.stringify({ hashMatched: true, sourceMembershipUnique: true, memberSnapshotsReady: true }),
      input.now, input.now, input.now);
    const insert = this.database.prepare(`
      INSERT INTO chunk_snapshot_memberships (
        chunk_snapshot_membership_id, owner_id, book_id, manifest_snapshot_id, member_snapshot_id,
        source_type, source_id, source_version, source_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const member of input.members) insert.run(member.membershipId, scope.ownerId, scope.bookId,
      input.snapshotId, member.memberSnapshotId, member.sourceType, member.sourceId,
      member.sourceVersion, member.sourceHash, input.now);
  }

  public complete(scope: BookScope, requestId: string, workerId: string, snapshotId: string, now: string): void {
    assertBookScope(scope);
    const result = this.database.prepare(`
      UPDATE canon_index_requests SET status = 'completed', worker_id = NULL, claimed_at = NULL,
        chunk_snapshot_id = ?, error_code = NULL, updated_at = ?, completed_at = ?
      WHERE canon_index_request_id = ? AND owner_id = ? AND book_id = ?
        AND status = 'claimed' AND worker_id = ?
    `).run(snapshotId, now, now, requestId, scope.ownerId, scope.bookId, workerId);
    if (result.changes !== 1) throw new Error('正史索引请求完成栅栏被拒绝');
  }

  public listAuthorityManuscripts(scope: BookScope): CanonIndexManuscriptRow[] {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT m.manuscript_version_id AS manuscriptVersionId, m.content_hash AS contentHash,
        f.relative_path AS relativePath, c.chapter_number AS chapterNumber, c.title
      FROM chapters c
      JOIN manuscript_versions m ON m.manuscript_version_id = c.canon_manuscript_version_id
        AND m.owner_id = c.owner_id AND m.book_id = c.book_id AND m.status = 'canon'
      JOIN file_registry f ON f.file_id = m.file_id AND f.owner_id = m.owner_id
        AND f.book_id = m.book_id AND f.status = 'active'
      WHERE c.owner_id = ? AND c.book_id = ? AND c.settlement_status = 'settled'
      ORDER BY c.chapter_number
    `).all(scope.ownerId, scope.bookId) as unknown as CanonIndexManuscriptRow[];
  }

  public listAuthorityArtifacts(scope: BookScope): CanonIndexArtifactRow[] {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT a.artifact_type AS artifactType, a.title,
        v.artifact_version_id AS artifactVersionId, v.version, v.content_json AS contentJson
      FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.status = 'active' AND v.status = 'selected'
      ORDER BY a.artifact_type, a.title
    `).all(scope.ownerId, scope.bookId) as unknown as CanonIndexArtifactRow[];
  }

  public listAuthorityFacts(scope: BookScope): CanonIndexFactRow[] {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT f.fact_id AS factId, f.relation_key AS relationKey, f.value_json AS valueJson,
        f.grade, e.canonical_name AS canonicalName, f.epistemic_status AS epistemicStatus,
        f.negated, viewpoint.canonical_name AS viewpointName
      FROM fact_assertions f JOIN entities e ON e.entity_id = f.subject_entity_id
        AND e.owner_id = f.owner_id AND e.book_id = f.book_id
      LEFT JOIN entities viewpoint ON viewpoint.entity_id = f.viewpoint_entity_id
        AND viewpoint.owner_id = f.owner_id AND viewpoint.book_id = f.book_id
      WHERE f.owner_id = ? AND f.book_id = ? AND f.status = 'active'
      ORDER BY e.canonical_name, f.relation_key, f.fact_id
    `).all(scope.ownerId, scope.bookId) as unknown as CanonIndexFactRow[];
  }
}
