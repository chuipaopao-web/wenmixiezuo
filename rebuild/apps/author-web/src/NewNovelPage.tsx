import {
  CheckCircleIcon,
  UsersThreeIcon,
  WarningCircleIcon
} from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImeTextarea } from './ImeSafeField';
import { emptyOpeningPackage, ManualOpeningForm, validateManualOpening } from './ManualOpeningForm';
import { useAuthorAccount } from './AuthorAccountBoundary';
import {
  AuthorApiError,
  abandonOpeningTask,
  confirmOpeningBook,
  createOpeningTask,
  fetchEditorialDepartment,
  fetchOpeningTask,
  fetchOpeningTaxonomy,
  newActionKey,
  reviseOpeningTask,
  type OpeningCandidate,
  type OpeningDecisionResolution,
  type EditorialDepartmentView,
  type OpeningPackage,
  type OpeningPublishingPlatform,
  type OpeningReview,
  type OpeningTaskView,
  type OpeningTaxonomy
} from './opening-api';
import { memberAvatarPosition, memberDisplayName } from './member-avatars';
import { publicFailureCopy, publicStatusCopy, uniqueByMemberKey } from './author-projection';
import { clearOpeningDraft, clearOpeningDraftForTask, openingDraftKey } from './opening-draft-storage';
import { WorkflowActionDock } from './WorkflowActionDock';

const DECISION_KEY_PREFIX = 'wenmi-v7-opening-decisions-v2';
const OPENING_RECOVERY_TIMEOUT_MS = 15_000;

interface OpeningDraftSnapshot {
  idea: string;
  taskId: string | null;
  mode: 'idea' | 'ai' | 'manual';
  publishingPlatform: OpeningPublishingPlatform;
  openingPackage: OpeningPackage | null;
  baseCandidateId: string | null;
  adjustmentNote: string;
  selectedDesignerMemberKey: string;
  manualStep: 1 | 2;
  openingSubmitAction: PendingOpeningAction | null;
  manualConfirmAction: PendingOpeningAction | null;
}

interface PendingOpeningAction {
  key: string;
  inputFingerprint: string;
}

function openingDecisionKey(userId: string, taskId: string, candidateId: string): string {
  return `${DECISION_KEY_PREFIX}:${encodeURIComponent(userId)}:${taskId}:${candidateId}`;
}

function emptySnapshot(entryMode: 'ai' | 'manual'): OpeningDraftSnapshot {
  return {
    idea: '',
    taskId: null,
    mode: entryMode === 'manual' ? 'manual' : 'idea',
    publishingPlatform: 'fanqie',
    openingPackage: null,
    baseCandidateId: null,
    adjustmentNote: '',
    selectedDesignerMemberKey: '',
    manualStep: 1,
    openingSubmitAction: null,
    manualConfirmAction: null
  };
}

function pendingOpeningAction(value: unknown): PendingOpeningAction | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const key = typeof record.key === 'string' ? record.key.trim() : '';
  const inputFingerprint = typeof record.inputFingerprint === 'string' ? record.inputFingerprint : '';
  return key.length >= 8 && key.length <= 128 && inputFingerprint.length > 0
    ? { key, inputFingerprint }
    : null;
}

function definitivelyRejectedAction(reason: unknown): boolean {
  return reason instanceof AuthorApiError
    && reason.status >= 400
    && reason.status < 500
    && reason.status !== 401
    && !reason.retryable;
}

function readSnapshot(entryMode: 'ai' | 'manual', userId: string): OpeningDraftSnapshot {
  try {
    const requestedTaskId = new URLSearchParams(window.location.search).get('taskId')?.trim() || null;
    const parsed = JSON.parse(localStorage.getItem(openingDraftKey(userId, entryMode)) ?? 'null') as Partial<OpeningDraftSnapshot> | null;
    const idea = typeof parsed?.idea === 'string' ? Array.from(parsed.idea).slice(0, 2_000).join('') : '';
    const publishingPlatform = parsed?.publishingPlatform === 'qidian' || parsed?.publishingPlatform === 'mainstream'
      ? parsed.publishingPlatform
      : 'fanqie';
    const openingPackage = parsed?.openingPackage === null || parsed?.openingPackage === undefined
      ? null
      : clonePackage(parsed.openingPackage);
    const baseCandidateId = typeof parsed?.baseCandidateId === 'string' && parsed.baseCandidateId.trim().length > 0
      ? parsed.baseCandidateId
      : null;
    const adjustmentNote = typeof parsed?.adjustmentNote === 'string'
      ? Array.from(parsed.adjustmentNote).slice(0, 2_000).join('')
      : '';
    const selectedDesignerMemberKey = typeof parsed?.selectedDesignerMemberKey === 'string'
      ? parsed.selectedDesignerMemberKey.slice(0, 120)
      : '';
    const manualStep = parsed?.manualStep === 2 ? 2 : 1;
    const openingSubmitAction = pendingOpeningAction(parsed?.openingSubmitAction);
    const manualConfirmAction = pendingOpeningAction(parsed?.manualConfirmAction);
    const restored: OpeningDraftSnapshot = {
      idea,
      taskId: null,
      mode: 'idea' as const,
      publishingPlatform,
      openingPackage,
      baseCandidateId,
      adjustmentNote,
      selectedDesignerMemberKey,
      manualStep,
      openingSubmitAction,
      manualConfirmAction
    };
    if (entryMode === 'manual') {
      return parsed?.mode === 'manual'
        ? { ...restored, mode: 'manual', openingPackage }
        : { ...emptySnapshot(entryMode), publishingPlatform };
    }
    if (requestedTaskId !== null) {
      return parsed?.mode === 'ai' && parsed.taskId?.trim() === requestedTaskId
        ? { ...restored, taskId: requestedTaskId, mode: 'ai' }
        : { ...emptySnapshot(entryMode), taskId: requestedTaskId, mode: 'ai' };
    }
    if (parsed?.mode === 'manual') {
      return { ...restored, taskId: null, mode: 'manual' };
    }
    if (parsed?.mode === 'ai' && typeof parsed.taskId === 'string' && parsed.taskId.trim().length > 0) {
      return { ...restored, taskId: parsed.taskId, mode: 'ai' };
    }
    return { ...restored, openingPackage: null, baseCandidateId: null, adjustmentNote: '', mode: 'idea' };
  } catch {
    return emptySnapshot(entryMode);
  }
}

function clonePackage(value: OpeningPackage): OpeningPackage {
  const cloned = JSON.parse(JSON.stringify(value)) as OpeningPackage;
  return {
    ...cloned,
    positioning: {
      ...cloned.positioning,
      publishingPlatform: cloned.positioning.publishingPlatform ?? 'fanqie'
    },
    protagonists: cloned.protagonists.map((item) => ({
      ...item,
      identity: normalizeRoleIdentity(item.identity, cloned.positioning.channel)
    }))
  };
}

function normalizeRoleIdentity(identity: string, channel: OpeningPackage['positioning']['channel']): string {
  if (['男主', '女主', '共同主角', '群像主角', '非人主角'].includes(identity)) return identity;
  if (identity.includes('群像')) return '群像主角';
  if (identity.includes('共同') || identity.includes('双主角')) return '共同主角';
  if (identity.includes('非人') || identity.includes('妖') || identity.includes('兽')) return '非人主角';
  if (identity.includes('女')) return '女主';
  return channel === 'female' ? '女主' : '男主';
}

function latestCandidate<T>(task: OpeningTaskView | null, kind: OpeningCandidate['kind']): OpeningCandidate<T> | null {
  return task?.candidates
    .filter((item) => item.kind === kind)
    .sort((left, right) => right.version - left.version)[0] as OpeningCandidate<T> | undefined ?? null;
}

function errorMessage(error: unknown): string {
  if (error instanceof AuthorApiError && error.status === 401) {
    return '对不起，登录状态已经失效，请重新登录后继续。';
  }
  if (error instanceof AuthorApiError && error.status >= 400 && error.status < 500) {
    return publicStatusCopy(error.message, '对不起，这次操作没有完成，请检查当前条件后再试。');
  }
  return '对不起，这次操作没有完成，请稍后重试。';
}

function WorkStatus({ task }: { task: OpeningTaskView }): React.JSX.Element {
  const reviewer = task.selectedMembers.reviewer ?? task.selectedMembers.chiefEditor;
  const designer = task.selectedMembers.designer ?? task.selectedMembers.screenwriter;
  const activeMember = task.phase.includes('review') ? reviewer : designer;
  const members = uniqueByMemberKey([designer, reviewer].filter((member): member is NonNullable<typeof member> => member !== null));
  const phaseText = publicStatusCopy(task.phaseText, '正在处理当前步骤');
  const statusText = publicStatusCopy(task.phaseText || task.statusText, '编辑部正在处理这项工作。');
  return (
    <div className="editorial-live-room" role="status" aria-live="polite" aria-label="编辑部工作进度">
      <div className="editorial-live-cast">
        {activeMember !== null && <div className="editorial-lead">
          <span className="chief-live-avatar" style={{ backgroundPosition: memberAvatarPosition(activeMember.memberKey) }} aria-hidden="true" />
          <strong>{memberDisplayName(activeMember.memberKey, activeMember.displayName)}</strong>
          <small>{activeMember.memberKey === reviewer?.memberKey ? '审查主编' : '开书设计'} · 当前工位：{phaseText}</small>
        </div>}
      </div>
      <p className="editorial-live-message">{statusText}</p>
      <div className="editorial-live-members" aria-label="本轮创作成员">
        {members.map((member) => <span key={member.memberKey}>
          <i className="agent-avatar" style={{ backgroundPosition: memberAvatarPosition(member.memberKey) }} aria-hidden="true" />
          <b>{memberDisplayName(member.memberKey, member.displayName)} · {member.memberKey === reviewer?.memberKey ? '审查主编' : '设计成员'}</b>
        </span>)}
      </div>
      <div className="phase-track" aria-label={`当前进度：${phaseText}`}>
        {['直接设计', '审查点评'].map((label, index) => <div className={index + 1 < task.progress.currentStep ? 'done' : index + 1 === task.progress.currentStep ? 'active' : ''} key={label}><span>{index + 1 < task.progress.currentStep ? '✓' : index + 1}</span><strong>{label}</strong></div>)}
      </div>
      <div className="honest-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress.percent}><span style={{ width: `${task.progress.percent}%` }} /></div>
      <details className="editorial-brief"><summary>看看本轮开书想法</summary><p>{task.idea}</p></details>
      <p className="safe-leave-copy">任务已经保存，您可以放心离开或刷新；回来后，编辑部会接着向您汇报真实进度。</p>
    </div>
  );
}

interface ReviewDecisionView {
  decisionId: string;
  field: string;
  question: string;
  currentValue: string;
  recommendation: string;
  reason: string;
  impact: string;
  required: boolean;
}

function reviewDecisions(review: OpeningReview | null): ReviewDecisionView[] {
  if (review === null) return [];
  if ((review.decisions?.length ?? 0) > 0) return review.decisions!;
  const savedItems = review.authorDecisions.length > 0 ? review.authorDecisions : review.requiredChanges;
  return savedItems.map((item, index) => ({
    decisionId: `saved-${index + 1}`, field: '', question: authorFacingReviewText(item),
    currentValue: '保持当前资料', recommendation: authorFacingReviewText(item),
    reason: '这是本轮主编留下的审查意见，采纳后只会重新整理开书资料。',
    impact: '只影响本页开书资料，不进入设定、蓝图或正文。', required: true
  }));
}

function ReviewPanel({ review, memberName, resolutions, onResolve, onAcceptAll }: {
  review: OpeningReview | null;
  memberName: string | null;
  resolutions: Record<string, OpeningDecisionResolution>;
  onResolve: (decisionId: string, resolution: OpeningDecisionResolution | null) => void;
  onAcceptAll: (decisions: ReviewDecisionView[]) => void;
}): React.JSX.Element | null {
  if (review === null) return null;
  const decisions = reviewDecisions(review);
  const itemCount = decisions.length + review.requiredChanges.length + review.issues.length;
  const resolvedCount = decisions.filter((item) => resolutions[item.decisionId] !== undefined).length;
  const allAccepted = decisions.length > 0 && decisions.every((item) => resolutions[item.decisionId]?.action === 'accept');
  return (
    <details className={`review-panel compact-review-panel verdict-${review.verdict}`} open={review.verdict === 'author_decision'}>
      <summary><CheckCircleIcon /><span><strong>{memberName ?? '主编'}审查</strong><small>{review.verdict === 'pass' ? '资料已经审查通过' : review.verdict === 'author_decision' ? '有内容需要您决定' : '有内容建议调整'}</small></span><b>{itemCount > 0 ? `${itemCount}项意见` : '查看意见'}</b></summary>
      <div className="compact-review-body">
        <p>{authorFacingReviewText(review.summary)}</p>
        {decisions.length > 0 && <section className="review-decision-section"><header><div><strong>请您决定</strong><small>先选处理方式，再请主编按选择更新开书资料。</small></div><button aria-pressed={allAccepted} className={allAccepted ? 'selected' : ''} type="button" onClick={() => onAcceptAll(decisions)}>{allAccepted ? `已采纳全部（${decisions.length}）` : '采纳全部建议'}</button></header><div className="review-decision-list">{decisions.map((item) => {
          const selected = resolutions[item.decisionId];
          return <article className={selected === undefined ? '' : `resolved ${selected.action}`} key={item.decisionId}>
            <div className="decision-card-heading"><span>{item.field ? reviewFieldLabel(item.field) : '开书方向'}</span>{item.required && <b>需要决定</b>}</div>
            <h4>{item.question}</h4>
            <dl><div><dt>当前方案</dt><dd>{item.currentValue}</dd></div><div><dt>主编建议</dt><dd>{item.recommendation}</dd></div></dl>
            <details><summary>为什么这样建议</summary><p>{item.reason}</p><small>{item.impact}</small></details>
            <div className="decision-actions">
              <button aria-pressed={selected?.action === 'accept'} className={selected?.action === 'accept' ? 'selected' : ''} type="button" onClick={() => onResolve(item.decisionId, { decisionId: item.decisionId, action: 'accept' })}>{selected?.action === 'accept' ? '已采纳' : '采纳建议'}</button>
              <button aria-pressed={selected?.action === 'reject'} className={selected?.action === 'reject' ? 'selected' : ''} type="button" onClick={() => onResolve(item.decisionId, { decisionId: item.decisionId, action: 'reject' })}>{selected?.action === 'reject' ? '已暂不采纳' : '暂不采纳'}</button>
              <button aria-pressed={selected?.action === 'custom'} className={selected?.action === 'custom' ? 'selected' : ''} type="button" onClick={() => onResolve(item.decisionId, { decisionId: item.decisionId, action: 'custom', customValue: selected?.customValue ?? '' })}>{selected?.action === 'custom' ? '正在修改后采纳' : '修改后采纳'}</button>
            </div>
            {selected?.action === 'custom' && <label className="decision-custom"><span>写下您的方案</span><ImeTextarea rows={3} maxChars={800} value={selected.customValue ?? ''} onChange={(customValue) => onResolve(item.decisionId, { ...selected, customValue })} placeholder="只写这一项希望怎样调整"/><small>{Array.from(selected.customValue ?? '').length}/800</small></label>}
            {selected !== undefined && <p className="decision-action-status" role="status">{selected.action === 'accept' ? '已选择采纳，尚未提交给主编。' : selected.action === 'reject' ? '已选择暂不采纳，尚未提交给主编。' : (selected.customValue?.trim().length ?? 0) > 0 ? '您的修改方案已保存，尚未提交给主编。' : '请写下修改方案，再交给主编更新。'}</p>}
          </article>;
        })}</div><footer className="review-decision-submit"><span role="status"><strong>已处理 {resolvedCount}/{decisions.length} 项</strong><small>请在页面底部提交给主编。</small></span></footer></section>}
        {review.requiredChanges.length > 0 && <div><strong>需要调整</strong><ul>{review.requiredChanges.map((item) => <li key={item}>{authorFacingReviewText(item)}</li>)}</ul></div>}
        {review.issues.length > 0 && <div className="review-issue-list"><strong>具体问题</strong>{review.issues.map((item, index) => <article key={`${item.field}-${index}`}><strong>{reviewFieldLabel(item.field)}</strong><p>{authorFacingReviewText(item.requiredAction)}</p></article>)}</div>}
      </div>
    </details>
  );
}

const REVIEW_FIELD_LABELS: Record<string, string> = {
  title: '书名',
  'positioning.channel': '创作频道',
  'positioning.category': '作品分类',
  'positioning.genres': '融合题材',
  'positioning.tags': '内容标签',
  'positioning.coreAppeal': '作品看点',
  'positioning.targetReaders': '适合读者',
  'positioning.expectedTotalWords': '预计总字数',
  'positioning.volumePlan': '建议卷数',
  'positioning.retentionPositioning': '追读定位',
  'backgrounds.eraAndWorld': '时代与世界',
  'backgrounds.openingSituation': '后续开局资料',
  'longTermDirection.centralConflict': '故事方向',
  'longTermDirection.progression': '故事方向',
  'longTermDirection.relationshipDirection': '故事方向',
  'longTermDirection.storyPotential': '故事方向',
  'possibleEnding.direction': '结局方向',
  'possibleEnding.price': '结局方向',
  'possibleEnding.openness': '结局方向'
};

export function reviewFieldLabel(field: string): string {
  const normalized = field.trim();
  if (REVIEW_FIELD_LABELS[normalized] !== undefined) return REVIEW_FIELD_LABELS[normalized]!;
  if (normalized.startsWith('authorNotes')) return '作者补充';
  if (normalized.startsWith('opening.')) return '后续开局资料';
  if (normalized.startsWith('protagonists.')) {
    const suffix = normalized.split('.').at(-1) ?? '';
    return ({
      name: '角色姓名', age: '角色年龄', identity: '角色身份', background: '角色背景',
      goal: '角色目标', dilemma: '后续角色处境', personality: '角色性格', boundary: '人物边界',
      appearance: '角色外貌', build: '角色身形', signatureFeature: '角色辨识特征'
    } as Record<string, string>)[suffix] ?? '角色资料';
  }
  return '相关资料';
}

export function authorFacingReviewText(value: string): string {
  return value.replace(
    /(?:positioning|backgrounds|protagonists|opening|longTermDirection|possibleEnding|authorNotes)(?:\.[\w\p{Script=Han}-]+)+/gu,
    (field) => reviewFieldLabel(field)
  );
}

type OpeningMembershipRecoveryAction = NonNullable<OpeningTaskView['recoveryAction']>;

export function NewNovelPage({ entryMode, onBack, onCreated, onAuthenticationRequired, onOpenAccount, membershipRetryReady, onMembershipRetryConsumed }: {
  entryMode: 'ai' | 'manual';
  onBack: () => void;
  onCreated: (bookId: string) => void;
  onAuthenticationRequired: () => void;
  onOpenAccount: (recoveryAction: OpeningMembershipRecoveryAction) => void;
  membershipRetryReady: boolean;
  onMembershipRetryConsumed: () => void;
}): React.JSX.Element {
  const { account } = useAuthorAccount();
  const draftStorageKey = openingDraftKey(account.userId, entryMode);
  const [initial] = useState(() => readSnapshot(entryMode, account.userId));
  const [idea, setIdea] = useState(initial.idea);
  const [mode, setMode] = useState<OpeningDraftSnapshot['mode']>(initial.mode);
  const [publishingPlatform, setPublishingPlatform] = useState<OpeningPublishingPlatform>(initial.publishingPlatform);
  const [taskId, setTaskId] = useState<string | null>(initial.taskId);
  const [task, setTask] = useState<OpeningTaskView | null>(null);
  const [taxonomy, setTaxonomy] = useState<OpeningTaxonomy | null>(null);
  const [department, setDepartment] = useState<EditorialDepartmentView | null>(null);
  const [selectedDesignerMemberKey, setSelectedDesignerMemberKey] = useState(initial.selectedDesignerMemberKey);
  const [openingPackage, setOpeningPackage] = useState<OpeningPackage | null>(
    initial.openingPackage ?? (initial.mode === 'manual' ? emptyOpeningPackage() : null)
  );
  const [baseCandidateId, setBaseCandidateId] = useState<string | null>(initial.baseCandidateId);
  const [adjustmentNote, setAdjustmentNote] = useState(initial.adjustmentNote);
  const [decisionResolutions, setDecisionResolutions] = useState<Record<string, OpeningDecisionResolution>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualStep, setManualStep] = useState<1 | 2>(initial.manualStep);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [openingSubmitAction, setOpeningSubmitAction] = useState<PendingOpeningAction | null>(initial.openingSubmitAction);
  const [manualConfirmAction, setManualConfirmAction] = useState<PendingOpeningAction | null>(initial.manualConfirmAction);
  const loadedCandidateRef = useRef<string | null>(initial.baseCandidateId);
  const openingSubmitRef = useRef(false);
  const confirmSubmitRef = useRef(false);
  const onCreatedRef = useRef(onCreated);

  useEffect(() => { onCreatedRef.current = onCreated; }, [onCreated]);

  const handleRequestFailure = useCallback((reason: unknown, showError = true): boolean => {
    if (reason instanceof AuthorApiError && reason.status === 401) {
      onAuthenticationRequired();
      return true;
    }
    if (showError) setError(errorMessage(reason));
    return false;
  }, [onAuthenticationRequired]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchOpeningTaxonomy(controller.signal).then((value) => {
      setTaxonomy(value);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) handleRequestFailure(reason);
    });
    return () => controller.abort();
  }, [handleRequestFailure]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchEditorialDepartment(controller.signal)
      .then((value) => { if (!controller.signal.aborted) setDepartment(value); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) handleRequestFailure(reason, false); });
    return () => controller.abort();
  }, [handleRequestFailure]);

  useEffect(() => {
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify({
        idea,
        taskId,
        mode,
        publishingPlatform,
        openingPackage,
        baseCandidateId,
        adjustmentNote,
        selectedDesignerMemberKey,
        manualStep,
        openingSubmitAction,
        manualConfirmAction
      } satisfies OpeningDraftSnapshot));
    } catch {
      // 浏览器拒绝本地存储时仍保留当前内存输入；提交失败会继续显示原位恢复提示。
    }
  }, [adjustmentNote, baseCandidateId, draftStorageKey, idea, manualConfirmAction, manualStep, mode, openingPackage, openingSubmitAction, publishingPlatform, selectedDesignerMemberKey, taskId]);

  const persistPendingAction = useCallback((
    field: 'openingSubmitAction' | 'manualConfirmAction',
    value: PendingOpeningAction | null
  ): void => {
    try {
      const current = JSON.parse(localStorage.getItem(draftStorageKey) ?? '{}') as Record<string, unknown>;
      localStorage.setItem(draftStorageKey, JSON.stringify({ ...current, [field]: value }));
    } catch {
      // 页面状态仍保留本轮动作键；浏览器恢复存储后，常规草稿保存会再次写入。
    }
  }, [draftStorageKey]);

  const removeTaskFromLocation = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('taskId');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const writeTaskToLocation = useCallback((nextTaskId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'new-novel');
    url.searchParams.set('entry', 'ai');
    url.searchParams.set('taskId', nextTaskId);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const startFreshIdea = useCallback(() => {
    if (taskId !== null) clearOpeningDraftForTask(account.userId, taskId);
    else clearOpeningDraft(account.userId, 'ai');
    removeTaskFromLocation();
    loadedCandidateRef.current = null;
    setIdea('');
    setMode('idea');
    setTaskId(null);
    setTask(null);
    setOpeningPackage(null);
    setBaseCandidateId(null);
    setAdjustmentNote('');
    setSelectedDesignerMemberKey('');
    setDecisionResolutions({});
    setManualStep(1);
    setError(null);
    setRecoveryError(null);
    setResetConfirmationOpen(false);
    setOpeningSubmitAction(null);
    setManualConfirmAction(null);
  }, [account.userId, removeTaskFromLocation, taskId]);

  useEffect(() => {
    if (taskId === null || mode !== 'ai') return;
    let stopped = false;
    let timer = 0;
    const controller = new AbortController();
    const refresh = async () => {
      const requestController = new AbortController();
      const abortRequest = () => requestController.abort(controller.signal.reason);
      controller.signal.addEventListener('abort', abortRequest, { once: true });
      const requestTimeout = window.setTimeout(() => {
        requestController.abort(new DOMException('找回工作记录超时', 'TimeoutError'));
      }, OPENING_RECOVERY_TIMEOUT_MS);
      try {
        const value = await fetchOpeningTask(taskId, requestController.signal);
        if (stopped) return;
        if (value.status === 'archived') {
          startFreshIdea();
          return;
        }
        if (value.resultBookId !== null) {
          clearOpeningDraftForTask(account.userId, taskId);
          onCreatedRef.current(value.resultBookId);
          return;
        }
        setIdea(value.idea);
        setTask(value);
        setPublishingPlatform(value.publishingPlatform);
        setRecoveryError(null);
        if (value.isRunning) timer = window.setTimeout(refresh, 1_200);
      } catch (reason) {
        if (stopped) return;
        if (reason instanceof AuthorApiError && reason.status === 404) {
          setTaskId(null);
          setMode('idea');
          setTask(null);
          setOpeningPackage(null);
          setBaseCandidateId(null);
          loadedCandidateRef.current = null;
          setError(null);
          setRecoveryError(null);
          clearOpeningDraftForTask(account.userId, taskId);
          removeTaskFromLocation();
          return;
        }
        if (handleRequestFailure(reason, false)) return;
        setRecoveryError(errorMessage(reason));
      } finally {
        window.clearTimeout(requestTimeout);
        controller.signal.removeEventListener('abort', abortRequest);
      }
    };
    void refresh();
    return () => { stopped = true; controller.abort(); window.clearTimeout(timer); };
  }, [account.userId, handleRequestFailure, mode, recoveryAttempt, removeTaskFromLocation, startFreshIdea, taskId]);

  useEffect(() => {
    const candidate = latestCandidate<OpeningPackage>(task, 'opening_package');
    if (candidate === null || loadedCandidateRef.current === candidate.candidateId) return;
    loadedCandidateRef.current = candidate.candidateId;
    setBaseCandidateId(candidate.candidateId);
    setOpeningPackage(clonePackage(candidate.content));
    setAdjustmentNote('');
  }, [task]);

  const packageCandidate = latestCandidate<OpeningPackage>(task, 'opening_package');
  const reviewCandidate = task?.candidates
    .filter((item) => item.kind === 'opening_review' && (packageCandidate === null || item.sourceCandidateIds.includes(packageCandidate.candidateId)))
    .sort((left, right) => right.version - left.version)[0] as OpeningCandidate<OpeningReview> | undefined ?? null;
  const review = reviewCandidate?.content ?? null;
  const currentReviewDecisions = useMemo(() => reviewDecisions(review), [review]);
  const decisionStorageKey = taskId === null || reviewCandidate === null
    ? null
    : openingDecisionKey(account.userId, taskId, reviewCandidate.candidateId);
  const [hydratedDecisionKey, setHydratedDecisionKey] = useState<string | null>(null);
  useEffect(() => {
    if (decisionStorageKey === null) {
      setDecisionResolutions({});
      setHydratedDecisionKey(null);
      return;
    }
    try {
      const parsed = JSON.parse(localStorage.getItem(decisionStorageKey) ?? '{}') as Record<string, OpeningDecisionResolution>;
      setDecisionResolutions(parsed);
    } catch {
      setDecisionResolutions({});
    }
    setHydratedDecisionKey(decisionStorageKey);
  }, [decisionStorageKey]);
  useEffect(() => {
    if (decisionStorageKey !== null && hydratedDecisionKey === decisionStorageKey) {
      try {
        localStorage.setItem(decisionStorageKey, JSON.stringify(decisionResolutions));
      } catch {
        // 当前页仍保留作者选择；浏览器恢复存储后，下一次修改会再次尝试保存。
      }
    }
  }, [decisionResolutions, decisionStorageKey, hydratedDecisionKey]);
  const manualValidation = useMemo(() => openingPackage === null
    ? { stepOne: ['尚无开书资料'], stepTwo: [], all: ['尚无开书资料'] }
    : validateManualOpening(openingPackage, taxonomy), [openingPackage, taxonomy]);
  const validationErrors = manualValidation.all;
  const dirty = mode === 'ai' && openingPackage !== null && packageCandidate !== null && (
    JSON.stringify(openingPackage) !== JSON.stringify(packageCandidate.content)
    || adjustmentNote.trim().length > 0
  );
  const activeDecisionResolutions = currentReviewDecisions
    .map((item) => decisionResolutions[item.decisionId])
    .filter((item): item is OpeningDecisionResolution => item !== undefined);
  const unresolvedRequiredDecisions = currentReviewDecisions.filter((item) => item.required && decisionResolutions[item.decisionId] === undefined);
  const invalidCustomDecision = activeDecisionResolutions.some((item) => item.action === 'custom' && (item.customValue?.trim().length ?? 0) === 0);
  const hasDecisionUpdates = activeDecisionResolutions.length > 0;
  const canConfirm = openingPackage !== null && validationErrors.length === 0 && !busy && (
    mode === 'manual' || (
      task?.status === 'awaiting_author_confirmation'
      && review?.verdict === 'pass'
      && !dirty
      && baseCandidateId === packageCandidate?.candidateId
    )
  );
  const ideaLength = Array.from(idea).length;

  const startAi = async () => {
    if (ideaLength < 4 || ideaLength > 2_000 || openingSubmitRef.current) return;
    openingSubmitRef.current = true;
    setBusy(true);
    setError(null);
    const inputFingerprint = JSON.stringify({
      idea: idea.trim(),
      publishingPlatform: 'fanqie',
      selectedDesignerMemberKey: selectedDesignerMemberKey || null
    });
    const action = openingSubmitAction?.inputFingerprint === inputFingerprint
      ? openingSubmitAction
      : { key: newActionKey('opening'), inputFingerprint };
    setOpeningSubmitAction(action);
    persistPendingAction('openingSubmitAction', action);
    try {
      const next = await createOpeningTask(
        idea.trim(),
        'fanqie',
        action.key,
        selectedDesignerMemberKey || undefined
      );
      setOpeningSubmitAction(null);
      persistPendingAction('openingSubmitAction', null);
      loadedCandidateRef.current = null;
      setTask(next);
      setIdea(next.idea || idea.trim());
      setTaskId(next.taskId);
      writeTaskToLocation(next.taskId);
      setMode('ai');
      setPublishingPlatform(next.publishingPlatform);
      setOpeningPackage(null);
      setBaseCandidateId(null);
    } catch (reason) {
      if (definitivelyRejectedAction(reason)) {
        setOpeningSubmitAction(null);
        persistPendingAction('openingSubmitAction', null);
      }
      handleRequestFailure(reason);
    } finally {
      openingSubmitRef.current = false;
      setBusy(false);
    }
  };

  const redesignWithMember = async () => {
    if (taskId === null || busy || selectedDesignerMemberKey.length === 0 || openingSubmitRef.current) return;
    openingSubmitRef.current = true;
    setBusy(true);
    setError(null);
    const inputFingerprint = JSON.stringify({
      idea: idea.trim(),
      publishingPlatform: 'fanqie',
      selectedDesignerMemberKey
    });
    const action = openingSubmitAction?.inputFingerprint === inputFingerprint
      ? openingSubmitAction
      : { key: newActionKey('opening-redesign'), inputFingerprint };
    setOpeningSubmitAction(action);
    persistPendingAction('openingSubmitAction', action);
    try {
      const previousTaskId = taskId;
      const next = await createOpeningTask(
        idea.trim(),
        'fanqie',
        action.key,
        selectedDesignerMemberKey
      );
      setOpeningSubmitAction(null);
      persistPendingAction('openingSubmitAction', null);
      loadedCandidateRef.current = null;
      setTask(next);
      setIdea(next.idea || idea.trim());
      setTaskId(next.taskId);
      writeTaskToLocation(next.taskId);
      setMode('ai');
      setOpeningPackage(null);
      setBaseCandidateId(null);
      setDecisionResolutions({});
      setError(null);
      // 新任务已经成功创建时必须立即切换页面；旧任务归档只是清理动作，
      // 网络变慢不能再次把作者锁在“正在重新安排”。
      void abandonOpeningTask(previousTaskId).catch(() => {
        setError('新方案已经开始，但上一轮任务暂时没有归档；它不会覆盖新方案。');
      });
    } catch (reason) {
      if (definitivelyRejectedAction(reason)) {
        setOpeningSubmitAction(null);
        persistPendingAction('openingSubmitAction', null);
      }
      handleRequestFailure(reason);
    } finally {
      openingSubmitRef.current = false;
      setBusy(false);
    }
  };

  const startManual = () => {
    if (ideaLength < 4 || ideaLength > 2_000) return;
    removeTaskFromLocation();
    setMode('manual');
    setTaskId(null);
    setTask(null);
    setBaseCandidateId(null);
    setOpeningPackage(openingPackage ?? emptyOpeningPackage());
    setManualStep(1);
    setError(null);
  };

  const submitRevision = async () => {
    if (taskId === null || baseCandidateId === null || openingPackage === null || (!dirty && !hasDecisionUpdates) || unresolvedRequiredDecisions.length > 0 || invalidCustomDecision) return;
    setBusy(true);
    setError(null);
    try {
      const next = await reviseOpeningTask({
        taskId,
        baseCandidateId,
        openingPackage,
        adjustmentNote,
        decisionResolutions: activeDecisionResolutions,
        idempotencyKey: newActionKey('revision')
      });
      setTask(next);
    } catch (reason) {
      handleRequestFailure(reason);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!canConfirm || openingPackage === null || confirmSubmitRef.current) return;
    confirmSubmitRef.current = true;
    setBusy(true);
    setError(null);
    const manualInputFingerprint = mode === 'manual'
      ? JSON.stringify({ openingIdea: idea.trim(), openingPackage })
      : null;
    const action = manualInputFingerprint === null
      ? { key: newActionKey('confirm'), inputFingerprint: '' }
      : manualConfirmAction?.inputFingerprint === manualInputFingerprint
        ? manualConfirmAction
        : { key: newActionKey('confirm'), inputFingerprint: manualInputFingerprint };
    if (mode === 'manual') {
      setManualConfirmAction(action);
      persistPendingAction('manualConfirmAction', action);
    }
    try {
      const result = await confirmOpeningBook({
        ...(mode === 'ai' && taskId !== null && baseCandidateId !== null
          ? { taskId, candidateId: baseCandidateId }
          : {}),
        ...(mode === 'manual' && idea.trim().length > 0 ? { openingIdea: idea.trim() } : {}),
        openingPackage,
        idempotencyKey: action.key
      });
      if (mode === 'manual') {
        setManualConfirmAction(null);
        persistPendingAction('manualConfirmAction', null);
      }
      localStorage.removeItem(draftStorageKey);
      onCreated(result.bookId);
    } catch (reason) {
      if (mode === 'manual' && definitivelyRejectedAction(reason)) {
        setManualConfirmAction(null);
        persistPendingAction('manualConfirmAction', null);
      }
      handleRequestFailure(reason);
    } finally {
      confirmSubmitRef.current = false;
      setBusy(false);
    }
  };

  const restart = () => {
    if (entryMode === 'ai') startFreshIdea();
    else {
      clearOpeningDraft(account.userId, 'manual');
      loadedCandidateRef.current = null;
      setIdea('');
      setMode('manual');
      setTaskId(null);
      setTask(null);
      setOpeningPackage(emptyOpeningPackage());
      setManualStep(1);
      setBaseCandidateId(null);
      setAdjustmentNote('');
      setSelectedDesignerMemberKey('');
      setOpeningSubmitAction(null);
      setManualConfirmAction(null);
      setDecisionResolutions({});
      setError(null);
      setResetConfirmationOpen(false);
    }
  };

  if (mode === 'ai' && taskId !== null && recoveryError !== null) {
    return <section className="novel-create-surface" aria-label="恢复开书任务"><div className="failure-card compact-failure-card" role="alert">
      <WarningCircleIcon /><p className="eyebrow">恢复没有完成</p><h2>对不起，这次没有找回工作记录</h2><p>{recoveryError}</p>
    </div><WorkflowActionDock
      title="选择如何继续"
      detail="重新连接不会重复创建任务；也可以放弃这份本地草稿，直接写新想法。"
      primary={<button className="primary-action" type="button" onClick={() => { setTask(null); setRecoveryError(null); setRecoveryAttempt((current) => current + 1); }}>重新连接</button>}
      secondary={<><button className="secondary-action" type="button" onClick={startFreshIdea}>重新填写想法</button><button className="secondary-action" type="button" onClick={onBack}>返回首页</button></>}
    /></section>;
  }

  if (mode === 'ai' && taskId !== null && task === null) {
    return <section className="novel-create-surface" aria-label="恢复开书任务"><div className="inline-task-recovery" role="status">编辑部正在找回您之前的工作记录…</div><WorkflowActionDock
      title="找回记录时也能继续"
      detail="超过15秒会明确提示恢复失败，不再一直白屏等待。"
      primary={<button className="primary-action" type="button" onClick={startFreshIdea}>直接开始新书</button>}
      secondary={<button className="secondary-action" type="button" onClick={onBack}>返回首页</button>}
    /></section>;
  }

  if (mode === 'ai' && task?.retired === true) {
    return <section className="novel-create-surface" aria-label="开书任务恢复"><div className="failure-card compact-failure-card">
      <WarningCircleIcon /><p className="eyebrow">本轮未完成</p><h2 id="novel-create-title">已有结果和开书思路都已保留</h2><p>对不起，这项未完成任务已经停止，请按当前流程重新开始。</p>
    </div><WorkflowActionDock title="继续这本书" detail="历史结果已安全保留。" primary={<button className="primary-action" type="button" disabled={busy} onClick={() => void startAi()}>{busy ? '正在重新提交…' : '按当前流程重新开始'}</button>} secondary={<><button className="secondary-action" type="button" disabled={busy} onClick={startManual}>{openingPackage === null ? '自己填写开书资料' : '保留现有资料，自己完成'}</button><button className="secondary-action" type="button" disabled={busy} onClick={startFreshIdea}>重新填写想法</button></>} /></section>;
  }

  if (mode === 'ai' && task !== null && task.isRunning) {
    return <section className="novel-create-surface" aria-label="开书设计进度"><WorkStatus task={task} /></section>;
  }

  if (mode === 'ai' && task !== null && (task.status === 'failed' || task.status === 'interrupted')) {
    const membershipRecoveryAction = task.recoveryAction;
    const membershipBlocked = membershipRecoveryAction === 'open_membership_required'
      || membershipRecoveryAction === 'open_membership_quota'
      || membershipRecoveryAction === 'open_membership_expired';
    if (membershipBlocked) {
      return <section className="novel-create-surface" aria-label="开书任务恢复"><div className="failure-card compact-failure-card">
        <WarningCircleIcon /><p className="eyebrow">需要先处理会员或额度</p><h2 id="novel-create-title">开书想法已经安全保存</h2><p>{publicFailureCopy(task.errorMessage)}</p>
      </div><WorkflowActionDock title="这本书仍然可以继续" detail={membershipRetryReady ? '会员信息已经重新确认，当前状态可以使用已保存的想法发起一轮新任务，不会覆盖旧结果。' : '先查看会员或额度；也可以不等AI，直接自己填写开书资料。'} primary={membershipRetryReady || busy
        ? <button className="primary-action" type="button" disabled={busy} onClick={() => { onMembershipRetryConsumed(); void startAi(); }}>{busy ? '正在提交…' : '重新交给创作团队'}</button>
        : <button className="primary-action" type="button" onClick={() => onOpenAccount(membershipRecoveryAction)}>查看会员与额度</button>} secondary={<>{membershipRetryReady && <button className="secondary-action" type="button" onClick={() => onOpenAccount(membershipRecoveryAction)}>再次查看会员与额度</button>}<button className="secondary-action" type="button" disabled={busy} onClick={startManual}>自己填写开书资料</button><button className="secondary-action" type="button" disabled={busy} onClick={startFreshIdea}>重新填写想法</button></>} /></section>;
    }
    return <section className="novel-create-surface" aria-label="开书任务恢复"><div className="failure-card compact-failure-card">
      <WarningCircleIcon /><p className="eyebrow">{task.status === 'interrupted' ? '本轮连接结果未知' : '本轮未完成'}</p><h2 id="novel-create-title">已有结果和开书思路都已保留</h2><p>{publicFailureCopy(task.errorMessage)}</p>
    </div><WorkflowActionDock title="选择恢复方式" detail="重试只会创建新一轮任务，不会覆盖旧结果。" primary={<button className="primary-action" type="button" disabled={busy} onClick={() => void startAi()}>{busy ? '正在重新提交…' : '重新交给创作团队'}</button>} secondary={<>{task.status === 'interrupted' && <button className="secondary-action" type="button" disabled={busy} onClick={() => setRecoveryAttempt((current) => current + 1)}>重新连接这次任务</button>}<button className="secondary-action" type="button" disabled={busy} onClick={startManual}>{openingPackage === null ? '自己填写开书资料' : '保留现有资料，自己完成'}</button><button className="secondary-action" type="button" disabled={busy} onClick={startFreshIdea}>重新填写想法</button></>} /></section>;
  }

  if (mode === 'idea') {
    const designMembers = department?.departments
      .find((item) => item.departmentKey === 'planning_writer')?.members
      .filter((member) => member.presence !== 'leave') ?? [];
    return (
      <section className="novel-create-surface" aria-label="填写开书想法">
        <div className="idea-card">
          <div className="idea-card-heading"><div><span className="step-number">01</span><h3>开书想法</h3></div></div>
          <label htmlFor="opening-idea">说说您想写什么</label>
          <ImeTextarea id="opening-idea" maxChars={2_000} value={idea} onChange={(next) => { setIdea(next); setError(null); }} placeholder="例如：张三穿越到三国成为一名小卒，想靠现代知识活下来，并在乱世中建立自己的班底……" rows={8} />
          <div className="idea-meta"><span>4至2000字</span><output>{ideaLength}/2000</output></div>
          {designMembers.length > 0 && <details className="opening-member-choice"><summary>选择开书设计成员（可不选）</summary><label><span>不选择时由编辑部自动安排；完成后会交给另一名强模型主编独立审查。</span><select value={selectedDesignerMemberKey} onChange={(event) => setSelectedDesignerMemberKey(event.target.value)}><option value="">编辑部自动安排</option>{designMembers.map((member) => <option key={member.memberKey} value={member.memberKey}>{member.displayName}</option>)}</select></label></details>}
          {error !== null && <div className="error-notice" role="alert">{error}</div>}
        </div>
        <WorkflowActionDock title="让编辑部开始设计" detail="想法至少4字，最多2000字。" primary={<button className="primary-action" type="button" disabled={ideaLength < 4 || busy} onClick={() => void startAi()}><UsersThreeIcon />{busy ? '正在提交…' : '开始设计'}</button>} secondary={<button className="secondary-action" type="button" onClick={onBack}>返回创作类型</button>} />
      </section>
    );
  }

  if (openingPackage !== null) {
    const designMembers = department?.departments
      .find((item) => item.departmentKey === 'planning_writer')?.members
      .filter((member) => member.presence !== 'leave') ?? [];
    const currentErrors = manualStep === 1 ? manualValidation.stepOne : manualValidation.stepTwo;
    const needsReview = mode === 'ai' && (dirty || hasDecisionUpdates || review?.verdict !== 'pass' || task?.needsAuthorDecision === true);
    const reviewNeedsImmediateAction = needsReview && (review?.verdict !== 'pass' || task?.needsAuthorDecision === true || manualStep === 2);
    const canSubmitRevision = !busy && !invalidCustomDecision && unresolvedRequiredDecisions.length === 0 && (dirty || hasDecisionUpdates);
    return (
      <section className="package-create-surface manual-create-surface" aria-label={mode === 'ai' ? '确认开书资料' : '自己设计开书资料'}>
        {mode === 'ai' && <ReviewPanel review={review} memberName={task?.selectedMembers.chiefEditor?.displayName ?? null} resolutions={decisionResolutions} onResolve={(decisionId, resolution) => setDecisionResolutions((current) => {
          if (resolution === null) {
            const next = { ...current };
            delete next[decisionId];
            return next;
          }
          return { ...current, [decisionId]: resolution };
        })} onAcceptAll={(decisions) => setDecisionResolutions((current) => ({
          ...current,
          ...Object.fromEntries(decisions.map((item) => [item.decisionId, { decisionId: item.decisionId, action: 'accept' as const }]))
        }))} />}
        <ManualOpeningForm value={openingPackage} taxonomy={taxonomy} onChange={setOpeningPackage} step={manualStep} onStepChange={setManualStep} />
        {mode === 'ai' && designMembers.length > 0 && <details className="opening-redesign-choice"><summary>换成员重新设计整份开书资料</summary><div><select aria-label="重新设计成员" value={selectedDesignerMemberKey} onChange={(event) => setSelectedDesignerMemberKey(event.target.value)}><option value="">请选择成员</option>{designMembers.map((member) => <option key={member.memberKey} value={member.memberKey}>{member.displayName}</option>)}</select></div><p>当前方案会移入任务记录，不会污染新方案；新方案仍由不同底模的主编审查。</p><WorkflowActionDock mode="card" ariaLabel="整份开书资料重新设计" title="已选成员后" primary={<button className="secondary-action" type="button" disabled={busy || selectedDesignerMemberKey.length === 0} onClick={() => void redesignWithMember()}>{busy ? '正在重新安排…' : '重新设计'}</button>} /></details>}
        {mode === 'ai' && manualStep === 2 && <label className="adjustment-field" htmlFor="adjustment-note"><span>给主编的开书资料调整意见（可选）</span><ImeTextarea id="adjustment-note" rows={3} maxChars={2_000} value={adjustmentNote} onChange={setAdjustmentNote} placeholder="例如：主角必须是张三；年龄改成二十岁；书名更直白吸睛。只调整本页开书资料。" /><output>{Array.from(adjustmentNote).length}/2000</output></label>}
        {currentErrors.length > 0 && <details className="validation-summary"><summary>还需完成 {currentErrors.length} 项</summary><ul>{currentErrors.map((item) => <li key={item}>{item}</li>)}</ul></details>}
        {error !== null && <div className="error-notice" role="alert">{error}</div>}
        {resetConfirmationOpen && <div className="error-notice" role="alert">当前页未提交的修改会被清空；已保存的历史版本不会删除。</div>}
        <WorkflowActionDock
          title={resetConfirmationOpen ? '确认清空当前草稿' : reviewNeedsImmediateAction ? '把选择交给主编' : manualStep === 1 ? '完成本页后继续' : '创建书籍'}
          detail={resetConfirmationOpen ? '这里只清空未提交草稿。' : currentErrors.length > 0 ? `还需完成 ${currentErrors.length} 项` : '当前资料已自动保存。'}
          primary={resetConfirmationOpen
            ? <button className="primary-action" type="button" disabled={busy} onClick={restart}>确认清空重填</button>
            : reviewNeedsImmediateAction
              ? <button className="primary-action" type="button" disabled={!canSubmitRevision} onClick={() => void submitRevision()}>{busy ? '正在提交…' : unresolvedRequiredDecisions.length > 0 ? `还需决定 ${unresolvedRequiredDecisions.length} 项` : invalidCustomDecision ? '请填写修改方案' : '请主编按选择更新资料'}</button>
              : manualStep === 1
                ? <button className="primary-action" type="button" disabled={manualValidation.stepOne.length > 0} onClick={() => setManualStep(2)}>下一步</button>
                : <button className="primary-action" type="button" disabled={!canConfirm} onClick={() => void confirm()}>{busy ? '正在创建…' : '确认开书资料，创建书籍'}</button>}
          secondary={resetConfirmationOpen
            ? <button className="secondary-action" type="button" onClick={() => setResetConfirmationOpen(false)}>继续编辑</button>
            : <>{manualStep === 2 && <button className="secondary-action" type="button" disabled={busy} onClick={() => setManualStep(1)}>上一步</button>}<button className="secondary-action" type="button" disabled={busy} onClick={onBack}>暂存并离开</button><button className="secondary-action" type="button" disabled={busy} onClick={() => setResetConfirmationOpen(true)}>清空重填</button></>}
          ariaLabel="开书确认"
        />
      </section>
    );
  }

  return <section className="novel-create-surface" aria-label="开书任务恢复"><div className="failure-card compact-failure-card" role="alert">
    <WarningCircleIcon /><p className="eyebrow">本轮没有返回资料</p><h2>对不起，这次开书设计没有完成</h2><p>已保留您的开书想法，可以重新连接核对这轮任务，也可以直接重新开始。</p>
  </div><WorkflowActionDock
    title="选择恢复方式"
    detail="重新连接只会查询原任务，不会重复下单。"
    primary={<button className="primary-action" type="button" onClick={() => { setTask(null); setRecoveryAttempt((current) => current + 1); }}>重新连接</button>}
    secondary={<><button className="secondary-action" type="button" onClick={startFreshIdea}>重新填写想法</button><button className="secondary-action" type="button" onClick={onBack}>返回首页</button></>}
  /></section>;
}
