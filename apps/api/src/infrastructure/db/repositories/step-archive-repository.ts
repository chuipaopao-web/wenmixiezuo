import type { DatabaseSync } from 'node:sqlite';

/**
 * 625cc3f7集中复核①：步骤版本重建完整归档（tm2_step_archive）。
 * 输入版本变化的旧步骤，其完整行、全部attempt与输出引用在重建前归档；
 * 不删除证据、不前80字冒充归档；归档与新版本同事务，归档失败不重建。
 */
export class StepArchiveRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** 归档并移除旧行（完整保留后）。返回归档id时间戳；行不存在按已归档跳过（幂等）。 */
  archiveStep(scope: { ownerId: string; bookId: string }, stepId: string, reason: string): void {
    const ownTx = !this.db.isTransaction;
    if (ownTx) this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT * FROM tm2_steps WHERE owner=? AND book=? AND id=?').get(scope.ownerId, scope.bookId, stepId) as Record<string, unknown> | undefined;
      if (row !== undefined) {
        const attempts = this.db.prepare('SELECT * FROM tm2_attempts WHERE owner=? AND book=? AND step=?').all(scope.ownerId, scope.bookId, stepId) as Record<string, unknown>[];
        this.db.prepare('INSERT INTO tm2_step_archive(owner,book,id,archived_at,reason,row_json,attempts_json,output_json) VALUES(?,?,?,?,?,?,?,?)')
          .run(scope.ownerId, scope.bookId, stepId, new Date().toISOString(), reason,
            JSON.stringify(row), JSON.stringify(attempts),
            typeof row.output === 'string' ? row.output : null);
        this.db.prepare('DELETE FROM tm2_attempts WHERE owner=? AND book=? AND step=?').run(scope.ownerId, scope.bookId, stepId);
        this.db.prepare('DELETE FROM tm2_steps WHERE owner=? AND book=? AND id=?').run(scope.ownerId, scope.bookId, stepId);
      }
      if (ownTx) this.db.exec('COMMIT');
    } catch (error) { if (ownTx && this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }

  /**
   * 带边界的归档（Codex复核）：同一事务内先核验——步骤必须同owner/book存在、非活动租约running，
   * 才完整归档并移除（供输入版本变更重建）；活租约抛错不归档不重建（不能遇到Conflict就替换成活步骤）。
   */
  archiveStepIfStale(scope: { ownerId: string; bookId: string }, stepId: string, reason: string): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT state, lease_until FROM tm2_steps WHERE owner=? AND book=? AND id=?').get(scope.ownerId, scope.bookId, stepId) as { state: string; lease_until: number | null } | undefined;
      if (row === undefined) throw new Error(`归档目标步骤不存在：${stepId}`);
      if (row.state === 'running' && row.lease_until !== null && row.lease_until > Date.now()) {
        throw new Error(`步骤活动租约未过期，不归档不重建：${stepId}`);
      }
      this.archiveStep(scope, stepId, reason);
      this.db.exec('COMMIT');
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }

  /** 读取某步骤的全部归档版本（审计/对照用）。 */
  archivedVersions(scope: { ownerId: string; bookId: string }, stepId: string): { archived_at: string; reason: string; row_json: string; attempts_json: string; output_json: string | null }[] {
    return this.db.prepare('SELECT archived_at,reason,row_json,attempts_json,output_json FROM tm2_step_archive WHERE owner=? AND book=? AND id=? ORDER BY archived_at')
      .all(scope.ownerId, scope.bookId, stepId) as { archived_at: string; reason: string; row_json: string; attempts_json: string; output_json: string | null }[];
  }
}
