import { useCallback, useEffect, useState, type CSSProperties } from 'react';
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

import {
  archiveBook,
  cancelTask,
  createBook,
  fetchArtifacts,
  fetchBooks,
  fetchCapabilities,
  fetchChapterContent,
  fetchChapterDetail,
  fetchHealth,
  fetchLibrary,
  fetchModelBindings,
  fetchOperationsStatus,
  fetchTaskCenter,
  fetchWorkspace,
  subscribeRuntimeEvents,
  resolveConfirmation,
  restoreBook,
  purgeBook,
  retryTask,
  type BookData,
  type CapabilityData,
  type ChapterData,
  type ModelBindingsData,
  type OperationsStatusData,
  type TaskCenterBookData,
  type WorkspaceData
} from '../lib/api/client';
import { cacheSnapshot, loadSnapshot } from '../lib/offline/offline-store';
import { NamingWorkspace } from '../features/naming/NamingWorkspace';
import { ArchiveBookDialog, PurgeBookDialog } from '../features/bookshelf/BookLifecycleDialogs';
import { bookStatusLabel } from './display-labels';
import { CompleteCreateBookDialog } from '../features/onboarding/CompleteCreateBookDialog';
import { PlanningWorkspace } from '../features/planning/PlanningWorkspace';
import { StoryKnowledgeWorkspace } from '../features/library/StoryKnowledgeWorkspace';
import { WorkspaceSkeleton } from '../features/shared/WorkspaceSkeleton';
import { GlobalTaskWorkspace, TaskDetailsDialog } from '../features/tasks/TaskWorkspace';
import { TeamWorkspace } from '../features/team/TeamWorkspace';
import { SettingsDialog } from '../features/settings/SettingsDialog';
import { ManuscriptWorkspace } from '../features/manuscript/ManuscriptWorkspace';
import { IdeationWorkspace } from '../features/ideation/IdeationWorkspace';
import {
  FONT_SCALE,
  readWorkspacePreferences,
  saveWorkspacePreferences,
  type WorkspacePreferences
} from './workspace-preferences';
import './app.css';

type UtilityView = 'tasks' | 'team' | 'ideas' | null;
type PlanningTab = 'framework' | 'basic' | 'master' | 'event' | 'chapter' | 'manuscript' | 'library' | 'naming';

interface TaskSelection {
  bookId: string;
  taskId: string;
}

export function App(): React.JSX.Element {
  const [capabilities, setCapabilities] = useState<CapabilityData | null>(null);
  const [books, setBooks] = useState<BookData[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(() => readSelectedBook());
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [creationTab, setCreationTab] = useState<PlanningTab>('framework');
  const [utilityView, setUtilityView] = useState<UtilityView>(null);
  const [homeTaskEntries, setHomeTaskEntries] = useState<TaskCenterBookData[]>([]);
  const [homeTasksLoading, setHomeTasksLoading] = useState(false);
  const [homeTasksError, setHomeTasksError] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<ChapterData | null>(null);
  const [reader, setReader] = useState<{ content: string; offline: boolean; manuscriptVersionId: string | null } | null>(null);
  const [chapterDetail, setChapterDetail] = useState<Awaited<ReturnType<typeof fetchChapterDetail>> | null>(null);
  const [referenceData, setReferenceData] = useState<unknown>([]);
  const [modelBindings, setModelBindings] = useState<ModelBindingsData | null>(null);
  const [operationsStatus, setOperationsStatus] = useState<OperationsStatusData | null>(null);
  const [leftOpen, setLeftOpen] = useState(false);
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
    Promise.all([fetchHealth(controller.signal), loadBooks(controller.signal), fetchCapabilities(controller.signal)])
      .then(([, , nextCapabilities]) => {
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
    if (utilityView !== 'tasks') return;
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
      className="app-shell unified-desk"
      data-theme={preferences.theme}
      style={{ '--font-scale': String(FONT_SCALE[preferences.fontSize]) } as CSSProperties}
    >
      <aside className={`left-rail ios-book-sidebar ${leftOpen ? 'drawer-open' : ''}`} aria-label="书籍栏">
        <div className="sidebar-brand">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">文</div>
            <div><h1>文秘写作</h1><span>本地小说工作台</span></div>
          </div>
          <button className="icon-button mobile-only" type="button" aria-label="关闭书籍栏" onClick={() => setLeftOpen(false)}><XIcon /></button>
        </div>
        <div className="rail-book-switcher unified-book-switcher" aria-label="书籍切换">
          <button className="rail-new-book" type="button" onClick={() => { setCreateOpen(true); setLeftOpen(false); }}><PlusIcon /><span>新建书籍</span></button>
          <div className="book-list-heading"><span>我的书籍</span><strong>{activeBooks.length}</strong></div>
          <nav aria-label="选择书籍">{activeBooks.map((book) => <button type="button" key={book.bookId}
            className={book.bookId === selectedBookId ? 'active' : ''} aria-current={book.bookId === selectedBookId ? 'page' : undefined}
            onClick={() => selectBook(book.bookId)}>
            <BookOpenTextIcon /><span><strong>{book.title}</strong><small>{book.bookId === selectedBookId ? '当前书籍' : bookStatusLabel(book.status)}</small></span>
          </button>)}</nav>
          <div className="sidebar-book-actions">
            {archivedBooks.length > 0 && <details className="rail-archived-books" open={archiveOpen} onToggle={(event) => setArchiveOpen(event.currentTarget.open)}>
              <summary>已归档书籍 · {archivedBooks.length}</summary>
              <div>{archivedBooks.map((book) => <article key={book.bookId}>
                <span><ArchiveBoxIcon /><strong>{book.title}</strong></span>
                <div><button type="button" disabled={busy} onClick={() => void restoreArchivedBook(book)}>恢复</button>
                  <button type="button" disabled={busy} onClick={() => setPurgeCandidate(book)}>彻底删除</button></div>
              </article>)}</div>
            </details>}
            {selectedBook !== null && <button className="archive-current-book" type="button" onClick={() => setArchiveCandidate(selectedBook)}><ArchiveBoxIcon /><span>归档当前书籍</span></button>}
          </div>
        </div>
      </aside>

      <header className="topbar ios-commandbar">
        <button className="icon-button mobile-only" type="button" aria-label="打开书籍栏" onClick={() => setLeftOpen(true)}><ListIcon /></button>
        <div className="topbar-current-object">
          <span>当前书籍</span>
          <strong>{selectedBook?.title ?? '还没有书籍'}</strong>
        </div>
        <div className="current-view-chip" aria-label={`当前功能：${utilityView === 'tasks' ? '任务' : utilityView === 'team' ? '团队' : utilityView === 'ideas' ? '灵感讨论' : sectionLabel(creationTab)}`}>
          <span aria-hidden="true" />
          {utilityView === 'tasks' ? '任务' : utilityView === 'team' ? '团队' : utilityView === 'ideas' ? '灵感讨论' : sectionLabel(creationTab)}
        </div>
      </header>

      <nav className="ios-function-bar" aria-label="功能栏">
        <div className="function-nav-primary">
          {([
            ['framework', '本书资料', BookOpenTextIcon],
            ['basic', '设定大纲', TreeStructureIcon],
            ['master', '当前卷纲', MapTrifoldIcon],
            ['event', '事件设计', CaretRightIcon],
            ['chapter', '章纲', ListIcon],
            ['manuscript', '正文', FileTextIcon],
            ['library', '故事资料库', BooksIcon],
            ['naming', '取名', TagIcon]
          ] as const).map(([key, label, Icon]) => <button type="button" className={utilityView === null && creationTab === key ? 'active' : ''}
            aria-current={utilityView === null && creationTab === key ? 'page' : undefined} aria-label={label} disabled={selectedBook === null}
            key={key} onClick={() => { setCreationTab(key); setUtilityView(null); }}><Icon /><span>{label}</span></button>)}
        </div>
        <div className="function-nav-utilities">
          <button className={utilityView === 'team' ? 'active' : ''} type="button" aria-current={utilityView === 'team' ? 'page' : undefined} disabled={selectedBook === null} onClick={() => setUtilityView('team')}><UsersThreeIcon /><span>团队</span></button>
          <button className={utilityView === 'tasks' ? 'active' : ''} type="button" aria-current={utilityView === 'tasks' ? 'page' : undefined} onClick={() => setUtilityView('tasks')}><FileTextIcon /><span>任务</span></button>
          <button className={utilityView === 'ideas' ? 'active' : ''} type="button" aria-current={utilityView === 'ideas' ? 'page' : undefined} disabled={selectedBook === null} onClick={() => setUtilityView('ideas')}><LightbulbIcon /><span>灵感讨论</span></button>
          <button type="button" onClick={() => setSettingsOpen(true)}><GearSixIcon /><span>设置</span></button>
        </div>
      </nav>

      <main className="workspace-main">
        {error !== null && <div className="error-banner" role="alert"><span><strong>小文秘书：</strong>{error}</span><button type="button" onClick={() => setError(null)} aria-label="关闭错误"><XIcon /></button></div>}
        {loading ? <WorkspaceSkeleton /> : utilityView === 'tasks' ? <GlobalTaskWorkspace
          entries={homeTaskEntries}
          loading={homeTasksLoading}
          loadError={homeTasksError}
          busy={busy}
          onSelect={(bookId, task) => setSelectedTask({ bookId, taskId: task.taskId })}
          onDecide={decideConfirmation}
        /> : utilityView === 'team' ? (selectedBook === null
          ? <UnifiedEmptyState title="先创建一本书" description="团队会随书创建，并固定显示全部11名创作成员。" onCreate={() => setCreateOpen(true)} />
          : <TeamWorkspace bookId={selectedBook.bookId} workspace={workspace} onError={setError} />)
        : utilityView === 'ideas' ? (selectedBook === null
          ? <UnifiedEmptyState title="先创建一本书" description="灵感讨论只读取当前书籍资料，不会混入其他书。" onCreate={() => setCreateOpen(true)} />
          : <IdeationWorkspace bookId={selectedBook.bookId} currentLocation={creationTab} onError={setError} />)
        : selectedBook === null ? <UnifiedEmptyState title="创建第一本书" description="填写开书资料后，会从设定、卷纲、事件、章纲到正文逐步推进。" onCreate={() => setCreateOpen(true)} />
        : (
          <>
            <PlanningWorkspace
              tab={creationTab}
              onTabChange={setCreationTab}
              data={referenceData}
              workspace={workspace}
              onBookProfileChanged={() => refreshWorkspace(selectedBook.bookId)}
              library={<StoryKnowledgeWorkspace bookId={selectedBook.bookId} />}
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

      {leftOpen && <button className="drawer-scrim mobile-only" type="button" aria-label="关闭抽屉" onClick={() => setLeftOpen(false)} />}
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
    </div>
  );
}

function UnifiedEmptyState({ title, description, onCreate }: { title: string; description: string; onCreate?: () => void }): React.JSX.Element {
  return <section className="unified-empty-state">
    <div className="brand-mark" aria-hidden="true">文</div>
    <span className="eyebrow">统一创作台</span>
    <h2>{title}</h2>
    <p>{description}</p>
    {onCreate !== undefined && <button className="primary-button" type="button" onClick={onCreate}><PlusIcon />新建书籍</button>}
  </section>;
}

function sectionLabel(tab: PlanningTab): string {
  return ({
    framework: '本书资料',
    basic: '设定大纲',
    master: '当前卷纲',
    event: '事件设计',
    chapter: '章纲',
    manuscript: '正文',
    library: '故事资料库',
    naming: '取名'
  } as const)[tab];
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
