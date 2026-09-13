/**
 * B1第三次返修worker夹具：真锁持有/竞争屏障。
 * 模式（第3参数mode）：
 *  - hold：BEGIN IMMEDIATE→插卡→发stdout 'LOCKED'→**阻塞等stdin一行再COMMIT**（主进程据此知道锁被持有）
 *  - try：直接createCard（在对方持锁时执行——busy/locked或排队后成功由SQLite决定）
 * 输出JSON行：{phase:'locked'|'done', ok?, displayCode?, internalId?, error?}
 * 退出码：hold=0（commit后）、try=0成功/1冲突类失败。
 */
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';
import { SqliteCreativeReferenceRepository } from '../../../apps/api/src/infrastructure/db/repositories/creative-reference-repository.js';
import { methodPayload } from './samples.js';

const [dbPath, idempotencyKey, mode] = process.argv.slice(2);
if (dbPath === undefined || idempotencyKey === undefined || mode === undefined) {
  console.error('usage: worker.mts <db> <key> <hold|try>');
  process.exit(64);
}
const database = new DatabaseSync(resolve(dbPath));
runMigrations(database, resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations'));
const repository = new SqliteCreativeReferenceRepository(database);
const NOW = '2026-09-13T00:00:00.000Z';
const input = await import('node:readline/promises');

try {
  if (mode === 'hold') {
    // 手动持锁窗口：事务内插卡后发LOCKED信号，等主进程回一行才提交释放。
    database.exec('BEGIN IMMEDIATE');
    const internalId = randomUUID();
    database.prepare(`INSERT INTO creative_reference_cards
      (internal_id, asset_kind, display_code, legacy_namespace, legacy_key, legacy_version, current_revision, status, idempotency_key, create_request_fingerprint, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(internalId, 'method', '法999', null, null, 0, 1, 'draft', idempotencyKey, 'hold-window', NOW, NOW);
    database.prepare(`INSERT INTO creative_reference_revisions
      (internal_id, revision, asset_kind, schema_version, payload_json, content_hash, display_code, short_phrase, summary, status, author_actor, review_actor, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(internalId, 1, 'method', 1, JSON.stringify(methodPayload()), 'hold', '法999', '持锁窗口', '持锁窗口卡', 'draft', 'worker-hold', null, NOW);
    process.stdout.write(JSON.stringify({ phase: 'locked', internalId }) + '\n');
    // 就绪信号后阻塞等释放指令（非固定sleep）。
    const rl = input.createInterface({ input: process.stdin });
    await rl.question('release?\n');
    rl.close();
    database.exec('COMMIT');
    // 事务内行作废：卡用专用idempotency key，正常路径不依赖它；保留法999占位不被后续分配（counter未动）。
    process.stdout.write(JSON.stringify({ phase: 'done', ok: true, internalId }) + '\n');
  } else {
    const card = await repository.createCard({ assetKind: 'method', payload: methodPayload(), legacy: null, idempotencyKey, authorActor: 'worker-try' }, NOW);
    process.stdout.write(JSON.stringify({ phase: 'done', ok: true, displayCode: card.displayCode, internalId: card.internalId }) + '\n');
  }
  database.close();
  process.exit(0);
} catch (error) {
  process.stdout.write(JSON.stringify({ phase: 'done', ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 160) }) + '\n');
  try { database.close(); } catch { /* 持锁失败路径 */ }
  process.exit(mode === 'try' ? 1 : 2);
}
