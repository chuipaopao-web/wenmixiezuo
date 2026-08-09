import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { AgentRecord } from '../agents/agent-team-service.js';
import { AgentTeamService } from '../agents/agent-team-service.js';
import type { DiscussionService } from '../discussions/discussion-service.js';
import { prepareEffectiveOutput } from '../presentation/author-output-service.js';
import type { TaskService } from '../tasks/task-service.js';
import type { AuthorCollaborationService } from '../planning/author-collaboration-service.js';
import type { AuthorInputSurface, AuthorIntentStrength } from '@wenmi/contracts';
import {
  IdeationRepository,
  type IdeationRoundRow
} from '../../infrastructure/db/repositories/ideation-repository.js';

const ideationMarker = '【独立灵感讨论室】';

export interface IdeationRoundView {
  roundId: string;
  taskId: string;
  status: string;
  phase: string;
  errorCode: string | null;
  authorMessage: string;
  createdAt: string;
  updatedAt: string;
  responses: Array<{
    opinionId: string;
    agentId: string;
    memberName: string;
    roleKey: string;
    provider: string;
    modelId: string;
    content: string;
    createdAt: string;
  }>;
}

export class IdeationService {
  private readonly repository: IdeationRepository;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly discussions: DiscussionService,
    private readonly tasks: TaskService,
    private readonly authorCollaboration: AuthorCollaborationService
  ) { this.repository = new IdeationRepository(database); }

  public members(scope: BookScope): Array<AgentRecord & { host: boolean }> {
    assertBookScope(scope);
    const activeEditor = this.activeEditor(scope);
    return new AgentTeamService(this.database, this.ids, this.clock)
      .list(scope)
      .map((member) => ({ ...member, host: member.agentId === activeEditor.agentId }));
  }

  public rounds(scope: BookScope): IdeationRoundView[] {
    assertBookScope(scope);
    const rows = this.repository.listRounds(scope, `${ideationMarker}%`);
    return rows.map((row) => this.mapRound(scope, row));
  }

  public startRound(scope: BookScope, input: {
    message: string;
    participantAgentIds: string[];
    idempotencyKey: string;
  }): IdeationRoundView {
    assertBookScope(scope);
    const message = normalizeText(input.message, '讨论内容', 6000);
    const idempotencyKey = normalizeText(input.idempotencyKey, '幂等键', 200);
    const existing = this.repository.findRoundByTaskIdempotency(scope, `ideation:${idempotencyKey}`, `${ideationMarker}%`);
    if (existing !== null) return this.mapRound(scope, existing);

    const allMembers = this.members(scope);
    const host = allMembers.find((member) => member.host);
    if (host === undefined) throw new DomainError(errorCodes.operationIncomplete, '当前书籍没有活动主编，暂时无法召集讨论。', {}, false, 409);
    const requested = Array.isArray(input.participantAgentIds) ? input.participantAgentIds : [];
    const selectedIds = [...new Set([host.agentId, ...requested])].slice(0, 3);
    if (selectedIds.length < 2) throw new DomainError(errorCodes.validation, '请在主编之外至少选择一名讨论成员。');
    const selected = selectedIds.map((agentId) => allMembers.find((member) => member.agentId === agentId));
    if (selected.some((member) => member === undefined)) {
      throw new DomainError(errorCodes.validation, '讨论成员不存在、已停用或不属于当前书籍。');
    }

    const history = this.rounds(scope).slice(-4).map((round) => ({
      author: round.authorMessage,
      responses: round.responses.map((response) => `${response.memberName}：${response.content}`).slice(0, 3)
    }));
    const bookTitle = this.repository.bookTitle(scope);
    const scopeText = [
      ideationMarker,
      '边界：这是独立灵感讨论。只给作者提供灵感、利弊和可选方向，不得创建、修改、确认或覆盖任何正式设定、卷纲、事件、章纲与正文。',
      `当前书籍：${bookTitle ?? '未命名书籍'}`,
      history.length > 0 ? `最近讨论摘录：${JSON.stringify(history)}` : '最近讨论摘录：无',
      `作者本轮想法：${message}`,
      '请每位成员从自己的专业岗位出发独立回答，使用自然中文和大白话；给出具体可用的剧情建议，并明确风险或取舍。'
    ].join('\n');
    const discussion = this.discussions.create(scope, {
      type: 'quick',
      scopeText,
      createdByAgentId: host.agentId,
      participants: selected.map((member) => ({
        agentId: member!.agentId,
        reason: member!.host ? '主编分身主持并梳理问题' : `${member!.displayName}分身从${member!.roleName}视角提供灵感`
      }))
    });
    const editor = this.activeEditor(scope);
    const budgetId = this.repository.latestBudgetId(scope);
    if (budgetId === null) throw new DomainError(errorCodes.operationIncomplete, '当前书籍没有可用预算记录，无法启动讨论。', {}, false, 409);
    const task = this.tasks.create(scope, {
      taskId: this.ids.next(),
      taskType: 'discussion',
      assignedAgentId: host.agentId,
      idempotencyKey: `ideation:${idempotencyKey}`,
      budgetId,
      requiredEditorEpoch: editor.epoch,
      initialPhase: 'collecting',
      brief: {
        discussionId: discussion.discussionId,
        scopeText,
        purpose: 'open_discussion',
        ideationOnly: true,
        requestedChapterCount: null
      }
    });
    this.tasks.queue(scope, task.taskId);
    const row = this.requireRoundRow(scope, discussion.discussionId);
    return this.mapRound(scope, row);
  }

  public promote(scope: BookScope, roundId: string, input: {
    opinionId: string;
    surface: AuthorInputSurface;
    subjectType: string;
    subjectId?: string | null;
    intentStrength?: AuthorIntentStrength;
    scopeNotes?: string | null;
    idempotencyKey: string;
  }): ReturnType<AuthorCollaborationService['create']> {
    assertBookScope(scope);
    const round = this.requireRoundRow(scope, roundId);
    const opinionId = normalizeText(input.opinionId, '讨论建议', 200);
    const opinion = this.repository.opinion(scope, round.discussion_id, opinionId);
    if (opinion === null) throw new DomainError(errorCodes.validation, '没有找到这条讨论建议。', {}, false, 404);
    const content = cleanVisibleContent(opinion.content);
    if (content.length === 0) throw new DomainError(errorCodes.operationIncomplete, '这条建议没有可转入的有效内容。', {}, false, 409);
    return this.authorCollaboration.create(scope, {
      surface: input.surface,
      subjectType: input.subjectType,
      subjectId: input.subjectId ?? null,
      intentStrength: input.intentStrength ?? 'inspiration',
      originalText: content,
      scopeNotes: [
        `来自独立灵感讨论，由${opinion.member_name}提出；只有这段被作者明确选中的文字进入正式作者意见。`,
        input.scopeNotes?.trim() ?? ''
      ].filter(Boolean).join('\n'),
      attachmentRefs: [],
      mentionedAgentIds: [opinion.agent_id],
      idempotencyKey: normalizeText(input.idempotencyKey, '幂等键', 200)
    });
  }

  public isIdeationDiscussion(scope: BookScope, discussionId: string): boolean {
    return this.repository.isIdeationDiscussion(scope, discussionId, `${ideationMarker}%`);
  }

  private activeEditor(scope: BookScope): { agentId: string; epoch: number } {
    const row = this.repository.activeEditor(scope);
    if (row?.agent_id == null) {
      throw new DomainError(errorCodes.operationIncomplete, '当前书籍没有活动主编。', {}, false, 409);
    }
    return { agentId: row.agent_id, epoch: row.epoch };
  }

  private requireRoundRow(scope: BookScope, roundId: string): IdeationRoundRow {
    const row = this.repository.requireRound(scope, roundId, `${ideationMarker}%`);
    if (row === null) throw new DomainError(errorCodes.validation, '讨论轮次不存在或不属于当前书籍。', {}, false, 404);
    return row;
  }

  private mapRound(scope: BookScope, row: IdeationRoundRow): IdeationRoundView {
    const opinions = this.repository.opinions(scope, row.discussion_id);
    return {
      roundId: row.discussion_id,
      taskId: row.task_id,
      status: row.task_status,
      phase: row.current_phase,
      errorCode: row.error_code,
      authorMessage: extractAuthorMessage(row.scope_text),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      responses: opinions.map((opinion) => ({
        opinionId: opinion.opinion_id,
        agentId: opinion.agent_id,
        memberName: opinion.member_name,
        roleKey: opinion.role_key,
        provider: opinion.provider,
        modelId: opinion.model_id,
        content: cleanVisibleContent(opinion.content),
        createdAt: opinion.created_at
      }))
    };
  }
}

function extractAuthorMessage(scopeText: string): string {
  const marker = '作者本轮想法：';
  const start = scopeText.indexOf(marker);
  if (start < 0) return '';
  const rest = scopeText.slice(start + marker.length);
  const end = rest.indexOf('\n');
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

function cleanVisibleContent(value: string | null): string {
  if (value === null || value.trim().length === 0) return '';
  return prepareEffectiveOutput(value).visibleContent.trim();
}

function normalizeText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainError(errorCodes.validation, `${field}不能为空。`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) throw new DomainError(errorCodes.validation, `${field}最多${maximum}个字。`);
  return normalized;
}
