import { createHash } from 'node:crypto';
import type { EpistemicStatus, KnowledgeAuthorityGrade, KnowledgeLayer, KnowledgePromotionRecord, KnowledgeRevisionRecord, TemporalScopeInput, TemporalScopeRecord } from '../../contracts/knowledge-lifecycle.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { KnowledgeRepository } from '../../infrastructure/db/repositories/knowledge-repository.js';
import type { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';

export interface CreateKnowledgeInput {
  knowledgeType: string;
  canonicalKey: string;
  layer: Extract<KnowledgeLayer, 'temporary' | 'candidate' | 'derived'>;
  authorityGrade: KnowledgeAuthorityGrade;
  epistemicStatus: EpistemicStatus;
  negated?: boolean;
  viewpointEntityId?: string | null;
  temporal: TemporalScopeInput;
  content: unknown;
  contentText: string;
  evidence: unknown[];
  sourceType: string;
  sourceId: string;
  sourceHash?: string | null;
  sourceLocator: Record<string, unknown>;
  extractorVersion?: string | null;
  createdByType: 'boss' | 'agent' | 'system' | 'migration';
  createdById?: string | null;
}

export class KnowledgeLifecycleService {
  public constructor(
    private readonly repository: KnowledgeRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public create(scope: BookScope, input: CreateKnowledgeInput): KnowledgeRevisionRecord {
    const now = this.clock.now().toISOString();
    return this.unitOfWork.run(() => {
      const ensured = this.repository.ensureItem(scope, this.ids.next(), input.knowledgeType, input.canonicalKey, now);
      const temporalScopeId = this.ids.next();
      this.repository.createTemporalScope(scope, temporalScopeId, input.temporal, now);
      const revision = this.repository.createRevision(scope, {
        revisionId: this.ids.next(),
        itemId: ensured.itemId,
        revision: this.repository.nextRevision(scope, ensured.itemId),
        layer: input.layer,
        authorityGrade: input.authorityGrade,
        epistemicStatus: input.epistemicStatus,
        negated: input.negated ?? false,
        viewpointEntityId: input.viewpointEntityId ?? null,
        temporalScopeId,
        contentJson: stableJson(input.content),
        contentText: input.contentText,
        contentHash: sha256(stableJson(input.content)),
        evidenceJson: stableJson(input.evidence),
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceHash: input.sourceHash ?? null,
        sourceLocatorJson: stableJson(input.sourceLocator),
        canonRevision: input.temporal.canonRevision,
        extractorVersion: input.extractorVersion ?? null,
        createdByType: input.createdByType,
        createdById: input.createdById ?? null,
        status: 'active',
        now
      });
      this.repository.setCurrentRevision(scope, ensured.itemId, revision.knowledgeRevisionId, now);
      return revision;
    });
  }

  public promote(scope: BookScope, candidateRevisionId: string, input: {
    decisionType: 'boss_confirmed' | 'graded_settlement' | 'chief_editor_approved';
    decisionSourceType: string;
    decisionSourceId: string;
    canonRevision: number;
    canonRevisionId?: string | null;
    failAt?: 'after_canon_revision';
  }): KnowledgePromotionRecord {
    const candidate = this.repository.requireRevision(scope, candidateRevisionId);
    const temporal = this.repository.requireTemporalScope(scope, candidate.temporalScopeId);
    const checks = this.checkPromotion(candidate, temporal, input.decisionType);
    const now = this.clock.now().toISOString();
    return this.unitOfWork.run(() => {
      const canonRevisionId = this.ids.next();
      const canon = this.repository.createRevision(scope, {
        revisionId: canonRevisionId,
        itemId: candidate.knowledgeItemId,
        parentRevisionId: candidate.knowledgeRevisionId,
        revision: this.repository.nextRevision(scope, candidate.knowledgeItemId),
        layer: 'canon',
        authorityGrade: candidate.authorityGrade,
        epistemicStatus: candidate.epistemicStatus,
        negated: candidate.negated,
        viewpointEntityId: candidate.viewpointEntityId,
        temporalScopeId: candidate.temporalScopeId,
        contentJson: stableJson(candidate.content),
        contentText: candidate.contentText,
        contentHash: candidate.contentHash,
        evidenceJson: stableJson(candidate.evidence),
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        sourceHash: candidate.sourceHash,
        sourceLocatorJson: stableJson(candidate.sourceLocator),
        canonRevision: input.canonRevision,
        extractorVersion: null,
        createdByType: input.decisionType === 'boss_confirmed' ? 'boss' : 'system',
        createdById: input.decisionSourceId,
        status: 'active',
        now
      });
      if (input.failAt === 'after_canon_revision') throw new Error('simulated-knowledge-promotion-failure');
      this.repository.setRevisionStatus(scope, candidateRevisionId, 'active', 'promoted', now);
      this.repository.setCurrentRevision(scope, candidate.knowledgeItemId, canon.knowledgeRevisionId, now);
      const promotionId = this.ids.next();
      this.repository.createPromotion(scope, {
        promotionId,
        itemId: candidate.knowledgeItemId,
        candidateRevisionId,
        canonRevisionId: canon.knowledgeRevisionId,
        checksJson: stableJson(checks),
        decisionType: input.decisionType,
        decisionSourceType: input.decisionSourceType,
        decisionSourceId: input.decisionSourceId,
        now
      });
      this.repository.createCanonSourceBinding(scope, {
        bindingId: this.ids.next(),
        knowledgeRevisionId: canon.knowledgeRevisionId,
        canonRevisionId: input.canonRevisionId ?? null,
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        sourceHash: candidate.sourceHash!,
        sourceLocatorJson: stableJson(candidate.sourceLocator),
        now
      });
      return { promotionId, candidateRevisionId, canonRevisionId: canon.knowledgeRevisionId, decisionType: input.decisionType, status: 'committed' };
    });
  }

  public migrateLegacyFacts(scope: BookScope, canonRevision: number): number {
    let migrated = 0;
    for (const fact of this.repository.listLegacyFacts(scope)) {
      const revision = this.create(scope, {
        knowledgeType: 'legacy_fact',
        canonicalKey: fact.factId,
        layer: 'candidate',
        authorityGrade: fact.grade,
        epistemicStatus: 'objective',
        temporal: {
          worldTimeStart: fact.storyTimeStart,
          worldTimeEnd: fact.storyTimeEnd,
          recordedAt: fact.createdAt,
          canonRevision,
          completeness: 'partial'
        },
        content: { subjectEntityId: fact.subjectEntityId, relationKey: fact.relationKey, value: fact.value },
        contentText: `${fact.subjectEntityId} ${fact.relationKey} ${stableJson(fact.value)}`,
        evidence: fact.evidence,
        sourceType: 'legacy_fact_assertion',
        sourceId: fact.factId,
        sourceHash: fact.sourceHash,
        sourceLocator: { chapterId: fact.sourceChapterId, manuscriptVersionId: fact.sourceManuscriptVersionId },
        createdByType: 'migration'
      });
      if (fact.status === 'active' && fact.sourceHash !== null) {
        this.promote(scope, revision.knowledgeRevisionId, {
          decisionType: 'graded_settlement',
          decisionSourceType: 'legacy_canon_binding',
          decisionSourceId: fact.factId,
          canonRevision
        });
      }
      migrated += 1;
    }
    return migrated;
  }

  private checkPromotion(
    candidate: KnowledgeRevisionRecord,
    temporal: TemporalScopeRecord,
    decisionType: 'boss_confirmed' | 'graded_settlement' | 'chief_editor_approved'
  ): Record<string, unknown> {
    if (candidate.layer !== 'candidate' || candidate.status !== 'active') {
      throw new DomainError(errorCodes.operationIncomplete, '只有活动候选版本可以提升', {}, false, 409);
    }
    if (candidate.sourceHash === null || !/^[a-f0-9]{64}$/u.test(candidate.sourceHash)) {
      throw new DomainError(errorCodes.operationIncomplete, '提升缺少可校验来源哈希', {}, false, 409);
    }
    if (candidate.epistemicStatus === 'ambiguous' || candidate.epistemicStatus === 'conflicted') {
      throw new DomainError(errorCodes.operationIncomplete, '歧义或冲突必须先形成已消歧的新候选', {}, false, 409);
    }
    if (candidate.authorityGrade === 'D' && decisionType !== 'boss_confirmed') {
      throw new DomainError(errorCodes.confirmationRequired, 'D级知识必须由老板确认', {}, false, 409);
    }
    if (decisionType === 'graded_settlement') {
      const epistemicallyScoped = candidate.epistemicStatus === 'objective' || temporal.knowledgeSubjectId !== null;
      if (!['A', 'B'].includes(candidate.authorityGrade) || !epistemicallyScoped || candidate.evidence.length === 0 || temporal.completeness === 'unknown') {
        throw new DomainError(errorCodes.operationIncomplete, '自动结算只接受有来源、时间可判定且认知主体明确的A/B级候选', {}, false, 409);
      }
      if (candidate.sourceType !== 'confirmed_manuscript' && candidate.sourceType !== 'legacy_fact_assertion') {
        throw new DomainError(errorCodes.operationIncomplete, '自动结算来源不是已确认正文', {}, false, 409);
      }
    }
    if (decisionType === 'chief_editor_approved' && candidate.authorityGrade === 'D') {
      throw new DomainError(errorCodes.confirmationRequired, '主编不能代替老板确认D级知识', {}, false, 409);
    }
    return {
      sourceHash: true,
      evidenceCount: candidate.evidence.length,
      epistemicStatus: candidate.epistemicStatus,
      temporalCompleteness: temporal.completeness,
      decisionType
    };
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value)) ?? 'null';
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]));
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
