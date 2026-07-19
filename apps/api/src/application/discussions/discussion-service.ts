import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';

export type DiscussionType = 'quick' | 'collaborative' | 'formal';
export type DiscussionStatus = 'collecting' | 'cross_review' | 'synthesizing' | 'reviewing_draft' | 'awaiting_boss' | 'confirmed' | 'rejected' | 'abandoned' | 'superseded';

export interface DiscussionRecord {
  discussionId: string;
  type: DiscussionType;
  scopeText: string;
  status: DiscussionStatus;
  callLimit: number;
  tokenLimit: number;
  callsUsed: number;
  tokensUsed: number;
  participants: Array<{ agentId: string; responded: boolean; reason: string }>;
}

interface DiscussionRow {
  discussion_id: string;
  discussion_type: DiscussionType;
  scope_text: string;
  status: DiscussionStatus;
  call_limit: number;
  token_limit: number;
  calls_used: number;
  tokens_used: number;
}

const limits = {
  quick: { calls: 3, tokens: 40_000, min: 2, max: 3 },
  collaborative: { calls: 7, tokens: 160_000, min: 4, max: 6 },
  formal: { calls: 12, tokens: 320_000, min: 3, max: 7 }
} as const;

export class DiscussionService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public create(scope: BookScope, input: { type: DiscussionType; scopeText: string; createdByAgentId: string; participants: Array<{ agentId: string; reason: string }> }): DiscussionRecord {
    assertBookScope(scope);
    const policy = limits[input.type];
    const unique = [...new Map(input.participants.map((participant) => [participant.agentId, participant])).values()];
    if (unique.length < policy.min || unique.length > policy.max) throw new Error(`${input.type}讨论参与者必须为${policy.min}至${policy.max}人`);
    if (!unique.some((participant) => participant.agentId === input.createdByAgentId)) throw new Error('主持主编必须在参与者中');
    const placeholders = unique.map(() => '?').join(',');
    const valid = this.database.prepare(`
      SELECT agent_id, model_snapshot_id FROM agent_instances
      WHERE owner_id = ? AND book_id = ? AND enabled = 1 AND agent_id IN (${placeholders})
    `).all(scope.ownerId, scope.bookId, ...unique.map((participant) => participant.agentId)) as unknown as Array<{ agent_id: string; model_snapshot_id: string }>;
    if (valid.length !== unique.length) throw new Error('讨论参与者包含跨书、停用或不存在Agent');
    const snapshots = new Map(valid.map((agent) => [agent.agent_id, agent.model_snapshot_id]));
    const discussionId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO discussions (
          discussion_id, owner_id, book_id, discussion_type, scope_text, status,
          call_limit, token_limit, created_by_agent_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'collecting', ?, ?, ?, ?, ?)
      `).run(discussionId, scope.ownerId, scope.bookId, input.type, input.scopeText, policy.calls, policy.tokens, input.createdByAgentId, now, now);
      const insert = this.database.prepare(`
        INSERT INTO discussion_participants (discussion_id, owner_id, book_id, agent_id, invited_reason, model_snapshot_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const participant of unique) insert.run(
        discussionId, scope.ownerId, scope.bookId, participant.agentId, participant.reason, snapshots.get(participant.agentId)!
      );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.require(scope, discussionId);
  }

  public addOpinion(
    scope: BookScope,
    discussionId: string,
    input: { agentId: string; modelSnapshotId: string; phase: 'independent' | 'cross_review' | 'supplement' | 'objection'; content: Record<string, unknown>; tokens: number }
  ): string {
    const discussion = this.require(scope, discussionId);
    if (!['collecting', 'cross_review', 'reviewing_draft'].includes(discussion.status)) throw new Error('当前讨论阶段不接收意见');
    if (discussion.callsUsed + 1 > discussion.callLimit || discussion.tokensUsed + input.tokens > discussion.tokenLimit) throw new Error('讨论预算已耗尽');
    const participant = this.database.prepare(`
      SELECT 1 FROM discussion_participants p
      JOIN agent_instances a ON a.agent_id = p.agent_id AND a.owner_id = p.owner_id AND a.book_id = p.book_id
      WHERE p.discussion_id = ? AND p.owner_id = ? AND p.book_id = ? AND p.agent_id = ?
        AND COALESCE(p.model_snapshot_id, a.model_snapshot_id) = ?
    `).get(discussionId, scope.ownerId, scope.bookId, input.agentId, input.modelSnapshotId);
    if (participant === undefined) throw new Error('意见来源不是本讨论真实参与者或模型快照不匹配');
    const opinionId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO discussion_opinions (
          opinion_id, discussion_id, owner_id, book_id, agent_id,
          model_snapshot_id, content_json, phase, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(opinionId, discussionId, scope.ownerId, scope.bookId, input.agentId, input.modelSnapshotId, JSON.stringify(input.content), input.phase, now);
      this.database.prepare(`UPDATE discussion_participants SET responded = 1 WHERE discussion_id = ? AND agent_id = ?`)
        .run(discussionId, input.agentId);
      this.database.prepare(`UPDATE discussions SET calls_used = calls_used + 1, tokens_used = tokens_used + ?, updated_at = ? WHERE discussion_id = ?`)
        .run(input.tokens, now, discussionId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return opinionId;
  }

  public setStage(scope: BookScope, discussionId: string, expected: DiscussionStatus, next: DiscussionStatus): DiscussionRecord {
    const allowed: Record<string, string[]> = {
      collecting: ['cross_review', 'synthesizing', 'abandoned'],
      cross_review: ['synthesizing', 'abandoned'],
      synthesizing: ['reviewing_draft', 'awaiting_boss', 'abandoned'],
      reviewing_draft: ['synthesizing', 'awaiting_boss', 'abandoned'],
      awaiting_boss: ['confirmed', 'rejected', 'superseded']
    };
    if (!(allowed[expected]?.includes(next) ?? false)) throw new Error('讨论状态转换无效');
    const result = this.database.prepare(`
      UPDATE discussions SET status = ?, updated_at = ?
      WHERE discussion_id = ? AND owner_id = ? AND book_id = ? AND status = ?
    `).run(next, this.clock.now().toISOString(), discussionId, scope.ownerId, scope.bookId, expected);
    if (result.changes !== 1) throw new Error('讨论状态已变化或越权');
    return this.require(scope, discussionId);
  }

  public synthesize(
    scope: BookScope,
    discussionId: string,
    summary: { recommendation: Record<string, unknown>; alternatives: unknown[]; disagreements: unknown[]; impacts: unknown[] }
  ): string {
    const discussion = this.require(scope, discussionId);
    if (!['synthesizing', 'reviewing_draft'].includes(discussion.status)) throw new Error('讨论尚未进入汇总阶段');
    const opinions = this.database.prepare('SELECT COUNT(*) AS count FROM discussion_opinions WHERE discussion_id = ? AND owner_id = ? AND book_id = ?')
      .get(discussionId, scope.ownerId, scope.bookId) as { count: number };
    if (opinions.count === 0) throw new Error('没有真实意见，不能伪造讨论结论');
    const decisionId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO discussion_decisions (
          decision_id, discussion_id, owner_id, book_id, recommendation_json,
          alternatives_json, disagreements_json, impacts_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        decisionId, discussionId, scope.ownerId, scope.bookId, JSON.stringify(summary.recommendation),
        JSON.stringify(summary.alternatives), JSON.stringify(summary.disagreements), JSON.stringify(summary.impacts), now
      );
      this.database.prepare("UPDATE discussions SET status = 'awaiting_boss', updated_at = ? WHERE discussion_id = ?")
        .run(now, discussionId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return decisionId;
  }

  public confirm(scope: BookScope, discussionId: string, decisionId: string): DiscussionRecord {
    const discussion = this.require(scope, discussionId);
    if (discussion.status !== 'awaiting_boss') throw new Error('讨论不在等待老板确认状态');
    const now = this.clock.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const updated = this.database.prepare(`
        UPDATE discussion_decisions SET boss_confirmed = 1, confirmed_at = ?
        WHERE decision_id = ? AND discussion_id = ? AND owner_id = ? AND book_id = ?
      `).run(now, decisionId, discussionId, scope.ownerId, scope.bookId);
      if (updated.changes !== 1) throw new Error('讨论决定不存在或越权');
      this.database.prepare("UPDATE discussions SET status = 'confirmed', updated_at = ? WHERE discussion_id = ?")
        .run(now, discussionId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.require(scope, discussionId);
  }

  public require(scope: BookScope, discussionId: string): DiscussionRecord {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT discussion_id, discussion_type, scope_text, status, call_limit,
             token_limit, calls_used, tokens_used
      FROM discussions WHERE discussion_id = ? AND owner_id = ? AND book_id = ?
    `).get(discussionId, scope.ownerId, scope.bookId) as DiscussionRow | undefined;
    if (row === undefined) throw new Error('讨论不存在或越权');
    const participants = this.database.prepare(`
      SELECT agent_id, responded, invited_reason FROM discussion_participants
      WHERE discussion_id = ? AND owner_id = ? AND book_id = ? ORDER BY agent_id
    `).all(discussionId, scope.ownerId, scope.bookId) as unknown as Array<{ agent_id: string; responded: number; invited_reason: string }>;
    return {
      discussionId: row.discussion_id,
      type: row.discussion_type,
      scopeText: row.scope_text,
      status: row.status,
      callLimit: row.call_limit,
      tokenLimit: row.token_limit,
      callsUsed: row.calls_used,
      tokensUsed: row.tokens_used,
      participants: participants.map((participant) => ({ agentId: participant.agent_id, responded: participant.responded === 1, reason: participant.invited_reason }))
    };
  }
}
