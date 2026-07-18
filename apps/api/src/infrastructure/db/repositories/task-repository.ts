import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export class TaskRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public exists(scope: BookScope, taskId: string): boolean {
    assertBookScope(scope);
    return this.database.prepare('SELECT 1 FROM tasks WHERE owner_id = ? AND book_id = ? AND task_id = ?')
      .get(scope.ownerId, scope.bookId, taskId) !== undefined;
  }

  public checkpoint(scope: BookScope, taskId: string, checkpointJson: string, now: string): void {
    assertBookScope(scope);
    const result = this.database.prepare(`
      UPDATE tasks SET checkpoint_json = ?, updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND task_id = ?
    `).run(checkpointJson, now, scope.ownerId, scope.bookId, taskId);
    if (result.changes !== 1) throw new Error('任务不存在或越权');
  }
}
