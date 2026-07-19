import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { EpistemicStatus } from '../../contracts/knowledge-lifecycle.js';
import { KnowledgeRepository } from '../../infrastructure/db/repositories/knowledge-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { KnowledgeLifecycleService } from './knowledge-lifecycle-service.js';

export type FactGrade = 'A' | 'B' | 'C' | 'D';
export type FactStatus = 'candidate' | 'awaiting_editor' | 'awaiting_boss' | 'approved' | 'active' | 'rejected' | 'superseded' | 'withdrawn';

export interface FactInput {
  subjectEntityId: string;
  relationKey: string;
  value: unknown;
  evidence: unknown[];
  grade: FactGrade;
  sourceChapterId?: string | null;
  sourceManuscriptVersionId?: string | null;
  storyTimeStart?: string | null;
  storyTimeEnd?: string | null;
  epistemicStatus?: EpistemicStatus;
  negated?: boolean;
  viewpointEntityId?: string | null;
  knowledgeSubjectId?: string | null;
  knowledgeTimeStart?: string | null;
  knowledgeTimeEnd?: string | null;
  temporalCompleteness?: 'complete' | 'partial' | 'unknown';
}

export interface ProposedFact {
  factId: string;
  grade: FactGrade;
  status: FactStatus;
  confirmationId: string | null;
  conflictId: string | null;
}

interface FactRow {
  fact_id: string;
  subject_entity_id: string;
  relation_key: string;
  value_json: string;
  story_time_start: string | null;
  story_time_end: string | null;
  source_chapter_id: string | null;
  grade: FactGrade;
  status: FactStatus;
}

interface BookRow { canon_revision: number; positioning_version: number }

export class CanonService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public createEntity(
    scope: BookScope,
    input: { entityType: string; canonicalName: string; aliases?: string[] }
  ): string {
    assertBookScope(scope);
    const entityId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      INSERT INTO entities (
        entity_id, owner_id, book_id, entity_type, canonical_name,
        aliases_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(entityId, scope.ownerId, scope.bookId, input.entityType, input.canonicalName, JSON.stringify(input.aliases ?? []), now, now);
    return entityId;
  }

  public proposeFact(scope: BookScope, input: FactInput): ProposedFact {
    assertBookScope(scope);
    this.requireEntity(scope, input.subjectEntityId);
    if (input.grade !== 'A' && input.evidence.length === 0) {
      throw new DomainError(errorCodes.validation, 'B/C/D级事实必须包含可追溯证据');
    }
    const factId = this.ids.next();
    const now = this.clock.now().toISOString();
    const conflict = this.findConflictingFact(scope, input);
    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
    let status: FactStatus = input.grade === 'A' ? 'candidate' : input.grade === 'B' ? 'approved' : input.grade === 'C' ? 'awaiting_editor' : 'awaiting_boss';
    if (conflict !== undefined && input.grade === 'B') status = 'awaiting_editor';
    this.database.prepare(`
      INSERT INTO fact_assertions (
        fact_id, owner_id, book_id, subject_entity_id, relation_key, value_json,
        story_time_start, story_time_end, source_chapter_id, source_manuscript_version_id,
        evidence_json, grade, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      factId, scope.ownerId, scope.bookId, input.subjectEntityId, input.relationKey,
      stableJson(input.value), input.storyTimeStart ?? null, input.storyTimeEnd ?? null,
      input.sourceChapterId ?? null, input.sourceManuscriptVersionId ?? null,
      stableJson(input.evidence), input.grade, status, now
    );

    let conflictId: string | null = null;
    if (conflict !== undefined) {
      conflictId = this.ids.next();
      this.database.prepare(`
        INSERT INTO conflicts (
          conflict_id, owner_id, book_id, target_type, target_id, conflict_type,
          severity, evidence_json, impact_json, status, created_at
        ) VALUES (?, ?, ?, 'fact', ?, 'same_subject_relation_different_value',
          'blocker', ?, ?, 'open', ?)
      `).run(
        conflictId, scope.ownerId, scope.bookId, factId,
        stableJson({ existingFactId: conflict.fact_id, proposedFactId: factId }),
        stableJson({ relationKey: input.relationKey, requiresReview: true }), now
      );
    }

    let confirmationId: string | null = null;
    if (input.grade === 'D') {
      const book = this.requireBook(scope);
      confirmationId = this.ids.next();
      this.database.prepare(`
        INSERT INTO confirmations (
          confirmation_id, owner_id, book_id, target_type, target_id,
          old_value_json, new_value_json, scope_json, impact_json,
          expected_canon_revision, status, created_at
        ) VALUES (?, ?, ?, 'fact', ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        confirmationId, scope.ownerId, scope.bookId, factId,
        conflict?.value_json ?? 'null', stableJson(input.value),
        stableJson({ entityId: input.subjectEntityId, relationKey: input.relationKey }),
        stableJson({ chapterId: input.sourceChapterId ?? null, blocksSettlement: true }),
        book.canon_revision, now
      );
    }
      const manuscript = input.sourceManuscriptVersionId === null || input.sourceManuscriptVersionId === undefined
        ? undefined
        : this.database.prepare(`
          SELECT content_hash FROM manuscript_versions
          WHERE manuscript_version_id = ? AND owner_id = ? AND book_id = ?
        `).get(input.sourceManuscriptVersionId, scope.ownerId, scope.bookId) as { content_hash: string } | undefined;
      new KnowledgeLifecycleService(
        new KnowledgeRepository(this.database), new UnitOfWork(this.database), this.ids, this.clock
      ).create(scope, {
        knowledgeType: 'fact_assertion',
        canonicalKey: factId,
        layer: 'candidate',
        authorityGrade: input.grade,
        epistemicStatus: input.epistemicStatus ?? 'objective',
        negated: input.negated ?? false,
        viewpointEntityId: input.viewpointEntityId ?? null,
        temporal: {
          worldTimeStart: input.storyTimeStart ?? null,
          worldTimeEnd: input.storyTimeEnd ?? null,
          knowledgeSubjectType: input.knowledgeSubjectId === undefined || input.knowledgeSubjectId === null ? null : 'entity',
          knowledgeSubjectId: input.knowledgeSubjectId ?? null,
          knowledgeTimeStart: input.knowledgeTimeStart ?? null,
          knowledgeTimeEnd: input.knowledgeTimeEnd ?? null,
          canonRevision: this.requireBook(scope).canon_revision,
          completeness: input.temporalCompleteness ?? 'partial'
        },
        content: { subjectEntityId: input.subjectEntityId, relationKey: input.relationKey, value: input.value },
        contentText: `${input.subjectEntityId} ${input.relationKey} ${stableJson(input.value)}`,
        evidence: input.evidence,
        sourceType: manuscript === undefined ? 'fact_assertion' : 'confirmed_manuscript',
        sourceId: input.sourceManuscriptVersionId ?? factId,
        sourceHash: manuscript?.content_hash ?? null,
        sourceLocator: {
          factId,
          chapterId: input.sourceChapterId ?? null,
          manuscriptVersionId: input.sourceManuscriptVersionId ?? null,
          evidence: input.evidence
        },
        extractorVersion: 'fact-bridge-v1',
        createdByType: 'system'
      });
      if (ownsTransaction) this.database.exec('COMMIT');
      return { factId, grade: input.grade, status, confirmationId, conflictId };
    } catch (error) {
      if (ownsTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public reviewFact(scope: BookScope, factId: string, accept: boolean, resolution: Record<string, unknown> = {}): void {
    const fact = this.requireFact(scope, factId);
    if (fact.status !== 'awaiting_editor') throw new Error('事实不处于主编复核状态');
    const now = this.clock.now().toISOString();
    const nextStatus: FactStatus = accept ? 'approved' : 'rejected';
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`UPDATE fact_assertions SET status = ?, reviewed_at = ? WHERE fact_id = ? AND owner_id = ? AND book_id = ?`)
        .run(nextStatus, now, factId, scope.ownerId, scope.bookId);
      this.database.prepare(`
        UPDATE conflicts SET status = 'resolved', resolution_json = ?, resolved_at = ?
        WHERE target_type = 'fact' AND target_id = ? AND owner_id = ? AND book_id = ? AND status = 'open'
      `).run(stableJson({ accept, ...resolution }), now, factId, scope.ownerId, scope.bookId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public resolveConfirmation(scope: BookScope, confirmationId: string, expectedCanonRevision: number, accept: boolean): void {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT target_id, expected_canon_revision, status FROM confirmations
      WHERE confirmation_id = ? AND owner_id = ? AND book_id = ?
    `).get(confirmationId, scope.ownerId, scope.bookId) as { target_id: string; expected_canon_revision: number; status: string } | undefined;
    if (row === undefined || row.status !== 'pending') throw new DomainError(errorCodes.confirmationMismatch, '确认对象不存在或已经处理', {}, false, 409);
    const book = this.requireBook(scope);
    if (row.expected_canon_revision !== expectedCanonRevision || book.canon_revision !== expectedCanonRevision) {
      throw new DomainError(errorCodes.canonRevisionConflict, '确认绑定的正史版本已经变化', { expectedCanonRevision, actualCanonRevision: book.canon_revision }, false, 409);
    }
    const now = this.clock.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`UPDATE confirmations SET status = ?, resolved_at = ? WHERE confirmation_id = ?`)
        .run(accept ? 'accepted' : 'rejected', now, confirmationId);
      this.database.prepare(`UPDATE fact_assertions SET status = ?, reviewed_at = ? WHERE fact_id = ? AND owner_id = ? AND book_id = ? AND status = 'awaiting_boss'`)
        .run(accept ? 'approved' : 'rejected', now, row.target_id, scope.ownerId, scope.bookId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public ensureInitialRevision(scope: BookScope): string {
    const existing = this.database.prepare(`
      SELECT canon_revision_id FROM canon_revisions WHERE owner_id = ? AND book_id = ? AND revision = 0
    `).get(scope.ownerId, scope.bookId) as { canon_revision_id: string } | undefined;
    if (existing !== undefined) return existing.canon_revision_id;
    const revisionId = this.ids.next();
    this.database.prepare(`
      INSERT INTO canon_revisions (
        canon_revision_id, owner_id, book_id, revision, reason, content_hash, created_at
      ) VALUES (?, ?, ?, 0, 'initial', ?, ?)
    `).run(revisionId, scope.ownerId, scope.bookId, sha256('[]'), this.clock.now().toISOString());
    return revisionId;
  }

  public settleChapter(
    scope: BookScope,
    chapterId: string,
    manuscriptVersionId: string,
    chapterEndState: Record<string, unknown>,
    failAt?: 'after_fact_activation' | 'after_revision',
    expectedCanonRevision?: number
  ): { canonRevision: number; canonRevisionId: string; chapterEndStateId: string } {
    assertBookScope(scope);
    const canonRevisionId = this.ids.next();
    const chapterEndStateId = this.ids.next();
    const changeId = this.ids.next();
    const now = this.clock.now().toISOString();

    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
      const book = this.requireBook(scope);
      if (expectedCanonRevision !== undefined && book.canon_revision !== expectedCanonRevision) {
        throw new DomainError(errorCodes.canonRevisionConflict, '正史修订已经变化，拒绝陈旧章节结算', {
          expectedCanonRevision,
          actualCanonRevision: book.canon_revision
        }, false, 409);
      }
      const manuscript = this.database.prepare(`
        SELECT status, content_hash FROM manuscript_versions
        WHERE manuscript_version_id = ? AND chapter_id = ? AND owner_id = ? AND book_id = ?
      `).get(manuscriptVersionId, chapterId, scope.ownerId, scope.bookId) as { status: string; content_hash: string } | undefined;
      if (manuscript === undefined || manuscript.status !== 'approved') throw new Error('只有已选定的完整正文可以结算');
      const pending = this.database.prepare(`
        SELECT fact_id, grade, status FROM fact_assertions
        WHERE owner_id = ? AND book_id = ? AND source_chapter_id = ? AND grade <> 'A'
          AND status NOT IN ('approved', 'active', 'rejected', 'superseded', 'withdrawn')
        ORDER BY fact_id
      `).all(scope.ownerId, scope.bookId, chapterId) as unknown as Array<{ fact_id: string; grade: FactGrade; status: FactStatus }>;
      if (pending.length > 0) {
        const hasBoss = pending.some((fact) => fact.grade === 'D');
        throw new DomainError(
          hasBoss ? errorCodes.confirmationRequired : errorCodes.operationIncomplete,
          hasBoss ? 'D级事实尚未确认，章节不能结算' : '章节事实门禁尚未完成',
          { pending }, false, 409
        );
      }
      const nextRevision = book.canon_revision + 1;
      const parent = this.database.prepare(`
        SELECT canon_revision_id FROM canon_revisions WHERE owner_id = ? AND book_id = ? AND revision = ?
      `).get(scope.ownerId, scope.bookId, book.canon_revision) as { canon_revision_id: string } | undefined;
      let parentRevisionId = parent?.canon_revision_id;
      if (parentRevisionId === undefined && book.canon_revision === 0) {
        parentRevisionId = this.ids.next();
        this.database.prepare(`
          INSERT INTO canon_revisions (canon_revision_id, owner_id, book_id, revision, reason, content_hash, created_at)
          VALUES (?, ?, ?, 0, 'initial', ?, ?)
        `).run(parentRevisionId, scope.ownerId, scope.bookId, sha256('[]'), now);
      }
      if (parentRevisionId === undefined) throw new Error('当前正史版本记录缺失');
      const additions = this.database.prepare(`
        SELECT * FROM fact_assertions WHERE owner_id = ? AND book_id = ? AND source_chapter_id = ? AND status = 'approved'
        ORDER BY fact_id
      `).all(scope.ownerId, scope.bookId, chapterId) as unknown as FactRow[];
      const priorActive = this.database.prepare(`
        SELECT f.* FROM canon_bindings b JOIN fact_assertions f ON f.fact_id = b.fact_id
        WHERE b.owner_id = ? AND b.book_id = ? AND b.canon_revision_id = ? AND b.active = 1
        ORDER BY f.fact_id
      `).all(scope.ownerId, scope.bookId, parentRevisionId) as unknown as FactRow[];
      const replacements = new Set(additions.map((fact) => `${fact.subject_entity_id}\u0000${fact.relation_key}`));
      const carried = priorActive.filter((fact) => !replacements.has(`${fact.subject_entity_id}\u0000${fact.relation_key}`));
      for (const fact of priorActive) {
        if (!carried.includes(fact)) {
          this.database.prepare(`UPDATE fact_assertions SET status = 'superseded' WHERE fact_id = ?`).run(fact.fact_id);
        }
      }
      this.database.prepare(`
        UPDATE fact_assertions SET status = 'active', reviewed_at = COALESCE(reviewed_at, ?)
        WHERE owner_id = ? AND book_id = ? AND source_chapter_id = ? AND status = 'approved'
      `).run(now, scope.ownerId, scope.bookId, chapterId);
      if (failAt === 'after_fact_activation') throw new Error('simulated-settlement-failure');
      const activeFacts = [...carried, ...additions].sort((left, right) => left.fact_id.localeCompare(right.fact_id));
      const contentHash = sha256(stableJson(activeFacts.map((fact) => ({ factId: fact.fact_id, value: JSON.parse(fact.value_json) }))));
      this.database.prepare(`
        INSERT INTO canon_revisions (
          canon_revision_id, owner_id, book_id, revision, parent_revision_id,
          reason, source_chapter_id, content_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, 'chapter_settlement', ?, ?, ?)
      `).run(canonRevisionId, scope.ownerId, scope.bookId, nextRevision, parentRevisionId, chapterId, contentHash, now);
      for (const fact of activeFacts) {
        this.database.prepare(`
          INSERT INTO canon_bindings (canon_revision_id, fact_id, owner_id, book_id, active, bound_at)
          VALUES (?, ?, ?, ?, 1, ?)
        `).run(canonRevisionId, fact.fact_id, scope.ownerId, scope.bookId, now);
      }
      const lifecycle = new KnowledgeLifecycleService(
        new KnowledgeRepository(this.database), new UnitOfWork(this.database), this.ids, this.clock
      );
      const knowledge = new KnowledgeRepository(this.database);
      for (const fact of additions) {
        const candidate = knowledge.findActiveCandidateByKey(scope, 'fact_assertion', fact.fact_id);
        if (candidate === null || candidate.sourceHash === null) continue;
        lifecycle.promote(scope, candidate.knowledgeRevisionId, {
          decisionType: fact.grade === 'D' ? 'boss_confirmed' : fact.grade === 'C' ? 'chief_editor_approved' : 'graded_settlement',
          decisionSourceType: 'chapter_settlement',
          decisionSourceId: chapterId,
          canonRevision: nextRevision,
          canonRevisionId
        });
      }
      if (failAt === 'after_revision') throw new Error('simulated-settlement-failure');
      this.database.prepare(`
        INSERT INTO chapter_end_states (
          chapter_end_state_id, owner_id, book_id, chapter_id, canon_revision,
          state_json, content_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(chapterEndStateId, scope.ownerId, scope.bookId, chapterId, nextRevision, stableJson(chapterEndState), sha256(stableJson(chapterEndState)), now);
      const manuscriptUpdate = this.database.prepare(`
        UPDATE manuscript_versions SET status = 'canon', confirmed_at = ?
        WHERE manuscript_version_id = ? AND chapter_id = ? AND owner_id = ? AND book_id = ? AND status = 'approved'
      `).run(now, manuscriptVersionId, chapterId, scope.ownerId, scope.bookId);
      if (manuscriptUpdate.changes !== 1) throw new Error('正文版本状态在结算期间发生变化');
      const chapterUpdate = this.database.prepare(`
        UPDATE chapters SET settlement_status = 'settled', canon_manuscript_version_id = ?,
          chapter_end_state_id = ?, updated_at = ?, version = version + 1
        WHERE chapter_id = ? AND owner_id = ? AND book_id = ? AND settlement_status <> 'settled'
      `).run(manuscriptVersionId, chapterEndStateId, now, chapterId, scope.ownerId, scope.bookId);
      if (chapterUpdate.changes !== 1) throw new Error('章节已经结算或状态发生变化');
      const bookUpdate = this.database.prepare(`
        UPDATE books SET canon_revision = ?, updated_at = ?, version = version + 1
        WHERE owner_id = ? AND book_id = ? AND canon_revision = ?
      `).run(nextRevision, now, scope.ownerId, scope.bookId, book.canon_revision);
      if (bookUpdate.changes !== 1) throw new DomainError(errorCodes.canonRevisionConflict, '正史修订并发变化，结算已回滚', {
        expectedCanonRevision: book.canon_revision
      }, false, 409);
      this.database.prepare(`
        INSERT INTO canon_revisions_log (
          canon_change_id, owner_id, book_id, from_revision, to_revision,
          change_type, affected_fact_ids_json, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, 'settlement', ?, ?, ?)
      `).run(changeId, scope.ownerId, scope.bookId, book.canon_revision, nextRevision, stableJson(additions.map((fact) => fact.fact_id)), `chapter:${chapterId}`, now);
      for (const fact of additions) {
        const entity = this.database.prepare(`SELECT canonical_name FROM entities WHERE entity_id = ? AND owner_id = ? AND book_id = ?`)
          .get(fact.subject_entity_id, scope.ownerId, scope.bookId) as { canonical_name: string };
        const memoryId = this.ids.next();
        const content = `${entity.canonical_name} ${fact.relation_key} ${fact.value_json}`;
        this.insertDerivedMemory(scope, memoryId, 'canon_fact', content, 'fact', fact.fact_id, nextRevision, book.positioning_version, now);
      }
      const endMemoryId = this.ids.next();
      this.insertDerivedMemory(scope, endMemoryId, 'chapter_end', stableJson(chapterEndState), 'chapter_end_state', chapterEndStateId, nextRevision, book.positioning_version, now);
      this.invalidateDerivedState(scope, nextRevision, now);
      this.rebuildProjectionsWithinTransaction(scope, nextRevision, activeFacts, now);
      this.database.prepare(`
        INSERT INTO canon_index_requests (
          canon_index_request_id, owner_id, book_id, canon_revision, source_chapter_id,
          status, attempts, available_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
        ON CONFLICT(owner_id, book_id, canon_revision) DO NOTHING
      `).run(this.ids.next(), scope.ownerId, scope.bookId, nextRevision, chapterId, now, now, now);
      if (ownsTransaction) this.database.exec('COMMIT');
      return { canonRevision: nextRevision, canonRevisionId, chapterEndStateId };
    } catch (error) {
      if (ownsTransaction && this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public rebuildProjections(scope: BookScope): void {
    const book = this.requireBook(scope);
    const revision = this.database.prepare(`
      SELECT canon_revision_id FROM canon_revisions WHERE owner_id = ? AND book_id = ? AND revision = ?
    `).get(scope.ownerId, scope.bookId, book.canon_revision) as { canon_revision_id: string } | undefined;
    const facts = revision === undefined ? [] : this.database.prepare(`
      SELECT f.* FROM canon_bindings b JOIN fact_assertions f ON f.fact_id = b.fact_id
      WHERE b.owner_id = ? AND b.book_id = ? AND b.canon_revision_id = ? AND b.active = 1 ORDER BY f.fact_id
    `).all(scope.ownerId, scope.bookId, revision.canon_revision_id) as unknown as FactRow[];
    const now = this.clock.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.rebuildProjectionsWithinTransaction(scope, book.canon_revision, facts, now);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public listFacts(scope: BookScope, chapterId?: string): FactRow[] {
    assertBookScope(scope);
    if (chapterId === undefined) {
      return this.database.prepare(`SELECT * FROM fact_assertions WHERE owner_id = ? AND book_id = ? ORDER BY created_at, fact_id`)
        .all(scope.ownerId, scope.bookId) as unknown as FactRow[];
    }
    return this.database.prepare(`SELECT * FROM fact_assertions WHERE owner_id = ? AND book_id = ? AND source_chapter_id = ? ORDER BY created_at, fact_id`)
      .all(scope.ownerId, scope.bookId, chapterId) as unknown as FactRow[];
  }

  private invalidateDerivedState(scope: BookScope, nextRevision: number, now: string): void {
    this.database.prepare(`
      UPDATE context_packs SET status = 'invalidated', invalidated_at = ?
      WHERE owner_id = ? AND book_id = ? AND status = 'active' AND canon_revision < ?
    `).run(now, scope.ownerId, scope.bookId, nextRevision);
    const staleMemories = this.database.prepare(`
      SELECT memory_id FROM memories
      WHERE owner_id = ? AND book_id = ? AND status = 'active' AND canon_revision < ?
        AND memory_layer IN ('canon_fact', 'chapter_end', 'book_working', 'task_temporary')
    `).all(scope.ownerId, scope.bookId, nextRevision) as unknown as Array<{ memory_id: string }>;
    this.database.prepare(`
      UPDATE memories SET status = 'invalidated', invalidation_reason = 'canon_revision_changed', invalidated_at = ?
      WHERE owner_id = ? AND book_id = ? AND status = 'active' AND canon_revision < ?
        AND memory_layer IN ('canon_fact', 'chapter_end', 'book_working', 'task_temporary')
    `).run(now, scope.ownerId, scope.bookId, nextRevision);
    for (const memory of staleMemories) {
      this.database.prepare(`DELETE FROM content_fts WHERE owner_id = ? AND book_id = ? AND source_type = 'memory' AND source_id = ?`)
        .run(scope.ownerId, scope.bookId, memory.memory_id);
    }
  }

  private insertDerivedMemory(
    scope: BookScope,
    memoryId: string,
    layer: 'canon_fact' | 'chapter_end',
    content: string,
    sourceType: string,
    sourceId: string,
    canonRevision: number,
    positioningVersion: number,
    now: string
  ): void {
    this.database.prepare(`
      INSERT INTO memories (
        memory_id, owner_id, book_id, memory_layer, content, source_type,
        source_id, fact_status, canon_revision, positioning_version,
        importance, version, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 90, 1, 'active', ?)
    `).run(memoryId, scope.ownerId, scope.bookId, layer, content, sourceType, sourceId, canonRevision, positioningVersion, now);
    this.database.prepare(`INSERT INTO content_fts (owner_id, book_id, source_type, source_id, content) VALUES (?, ?, 'memory', ?, ?)`)
      .run(scope.ownerId, scope.bookId, memoryId, content);
  }

  private rebuildProjectionsWithinTransaction(scope: BookScope, revision: number, facts: FactRow[], now: string): void {
    this.database.prepare(`DELETE FROM character_state_projection WHERE owner_id = ? AND book_id = ?`).run(scope.ownerId, scope.bookId);
    this.database.prepare(`DELETE FROM timeline_projection WHERE owner_id = ? AND book_id = ?`).run(scope.ownerId, scope.bookId);
    this.database.prepare(`DELETE FROM relationship_projection WHERE owner_id = ? AND book_id = ?`).run(scope.ownerId, scope.bookId);
    const byEntity = new Map<string, Record<string, unknown>>();
    for (const fact of facts) {
      const state = byEntity.get(fact.subject_entity_id) ?? {};
      state[fact.relation_key] = JSON.parse(fact.value_json) as unknown;
      byEntity.set(fact.subject_entity_id, state);
      if (fact.story_time_start !== null || fact.relation_key === 'event') {
        this.database.prepare(`
          INSERT INTO timeline_projection (
            timeline_id, owner_id, book_id, canon_revision, entity_id,
            story_time, event_json, source_fact_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(this.ids.next(), scope.ownerId, scope.bookId, revision, fact.subject_entity_id, fact.story_time_start ?? 'unspecified', fact.value_json, fact.fact_id);
      }
      if (fact.relation_key.startsWith('relationship:')) {
        this.database.prepare(`
          INSERT INTO relationship_projection (
            relationship_id, owner_id, book_id, canon_revision, from_entity_id,
            relation_key, to_value_json, source_fact_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(this.ids.next(), scope.ownerId, scope.bookId, revision, fact.subject_entity_id, fact.relation_key, fact.value_json, fact.fact_id);
      }
    }
    for (const [entityId, state] of byEntity) {
      this.database.prepare(`
        INSERT INTO character_state_projection (
          owner_id, book_id, canon_revision, entity_id, state_json, rebuilt_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(scope.ownerId, scope.bookId, revision, entityId, stableJson(state), now);
    }
  }

  private requireEntity(scope: BookScope, entityId: string): void {
    const row = this.database.prepare(`SELECT 1 FROM entities WHERE entity_id = ? AND owner_id = ? AND book_id = ? AND status = 'active'`)
      .get(entityId, scope.ownerId, scope.bookId);
    if (row === undefined) throw new Error('实体不存在或越权');
  }

  private requireBook(scope: BookScope): BookRow {
    const row = this.database.prepare(`SELECT canon_revision, positioning_version FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as BookRow | undefined;
    if (row === undefined) throw new Error('书籍不存在或越权');
    return row;
  }

  private requireFact(scope: BookScope, factId: string): FactRow {
    const row = this.database.prepare(`SELECT * FROM fact_assertions WHERE fact_id = ? AND owner_id = ? AND book_id = ?`)
      .get(factId, scope.ownerId, scope.bookId) as FactRow | undefined;
    if (row === undefined) throw new Error('事实不存在或越权');
    return row;
  }

  private findConflictingFact(scope: BookScope, input: FactInput): FactRow | undefined {
    return this.database.prepare(`
      SELECT * FROM fact_assertions
      WHERE owner_id = ? AND book_id = ? AND subject_entity_id = ? AND relation_key = ?
        AND status IN ('approved', 'active') AND value_json <> ?
      ORDER BY created_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, input.subjectEntityId, input.relationKey, stableJson(input.value)) as FactRow | undefined;
  }
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value)) ?? 'null';
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortValue(child)]));
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
