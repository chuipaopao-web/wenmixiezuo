import { BooksIcon, CaretRightIcon, XIcon } from '@phosphor-icons/react';
import type { TaskCenterBookData, TaskData } from '../../lib/api/client';
import { StructuredContent } from '../shared/StructuredContent';
import { WorkspaceSkeleton } from '../shared/WorkspaceSkeleton';
import { memberIdentity } from '../shared/agent-presentation';
import { bookDisplayTitle } from '../../app/display-labels';
import {
  confirmationLabel,
  isActiveTask,
  phaseLabel,
  statusLabel,
  taskChapterLabel,
  taskCheckpointLabel,
  taskGoal,
  taskLabel
} from '../shared/task-presentation';

function TaskButton({ task, workspace, onSelect }: { task: TaskData; workspace: TaskCenterBookData; onSelect: (task: TaskData) => void }): React.JSX.Element {
  const chapter = taskChapterLabel(task, workspace);
  return (
    <button className="task-button" type="button" aria-label={`${chapter} ${taskLabel(task.taskType)} ${phaseLabel(task.currentPhase)}`} onClick={() => onSelect(task)}>
      <span className={`task-status-dot ${task.status}`} aria-hidden="true" />
      <span>
        <strong>{chapter} · {taskLabel(task.taskType)}</strong>
        <small>{phaseLabel(task.currentPhase)} · {statusLabel(task.status)}</small>
      </span>
      <CaretRightIcon />
    </button>
  );
}

export function GlobalTaskWorkspace({ entries, loading, loadError, busy, onSelect, onDecide }: {
  entries: TaskCenterBookData[];
  loading: boolean;
  loadError: string | null;
  busy: boolean;
  onSelect: (bookId: string, task: TaskData) => void;
  onDecide: (bookId: string, confirmationId: string, expectedCanonRevision: number, accept: boolean) => Promise<void>;
}): React.JSX.Element {
  const activeTaskCount = entries.reduce((total, entry) =>
    total + entry.tasks.filter((task) => isActiveTask(task.status)).length, 0);
  const activeBookCount = entries.filter((entry) =>
    entry.tasks.some((task) => isActiveTask(task.status))).length;
  return (
    <section className="task-workspace" aria-labelledby="task-workspace-title">
      <header className="task-workspace-header">
        <h2 id="task-workspace-title" className="sr-only">任务</h2>
        <div className="task-workspace-count"><strong>{activeTaskCount}</strong><span>{activeBookCount} 本书有任务进行中</span></div>
      </header>
      {loadError !== null && <p className="task-workspace-warning" role="status">{loadError}</p>}
      {loading && entries.length === 0 ? <WorkspaceSkeleton /> : entries.length === 0 ? (
        <div className="task-workspace-empty-state">
          <BooksIcon />
          <h3>还没有可查看的书籍任务</h3>
          <p>创建书籍后，主编讨论、正文生成和后台整理任务会按书显示在这里。</p>
        </div>
      ) : (
        <div className="task-book-groups">
          {entries.map((workspace) => {
            const { book } = workspace;
            const activeTasks = workspace.tasks.filter((task) => isActiveTask(task.status));
            const historyTasks = workspace.tasks.filter((task) => !isActiveTask(task.status)).slice(-8).reverse();
            const budgetRatio = workspace.budget === null || workspace.budget.token_limit === 0
              ? 0
              : Math.round(((workspace.budget.spent_tokens + workspace.budget.reserved_tokens) / workspace.budget.token_limit) * 100);
            return (
              <section className="task-book-group" aria-label={`《${bookDisplayTitle(book.title)}》的任务`} key={book.bookId}>
                <header className="task-book-header">
                  <div><span className="task-book-mark"><BooksIcon /></span><span><h3>{bookDisplayTitle(book.title)}</h3><p>{activeTasks.length} 项进行中 · {historyTasks.length} 项最近记录</p></span></div>
                </header>
                <div className="task-workspace-layout">
                  <div className="task-workspace-primary">
                    <section className="task-workspace-section">
                      <div className="task-workspace-heading"><h4>进行中的任务</h4><span>{activeTasks.length}</span></div>
                      {activeTasks.length === 0 ? <p className="task-workspace-empty">这本书当前没有进行中的任务。</p> : (
                        <div className="task-list">{activeTasks.map((task) =>
                          <TaskButton key={task.taskId} task={task} workspace={workspace} onSelect={(selected) => onSelect(book.bookId, selected)} />
                        )}</div>
                      )}
                    </section>
                    <section className="task-workspace-section">
                      <div className="task-workspace-heading"><h4>最近任务</h4><span>{historyTasks.length}</span></div>
                      {historyTasks.length === 0 ? <p className="task-workspace-empty">还没有已结束的任务记录。</p> : (
                        <div className="task-list">{historyTasks.map((task) =>
                          <TaskButton key={task.taskId} task={task} workspace={workspace} onSelect={(selected) => onSelect(book.bookId, selected)} />
                        )}</div>
                      )}
                    </section>
                  </div>
                  <div className="task-workspace-secondary">
                    <section className="task-workspace-section budget-section">
                      <div className="task-workspace-heading"><h4>预算</h4><span>{budgetRatio}%</span></div>
                      <p>费用保护上限 {((workspace.budget?.cash_limit_micros ?? 0) / 1_000_000).toFixed(2)} 元</p>
                    </section>
                    <ConfirmationsPanel bookId={book.bookId} workspace={workspace} busy={busy} onDecide={onDecide} />
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function ConfirmationsPanel({ bookId, workspace, busy, onDecide }: {
  bookId: string;
  workspace: TaskCenterBookData | null;
  busy: boolean;
  onDecide: (bookId: string, confirmationId: string, expectedCanonRevision: number, accept: boolean) => Promise<void>;
}): React.JSX.Element {
  const confirmations = workspace?.confirmations.items ?? [];
  const headingId = `task-confirmations-${bookId}`;
  return (
    <section className="task-workspace-section" aria-labelledby={headingId}>
      <div className="task-workspace-heading"><h3 id={headingId}>待确认</h3><span>{workspace?.confirmations.count ?? 0}</span></div>
      {confirmations.length === 0 ? <p className="task-workspace-empty">当前没有需要老板确认的重大事项。</p> : (
        <div className="confirmation-list">{confirmations.map((confirmation) => (
          <article className="confirmation-card" key={confirmation.confirmationId}>
            <strong>{confirmationLabel(confirmation.targetType)}</strong>
            <span>需要你确认后才会继续</span>
            <details><summary>查看范围与影响</summary><StructuredContent value={{ scope: confirmation.scope, impact: confirmation.impact, estimatedCashCny: '0 元' }} /></details>
            <p>接受后会继续执行相关任务；含糊回复不会自动生效。</p>
            <div><button type="button" disabled={busy} onClick={() => void onDecide(bookId, confirmation.confirmationId, confirmation.expectedCanonRevision, false)}>拒绝</button><button className="confirm-button" type="button" disabled={busy} onClick={() => void onDecide(bookId, confirmation.confirmationId, confirmation.expectedCanonRevision, true)}>明确接受</button></div>
          </article>
        ))}</div>
      )}
    </section>
  );
}

export function TaskDetailsDialog({ bookId, task, workspace, busy, onCancelTask, onRetryTask, onClose }: {
  bookId: string;
  task: TaskData;
  workspace: TaskCenterBookData;
  busy: boolean;
  onCancelTask: (bookId: string, taskId: string) => Promise<void>;
  onRetryTask: (bookId: string, taskId: string) => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const agent = workspace.agents.find((item) => item.agentId === task.assignedAgentId) ?? null;
  const canCancel = isActiveTask(task.status) && !task.cancelRequested;
  const canRetry = ['failed', 'interrupted'].includes(task.status);
  const chapter = taskChapterLabel(task, workspace).replace(/^第(\d+)章$/u, '第 $1 章');
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="dialog task-dialog" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">
        <header>
          <div><h2 id="task-detail-title">任务详情</h2><p>{chapter} · {taskLabel(task.taskType)}</p></div>
          <button className="icon-button" type="button" aria-label="关闭任务详情" disabled={busy} onClick={onClose}><XIcon /></button>
        </header>
        <dl className="task-detail-grid">
          <div><dt>所属书籍</dt><dd>{bookDisplayTitle(workspace.book.title)}</dd></div>
          <div><dt>当前状态</dt><dd><span className={`task-status-dot ${task.status}`} aria-hidden="true" />{task.cancelRequested ? '取消处理中' : statusLabel(task.status)}</dd></div>
          <div><dt>创作阶段</dt><dd>{phaseLabel(task.currentPhase)}</dd></div>
          <div><dt>执行成员</dt><dd>{agent === null ? '等待分派' : memberIdentity(agent)}</dd></div>
          <div className="task-detail-wide"><dt>任务目标</dt><dd>{taskGoal(task, chapter)}</dd></div>
          <div className="task-detail-wide"><dt>当前进度</dt><dd>{taskCheckpointLabel(task.checkpoint)}</dd></div>
          {canRetry && <div className="task-detail-wide"><dt>继续说明</dt><dd>已完成的内容会继续保留，只处理尚未完成的部分。</dd></div>}
        </dl>
        <footer>
          <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>关闭</button>
          {canRetry && <button className="primary-button" type="button" disabled={busy} onClick={() => void onRetryTask(bookId, task.taskId)}>{busy ? '正在重试' : '继续重试'}</button>}
          {canCancel && <button className="danger-button" type="button" disabled={busy} onClick={() => void onCancelTask(bookId, task.taskId)}>{busy ? '正在取消' : '取消任务'}</button>}
        </footer>
      </section>
    </div>
  );
}

