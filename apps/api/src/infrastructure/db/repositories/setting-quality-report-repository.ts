import type { DatabaseSync } from 'node:sqlite';
import type { BookScope } from '../../../domain/scope.js';

export interface SettingQualityIssue {
  id: string;
  severity: 'hard' | 'soft';
  itemKey: string;
  problem: string;
  suggestion: string;
}

export interface SettingQualityReportRow {
  report_id: string;
  task_id: string | null;
  content_hash: string;
  verdict: 'pass' | 'warn' | 'fail';
  summary_text: string;
  issues_json: string;
  created_at: string;
}

export class SettingQualityReportRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public save(scope: BookScope, input: {
    reportId: string;
    taskId: string | null;
    contentHash: string;
    verdict: 'pass' | 'warn' | 'fail';
    summary: string;
    issues: SettingQualityIssue[];
    now: string;
  }): void {
    this.database.prepare(`
      INSERT INTO setting_quality_reports (
        report_id, owner_id, book_id, task_id, content_hash, verdict, summary_text, issues_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.reportId, scope.ownerId, scope.bookId, input.taskId, input.contentHash,
      input.verdict, input.summary, JSON.stringify(input.issues), input.now
    );
  }

  public latest(scope: BookScope): SettingQualityReportRow | undefined {
    return this.database.prepare(`
      SELECT report_id, task_id, content_hash, verdict, summary_text, issues_json, created_at
      FROM setting_quality_reports
      WHERE owner_id = ? AND book_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) as SettingQualityReportRow | undefined;
  }

  /** 最近一次整份设定质检任务的状态，供前端提示“主编正在检查”。 */
  public latestAuditTaskStatus(scope: BookScope): string | null {
    const row = this.database.prepare(`
      SELECT status FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
        AND json_extract(task_brief_json, '$.purpose') = 'setting_quality_audit'
      ORDER BY created_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { status: string } | undefined;
    return row?.status ?? null;
  }
}
