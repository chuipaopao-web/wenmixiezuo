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
  fetchOpeningTasks,
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

const DRAFT_KEY_PREFIX = 'wenmi-v7-opening-draft-v2';
const DECISION_KEY_PREFIX = 'wenmi-v7-opening-decisions-v2';

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
}

function openingDraftKey(userId: string, entryMode: 'ai' | 'manual'): string {
  return `${DRAFT_KEY_PREFIX}:${encodeURIComponent(userId)}:${entryMode}`;
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
    manualStep: 1
  };
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
    const restored: OpeningDraftSnapshot = {
      idea,
      taskId: null,
      mode: 'idea' as const,
      publishingPlatform,
      openingPackage,
      baseCandidateId,
      adjustmentNote,
      selectedDesignerMemberKey,
      manualStep
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
  return error instanceof AuthorApiError && error.status === 401
    ? '对不起，登录状态已经失效，请重新登录后继续。'
    : '对不起，这次操作没有完成，请稍后重试。';
}

function WorkStatus({ task }: { task: OpeningTaskView }): React.JSX.Element {
  const direct = task.workflowStyle === 'direct_design_review';
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
        {(direct ? ['直接设计', '审查点评'] : ['主编理解', '编剧设计', '主编审查']).map((label, index) => <div className={index + 1 < task.progress.currentStep ? 'done' : index + 1 === task.progress.currentStep ? 'active' : ''} key={label}><span>{index + 1 < task.progress.currentStep ? '✓' : index + 1}</span><strong>{label}</strong></div>)}
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
  const legacyItems = review.authorDecisions.length > 0 ? review.authorDecisions : review.requiredChanges;
  return legacyItems.map((item, index) => ({
    decisionId: `legacy-${index + 1}`, field: '', question: authorFacingReviewText(item),
    currentValue: '保持当前资料', recommendation: authorFacingReviewText(item),
    reason: '这是旧版主编意见，采纳后主编会只在开书资料内重新整理。',
    impact: '只影响本页开书资料，不进入设定、蓝图或正文。', required: true
  }));
}

function ReviewPanel({ review, memberName, resolutions, onResolve, onAcceptAll, onSubmit, submitDisabled, submitLabel }: {
  review: OpeningReview | null;
  memberName: string | null;
  resolutions: Record<string, OpeningDecisionResolution>;
  onResolve: (decisionId: string, resolution: OpeningDecisionResolution | null) => void;
  onAcceptAll: (decisions: ReviewDecisionView[]) => void;
  onSubmit: () => void;
  submitDisabled: boolean;
  submitLabel: string;
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
        })}</div><footer className="review-decision-submit"><span role="status">已处理 {resolvedCount}/{decisions.length} 项</span><button className="primary-action" type="button" disabled={submitDisabled} onClick={onSubmit}>{submitLabel}</button></footer></section>}
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

export function NewNovelPage({ entryMode, onBack, onCreated, onAuthenticationRequired }: {
  entryMode: 'ai' | 'manual';
  onBack: () => void;
  onCreated: (bookId: string) => void;
  onAuthenticationRequired: () => void;
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
  const [historyChecked, setHistoryChecked] = useState(entryMode === 'manual' || initial.taskId !== null);
  const loadedCandidateRef = useRef<string | null>(initial.baseCandidateId);
  const openingSubmitRef = useRef(false);

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
        manualStep
      } satisfies OpeningDraftSnapshot));
    } catch {
      // 浏览器拒绝本地存储时仍保留当前内存输入；提交失败会继续显示原位恢复提示。
    }
  }, [adjustmentNote, baseCandidateId, draftStorageKey, idea, manualStep, mode, openingPackage, publishingPlatform, selectedDesignerMemberKey, taskId]);

  useEffect(() => {
    if (entryMode !== 'ai' || taskId !== null || historyChecked) return;
    const controller = new AbortController();
    void fetchOpeningTasks(controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      const recoverable = items.find((item) => item.resultBookId === null && (
        item.isRunning
        || item.status === 'awaiting_author_confirmation'
        || item.status === 'awaiting_author_decision'
      ));
      if (recoverable !== undefined) {
        setIdea(recoverable.idea);
        setTask(recoverable);
        setPublishingPlatform(recoverable.publishingPlatform);
        setTaskId(recoverable.taskId);
        setMode('ai');
      }
      setHistoryChecked(true);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setHistoryChecked(true);
        handleRequestFailure(reason);
      }
    });
    return () => controller.abort();
  }, [entryMode, handleRequestFailure, historyChecked, taskId]);

  useEffect(() => {
    if (taskId === null || mode !== 'ai') return;
    let stopped = false;
    let timer = 0;
    const refresh = async () => {
      try {
        const value = await fetchOpeningTask(taskId);
        if (stopped) return;
        setTask(value);
        setPublishingPlatform(value.publishingPlatform);
        setError(null);
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
          setHistoryChecked(false);
          return;
        }
        if (!handleRequestFailure(reason)) timer = window.setTimeout(refresh, 3_000);
      }
    };
    void refresh();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [handleRequestFailure, mode, taskId]);

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
    try {
      const next = await createOpeningTask(
        idea.trim(),
        'fanqie',
        newActionKey('opening'),
        selectedDesignerMemberKey || undefined
      );
      loadedCandidateRef.current = null;
      setTask(next);
      setIdea(next.idea || idea.trim());
      setTaskId(next.taskId);
      setMode('ai');
      setPublishingPlatform(next.publishingPlatform);
      setHistoryChecked(true);
      setOpeningPackage(null);
      setBaseCandidateId(null);
    } catch (reason) {
      handleRequestFailure(reason);
    } finally {
      openingSubmitRef.current = false;
      setBusy(false);
    }
  };

  const redesignWithMember = async () => {
    if (taskId === null || busy || selectedDesignerMemberKey.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await abandonOpeningTask(taskId);
      const next = await createOpeningTask(
        idea.trim(),
        'fanqie',
        newActionKey('opening-redesign'),
        selectedDesignerMemberKey
      );
      loadedCandidateRef.current = null;
      setTask(next);
      setTaskId(next.taskId);
      setMode('ai');
      setOpeningPackage(null);
      setBaseCandidateId(null);
      setDecisionResolutions({});
    } catch (reason) {
      handleRequestFailure(reason);
    } finally {
      setBusy(false);
    }
  };

  const startManual = () => {
    if (ideaLength < 4 || ideaLength > 2_000) return;
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
    if (!canConfirm || openingPackage === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await confirmOpeningBook({
        ...(mode === 'ai' && taskId !== null && baseCandidateId !== null
          ? { taskId, candidateId: baseCandidateId }
          : {}),
        openingPackage,
        idempotencyKey: newActionKey('confirm')
      });
      localStorage.removeItem(draftStorageKey);
      onCreated(result.bookId);
    } catch (reason) {
      handleRequestFailure(reason);
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    if (!window.confirm('重新开始会清空当前页面草稿；已经保存的历史版本不会被删除。确定继续吗？')) return;
    localStorage.removeItem(draftStorageKey);
    loadedCandidateRef.current = null;
    setIdea('');
    setMode(entryMode === 'manual' ? 'manual' : 'idea');
    setTaskId(null);
    setTask(null);
    setOpeningPackage(entryMode === 'manual' ? emptyOpeningPackage() : null);
    setManualStep(1);
    setBaseCandidateId(null);
    setAdjustmentNote('');
    setSelectedDesignerMemberKey('');
    setDecisionResolutions({});
    setError(null);
    setHistoryChecked(true);
  };

  if (!historyChecked || (mode === 'ai' && task === null)) {
    return <section className="novel-create-surface" aria-label="恢复开书任务"><div className="inline-task-recovery" role="status">编辑部正在找回您之前的工作记录…</div></section>;
  }

  if (mode === 'ai' && task !== null && task.isRunning) {
    return <section className="novel-create-surface" aria-label="开书设计进度"><WorkStatus task={task} /></section>;
  }

  if (mode === 'ai' && task?.status === 'archived') {
    return <section className="novel-create-surface" aria-label="已放弃的开书任务"><div className="failure-card compact-failure-card">
      <p className="eyebrow">这项任务已放弃</p><h2>历史资料已经安全保留</h2><p>它不会再阻塞新建书籍。您可以返回首页重新开始。</p>
      <button className="primary-action" type="button" onClick={onBack}>返回首页</button>
    </div></section>;
  }

  if (mode === 'ai' && task !== null && (task.status === 'failed' || task.status === 'interrupted')) {
    return <section className="novel-create-surface" aria-label="开书任务恢复"><div className="failure-card compact-failure-card">
      <WarningCircleIcon /><p className="eyebrow">{task.status === 'interrupted' ? '本轮连接结果未知' : '本轮未完成'}</p><h2 id="novel-create-title">已有结果和开书思路都已保留</h2><p>{publicFailureCopy(task.errorMessage)}</p>
      <div className="design-actions"><button className="primary-action" type="button" disabled={busy} onClick={() => void startAi()}>{busy ? '正在重新提交…' : '重新交给创作团队'}</button>{openingPackage !== null && <button className="secondary-action" type="button" disabled={busy} onClick={startManual}>保留现有资料，自己完成</button>}</div>
      <button className="restart-button" type="button" disabled={busy} onClick={restart}>重新填写想法</button>
    </div></section>;
  }

  if (mode === 'idea') {
    const designMembers = department?.departments
      .find((item) => item.departmentKey === 'planning_writer')?.members
      .filter((member) => member.presence !== 'leave') ?? [];
    return (
      <section className="novel-create-surface" aria-label="填写开书想法">
        <div className="page-utility-row"><button className="back-button" type="button" onClick={onBack}>返回创作类型</button></div>
        <div className="idea-card">
          <div className="idea-card-heading"><div><span className="step-number">01</span><h3>开书想法</h3></div></div>
          <label htmlFor="opening-idea">说说您想写什么</label>
          <ImeTextarea id="opening-idea" maxChars={2_000} value={idea} onChange={(next) => { setIdea(next); setError(null); }} placeholder="例如：张三穿越到三国成为一名小卒，想靠现代知识活下来，并在乱世中建立自己的班底……" rows={8} />
          <div className="idea-meta"><span>4至2000字</span><output>{ideaLength}/2000</output></div>
          {designMembers.length > 0 && <details className="opening-member-choice"><summary>选择开书设计成员（可不选）</summary><label><span>不选择时由编辑部自动安排；完成后会交给另一名强模型主编独立审查。</span><select value={selectedDesignerMemberKey} onChange={(event) => setSelectedDesignerMemberKey(event.target.value)}><option value="">编辑部自动安排</option>{designMembers.map((member) => <option key={member.memberKey} value={member.memberKey}>{member.displayName}</option>)}</select></label></details>}
          <div className="design-actions single-action"><button className="primary-action" type="button" disabled={ideaLength < 4 || busy} onClick={() => void startAi()}><UsersThreeIcon />{busy ? '正在提交…' : '开始设计'}</button></div>
          {error !== null && <div className="error-notice" role="alert">{error}</div>}
        </div>
      </section>
    );
  }

  if (openingPackage !== null) {
    const designMembers = department?.departments
      .find((item) => item.departmentKey === 'planning_writer')?.members
      .filter((member) => member.presence !== 'leave') ?? [];
    const currentErrors = manualStep === 1 ? manualValidation.stepOne : manualValidation.stepTwo;
    const needsReview = mode === 'ai' && (dirty || hasDecisionUpdates || review?.verdict !== 'pass' || task?.needsAuthorDecision === true);
    const canSubmitRevision = !busy && !invalidCustomDecision && unresolvedRequiredDecisions.length === 0 && (dirty || hasDecisionUpdates);
    return (
      <section className="package-create-surface manual-create-surface" aria-label={mode === 'ai' ? '确认开书资料' : '自己设计开书资料'}>
        <div className="page-utility-row"><button className="back-button" type="button" onClick={onBack}>返回首页</button><button className="restart-button" type="button" onClick={restart}>清空重填</button></div>
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
        }))} onSubmit={() => void submitRevision()} submitDisabled={!canSubmitRevision} submitLabel={busy ? '主编正在更新…' : unresolvedRequiredDecisions.length > 0 ? `还需决定 ${unresolvedRequiredDecisions.length} 项` : invalidCustomDecision ? '请填写修改方案' : '请主编按选择更新资料'} />}
        <ManualOpeningForm value={openingPackage} taxonomy={taxonomy} onChange={setOpeningPackage} step={manualStep} onStepChange={setManualStep} />
        {mode === 'ai' && designMembers.length > 0 && <details className="opening-redesign-choice"><summary>换成员重新设计整份开书资料</summary><div><select aria-label="重新设计成员" value={selectedDesignerMemberKey} onChange={(event) => setSelectedDesignerMemberKey(event.target.value)}><option value="">请选择成员</option>{designMembers.map((member) => <option key={member.memberKey} value={member.memberKey}>{member.displayName}</option>)}</select><button className="secondary-action" type="button" disabled={busy || selectedDesignerMemberKey.length === 0} onClick={() => void redesignWithMember()}>{busy ? '正在重新安排…' : '重新设计'}</button></div><p>当前方案会移入任务记录，不会污染新方案；新方案仍由不同底模的主编审查。</p></details>}
        <section className="confirmation-dock manual-confirmation-dock" aria-label="开书确认">
          <div>
            {mode === 'ai' && manualStep === 2 && <label className="adjustment-field" htmlFor="adjustment-note"><span>给主编的开书资料调整意见（可选）</span><ImeTextarea id="adjustment-note" rows={3} maxChars={2_000} value={adjustmentNote} onChange={setAdjustmentNote} placeholder="例如：主角必须是张三；年龄改成二十岁；书名更直白吸睛。只调整本页开书资料。" /><output>{Array.from(adjustmentNote).length}/2000</output></label>}
            {currentErrors.length > 0 && <details className="validation-summary"><summary>还需完成 {currentErrors.length} 项</summary><ul>{currentErrors.map((item) => <li key={item}>{item}</li>)}</ul></details>}
            {error !== null && <div className="error-notice" role="alert">{error}</div>}
          </div>
          <div className="dock-actions">
            {manualStep === 2 && <button className="secondary-action" type="button" disabled={busy} onClick={() => setManualStep(1)}>上一步</button>}
            {manualStep === 1
              ? <button className="primary-action" type="button" disabled={manualValidation.stepOne.length > 0} onClick={() => setManualStep(2)}>下一步</button>
              : needsReview
                ? <button className="primary-action" type="button" disabled={!canSubmitRevision} onClick={() => void submitRevision()}>{busy ? '正在提交…' : unresolvedRequiredDecisions.length > 0 ? `还需决定 ${unresolvedRequiredDecisions.length} 项` : invalidCustomDecision ? '请填写您的方案' : '请主编按选择更新资料'}</button>
                : <button className="primary-action" type="button" disabled={!canConfirm} onClick={() => void confirm()}>{busy ? '正在创建…' : '确认开书资料，创建书籍'}</button>}
            <button className="secondary-action" type="button" disabled={busy} onClick={onBack}>暂存并离开</button>
          </div>
        </section>
      </section>
    );
  }

  return <section className="novel-create-surface" aria-label="开书资料加载"><div className="inline-task-recovery" role="status">正在准备开书资料…</div></section>;
}
