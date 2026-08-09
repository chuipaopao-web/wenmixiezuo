import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, assertOwnerScope, type BookScope, type OwnerScope } from '../../domain/scope.js';
import { portableRelative, resolveInside } from '../../infrastructure/files/file-utils.js';
import type { RuntimeConfig } from '../../infrastructure/runtime-config.js';
import { BookPortabilityRepository } from '../../infrastructure/db/repositories/book-portability-repository.js';

const FORMAT = 'wenmi-book';
const FORMAT_VERSION = 1;
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
const excludedTables = new Set([
  'portable_operations', 'portable_manifests', 'portable_files', 'import_quarantine_checks', 'restore_impact_reports',
  'content_chunks', 'chunk_snapshot_items', 'chunk_projection_snapshots', 'chunk_projection_watermarks',
  'embedding_model_snapshots', 'embedding_vector_manifest', 'vector_projection_jobs', 'vector_projection_watermarks',
  'retrieval_query_plans', 'retrieval_channel_runs', 'retrieval_fusion_runs', 'retrieval_results',
  'context_packs', 'context_pack_items', 'context_pack_dependencies', 'narrative_projections', 'relationship_projection'
]);

interface PortableFile {
  sourceFileId: string;
  relativePath: string;
  mediaType: string;
  contentHash: string;
  byteCount: number;
  base64: string;
}

interface PortablePackageCore {
  format: typeof FORMAT;
  formatVersion: number;
  schemaVersion: number;
  releaseId: string;
  sourceBookId: string;
  sourceTitle: string;
  exportedAt: string;
  tables: Record<string, Array<Record<string, unknown>>>;
  files: PortableFile[];
}

interface PortablePackage extends PortablePackageCore { manifestHash: string }

export class BookPortabilityService {
  private readonly repository: BookPortabilityRepository;

  public constructor(
    database: DatabaseSync,
    private readonly config: RuntimeConfig,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.repository = new BookPortabilityRepository(database);
  }

  public exportBook(scope: BookScope): { operationId: string; packageName: string; packagePath: string; manifestHash: string; rowCount: number; fileCount: number; byteCount: number } {
    assertBookScope(scope);
    const bookTitle = this.repository.bookTitle(scope);
    if (bookTitle === null) throw new Error('待导出的书籍不存在或越权');
    const operationId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.repository.insertOperation({ id: operationId, ownerId: scope.ownerId, bookId: scope.bookId, type: 'export', status: 'preparing', packageName: null, sourceBookId: scope.bookId, targetBookId: null, summary: {}, now });
    try {
      const tables: PortablePackageCore['tables'] = {};
      for (const table of this.repository.bookScopedTables(excludedTables)) {
        tables[table] = this.repository.rows(scope, table);
      }
      const files = this.collectFiles(tables.file_registry ?? []);
      const core: PortablePackageCore = {
        format: FORMAT,
        formatVersion: FORMAT_VERSION,
        schemaVersion: this.repository.schemaVersion(),
        releaseId: this.config.releaseId,
        sourceBookId: scope.bookId,
        sourceTitle: bookTitle,
        exportedAt: now,
        tables,
        files
      };
      const manifestHash = hashJson(core);
      const portable: PortablePackage = { ...core, manifestHash };
      const payload = JSON.stringify(portable);
      if (Buffer.byteLength(payload) > MAX_PACKAGE_BYTES) throw new Error('可移植包超过256MB安全上限');
      const packageName = `${safeFileStem(bookTitle)}-${scope.bookId.slice(0, 8)}.wenmi-book`;
      const exportDir = resolve(this.config.dataDir, 'exports');
      mkdirSync(exportDir, { recursive: true });
      const packagePath = resolveInside(exportDir, packageName);
      writeFileSync(packagePath, payload, { encoding: 'utf8', flag: 'wx' });
      const rowCount = Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
      const byteCount = files.reduce((sum, file) => sum + file.byteCount, 0);
      this.repository.recordManifest({
        manifestId: this.ids.next(), operationId, scope, formatVersion: FORMAT_VERSION, schemaVersion: this.repository.schemaVersion(),
        hash: manifestHash, tableCount: Object.keys(tables).length, rowCount,
        files: files.map((file) => ({ portableFileId: this.ids.next(), ...file })), byteCount, now
      });
      this.repository.completeExportOperation(operationId, packageName, { manifestHash, rowCount, fileCount: files.length, byteCount }, now);
      return { operationId, packageName, packagePath, manifestHash, rowCount, fileCount: files.length, byteCount };
    } catch (error) {
      this.failOperation(operationId, error);
      throw error;
    }
  }

  public importCopy(scope: OwnerScope, packageName: string): { operationId: string; bookId: string; title: string; sourceBookId: string; manifestHash: string; importedRows: number; importedFiles: number } {
    assertOwnerScope(scope);
    if (!/^[^\\/:*?"<>|]{1,180}\.wenmi-book$/u.test(packageName)) throw new Error('导入包文件名无效');
    const path = resolveInside(resolve(this.config.dataDir, 'imports'), packageName);
    const stats = statSync(path);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_PACKAGE_BYTES) throw new Error('导入包为空、不是文件或超过256MB');
    const operationId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.repository.insertOperation({ id: operationId, ownerId: scope.ownerId, bookId: null, type: 'copy_import', status: 'preparing', packageName, sourceBookId: null, targetBookId: null, summary: {}, now });
    const writtenPaths: string[] = [];
    try {
      const raw = readFileSync(path, 'utf8');
      this.assertNoSecretMaterial(raw);
      const portable = JSON.parse(raw) as PortablePackage;
      this.validatePackage(operationId, portable, now);
      const currentSchema = this.repository.schemaVersion();
      if (portable.schemaVersion > currentSchema) throw new Error(`导入包Schema ${portable.schemaVersion}高于本机Schema ${currentSchema}`);
      const allowedTables = new Set(this.repository.bookScopedTables(excludedTables));
      for (const table of Object.keys(portable.tables)) if (!allowedTables.has(table)) throw new Error(`导入包包含不允许的表：${table}`);
      const newBookId = this.ids.next();
      const idMap = this.buildIdMap(portable.tables, portable.sourceBookId, newBookId);
      const imported = this.rewriteRows(portable, scope.ownerId, newBookId, idMap, writtenPaths);
      this.repository.importRowsAtomically({
        operationId, newBookId, sourceBookId: portable.sourceBookId, manifestHash: portable.manifestHash,
        importedRows: imported.rowCount, importedFiles: portable.files.length, tables: imported.tables, now
      });
      const title = String((imported.tables.books![0]!).title);
      return { operationId, bookId: newBookId, title, sourceBookId: portable.sourceBookId, manifestHash: portable.manifestHash, importedRows: imported.rowCount, importedFiles: portable.files.length };
    } catch (error) {
      for (const written of writtenPaths) rmSync(written, { force: true });
      this.failOperation(operationId, error);
      throw error;
    }
  }

  public listOperations(ownerId: string): unknown[] {
    return this.repository.listOperations(ownerId);
  }

  private collectFiles(rows: Array<Record<string, unknown>>): PortableFile[] {
    const files: PortableFile[] = [];
    for (const row of rows) {
      if (row.status !== 'active' || typeof row.relative_path !== 'string' || typeof row.file_id !== 'string') continue;
      const path = resolveInside(this.config.dataDir, row.relative_path);
      const buffer = readFileSync(path);
      const contentHash = createHash('sha256').update(buffer).digest('hex');
      if (typeof row.content_hash === 'string' && row.content_hash !== contentHash) throw new Error(`文件哈希不一致：${row.relative_path}`);
      files.push({ sourceFileId: row.file_id, relativePath: row.relative_path, mediaType: String(row.media_type ?? 'application/octet-stream'), contentHash, byteCount: buffer.byteLength, base64: buffer.toString('base64') });
    }
    return files;
  }

  private validatePackage(operationId: string, portable: PortablePackage, now: string): void {
    const checks: Array<[string, boolean, Record<string, unknown>]> = [
      ['format', portable.format === FORMAT && portable.formatVersion === FORMAT_VERSION, { format: portable.format, version: portable.formatVersion }],
      ['manifest_hash', typeof portable.manifestHash === 'string' && portable.manifestHash === hashJson(withoutManifest(portable)), { expected: portable.manifestHash }],
      ['table_shape', isRecord(portable.tables) && Array.isArray(portable.files), { tableCount: isRecord(portable.tables) ? Object.keys(portable.tables).length : 0 }],
      ['source_identity', typeof portable.sourceBookId === 'string' && typeof portable.sourceTitle === 'string', { sourceBookId: portable.sourceBookId }]
    ];
    for (const [key, passed, details] of checks) {
      this.repository.recordQuarantineCheck({ id: this.ids.next(), operationId, key, passed, details, now });
      if (!passed) throw new Error(`导入隔离检查失败：${key}`);
    }
    for (const file of portable.files) {
      const buffer = Buffer.from(file.base64, 'base64');
      if (buffer.byteLength !== file.byteCount || createHash('sha256').update(buffer).digest('hex') !== file.contentHash) {
        throw new Error(`导入文件哈希或长度无效：${file.relativePath}`);
      }
    }
  }

  private buildIdMap(tables: PortablePackageCore['tables'], oldBookId: string, newBookId: string): Map<string, string> {
    const map = new Map<string, string>([[oldBookId, newBookId]]);
    for (const [table, rows] of Object.entries(tables)) {
      const primaryKey = this.repository.columns(table).filter((column) => column.pk > 0);
      const idColumns = primaryKey.length === 1
        ? primaryKey.filter((column) => column.name.endsWith('_id') && !['owner_id', 'book_id'].includes(column.name))
        : [];
      for (const row of rows) for (const column of idColumns) {
        const value = row[column.name];
        if (typeof value === 'string' && !map.has(value)) map.set(value, this.ids.next());
      }
    }
    return map;
  }

  private rewriteRows(portable: PortablePackage, ownerId: string, newBookId: string, idMap: Map<string, string>, writtenPaths: string[]): { tables: PortablePackageCore['tables']; rowCount: number } {
    const fileById = new Map(portable.files.map((file) => [file.sourceFileId, file]));
    const rewritten: PortablePackageCore['tables'] = {};
    let rowCount = 0;
    for (const [table, rows] of Object.entries(portable.tables)) {
      rewritten[table] = rows.map((source) => {
        const row: Record<string, unknown> = {};
        for (const [column, value] of Object.entries(source)) {
          if (column === 'owner_id') row[column] = ownerId;
          else if (column === 'book_id') row[column] = newBookId;
          else if (column === 'release_id') row[column] = this.config.releaseId;
          else if (column === 'source_draft_id') row[column] = null;
          else if (column.endsWith('_json') && typeof value === 'string') row[column] = rewriteJsonText(value, idMap);
          else row[column] = typeof value === 'string' ? idMap.get(value) ?? value : value;
        }
        if (table === 'tasks' && ['pending', 'queued', 'working', 'waiting_confirmation', 'paused', 'blocked', 'interrupted'].includes(String(row.status))) {
          row.status = 'cancelled'; row.cancel_requested = 1; row.lease_owner = null; row.lease_expires_at = null; row.heartbeat_at = null;
        }
        if (table === 'file_registry' && typeof source.file_id === 'string') {
          const portableFile = fileById.get(source.file_id);
          if (portableFile !== undefined) {
            const targetId = String(row.file_id);
            const relativePath = `portable/${newBookId}/${targetId}${safeExtension(portableFile.relativePath)}`;
            const target = resolveInside(this.config.dataDir, relativePath);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, Buffer.from(portableFile.base64, 'base64'), { flag: 'wx' });
            writtenPaths.push(target);
            row.relative_path = portableRelative(this.config.dataDir, target);
          }
        }
        return row;
      });
      rowCount += rows.length;
    }
    return { tables: rewritten, rowCount };
  }

  private failOperation(operationId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.repository.failOperation(operationId, message, this.clock.now().toISOString());
  }

  private assertNoSecretMaterial(raw: string): void {
    if (/(?:sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|"api[_-]?key"\s*:)/iu.test(raw)) {
      throw new Error('导入包疑似包含API Key或访问令牌，已拒绝');
    }
  }

}

function hashJson(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function withoutManifest(value: PortablePackage): PortablePackageCore { const { manifestHash: _ignored, ...core } = value; return core; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function safeFileStem(value: string): string { return value.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_').trim().slice(0, 48) || '未命名书籍'; }
function safeExtension(path: string): string { const extension = extname(path).toLowerCase(); return /^\.[a-z0-9]{1,8}$/u.test(extension) ? extension : '.bin'; }
function rewriteJsonText(value: string, map: Map<string, string>): string {
  const rewrite = (input: unknown): unknown => Array.isArray(input)
    ? input.map(rewrite)
    : isRecord(input)
      ? Object.fromEntries(Object.entries(input).map(([key, item]) => [key, rewrite(item)]))
      : typeof input === 'string' ? map.get(input) ?? input : input;
  try { return JSON.stringify(rewrite(JSON.parse(value) as unknown)); } catch { throw new Error('导入包包含无效JSON字段'); }
}
