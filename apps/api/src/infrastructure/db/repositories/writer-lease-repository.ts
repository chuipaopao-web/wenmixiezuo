import type { DatabaseSync } from 'node:sqlite';
import type { BookScope } from '../../../domain/scope.js';

export interface WriterLeaseRecord { writerAgentId: string; epoch: number; writingOrderId: string | null; checkpoint: Record<string, unknown>; leaseExpiresAt: string }
export interface WriterAgentEligibility {
  roleKey: string; roleTemplateVersion: number; provider: string; modelId: string; plan: string;
}
export interface WriterModelFailure {
  state: 'failed' | 'interrupted';
  errorClass: string | null;
}
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
  public renew(scope: BookScope, input: { agentId: string; epoch: number; expiresAt: string; now: string }): boolean {
    return this.database.prepare(`UPDATE writer_leases SET lease_expires_at = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND active_writer_agent_id = ? AND writer_epoch = ?
        AND lease_expires_at > ?`)
      .run(input.expiresAt, input.now, scope.ownerId, scope.bookId, input.agentId, input.epoch, input.now).changes === 1;
  }
  public resumeExactOrder(scope: BookScope, input: {
    agentId: string; epoch: number; writingOrderId: string; expiresAt: string; checkpoint: unknown; now: string;
  }): boolean {
    return this.database.prepare(`UPDATE writer_leases SET lease_expires_at = ?, checkpoint_json = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND active_writer_agent_id = ? AND writer_epoch = ?
        AND writing_order_id = ? AND takeover_state = 'stable'`)
      .run(input.expiresAt, JSON.stringify(input.checkpoint), input.now, scope.ownerId, scope.bookId,
        input.agentId, input.epoch, input.writingOrderId).changes === 1;
  }
  public writerAgent(scope: BookScope, agentId: string, modelSnapshotId?: string): WriterAgentEligibility | null {
    const row = this.database.prepare(`SELECT r.role_key, a.role_template_version, m.provider, m.model_id,
      COALESCE(json_extract(m.parameters_json, '$.plan'), 'deterministic') AS plan_type
      FROM agent_instances a JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id = COALESCE(?, a.model_snapshot_id)
        AND m.owner_id = a.owner_id AND m.book_id = a.book_id
      WHERE a.agent_id = ? AND a.owner_id = ? AND a.book_id = ? AND a.enabled = 1`)
      .get(modelSnapshotId ?? null, agentId, scope.ownerId, scope.bookId) as {
        role_key: string; role_template_version: number; provider: string; model_id: string; plan_type: string;
      } | undefined;
    return row === undefined ? null : {
      roleKey: row.role_key, roleTemplateVersion: row.role_template_version,
      provider: row.provider, modelId: row.model_id, plan: row.plan_type
    };
  }
  public hasRecentModelSuccess(scope: BookScope, provider: string, modelId: string, since: string): boolean {
    return this.database.prepare(`SELECT 1 FROM model_calls
      WHERE owner_id = ? AND provider = ? AND model_id = ? AND state = 'succeeded' AND completed_at >= ? LIMIT 1`)
      .get(scope.ownerId, provider, modelId, since) !== undefined;
  }
  public hasWorkingModelCall(scope: BookScope, provider: string, modelId: string): boolean {
    return this.database.prepare(`SELECT 1 FROM model_calls
      WHERE owner_id = ? AND provider = ? AND model_id = ? AND state = 'working' LIMIT 1`)
      .get(scope.ownerId, provider, modelId) !== undefined;
  }
  public recentModelFailure(scope: BookScope, provider: string, modelId: string, since: string): WriterModelFailure | null {
    const row = this.database.prepare(`SELECT state, error_class FROM model_calls
      WHERE owner_id = ? AND provider = ? AND model_id = ?
        AND state IN ('failed', 'interrupted')
        AND COALESCE(completed_at, started_at, created_at) >= ?
      ORDER BY created_at DESC LIMIT 1`)
      .get(scope.ownerId, provider, modelId, since) as { state: 'failed' | 'interrupted'; error_class: string | null } | undefined;
    return row === undefined ? null : { state: row.state, errorClass: row.error_class };
  }
}
