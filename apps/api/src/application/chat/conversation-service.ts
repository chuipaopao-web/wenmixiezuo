import type { DatabaseSync } from 'node:sqlite';
import { ChapterBatchService } from '../creation/chapter-batch-service.js';
import { TaskService } from '../tasks/task-service.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { EditorLeaseService } from '../editors/editor-lease-service.js';
import { DiscussionService } from '../discussions/discussion-service.js';
import { AgentTeamService } from '../agents/agent-team-service.js';
import { WritingReadinessService, type ChapterRequestCount } from '../creation/writing-readiness-service.js';
import { PlanningArtifactService } from '../artifacts/planning-artifact-service.js';

type DiscussionPurpose = 'open_discussion' | 'creative_planning';

export class ConversationService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public listMessages(scope: BookScope, options: { limit?: number; before?: string } = {}): unknown[] {
    const conversationId = this.requireConversation(scope);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 500)));
    const before = options.before === undefined ? undefined : this.database.prepare(`
      SELECT created_at, message_id FROM messages
      WHERE message_id = ? AND conversation_id = ? AND owner_id = ? AND book_id = ?
    `).get(options.before, conversationId, scope.ownerId, scope.bookId) as { created_at: string; message_id: string } | undefined;
    if (options.before !== undefined && before === undefined) throw new Error('分页游标不存在或不属于当前书籍');
    const rows = this.database.prepare(`
      SELECT message_id, sender_type, sender_agent_id, role_key, model_provider,
        model_id, message_type, content, references_json, created_at
      FROM messages WHERE conversation_id = ? AND owner_id = ? AND book_id = ?
        AND (? IS NULL OR created_at < ? OR (created_at = ? AND message_id < ?))
      ORDER BY created_at DESC, message_id DESC LIMIT ?
    `).all(
      conversationId, scope.ownerId, scope.bookId,
      before?.created_at ?? null, before?.created_at ?? null,
      before?.created_at ?? null, before?.message_id ?? null, limit
    );
    return rows.reverse();
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
    const action = this.routeMessage(scope, trimmed, messageId, conversationId);
    this.addSystemMessage(scope, conversationId, actionNotice(action));
    return { messageId, action };
  }

  private routeMessage(scope: BookScope, content: string, messageId: string, conversationId: string): Record<string, unknown> {
    const write = /^写([一1]|[三3]|[四4]|[五5])章$/u.exec(content);
    if (write !== null) {
      const countMap: Record<string, ChapterRequestCount> = { 一: 1, '1': 1, 三: 3, '3': 3, 四: 4, '4': 4, 五: 5, '5': 5 };
      const count = countMap[write[1]!]!;
      const readiness = new WritingReadinessService(this.database).inspect(scope, count);
      if (!readiness.ready) {
        const existing = this.findActivePlanningDiscussion(scope, count);
        if (existing !== undefined) {
          return {
            kind: 'planning_discussion_existing', discussionId: existing.discussion_id,
            taskId: existing.task_id, requestedChapterCount: count, missing: readiness.missing
          };
        }
        const premise = this.currentPremise(scope);
        const scopeText = [
          `为创作第${readiness.chapterNumbers[0]}至${readiness.chapterNumbers.at(-1)}章，先完成可执行创作方案。`,
          `当前核心创意：${premise}`,
          '请明确主角与开局处境、核心冲突、各章推进节点、第一章视角与文风、章末钩子，以及仍需老板决定的问题。',
          `当前缺少：${readiness.missing.join('、')}`
        ].join('\n');
        const scheduled = this.scheduleDiscussion(scope, scopeText, messageId, conversationId, 'creative_planning', count);
        return { ...scheduled, kind: 'planning_discussion_scheduled', requestedChapterCount: count, missing: readiness.missing };
      }
      const batch = new ChapterBatchService(this.database, this.dataDir, this.releaseId, this.ids, this.clock).scheduleNewChapters(scope, count);
      return { kind: 'chapter_batch_scheduled', batchId: batch.batchId, count };
    }
    const discussionMatch = /^讨论\s+(.+)$/u.exec(content);
    if (discussionMatch !== null) {
      const scopeText = discussionMatch[1]!.trim();
      if (scopeText.length < 2) throw new Error('请在“讨论”后写明具体问题');
      const planning = isCreativeIntent(scopeText);
      return this.scheduleDiscussion(scope, scopeText, messageId, conversationId, planning ? 'creative_planning' : 'open_discussion', planning ? 1 : null);
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
    if (content === '准备接管') {
      const lease = this.database.prepare(`SELECT active_editor_agent_id, editor_epoch FROM editor_leases WHERE owner_id = ? AND book_id = ?`)
        .get(scope.ownerId, scope.bookId) as { active_editor_agent_id: string; editor_epoch: number } | undefined;
      if (lease === undefined) throw new Error('当前书籍没有活动主编租约');
      const candidate = this.database.prepare(`
        SELECT a.agent_id FROM agent_instances a JOIN role_templates r
          ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
        WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1
          AND a.agent_id <> ? AND r.category = 'core'
        ORDER BY CASE r.role_key WHEN 'continuity' THEN 0 ELSE 1 END, r.role_key LIMIT 1
      `).get(scope.ownerId, scope.bookId, lease.active_editor_agent_id) as { agent_id: string } | undefined;
      if (candidate === undefined) throw new Error('没有可用于接管的核心Agent');
      const prepared = new EditorLeaseService(this.database, this.ids, this.clock).prepareTakeover(scope, candidate.agent_id);
      return { kind: 'takeover_prepared', takeoverId: prepared.takeoverId, fromEpoch: lease.editor_epoch, candidateAgentId: candidate.agent_id };
    }
    const confirmTakeover = /^确认接管\s+([A-Za-z0-9-]+)$/u.exec(content);
    if (confirmTakeover !== null) {
      const completed = new EditorLeaseService(this.database, this.ids, this.clock).completeTakeover(scope, confirmTakeover[1]!);
      return { kind: 'takeover_completed', editorEpoch: completed.editorEpoch, activeEditorAgentId: completed.activeEditorAgentId };
    }
    const confirmDecision = /^确认方案\s+([A-Za-z0-9-]+)$/u.exec(content);
    if (confirmDecision !== null) {
      const decision = this.database.prepare(`
        SELECT d.discussion_id FROM discussion_decisions d JOIN discussions x ON x.discussion_id = d.discussion_id
        WHERE d.decision_id = ? AND d.owner_id = ? AND d.book_id = ? AND x.status = 'awaiting_boss'
      `).get(confirmDecision[1]!, scope.ownerId, scope.bookId) as { discussion_id: string } | undefined;
      if (decision === undefined) throw new Error('待确认方案不存在、已处理或不属于当前书籍');
      new DiscussionService(this.database, this.ids, this.clock).confirm(scope, decision.discussion_id, confirmDecision[1]!);
      const prepared = new PlanningArtifactService(this.database, this.ids, this.clock)
        .promoteIfPlanningTask(scope, decision.discussion_id, confirmDecision[1]!);
      return {
        kind: 'discussion_confirmed', discussionId: decision.discussion_id, decisionId: confirmDecision[1],
        planningPrepared: prepared !== null, chapterOutlineCount: prepared?.chapterOutlineVersionIds.length ?? 0
      };
    }
    if (isCreativeIntent(content)) return this.scheduleDiscussion(scope, content, messageId, conversationId, 'creative_planning', 1);
    return this.scheduleConversationReply(scope, content, messageId, conversationId);
  }

  private scheduleConversationReply(scope: BookScope, content: string, messageId: string, conversationId: string): Record<string, unknown> {
    const lease = this.requireEditorLease(scope);
    const budget = this.requireBudget(scope);
    const taskId = this.ids.next();
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    tasks.create(scope, {
      taskId,
      taskType: 'conversation_reply',
      assignedAgentId: lease.active_editor_agent_id,
      idempotencyKey: `conversation-reply:${messageId}`,
      budgetId: budget.budget_id,
      requiredEditorEpoch: lease.editor_epoch,
      initialPhase: 'reply',
      brief: { conversationId, messageId, content }
    });
    tasks.queue(scope, taskId);
    return { kind: 'conversation_reply_scheduled', taskId, agentId: lease.active_editor_agent_id };
  }

  private scheduleDiscussion(
    scope: BookScope,
    scopeText: string,
    messageId: string,
    conversationId: string,
    purpose: DiscussionPurpose,
    requestedChapterCount: ChapterRequestCount | null
  ): Record<string, unknown> {
    const lease = this.requireEditorLease(scope);
    const roleKey = relevantDiscussionRole(scopeText);
    const secondary = this.database.prepare(`
      SELECT a.agent_id, r.role_key FROM agent_instances a JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1 AND a.agent_id <> ?
        AND r.role_key IN (?, 'plot_architect', 'reviewer')
      ORDER BY CASE r.role_key WHEN ? THEN 0 WHEN 'plot_architect' THEN 1 ELSE 2 END LIMIT 1
    `).get(scope.ownerId, scope.bookId, lease.active_editor_agent_id, roleKey, roleKey) as { agent_id: string; role_key: string } | undefined;
    if (secondary === undefined) throw new Error('没有与讨论范围匹配的岗位');
    new AgentTeamService(this.database, this.ids, this.clock).activate(scope, secondary.agent_id, 'text');
    const discussion = new DiscussionService(this.database, this.ids, this.clock).create(scope, {
      type: 'quick',
      scopeText,
      createdByAgentId: lease.active_editor_agent_id,
      participants: [
        { agentId: lease.active_editor_agent_id, reason: '活动主编负责主持、取舍和汇总' },
        { agentId: secondary.agent_id, reason: `问题由${secondary.role_key}岗位提供专项视角` }
      ]
    });
    const budget = this.requireBudget(scope);
    const taskId = this.ids.next();
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    tasks.create(scope, {
      taskId,
      taskType: 'discussion',
      assignedAgentId: lease.active_editor_agent_id,
      idempotencyKey: `discussion-message:${messageId}`,
      budgetId: budget.budget_id,
      requiredEditorEpoch: lease.editor_epoch,
      initialPhase: 'collecting',
      brief: { discussionId: discussion.discussionId, scopeText, conversationId, purpose, requestedChapterCount }
    });
    tasks.queue(scope, taskId);
    return {
      kind: 'discussion_scheduled',
      purpose,
      discussionId: discussion.discussionId,
      taskId,
      participants: discussion.participants.map((item) => item.agentId)
    };
  }

  private requireEditorLease(scope: BookScope): { active_editor_agent_id: string; editor_epoch: number } {
    const lease = this.database.prepare(`SELECT active_editor_agent_id, editor_epoch FROM editor_leases WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { active_editor_agent_id: string; editor_epoch: number } | undefined;
    if (lease === undefined) throw new Error('当前书籍没有活动主编租约');
    return lease;
  }

  private requireBudget(scope: BookScope): { budget_id: string } {
    const budget = this.database.prepare(`SELECT budget_id FROM budgets WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as { budget_id: string } | undefined;
    if (budget === undefined) throw new Error('当前书籍没有活动预算');
    return budget;
  }

  private findActivePlanningDiscussion(scope: BookScope, count: ChapterRequestCount): { discussion_id: string; task_id: string } | undefined {
    return this.database.prepare(`
      SELECT json_extract(t.task_brief_json, '$.discussionId') AS discussion_id, t.task_id
      FROM tasks t JOIN discussions d ON d.discussion_id = json_extract(t.task_brief_json, '$.discussionId')
      WHERE t.owner_id = ? AND t.book_id = ? AND t.task_type = 'discussion'
        AND json_extract(t.task_brief_json, '$.purpose') = 'creative_planning'
        AND CAST(json_extract(t.task_brief_json, '$.requestedChapterCount') AS INTEGER) >= ?
        AND t.status IN ('pending', 'queued', 'working', 'waiting_confirmation', 'succeeded')
        AND d.status IN ('collecting', 'cross_review', 'synthesizing', 'reviewing_draft', 'awaiting_boss')
      ORDER BY t.created_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, count) as { discussion_id: string; task_id: string } | undefined;
  }

  private currentPremise(scope: BookScope): string {
    const row = this.database.prepare(`
      SELECT json_extract(value, '$.value') AS premise FROM positioning_versions,
        json_each(positioning_versions.fields_json)
      WHERE owner_id = ? AND book_id = ? AND json_extract(value, '$.key') = 'premise'
      ORDER BY version DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { premise: string | null } | undefined;
    return row?.premise?.trim() || '尚未形成明确核心创意';
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

function relevantDiscussionRole(content: string): string {
  if (/版权|原创|仿写|改编/u.test(content)) return 'copyright';
  if (/考据|资料|史实|历史/u.test(content)) return 'researcher';
  if (/文风|语言|对白|去AI/u.test(content)) return 'style_editor';
  if (/读者|节奏|情绪|钩子|爽点/u.test(content)) return 'reader_experience';
  if (/设定|连续|时间线|人物状态/u.test(content)) return 'continuity';
  return 'plot_architect';
}

function isCreativeIntent(content: string): boolean {
  return /小说|故事|剧情|情节|题材|游戏文|主角|角色|人物|设定|世界观|开局|结局|冲突|转折|节奏|文风|大纲|章纲|第一章|下一章|钩子|我想写|怎么写/u.test(content);
}

function actionNotice(action: Record<string, unknown>): string {
  switch (action.kind) {
    case 'chapter_batch_scheduled': return `已安排连续创作 ${String(action.count)} 章，批次ID：${String(action.batchId)}。`;
    case 'discussion_scheduled': return `讨论任务已安排，讨论ID：${String(action.discussionId)}。Worker完成真实岗位意见后，主编会在这里汇总并给出确认方案。`;
    case 'planning_discussion_scheduled': return `资料不足，未启动主笔。已请主编和相关成员先完成 ${String(action.requestedChapterCount)} 章所需的剧情方案，讨论ID：${String(action.discussionId)}。`;
    case 'planning_discussion_existing': return `资料仍未齐备，未启动主笔。已有规划讨论 ${String(action.discussionId)} 正在进行或等待你确认，请先完成该讨论。`;
    case 'conversation_reply_scheduled': return '主编已收到，正在根据当前书籍资料回复。';
    case 'pause_requested': return `已向 ${String((action.taskIds as unknown[]).length)} 个运行任务发出安全检查点暂停请求。`;
    case 'tasks_resumed': return `已将 ${String((action.taskIds as unknown[]).length)} 个暂停任务重新入队。`;
    case 'cancel_requested': return `已向 ${String((action.taskIds as unknown[]).length)} 个任务发出真实取消请求。`;
    case 'takeover_prepared': return `接管包已准备。完整接管ID：${String(action.takeoverId)}。确认无误后输入“确认接管 ${String(action.takeoverId)}”。`;
    case 'takeover_completed': return `主编接管已完成，新 editor_epoch 为 ${String(action.editorEpoch)}；旧epoch指令已失效。`;
    case 'discussion_confirmed': return action.planningPrepared === true
      ? `方案 ${String(action.decisionId)} 已由老板明确确认，并已形成 ${String(action.chapterOutlineCount)} 章可追溯章纲。`
      : `方案 ${String(action.decisionId)} 已由老板明确确认。`;
    default: return '明确控制命令已执行。';
  }
}
