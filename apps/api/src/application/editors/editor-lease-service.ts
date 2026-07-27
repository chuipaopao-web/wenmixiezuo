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

export interface AutomaticTakeoverResult {
  takenOver: boolean;
  activeEditorAgentId: string;
  editorEpoch: number;
  reason: string;
}

export interface EditorLeaseStatus extends EditorLease {
  expired: boolean;
}

export interface ExpirySafetyReport {
  hasWorkingTasks: boolean;
  hasWorkingCalls: boolean;
  hasUnknownResultCalls: boolean;
  safeToRevert: boolean;
}

export interface RevertResult {
  reverted: boolean;
  activeEditorAgentId: string;
  editorEpoch: number;
  reason: string;
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
    this.requireEditorAgent(scope, activeEditorAgentId, 'active');
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

  public heartbeatRenew(scope: BookScope, editorAgentId: string, leaseMs = 60_000): EditorLease {
    // P0-4: 主编活动心跳续租。以当前租约的 epoch 续期——只要主编身份与 epoch 未变即续期，
    // 防止租约因无续期调用而过期、又被上层误判为 stable。若主编已被接管，assertEpoch 会拒绝旧主编续租。
    const lease = this.require(scope);
    return this.renew(scope, editorAgentId, lease.editorEpoch, leaseMs);
  }

  public prepareTakeover(scope: BookScope, candidateEditorAgentId: string): { takeoverId: string; package: Record<string, unknown> } {
    assertBookScope(scope);
    this.requireEditorAgent(scope, candidateEditorAgentId, 'candidate');
    this.assertCandidateModelAvailable(scope, candidateEditorAgentId);
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
    const chapters = this.database.prepare(`
      SELECT chapter_id, chapter_number, title, generation_status, settlement_status,
             current_manuscript_version_id, canon_manuscript_version_id
      FROM chapters WHERE owner_id = ? AND book_id = ? ORDER BY chapter_number
    `).all(scope.ownerId, scope.bookId);
    const pendingDecisions = this.database.prepare(`
      SELECT confirmation_id, target_type, target_id, old_value_json,
             new_value_json, scope_json, impact_json, expected_canon_revision,
             status, created_at
      FROM confirmations WHERE owner_id = ? AND book_id = ? AND status = 'pending'
      ORDER BY created_at, confirmation_id
    `).all(scope.ownerId, scope.bookId);
    const packageData = {
      bookId: scope.bookId,
      fromEpoch: lease.editorEpoch,
      canonRevision: book.canon_revision,
      positioningVersion: book.positioning_version,
      chapters,
      tasks,
      modelCalls: calls,
      budgets,
      pendingDecisions
    };
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO takeover_packages (
          takeover_id, owner_id, book_id, from_editor_agent_id, to_editor_agent_id,
          from_epoch, package_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?)
      `).run(takeoverId, scope.ownerId, scope.bookId, lease.activeEditorAgentId, candidateEditorAgentId, lease.editorEpoch, JSON.stringify(packageData), now);
      const prepared = this.database.prepare(`
        UPDATE editor_leases SET candidate_editor_agent_id = ?, takeover_state = 'ready',
          takeover_id = ?, updated_at = ?
        WHERE owner_id = ? AND book_id = ? AND active_editor_agent_id = ?
          AND editor_epoch = ? AND takeover_state = 'stable'
      `).run(candidateEditorAgentId, takeoverId, now, scope.ownerId, scope.bookId,
        lease.activeEditorAgentId, lease.editorEpoch);
      if (prepared.changes !== 1) throw new Error('主编接管状态已经变化，请重新读取当前租约');
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
    this.requireEditorAgent(scope, lease.candidateEditorAgentId, 'candidate');
    this.assertCandidateModelAvailable(scope, lease.candidateEditorAgentId);
    const nextEpoch = lease.editorEpoch + 1;
    const now = this.clock.now();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const leaseUpdated = this.database.prepare(`
        UPDATE editor_leases SET active_editor_agent_id = candidate_editor_agent_id,
          candidate_editor_agent_id = NULL, editor_epoch = ?, lease_expires_at = ?,
          takeover_state = 'stable', takeover_id = NULL, updated_at = ?
        WHERE owner_id = ? AND book_id = ? AND editor_epoch = ? AND takeover_id = ?
      `).run(nextEpoch, new Date(now.getTime() + leaseMs).toISOString(), now.toISOString(), scope.ownerId, scope.bookId, lease.editorEpoch, takeoverId);
      if (leaseUpdated.changes !== 1) throw new Error('主编接管租约已失效，拒绝提交旧接管包');
      const bookUpdated = this.database.prepare(`
        UPDATE books SET active_editor_agent_id = ?, editor_epoch = ?, version = version + 1, updated_at = ?
        WHERE owner_id = ? AND book_id = ? AND editor_epoch = ?
      `).run(lease.candidateEditorAgentId, nextEpoch, now.toISOString(), scope.ownerId, scope.bookId, lease.editorEpoch);
      if (bookUpdated.changes !== 1) throw new Error('书籍主编epoch已变化，接管事务已回滚');
      const candidateModel = this.database.prepare(`SELECT model_snapshot_id FROM agent_instances
        WHERE agent_id = ? AND owner_id = ? AND book_id = ? AND enabled = 1`)
        .get(lease.candidateEditorAgentId, scope.ownerId, scope.bookId) as { model_snapshot_id: string } | undefined;
      if (candidateModel === undefined) throw new Error('候任主编模型快照在接管提交前失效');
      this.database.prepare(`
        INSERT INTO discussion_participants (
          discussion_id, owner_id, book_id, agent_id, invited_reason, responded, model_snapshot_id
        )
        SELECT json_extract(t.task_brief_json, '$.discussionId'), t.owner_id, t.book_id, ?,
          '活动主编故障接管后继续主持', 0, ?
        FROM tasks t JOIN discussions d
          ON d.discussion_id = json_extract(t.task_brief_json, '$.discussionId')
          AND d.owner_id = t.owner_id AND d.book_id = t.book_id
        WHERE t.owner_id = ? AND t.book_id = ? AND t.task_type = 'discussion'
          AND t.status NOT IN ('succeeded', 'failed', 'cancelled')
          AND d.status IN ('collecting', 'cross_review', 'synthesizing')
        ON CONFLICT(discussion_id, agent_id) DO UPDATE SET
          invited_reason = excluded.invited_reason,
          model_snapshot_id = excluded.model_snapshot_id
      `).run(lease.candidateEditorAgentId, candidateModel.model_snapshot_id, scope.ownerId, scope.bookId);
      this.database.prepare(`
        UPDATE task_attempts SET
          status = CASE WHEN EXISTS (
            SELECT 1 FROM model_calls m WHERE m.task_id = task_attempts.task_id
              AND m.owner_id = task_attempts.owner_id AND m.book_id = task_attempts.book_id AND m.state = 'working'
          ) THEN 'interrupted' ELSE 'expired' END,
          error_code = 'EDITOR_TAKEOVER', completed_at = ?
        WHERE owner_id = ? AND book_id = ? AND status = 'working'
      `).run(now.toISOString(), scope.ownerId, scope.bookId);
      this.database.prepare(`
        UPDATE tasks SET required_editor_epoch = ?,
          assigned_agent_id = CASE WHEN task_type IN ('discussion', 'conversation_reply') THEN ? ELSE assigned_agent_id END,
          task_brief_json = CASE
            WHEN task_type = 'conversation_reply'
              THEN json_set(task_brief_json, '$.modelSnapshotId', ?)
            ELSE task_brief_json
          END,
          status = CASE
            WHEN status = 'working' AND EXISTS (
              SELECT 1 FROM model_calls m WHERE m.task_id = tasks.task_id
                AND m.owner_id = tasks.owner_id AND m.book_id = tasks.book_id AND m.state = 'working'
            ) THEN 'interrupted'
            WHEN status = 'working' THEN 'queued'
            ELSE status
          END,
          error_code = CASE WHEN status = 'working' THEN 'EDITOR_TAKEOVER' ELSE error_code END,
          lease_owner = CASE WHEN status = 'working' THEN NULL ELSE lease_owner END,
          lease_token = CASE WHEN status = 'working' THEN NULL ELSE lease_token END,
          lease_expires_at = CASE WHEN status = 'working' THEN NULL ELSE lease_expires_at END,
          heartbeat_at = CASE WHEN status = 'working' THEN NULL ELSE heartbeat_at END,
          updated_at = ?
        WHERE owner_id = ? AND book_id = ? AND status NOT IN ('succeeded', 'failed', 'cancelled')
      `).run(nextEpoch, lease.candidateEditorAgentId, candidateModel.model_snapshot_id,
        now.toISOString(), scope.ownerId, scope.bookId);
      const packageCompleted = this.database.prepare(`
        UPDATE takeover_packages SET status = 'completed', to_epoch = ?, completed_at = ?
        WHERE takeover_id = ? AND owner_id = ? AND book_id = ? AND status = 'ready'
      `).run(nextEpoch, now.toISOString(), takeoverId, scope.ownerId, scope.bookId);
      if (packageCompleted.changes !== 1) throw new Error('接管包状态已变化，接管事务已回滚');
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    this.events?.append(scope, 'agent.presence.changed', { takeoverId, editorEpoch: nextEpoch, activeEditorAgentId: lease.candidateEditorAgentId });
    return this.require(scope);
  }

  public tryAutomaticTakeover(scope: BookScope, failedEditorAgentId: string): AutomaticTakeoverResult {
    const lease = this.require(scope);
    if (lease.activeEditorAgentId !== failedEditorAgentId) {
      return {
        takenOver: false,
        activeEditorAgentId: lease.activeEditorAgentId,
        editorEpoch: lease.editorEpoch,
        reason: '活动主编已经变化，旧故障信号不再触发接管'
      };
    }
    // 自动接管只允许初始主编(epoch 1)向候任者单向切换一次。
    // 后续回切必须经过 safeRevertToChief 的调用状态检查，不能因新的故障信号来回弹跳。
    if (lease.editorEpoch > 1) {
      return {
        takenOver: false,
        activeEditorAgentId: lease.activeEditorAgentId,
        editorEpoch: lease.editorEpoch,
        reason: '副编接管后也发生连续技术故障，系统不会自动切回刚刚失败的主编；请老板检查模型可用性后再决定'
      };
    }
    const candidate = this.database.prepare(`
      SELECT a.agent_id FROM agent_instances a JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1 AND a.agent_id <> ?
        AND r.role_key IN ('chief_editor', 'deputy_editor')
      ORDER BY CASE r.role_key WHEN 'deputy_editor' THEN 0 ELSE 1 END, a.created_at, a.agent_id LIMIT 1
    `).get(scope.ownerId, scope.bookId, failedEditorAgentId) as { agent_id: string } | undefined;
    if (candidate === undefined) {
      return { takenOver: false, activeEditorAgentId: lease.activeEditorAgentId, editorEpoch: lease.editorEpoch, reason: '没有已启用的候任主编' };
    }
    try {
      const prepared = this.prepareTakeover(scope, candidate.agent_id);
      const completed = this.completeTakeover(scope, prepared.takeoverId);
      return {
        takenOver: true,
        activeEditorAgentId: completed.activeEditorAgentId,
        editorEpoch: completed.editorEpoch,
        reason: '活动主编连续两次技术调用失败，候任模型已有近期成功证据，已完成原子接管'
      };
    } catch (error) {
      return {
        takenOver: false,
        activeEditorAgentId: lease.activeEditorAgentId,
        editorEpoch: lease.editorEpoch,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
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

  public isLeaseExpired(scope: BookScope, now?: Date): boolean {
    const lease = this.require(scope);
    const at = now ?? this.clock.now();
    return Date.parse(lease.leaseExpiresAt) <= at.getTime();
  }

  public describeLease(scope: BookScope): EditorLeaseStatus {
    const lease = this.require(scope);
    const expired = Date.parse(lease.leaseExpiresAt) <= this.clock.now().getTime();
    return { ...lease, expired };
  }

  public evaluateExpirySafety(scope: BookScope): ExpirySafetyReport {
    assertBookScope(scope);
    const workingTasks = this.database.prepare(`
      SELECT COUNT(*) AS count FROM tasks
      WHERE owner_id = ? AND book_id = ? AND status = 'working'
    `).get(scope.ownerId, scope.bookId) as { count: number };
    const workingCalls = this.database.prepare(`
      SELECT COUNT(*) AS count FROM model_calls
      WHERE owner_id = ? AND book_id = ? AND state = 'working'
    `).get(scope.ownerId, scope.bookId) as { count: number };
    const unknownResultCalls = this.database.prepare(`
      SELECT COUNT(*) AS count FROM model_calls
      WHERE owner_id = ? AND book_id = ? AND state IN ('pending', 'working', 'interrupted')
    `).get(scope.ownerId, scope.bookId) as { count: number };
    // 安全回切边界：只有在途模型调用与结果未知调用都为 0 时才允许切人，避免丢失正在生成的结果
    const safeToRevert = workingCalls.count === 0 && unknownResultCalls.count === 0;
    return {
      hasWorkingTasks: workingTasks.count > 0,
      hasWorkingCalls: workingCalls.count > 0,
      hasUnknownResultCalls: unknownResultCalls.count > 0,
      safeToRevert
    };
  }

  public safeRevertToChief(scope: BookScope, preferredChiefAgentId: string): RevertResult {
    assertBookScope(scope);
    const lease = this.require(scope);
    if (lease.activeEditorAgentId === preferredChiefAgentId) {
      return { reverted: false, activeEditorAgentId: lease.activeEditorAgentId, editorEpoch: lease.editorEpoch, reason: '当前活动主编即为目标主编，无需回切' };
    }
    const safety = this.evaluateExpirySafety(scope);
    if (!safety.safeToRevert) {
      return { reverted: false, activeEditorAgentId: lease.activeEditorAgentId, editorEpoch: lease.editorEpoch, reason: '存在进行中或结果未知的模型调用，暂不回切以避免丢失结果' };
    }
    try {
      // 复用 prepareTakeover/completeTakeover 的原子交接与候任模型可用性校验
      const prepared = this.prepareTakeover(scope, preferredChiefAgentId);
      const completed = this.completeTakeover(scope, prepared.takeoverId);
      return { reverted: true, activeEditorAgentId: completed.activeEditorAgentId, editorEpoch: completed.editorEpoch, reason: '原主编模型恢复且无进行中调用，已安全回切' };
    } catch (error) {
      return { reverted: false, activeEditorAgentId: lease.activeEditorAgentId, editorEpoch: lease.editorEpoch, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private requireEditorAgent(scope: BookScope, agentId: string, mode: 'active' | 'candidate'): void {
    const agent = this.database.prepare(`
      SELECT r.role_key, a.role_template_version
      FROM agent_instances a JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.agent_id = ? AND a.owner_id = ? AND a.book_id = ? AND a.enabled = 1
    `).get(agentId, scope.ownerId, scope.bookId) as { role_key: string; role_template_version: number } | undefined;
    if (agent === undefined) throw new Error('主编Agent不存在、停用或跨书');
    if (agent.role_template_version === 2) {
      if (mode === 'active' && agent.role_key !== 'chief_editor') throw new Error('初始活动主编必须使用主编岗位');
      if (mode === 'candidate' && !['chief_editor', 'deputy_editor'].includes(agent.role_key)) {
        throw new Error('候任接管者必须使用主编或副编岗位');
      }
    }
  }

  private assertCandidateModelAvailable(scope: BookScope, agentId: string): void {
    const model = this.database.prepare(`
      SELECT m.provider, m.model_id, json_extract(m.parameters_json, '$.plan') AS plan_type
      FROM agent_instances a JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
      WHERE a.agent_id = ? AND a.owner_id = ? AND a.book_id = ? AND a.enabled = 1
    `).get(agentId, scope.ownerId, scope.bookId) as { provider: string; model_id: string; plan_type: string | null } | undefined;
    if (model === undefined) throw new Error('候任主编缺少有效模型快照');
    if (model.plan_type === 'deterministic' || model.provider.startsWith('local-deterministic')) return;
    const since = new Date(this.clock.now().getTime() - 24 * 60 * 60 * 1_000).toISOString();
    const recentSuccess = this.database.prepare(`
      SELECT 1 FROM model_calls
      WHERE owner_id = ? AND provider = ? AND model_id = ?
        AND state = 'succeeded' AND completed_at >= ? LIMIT 1
    `).get(scope.ownerId, model.provider, model.model_id, since) !== undefined;
    if (!recentSuccess) {
      throw new DomainError(errorCodes.agentCapabilityUnavailable, '候任副编模型当前没有24小时内的成功调用证据，已停止接管并等待老板处理', {
        candidateAgentId: agentId,
        provider: model.provider,
        modelId: model.model_id,
        verificationWindowHours: 24
      }, false, 409);
    }
  }
}
