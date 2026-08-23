import { coreWorkflowStages, hashStableContractContent, parseEventChainContent } from '@wenmi/contracts';
import type {
  AuthorObjectDraftView, CharacterCardContent, CharacterCardView, CoreWorkflowStage, CoreWorkflowV6View,
  CreativeLedgerEntryView, CreativeLedgerType, EventRoleAssignmentView, StorylineContent,
  StorylineFrontierView, StorylineGrowthCandidateContent, StorylineGrowthCandidateView,
  StorylineLifecycleStatus, StorylineOpenQuestionView, StorylineRelationView, StorylineVersionView,
  StorylineVolumeParticipationStatus, WorkflowInvalidationView
} from '@wenmi/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { SqliteDataRepository } from '../../infrastructure/db/repositories/sqlite-data-repository.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';

type JsonObject = Record<string, unknown>;
type Stored = Record<string, unknown>;
type SqlValue = string | number | bigint | Uint8Array | null;
export interface SaveCoreVersionInput<T> {
  content: T; sourceTaskId?: string | null; sourceVersionIds?: string[];
  authorInputRefs?: string[]; parentVersionId?: string | null; baseVersion?: number;
}
export interface CoreLedgerInput {
  ledgerType: CreativeLedgerType; truthStatus: 'planned' | 'actual'; scopeType: CreativeLedgerEntryView['scopeType'];
  scopeId: string; subjectKey: string; entryStatus: CreativeLedgerEntryView['entryStatus']; content: JsonObject;
  sourceKind: CreativeLedgerEntryView['sourceKind']; sourceVersionId: string; sourceLocator?: JsonObject | null;
  supersedesEntryId?: string | null;
}

export class CoreWorkflowV6Service {
  private readonly persistence: SqliteDataRepository;

  public constructor(private readonly database: DatabaseSync, private readonly ids: IdGenerator, private readonly clock: Clock) {
    this.persistence = new SqliteDataRepository(database);
  }

  public view(scope: BookScope): CoreWorkflowV6View {
    this.requireBook(scope);
    this.ensureOpeningProtagonistCards(scope);
    const storylineRows = this.rows(`SELECT storyline_id,sort_order,lifecycle_status,active_version_id FROM storylines
      WHERE owner_id=? AND book_id=? ORDER BY sort_order,storyline_id`, scope.ownerId, scope.bookId);
    const storylines = storylineRows.map((row) => {
      const versions = this.storylineVersions(scope, text(row.storyline_id));
      const activeVersionId = nullableText(row.active_version_id);
      return {
        storylineId: text(row.storyline_id), sortOrder: number(row.sort_order),
        lifecycleStatus: text(row.lifecycle_status) as StorylineLifecycleStatus, activeVersionId,
        activeVersion: versions.find((item) => item.storylineVersionId === activeVersionId) ?? null, versions
      };
    });
    const relations = this.rows(`SELECT storyline_relation_id,from_storyline_id,to_storyline_id,relation_type,content_json,status
      FROM storyline_relations WHERE owner_id=? AND book_id=? ORDER BY created_at,storyline_relation_id`, scope.ownerId, scope.bookId)
      .map((row) => ({
        storylineRelationId: text(row.storyline_relation_id), fromStorylineId: text(row.from_storyline_id),
        toStorylineId: text(row.to_storyline_id), relationType: text(row.relation_type) as StorylineRelationView['relationType'],
        description: text(parseObject(text(row.content_json)).description ?? ''), status: text(row.status) as StorylineRelationView['status']
      }));
    const volumeParticipations = this.rows(`SELECT storyline_volume_participation_id,storyline_id,volume_plan_id,
      participation_status,responsibility,source_storyline_version_id,status FROM storyline_volume_participations
      WHERE owner_id=? AND book_id=? ORDER BY created_at,storyline_volume_participation_id`, scope.ownerId, scope.bookId)
      .map((row) => ({
        storylineVolumeParticipationId: text(row.storyline_volume_participation_id), storylineId: text(row.storyline_id),
        volumePlanId: text(row.volume_plan_id), participationStatus: text(row.participation_status) as StorylineVolumeParticipationStatus,
        responsibility: nullableText(row.responsibility), sourceStorylineVersionId: text(row.source_storyline_version_id),
        status: text(row.status) as 'active' | 'stale' | 'archived'
      }));
    const characters = this.rows(`SELECT c.character_id,c.character_kind,c.lifecycle_status,c.active_version_id,
      c.promoted_from_character_id,v.version,v.content_json FROM character_cards c LEFT JOIN character_card_versions v
      ON v.owner_id=c.owner_id AND v.book_id=c.book_id AND v.character_card_version_id=c.active_version_id
      WHERE c.owner_id=? AND c.book_id=? ORDER BY c.created_at,c.character_id`, scope.ownerId, scope.bookId)
      .map((row): CharacterCardView => ({
        characterId: text(row.character_id), characterKind: text(row.character_kind) as CharacterCardView['characterKind'],
        lifecycleStatus: text(row.lifecycle_status) as CharacterCardView['lifecycleStatus'], activeVersionId: nullableText(row.active_version_id),
        promotedFromCharacterId: nullableText(row.promoted_from_character_id), version: number(row.version),
        content: row.content_json === null ? null : parseObject(text(row.content_json)) as unknown as CharacterCardContent
      }));
    const eventRoleAssignments = this.rows(`SELECT event_role_assignment_id,event_chain_version_id,event_node_id,role_function_key,
      role_function_label,requirement_json,assigned_character_id,assignment_status,source_character_version_id
      FROM event_role_assignments WHERE owner_id=? AND book_id=? ORDER BY created_at,event_role_assignment_id`, scope.ownerId, scope.bookId)
      .map((row): EventRoleAssignmentView => ({
        eventRoleAssignmentId: text(row.event_role_assignment_id), eventChainVersionId: text(row.event_chain_version_id),
        eventNodeId: text(row.event_node_id), roleFunctionKey: text(row.role_function_key), roleFunctionLabel: text(row.role_function_label),
        requirement: parseObject(text(row.requirement_json)), assignedCharacterId: nullableText(row.assigned_character_id),
        assignmentStatus: text(row.assignment_status) as EventRoleAssignmentView['assignmentStatus'],
        sourceCharacterVersionId: nullableText(row.source_character_version_id)
      }));
    const ledgers = Object.fromEntries((['storyline','relationship','world_state','causality','foreshadow','settlement'] as CreativeLedgerType[])
      .map((ledgerType) => [ledgerType, { planned: [] as CreativeLedgerEntryView[], actual: [] as CreativeLedgerEntryView[] }])) as CoreWorkflowV6View['ledgers'];
    for (const entry of this.ledgerEntries(scope)) ledgers[entry.ledgerType][entry.truthStatus].push(entry);
    const state = this.one(`SELECT active_stage,state_version,blocking_reason FROM core_workflow_states_v6
      WHERE owner_id=? AND book_id=?`, scope.ownerId, scope.bookId);
    return {
      contractVersion: 2, stage: (state === undefined ? 'setting' : text(state.active_stage)) as CoreWorkflowStage,
      stateVersion: state === undefined ? 0 : number(state.state_version), blockingReason: state === undefined ? null : nullableText(state.blocking_reason),
      storylines, growth: this.storylineGrowth(scope), relations, volumeParticipations, characters, eventRoleAssignments, ledgers,
      drafts: this.drafts(scope), invalidations: this.invalidations(scope)
    };
  }

  public saveStorylineFrontier(scope: BookScope, input: {
    storylineId?: string | null; summary: string; targetVolumeNumber?: number | null; stageEnding?: string | null;
    fullBookEndingKnown?: boolean; expectedActiveVersionId?: string | null; sourceKind?: StorylineFrontierView['sourceKind'];
    sourceVersionIds?: string[];
  }): StorylineFrontierView {
    this.requireBook(scope); requireNonEmpty(input.summary, '作者目前想到的位置');
    if (input.storylineId !== undefined && input.storylineId !== null) this.requireStoryline(scope, input.storylineId);
    if (input.targetVolumeNumber !== undefined && input.targetVolumeNumber !== null
      && (!Number.isInteger(input.targetVolumeNumber) || input.targetVolumeNumber < 1)) throw validation('目标卷数必须是正整数');
    const storylineId = input.storylineId ?? null;
    const active = this.one(`SELECT frontier_version_id,version FROM storyline_frontier_versions
      WHERE owner_id=? AND book_id=? AND storyline_id IS ? AND status='active'`, scope.ownerId, scope.bookId, storylineId);
    const expected = input.expectedActiveVersionId ?? null;
    if ((active === undefined ? null : text(active.frontier_version_id)) !== expected) throw conflict('作者边界基线已经变化，请刷新后重试');
    const id = this.ids.next(); const now = this.now(); const version = active === undefined ? 1 : number(active.version) + 1;
    const payload = { summary: input.summary.trim(), targetVolumeNumber: input.targetVolumeNumber ?? null,
      stageEnding: nullableTrim(input.stageEnding), fullBookEndingKnown: input.fullBookEndingKnown === true };
    this.tx(() => {
      this.persistence.statement(`UPDATE storyline_frontier_versions SET status='superseded' WHERE owner_id=? AND book_id=?
        AND storyline_id IS ? AND status='active'`).run(scope.ownerId, scope.bookId, storylineId);
      this.persistence.statement(`INSERT INTO storyline_frontier_versions (frontier_version_id,owner_id,book_id,storyline_id,
        version,status,summary,target_volume_number,stage_ending,full_book_ending_known,parent_version_id,source_kind,
        source_version_ids_json,content_hash,created_at,confirmed_at) VALUES (?,?,?,?,?,'active',?,?,?,?,?,?,?,?,?,?)`).run(
          id, scope.ownerId, scope.bookId, storylineId, version, payload.summary, payload.targetVolumeNumber, payload.stageEnding,
          payload.fullBookEndingKnown ? 1 : 0, active === undefined ? null : text(active.frontier_version_id),
          input.sourceKind ?? 'author', stableJson(input.sourceVersionIds ?? []), hash(payload), now, now);
    });
    return this.storylineGrowth(scope).frontiers.find((item) => item.frontierVersionId === id)!;
  }

  public addStorylineOpenQuestion(scope: BookScope, input: { storylineId?: string | null; question: string;
    sourceKind?: StorylineOpenQuestionView['sourceKind']; sourceVersionId?: string | null }): StorylineOpenQuestionView {
    this.requireBook(scope); requireNonEmpty(input.question, '开放问题');
    if (input.storylineId !== undefined && input.storylineId !== null) this.requireStoryline(scope, input.storylineId);
    const id = this.ids.next(); const now = this.now();
    this.persistence.statement(`INSERT INTO storyline_open_questions_v6 (open_question_id,owner_id,book_id,storyline_id,
      question,source_kind,source_version_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'open',?,?)`).run(id,
        scope.ownerId, scope.bookId, input.storylineId ?? null, input.question.trim(), input.sourceKind ?? 'author',
        input.sourceVersionId ?? null, now, now);
    return this.storylineGrowth(scope).openQuestions.find((item) => item.openQuestionId === id)!;
  }

  public resolveStorylineOpenQuestion(scope: BookScope, openQuestionId: string, resolution: string): void {
    this.requireBook(scope); requireNonEmpty(resolution, '问题结论');
    const changed = this.persistence.statement(`UPDATE storyline_open_questions_v6 SET status='resolved',resolution=?,
      resolved_at=?,updated_at=? WHERE owner_id=? AND book_id=? AND open_question_id=? AND status='open'`).run(
        resolution.trim(), this.now(), this.now(), scope.ownerId, scope.bookId, openQuestionId).changes;
    if (changed !== 1) throw conflict('开放问题不存在、已处理或不属于当前书籍');
  }

  public createStorylineGrowthRound(scope: BookScope, input: { triggerKind: 'author_request' | 'event_settlement' | 'volume_settlement';
    triggerObjectId: string; triggerVersionId: string; evidenceRefs: Array<{ sourceKind: string; sourceVersionId: string; locator?: string }>;
    idempotencyKey: string }): string {
    this.requireBook(scope); requireNonEmpty(input.triggerObjectId, '触发对象'); requireNonEmpty(input.triggerVersionId, '触发版本');
    requireNonEmpty(input.idempotencyKey, '幂等键');
    if (input.triggerKind !== 'author_request') {
      const stageType = input.triggerKind === 'volume_settlement' ? 'volume' : 'story_arc';
      if (this.one(`SELECT 1 AS ok FROM stage_settlements WHERE owner_id=? AND book_id=? AND stage_settlement_id=?
        AND stage_type=? AND status='active'`, scope.ownerId, scope.bookId, input.triggerVersionId, stageType) === undefined) {
        throw validation('故事线提炼只能引用当前书籍的有效结算');
      }
    }
    const existing = this.one(`SELECT growth_round_id FROM storyline_growth_rounds_v6 WHERE owner_id=? AND book_id=?
      AND idempotency_key=?`, scope.ownerId, scope.bookId, input.idempotencyKey);
    if (existing !== undefined) return text(existing.growth_round_id);
    if (input.triggerKind !== 'author_request'
      && !input.evidenceRefs.some((item) => item.sourceVersionId === input.triggerVersionId)) {
      throw validation('故事线提炼证据必须引用本次有效结算版本');
    }
    const id = this.ids.next(); const now = this.now();
    this.tx(() => {
      this.persistence.statement(`UPDATE storyline_growth_candidates_v6 SET status='stale',stale_reason=?
        WHERE owner_id=? AND book_id=? AND status IN ('candidate','observing') AND growth_round_id IN (
          SELECT growth_round_id FROM storyline_growth_rounds_v6 WHERE owner_id=? AND book_id=?
          AND trigger_kind=? AND trigger_object_id=? AND trigger_version_id<>?
        )`).run('上游结算已生成新版本，请按新结算重新提炼', scope.ownerId, scope.bookId,
          scope.ownerId, scope.bookId, input.triggerKind, input.triggerObjectId, input.triggerVersionId);
      this.persistence.statement(`UPDATE storyline_growth_rounds_v6 SET status='stale',updated_at=?
        WHERE owner_id=? AND book_id=? AND trigger_kind=? AND trigger_object_id=? AND trigger_version_id<>?
        AND status<>'stale'`).run(now, scope.ownerId, scope.bookId, input.triggerKind, input.triggerObjectId, input.triggerVersionId);
      this.persistence.statement(`INSERT INTO storyline_growth_rounds_v6 (growth_round_id,owner_id,book_id,trigger_kind,
        trigger_object_id,trigger_version_id,idempotency_key,evidence_hash,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,'pending',?,?)`).run(id, scope.ownerId, scope.bookId, input.triggerKind,
          input.triggerObjectId, input.triggerVersionId, input.idempotencyKey, hash(input.evidenceRefs), now, now);
    });
    return id;
  }

  public addStorylineGrowthCandidate(scope: BookScope, input: { growthRoundId: string;
    candidateKind: StorylineGrowthCandidateView['candidateKind']; storylineId?: string | null; title: string;
    content: StorylineGrowthCandidateContent; evidenceRefs: StorylineGrowthCandidateView['evidenceRefs'];
    sourceBatchId?: string | null; sourceBatchMemberId?: string | null; basedOnVersionIds?: string[] }): StorylineGrowthCandidateView {
    this.requireBook(scope); requireNonEmpty(input.title, '候选标题'); validateGrowthCandidate(input.content);
    const round = this.one(`SELECT trigger_version_id FROM storyline_growth_rounds_v6 WHERE owner_id=? AND book_id=?
      AND growth_round_id=?`, scope.ownerId, scope.bookId, input.growthRoundId);
    if (round === undefined) throw notFound('故事线提炼轮次不存在或不属于当前书籍');
    if (input.storylineId !== undefined && input.storylineId !== null) this.requireStoryline(scope, input.storylineId);
    for (const storylineId of input.content.pushesStorylineIds) this.requireStoryline(scope, storylineId);
    if (input.evidenceRefs.length === 0) throw validation('候选必须包含至少一条正文或结算证据');
    if (!input.evidenceRefs.some((item) => item.sourceVersionId === text(round.trigger_version_id))) {
      throw validation('候选证据必须包含本次提炼的触发版本');
    }
    const evidenceHash = hash(input.evidenceRefs); const now = this.now();
    const existing = this.one(`SELECT candidate_id FROM storyline_growth_candidates_v6 WHERE owner_id=? AND book_id=?
      AND growth_round_id=? AND candidate_kind=? AND evidence_hash=? AND title=?`, scope.ownerId, scope.bookId,
        input.growthRoundId, input.candidateKind, evidenceHash, input.title.trim());
    if (existing !== undefined) return this.storylineGrowth(scope).candidates.find((item) => item.candidateId === text(existing.candidate_id))!;
    const id = this.ids.next();
    this.tx(() => {
      this.persistence.statement(`INSERT INTO storyline_growth_candidates_v6 (candidate_id,owner_id,book_id,growth_round_id,
        candidate_kind,storyline_id,status,title,content_json,evidence_refs_json,evidence_hash,source_batch_id,
        source_batch_member_id,based_on_version_ids_json,created_at) VALUES (?,?,?,?,?,?,'candidate',?,?,?,?,?,?,?,?)`).run(
          id, scope.ownerId, scope.bookId, input.growthRoundId, input.candidateKind, input.storylineId ?? null,
          input.title.trim(), stableJson(input.content), stableJson(input.evidenceRefs), evidenceHash,
          input.sourceBatchId ?? null, input.sourceBatchMemberId ?? null, stableJson(input.basedOnVersionIds ?? []), now);
      this.persistence.statement(`UPDATE storyline_growth_rounds_v6 SET status='completed',updated_at=? WHERE owner_id=?
        AND book_id=? AND growth_round_id=?`).run(now, scope.ownerId, scope.bookId, input.growthRoundId);
    });
    return this.storylineGrowth(scope).candidates.find((item) => item.candidateId === id)!;
  }

  public decideStorylineGrowthCandidate(scope: BookScope, candidateId: string, input: {
    decision: 'accepted' | 'rejected' | 'observing'; editedContent?: StorylineGrowthCandidateContent | null;
    idempotencyKey: string; expectedStatus: 'candidate'
  }): { decisionId: string; createdStorylineId: string | null; createdFrontierVersionId: string | null } {
    this.requireBook(scope); requireNonEmpty(input.idempotencyKey, '幂等键');
    const replay = this.one(`SELECT decision_id,created_storyline_id,created_frontier_version_id FROM storyline_growth_decisions_v6
      WHERE owner_id=? AND book_id=? AND idempotency_key=?`, scope.ownerId, scope.bookId, input.idempotencyKey);
    if (replay !== undefined) return { decisionId: text(replay.decision_id), createdStorylineId: nullableText(replay.created_storyline_id),
      createdFrontierVersionId: nullableText(replay.created_frontier_version_id) };
    const candidate = this.one(`SELECT * FROM storyline_growth_candidates_v6 WHERE owner_id=? AND book_id=? AND candidate_id=?`,
      scope.ownerId, scope.bookId, candidateId);
    if (candidate === undefined) throw notFound('故事线候选不存在或不属于当前书籍');
    if (text(candidate.status) !== input.expectedStatus) throw conflict('故事线候选已经处理或失效');
    const content = input.editedContent ?? parseObject(text(candidate.content_json)) as unknown as StorylineGrowthCandidateContent;
    validateGrowthCandidate(content); const now = this.now(); const decisionId = this.ids.next();
    let createdStorylineId: string | null = null; let createdFrontierVersionId: string | null = null;
    this.tx(() => {
      if (input.decision === 'accepted' && text(candidate.candidate_kind) === 'emerging_line') {
        const created = this.createStoryline(scope, { content: { title: text(candidate.title), lineKind: 'branch',
          coreQuestion: content.coreQuestion, stageGoal: content.summary, expectedStages: [], associatedCharacterIds: [],
          foreshadowingKeys: [], rhythmMethodVersionId: null }, sourceVersionIds: parseArray(text(candidate.based_on_version_ids_json)) });
        this.confirmStoryline(scope, created.storylineId, created.versionId, null); createdStorylineId = created.storylineId;
      }
      if (input.decision === 'accepted' && text(candidate.candidate_kind) === 'next_direction') {
        const active = this.one(`SELECT frontier_version_id FROM storyline_frontier_versions WHERE owner_id=? AND book_id=?
          AND storyline_id IS ? AND status='active'`, scope.ownerId, scope.bookId, nullableText(candidate.storyline_id));
        const frontier = this.saveStorylineFrontier(scope, { storylineId: nullableText(candidate.storyline_id), summary: content.summary,
          stageEnding: content.unknowns.join('；') || null, fullBookEndingKnown: false,
          expectedActiveVersionId: active === undefined ? null : text(active.frontier_version_id),
          sourceKind: 'accepted_recommendation', sourceVersionIds: parseArray(text(candidate.based_on_version_ids_json)) });
        createdFrontierVersionId = frontier.frontierVersionId;
      }
      const changed = this.persistence.statement(`UPDATE storyline_growth_candidates_v6 SET status=?,decided_at=? WHERE owner_id=?
        AND book_id=? AND candidate_id=? AND status='candidate'`).run(input.decision, now, scope.ownerId, scope.bookId, candidateId).changes;
      if (changed !== 1) throw conflict('故事线候选已经处理或失效');
      this.persistence.statement(`INSERT INTO storyline_growth_decisions_v6 (decision_id,owner_id,book_id,candidate_id,decision,
        edited_content_json,created_storyline_id,created_frontier_version_id,expected_candidate_status,idempotency_key,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(decisionId, scope.ownerId, scope.bookId, candidateId, input.decision,
          input.editedContent === undefined || input.editedContent === null ? null : stableJson(input.editedContent),
          createdStorylineId, createdFrontierVersionId, input.expectedStatus, input.idempotencyKey, now);
    });
    return { decisionId, createdStorylineId, createdFrontierVersionId };
  }
  public createStoryline(scope: BookScope, input: SaveCoreVersionInput<StorylineContent> & { sortOrder?: number }): { storylineId: string; versionId: string } {
    this.requireBook(scope); validateStoryline(input.content);
    const storylineId = this.ids.next(); const versionId = this.ids.next(); const now = this.now();
    const sortOrder = input.sortOrder ?? this.next(scope, 'storylines', 'sort_order');
    this.tx(() => {
      this.persistence.statement(`INSERT INTO storylines (storyline_id,owner_id,book_id,sort_order,lifecycle_status,created_at,updated_at)
        VALUES (?,?,?,?,'ideation',?,?)`).run(storylineId, scope.ownerId, scope.bookId, sortOrder, now, now);
      this.insertStorylineVersion(scope, storylineId, versionId, 1, input.baseVersion ?? 0, input, now);
    });
    return { storylineId, versionId };
  }

  public saveStorylineVersion(scope: BookScope, storylineId: string, input: SaveCoreVersionInput<StorylineContent>): string {
    this.requireStoryline(scope, storylineId); validateStoryline(input.content);
    const versionId = this.ids.next(); const version = this.nextStorylineVersion(scope, storylineId);
    this.insertStorylineVersion(scope, storylineId, versionId, version, input.baseVersion ?? version - 1, input, this.now());
    return versionId;
  }

  public confirmStoryline(scope: BookScope, storylineId: string, versionId: string, expectedActiveVersionId: string | null): void {
    this.requireStoryline(scope, storylineId);
    this.tx(() => {
      const candidate = this.one(`SELECT status FROM storyline_versions WHERE owner_id=? AND book_id=? AND storyline_id=?
        AND storyline_version_id=?`, scope.ownerId, scope.bookId, storylineId, versionId);
      if (candidate?.status !== 'candidate') throw conflict('故事线候选不存在或已经处理');
      const current = this.requireStoryline(scope, storylineId);
      if (current.activeVersionId !== expectedActiveVersionId) throw conflict('故事线基线已经变化，请刷新后重试');
      const now = this.now();
      this.persistence.statement(`UPDATE storyline_versions SET status='superseded' WHERE owner_id=? AND book_id=? AND storyline_id=? AND status='active'`)
        .run(scope.ownerId, scope.bookId, storylineId);
      this.persistence.statement(`UPDATE storyline_versions SET status='active',confirmed_at=? WHERE owner_id=? AND book_id=? AND storyline_id=?
        AND storyline_version_id=? AND status='candidate'`).run(now, scope.ownerId, scope.bookId, storylineId, versionId);
      this.persistence.statement(`UPDATE storylines SET active_version_id=?,lifecycle_status='active',updated_at=? WHERE owner_id=? AND book_id=?
        AND storyline_id=?`).run(versionId, now, scope.ownerId, scope.bookId, storylineId);
      if (current.activeVersionId !== null) this.invalidateStorylineConsumers(scope, storylineId, versionId, now);
    });
  }

  public reorderStorylines(scope: BookScope, storylineIds: string[]): void {
    this.requireBook(scope);
    if (storylineIds.length === 0 || new Set(storylineIds).size !== storylineIds.length) {
      throw validation('故事线排序不能为空或包含重复项');
    }
    const current = this.rows(`SELECT storyline_id FROM storylines WHERE owner_id=? AND book_id=?
      AND lifecycle_status<>'abandoned' ORDER BY sort_order,storyline_id`, scope.ownerId, scope.bookId)
      .map((row) => text(row.storyline_id));
    if (current.length !== storylineIds.length || current.some((id) => !storylineIds.includes(id))) {
      throw conflict('故事线集合已经变化，请刷新后重新排序');
    }
    this.tx(() => storylineIds.forEach((storylineId, index) => {
      this.persistence.statement(`UPDATE storylines SET sort_order=?,updated_at=? WHERE owner_id=? AND book_id=? AND storyline_id=?`)
        .run(index + 1, this.now(), scope.ownerId, scope.bookId, storylineId);
    }));
  }

  public updateStorylineLifecycle(scope: BookScope, storylineId: string, status: StorylineLifecycleStatus): void {
    this.requireStoryline(scope, storylineId);
    const changed = this.persistence.statement(`UPDATE storylines SET lifecycle_status=?,updated_at=? WHERE owner_id=? AND book_id=? AND storyline_id=?`)
      .run(status, this.now(), scope.ownerId, scope.bookId, storylineId).changes;
    if (changed !== 1) throw conflict('故事线状态更新失败');
  }
  public upsertRelation(scope: BookScope, input: { fromStorylineId: string; toStorylineId: string;
    relationType: StorylineRelationView['relationType']; description: string }): string {
    this.requireStoryline(scope, input.fromStorylineId); this.requireStoryline(scope, input.toStorylineId);
    if (input.fromStorylineId === input.toStorylineId) throw validation('故事线不能关联自身');
    const existing = this.one(`SELECT storyline_relation_id FROM storyline_relations WHERE owner_id=? AND book_id=?
      AND from_storyline_id=? AND to_storyline_id=? AND relation_type=?`, scope.ownerId, scope.bookId,
      input.fromStorylineId, input.toStorylineId, input.relationType);
    const id = existing === undefined ? this.ids.next() : text(existing.storyline_relation_id); const now = this.now();
    this.persistence.statement(`INSERT INTO storyline_relations (storyline_relation_id,owner_id,book_id,from_storyline_id,to_storyline_id,
      relation_type,content_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'active',?,?)
      ON CONFLICT(owner_id,book_id,from_storyline_id,to_storyline_id,relation_type) DO UPDATE SET
      content_json=excluded.content_json,status='active',updated_at=excluded.updated_at`).run(id, scope.ownerId, scope.bookId,
        input.fromStorylineId, input.toStorylineId, input.relationType, stableJson({ description: input.description.trim() }), now, now);
    return id;
  }

  public upsertVolumeParticipation(scope: BookScope, input: { storylineId: string; volumePlanId: string;
    participationStatus: StorylineVolumeParticipationStatus; responsibility?: string | null }): string {
    const storyline = this.requireStoryline(scope, input.storylineId);
    if (storyline.activeVersionId === null) throw conflict('故事线尚未确认，不能加入分卷');
    this.requireScoped(scope, 'volume_plans', 'volume_plan_id', input.volumePlanId, '分卷');
    const existing = this.one(`SELECT storyline_volume_participation_id FROM storyline_volume_participations
      WHERE owner_id=? AND book_id=? AND storyline_id=? AND volume_plan_id=?`, scope.ownerId, scope.bookId,
      input.storylineId, input.volumePlanId);
    const id = existing === undefined ? this.ids.next() : text(existing.storyline_volume_participation_id); const now = this.now();
    this.persistence.statement(`INSERT INTO storyline_volume_participations (storyline_volume_participation_id,owner_id,book_id,
      storyline_id,volume_plan_id,participation_status,responsibility,source_storyline_version_id,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'active',?,?) ON CONFLICT(owner_id,book_id,storyline_id,volume_plan_id) DO UPDATE SET
      participation_status=excluded.participation_status,responsibility=excluded.responsibility,
      source_storyline_version_id=excluded.source_storyline_version_id,status='active',updated_at=excluded.updated_at`).run(id,
        scope.ownerId, scope.bookId, input.storylineId, input.volumePlanId, input.participationStatus,
        input.responsibility?.trim() || null, storyline.activeVersionId, now, now);
    return id;
  }

  public createCharacter(scope: BookScope, input: { characterKind: CharacterCardView['characterKind']; content: CharacterCardContent;
    promotedFromCharacterId?: string | null }): { characterId: string; versionId: string } {
    this.requireBook(scope);
    if (input.content.name.trim().length === 0) throw validation('角色姓名不能为空');
    if (input.promotedFromCharacterId !== undefined && input.promotedFromCharacterId !== null) {
      this.requireScoped(scope, 'character_cards', 'character_id', input.promotedFromCharacterId, '来源角色');
    }
    for (const influence of input.content.storylineInfluences) this.requireStoryline(scope, influence.storylineId);
    const characterId = this.ids.next(); const versionId = this.ids.next(); const now = this.now();
    this.tx(() => {
      this.persistence.statement(`INSERT INTO character_cards (character_id,owner_id,book_id,character_kind,lifecycle_status,
        active_version_id,promoted_from_character_id,created_at,updated_at) VALUES (?,?,?,?,'active',?,?,?,?)`).run(characterId,
          scope.ownerId, scope.bookId, input.characterKind, versionId, input.promotedFromCharacterId ?? null, now, now);
      this.persistence.statement(`INSERT INTO character_card_versions (character_card_version_id,owner_id,book_id,character_id,
        version,status,base_version,content_json,content_hash,created_at,confirmed_at) VALUES (?,?,?,?,1,'active',0,?,?,?,?)`).run(
          versionId, scope.ownerId, scope.bookId, characterId, stableJson(input.content), hash(input.content), now, now);
      for (const influence of input.content.storylineInfluences) {
        this.persistence.statement(`INSERT INTO character_storyline_links (character_storyline_link_id,owner_id,book_id,character_id,
          storyline_id,influence,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',?,?)`).run(this.ids.next(),
            scope.ownerId, scope.bookId, characterId, influence.storylineId, influence.influence, now, now);
      }
    });
    return { characterId, versionId };
  }

  public updateCharacter(scope: BookScope, characterId: string, input: { content: CharacterCardContent;
    expectedActiveVersionId: string; sourceOpeningVersion?: number | null }): { versionId: string; version: number } {
    this.requireBook(scope); requireNonEmpty(input.content.name, '角色姓名');
    const character = this.one(`SELECT active_version_id FROM character_cards WHERE owner_id=? AND book_id=? AND character_id=?`,
      scope.ownerId, scope.bookId, characterId);
    if (character === undefined) throw notFound('人物卡不存在或不属于当前书籍');
    if (nullableText(character.active_version_id) !== input.expectedActiveVersionId) throw conflict('人物卡基线已经变化，请刷新后重试');
    for (const influence of input.content.storylineInfluences) this.requireStoryline(scope, influence.storylineId);
    const version = number(this.one(`SELECT COALESCE(MAX(version),0)+1 AS value FROM character_card_versions
      WHERE owner_id=? AND book_id=? AND character_id=?`, scope.ownerId, scope.bookId, characterId)?.value);
    const versionId = this.ids.next(); const now = this.now();
    const content = { ...input.content, sourceOpeningVersion: input.sourceOpeningVersion ?? input.content.sourceOpeningVersion ?? null };
    this.tx(() => {
      this.persistence.statement(`UPDATE character_card_versions SET status='superseded' WHERE owner_id=? AND book_id=?
        AND character_id=? AND status='active'`).run(scope.ownerId, scope.bookId, characterId);
      this.persistence.statement(`INSERT INTO character_card_versions (character_card_version_id,owner_id,book_id,character_id,
        version,status,base_version,parent_version_id,content_json,content_hash,created_at,confirmed_at)
        VALUES (?,?,?,?,?,'active',?,?,?,?,?,?)`).run(versionId, scope.ownerId, scope.bookId, characterId, version,
          version - 1, input.expectedActiveVersionId, stableJson(content), hash(content), now, now);
      this.persistence.statement(`UPDATE character_cards SET active_version_id=?,updated_at=? WHERE owner_id=? AND book_id=?
        AND character_id=? AND active_version_id=?`).run(versionId, now, scope.ownerId, scope.bookId, characterId, input.expectedActiveVersionId);
      this.persistence.statement(`UPDATE character_storyline_links SET status='archived',updated_at=? WHERE owner_id=? AND book_id=?
        AND character_id=? AND status='active'`).run(now, scope.ownerId, scope.bookId, characterId);
      for (const influence of content.storylineInfluences) this.persistence.statement(`INSERT INTO character_storyline_links
        (character_storyline_link_id,owner_id,book_id,character_id,storyline_id,influence,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'active',?,?) ON CONFLICT(owner_id,book_id,character_id,storyline_id) DO UPDATE SET
        influence=excluded.influence,status='active',updated_at=excluded.updated_at`).run(this.ids.next(), scope.ownerId, scope.bookId,
          characterId, influence.storylineId, influence.influence, now, now);
      this.insertInvalidation(scope, 'character', characterId, versionId, 'character_consumers', characterId, now);
    });
    return { versionId, version };
  }
  public upsertEventRole(scope: BookScope, input: { eventChainVersionId: string; eventNodeId: string; roleFunctionKey: string;
    roleFunctionLabel: string; requirement: JsonObject; assignedCharacterId?: string | null }): string {
    if (input.roleFunctionKey.trim().length === 0 || input.roleFunctionLabel.trim().length === 0) throw validation('角色功能标识和名称不能为空');
    const chain = this.one(`SELECT content_json FROM event_chain_versions WHERE owner_id=? AND book_id=? AND event_chain_version_id=?`,
      scope.ownerId, scope.bookId, input.eventChainVersionId);
    if (chain === undefined) throw notFound('事件链版本不属于当前书籍');
    const chainContent = parseEventChainContent(JSON.parse(text(chain.content_json)) as unknown);
    if (!chainContent.events.some((event) => event.nodeId === input.eventNodeId)) throw validation('角色功能引用了不存在的事件节点');
    let sourceCharacterVersionId: string | null = null;
    if (input.assignedCharacterId !== undefined && input.assignedCharacterId !== null) {
      const character = this.one(`SELECT active_version_id FROM character_cards WHERE owner_id=? AND book_id=? AND character_id=?`,
        scope.ownerId, scope.bookId, input.assignedCharacterId);
      if (character === undefined) throw notFound('角色不属于当前书籍');
      sourceCharacterVersionId = nullableText(character.active_version_id);
    }
    const existing = this.one(`SELECT event_role_assignment_id FROM event_role_assignments WHERE owner_id=? AND book_id=?
      AND event_chain_version_id=? AND event_node_id=? AND role_function_key=?`, scope.ownerId, scope.bookId,
      input.eventChainVersionId, input.eventNodeId, input.roleFunctionKey);
    const id = existing === undefined ? this.ids.next() : text(existing.event_role_assignment_id); const now = this.now();
    this.persistence.statement(`INSERT INTO event_role_assignments (event_role_assignment_id,owner_id,book_id,event_chain_version_id,
      event_node_id,role_function_key,role_function_label,requirement_json,assigned_character_id,assignment_status,
      source_character_version_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(owner_id,book_id,event_chain_version_id,event_node_id,role_function_key) DO UPDATE SET
      role_function_label=excluded.role_function_label,requirement_json=excluded.requirement_json,
      assigned_character_id=excluded.assigned_character_id,assignment_status=excluded.assignment_status,
      source_character_version_id=excluded.source_character_version_id,updated_at=excluded.updated_at`).run(id, scope.ownerId,
        scope.bookId, input.eventChainVersionId, input.eventNodeId, input.roleFunctionKey, input.roleFunctionLabel,
        stableJson(input.requirement), input.assignedCharacterId ?? null,
        input.assignedCharacterId === undefined || input.assignedCharacterId === null ? 'placeholder' : 'assigned',
        sourceCharacterVersionId, now, now);
    return id;
  }

  public saveDraft(scope: BookScope, input: { objectType: AuthorObjectDraftView['objectType']; objectId: string;
    baseVersion: number; expectedDraftRevision: number; draft: JsonObject; authorInputVersion?: number }): AuthorObjectDraftView {
    this.requireBook(scope);
    const current = this.one(`SELECT author_object_draft_id,draft_revision FROM author_object_drafts WHERE owner_id=? AND book_id=?
      AND object_type=? AND object_id=? AND status='active'`, scope.ownerId, scope.bookId, input.objectType, input.objectId);
    const now = this.now();
    if (current === undefined) {
      if (input.expectedDraftRevision !== 0) throw conflict('草稿基线不存在，请刷新后重试');
      this.persistence.statement(`INSERT INTO author_object_drafts (author_object_draft_id,owner_id,book_id,object_type,object_id,
        base_version,draft_revision,draft_json,author_input_version,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,1,?,?,'active',?,?)`).run(this.ids.next(), scope.ownerId, scope.bookId, input.objectType,
          input.objectId, input.baseVersion, stableJson(input.draft), input.authorInputVersion ?? 0, now, now);
    } else {
      if (number(current.draft_revision) !== input.expectedDraftRevision) throw conflict('草稿已被其他编辑更新，请合并后再保存');
      const changed = this.persistence.statement(`UPDATE author_object_drafts SET base_version=?,draft_revision=draft_revision+1,
        draft_json=?,author_input_version=?,updated_at=? WHERE owner_id=? AND book_id=? AND author_object_draft_id=?
        AND draft_revision=? AND status='active'`).run(input.baseVersion, stableJson(input.draft), input.authorInputVersion ?? 0,
          now, scope.ownerId, scope.bookId, text(current.author_object_draft_id), input.expectedDraftRevision).changes;
      if (changed !== 1) throw conflict('草稿修订冲突，请刷新后重试');
    }
    const saved = this.drafts(scope).find((draft) => draft.objectType === input.objectType && draft.objectId === input.objectId);
    if (saved === undefined) throw new Error('草稿保存后不可见');
    return saved;
  }

  public reopenStoryline(scope: BookScope, storylineId: string, expectedActiveVersionId: string): { draft: AuthorObjectDraftView; impactPreview: JsonObject } {
    const storyline = this.requireStoryline(scope, storylineId);
    if (storyline.activeVersionId !== expectedActiveVersionId) throw conflict('故事线版本已经变化，请刷新后重试');
    const version = this.one(`SELECT version,content_json FROM storyline_versions WHERE owner_id=? AND book_id=? AND storyline_id=?
      AND storyline_version_id=? AND status='active'`, scope.ownerId, scope.bookId, storylineId, expectedActiveVersionId);
    if (version === undefined) throw conflict('只有当前已确认故事线可以重开');
    const impactPreview = {
      participations: this.rows(`SELECT volume_plan_id,participation_status FROM storyline_volume_participations WHERE owner_id=?
        AND book_id=? AND storyline_id=? AND status='active'`, scope.ownerId, scope.bookId, storylineId),
      relations: this.rows(`SELECT storyline_relation_id,from_storyline_id,to_storyline_id FROM storyline_relations WHERE owner_id=?
        AND book_id=? AND (from_storyline_id=? OR to_storyline_id=?) AND status='active'`, scope.ownerId, scope.bookId,
        storylineId, storylineId),
      effect: '确认新版本后，这些下游对象将标记为需复核，不会被自动覆盖。'
    };
    const draft = this.saveDraft(scope, { objectType: 'storyline', objectId: storylineId, baseVersion: number(version.version),
      expectedDraftRevision: 0, draft: parseObject(text(version.content_json)) });
    this.persistence.statement(`INSERT INTO object_reopen_records (reopen_id,owner_id,book_id,object_type,object_id,from_version_id,
      new_draft_id,impact_preview_json,created_at) VALUES (?,?,?,'storyline',?,?,?,?,?)`).run(this.ids.next(), scope.ownerId,
        scope.bookId, storylineId, expectedActiveVersionId, draft.authorObjectDraftId, stableJson(impactPreview), this.now());
    return { draft, impactPreview };
  }

  public projectSettlementToStorylines(scope: BookScope, input: {
    stageKind: 'event' | 'volume';
    stageObjectId: string;
    settlementId: string;
    actual: unknown;
  }): string[] {
    this.requireBook(scope);
    const sourceKind = input.stageKind === 'event' ? 'event_settlement' : 'volume_settlement';
    this.requireActualAuthority(scope, sourceKind, input.settlementId);
    const volumePlanId = input.stageKind === 'volume'
      ? input.stageObjectId
      : nullableText(this.one(`SELECT volume_plan_id FROM story_events WHERE owner_id=? AND book_id=? AND event_id=?`,
        scope.ownerId, scope.bookId, input.stageObjectId)?.volume_plan_id);
    if (volumePlanId === null) return [];
    const participations = this.rows(`SELECT p.storyline_id FROM storyline_volume_participations p
      JOIN storylines s ON s.owner_id=p.owner_id AND s.book_id=p.book_id AND s.storyline_id=p.storyline_id
      WHERE p.owner_id=? AND p.book_id=? AND p.volume_plan_id=? AND p.status='active'
        AND p.participation_status IN ('leading','important','foreshadow') AND s.lifecycle_status<>'abandoned'
        AND s.active_version_id IS NOT NULL ORDER BY p.storyline_id`, scope.ownerId, scope.bookId, volumePlanId);
    const actual = settlementActualRecord(input.actual);
    const actualProgress = settlementActualSummary(actual);
    return this.tx(() => {
      const ids: string[] = [];
      for (const row of participations) {
        const storylineId = text(row.storyline_id);
        const receipt = this.one(`SELECT ledger_entry_id FROM storyline_settlement_projection_receipts_v6
          WHERE owner_id=? AND book_id=? AND storyline_id=? AND source_kind=? AND source_version_id=?`,
          scope.ownerId, scope.bookId, storylineId, sourceKind, input.settlementId);
        if (receipt !== undefined) { ids.push(text(receipt.ledger_entry_id)); continue; }
        const historical = this.one(`SELECT ledger_entry_id FROM creative_ledger_entries WHERE owner_id=? AND book_id=?
          AND ledger_type='storyline' AND truth_status='actual' AND subject_key=? AND source_kind=? AND source_version_id=?
          ORDER BY created_at,ledger_entry_id LIMIT 1`, scope.ownerId, scope.bookId, storylineId, sourceKind, input.settlementId);
        const ledgerEntryId = historical === undefined ? this.ids.next() : text(historical.ledger_entry_id);
        if (historical === undefined) {
          this.persistence.statement(`INSERT INTO creative_ledger_entries (ledger_entry_id,owner_id,book_id,ledger_type,
            truth_status,scope_type,scope_id,subject_key,entry_status,content_json,source_kind,source_version_id,
            source_locator_json,supersedes_entry_id,created_at) VALUES (?,?,?,'storyline','actual',?,?,?,?,?,?,?,?,NULL,?)`)
            .run(ledgerEntryId, scope.ownerId, scope.bookId, input.stageKind, input.stageObjectId, storylineId, 'advanced',
              stableJson({ actualProgress, actual }), sourceKind, input.settlementId,
              stableJson({ stageKind: input.stageKind, stageObjectId: input.stageObjectId }), this.now());
        }
        this.persistence.statement(`INSERT INTO storyline_settlement_projection_receipts_v6
          (projection_receipt_id,owner_id,book_id,storyline_id,source_kind,source_version_id,ledger_entry_id,created_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(this.ids.next(), scope.ownerId, scope.bookId, storylineId, sourceKind,
            input.settlementId, ledgerEntryId, this.now());
        ids.push(ledgerEntryId);
      }
      return ids;
    });
  }

  public writeLedger(scope: BookScope, input: CoreLedgerInput): string {
    this.requireBook(scope);
    if (input.subjectKey.trim().length === 0) throw validation('账本主题不能为空');
    if (input.truthStatus === 'actual') this.requireActualAuthority(scope, input.sourceKind, input.sourceVersionId);
    const id = this.ids.next();
    this.persistence.statement(`INSERT INTO creative_ledger_entries (ledger_entry_id,owner_id,book_id,ledger_type,truth_status,
      scope_type,scope_id,subject_key,entry_status,content_json,source_kind,source_version_id,source_locator_json,
      supersedes_entry_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, scope.ownerId, scope.bookId,
        input.ledgerType, input.truthStatus, input.scopeType, input.scopeId, input.subjectKey.trim(), input.entryStatus,
        stableJson(input.content), input.sourceKind, input.sourceVersionId,
        input.sourceLocator === undefined || input.sourceLocator === null ? null : stableJson(input.sourceLocator),
        input.supersedesEntryId ?? null, this.now());
    return id;
  }

  public resolveInvalidation(scope: BookScope, invalidationId: string, resolution: 'resolved' | 'not_affected'): void {
    const changed = this.persistence.statement(`UPDATE workflow_invalidations_v6 SET resolution=?,resolved_at=? WHERE owner_id=?
      AND book_id=? AND invalidation_id=? AND resolution IN ('stale','recompile_required','review_required')`).run(resolution,
        this.now(), scope.ownerId, scope.bookId, invalidationId).changes;
    if (changed !== 1) throw conflict('影响记录不存在或已经处理');
  }

  public setWorkflowStage(scope: BookScope, input: { stage: CoreWorkflowStage; activeObjectId?: string | null;
    expectedStateVersion: number; blockingReason?: string | null }): number {
    this.requireBook(scope); const current = this.one(`SELECT active_stage,state_version FROM core_workflow_states_v6 WHERE owner_id=? AND book_id=?`,
      scope.ownerId, scope.bookId); const now = this.now();
    const currentStage = current === undefined ? 'setting' : text(current.active_stage) as CoreWorkflowStage;
    const currentIndex = coreWorkflowStages.indexOf(currentStage);
    const nextIndex = coreWorkflowStages.indexOf(input.stage);
    if (nextIndex > currentIndex + 1) throw validation('必须先完成并确认上一步，不能跨级开放后续阶段');
    if (current === undefined) {
      if (input.expectedStateVersion !== 0) throw conflict('工作台状态基线已经变化');
      this.persistence.statement(`INSERT INTO core_workflow_states_v6 (owner_id,book_id,active_stage,active_object_id,state_version,
        blocking_reason,updated_at) VALUES (?,?,?,?,1,?,?)`).run(scope.ownerId, scope.bookId, input.stage,
          input.activeObjectId ?? null, input.blockingReason ?? null, now);
      return 1;
    }
    if (number(current.state_version) !== input.expectedStateVersion) throw conflict('工作台状态基线已经变化');
    const next = input.expectedStateVersion + 1;
    const changed = this.persistence.statement(`UPDATE core_workflow_states_v6 SET active_stage=?,active_object_id=?,state_version=?,
      blocking_reason=?,updated_at=? WHERE owner_id=? AND book_id=? AND state_version=?`).run(input.stage,
        input.activeObjectId ?? null, next, input.blockingReason ?? null, now, scope.ownerId, scope.bookId,
        input.expectedStateVersion).changes;
    if (changed !== 1) throw conflict('工作台状态更新冲突');
    return next;
  }
  private ensureOpeningProtagonistCards(scope: BookScope): void {
    const opening = this.one(`SELECT version,blueprint_json FROM book_opening_blueprints
      WHERE owner_id=? AND book_id=? AND status='active' ORDER BY version DESC LIMIT 1`, scope.ownerId, scope.bookId);
    if (opening === undefined) return;
    const blueprint = parseObject(text(opening.blueprint_json));
    const protagonists = Array.isArray(blueprint.protagonists) ? blueprint.protagonists : [];
    if (protagonists.length === 0) return;
    const existingNames = new Set(this.rows(`SELECT v.content_json FROM character_cards c JOIN character_card_versions v
      ON v.owner_id=c.owner_id AND v.book_id=c.book_id AND v.character_card_version_id=c.active_version_id
      WHERE c.owner_id=? AND c.book_id=? AND c.lifecycle_status<>'archived'`, scope.ownerId, scope.bookId)
      .map((row) => String(parseObject(text(row.content_json)).name ?? '').trim()).filter(Boolean));
    const storyDirection = String(blueprint.storyDirection ?? blueprint.storyEnding ?? blueprint.openingStart ?? '').trim();
    const openingState = String(blueprint.openingStart ?? blueprint.openingBackground ?? '').trim();
    const boundaries = Array.isArray(blueprint.mustFollow)
      ? blueprint.mustFollow.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    for (const candidate of protagonists) {
      if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const protagonist = candidate as Record<string, unknown>;
      const name = String(protagonist.name ?? '').trim();
      if (!name || existingNames.has(name)) continue;
      const role = String(protagonist.role ?? '主角').trim();
      const age = String(protagonist.age ?? '').trim();
      const background = String(protagonist.background ?? protagonist.familyBackground ?? '').trim();
      const personalityTraits = Array.isArray(protagonist.personalities)
        ? protagonist.personalities.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
      this.createCharacter(scope, { characterKind: 'protagonist', content: {
        name,
        roleSummary: [role, age, background].filter(Boolean).join(' · ') || '主角',
        desire: storyDirection || '跟随正文逐步确认核心目标',
        currentState: openingState || background || '开局处境待作者随正文确认',
        personalityTraits,
        sourceOpeningVersion: number(opening.version),
        boundaries,
        storylineInfluences: []
      } });
      existingNames.add(name);
    }
  }
  private storylineVersions(scope: BookScope, storylineId: string): StorylineVersionView[] {
    return this.rows(`SELECT storyline_version_id,version,status,base_version,parent_version_id,source_version_ids_json,
      author_input_refs_json,content_json,content_hash,created_at,confirmed_at FROM storyline_versions
      WHERE owner_id=? AND book_id=? AND storyline_id=? ORDER BY version DESC`, scope.ownerId, scope.bookId, storylineId)
      .map((row) => ({
        storylineVersionId: text(row.storyline_version_id), version: number(row.version),
        status: text(row.status) as StorylineVersionView['status'], baseVersion: number(row.base_version),
        parentVersionId: nullableText(row.parent_version_id), sourceVersionIds: parseArray(text(row.source_version_ids_json)),
        authorInputRefs: parseArray(text(row.author_input_refs_json)),
        content: parseObject(text(row.content_json)) as unknown as StorylineContent, contentHash: text(row.content_hash),
        createdAt: text(row.created_at), confirmedAt: nullableText(row.confirmed_at)
      }));
  }

  private insertStorylineVersion(scope: BookScope, storylineId: string, versionId: string, version: number, baseVersion: number,
    input: SaveCoreVersionInput<StorylineContent>, now: string): void {
    this.persistence.statement(`INSERT INTO storyline_versions (storyline_version_id,owner_id,book_id,storyline_id,version,status,
      base_version,parent_version_id,source_task_id,source_version_ids_json,author_input_refs_json,content_json,content_hash,created_at)
      VALUES (?,?,?,?,?,'candidate',?,?,?,?,?,?,?,?)`).run(versionId, scope.ownerId, scope.bookId, storylineId, version,
        baseVersion, input.parentVersionId ?? null, input.sourceTaskId ?? null, stableJson(input.sourceVersionIds ?? []),
        stableJson(input.authorInputRefs ?? []), stableJson(input.content), hash(input.content), now);
  }

  private ledgerEntries(scope: BookScope): CreativeLedgerEntryView[] {
    return this.rows(`SELECT ledger_entry_id,ledger_type,truth_status,scope_type,scope_id,subject_key,entry_status,content_json,
      source_kind,source_version_id,source_locator_json,created_at FROM creative_ledger_entries WHERE owner_id=? AND book_id=?
      ORDER BY created_at,ledger_entry_id`, scope.ownerId, scope.bookId).map((row) => ({
        ledgerEntryId: text(row.ledger_entry_id), ledgerType: text(row.ledger_type) as CreativeLedgerType,
        truthStatus: text(row.truth_status) as 'planned' | 'actual', scopeType: text(row.scope_type) as CreativeLedgerEntryView['scopeType'],
        scopeId: text(row.scope_id), subjectKey: text(row.subject_key), entryStatus: text(row.entry_status) as CreativeLedgerEntryView['entryStatus'],
        content: parseObject(text(row.content_json)), sourceKind: text(row.source_kind) as CreativeLedgerEntryView['sourceKind'],
        sourceVersionId: text(row.source_version_id), sourceLocator: row.source_locator_json === null ? null : parseObject(text(row.source_locator_json)),
        createdAt: text(row.created_at)
      }));
  }

  private drafts(scope: BookScope): AuthorObjectDraftView[] {
    return this.rows(`SELECT author_object_draft_id,object_type,object_id,base_version,draft_revision,draft_json,
      author_input_version,status,updated_at FROM author_object_drafts WHERE owner_id=? AND book_id=? ORDER BY updated_at DESC`,
      scope.ownerId, scope.bookId).map((row) => ({
        authorObjectDraftId: text(row.author_object_draft_id), objectType: text(row.object_type) as AuthorObjectDraftView['objectType'],
        objectId: text(row.object_id), baseVersion: number(row.base_version), draftRevision: number(row.draft_revision),
        draft: parseObject(text(row.draft_json)), authorInputVersion: number(row.author_input_version),
        status: text(row.status) as AuthorObjectDraftView['status'], updatedAt: text(row.updated_at)
      }));
  }

  private invalidations(scope: BookScope): WorkflowInvalidationView[] {
    return this.rows(`SELECT invalidation_id,upstream_object_type,upstream_object_id,upstream_version_id,downstream_object_type,
      downstream_object_id,resolution,impact_json,created_at,resolved_at FROM workflow_invalidations_v6 WHERE owner_id=? AND book_id=?
      ORDER BY created_at DESC,invalidation_id`, scope.ownerId, scope.bookId).map((row) => ({
        invalidationId: text(row.invalidation_id), upstreamObjectType: text(row.upstream_object_type),
        upstreamObjectId: text(row.upstream_object_id), upstreamVersionId: text(row.upstream_version_id),
        downstreamObjectType: text(row.downstream_object_type), downstreamObjectId: text(row.downstream_object_id),
        resolution: text(row.resolution) as WorkflowInvalidationView['resolution'], impact: parseObject(text(row.impact_json)),
        createdAt: text(row.created_at), resolvedAt: nullableText(row.resolved_at)
      }));
  }

  private storylineGrowth(scope: BookScope): CoreWorkflowV6View['growth'] {
    const frontiers = this.rows(`SELECT frontier_version_id,storyline_id,version,summary,target_volume_number,stage_ending,
      full_book_ending_known,source_kind,source_version_ids_json,content_hash,created_at,confirmed_at
      FROM storyline_frontier_versions WHERE owner_id=? AND book_id=? AND status='active'
      ORDER BY created_at DESC,frontier_version_id`, scope.ownerId, scope.bookId).map((row): StorylineFrontierView => ({
        frontierVersionId: text(row.frontier_version_id), storylineId: nullableText(row.storyline_id), version: number(row.version),
        summary: text(row.summary), targetVolumeNumber: row.target_volume_number === null ? null : number(row.target_volume_number),
        stageEnding: nullableText(row.stage_ending), fullBookEndingKnown: number(row.full_book_ending_known) === 1,
        sourceKind: text(row.source_kind) as StorylineFrontierView['sourceKind'],
        sourceVersionIds: parseArray(text(row.source_version_ids_json)), contentHash: text(row.content_hash),
        createdAt: text(row.created_at), confirmedAt: nullableText(row.confirmed_at)
      }));
    const openQuestions = this.rows(`SELECT open_question_id,storyline_id,question,source_kind,source_version_id,status,
      resolution,created_at,updated_at,resolved_at FROM storyline_open_questions_v6 WHERE owner_id=? AND book_id=?
      AND status<>'archived' ORDER BY updated_at DESC,open_question_id`, scope.ownerId, scope.bookId)
      .map((row): StorylineOpenQuestionView => ({ openQuestionId: text(row.open_question_id),
        storylineId: nullableText(row.storyline_id), question: text(row.question),
        sourceKind: text(row.source_kind) as StorylineOpenQuestionView['sourceKind'], sourceVersionId: nullableText(row.source_version_id),
        status: text(row.status) as StorylineOpenQuestionView['status'], resolution: nullableText(row.resolution),
        createdAt: text(row.created_at), updatedAt: text(row.updated_at), resolvedAt: nullableText(row.resolved_at) }));
    const candidates = this.rows(`SELECT candidate_id,growth_round_id,candidate_kind,storyline_id,status,title,content_json,
      evidence_refs_json,evidence_hash,source_batch_id,source_batch_member_id,based_on_version_ids_json,stale_reason,
      created_at,decided_at FROM storyline_growth_candidates_v6 WHERE owner_id=? AND book_id=?
      ORDER BY created_at DESC,candidate_id`, scope.ownerId, scope.bookId).map((row): StorylineGrowthCandidateView => ({
        candidateId: text(row.candidate_id), growthRoundId: text(row.growth_round_id),
        candidateKind: text(row.candidate_kind) as StorylineGrowthCandidateView['candidateKind'],
        storylineId: nullableText(row.storyline_id), status: text(row.status) as StorylineGrowthCandidateView['status'],
        title: text(row.title), content: parseObject(text(row.content_json)) as unknown as StorylineGrowthCandidateContent,
        evidenceRefs: parseEvidenceRefs(text(row.evidence_refs_json)), evidenceHash: text(row.evidence_hash),
        sourceBatchId: nullableText(row.source_batch_id), sourceBatchMemberId: nullableText(row.source_batch_member_id),
        basedOnVersionIds: parseArray(text(row.based_on_version_ids_json)), staleReason: nullableText(row.stale_reason),
        createdAt: text(row.created_at), decidedAt: nullableText(row.decided_at)
      }));
    const decisions = this.rows(`SELECT decision_id,candidate_id,decision,edited_content_json,created_storyline_id,
      created_frontier_version_id,created_at FROM storyline_growth_decisions_v6 WHERE owner_id=? AND book_id=?
      ORDER BY created_at DESC,decision_id`, scope.ownerId, scope.bookId).map((row) => ({
        decisionId: text(row.decision_id), candidateId: text(row.candidate_id),
        decision: text(row.decision) as 'accepted' | 'rejected' | 'observing',
        editedContent: row.edited_content_json === null ? null : parseObject(text(row.edited_content_json)) as unknown as StorylineGrowthCandidateContent,
        createdStorylineId: nullableText(row.created_storyline_id), createdFrontierVersionId: nullableText(row.created_frontier_version_id),
        createdAt: text(row.created_at)
      }));
    return { frontiers, openQuestions, candidates, decisions };
  }
  private requireActualAuthority(scope: BookScope, sourceKind: CreativeLedgerEntryView['sourceKind'], sourceVersionId: string): void {
    if (sourceKind === 'manuscript') {
      const row = this.one(`SELECT 1 AS ok FROM manuscript_versions m JOIN chapters c ON c.owner_id=m.owner_id AND c.book_id=m.book_id
        AND c.chapter_id=m.chapter_id WHERE m.owner_id=? AND m.book_id=? AND m.manuscript_version_id=? AND m.status='canon'
        AND c.settlement_status='settled' AND c.canon_manuscript_version_id=m.manuscript_version_id`, scope.ownerId, scope.bookId,
        sourceVersionId);
      if (row === undefined) throw validation('实际账本只能引用当前书籍已结算的正史正文');
      return;
    }
    const stageType = sourceKind === 'chapter_settlement' ? 'chapter' : sourceKind === 'event_settlement' ? 'story_arc'
      : sourceKind === 'volume_settlement' ? 'volume' : null;
    if (stageType === null) throw validation('计划或模型产物不能写入实际账本');
    const row = this.one(`SELECT 1 AS ok FROM stage_settlements WHERE owner_id=? AND book_id=? AND stage_settlement_id=?
      AND stage_type=? AND status='active'`, scope.ownerId, scope.bookId, sourceVersionId, stageType);
    if (row === undefined) throw validation('实际账本来源不是当前书籍的有效结算');
  }

  private invalidateStorylineConsumers(scope: BookScope, storylineId: string, versionId: string, now: string): void {
    for (const row of this.rows(`SELECT volume_plan_id FROM storyline_volume_participations WHERE owner_id=? AND book_id=?
      AND storyline_id=? AND status='active'`, scope.ownerId, scope.bookId, storylineId)) {
      const volumePlanId = text(row.volume_plan_id);
      this.persistence.statement(`UPDATE storyline_volume_participations SET status='stale',updated_at=? WHERE owner_id=? AND book_id=?
        AND storyline_id=? AND volume_plan_id=? AND status='active'`).run(now, scope.ownerId, scope.bookId, storylineId, volumePlanId);
      this.insertInvalidation(scope, 'storyline', storylineId, versionId, 'volume_plan', volumePlanId, now);
    }
  }

  private insertInvalidation(scope: BookScope, upstreamType: string, upstreamId: string, upstreamVersionId: string,
    downstreamType: string, downstreamId: string, now: string): void {
    this.persistence.statement(`INSERT INTO workflow_invalidations_v6 (invalidation_id,owner_id,book_id,upstream_object_type,
      upstream_object_id,upstream_version_id,downstream_object_type,downstream_object_id,resolution,impact_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,'review_required',?,?)`).run(this.ids.next(), scope.ownerId, scope.bookId, upstreamType,
        upstreamId, upstreamVersionId, downstreamType, downstreamId,
        stableJson({ message: '上游确认版本已变化；下游保留原版本并等待作者复核。' }), now);
  }

  private requireBook(scope: BookScope): void {
    assertBookScope(scope);
    if (this.one(`SELECT 1 AS ok FROM books WHERE owner_id=? AND book_id=?`, scope.ownerId, scope.bookId) === undefined) {
      throw notFound('书籍不存在或不属于当前账号');
    }
  }

  private requireStoryline(scope: BookScope, storylineId: string): { activeVersionId: string | null } {
    this.requireBook(scope);
    const row = this.one(`SELECT active_version_id FROM storylines WHERE owner_id=? AND book_id=? AND storyline_id=?`,
      scope.ownerId, scope.bookId, storylineId);
    if (row === undefined) throw notFound('故事线不存在或不属于当前书籍');
    return { activeVersionId: nullableText(row.active_version_id) };
  }

  private requireScoped(scope: BookScope, table: string, column: string, id: string, label: string): void {
    this.requireBook(scope);
    const allowed = new Set(['volume_plans:volume_plan_id','character_cards:character_id','event_chain_versions:event_chain_version_id']);
    if (!allowed.has(`${table}:${column}`)) throw new Error('非法作用域查询');
    if (this.one(`SELECT 1 AS ok FROM ${table} WHERE owner_id=? AND book_id=? AND ${column}=?`, scope.ownerId, scope.bookId, id) === undefined) {
      throw notFound(`${label}不存在或不属于当前书籍`);
    }
  }

  private next(scope: BookScope, table: 'storylines', column: 'sort_order'): number {
    return number(this.one(`SELECT COALESCE(MAX(${column}),0)+1 AS value FROM ${table} WHERE owner_id=? AND book_id=?`,
      scope.ownerId, scope.bookId)?.value);
  }
  private nextStorylineVersion(scope: BookScope, storylineId: string): number {
    return number(this.one(`SELECT COALESCE(MAX(version),0)+1 AS value FROM storyline_versions WHERE owner_id=? AND book_id=?
      AND storyline_id=?`, scope.ownerId, scope.bookId, storylineId)?.value);
  }
  private one(sql: string, ...params: SqlValue[]): Stored | undefined { return this.persistence.statement(sql).get(...params) as Stored | undefined; }
  private rows(sql: string, ...params: SqlValue[]): Stored[] { return this.persistence.statement(sql).all(...params) as unknown as Stored[]; }
  private now(): string { return this.clock.now().toISOString(); }
  private tx<T>(work: () => T): T { return this.persistence.transaction(work); }
}

function settlementActualRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : { summary: String(value ?? '') };
}
function settlementActualSummary(actual: Record<string, unknown>): string {
  for (const key of ['actualProgress','summary','result']) {
    const value = actual[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const irreversible = Array.isArray(actual.irreversibleResults)
    ? actual.irreversibleResults.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  if (irreversible.length > 0) return irreversible.join('；');
  const closed = Array.isArray(actual.closedThreads)
    ? actual.closedThreads.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  return closed.length > 0 ? closed.join('；') : '本阶段已完成结算，实际结果可追溯到结算版本。';
}

function validateStoryline(content: StorylineContent): void {
  if (content.title.trim().length === 0 || content.coreQuestion.trim().length === 0 || content.stageGoal.trim().length === 0) {
    throw validation('故事线名称、核心问题与阶段目标不能为空');
  }
}
function validateGrowthCandidate(content: StorylineGrowthCandidateContent): void {
  requireNonEmpty(content.summary, '候选摘要');
  requireNonEmpty(content.continuationReason, '自然延伸理由');
  requireNonEmpty(content.protagonistInvolvement, '主角继续卷入的原因');
  requireNonEmpty(content.coreQuestion, '下一段核心问题');
  requireNonEmpty(content.misreadRisk, '候选误判风险');
  if (!Array.isArray(content.pushesStorylineIds) || !Array.isArray(content.inferences) || !Array.isArray(content.unknowns)
    || [...content.pushesStorylineIds, ...content.inferences, ...content.unknowns].some((item) => typeof item !== 'string')) {
    throw validation('故事线候选的线路、推断和未知项格式无效');
  }
  if (!Number.isInteger(content.recommendedHorizonVolumes) || content.recommendedHorizonVolumes < 1
    || content.recommendedHorizonVolumes > 2) throw validation('主编推荐范围只能是下一卷至未来两卷');
}
function requireNonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw validation(`${label}不能为空`);
}
function nullableTrim(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length === 0 ? null : normalized;
}
function parseEvidenceRefs(value: string): StorylineGrowthCandidateView['evidenceRefs'] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.sourceKind !== 'string' || typeof row.sourceVersionId !== 'string') return [];
    return [{ sourceKind: row.sourceKind, sourceVersionId: row.sourceVersionId,
      ...(typeof row.locator === 'string' ? { locator: row.locator } : {}) }];
  });
}function validation(message: string): DomainError { return new DomainError(errorCodes.validation, message, {}, false, 400); }
function conflict(message: string): DomainError { return new DomainError(errorCodes.operationIncomplete, message, {}, true, 409); }
function notFound(message: string): DomainError { return new DomainError(errorCodes.bookScopeViolation, message, {}, false, 404); }
function stableJson(value: unknown): string { return JSON.stringify(sortValue(value)); }
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value as JsonObject)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, sortValue(nested)]));
  return value;
}
function hash(value: unknown): string { return hashStableContractContent(value).slice('sha256:'.length); }
function parseObject(value: string): JsonObject {
  const parsed = JSON.parse(value) as unknown;
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : {};
}
function parseArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}
function text(value: unknown): string { return typeof value === 'string' ? value : String(value ?? ''); }
function nullableText(value: unknown): string | null { return value === null || value === undefined ? null : text(value); }
function number(value: unknown): number { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
