/**
 * 导入后补齐脚本：为指定 book_id 入队正史索引重建（canon_index_request），并同步重建投影。
 *
 * 被排除的派生数据（content_chunks / context_packs / 向量 / 投影 / FTS）由生产既有流水线重建：
 *   worker 的 CanonIndexLoop 认领 pending 请求 -> CanonIndexService 建 chunk snapshot ->
 *   ProjectionLoop 重建 FTS + LanceDB 向量 + vector_index_manifests + projection_watermarks。
 *
 * 本脚本做三件事（每本一个原子事务）：
 *   1) 清掉随包导入的过期 content_chunks_fts（其 chunk_id 是本地旧 id）
 *   2) 入队一条当前修订的 pending canon_index_request（UNIQUE(owner,book,revision)）
 *   3) 同步调用 CanonService.rebuildProjections 重建叙事/关系/时间线投影
 *
 * 跳过 canon_revision < 1 的书（无已结算章节，无需索引）。
 *
 * 运行（线上，在 import 之后、确认 9 个新 book_id 后）：
 *   cd /opt/wenmi && sudo -u wenmi /usr/bin/node /opt/wenmi/node_modules/tsx/dist/cli.mjs \
 *     scripts/migrate-admin-books/enqueue-reindex.ts <bookId1> <bookId2> ...
 *   systemctl start wenmi-worker   # 若导入时停过，这里重启
 */
import { DatabaseSync } from 'node:sqlite';
import { CanonService } from '../../apps/api/src/application/knowledge/canon-service.js';
import { SystemClock, UuidGenerator } from '../../apps/api/src/domain/ids.js';
import { loadRuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';

const TARGET_OWNER = process.env.WENMI_TARGET_OWNER ?? '6838dc00-0b1c-45f2-8df9-2e6b754f1359';
const bookIds = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);

const config = loadRuntimeConfig();
const database = new DatabaseSync(config.databasePath);
database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 30000;');
const ids = new UuidGenerator();
const clock = new SystemClock();
const canon = new CanonService(database, ids, clock);

const enqueued: Array<Record<string, unknown>> = [];
for (const bookId of bookIds) {
  const book = database.prepare(`SELECT book_id, canon_revision, title FROM books WHERE owner_id = ? AND book_id = ?`)
    .get(TARGET_OWNER, bookId) as { book_id: string; canon_revision: number; title: string } | undefined;
  if (book === undefined) { process.stdout.write(`${JSON.stringify({ bookId, skip: 'not_found' })}\n`); continue; }
  if (book.canon_revision < 1) { process.stdout.write(`${JSON.stringify({ bookId, title: book.title, skip: 'no_settled_canon' })}\n`); continue; }

  const now = clock.now().toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    // 清掉随包导入的过期 FTS
    database.prepare(`DELETE FROM content_chunks_fts WHERE owner_id = ? AND book_id = ?`).run(TARGET_OWNER, bookId);
    // 入队当前修订的 pending 索引请求；source_chapter_id 取一条已结算章节以满足 FK
    database.prepare(`
      INSERT INTO canon_index_requests (canon_index_request_id, owner_id, book_id, canon_revision, source_chapter_id, status, attempts, available_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, chapter_id, 'pending', 0, ?, ?, ?
      FROM chapters WHERE owner_id = ? AND book_id = ? AND settlement_status = 'settled' ORDER BY chapter_number LIMIT 1
      ON CONFLICT(owner_id, book_id, canon_revision) DO UPDATE SET
        status = 'pending', attempts = 0, worker_id = NULL, claimed_at = NULL,
        available_at = excluded.available_at, error_code = NULL, updated_at = excluded.updated_at
    `).run(ids.next(), TARGET_OWNER, bookId, book.canon_revision, now, now, now, TARGET_OWNER, bookId);
    database.exec('COMMIT');
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    process.stdout.write(`${JSON.stringify({ bookId, title: book.title, enqueue: 'failed', error: String(error) })}\n`);
    continue;
  }

  try {
    canon.rebuildProjections({ ownerId: TARGET_OWNER, bookId });
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ bookId, title: book.title, projectionRebuild: 'failed', error: String(error) })}\n`);
  }
  enqueued.push({ bookId, title: book.title, canonRevision: book.canon_revision });
}
database.close();
process.stdout.write(`${JSON.stringify({ enqueued, count: enqueued.length }, null, 2)}\n`);
