import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export type SettlementFollowUpStageKind = 'event' | 'volume';

export interface SettlementFollowUpRow {
  follow_up_id: string;
  owner_id: string;
  book_id: string;
  stage_kind: SettlementFollowUpStageKind;
  stage_object_id: string;
  settlement_id: string;
  task_id: string;
  pacing_report_json: string | null;
  summary_text: string | null;
  pacing_agent_id: string | null;
  pacing_model_snapshot_id: string | null;
  summary_agent_id: string | null;
  summary_model_snapshot_id: string | null;
  created_at: string;
  updated_at: string;
}

export class SettlementFollowUpRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public byStage(
    scope: BookScope,
    stageKind: SettlementFollowUpStageKind,
    stageObjectId: string
  ): SettlementFollowUpRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT * FROM settlement_follow_ups
      WHERE owner_id = ? AND book_id = ? AND stage_kind = ? AND stage_object_id = ?`)
      .get(scope.ownerId, scope.bookId, stageKind, stageObjectId) as SettlementFollowUpRow | undefined;
  }

  public byTask(scope: BookScope, taskId: string): SettlementFollowUpRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT * FROM settlement_follow_ups
      WHERE owner_id = ? AND book_id = ? AND task_id = ?`)
      .get(scope.ownerId, scope.bookId, taskId) as SettlementFollowUpRow | undefined;
  }

  /** 同一结算对象只留一份后续产物；重试时换新任务并清空旧产物。 */
  public createOrResetPending(scope: BookScope, input: {
    followUpId: string;
    stageKind: SettlementFollowUpStageKind;
    stageObjectId: string;
    settlementId: string;
    taskId: string;
    now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`INSERT INTO settlement_follow_ups(
        follow_up_id, owner_id, book_id, stage_kind, stage_object_id, settlement_id, task_id,
        pacing_report_json, summary_text,
        pacing_agent_id, pacing_model_snapshot_id, summary_agent_id, summary_model_snapshot_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
      ON CONFLICT(owner_id, book_id, stage_kind, stage_object_id) DO UPDATE SET
        settlement_id = excluded.settlement_id,
        task_id = excluded.task_id,
        pacing_report_json = NULL,
        summary_text = NULL,
        pacing_agent_id = NULL,
        pacing_model_snapshot_id = NULL,
        summary_agent_id = NULL,
        summary_model_snapshot_id = NULL,
        updated_at = excluded.updated_at`)
      .run(
        input.followUpId, scope.ownerId, scope.bookId, input.stageKind, input.stageObjectId,
        input.settlementId, input.taskId, input.now, input.now
      );
  }

  public savePacing(scope: BookScope, taskId: string, input: {
    report: unknown;
    agentId: string;
    modelSnapshotId: string;
    now: string;
  }): void {
    assertBookScope(scope);
    const result = this.database.prepare(`UPDATE settlement_follow_ups SET
        pacing_report_json = ?, pacing_agent_id = ?, pacing_model_snapshot_id = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND task_id = ?`)
      .run(
        JSON.stringify(input.report), input.agentId, input.modelSnapshotId, input.now,
        scope.ownerId, scope.bookId, taskId
      );
    if (result.changes !== 1) throw new Error('结算后续记录不存在，无法保存节奏体检。');
  }

  public saveSummary(scope: BookScope, taskId: string, input: {
    summary: string;
    agentId: string;
    modelSnapshotId: string;
    now: string;
  }): void {
    assertBookScope(scope);
    const result = this.database.prepare(`UPDATE settlement_follow_ups SET
        summary_text = ?, summary_agent_id = ?, summary_model_snapshot_id = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND task_id = ?`)
      .run(
        input.summary, input.agentId, input.modelSnapshotId, input.now,
        scope.ownerId, scope.bookId, taskId
      );
    if (result.changes !== 1) throw new Error('结算后续记录不存在，无法保存大白话摘要。');
  }
}
