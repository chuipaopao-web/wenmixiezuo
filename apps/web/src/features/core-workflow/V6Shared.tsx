import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CheckCircleIcon,
  ClockIcon,
  PlusIcon,
  SparkleIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  XIcon
} from '@phosphor-icons/react';
import type { AiNodeBatchMemberView, AiNodeBatchView, AiNodeCostEstimate, CoreWorkflowStage, EditorialMemberView, EditorialRoleKey } from '@wenmi/contracts';
import { authorErrorFromUnknown } from '../../lib/api/author-error';
import { AgentAvatar } from '../shared/AgentAvatar';
import { useMembershipGate } from '../shared/membership-gate';
import {
  createAiNodeBatch,
  estimateAiNodeCost,
  fetchAiNodeBatch,
  fetchEditorialTeam,
  replaceAiNodeMember,
  retryAiNodeMember,
  saveAiNodeAuthorInput,
  type ContextSourceInput
} from './v6-api';

export const V6_STAGES: Array<{ key: CoreWorkflowStage; label: string; description: string }> = [
  { key: 'setting', label: '设定', description: '建立创作边界' },
  { key: 'storyline', label: '故事线', description: '确认全书脉络' },
  { key: 'volume', label: '分卷', description: '安排本卷方向' },
  { key: 'event', label: '事件', description: '推进因果单元' },
  { key: 'chapter', label: '章节', description: '章纲、正文与结算' }
];

export function StageTrack({ active, available = V6_STAGES.map((stage) => stage.key), onSelect }: {
  active: CoreWorkflowStage;
  available?: CoreWorkflowStage[];
  onSelect: (stage: CoreWorkflowStage) => void;
}): React.JSX.Element {
  const activeIndex = V6_STAGES.findIndex((stage) => stage.key === active);
  return <ol className="v6-stage-track" aria-label="创作阶段">
    {V6_STAGES.map((stage, index) => {
      const enabled = available.includes(stage.key);
      const state = index < activeIndex ? 'completed' : index === activeIndex ? 'active' : 'future';
      return <li key={stage.key} data-state={state}>
        <button type="button" disabled={!enabled} aria-current={state === 'active' ? 'step' : undefined}
          title={enabled ? stage.description : `${stage.label}尚未开放`}
          onClick={() => onSelect(stage.key)}>
          <span>{index < activeIndex ? <CheckCircleIcon weight="fill" /> : index + 1}</span>
          <strong>{stage.label}</strong>
        </button>
      </li>;
    })}
  </ol>;
}

export function V6PageHeader({ eyebrow, title, description, actions, mapAction }: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  mapAction?: () => void;
}): React.JSX.Element {
  return <header className="v6-page-header">
    <div><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>
    <div className="v6-page-actions">
      {mapAction !== undefined && <button type="button" className="v6-quiet-button" onClick={mapAction}>查看故事地图</button>}
      {actions}
    </div>
  </header>;
}

export function TeamProgress({ progress, status }: { progress: AiNodeBatchView['progress']; status: AiNodeBatchView['status'] }): React.JSX.Element {
  const label = status === 'completed' ? '团队设计已完成' : status === 'partial_success' ? '已有方案，可继续恢复失败成员'
    : status === 'failed' ? '本轮失败，可重试或换成员' : '团队正在设计';
  return <section className="v6-team-progress" aria-label="团队任务进度" aria-live="polite">
    <div><strong>{label}</strong><span>{progress.completed} 完成 · {progress.failed} 失败 · 共 {progress.total} 位</span><b>{progress.percent}%</b></div>
    <div className="v6-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
      <i style={{ width: `${Math.max(progress.percent, progress.percent === 0 ? 0 : 3)}%` }} />
    </div>
  </section>;
}

export function MemberBadge({ member, compact = false }: { member: EditorialMemberView; compact?: boolean }): React.JSX.Element {
  return <span className={`v6-member-badge ${compact ? 'compact' : ''}`}>
    <AgentAvatar roleKey={member.avatarKey || member.roleKey} roleName={member.displayName} />
    <span><strong>{member.displayName}</strong><small>{member.roleLabel}{compact ? '' : ` · ${member.supplierCompany}`}</small></span>
    {!compact && <em data-tier={member.baseCostTier}>消耗{costTierLabel(member.baseCostTier)}</em>}
  </span>;
}

export function CandidatePanel({ member, onUse, onRedesign }: {
  member: AiNodeBatchMemberView;
  onUse?: (content: Record<string, unknown>) => void;
  onRedesign?: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const result = member.result;
  const useSelected = (): void => {
    if (result === null || onUse === undefined || selectedFields.length === 0) return;
    onUse(Object.fromEntries(selectedFields.map((key) => [key, result.content[key]])));
  };
  return <article className={`v6-candidate ${member.status}`}>
    <header>
      <MemberBadge member={member.member} compact />
      <span className="v6-member-state">{memberStatusLabel(member.status)}</span>
      <button type="button" className="v6-icon-button" aria-label={open ? '收起方案' : '展开方案'} onClick={() => setOpen((value) => !value)}>
        <CaretDownIcon className={open ? 'rotated' : ''} />
      </button>
    </header>
    {member.status === 'failed' && <p className="v6-inline-error">{member.failureMessage ?? '本成员未能完成，可单独恢复。'}</p>}
    {open && result !== null && <div className="v6-candidate-body">
      <CandidateContent content={result.content} selectedFields={selectedFields} onToggle={(key) => setSelectedFields((current) =>
        current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} />
      <details><summary>本轮处理说明</summary>
        <dl className="v6-result-summary">
          <div><dt>保留</dt><dd>{result.authorSummary.preserved.join('、') || '无'}</dd></div>
          <div><dt>专业调整</dt><dd>{result.authorSummary.adjusted.join('、') || '无'}</dd></div>
          <div><dt>未采用</dt><dd>{result.authorSummary.omitted.map((item) => `${item.item}（${item.reason}）`).join('、') || '无'}</dd></div>
        </dl>
      </details>
      <div className="v6-candidate-actions">
        {onUse !== undefined && <><button type="button" className="v6-primary-button" onClick={() => onUse(result.content)}>整份采用</button>
          <button type="button" className="v6-quiet-button" disabled={selectedFields.length === 0} onClick={useSelected}>采用所选 {selectedFields.length} 项</button></>}
        {onRedesign !== undefined && <button type="button" className="v6-quiet-button" onClick={onRedesign}><ArrowsClockwiseIcon />重新设计</button>}
      </div>
    </div>}
  </article>;
}

function CandidateContent({ content, selectedFields, onToggle }: {
  content: Record<string, unknown>;
  selectedFields: string[];
  onToggle: (key: string) => void;
}): React.JSX.Element {
  const entries = Object.entries(content).filter(([, value]) => value !== null && value !== '');
  return <dl className="v6-candidate-content">{entries.map(([key, value]) => <div key={key}>
    <dt><label><input type="checkbox" checked={selectedFields.includes(key)} onChange={() => onToggle(key)} />{plainFieldLabel(key)}</label></dt><dd>{renderValue(value)}</dd>
  </div>)}</dl>;
}

export function VersionedDraftPanel({ title, value, versionLabel, impactPreview, busy = false, onChange, onOrganize, onConfirm, onReopen }: {
  title: string;
  value: string;
  versionLabel: string;
  impactPreview?: ReactNode;
  busy?: boolean;
  onChange: (value: string) => void;
  onOrganize?: () => void;
  onConfirm: () => void;
  onReopen?: () => void;
}): React.JSX.Element {
  return <section className="v6-versioned-draft">
    <header><div><span>可编辑稿</span><h3>{title}</h3></div><small>{versionLabel}</small></header>
    <textarea aria-label={`${title}编辑稿`} value={value} disabled={busy} onChange={(event) => onChange(event.target.value)} />
    {impactPreview !== undefined && <details><summary>查看确认影响</summary><div className="v6-impact-preview">{impactPreview}</div></details>}
    <footer>{onReopen !== undefined && <button type="button" className="v6-quiet-button" disabled={busy} onClick={onReopen}>重开并产生新版本</button>}
      <span />{onOrganize !== undefined && <button type="button" className="v6-quiet-button" disabled={busy || value.trim().length === 0} onClick={onOrganize}>按此整理</button>}
      <button type="button" className="v6-primary-button" disabled={busy || value.trim().length === 0} onClick={onConfirm}>确认此版本</button></footer>
  </section>;
}
export function AiNodePanel({ bookId, nodeKind, objectId, roleKey, title, taskDescription, source, templateVersion,
  onUseCandidate, initialExpanded = false, defaultMemberCount = 1 }: {
  bookId: string;
  nodeKind: string;
  objectId: string;
  roleKey: EditorialRoleKey;
  title: string;
  taskDescription: string;
  source: ContextSourceInput;
  templateVersion: string;
  onUseCandidate?: (content: Record<string, unknown>) => void;
  initialExpanded?: boolean;
  defaultMemberCount?: number;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [authorInput, setAuthorInput] = useState('');
  const [authorSavedVersion, setAuthorSavedVersion] = useState<number | null>(null);
  const [members, setMembers] = useState<EditorialMemberView[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [estimate, setEstimate] = useState<AiNodeCostEstimate | null>(null);
  const [batch, setBatch] = useState<AiNodeBatchView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputSaveSequence = useRef(0);
  const { guardAi } = useMembershipGate();

  useEffect(() => {
    const controller = new AbortController();
    void fetchEditorialTeam(bookId, controller.signal).then(({ pools }) => {
      const role = pools.find((pool) => pool.roleKey === roleKey);
      if (!controller.signal.aborted) {
        const available = role?.members.filter((member) => member.enabled) ?? [];
        setMembers(available);
        setSelectedMemberIds((current) => current.length > 0 ? current : available.slice(0, Math.max(1, defaultMemberCount)).map((member) => member.memberId));
      }
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(authorErrorFromUnknown(reason, '团队成员加载失败')); });
    return () => controller.abort();
  }, [bookId, defaultMemberCount, roleKey]);

  useEffect(() => {
    if (!expanded || batch !== null) return;
    const controller = new AbortController();
    void estimateAiNodeCost(bookId, {
      roleKey, hardSources: [source], optionalSources: [], outputTokenBudget: 4_000, reasoningLevel: 'standard', roundCount: 1, exampleCount: 0,
      ...(selectedMemberIds.length === 0 ? {} : { preferredMemberIds: selectedMemberIds })
    }).then((value) => { if (!controller.signal.aborted) setEstimate(value); }).catch(() => undefined);
    return () => controller.abort();
  }, [batch, bookId, expanded, roleKey, selectedMemberIds, source]);

  useEffect(() => {
    if (!expanded || batch !== null) return;
    const sequence = ++inputSaveSequence.current;
    const timer = window.setTimeout(() => {
      void saveAiNodeAuthorInput(bookId, nodeKind, objectId, authorInput).then((saved) => {
        if (sequence === inputSaveSequence.current) setAuthorSavedVersion(saved.version);
      }).catch((reason: unknown) => setError(authorErrorFromUnknown(reason, '作者想法自动保存失败')));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [authorInput, batch, bookId, expanded, nodeKind, objectId]);

  useEffect(() => {
    if (batch === null || ['completed', 'failed', 'cancelled'].includes(batch.status)) return;
    const controller = new AbortController();
    const poll = window.setInterval(() => {
      void fetchAiNodeBatch(bookId, batch.batchId, controller.signal).then(setBatch).catch(() => undefined);
    }, 1800);
    return () => { controller.abort(); window.clearInterval(poll); };
  }, [batch?.batchId, batch?.status, bookId]);

  const start = useCallback(async (confirmed: boolean): Promise<void> => {
    if (!guardAi()) return;
    if (estimate?.requiresConfirmation === true && !confirmed) { setConfirmOpen(true); return; }
    setBusy(true); setError(null);
    try {
      await saveAiNodeAuthorInput(bookId, nodeKind, objectId, authorInput);
      const next = await createAiNodeBatch(bookId, {
        nodeKind, objectId, roleKey, taskDescription, templateVersion,
        sourceVersionIds: source.version === undefined ? [] : [String(source.version)],
        hardSources: [source], optionalSources: [], outputTokenBudget: 4_000, reasoningLevel: 'standard', roundCount: 1, exampleCount: 0,
        ...(selectedMemberIds.length === 0 ? {} : { preferredMemberIds: selectedMemberIds }),
        confirmHighCost: confirmed,
        idempotencyKey: `${nodeKind}:${objectId}:${Date.now()}:${crypto.randomUUID()}`
      });
      setBatch(next); setConfirmOpen(false); setExpanded(true);
    } catch (reason) {
      setError(authorErrorFromUnknown(reason, '团队任务启动失败'));
    } finally { setBusy(false); }
  }, [authorInput, bookId, estimate?.requiresConfirmation, guardAi, nodeKind, objectId, roleKey, selectedMemberIds, source, taskDescription, templateVersion]);

  const recover = async (member: AiNodeBatchMemberView, replacementId?: string): Promise<void> => {
    if (batch === null) return;
    setBusy(true); setError(null);
    try {
      const next = replacementId === undefined
        ? await retryAiNodeMember(bookId, batch.batchId, member.batchMemberId)
        : await replaceAiNodeMember(bookId, batch.batchId, member.batchMemberId, replacementId, true);
      setBatch(next);
    } catch (reason) { setError(authorErrorFromUnknown(reason, '成员恢复失败')); }
    finally { setBusy(false); }
  };

  const availableReplacements = useMemo(() => members.filter((member) =>
    batch?.members.every((current) => current.member.memberId !== member.memberId) ?? true), [batch?.members, members]);

  return <section className="v6-ai-node">
    <header>
      <div><span className="v6-ai-mark"><SparkleIcon weight="fill" /></span><div><h3>{title}</h3><p>{taskDescription}</p></div></div>
      <button type="button" className="v6-quiet-button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        {expanded ? '收起' : batch === null ? '开始设计' : '查看结果'}
      </button>
    </header>
    {expanded && <div className="v6-ai-node-body">
      {batch === null ? <>
        <label className="v6-author-input"><span>补充我的想法 <small>可选 · 只用于本轮</small></span>
          <textarea value={authorInput} rows={3} placeholder="例如：我更想保留哪部分、希望避开什么……"
            onChange={(event) => setAuthorInput(event.target.value)} />
          <small>{authorSavedVersion === null ? '输入会自动保存' : `已自动保存 · 第 ${authorSavedVersion} 版`}</small>
        </label>
        <div className="v6-node-member-row">
          <div><span>参与成员</span><div className="v6-avatar-stack">
            {(selectedMemberIds.length === 0 ? members.slice(0, 1) : members.filter((member) => selectedMemberIds.includes(member.memberId)))
              .map((member) => <MemberBadge key={member.memberId} member={member} compact />)}
          </div></div>
          <button type="button" className="v6-quiet-button" onClick={() => setPickerOpen(true)}><UsersThreeIcon />更换或追加</button>
        </div>
        <div className="v6-node-launch"><span><strong>本次预计消耗：{estimate === null ? '计算中' : `${costTierLabel(estimate.tier)} · ${estimate.units} 算力值`}</strong>
          <small>{estimate === null ? '会按资料长度和成员数动态计算' : `${estimate.memberCount} 位成员 · ${estimate.multiplier.toFixed(1)}×`}</small></span>
          <button type="button" className="v6-primary-button" disabled={busy || members.length === 0} onClick={() => void start(false)}>{busy ? '正在启动…' : '交给团队设计'}</button>
        </div>
      </> : <>
        {batch.authorInputIncluded && <p className="v6-pack-note">作者想法已加入本轮资料包 · 固定版本 {batch.authorInputVersion}</p>}
        <TeamProgress progress={batch.progress} status={batch.status} />
        <div className="v6-candidate-list">{batch.members.map((member) => <div key={member.batchMemberId}>
          <CandidatePanel member={member} {...(onUseCandidate === undefined ? {} : { onUse: onUseCandidate })}
            onRedesign={() => { setBatch(null); setExpanded(true); }} />
          {member.status === 'failed' && <div className="v6-recovery-actions">
            <button type="button" disabled={busy} onClick={() => void recover(member)}><ArrowsClockwiseIcon />只重试这位</button>
            {availableReplacements.map((replacement) => <button key={replacement.memberId} type="button" disabled={busy}
              onClick={() => void recover(member, replacement.memberId)}>换成 {replacement.displayName}</button>)}
          </div>}
        </div>)}</div>
      </>}
      {error !== null && <p className="v6-inline-error" role="alert"><WarningCircleIcon />{error}</p>}
    </div>}
    {pickerOpen && <MemberPicker members={members} selected={selectedMemberIds} onClose={() => setPickerOpen(false)} onApply={(next) => { setSelectedMemberIds(next); setPickerOpen(false); }} />}
    {confirmOpen && <V6Dialog title="确认高消耗任务" onClose={() => setConfirmOpen(false)}>
      <p>本轮将由 {estimate?.memberCount ?? 0} 位成员独立设计，预计消耗 {estimate?.units ?? 0} 算力值。是否继续？</p>
      <footer><button type="button" className="v6-quiet-button" onClick={() => setConfirmOpen(false)}>返回调整</button>
        <button type="button" className="v6-primary-button" onClick={() => void start(true)}>确认并启动</button></footer>
    </V6Dialog>}
  </section>;
}

function MemberPicker({ members, selected, onClose, onApply }: {
  members: EditorialMemberView[];
  selected: string[];
  onClose: () => void;
  onApply: (ids: string[]) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string[]>(selected.length === 0 ? members.slice(0, 1).map((member) => member.memberId) : selected);
  return <V6Dialog title="选择本轮成员" onClose={onClose}>
    <p className="v6-dialog-hint">每位成员独立完成方案；追加成员会增加本轮消耗。</p>
    <div className="v6-member-picker">{members.map((member) => {
      const checked = draft.includes(member.memberId);
      return <label key={member.memberId} className={checked ? 'selected' : ''}>
        <input type="checkbox" checked={checked} onChange={() => setDraft((current) => checked
          ? current.filter((id) => id !== member.memberId) : [...current, member.memberId])} />
        <MemberBadge member={member} />
      </label>;
    })}</div>
    <footer><button type="button" className="v6-quiet-button" onClick={onClose}>取消</button>
      <button type="button" className="v6-primary-button" disabled={draft.length === 0} onClick={() => onApply(draft)}>使用 {draft.length} 位成员</button></footer>
  </V6Dialog>;
}

export function V6Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): React.JSX.Element {
  useModalKeyboard(onClose);
  return <div className="v6-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="v6-dialog" role="dialog" aria-modal="true" aria-labelledby="v6-dialog-title">
      <header><h3 id="v6-dialog-title">{title}</h3><button type="button" className="v6-icon-button" aria-label="关闭" onClick={onClose} autoFocus><XIcon /></button></header>
      {children}
    </section>
  </div>;
}

export function V6Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): React.JSX.Element {
  useModalKeyboard(onClose);
  return <div className="v6-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="v6-drawer" role="dialog" aria-modal="true" aria-label={title}>
      <header><h3>{title}</h3><button type="button" className="v6-icon-button" aria-label="关闭" onClick={onClose} autoFocus><XIcon /></button></header>
      <div>{children}</div>
    </aside>
  </div>;
}

function useModalKeyboard(onClose: () => void): void {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); previous?.focus(); };
  }, [onClose]);
}

export function V6EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }): React.JSX.Element {
  return <section className="v6-state v6-empty-state"><SparkleIcon /><h3>{title}</h3><p>{description}</p>{action}</section>;
}

export function V6LoadingState({ label = '正在整理本书资料…' }: { label?: string }): React.JSX.Element {
  return <section className="v6-state v6-loading-state" aria-live="polite"><ClockIcon /><p>{label}</p></section>;
}

export function V6ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }): React.JSX.Element {
  return <section className="v6-state v6-error-state" role="alert"><WarningCircleIcon /><p>{message}</p>
    {onRetry !== undefined && <button type="button" className="v6-quiet-button" onClick={onRetry}>重新加载</button>}</section>;
}

function costTierLabel(tier: EditorialMemberView['baseCostTier'] | AiNodeCostEstimate['tier']): string {
  return tier === 'low' ? '低' : tier === 'medium' ? '中' : '高';
}

function memberStatusLabel(status: AiNodeBatchMemberView['status']): string {
  return ({ queued: '等待中', working: '工作中', completed: '已完成', failed: '已失败', unavailable: '不可用', replaced: '已替换' } as const)[status];
}

function plainFieldLabel(key: string): string {
  return ({ title: '标题', summary: '概要', reason: '理由', content: '方案', structure: '结构', outline: '骨架', notes: '说明' } as Record<string, string>)[key]
    ?? key.replace(/([A-Z])/g, ' $1').trim();
}

function renderValue(value: unknown): ReactNode {
  if (Array.isArray(value)) return <ul>{value.map((item, index) => <li key={index}>{renderValue(item)}</li>)}</ul>;
  if (typeof value === 'object' && value !== null) return <dl>{Object.entries(value).map(([key, item]) => <div key={key}><dt>{plainFieldLabel(key)}</dt><dd>{renderValue(item)}</dd></div>)}</dl>;
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value ?? '');
}
