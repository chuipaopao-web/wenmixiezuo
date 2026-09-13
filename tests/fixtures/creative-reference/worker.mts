/**
 * B1第二次返修worker夹具：独立进程内开连接持锁执行编号分配，
 * 主进程同步尝试同库写入——保证至少一方真实持锁、另一方竞争（真进程级重叠证据）。
 * 用法：node worker.mts <db-path> <idempotency-key> <mode>
 * mode=hold-release：BEGIN IMMEDIATE→插卡→sleep 350ms→COMMIT（持锁窗口）
 * 输出JSON：{ok, displayCode?, error?}
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';
import { SqliteCreativeReferenceRepository } from '../../../apps/api/src/infrastructure/db/repositories/creative-reference-repository.js';
import { methodPayload } from '../creative-reference/samples.js';

const [dbPath, idempotencyKey] = process.argv.slice(2);
if (dbPath === undefined || idempotencyKey === undefined) { console.error('usage: worker.mts <db> <key>'); process.exit(64); }
const database = new DatabaseSync(resolve(dbPath));
runMigrations(database, resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations'));
const repository = new SqliteCreativeReferenceRepository(database);
const NOW = '2026-09-13T00:00:00.000Z';
try {
  const card = await repository.createCard({ assetKind: 'method', payload: methodPayload(), legacy: null, idempotencyKey, authorActor: 'worker' }, NOW);
  console.log(JSON.stringify({ ok: true, displayCode: card.displayCode, internalId: card.internalId }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 120) }));
} finally {
  database.close();
}
