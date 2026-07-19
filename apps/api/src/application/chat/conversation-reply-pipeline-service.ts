import type { DatabaseSync } from 'node:sqlite';
import { BudgetService } from '../budget/budget-service.js';
import { ModelCallService } from '../calls/model-call-service.js';
import { ContextPackService, type ContextSource } from '../memory/context-pack-service.js';
import { TaskService } from '../tasks/task-service.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { RoleKey } from '../../domain/roles.js';
import type { CreativeRoleKey } from '../../contracts/agent-team-v2.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../infrastructure/models/model-runtime-config.js';

interface ReplyTaskRow {
  status: string;
  lease_owner: string | null;
  task_brief_json: string;
  cancel_requested: number;
  assigned_agent_id: string | null;
}

interface EditorRow {
  agent_id: string;
  display_name: string;
  role_key: RoleKey | CreativeRoleKey;
  model_snapshot_id: string;
  provider: string;
  model_id: string;
}

export class ConversationReplyPipelineService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly modelAdapters: ModelAdapterFactory = new ModelAdapterFactory(loadModelRuntimeConfig({}))
  ) {}

  public async executeClaimed(scope: BookScope, taskId: string, workerId: string): Promise<{ messageId: string }> {
    assertBookScope(scope);
    const task = this.database.prepare(`
      SELECT status, lease_owner, task_brief_json, cancel_requested, assigned_agent_id FROM tasks
      WHERE task_id = ? AND owner_id = ? AND book_id = ? AND task_type = 'conversation_reply'
    `).get(taskId, scope.ownerId, scope.bookId) as ReplyTaskRow | undefined;
    if (task === undefined || task.status !== 'working' || task.lease_owner !== workerId || task.assigned_agent_id === null) {
      throw new Error('对话回复任务未由指定Worker持有');
    }
    try {
      const brief = JSON.parse(task.task_brief_json) as { conversationId: string; messageId: string; content: string };
      const editor = this.database.prepare(`
        SELECT a.agent_id, a.display_name, r.role_key, a.model_snapshot_id, m.provider, m.model_id
        FROM agent_instances a
        JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
        JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
        WHERE a.agent_id = ? AND a.owner_id = ? AND a.book_id = ? AND r.role_key = 'chief_editor'
      `).get(task.assigned_agent_id, scope.ownerId, scope.bookId) as EditorRow | undefined;
      if (editor === undefined) throw new Error('活动主编或主编模型快照不存在');
      const book = this.database.prepare(`SELECT canon_revision, positioning_version FROM books WHERE owner_id = ? AND book_id = ?`)
        .get(scope.ownerId, scope.bookId) as { canon_revision: number; positioning_version: number };
      const targetMessage = this.database.prepare(`
        SELECT rowid AS row_id, created_at FROM messages
        WHERE message_id = ? AND conversation_id = ? AND owner_id = ? AND book_id = ?
      `).get(brief.messageId, brief.conversationId, scope.ownerId, scope.bookId) as { row_id: number; created_at: string } | undefined;
      if (targetMessage === undefined) throw new Error('待回复的老板消息不存在或越权');
      const history = this.database.prepare(`
        SELECT sender_type, role_key, content, created_at FROM messages
        WHERE conversation_id = ? AND owner_id = ? AND book_id = ? AND rowid < ?
        ORDER BY rowid DESC LIMIT 12
      `).all(brief.conversationId, scope.ownerId, scope.bookId, targetMessage.row_id) as unknown as Array<Record<string, unknown>>;
      history.reverse();
      const storyBible = this.database.prepare(`
        SELECT v.artifact_version_id, v.content_json FROM artifacts a
        JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
        WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'story_bible'
        ORDER BY a.created_at LIMIT 1
      `).get(scope.ownerId, scope.bookId) as { artifact_version_id: string; content_json: string } | undefined;
      const decisions = this.database.prepare(`
        SELECT d.decision_id, x.scope_text, d.recommendation_json FROM discussion_decisions d
        JOIN discussions x ON x.discussion_id = d.discussion_id
        WHERE d.owner_id = ? AND d.book_id = ? AND d.boss_confirmed = 1
        ORDER BY d.confirmed_at DESC LIMIT 5
      `).all(scope.ownerId, scope.bookId) as unknown as Array<Record<string, unknown>>;
      const hardSources: ContextSource[] = [{
        sourceType: 'boss_message', sourceId: brief.messageId, content: brief.content,
        reason: '当前需要回复的老板消息', priority: 100
      }];
      if (storyBible !== undefined) {
        hardSources.push({
          sourceType: 'story_bible', sourceId: storyBible.artifact_version_id, content: storyBible.content_json,
          reason: '当前书籍已选故事圣经；草稿字段必须如实标识', priority: 95
        });
      }
      const optionalSources: ContextSource[] = [
        { sourceType: 'recent_conversation', sourceId: `history:${brief.messageId}`, content: JSON.stringify(history), reason: '仅限本次回复的最近12条对话窗口', priority: 70 },
        { sourceType: 'confirmed_decisions', sourceId: `decisions:${scope.bookId}`, content: JSON.stringify(decisions), reason: '老板已经确认的创作决定', priority: 80 }
      ];
      const pack = new ContextPackService(this.database, this.ids, this.clock).build(scope, {
        taskId,
        agentId: editor.agent_id,
        canonRevision: book.canon_revision,
        positioningVersion: book.positioning_version,
        tokenBudget: 24_000,
        hardSources,
        optionalSources
      });
      const budget = this.database.prepare(`SELECT budget_id FROM budgets WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`)
        .get(scope.ownerId, scope.bookId) as { budget_id: string } | undefined;
      if (budget === undefined) throw new Error('当前书籍没有活动预算');
      const prompt = JSON.stringify({
        operation: 'open_conversation_reply',
        identity: editor.display_name,
        rules: [
          '直接回应老板，不要声称其他成员已经回复或已完成未执行的工作',
          '如果创作资料不足，指出缺口并提出一至三个具体问题',
          '不要在没有确认方案和章纲时直接创作正文',
          '回答使用自然中文，可讨论但不得把闲聊写入正史'
        ],
        currentMessage: brief.content,
        recentConversation: history,
        storyBible: storyBible === undefined ? null : JSON.parse(storyBible.content_json),
        confirmedDecisions: decisions,
        contextPackHash: pack.contentHash
      });
      const requestId = this.ids.next();
      const budgets = new BudgetService(this.database, this.ids, this.clock);
      const adapter = this.modelAdapters.resolve(editor.provider, editor.model_id, 'discussion', editor.role_key);
      const reservationId = budgets.reserve(scope, budget.budget_id, requestId, adapter.provider === 'openai-codex-subscription' ? 30_000 : 8_000, 0);
      const result = await new ModelCallService(this.database, this.clock, budgets).execute(scope, {
        requestId,
        taskId,
        phaseKey: 'reply:chief_editor',
        agentId: editor.agent_id,
        modelSnapshotId: editor.model_snapshot_id,
        provider: editor.provider,
        modelId: editor.model_id,
        input: prompt,
        parameters: JSON.stringify({ maxOutputTokens: 1_200, planOnly: !editor.provider.startsWith('local-deterministic'), cashFallbackAllowed: false }),
        reservationId,
        contextPackId: pack.contextPackId
      }, adapter, {
        requestId,
        taskId,
        ownerId: scope.ownerId,
        bookId: scope.bookId,
        agentId: editor.agent_id,
        prompt,
        maxOutputTokens: 1_200
      });
      const messageId = this.ids.next();
      this.database.prepare(`
        INSERT INTO messages (
          message_id, conversation_id, owner_id, book_id, sender_type, sender_agent_id,
          role_key, model_provider, model_id, message_type, content, references_json, created_at
        ) VALUES (?, ?, ?, ?, 'agent', ?, ?, ?, ?, 'conversation_reply', ?, ?, ?)
      `).run(
        messageId, brief.conversationId, scope.ownerId, scope.bookId, editor.agent_id,
        editor.role_key, result.provider, result.modelId, result.output,
        JSON.stringify([{ replyToMessageId: brief.messageId, contextPackId: pack.contextPackId }]), this.clock.now().toISOString()
      );
      new TaskService(this.database, this.releaseId, this.clock).complete(scope, taskId, workerId);
      return { messageId };
    } catch (error) {
      const now = this.clock.now().toISOString();
      const cancelled = (this.database.prepare(`SELECT cancel_requested FROM tasks WHERE task_id = ?`).get(taskId) as { cancel_requested: number }).cancel_requested === 1;
      this.database.prepare(`
        UPDATE tasks SET status = ?, error_code = ?, lease_owner = NULL, lease_expires_at = NULL,
          heartbeat_at = NULL, updated_at = ? WHERE task_id = ? AND owner_id = ? AND book_id = ? AND lease_owner = ?
      `).run(cancelled ? 'cancelled' : 'failed', cancelled ? 'TASK_CANCELLED' : 'CONVERSATION_REPLY_FAILED', now, taskId, scope.ownerId, scope.bookId, workerId);
      throw error;
    }
  }
}
