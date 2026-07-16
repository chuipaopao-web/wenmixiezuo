import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, fsyncSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { portableRelative, resolveInside, safeSegment, sha256File } from '../files/file-utils.js';

export interface StagedText {
  stagedRelativePath: string;
  contentHash: string;
  sizeBytes: number;
}

export interface PromotionRequest extends StagedText {
  operationId: string;
  fileId: string;
  chapterId: string;
  versionId: string;
}

export interface PromotionFaults {
  afterFilePromoted?(): void;
}

interface PromotionPayload extends PromotionRequest {
  targetRelativePath: string;
}

export class PromotionService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string,
    private readonly clock: Clock
  ) {}

  public stageText(taskId: string, content: string): StagedText {
    safeSegment(taskId, 'task_id');
    const contentBytes = Buffer.from(content, 'utf8');
    const contentHash = createHash('sha256').update(contentBytes).digest('hex');
    const stageDirectory = resolveInside(this.dataDir, `staging/${taskId}`);
    mkdirSync(stageDirectory, { recursive: true });
    const stagePath = resolve(stageDirectory, `${contentHash}.txt`);
    if (!existsSync(stagePath)) writeFileSync(stagePath, contentBytes, { flag: 'wx' });
    return {
      stagedRelativePath: portableRelative(this.dataDir, stagePath),
      contentHash,
      sizeBytes: contentBytes.byteLength
    };
  }

  public promote(scope: BookScope, request: PromotionRequest, faults: PromotionFaults = {}): void {
    assertBookScope(scope);
    for (const [value, label] of [[request.operationId, 'operation_id'], [request.fileId, 'file_id'], [request.chapterId, 'chapter_id'], [request.versionId, 'version_id']] as const) {
      safeSegment(value, label);
    }
    const stagedPath = resolveInside(this.dataDir, request.stagedRelativePath);
    if (!existsSync(stagedPath) || sha256File(stagedPath) !== request.contentHash || statSync(stagedPath).size !== request.sizeBytes) {
      throw new Error('暂存文件缺失或哈希不匹配');
    }
    const existingVersion = this.database.prepare(`
      SELECT file_id, content_hash FROM file_registry
      WHERE owner_id = ? AND book_id = ? AND version_id = ?
    `).get(scope.ownerId, scope.bookId, request.versionId) as { file_id: string; content_hash: string } | undefined;
    if (existingVersion !== undefined) {
      if (existingVersion.file_id === request.fileId && existingVersion.content_hash === request.contentHash) return;
      throw new Error('不可变版本已经登记，禁止覆盖');
    }
    const targetRelativePath = `books/${scope.bookId}/chapters/${request.chapterId}/${request.versionId}/${request.contentHash}.txt`;
    const payload: PromotionPayload = { ...request, targetRelativePath };
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      INSERT INTO operations (operation_id, owner_id, book_id, operation_type, status, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, 'promote_manuscript', 'working', ?, ?, ?)
      ON CONFLICT(operation_id) DO NOTHING
    `).run(request.operationId, scope.ownerId, scope.bookId, JSON.stringify(payload), now, now);
    const operation = this.database.prepare('SELECT owner_id, book_id, payload_json FROM operations WHERE operation_id = ?')
      .get(request.operationId) as { owner_id: string; book_id: string; payload_json: string };
    if (operation.owner_id !== scope.ownerId || operation.book_id !== scope.bookId || operation.payload_json !== JSON.stringify(payload)) {
      throw new Error('operation_id已被其他范围或不同载荷占用');
    }
    this.log(request.operationId, scope, 'copy_file', 'started', {});

    try {
      const targetPath = resolveInside(this.dataDir, targetRelativePath);
      mkdirSync(dirname(targetPath), { recursive: true });
      if (!existsSync(targetPath)) {
        const tempPath = `${targetPath}.${request.operationId}.tmp`;
        copyFileSync(stagedPath, tempPath);
        const descriptor = openSync(tempPath, 'r+');
        try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
        renameSync(tempPath, targetPath);
      }
      if (sha256File(targetPath) !== request.contentHash) throw new Error('目标文件哈希不匹配');
      this.log(request.operationId, scope, 'copy_file', 'completed', { targetRelativePath });
      faults.afterFilePromoted?.();
      this.register(scope, payload);
    } catch (error) {
      this.database.prepare("UPDATE operations SET status = 'incomplete', error_text = ?, updated_at = ? WHERE operation_id = ?")
        .run(error instanceof Error ? error.message : String(error), this.clock.now().toISOString(), request.operationId);
      this.log(request.operationId, scope, 'promotion', 'failed', { message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  public recover(scope: BookScope, operationId: string): void {
    assertBookScope(scope);
    const row = this.database.prepare(`
      SELECT payload_json FROM operations
      WHERE operation_id = ? AND owner_id = ? AND book_id = ? AND status = 'incomplete'
    `).get(operationId, scope.ownerId, scope.bookId) as { payload_json: string } | undefined;
    if (row === undefined) throw new Error('没有可恢复的提升操作');
    const payload = JSON.parse(row.payload_json) as PromotionPayload;
    const targetPath = resolveInside(this.dataDir, payload.targetRelativePath);
    if (!existsSync(targetPath) || sha256File(targetPath) !== payload.contentHash) {
      throw new Error('恢复目标文件缺失或哈希不匹配');
    }
    this.register(scope, payload);
  }

  private register(scope: BookScope, payload: PromotionPayload): void {
    const now = this.clock.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO file_registry (
          file_id, owner_id, book_id, chapter_id, version_id, relative_path,
          content_hash, size_bytes, status, operation_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(owner_id, book_id, version_id) DO NOTHING
      `).run(
        payload.fileId, scope.ownerId, scope.bookId, payload.chapterId, payload.versionId,
        payload.targetRelativePath, payload.contentHash, payload.sizeBytes, payload.operationId, now
      );
      this.database.prepare("UPDATE operations SET status = 'succeeded', error_text = NULL, updated_at = ? WHERE operation_id = ? AND owner_id = ? AND book_id = ?")
        .run(now, payload.operationId, scope.ownerId, scope.bookId);
      this.database.prepare(`
        INSERT INTO recovery_log (operation_id, owner_id, book_id, step, status, details_json, recorded_at)
        VALUES (?, ?, ?, 'register_file', 'completed', ?, ?)
      `).run(payload.operationId, scope.ownerId, scope.bookId, JSON.stringify({ fileId: payload.fileId }), now);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private log(operationId: string, scope: BookScope, step: string, status: 'started' | 'completed' | 'failed', details: object): void {
    this.database.prepare(`
      INSERT INTO recovery_log (operation_id, owner_id, book_id, step, status, details_json, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(operationId, scope.ownerId, scope.bookId, step, status, JSON.stringify(details), this.clock.now().toISOString());
  }
}
