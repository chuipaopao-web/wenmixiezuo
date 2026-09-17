import type { DatabaseSync } from 'node:sqlite';
import type { Scope } from '@wenmi/time-machine-core';

/**
 * 625cc3f7集中复核①：合法任务恢复准备（应用层可测试方法，非脚本猴子补丁）。
 * - 接管前提：无活动租约/活写者（running步骤lease未过期→阻塞不动）；
 * - 非成功步骤（running且租约过期/failed/unknown）回ready清租约，旧attempt行保留为证据；
 * - 成功步骤一律不动：输入hash一致由claim命中saved零重发；不一致由设计服务createStepVersioned完整归档后重建；
 * - run仅在接管成功时回queued（既有process只受理queued）；全部动作与阻塞逐条返回供审计。
 */
export interface ResumePrepareResult {
  readonly actions: readonly string[];
  readonly blocked: readonly string[];
}

export class TimeMachineResumeService {
  constructor(private readonly db: DatabaseSync) {}

  prepare(scope: Scope, runId: string): ResumePrepareResult {
    const run = this.db.prepare('SELECT id,state,phase,updated_at FROM tm2_design_runs WHERE owner_id=? AND book_id=? AND id=?')
      .get(scope.ownerId, scope.bookId, runId) as { state: string; phase: string } | undefined;
    if (!run) throw new Error(`恢复目标run不存在：${runId}`);
    if (run.state === 'succeeded') return { actions: ['run已成功，无需恢复'], blocked: [] };

    const now = Date.now();
    const steps = this.db.prepare('SELECT id,state,lease_until FROM tm2_steps WHERE owner=? AND book=? AND id LIKE ? ORDER BY rowid')
      .all(scope.ownerId, scope.bookId, `${runId}:%`) as { id: string; state: string; lease_until: number | null }[];
    const blocked: string[] = [];
    const actions: string[] = [];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      // 活写者检查（事务内重新确认，避免读检查后另一worker接手）：任一running步骤租约未过期→整体不动
      const live = this.db.prepare("SELECT id,lease_until FROM tm2_steps WHERE owner=? AND book=? AND id LIKE ? AND state='running' AND lease_until IS NOT NULL AND lease_until > ?")
        .all(scope.ownerId, scope.bookId, `${runId}:%`, now) as { id: string; lease_until: number }[];
      if (live.length) {
        this.db.exec('ROLLBACK');
        return { actions: [], blocked: live.map(s => `活动租约未过期：${s.id.split(':').slice(-2).join(':')}（lease至${new Date(s.lease_until).toISOString()}）`) };
      }
      for (const s of steps) {
        if (s.state === 'succeeded' || s.state === 'ready') continue; // 成功步骤不动（hash对比由claim/versioned处理）
        if (s.state === 'failed') {
          // failed证据保留：error_code不清除（truncated等标记供降级路径识别），仅重置状态与租约
          this.db.prepare("UPDATE tm2_steps SET state='ready',attempt=NULL,lease_until=NULL WHERE owner=? AND book=? AND id=?")
            .run(scope.ownerId, scope.bookId, s.id);
        } else {
          this.db.prepare("UPDATE tm2_steps SET state='ready',attempt=NULL,lease_until=NULL,error_code=NULL WHERE owner=? AND book=? AND id=?")
            .run(scope.ownerId, scope.bookId, s.id);
        }
        actions.push(`步骤回ready：${s.id.split(':').slice(-2).join(':')}（原${s.state}${s.state === 'failed' ? '；error_code保留' : ''}；旧attempt行保留为证据）`);
      }
      if (run.state !== 'queued') {
        this.db.prepare("UPDATE tm2_design_runs SET state='queued',updated_at=? WHERE owner_id=? AND book_id=? AND id=?")
          .run(new Date().toISOString(), scope.ownerId, scope.bookId, runId);
        actions.push(`run恢复入口：${run.state}→queued（仅状态移交，无进度伪造）`);
      }
      this.db.exec('COMMIT');
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
    return { actions, blocked };
  }
}
