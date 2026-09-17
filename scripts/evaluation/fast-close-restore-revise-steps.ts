#!/usr/bin/env tsx
/**
 * bcf19a6a收尾核定·事故恢复（零模型调用）：
 * 共享边界/rationale提示合同升级本属第二轮（reviseAgain），首轮修订提示变更导致
 * revise-volume:v3~v6:revision-1 四个已缓存步骤被判输入版本冲突归档并重发（4次真实调用）。
 * 本脚本：把误重发的当前行归档留证（输出不丢），从 tm2_step_archive 恢复首轮原始缓存行，
 * 使恢复重放零新增dispatch；全过程outbox事件记录，归档表双侧证据均保留。
 */
import { resolve } from 'node:path';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { StepArchiveRepository } from '../../apps/api/src/infrastructure/db/repositories/step-archive-repository.js';

const DB = '.local/eval/fast-close-runtime/data/database/wenmi.sqlite';
const RUN = 'c116818b-028d-4438-9bc6-2e4474155aaa';
const STEP_IDS = ['v3', 'v4', 'v5', 'v6'].map(v => `${RUN}:revise-volume:${v}:revision-1`);

function main(): void {
  const db = openDatabase(resolve(DB));
  const run = db.prepare('SELECT owner_id, book_id FROM tm2_design_runs WHERE id=?').get(RUN) as { owner_id: string; book_id: string };
  const scope = { ownerId: run.owner_id, bookId: run.book_id };
  const archiver = new StepArchiveRepository(db);
  const restored: string[] = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const stepId of STEP_IDS) {
      const current = db.prepare('SELECT input_hash, state FROM tm2_steps WHERE owner=? AND book=? AND id=?').get(scope.ownerId, scope.bookId, stepId) as { input_hash: string; state: string } | undefined;
      if (!current) throw new Error(`当前行不存在：${stepId}`);
      const archives = db.prepare('SELECT archived_at, reason, row_json, attempts_json FROM tm2_step_archive WHERE owner=? AND book=? AND id=? ORDER BY archived_at ASC').all(scope.ownerId, scope.bookId, stepId) as { archived_at: string; reason: string; row_json: string; attempts_json: string }[];
      const original = archives.find(a => a.reason.includes('输入版本变化'));
      if (!original) throw new Error(`未找到首轮归档：${stepId}`);
      const originalRow = JSON.parse(original.row_json) as Record<string, unknown>;
      if (originalRow.input_hash === current.input_hash) throw new Error(`归档与当前同hash，无需恢复：${stepId}`);
      // ① 误重发的当前行归档留证（输出保留在output_json）
      archiver.archiveStep(scope, stepId, 'bcf19a6a提示合同升级误触发首轮重发：本轮输出保留为证据，恢复首轮原始缓存行（不删除不掩盖）');
      // ② 恢复首轮原始行与attempts
      const rowCols = Object.keys(originalRow);
      db.prepare(`INSERT INTO tm2_steps(${rowCols.join(',')}) VALUES(${rowCols.map(() => '?').join(',')})`).run(...rowCols.map(k => originalRow[k] as string | number | null));
      const attempts = JSON.parse(original.attempts_json) as Record<string, unknown>[];
      for (const at of attempts) {
        const cols = Object.keys(at);
        db.prepare(`INSERT INTO tm2_attempts(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map(k => at[k] as string | number | null));
      }
      restored.push(`${stepId.split(':').slice(-2).join(':')}（hash ${String(originalRow.input_hash).slice(0, 8)}←${current.input_hash.slice(0, 8)}）`);
    }
    // ③ outbox事件：恢复事实与原因
    db.prepare("INSERT INTO tm2_outbox(owner,book,id,kind,body) VALUES(?,?,?,'eval.restore-revise-steps',?)")
      .run(scope.ownerId, scope.bookId, `${RUN}:restore-revise-steps:${Date.now()}`, JSON.stringify({ runId: RUN, restored: STEP_IDS, reason: 'bcf19a6a提示合同升级误触发首轮重发，恢复首轮原始缓存行使重放零新增dispatch', at: new Date().toISOString() }));
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
  for (const r of restored) console.log('已恢复：', r);
  db.close();
}
main();
