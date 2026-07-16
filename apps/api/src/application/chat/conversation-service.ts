import type { DatabaseSync } from 'node:sqlite';
import { ChapterBatchService } from '../creation/chapter-batch-service.js';
import { TaskService } from '../tasks/task-service.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';

export class ConversationService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public listMessages(scope: BookScope): unknown[] {
    const conversationId = this.requireConversation(scope);
    return this.database.prepare(`
      SELECT message_id, sender_type, sender_agent_id, role_key, model_provider,
        model_id, message_type, content, references_json, created_at
      FROM messages WHERE conversation_id = ? AND owner_id = ? AND book_id = ?
      ORDER BY created_at, message_id
    `).all(conversationId, scope.ownerId, scope.bookId);
  }

  public sendBossMessage(scope: BookScope, content: string): { messageId: string; action: Record<string, unknown> } {
    assertBookScope(scope);
    const trimmed = content.trim();
    if (trimmed.length === 0 || trimmed.length > 20_000) throw new Error('消息长度必须在1至20000字符之间');
    const conversationId = this.requireConversation(scope);
    const messageId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      INSERT INTO messages (
        message_id, conversation_id, owner_id, book_id, sender_type,
        message_type, content, references_json, created_at
      ) VALUES (?, ?, ?, ?, 'boss', 'text', ?, '[]', ?)
    `).run(messageId, conversationId, scope.ownerId, scope.bookId, trimmed, now);
    this.database.prepare(`UPDATE conversations SET updated_at = ? WHERE conversation_id = ?`).run(now, conversationId);
    const action = this.executeDeterministicCommand(scope, trimmed);
    if (action.kind === 'message_saved') {
      this.addSystemMessage(scope, conversationId, '消息已保存。当前使用确定性离线适配器，不会把开放式创作对话伪装成真实模型回复。你可以使用“写一章”“写3章”“暂停”“继续”或“取消”等明确命令。');
    }
    return { messageId, action };
  }

  private executeDeterministicCommand(scope: BookScope, content: string): Record<string, unknown> {
    const write = /^写([一1]|[三3]|[四4]|[五5])章$/u.exec(content);
    if (write !== null) {
      const countMap: Record<string, 1 | 3 | 4 | 5> = { 一: 1, '1': 1, 三: 3, '3': 3, 四: 4, '4': 4, 五: 5, '5': 5 };
      const count = countMap[write[1]!]!;
      const batch = new ChapterBatchService(this.database, this.dataDir, this.releaseId, this.ids, this.clock).scheduleNewChapters(scope, count);
      return { kind: 'chapter_batch_scheduled', batchId: batch.batchId, count };
    }
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    if (content === '暂停') {
      const working = tasks.list(scope).filter((task) => task.status === 'working');
      for (const task of working) tasks.requestPause(scope, task.taskId);
      return { kind: 'pause_requested', taskIds: working.map((task) => task.taskId) };
    }
    if (content === '继续') {
      const paused = tasks.list(scope).filter((task) => task.status === 'paused');
      for (const task of paused) tasks.queue(scope, task.taskId);
      return { kind: 'tasks_resumed', taskIds: paused.map((task) => task.taskId) };
    }
    if (content === '取消') {
      const cancellable = tasks.list(scope).filter((task) => ['pending', 'queued', 'working', 'paused', 'blocked'].includes(task.status));
      for (const task of cancellable) tasks.requestCancel(scope, task.taskId);
      return { kind: 'cancel_requested', taskIds: cancellable.map((task) => task.taskId) };
    }
    return { kind: 'message_saved', modelCalled: false };
  }

  private addSystemMessage(scope: BookScope, conversationId: string, content: string): void {
    this.database.prepare(`
      INSERT INTO messages (
        message_id, conversation_id, owner_id, book_id, sender_type,
        message_type, content, references_json, created_at
      ) VALUES (?, ?, ?, ?, 'system', 'capability_notice', ?, '[]', ?)
    `).run(this.ids.next(), conversationId, scope.ownerId, scope.bookId, content, this.clock.now().toISOString());
  }

  private requireConversation(scope: BookScope): string {
    const row = this.database.prepare(`
      SELECT conversation_id FROM conversations WHERE owner_id = ? AND book_id = ? ORDER BY created_at LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { conversation_id: string } | undefined;
    if (row === undefined) throw new Error('书籍主对话不存在或越权');
    return row.conversation_id;
  }
}
