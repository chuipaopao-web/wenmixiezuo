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
import { DomainError, errorCodes } from '../../domain/errors.js';
import { PlanningWorkflowRepository } from '../../infrastructure/db/repositories/planning-workflow-repository.js';
import { SettingOutlineWorkspaceService } from '../knowledge/setting-outline-workspace-service.js';
import {
  SettingGuidanceService,
  type SettingGuidanceFeedbackMode,
  type SettingGuidanceSnapshot
} from '../knowledge/setting-guidance-service.js';
import { compactLockedDecisionSummary } from '../discussions/locked-planning-context.js';
import { createHash } from 'node:crypto';
import {
  projectBossMessageForAuthor,
  sanitizeAuthorFacingConversationText
} from './author-conversation-presentation.js';
import { NarrativeProjectionService } from '../projections/narrative-projection-service.js';

export { compactLockedDecisionSummary } from '../discussions/locked-planning-context.js';

type DiscussionPurpose = 'open_discussion' | 'creative_exploration' | 'locked_planning' | 'creative_concept_panel' | 'setting_proposal_panel';
type CreativeRoundKind = 'initial_exploration' | 'major_redirect' | 'locked_planning';

export type ConversationReceptionKind =
  | 'guidance_scheduled'
  | 'guidance_in_progress'
  | 'guidance_available'
  | 'awaiting_confirmation'
  | 'guidance_paused'
  | 'guidance_failed'
  | 'guidance_cancelled'
  | 'setting_complete'
  | 'planning_next'
  | 'continuation_analysis_in_progress'
  | 'continuation_analysis_failed'
  | 'continuation_ready';

export interface ConversationReception {
  kind: ConversationReceptionKind;
  headline: string;
  message: string;
  settingItemKey?: string;
  settingLabel?: string;
  taskId?: string;
  taskStatus?: string;
  editorAgentId?: string;
  editorName?: string;
}

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

function projectConversationMessageForAuthor(row: Record<string, unknown>): Record<string, unknown> {
  if (row.sender_type === 'boss') {
    return {
      ...row,
      content: typeof row.content === 'string' ? projectBossMessageForAuthor(row.content) : row.content
    };
  }
  const content = typeof row.content === 'string'
    ? sanitizeAuthorFacingConversationText(row.content)
    : row.content;
  if (typeof row.references_json !== 'string') return { ...row, content };

  let references: unknown;
  try { references = JSON.parse(row.references_json) as unknown; } catch { return { ...row, content }; }
  if (!Array.isArray(references)) return { ...row, content };
  const projected = references.map((reference) => {
    if (!isConversationRecord(reference) || reference.type !== 'effective_output' || typeof reference.fullContent !== 'string') {
      return reference;
    }
    const fullContent = sanitizeAuthorFacingConversationText(reference.fullContent);
    return {
      ...reference,
      fullContent,
      contentHash: createHash('sha256').update(fullContent).digest('hex')
    };
  });
  return { ...row, content, references_json: JSON.stringify(projected) };
}

function isConversationRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
        AND message_type NOT IN ('onboarding_trigger', 'conversation_entry_trigger')
        AND (? IS NULL OR created_at < ? OR (created_at = ? AND message_id < ?))
      ORDER BY created_at DESC, message_id DESC LIMIT ?
    `).all(
      conversationId, scope.ownerId, scope.bookId,
      before?.created_at ?? null, before?.created_at ?? null,
      before?.created_at ?? null, before?.message_id ?? null, limit
    );
    return rows.reverse().map((row) => projectConversationMessageForAuthor(row as Record<string, unknown>));
  }

  public enterConversation(scope: BookScope): ConversationReception {
    assertBookScope(scope);
    const conversationId = this.requireConversation(scope);
    if (!this.hasStartedSettingProposalWork(scope)) {
      const continuationReception = this.continuationReception(scope);
      if (continuationReception !== null) return continuationReception;
    }
    const guidance = new SettingGuidanceService(this.database, this.ids, this.clock).ensureInitialized(scope);
    if (guidance !== null) {
      if (guidance.phase !== 'revise') {
        const existingPanel = this.findSettingProposalPanel(scope, guidance.itemKey);
        if (existingPanel !== null) {
          const lease = this.requireEditorLease(scope);
          if (['pending', 'queued', 'working'].includes(existingPanel.status)) {
            return {
              kind: 'guidance_in_progress',
              headline: `三名成员正在独立构思“${guidance.label}”`,
              message: '活动主编与两名编剧会分别给出自己的方案，彼此不会看到或评价其他人的答案。完成后，您可以任选、组合，或直接提出自己的版本。',
              settingItemKey: guidance.itemKey,
              settingLabel: guidance.label,
              taskId: existingPanel.taskId,
              taskStatus: existingPanel.status,
              editorAgentId: lease.active_editor_agent_id,
              editorName: lease.active_editor_name
            };
          }
          if (['succeeded', 'waiting_confirmation'].includes(existingPanel.status)) {
            return {
              kind: 'guidance_available',
              headline: `“${guidance.label}”的三份独立方案已经备好`,
              message: '请查看三名成员各自的方案。您可以选一份、组合喜欢的部分，或直接把自己的最终想法发给团队；系统不会替您自动合并或确认。',
              settingItemKey: guidance.itemKey,
              settingLabel: guidance.label,
              taskId: existingPanel.taskId,
              taskStatus: existingPanel.status,
              editorAgentId: lease.active_editor_agent_id,
              editorName: lease.active_editor_name
            };
          }
          if (['failed', 'blocked', 'interrupted'].includes(existingPanel.status)) {
            return {
              kind: 'guidance_failed',
              headline: `“${guidance.label}”的三人独立提案没有顺利完成`,
              message: '失败任务已经保留，不会自动重复调用模型。请在任务中心查看原因并重试；重试会从原任务继续。',
              settingItemKey: guidance.itemKey,
              settingLabel: guidance.label,
              taskId: existingPanel.taskId,
              taskStatus: existingPanel.status,
              editorAgentId: lease.active_editor_agent_id,
              editorName: lease.active_editor_name
            };
          }
          if (existingPanel.status === 'paused') {
            return {
              kind: 'guidance_paused',
              headline: '三人独立提案已经暂停',
              message: '任务进度仍然保留，可在任务中心继续。',
              settingItemKey: guidance.itemKey,
              settingLabel: guidance.label,
              taskId: existingPanel.taskId,
              taskStatus: existingPanel.status,
              editorAgentId: lease.active_editor_agent_id,
              editorName: lease.active_editor_name
            };
          }
          if (existingPanel.status === 'cancelled') {
            return {
              kind: 'guidance_cancelled',
              headline: '三人独立提案已经取消',
              message: `“${guidance.label}”仍未确认。需要继续时，请从规划页重新发起。`,
              settingItemKey: guidance.itemKey,
              settingLabel: guidance.label,
              taskId: existingPanel.taskId,
              taskStatus: existingPanel.status,
              editorAgentId: lease.active_editor_agent_id,
              editorName: lease.active_editor_name
            };
          }
        }
        if (existingPanel === null) {
          // Fail before creating any discussion rows when the book has no usable
          // budget. This keeps conversation entry retryable and side-effect free.
          this.requireBudget(scope);
          const messageId = this.ids.next();
          const now = this.clock.now().toISOString();
          const content = buildSettingProposalPanelScope(
            `请结合本书当前资料，独立提出你认为最值得采用的“${guidance.label}”方案。`,
            guidance,
            this.continuationSettingReference(scope)
          );
          // DiscussionService owns its own transaction. Validate and create the
          // discussion before writing the hidden entry marker so a dispatch
          // failure cannot leave a fake reception message behind.
          const scheduled = this.scheduleDiscussion(
            scope, content, messageId, conversationId, 'setting_proposal_panel', null
          ) as { taskId: string; editorName: string };
          this.database.prepare(`
            INSERT INTO messages (
              message_id, conversation_id, owner_id, book_id, sender_type,
              message_type, content, references_json, created_at
            ) VALUES (?, ?, ?, ?, 'system', 'conversation_entry_trigger', ?, '[]', ?)
          `).run(messageId, conversationId, scope.ownerId, scope.bookId, content, now);
          return {
            kind: 'guidance_scheduled',
            headline: '三名成员开始独立构思',
            message: `活动主编与两名编剧将分别提出一份“${guidance.label}”方案，不互相讨论，也不会替您自动做决定。`,
            settingItemKey: guidance.itemKey,
            settingLabel: guidance.label,
            taskId: scheduled.taskId,
            taskStatus: 'queued',
            editorName: scheduled.editorName
          };
        }
      }
      if (guidance.phase === 'revise') {
        return {
          kind: 'awaiting_confirmation',
          headline: `“${guidance.label}”已有候选方案`,
          message: '小文秘书已核对进度：请先查看主编整理的候选方案。满意就确认，不满意可以继续补充或要求调整。',
          settingItemKey: guidance.itemKey,
          settingLabel: guidance.label
        };
      }
      const existing = this.latestSettingReceptionTask(scope, guidance.itemKey);
      if (existing !== undefined) return this.receptionForExistingTask(guidance, existing);

      const lease = this.requireEditorLease(scope);
      const messageId = this.ids.next();
      const now = this.clock.now().toISOString();
      const content = [
        `进入对话后继续完善设定大纲的当前项“${guidance.label}”。`,
        `讨论目标：${guidance.prompt}`,
        '请先依据开书资料和已经确认的前置设定理解作者意图，再用自然、简短的方式提出一至三个真正需要作者决定的问题。',
        '剧情梗概只是参考方向；当前不要展开剧情总纲、章纲或正文，也不要替作者确认设定。'
      ].join('\n');
      const entry = new UnitOfWork(this.database).run(() => {
        // React StrictMode (and a fast double-click) can issue two entry requests.
        // Recheck after BEGIN IMMEDIATE so only one request may create the hidden
        // trigger and its model task for the current setting item.
        const concurrent = this.latestSettingReceptionTask(scope, guidance.itemKey);
        if (concurrent !== undefined) return { existing: concurrent } as const;
        this.database.prepare(`
          INSERT INTO messages (
            message_id, conversation_id, owner_id, book_id, sender_type,
            message_type, content, references_json, created_at
          ) VALUES (?, ?, ?, ?, 'system', 'conversation_entry_trigger', ?, '[]', ?)
        `).run(messageId, conversationId, scope.ownerId, scope.bookId, content, now);
        const scheduled = this.scheduleConversationReply(
          scope,
          content,
          messageId,
          conversationId,
          undefined,
          { ...guidance, phase: 'ask' },
          `conversation-entry-setting:${guidance.itemKey}`
        );
        return { scheduled } as const;
      });
      if ('existing' in entry) return this.receptionForExistingTask(guidance, entry.existing);
      const { scheduled } = entry;
      return {
        kind: 'guidance_scheduled',
        headline: `${lease.active_editor_name}正在接待`,
        message: `小文秘书已把当前进度交给${lease.active_editor_name}：先讨论“${guidance.label}”，不会提前跑去规划剧情。`,
        settingItemKey: guidance.itemKey,
        settingLabel: guidance.label,
        taskId: String(scheduled.taskId),
        taskStatus: String(scheduled.taskStatus ?? 'queued'),
        editorAgentId: lease.active_editor_agent_id,
        editorName: lease.active_editor_name
      };
    }

    const planning = new PlanningWorkflowRepository(this.database).planningState(scope);
    if (planning?.setting_baseline_version_id !== null && planning?.setting_baseline_version_id !== undefined) {
      return {
        kind: 'setting_complete',
        headline: '设定大纲已经确认',
        message: planning.stage === 'setting_ready'
          ? '小文秘书已核对全书状态：接下来可以请主编主持当前阶段剧情总纲，每次只规划一个完整事件阶段。'
          : '小文秘书已核对全书状态：设定大纲已经生效，可以继续当前规划或写作任务。'
      };
    }
    return {
      kind: 'planning_next',
      headline: '小文秘书已接待',
      message: '我正在根据这本书的真实进度整理下一步。您可以直接说想完善哪项设定，也可以先查看规划页的待讨论清单。'
    };
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
    if (intake?.selectedAction === 'preserve_continuation_handoff_packet') {
      const continuationReference = this.continuationSettingReference(scope);
      if (continuationReference === null) {
        return this.scheduleConversationReply(scope, modelContent, messageId, conversationId);
      }
      const guidance = new SettingGuidanceService(this.database, this.ids, this.clock).ensureInitialized(scope);
      if (guidance === null) {
        return this.scheduleConversationReply(scope, modelContent, messageId, conversationId);
      }
      const existingPanel = this.findSettingProposalPanel(scope, guidance.itemKey);
      if (existingPanel !== null && ['pending', 'queued', 'working', 'paused', 'succeeded'].includes(existingPanel.status)) {
        const lease = this.requireEditorLease(scope);
        return {
          kind: 'discussion_scheduled',
          purpose: 'setting_proposal_panel',
          discussionId: existingPanel.discussionId,
          taskId: existingPanel.taskId,
          editorName: lease.active_editor_name,
          participants: existingPanel.participants
        };
      }
      return this.scheduleDiscussion(
        scope,
        buildSettingProposalPanelScope(modelContent, guidance, continuationReference),
        messageId,
        conversationId,
        'setting_proposal_panel',
        null
      );
    }
    const settingWorkAllowed = !this.hasImportedManuscript(scope) || this.hasStartedSettingProposalWork(scope);
    if (!isOperationalControlMessage(content, intake) && settingWorkAllowed) {
      const guidanceService = new SettingGuidanceService(this.database, this.ids, this.clock);
      const guidance = guidanceService.ensureInitialized(scope);
      if (guidance !== null && intake?.routeClass !== 'named_member') {
        if (isNaturalSettingConfirmation(content) && guidance.status !== '候选待确认') {
          return this.scheduleConversationReply(
            scope,
            `当前设定项“${guidance.label}”还没有形成可确认的候选。请只继续询问这一项，不要进入剧情。`,
            messageId,
            conversationId,
            undefined,
            { ...guidance, phase: 'ask' }
          );
        }
        if (isNaturalSettingConfirmation(content) && guidance.status === '候选待确认') {
          const advanced = guidanceService.confirmCurrent(scope);
          if (advanced.completed || advanced.next === null) {
            const continuationReference = this.continuationSettingReference(scope);
            if (continuationReference !== null) {
              const scheduled = this.scheduleDiscussion(
                scope,
                [
                  '【剧情总纲专项讨论资料包】',
                  '创作方式：已有正文续写。设定大纲已经由老板逐项确认。',
                  '任务：依据已确认设定、已导入正文和逐章反向章纲，只整理正文已经覆盖的第一阶段剧情总纲。',
                  '边界：不得重写正文，不得把开书简介当成已发生事实；阶段范围以现有正文首章到末章为准，最多50章。',
                  continuationReference
                ].join('\n'),
                messageId,
                conversationId,
                'open_discussion',
                null
              );
              return {
                kind: 'setting_guidance_completed',
                confirmedItemKey: advanced.confirmedItemKey,
                settingStage: 'setting_ready',
                nextAction: 'continuation_stage_outline_scheduled',
                discussionId: scheduled.discussionId,
                taskId: scheduled.taskId,
                participants: scheduled.participants
              };
            }
            return {
              kind: 'setting_guidance_completed',
              confirmedItemKey: advanced.confirmedItemKey,
              settingStage: 'setting_ready'
            };
          }
          const scheduled = this.scheduleDiscussion(
            scope,
            buildSettingProposalPanelScope(
              `老板已经确认上一项。请分别独立提出下一项“${advanced.next.label}”的方案。`,
              { ...advanced.next, phase: 'ask' },
              this.continuationSettingReference(scope)
            ),
            messageId,
            conversationId,
            'setting_proposal_panel',
            null
          );
          return { ...scheduled, confirmedSettingItemKey: advanced.confirmedItemKey };
        }
      const settingProposalPanel = this.findSettingProposalPanel(scope, guidance.itemKey);
      if (isExplicitSettingProposalPanelRequest(content)) {
        if (
          settingProposalPanel !== null
          && ['pending', 'queued', 'working', 'paused'].includes(settingProposalPanel.status)
        ) {
          const lease = this.requireEditorLease(scope);
          return {
            kind: 'discussion_scheduled',
            purpose: 'setting_proposal_panel',
            discussionId: settingProposalPanel.discussionId,
            taskId: settingProposalPanel.taskId,
            editorName: lease.active_editor_name,
            participants: settingProposalPanel.participants
          };
        }
        return this.scheduleDiscussion(
          scope,
          buildSettingProposalPanelScope(modelContent, guidance, this.continuationSettingReference(scope)),
          messageId,
          conversationId,
          'setting_proposal_panel',
          null
        );
      }
      if (
        guidance.status !== '候选待确认'
        && settingProposalPanel === null
      ) {
          return this.scheduleDiscussion(
            scope,
            buildSettingProposalPanelScope(modelContent, guidance, this.continuationSettingReference(scope)),
            messageId,
            conversationId,
            'setting_proposal_panel',
            null
          );
        }
        if (
          guidance.status !== '候选待确认'
          && settingProposalPanel !== null
          && settingProposalPanel.status !== 'succeeded'
        ) {
          const lease = this.requireEditorLease(scope);
          return {
            kind: 'discussion_scheduled',
            purpose: 'setting_proposal_panel',
            discussionId: settingProposalPanel.discussionId,
            taskId: settingProposalPanel.taskId,
            editorName: lease.active_editor_name,
            participants: settingProposalPanel.participants
          };
        }
        const downstreamBlocked = isDownstreamPlanningRequest(content);
        const proposalOptions = this.settingProposalOptions(scope, guidance.itemKey);
        const selectionNumbers = parseSettingSelectionNumbers(content, proposalOptions.map((option) => option.number));
        const feedbackMode = selectionNumbers.length > 0
          ? 'numeric_selection'
          : guidance.status === '候选待确认'
            ? classifySettingFeedback(content)
            : 'initial';
        const dissatisfactionRound = ['vague_dissatisfaction', 'replace_direction'].includes(feedbackMode)
          ? this.settingDissatisfactionRound(scope, guidance.itemKey) + 1
          : 0;
        const phase = downstreamBlocked || isGuidancePromptRequest(content)
          ? 'ask'
          : selectionNumbers.length > 0 || guidance.status === '候选待确认' ? 'revise' : 'collect';
        const scheduled = this.scheduleConversationReply(
          scope,
          downstreamBlocked
            ? `老板希望进入后续创作阶段，但当前设定项“${guidance.label}”尚未确认。请只继续完成这一项。老板原话：${modelContent}`
            : modelContent,
          messageId,
          conversationId,
          undefined,
          {
            ...guidance,
            phase,
            feedbackMode,
            dissatisfactionRound,
            ...(proposalOptions.length === 0 ? {} : { proposalOptions }),
            ...(selectionNumbers.length === 0 ? {} : { selectionNumbers })
          }
        );
        return {
          ...scheduled,
          ...(downstreamBlocked ? { blockedBy: 'setting_baseline_not_confirmed' } : {})
        };
      }
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
    const settingDiscussionMatch = /^讨论设定\s+([\s\S]+)$/u.exec(content);
    if (settingDiscussionMatch !== null) {
      const scopeText = settingDiscussionMatch[1]!.trim();
      if (scopeText.length < 2) throw new Error('请在“讨论设定”后写明具体设定项');
      return this.scheduleDiscussion(
        scope,
        appendAttachmentContext(scopeText, attachmentContext),
        messageId,
        conversationId,
        'open_discussion',
        null
      );
    }
    const discussionMatch = /^讨论\s+([\s\S]+)$/u.exec(content)
      ?? /^讨论((?:剧情)?总纲[\s\S]*)$/u.exec(content);
    if (discussionMatch !== null) {
      const scopeText = discussionMatch[1]!.trim();
      if (scopeText.length < 2) throw new Error('请在“讨论”后写明具体问题');
      const explicitMasterOutline = /^(?:剧情)?总纲(?:升级|重做|修订|重新讨论|最终版|替换版|最终替换版)?(?:\s|：|:|$)/u.test(scopeText)
        || scopeText.includes('【剧情总纲专项讨论资料包】');
      const planning = explicitMasterOutline || isCreativeIntent(scopeText);
      if (planning) {
        const planningState = new PlanningWorkflowRepository(this.database).planningState(scope);
        const usesStagedOpening = new PlanningWorkflowRepository(this.database).openingBlueprint(scope) !== undefined;
        const settingBaselineConfirmed = planningState !== undefined
          && planningState.setting_baseline_version_id !== null
          && !['style_in_progress', 'style_ready', 'setting_in_progress'].includes(planningState.stage);
        if (usesStagedOpening && explicitMasterOutline) {
          if (!settingBaselineConfirmed) {
            return {
              ...this.scheduleConversationReply(
                scope,
                appendAttachmentContext(
                  [
                    '老板要求讨论剧情总纲，但本书设定大纲尚未确认。',
                    '请活动主编先继续主持设定大纲，只说明当前创作真正缺少的最小前置设定，每轮询问1—3个高价值问题。',
                    '在设定大纲确认前，不得启动双编剧、剧情跨度评估、剧情总纲、章纲或正文。',
                    `老板原话：${content}`
                  ].join('\n'),
                  attachmentContext
                ),
                messageId,
                conversationId
              ),
              blockedBy: 'setting_baseline_not_confirmed',
              missing: ['已确认的设定大纲']
            };
          }
          return this.scheduleDiscussion(
            scope,
            appendAttachmentContext(`【剧情总纲专项讨论资料包】\n${scopeText}`, attachmentContext),
            messageId,
            conversationId,
            'open_discussion',
            null
          );
        }
        if (usesStagedOpening && planningState !== undefined && ['setting_ready', 'master_outline_in_progress'].includes(planningState.stage)) {
          return this.scheduleDiscussion(
            scope,
            appendAttachmentContext(`【剧情总纲专项讨论资料包】\n${scopeText}`, attachmentContext),
            messageId,
            conversationId,
            'open_discussion',
            null
          );
        }
        return this.scheduleCreativeSessionMessage(
          scope, appendAttachmentContext(scopeText, attachmentContext), messageId, conversationId, false
        );
      }
      return this.scheduleDiscussion(
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
      new NarrativeProjectionService(this.database, this.ids, this.clock).rebuild(scope);
      return {
        kind: 'story_arc_settled',
        settlementId: settlement.settlementId,
        chapterStart: settlement.chapterStart,
        chapterEnd: settlement.chapterEnd
      };
    }
    if (/^(?:锁定当前方向|就按这个方向|按主编推荐(?:的方向)?|确定这个方向)(?:[！!。.？?\s]*|[：:，,]\s*[\s\S]+)$/u.test(content)) {
      const active = new CreativeSessionRepository(this.database).active(scope);
      if (active === null) {
        throw new DomainError(errorCodes.operationIncomplete, '当前没有可锁定方向的创作会话，请先让主编和编剧完成一次剧情方向讨论', {}, false, 409);
      }
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
        throw new DomainError(
          errorCodes.operationIncomplete,
          '当前创作会话还没有可锁定的主编方向结论，请先让主编和编剧完成剧情方向讨论',
          {},
          false,
          409
        );
      }
      return this.confirmDiscussionDecision(
        scope,
        latest.decision_id,
        messageId,
        conversationId,
        lockDirectionNote(content)
      );
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
      if (latest === undefined) {
        throw new DomainError(errorCodes.operationIncomplete, '当前没有等待确认的规划或方案，请先完成规划讨论', {}, false, 409);
      }
      return this.confirmDiscussionDecision(scope, latest.decision_id, messageId, conversationId);
    }
    const activeCreativeSession = new CreativeSessionRepository(this.database).active(scope);
    const planningRepository = new PlanningWorkflowRepository(this.database);
    const planningState = planningRepository.planningState(scope);
    const usesStagedOpening = planningRepository.openingBlueprint(scope) !== undefined;
    if (
      intake?.routeClass === 'plot_discussion'
      || isCreativeIntent(content)
      || activeCreativeSession !== null
    ) {
      if (
        activeCreativeSession === null
        && usesStagedOpening
        && planningState !== undefined
        && !['master_outline_ready', 'chapter_outline_ready', 'writing_enabled'].includes(planningState.stage)
      ) {
        return this.scheduleConversationReply(
          scope,
          appendAttachmentContext(
            `当前仍在“${planningState.stage}”阶段。请先按设定大纲、剧情总纲的顺序完成并确认前置内容；本轮由主编先理解和追问，不启动正文规划。\n老板原话：${content}`,
            attachmentContext
          ),
          messageId,
          conversationId
        );
      }
      return this.scheduleCreativeSessionMessage(
        scope, modelContent, messageId, conversationId,
        isMajorCreativeRedirect(content)
      );
    }
    return this.scheduleConversationReply(scope, modelContent, messageId, conversationId);
  }

  private hasImportedManuscript(scope: BookScope): boolean {
    return this.database.prepare(`
      SELECT 1 FROM continuation_imports
      WHERE owner_id = ? AND book_id = ? AND status = 'ready'
      ORDER BY completed_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) !== undefined;
  }

  private hasStartedSettingProposalWork(scope: BookScope): boolean {
    return this.database.prepare(`
      SELECT 1 FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
        AND json_extract(task_brief_json, '$.purpose') = 'setting_proposal_panel'
      ORDER BY created_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) !== undefined;
  }

  private continuationSettingReference(scope: BookScope): string | null {
    const row = this.database.prepare(`
      SELECT baseline_id, summary_text, structured_json,
        analyzed_chapter_count, total_chapter_count, canon_revision
      FROM continuation_baselines
      WHERE owner_id = ? AND book_id = ? AND status = 'ready'
      ORDER BY completed_at DESC, updated_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) as {
      baseline_id: string;
      summary_text: string | null;
      structured_json: string;
      analyzed_chapter_count: number;
      total_chapter_count: number;
      canon_revision: number;
    } | undefined;
    if (row === undefined) return null;
    let structured: Record<string, unknown> = {};
    try {
      structured = JSON.parse(row.structured_json) as Record<string, unknown>;
    } catch {
      structured = {};
    }
    const outlines = Array.isArray(structured.chapterOutlines)
      ? structured.chapterOutlines as Array<Record<string, unknown>>
      : [];
    const selected = outlines.length <= 8
      ? outlines
      : [...outlines.slice(0, 3), ...outlines.slice(-5)];
    const compactOutlines = selected.map((outline) => ({
      chapterNumber: outline.chapterNumber,
      title: outline.title,
      chapterGoal: outline.chapterGoal,
      cast: outline.cast,
      centralConflict: outline.centralConflict,
      ending: outline.ending
    }));
    return clipText([
      '【已有正文反向整理参考】',
      '权威说明：以下是从作者已确认正文派生的可重建摘要；发生冲突时必须回查正文原文。',
      `已分析章节：${row.analyzed_chapter_count}/${row.total_chapter_count}；正史修订：${row.canon_revision}`,
      `前文总览：${row.summary_text?.trim() || '暂无总览'}`,
      `逐章反向章纲（首尾抽样）：${JSON.stringify(compactOutlines)}`
    ].join('\n'), 2_400);
  }

  private settingProposalOptions(
    scope: BookScope,
    itemKey: string
  ): Array<{ number: number; memberName: string; content: string }> {
    const panel = this.findSettingProposalPanel(scope, itemKey);
    if (panel === null) return [];
    const rows = this.database.prepare(`
      SELECT m.content, a.display_name AS member_name,
        CAST(json_extract(m.references_json, '$[0].proposalNumber') AS INTEGER) AS proposal_number
      FROM messages m
      LEFT JOIN agent_instances a
        ON a.agent_id = m.sender_agent_id
        AND a.owner_id = m.owner_id AND a.book_id = m.book_id
      WHERE m.owner_id = ? AND m.book_id = ?
        AND m.message_type = 'setting_proposal'
        AND json_extract(m.references_json, '$[0].discussionId') = ?
      ORDER BY proposal_number, m.created_at, m.message_id
    `).all(scope.ownerId, scope.bookId, panel.discussionId) as unknown as Array<{
      content: string;
      member_name: string | null;
      proposal_number: number | null;
    }>;
    return rows.flatMap((row, index) => {
      const number = row.proposal_number ?? index + 1;
      if (!Number.isInteger(number) || number < 1 || number > 9) return [];
      const content = row.content.split('\n\n三份都是独立候选。', 1)[0]?.trim() ?? '';
      return [{
        number,
        memberName: row.member_name?.trim() || `成员${number}`,
        content: clipText(content, 720)
      }];
    });
  }

  private continuationReception(scope: BookScope): ConversationReception | null {
    const row = this.database.prepare(`
      SELECT i.continuation_import_id, i.imported_chapter_count,
        COALESCE(b.status, 'not_started') AS analysis_status,
        COALESCE(b.analyzed_chapter_count, 0) AS analyzed_chapter_count,
        COALESCE(b.total_chapter_count, i.imported_chapter_count) AS total_chapter_count,
        b.error_message
      FROM continuation_imports i
      LEFT JOIN continuation_baselines b
        ON b.owner_id = i.owner_id AND b.book_id = i.book_id
          AND b.continuation_import_id = i.continuation_import_id
      WHERE i.owner_id = ? AND i.book_id = ? AND i.status = 'ready'
      ORDER BY i.completed_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) as {
      continuation_import_id: string;
      imported_chapter_count: number;
      analysis_status: string;
      analyzed_chapter_count: number;
      total_chapter_count: number;
      error_message: string | null;
    } | undefined;
    if (row === undefined) return null;
    if (row.analysis_status === 'ready') {
      return {
        kind: 'continuation_ready',
        headline: `已有正文的 ${row.imported_chapter_count} 章已经整理完成`,
        message: '主编会以作者原文为准，并按需检索逐章摘要、人物当前状态、事件、规则和未回收线索。接下来只确认原文中的空缺、冲突和续写方向，不会要求您重新从空白设定大纲开始。'
      };
    }
    if (row.analysis_status === 'failed') {
      return {
        kind: 'continuation_analysis_failed',
        headline: '已有正文已保存，但逐章整理没有完成',
        message: `正文不会丢失或回滚。请到“正文—批量识别整本TXT”查看失败原因并重试；完成后主编会从续写基线接待。${row.error_message === null ? '' : ` 原因：${row.error_message}`}`
      };
    }
    return {
      kind: 'continuation_analysis_in_progress',
      headline: '已有正文正在逐章整理',
      message: `文姬正在提炼章节信息（${row.analyzed_chapter_count}/${row.total_chapter_count}）。正文已经安全保存；整理完成后，主编会以已有正文为基础讨论续写，不再从空白设定开始。`
    };
  }

  private settingDissatisfactionRound(scope: BookScope, itemKey: string): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type = 'conversation_reply'
        AND json_extract(task_brief_json, '$.settingGuidance.itemKey') = ?
        AND json_extract(task_brief_json, '$.settingGuidance.feedbackMode')
          IN ('vague_dissatisfaction', 'replace_direction')
    `).get(scope.ownerId, scope.bookId, itemKey) as { count: number };
    return Number(row.count);
  }

  private latestSettingReceptionTask(scope: BookScope, itemKey: string): {
    task_id: string;
    status: string;
    error_code: string | null;
    assigned_agent_id: string | null;
    editor_name: string | null;
  } | undefined {
    return this.database.prepare(`
      SELECT t.task_id, t.status, t.error_code, t.assigned_agent_id,
        a.display_name AS editor_name
      FROM tasks t
      LEFT JOIN agent_instances a ON a.owner_id = t.owner_id AND a.book_id = t.book_id
        AND a.agent_id = t.assigned_agent_id
      WHERE t.owner_id = ? AND t.book_id = ? AND t.task_type = 'conversation_reply'
        AND json_extract(t.task_brief_json, '$.settingGuidance.itemKey') = ?
      ORDER BY t.created_at DESC, t.task_id DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, itemKey) as {
      task_id: string;
      status: string;
      error_code: string | null;
      assigned_agent_id: string | null;
      editor_name: string | null;
    } | undefined;
  }

  private receptionForExistingTask(
    guidance: SettingGuidanceSnapshot,
    task: {
      task_id: string;
      status: string;
      error_code: string | null;
      assigned_agent_id: string | null;
      editor_name: string | null;
    }
  ): ConversationReception {
    const common = {
      settingItemKey: guidance.itemKey,
      settingLabel: guidance.label,
      taskId: task.task_id,
      taskStatus: task.status,
      ...(task.assigned_agent_id === null ? {} : { editorAgentId: task.assigned_agent_id }),
      ...(task.editor_name === null ? {} : { editorName: task.editor_name })
    };
    if (['pending', 'queued', 'working'].includes(task.status)) {
      return {
        kind: 'guidance_in_progress',
        headline: task.editor_name === null ? '主编正在接待' : `${task.editor_name}正在接待`,
        message: `当前正在整理“${guidance.label}”。小文秘书会保留进度，不会重复创建任务；完成后主编会直接在对话中回复。`,
        ...common
      };
    }
    if (task.status === 'succeeded' || task.status === 'waiting_confirmation') {
      return {
        kind: task.status === 'waiting_confirmation' ? 'awaiting_confirmation' : 'guidance_available',
        headline: `继续完善“${guidance.label}”`,
        message: '主编已经完成本轮接待。您可以直接回答她的问题，或补充、纠正当前设定；小文秘书不会重复召集成员。',
        ...common
      };
    }
    if (task.status === 'paused') {
      return {
        kind: 'guidance_paused',
        headline: '当前接待已经暂停',
        message: `“${guidance.label}”的进度仍然保留。请到首页“任务”中继续该任务，恢复后会从原检查点接着处理。`,
        ...common
      };
    }
    if (['failed', 'blocked', 'interrupted'].includes(task.status)) {
      return {
        kind: 'guidance_failed',
        headline: '主编这次没有成功接入',
        message: `“${guidance.label}”的任务记录和检查点都已保留。请到首页“任务”查看原因并继续重试；系统不会伪造回复或自动重复扣费。`,
        ...common
      };
    }
    return {
      kind: 'guidance_cancelled',
      headline: '当前接待任务已经取消',
      message: `“${guidance.label}”仍未确认。需要继续时，请在规划页重新发起这一项讨论。`,
      ...common
    };
  }

  private scheduleConversationReply(
    scope: BookScope,
    content: string,
    messageId: string,
    conversationId: string,
    creativeSession?: { sessionId: string; blackboardRevision: number; action: 'continue_discussion' },
    settingGuidance?: SettingGuidanceSnapshot,
    idempotencyKey?: string
  ): Record<string, unknown> {
    const lease = this.requireEditorLease(scope);
    const editor = this.database.prepare(`SELECT model_snapshot_id FROM agent_instances
      WHERE owner_id = ? AND book_id = ? AND agent_id = ? AND enabled = 1`)
      .get(scope.ownerId, scope.bookId, lease.active_editor_agent_id) as { model_snapshot_id: string } | undefined;
    if (editor === undefined) throw new Error('活动主编不存在、已停用或不属于当前书籍');
    const budget = this.requireBudget(scope);
    const taskId = this.ids.next();
    const tasks = new TaskService(this.database, this.releaseId, this.clock);
    const task = tasks.create(scope, {
      taskId,
      taskType: 'conversation_reply',
      assignedAgentId: lease.active_editor_agent_id,
      idempotencyKey: idempotencyKey ?? `conversation-reply:${messageId}`,
      budgetId: budget.budget_id,
      requiredEditorEpoch: lease.editor_epoch,
      initialPhase: 'reply',
      brief: {
        conversationId, messageId, content, modelSnapshotId: editor.model_snapshot_id,
        ...(creativeSession === undefined ? {} : {
          creativeSessionId: creativeSession.sessionId,
          creativeBlackboardRevision: creativeSession.blackboardRevision,
          creativeSessionAction: creativeSession.action
        }),
        ...(settingGuidance === undefined ? {} : { settingGuidance })
      }
    });
    if (task.status === 'pending') tasks.queue(scope, task.taskId);
    return {
      kind: settingGuidance !== undefined
        ? 'setting_guidance_scheduled'
        : creativeSession === undefined ? 'conversation_reply_scheduled' : 'creative_session_continued',
      taskId: task.taskId,
      taskStatus: task.status === 'pending' ? 'queued' : task.status,
      agentId: lease.active_editor_agent_id,
      editorName: lease.active_editor_name,
      ...(creativeSession === undefined ? {} : {
        sessionId: creativeSession.sessionId,
        blackboardRevision: creativeSession.blackboardRevision
      }),
      ...(settingGuidance === undefined ? {} : {
        settingItemKey: settingGuidance.itemKey,
        settingLabel: settingGuidance.label,
        settingPhase: settingGuidance.phase
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
    const creativeSessions = new CreativeSessionService(this.database, this.ids, this.clock);
    const requestedChapterCount = requestedChapterCountFromScope(content);
    if (requestedChapterCount !== null) {
      creativeSessions.closeReadyTopic(scope, messageId);
      const pendingPlan = this.pendingLockedPlanningDecision(scope);
      if (pendingPlan !== null) {
        return {
          kind: 'planning_confirmation_required',
          sessionId: pendingPlan.sessionId,
          discussionId: pendingPlan.discussionId,
          decisionId: pendingPlan.decisionId,
          requestedChapterCount
        };
      }
    }
    const intake = creativeSessions.receiveOwnerMessage(scope, {
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
      requestedChapterCount,
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

  private pendingLockedPlanningDecision(scope: BookScope): {
    sessionId: string;
    discussionId: string;
    decisionId: string;
  } | null {
    const row = this.database.prepare(`
      SELECT r.creative_session_id AS session_id, d.discussion_id, x.decision_id
      FROM creative_sessions s
      JOIN creative_session_rounds r
        ON r.creative_session_id = s.creative_session_id
        AND r.owner_id = s.owner_id AND r.book_id = s.book_id
      JOIN discussions d
        ON d.discussion_id = r.discussion_id
        AND d.owner_id = r.owner_id AND d.book_id = r.book_id
      JOIN discussion_decisions x
        ON x.discussion_id = d.discussion_id
        AND x.owner_id = d.owner_id AND x.book_id = d.book_id
      JOIN tasks t
        ON t.owner_id = d.owner_id AND t.book_id = d.book_id
        AND t.task_type = 'discussion'
        AND json_extract(t.task_brief_json, '$.discussionId') = d.discussion_id
      WHERE s.owner_id = ? AND s.book_id = ?
        AND s.status <> 'closed'
        AND r.round_kind = 'locked_planning'
        AND d.status = 'awaiting_boss'
        AND x.boss_confirmed = 0
        AND json_extract(t.task_brief_json, '$.purpose') = 'locked_planning'
      ORDER BY r.round_number DESC, x.created_at DESC
      LIMIT 1
    `).get(scope.ownerId, scope.bookId) as {
      session_id: string;
      discussion_id: string;
      decision_id: string;
    } | undefined;
    return row === undefined
      ? null
      : { sessionId: row.session_id, discussionId: row.discussion_id, decisionId: row.decision_id };
  }

  private confirmDiscussionDecision(
    scope: BookScope,
    decisionId: string,
    sourceMessageId: string,
    conversationId: string,
    authorConfirmationNote: string | null = null
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
      requestedChapterCount?: ChapterRequestCount | null;
    };
    const planningArtifacts = new PlanningArtifactService(this.database, this.ids, this.clock);
    if (brief.purpose === 'locked_planning' && brief.creativeSessionId !== undefined) {
      const creativeSessionId = brief.creativeSessionId;
      const prepared = new UnitOfWork(this.database).run(() => {
        new DiscussionService(this.database, this.ids, this.clock).confirm(scope, row.discussion_id, decisionId);
        const promoted = planningArtifacts.promoteIfPlanningTask(scope, row.discussion_id, decisionId);
        if (promoted === null) throw new Error('锁定规划已经确认，但未能生成滚动规划资料');
        const repository = new CreativeSessionRepository(this.database);
        const session = repository.require(scope, creativeSessionId);
        repository.updateStatus(scope, {
          sessionId: session.sessionId,
          expectedStatus: session.status,
          status: 'ready',
          mode: 'formal_production',
          now: this.clock.now().toISOString()
        });
        return promoted;
      });
      return {
        kind: 'discussion_confirmed',
        discussionId: row.discussion_id,
        decisionId,
        planningStage: null,
        settingItemKey: null,
        settingItemKeys: [],
        planningArtifactType: null,
        planningArtifactVersionId: null,
        planningPrepared: true,
        chapterOutlineCount: prepared.chapterOutlineVersionIds.length
      };
    }
    const stagedConfirmation = (brief.purpose === 'open_discussion' || brief.purpose === undefined)
      && new PlanningWorkflowRepository(this.database).openingBlueprint(scope) !== undefined;
    const stagedResult = stagedConfirmation
      ? new UnitOfWork(this.database).run(() => {
          new DiscussionService(this.database, this.ids, this.clock).confirm(scope, row.discussion_id, decisionId);
          const confirmedSettings = new SettingOutlineWorkspaceService(this.database, this.clock)
            .confirmDiscussionCandidates(scope, row.discussion_id, decisionId);
          const stagePromotion = confirmedSettings.length === 0
            ? planningArtifacts.promoteCurrentPlanningStage(scope, row.discussion_id, decisionId)
            : null;
          return { confirmedSettings, stagePromotion };
        })
      : null;
    const stagePromotion = stagedResult?.stagePromotion ?? null;
    if (!stagedConfirmation) {
      new DiscussionService(this.database, this.ids, this.clock).confirm(scope, row.discussion_id, decisionId);
    }

    if (brief.purpose === 'creative_exploration' && brief.creativeSessionId !== undefined) {
      const recommendation = JSON.parse(row.recommendation_json) as Record<string, unknown>;
      const summary = typeof recommendation.summary === 'string'
        ? recommendation.summary
        : JSON.stringify(recommendation.summary ?? recommendation);
      const lockedSummary = authorConfirmationNote === null
        ? summary
        : `${summary}\n\n老板锁定时补充：${authorConfirmationNote}`;
      const blackboard = new CreativeSessionService(this.database, this.ids, this.clock).lockDirection(scope, {
        sessionId: brief.creativeSessionId,
        decisionId,
        summary: lockedSummary,
        sourceMessageId
      });
      const lockedPlanningSummary = compactLockedDecisionSummary(lockedSummary);
      const scheduled = this.scheduleDiscussion(
        scope,
        `老板已锁定方向。锁定决定：${lockedPlanningSummary}`,
        sourceMessageId,
        conversationId,
        'locked_planning',
        brief.requestedChapterCount ?? null,
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

    const prepared = stagePromotion === null
      ? planningArtifacts.promoteIfPlanningTask(scope, row.discussion_id, decisionId)
      : null;
    return {
      kind: 'discussion_confirmed',
      discussionId: row.discussion_id,
      decisionId,
      planningStage: stagePromotion?.stage ?? null,
      settingItemKey: stagedResult?.confirmedSettings[0]?.itemKey ?? null,
      settingItemKeys: stagedResult?.confirmedSettings.map((item) => item.itemKey) ?? [],
      planningArtifactType: stagePromotion?.artifactType ?? null,
      planningArtifactVersionId: stagePromotion?.artifactVersionId ?? null,
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
    const creativePurpose = purpose === 'creative_exploration'
      || purpose === 'locked_planning'
      || purpose === 'creative_concept_panel'
      || purpose === 'setting_proposal_panel';
    const settingWorkshop = scopeText.includes('【设定专项讨论资料包】')
      || scopeText.includes('【设定大纲成组讨论资料包】')
      || scopeText.includes('【剧情总纲专项讨论资料包】');
    const collaborative = creativePurpose || settingWorkshop;
    const roleKeys = collaborative
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
    `).all(scope.ownerId, scope.bookId, lease.active_editor_agent_id, ...roleKeys, collaborative ? 2 : 1) as unknown as Array<{ agent_id: string; role_key: string }>;
    if (specialists.length === 0) throw new Error('没有与讨论范围匹配的岗位');
    for (const specialist of specialists) {
      this.database.prepare(`UPDATE agent_instances SET activation_state = 'idle', updated_at = ? WHERE owner_id = ? AND book_id = ? AND agent_id = ?`)
        .run(this.clock.now().toISOString(), scope.ownerId, scope.bookId, specialist.agent_id);
    }
    const discussion = new DiscussionService(this.database, this.ids, this.clock).create(scope, {
      type: collaborative ? 'collaborative' : 'quick',
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
        ...(purpose === 'creative_concept_panel' || purpose === 'setting_proposal_panel'
          ? { settingItemKey: settingPanelItemKey(scopeText) }
          : {}),
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
      editorName: lease.active_editor_name,
      participants: discussion.participants.map((item) => item.agentId),
      ...(creativeSession === undefined ? {} : {
        sessionId: creativeSession.sessionId,
        roundKind: creativeSession.roundKind
      })
    };
  }

  private findSettingProposalPanel(scope: BookScope, itemKey: string): {
    taskId: string;
    discussionId: string;
    status: string;
    participants: string[];
  } | null {
    const task = this.database.prepare(`
      SELECT task_id, status, task_brief_json
      FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
        AND json_extract(task_brief_json, '$.purpose') IN ('creative_concept_panel', 'setting_proposal_panel')
        AND (
          json_extract(task_brief_json, '$.settingItemKey') = ?
          OR (? = 'creative-concept' AND json_extract(task_brief_json, '$.purpose') = 'creative_concept_panel'
            AND json_extract(task_brief_json, '$.settingItemKey') IS NULL)
        )
      ORDER BY created_at DESC
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, itemKey, itemKey) as {
      task_id: string;
      status: string;
      task_brief_json: string;
    } | undefined;
    if (task === undefined) return null;
    const brief = JSON.parse(task.task_brief_json) as { discussionId: string };
    const participants = this.database.prepare(`
      SELECT agent_id FROM discussion_participants
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ?
      ORDER BY agent_id
    `).all(scope.ownerId, scope.bookId, brief.discussionId) as unknown as Array<{ agent_id: string }>;
    return {
      taskId: task.task_id,
      discussionId: brief.discussionId,
      status: task.status,
      participants: participants.map((participant) => participant.agent_id)
    };
  }

  private requireEditorLease(scope: BookScope): { active_editor_agent_id: string; editor_epoch: number; active_editor_name: string } {
    const lease = this.database.prepare(`
      SELECT l.active_editor_agent_id, l.editor_epoch, a.display_name AS active_editor_name
      FROM editor_leases l
      JOIN agent_instances a ON a.owner_id = l.owner_id AND a.book_id = l.book_id
        AND a.agent_id = l.active_editor_agent_id
      WHERE l.owner_id = ? AND l.book_id = ?
    `).get(scope.ownerId, scope.bookId) as {
      active_editor_agent_id: string; editor_epoch: number; active_editor_name: string;
    } | undefined;
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
    const latest = this.database.prepare(`
      SELECT message_type, content FROM messages
      WHERE conversation_id = ? AND owner_id = ? AND book_id = ?
      ORDER BY created_at DESC, message_id DESC LIMIT 1
    `).get(conversationId, scope.ownerId, scope.bookId) as { message_type: string; content: string } | undefined;
    if (latest?.message_type === 'local_assistant_notice' && latest.content === content) return;
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

function lockDirectionNote(content: string): string | null {
  const match = content.trim().match(
    /^(?:锁定当前方向|就按这个方向|按主编推荐(?:的方向)?|确定这个方向)[！!。.？?\s]*(?:[：:，,]\s*)?([\s\S]*)$/u
  );
  const note = match?.[1]?.trim() ?? '';
  return note.length === 0 ? null : note;
}

function requestedChapterCountFromScope(content: string): ChapterRequestCount | null {
  if (!/(?:讨论|规划)/u.test(content)) return null;
  const match = content.match(/第\s*(\d{1,4})\s*(?:[—–\-至到]\s*(\d{1,4})\s*)?章/u);
  if (match === null) return null;
  const start = Number.parseInt(match[1]!, 10);
  const end = match[2] === undefined ? start : Number.parseInt(match[2], 10);
  const count = end - start + 1;
  return [1, 2, 3, 4, 5].includes(count) ? count as ChapterRequestCount : null;
}

function isOperationalControlMessage(content: string, intake?: RoutingDecision): boolean {
  if (['pause_tasks', 'resume_tasks', 'cancel_tasks', 'show_task_overview', 'open_knowledge_workspace']
    .includes(intake?.selectedAction ?? '')) return true;
  return /^(?:暂停|继续|取消|查看任务|打开资料库|准备接管|确认接管\s+\S+|确认方案\s+\S+|阶段结束|结算当前剧情阶段)[！!。.？?\s]*$/u
    .test(content.trim());
}

function isNaturalSettingConfirmation(content: string): boolean {
  return /^(?:确认|确定|确认这项|确定这项|确认当前设定|确定当前设定|就按这个|就这样|这样确认|没问题|可以)[！!。.？?\s]*$/u.test(content.trim());
}

function classifySettingFeedback(
  content: string,
  selectionNumbers: number[] = []
): SettingGuidanceFeedbackMode {
  if (selectionNumbers.length > 0) return 'numeric_selection';
  const normalized = content.replace(/\s+/gu, ' ').trim();
  if (/(?:完全|彻底|全部).{0,6}(?:换|推翻|重来)|(?:换|改成).{0,4}(?:完全不同|另一条|新方向)|不要这个方向/u.test(normalized)) {
    return 'replace_direction';
  }
  const vague = /^(?:还是)?(?:不满意|不喜欢|不对|不好|不行|换一个|重新推荐|再想想)(?:了|啊|呀|呢)?[！!。.？?\s]*$/u;
  if (vague.test(normalized)) return 'vague_dissatisfaction';
  return 'specific_revision';
}

function parseSettingSelectionNumbers(content: string, available: number[]): number[] {
  const normalized = content.trim().replace(/[＋+、，,和与及\s]/gu, '');
  if (!/^[1-9]+$/u.test(normalized)) return [];
  const allowed = new Set(available);
  const selected = [...new Set([...normalized].map((value) => Number(value)))];
  return selected.length > 0 && selected.every((value) => allowed.has(value))
    ? selected.sort((left, right) => left - right)
    : [];
}

function buildSettingProposalPanelScope(
  content: string,
  guidance: SettingGuidanceSnapshot,
  continuationReference: string | null = null
): string {
  return [
    '【设定条目三席独立提案】',
    `当前设定项编号：${guidance.itemKey}`,
    `当前设定项：${guidance.label}`,
    `当前问题：${guidance.prompt}`,
    `作品定位摘要：${guidance.positioningSummary}`,
    `故事方向参考：${guidance.storyDirectionReference}`,
    `已经确认的前置设定：${guidance.confirmedContext}`,
    `老板本轮原话：${content}`,
    ...(continuationReference === null ? [] : [continuationReference]),
    '任务：活动主编与两名编剧分别独立思考，不读取、不评价也不综合另外两人的答案。每人只提交一个自己真正推荐、可直接供作者选择的本项设定方案。故事方向只是软参考；只讨论当前设定项，不得扩写剧情总纲、章纲或正文。',
    '本轮只展示三个独立候选，不自动形成共识，不自动写入设定大纲；由老板选一个、组合其中若干要素，或直接提交自己的版本。'
  ].join('\n');
}

function clipText(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 15)}……（已压缩）`;
}

function settingPanelItemKey(scopeText: string): string | null {
  return scopeText.match(/当前设定项编号：([^\n]+)/u)?.[1]?.trim() || null;
}

function isDownstreamPlanningRequest(content: string): boolean {
  const normalized = content.trim();
  const planningRequest = /(?:^|[。！？!?\n])\s*(?:请|现在|接下来|我要|我想|我们|先|再|然后|帮我|麻烦|可以)?\s*(?:开始|继续)?\s*(?:讨论|规划|生成|创建|完善)\s*(?:一下)?\s*(?:本书|第一阶段|当前阶段|下一阶段)?\s*(?:剧情总纲|剧情大纲|章纲)/u;
  const writingRequest = /(?:^|[。！？!?\n])\s*(?:请|现在|接下来|我要|我想|我们|先|再|然后|帮我|麻烦|可以|让主笔)?\s*(?:开始写|写一章|写三章|写十章|试写|创作正文|继续写|续写)/u;
  return planningRequest.test(normalized) || writingRequest.test(normalized);
}

function isGuidancePromptRequest(content: string): boolean {
  return /^(?:你好|在吗|怎么开始|下一步是什么|请引导我|开始设定|讨论设定|继续设定)[！!。.？?\s]*$/u.test(content.trim());
}

function isExplicitSettingProposalPanelRequest(content: string): boolean {
  const normalized = content.replace(/\s+/gu, ' ').trim();
  return /^(?:请)?(?:重新|再次|继续)?(?:讨论|构思)(?:一下)?(?:当前)?设定(?:项)?(?:[：:\s【]|$)/u.test(normalized)
    || /^(?:请)?(?:重新|再次)(?:让|请)?(?:主编|副编|两名编剧|两位编剧|编剧|三名成员|三位成员).{0,12}(?:讨论|提案|出方案)/u.test(normalized);
}

function actionNotice(action: Record<string, unknown>): string {
  const editorName = typeof action.editorName === 'string' && action.editorName.trim().length > 0
    ? action.editorName.trim()
    : '活动主编';
  switch (action.kind) {
    case 'local_assistant_reply': return action.topic === 'identity'
      ? '我是小文秘书，负责接收消息、整理附件、查看任务和安排合适的成员。剧情、正文和正史仍由创作成员与您确认，我不会替她们作答。'
      : '我在。您可以直接说想聊的剧情、点名成员，或者让我查看任务和资料；需要创作判断时，我会把您的原话交给合适的成员。';
    case 'chapter_batch_scheduled': return '好的，下一章已经交给主笔。完成三轮独立点评后，我会把稿件带回来请您确认；在您确认前，它不会进入正史。';
    case 'trial_draft_scheduled': return '好的，已安排试写一章。它只会保留为可修改的临时稿，不启动正式三席审校，也不会进入正史；满意后再点“定稿”进入正式审校。';
    case 'trial_draft_not_ready': return `可以先试写，但还缺少唯一下一章所需的信息：${(action.missing as string[]).join('、')}。${editorName}会在当前会话里继续问清，不会直接让主笔盲写。`;
    case 'discussion_scheduled': return action.purpose === 'setting_proposal_panel'
      ? `收到。本轮由${editorName}主持，婉儿和红玉会分别独立提出一份方案，三人不会互相照抄。完成后会直接在这里显示三份候选，供您选择、组合或提出自己的版本。`
      : `收到，我已经把您的原话交给${editorName}，并请相关成员从各自岗位出发讨论。她们完成后会直接在这里回复您，进度可以在左侧“任务”查看。`;
    case 'planning_discussion_scheduled': return action.requestedChapterCount === null
      ? `我没有让主笔贸然批量开写。${editorName}和两位编剧会先评估这段剧情适合展开多少章，并把唯一下一章理清后请您确认。`
      : `目前还缺少可执行的下一章方案，我没有启动主笔。${editorName}会先和相关成员补齐剧情与章纲，再回来请您确认。`;
    case 'planning_discussion_existing': return '前面的剧情方案还在讨论或等您确认，我没有重复开启新任务。您可以在左侧“任务”里查看进度。';
    case 'conversation_reply_scheduled': return `收到，我已经把您的原话交给${editorName}。她会结合这本书现有的资料直接回复您。`;
    case 'setting_guidance_scheduled': return action.blockedBy === 'setting_baseline_not_confirmed'
      ? `还不能进入剧情规划。${editorName}会先和您完成当前设定项“${String(action.settingLabel)}”，确认后再自动推进。`
      : `收到。${editorName}本轮只处理设定项“${String(action.settingLabel)}”，不会跳去讨论剧情。`;
    case 'setting_guidance_completed': return '本书必备设定大纲已经逐项确认完成。现在可以让主编主持剧情总纲讨论；开书时填写的剧情简介仍只作为方向参考。';
    case 'creative_session_started': return `新的剧情议题已经建立为持续创作会话。${editorName}会先主持两位异模型编剧独立推演和一次交叉质疑；这一轮只比较方向，不会提前写正文或生成整批章纲。`;
    case 'creative_session_continued': return `这句话已经接在当前剧情会话里，我没有重复拉起两位编剧。${editorName}会沿着现有分歧和未决问题继续回应。`;
    case 'creative_session_round_scheduled': return '收到明确的重大改向要求。我保留了原讨论记录，并为同一创作会话开启一轮新的双编剧独立推演；旧预演会标记为过期，不会混入新结论。';
    case 'planning_confirmation_required': return '上一轮滚动章纲已经整理完成，正在等您确认。我没有重复召集成员或再次消耗模型额度；请先确认、补充或退回现有方案，再规划后续章节。';
    case 'creative_direction_locked': return `剧情方向已经锁定，但还没有让主笔开写。两位编剧现在会分别估算这个故事弧需要多少章，${editorName}只细化未来1至3章，完成后再请您确认。`;
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
