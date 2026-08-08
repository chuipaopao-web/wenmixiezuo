import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArchiveBoxIcon,
  ArrowCounterClockwiseIcon,
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  BookOpenTextIcon,
  BooksIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
  DotsThreeVerticalIcon,
  EyeIcon,
  FileTextIcon,
  GearSixIcon,
  ImageIcon,
  MagnifyingGlassIcon,
  MapTrifoldIcon,
  TagIcon,
  TrashIcon,
  TreeStructureIcon,
  ListIcon,
  PlusIcon,
  UserCircleIcon,
  UsersThreeIcon,
  WifiHighIcon,
  WifiSlashIcon,
  XIcon
} from '@phosphor-icons/react';

import {
  archiveBook,
  cancelTask,
  createBook,
  fetchArtifacts,
  fetchArtifactVersions,
  fetchBooks,
  fetchOpeningTaxonomy,
  fetchCapabilities,
  fetchChapterContent,
  fetchChapterDetail,
  previewContinuationImport,
  confirmContinuationImport,
  analyzeContinuationImport,
  fetchContinuationImport,
  fetchLatestContinuationImport,
  fetchHealth,
  fetchGraphWorkspace,
  fetchLibrary,
  fetchMessages,
  fetchModelBindings,
  fetchVolumeChapters,
  createManuscriptVolume,
  createManuscriptChapter,
  fetchOperationsStatus,
  fetchProtagonists,
  fetchAttributeFormulas,
  fetchSettingOutlineWorkspace,
  fetchBookProfile,
  fetchPlanningState,
  fetchSettingReadiness,
  confirmSettingBaseline,
  fetchTaskCenter,
  fetchWorker,
  fetchWorkspace,
  fetchTeamConfig,
  fetchTeamTemplate,
  fetchProtectedRolePrompt,
  subscribeRuntimeEvents,
  resolveConfirmation,
  activateModelBindings,
  previewModelBindings,
  restoreModelBindingRevision,
  exportBookPackage,
  importBookCopy,
  addArtifactVersion,
  selectArtifactVersion,
  rejectArtifactVersion,
  restoreBook,
  purgeBook,
  retryTask,
  compareArtifactVersions,
  createLibraryTag,
  saveOwnerManuscript,
  withdrawOwnerManuscript,
  rewriteChapter,
  finalizeChapter,
  saveProtagonistProfile,
  appendProtagonistState,
  archiveProtagonistState,
  classifyProtagonistState,
  createAttributeFormula,
  evaluateAttributeFormula,
  initializeSettingOutlineWorkspace,
  saveSettingOutlineItem,
  saveAgentPromptPreference,
  type AgentData,
  type ArtifactVersionData,
  type BookData,
  type CapabilityData,
  type ChapterData,
  type ChapterPageData,
  type ContinuationImportData,
  type HealthData,
  type LibraryData,
  type GraphWorkspaceData,
  type ProtagonistDashboardData,
  type ProtagonistProfileData,
  type ProtagonistStateData,
  type AttributeFormulaData,
  type MessageData,
  type ModelBindingsData,
  type OperationsStatusData,
  type OpeningBlueprintData,
  type OpeningChannel,
  type ProtagonistRole,
  type OpeningTaxonomyData,
  type BookProfileViewData,
  type PlanningStateData,
  type TaskData,
  type TaskCenterBookData,
  type TeamModelProfileData,
  type TeamConfigData,
  type TeamTemplateData,
  type ProtectedRolePromptData,
  type WorkerData,
  type WorkspaceData
} from '../lib/api/client';
import { cacheSnapshot, loadSnapshot } from '../lib/offline/offline-store';
import { avatarPosition } from './role-avatars';
import { NamingAssistantPanel } from './NamingAssistantPanel';
import { recommendCharacterTarget, type NamingContext } from './naming-assistant';
import { NamingWorkspace } from '../features/naming/NamingWorkspace';
import { BookshelfHome } from '../features/bookshelf/BookshelfHome';
import { ArchiveBookDialog, PurgeBookDialog } from '../features/bookshelf/BookLifecycleDialogs';
import { bookStatusLabel, shortId } from './display-labels';
import { DrawerHeader, RailViewButton, ServiceState, TopbarBookSummary } from '../features/creation-desk/WorkspaceShell';
import { CompleteCreateBookDialog } from '../features/onboarding/CompleteCreateBookDialog';
import { PROTAGONIST_ROLES } from '../features/onboarding/opening-options';
import { FORMULA_CATEGORIES, PlanningWorkspace } from '../features/planning/PlanningWorkspace';
import { EmptyReference, RecordCollection, StructuredContent, artifactTypeLabel, authorityLabel, fieldLabel, formatValue, isRecord, isTechnicalField } from '../features/shared/StructuredContent';
import { KnowledgeGraph, LibraryWorkspace } from '../features/library/LibraryWorkspace';
import { ProjectionWorkspace } from '../features/graph/ProjectionWorkspace';
import { budgetModeLabel, confirmationLabel, formatBytes, formatNumber, formatTime, isActiveTask, phaseLabel, statusLabel, taskChapterFromBrief, taskChapterLabel, taskCheckpointLabel, taskGoal, taskLabel } from '../features/shared/task-presentation';
import { memberIdentity } from '../features/shared/agent-presentation';
import { AgentAvatar } from '../features/shared/AgentAvatar';
import { WorkspaceSkeleton } from '../features/shared/WorkspaceSkeleton';
import { ConfirmationsPanel, GlobalTaskWorkspace, TaskDetailsDialog } from '../features/tasks/TaskWorkspace';
import { AgentDetailsDialog, TeamInspector, TeamTemplateWorkspace, TeamWorkspace, activeTaskForAgent, roleSummary } from '../features/team/TeamWorkspace';
import { SettingsDialog } from '../features/settings/SettingsDialog';
import { ManuscriptChapterBrowser, ManuscriptWorkspace } from '../features/manuscript/ManuscriptWorkspace';
import {
  authorFactRelationLabel,
  authorFieldLabel,
  authorFormatScalar,
  authorRelationshipLabel,
  structuredReplyFromMixedText,
  toAuthorDisplayValue,
  toAuthorFacingText
} from './author-presentation';
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  FONT_SCALE,
  readWorkspacePreferences,
  saveWorkspacePreferences,
  type WorkspacePreferences
} from './workspace-preferences';
import './app.css';

type HomeView = 'shelf' | 'tasks' | 'team';
type PlanningTab = 'framework' | 'basic' | 'master' | 'event' | 'chapter' | 'manuscript' | 'graph' | 'library' | 'naming';

interface TaskSelection {
  bookId: string;
  taskId: string;
}

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityData | null>(null);
  const [worker, setWorker] = useState<WorkerData | null>(null);
  const [books, setBooks] = useState<BookData[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(() => readSelectedBook());
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [creationTab, setCreationTab] = useState<PlanningTab>('framework');
  const [homeView, setHomeView] = useState<HomeView>('shelf');
  const [homeTaskEntries, setHomeTaskEntries] = useState<TaskCenterBookData[]>([]);
  const [homeTasksLoading, setHomeTasksLoading] = useState(false);
  const [homeTasksError, setHomeTasksError] = useState<string | null>(null);
  const [teamTemplate, setTeamTemplate] = useState<TeamTemplateData | null>(null);
  const [teamBookId, setTeamBookId] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<ChapterData | null>(null);
  const [reader, setReader] = useState<{ content: string; offline: boolean; manuscriptVersionId: string | null } | null>(null);
  const [chapterDetail, setChapterDetail] = useState<Awaited<ReturnType<typeof fetchChapterDetail>> | null>(null);
  const [referenceData, setReferenceData] = useState<unknown>([]);
  const [modelBindings, setModelBindings] = useState<ModelBindingsData | null>(null);
  const [operationsStatus, setOperationsStatus] = useState<OperationsStatusData | null>(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [readerMode, setReaderMode] = useState(false);
  const [createOpen, setCreateOpen] = useState(() => new URLSearchParams(window.location.search).get('newBook') === '1');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [bookMenuId, setBookMenuId] = useState<string | null>(null);
  const [archiveCandidate, setArchiveCandidate] = useState<BookData | null>(null);
  const [purgeCandidate, setPurgeCandidate] = useState<BookData | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskSelection | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<WorkspacePreferences>(() => readWorkspacePreferences());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeBooks = books.filter((book) => book.status !== 'archived');
  const archivedBooks = books.filter((book) => book.status === 'archived');
  const selectedBook = activeBooks.find((book) => book.bookId === selectedBookId) ?? null;
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
  const homeTaskBookCount = homeTaskEntries.filter((entry) => entry.tasks.some((task) => isActiveTask(task.status))).length;

  const loadBooks = useCallback(async (signal?: AbortSignal) => {
    const nextBooks = await fetchBooks(signal);
    setBooks(nextBooks);
    setSelectedBookId((current) => {
      const nextActiveBooks = nextBooks.filter((book) => book.status !== 'archived');
      const next = current !== null && nextActiveBooks.some((book) => book.bookId === current) ? current : null;
      persistSelectedBook(next);
      return next;
    });
  }, []);

  const refreshWorkspace = useCallback(async (bookId: string, signal?: AbortSignal) => {
    const [nextWorkspace, nextMessages, nextWorker] = await Promise.all([
      fetchWorkspace(bookId, signal), fetchMessages(bookId, signal), fetchWorker(signal)
    ]);
    setWorkspace(nextWorkspace);
    setMessages(nextMessages);
    setWorker(nextWorker);
  }, []);

  const refreshHomeTasks = useCallback(async (signal?: AbortSignal) => {
    const taskCenter = await fetchTaskCenter(signal);
    if (signal?.aborted === true) return;
    setHomeTaskEntries(taskCenter.books);
    setHomeTasksError(null);
    setHomeTasksLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([fetchHealth(controller.signal), loadBooks(controller.signal), fetchWorker(controller.signal), fetchCapabilities(controller.signal)])
      .then(([nextHealth, , nextWorker, nextCapabilities]) => {
        setHealth(nextHealth);
        setWorker(nextWorker);
        setCapabilities(nextCapabilities);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法连接本地服务');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [loadBooks]);

  useEffect(() => {
    if (selectedBookId === null) {
      setWorkspace(null);
      setMessages([]);
      return;
    }
    const controller = new AbortController();
    void refreshWorkspace(selectedBookId, controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '工作区加载失败');
    });
    let refreshTimer: number | null = null;
    const unsubscribe = subscribeRuntimeEvents({ bookId: selectedBookId, onEvent: () => {
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => { refreshTimer = null; void refreshWorkspace(selectedBookId).catch(() => undefined); }, 80);
    }});
    const poll = window.setInterval(() => { void refreshWorkspace(selectedBookId).catch(() => undefined); }, 30_000);
    return () => {
      controller.abort(); unsubscribe();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.clearInterval(poll);
    };
  }, [refreshWorkspace, selectedBookId]);

  useEffect(() => {
    if (selectedBookId !== null || homeView !== 'team' || teamTemplate !== null) return;
    const controller = new AbortController();
    void fetchTeamTemplate(controller.signal).then(setTeamTemplate).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '团队模板加载失败');
    });
    return () => controller.abort();
  }, [homeView, selectedBookId, teamTemplate]);

  useEffect(() => {
    if (selectedBookId !== null || homeView !== 'tasks') return;
    const controller = new AbortController();
    setHomeTasksLoading(true);
    void refreshHomeTasks(controller.signal).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setHomeTasksError(reason instanceof Error ? reason.message : '任务中心加载失败');
        setHomeTasksLoading(false);
      }
    });
    let refreshTimer: number | null = null;
    const unsubscribe = subscribeRuntimeEvents({ onEvent: () => {
      if (refreshTimer !== null) return;
      refreshTimer = window.setTimeout(() => { refreshTimer = null; void refreshHomeTasks().catch(() => undefined); }, 80);
    }});
    const poll = window.setInterval(() => { void refreshHomeTasks().catch(() => undefined); }, 30_000);
    return () => {
      controller.abort(); unsubscribe();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.clearInterval(poll);
    };
  }, [homeView, refreshHomeTasks, selectedBookId]);

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
    if (creationTab !== 'manuscript' || workspace === null || workspace.chapters.length === 0) return;
    if (selectedChapterId !== null && selectedChapter?.chapterId === selectedChapterId) return;
    const firstChapter = [...workspace.chapters].sort((left, right) => left.chapterNumber - right.chapterNumber)[0];
    if (firstChapter === undefined) return;
    setSelectedChapterId(firstChapter.chapterId);
    setSelectedChapter(firstChapter);
  }, [creationTab, selectedChapterId, selectedChapter?.chapterId, workspace]);

  useEffect(() => {
    if (selectedBookId === null || workspace === null) return;
    if (creationTab === 'naming') { setReferenceData([]); return; }
    const cacheKey = `${creationTab}:${selectedBookId}`;
    const controller = new AbortController();
    const refreshReferenceData = async (useCacheFallback: boolean): Promise<void> => {
      const request = creationTab === 'library'
        ? fetchLibrary(selectedBookId, controller.signal)
        : creationTab === 'graph'
          ? fetchGraphWorkspace(selectedBookId, controller.signal)
          : fetchArtifacts(selectedBookId, controller.signal);
      try {
        const data = await request;
        if (controller.signal.aborted) return;
        setReferenceData(data);
        await cacheSnapshot(cacheKey, selectedBookId, workspace.book.canonRevision, data);
      } catch {
        if (!useCacheFallback || controller.signal.aborted) return;
        setReferenceData(await loadSnapshot<unknown>(cacheKey, workspace.book.canonRevision) ?? []);
      }
    };
    void refreshReferenceData(true);
    const poll = window.setInterval(() => void refreshReferenceData(false), 30_000);
    return () => { controller.abort(); window.clearInterval(poll); };
  }, [creationTab, selectedBookId, workspace?.book.canonRevision]);

  useEffect(() => {
    if (!settingsOpen || selectedBookId === null) {
      setModelBindings(null);
      setOperationsStatus(null);
      return;
    }
    const controller = new AbortController();
    void Promise.all([fetchModelBindings(selectedBookId, controller.signal), fetchOperationsStatus(controller.signal)]).then(([nextBindings, nextOperations]) => {
      setModelBindings(nextBindings); setOperationsStatus(nextOperations);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '模型绑定加载失败');
    });
    return () => controller.abort();
  }, [selectedBookId, settingsOpen]);

  const selectBook = (bookId: string): void => {
    setSelectedBookId(bookId);
    persistSelectedBook(bookId);
    setSelectedChapterId(null);
    setSelectedChapter(null);
    setSelectedTask(null);
    setLeftOpen(false);
  };

  const openHomeView = (nextHomeView: HomeView): void => {
    setSelectedBookId(null);
    persistSelectedBook(null);
    setWorkspace(null);
    setMessages([]);
    setSelectedChapterId(null);
    setSelectedChapter(null);
    setSelectedTask(null);
    setReaderMode(false);
    setHomeView(nextHomeView);
    setLeftOpen(false);
    setRightOpen(false);
  };

  const returnToShelf = (): void => {
    openHomeView('shelf');
  };

  const createNewBook = async (input: Parameters<typeof createBook>[0]): Promise<boolean> => {
    setBusy(true);
    try {
      const created = await createBook(input);
      await loadBooks();
      selectBook(created.bookId);
      if (input.openingBlueprint?.creationMode === 'continuation') {
        setCreationTab('manuscript');
          } else {
        setCreationTab('basic');
          }
      setCreateOpen(false);
      setError(null);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '建书失败');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const decideConfirmation = async (bookId: string, confirmationId: string, expectedCanonRevision: number, accept: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await resolveConfirmation(bookId, confirmationId, expectedCanonRevision, accept);
      await refreshHomeTasks();
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '确认操作失败');
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
      setError(reason instanceof Error ? reason.message : '任务取消失败');
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
      setError(reason instanceof Error ? reason.message : '任务重试失败');
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
      setBookMenuId(null);
      await loadBooks();
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '归档书籍失败');
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
      setError(reason instanceof Error ? reason.message : '恢复书籍失败');
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
        setMessages([]);
        setSelectedChapterId(null);
        setSelectedChapter(null);
        setSelectedTask(null);
      }
      setPurgeCandidate(null);
      setArchiveOpen(false);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '永久删除书籍失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`app-shell ${readerMode ? 'reader-mode' : ''} ${selectedBook === null ? 'home-mode' : ''}`}
      data-theme={preferences.theme}
      style={{ '--font-scale': String(FONT_SCALE[preferences.fontSize]) } as CSSProperties}
    >
      <header className="topbar">
        <div className="brand-lockup">
          <button className="icon-button mobile-only" type="button" aria-label="打开书籍" onClick={() => setLeftOpen(true)}><ListIcon /></button>
          <div className="brand-mark" aria-hidden="true">文</div>
          <div><h1>文秘写作</h1><span>本地小说工作台</span></div>
        </div>
        {selectedBook === null
          ? <div className="home-topbar-title">
              <strong>{homeView === 'shelf' ? '我的书架' : homeView === 'tasks' ? '任务中心' : '创作团队'}</strong>
              <span>{homeView === 'shelf' ? `${activeBooks.length} 本创作中的书` : homeView === 'tasks' ? `${homeTaskBookCount} 本书有后台任务` : '全局岗位模板'}</span>
            </div>
          : <TopbarBookSummary book={selectedBook} workspace={workspace} />}
        <div className="topbar-actions">
          <ServiceState health={health} worker={worker} error={error} />
          <button className="icon-button settings-button" type="button" aria-label="界面设置" onClick={() => setSettingsOpen(true)}><GearSixIcon /></button>
          {selectedBook !== null && (
            <button className="icon-button" type="button" aria-label={readerMode ? '退出沉浸阅读' : '进入沉浸阅读'} onClick={() => setReaderMode((value) => !value)}>
              {readerMode ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}
            </button>
          )}
          {selectedBook !== null && <button className="icon-button mobile-only" type="button" aria-label="打开创作团队" onClick={() => setRightOpen(true)}><UsersThreeIcon /></button>}
        </div>
      </header>

      <aside className={`left-rail ${leftOpen ? 'drawer-open' : ''}`} aria-label={selectedBook === null ? '首页功能' : '书籍'}>
        <DrawerHeader title="书籍" onClose={() => setLeftOpen(false)} />
        {selectedBook === null ? (
          <nav className="home-navigation" aria-label="首页功能">
            <RailViewButton active={homeView === 'shelf'} onClick={() => { setHomeView('shelf'); setLeftOpen(false); }} icon={<BooksIcon />} label="书架" />
            <RailViewButton active={homeView === 'tasks'} onClick={() => { setHomeView('tasks'); setLeftOpen(false); }} icon={<FileTextIcon />} label="任务" />
            <RailViewButton active={homeView === 'team'} onClick={() => { setHomeView('team'); setLeftOpen(false); }} icon={<UsersThreeIcon />} label="团队" />
            <button type="button" onClick={() => { setSettingsOpen(true); setLeftOpen(false); }}><GearSixIcon /><span>设置</span></button>
          </nav>
        ) : (
          <div className="rail-book-switcher" aria-label="书籍切换">
            <button className="back-to-shelf" type="button" onClick={returnToShelf}><BooksIcon /><span>返回书架</span></button>
            <button className="rail-new-book" type="button" onClick={() => { setCreateOpen(true); setLeftOpen(false); }}><PlusIcon /><span>新建书籍</span></button>
            <p>我的书籍</p>
            <nav aria-label="选择书籍">{activeBooks.map((book) => <button type="button" key={book.bookId}
              className={book.bookId === selectedBookId ? 'active' : ''} onClick={() => selectBook(book.bookId)}>
              <BookOpenTextIcon /><span><strong>{book.title}</strong><small>{book.bookId === selectedBookId ? '当前书籍' : bookStatusLabel(book.status)}</small></span>
            </button>)}</nav>
          </div>
        )}
      </aside>

      <main className="workspace-main">
        {error !== null && <div className="error-banner" role="alert"><span><strong>小文秘书：</strong>{error}</span><button type="button" onClick={() => setError(null)} aria-label="关闭错误"><XIcon /></button></div>}
        {loading ? <WorkspaceSkeleton /> : selectedBook === null ? (
          homeView === 'shelf'
            ? <BookshelfHome
                activeBooks={activeBooks}
                archivedBooks={archivedBooks}
                busy={busy}
                archiveOpen={archiveOpen}
                bookMenuId={bookMenuId}
                onCreate={() => setCreateOpen(true)}
                onOpen={selectBook}
                onToggleMenu={setBookMenuId}
                onArchive={setArchiveCandidate}
                onToggleArchive={() => setArchiveOpen((value) => !value)}
                onRestore={restoreArchivedBook}
                onPurge={setPurgeCandidate}
              />
            : homeView === 'tasks'
              ? <GlobalTaskWorkspace
                  entries={homeTaskEntries}
                  loading={homeTasksLoading}
                  loadError={homeTasksError}
                  busy={busy}
                  onSelect={(bookId, task) => setSelectedTask({ bookId, taskId: task.taskId })}
                  onDecide={decideConfirmation}
                />
            : teamBookId === null
              ? <TeamTemplateWorkspace data={teamTemplate} books={activeBooks} onManageBook={setTeamBookId} />
              : <section className="home-team-book-config">
                  <button className="secondary-button" type="button" onClick={() => setTeamBookId(null)}>返回团队模板</button>
                  <TeamWorkspace bookId={teamBookId} workspace={null} onError={setError} />
                </section>
        ) : (
          <>
            <PlanningWorkspace
              tab={creationTab}
              onTabChange={setCreationTab}
              data={referenceData}
              workspace={workspace}
              onBookProfileChanged={() => refreshWorkspace(selectedBook.bookId)}
              graph={<ProjectionWorkspace data={referenceData} />}
              library={<LibraryWorkspace data={referenceData} bookId={selectedBookId} />}
              naming={<NamingWorkspace book={selectedBook} />}
              manuscript={<ManuscriptWorkspace
                key={selectedBook.bookId}
                workspace={workspace}
                selectedChapterId={selectedChapterId}
                chapter={selectedWorkspaceChapter ?? selectedChapter}
                reader={reader}
                detail={chapterDetail}
                onSelectChapter={(chapter) => { setSelectedChapterId(chapter.chapterId); setSelectedChapter(chapter); }}
                onChanged={() => void refreshWorkspace(selectedBook.bookId)}
                onOpenPlanning={() => setCreationTab('basic')}
              />}
            />
          </>
        )}
      </main>

      {selectedBook !== null && <aside className={`right-rail ${rightOpen ? 'drawer-open' : ''}`} aria-label="创作团队">
          <DrawerHeader title="创作团队" onClose={() => setRightOpen(false)} />
          <TeamInspector workspace={workspace} worker={worker} onSelectAgent={(agent) => setSelectedAgentId(agent.agentId)} />
        </aside>}

      {(leftOpen || rightOpen) && <button className="drawer-scrim mobile-only" type="button" aria-label="关闭抽屉" onClick={() => { setLeftOpen(false); setRightOpen(false); }} />}
      {createOpen && <CompleteCreateBookDialog busy={busy} onCancel={() => setCreateOpen(false)} onCreate={createNewBook} />}
      {archiveCandidate !== null && <ArchiveBookDialog book={archiveCandidate} busy={busy} onCancel={() => setArchiveCandidate(null)} onConfirm={archiveSelectedBook} />}
      {purgeCandidate !== null && <PurgeBookDialog book={purgeCandidate} busy={busy} onCancel={() => setPurgeCandidate(null)} onConfirm={permanentlyDeleteArchivedBook} />}
      {settingsOpen && <SettingsDialog preferences={preferences} capabilities={capabilities} bookId={selectedBookId} bindings={modelBindings} operations={operationsStatus} onBindingsChanged={() => selectedBookId === null ? undefined : void fetchModelBindings(selectedBookId).then(setModelBindings)} onBooksChanged={() => void loadBooks()} onChange={setPreferences} onClose={() => setSettingsOpen(false)} />}
      {selectedTaskContext !== null && (
        <TaskDetailsDialog
          bookId={selectedTaskContext.bookId}
          task={selectedTaskContext.task}
          workspace={selectedTaskContext.workspace}
          busy={busy}
          onCancelTask={cancelSelectedTask}
          onRetryTask={retrySelectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
      {selectedAgentId !== null && workspace !== null && (() => {
        const agent = workspace.agents.find((item) => item.agentId === selectedAgentId);
        return agent === undefined ? null : <AgentDetailsDialog agent={agent} task={activeTaskForAgent(workspace, agent.agentId)} messages={messages} onClose={() => setSelectedAgentId(null)} />;
      })()}
    </div>
  );
}

function readSelectedBook(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('book');
  } catch {
    return null;
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
