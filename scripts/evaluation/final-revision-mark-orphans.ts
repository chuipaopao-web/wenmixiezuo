#!/usr/bin/env tsx
/**
 * 915a3a79复核·事故B孤儿步骤标注归档（零模型调用）：
 * 双后缀事故残留的7个review-source:*:revision-1:revision-1孤儿步骤（6成功+1被重置）
 * 不再参与任何恢复路径，按"不删除成功轨迹"原则标注归档留证，outbox事件记录。
 */
import { resolve } from 'node:path';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { StepArchiveRepository } from '../../apps/api/src/infrastructure/db/repositories/step-archive-repository.js';

const DB = '.local/eval/fast-close-runtime/data/database/wenmi.sqlite';
const RUN = 'c116818b-028d-4438-9bc6-2e4474155aaa';

function main(): void {
  const db = openDatabase(resolve(DB));
  const run = db.prepare('SELECT owner_id, book_id FROM tm2_design_runs WHERE id=?').get(RUN) as { owner_id: string; book_id: string };
  const scope = { ownerId: run.owner_id, bookId: run.book_id };
  const orphans = (db.prepare("SELECT id FROM tm2_steps WHERE owner=? AND book=? AND id LIKE '%:revision-1:revision-1' ORDER BY id").all(scope.ownerId, scope.bookId) as { id: string }[]).map(r => r.id);
  if (!orphans.length) { console.log('无双后缀孤儿步骤，无需处理'); db.close(); return; }
  const archiver = new StepArchiveRepository(db);
  for (const id of orphans) {
    archiver.archiveStep(scope, id, '事故B双后缀孤儿标注（bcf19a6a）：generate包装器与independentReview重复拼接后缀致缓存失效重发；该系列不再参与恢复，输出保留留证');
    console.log('已标注归档：', id.split(`${RUN}:`)[1]);
  }
  db.prepare("INSERT INTO tm2_outbox(owner,book,id,kind,body) VALUES(?,?,?,'eval.mark-double-suffix-orphans',?)")
    .run(scope.ownerId, scope.bookId, `${RUN}:mark-orphans:${Date.now()}`, JSON.stringify({ runId: RUN, marked: orphans, at: new Date().toISOString() }));
  console.log(`共标注归档${orphans.length}条，outbox事件在案`);
  db.close();
}
main();
