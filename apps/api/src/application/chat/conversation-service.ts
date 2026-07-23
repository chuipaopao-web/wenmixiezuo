import type { DatabaseSync } from 'node:sqlite';
import { ChapterBatchService } from '../creation/chapter-batch-service.js';
import { TaskService } from '../tasks/task-service.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { EditorLeaseService } from '../editors/editor-lease-service.js';
import { DiscussionService } from '../discussions/discussion-service.js';
import { WritingReadinessService, type ChapterRequestCount } from '../creation/writing-readiness-service.js';
import { PlanningArtifactService } from '../artifacts/planning-artifact-service.js';
import { LocalAssistantService, type RoutingDecision } from '../local-assistant/local-assistant-service.js';
import { LocalAssistantRepository } from '../../infrastructure/db/repositories/local-assistant-repository.js';
import type { LocalUtilityModel } from '../local-assistant/local-utility-model.js';
import { cancelActiveModelCall } from '../calls/model-call-service.js';
import { cancelActiveToolCall } from '../calls/tool-call-service.js';
import {
  ChatAttachmentRepository,
  type ChatAttachmentRecord
} from '../../infrastructure/db/repositories/chat-attachment-repository.js';

type DiscussionPurpose = 'open_discussion' | 'creative_planning';

interface AttachmentReference {
  type: 'chat_attachment';
  attachmentId: string;
  originalName: string;
  mediaKind: ChatAttachmentRecord['mediaKind'];
  mimeType: string;
  sizeBytes: number;
  parseStatus: ChatAttachmentRecord['parseStatus'];
  parsedCharCount: number;
  contentHash: string;
  contextExcerpt: string;
}

const MAX_ATTACHMENT_CONTEXT_CHARS = 12_000;

function buildAttachmentReferences(attachments: ChatAttachmentRecord[]): AttachmentReference[] {
  let remaining = MAX_ATTACHMENT_CONTEXT_CHARS;
  return attachments.map((attachment) => {
    const headerReserve = Math.min(remaining, attachment.originalName.length + 80);
    const excerptBudget = Math.max(0, remaining - headerReserve);
    const contextExcerpt = attachment.contextExcerpt.slice(0, excerptBudget);
    remaining = Math.max(0, remaining - headerReserve - contextExcerpt.length);
    return {
      type: 'chat_attachment',
      attachmentId: attachment.attachmentId,
      originalName: attachment.originalName,
      mediaKind: attachment.mediaKind,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      parseStatus: attachment.parseStatus,
      parsedCharCount: attachment.parsedCharCount,
      contentHash: attachment.contentHash,
      contextExcerpt
    };
  });
}

function renderAttachmentContext(references: AttachmentReference[]): string {
  return references.map((reference) => {
    const status = reference.parseStatus === 'preview_only'
      ? '仅预览，未识别图片内容'
      : reference.parseStatus === 'no_text' || reference.parseStatus === 'failed'
        ? '没有可用解析文本'
        : `已解析${reference.parsedCharCount}字符`;
    const excerpt = reference.contextExcerpt.length === 0 ? '' : `\n${reference.contextExcerpt}`;
    return `[临时对话附件｜${reference.originalName}｜${status}｜attachment_id=${reference.attachmentId}]${excerpt}`;
  }).join('\n\n').slice(0, MAX_ATTACHMENT_CONTEXT_CHARS);
}

function appendAttachmentContext(content: string, attachmentContext: string): string {
  return attachmentContext.length === 0
    ? content
    : `${content}\n\n以下附件只属于当前对话临时资料，不是正史；引用时保留不确定性：\n${attachmentContext}`;
}

export class ConversationService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly dataDir: string,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly localUtilityModel?: LocalUtilityModel
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
        AND message_type <> 'onboarding_trigger'
        AND (? IS NULL OR created_at < ? OR (created_at = ? AND message_id < ?))
      ORDER BY created_at DESC, message_id DESC LIMIT ?
    `).all(
      conversationId, scope.ownerId, scope.bookId,
      before?.created_at ?? null, before?.created_at ?? null,
      before?.created_at ?? null, before?.message_id ?? null, limit
    );
    return rows.reverse();
  }

  public sendBossMessage(scope: BookScope, content: string, attachmentIds: string[] = []): { messageId: string; action: Record<string, unknown> } {
    const stored = this.storeBossMessage(scope, content, attachmentIds);
    const intake = new LocalAssistantService(new LocalAssistantRepository(this.database), this.ids, this.clock)
      .route(scope, { conversationId: stored.conversationId, messageId: stored.messageId, original: stored.trimmed });
    const action = this.routeMessage(scope, stored.trimmed, stored.messageId, stored.conversationId, intake, stored.attachmentContext);
    const result = { ...action, intake: { routeClass: intake.routeClass, riskLevel: intake.riskLevel,
      confidenceBand: intake.confidenceBand, selectedAction: intake.selectedAction } };
    this.addLocalAssistantMessage(scope, stored.conversationId, actionNotice(result));
    return { messageId: stored.messageId, action: result };
  }

  public async sendBossMessageWithLocalAssistant(scope: BookScope, content: string, attachmentIds: string[] = []): Promise<{ messageId: string; action: Record<string, unknown> }> {
    const stored = this.storeBossMessage(scope, content, attachmentIds);
    const intake = await new LocalAssistantService(new LocalAssistantRepository(this.database), this.ids, this.clock, this.localUtilityModel)
      .routeWithSemantic(scope, { conversationId: stored.conversationId, messageId: stored.messageId, original: stored.trimmed });
    const action = this.routeMessage(scope, stored.trimmed, stored.messageId, stored.conversationId, intake, stored.attachmentContext);
    const result = { ...action, intake: { routeClass: intake.routeClass, riskLevel: intake.riskLevel,
      confidenceBand: intake.confidenceBand, selectedAction: intake.selectedAction } };
    this.addLocalAssistantMessage(scope, stored.conversationId, actionNotice(result));
    return { messageId: stored.messageId, action: result };
  }

  private storeBossMessage(scope: BookScope, content: string, attachmentIds: string[]): {
    conversationId: string;
    messageId: string;
    trimmed: string;
    attachmentContext: string;
  } {
    assertBookScope(scope);
    const attachmentRepository = new ChatAttachmentRepository(this.database, scope);
    const attachments = attachmentRepository.requireBindable(attachmentIds);
    const rawTrimmed = content.trim();
    const trimmed = rawTrimmed.length === 0 && attachments.length > 0
      ? `分享附件：${attachments.map((item) => item.originalName).join('、')}`
      : rawTrimmed;
    if (trimmed.length === 0 || trimmed.length > 20_000) throw new Error('消息长度必须在1至20000字符之间，或至少附加一个文件');
    const conversationId = this.requireConversation(scope);
    const messageId = this.ids.next();
    const now = this.clock.now().toISOString();
    const references = buildAttachmentReferences(attachments);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO messages (
          message_id, conversation_id, owner_id, book_id, sender_type,
          message_type, content, references_json, created_at
        ) VALUES (?, ?, ?, ?, 'boss', ?, ?, ?, ?)
      `).run(
        messageId, conversationId, scope.ownerId, scope.bookId,
        references.length > 0 ? 'text_with_attachments' : 'text', trimmed, JSON.stringify(references), now
      );
      attachmentRepository.bindToMessage(attachmentIds, messageId, now);
      this.database.prepare(`UPDATE conversations SET updated_at = ? WHERE conversation_id = ?`).run(now, conversationId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return { conversationId, messageId, trimmed, attachmentContext: renderAttachmentContext(references) };
  }

  private routeMessage(
    scope: BookScope,
    content: string,
    messageId: string,
    conversationId: string,
    intake?: RoutingDecision,
    attachmentContext = ''
  ): Record<string, unknown> {
    const modelContent = appendAttachmentContext(content, attachmentContext);
    if (intake?.routeClass === 'protected_operation') {
      return { kind: 'protected_operation_blocked', selectedAction: intake.selectedAction, receiptText: intake.receiptText };
    }
    if (intake?.routeClass === 'named_member') {
      const memberName = intake.selectedRoles[0];
      if (memberName === undefined) throw new Error('点名成员路由缺少成员名称');
      return this.scheduleNamedConversationReply(scope, modelContent, messageId, conversationId, memberName);
    }
    if (intake?.routeClass === 'local_assistant_conversation') {
      return {
        kind: 'local_assistant_reply',
        topic: intake.selectedAction === 'explain_local_assistant_role' ? 'identity' : 'greeting'
      };
    }
    if (/^(?:写[一1]章|开始写|继续写)$/u.test(content)) {
      if (attachmentContext.length > 0) {
        return {
          ...this.scheduleDiscussion(
            scope,
            `老板要求开始创作并附加了临时资料。先核对附件与当前正史、明确其用途，再细化唯一下一章；附件未确认，不能写入正史。\n\n${modelContent}`,
            messageId,
            conversationId,
            'creative_planning',
            null
          ),
          kind: 'planning_discussion_scheduled',
          requestedChapterCount: null,
          missing: ['附件用途与唯一下一章规划']
        };
      }
      const count: ChapterRequestCount = 1;
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
        const scheduled = this.scheduleDiscussion(
          scope, appendAttachmentContext(scopeText, attachmentContext), messageId, conversationId, 'creative_planning', null
        );
        return { ...scheduled, kind: 'planning_discussion_scheduled', requestedChapterCount: null, missing: readiness.missing };
      }
      const batch = new ChapterBatchService(this.database, this.dataDir, this.releaseId, this.ids, this.clock).scheduleNewChapters(scope, count);
      return { kind: 'chapter_batch_scheduled', batchId: batch.batchId, count };
    }
    if (/^写[三四五345]章$/u.test(content)) {
      return {
        ...this.scheduleDiscussion(
          scope,
          appendAttachmentContext(
            `老板希望连续推进多章，但正式正文必须逐章点评、逐章确认和逐章结算。请先评估合理章节跨度并细化唯一下一章。原话：${content}`,
            attachmentContext
          ),
          messageId,
          conversationId,
          'creative_planning',
          null
        ),
        kind: 'planning_discussion_scheduled',
        requestedChapterCount: null,
        missing: ['逐章规划与确认']
      };
    }
    const discussionMatch = /^讨论\s+(.+)$/u.exec(content);
    if (discussionMatch !== null) {
      const scopeText = discussionMatch[1]!.trim();
      if (scopeText.length < 2) throw new Error('请在“讨论”后写明具体问题');
      const planning = isCreativeIntent(scopeText);
      return this.scheduleDiscussion(
        scope, appendAttachmentContext(scopeText, attachmentContext), messageId, conversationId,
        planning ? 'creative_planning' : 'open_discussion', null
      );
    }
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    if (content === '暂停' || intake?.selectedAction === 'pause_tasks') {
      const working = tasks.list(scope).filter((task) => task.status === 'working');
      for (const task of working) tasks.requestPause(scope, task.taskId);
      return { kind: 'pause_requested', taskIds: working.map((task) => task.taskId) };
    }
    if (content === '继续' || intake?.selectedAction === 'resume_tasks') {
      const paused = tasks.list(scope).filter((task) => task.status === 'paused');
      for (const task of paused) tasks.queue(scope, task.taskId);
      return { kind: 'tasks_resumed', taskIds: paused.map((task) => task.taskId) };
    }
    if (content === '取消' || intake?.selectedAction === 'cancel_tasks') {
      const cancellable = tasks.list(scope).filter((task) => ['pending', 'queued', 'working', 'paused', 'blocked'].includes(task.status));
      for (const task of cancellable) tasks.requestCancel(scope, task.taskId);
      const taskIds = cancellable.map((task) => task.taskId);
      const modelCalls = this.database.prepare(`
        SELECT m.request_id FROM model_calls m JOIN tasks t ON t.task_id = m.task_id
          AND t.owner_id = m.owner_id AND t.book_id = m.book_id
        WHERE m.owner_id = ? AND m.book_id = ? AND m.state = 'working' AND t.cancel_requested = 1
      `).all(scope.ownerId, scope.bookId) as unknown as Array<{ request_id: string }>;
      const toolCalls = this.database.prepare(`
        SELECT c.tool_call_id FROM tool_calls c JOIN tasks t ON t.task_id = c.task_id
          AND t.owner_id = c.owner_id AND t.book_id = c.book_id
        WHERE c.owner_id = ? AND c.book_id = ? AND c.state = 'working' AND t.cancel_requested = 1
      `).all(scope.ownerId, scope.bookId) as unknown as Array<{ tool_call_id: string }>;
      const cancelledModelCalls = modelCalls.filter((call) => cancelActiveModelCall(call.request_id)).length;
      const cancelledToolCalls = toolCalls.filter((call) => cancelActiveToolCall(call.tool_call_id)).length;
      return { kind: 'cancel_requested', taskIds, cancelledModelCalls, cancelledToolCalls };
    }
    if (intake?.selectedAction === 'show_task_overview' || /^查看任务[！!。.？?\s]*$/u.test(content)) {
      const allTasks = tasks.list(scope);
      const active = allTasks.filter((task) => ['pending', 'queued', 'working', 'paused', 'blocked', 'waiting_confirmation'].includes(task.status));
      return {
        kind: 'task_overview',
        activeCount: active.length,
        waitingConfirmationCount: active.filter((task) => task.status === 'waiting_confirmation').length,
        latestTaskId: active[0]?.taskId ?? null
      };
    }
    if (intake?.selectedAction === 'open_knowledge_workspace' || /^打开资料库[！!。.？?\s]*$/u.test(content)) {
      return { kind: 'knowledge_workspace_opened' };
    }
    if (content === '准备接管') {
      const lease = this.database.prepare(`SELECT active_editor_agent_id, editor_epoch FROM editor_leases WHERE owner_id = ? AND book_id = ?`)
        .get(scope.ownerId, scope.bookId) as { active_editor_agent_id: string; editor_epoch: number } | undefined;
      if (lease === undefined) throw new Error('当前书籍没有活动主编租约');
      const candidate = this.database.prepare(`
        SELECT a.agent_id FROM agent_instances a JOIN role_templates r
          ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
        WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1
          AND a.agent_id <> ? AND r.role_key IN ('chief_editor', 'deputy_editor')
        ORDER BY CASE r.role_key WHEN 'deputy_editor' THEN 0 ELSE 1 END, a.created_at, a.agent_id LIMIT 1
      `).get(scope.ownerId, scope.bookId, lease.active_editor_agent_id) as { agent_id: string } | undefined;
      if (candidate === undefined) throw new Error('没有已启用的候任副编可用于接管');
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
    if (intake?.routeClass === 'plot_discussion') return this.scheduleDiscussion(scope, modelContent, messageId, conversationId, 'creative_planning', null);
    if (isCreativeIntent(content)) return this.scheduleDiscussion(scope, modelContent, messageId, conversationId, 'creative_planning', null);
    return this.scheduleConversationReply(scope, modelContent, messageId, conversationId);
  }

  private scheduleConversationReply(scope: BookScope, content: string, messageId: string, conversationId: string): Record<string, unknown> {
    const lease = this.requireEditorLease(scope);
    const editor = this.database.prepare(`SELECT model_snapshot_id FROM agent_instances
      WHERE owner_id = ? AND book_id = ? AND agent_id = ? AND enabled = 1`)
      .get(scope.ownerId, scope.bookId, lease.active_editor_agent_id) as { model_snapshot_id: string } | undefined;
    if (editor === undefined) throw new Error('活动主编不存在、已停用或不属于当前书籍');
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
      brief: { conversationId, messageId, content, modelSnapshotId: editor.model_snapshot_id }
    });
    tasks.queue(scope, taskId);
    return { kind: 'conversation_reply_scheduled', taskId, agentId: lease.active_editor_agent_id };
  }

  private scheduleNamedConversationReply(
    scope: BookScope,
    content: string,
    messageId: string,
    conversationId: string,
    memberName: string
  ): Record<string, unknown> {
    const lease = this.requireEditorLease(scope);
    const member = this.database.prepare(`
      SELECT a.agent_id, a.model_snapshot_id, r.role_key
      FROM agent_instances a
      JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND a.display_name = ? AND a.enabled = 1
      ORDER BY r.version DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, memberName) as {
      agent_id: string;
      model_snapshot_id: string;
      role_key: string;
    } | undefined;
    if (member === undefined) throw new Error(`点名成员不存在、已停用或不属于当前书籍：${memberName}`);
    const budget = this.requireBudget(scope);
    const taskId = this.ids.next();
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    tasks.create(scope, {
      taskId,
      taskType: 'conversation_reply',
      assignedAgentId: member.agent_id,
      idempotencyKey: `named-conversation-reply:${messageId}:${member.agent_id}`,
      budgetId: budget.budget_id,
      requiredEditorEpoch: lease.editor_epoch,
      initialPhase: 'reply',
      brief: {
        conversationId,
        messageId,
        content,
        modelSnapshotId: member.model_snapshot_id,
        directNamedMember: true,
        requestedMemberName: memberName,
        requestedRoleKey: member.role_key
      }
    });
    tasks.queue(scope, taskId);
    return {
      kind: 'named_member_reply_scheduled',
      taskId,
      agentId: member.agent_id,
      memberName,
      roleKey: member.role_key
    };
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
    const roleKeys = purpose === 'creative_planning'
      ? ['lead_screenwriter', 'second_screenwriter', 'plot_architect']
      : discussionRoleCandidates(scopeText);
    const placeholders = roleKeys.map(() => '?').join(', ');
    const specialists = this.database.prepare(`
      SELECT a.agent_id, r.role_key FROM agent_instances a JOIN role_templates r
        ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1 AND a.agent_id <> ?
        AND r.role_key IN (${placeholders})
      ORDER BY CASE r.role_key WHEN 'lead_screenwriter' THEN 0 WHEN 'second_screenwriter' THEN 1 ELSE 2 END, r.role_key
      LIMIT ?
    `).all(scope.ownerId, scope.bookId, lease.active_editor_agent_id, ...roleKeys, purpose === 'creative_planning' ? 2 : 1) as unknown as Array<{ agent_id: string; role_key: string }>;
    if (specialists.length === 0) throw new Error('没有与讨论范围匹配的岗位');
    for (const specialist of specialists) {
      this.database.prepare(`UPDATE agent_instances SET activation_state = 'idle', updated_at = ? WHERE owner_id = ? AND book_id = ? AND agent_id = ?`)
        .run(this.clock.now().toISOString(), scope.ownerId, scope.bookId, specialist.agent_id);
    }
    const discussion = new DiscussionService(this.database, this.ids, this.clock).create(scope, {
      type: 'quick',
      scopeText,
      createdByAgentId: lease.active_editor_agent_id,
      participants: [
        { agentId: lease.active_editor_agent_id, reason: '活动主编负责主持、取舍和汇总' },
        ...specialists.map((specialist) => ({ agentId: specialist.agent_id, reason: `问题由${specialist.role_key}岗位独立提供专项视角` }))
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
        AND (json_extract(t.task_brief_json, '$.requestedChapterCount') IS NULL
          OR CAST(json_extract(t.task_brief_json, '$.requestedChapterCount') AS INTEGER) >= ?)
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

  private addLocalAssistantMessage(scope: BookScope, conversationId: string, content: string): void {
    this.database.prepare(`
      INSERT INTO messages (
        message_id, conversation_id, owner_id, book_id, sender_type,
        message_type, content, references_json, created_at
      ) VALUES (?, ?, ?, ?, 'system', 'local_assistant_notice', ?, '[]', ?)
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

function discussionRoleCandidates(content: string): string[] {
  if (/版权|原创|仿写|改编/u.test(content)) return ['copyright'];
  if (/考据|资料|史实|历史/u.test(content)) return ['researcher'];
  if (/文风|语言|对白|去AI/u.test(content)) return ['literary_reviewer', 'reviewer', 'style_editor'];
  if (/读者|节奏|情绪|钩子|爽点/u.test(content)) return ['experience_reviewer', 'reader_experience'];
  if (/设定|连续|时间线|人物状态/u.test(content)) return ['setting', 'continuity'];
  return ['lead_screenwriter', 'second_screenwriter', 'plot_architect'];
}

function isCreativeIntent(content: string): boolean {
  return /小说|故事|剧情|情节|题材|游戏文|主角|角色|人物|设定|世界观|开局|结局|冲突|转折|节奏|文风|大纲|章纲|第一章|下一章|钩子|我想写|怎么写/u.test(content);
}

function actionNotice(action: Record<string, unknown>): string {
  switch (action.kind) {
    case 'local_assistant_reply': return action.topic === 'identity'
      ? '我是小文秘书，负责接收消息、整理附件、查看任务和安排合适的成员。剧情、正文和正史仍由创作成员与您确认，我不会替她们作答。'
      : '我在。您可以直接说想聊的剧情、点名成员，或者让我查看任务和资料；需要创作判断时，我会把您的原话交给合适的成员。';
    case 'chapter_batch_scheduled': return '好的，下一章已经交给主笔。完成三轮独立点评后，我会把稿件带回来请您确认；在您确认前，它不会进入正史。';
    case 'discussion_scheduled': return '收到，我已经把您的原话交给貂蝉，并请相关成员从各自岗位出发讨论。她们完成后会直接在这里回复您，进度可以在左侧“任务”查看。';
    case 'planning_discussion_scheduled': return action.requestedChapterCount === null
      ? '我没有让主笔贸然批量开写。貂蝉和两位编剧会先评估这段剧情适合展开多少章，并把唯一下一章理清后请您确认。'
      : '目前还缺少可执行的下一章方案，我没有启动主笔。貂蝉会先和相关成员补齐剧情与章纲，再回来请您确认。';
    case 'planning_discussion_existing': return '前面的剧情方案还在讨论或等您确认，我没有重复开启新任务。您可以在左侧“任务”里查看进度。';
    case 'conversation_reply_scheduled': return '收到，我已经把您的原话交给貂蝉。她会结合这本书现有的资料直接回复您。';
    case 'named_member_reply_scheduled': return `好的，我已经把您的原话直接交给${String(action.memberName)}，由她本人回复。`;
    case 'pause_requested': return (action.taskIds as unknown[]).length === 0
      ? '目前没有正在运行的任务，不需要暂停。'
      : `收到，正在让 ${String((action.taskIds as unknown[]).length)} 个任务停在安全检查点，已经完成的内容不会丢失。`;
    case 'tasks_resumed': return (action.taskIds as unknown[]).length === 0
      ? '目前没有暂停中的任务。'
      : `好的，${String((action.taskIds as unknown[]).length)} 个暂停任务已经重新排队，会从保存的检查点继续。`;
    case 'cancel_requested': return (action.taskIds as unknown[]).length === 0
      ? '目前没有可以取消的任务。'
      : `已经向 ${String((action.taskIds as unknown[]).length)} 个任务发出取消请求；正在运行的模型和工具调用也已立即中断，未知的远程调用结果会先核对再决定是否重试。`;
    case 'task_overview': return Number(action.activeCount) === 0
      ? '目前没有进行中的任务。需要开始讨论或创作时，直接告诉我就好。'
      : `目前有 ${String(action.activeCount)} 个任务正在进行或等待处理${Number(action.waitingConfirmationCount) > 0 ? `，其中 ${String(action.waitingConfirmationCount)} 个等您确认` : ''}。我已经为您打开左侧“任务”。`;
    case 'knowledge_workspace_opened': return '资料库已经为您打开。这里能看到角色、地点、势力、规则、标签和正史资料；缺什么可以直接告诉我。';
    case 'takeover_prepared': return `接管资料已经准备好。确认无误后，请输入“确认接管 ${String(action.takeoverId)}”。`;
    case 'takeover_completed': return '主编接管已经完成，旧主编的未完成指令不会继续生效。';
    case 'discussion_confirmed': return action.planningPrepared === true
      ? `方案已经按您的确认保存，并形成 ${String(action.chapterOutlineCount)} 章可追溯章纲。`
      : '方案已经按您的确认保存。';
    case 'protected_operation_blocked': return String(action.receiptText ?? '这一步需要您亲自确认，我先停在这里，没有执行任何不可逆操作。');
    default: return '这条请求已经记录，但我暂时没有可显示的处理结果。您可以在左侧“任务”查看，或换一种说法告诉我。';
  }
}
