import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { RuntimeConfig } from '../runtime-config.js';
import { portableRelative, resolveInside, sha256File } from '../files/file-utils.js';

interface RegisteredFileRow {
  file_id: string;
  owner_id: string;
  book_id: string;
  relative_path: string;
  content_hash: string;
  size_bytes: number;
}

interface BackupFileManifest {
  fileId: string;
  ownerId: string;
  bookId: string;
  sourceRelativePath: string;
  backupRelativePath: string;
  contentHash: string;
  sizeBytes: number;
}

interface BackupManifest {
  backupId: string;
  releaseId: string;
  databaseHash: string;
  createdAt: string;
  files: BackupFileManifest[];
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export class BackupService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly config: RuntimeConfig
  ) {}

  public create(): { backupId: string; manifestHash: string; fileCount: number } {
    const backupId = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const backupRelativePath = `backups/${backupId}`;
    const backupRoot = resolveInside(this.config.dataDir, backupRelativePath);
    mkdirSync(backupRoot, { recursive: true });
    const databasePath = resolve(backupRoot, 'database.sqlite');
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO backups (backup_id, release_id, status, backup_path, created_at)
      VALUES (?, ?, 'creating', ?, ?)
    `).run(backupId, this.config.releaseId, backupRelativePath, now);

    try {
      this.database.exec(`VACUUM INTO ${sqlString(databasePath)}`);
      const rows = this.database.prepare(`
        SELECT file_id, owner_id, book_id, relative_path, content_hash, size_bytes
        FROM file_registry WHERE status IN ('active', 'archived') ORDER BY owner_id, book_id, file_id
      `).all() as unknown as RegisteredFileRow[];
      const files: BackupFileManifest[] = [];
      for (const row of rows) {
        const sourcePath = resolveInside(this.config.dataDir, row.relative_path);
        if (!existsSync(sourcePath) || sha256File(sourcePath) !== row.content_hash) {
          throw new Error(`备份源文件缺失或哈希不匹配：${row.file_id}`);
        }
        const backupFileRelative = `files/${row.owner_id}/${row.book_id}/${row.file_id}`;
        const backupFilePath = resolve(backupRoot, backupFileRelative);
        mkdirSync(dirname(backupFilePath), { recursive: true });
        copyFileSync(sourcePath, backupFilePath);
        files.push({
          fileId: row.file_id,
          ownerId: row.owner_id,
          bookId: row.book_id,
          sourceRelativePath: row.relative_path,
          backupRelativePath: backupFileRelative.replaceAll('\\', '/'),
          contentHash: row.content_hash,
          sizeBytes: row.size_bytes
        });
      }
      const manifest: BackupManifest = {
        backupId,
        releaseId: this.config.releaseId,
        databaseHash: sha256File(databasePath),
        createdAt: now,
        files
      };
      const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
      const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
      writeFileSync(resolve(backupRoot, 'manifest.json'), manifestBytes, { flag: 'wx' });
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const insert = this.database.prepare(`
          INSERT INTO backup_files (
            backup_id, file_id, owner_id, book_id, source_relative_path,
            backup_relative_path, content_hash, size_bytes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const file of files) {
          insert.run(backupId, file.fileId, file.ownerId, file.bookId, file.sourceRelativePath, file.backupRelativePath, file.contentHash, file.sizeBytes);
        }
        this.database.prepare(`
          UPDATE backups SET status = 'complete', database_hash = ?, manifest_hash = ?, file_count = ?
          WHERE backup_id = ?
        `).run(manifest.databaseHash, manifestHash, files.length, backupId);
        this.database.exec('COMMIT');
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
      return { backupId, manifestHash, fileCount: files.length };
    } catch (error) {
      this.database.prepare("UPDATE backups SET status = 'invalid', verification_json = ? WHERE backup_id = ?")
        .run(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), backupId);
      rmSync(backupRoot, { force: true, recursive: true });
      throw error;
    }
  }

  public verify(backupId: string): { verified: true; databaseHash: string; fileCount: number; restorePath: string } {
    const row = this.database.prepare(`
      SELECT backup_path, database_hash, manifest_hash, file_count, status FROM backups
      WHERE backup_id = ? AND status IN ('creating', 'complete', 'verified')
    `).get(backupId) as {
      backup_path: string; database_hash: string | null; manifest_hash: string | null; file_count: number; status: string;
    } | undefined;
    if (row === undefined) throw new Error('备份不存在或尚未完成');
    const backupRoot = resolveInside(this.config.dataDir, row.backup_path);
    const manifestPath = resolve(backupRoot, 'manifest.json');
    const manifestBytes = readFileSync(manifestPath);
    const actualManifestHash = createHash('sha256').update(manifestBytes).digest('hex');
    if (row.manifest_hash !== null && actualManifestHash !== row.manifest_hash) throw new Error('备份清单哈希不匹配');
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as BackupManifest;
    if (manifest.backupId !== backupId || manifest.releaseId !== this.config.releaseId) throw new Error('备份清单身份或release不匹配');
    const sourceDatabase = resolve(backupRoot, 'database.sqlite');
    const expectedDatabaseHash = row.database_hash ?? manifest.databaseHash;
    if (sha256File(sourceDatabase) !== expectedDatabaseHash || manifest.databaseHash !== expectedDatabaseHash) throw new Error('备份数据库哈希不匹配');

    const restoreRoot = resolveInside(this.config.dataDir, `quarantine/restore-${backupId}-${randomUUID().slice(0, 8)}`);
    mkdirSync(restoreRoot, { recursive: true });
    const restoredDatabasePath = resolve(restoreRoot, 'database.sqlite');
    copyFileSync(sourceDatabase, restoredDatabasePath);
    if (sha256File(restoredDatabasePath) !== expectedDatabaseHash) throw new Error('恢复数据库副本哈希不匹配');
    for (const file of manifest.files) {
      const sourcePath = resolve(backupRoot, file.backupRelativePath);
      if (!existsSync(sourcePath) || sha256File(sourcePath) !== file.contentHash || statSync(sourcePath).size !== file.sizeBytes) {
        throw new Error(`备份文件校验失败：${file.fileId}`);
      }
      const restoredPath = resolve(restoreRoot, file.sourceRelativePath);
      mkdirSync(dirname(restoredPath), { recursive: true });
      copyFileSync(sourcePath, restoredPath);
      if (sha256File(restoredPath) !== file.contentHash || statSync(restoredPath).size !== file.sizeBytes) {
        throw new Error(`恢复文件校验失败：${file.fileId}`);
      }
    }
    const restored = new DatabaseSync(restoredDatabasePath, { readOnly: true });
    try {
      restored.exec('PRAGMA foreign_keys = ON');
      const integrity = restored.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      const foreignKeys = restored.prepare('PRAGMA foreign_key_check').all();
      if (integrity.integrity_check !== 'ok' || foreignKeys.length !== 0) throw new Error('恢复数据库完整性或外键检查失败');
      const tombstones = this.database.prepare('SELECT owner_id, deleted_book_id FROM deletion_tombstones').all() as unknown as Array<{ owner_id: string; deleted_book_id: string }>;
      const restoredTables = restored.prepare(
        `SELECT name FROM pragma_table_list WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
      ).all() as unknown as Array<{ name: string }>;
      const scopedTables = restoredTables.filter(({ name }) => {
          const columns = restored.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all() as unknown as Array<{ name: string }>;
          const names = new Set(columns.map((column) => column.name));
          return names.has('owner_id') && names.has('book_id');
        });
      for (const tombstone of tombstones) {
        for (const table of scopedTables) {
          const resurrected = restored.prepare(`SELECT 1 FROM ${quoteIdentifier(table.name)} WHERE owner_id = ? AND book_id = ? LIMIT 1`)
            .get(tombstone.owner_id, tombstone.deleted_book_id);
          if (resurrected !== undefined) throw new Error(`删除墓碑禁止备份复活书籍：${tombstone.deleted_book_id}/${table.name}`);
        }
      }
    } finally {
      restored.close();
    }
    const verification = {
      verified: true as const,
      databaseHash: expectedDatabaseHash,
      fileCount: manifest.files.length,
      restorePath: portableRelative(this.config.dataDir, restoreRoot)
    };
    this.database.prepare(`
      UPDATE backups SET status = 'verified', database_hash = ?, manifest_hash = ?, file_count = ?,
        verified_at = ?, verification_json = ? WHERE backup_id = ?
    `).run(expectedDatabaseHash, actualManifestHash, manifest.files.length,
      new Date().toISOString(), JSON.stringify(verification), backupId);
    return verification;
  }

  public discardVerification(restoreRelativePath: string): void {
    const path = resolveInside(this.config.dataDir, restoreRelativePath);
    rmSync(path, { force: true, recursive: true });
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
