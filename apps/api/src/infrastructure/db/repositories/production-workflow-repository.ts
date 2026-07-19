import type { DatabaseSync } from 'node:sqlite';
import type { BookScope } from '../../../domain/scope.js';
import { assertBookScope } from '../../../domain/scope.js';
import type { ReviewerRole } from '../../../contracts/production-review.js';
import type { TeamAgentRow } from './agent-governance-repository.js';

export interface WritingOrderRecord {
  writingOrderId: string;
  chapterId: string;
  taskId: string;
  sourceDecisionId: string;
  chapterOutlineVersionId: string;
  writingContractVersionId: string;
  objective: string;
  canonRevision: number;
  positioningVersion: number;
  contentHash: string;
}

export interface ReviewPanelRecord {
  reviewPanelId: string;
  manuscriptVersionId: string;
  reviewRound: number;
  writerModelSnapshotId: string;
  fact: TeamAgentRow;
  literary: TeamAgentRow;
  experience: TeamAgentRow;
  status: string;
}

export interface ApprovalGateRecord {
  gateId: string;
  chapterId: string;
  taskId: string;
  manuscriptVersionId: string;
  reviewPanelId: string;
  confirmationId: string;
  expectedCanonRevision: number;
  status: string;
}

export class ProductionWorkflowRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public currentTeam(scope: BookScope): TeamAgentRow[] {
    assertBookScope(scope);
    const rows = this.database.prepare(`
      SELECT a.agent_id, r.role_key, a.role_template_id, a.display_name, r.display_name AS short_title,
        m.provider, m.model_id, m.model_snapshot_id, a.activation_state
      FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.role_template_version = 2 AND a.enabled = 1
      ORDER BY a.created_at, a.agent_id
    `).all(scope.ownerId, scope.bookId) as unknown as Array<Record<string, string>>;
    return rows.map((row) => ({
      agentId: row.agent_id!, roleKey: row.role_key!, roleTemplateId: row.role_template_id!, memberName: row.display_name!,
      shortTitle: row.short_title!, provider: row.provider!, modelId: row.model_id!, modelSnapshotId: row.model_snapshot_id!,
      activationState: row.activation_state!
    }));
  }

  public createWritingOrder(scope: BookScope, input: {
    id: string; chapterId: string; taskId: string; sourceDecisionId: string; outlineVersionId: string; contractVersionId: string;
    objective: string; scopeData: unknown; hardConstraints: unknown; creativeFreedom: unknown; reviewThresholds: unknown;
    canonRevision: number; positioningVersion: number; contentHash: string; now: string;
  }): WritingOrderRecord {
    const version = (this.database.prepare(`SELECT COALESCE(MAX(version), 0) AS value FROM writing_orders WHERE owner_id = ? AND book_id = ? AND chapter_id = ?`)
      .get(scope.ownerId, scope.bookId, input.chapterId) as { value: number }).value + 1;
    this.database.prepare(`UPDATE writing_orders SET status = 'superseded' WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND status = 'active'`)
      .run(scope.ownerId, scope.bookId, input.chapterId);
    this.database.prepare(`INSERT INTO writing_orders (
      writing_order_id, owner_id, book_id, chapter_id, task_id, version, source_decision_id,
      chapter_outline_version_id, writing_contract_version_id, objective, scope_json, hard_constraints_json,
      creative_freedom_json, review_thresholds_json, canon_revision, positioning_version, content_hash, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
      .run(input.id, scope.ownerId, scope.bookId, input.chapterId, input.taskId, version, input.sourceDecisionId,
        input.outlineVersionId, input.contractVersionId, input.objective, JSON.stringify(input.scopeData), JSON.stringify(input.hardConstraints),
        JSON.stringify(input.creativeFreedom), JSON.stringify(input.reviewThresholds), input.canonRevision, input.positioningVersion,
        input.contentHash, input.now);
    return this.requireWritingOrder(scope, input.id);
  }

  public addWritingOrderSource(scope: BookScope, input: {
    id: string; writingOrderId: string; sourceClass: 'hard' | 'focused' | 'optional'; sourceType: string; sourceId: string;
    reason: string; contentHash: string; characterCount: number; ordinal: number; now: string;
  }): void {
    this.database.prepare(`INSERT INTO writing_order_sources (
      writing_order_source_id, owner_id, book_id, writing_order_id, source_class, source_type, source_id,
      reason, content_hash, character_count, ordinal, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.id, scope.ownerId, scope.bookId, input.writingOrderId, input.sourceClass, input.sourceType, input.sourceId,
        input.reason, input.contentHash, input.characterCount, input.ordinal, input.now);
  }

  public requireWritingOrder(scope: BookScope, id: string): WritingOrderRecord {
    const row = this.database.prepare(`SELECT writing_order_id, chapter_id, task_id, source_decision_id,
      chapter_outline_version_id, writing_contract_version_id, objective, canon_revision, positioning_version, content_hash
      FROM writing_orders WHERE writing_order_id = ? AND owner_id = ? AND book_id = ?`)
      .get(id, scope.ownerId, scope.bookId) as Record<string, string | number> | undefined;
    if (row === undefined) throw new Error('写作工单不存在或越权');
    return {
      writingOrderId: row.writing_order_id as string, chapterId: row.chapter_id as string, taskId: row.task_id as string,
      sourceDecisionId: row.source_decision_id as string, chapterOutlineVersionId: row.chapter_outline_version_id as string,
      writingContractVersionId: row.writing_contract_version_id as string, objective: row.objective as string,
      canonRevision: row.canon_revision as number, positioningVersion: row.positioning_version as number, contentHash: row.content_hash as string
    };
  }

  public createReviewPanel(scope: BookScope, input: {
    id: string; chapterId: string; manuscriptVersionId: string; manuscriptHash: string; reviewRound: number;
    writerModelSnapshotId: string; writerEpoch: number; bindingRevisionId: string | null; writingOrderId: string;
    canonRevision: number; tokenBudget: number; fact: TeamAgentRow; literary: TeamAgentRow; experience: TeamAgentRow;
    selectionReason: unknown; now: string;
  }): void {
    this.database.prepare(`INSERT INTO review_panels (
      review_panel_id, owner_id, book_id, manuscript_version_id, writer_model_snapshot_id,
      fact_agent_id, fact_model_snapshot_id, literary_agent_id, literary_model_snapshot_id,
      experience_agent_id, experience_model_snapshot_id, selection_reason_json, status, created_at,
      chapter_id, review_round, manuscript_hash, writer_epoch, binding_revision_id, writing_order_id, canon_revision, token_budget
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'working', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.id, scope.ownerId, scope.bookId, input.manuscriptVersionId, input.writerModelSnapshotId,
        input.fact.agentId, input.fact.modelSnapshotId, input.literary.agentId, input.literary.modelSnapshotId,
        input.experience.agentId, input.experience.modelSnapshotId, JSON.stringify(input.selectionReason), input.now,
        input.chapterId, input.reviewRound, input.manuscriptHash, input.writerEpoch, input.bindingRevisionId, input.writingOrderId,
        input.canonRevision, input.tokenBudget);
  }

  public insertReviewReport(scope: BookScope, input: {
    id: string; panelId: string; manuscriptVersionId: string; role: ReviewerRole; agentId: string; modelSnapshotId: string;
    report: unknown; reportHash: string; inputTokens: number; now: string;
  }): void {
    this.database.prepare(`INSERT INTO review_reports (
      review_report_id, owner_id, book_id, review_panel_id, manuscript_version_id, reviewer_role,
      agent_id, model_snapshot_id, report_json, report_hash, input_tokens, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`)
      .run(input.id, scope.ownerId, scope.bookId, input.panelId, input.manuscriptVersionId, input.role, input.agentId,
        input.modelSnapshotId, JSON.stringify(input.report), input.reportHash, input.inputTokens, input.now);
  }

  public finishReviewPanel(scope: BookScope, panelId: string, blocked: boolean): void {
    const count = (this.database.prepare(`SELECT COUNT(*) AS count FROM review_reports WHERE owner_id = ? AND book_id = ? AND review_panel_id = ? AND status = 'submitted'`)
      .get(scope.ownerId, scope.bookId, panelId) as { count: number }).count;
    if (count !== 3) throw new Error('三份有效点评报告未齐，不能完成点评轮次');
    this.database.prepare(`UPDATE review_panels SET status = ? WHERE review_panel_id = ? AND owner_id = ? AND book_id = ? AND status = 'working'`)
      .run(blocked ? 'blocked' : 'complete', panelId, scope.ownerId, scope.bookId);
  }

  public blockReviewPanel(scope: BookScope, panelId: string): void {
    this.database.prepare(`UPDATE review_panels SET status = 'blocked' WHERE review_panel_id = ? AND owner_id = ? AND book_id = ? AND status IN ('frozen', 'working')`)
      .run(panelId, scope.ownerId, scope.bookId);
  }

  public createRevisionOrder(scope: BookScope, input: {
    id: string; panelId: string; manuscriptVersionId: string; round: number; hardActions: unknown; softActions: unknown;
    disagreements: unknown; now: string;
  }): void {
    this.database.prepare(`UPDATE revision_orders SET status = 'completed' WHERE owner_id = ? AND book_id = ? AND status = 'active'`)
      .run(scope.ownerId, scope.bookId);
    this.database.prepare(`INSERT INTO revision_orders (
      revision_order_id, owner_id, book_id, review_panel_id, manuscript_version_id, revision_round,
      hard_actions_json, soft_actions_json, disagreements_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
      .run(input.id, scope.ownerId, scope.bookId, input.panelId, input.manuscriptVersionId, input.round,
        JSON.stringify(input.hardActions), JSON.stringify(input.softActions), JSON.stringify(input.disagreements), input.now);
  }

  public createApprovalGate(scope: BookScope, input: {
    gateId: string; confirmationId: string; chapterId: string; taskId: string; manuscriptVersionId: string;
    reviewPanelId: string; expectedCanonRevision: number; scopeData: unknown; impact: unknown; now: string;
  }): ApprovalGateRecord {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`INSERT INTO confirmations (
        confirmation_id, owner_id, book_id, target_type, target_id, old_value_json, new_value_json,
        scope_json, impact_json, expected_canon_revision, status, created_at
      ) VALUES (?, ?, ?, 'manuscript', ?, '{}', ?, ?, ?, ?, 'pending', ?)`)
        .run(input.confirmationId, scope.ownerId, scope.bookId, input.manuscriptVersionId,
          JSON.stringify({ manuscriptVersionId: input.manuscriptVersionId, status: 'approved' }), JSON.stringify(input.scopeData),
          JSON.stringify(input.impact), input.expectedCanonRevision, input.now);
      this.database.prepare(`INSERT INTO chapter_approval_gates (
        chapter_approval_gate_id, owner_id, book_id, chapter_id, task_id, manuscript_version_id,
        review_panel_id, confirmation_id, expected_canon_revision, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_owner', ?)`)
        .run(input.gateId, scope.ownerId, scope.bookId, input.chapterId, input.taskId, input.manuscriptVersionId,
          input.reviewPanelId, input.confirmationId, input.expectedCanonRevision, input.now);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.requireGate(scope, input.confirmationId);
  }

  public requireGate(scope: BookScope, confirmationId: string): ApprovalGateRecord {
    const row = this.database.prepare(`SELECT chapter_approval_gate_id, chapter_id, task_id, manuscript_version_id,
      review_panel_id, confirmation_id, expected_canon_revision, status FROM chapter_approval_gates
      WHERE confirmation_id = ? AND owner_id = ? AND book_id = ?`)
      .get(confirmationId, scope.ownerId, scope.bookId) as Record<string, string | number> | undefined;
    if (row === undefined) throw new Error('正文确认单不存在或越权');
    return { gateId: row.chapter_approval_gate_id as string, chapterId: row.chapter_id as string, taskId: row.task_id as string,
      manuscriptVersionId: row.manuscript_version_id as string, reviewPanelId: row.review_panel_id as string,
      confirmationId: row.confirmation_id as string, expectedCanonRevision: row.expected_canon_revision as number, status: row.status as string };
  }

  public resolveGate(scope: BookScope, confirmationId: string, accept: boolean, note: string | null, now: string): ApprovalGateRecord {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const confirmation = this.database.prepare(`SELECT status FROM confirmations WHERE confirmation_id = ? AND owner_id = ? AND book_id = ?`)
        .get(confirmationId, scope.ownerId, scope.bookId) as { status: string } | undefined;
      if (confirmation?.status !== 'pending') throw new Error('正文确认单不存在或已经处理');
      const result = this.database.prepare(`UPDATE chapter_approval_gates SET status = ?, decision_note = ?, resolved_at = ?
        WHERE confirmation_id = ? AND owner_id = ? AND book_id = ? AND status = 'awaiting_owner'`)
        .run(accept ? 'accepted' : 'rejected', note, now, confirmationId, scope.ownerId, scope.bookId);
      if (result.changes !== 1) throw new Error('正文确认门禁状态冲突');
      this.database.prepare(`UPDATE confirmations SET status = ?, resolved_at = ? WHERE confirmation_id = ?`)
        .run(accept ? 'accepted' : 'rejected', now, confirmationId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.requireGate(scope, confirmationId);
  }

  public markGateSettlement(scope: BookScope, confirmationId: string, succeeded: boolean, now: string): void {
    this.database.prepare(`UPDATE chapter_approval_gates SET status = ?, resolved_at = ?
      WHERE confirmation_id = ? AND owner_id = ? AND book_id = ? AND status IN ('accepted', 'settlement_failed')`)
      .run(succeeded ? 'settled' : 'settlement_failed', now, confirmationId, scope.ownerId, scope.bookId);
  }

  public prepareOwnerRejectedRewrite(scope: BookScope, gate: ApprovalGateRecord, note: string, revisionOrderId: string, now: string): 'paused' | 'blocked' {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const confirmation = this.database.prepare(`SELECT status FROM confirmations
        WHERE confirmation_id = ? AND owner_id = ? AND book_id = ?`)
        .get(gate.confirmationId, scope.ownerId, scope.bookId) as { status: string } | undefined;
      if (confirmation?.status !== 'pending') throw new Error('正文确认单不存在或已经处理');
      const run = this.database.prepare(`SELECT pipeline_run_id, rewrite_count, writing_order_id FROM chapter_pipeline_runs
        WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND task_id = ?`)
        .get(scope.ownerId, scope.bookId, gate.chapterId, gate.taskId) as { pipeline_run_id: string; rewrite_count: number; writing_order_id: string | null } | undefined;
      if (run === undefined) throw new Error('正文确认对应的流水线不存在');
      const canRewrite = run.rewrite_count < 2;
      const gateResult = this.database.prepare(`UPDATE chapter_approval_gates SET status = 'rejected', decision_note = ?, resolved_at = ?
        WHERE confirmation_id = ? AND owner_id = ? AND book_id = ? AND status = 'awaiting_owner'`)
        .run(note, now, gate.confirmationId, scope.ownerId, scope.bookId);
      if (gateResult.changes !== 1) throw new Error('正文确认门禁状态冲突');
      this.database.prepare(`UPDATE confirmations SET status = 'rejected', resolved_at = ? WHERE confirmation_id = ?`)
        .run(now, gate.confirmationId);
      this.database.prepare(`UPDATE chapters SET settlement_status = 'unsettled', updated_at = ? WHERE chapter_id = ? AND owner_id = ? AND book_id = ?`)
        .run(now, gate.chapterId, scope.ownerId, scope.bookId);
      if (canRewrite) {
        this.database.prepare(`UPDATE revision_orders SET status = 'completed' WHERE owner_id = ? AND book_id = ? AND status = 'active'`)
          .run(scope.ownerId, scope.bookId);
        this.database.prepare(`INSERT INTO revision_orders (
          revision_order_id, owner_id, book_id, review_panel_id, manuscript_version_id, revision_round,
          hard_actions_json, soft_actions_json, disagreements_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', 'active', ?)`)
          .run(revisionOrderId, scope.ownerId, scope.bookId, gate.reviewPanelId, gate.manuscriptVersionId,
            run.rewrite_count + 1, JSON.stringify([`老板拒绝当前稿：${note}`]), now);
        this.database.prepare(`UPDATE chapter_pipeline_runs SET phase = 'rewrite', status = 'paused', confirmation_id = NULL,
          error_code = NULL, updated_at = ? WHERE pipeline_run_id = ?`)
          .run(now, run.pipeline_run_id);
        this.database.prepare(`UPDATE tasks SET status = 'paused', current_phase = 'rewrite', error_code = NULL, updated_at = ?
          WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'waiting_confirmation'`)
          .run(now, gate.taskId, scope.ownerId, scope.bookId);
      } else {
        this.database.prepare(`UPDATE tasks SET status = 'blocked', current_phase = 'owner_rejected', error_code = 'OWNER_REJECTED_AFTER_TWO_REWRITES', updated_at = ?
          WHERE task_id = ? AND owner_id = ? AND book_id = ? AND status = 'waiting_confirmation'`)
          .run(now, gate.taskId, scope.ownerId, scope.bookId);
      }
      this.database.exec('COMMIT');
      return canRewrite ? 'paused' : 'blocked';
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public recordQualityMetric(scope: BookScope, input: {
    id: string; chapterId: string; manuscriptVersionId: string; rewriteCount: number; now: string;
  }): void {
    const reports = this.database.prepare(`SELECT reviewer_role, report_json FROM review_reports
      WHERE owner_id = ? AND book_id = ? AND manuscript_version_id = ? AND status = 'submitted' ORDER BY reviewer_role`)
      .all(scope.ownerId, scope.bookId, input.manuscriptVersionId) as unknown as Array<{ reviewer_role: string; report_json: string }>;
    if (reports.length !== 3) throw new Error('正式结算缺少三份点评报告');
    const scores = Object.fromEntries(reports.map((report) => [report.reviewer_role, JSON.parse(report.report_json)]));
    this.database.prepare(`INSERT INTO chapter_quality_metrics (
      quality_metric_id, owner_id, book_id, chapter_id, manuscript_version_id, scores_json,
      rewrite_count, repeated_major_style_issue, switch_writer_suggested, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`)
      .run(input.id, scope.ownerId, scope.bookId, input.chapterId, input.manuscriptVersionId, JSON.stringify(scores), input.rewriteCount, input.now);
  }

  public rewriteCount(scope: BookScope, chapterId: string, taskId: string): number {
    const row = this.database.prepare(`SELECT rewrite_count FROM chapter_pipeline_runs WHERE owner_id = ? AND book_id = ? AND chapter_id = ? AND task_id = ?`)
      .get(scope.ownerId, scope.bookId, chapterId, taskId) as { rewrite_count: number } | undefined;
    if (row === undefined) throw new Error('章节流水线不存在');
    return row.rewrite_count;
  }

  public manuscriptReference(scope: BookScope, manuscriptVersionId: string): { relativePath: string; contentHash: string; status: string } {
    const row = this.database.prepare(`SELECT f.relative_path, m.content_hash, m.status FROM manuscript_versions m
      JOIN file_registry f ON f.file_id = m.file_id
      WHERE m.manuscript_version_id = ? AND m.owner_id = ? AND m.book_id = ? AND f.status = 'active'`)
      .get(manuscriptVersionId, scope.ownerId, scope.bookId) as { relative_path: string; content_hash: string; status: string } | undefined;
    if (row === undefined) throw new Error('正文文件不存在或越权');
    return { relativePath: row.relative_path, contentHash: row.content_hash, status: row.status };
  }

  public chapter(scope: BookScope, chapterId: string): { chapterNumber: number; title: string } {
    const row = this.database.prepare(`SELECT chapter_number, title FROM chapters WHERE chapter_id = ? AND owner_id = ? AND book_id = ?`)
      .get(chapterId, scope.ownerId, scope.bookId) as { chapter_number: number; title: string } | undefined;
    if (row === undefined) throw new Error('章节不存在或越权');
    return { chapterNumber: row.chapter_number, title: row.title };
  }

  public findChapterEventEntity(scope: BookScope, canonicalName: string): string | null {
    const row = this.database.prepare(`SELECT entity_id FROM entities WHERE owner_id = ? AND book_id = ? AND entity_type = 'event' AND canonical_name = ? ORDER BY created_at LIMIT 1`)
      .get(scope.ownerId, scope.bookId, canonicalName) as { entity_id: string } | undefined;
    return row?.entity_id ?? null;
  }

  public hasChapterFact(scope: BookScope, chapterId: string, manuscriptVersionId: string): boolean {
    return this.database.prepare(`SELECT 1 FROM fact_assertions WHERE owner_id = ? AND book_id = ?
      AND source_chapter_id = ? AND source_manuscript_version_id = ? AND relation_key = 'event'
      AND status NOT IN ('rejected', 'withdrawn') LIMIT 1`)
      .get(scope.ownerId, scope.bookId, chapterId, manuscriptVersionId) !== undefined;
  }
}
