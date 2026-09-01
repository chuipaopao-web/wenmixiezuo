import { ArrowRightIcon, BookOpenTextIcon, ClockCounterClockwiseIcon, SlidersHorizontalIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { cancelCreationWorkflow, fetchCreationTasks, type CreationWorkflowView } from './creation-api';
import { memberAvatarPosition, memberDisplayName } from './member-avatars';
import { publicFailureCopy, publicRoleLabel, publicStatusCopy, uniqueByMemberKey } from './author-projection';
import {
  abandonAllOpeningTasks,
  abandonOpeningTask,
  cancelPlanningRouteRun,
  cancelPlanningTreeGeneration,
  fetchDesignTasks,
  fetchOpeningTasks,
  fetchPlanningTasks,
  fetchSettingTasks,
  type DesignTaskView,
  type OpeningTaskView,
  type PlanningTaskView,
  type SettingTaskView
} from './opening-api';
import { useAuthorAccount } from './AuthorAccountBoundary';
import { clearOpeningDraftForTask } from './opening-draft-storage';

export function TaskLogPage({ onOpenTask, onOpenBook, onOpenCreation, onOpenPlanning, onOpenSetting }: {
  onOpenTask: (taskId: string) => void;
  onOpenBook: (bookId: string) => void;
  onOpenCreation?: (bookId: string, focus: 'volume' | 'chain' | 'chapter') => void;
  onOpenPlanning?: (bookId: string) => void;
  onOpenSetting?: (bookId: string, focus: 'final-review' | null) => void;
}): React.JSX.Element {
  const { account } = useAuthorAccount();
  const [tasks, setTasks] = useState<OpeningTaskView[]>([]);
  const [designTasks, setDesignTasks] = useState<DesignTaskView[]>([]);
  const [creationTasks, setCreationTasks] = useState<CreationWorkflowView[]>([]);
  const [planningTasks, setPlanningTasks] = useState<PlanningTaskView[]>([]);
  const [settingTasks, setSettingTasks] = useState<SettingTaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abandoningTaskId, setAbandoningTaskId] = useState<string | null>(null);
  const [clearingIncompleteTasks, setClearingIncompleteTasks] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const hasAnyRecord = tasks.length > 0 || designTasks.length > 0 || creationTasks.length > 0 || planningTasks.length > 0 || settingTasks.length > 0;
  const hasRunning = useMemo(
    () => tasks.some((task) => task.isRunning) || designTasks.some((task) => task.status === 'working')
      || creationTasks.some((task) => ['waiting', 'working'].includes(task.status))
      || planningTasks.some((task) => ['waiting', 'working'].includes(task.status))
      || settingTasks.some((task) => ['waiting', 'working'].includes(task.status)),
    [creationTasks, designTasks, planningTasks, settingTasks, tasks]
  );
  const hasArchivable = useMemo(
    () => tasks.some(openingTaskCanArchive),
    [tasks]
  );

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const load = async () => {
      try {
        const results = await Promise.allSettled([
          fetchOpeningTasks(), fetchDesignTasks(), fetchCreationTasks(), fetchPlanningTasks(), fetchSettingTasks()
        ]);
        if (stopped) return;
        const [openingResult, designResult, creationResult, planningResult, settingResult] = results;
        const visible = openingResult.status === 'fulfilled'
          ? openingResult.value.filter((task) => !(
            task.resultBookId === null && task.status === 'failed' && task.errorMessage === null
          ))
          : null;
        if (visible !== null) setTasks(visible);
        if (designResult.status === 'fulfilled') setDesignTasks(designResult.value);
        if (creationResult.status === 'fulfilled') setCreationTasks(creationResult.value);
        if (planningResult.status === 'fulfilled') setPlanningTasks(planningResult.value);
        if (settingResult.status === 'fulfilled') setSettingTasks(settingResult.value);
        const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
        setError(failed.length === 0 ? null : '部分工作记录暂时没有加载出来，编辑部会自动重试。');
        setLoading(false);
        const hasVisibleRunning = visible?.some((task) => task.isRunning) ?? false;
        const hasDesignRunning = designResult.status === 'fulfilled' && designResult.value.some((task) => task.status === 'working');
        const hasCreationRunning = creationResult.status === 'fulfilled' && creationResult.value.some((task) => ['waiting', 'working'].includes(task.status));
        const hasPlanningRunning = planningResult.status === 'fulfilled' && planningResult.value.some((task) => ['waiting', 'working'].includes(task.status));
        const hasSettingRunning = settingResult.status === 'fulfilled' && settingResult.value.some((task) => ['waiting', 'working'].includes(task.status));
        if (failed.length > 0 || hasVisibleRunning || hasDesignRunning || hasCreationRunning || hasPlanningRunning || hasSettingRunning) {
          timer = window.setTimeout(load, failed.length > 0 ? 4_000 : 2_000);
        }
      } catch (reason) {
        if (stopped) return;
        setError(reason instanceof Error ? reason.message : '任务记录暂时没有加载出来。');
        setLoading(false);
        timer = window.setTimeout(load, 4_000);
      }
    };
    void load();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, []);

  const active = tasks.filter(openingTaskNeedsAttention);
  const history = tasks.filter((task) => !active.includes(task));
  const activeDesignTasks = designTasks.filter((task) => task.status === 'working');
  const designHistory = designTasks.filter((task) => task.status !== 'working');
  const activeCreationTasks = creationTasks.filter((task) => ['waiting', 'working', 'waiting_for_you', 'failed', 'partially_failed'].includes(task.status));
  const creationHistory = creationTasks.filter((task) => !activeCreationTasks.includes(task));
  const activePlanningTasks = planningTasks.filter((task) => ['waiting', 'working', 'waiting_for_you', 'failed'].includes(task.status));
  const planningHistory = planningTasks.filter((task) => !activePlanningTasks.includes(task));
  const activeSettingTasks = settingTasks.filter((task) => task.status !== 'completed');
  const settingHistory = settingTasks.filter((task) => task.status === 'completed');
  const activeCount = active.length + activeDesignTasks.length + activeCreationTasks.length + activePlanningTasks.length + activeSettingTasks.length;
  const abandon = async (task: OpeningTaskView) => {
    setAbandoningTaskId(task.taskId);
    setError(null);
    try {
      await abandonOpeningTask(task.taskId);
      clearOpeningDraftForTask(account.userId, task.taskId);
      setTasks((current) => current.filter((item) => item.taskId !== task.taskId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '这项任务暂时没有放弃成功，请刷新后重试。');
    } finally {
      setAbandoningTaskId(null);
    }
  };
  const clearIncompleteTasks = async () => {
    setClearingIncompleteTasks(true);
    setError(null);
    try {
      const abandonedTaskIds = tasks.filter(openingTaskCanArchive).map((task) => task.taskId);
      await abandonAllOpeningTasks();
      for (const taskId of abandonedTaskIds) clearOpeningDraftForTask(account.userId, taskId);
      setTasks((current) => current.filter((task) => !openingTaskCanArchive(task)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '未完成任务暂时没有清理成功，请刷新后重试。');
    } finally {
      setClearingIncompleteTasks(false);
      setConfirmingClear(false);
    }
  };

  return (
    <section className="task-log-surface" aria-label="任务日志">
      <div className="task-log-summary">
        <span><ClockCounterClockwiseIcon /></span>
        <strong>{error === null ? activeCount : '—'}</strong>
        <p>{error !== null ? '部分工作记录正在重新整理' : activeCount > 0 ? '项工作正在进行或等您确认' : '编辑部当前没有待处理工作'}</p>
        {hasRunning && <i>编辑部会自动更新进度</i>}
        {hasArchivable && !confirmingClear && <button className="task-clear-button" type="button" disabled={clearingIncompleteTasks} onClick={() => setConfirmingClear(true)}>{clearingIncompleteTasks ? '正在清理…' : '清理未完成任务'}</button>}
        {hasArchivable && confirmingClear && <div className="task-inline-confirm"><span>只移走尚未建成书籍的未完成任务，书籍与历史方案都会保留。</span><button type="button" disabled={clearingIncompleteTasks} onClick={() => void clearIncompleteTasks()}>{clearingIncompleteTasks ? '正在清理…' : '确认清理'}</button><button type="button" disabled={clearingIncompleteTasks} onClick={() => setConfirmingClear(false)}>先不清理</button></div>}
      </div>
      {error !== null && <div className="error-notice" role="status">{error}</div>}
      {loading ? <div className="inline-task-recovery" role="status">正在整理编辑部工作记录…</div> : error === null && !hasAnyRecord ? (
        <div className="task-log-empty"><BookOpenTextIcon /><strong>还没有工作记录</strong><span>提交开书想法后，任务会一直保存在这里。</span></div>
      ) : hasAnyRecord ? <div className="task-log-sections">
        {active.length > 0 && <TaskSection title="进行中与待确认" tasks={active} onOpenTask={onOpenTask} onOpenBook={onOpenBook} abandoningTaskId={abandoningTaskId} onAbandon={abandon} />}
        {activeSettingTasks.length > 0 && <SettingTaskSection title="设定工作" tasks={activeSettingTasks} onOpen={(task) => {
          if (onOpenSetting !== undefined) onOpenSetting(task.bookId, task.taskKind === 'batch_final_review' ? 'final-review' : null);
          else onOpenBook(task.bookId);
        }} />}
        {activePlanningTasks.length > 0 && <PlanningTaskSection title="全书路线与框架" tasks={activePlanningTasks} onOpen={(task) => {
          if (onOpenPlanning !== undefined) onOpenPlanning(task.bookId);
          else onOpenBook(task.bookId);
        }} onCancel={async (task) => {
          try {
            if (task.taskKind === 'planning_route') await cancelPlanningRouteRun(task.bookId, task.taskId);
            else await cancelPlanningTreeGeneration(task.bookId, task.taskId);
            setPlanningTasks((current) => current.map((item) => item.taskId === task.taskId ? { ...item, status: 'cancelled', message: '任务已停止，已经完成的内容仍然保留。', canStop: false } : item));
          } catch (reason) { setError(reason instanceof Error ? reason.message : '这项任务暂时没有停止成功。'); }
        }} />}
        {activeCreationTasks.length > 0 && <CreationTaskSection title="卷、链与正文" tasks={activeCreationTasks} onOpen={(task) => openCreationTask(task, onOpenBook, onOpenCreation)} onCancel={async (task) => {
          try {
            await cancelCreationWorkflow(task.bookId, task.workflowId);
            setCreationTasks((current) => current.map((item) => item.workflowId === task.workflowId ? { ...item, status: 'cancelled', message: '任务已停止，已经完成的内容仍然保留。' } : item));
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : '这项任务暂时没有停止成功。');
          }
        }} />}
        {activeDesignTasks.length > 0 && <DesignTaskSection title="书名与封面制作中" tasks={activeDesignTasks} onOpenBook={onOpenBook} />}
        {history.length > 0 && <TaskSection title="最近记录" tasks={history} onOpenTask={onOpenTask} onOpenBook={onOpenBook} abandoningTaskId={abandoningTaskId} onAbandon={abandon} />}
        {designHistory.length > 0 && <DesignTaskSection title="书名与封面历史" tasks={designHistory} onOpenBook={onOpenBook} />}
        {settingHistory.length > 0 && <SettingTaskSection title="设定历史" tasks={settingHistory} onOpen={(task) => {
          if (onOpenSetting !== undefined) onOpenSetting(task.bookId, task.taskKind === 'batch_final_review' ? 'final-review' : null);
          else onOpenBook(task.bookId);
        }} />}
        {creationHistory.length > 0 && <CreationTaskSection title="卷与正文历史" tasks={creationHistory} onOpen={(task) => openCreationTask(task, onOpenBook, onOpenCreation)} />}
        {planningHistory.length > 0 && <PlanningTaskSection title="全书规划历史" tasks={planningHistory} onOpen={(task) => {
          if (onOpenPlanning !== undefined) onOpenPlanning(task.bookId);
          else onOpenBook(task.bookId);
        }} />}
      </div> : null}
    </section>
  );
}

function SettingTaskSection({ title, tasks, onOpen }: {
  title: string;
  tasks: SettingTaskView[];
  onOpen: (task: SettingTaskView) => void;
}): React.JSX.Element {
  return <section className="task-log-section" aria-label={title}>
    <div className="task-log-section-heading"><strong>{title}</strong><span>{tasks.length}</span></div>
    <div className="task-log-list">{tasks.map((task) => <SettingTaskCard key={task.taskId} task={task} onOpen={() => onOpen(task)} />)}</div>
  </section>;
}

function SettingTaskCard({ task, onOpen }: { task: SettingTaskView; onOpen: () => void }): React.JSX.Element {
  const active = task.status === 'waiting' || task.status === 'working';
  const failed = task.status === 'failed';
  const state = task.status === 'waiting_for_you' ? '等您决定'
    : task.status === 'completed' ? '已完成'
      : failed ? '本轮未完成'
        : task.status === 'working' ? '工作中' : '马上开始';
  const memberName = task.member === null ? null : memberDisplayName(task.member.memberKey, task.member.displayName);
  const copy = failed
    ? publicFailureCopy(task.statusText)
    : publicStatusCopy(task.statusText, task.status === 'completed' ? '本轮设定工作已经完成。' : '当前设定进度已经保存。');
  return <article className={`task-log-card state-${task.status}`}>
    <div className="task-log-card-main"><span className={`task-state-dot ${active ? 'working' : ''}`} /><div><small>{settingTaskName(task.taskKind)} · {formatTime(task.updatedAt)}</small><strong>{task.bookTitle}</strong><p>{memberName === null ? copy : `${failed ? '🙇' : active ? '✍️' : '🌿'} ${memberName}：${copy}`}</p></div></div>
    <div className="task-log-card-side">{task.member !== null && <div className="task-member-stack"><i title={memberName ?? '编辑部成员'} style={{ backgroundPosition: memberAvatarPosition(task.member.memberKey) }} /></div>}<span className="task-state-label">{state}</span><button type="button" onClick={onOpen}>{task.status === 'completed' ? '查看设定' : '继续处理'}<ArrowRightIcon /></button></div>
    {failed && <div className="task-card-members"><SlidersHorizontalIcon />已经完成的设定都已保留，打开后可按当前状态继续。</div>}
    {active && <div className="task-card-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress}><span style={{ width: `${task.progress}%` }} /></div>}
  </article>;
}

function settingTaskName(kind: SettingTaskView['taskKind']): string {
  return ({
    catalog_recommendation: '设定清单',
    setting_batch: '设定设计',
    item_review: '设定修改复审',
    item_fusion: '设定方案融合',
    batch_final_review: '设定统一整理',
    item_redesign: '设定重新设计'
  } as const)[kind];
}

function PlanningTaskSection({ title, tasks, onOpen, onCancel }: {
  title: string; tasks: PlanningTaskView[]; onOpen: (task: PlanningTaskView) => void;
  onCancel?: (task: PlanningTaskView) => Promise<void>;
}): React.JSX.Element {
  return <section className="task-log-section" aria-label={title}>
    <div className="task-log-section-heading"><strong>{title}</strong><span>{tasks.length}</span></div>
    <div className="task-log-list">{tasks.map((task) => <PlanningTaskCard key={`${task.taskKind}-${task.taskId}`} task={task} onOpen={() => onOpen(task)} {...(onCancel === undefined ? {} : { onCancel: () => onCancel(task) })} />)}</div>
  </section>;
}

function PlanningTaskCard({ task, onOpen, onCancel }: {
  task: PlanningTaskView; onOpen: () => void; onCancel?: () => Promise<void>;
}): React.JSX.Element {
  const [confirmingStop, setConfirmingStop] = useState(false);
  const state = task.status === 'waiting_for_you' ? '等您决定' : task.status === 'completed' ? '已完成'
    : task.status === 'cancelled' ? '已停止' : task.status === 'failed' ? '本轮未完成'
      : task.status === 'working' ? '工作中' : '马上开始';
  const kind = task.taskKind === 'planning_route' ? '全书路线'
    : task.treeKind === 'volume' ? '本卷框架' : task.treeKind === 'chain' ? '单元链框架' : '全书框架';
  const memberEmoji = task.status === 'failed' ? '🙇' : task.status === 'cancelled' ? '👌' : task.status === 'waiting_for_you' ? '🌿' : '✍️';
  const displayName = task.memberKey === null || task.memberName === null ? null : memberDisplayName(task.memberKey, task.memberName);
  const taskCopy = task.status === 'failed'
    ? publicFailureCopy(task.message)
    : publicStatusCopy(task.message, ['waiting', 'working'].includes(task.status) ? '编辑部正在处理这项工作。' : '当前进度已经保存。');
  return <article className={`task-log-card state-${task.status}`}>
    <div className="task-log-card-main"><span className={`task-state-dot ${['waiting', 'working'].includes(task.status) ? 'working' : ''}`} /><div><small>{kind} · {formatTime(task.updatedAt)}</small><strong>{task.bookTitle}</strong><p>{displayName === null ? taskCopy : `${memberEmoji} ${displayName}：${taskCopy}`}</p></div></div>
    <div className="task-log-card-side">{task.memberKey !== null && <div className="task-member-stack"><i title={displayName ?? '编辑部成员'} style={{ backgroundPosition: memberAvatarPosition(task.memberKey) }} /></div>}<span className="task-state-label">{state}</span><button type="button" onClick={onOpen}>继续处理<ArrowRightIcon /></button>{task.canStop && onCancel !== undefined && !confirmingStop && <button className="task-abandon-button" type="button" onClick={() => setConfirmingStop(true)}>停止任务</button>}</div>
    {task.canStop && onCancel !== undefined && confirmingStop && <div className="task-inline-confirm"><span>已经完成的路线会保留，只停止未完成工作。</span><button type="button" onClick={() => void onCancel().finally(() => setConfirmingStop(false))}>保留成果并停止</button><button type="button" onClick={() => setConfirmingStop(false)}>继续工作</button></div>}
    {['waiting', 'working'].includes(task.status) && <div className="task-card-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress}><span style={{ width: `${task.progress}%` }} /></div>}
  </article>;
}

function CreationTaskSection({ title, tasks, onOpen, onCancel }: {
  title: string;
  tasks: CreationWorkflowView[];
  onOpen: (task: CreationWorkflowView) => void;
  onCancel?: (task: CreationWorkflowView) => Promise<void>;
}): React.JSX.Element {
  return <section className="task-log-section" aria-label={title}>
    <div className="task-log-section-heading"><strong>{title}</strong><span>{tasks.length}</span></div>
    <div className="task-log-list">{tasks.map((task) => <CreationTaskCard key={task.workflowId} task={task} onOpen={() => onOpen(task)} {...(onCancel === undefined ? {} : { onCancel: () => onCancel(task) })} />)}</div>
  </section>;
}

function CreationTaskCard({ task, onOpen, onCancel }: {
  task: CreationWorkflowView;
  onOpen: () => void;
  onCancel?: () => Promise<void>;
}): React.JSX.Element {
  const [confirmingStop, setConfirmingStop] = useState(false);
  const actors = uniqueByMemberKey(task.actors);
  const taskActive = ['waiting', 'working'].includes(task.status);
  const taskFailed = task.status === 'failed' || task.status === 'partially_failed';
  const active = taskActive ? actors.find((actor) => actor.status === 'working') ?? actors.find((actor) => actor.status === 'waiting') : undefined;
  const canStop = onCancel !== undefined && ['waiting', 'working', 'failed'].includes(task.status);
  const progress = task.progress.totalChapters > 0
    ? task.progress.percent
    : task.expectedOptions > 0 ? Math.round((task.completedOptions / task.expectedOptions) * 100) : 0;
  const timing = creationTimingCopy(task);
  const effectiveActorStatus = (actor: CreationWorkflowView['actors'][number]): CreationWorkflowView['actors'][number]['status'] =>
    !taskActive && ['working', 'waiting'].includes(actor.status) ? 'completed' : actor.status;
  const actorCopy = (actor: CreationWorkflowView['actors'][number]): string => effectiveActorStatus(actor) === 'failed'
    ? publicFailureCopy(actor.message)
    : publicStatusCopy(taskActive ? actor.message : null, effectiveActorStatus(actor) === 'working' ? '正在处理本轮工作。'
      : effectiveActorStatus(actor) === 'waiting' ? '已经接单，正在排队。'
        : effectiveActorStatus(actor) === 'handed_over' ? '当前工作已交给下一位成员。' : '本轮工作已经完成。');
  return <article className={`task-log-card state-${task.status}`}>
    <div className="task-log-card-main"><span className={`task-state-dot ${taskActive ? 'working' : ''}`} /><div><small>{creationStageName(task.stage)}{timing === null ? '' : ` · ${timing}`}</small><strong>{taskFailed ? publicFailureCopy(task.message) : publicStatusCopy(task.message, '编辑部已经保存了当前进度。')}</strong><p>{active === undefined ? taskFailed ? '已经完成的方案、正文和结算都会保留，打开任务可继续处理。' : task.status === 'completed' ? '本轮工作已经完成。' : '编辑部已经保存了当前进度。' : `${active.emoji} ${memberDisplayName(active.memberKey, active.memberName)}：${actorCopy(active)}`}</p></div></div>
    <div className="task-log-card-side"><div className="task-member-stack">{actors.slice(0, 4).map((actor) => <i key={actor.memberKey} title={memberDisplayName(actor.memberKey, actor.memberName)} style={{ backgroundPosition: memberAvatarPosition(actor.memberKey) }} />)}</div><span className="task-state-label">{creationStateName(task.status)}</span><button type="button" onClick={onOpen}>继续处理<ArrowRightIcon /></button>{canStop && !confirmingStop && <button className="task-abandon-button" type="button" onClick={() => setConfirmingStop(true)}>停止任务</button>}</div>
    {canStop && confirmingStop && <div className="task-inline-confirm"><span>已经完成的方案、正文和结算都会保留。</span><button type="button" onClick={() => void onCancel().finally(() => setConfirmingStop(false))}>保留成果并停止</button><button type="button" onClick={() => setConfirmingStop(false)}>继续工作</button></div>}
    {actors.length > 0 && <details className="task-card-details"><summary>查看任务详情</summary><div>{actors.map((actor) => <p key={actor.memberKey}><b>{memberDisplayName(actor.memberKey, actor.memberName)} · {publicRoleLabel(actor.role)}</b><span>{actorCopy(actor)}</span></p>)}</div></details>}
    {taskActive && (task.progress.totalChapters > 0 || task.expectedOptions > 0) && <div className="task-card-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>}
  </article>;
}

function creationTimingCopy(task: CreationWorkflowView): string | null {
  if (task.timing === undefined) return null;
  if (!['waiting', 'working'].includes(task.status)) return `更新于${taskDuration(task.timing.idleSeconds)}前`;
  if (task.timing.state === 'overdue') return `已等待${taskDuration(task.timing.elapsedSeconds)}，可能超时`;
  if (task.timing.state === 'slow') return `已用时${taskDuration(task.timing.elapsedSeconds)}，仍在处理`;
  return `已用时${taskDuration(task.timing.elapsedSeconds)}`;
}

function taskDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, seconds)}秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟`;
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分钟`;
}

function DesignTaskSection({ title, tasks, onOpenBook }: {
  title: string;
  tasks: DesignTaskView[];
  onOpenBook: (bookId: string) => void;
}): React.JSX.Element {
  return <section className="task-log-section" aria-label={title}>
    <div className="task-log-section-heading"><strong>{title}</strong><span>{tasks.length}</span></div>
    <div className="task-log-list">{tasks.map((task) => <DesignTaskCard key={`${task.taskKind}-${task.designId}`} task={task} onOpen={() => onOpenBook(task.bookId)} />)}</div>
  </section>;
}

function DesignTaskCard({ task, onOpen }: { task: DesignTaskView; onOpen: () => void }): React.JSX.Element {
  const kind = task.taskKind === 'cover_design' ? '封面制作' : '书名设计';
  const state = task.status === 'working' ? '工作中' : task.status === 'succeeded' ? '已完成' : '本轮未完成';
  return <article className={`task-log-card state-${task.status}`}>
    <div className="task-log-card-main">
      <span className={`task-state-dot ${task.status === 'working' ? 'working' : ''}`} aria-hidden="true" />
      <div><small>{kind} · {formatTime(task.updatedAt)}</small><strong>{task.bookTitle}</strong><p>{publicStatusCopy(task.statusText, task.status === 'working' ? '编辑部正在处理这项工作。' : task.status === 'failed' ? '对不起，这次没有完成。已经完成的内容会保留。' : '本轮工作已经完成。')}</p></div>
    </div>
    <div className="task-log-card-side">
      <span className="task-state-label">{state}</span>
      <button type="button" onClick={onOpen}>打开书籍<ArrowRightIcon /></button>
    </div>
    <div className="task-card-members"><UsersThreeIcon />{[...new Set(task.memberNames.map((name) => name.trim()).filter(Boolean))].join(' · ')}</div>
  </article>;
}

function TaskSection({ title, tasks, onOpenTask, onOpenBook, abandoningTaskId, onAbandon }: {
  title: string;
  tasks: OpeningTaskView[];
  onOpenTask: (taskId: string) => void;
  onOpenBook: (bookId: string) => void;
  abandoningTaskId: string | null;
  onAbandon: (task: OpeningTaskView) => Promise<void>;
}): React.JSX.Element {
  return <section className="task-log-section" aria-label={title}>
    <div className="task-log-section-heading"><strong>{title}</strong><span>{tasks.length}</span></div>
    <div className="task-log-list">{tasks.map((task) => <TaskCard key={task.taskId} task={task} abandoning={abandoningTaskId === task.taskId} onAbandon={() => onAbandon(task)} onOpen={() => {
      if (task.resultBookId !== null) onOpenBook(task.resultBookId);
      else onOpenTask(task.taskId);
    }} />)}</div>
  </section>;
}

function TaskCard({ task, onOpen, onAbandon, abandoning }: { task: OpeningTaskView; onOpen: () => void; onAbandon: () => Promise<void>; abandoning: boolean }): React.JSX.Element {
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);
  const members = [task.selectedMembers.chiefEditor, task.selectedMembers.screenwriter]
    .filter((member): member is NonNullable<typeof member> => member !== null);
  const visibleMembers = uniqueByMemberKey(members);
  const state = task.resultBookId !== null ? '已建书'
    : task.status === 'awaiting_author_confirmation' ? '等您确认'
      : task.status === 'awaiting_author_decision' ? '等您决定'
        : task.status === 'failed' ? '本轮未完成'
          : task.status === 'interrupted' ? '结果待核对'
            : '工作中';
  const detail = task.resultBookId !== null
    ? '这项工作已经正式建书。'
    : task.status === 'failed' || task.status === 'interrupted'
      ? publicFailureCopy(task.errorMessage ?? task.statusText)
      : task.phaseText;
  return <article className={`task-log-card state-${task.status}`}>
    <div className="task-log-card-main">
      <span className={`task-state-dot ${task.isRunning ? 'working' : ''}`} aria-hidden="true" />
      <div><small>开书设计 · {formatTime(task.updatedAt)}</small><strong>{openingIdeaSummary(task.idea)}</strong><p>{detail}</p></div>
    </div>
    <div className="task-log-card-side">
      <div className="task-member-stack" aria-label="参与成员">{visibleMembers.map((member) => <i key={member.memberKey} title={memberDisplayName(member.memberKey, member.displayName)} style={{ backgroundPosition: memberAvatarPosition(member.memberKey) }} />)}</div>
      <span className="task-state-label">{state}</span>
      <button type="button" onClick={onOpen}>{task.resultBookId !== null ? '打开书籍' : ['failed', 'interrupted'].includes(task.status) ? '查看详情' : '查看进度'}<ArrowRightIcon /></button>
      {task.resultBookId === null && !task.isRunning && !confirmingAbandon && <button className="task-abandon-button" type="button" disabled={abandoning} onClick={() => setConfirmingAbandon(true)}>{abandoning ? '正在放弃…' : '放弃任务'}</button>}
    </div>
    {task.resultBookId === null && !task.isRunning && confirmingAbandon && <div className="task-inline-confirm"><span>任务会移出列表，历史资料不会永久删除。</span><button type="button" disabled={abandoning} onClick={() => void onAbandon().finally(() => setConfirmingAbandon(false))}>{abandoning ? '正在放弃…' : '确认放弃'}</button><button type="button" disabled={abandoning} onClick={() => setConfirmingAbandon(false)}>继续保留</button></div>}
    {task.isRunning && <div className="task-card-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress.percent}><span style={{ width: `${task.progress.percent}%` }} /></div>}
    {!task.isRunning && task.resultBookId === null && <div className="task-card-members"><UsersThreeIcon />{visibleMembers.map((member) => memberDisplayName(member.memberKey, member.displayName)).join(' · ')}</div>}
  </article>;
}

function openingTaskNeedsAttention(task: OpeningTaskView): boolean {
  return task.resultBookId === null && (
    task.isRunning
    || task.status === 'awaiting_author_confirmation'
    || task.status === 'awaiting_author_decision'
    || task.status === 'failed'
    || task.status === 'interrupted'
  );
}

function openingIdeaSummary(value: string): string {
  const characters = Array.from(value.trim().replace(/\s+/gu, ' '));
  return characters.length <= 48 ? characters.join('') : `${characters.slice(0, 48).join('')}…`;
}

function openingTaskCanArchive(task: OpeningTaskView): boolean {
  return task.resultBookId === null && !task.isRunning && ['failed', 'interrupted'].includes(task.status);
}

function openCreationTask(
  task: CreationWorkflowView,
  onOpenBook: (bookId: string) => void,
  onOpenCreation: ((bookId: string, focus: 'volume' | 'chain' | 'chapter') => void) | undefined
): void {
  const focus = creationFocus(task.stage);
  if (onOpenCreation !== undefined) onOpenCreation(task.bookId, focus);
  else onOpenBook(task.bookId);
}

function creationFocus(stage: CreationWorkflowView['stage']): 'volume' | 'chain' | 'chapter' {
  if (stage.startsWith('volume') || stage === 'context_selection') return 'volume';
  if (stage.startsWith('chain') || stage === 'chapter_outlines' || stage === 'chapter_outline_confirmation') return 'chain';
  return 'chapter';
}

function creationStageName(stage: CreationWorkflowView['stage']): string {
  if (stage.startsWith('volume') || stage === 'context_selection') return '本卷设计';
  if (stage.startsWith('chain')) return '单元链设计';
  if (stage.includes('outline')) return '章纲设计';
  if (stage.includes('manuscript')) return '正文创作';
  if (stage === 'settlement') return '写后整理';
  return '本链完成';
}

function creationStateName(status: CreationWorkflowView['status']): string {
  return ({
    waiting: '马上开始', working: '工作中', waiting_for_you: '等您决定',
    completed: '已完成', failed: '本轮未完成', partially_failed: '部分未完成', cancelled: '已停止'
  } as const)[status];
}

function formatTime(value: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return '刚刚更新';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time);
}
