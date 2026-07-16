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
      throw error;
    }
  }

  public verify(backupId: string): { verified: true; databaseHash: string; fileCount: number; restorePath: string } {
    const row = this.database.prepare(`
      SELECT backup_path, database_hash, manifest_hash, file_count FROM backups
      WHERE backup_id = ? AND status IN ('complete', 'verified')
    `).get(backupId) as { backup_path: string; database_hash: string; manifest_hash: string; file_count: number } | undefined;
    if (row === undefined) throw new Error('备份不存在或尚未完成');
    const backupRoot = resolveInside(this.config.dataDir, row.backup_path);
    const manifestPath = resolve(backupRoot, 'manifest.json');
    const manifestBytes = readFileSync(manifestPath);
    if (createHash('sha256').update(manifestBytes).digest('hex') !== row.manifest_hash) throw new Error('备份清单哈希不匹配');
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as BackupManifest;
    const sourceDatabase = resolve(backupRoot, 'database.sqlite');
    if (sha256File(sourceDatabase) !== row.database_hash || manifest.databaseHash !== row.database_hash) throw new Error('备份数据库哈希不匹配');

    const restoreRoot = resolveInside(this.config.dataDir, `quarantine/restore-${backupId}-${randomUUID().slice(0, 8)}`);
    mkdirSync(restoreRoot, { recursive: true });
    const restoredDatabasePath = resolve(restoreRoot, 'database.sqlite');
    copyFileSync(sourceDatabase, restoredDatabasePath);
    for (const file of manifest.files) {
      const sourcePath = resolve(backupRoot, file.backupRelativePath);
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
      for (const tombstone of tombstones) {
        const resurrected = restored.prepare('SELECT 1 FROM books WHERE owner_id = ? AND book_id = ?')
          .get(tombstone.owner_id, tombstone.deleted_book_id);
        if (resurrected !== undefined) throw new Error(`删除墓碑禁止备份复活书籍：${tombstone.deleted_book_id}`);
      }
    } finally {
      restored.close();
    }
    const verification = {
      verified: true as const,
      databaseHash: sha256File(restoredDatabasePath),
      fileCount: manifest.files.length,
      restorePath: portableRelative(this.config.dataDir, restoreRoot)
    };
    this.database.prepare(`
      UPDATE backups SET status = 'verified', verified_at = ?, verification_json = ? WHERE backup_id = ?
    `).run(new Date().toISOString(), JSON.stringify(verification), backupId);
    return verification;
  }

  public discardVerification(restoreRelativePath: string): void {
    const path = resolveInside(this.config.dataDir, restoreRelativePath);
    rmSync(path, { force: true, recursive: true });
  }
}
