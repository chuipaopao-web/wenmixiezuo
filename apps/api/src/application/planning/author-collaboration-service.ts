import { createHash } from 'node:crypto';
import {
  authorInputStatuses,
  hashStableContractContent,
  parseAuthorPlanningInputDraft,
  type AuthorInputStatus,
  type AuthorInputSurface,
  type AuthorPlanningInput,
  type AuthorPlanningInputDraft,
  type AuthorPlanningDecisionStatus as SharedAuthorPlanningDecisionStatus,
  type CreateAuthorPlanningInputCommand,
  type DecideAuthorPlanningInputCommand,
  type VersionReference
} from '@wenmi/contracts';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import {
  AuthorPlanningInputRepository,
  type AuthorPlanningInputRow
} from '../../infrastructure/db/repositories/author-planning-input-repository.js';

export type AuthorPlanningDecisionStatus = SharedAuthorPlanningDecisionStatus;
export type AuthorPlanningInputView = AuthorPlanningInput;
export type CreateAuthorPlanningInput = CreateAuthorPlanningInputCommand;
export type DecideAuthorPlanningInput = DecideAuthorPlanningInputCommand;
const subjectTypesBySurface: Record<AuthorInputSurface, readonly string[]> = {
  book_profile: ['book'],
  setting: ['setting', 'setting_module'],
  volume_plan: ['volume_plan'],
  event: ['story_event', 'event_sequence'],
  chapter_outline: ['chapter_outline', 'event_chapter_sequence', 'event_chapter_outline'],
  manuscript: ['chapter', 'manuscript']
};
const versionReferenceKinds: readonly VersionReference['kind'][] = [
  'book_profile', 'setting', 'volume_plan', 'story_event', 'chapter_outline',
  'chapter', 'settlement', 'canon_revision'
];

export class AuthorCollaborationService {
  public constructor(
    private readonly repository: AuthorPlanningInputRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public create(scope: BookScope, input: CreateAuthorPlanningInput): AuthorPlanningInputView {
    assertBookScope(scope);
    const draft = parseAuthorPlanningInputDraft(input);
    this.validateDraft(draft);
    const idempotencyKey = this.requireIdempotencyKey(input.idempotencyKey);
    const requestHash = requestHashFor({ ...draft, idempotencyKey });
    const existing = this.repository.findByIdempotencyKey(scope, idempotencyKey);
    if (existing !== null) {
      if (existing.request_hash !== requestHash) this.throwIdempotencyConflict();
      return this.view(scope, existing);
    }
    this.validateReferences(scope, draft);
    const now = this.clock.now().toISOString();
    const authorInputId = this.ids.next();
    return this.unitOfWork.run(() => {
      this.repository.insert(scope, {
        id: authorInputId,
        surface: draft.surface,
        subjectType: draft.subjectType,
        subjectId: draft.subjectId,
        intentStrength: draft.intentStrength,
        originalText: draft.originalText,
        originalTextHash: createHash('sha256').update(draft.originalText, 'utf8').digest('hex'),
        scopeNotes: draft.scopeNotes,
        idempotencyKey,
        requestHash,
        now
      });
      for (const [sortOrder, attachmentId] of draft.attachmentRefs.entries()) {
        this.repository.insertLink(scope, {
          id: this.ids.next(), authorInputId, decisionId: null, linkType: 'attachment',
          targetType: 'author_attachment', targetId: attachmentId, targetVersion: null,
          targetHash: null, relation: 'attached', sortOrder, now
        });
      }
      for (const [sortOrder, agentId] of draft.mentionedAgentIds.entries()) {
        this.repository.insertLink(scope, {
          id: this.ids.next(), authorInputId, decisionId: null, linkType: 'mention',
          targetType: 'agent_instance', targetId: agentId, targetVersion: null,
          targetHash: null, relation: 'mentioned', sortOrder, now
        });
      }
      return this.get(scope, authorInputId);
    });
  }

  public get(scope: BookScope, authorInputId: string): AuthorPlanningInputView {
    return this.view(scope, this.repository.require(scope, authorInputId));
  }

  public list(scope: BookScope, filter: {
    surface?: AuthorInputSurface; subjectType?: string; subjectId?: string;
  } = {}): AuthorPlanningInputView[] {
    assertBookScope(scope);
    if (filter.surface !== undefined && !Object.hasOwn(subjectTypesBySurface, filter.surface)) {
      throw new DomainError(errorCodes.validation, '作者想法位置无效。');
    }
    return this.repository.list(scope, filter).map((row) => this.view(scope, row));
  }

  public decide(scope: BookScope, authorInputId: string, input: DecideAuthorPlanningInput): AuthorPlanningInputView {
    assertBookScope(scope);
    const expectedStatus = this.requireStatus(input.expectedStatus);
    const status = this.requireDecisionStatus(input.status);
    const handlingReason = normalizeLimitedText(input.handlingReason, '处理理由', 2000);
    const idempotencyKey = this.requireIdempotencyKey(input.idempotencyKey);
    const appliedToRefs = this.validateAppliedRefs(status, input.appliedToRefs);
    const requestHash = requestHashFor({ authorInputId, expectedStatus, status, handlingReason, appliedToRefs, idempotencyKey });
    const priorDecision = this.repository.findDecisionByIdempotencyKey(scope, idempotencyKey);
    if (priorDecision !== null) {
      if (priorDecision.author_input_id !== authorInputId || priorDecision.request_hash !== requestHash) this.throwIdempotencyConflict();
      return this.get(scope, authorInputId);
    }
    const current = this.repository.require(scope, authorInputId);
    if (current.status !== expectedStatus) {
      throw new DomainError(errorCodes.bookVersionConflict, '作者想法状态已经变化，请刷新后再处理。', {
        expectedStatus, actualStatus: current.status
      }, false, 409);
    }
    this.assertTransition(current.status, status);
    const now = this.clock.now().toISOString();
    const decisionId = this.ids.next();
    return this.unitOfWork.run(() => {
      this.repository.insertDecision(scope, {
        id: decisionId, authorInputId, fromStatus: current.status, toStatus: status,
        handlingReason, idempotencyKey, requestHash, now
      });
      if (!this.repository.updateDecision(scope, authorInputId, expectedStatus, { status, handlingReason, now })) {
        throw new DomainError(errorCodes.bookVersionConflict, '作者想法状态已经变化，请刷新后再处理。', {}, false, 409);
      }
      for (const [sortOrder, ref] of appliedToRefs.entries()) {
        this.repository.insertLink(scope, {
          id: this.ids.next(), authorInputId, decisionId, linkType: 'application',
          targetType: ref.kind, targetId: ref.id, targetVersion: ref.version,
          targetHash: normalizeHash(ref.contentHash), relation: status === 'adopted' ? 'adopted' : 'adapted', sortOrder, now
        });
      }
      return this.get(scope, authorInputId);
    });
  }

  private validateDraft(draft: AuthorPlanningInputDraft): void {
    if (!subjectTypesBySurface[draft.surface].includes(draft.subjectType)) {
      throw new DomainError(errorCodes.validation, '作者想法的目标类型与当前位置不一致。');
    }
    if (draft.originalText.length > 20_000) throw new DomainError(errorCodes.validation, '单条作者想法最多20000字。');
    if (draft.subjectType.length > 80 || (draft.subjectId?.length ?? 0) > 128) {
      throw new DomainError(errorCodes.validation, '作者想法的目标定位过长。');
    }
    if ((draft.scopeNotes?.length ?? 0) > 4000) throw new DomainError(errorCodes.validation, '作用范围说明最多4000字。');
    if (draft.attachmentRefs.length > 6) throw new DomainError(errorCodes.validation, '每条作者想法最多引用6个附件。');
    if (draft.mentionedAgentIds.length > 11) throw new DomainError(errorCodes.validation, '点名成员数量超过当前创作团队上限。');
  }

  private validateReferences(scope: BookScope, draft: AuthorPlanningInputDraft): void {
    for (const attachmentId of draft.attachmentRefs) {
      if (!this.repository.attachmentExists(scope, attachmentId)) {
        throw new DomainError(errorCodes.validation, '附件不存在、已移除或不属于当前书籍。', {}, false, 404);
      }
    }
    for (const agentId of draft.mentionedAgentIds) {
      if (!this.repository.agentExists(scope, agentId)) {
        throw new DomainError(errorCodes.validation, '点名成员不存在或不属于当前书籍。', {}, false, 404);
      }
    }
  }

  private validateAppliedRefs(status: AuthorPlanningDecisionStatus, refs: VersionReference[]): VersionReference[] {
    if (!Array.isArray(refs)) throw new DomainError(errorCodes.validation, '采用位置必须是列表。');
    if ((status === 'adopted' || status === 'adapted') && refs.length === 0) {
      throw new DomainError(errorCodes.validation, '采用作者想法时必须记录采用到哪个版本。');
    }
    if (status !== 'adopted' && status !== 'adapted' && refs.length > 0) {
      throw new DomainError(errorCodes.validation, '暂存、未采用或撤回不能伪造采用位置。');
    }
    const seen = new Set<string>();
    return refs.map((ref) => {
      if (typeof ref !== 'object' || ref === null || typeof ref.kind !== 'string' || typeof ref.id !== 'string'
        || !Number.isInteger(ref.version) || ref.version < 0 || typeof ref.contentHash !== 'string'
        || typeof ref.required !== 'boolean') throw new DomainError(errorCodes.validation, '采用位置格式无效。');
      if (!(versionReferenceKinds as readonly string[]).includes(ref.kind)) {
        throw new DomainError(errorCodes.validation, '采用对象类型无效。');
      }
      const key = `${ref.kind}:${ref.id}:${ref.version}`;
      if (seen.has(key)) throw new DomainError(errorCodes.validation, '采用位置不能重复。');
      seen.add(key);
      return { ...ref, id: normalizeLimitedText(ref.id, '采用对象ID', 128), contentHash: normalizeHash(ref.contentHash) };
    });
  }

  private assertTransition(from: AuthorInputStatus, to: AuthorPlanningDecisionStatus): void {
    if (from === 'withdrawn' || from === 'superseded') {
      throw new DomainError(errorCodes.bookVersionConflict, '已撤回或已被替代的作者想法不能再次处理。', {}, false, 409);
    }
    if ((from === 'adopted' || from === 'adapted') && to !== 'withdrawn') {
      throw new DomainError(errorCodes.bookVersionConflict, '已采用的作者想法只能撤回，不能静默改成其他结论。', {}, false, 409);
    }
  }

  private requireStatus(value: unknown): AuthorInputStatus {
    if (typeof value !== 'string' || !(authorInputStatuses as readonly string[]).includes(value)) {
      throw new DomainError(errorCodes.validation, '预期作者想法状态无效。');
    }
    return value as AuthorInputStatus;
  }

  private requireDecisionStatus(value: unknown): AuthorPlanningDecisionStatus {
    if (value === 'adopted' || value === 'adapted' || value === 'parked' || value === 'rejected' || value === 'withdrawn') return value;
    throw new DomainError(errorCodes.validation, '作者想法处理状态无效。');
  }

  private requireIdempotencyKey(value: unknown): string {
    return normalizeLimitedText(value, '幂等键', 200);
  }

  private throwIdempotencyConflict(): never {
    throw new DomainError(errorCodes.bookVersionConflict, '相同幂等键已经用于不同内容。', {}, false, 409);
  }

  private view(scope: BookScope, row: AuthorPlanningInputRow): AuthorPlanningInputView {
    const links = this.repository.links(scope, row.author_input_id).map((link) => ({
      linkId: link.link_id,
      linkType: link.link_type,
      sortOrder: link.sort_order,
      targetType: link.target_type,
      targetId: link.target_id,
      targetVersion: link.target_version,
      targetHash: link.target_hash,
      relation: link.relation,
      createdAt: link.created_at
    }));
    const applicationLinks = links.filter((link) => link.linkType === 'application');
    return {
      authorInputId: row.author_input_id,
      ownerId: row.owner_id,
      bookId: row.book_id,
      surface: row.surface,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      intentStrength: row.intent_strength,
      originalText: row.original_text,
      originalTextHash: row.original_text_hash,
      scopeNotes: row.scope_notes,
      status: row.status,
      handlingReason: row.handling_reason,
      attachmentRefs: links.filter((link) => link.linkType === 'attachment').map((link) => link.targetId),
      mentionedAgentIds: links.filter((link) => link.linkType === 'mention').map((link) => link.targetId),
      appliedToRefs: applicationLinks.map((link) => ({
        kind: link.targetType as VersionReference['kind'], id: link.targetId,
        version: link.targetVersion ?? 0, contentHash: link.targetHash ?? '', required: true
      })),
      links,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      decidedAt: row.decided_at
    };
  }
}

function normalizeLimitedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainError(errorCodes.validation, `${field}不能为空。`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) throw new DomainError(errorCodes.validation, `${field}最多${maximum}个字符。`);
  return normalized;
}

function normalizeHash(value: string): string {
  const normalized = value.startsWith('sha256:') ? value.slice(7) : value;
  if (!/^[0-9a-f]{64}$/u.test(normalized)) throw new DomainError(errorCodes.validation, '采用位置内容指纹无效。');
  return normalized;
}

function requestHashFor(value: unknown): string {
  return hashStableContractContent(value).slice('sha256:'.length);
}
