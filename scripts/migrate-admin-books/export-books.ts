/**
 * 本地导出 9 本管理员测试书为 .wenmi-book 包（自研导出器，精确复刻 exportBook 包格式）。
 *
 * 为什么不用 service.exportBook 直接导：
 *   1) exportBook 在构建完整包后、写文件前检查 256MB 上限。`烬脉天衡` 裸包 278MB（其中
 *      retrieval_candidates 单表 177MB）会直接抛错，无法导出后再删表。
 *   2) 因此这里在【源头】排除大体积派生/缓存表，包体压到 <120MB。
 *
 * 排除的表（8 张 FK 破坏表 + vector_index_manifests）：
 *   - backup_files            FK->backups（全局）
 *   - chunk_entities          FK->content_chunks（被排除）
 *   - retrieval_candidates/context_selections/drilldowns/evidence_checks/evidence_clusters
 *                            FK->retrieval_query_plans（被排除）
 *   - retrieval_records       检索遥测
 *   - vector_index_manifests  派生索引清单，FK->embedding_model_snapshots(全局)；其本地
 *                             local_path 指向本机模型文件，不能带进线上（可能破坏线上嵌入模型解析）。
 *                             re-index 会用线上已验证的模型重建它。
 *
 * 保留 chunk_snapshots/chunk_snapshot_memberships/content_chunks_fts 等快照图：
 *   importCopy 的 buildIdMap 会把它们和引用表的 id 一起重映射，保持内部一致。
 *
 * 另外把 chapter_pipeline_runs.context_pack_id 置 null（FK->context_packs 被排除，importCopy
 * 不处理该列）。
 *
 * 生成 global-preflight.json：9 本书引用的 classification_tags 行（导入前 INSERT OR IGNORE）。
 *
 * 运行（在 D:\wenmixiezuo 下）：
 *   Remove-Item D:\wenmixiezuo\data\exports\*.wenmi-book -ErrorAction SilentlyContinue
 *   npx tsx scripts/migrate-admin-books/export-books.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BookPortabilityRepository } from '../../apps/api/src/infrastructure/db/repositories/book-portability-repository.js';
import { resolveInside } from '../../apps/api/src/infrastructure/files/file-utils.js';
import { loadRuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';

const FORMAT = 'wenmi-book';
const FORMAT_VERSION = 1;
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;

const hashJson = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');

// 与 book-portability-service.ts 的 excludedTables 完全一致
const BASE_EXCLUDED = new Set([
  'portable_operations', 'portable_manifests', 'portable_files', 'import_quarantine_checks', 'restore_impact_reports',
  'content_chunks', 'chunk_snapshot_items', 'chunk_projection_snapshots', 'chunk_projection_watermarks',
  'embedding_model_snapshots', 'embedding_vector_manifest', 'vector_projection_jobs', 'vector_projection_watermarks',
  'retrieval_query_plans', 'retrieval_channel_runs', 'retrieval_fusion_runs', 'retrieval_results',
  'context_packs', 'context_pack_items', 'context_pack_dependencies', 'narrative_projections', 'relationship_projection'
]);

// 额外排除的表（从源头剔除，避免 exportBook 的 256MB 检查触发）
const EXTRA_EXCLUDED = new Set([
  'backup_files',
  'chunk_entities',
  'retrieval_candidates',
  'retrieval_context_selections',
  'retrieval_drilldowns',
  'retrieval_evidence_checks',
  'retrieval_evidence_clusters',
  'retrieval_records',
  'vector_index_manifests'
]);

const FINAL_EXCLUDED = new Set([...BASE_EXCLUDED, ...EXTRA_EXCLUDED]);

const safeStem = (title: string): string => title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);

const config = loadRuntimeConfig();
const database = new DatabaseSync(config.databasePath);
database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 30000;');
const repo = new BookPortabilityRepository(database);

const OWNER = config.ownerId;
const books = database.prepare(
  `SELECT book_id, title FROM books WHERE owner_id = ? AND archived_at IS NULL ORDER BY title`
).all(OWNER) as Array<{ book_id: string; title: string }>;
if (books.length !== 9) throw new Error(`预期 9 本，实际 ${books.length}，中止`);

const exportDir = resolve(config.dataDir, 'exports');
mkdirSync(exportDir, { recursive: true });

const results: Array<Record<string, unknown>> = [];
for (const book of books) {
  const scope = { ownerId: OWNER, bookId: book.book_id };
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  let rowCount = 0;
  for (const table of repo.bookScopedTables(FINAL_EXCLUDED)) {
    const rows = repo.rows(scope, table);
    if (rows.length === 0) continue;
    tables[table] = rows;
    rowCount += rows.length;
  }

  // context_pack_id：FK->context_packs（被排除），importCopy 不处理该列，必须置空
  if (Array.isArray(tables.chapter_pipeline_runs)) {
    for (const row of tables.chapter_pipeline_runs) row.context_pack_id = null;
  }

  // collectFiles（与 exportBook 一致：active 文件 -> base64 + 哈希校验）
  const files: Array<Record<string, unknown>> = [];
  let byteCount = 0;
  for (const row of tables.file_registry ?? []) {
    if (row.status !== 'active' || typeof row.relative_path !== 'string' || typeof row.file_id !== 'string') continue;
    const path = resolveInside(config.dataDir, row.relative_path);
    const buffer = readFileSync(path);
    const contentHash = createHash('sha256').update(buffer).digest('hex');
    if (typeof row.content_hash === 'string' && row.content_hash !== contentHash) {
      throw new Error(`文件哈希不一致：${row.relative_path}`);
    }
    const portable = {
      sourceFileId: row.file_id,
      relativePath: row.relative_path,
      mediaType: String(row.media_type ?? 'application/octet-stream'),
      contentHash,
      byteCount: buffer.byteLength,
      base64: buffer.toString('base64')
    };
    files.push(portable);
    byteCount += buffer.byteLength;
  }

  const core = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    schemaVersion: repo.schemaVersion(),
    releaseId: config.releaseId,
    sourceBookId: book.book_id,
    sourceTitle: book.title,
    exportedAt: new Date().toISOString(),
    tables,
    files
  };
  const payload = JSON.stringify({ ...core, manifestHash: hashJson(core) });
  const size = Buffer.byteLength(payload);
  if (size > MAX_PACKAGE_BYTES) throw new Error(`${book.title} 包 ${(size / 1048576).toFixed(1)}MB 超过 256MB 上限`);

  const packageName = `${safeStem(book.title)}-${book.book_id.slice(0, 8)}.wenmi-book`;
  const packagePath = resolve(exportDir, packageName);
  writeFileSync(packagePath, payload, { encoding: 'utf8', flag: 'wx' });

  results.push({ title: book.title, bookId: book.book_id, packageName, sizeMB: Number((size / 1048576).toFixed(1)), rowCount, fileCount: files.length, byteCount, tableCount: Object.keys(tables).length });
}

// global-preflight.json：9 本书引用的 classification_tags 行（导入前 INSERT OR IGNORE）
const tagIds = (database.prepare(`
  SELECT DISTINCT ptb.tag_id FROM positioning_tag_bindings ptb
  JOIN books b ON b.owner_id = ptb.owner_id AND b.book_id = ptb.book_id
  WHERE ptb.owner_id = ? AND b.archived_at IS NULL
`).all(OWNER) as Array<{ tag_id: string }>).map((r) => r.tag_id);
const pre = {
  classification_tags: tagIds.length
    ? database.prepare(`SELECT * FROM classification_tags WHERE tag_id IN (${tagIds.map(() => '?').join(',')})`).all(...tagIds)
    : []
};
writeFileSync(resolve(exportDir, 'global-preflight.json'), JSON.stringify(pre, null, 2));

database.close();
process.stdout.write(`${JSON.stringify({ packageCount: results.length, preflightTags: pre.classification_tags.length, results }, null, 2)}\n`);
