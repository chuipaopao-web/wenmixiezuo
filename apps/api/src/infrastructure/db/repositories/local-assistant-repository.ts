import type { DatabaseSync } from 'node:sqlite';
import type { BookScope } from '../../../domain/scope.js';

export class LocalAssistantRepository {
  public constructor(private readonly database: DatabaseSync) {}
  public ensureSession(scope: BookScope, input: { id: string; conversationId: string; state: unknown; now: string }): string {
    const existing = this.database.prepare(`SELECT local_assistant_session_id FROM local_assistant_sessions WHERE owner_id = ? AND book_id = ? AND conversation_id = ?`)
      .get(scope.ownerId, scope.bookId, input.conversationId) as { local_assistant_session_id: string } | undefined;
    if (existing !== undefined) return existing.local_assistant_session_id;
    this.database.prepare(`INSERT INTO local_assistant_sessions (
      local_assistant_session_id, owner_id, book_id, conversation_id, state_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`).run(input.id, scope.ownerId, scope.bookId, input.conversationId, JSON.stringify(input.state), input.now, input.now);
    return input.id;
  }
  public insertRouting(scope: BookScope, input: { id: string; sessionId: string; messageId: string; messageHash: string; routeClass: string; riskLevel: string; confidenceBand: string; entities: unknown; sourcePointers: unknown; selectedAction: string; selectedRoles: string[]; excludedActions: string[]; receiptText: string; now: string }): void {
    this.database.prepare(`INSERT INTO message_routing_decisions (
      message_routing_decision_id, owner_id, book_id, local_assistant_session_id, message_id, original_message_hash,
      route_class, risk_level, confidence_band, entities_json, source_pointers_json, selected_action,
      selected_roles_json, excluded_actions_json, receipt_text, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.id, scope.ownerId, scope.bookId, input.sessionId,
      input.messageId, input.messageHash, input.routeClass, input.riskLevel, input.confidenceBand, JSON.stringify(input.entities),
      JSON.stringify(input.sourcePointers), input.selectedAction, JSON.stringify(input.selectedRoles), JSON.stringify(input.excludedActions), input.receiptText, input.now);
  }
  public insertExperience(scope: BookScope, input: { id: string; type: string; rule: unknown; evidence: unknown; counterexamples: unknown; applicability: unknown; expiresAt: string; rollbackCondition: string; now: string }): void {
    this.database.prepare(`INSERT INTO utility_experience_candidates (
      utility_experience_candidate_id, owner_id, book_id, experience_type, rule_json, evidence_json,
      counterexamples_json, applicability_json, expires_at, rollback_condition, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?)`).run(input.id, scope.ownerId, scope.bookId, input.type,
      JSON.stringify(input.rule), JSON.stringify(input.evidence), JSON.stringify(input.counterexamples), JSON.stringify(input.applicability),
      input.expiresAt, input.rollbackCondition, input.now);
  }
}
