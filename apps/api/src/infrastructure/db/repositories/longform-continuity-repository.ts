import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface CommitmentRecord {
  commitmentId: string; type: string; title: string; description: string; entityIds: string[]; openedChapter: number;
  earliestDueChapter: number | null; latestDueChapter: number | null; sourceId: string; sourceHash: string;
  status: 'open' | 'due' | 'fulfilled' | 'violated' | 'retired';
}

export class LongformContinuityRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public insertCommitment(scope: BookScope, input: {
    id: string; type: string; title: string; description: string; entityIds: string[]; openedChapter: number;
    earliestDueChapter?: number; latestDueChapter?: number; sourceType: string; sourceId: string; sourceHash: string;
    sourceLocator: Record<string, unknown>; authorityGrade: string; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`INSERT INTO narrative_commitments (
      narrative_commitment_id, owner_id, book_id, commitment_type, title, description, entity_ids_json,
      opened_chapter, earliest_due_chapter, latest_due_chapter, source_type, source_id, source_hash,
      source_locator_json, authority_grade, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`).run(
      input.id, scope.ownerId, scope.bookId, input.type, input.title, input.description, JSON.stringify(input.entityIds),
      input.openedChapter, input.earliestDueChapter ?? null, input.latestDueChapter ?? null, input.sourceType, input.sourceId,
      input.sourceHash, JSON.stringify(input.sourceLocator), input.authorityGrade, input.now, input.now
    );
  }

  public listCommitments(scope: BookScope, currentChapter?: number): CommitmentRecord[] {
    assertBookScope(scope);
    const rows = this.database.prepare(`SELECT narrative_commitment_id, commitment_type, title, description, entity_ids_json,
      opened_chapter, earliest_due_chapter, latest_due_chapter, source_id, source_hash, status
      FROM narrative_commitments WHERE owner_id = ? AND book_id = ?
      AND status IN ('open', 'due', 'violated') AND (? IS NULL OR latest_due_chapter IS NULL OR latest_due_chapter >= ?)
      ORDER BY CASE status WHEN 'violated' THEN 0 WHEN 'due' THEN 1 ELSE 2 END, opened_chapter`)
      .all(scope.ownerId, scope.bookId, currentChapter ?? null, currentChapter ?? null) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({ commitmentId: row.narrative_commitment_id as string, type: row.commitment_type as string,
      title: row.title as string, description: row.description as string, entityIds: JSON.parse(row.entity_ids_json as string) as string[],
      openedChapter: row.opened_chapter as number, earliestDueChapter: row.earliest_due_chapter as number | null,
      latestDueChapter: row.latest_due_chapter as number | null, sourceId: row.source_id as string, sourceHash: row.source_hash as string,
      status: row.status as CommitmentRecord['status'] }));
  }

  public updateCommitmentStatus(scope: BookScope, id: string, status: CommitmentRecord['status'], resolutionSourceId: string | null, now: string): boolean {
    return this.database.prepare(`UPDATE narrative_commitments SET status = ?, resolution_source_id = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND narrative_commitment_id = ?`).run(status, resolutionSourceId, now, scope.ownerId, scope.bookId, id).changes === 1;
  }

  public nextSettlementVersion(scope: BookScope, stageType: string, stageKey: string): number {
    return (this.database.prepare(`SELECT COALESCE(MAX(version), 0) AS version FROM stage_settlements
      WHERE owner_id = ? AND book_id = ? AND stage_type = ? AND stage_key = ?`).get(scope.ownerId, scope.bookId, stageType, stageKey) as { version: number }).version + 1;
  }

  public insertSettlement(scope: BookScope, input: {
    id: string; stageType: string; stageKey: string; version: number; chapterStart: number; chapterEnd: number; canonRevision: number;
    payload: Record<string, unknown>; status: 'building' | 'failed'; now: string;
  }): void {
    const p = input.payload;
    this.database.prepare(`INSERT INTO stage_settlements (
      stage_settlement_id, owner_id, book_id, stage_type, stage_key, version, chapter_start, chapter_end, canon_revision,
      irreversible_results_json, entity_states_json, closed_threads_json, open_threads_json, relationship_changes_json,
      knowledge_changes_json, resource_changes_json, rule_changes_json, exclusions_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      input.id, scope.ownerId, scope.bookId, input.stageType, input.stageKey, input.version, input.chapterStart, input.chapterEnd,
      input.canonRevision, json(p.irreversibleResults), json(p.entityStates), json(p.closedThreads), json(p.openThreads),
      json(p.relationshipChanges), json(p.knowledgeChanges), json(p.resourceChanges), json(p.ruleChanges), json(p.exclusions), input.status, input.now
    );
  }

  public insertSettlementSource(scope: BookScope, input: { id: string; settlementId: string; sourceType: string; sourceId: string; sourceHash: string; locator: Record<string, unknown>; now: string }): void {
    this.database.prepare(`INSERT INTO stage_settlement_sources (
      stage_settlement_source_id, owner_id, book_id, stage_settlement_id, source_type, source_id, source_hash, source_locator_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.id, scope.ownerId, scope.bookId, input.settlementId, input.sourceType, input.sourceId, input.sourceHash, JSON.stringify(input.locator), input.now);
  }

  public insertProbe(scope: BookScope, input: { id: string; settlementId: string; type: string; expected: unknown; actual: unknown; passed: boolean; now: string }): void {
    this.database.prepare(`INSERT INTO stage_settlement_probes (
      stage_settlement_probe_id, owner_id, book_id, stage_settlement_id, probe_type, expected_json, actual_json, passed, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.id, scope.ownerId, scope.bookId, input.settlementId, input.type,
      JSON.stringify(input.expected), JSON.stringify(input.actual), input.passed ? 1 : 0, input.now);
  }

  public activateSettlement(scope: BookScope, settlementId: string, stageType: string, stageKey: string, now: string): void {
    this.database.prepare(`UPDATE stage_settlements SET status = 'superseded' WHERE owner_id = ? AND book_id = ? AND stage_type = ? AND stage_key = ? AND status = 'active'`)
      .run(scope.ownerId, scope.bookId, stageType, stageKey);
    this.database.prepare(`UPDATE stage_settlements SET status = 'active', activated_at = ? WHERE owner_id = ? AND book_id = ? AND stage_settlement_id = ? AND status = 'building'`)
      .run(now, scope.ownerId, scope.bookId, settlementId);
  }

  public failSettlement(scope: BookScope, settlementId: string): void {
    this.database.prepare(`UPDATE stage_settlements SET status = 'failed' WHERE owner_id = ? AND book_id = ? AND stage_settlement_id = ?`).run(scope.ownerId, scope.bookId, settlementId);
  }

  public activeSettlement(scope: BookScope, stageType: string, stageKey: string): { id: string; version: number } | null {
    const row = this.database.prepare(`SELECT stage_settlement_id, version FROM stage_settlements WHERE owner_id = ? AND book_id = ? AND stage_type = ? AND stage_key = ? AND status = 'active'`)
      .get(scope.ownerId, scope.bookId, stageType, stageKey) as { stage_settlement_id: string; version: number } | undefined;
    return row === undefined ? null : { id: row.stage_settlement_id, version: row.version };
  }

  public activateRollingPlan(scope: BookScope, input: { id: string; version: number; currentChapter: number; detailedStart: number; detailedEnd: number; outlinedEnd: number; spanEstimateId?: string; plan: unknown; now: string }): void {
    this.database.prepare(`UPDATE rolling_plan_windows SET status = 'superseded' WHERE owner_id = ? AND book_id = ? AND status = 'active'`).run(scope.ownerId, scope.bookId);
    this.database.prepare(`INSERT INTO rolling_plan_windows (
      rolling_plan_window_id, owner_id, book_id, version, current_chapter, detailed_start, detailed_end, outlined_end,
      source_span_estimate_id, plan_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`).run(input.id, scope.ownerId, scope.bookId, input.version,
      input.currentChapter, input.detailedStart, input.detailedEnd, input.outlinedEnd, input.spanEstimateId ?? null, JSON.stringify(input.plan), input.now);
  }

  public activeRollingPlan(scope: BookScope): { id: string; version: number; currentChapter: number; detailedEnd: number; outlinedEnd: number } | null {
    const row = this.database.prepare(`SELECT rolling_plan_window_id, version, current_chapter, detailed_end, outlined_end FROM rolling_plan_windows WHERE owner_id = ? AND book_id = ? AND status = 'active'`)
      .get(scope.ownerId, scope.bookId) as Record<string, number | string> | undefined;
    return row === undefined ? null : { id: row.rolling_plan_window_id as string, version: row.version as number,
      currentChapter: row.current_chapter as number, detailedEnd: row.detailed_end as number, outlinedEnd: row.outlined_end as number };
  }

  public invalidateRollingPlan(scope: BookScope, reason: string): boolean {
    return this.database.prepare(`UPDATE rolling_plan_windows SET status = 'invalidated', invalidation_reason = ? WHERE owner_id = ? AND book_id = ? AND status = 'active'`)
      .run(reason, scope.ownerId, scope.bookId).changes === 1;
  }

  public insertSpanEstimate(scope: BookScope, input: { id: string; discussionId: string; round: number; agentId: string; modelSnapshotId: string; minimum: number; recommended: number; maximum: number; units: unknown; assumptions: unknown; uncertainty: unknown; inputHash: string; now: string }): void {
    this.database.prepare(`INSERT INTO plot_span_estimates (
      plot_span_estimate_id, owner_id, book_id, discussion_id, round, screenwriter_agent_id, model_snapshot_id,
      minimum_chapters, recommended_chapters, maximum_chapters, units_json, assumptions_json, uncertainty_json,
      input_hash, independence_attested, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'submitted', ?)`).run(input.id, scope.ownerId, scope.bookId,
      input.discussionId, input.round, input.agentId, input.modelSnapshotId, input.minimum, input.recommended, input.maximum,
      JSON.stringify(input.units), JSON.stringify(input.assumptions), JSON.stringify(input.uncertainty), input.inputHash, input.now);
  }

  public spanEstimates(scope: BookScope, discussionId: string, round: number): Array<{ id: string; agentId: string; modelSnapshotId: string; minimum: number; recommended: number; maximum: number; inputHash: string }> {
    const rows = this.database.prepare(`SELECT plot_span_estimate_id, screenwriter_agent_id, model_snapshot_id,
      minimum_chapters, recommended_chapters, maximum_chapters, input_hash FROM plot_span_estimates
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ? AND round = ? AND status = 'submitted'`)
      .all(scope.ownerId, scope.bookId, discussionId, round) as unknown as Array<Record<string, string | number>>;
    return rows.map((r) => ({ id: r.plot_span_estimate_id as string, agentId: r.screenwriter_agent_id as string,
      modelSnapshotId: r.model_snapshot_id as string, minimum: r.minimum_chapters as number, recommended: r.recommended_chapters as number,
      maximum: r.maximum_chapters as number, inputHash: r.input_hash as string }));
  }

  public modelSignature(snapshotId: string): string {
    const row = this.database.prepare(`SELECT provider, model_id FROM model_config_snapshots WHERE model_snapshot_id = ?`).get(snapshotId) as { provider: string; model_id: string } | undefined;
    if (row === undefined) throw new Error('模型快照不存在');
    return `${row.provider}/${row.model_id}`;
  }
}

function json(value: unknown): string { return JSON.stringify(value ?? []); }
