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
import { CreativeSessionService } from '../discussions/creative-session-service.js';
import { CreativeSessionRepository } from '../../infrastructure/db/repositories/creative-session-repository.js';
import { LongformContinuityRepository } from '../../infrastructure/db/repositories/longform-continuity-repository.js';
import { StageSettlementService } from '../continuity/stage-settlement-service.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';

type DiscussionPurpose = 'open_discussion' | 'creative_exploration' | 'locked_planning';
type CreativeRoundKind = 'initial_exploration' | 'major_redirect' | 'locked_planning';

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
    if (/^(?:试写|试写看看|试写一章|先试写一章)[！!。.？?\s]*$/u.test(content)) {
      const count: ChapterRequestCount = 1;
      const readiness = new WritingReadinessService(this.database).inspect(scope, count);
      if (!readiness.ready) {
        const scheduled = this.scheduleCreativeSessionMessage(
          scope,
          `老板希望先试写，不进入正史。请继续当前剧情讨论，只补齐唯一下一章所需的信息；不要提前扩写整批章纲。当前缺少：${readiness.missing.join('、')}`,
          messageId,
          conversationId,
          false
        );
        return {
          ...scheduled,
          kind: 'trial_draft_not_ready',
          requestedChapterCount: null,
          missing: readiness.missing
        };
      }
      const active = new CreativeSessionRepository(this.database).active(scope);
      if (active !== null) {
        const repository = new CreativeSessionRepository(this.database);
        repository.updateStatus(scope, {
          sessionId: active.sessionId,
          expectedStatus: active.status,
          status: active.status,
          mode: 'trial_draft',
          now: this.clock.now().toISOString()
        });
        repository.appendEvent(scope, {
          eventId: this.ids.next(),
          sessionId: active.sessionId,
          eventType: 'action',
          sourceMessageId: messageId,
          payload: { action: 'request_trial_draft' },
          now: this.clock.now().toISOString()
        });
      }
      const batch = new ChapterBatchService(
        this.database, this.dataDir, this.releaseId, this.ids, this.clock
      ).scheduleNewChapters(scope, count, { productionMode: 'trial_draft' });
      return { kind: 'trial_draft_scheduled', batchId: batch.batchId, count };
    }
    if (/^(?:写[一1]章|开始写|继续写)$/u.test(content)) {
      if (attachmentContext.length > 0) {
        return {
          ...this.scheduleCreativeSessionMessage(
            scope,
            `老板要求开始创作并附加了临时资料。先核对附件与当前正史、明确其用途，再细化唯一下一章；附件未确认，不能写入正史。\n\n${modelContent}`,
            messageId,
            conversationId,
            false
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
        const scheduled = this.scheduleCreativeSessionMessage(
          scope, appendAttachmentContext(scopeText, attachmentContext), messageId, conversationId, false
        );
        return { ...scheduled, kind: 'planning_discussion_scheduled', requestedChapterCount: null, missing: readiness.missing };
      }
      const active = new CreativeSessionRepository(this.database).active(scope);
      if (active !== null) {
        new CreativeSessionRepository(this.database).updateStatus(scope, {
          sessionId: active.sessionId,
          expectedStatus: active.status,
          status: active.status,
          mode: 'formal_production',
          now: this.clock.now().toISOString()
        });
      }
      const batch = new ChapterBatchService(this.database, this.dataDir, this.releaseId, this.ids, this.clock)
        .scheduleNewChapters(scope, count, { productionMode: 'formal_production' });
      return { kind: 'chapter_batch_scheduled', batchId: batch.batchId, count };
    }
    if (/^写[三四五345]章$/u.test(content)) {
      return {
        ...this.scheduleCreativeSessionMessage(
          scope,
          appendAttachmentContext(
            `老板希望连续推进多章，但正式正文必须逐章点评、逐章确认和逐章结算。先继续讨论并锁定剧情方向，方向锁定后再评估跨度和细化唯一下一章。原话：${content}`,
            attachmentContext
          ),
          messageId,
          conversationId,
          false
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
      return planning
        ? this.scheduleCreativeSessionMessage(
            scope, appendAttachmentContext(scopeText, attachmentContext), messageId, conversationId, false
          )
        : this.scheduleDiscussion(
            scope, appendAttachmentContext(scopeText, attachmentContext), messageId, conversationId,
            'open_discussion', null
          );
    }
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    if (content === '暂停' || intake?.selectedAction === 'pause_tasks') {
      const working = tasks.list(scope).filter((task) => task.status === 'working');
      for (const task of working) tasks.requestPause(scope, task.taskId);
      const session = new CreativeSessionService(this.database, this.ids, this.clock).pauseActive(scope, messageId);
      return {
        kind: 'pause_requested',
        taskIds: working.map((task) => task.taskId),
        creativeSessionId: session?.sessionId ?? null,
        creativeSessionStatus: session?.status ?? null
      };
    }
    if (content === '继续' || intake?.selectedAction === 'resume_tasks') {
      const paused = tasks.list(scope).filter((task) => task.status === 'paused');
      for (const task of paused) tasks.queue(scope, task.taskId);
      const session = new CreativeSessionService(this.database, this.ids, this.clock).resumeActive(scope, messageId);
      return {
        kind: 'tasks_resumed',
        taskIds: paused.map((task) => task.taskId),
        creativeSessionId: session?.sessionId ?? null,
        creativeSessionStatus: session?.status ?? null
      };
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
      return this.confirmDiscussionDecision(
        scope,
        confirmDecision[1]!,
        messageId,
        conversationId
      );
    }
    const closeStoryArc = /^(?:这段剧情结束了|当前剧情阶段结束|阶段结束(?:，|,)?生成总结|结算当前剧情阶段)(?:[：:]\s*(.+))?[。.\s]*$/u.exec(content);
    if (closeStoryArc !== null) {
      const settlement = new StageSettlementService(
        new LongformContinuityRepository(this.database),
        new UnitOfWork(this.database),
        this.ids,
        this.clock
      ).closeCurrentStoryArc(scope, closeStoryArc[1]?.trim() || '当前剧情阶段');
      return {
        kind: 'story_arc_settled',
        settlementId: settlement.settlementId,
        chapterStart: settlement.chapterStart,
        chapterEnd: settlement.chapterEnd
      };
    }
    if (/^(?:锁定当前方向|就按这个方向|按主编推荐(?:的方向)?|确定这个方向)[！!。.？?\s]*$/u.test(content)) {
      const active = new CreativeSessionRepository(this.database).active(scope);
      if (active === null) throw new Error('当前没有可锁定方向的创作会话');
      const latest = this.database.prepare(`
        SELECT r.completed_decision_id AS decision_id
        FROM creative_session_rounds r
        JOIN discussions d ON d.discussion_id = r.discussion_id
        JOIN tasks t ON t.owner_id = r.owner_id AND t.book_id = r.book_id
          AND t.task_type = 'discussion'
          AND json_extract(t.task_brief_json, '$.discussionId') = r.discussion_id
        WHERE r.creative_session_id = ? AND r.owner_id = ? AND r.book_id = ?
          AND r.round_kind IN ('initial_exploration', 'major_redirect')
          AND r.status = 'completed' AND d.status = 'awaiting_boss'
          AND json_extract(t.task_brief_json, '$.purpose') = 'creative_exploration'
        ORDER BY r.round_number DESC LIMIT 1
      `).get(active.sessionId, scope.ownerId, scope.bookId) as { decision_id: string | null } | undefined;
      if (latest?.decision_id === null || latest?.decision_id === undefined) {
        throw new Error('当前创作会话还没有可锁定的主编方向结论');
      }
      return this.confirmDiscussionDecision(scope, latest.decision_id, messageId, conversationId);
    }
    if (/^(?:确认当前规划|确认当前方案|就按当前规划|采用当前方案)[！!。.？?\s]*$/u.test(content)) {
      const latest = this.database.prepare(`
        SELECT d.decision_id
        FROM discussion_decisions d
        JOIN discussions x ON x.discussion_id = d.discussion_id
        JOIN tasks t ON t.owner_id = d.owner_id AND t.book_id = d.book_id
          AND t.task_type = 'discussion'
          AND json_extract(t.task_brief_json, '$.discussionId') = d.discussion_id
        WHERE d.owner_id = ? AND d.book_id = ? AND x.status = 'awaiting_boss'
          AND COALESCE(json_extract(t.task_brief_json, '$.purpose'), 'open_discussion') <> 'creative_exploration'
        ORDER BY t.created_at DESC LIMIT 1
      `).get(scope.ownerId, scope.bookId) as { decision_id: string } | undefined;
      if (latest === undefined) throw new Error('当前没有等待确认的规划或方案');
      return this.confirmDiscussionDecision(scope, latest.decision_id, messageId, conversationId);
    }
    const activeCreativeSession = new CreativeSessionRepository(this.database).active(scope);
    if (
      intake?.routeClass === 'plot_discussion'
      || isCreativeIntent(content)
      || activeCreativeSession !== null
    ) {
      return this.scheduleCreativeSessionMessage(
        scope, modelContent, messageId, conversationId,
        isMajorCreativeRedirect(content)
      );
    }
    return this.scheduleConversationReply(scope, modelContent, messageId, conversationId);
  }

  private scheduleConversationReply(
    scope: BookScope,
    content: string,
    messageId: string,
    conversationId: string,
    creativeSession?: { sessionId: string; blackboardRevision: number; action: 'continue_discussion' }
  ): Record<string, unknown> {
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
      brief: {
        conversationId, messageId, content, modelSnapshotId: editor.model_snapshot_id,
        ...(creativeSession === undefined ? {} : {
          creativeSessionId: creativeSession.sessionId,
          creativeBlackboardRevision: creativeSession.blackboardRevision,
          creativeSessionAction: creativeSession.action
        })
      }
    });
    tasks.queue(scope, taskId);
    return {
      kind: creativeSession === undefined ? 'conversation_reply_scheduled' : 'creative_session_continued',
      taskId,
      agentId: lease.active_editor_agent_id,
      ...(creativeSession === undefined ? {} : {
        sessionId: creativeSession.sessionId,
        blackboardRevision: creativeSession.blackboardRevision
      })
    };
  }

  private scheduleCreativeSessionMessage(
    scope: BookScope,
    content: string,
    messageId: string,
    conversationId: string,
    forceMajorRedirect: boolean
  ): Record<string, unknown> {
    const intake = new CreativeSessionService(this.database, this.ids, this.clock).receiveOwnerMessage(scope, {
      conversationId,
      messageId,
      content
    });
    if (!intake.created && !forceMajorRedirect) {
      return this.scheduleConversationReply(scope, content, messageId, conversationId, {
        sessionId: intake.session.sessionId,
        blackboardRevision: intake.blackboard.revision,
        action: 'continue_discussion'
      });
    }
    const roundKind: CreativeRoundKind = intake.created ? 'initial_exploration' : 'major_redirect';
    const scheduled = this.scheduleDiscussion(
      scope,
      content,
      messageId,
      conversationId,
      'creative_exploration',
      null,
      {
        sessionId: intake.session.sessionId,
        blackboardRevision: intake.blackboard.revision,
        sourceFingerprint: intake.blackboard.sourceFingerprint,
        roundKind
      }
    );
    return {
      ...scheduled,
      kind: intake.created ? 'creative_session_started' : 'creative_session_round_scheduled',
      sessionId: intake.session.sessionId,
      blackboardRevision: intake.blackboard.revision,
      roundKind
    };
  }

  private confirmDiscussionDecision(
    scope: BookScope,
    decisionId: string,
    sourceMessageId: string,
    conversationId: string
  ): Record<string, unknown> {
    const row = this.database.prepare(`
      SELECT d.discussion_id, d.recommendation_json, t.task_brief_json
      FROM discussion_decisions d
      JOIN discussions x ON x.discussion_id = d.discussion_id
      JOIN tasks t ON t.owner_id = d.owner_id AND t.book_id = d.book_id
        AND t.task_type = 'discussion'
        AND json_extract(t.task_brief_json, '$.discussionId') = d.discussion_id
      WHERE d.decision_id = ? AND d.owner_id = ? AND d.book_id = ?
        AND x.status = 'awaiting_boss'
      ORDER BY t.created_at DESC LIMIT 1
    `).get(decisionId, scope.ownerId, scope.bookId) as {
      discussion_id: string;
      recommendation_json: string;
      task_brief_json: string;
    } | undefined;
    if (row === undefined) throw new Error('待确认方案不存在、已处理或不属于当前书籍');
    const brief = JSON.parse(row.task_brief_json) as {
      purpose?: DiscussionPurpose;
      creativeSessionId?: string;
    };
    new DiscussionService(this.database, this.ids, this.clock).confirm(scope, row.discussion_id, decisionId);

    if (brief.purpose === 'creative_exploration' && brief.creativeSessionId !== undefined) {
      const recommendation = JSON.parse(row.recommendation_json) as Record<string, unknown>;
      const summary = typeof recommendation.summary === 'string'
        ? recommendation.summary
        : JSON.stringify(recommendation.summary ?? recommendation);
      const blackboard = new CreativeSessionService(this.database, this.ids, this.clock).lockDirection(scope, {
        sessionId: brief.creativeSessionId,
        decisionId,
        summary,
        sourceMessageId
      });
      const scheduled = this.scheduleDiscussion(
        scope,
        `老板已锁定方向。锁定决定：${summary}`,
        sourceMessageId,
        conversationId,
        'locked_planning',
        null,
        {
          sessionId: brief.creativeSessionId,
          blackboardRevision: blackboard.revision,
          sourceFingerprint: blackboard.sourceFingerprint,
          roundKind: 'locked_planning'
        }
      );
      return {
        ...scheduled,
        kind: 'creative_direction_locked',
        sourceDiscussionId: row.discussion_id,
        sourceDecisionId: decisionId,
        sessionId: brief.creativeSessionId
      };
    }

    const prepared = new PlanningArtifactService(this.database, this.ids, this.clock)
      .promoteIfPlanningTask(scope, row.discussion_id, decisionId);
    if (brief.purpose === 'locked_planning' && brief.creativeSessionId !== undefined) {
      if (prepared === null) throw new Error('锁定规划已经确认，但未能生成滚动规划资料');
      const repository = new CreativeSessionRepository(this.database);
      const session = repository.require(scope, brief.creativeSessionId);
      repository.updateStatus(scope, {
        sessionId: session.sessionId,
        expectedStatus: session.status,
        status: 'ready',
        mode: 'formal_production',
        now: this.clock.now().toISOString()
      });
    }
    return {
      kind: 'discussion_confirmed',
      discussionId: row.discussion_id,
      decisionId,
      planningPrepared: prepared !== null,
      chapterOutlineCount: prepared?.chapterOutlineVersionIds.length ?? 0
    };
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
    requestedChapterCount: ChapterRequestCount | null,
    creativeSession?: {
      sessionId: string;
      blackboardRevision: number;
      sourceFingerprint: string;
      roundKind: CreativeRoundKind;
    }
  ): Record<string, unknown> {
    const lease = this.requireEditorLease(scope);
    const creativePurpose = purpose === 'creative_exploration' || purpose === 'locked_planning';
    const roleKeys = creativePurpose
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
    `).all(scope.ownerId, scope.bookId, lease.active_editor_agent_id, ...roleKeys, creativePurpose ? 2 : 1) as unknown as Array<{ agent_id: string; role_key: string }>;
    if (specialists.length === 0) throw new Error('没有与讨论范围匹配的岗位');
    for (const specialist of specialists) {
      this.database.prepare(`UPDATE agent_instances SET activation_state = 'idle', updated_at = ? WHERE owner_id = ? AND book_id = ? AND agent_id = ?`)
        .run(this.clock.now().toISOString(), scope.ownerId, scope.bookId, specialist.agent_id);
    }
    const discussion = new DiscussionService(this.database, this.ids, this.clock).create(scope, {
      type: creativePurpose ? 'collaborative' : 'quick',
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
      brief: {
        discussionId: discussion.discussionId,
        scopeText,
        conversationId,
        purpose,
        requestedChapterCount,
        ...(creativeSession === undefined ? {} : {
          creativeSessionId: creativeSession.sessionId,
          creativeBlackboardRevision: creativeSession.blackboardRevision,
          creativeSourceFingerprint: creativeSession.sourceFingerprint,
          roundKind: creativeSession.roundKind
        })
      }
    });
    if (creativeSession !== undefined) {
      const repository = new CreativeSessionRepository(this.database);
      repository.linkRound(scope, {
        roundId: this.ids.next(),
        sessionId: creativeSession.sessionId,
        discussionId: discussion.discussionId,
        roundKind: creativeSession.roundKind,
        blackboardRevision: creativeSession.blackboardRevision,
        sourceFingerprint: creativeSession.sourceFingerprint,
        now: this.clock.now().toISOString()
      });
      repository.appendEvent(scope, {
        eventId: this.ids.next(),
        sessionId: creativeSession.sessionId,
        eventType: 'round_opened',
        sourceMessageId: messageId,
        payload: { discussionId: discussion.discussionId, roundKind: creativeSession.roundKind },
        now: this.clock.now().toISOString()
      });
    }
    tasks.queue(scope, taskId);
    return {
      kind: 'discussion_scheduled',
      purpose,
      discussionId: discussion.discussionId,
      taskId,
      participants: discussion.participants.map((item) => item.agentId),
      ...(creativeSession === undefined ? {} : {
        sessionId: creativeSession.sessionId,
        roundKind: creativeSession.roundKind
      })
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
        AND json_extract(t.task_brief_json, '$.purpose') IN ('creative_exploration', 'locked_planning')
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
  return /讨论|小说|故事|剧情|情节|题材|游戏文|主角|角色|人物|设定|世界观|开局|结局|冲突|转折|节奏|文风|大纲|章纲|第一章|下一章|钩子|我想写|怎么写/u.test(content);
}

function isMajorCreativeRedirect(content: string): boolean {
  return /^(?:重大改向|重大调整|推翻当前方向|换一条完全不同的路线|重新让两位编剧推演)(?:[：:\s]|$)/u.test(content.trim());
}

function actionNotice(action: Record<string, unknown>): string {
  switch (action.kind) {
    case 'local_assistant_reply': return action.topic === 'identity'
      ? '我是小文秘书，负责接收消息、整理附件、查看任务和安排合适的成员。剧情、正文和正史仍由创作成员与您确认，我不会替她们作答。'
      : '我在。您可以直接说想聊的剧情、点名成员，或者让我查看任务和资料；需要创作判断时，我会把您的原话交给合适的成员。';
    case 'chapter_batch_scheduled': return '好的，下一章已经交给主笔。完成三轮独立点评后，我会把稿件带回来请您确认；在您确认前，它不会进入正史。';
    case 'trial_draft_scheduled': return '好的，已安排试写一章。它只会保留为可修改的临时稿，不启动正式三席审校，也不会进入正史；满意后再点“定稿”进入正式审校。';
    case 'trial_draft_not_ready': return `可以先试写，但还缺少唯一下一章所需的信息：${(action.missing as string[]).join('、')}。貂蝉会在当前会话里继续问清，不会直接让主笔盲写。`;
    case 'discussion_scheduled': return '收到，我已经把您的原话交给貂蝉，并请相关成员从各自岗位出发讨论。她们完成后会直接在这里回复您，进度可以在左侧“任务”查看。';
    case 'planning_discussion_scheduled': return action.requestedChapterCount === null
      ? '我没有让主笔贸然批量开写。貂蝉和两位编剧会先评估这段剧情适合展开多少章，并把唯一下一章理清后请您确认。'
      : '目前还缺少可执行的下一章方案，我没有启动主笔。貂蝉会先和相关成员补齐剧情与章纲，再回来请您确认。';
    case 'planning_discussion_existing': return '前面的剧情方案还在讨论或等您确认，我没有重复开启新任务。您可以在左侧“任务”里查看进度。';
    case 'conversation_reply_scheduled': return '收到，我已经把您的原话交给貂蝉。她会结合这本书现有的资料直接回复您。';
    case 'creative_session_started': return '新的剧情议题已经建立为持续创作会话。貂蝉会先主持两位异模型编剧独立推演和一次交叉质疑；这一轮只比较方向，不会提前写正文或生成整批章纲。';
    case 'creative_session_continued': return '这句话已经接在当前剧情会话里，我没有重复拉起两位编剧。貂蝉会沿着现有分歧和未决问题继续回应。';
    case 'creative_session_round_scheduled': return '收到明确的重大改向要求。我保留了原讨论记录，并为同一创作会话开启一轮新的双编剧独立推演；旧预演会标记为过期，不会混入新结论。';
    case 'creative_direction_locked': return '剧情方向已经锁定，但还没有让主笔开写。两位编剧现在会分别估算这个故事弧需要多少章，貂蝉只细化未来1至3章，完成后再请您确认。';
    case 'story_arc_settled': return `当前剧情阶段已经按第${String(action.chapterStart)}章至第${String(action.chapterEnd)}章的定稿正史完成结算。后续创作默认读取这份精简阶段记忆；遇到人物、规则、伏笔或旧因果触发时，仍会回查对应正史原文。`;
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
