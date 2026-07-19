import type { DatabaseSync } from 'node:sqlite';
import type { BookScope } from '../../../domain/scope.js';

export interface WriterLeaseRecord { writerAgentId: string; epoch: number; writingOrderId: string | null; checkpoint: Record<string, unknown>; leaseExpiresAt: string }
export class WriterLeaseRepository {
  public constructor(private readonly database: DatabaseSync) {}
  public get(scope: BookScope): WriterLeaseRecord | null {
    const row = this.database.prepare(`SELECT active_writer_agent_id, writer_epoch, writing_order_id, checkpoint_json, lease_expires_at
      FROM writer_leases WHERE owner_id = ? AND book_id = ?`).get(scope.ownerId, scope.bookId) as Record<string, string | number> | undefined;
    return row === undefined ? null : { writerAgentId: row.active_writer_agent_id as string, epoch: row.writer_epoch as number,
      writingOrderId: row.writing_order_id as string | null, checkpoint: JSON.parse(row.checkpoint_json as string) as Record<string, unknown>, leaseExpiresAt: row.lease_expires_at as string };
  }
  public initialize(scope: BookScope, input: { agentId: string; writingOrderId?: string; expiresAt: string; checkpoint: unknown; now: string }): void {
    this.database.prepare(`INSERT INTO writer_leases (
      owner_id, book_id, active_writer_agent_id, writer_epoch, writing_order_id, lease_expires_at, takeover_state, checkpoint_json, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, 'stable', ?, ?)`).run(scope.ownerId, scope.bookId, input.agentId, input.writingOrderId ?? null,
      input.expiresAt, JSON.stringify(input.checkpoint), input.now);
  }
  public takeover(scope: BookScope, input: { expectedEpoch: number; agentId: string; writingOrderId?: string; expiresAt: string; checkpoint: unknown; now: string }): boolean {
    return this.database.prepare(`UPDATE writer_leases SET active_writer_agent_id = ?, writer_epoch = writer_epoch + 1,
      writing_order_id = ?, lease_expires_at = ?, takeover_state = 'stable', checkpoint_json = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND writer_epoch = ?`).run(input.agentId, input.writingOrderId ?? null, input.expiresAt,
      JSON.stringify(input.checkpoint), input.now, scope.ownerId, scope.bookId, input.expectedEpoch).changes === 1;
  }
}
