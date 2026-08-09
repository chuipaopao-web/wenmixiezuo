import type { DatabaseSync } from 'node:sqlite';
import type { AuthorInputStatus, AuthorInputSurface, AuthorIntentStrength } from '@wenmi/contracts';
import { DomainError, errorCodes } from '../../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface AuthorPlanningInputRow {
  author_input_id: string;
  owner_id: string;
  book_id: string;
  surface: AuthorInputSurface;
  subject_type: string;
  subject_id: string | null;
  intent_strength: AuthorIntentStrength;
  original_text: string;
  original_text_hash: string;
  scope_notes: string | null;
  status: AuthorInputStatus;
  handling_reason: string | null;
  idempotency_key: string;
  request_hash: string;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
}

export interface AuthorPlanningInputLinkRow {
  link_id: string;
  link_type: 'attachment' | 'mention' | 'application' | 'supersedes';
  sort_order: number;
  target_type: string;
  target_id: string;
  target_version: number | null;
  target_hash: string | null;
  relation: 'attached' | 'mentioned' | 'adopted' | 'adapted' | 'supersedes';
  created_at: string;
}

export interface AuthorPlanningInputDecisionRow {
  decision_id: string;
  author_input_id: string;
  from_status: AuthorInputStatus;
  to_status: Exclude<AuthorInputStatus, 'new' | 'superseded'>;
  handling_reason: string;
  idempotency_key: string;
  request_hash: string;
  created_at: string;
}

const INPUT_COLUMNS = `author_input_id, owner_id, book_id, surface, subject_type, subject_id,
  intent_strength, original_text, original_text_hash, scope_notes, status, handling_reason,
  idempotency_key, request_hash, created_at, updated_at, decided_at`;

export class AuthorPlanningInputRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public findByIdempotencyKey(scope: BookScope, idempotencyKey: string): AuthorPlanningInputRow | null {
    assertBookScope(scope);
    return this.database.prepare(`SELECT ${INPUT_COLUMNS} FROM author_planning_inputs
      WHERE owner_id = ? AND book_id = ? AND idempotency_key = ?`)
      .get(scope.ownerId, scope.bookId, idempotencyKey) as AuthorPlanningInputRow | undefined ?? null;
  }

  public insert(scope: BookScope, input: {
    id: string; surface: AuthorInputSurface; subjectType: string; subjectId: string | null;
    intentStrength: AuthorIntentStrength; originalText: string; originalTextHash: string;
    scopeNotes: string | null; idempotencyKey: string; requestHash: string; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`INSERT INTO author_planning_inputs (
      author_input_id, owner_id, book_id, surface, subject_type, subject_id,
      intent_strength, original_text, original_text_hash, scope_notes, status,
      idempotency_key, request_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`)
      .run(input.id, scope.ownerId, scope.bookId, input.surface, input.subjectType, input.subjectId,
        input.intentStrength, input.originalText, input.originalTextHash, input.scopeNotes,
        input.idempotencyKey, input.requestHash, input.now, input.now);
  }

  public require(scope: BookScope, authorInputId: string): AuthorPlanningInputRow {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT ${INPUT_COLUMNS} FROM author_planning_inputs
      WHERE owner_id = ? AND book_id = ? AND author_input_id = ?`)
      .get(scope.ownerId, scope.bookId, authorInputId) as AuthorPlanningInputRow | undefined;
    if (row === undefined) {
      throw new DomainError(errorCodes.validation, '作者想法不存在或不属于当前书籍。', {}, false, 404);
    }
    return row;
  }

  public list(scope: BookScope, filter: { surface?: AuthorInputSurface; subjectType?: string; subjectId?: string }): AuthorPlanningInputRow[] {
    assertBookScope(scope);
    const conditions = ['owner_id = ?', 'book_id = ?'];
    const parameters: Array<string> = [scope.ownerId, scope.bookId];
    if (filter.surface !== undefined) { conditions.push('surface = ?'); parameters.push(filter.surface); }
    if (filter.subjectType !== undefined) { conditions.push('subject_type = ?'); parameters.push(filter.subjectType); }
    if (filter.subjectId !== undefined) { conditions.push('subject_id = ?'); parameters.push(filter.subjectId); }
    return this.database.prepare(`SELECT ${INPUT_COLUMNS} FROM author_planning_inputs
      WHERE ${conditions.join(' AND ')} ORDER BY created_at, author_input_id`).all(...parameters) as unknown as AuthorPlanningInputRow[];
  }

  public insertLink(scope: BookScope, input: {
    id: string; authorInputId: string; decisionId: string | null;
    linkType: AuthorPlanningInputLinkRow['link_type']; targetType: string; targetId: string;
    targetVersion: number | null; targetHash: string | null; relation: AuthorPlanningInputLinkRow['relation'];
    sortOrder: number; now: string;
  }): void {
    this.database.prepare(`INSERT INTO author_planning_input_links (
      link_id, owner_id, book_id, author_input_id, decision_id, link_type,
      target_type, target_id, target_version, target_hash, relation, sort_order, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.id, scope.ownerId, scope.bookId, input.authorInputId, input.decisionId, input.linkType,
        input.targetType, input.targetId, input.targetVersion, input.targetHash, input.relation,
        input.sortOrder, input.now);
  }

  public links(scope: BookScope, authorInputId: string): AuthorPlanningInputLinkRow[] {
    return this.database.prepare(`SELECT link_id, link_type, sort_order, target_type, target_id, target_version,
      target_hash, relation, created_at FROM author_planning_input_links
      WHERE owner_id = ? AND book_id = ? AND author_input_id = ?
      ORDER BY created_at, link_type, sort_order, link_id`)
      .all(scope.ownerId, scope.bookId, authorInputId) as unknown as AuthorPlanningInputLinkRow[];
  }

  public agentExists(scope: BookScope, agentId: string): boolean {
    return this.database.prepare(`SELECT 1 FROM agent_instances
      WHERE owner_id = ? AND book_id = ? AND agent_id = ? AND enabled = 1`)
      .get(scope.ownerId, scope.bookId, agentId) !== undefined;
  }

  public attachmentExists(scope: BookScope, attachmentId: string): boolean {
    return this.database.prepare(`SELECT 1 FROM author_attachments
      WHERE owner_id = ? AND book_id = ? AND attachment_id = ? AND parse_status <> 'discarded'`)
      .get(scope.ownerId, scope.bookId, attachmentId) !== undefined;
  }

  public findDecisionByIdempotencyKey(scope: BookScope, idempotencyKey: string): AuthorPlanningInputDecisionRow | null {
    return this.database.prepare(`SELECT decision_id, author_input_id, from_status, to_status,
      handling_reason, idempotency_key, request_hash, created_at FROM author_planning_input_decisions
      WHERE owner_id = ? AND book_id = ? AND idempotency_key = ?`)
      .get(scope.ownerId, scope.bookId, idempotencyKey) as AuthorPlanningInputDecisionRow | undefined ?? null;
  }

  public insertDecision(scope: BookScope, input: {
    id: string; authorInputId: string; fromStatus: AuthorInputStatus;
    toStatus: AuthorPlanningInputDecisionRow['to_status']; handlingReason: string;
    idempotencyKey: string; requestHash: string; now: string;
  }): void {
    this.database.prepare(`INSERT INTO author_planning_input_decisions (
      decision_id, owner_id, book_id, author_input_id, from_status, to_status,
      handling_reason, idempotency_key, request_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.id, scope.ownerId, scope.bookId, input.authorInputId, input.fromStatus, input.toStatus,
        input.handlingReason, input.idempotencyKey, input.requestHash, input.now);
  }

  public updateDecision(scope: BookScope, authorInputId: string, expectedStatus: AuthorInputStatus, input: {
    status: AuthorPlanningInputDecisionRow['to_status']; handlingReason: string; now: string;
  }): boolean {
    return this.database.prepare(`UPDATE author_planning_inputs
      SET status = ?, handling_reason = ?, decided_at = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND author_input_id = ? AND status = ?`)
      .run(input.status, input.handlingReason, input.now, input.now,
        scope.ownerId, scope.bookId, authorInputId, expectedStatus).changes === 1;
  }
}
