import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { authorErrorFromUnknown } from '../lib/api/author-error';
import {
  ArchiveBoxIcon,
  BookOpenTextIcon,
  BooksIcon,
  CaretRightIcon,
  FileTextIcon,
  GearSixIcon,
  MapTrifoldIcon,
  LightbulbIcon,
  TagIcon,
  TreeStructureIcon,
  ListIcon,
  PlusIcon,
  UsersThreeIcon,
  XIcon
} from '@phosphor-icons/react';
import type { CoreWorkflowStage } from '@wenmi/contracts';

import {
  archiveBook,
  cancelTask,
  createBook,
  fetchBooks,
  fetchChapterContent,
  fetchChapterDetail,
  fetchHealth,
  fetchCurrentAccount,
  fetchMyMembership,
  logoutAccount,
  fetchOperationsStatus,
  fetchTaskCenter,
  fetchWorkspace,
  subscribeRuntimeEvents,
  resolveConfirmation,
  restoreBook,
  purgeBook,
  resumeTask,
  retryTask,
  type AuthAccountData,
  type BookData,
  type ChapterData,
  type MembershipStatusData,
  type OperationsStatusData,
  type TaskCenterBookData,
  type WorkspaceData
} from '../lib/api/client';
import { cacheSnapshot, loadSnapshot } from '../lib/offline/offline-store';
import { NamingWorkspace } from '../features/naming/NamingWorkspace';
import { ArchiveBookDialog, PurgeBookDialog } from '../features/bookshelf/BookLifecycleDialogs';
import { bookCoverTitle, bookCoverTone, bookDisplayInfo, bookDisplayTitle, bookStatusLabel } from './display-labels';
import { CompleteCreateBookDialog } from '../features/onboarding/CompleteCreateBookDialog';
import { CoreWorkflowWorkspace } from '../features/core-workflow/CoreWorkflowWorkspace';
import { StoryKnowledgeWorkspace } from '../features/library/StoryKnowledgeWorkspace';
import { WorkspaceSkeleton } from '../features/shared/WorkspaceSkeleton';
import { GlobalTaskWorkspace, TaskDetailsDialog } from '../features/tasks/TaskWorkspace';
import { loadTaskSeen, taskNeedsAttention } from '../features/shared/task-presentation';
import { EditorialTeamWorkspace } from '../features/core-workflow/EditorialTeamWorkspace';
import { SettingsDialog } from '../features/settings/SettingsDialog';
import { ManuscriptWorkspace } from '../features/manuscript/ManuscriptWorkspace';
import { IdeationWorkspace } from '../features/ideation/IdeationWorkspace';
import { AuthScreen } from '../features/auth/AuthScreen';
import { PersonalCenterDialog, formatComputeValue } from '../features/account/PersonalCenterDialog';
import { FeedbackDialog } from '../features/feedback/FeedbackDialog';
import {
  MEMBERSHIP_BLOCK_COPY,
  MembershipGateProvider,
  setMembershipBlockedListener,
  type MembershipBlockReason
} from '../features/shared/membership-gate';
import {
  FONT_SCALE,
  readWorkspacePreferences,
  saveWorkspacePreferences,
  type WorkspacePreferences
} from './workspace-preferences';
import './app.css';
import '../features/core-workflow/core-workflow-v6.css';
import { installMobileViewportBridge } from './mobile-viewport';

type UtilityView = 'library' | 'naming' | 'tasks' | 'team' | 'ideas' | null;
type PlanningTab = CoreWorkflowStage;

interface TaskSelection {
  bookId: string;
  taskId: string;
}

const V6_PRIMARY_NAV = [
  ['setting', '设定', TreeStructureIcon],
  ['storyline', '故事线', BookOpenTextIcon],
  ['volume', '分卷', MapTrifoldIcon],
  ['event', '事件', CaretRightIcon],
  ['chapter', '章节', FileTextIcon]
] as const;

const V6_UTILITY_NAV = [
  ['library', '资料库', BooksIcon],
  ['naming', '取名', TagIcon],
  ['team', '团队', UsersThreeIcon],
  ['tasks', '任务', FileTextIcon],
  ['ideas', '灵感', LightbulbIcon],
  ['settings', '设置', GearSixIcon]
] as const;

export function App(): React.JSX.Element {
  const [account, setAccount] = useState<AuthAccountData | null | undefined>(undefined);
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => installMobileViewportBridge(), []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchCurrentAccount(controller.signal)
      .then((current) => { setAccount(current); setStartupError(null); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setStartupError(authorErrorFromUnknown(reason, '暂时无法连接文秘写作'));
          setAccount(null);
        }
      });
    return () => controller.abort();
  }, []);

  if (account === undefined) {
    return <main className="auth-shell"><section className="auth-card auth-loading"><div className="auth-brand" aria-hidden="true">文</div><h1 className="sr-only">文秘写作</h1><p>正在打开文秘写作…</p></section></main>;
  }
  if (account === null) {
    return <><AuthScreen onAuthenticated={setAccount} />{startupError !== null && <p className="startup-connection-error" role="alert">{startupError}</p>}</>;
  }
  return <WorkspaceApp account={account} onSignOut={async () => {
    await logoutAccount();
    setAccount(null);
  }} />;
}

function WorkspaceApp({ account, onSignOut }: { account: AuthAccountData; onSignOut: () => Promise<void> }): React.JSX.Element {
  const [books, setBooks] = useState<BookData[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(() => readSelectedBook());
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [creationTab, setCreationTab] = useState<PlanningTab>(() => readCoreWorkflowStage());
  const [unlockedStage, setUnlockedStage] = useState<CoreWorkflowStage | null>(null);
  const [utilityView, setUtilityView] = useState<UtilityView>(null);
  const [homeTaskEntries, setHomeTaskEntries] = useState<TaskCenterBookData[]>([]);
  const [homeTasksLoading, setHomeTasksLoading] = useState(false);
  const [homeTasksError, setHomeTasksError] = useState<string | null>(null);
  const [taskSeen, setTaskSeen] = useState<Record<string, string>>(() => loadTaskSeen());
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<ChapterData | null>(null);
  const [reader, setReader] = useState<{ content: string; offline: boolean; manuscriptVersionId: string | null } | null>(null);
  const [chapterDetail, setChapterDetail] = useState<Awaited<ReturnType<typeof fetchChapterDetail>> | null>(null);
  const [operationsStatus, setOperationsStatus] = useState<OperationsStatusData | null>(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(() => new URLSearchParams(window.location.search).get('newBook') === '1');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveCandidate, setArchiveCandidate] = useState<BookData | null>(null);
  const [purgeCandidate, setPurgeCandidate] = useState<BookData | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskSelection | null>(null);
  const [preferences, setPreferences] = useState<WorkspacePreferences>(() => readWorkspacePreferences());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chapterAdvanceNotice, setChapterAdvanceNotice] = useState<{ message: string; actionLabel: string } | null>(null);
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatusData | null>(null);
  const [membershipChecking, setMembershipChecking] = useState(false);
  const [membershipBlock, setMembershipBlock] = useState<MembershipBlockReason | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [noticeDismissed, setNoticeDismissedState] = useState(() => {
    try { return window.localStorage.getItem('wenmi-notice-dismissed') === '1'; } catch { return false; }
  });
  useEffect(() => persistCoreWorkflowStage(creationTab), [creationTab]);

  const setNoticeDismissed = (dismissed: boolean) => {
    setNoticeDismissedState(dismissed);
    try { if (dismissed) window.localStorage.setItem('wenmi-notice-dismissed', '1'); } catch { /* 忽略隐私模式写入失败 */ }
  };

  const refreshMembership = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setMembershipChecking(true);
    try {
      const status = await fetchMyMembership(signal);
      if (signal?.aborted !== true) setMembershipStatus(status);
    } catch {
      // 会员状态暂时取不到时保留旧值；生成门禁由服务端兜底。
    } finally {
      if (signal?.aborted !== true) setMembershipChecking(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshMembership(controller.signal);
    return () => controller.abort();
  }, [refreshMembership]);

  const activeBooks = books.filter((book) => book.status !== 'archived');
  const archivedBooks = books.filter((book) => book.status === 'archived');
  const selectedBook = activeBooks.find((book) => book.bookId === selectedBookId) ?? null;
  // 功能栏"任务"按钮红点：任何书有任务在跑、卡住或出了没看过的新结果就亮。
  const tasksAttention = homeTaskEntries.some((entry) =>
    entry.tasks.some((task) => taskNeedsAttention(task, taskSeen)));
  const membershipRecord = membershipStatus?.membership ?? null;
  const membershipUsable = account.role === 'admin'
    || (membershipRecord !== null && membershipRecord.status === 'active' && !membershipRecord.expired && membershipRecord.computeRemaining > 0);
  // AI 介入前置检查：管理员或持有生效会员可放行；未开通会员则弹窗提示并阻断调用。
  const guardAi = useCallback((): boolean => {
    if (membershipUsable) return true;
    const record = membershipStatus?.membership ?? null;
    if (record !== null && record.status === 'active' && record.expired) setMembershipBlock('expired');
    else if (record !== null && record.status === 'active') setMembershipBlock('quota');
    else setMembershipBlock('required');
    return false;
  }, [membershipStatus, membershipUsable]);

  useEffect(() => {
    setMembershipBlockedListener((reason) => {
      if (account.role !== 'admin') setMembershipBlock(reason);
    });
    return () => setMembershipBlockedListener(null);
  }, [account.role]);

  useEffect(() => {
    if (membershipUsable) setMembershipBlock(null);
  }, [membershipUsable]);

  useEffect(() => {
    // 会员不可用期间持续轮询（无论内测说明弹窗是否被关闭），保证管理员开通后
    // 无需刷新页面即可自动解锁；一旦变为可用即停止。
    if (membershipUsable || account.role === 'admin') return;
    const poll = window.setInterval(() => { void refreshMembership(); }, 20_000);
    return () => window.clearInterval(poll);
  }, [membershipUsable, account.role, refreshMembership]);
  const membershipGateValue = useMemo(
    () => ({ canUseAi: membershipUsable, guardAi }),
    [membershipUsable, guardAi]
  );
  const selectedTaskContext = selectedTask === null
    ? null
    : (() => {
        const taskWorkspace = selectedBookId === selectedTask.bookId
          ? workspace
          : homeTaskEntries.find((entry) => entry.book.bookId === selectedTask.bookId) ?? null;
        const task = taskWorkspace?.tasks.find((item) => item.taskId === selectedTask.taskId) ?? null;
        return taskWorkspace === null || task === null
          ? null
          : { bookId: selectedTask.bookId, workspace: taskWorkspace, task };
      })();
  const selectedWorkspaceChapter = workspace?.chapters.find((chapter) => chapter.chapterId === selectedChapterId) ?? null;

  const loadBooks = useCallback(async (signal?: AbortSignal) => {
    const nextBooks = await fetchBooks(signal);
    setBooks(nextBooks);
    setSelectedBookId((current) => {
      const nextActiveBooks = nextBooks.filter((book) => book.status !== 'archived');
      const next = current !== null && nextActiveBooks.some((book) => book.bookId === current)
        ? current
        : nextActiveBooks[0]?.bookId ?? null;
      persistSelectedBook(next);
      return next;
    });
  }, []);

  const refreshWorkspace = useCallback(async (bookId: string, signal?: AbortSignal) => {
    const nextWorkspace = await fetchWorkspace(bookId, signal);
    setWorkspace(nextWorkspace);
    return nextWorkspace;
  }, []);

  const refreshHomeTasks = useCallback(async (signal?: AbortSignal) => {
    const taskCenter = await fetchTaskCenter(signal);
    if (signal?.aborted === true) return;
    setHomeTaskEntries(Array.isArray(taskCenter?.books) ? taskCenter.books : []);
    setHomeTasksError(null);
    setHomeTasksLoading(false);
  }, []);

  // 事件流刷新依赖当前选中书但订阅本身只需建立一次：用 ref 镜像最新值，避免按书重连分叉游标。
  const selectedBookIdRef = useRef(selectedBookId);
  selectedBookIdRef.current = selectedBookId;
  const refreshWorkspaceRef = useRef(refreshWorkspace);
  refreshWorkspaceRef.current = refreshWorkspace;
  const refreshHomeTasksRef = useRef(refreshHomeTasks);
  refreshHomeTasksRef.current = refreshHomeTasks;

  useEffect(() => {
    let workspaceTimer: number | null = null;
    let tasksTimer: number | null = null;
    const unsubscribe = subscribeRuntimeEvents({
      onEvent: (event) => {
        const bookId = selectedBookIdRef.current;
        if (bookId !== null && event.bookId === bookId && workspaceTimer === null) {
          workspaceTimer = window.setTimeout(() => {
            workspaceTimer = null;
            void refreshWorkspaceRef.current(bookId).catch(() => undefined);
          }, 80);
        }
        // 任务事件始终刷新任务中心：功能栏"任务"按钮的红点依赖这份数据，不限于打开任务页时。
        if (tasksTimer !== null) return;
        tasksTimer = window.setTimeout(() => {
          tasksTimer = null;
          void refreshHomeTasksRef.current().catch(() => undefined);
        }, 80);
      }
    });
    return () => {
      unsubscribe();
      if (workspaceTimer !== null) window.clearTimeout(workspaceTimer);
      if (tasksTimer !== null) window.clearTimeout(tasksTimer);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([fetchHealth(controller.signal), loadBooks(controller.signal)])
      .then(() => {
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(authorErrorFromUnknown(reason, '无法连接本地服务'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    // 功能栏"任务"红点需要任务数据：进入应用即加载一次，并慢速轮询兜底（事件流是主通道）。
    void refreshHomeTasks(controller.signal).catch(() => undefined);
    const tasksPoll = window.setInterval(() => { void refreshHomeTasks().catch(() => undefined); }, 60_000);
    return () => {
      controller.abort();
      window.clearInterval(tasksPoll);
    };
  }, [loadBooks, refreshHomeTasks]);

  // 从任务中心返回其他页面时，重新读取"已看过"记录，红点立即熄灭。
  useEffect(() => {
    setTaskSeen(loadTaskSeen());
  }, [utilityView]);

  useEffect(() => {
    if (selectedBookId === null) {
      setWorkspace(null);
      return;
    }
    const controller = new AbortController();
    void refreshWorkspace(selectedBookId, controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(authorErrorFromUnknown(reason, '工作区加载失败'));
    });
    const poll = window.setInterval(() => { void refreshWorkspace(selectedBookId).catch(() => undefined); }, 30_000);
    return () => {
      controller.abort();
      window.clearInterval(poll);
    };
  }, [refreshWorkspace, selectedBookId]);

  useEffect(() => {
    if (utilityView !== 'tasks') return;
    const controller = new AbortController();
    setHomeTasksLoading(true);
    void refreshHomeTasks(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setHomeTasksError(authorErrorFromUnknown(reason, '任务中心加载失败'));
        setHomeTasksLoading(false);
      }
    });
    const poll = window.setInterval(() => { void refreshHomeTasks().catch(() => undefined); }, 30_000);
    return () => {
      controller.abort();
      window.clearInterval(poll);
    };
  }, [refreshHomeTasks, utilityView]);

  useEffect(() => {
    saveWorkspacePreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    setReader(null);
    setChapterDetail(null);
    if (selectedBookId === null || selectedChapterId === null || workspace === null) return;
    const cacheKey = `chapter:${selectedBookId}:${selectedChapterId}`;
    const controller = new AbortController();
    void fetchChapterDetail(selectedBookId, selectedChapterId, controller.signal).then(setChapterDetail).catch(() => undefined);
    const activeChapter = selectedWorkspaceChapter ?? selectedChapter;
    const activeVersionId = activeChapter?.currentManuscriptVersionId ?? activeChapter?.canonManuscriptVersionId ?? null;
    if (activeChapter !== null && activeVersionId === null) {
      setReader({ content: '', offline: false, manuscriptVersionId: null });
      return () => controller.abort();
    }
    void fetchChapterContent(selectedBookId, selectedChapterId, controller.signal)
      .then(async (content) => {
        setReader({ content: content.content, offline: false, manuscriptVersionId: content.manuscriptVersionId });
        await cacheSnapshot(cacheKey, selectedBookId, workspace.book.canonRevision, content.content);
      })
      .catch(async () => {
        const cached = await loadSnapshot<string>(cacheKey, workspace.book.canonRevision);
        if (cached !== null) setReader({ content: cached, offline: true, manuscriptVersionId: activeVersionId });
      });
    return () => controller.abort();
  }, [selectedBookId, selectedChapterId, selectedWorkspaceChapter?.currentManuscriptVersionId, selectedWorkspaceChapter?.canonManuscriptVersionId, selectedChapter?.currentManuscriptVersionId, selectedChapter?.canonManuscriptVersionId, workspace?.book.canonRevision]);

  useEffect(() => {
    if (creationTab !== 'chapter' || workspace === null || workspace.chapters.length === 0) return;
    if (selectedChapterId !== null && selectedChapter?.chapterId === selectedChapterId) return;
    const firstChapter = [...workspace.chapters].sort((left, right) => left.chapterNumber - right.chapterNumber)[0];
    if (firstChapter === undefined) return;
    setSelectedChapterId(firstChapter.chapterId);
    setSelectedChapter(firstChapter);
  }, [creationTab, selectedChapterId, selectedChapter?.chapterId, workspace]);

  useEffect(() => {
    if (!settingsOpen) {
      setOperationsStatus(null);
      return;
    }
    const controller = new AbortController();
    void fetchOperationsStatus(controller.signal).then((nextOperations) => {
      setOperationsStatus(nextOperations);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(authorErrorFromUnknown(reason, '本机诊断加载失败'));
    });
    return () => controller.abort();
  }, [settingsOpen]);

  const selectBook = (bookId: string): void => {
    setSelectedBookId(bookId);
    setUnlockedStage(null);
    persistSelectedBook(bookId);
    setSelectedChapterId(null);
    setSelectedChapter(null);
    setSelectedTask(null);
    setUtilityView(null);
    setLeftOpen(false);
  };

  const createNewBook = async (input: Parameters<typeof createBook>[0]): Promise<boolean> => {
    setBusy(true);
    try {
      const created = await createBook(input);
      await loadBooks();
      selectBook(created.bookId);
      if (input.openingBlueprint?.creationMode === 'continuation') {
        setCreationTab('chapter');
          } else {
        setCreationTab('setting');
          }
      setCreateOpen(false);
      setError(null);
      return true;
    } catch (reason) {
      setError(authorErrorFromUnknown(reason, '建书失败'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const decideConfirmation = async (bookId: string, confirmationId: string, expectedCanonRevision: number, accept: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const resolution = await resolveConfirmation(bookId, confirmationId, expectedCanonRevision, accept);
      if (accept && resolution.status === 'settled') {
        if (bookId !== selectedBookId) selectBook(bookId);
        const nextWorkspace = await refreshWorkspace(bookId);
        const settledChapter = nextWorkspace.chapters.find((chapter) => chapter.chapterId === resolution.settledChapterId) ?? null;
        const ordered = [...nextWorkspace.chapters].sort((left, right) => left.chapterNumber - right.chapterNumber);
        const nextChapter = ordered.find((chapter) => chapter.settlementStatus !== 'settled'
          && (settledChapter === null || chapter.chapterNumber > settledChapter.chapterNumber))
          ?? ordered.find((chapter) => chapter.settlementStatus !== 'settled')
          ?? null;
        if (nextChapter !== null) {
          setSelectedChapterId(nextChapter.chapterId);
          setSelectedChapter(nextChapter);
          setCreationTab('chapter');
          setUtilityView(null);
          setChapterAdvanceNotice({
            message: resolution.nextOutlineTaskId === null || resolution.nextOutlineTaskId === undefined
              ? `上一章已定稿并结算。第 ${nextChapter.chapterNumber} 章已经就位，是否开始下一章？`
              : `上一章已定稿并结算。第 ${nextChapter.chapterNumber} 章章纲正在按真实结算重新生成，是否开始下一章？`,
            actionLabel: '开始下一章'
          });
          window.setTimeout(() => {
            const stageTrack = document.querySelector('[aria-label="章节阶段"]');
            if (stageTrack instanceof HTMLElement && typeof stageTrack.scrollIntoView === 'function') {
              stageTrack.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 0);
        } else {
          setCreationTab('event');
          setUtilityView(null);
          setChapterAdvanceNotice({ message: '当前事件的章节已经全部结算，请查看事件结算并继续后续事件。', actionLabel: '查看事件' });
        }
      }
      await refreshHomeTasks();
      setError(null);
    } catch (reason) {
      setError(authorErrorFromUnknown(reason, '确认操作失败'));
    } finally {
      setBusy(false);
    }
  };

  const cancelSelectedTask = async (bookId: string, taskId: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await cancelTask(bookId, taskId);
      await refreshHomeTasks();
      setSelectedTask(null);
      setError(null);
    } catch (reason) {
      setError(authorErrorFromUnknown(reason, '任务取消失败'));
    } finally {
      setBusy(false);
    }
  };

  const retrySelectedTask = async (bookId: string, taskId: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await retryTask(bookId, taskId);
      await refreshHomeTasks();
      setSelectedTask(null);
      setError(null);
    } catch (reason) {
      setError(authorErrorFromUnknown(reason, '任务重试失败'));
    } finally {
      setBusy(false);
    }
  };

  const resumeSelectedTask = async (bookId: string, taskId: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await resumeTask(bookId, taskId);
      await refreshHomeTasks();
      setSelectedTask(null);
      setError(null);
    } catch (reason) {
      setError(authorErrorFromUnknown(reason, '任务继续失败'));
    } finally {
      setBusy(false);
    }
  };

  const archiveSelectedBook = async (): Promise<void> => {
    if (archiveCandidate === null || busy) return;
    setBusy(true);
    try {
      await archiveBook(archiveCandidate.bookId, archiveCandidate.version);
      setArchiveCandidate(null);
      await loadBooks();
      setError(null);
    } catch (reason) {
      setError(authorErrorFromUnknown(reason, '归档书籍失败'));
    } finally {
      setBusy(false);
    }
  };

  const restoreArchivedBook = async (book: BookData): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await restoreBook(book.bookId, book.version);
      await loadBooks();
      selectBook(book.bookId);
      setArchiveOpen(false);
      setError(null);
    } catch (reason) {
      setError(authorErrorFromUnknown(reason, '恢复书籍失败'));
    } finally {
      setBusy(false);
    }
  };

  const permanentlyDeleteArchivedBook = async (confirmationText: string): Promise<void> => {
    if (purgeCandidate === null || busy) return;
    const deletedBookId = purgeCandidate.bookId;
    setBusy(true);
    try {
      await purgeBook(deletedBookId, confirmationText);
      setBooks((current) => current.filter((book) => book.bookId !== deletedBookId));
      if (selectedBookId === deletedBookId) {
        setSelectedBookId(null);
        persistSelectedBook(null);
        setWorkspace(null);
          setSelectedChapterId(null);
        setSelectedChapter(null);
        setSelectedTask(null);
      }
      setPurgeCandidate(null);
      setArchiveOpen(false);
      setError(null);
    } catch (reason) {
      setError(authorErrorFromUnknown(reason, '永久删除书籍失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MembershipGateProvider value={membershipGateValue}>
    <div
      className="app-shell unified-desk"
      data-theme={preferences.theme}
      style={{ '--font-scale': String(FONT_SCALE[preferences.fontSize]) } as CSSProperties}
    >
      <aside className={`left-rail ios-book-sidebar ${leftOpen ? 'drawer-open' : ''}`} aria-label="书籍栏">
        <div className="sidebar-brand">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">文</div>
            <div><h1>文秘写作</h1><span>长篇小说创作台</span></div>
          </div>
          <button className="icon-button mobile-only" type="button" aria-label="关闭书籍栏" onClick={() => setLeftOpen(false)}><XIcon /></button>
        </div>
        <div className="rail-book-switcher unified-book-switcher" aria-label="书籍切换">
          <button className="rail-new-book" type="button" onClick={() => { setCreateOpen(true); setLeftOpen(false); }}><PlusIcon /><span>新建书籍</span></button>
          <div className="book-list-heading"><span>我的书籍</span><strong>{activeBooks.length}</strong></div>
          <nav aria-label="选择书籍">{activeBooks.map((book) => {
            const display = bookDisplayInfo(book.title);
            const coverTitle = bookCoverTitle(book.title);
            const selected = book.bookId === selectedBookId;
            return <button type="button" key={book.bookId}
              className={selected ? 'active' : ''} aria-current={selected ? 'page' : undefined}
              aria-label={`打开《${display.title}》${display.qualifier === null ? '' : `，${display.qualifier}`}`}
              onClick={() => selectBook(book.bookId)}>
              <span className={`book-rail-cover cover-tone-${bookCoverTone(book.bookId)}`} aria-hidden="true">
                <small>文秘</small><b className={`book-cover-title title-${coverTitle.size}`} title={coverTitle.truncated ? coverTitle.fullTitle : undefined}>{coverTitle.text}</b><i>小说</i>
              </span>
              <span className="book-cover-status"><strong>{display.title}</strong><small>{display.qualifier ?? (selected ? '当前书籍' : bookStatusLabel(book.status))}</small></span>
            </button>;
          })}</nav>
          <div className="sidebar-book-actions">
            {archivedBooks.length > 0 && <details className="rail-archived-books" open={archiveOpen} onToggle={(event) => setArchiveOpen(event.currentTarget.open)}>
              <summary>已归档书籍 · {archivedBooks.length}</summary>
              <div>{archivedBooks.map((book) => <article key={book.bookId}>
                <span><ArchiveBoxIcon /><strong>{bookDisplayTitle(book.title)}</strong></span>
                <div><button type="button" disabled={busy} onClick={() => void restoreArchivedBook(book)}>恢复</button>
                  <button type="button" disabled={busy} onClick={() => setPurgeCandidate(book)}>彻底删除</button></div>
              </article>)}</div>
            </details>}
            {selectedBook !== null && <button className="archive-current-book" type="button" onClick={() => setArchiveCandidate(selectedBook)}><ArchiveBoxIcon /><span>归档当前书籍</span></button>}
          </div>
        </div>
        <div className="sidebar-account">
          <button className="sidebar-account-profile" type="button" aria-label="打开个人资料" onClick={() => { setProfileOpen(true); setLeftOpen(false); }}>
            <span className="sidebar-account-avatar" aria-hidden="true">{account.displayName.slice(0, 1).toUpperCase()}</span>
            <span className="sidebar-account-copy"><strong>{account.displayName}</strong><span>{account.role === 'admin' ? '管理员 · 算力值不限' : formatMembershipBadge(membershipStatus)}</span></span>
            <span className="sidebar-account-profile-label">个人资料</span>
          </button>
          <div className="sidebar-account-actions">
            <button type="button" onClick={() => setFeedbackOpen(true)}>反馈</button>
            <button type="button" onClick={() => void onSignOut()}>退出</button>
          </div>
        </div>
      </aside>

      <nav className="ios-function-bar" aria-label="功能栏">
        <button className="icon-button mobile-only function-book-toggle" type="button" aria-label="打开书籍栏" onClick={() => setLeftOpen(true)}><ListIcon /></button>
        <div className="function-nav-primary" hidden={loading}>
          {V6_PRIMARY_NAV.map(([key, label, Icon]) => <button type="button" className={utilityView === null && creationTab === key ? 'active' : ''}
            aria-current={utilityView === null && creationTab === key ? 'page' : undefined} aria-label={label} disabled={selectedBook === null || (unlockedStage !== null && V6_PRIMARY_NAV.findIndex(([stageKey]) => stageKey === key) > V6_PRIMARY_NAV.findIndex(([stageKey]) => stageKey === unlockedStage))}
            key={key} onClick={() => { setCreationTab(key); setUtilityView(null); setToolsOpen(false); }}><Icon /><span>{label}</span></button>)}
        </div>
        <div className="function-nav-utilities" hidden={loading}>
          {V6_UTILITY_NAV.map(([key, label, Icon]) => <button className={key !== 'settings' && utilityView === key ? 'active' : ''} type="button"
            aria-current={key !== 'settings' && utilityView === key ? 'page' : undefined} disabled={key !== 'tasks' && key !== 'settings' && selectedBook === null}
            key={key} onClick={() => { if (key === 'settings') setSettingsOpen(true); else setUtilityView(key); setToolsOpen(false); }}><Icon /><span>{label}</span>
            {key === 'tasks' && tasksAttention && <i className="nav-task-dot" aria-hidden="true" />}</button>)}
        </div>
        <button type="button" className={`v6-tools-trigger ${utilityView !== null ? 'active' : ''}`} aria-expanded={toolsOpen} onClick={() => setToolsOpen((value) => !value)}><GearSixIcon /><span>工具</span></button>
        {toolsOpen && <div className="function-nav-utilities v6-tools-popover" role="menu">
          {V6_UTILITY_NAV.map(([key, label, Icon]) => <button className={key !== 'settings' && utilityView === key ? 'active' : ''} type="button" role="menuitem"
            disabled={key !== 'tasks' && key !== 'settings' && selectedBook === null} key={key}
            onClick={() => { if (key === 'settings') setSettingsOpen(true); else setUtilityView(key); setToolsOpen(false); }}><Icon /><span>{label}</span>
            {key === 'tasks' && tasksAttention && <i className="nav-task-dot" aria-hidden="true" />}</button>)}
        </div>}
      </nav>
      <main className="workspace-main">
        {chapterAdvanceNotice !== null && <div className="flow-notice" role="status"><span><strong>章节已推进</strong>{chapterAdvanceNotice.message}</span><div><button type="button" onClick={() => setChapterAdvanceNotice(null)}>稍后</button><button className="primary-button" type="button" onClick={() => { setChapterAdvanceNotice(null); setUtilityView(null); }}>{chapterAdvanceNotice.actionLabel}</button></div></div>}
        {error !== null && <div className="error-banner" role="alert"><span><strong>小文秘书：</strong>{error}</span><button type="button" onClick={() => setError(null)} aria-label="关闭错误"><XIcon /></button></div>}
        {loading ? <WorkspaceSkeleton />
        : utilityView === 'library' ? (selectedBook === null
          ? <UnifiedEmptyState title="先创建一本书" description="资料库只读取当前书籍的正式资料与来源。" onCreate={() => setCreateOpen(true)} />
          : <StoryKnowledgeWorkspace bookId={selectedBook.bookId} />)
        : utilityView === 'naming' ? (selectedBook === null
          ? <UnifiedEmptyState title="先创建一本书" description="取名工具会结合当前书籍信息提供建议。" onCreate={() => setCreateOpen(true)} />
          : <NamingWorkspace book={selectedBook} />)
        : utilityView === 'tasks' ? <GlobalTaskWorkspace
          entries={homeTaskEntries}
          loading={homeTasksLoading}
          loadError={homeTasksError}
          busy={busy}
          onSelect={(bookId, task) => setSelectedTask({ bookId, taskId: task.taskId })}
          onDecide={decideConfirmation}
        /> : utilityView === 'team' ? (selectedBook === null
          ? <UnifiedEmptyState title="先创建一本书" description="编辑部成员会随书建立，并按任务动态分配。" onCreate={() => setCreateOpen(true)} />
          : <EditorialTeamWorkspace bookId={selectedBook.bookId} />)
        : utilityView === 'ideas' ? (selectedBook === null
          ? <UnifiedEmptyState title="先创建一本书" description="灵感只读取当前书籍信息，不会混入其他书。" onCreate={() => setCreateOpen(true)} />
          : <IdeationWorkspace bookId={selectedBook.bookId}
              currentLocation={creationTab === 'setting' ? 'basic' : creationTab === 'storyline' ? 'framework' : creationTab === 'volume' ? 'master' : creationTab}
              onError={setError} />)
        : selectedBook === null ? <UnifiedEmptyState title="创建您的第一本书" description="专业网文剧本设计平台：AI 团队帮您设计骨架、大纲、剧情，书写正文，订制化设计原创作品。" hint="未开通会员也可以先建书、填资料；开通后 AI 团队立刻开始干活。" onCreate={() => setCreateOpen(true)} />
        : <CoreWorkflowWorkspace
            stage={creationTab}
            onStageChange={(stage) => { setCreationTab(stage); setUtilityView(null); }}
            onAvailabilityChange={setUnlockedStage}
            workspace={workspace}
            onChanged={async () => { await refreshWorkspace(selectedBook.bookId); }}
            manuscript={<ManuscriptWorkspace
              key={selectedBook.bookId}
              workspace={workspace}
              selectedChapterId={selectedChapterId}
              chapter={selectedWorkspaceChapter ?? selectedChapter}
              reader={reader}
              detail={chapterDetail}
              onSelectChapter={(chapter) => { setSelectedChapterId(chapter.chapterId); setSelectedChapter(chapter); }}
              onChanged={() => void refreshWorkspace(selectedBook.bookId)}
              onOpenPlanning={() => setCreationTab('setting')}
            />}
          />}      </main>

      {leftOpen && <button className="drawer-scrim mobile-only" type="button" aria-label="关闭抽屉" onClick={() => setLeftOpen(false)} />}
      {profileOpen && <PersonalCenterDialog account={account} membership={membershipStatus} onClose={() => setProfileOpen(false)} onSignOut={() => { setProfileOpen(false); void onSignOut(); }} />}
      {feedbackOpen && <FeedbackDialog bookId={selectedBookId} onClose={() => setFeedbackOpen(false)} />}
      {createOpen && <CompleteCreateBookDialog accountId={account.userId} busy={busy} onCancel={() => setCreateOpen(false)} onCreate={createNewBook} />}
      {account.role !== 'admin' && membershipStatus !== null && !membershipUsable && !noticeDismissed && (
        <div className="dialog-backdrop membership-gate-backdrop">
          <section className="dialog membership-prompt" role="dialog" aria-label="欢迎说明">
            <button className="membership-close" type="button" aria-label="关闭欢迎说明" onClick={() => setNoticeDismissed(true)}><XIcon /></button>
            <div className="brand-mark" aria-hidden="true">文</div>
            <h2>欢迎来到文秘写作（内测版）</h2>
            <p>这是一个 AI 团队陪您写长篇小说的工具：您出想法、做取舍，11 位 AI 成员分工完成设定、大纲、正文，每一步都由您拍板。</p>
            <p>当前为内测阶段，使用中遇到问题欢迎反馈，我们会持续优化。</p>
            <p className="membership-contact">使用需要算力：添加管理员微信 <strong>595341366</strong> 开通会员即可开始创作。</p>
            <p className="membership-gate-hint">管理员开通后会自动解除限制；如已开通，点击下方刷新立即生效。</p>
            <footer className="membership-prompt-actions two">
              <button type="button" className="primary" disabled={membershipChecking} onClick={() => void refreshMembership()}>
                {membershipChecking ? '正在刷新…' : '刷新会员状态'}
              </button>
              <button type="button" onClick={() => setNoticeDismissed(true)}>先看看</button>
            </footer>
          </section>
        </div>
      )}
      {membershipBlock !== null && (
        <div className="dialog-backdrop membership-gate-backdrop">
          <section className="dialog membership-prompt" role="dialog" aria-label="会员提示">
            <div className="brand-mark" aria-hidden="true">文</div>
            <h2>{MEMBERSHIP_BLOCK_COPY[membershipBlock].title}</h2>
            <p className="membership-contact">{MEMBERSHIP_BLOCK_COPY[membershipBlock].body}</p>
            <p className="membership-gate-hint">管理员开通后会自动解除限制；如已开通，点击下方刷新立即生效。</p>
            <footer className="membership-prompt-actions two">
              <button type="button" className="primary" disabled={membershipChecking} onClick={() => void refreshMembership()}>
                {membershipChecking ? '正在刷新…' : '刷新会员状态'}
              </button>
              <button type="button" onClick={() => setMembershipBlock(null)}>知道了</button>
            </footer>
          </section>
        </div>
      )}
      {archiveCandidate !== null && <ArchiveBookDialog book={archiveCandidate} busy={busy} onCancel={() => setArchiveCandidate(null)} onConfirm={archiveSelectedBook} />}
      {purgeCandidate !== null && <PurgeBookDialog book={purgeCandidate} busy={busy} onCancel={() => setPurgeCandidate(null)} onConfirm={permanentlyDeleteArchivedBook} />}
      {settingsOpen && <SettingsDialog preferences={preferences} bookId={selectedBookId} operations={operationsStatus} onBooksChanged={() => void loadBooks()} onChange={setPreferences} onClose={() => setSettingsOpen(false)} />}
      {selectedTaskContext !== null && (
        <TaskDetailsDialog
          bookId={selectedTaskContext.bookId}
          task={selectedTaskContext.task}
          workspace={selectedTaskContext.workspace}
          busy={busy}
          onCancelTask={cancelSelectedTask}
          onRetryTask={retrySelectedTask}
          onResumeTask={resumeSelectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
    </MembershipGateProvider>
  );
}

function formatMembershipBadge(status: MembershipStatusData | null): string {
  const record = status?.membership ?? null;
  if (record === null) return '作者账号 · 未开通会员';
  const usable = record.status === 'active' && !record.expired && record.computeRemaining > 0;
  if (!usable) return record.expired ? `作者账号 · ${record.planLabel}已到期` : '作者账号 · 会员可用算力值已用完';
  return `作者账号 · ${record.planLabel} · 剩余${formatComputeValue(record.computeRemaining)}算力值`;
}

function UnifiedEmptyState({ title, description, hint, onCreate }: { title: string; description: string; hint?: string; onCreate?: () => void }): React.JSX.Element {
  return <section className="unified-empty-state">
    <div className="brand-mark" aria-hidden="true">文</div>
    <h2>{title}</h2>
    <p>{description}</p>
    {hint !== undefined && <small className="unified-empty-hint">{hint}</small>}
    {onCreate !== undefined && <button className="primary-button" type="button" onClick={onCreate}><PlusIcon />新建书籍</button>}
  </section>;
}


function readSelectedBook(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('book');
  } catch {
    return null;
  }
}

function readCoreWorkflowStage(): PlanningTab {
  try {
    if (typeof window === 'undefined') return 'setting';
    const query = new URLSearchParams(window.location.search);
    const value = query.get('stage') ?? query.get('view');
    return ({
      setting: 'setting', basic: 'setting',
      storyline: 'storyline', framework: 'storyline',
      volume: 'volume', master: 'volume',
      event: 'event', chapter: 'chapter', manuscript: 'chapter'
    } as const)[value ?? ''] ?? 'setting';
  } catch {
    return 'setting';
  }
}

function persistCoreWorkflowStage(stage: PlanningTab): void {
  try {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('view');
    url.searchParams.set('stage', stage);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // 受限 WebView 可能禁用 history；当前会话中的 React 状态仍可使用。
  }
}

function persistSelectedBook(bookId: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (bookId === null) url.searchParams.delete('book');
    else {
      url.searchParams.delete('newBook');
      url.searchParams.set('book', bookId);
    }
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // 受限WebView可能禁用history；当前会话中的React状态仍可使用。
  }
}
