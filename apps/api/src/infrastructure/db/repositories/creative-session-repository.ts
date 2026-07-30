import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  CreativeBlackboard,
  CreativeBlackboardRevision,
  CreativeSessionMode,
  CreativeSessionRecord,
  CreativeSessionStatus,
  NarrativeForecastBranchRecord,
  NarrativeForecastRecord
} from '../../../contracts/creative-session.js';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';
import { stableJson } from '../../../application/knowledge/canon-service.js';

interface CreativeSessionRow {
  creative_session_id: string;
  conversation_id: string;
  status: CreativeSessionStatus;
  mode: CreativeSessionMode;
  active_topic: string;
  current_blackboard_revision: number;
  canon_revision: number;
  session_epoch: number;
  locked_decision_id: string | null;
}

interface ForecastRow {
  narrative_forecast_id: string;
  creative_session_id: string;
  status: NarrativeForecastRecord['status'];
  stale_reason: string | null;
  canon_revision: number;
  blackboard_revision: number;
  source_fingerprint: string;
  branch_count: number;
}

const ACTIVE_STATUSES: CreativeSessionStatus[] = [
  'exploring', 'awaiting_direction', 'planning', 'awaiting_plan', 'ready', 'paused'
];

export class CreativeSessionRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public bookCanonRevision(scope: BookScope): number {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { canon_revision: number } | undefined;
    if (row === undefined) throw new Error('创作会话所属书籍不存在或越权');
    return row.canon_revision;
  }

  public create(scope: BookScope, input: {
    sessionId: string;
    conversationId: string;
    topic: string;
    openedByMessageId: string | null;
    canonRevision: number;
    now: string;
  }): CreativeSessionRecord {
    assertBookScope(scope);
    if (input.topic.trim().length === 0) throw new Error('创作会话议题不能为空');
    const conversation = this.database.prepare(`
      SELECT 1 FROM conversations
      WHERE conversation_id = ? AND owner_id = ? AND book_id = ?
    `).get(input.conversationId, scope.ownerId, scope.bookId);
    if (conversation === undefined) throw new Error('创作会话所属对话不存在或越权');
    if (input.openedByMessageId !== null) {
      const message = this.database.prepare(`
        SELECT 1 FROM messages
        WHERE message_id = ? AND conversation_id = ? AND owner_id = ? AND book_id = ?
      `).get(
        input.openedByMessageId, input.conversationId, scope.ownerId, scope.bookId
      );
      if (message === undefined) throw new Error('创作会话开场消息不存在、越权或不属于指定对话');
    }
    this.database.prepare(`
      INSERT INTO creative_sessions (
        creative_session_id, owner_id, book_id, conversation_id, status, mode,
        active_topic, canon_revision, opened_by_message_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'exploring', 'creative_forecast', ?, ?, ?, ?, ?)
    `).run(
      input.sessionId, scope.ownerId, scope.bookId, input.conversationId,
      input.topic.trim(), input.canonRevision, input.openedByMessageId, input.now, input.now
    );
    return this.require(scope, input.sessionId);
  }

  public active(scope: BookScope): CreativeSessionRecord | null {
    assertBookScope(scope);
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
    const row = this.database.prepare(`
      SELECT creative_session_id, conversation_id, status, mode, active_topic,
        current_blackboard_revision, canon_revision, session_epoch, locked_decision_id
      FROM creative_sessions
      WHERE owner_id = ? AND book_id = ? AND status IN (${placeholders})
      ORDER BY updated_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, ...ACTIVE_STATUSES) as CreativeSessionRow | undefined;
    return row === undefined ? null : mapSession(row);
  }

  public require(scope: BookScope, sessionId: string): CreativeSessionRecord {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT creative_session_id, conversation_id, status, mode, active_topic,
        current_blackboard_revision, canon_revision, session_epoch, locked_decision_id
      FROM creative_sessions
      WHERE creative_session_id = ? AND owner_id = ? AND book_id = ?
    `).get(sessionId, scope.ownerId, scope.bookId) as CreativeSessionRow | undefined;
    if (row === undefined) throw new Error('创作会话不存在或越权');
    return mapSession(row);
  }

  public hasCompletedRollingPlan(scope: BookScope, sessionId: string): boolean {
    assertBookScope(scope);
    this.require(scope, sessionId);
    const planning = this.database.prepare(`
      SELECT stage
      FROM book_planning_states
      WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { stage: string } | undefined;
    if (planning === undefined || !['chapter_outline_ready', 'writing_enabled'].includes(planning.stage)) {
      return false;
    }
    const round = this.database.prepare(`
      SELECT d.status
      FROM creative_session_rounds r
      JOIN discussions d ON d.discussion_id = r.discussion_id
      WHERE r.owner_id = ? AND r.book_id = ? AND r.creative_session_id = ?
        AND r.round_kind = 'locked_planning'
      ORDER BY r.round_number DESC
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, sessionId) as { status: string } | undefined;
    return round?.status === 'confirmed';
  }

  public appendEvent(scope: BookScope, input: {
    eventId: string;
    sessionId: string;
    eventType: 'owner_message' | 'editor_reply' | 'action' | 'status_changed' | 'round_opened' | 'round_completed' | 'direction_locked' | 'session_closed';
    sourceMessageId: string | null;
    payload: Record<string, unknown>;
    now: string;
  }): number {
    this.require(scope, input.sessionId);
    if (input.sourceMessageId !== null) {
      const message = this.database.prepare(`
        SELECT 1 FROM messages
        WHERE message_id = ? AND owner_id = ? AND book_id = ?
      `).get(input.sourceMessageId, scope.ownerId, scope.bookId);
      if (message === undefined) throw new Error('创作会话事件来源消息不存在或越权');
    }
    const sequence = (this.database.prepare(`
      SELECT COALESCE(MAX(sequence_no), 0) + 1 AS sequence
      FROM creative_session_events
      WHERE creative_session_id = ? AND owner_id = ? AND book_id = ?
    `).get(input.sessionId, scope.ownerId, scope.bookId) as { sequence: number }).sequence;
    this.database.prepare(`
      INSERT INTO creative_session_events (
        creative_session_event_id, creative_session_id, owner_id, book_id,
        sequence_no, event_type, source_message_id, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.eventId, input.sessionId, scope.ownerId, scope.bookId, sequence,
      input.eventType, input.sourceMessageId, stableJson(input.payload), input.now
    );
    return sequence;
  }

  public appendBlackboard(scope: BookScope, input: {
    sessionId: string;
    expectedRevision: number;
    payload: CreativeBlackboard;
    sourceFingerprint: string;
    createdBy: 'workflow' | 'chief_editor' | 'boss_action';
    now: string;
    revisionId?: string;
  }): CreativeBlackboardRevision {
    if (input.sourceFingerprint.length !== 64) throw new Error('黑板来源指纹无效');
    const session = this.require(scope, input.sessionId);
    if (session.currentBlackboardRevision !== input.expectedRevision) throw new Error('黑板修订已变化');
    const revision = input.expectedRevision + 1;
    const serialized = stableJson(input.payload);
    const contentHash = createHash('sha256').update(serialized).digest('hex');
    const revisionId = input.revisionId ?? `${input.sessionId}:blackboard:${revision}`;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO creative_blackboard_revisions (
          creative_blackboard_revision_id, creative_session_id, owner_id, book_id,
          revision, previous_revision, payload_json, content_hash, source_fingerprint,
          created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        revisionId, input.sessionId, scope.ownerId, scope.bookId, revision,
        input.expectedRevision === 0 ? null : input.expectedRevision, serialized, contentHash,
        input.sourceFingerprint, input.createdBy, input.now
      );
      const updated = this.database.prepare(`
        UPDATE creative_sessions
        SET current_blackboard_revision = ?, updated_at = ?
        WHERE creative_session_id = ? AND owner_id = ? AND book_id = ?
          AND current_blackboard_revision = ?
      `).run(revision, input.now, input.sessionId, scope.ownerId, scope.bookId, input.expectedRevision);
      if (updated.changes !== 1) throw new Error('黑板修订已变化');
      this.database.prepare(`
        UPDATE narrative_forecasts
        SET status = 'stale', stale_reason = 'blackboard_revision_changed', updated_at = ?
        WHERE creative_session_id = ? AND owner_id = ? AND book_id = ?
          AND status = 'active' AND (
            blackboard_revision <> ? OR source_fingerprint <> ?
          )
      `).run(input.now, input.sessionId, scope.ownerId, scope.bookId, revision, input.sourceFingerprint);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return { revision, payload: input.payload, sourceFingerprint: input.sourceFingerprint, contentHash };
  }

  public blackboard(scope: BookScope, sessionId: string, revision?: number): CreativeBlackboardRevision | null {
    const session = this.require(scope, sessionId);
    const target = revision ?? session.currentBlackboardRevision;
    if (target === 0) return null;
    const row = this.database.prepare(`
      SELECT revision, payload_json, source_fingerprint, content_hash
      FROM creative_blackboard_revisions
      WHERE creative_session_id = ? AND owner_id = ? AND book_id = ? AND revision = ?
    `).get(sessionId, scope.ownerId, scope.bookId, target) as {
      revision: number;
      payload_json: string;
      source_fingerprint: string;
      content_hash: string;
    } | undefined;
    if (row === undefined) throw new Error('创作黑板修订不存在或越权');
    return {
      revision: row.revision,
      payload: JSON.parse(row.payload_json) as CreativeBlackboard,
      sourceFingerprint: row.source_fingerprint,
      contentHash: row.content_hash
    };
  }

  public updateStatus(scope: BookScope, input: {
    sessionId: string;
    expectedStatus: CreativeSessionStatus;
    status: CreativeSessionStatus;
    mode?: CreativeSessionMode;
    lockedDecisionId?: string | null;
    canonRevision?: number;
    now: string;
  }): CreativeSessionRecord {
    if (input.lockedDecisionId !== undefined && input.lockedDecisionId !== null) {
      const decision = this.database.prepare(`
        SELECT 1 FROM discussion_decisions
        WHERE decision_id = ? AND owner_id = ? AND book_id = ?
      `).get(input.lockedDecisionId, scope.ownerId, scope.bookId);
      if (decision === undefined) throw new Error('创作会话锁定决定不存在或越权');
    }
    const result = this.database.prepare(`
      UPDATE creative_sessions
      SET status = ?, mode = COALESCE(?, mode),
        locked_decision_id = CASE WHEN ? = 1 THEN ? ELSE locked_decision_id END,
        canon_revision = COALESCE(?, canon_revision),
        session_epoch = session_epoch + 1, updated_at = ?,
        closed_at = CASE WHEN ? IN ('closed', 'superseded') THEN ? ELSE closed_at END
      WHERE creative_session_id = ? AND owner_id = ? AND book_id = ? AND status = ?
    `).run(
      input.status, input.mode ?? null,
      Object.hasOwn(input, 'lockedDecisionId') ? 1 : 0, input.lockedDecisionId ?? null,
      input.canonRevision ?? null, input.now, input.status, input.now,
      input.sessionId, scope.ownerId, scope.bookId, input.expectedStatus
    );
    if (result.changes !== 1) throw new Error('创作会话状态已变化或越权');
    return this.require(scope, input.sessionId);
  }

  public linkRound(scope: BookScope, input: {
    roundId: string;
    sessionId: string;
    discussionId: string;
    roundKind: 'initial_exploration' | 'major_redirect' | 'locked_planning';
    blackboardRevision: number;
    sourceFingerprint: string;
    now: string;
  }): number {
    const session = this.require(scope, input.sessionId);
    const discussion = this.database.prepare(`
      SELECT 1 FROM discussions
      WHERE discussion_id = ? AND owner_id = ? AND book_id = ?
    `).get(input.discussionId, scope.ownerId, scope.bookId);
    if (discussion === undefined) throw new Error('创作会话轮次所属讨论不存在或越权');
    const blackboard = this.blackboard(scope, input.sessionId, input.blackboardRevision);
    if (blackboard === null || blackboard.sourceFingerprint !== input.sourceFingerprint) {
      throw new Error('创作会话轮次来源黑板不存在或指纹不匹配');
    }
    if (session.currentBlackboardRevision < input.blackboardRevision) {
      throw new Error('创作会话轮次不能引用未来黑板修订');
    }
    const roundNumber = (this.database.prepare(`
      SELECT COALESCE(MAX(round_number), 0) + 1 AS round_number
      FROM creative_session_rounds
      WHERE creative_session_id = ? AND owner_id = ? AND book_id = ?
    `).get(input.sessionId, scope.ownerId, scope.bookId) as { round_number: number }).round_number;
    this.database.prepare(`
      INSERT INTO creative_session_rounds (
        creative_session_round_id, creative_session_id, discussion_id, owner_id, book_id,
        round_number, round_kind, blackboard_revision, source_fingerprint, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)
    `).run(
      input.roundId, input.sessionId, input.discussionId, scope.ownerId, scope.bookId,
      roundNumber, input.roundKind, input.blackboardRevision, input.sourceFingerprint, input.now
    );
    return roundNumber;
  }

  public completeRound(scope: BookScope, input: {
    sessionId: string;
    discussionId: string;
    decisionId: string;
    now: string;
  }): void {
    this.require(scope, input.sessionId);
    const decision = this.database.prepare(`
      SELECT 1 FROM discussion_decisions
      WHERE decision_id = ? AND discussion_id = ? AND owner_id = ? AND book_id = ?
    `).get(
      input.decisionId, input.discussionId, scope.ownerId, scope.bookId
    );
    if (decision === undefined) throw new Error('创作会话完成决定不存在、越权或不属于指定讨论');
    const result = this.database.prepare(`
      UPDATE creative_session_rounds
      SET status = 'completed', completed_decision_id = ?, completed_at = ?
      WHERE creative_session_id = ? AND discussion_id = ?
        AND owner_id = ? AND book_id = ? AND status IN ('queued', 'working')
    `).run(
      input.decisionId,
      input.now,
      input.sessionId,
      input.discussionId,
      scope.ownerId,
      scope.bookId
    );
    if (result.changes !== 1) throw new Error('创作会话轮次不存在、已完成或越权');
    this.appendEvent(scope, {
      eventId: `${input.sessionId}:round-completed:${input.decisionId}`,
      sessionId: input.sessionId,
      eventType: 'round_completed',
      sourceMessageId: null,
      payload: { discussionId: input.discussionId, decisionId: input.decisionId },
      now: input.now
    });
  }

  public createForecast(scope: BookScope, input: {
    forecastId: string;
    sessionId: string;
    discussionId: string | null;
    canonRevision: number;
    blackboardRevision: number;
    sourceFingerprint: string;
    branches: Array<{
      branchId: string;
      ordinal: number;
      title: string;
      proposal: Record<string, unknown>;
      sourceAgentId: string | null;
      sourceOpinionId: string | null;
    }>;
    now: string;
  }): NarrativeForecastRecord {
    const session = this.require(scope, input.sessionId);
    if (input.branches.length < 2 || input.branches.length > 5) throw new Error('剧情预演必须包含2至5个分支');
    if (input.sourceFingerprint.length !== 64) throw new Error('剧情预演来源指纹无效');
    if (session.canonRevision !== input.canonRevision) throw new Error('剧情预演正史修订已变化');
    const blackboard = this.blackboard(scope, input.sessionId, input.blackboardRevision);
    if (blackboard === null || blackboard.sourceFingerprint !== input.sourceFingerprint) {
      throw new Error('剧情预演来源黑板不存在或指纹不匹配');
    }
    if (input.discussionId !== null) {
      const discussion = this.database.prepare(`
        SELECT 1 FROM discussions
        WHERE discussion_id = ? AND owner_id = ? AND book_id = ?
      `).get(input.discussionId, scope.ownerId, scope.bookId);
      if (discussion === undefined) throw new Error('剧情预演所属讨论不存在或越权');
    }
    for (const branch of input.branches) {
      if (branch.sourceAgentId !== null) {
        const agent = this.database.prepare(`
          SELECT 1 FROM agent_instances
          WHERE agent_id = ? AND owner_id = ? AND book_id = ?
        `).get(branch.sourceAgentId, scope.ownerId, scope.bookId);
        if (agent === undefined) throw new Error('剧情预演来源成员不存在或越权');
      }
      if (branch.sourceOpinionId !== null) {
        const opinion = this.database.prepare(`
          SELECT 1 FROM discussion_opinions
          WHERE opinion_id = ? AND owner_id = ? AND book_id = ?
        `).get(branch.sourceOpinionId, scope.ownerId, scope.bookId);
        if (opinion === undefined) throw new Error('剧情预演来源意见不存在或越权');
      }
    }
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        UPDATE narrative_forecasts
        SET status = 'superseded', stale_reason = 'new_forecast_created', updated_at = ?
        WHERE creative_session_id = ? AND owner_id = ? AND book_id = ? AND status = 'active'
      `).run(input.now, input.sessionId, scope.ownerId, scope.bookId);
      this.database.prepare(`
        INSERT INTO narrative_forecasts (
          narrative_forecast_id, creative_session_id, discussion_id, owner_id, book_id,
          canon_revision, blackboard_revision, source_fingerprint, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(
        input.forecastId, input.sessionId, input.discussionId, scope.ownerId, scope.bookId,
        input.canonRevision, input.blackboardRevision, input.sourceFingerprint, input.now, input.now
      );
      const insertBranch = this.database.prepare(`
        INSERT INTO narrative_forecast_branches (
          narrative_forecast_branch_id, narrative_forecast_id, owner_id, book_id,
          ordinal, title, proposal_json, source_agent_id, source_opinion_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const branch of input.branches) {
        insertBranch.run(
          branch.branchId, input.forecastId, scope.ownerId, scope.bookId, branch.ordinal,
          branch.title, stableJson(branch.proposal), branch.sourceAgentId, branch.sourceOpinionId, input.now
        );
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.listForecasts(scope, input.sessionId).find((item) => item.forecastId === input.forecastId)!;
  }

  public markForecastsStale(scope: BookScope, input: {
    sessionId: string;
    canonRevision: number;
    blackboardRevision: number;
    sourceFingerprint: string;
    reason: string;
    now: string;
  }): number {
    const result = this.database.prepare(`
      UPDATE narrative_forecasts
      SET status = 'stale', stale_reason = ?, updated_at = ?
      WHERE creative_session_id = ? AND owner_id = ? AND book_id = ? AND status = 'active'
        AND (canon_revision <> ? OR blackboard_revision <> ? OR source_fingerprint <> ?)
    `).run(
      input.reason, input.now, input.sessionId, scope.ownerId, scope.bookId,
      input.canonRevision, input.blackboardRevision, input.sourceFingerprint
    );
    return Number(result.changes);
  }

  public listForecasts(scope: BookScope, sessionId: string): NarrativeForecastRecord[] {
    this.require(scope, sessionId);
    const rows = this.database.prepare(`
      SELECT f.narrative_forecast_id, f.creative_session_id, f.status, f.stale_reason,
        f.canon_revision, f.blackboard_revision, f.source_fingerprint,
        COUNT(b.narrative_forecast_branch_id) AS branch_count
      FROM narrative_forecasts f
      LEFT JOIN narrative_forecast_branches b
        ON b.narrative_forecast_id = f.narrative_forecast_id
        AND b.owner_id = f.owner_id AND b.book_id = f.book_id
      WHERE f.creative_session_id = ? AND f.owner_id = ? AND f.book_id = ?
      GROUP BY f.narrative_forecast_id
      ORDER BY f.created_at DESC
    `).all(sessionId, scope.ownerId, scope.bookId) as unknown as ForecastRow[];
    return rows.map((row) => ({
      forecastId: row.narrative_forecast_id,
      sessionId: row.creative_session_id,
      status: row.status,
      staleReason: row.stale_reason,
      canonRevision: row.canon_revision,
      blackboardRevision: row.blackboard_revision,
      sourceFingerprint: row.source_fingerprint,
      branchCount: row.branch_count
    }));
  }

  public listForecastBranches(scope: BookScope, forecastId: string): NarrativeForecastBranchRecord[] {
    assertBookScope(scope);
    const exists = this.database.prepare(`
      SELECT 1 FROM narrative_forecasts
      WHERE narrative_forecast_id = ? AND owner_id = ? AND book_id = ?
    `).get(forecastId, scope.ownerId, scope.bookId);
    if (exists === undefined) throw new Error('剧情预测不存在或越权');
    const rows = this.database.prepare(`
      SELECT narrative_forecast_branch_id, narrative_forecast_id, ordinal, title,
        proposal_json, source_agent_id
      FROM narrative_forecast_branches
      WHERE narrative_forecast_id = ? AND owner_id = ? AND book_id = ?
      ORDER BY ordinal
    `).all(forecastId, scope.ownerId, scope.bookId) as unknown as Array<{
      narrative_forecast_branch_id: string;
      narrative_forecast_id: string;
      ordinal: number;
      title: string;
      proposal_json: string;
      source_agent_id: string | null;
    }>;
    return rows.map((row) => ({
      branchId: row.narrative_forecast_branch_id,
      forecastId: row.narrative_forecast_id,
      ordinal: row.ordinal,
      title: row.title,
      proposal: JSON.parse(row.proposal_json) as Record<string, unknown>,
      sourceAgentId: row.source_agent_id
    }));
  }
}

function mapSession(row: CreativeSessionRow): CreativeSessionRecord {
  return {
    sessionId: row.creative_session_id,
    conversationId: row.conversation_id,
    status: row.status,
    mode: row.mode,
    activeTopic: row.active_topic,
    currentBlackboardRevision: row.current_blackboard_revision,
    canonRevision: row.canon_revision,
    sessionEpoch: row.session_epoch,
    lockedDecisionId: row.locked_decision_id
  };
}
