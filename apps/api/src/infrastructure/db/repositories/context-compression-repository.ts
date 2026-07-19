import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export class ContextCompressionRepository {
  public constructor(private readonly database: DatabaseSync) {}
  public active(scope: BookScope, conversationId: string): { snapshotId: string; summary: Record<string, unknown> } | null {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT context_compression_snapshot_id, summary_json FROM context_compression_snapshots
      WHERE owner_id = ? AND book_id = ? AND conversation_id = ? AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, conversationId) as { context_compression_snapshot_id: string; summary_json: string } | undefined;
    return row === undefined ? null : { snapshotId: row.context_compression_snapshot_id, summary: JSON.parse(row.summary_json) as Record<string, unknown> };
  }
  public activate(scope: BookScope, input: {
    snapshotId: string; conversationId: string; previousSnapshotId?: string | null; startId: string; endId: string;
    rangeHash: string; anchorsJson: string; summaryJson: string; probesJson: string; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE context_compression_snapshots SET status = 'superseded' WHERE owner_id = ? AND book_id = ? AND conversation_id = ? AND status = 'active'`)
      .run(scope.ownerId, scope.bookId, input.conversationId);
    this.database.prepare(`
      INSERT INTO context_compression_snapshots (
        context_compression_snapshot_id, owner_id, book_id, conversation_id, previous_snapshot_id,
        source_message_start_id, source_message_end_id, source_range_hash, schema_version, compressor_snapshot_id,
        anchors_json, summary_json, probes_json, status, created_at, activated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'anchored-v1', 'deterministic-extractive-v1', ?, ?, ?, 'active', ?, ?)
    `).run(input.snapshotId, scope.ownerId, scope.bookId, input.conversationId, input.previousSnapshotId ?? null,
      input.startId, input.endId, input.rangeHash, input.anchorsJson, input.summaryJson, input.probesJson, input.now, input.now);
  }
}
