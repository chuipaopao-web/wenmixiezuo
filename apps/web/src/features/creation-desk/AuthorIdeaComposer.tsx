import { useCallback, useEffect, useRef, useState } from 'react';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import { PaperclipIcon, XIcon } from '@phosphor-icons/react';
import type { AuthorInputSurface, AuthorIntentStrength } from '@wenmi/contracts';
import {
  createAuthorPlanningInput,
  discardAuthorAttachment,
  fetchAuthorPlanningInputs,
  uploadAuthorAttachment,
  type AuthorPlanningInputData,
  type AuthorAttachmentData
} from '../../lib/api/client';
import { toAuthorFacingText } from '../../app/author-presentation';
import { ImeInput, ImeTextarea } from '../shared/ImeSafeField';

const intentOptions: Array<{ value: AuthorIntentStrength; label: string; help: string }> = [
  { value: 'must', label: '必须遵守', help: '作为当前对象的明确目标；如与已确认事实冲突，先提示你决定。' },
  { value: 'preference', label: '强烈偏好', help: 'AI会优先满足；确有冲突或更好理由时必须向你说明调整。' },
  { value: 'inspiration', label: '灵感参考', help: '可以变形、组合或不用，不会自动升级成硬要求。' },
  { value: 'question', label: '我想先问问', help: '先讨论，不会自动变成决定或正式内容。' }
];

const statusLabels: Record<AuthorPlanningInputData['status'], string> = {
  new: '等待处理', adopted: '已采用', adapted: '调整后采用', parked: '暂存',
  rejected: '本次未采用', superseded: '已被新想法替代', withdrawn: '已撤回'
};

export interface AuthorIdeaAgentOption {
  agentId: string;
  displayName: string;
  roleName: string;
}

export function AuthorIdeaComposer({
  bookId,
  surface,
  subjectType,
  subjectId,
  title = '把你的想法告诉AI',
  agents = []
}: {
  bookId: string;
  surface: AuthorInputSurface;
  subjectType: string;
  subjectId: string | null;
  title?: string;
  agents?: AuthorIdeaAgentOption[];
}): React.JSX.Element {
  const [ideas, setIdeas] = useState<AuthorPlanningInputData[]>([]);
  const [text, setText] = useState('');
  const [scopeNotes, setScopeNotes] = useState('');
  const [intentStrength, setIntentStrength] = useState<AuthorIntentStrength>('preference');
  const [mentionedAgentIds, setMentionedAgentIds] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<AuthorAttachmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveController = useRef<AbortController | null>(null);
  const retryIdempotencyKey = useRef<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const result = await fetchAuthorPlanningInputs(bookId, {
      surface,
      subjectType,
      ...(subjectId === null ? {} : { subjectId })
    }, signal);
    setIdeas(result);
  }, [bookId, subjectId, subjectType, surface]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void refresh(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(authorErrorFromUnknown(reason, '作者想法加载失败。'));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [refresh]);

  const save = async (): Promise<void> => {
    if (text.trim().length === 0 || saving || uploading) return;
    setSaving(true);
    setError(null);
    const controller = new AbortController();
    saveController.current = controller;
    retryIdempotencyKey.current ??= createClientKey();
    try {
      await createAuthorPlanningInput(bookId, {
        surface,
        subjectType,
        subjectId,
        intentStrength,
        originalText: text,
        attachmentRefs: attachments.map((item) => item.attachmentId),
        mentionedAgentIds,
        scopeNotes: scopeNotes.trim().length === 0 ? null : scopeNotes,
        idempotencyKey: retryIdempotencyKey.current
      }, controller.signal);
      retryIdempotencyKey.current = null;
      setText('');
      setScopeNotes('');
      setMentionedAgentIds([]);
      setAttachments([]);
      await refresh();
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') {
        setError('这次保存已取消；再次点击保存会沿用同一请求，不会重复记录。');
      } else {
        setError(authorErrorFromUnknown(reason, '保存失败，请稍后重试。'));
      }
    } finally {
      if (saveController.current === controller) saveController.current = null;
      setSaving(false);
    }
  };

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return;
    const remaining = Math.max(0, 6 - attachments.length);
    if (remaining === 0) { setError('每条想法最多附加6个文件。'); return; }
    setUploading(true);
    setError(null);
    const uploaded: AuthorAttachmentData[] = [];
    try {
      for (const file of [...files].slice(0, remaining)) uploaded.push(await uploadAuthorAttachment(bookId, file));
      setAttachments((current) => [...current, ...uploaded]);
      retryIdempotencyKey.current = null;
    } catch (reason) {
      setAttachments((current) => [...current, ...uploaded]);
      retryIdempotencyKey.current = null;
      setError(authorErrorFromUnknown(reason, '附件上传失败。'));
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (attachment: AuthorAttachmentData): Promise<void> => {
    try {
      await discardAuthorAttachment(bookId, attachment.attachmentId);
      setAttachments((current) => current.filter((item) => item.attachmentId !== attachment.attachmentId));
      retryIdempotencyKey.current = null;
    } catch (reason) {
      setError(authorErrorFromUnknown(reason, '附件移除失败。'));
    }
  };

  const selectedIntent = intentOptions.find((item) => item.value === intentStrength) ?? intentOptions[1]!;
  return <section className="author-idea-card" aria-label={title}>
    <header>
      <div><small>作者意见</small><h3>{title}</h3><p>原话会完整保留；AI必须说明采用到哪里，没采用也要说明理由。</p></div>
      <span>{ideas.length} 条</span>
    </header>
    {ideas.length > 0 && <div className="author-idea-history" aria-label="已有作者想法">
      {ideas.map((idea) => <article key={idea.authorInputId}>
        <div><strong>{intentOptions.find((item) => item.value === idea.intentStrength)?.label ?? idea.intentStrength}</strong><span>{statusLabels[idea.status]}</span></div>
        <p>{idea.originalText}</p>
        {idea.handlingReason !== null && <small>处理说明：{idea.handlingReason}</small>}
      </article>)}
    </div>}
    {loading && <p className="author-idea-loading">正在读取这一步的作者想法…</p>}
    <label className="author-idea-text">
      <span>你的原话</span>
      <ImeTextarea value={text} maxChars={20_000} onChange={(next) => {
        setText(next);
        if (retryIdempotencyKey.current !== null) retryIdempotencyKey.current = null;
      }} placeholder="例如：这个事件不要靠硬碰硬取胜，希望主角用前文已经学会的阵法知识。" />
    </label>
    <fieldset className="author-intent-options" aria-describedby="author-intent-help">
      <legend>这条想法有多重要？</legend>
      {intentOptions.map((item) => <button key={item.value} type="button" role="radio"
        aria-checked={intentStrength === item.value} className={intentStrength === item.value ? 'selected' : ''}
        onClick={() => { setIntentStrength(item.value); retryIdempotencyKey.current = null; }}>
        {item.label}
      </button>)}
      <p id="author-intent-help">{selectedIntent.help}</p>
    </fieldset>
    <label className="author-scope-notes"><span>只影响哪里？（可不填）</span><ImeInput value={scopeNotes} maxChars={4000}
      onChange={(next) => { setScopeNotes(next); retryIdempotencyKey.current = null; }} placeholder="例如：只影响本事件结尾，不改变卷末结果" /></label>
    {agents.length > 0 && <details className="author-mentions">
      <summary>点名成员（可不选）</summary>
      <div>{agents.map((agent) => <label key={agent.agentId}>
        <input type="checkbox" checked={mentionedAgentIds.includes(agent.agentId)} onChange={() => {
          setMentionedAgentIds((current) => current.includes(agent.agentId)
            ? current.filter((id) => id !== agent.agentId)
            : [...current, agent.agentId]);
          retryIdempotencyKey.current = null;
        }} />
        <span>{agent.displayName} · {agent.roleName}</span>
      </label>)}</div>
    </details>}
    {attachments.length > 0 && <div className="author-idea-attachments">{attachments.map((attachment) => <span key={attachment.attachmentId}>
      <PaperclipIcon />{attachment.originalName}
      <button type="button" aria-label={`移除附件 ${attachment.originalName}`} onClick={() => void removeAttachment(attachment)}><XIcon /></button>
    </span>)}</div>}
    <footer>
      <label className="author-attachment-button"><PaperclipIcon />{uploading ? '正在上传…' : '添加附件'}
        <input type="file" multiple disabled={uploading || saving} onChange={(event) => { void addFiles(event.target.files); event.currentTarget.value = ''; }} />
      </label>
      <div>
        {saving && <button type="button" className="text-button" onClick={() => saveController.current?.abort()}>取消保存</button>}
        <button type="button" className="primary-button" disabled={saving || uploading || text.trim().length === 0} onClick={() => void save()}>
          {saving ? '正在保存…' : '保存给AI参考'}
        </button>
      </div>
    </footer>
    {error !== null && <p className="author-idea-error" role="alert">{toAuthorFacingText(error, 'error')}</p>}
  </section>;
}

function createClientKey(): string {
  return `author-idea:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
