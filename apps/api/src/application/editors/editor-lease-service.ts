import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { EventStore } from '../events/event-store.js';

export interface EditorLease {
  activeEditorAgentId: string;
  candidateEditorAgentId: string | null;
  editorEpoch: number;
  leaseExpiresAt: string;
  takeoverState: 'stable' | 'preparing' | 'ready';
  takeoverId: string | null;
}

interface LeaseRow {
  active_editor_agent_id: string;
  candidate_editor_agent_id: string | null;
  editor_epoch: number;
  lease_expires_at: string;
  takeover_state: EditorLease['takeoverState'];
  takeover_id: string | null;
}

export class EditorLeaseService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events?: EventStore
  ) {}

  public create(scope: BookScope, activeEditorAgentId: string, leaseMs = 60_000): EditorLease {
    assertBookScope(scope);
    this.requireAgent(scope, activeEditorAgentId);
    const now = this.clock.now();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO editor_leases (
          owner_id, book_id, active_editor_agent_id, editor_epoch,
          lease_expires_at, takeover_state, updated_at
        ) VALUES (?, ?, ?, 1, ?, 'stable', ?)
      `).run(scope.ownerId, scope.bookId, activeEditorAgentId, new Date(now.getTime() + leaseMs).toISOString(), now.toISOString());
      this.database.prepare(`
        UPDATE books SET active_editor_agent_id = ?, editor_epoch = 1, updated_at = ?
        WHERE owner_id = ? AND book_id = ?
      `).run(activeEditorAgentId, now.toISOString(), scope.ownerId, scope.bookId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.require(scope);
  }

  public renew(scope: BookScope, editorAgentId: string, epoch: number, leaseMs = 60_000): EditorLease {
    this.assertEpoch(scope, editorAgentId, epoch);
    const now = this.clock.now();
    this.database.prepare(`
      UPDATE editor_leases SET lease_expires_at = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND active_editor_agent_id = ? AND editor_epoch = ?
    `).run(new Date(now.getTime() + leaseMs).toISOString(), now.toISOString(), scope.ownerId, scope.bookId, editorAgentId, epoch);
    return this.require(scope);
  }

  public prepareTakeover(scope: BookScope, candidateEditorAgentId: string): { takeoverId: string; package: Record<string, unknown> } {
    assertBookScope(scope);
    this.requireAgent(scope, candidateEditorAgentId);
    const lease = this.require(scope);
    if (lease.activeEditorAgentId === candidateEditorAgentId) throw new Error('候任主编不能与活动主编相同');
    const takeoverId = this.ids.next();
    const now = this.clock.now().toISOString();
    const book = this.database.prepare(`
      SELECT canon_revision, positioning_version FROM books WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { canon_revision: number; positioning_version: number };
    const tasks = this.database.prepare(`
      SELECT task_id, status, current_phase, checkpoint_json, budget_id
      FROM tasks WHERE owner_id = ? AND book_id = ? AND status NOT IN ('succeeded', 'failed', 'cancelled')
      ORDER BY created_at
    `).all(scope.ownerId, scope.bookId);
    const calls = this.database.prepare(`
      SELECT request_id, task_id, state, provider, model_id
      FROM model_calls WHERE owner_id = ? AND book_id = ? AND state IN ('pending', 'working', 'interrupted')
      ORDER BY created_at
    `).all(scope.ownerId, scope.bookId);
    const budgets = this.database.prepare(`
      SELECT budget_id, token_limit, reserved_tokens, spent_tokens, cash_limit_micros,
             reserved_cash_micros, spent_cash_micros, status
      FROM budgets WHERE owner_id = ? AND book_id = ? AND status <> 'closed'
    `).all(scope.ownerId, scope.bookId);
    const packageData = {
      bookId: scope.bookId,
      fromEpoch: lease.editorEpoch,
      canonRevision: book.canon_revision,
      positioningVersion: book.positioning_version,
      tasks,
      modelCalls: calls,
      budgets,
      pendingDecisions: []
    };
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO takeover_packages (
          takeover_id, owner_id, book_id, from_editor_agent_id, to_editor_agent_id,
          from_epoch, package_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?)
      `).run(takeoverId, scope.ownerId, scope.bookId, lease.activeEditorAgentId, candidateEditorAgentId, lease.editorEpoch, JSON.stringify(packageData), now);
      this.database.prepare(`
        UPDATE editor_leases SET candidate_editor_agent_id = ?, takeover_state = 'ready',
          takeover_id = ?, updated_at = ? WHERE owner_id = ? AND book_id = ?
      `).run(candidateEditorAgentId, takeoverId, now, scope.ownerId, scope.bookId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return { takeoverId, package: packageData };
  }

  public completeTakeover(scope: BookScope, takeoverId: string, leaseMs = 60_000): EditorLease {
    const lease = this.require(scope);
    if (lease.takeoverId !== takeoverId || lease.takeoverState !== 'ready' || lease.candidateEditorAgentId === null) {
      throw new Error('接管包未就绪或不匹配');
    }
    const nextEpoch = lease.editorEpoch + 1;
    const now = this.clock.now();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        UPDATE editor_leases SET active_editor_agent_id = candidate_editor_agent_id,
          candidate_editor_agent_id = NULL, editor_epoch = ?, lease_expires_at = ?,
          takeover_state = 'stable', takeover_id = NULL, updated_at = ?
        WHERE owner_id = ? AND book_id = ? AND editor_epoch = ? AND takeover_id = ?
      `).run(nextEpoch, new Date(now.getTime() + leaseMs).toISOString(), now.toISOString(), scope.ownerId, scope.bookId, lease.editorEpoch, takeoverId);
      this.database.prepare(`
        UPDATE books SET active_editor_agent_id = ?, editor_epoch = ?, version = version + 1, updated_at = ?
        WHERE owner_id = ? AND book_id = ? AND editor_epoch = ?
      `).run(lease.candidateEditorAgentId, nextEpoch, now.toISOString(), scope.ownerId, scope.bookId, lease.editorEpoch);
      this.database.prepare(`
        UPDATE tasks SET required_editor_epoch = ?, updated_at = ?
        WHERE owner_id = ? AND book_id = ? AND status NOT IN ('succeeded', 'failed', 'cancelled')
      `).run(nextEpoch, now.toISOString(), scope.ownerId, scope.bookId);
      this.database.prepare(`
        UPDATE takeover_packages SET status = 'completed', to_epoch = ?, completed_at = ?
        WHERE takeover_id = ? AND owner_id = ? AND book_id = ? AND status = 'ready'
      `).run(nextEpoch, now.toISOString(), takeoverId, scope.ownerId, scope.bookId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    this.events?.append(scope, 'agent.presence.changed', { takeoverId, editorEpoch: nextEpoch, activeEditorAgentId: lease.candidateEditorAgentId });
    return this.require(scope);
  }

  public assertEpoch(scope: BookScope, editorAgentId: string, epoch: number): void {
    const lease = this.require(scope);
    if (lease.activeEditorAgentId !== editorAgentId || lease.editorEpoch !== epoch) {
      throw new DomainError(errorCodes.editorEpochConflict, '主编epoch已经变化，旧指令被拒绝', {
        currentEpoch: lease.editorEpoch,
        activeEditorAgentId: lease.activeEditorAgentId
      }, false, 409);
    }
  }

  public require(scope: BookScope): EditorLease {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT active_editor_agent_id, candidate_editor_agent_id, editor_epoch,
             lease_expires_at, takeover_state, takeover_id
      FROM editor_leases WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as LeaseRow | undefined;
    if (row === undefined) throw new Error('活动主编租约不存在');
    return {
      activeEditorAgentId: row.active_editor_agent_id,
      candidateEditorAgentId: row.candidate_editor_agent_id,
      editorEpoch: row.editor_epoch,
      leaseExpiresAt: row.lease_expires_at,
      takeoverState: row.takeover_state,
      takeoverId: row.takeover_id
    };
  }

  private requireAgent(scope: BookScope, agentId: string): void {
    const agent = this.database.prepare(`
      SELECT 1 FROM agent_instances WHERE agent_id = ? AND owner_id = ? AND book_id = ? AND enabled = 1
    `).get(agentId, scope.ownerId, scope.bookId);
    if (agent === undefined) throw new Error('主编Agent不存在、停用或跨书');
  }
}

