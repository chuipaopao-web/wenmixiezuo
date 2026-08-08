import { useRef, useState } from 'react';
import {
  ChatsCircleIcon,
  FileTextIcon,
  ImageIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  UserCircleIcon,
  XIcon
} from '@phosphor-icons/react';
import {
  chatAttachmentContentUrl,
  type AgentData,
  type ChatAttachmentData,
  type ConversationReceptionData,
  type CreativeSessionData,
  type MessageData,
  type TaskData
} from '../../lib/api/client';
import {
  structuredReplyFromMixedText,
  toAuthorFacingText
} from '../../app/author-presentation';
import { memberIdentity } from '../shared/agent-presentation';
import { AgentAvatar } from '../shared/AgentAvatar';
import { isRecord } from '../shared/StructuredContent';
import { formatTime } from '../shared/task-presentation';

export interface PendingChatAttachment {
  localId: string;
  fileName: string;
  status: 'uploading' | 'ready' | 'failed';
  data: ChatAttachmentData | null;
  error: string | null;
}

export function ChatWorkspace(props: {
  bookId: string;
  reception: ConversationReceptionData | null;
  messages: MessageData[];
  agents: AgentData[];
  totalMessageCount: number;
  creativeSession: CreativeSessionData | null;
  onboardingTask: TaskData | null;
  activeFlowTask: TaskData | null;
  busy: boolean;
  composer: string;
  setComposer: (value: string) => void;
  pendingAttachments: PendingChatAttachment[];
  onFilesSelected: (files: File[]) => Promise<void>;
  onRemoveAttachment: (attachment: PendingChatAttachment) => void;
  onSubmit: () => Promise<void>;
  onQuickAction: (content: string) => Promise<void>;
}): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const visibleMessages = props.messages.slice(-200);
  const hiddenMessageCount = Math.max(0, props.totalMessageCount - visibleMessages.length);
  const readyAttachmentCount = props.pendingAttachments.filter((item) => item.status === 'ready').length;
  const uploading = props.pendingAttachments.some((item) => item.status === 'uploading');
  const canSend = !props.busy && !uploading && (props.composer.trim().length > 0 || readyAttachmentCount > 0);
  const onboardingPending = props.onboardingTask !== null
    && ['pending', 'queued', 'working'].includes(props.onboardingTask.status);
  const onboardingFailed = props.onboardingTask !== null
    && ['failed', 'blocked', 'interrupted'].includes(props.onboardingTask.status);
  const showActiveFlowTask = props.activeFlowTask !== null
    && props.activeFlowTask.taskId !== props.reception?.taskId;
  return (
    <section className="chat-workspace" aria-label="主创作对话">
      {(props.reception !== null || props.creativeSession !== null || showActiveFlowTask) && <div className="chat-status-stack">
        {props.reception !== null && (
          <section className={`conversation-reception ${receptionTone(props.reception.kind)}`} role="status" aria-live="polite">
            <ChatsCircleIcon aria-hidden="true" />
            <div>
              <strong>{props.reception.headline}</strong>
              <p>{props.reception.message}</p>
            </div>
          </section>
        )}
        {props.creativeSession !== null && (
          <CreativeSessionStrip
            session={props.creativeSession}
            busy={props.busy}
            onQuickAction={props.onQuickAction}
          />
        )}
        {showActiveFlowTask && props.activeFlowTask !== null && (
          <section className="conversation-progress" role="status" aria-live="polite">
            <span className="conversation-progress-pulse" aria-hidden="true" />
            <div>
              <strong>{props.activeFlowTask.taskType === 'discussion' ? '主编与编剧正在讨论' : '成员正在整理回复'}</strong>
              <small>{flowTaskProgress(props.activeFlowTask)}；完成后会自动显示在这里，不需要重复发送。</small>
            </div>
          </section>
        )}
      </div>}
      <div className="conversation-stream" aria-live="polite">
        {props.messages.length === 0 ? (
          <div className="conversation-empty">
            <ChatsCircleIcon />
            <h2>{props.reception?.settingLabel !== undefined
              ? `继续完善“${props.reception.settingLabel}”`
              : onboardingPending ? '主编正在整理开书资料' : onboardingFailed ? '主编这次没有成功接入' : '从故事想法开始聊'}</h2>
            <p>{props.reception?.settingLabel !== undefined
              ? '可以直接回答主编的问题，也可以补充或纠正这一项；确认后才会按顺序进入下一项。'
              : onboardingPending
              ? '貂蝉会先看你已经填写的作品定位，再提出一至三个最值得先确定的设定问题。这里不会自动写正文，也不会把讨论直接当成正式内容。'
              : onboardingFailed
                ? '开场任务保留了完整记录，没有伪造回复。您可以在左侧“任务”查看故障；恢复后会继续使用原来的开场任务，不会重复创建。'
                : '自由说出人物、冲突或你拿不准的剧情。小文秘书会保留原话，剧情问题由主编主持两名异模型编剧讨论；规划齐备后再逐章创作。'}</p>
          </div>
        ) : (
          <>
            {hiddenMessageCount > 0 && <p className="history-window-note">为保持工作区流畅，当前显示最近 200 条消息；更早的 {hiddenMessageCount} 条仍保存在本地记录中。</p>}
            {visibleMessages.map((message) => <MessageBubble key={message.message_id} bookId={props.bookId} message={message} agents={props.agents} />)}
          </>
        )}
      </div>
      <div className="composer-wrap">
        <label htmlFor="boss-message">和创作团队说</label>
        {props.pendingAttachments.length > 0 && <div className="pending-attachments" aria-label="待发送附件">
          {props.pendingAttachments.map((attachment) => <div className={`pending-attachment ${attachment.status}`} key={attachment.localId}>
            <span className="pending-attachment-icon">{attachment.data?.mediaKind === 'image' ? <ImageIcon /> : <FileTextIcon />}</span>
            <span className="pending-attachment-copy">
              <strong>{attachment.fileName}</strong>
              <small>{pendingAttachmentStatus(attachment)}</small>
            </span>
            <button type="button" aria-label={`移除附件 ${attachment.fileName}`} disabled={attachment.status === 'uploading'} onClick={() => props.onRemoveAttachment(attachment)}><XIcon /></button>
          </div>)}
        </div>}
        <div className="composer-box">
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            aria-label="选择图片或文件"
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp,.txt,.md,.markdown,.json,.csv,.log,.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              void props.onFilesSelected(files);
            }}
          />
          <button className="attachment-button" type="button" aria-label="添加图片或文件" disabled={props.busy || props.pendingAttachments.length >= 6} onClick={() => fileInputRef.current?.click()}><PlusIcon /></button>
          <textarea
            id="boss-message"
            value={props.composer}
            onChange={(event) => props.setComposer(event.target.value)}
            placeholder="例如：我想先讨论主角、核心冲突和第一章开局"
            rows={3}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void props.onSubmit();
            }}
          />
          <button className="send-button" type="button" disabled={!canSend} onClick={() => void props.onSubmit()}><PaperPlaneTiltIcon />发送</button>
        </div>
      </div>
    </section>
  );
}

function receptionTone(kind: ConversationReceptionData['kind']): 'active' | 'ready' | 'warning' {
  if (['guidance_failed', 'guidance_cancelled', 'guidance_paused'].includes(kind)) return 'warning';
  if (['guidance_available', 'awaiting_confirmation', 'setting_complete'].includes(kind)) return 'ready';
  return 'active';
}

export function syncReceptionWithTask(reception: ConversationReceptionData, task: TaskData): ConversationReceptionData {
  const label = reception.settingLabel === undefined ? '当前事项' : `“${reception.settingLabel}”`;
  if (['pending', 'queued', 'working'].includes(task.status)) {
    return { ...reception, kind: 'guidance_in_progress', taskStatus: task.status };
  }
  if (task.status === 'succeeded') {
    return {
      ...reception,
      kind: 'guidance_available',
      headline: `${label}已有主编回复`,
      message: '小文秘书已核对进度：回复已经送达，可以继续回答、补充或纠正；系统不会替您确认设定。',
      taskStatus: task.status
    };
  }
  if (task.status === 'waiting_confirmation') {
    return {
      ...reception,
      kind: 'awaiting_confirmation',
      headline: `${label}等待您确认`,
      message: '小文秘书已看过当前进度：请查看待确认方案。满意就确认，不满意可以继续补充或要求调整。',
      taskStatus: task.status
    };
  }
  if (task.status === 'paused') {
    return {
      ...reception,
      kind: 'guidance_paused',
      headline: `${label}已暂停`,
      message: '小文秘书已保留当前进度；可以到首页“任务”继续或取消，不会重复创建任务。',
      taskStatus: task.status
    };
  }
  if (['failed', 'blocked', 'interrupted'].includes(task.status)) {
    return {
      ...reception,
      kind: 'guidance_failed',
      headline: `${label}这次没有完成`,
      message: '小文秘书已保留故障和进度记录，没有伪造回复或自动重试。请到首页“任务”查看原因并决定是否继续。',
      taskStatus: task.status
    };
  }
  return {
    ...reception,
    kind: 'guidance_cancelled',
    headline: `${label}任务已结束`,
    message: '小文秘书已保留现有讨论记录；如需继续，可以直接告诉团队想完善哪一项。',
    taskStatus: task.status
  };
}

function flowTaskProgress(task: TaskData): string {
  if (task.status === 'pending' || task.status === 'queued') return '任务已经进入队列';
  const labels: Record<string, string> = {
    briefing: '正在整理最小资料包',
    forecast: '两位编剧正在独立提出方向',
    cross_examination: '正在进行一次交叉质疑',
    synthesis: '主编正在归纳有效结论',
    reply: '正在组织面向作者的回复',
    working: '正在处理'
  };
  return labels[task.currentPhase] ?? '正在处理';
}

function CreativeSessionStrip({ session, busy, onQuickAction }: {
  session: CreativeSessionData;
  busy: boolean;
  onQuickAction: (content: string) => Promise<void>;
}): React.JSX.Element {
  const board = session.blackboard;
  const branches = session.activeForecast?.branches ?? [];
  const canLock = ['exploring', 'awaiting_direction'].includes(session.status) && branches.length > 0;
  return (
    <section className="creative-session-strip" aria-label="当前剧情会话">
      <div className="creative-session-heading">
        <span className="creative-session-state">{creativeSessionStatus(session.status)}</span>
        <strong>{board?.currentGoal || session.activeTopic}</strong>
        <small>{board?.nextStep ?? '主编正在整理当前议题。'}</small>
      </div>
      {branches.length > 0 && (
        <div className="forecast-branch-list" aria-label="待选剧情方向">
          {branches.slice(0, 3).map((branch) => (
            <span key={branch.branchId}><b>{branch.ordinal}</b>{branch.title}</span>
          ))}
        </div>
      )}
      <div className="creative-session-actions">
        {canLock && (
          <>
            <button type="button" disabled={busy} onClick={() => void onQuickAction('请主编比较这些方向的收益、代价、风险和未知项')}>继续比较</button>
            <button className="primary" type="button" disabled={busy} onClick={() => void onQuickAction('锁定当前方向')}>锁定方向</button>
          </>
        )}
        {session.status === 'ready' && (
          <button type="button" disabled={busy} onClick={() => void onQuickAction('请主编只细化下一章，先不要让主笔开写')}>细化下一章</button>
        )}
      </div>
    </section>
  );
}

function creativeSessionStatus(status: CreativeSessionData['status']): string {
  const labels: Record<CreativeSessionData['status'], string> = {
    exploring: '讨论中',
    awaiting_direction: '待锁定方向',
    planning: '规划中',
    awaiting_plan: '待确认规划',
    ready: '可进入创作',
    paused: '已暂停'
  };
  return labels[status];
}

function MessageBubble({ bookId, message, agents }: { bookId: string; message: MessageData; agents: AgentData[] }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const speakingAgent = message.role_key === null ? null : agents.find((agent) => agent.roleKey === message.role_key) ?? null;
  const attachments = messageAttachmentReferences(message.references_json);
  const storedEffectiveOutput = effectiveOutputReference(message.references_json);
  const recoveredDirectOutput = message.sender_type === 'agent' ? structuredReplyFromMixedText(message.content) : null;
  const recoveredLegacyOutput = storedEffectiveOutput?.format === 'fallback'
    ? structuredReplyFromMixedText(storedEffectiveOutput.fullContent)
    : null;
  const effectiveOutput = recoveredLegacyOutput ?? recoveredDirectOutput ?? (storedEffectiveOutput?.format === 'structured' ? storedEffectiveOutput : null);
  const conciseContent = recoveredLegacyOutput?.visibleContent ?? recoveredDirectOutput?.visibleContent ?? localAssistantDisplayContent(message);
  const displayContent = expanded && effectiveOutput !== null ? effectiveOutput.fullContent : conciseContent;
  const source = message.sender_type === 'boss'
    ? '老板'
    : message.sender_type === 'agent'
      ? speakingAgent === null ? message.role_key ?? '成员' : memberIdentity(speakingAgent)
      : '小文秘书';
  const alignment = message.sender_type === 'boss' ? 'align-right' : 'align-left';
  const visualType = message.sender_type === 'system' ? 'local-assistant' : message.sender_type;
  return (
    <article className={`message ${visualType} ${alignment}`}>
      {message.sender_type === 'agent' && <span className="message-avatar"><AgentAvatar roleKey={message.role_key ?? 'chief_editor'} roleName={source} /></span>}
      {message.sender_type === 'system' && <span className="message-avatar secretary-message-avatar" role="img" aria-label="小文秘书头像"><ChatsCircleIcon /></span>}
      <div className="message-card">
        <header><strong>{source}</strong><time dateTime={message.created_at}>{formatTime(message.created_at)}</time></header>
        <p>{displayContent}</p>
        {effectiveOutput !== null && effectiveOutput.fullContent.trim() !== conciseContent.trim() && (
          <button
            className="message-detail-toggle"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? '收起完整回复' : '查看完整回复'}
          </button>
        )}
        {attachments.length > 0 && <div className="message-attachments">{attachments.map((attachment) => (
          attachment.mediaKind === 'image'
            ? <a className="message-image-attachment" key={attachment.attachmentId} href={chatAttachmentContentUrl(bookId, attachment.attachmentId)} target="_blank" rel="noreferrer"><img src={chatAttachmentContentUrl(bookId, attachment.attachmentId)} alt={attachment.originalName} /><span>{attachment.originalName}</span></a>
            : <a className="message-file-attachment" key={attachment.attachmentId} href={chatAttachmentContentUrl(bookId, attachment.attachmentId)} target="_blank" rel="noreferrer"><FileTextIcon /><span><strong>{attachment.originalName}</strong><small>{attachmentStatusLabel(attachment.parseStatus, attachment.parsedCharCount)}</small></span></a>
        ))}</div>}
      </div>
      {message.sender_type === 'boss' && <span className="message-avatar boss-avatar" role="img" aria-label="老板头像"><UserCircleIcon /></span>}
    </article>
  );
}

function localAssistantDisplayContent(message: MessageData): string {
  if (message.sender_type === 'boss') return message.content;
  if (message.sender_type !== 'system') return toAuthorFacingText(message.content);
  const content = message.content.trim();
  if (content.startsWith('消息已保存。当前使用确定性离线适配器')) {
    return '您的消息我已经收好。现在可以直接聊天、讨论剧情、点名成员，也可以查看任务和资料；需要创作判断时，我会安排对应成员回复。';
  }
  if (content === '明确控制命令已执行。') return '这条请求已经处理好了；如果还需要下一步，直接告诉我。';
  if (content === '内部错误') return '这次没有顺利完成，请稍后再试。问题已经留下本地追踪信息，方便继续排查。';
  return toAuthorFacingText(message.content);
}

interface MessageAttachmentReference {
  type: 'chat_attachment';
  attachmentId: string;
  originalName: string;
  mediaKind: 'image' | 'text' | 'pdf' | 'docx';
  parseStatus: ChatAttachmentData['parseStatus'];
  parsedCharCount: number;
}

interface EffectiveOutputMessageReference {
  type: 'effective_output';
  version: 1;
  format: 'structured' | 'fallback';
  fullContent: string;
  contentHash: string;
}

function effectiveOutputReference(value: string): EffectiveOutputMessageReference | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const reference = parsed.find((item): item is EffectiveOutputMessageReference => isRecord(item)
      && item.type === 'effective_output'
      && item.version === 1
      && (item.format === 'structured' || item.format === 'fallback')
      && typeof item.fullContent === 'string'
      && item.fullContent.trim().length > 0
      && typeof item.contentHash === 'string'
      && /^[a-f0-9]{64}$/u.test(item.contentHash));
    return reference ?? null;
  } catch {
    return null;
  }
}

function messageAttachmentReferences(value: string): MessageAttachmentReference[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is MessageAttachmentReference => isRecord(item)
      && item.type === 'chat_attachment'
      && typeof item.attachmentId === 'string'
      && typeof item.originalName === 'string'
      && typeof item.mediaKind === 'string'
      && typeof item.parseStatus === 'string'
      && typeof item.parsedCharCount === 'number');
  } catch {
    return [];
  }
}

function pendingAttachmentStatus(attachment: PendingChatAttachment): string {
  if (attachment.status === 'uploading') return '正在上传并解析';
  if (attachment.status === 'failed') return attachment.error ?? '上传失败';
  if (attachment.data === null) return '状态未知';
  return attachmentStatusLabel(attachment.data.parseStatus, attachment.data.parsedCharCount, attachment.error);
}

function attachmentStatusLabel(status: ChatAttachmentData['parseStatus'], charCount: number, detail?: string | null): string {
  if (status === 'parsed') return `已解析 ${charCount.toLocaleString('zh-CN')} 字符`;
  if (status === 'truncated') return `已解析 ${charCount.toLocaleString('zh-CN')} 字符，超长部分未进入对话`;
  if (status === 'preview_only') return '图片可预览，未识别图片内容';
  if (status === 'no_text') return detail ?? '未提取到文字';
  if (status === 'failed') return detail ?? '解析失败';
  return '已从待发送列表移除';
}

