import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { EpistemicStatus } from '../../contracts/knowledge-lifecycle.js';
import { KnowledgeRepository } from '../../infrastructure/db/repositories/knowledge-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { KnowledgeLifecycleService } from './knowledge-lifecycle-service.js';
import { LongformContinuityRepository } from '../../infrastructure/db/repositories/longform-continuity-repository.js';
import { StageSettlementService } from '../continuity/stage-settlement-service.js';
import { RollingPlanService } from '../continuity/rolling-plan-service.js';
import { AgentContinuityRepository } from '../../infrastructure/db/repositories/agent-continuity-repository.js';
import { AgentContinuityService } from '../agents/agent-continuity-service.js';
import { NarrativeProjectionService } from '../projections/narrative-projection-service.js';

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
  epistemic_status: EpistemicStatus;
  negated: number;
  viewpoint_entity_id: string | null;
  knowledge_subject_id: string | null;
  knowledge_time_start: string | null;
  knowledge_time_end: string | null;
  temporal_completeness: 'complete' | 'partial' | 'unknown';
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
        evidence_json, epistemic_status, negated, viewpoint_entity_id, knowledge_subject_id,
        knowledge_time_start, knowledge_time_end, temporal_completeness, grade, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      factId, scope.ownerId, scope.bookId, input.subjectEntityId, input.relationKey,
      stableJson(input.value), input.storyTimeStart ?? null, input.storyTimeEnd ?? null,
      input.sourceChapterId ?? null, input.sourceManuscriptVersionId ?? null,
      stableJson(input.evidence), input.epistemicStatus ?? 'objective', input.negated === true ? 1 : 0,
      input.viewpointEntityId ?? null, input.knowledgeSubjectId ?? null,
      input.knowledgeTimeStart ?? null, input.knowledgeTimeEnd ?? null,
      input.temporalCompleteness ?? 'partial', input.grade, status, now
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
    const now = this.clock.now().toISOString();
    const nextStatus: FactStatus = accept ? 'approved' : 'rejected';
    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = this.database.prepare(`UPDATE fact_assertions SET status = ?, reviewed_at = ?
        WHERE fact_id = ? AND owner_id = ? AND book_id = ? AND status = 'awaiting_editor'`)
        .run(nextStatus, now, factId, scope.ownerId, scope.bookId);
      if (result.changes !== 1) throw new Error('事实不处于主编复核状态或已被其他操作处理');
      this.database.prepare(`
        UPDATE conflicts SET status = 'resolved', resolution_json = ?, resolved_at = ?
        WHERE target_type = 'fact' AND target_id = ? AND owner_id = ? AND book_id = ? AND status = 'open'
      `).run(stableJson({ accept, ...resolution }), now, factId, scope.ownerId, scope.bookId);
      if (ownsTransaction) this.database.exec('COMMIT');
    } catch (error) {
      if (ownsTransaction && this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public resolveConfirmation(scope: BookScope, confirmationId: string, expectedCanonRevision: number, accept: boolean): void {
    assertBookScope(scope);
    const now = this.clock.now().toISOString();
    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database.prepare(`
        SELECT target_id, expected_canon_revision, status FROM confirmations
        WHERE confirmation_id = ? AND owner_id = ? AND book_id = ?
      `).get(confirmationId, scope.ownerId, scope.bookId) as { target_id: string; expected_canon_revision: number; status: string } | undefined;
      if (row === undefined || row.status !== 'pending') throw new DomainError(errorCodes.confirmationMismatch, '确认对象不存在或已经处理', {}, false, 409);
      const book = this.requireBook(scope);
      if (row.expected_canon_revision !== expectedCanonRevision || book.canon_revision !== expectedCanonRevision) {
        throw new DomainError(errorCodes.canonRevisionConflict, '确认绑定的正史版本已经变化', { expectedCanonRevision, actualCanonRevision: book.canon_revision }, false, 409);
      }
      const factResult = this.database.prepare(`UPDATE fact_assertions SET status = ?, reviewed_at = ?
        WHERE fact_id = ? AND owner_id = ? AND book_id = ? AND status = 'awaiting_boss'`)
        .run(accept ? 'approved' : 'rejected', now, row.target_id, scope.ownerId, scope.bookId);
      if (factResult.changes !== 1) throw new DomainError(errorCodes.confirmationMismatch, '待确认事实状态已经变化', {}, false, 409);
      const confirmationResult = this.database.prepare(`UPDATE confirmations SET status = ?, resolved_at = ?
        WHERE confirmation_id = ? AND owner_id = ? AND book_id = ? AND status = 'pending'`)
        .run(accept ? 'accepted' : 'rejected', now, confirmationId, scope.ownerId, scope.bookId);
      if (confirmationResult.changes !== 1) throw new DomainError(errorCodes.confirmationMismatch, '确认单状态已经变化', {}, false, 409);
      if (ownsTransaction) this.database.exec('COMMIT');
    } catch (error) {
      if (ownsTransaction && this.database.isTransaction) this.database.exec('ROLLBACK');
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
      ON CONFLICT(owner_id, book_id, revision) DO NOTHING
    `).run(revisionId, scope.ownerId, scope.bookId, sha256('[]'), this.clock.now().toISOString());
    const stored = this.database.prepare(`SELECT canon_revision_id FROM canon_revisions
      WHERE owner_id = ? AND book_id = ? AND revision = 0`)
      .get(scope.ownerId, scope.bookId) as { canon_revision_id: string } | undefined;
    if (stored === undefined) throw new Error('初始正史版本创建失败');
    return stored.canon_revision_id;
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
      const replacements = new Set(additions.map(factIdentityKey));
      const carried = priorActive.filter((fact) => !replacements.has(factIdentityKey(fact)));
      for (const fact of priorActive) {
        if (!carried.includes(fact)) {
          this.database.prepare(`UPDATE fact_assertions SET status = 'superseded'
            WHERE fact_id = ? AND owner_id = ? AND book_id = ? AND status = 'active'`)
            .run(fact.fact_id, scope.ownerId, scope.bookId);
        }
      }
      this.database.prepare(`
        UPDATE fact_assertions SET status = 'active', reviewed_at = COALESCE(reviewed_at, ?)
        WHERE owner_id = ? AND book_id = ? AND source_chapter_id = ? AND status = 'approved'
      `).run(now, scope.ownerId, scope.bookId, chapterId);
      if (failAt === 'after_fact_activation') throw new Error('simulated-settlement-failure');
      const activeFacts = [...carried, ...additions].sort((left, right) => left.fact_id.localeCompare(right.fact_id));
      const contentHash = sha256(stableJson(activeFacts.map((fact) => ({
        factId: fact.fact_id,
        value: JSON.parse(fact.value_json),
        epistemicStatus: fact.epistemic_status,
        negated: fact.negated === 1,
        viewpointEntityId: fact.viewpoint_entity_id,
        knowledgeSubjectId: fact.knowledge_subject_id
      }))));
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
        // The confirmed manuscript is authoritative, while an extracted ambiguous/conflicted
        // assertion must preserve that epistemic status instead of pretending to be a resolved
        // knowledge fact. Keep its lifecycle record in the candidate layer for later
        // disambiguation, but do not let this derived projection block chapter settlement.
        if (candidate.epistemicStatus === 'ambiguous' || candidate.epistemicStatus === 'conflicted') continue;
        const decisionType = fact.grade === 'D' ? 'boss_confirmed' : fact.grade === 'C' ? 'chief_editor_approved' : 'graded_settlement';
        if (decisionType === 'graded_settlement') {
          const temporal = knowledge.requireTemporalScope(scope, candidate.temporalScopeId);
          const epistemicallyScoped = candidate.epistemicStatus === 'objective' || temporal.knowledgeSubjectId !== null;
          const eligible = ['A', 'B'].includes(candidate.authorityGrade)
            && epistemicallyScoped
            && candidate.evidence.length > 0
            && temporal.completeness !== 'unknown'
            && candidate.sourceType === 'confirmed_manuscript';
          if (!eligible) continue;
        }
        lifecycle.promote(scope, candidate.knowledgeRevisionId, {
          decisionType,
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
        UPDATE chapters SET settlement_status = 'settled', generation_status = 'completed', canon_manuscript_version_id = ?,
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
        const content = `${entity.canonical_name} ${fact.negated === 1 ? '不成立：' : ''}${fact.relation_key} ${fact.value_json} [${fact.epistemic_status}]`;
        this.insertDerivedMemory(scope, memoryId, 'canon_fact', content, 'fact', fact.fact_id, nextRevision, book.positioning_version, now);
      }
      const endMemoryId = this.ids.next();
      this.insertDerivedMemory(scope, endMemoryId, 'chapter_end', stableJson(chapterEndState), 'chapter_end_state', chapterEndStateId, nextRevision, book.positioning_version, now);
      this.invalidateDerivedState(scope, nextRevision, now);
      this.rebuildProjectionsWithinTransaction(scope, nextRevision, activeFacts, now);
      new NarrativeProjectionService(this.database, this.ids, this.clock).rebuild(scope);
      this.updateLongformContinuity(scope, {
        chapterId,
        manuscriptVersionId,
        manuscriptHash: manuscript.content_hash,
        canonRevision: nextRevision,
        chapterEndState,
        additions
      });
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

  private updateLongformContinuity(scope: BookScope, input: {
    chapterId: string;
    manuscriptVersionId: string;
    manuscriptHash: string;
    canonRevision: number;
    chapterEndState: Record<string, unknown>;
    additions: FactRow[];
  }): void {
    const chapter = this.database.prepare(`
      SELECT c.chapter_number, c.title, c.volume_id, v.volume_number, v.title AS volume_title
      FROM chapters c JOIN volumes v ON v.volume_id = c.volume_id
      WHERE c.chapter_id = ? AND c.owner_id = ? AND c.book_id = ?
    `).get(input.chapterId, scope.ownerId, scope.bookId) as {
      chapter_number: number; title: string; volume_id: string; volume_number: number; volume_title: string;
    } | undefined;
    if (chapter === undefined) throw new Error('长篇结算缺少章节与卷信息');
    const continuityRepository = new LongformContinuityRepository(this.database);
    new StageSettlementService(continuityRepository, new UnitOfWork(this.database), this.ids, this.clock).build(scope, {
      stageType: 'chapter',
      stageKey: input.chapterId,
      chapterStart: chapter.chapter_number,
      chapterEnd: chapter.chapter_number,
      canonRevision: input.canonRevision,
      payload: {
        irreversibleResults: input.additions.map((fact) => ({ factId: fact.fact_id, relationKey: fact.relation_key, value: JSON.parse(fact.value_json) })),
        entityStates: input.chapterEndState,
        closedThreads: [],
        openThreads: continuityRepository.listCommitments(scope, chapter.chapter_number),
        relationshipChanges: input.additions.filter((fact) => fact.relation_key.startsWith('relationship:')).map((fact) => fact.fact_id),
        knowledgeChanges: input.additions.map((fact) => ({ factId: fact.fact_id, grade: fact.grade })),
        resourceChanges: input.additions.filter((fact) => /resource|item|possesses/iu.test(fact.relation_key)).map((fact) => fact.fact_id),
        ruleChanges: input.additions.filter((fact) => /rule|constraint/iu.test(fact.relation_key)).map((fact) => fact.fact_id),
        exclusions: ['未被确认正文逐字支持的推断', '聊天原文', '未选初稿']
      },
      sources: [{
        sourceType: 'confirmed_manuscript', sourceId: input.manuscriptVersionId, sourceHash: input.manuscriptHash,
        locator: { chapterId: input.chapterId, chapterNumber: chapter.chapter_number }
      }],
      probes: [
        { type: 'source', expected: input.manuscriptHash, actual: input.manuscriptHash, passed: true },
        { type: 'fact', expected: input.additions.length, actual: input.additions.length, passed: true },
        { type: 'state', expected: input.canonRevision, actual: input.canonRevision, passed: true }
      ]
    });

    const futureOutlines = (this.database.prepare(`
      SELECT v.artifact_version_id, v.content_json
      FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'chapter_outline'
        AND a.status = 'active' AND v.status = 'selected'
      ORDER BY a.created_at, a.artifact_id
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ artifact_version_id: string; content_json: string }>)
      .map((row) => ({ ...row, content: JSON.parse(row.content_json) as Record<string, unknown> }))
      .filter((row) => Number(row.content.chapterNumber) > chapter.chapter_number)
      .sort((left, right) => Number(left.content.chapterNumber) - Number(right.content.chapterNumber))
      .slice(0, 12);
    if (futureOutlines.length > 0) {
      const detailed = Math.min(3, futureOutlines.length);
      new RollingPlanService(continuityRepository, this.ids, this.clock).advance(scope, {
        currentChapter: chapter.chapter_number + 1,
        detailedChapters: detailed,
        outlinedChapters: futureOutlines.length,
        plan: {
          sourceCanonRevision: input.canonRevision,
          volume: { volumeId: chapter.volume_id, volumeNumber: chapter.volume_number, title: chapter.volume_title },
          outlines: futureOutlines.map((row) => ({ artifactVersionId: row.artifact_version_id, content: row.content })),
          openCommitments: continuityRepository.listCommitments(scope, chapter.chapter_number + 1)
        }
      });
    }

    const agents = this.database.prepare(`
      SELECT a.agent_id, r.role_key FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1 AND r.role_key IN ('chief_editor', 'lead_writer')
      ORDER BY r.role_key
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ agent_id: string; role_key: string }>;
    const agentContinuity = new AgentContinuityService(
      new AgentContinuityRepository(this.database), new UnitOfWork(this.database), this.ids, this.clock
    );
    for (const agent of agents) {
      agentContinuity.append(scope, {
        agentId: agent.agent_id,
        entryType: 'conclusion',
        content: { event: 'chapter_settled', chapterId: input.chapterId, chapterNumber: chapter.chapter_number, roleKey: agent.role_key },
        sourceIds: [input.manuscriptVersionId, ...input.additions.map((fact) => fact.fact_id)],
        canonRevision: input.canonRevision
      });
      agentContinuity.updateFocus(scope, {
        agentId: agent.agent_id,
        current: { nextChapter: chapter.chapter_number + 1, volumeId: chapter.volume_id },
        unresolved: continuityRepository.listCommitments(scope, chapter.chapter_number + 1),
        lastContribution: { settledChapterId: input.chapterId, manuscriptVersionId: input.manuscriptVersionId },
        canonRevision: input.canonRevision
      });
    }
  }

  private rebuildProjectionsWithinTransaction(scope: BookScope, revision: number, facts: FactRow[], now: string): void {
    this.database.prepare(`DELETE FROM character_state_projection WHERE owner_id = ? AND book_id = ?`).run(scope.ownerId, scope.bookId);
    this.database.prepare(`DELETE FROM timeline_projection WHERE owner_id = ? AND book_id = ?`).run(scope.ownerId, scope.bookId);
    this.database.prepare(`DELETE FROM relationship_projection WHERE owner_id = ? AND book_id = ?`).run(scope.ownerId, scope.bookId);
    const chapterNumbers = new Map((this.database.prepare(`
      SELECT chapter_id, chapter_number FROM chapters WHERE owner_id = ? AND book_id = ?
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ chapter_id: string; chapter_number: number }>)
      .map((chapter) => [chapter.chapter_id, chapter.chapter_number]));
    const orderedFacts = [...facts].sort((left, right) => {
      const leftChapter = left.source_chapter_id === null ? -1 : chapterNumbers.get(left.source_chapter_id) ?? -1;
      const rightChapter = right.source_chapter_id === null ? -1 : chapterNumbers.get(right.source_chapter_id) ?? -1;
      return leftChapter - rightChapter || left.fact_id.localeCompare(right.fact_id);
    });
    const byEntity = new Map<string, Record<string, unknown>>();
    for (const fact of orderedFacts) {
      // 梦境、谎言、角色认知与否定命题属于已确认的叙事事实，但不能冒充客观人物状态。
      if (fact.epistemic_status !== 'objective' || fact.negated === 1) continue;
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
    const conflict = this.database.prepare(`
      SELECT * FROM fact_assertions
      WHERE owner_id = ? AND book_id = ? AND subject_entity_id = ? AND relation_key = ?
        AND status IN ('approved', 'active') AND epistemic_status = ?
        AND COALESCE(viewpoint_entity_id, '') = COALESCE(?, '')
        AND COALESCE(knowledge_subject_id, '') = COALESCE(?, '')
        AND (value_json <> ? OR negated <> ?)
      ORDER BY created_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, input.subjectEntityId, input.relationKey,
      input.epistemicStatus ?? 'objective', input.viewpointEntityId ?? null, input.knowledgeSubjectId ?? null,
      stableJson(input.value), input.negated === true ? 1 : 0) as FactRow | undefined;
    if (conflict !== undefined && input.storyTimeStart !== null && input.storyTimeStart !== undefined
      && conflict.story_time_start !== null && conflict.story_time_start !== input.storyTimeStart) {
      return undefined;
    }
    return conflict;
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

function factIdentityKey(fact: Pick<FactRow,
  'subject_entity_id' | 'relation_key' | 'story_time_start' | 'epistemic_status' | 'viewpoint_entity_id' | 'knowledge_subject_id'>): string {
  return [
    fact.subject_entity_id,
    fact.relation_key,
    fact.story_time_start ?? 'timeless',
    fact.epistemic_status,
    fact.viewpoint_entity_id ?? 'no-viewpoint',
    fact.knowledge_subject_id ?? 'no-knowledge-subject'
  ].join('\u0000');
}
