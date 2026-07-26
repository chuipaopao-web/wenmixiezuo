import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArchiveBoxIcon,
  ArrowCounterClockwiseIcon,
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  BookOpenTextIcon,
  BooksIcon,
  BrainIcon,
  CaretRightIcon,
  ChatsCircleIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
  DatabaseIcon,
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
  PaperPlaneTiltIcon,
  PlusIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  UsersThreeIcon,
  WifiHighIcon,
  WifiSlashIcon,
  XIcon
} from '@phosphor-icons/react';
import {
  archiveBook,
  analyzeOpeningSynopsis,
  cancelTask,
  createBook,
  fetchArtifacts,
  fetchArtifactVersions,
  fetchBooks,
  fetchOpeningTaxonomy,
  fetchCapabilities,
  fetchChapterContent,
  fetchChapterDetail,
  fetchHealth,
  fetchGraphWorkspace,
  fetchLibrary,
  fetchMessages,
  fetchModelBindings,
  fetchVolumeChapters,
  fetchOperationsStatus,
  fetchProtagonists,
  fetchAttributeFormulas,
  fetchRightsWorkspace,
  fetchWorker,
  fetchWorkspace,
  sendMessage,
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
  uploadChatAttachment,
  discardChatAttachment,
  chatAttachmentContentUrl,
  compareArtifactVersions,
  createLibraryTag,
  saveOwnerManuscript,
  rewriteChapter,
  finalizeChapter,
  saveProtagonistProfile,
  appendProtagonistState,
  archiveProtagonistState,
  classifyProtagonistState,
  createAttributeFormula,
  evaluateAttributeFormula,
  type AgentData,
  type ArtifactVersionData,
  type BookData,
  type CapabilityData,
  type ChapterData,
  type ChapterPageData,
  type ChatAttachmentData,
  type CreativeSessionData,
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
  type OpeningSynopsisAnalysisData,
  type OpeningTaxonomyData,
  type ProtagonistRole,
  type TaskData,
  type TeamModelProfileData,
  type WorkerData,
  type WorkspaceData
} from '../lib/api/client';
import { cacheSnapshot, loadDraft, loadSnapshot, saveDraft } from '../lib/offline/offline-store';
import { avatarPosition } from './role-avatars';
import {
  authorFieldLabel,
  authorFormatScalar,
  authorRelationshipLabel,
  projectionForAuthor,
  structuredReplyFromMixedText,
  toAuthorDisplayValue
} from './author-presentation';
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  FONT_SCALE,
  readWorkspacePreferences,
  saveWorkspacePreferences,
  type WorkspacePreferences
} from './workspace-preferences';
import './app.css';

type WorkspaceView = 'chat' | 'tasks' | 'outline' | 'manuscript' | 'projections' | 'knowledge' | 'rights';

interface PendingChatAttachment {
  localId: string;
  fileName: string;
  status: 'uploading' | 'ready' | 'failed';
  data: ChatAttachmentData | null;
  error: string | null;
}

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityData | null>(null);
  const [worker, setWorker] = useState<WorkerData | null>(null);
  const [books, setBooks] = useState<BookData[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(() => readSelectedBook());
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [view, setView] = useState<WorkspaceView>('chat');
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<ChapterData | null>(null);
  const [reader, setReader] = useState<{ content: string; offline: boolean; manuscriptVersionId: string | null } | null>(null);
  const [chapterDetail, setChapterDetail] = useState<Awaited<ReturnType<typeof fetchChapterDetail>> | null>(null);
  const [referenceData, setReferenceData] = useState<unknown>([]);
  const [modelBindings, setModelBindings] = useState<ModelBindingsData | null>(null);
  const [operationsStatus, setOperationsStatus] = useState<OperationsStatusData | null>(null);
  const [composer, setComposer] = useState('');
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [readerMode, setReaderMode] = useState(false);
  const [createOpen, setCreateOpen] = useState(() => new URLSearchParams(window.location.search).get('newBook') === '1');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [bookMenuId, setBookMenuId] = useState<string | null>(null);
  const [archiveCandidate, setArchiveCandidate] = useState<BookData | null>(null);
  const [purgeCandidate, setPurgeCandidate] = useState<BookData | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<WorkspacePreferences>(() => readWorkspacePreferences());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeBooks = books.filter((book) => book.status !== 'archived');
  const archivedBooks = books.filter((book) => book.status === 'archived');
  const selectedBook = activeBooks.find((book) => book.bookId === selectedBookId) ?? null;
  const selectedTask = workspace?.tasks.find((task) => task.taskId === selectedTaskId) ?? null;
  const selectedWorkspaceChapter = workspace?.chapters.find((chapter) => chapter.chapterId === selectedChapterId) ?? null;

  const loadBooks = useCallback(async (signal?: AbortSignal) => {
    const nextBooks = await fetchBooks(signal);
    setBooks(nextBooks);
    setSelectedBookId((current) => {
      const nextActiveBooks = nextBooks.filter((book) => book.status !== 'archived');
      const next = current !== null && nextActiveBooks.some((book) => book.bookId === current) ? current : nextActiveBooks[0]?.bookId ?? null;
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
    const poll = window.setInterval(() => {
      void refreshWorkspace(selectedBookId).catch(() => undefined);
    }, 5_000);
    return () => {
      controller.abort();
      window.clearInterval(poll);
    };
  }, [refreshWorkspace, selectedBookId]);

  useEffect(() => {
    setPendingAttachments([]);
    if (selectedBookId === null) {
      setComposer('');
      return;
    }
    let active = true;
    void loadDraft(selectedBookId).then((draft) => {
      if (active) setComposer(draft);
    });
    return () => { active = false; };
  }, [selectedBookId]);

  useEffect(() => {
    if (selectedBookId === null) return;
    const timeout = window.setTimeout(() => void saveDraft(selectedBookId, composer), 250);
    return () => window.clearTimeout(timeout);
  }, [composer, selectedBookId]);

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
    if (view !== 'manuscript' || workspace === null || workspace.chapters.length === 0) return;
    if (selectedChapterId !== null && selectedChapter?.chapterId === selectedChapterId) return;
    const firstChapter = [...workspace.chapters].sort((left, right) => left.chapterNumber - right.chapterNumber)[0];
    if (firstChapter === undefined) return;
    setSelectedChapterId(firstChapter.chapterId);
    setSelectedChapter(firstChapter);
  }, [selectedChapterId, selectedChapter?.chapterId, view, workspace]);

  useEffect(() => {
    if (selectedBookId === null || workspace === null || !['outline', 'knowledge', 'projections', 'rights'].includes(view)) return;
    const cacheKey = `${view}:${selectedBookId}`;
    const controller = new AbortController();
    const request = view === 'outline'
      ? fetchArtifacts(selectedBookId, controller.signal)
      : view === 'knowledge'
        ? fetchLibrary(selectedBookId, controller.signal)
        : view === 'projections'
          ? fetchGraphWorkspace(selectedBookId, controller.signal)
          : fetchRightsWorkspace(selectedBookId, controller.signal);
    void request.then(async (data) => {
      setReferenceData(data);
      await cacheSnapshot(cacheKey, selectedBookId, workspace.book.canonRevision, data);
    }).catch(async () => {
      setReferenceData(await loadSnapshot<unknown[]>(cacheKey, workspace.book.canonRevision) ?? []);
    });
    return () => controller.abort();
  }, [selectedBookId, view, workspace?.book.canonRevision]);

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
    if (bookId !== selectedBookId && pendingAttachments.length > 0) {
      setError('切换书籍前请先发送或移除当前附件，避免留下未引用资料。');
      return;
    }
    setSelectedBookId(bookId);
    persistSelectedBook(bookId);
    setSelectedChapterId(null);
    setSelectedChapter(null);
    setSelectedTaskId(null);
    setView('chat');
    setLeftOpen(false);
  };

  const submitMessage = async (overrideContent?: string): Promise<void> => {
    const isQuickAction = overrideContent !== undefined;
    const readyAttachments = isQuickAction
      ? []
      : pendingAttachments.filter((item) => item.status === 'ready' && item.data !== null);
    const outgoingContent = overrideContent ?? composer;
    if (selectedBookId === null || (outgoingContent.trim().length === 0 && readyAttachments.length === 0) || busy) return;
    const switchMatch = /^(?:切书|切换到)\s*[《「]?(.+?)[》」]?$/u.exec(outgoingContent.trim());
    if (switchMatch !== null) {
      if (pendingAttachments.length > 0) {
        setError('切换书籍前请先发送或移除当前附件，避免资料进入错误书籍。');
        return;
      }
      const target = books.find((book) => book.title === switchMatch[1]!.trim());
      if (target === undefined) {
        setError(`没有找到书籍“${switchMatch[1]!.trim()}”`);
        return;
      }
      setComposer('');
      await saveDraft(selectedBookId, '');
      selectBook(target.bookId);
      return;
    }
    setBusy(true);
    try {
      const sent = await sendMessage(selectedBookId, outgoingContent, readyAttachments.map((item) => item.data!.attachmentId));
      if (sent.action.kind === 'task_overview') setView('tasks');
      if (sent.action.kind === 'knowledge_workspace_opened') setView('knowledge');
      if (!isQuickAction) {
        setComposer('');
        setPendingAttachments([]);
        await saveDraft(selectedBookId, '');
      }
      await refreshWorkspace(selectedBookId);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '消息发送失败');
    } finally {
      setBusy(false);
    }
  };

  const createNewBook = async (input: Parameters<typeof createBook>[0]): Promise<void> => {
    if (pendingAttachments.length > 0) {
      setError('创建并切换新书前请先发送或移除当前附件。');
      return;
    }
    setBusy(true);
    try {
      const created = await createBook(input);
      await loadBooks();
      selectBook(created.bookId);
      setCreateOpen(false);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '建书失败');
    } finally {
      setBusy(false);
    }
  };

  const decideConfirmation = async (confirmationId: string, expectedCanonRevision: number, accept: boolean): Promise<void> => {
    if (selectedBookId === null || busy) return;
    setBusy(true);
    try {
      await resolveConfirmation(selectedBookId, confirmationId, expectedCanonRevision, accept);
      await refreshWorkspace(selectedBookId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '确认操作失败');
    } finally {
      setBusy(false);
    }
  };

  const cancelSelectedTask = async (taskId: string): Promise<void> => {
    if (selectedBookId === null || busy) return;
    setBusy(true);
    try {
      await cancelTask(selectedBookId, taskId);
      await refreshWorkspace(selectedBookId);
      setSelectedTaskId(null);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '任务取消失败');
    } finally {
      setBusy(false);
    }
  };

  const archiveSelectedBook = async (): Promise<void> => {
    if (archiveCandidate === null || busy) return;
    if (pendingAttachments.length > 0) {
      setError('归档当前书籍前请先发送或移除待发附件。');
      return;
    }
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
    if (pendingAttachments.length > 0) {
      setError('恢复并切换书籍前请先发送或移除当前附件。');
      return;
    }
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

  const uploadSelectedFiles = async (files: File[]): Promise<void> => {
    if (selectedBookId === null || files.length === 0) return;
    const slots = Math.max(0, 6 - pendingAttachments.length);
    const selected = files.slice(0, slots);
    if (selected.length < files.length) setError('每条消息最多附加6个文件。');
    const bookId = selectedBookId;
    for (const file of selected) {
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setPendingAttachments((current) => [...current, {
        localId, fileName: file.name, status: 'uploading', data: null, error: null
      }]);
      void uploadChatAttachment(bookId, file).then((data) => {
        setPendingAttachments((current) => current.map((item) => item.localId === localId
          ? { ...item, status: 'ready', data, error: data.parseError }
          : item));
      }).catch((reason: unknown) => {
        setPendingAttachments((current) => current.map((item) => item.localId === localId
          ? { ...item, status: 'failed', error: reason instanceof Error ? reason.message : '附件上传失败' }
          : item));
      });
    }
  };

  const removePendingAttachment = (attachment: PendingChatAttachment): void => {
    setPendingAttachments((current) => current.filter((item) => item.localId !== attachment.localId));
    if (selectedBookId !== null && attachment.data !== null) {
      void discardChatAttachment(selectedBookId, attachment.data.attachmentId).catch(() => undefined);
    }
  };

  const permanentlyDeleteArchivedBook = async (confirmationText: string): Promise<void> => {
    if (purgeCandidate === null || busy) return;
    setBusy(true);
    try {
      await purgeBook(purgeCandidate.bookId, confirmationText);
      setPurgeCandidate(null);
      await loadBooks();
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '永久删除书籍失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`app-shell ${readerMode ? 'reader-mode' : ''}`}
      data-theme={preferences.theme}
      style={{ '--font-scale': String(FONT_SCALE[preferences.fontSize]) } as CSSProperties}
    >
      <header className="topbar">
        <div className="brand-lockup">
          <button className="icon-button mobile-only" type="button" aria-label="打开书籍与功能" onClick={() => setLeftOpen(true)}><ListIcon /></button>
          <div className="brand-mark" aria-hidden="true">文</div>
          <div><h1>文秘写作</h1><span>本地小说工作台</span></div>
        </div>
        <TopbarBookSummary book={selectedBook} workspace={workspace} />
        <div className="topbar-actions">
          <ServiceState health={health} worker={worker} error={error} />
          <button className="icon-button settings-button" type="button" aria-label="界面设置" onClick={() => setSettingsOpen(true)}><GearSixIcon /></button>
          {selectedBook !== null && (
            <button className="icon-button" type="button" aria-label={readerMode ? '退出沉浸阅读' : '进入沉浸阅读'} onClick={() => setReaderMode((value) => !value)}>
              {readerMode ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}
            </button>
          )}
          <button className="icon-button mobile-only" type="button" aria-label="打开创作团队" onClick={() => setRightOpen(true)}><UsersThreeIcon /></button>
        </div>
      </header>

      <aside className={`left-rail ${leftOpen ? 'drawer-open' : ''}`} aria-label="书籍与功能">
        <DrawerHeader title="书籍与功能" onClose={() => setLeftOpen(false)} />
        <div className="rail-heading"><span>我的书</span><button className="small-icon-button" type="button" aria-label="创建新书" onClick={() => setCreateOpen(true)}><PlusIcon /></button></div>
        <nav className="book-switcher" aria-label="书籍列表">
          {activeBooks.map((book) => (
            <div className="book-row" key={book.bookId}>
              <button aria-label={`打开《${book.title}》`} className={book.bookId === selectedBookId ? 'book-button active' : 'book-button'} type="button" onClick={() => selectBook(book.bookId)}>
                <BooksIcon /><span><strong>{book.title}</strong><small>{bookStatusLabel(book.status)}</small></span><CaretRightIcon />
              </button>
              <button className="book-menu-button" type="button" aria-label={`管理《${book.title}》`} aria-expanded={bookMenuId === book.bookId} onClick={() => setBookMenuId((current) => current === book.bookId ? null : book.bookId)}><DotsThreeVerticalIcon /></button>
              {bookMenuId === book.bookId && (
                <div className="book-action-popover">
                  <button type="button" onClick={() => setArchiveCandidate(book)}><ArchiveBoxIcon />移到归档</button>
                  <small>从主书架收起，可以恢复</small>
                </div>
              )}
            </div>
          ))}
          {!loading && activeBooks.length === 0 && <p className="rail-empty">主书架还没有书。创建新书或从归档区恢复。</p>}
          {archivedBooks.length > 0 && (
            <div className="archive-shelf">
              <button className="archive-shelf-toggle" type="button" aria-expanded={archiveOpen} aria-label={`查看已归档书籍，共 ${archivedBooks.length} 本`} onClick={() => setArchiveOpen((value) => !value)}>
                <ArchiveBoxIcon /><span>已归档</span><small>{archivedBooks.length}</small><CaretRightIcon />
              </button>
              {archiveOpen && <div className="archived-book-list">{archivedBooks.map((book) => (
                <div className="archived-book-row" key={book.bookId}>
                  <span><strong>{book.title}</strong><small>不参与当前创作</small></span>
                  <div className="archived-book-actions">
                    <button type="button" disabled={busy} aria-label={`恢复《${book.title}》`} onClick={() => void restoreArchivedBook(book)}><ArrowCounterClockwiseIcon /></button>
                    <button className="danger-icon-button" type="button" disabled={busy} aria-label={`彻底删除《${book.title}》`} onClick={() => setPurgeCandidate(book)}><TrashIcon /></button>
                  </div>
                </div>
              ))}</div>}
            </div>
          )}
        </nav>
        {selectedBook !== null && (
          <nav className="rail-navigation" aria-label="创作功能">
            <RailViewButton active={view === 'chat'} onClick={() => { setView('chat'); setLeftOpen(false); }} icon={<ChatsCircleIcon />} label="对话" />
            <RailViewButton active={view === 'outline'} onClick={() => { setView('outline'); setLeftOpen(false); }} icon={<FileTextIcon />} label="规划" />
            <RailViewButton active={view === 'manuscript'} onClick={() => { setView('manuscript'); setLeftOpen(false); }} icon={<BookOpenTextIcon />} label="正文" />
            <RailViewButton active={view === 'projections'} onClick={() => { setView('projections'); setLeftOpen(false); }} icon={<DatabaseIcon />} label="图谱" />
            <RailViewButton active={view === 'knowledge'} onClick={() => { setView('knowledge'); setLeftOpen(false); }} icon={<BrainIcon />} label="资料库" />
            <RailViewButton active={view === 'rights'} onClick={() => { setView('rights'); setLeftOpen(false); }} icon={<ShieldCheckIcon />} label="版权" accessibleLabel="版权与研究" />
            <RailViewButton active={view === 'tasks'} onClick={() => { setView('tasks'); setLeftOpen(false); }} icon={<FileTextIcon />} label="任务" />
          </nav>
        )}
      </aside>

      <main className="workspace-main">
        {error !== null && <div className="error-banner" role="alert"><span><strong>小文秘书：</strong>{error}</span><button type="button" onClick={() => setError(null)} aria-label="关闭错误"><XIcon /></button></div>}
        {loading ? <WorkspaceSkeleton /> : selectedBook === null ? <EmptyLibrary onCreate={() => setCreateOpen(true)} /> : (
          <>
            {view === 'chat' && (
              <ChatWorkspace
                bookId={selectedBook.bookId}
                messages={messages}
                agents={workspace?.agents ?? []}
                totalMessageCount={workspace?.messageCount ?? messages.length}
                creativeSession={workspace?.creativeSession ?? null}
                busy={busy}
                composer={composer}
                setComposer={setComposer}
                pendingAttachments={pendingAttachments}
                onFilesSelected={uploadSelectedFiles}
                onRemoveAttachment={removePendingAttachment}
                onSubmit={submitMessage}
                onQuickAction={(content) => submitMessage(content)}
              />
            )}
            {view === 'tasks' && (
              <TaskWorkspace workspace={workspace} busy={busy} onSelect={(task) => setSelectedTaskId(task.taskId)} onDecide={decideConfirmation} />
            )}
            {view === 'manuscript' && (
              <ManuscriptWorkspace
                key={selectedBook.bookId}
                workspace={workspace}
                selectedChapterId={selectedChapterId}
                chapter={selectedWorkspaceChapter ?? selectedChapter}
                reader={reader}
                detail={chapterDetail}
                onSelectChapter={(chapter) => { setSelectedChapterId(chapter.chapterId); setSelectedChapter(chapter); }}
                onChanged={() => void refreshWorkspace(selectedBook.bookId)}
              />
            )}
            {view === 'outline' && <PlanningWorkspace data={referenceData} workspace={workspace} />}
            {view === 'knowledge' && <LibraryWorkspace data={referenceData} bookId={selectedBookId} />}
            {view === 'projections' && <ProjectionWorkspace data={referenceData} />}
            {view === 'rights' && <RightsWorkspace data={referenceData} />}
          </>
        )}
      </main>

      <aside className={`right-rail ${rightOpen ? 'drawer-open' : ''}`} aria-label="创作团队">
        <DrawerHeader title="创作团队" onClose={() => setRightOpen(false)} />
        <TeamInspector workspace={workspace} worker={worker} onSelectAgent={(agent) => setSelectedAgentId(agent.agentId)} />
      </aside>

      {(leftOpen || rightOpen) && <button className="drawer-scrim mobile-only" type="button" aria-label="关闭抽屉" onClick={() => { setLeftOpen(false); setRightOpen(false); }} />}
      {createOpen && <CompleteCreateBookDialog busy={busy} onCancel={() => setCreateOpen(false)} onCreate={createNewBook} />}
      {archiveCandidate !== null && <ArchiveBookDialog book={archiveCandidate} busy={busy} onCancel={() => setArchiveCandidate(null)} onConfirm={archiveSelectedBook} />}
      {purgeCandidate !== null && <PurgeBookDialog book={purgeCandidate} busy={busy} onCancel={() => setPurgeCandidate(null)} onConfirm={permanentlyDeleteArchivedBook} />}
      {settingsOpen && <SettingsDialog preferences={preferences} capabilities={capabilities} bookId={selectedBookId} bindings={modelBindings} operations={operationsStatus} onBindingsChanged={() => selectedBookId === null ? undefined : void fetchModelBindings(selectedBookId).then(setModelBindings)} onBooksChanged={() => void loadBooks()} onChange={setPreferences} onClose={() => setSettingsOpen(false)} />}
      {selectedTask !== null && workspace !== null && (
        <TaskDetailsDialog task={selectedTask} workspace={workspace} busy={busy} onCancelTask={cancelSelectedTask} onClose={() => setSelectedTaskId(null)} />
      )}
      {selectedAgentId !== null && workspace !== null && (() => {
        const agent = workspace.agents.find((item) => item.agentId === selectedAgentId);
        return agent === undefined ? null : <AgentDetailsDialog agent={agent} task={activeTaskForAgent(workspace, agent.agentId)} messages={messages} onClose={() => setSelectedAgentId(null)} />;
      })()}
    </div>
  );
}

function ServiceState({ health, worker, error }: { health: HealthData | null; worker: WorkerData | null; error: string | null }): React.JSX.Element {
  const ready = health?.status === 'ok' && worker?.status === 'ready' && error === null;
  return <div className={ready ? 'service-state ready' : 'service-state'} role="status" aria-live="polite">{ready ? <WifiHighIcon /> : <WifiSlashIcon />}<span>{ready ? '本地服务已就绪' : error === null ? '正在连接' : '服务不可用'}</span></div>;
}

function TopbarBookSummary({ book, workspace }: { book: BookData | null; workspace: WorkspaceData | null }): React.JSX.Element {
  if (book === null) {
    return <div className="topbar-book-summary empty" aria-label="当前书籍"><span>请选择一本书</span></div>;
  }
  const volumeCount = workspace?.volumes?.length ?? 0;
  const chapterCount = volumeCount > 0
    ? workspace?.volumes?.reduce((total, volume) => total + volume.chapterCount, 0) ?? 0
    : workspace?.chapters.length ?? 0;
  return (
    <div className="topbar-book-summary" aria-label={`当前书籍：《${book.title}》`}>
      <div className="topbar-book-title"><BooksIcon /><strong>{book.title}</strong></div>
      <div className="topbar-book-meta" aria-label="书籍进度">
        <span>{bookStatusLabel(book.status)}</span>
        <span>{volumeCount} 卷</span>
        <span>{chapterCount} 章</span>
        <span>正史修订 {book.canonRevision}</span>
      </div>
    </div>
  );
}

function DrawerHeader({ title, onClose }: { title: string; onClose: () => void }): React.JSX.Element {
  return <div className="drawer-header mobile-only"><strong>{title}</strong><button className="icon-button" type="button" aria-label={`关闭${title}`} onClick={onClose}><XIcon /></button></div>;
}

function RailViewButton({ active, onClick, icon, label, accessibleLabel }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; accessibleLabel?: string;
}): React.JSX.Element {
  return <button className={active ? 'active' : ''} type="button" aria-current={active ? 'page' : undefined} aria-label={accessibleLabel} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function ChatWorkspace(props: {
  bookId: string;
  messages: MessageData[];
  agents: AgentData[];
  totalMessageCount: number;
  creativeSession: CreativeSessionData | null;
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
  return (
    <section className="chat-workspace" aria-label="主创作对话">
      {props.creativeSession !== null && (
        <CreativeSessionStrip
          session={props.creativeSession}
          busy={props.busy}
          onQuickAction={props.onQuickAction}
        />
      )}
      <div className="conversation-stream" aria-live="polite">
        {props.messages.length === 0 ? (
          <div className="conversation-empty">
            <ChatsCircleIcon />
            <h2>从故事想法开始聊</h2>
            <p>自由说出人物、冲突或你拿不准的剧情。小文秘书会保留原话，剧情问题由主编主持两名异模型编剧讨论；规划齐备后再逐章创作。</p>
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
          <textarea id="boss-message" value={props.composer} onChange={(event) => props.setComposer(event.target.value)} placeholder="例如：我想先讨论主角、核心冲突和第一章开局" rows={3} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void props.onSubmit(); }} />
          <button className="send-button" type="button" disabled={!canSend} onClick={() => void props.onSubmit()}><PaperPlaneTiltIcon />发送</button>
        </div>
      </div>
    </section>
  );
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
        <div className="forecast-branch-list" aria-label="候选剧情方向">
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
  if (message.sender_type !== 'system') return message.content;
  const content = message.content.trim();
  if (content.startsWith('消息已保存。当前使用确定性离线适配器')) {
    return '您的消息我已经收好。现在可以直接聊天、讨论剧情、点名成员，也可以查看任务和资料；需要创作判断时，我会安排对应成员回复。';
  }
  if (content === '明确控制命令已执行。') return '这条请求已经处理好了；如果还需要下一步，直接告诉我。';
  if (content === '内部错误') return '这次没有顺利完成，请稍后再试。问题已经留下本地追踪信息，方便继续排查。';
  return message.content;
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

function ManuscriptWorkspace({ workspace, selectedChapterId, chapter, reader, detail, onSelectChapter, onChanged }: {
  workspace: WorkspaceData | null;
  selectedChapterId: string | null;
  chapter: ChapterData | null;
  reader: { content: string; offline: boolean; manuscriptVersionId: string | null } | null;
  detail: Awaited<ReturnType<typeof fetchChapterDetail>> | null;
  onSelectChapter: (chapter: ChapterData) => void;
  onChanged: () => void;
}): React.JSX.Element {
  if (workspace === null) return <div className="text-skeleton" aria-label="正在加载章节列表" />;
  return <section className="manuscript-workspace">
    <aside className="manuscript-workspace-sidebar"><ManuscriptChapterBrowser workspace={workspace} selectedChapterId={selectedChapterId} onSelect={onSelectChapter} /></aside>
    <div className="manuscript-workspace-editor">{chapter === null
      ? <EmptyReference icon={<BookOpenTextIcon />} title="选择一章正文" description="左侧章节列表是正文的唯一目录；选中章节后可阅读或修改未定稿版本。" />
      : <ManuscriptView bookId={workspace.book.bookId} chapter={chapter} reader={reader} detail={detail} onChanged={onChanged} />}
    </div>
  </section>;
}

function ManuscriptView({ bookId, chapter, reader, detail, onChanged }: {
  bookId: string;
  chapter: ChapterData;
  reader: { content: string; offline: boolean; manuscriptVersionId: string | null } | null;
  detail: Awaited<ReturnType<typeof fetchChapterDetail>> | null;
  onChanged: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const [baselineContent, setBaselineContent] = useState('');
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [rewriteInstruction, setRewriteInstruction] = useState('保留已确认事实和人物声音，重新组织本章正文。');
  const [busyAction, setBusyAction] = useState<'save' | 'rewrite' | 'finalize' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    setDraft(reader?.content ?? '');
    setBaselineContent(reader?.content ?? '');
    setBaseVersionId(reader?.manuscriptVersionId ?? chapter.currentManuscriptVersionId ?? chapter.canonManuscriptVersionId);
    setNotice(null);
    setRewriteOpen(false);
  }, [chapter.chapterId, chapter.currentManuscriptVersionId, chapter.canonManuscriptVersionId, reader?.content, reader?.manuscriptVersionId]);
  const settled = chapter.settlementStatus === 'settled';
  const editable = !settled && reader !== null && !reader.offline;
  const hasVersion = baseVersionId !== null;
  const changed = reader !== null && draft !== baselineContent;
  const perform = async (kind: 'save' | 'rewrite' | 'finalize'): Promise<void> => {
    const actionVersionId = baseVersionId;
    if (busyAction !== null || (kind !== 'save' && actionVersionId === null)) return;
    setBusyAction(kind); setNotice(null);
    try {
      if (kind === 'save') {
        const result = await saveOwnerManuscript(bookId, chapter.chapterId, { baseManuscriptVersionId: baseVersionId, content: draft, note: '作者在正文工作台修改' });
        setBaseVersionId(result.manuscriptVersionId);
        setBaselineContent(draft);
        setNotice(result.unchanged ? '正文没有变化。' : '修改已保存为新的不可变草稿版本，旧版本仍可追溯。');
      } else if (kind === 'rewrite') {
        if (actionVersionId === null) return;
        const result = await rewriteChapter(bookId, chapter.chapterId, actionVersionId, rewriteInstruction.trim());
        setRewriteOpen(false);
        setNotice(`重写任务已进入队列（${shortId(result.taskId)}），完成后会生成新草稿，不覆盖当前版本。`);
      } else {
        if (actionVersionId === null) return;
        const result = await finalizeChapter(bookId, chapter.chapterId, actionVersionId);
        setNotice(result.confirmationId === undefined
          ? `定稿审校任务已进入队列（${shortId(result.taskId)}）。通过三席点评后仍需你确认，才会进入正史。`
          : '本章已完成审校，正在等待你的最终确认。');
      }
      onChanged();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '这次操作没有完成，请稍后重试。');
    } finally {
      setBusyAction(null);
    }
  };
  return (
    <article className="manuscript-view">
      <header><span>第 {chapter.chapterNumber} 章</span><h2>{chapter.title}</h2><div>{settled ? <><CheckCircleIcon />正史已定稿</> : <><ClockCountdownIcon />{chapterStatus(chapter)}</>}</div></header>
      {reader === null ? <div className="text-skeleton" aria-label="正在加载正文" /> : <>
        <p className="offline-note">{reader.offline ? <><WifiSlashIcon />离线缓存，只读</> : settled ? <><WifiHighIcon />已确认正史正文，只读</> : <><WifiHighIcon />当前草稿，可修改</>}</p>
        {settled ? <div className="novel-text">{reader.content}</div> : <textarea className="manuscript-editor-textarea" aria-label="正文编辑器" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} disabled={!editable || busyAction !== null} />}
        {!settled && <div className="manuscript-actions">
          <button className="secondary-button" type="button" disabled={!editable || !changed || draft.trim().length === 0 || busyAction !== null} onClick={() => void perform('save')}>{busyAction === 'save' ? '保存中…' : hasVersion ? '保存修改' : '保存草稿'}</button>
          <button className="secondary-button" type="button" title={!hasVersion ? '先保存第一份正文草稿' : changed ? '请先保存当前修改' : '创建真实主笔重写任务'} disabled={!editable || !hasVersion || changed || busyAction !== null} onClick={() => setRewriteOpen((value) => !value)}>重写</button>
          <button className="primary-button" type="button" title={!hasVersion ? '先保存第一份正文草稿' : changed ? '请先保存当前修改' : '提交硬检查、三席点评和老板确认'} disabled={!editable || !hasVersion || changed || busyAction !== null} onClick={() => void perform('finalize')}>{busyAction === 'finalize' ? '提交中…' : '定稿'}</button>
        </div>}
        {rewriteOpen && <div className="rewrite-panel"><label>重写要求<textarea rows={3} value={rewriteInstruction} onChange={(event) => setRewriteInstruction(event.target.value)} /></label><div><button className="secondary-button" type="button" onClick={() => setRewriteOpen(false)}>取消</button><button className="primary-button" type="button" disabled={!rewriteInstruction.trim() || busyAction !== null} onClick={() => void perform('rewrite')}>{busyAction === 'rewrite' ? '已提交…' : '开始重写'}</button></div></div>}
        {!settled && <p className="manuscript-unsaved">{!hasVersion
          ? '先输入或粘贴正文并保存第一稿，保存后才能重写或提交定稿审校。'
          : changed
            ? '正文有未保存修改。保存后才能重写或提交定稿审校。'
            : '当前草稿已保存。重写会创建主笔任务，定稿会进入完整审校和老板确认。'}</p>}
        {notice !== null && <p className="binding-status" role="status">{notice}</p>}
      </>}
      {detail !== null && <ChapterProductionEvidence detail={detail} />}
    </article>
  );
}

function ChapterProductionEvidence({ detail }: { detail: Awaited<ReturnType<typeof fetchChapterDetail>> }): React.JSX.Element {
  const order = detail.production.writingOrders[0];
  const reports = detail.production.reviewReports.map((row) => ({ row, report: parseRecordJson(row.report_json) })).filter((item) => item.report !== null) as Array<{ row: Record<string, unknown>; report: Record<string, unknown> }>;
  if (order === undefined && reports.length === 0) return <section className="production-evidence empty"><h3>生产证据</h3><p>本章尚未形成正式工单和三席点评。</p></section>;
  return <section className="production-evidence"><header><h3>工单与三席点评</h3><p>点评针对同一不可变正文版本；AI腔是可定位文风风险，不是AI作者概率。政治与情色项是内容筛查，不是法律或平台保证。</p></header>
    {order !== undefined && <article className="writing-order-card"><span>写作工单</span><strong>{String(order.objective ?? '本章正式写作目标')}</strong><small>版本 {String(order.version ?? 1)}，依据正史版本 {String(order.canon_revision ?? 0)}，状态 {authorityLabel(String(order.status ?? 'active'))}</small></article>}
    <div className="review-evidence-grid">{reports.map(({ row, report }) => {
      const aiStyle = isRecord(report.aiStyle) ? report.aiStyle : null;
      const political = isRecord(report.politicalRisk) ? report.politicalRisk : null;
      const sexual = isRecord(report.sexualContentRisk) ? report.sexualContentRisk : null;
      return <article key={String(row.review_report_id)}><header><span>{reviewerRoleLabel(String(row.reviewer_role))}</span><em>{authorityLabel(String(row.status ?? 'completed'))}</em></header><h4>{String(report.summary ?? '已完成结构化点评')}</h4><dl><div><dt>结论</dt><dd>{reviewVerdictLabel(String(report.verdict ?? 'pass'))}</dd></div>{aiStyle !== null && <><div><dt>AI腔风险</dt><dd>{String(aiStyle.riskScore ?? 0)}/100</dd></div><div><dt>证据段落</dt><dd>{String(aiStyle.flaggedParagraphCount ?? 0)}/{String(aiStyle.totalParagraphCount ?? 0)}（{formatPercent(Number(aiStyle.flaggedParagraphRatio ?? 0))}）</dd></div></>}{political !== null && <div><dt>政治风险</dt><dd>{riskLevelLabel(String(political.level ?? 'none'))}</dd></div>}{sexual !== null && <div><dt>情色风险</dt><dd>{riskLevelLabel(String(sexual.level ?? 'none'))}</dd></div>}</dl>{Array.isArray(report.issues) && report.issues.length > 0 && <details><summary>查看定位问题 {report.issues.length}</summary><StructuredContent value={report.issues} /></details>}</article>;
    })}</div>
  </section>;
}

type PlanningTab = 'framework' | 'basic' | 'master' | 'volume' | 'chapter';
type ArtifactProjection = 'complete' | 'framework' | 'basic';

const storyFrameworkFields = ['title', 'positioning', 'tags', 'openingReference', 'theme', 'mainPlot', 'characters', 'initialOrganizations', 'openQuestions', 'planningHistory'] as const;
const storyBasicFields = ['worldView', 'worldRules', 'powerSystem', 'resourceSystem', 'equipmentTiers', 'economicRules', 'attributeFields'] as const;
const basicSettingDefaults: Record<string, unknown> = {
  worldView: '', powerSystem: '', resourceSystem: '', equipmentTiers: [], economicRules: [], attributeFields: [], worldRules: []
};

const SETTING_CATALOG: Array<{ group: string; description: string; items: string[] }> = [
  { group: '世界与文明', description: '世界运行的底层背景', items: ['时代与纪元', '位面与宇宙', '地理地图', '种族', '文明', '国家与政体', '法律制度', '宗教信仰', '历法时间', '灾难与禁区'] },
  { group: '力量体系', description: '能力来源、成长与克制', items: ['境界等级', '职业体系', '天赋资质', '血脉体质', '技能与熟练度', '能量与消耗', '突破条件', '克制关系', '异常状态', '死亡与复活'] },
  { group: '装备与制造', description: '物品属性和成长规则', items: ['装备部位', '品质等级', '基础属性', '随机词条', '强化精炼', '镶嵌附魔', '套装效果', '耐久损耗', '绑定与交易', '锻造炼制'] },
  { group: '经济与资源', description: '货币、产出和消耗闭环', items: ['货币体系', '物价与汇率', '稀有度', '资源种类', '采集产出', '生产加工', '库存与容量', '交易拍卖', '税收维护', '升级消耗'] },
  { group: '人物与战力', description: '个人面板与衍生数值', items: ['基础属性', '生命能量', '攻击防御', '速度敏捷', '命中闪避', '暴击抗性', '恢复续航', '负重容量', '个人战力', '伤害与治疗'] },
  { group: '伙伴与军团', description: '可成长单位和协同力量', items: ['宠物', '坐骑', '召唤物', '将领随从', '兵种', '军队规模', '忠诚士气', '编制阵型', '军团战力', '伤亡补充'] },
  { group: '领地与建设', description: '城池、建筑和经营数据', items: ['领地等级', '城池等级', '建筑等级', '人口民心', '科技研究', '防御设施', '生产队列', '资源产量', '维护成本', '升级时间'] },
  { group: '游戏机制', description: '系统玩法与反馈规则', items: ['任务', '成就', '称号', '声望', '阵营', '副本', '竞技对战', '赛季', '排行榜', '掉落概率'] },
  { group: '榜单与评分', description: '排名口径必须可以解释', items: ['个人战力榜', '等级榜', '装备榜', '宠物榜', '坐骑榜', '军团榜', '领地榜', '财富榜', '成就榜', '赛季积分榜'] },
  { group: '计算公式', description: '只计算声明变量，不执行脚本', items: ['个人战力', '装备战力', '综合战力', '军队战力', '伤害结算', '治疗结算', '资源产出', '升级成本', '升级时间', '排行榜积分'] }
];

const FORMULA_CATEGORIES = SETTING_CATALOG.find((item) => item.group === '计算公式')!.items;

function PlanningWorkspace({ data, workspace }: {
  data: unknown; workspace: WorkspaceData | null;
}): React.JSX.Element {
  const [tab, setTab] = useState<PlanningTab>('framework');
  const artifacts = Array.isArray(data) ? data.filter(isRecord) : [];
  const visible = artifacts.flatMap<{ artifact: Record<string, unknown>; projection: ArtifactProjection }>((artifact) => {
    const type = String(artifact.artifact_type);
    if (type === 'story_bible' && (tab === 'framework' || tab === 'basic')) return [{ artifact, projection: tab }];
    const typeByTab: Record<Exclude<PlanningTab, 'framework' | 'basic'>, string> = {
      master: 'master_outline', volume: 'volume_outline', chapter: 'chapter_outline'
    };
    if (tab === 'framework' && type === 'creative_plan') return [{ artifact, projection: 'complete' }];
    if (tab !== 'framework' && tab !== 'basic' && type === typeByTab[tab]) return [{ artifact, projection: 'complete' }];
    return [];
  });
  const tabs: Array<[PlanningTab, string]> = [['framework', '全书框架'], ['basic', '基本设定'], ['master', '总纲'], ['volume', '卷纲'], ['chapter', '章纲']];
  const tabDescription: Record<PlanningTab, string> = {
    framework: '作品定位、题材与读者、表达基线、核心前提、主线和初始人物势力都在这里。',
    basic: '这里只维护世界观、力量与资源体系、装备等级、经济规则、属性字段和计算公式；非数值题材可以留空。',
    master: '全书主线、推进阶段、重大承诺、开放问题和终局方向。',
    volume: '按卷维护阶段目标、核心冲突、故事弧、高潮结果和卷末状态。',
    chapter: '按章维护叙事目标、场景节拍、必须结果、读者信息和伏笔回收。'
  };
  return (
    <section className="reference-view planning-workspace" aria-labelledby="planning-title">
      <header><h2 id="planning-title">规划工作台</h2><p>这里说明准备怎样写；资料库记录已经确认或发生的正史，两者通过来源相连。</p></header>
      <nav className="secondary-tabs" aria-label="规划层级">{tabs.map(([key, label]) => <button type="button" className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>{label}</button>)}</nav>
      <p className="planning-tab-description">{tabDescription[tab]}</p>
      {visible.length === 0 ? (
        <EmptyReference icon={<FileTextIcon />} title={`尚无${tabs.find(([key]) => key === tab)?.[1] ?? '规划'}`} description="先在对话中讨论并明确确认，主编才会生成带来源和版本的候选规划。" />
      ) : <div className="artifact-list">{visible.map(({ artifact, projection }) => <ArtifactCard key={`${String(artifact.artifact_id)}:${projection}`} bookId={workspace?.book.bookId ?? null} artifact={artifact} projection={projection} />)}</div>}
      {tab === 'basic' && <><SettingCatalog bookId={workspace?.book.bookId ?? null} /><AttributeFormulaManager bookId={workspace?.book.bookId ?? null} /></>}
    </section>
  );
}

function SettingCatalog({ bookId }: { bookId: string | null }): React.JSX.Element {
  const [source, setSource] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (): void => {
    const text = source.trim();
    if (bookId === null || text.length === 0 || text.length > 10_000) return;
    setBusy(true);
    const instruction = `@文姬 请拆解下面这份设定资料。按“世界观、力量与资源、装备、经济、属性字段、排行榜、宠物坐骑、领地建筑、资源产出、计算公式、未知项”分类整理；保留我的原意，不要补造数字。请给出可写入基本设定的候选内容和需要我确认的问题。以下是原文：\n\n${text}`;
    void sendMessage(bookId, instruction).then(() => {
      setSource('');
      setNotice('已交给文姬真实拆解。结果会出现在对话中；确认前只是候选，不会覆盖正式设定。');
    }).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '设定资料提交失败')).finally(() => setBusy(false));
  };
  return <section className="setting-workbench">
    <header><div><h3>设定目录</h3><p>用于整理资料和发现缺口，不是限制创作的固定模板；可按本书情况自定义。</p></div><span>目录版本 1</span></header>
    <div className="setting-catalog-grid">{SETTING_CATALOG.map((section) => <article key={section.group}><h4>{section.group}</h4><p>{section.description}</p><div>{section.items.map((item) => <span key={item}>{item}</span>)}</div></article>)}</div>
    <div className="setting-import"><div><h4>粘贴已有设定，让成员拆解</h4><p>最多10000字。原文会进入当前对话并保留来源；文姬只整理候选，不会自动改正史。</p></div><textarea aria-label="已有设定原文" rows={8} maxLength={10_000} value={source} onChange={(event) => setSource(event.target.value)} placeholder="可粘贴世界观、数值面板、装备等级、排行榜、宠物、坐骑、建筑、资源产出和计算规则……" /><footer><span>{source.length}/10000</span><button className="primary-button" type="button" disabled={busy || bookId === null || source.trim().length === 0} onClick={submit}>{busy ? '正在提交…' : '交给文姬拆解'}</button></footer>{notice !== null && <p className="binding-status" role="status">{notice}</p>}</div>
  </section>;
}

function ArtifactCard({ artifact, bookId, projection }: { artifact: Record<string, unknown>; bookId: string | null; projection: ArtifactProjection }): React.JSX.Element {
  const artifactId = String(artifact.artifact_id ?? '');
  const initialStatus = String(artifact.active_version_status ?? artifact.status ?? 'candidate');
  const initialContent = isRecord(artifact.active_content) ? artifact.active_content : {};
  const [status, setStatus] = useState(initialStatus);
  const [content, setContent] = useState<Record<string, unknown>>(initialContent);
  const [versions, setVersions] = useState<ArtifactVersionData[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(initialContent);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState(String(artifact.active_version_id ?? ''));
  const visibleContent = projectArtifactContent(content, projection, projection === 'basic');
  const editableProjection = projectArtifactContent(draft, projection, true);
  const displayTitle = projection === 'framework' ? '作品定位与全书框架' : projection === 'basic' ? '基本设定' : String(artifact.title ?? '未命名规划');
  const reloadVersions = (): void => {
    if (bookId === null || artifactId.length === 0) return;
    setBusy(true);
    void fetchArtifactVersions(bookId, artifactId).then(setVersions).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '版本加载失败')).finally(() => setBusy(false));
  };
  return <article className="artifact-card"><header><div><h3>{displayTitle}</h3><p>{artifactTypeLabel(String(artifact.artifact_type ?? ''))}</p></div><span className={`authority-badge ${status}`}>{authorityLabel(status)}</span></header><StructuredContent value={visibleContent} />
    {notice !== null && <p className="artifact-notice" role="status">{notice}</p>}
    {editing && <div className="artifact-editor"><h4>从当前内容创建候选版本</h4><ArtifactEditFields value={editableProjection} onChange={(next) => setDraft(mergeArtifactProjection(draft, next, projection))} /><div className="artifact-actions"><button className="secondary-button" type="button" onClick={() => { setEditing(false); setDraft(content); }}>取消</button><button className="primary-button" type="button" disabled={busy || bookId === null} onClick={() => {
      if (bookId === null) return;
      setBusy(true); setNotice(null);
      void addArtifactVersion(bookId, artifactId, draft, activeVersionId || null).then((created) => { setVersions((current) => [...(current ?? []), created]); setEditing(false); setNotice(`候选版本 ${created.version} 已保存，尚未转为正式。`); }).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '候选保存失败')).finally(() => setBusy(false));
    }}>保存候选</button></div></div>}
    {versions !== null && <div className="artifact-versions"><h4>版本历史</h4>{versions.map((version) => <div key={version.artifactVersionId}><span><strong>版本 {version.version}</strong><small>{authorityLabel(version.status)}，定位版本 {version.positioningVersion}</small></span><div>{activeVersionId && version.artifactVersionId !== activeVersionId && <button type="button" disabled={busy} onClick={() => {
        if (bookId === null) return;
        setBusy(true); void compareArtifactVersions(bookId, artifactId, activeVersionId, version.artifactVersionId).then((result) => setNotice(result.same ? '与当前正式版本内容一致。' : `变化字段：${result.changedTopLevelKeys.map(fieldLabel).join('、')}`)).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '版本比较失败')).finally(() => setBusy(false));
      }}>比较</button>}{version.status === 'candidate' && <><button type="button" disabled={busy} onClick={() => {
        if (bookId === null) return;
        setBusy(true); void selectArtifactVersion(bookId, artifactId, version.artifactVersionId).then((selected) => { setContent(selected.content); setStatus(selected.status); setActiveVersionId(selected.artifactVersionId); setNotice(`版本 ${selected.version} 已确认为正式规划。`); reloadVersions(); }).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '版本确认失败')).finally(() => setBusy(false));
      }}>确认</button><button type="button" disabled={busy} onClick={() => {
        if (bookId === null) return;
        setBusy(true); void rejectArtifactVersion(bookId, artifactId, version.artifactVersionId).then(() => { setNotice(`版本 ${version.version} 已否决并保留追溯记录。`); reloadVersions(); }).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '版本否决失败')).finally(() => setBusy(false));
      }}>否决</button></>}</div></div>)}</div>}
    <footer><span>版本 {String(artifact.version ?? 1)}</span><span>来源和影响范围随版本保留</span><span className="artifact-footer-actions"><button type="button" disabled={busy || bookId === null} onClick={() => { setDraft(content); setEditing((value) => !value); }}>作者编辑</button><button type="button" disabled={busy || bookId === null} onClick={reloadVersions}>{versions === null ? '查看版本' : '刷新版本'}</button></span></footer></article>;
}

function projectArtifactContent(content: Record<string, unknown>, projection: ArtifactProjection, includeDefaults = false): Record<string, unknown> {
  if (projection === 'complete') return content;
  const keys = projection === 'framework' ? storyFrameworkFields : storyBasicFields;
  const projected: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in content) projected[key] = content[key];
    else if (projection === 'basic' && includeDefaults) projected[key] = basicSettingDefaults[key];
  }
  return projected;
}

function mergeArtifactProjection(content: Record<string, unknown>, projected: Record<string, unknown>, projection: ArtifactProjection): Record<string, unknown> {
  if (projection === 'complete') return projected;
  const allowed = new Set<string>(projection === 'framework' ? storyFrameworkFields : storyBasicFields);
  const merged = { ...content };
  for (const [key, value] of Object.entries(projected)) if (allowed.has(key)) merged[key] = value;
  return merged;
}

function ArtifactEditFields({ value, onChange, depth = 0 }: { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; depth?: number }): React.JSX.Element {
  return <div className={`artifact-edit-fields depth-${Math.min(depth, 2)}`}>{Object.entries(value).filter(([key]) => !isTechnicalField(key)).map(([key, item]) => {
    if (isRecord(item) && depth < 2) return <fieldset key={key}><legend>{fieldLabel(key)}</legend><ArtifactEditFields value={item} depth={depth + 1} onChange={(next) => onChange({ ...value, [key]: next })} /></fieldset>;
    if (Array.isArray(item) && item.every((entry) => ['string', 'number'].includes(typeof entry))) return <label key={key}><span>{fieldLabel(key)}</span><textarea rows={Math.min(8, Math.max(3, item.length + 1))} value={item.map(String).join('\n')} onChange={(event) => onChange({ ...value, [key]: event.target.value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean) })} /></label>;
    if (typeof item === 'boolean') return <label key={key}><span>{fieldLabel(key)}</span><select value={String(item)} onChange={(event) => onChange({ ...value, [key]: event.target.value === 'true' })}><option value="true">是</option><option value="false">否</option></select></label>;
    if (typeof item === 'number') return <label key={key}><span>{fieldLabel(key)}</span><input type="number" value={item} onChange={(event) => onChange({ ...value, [key]: Number(event.target.value) })} /></label>;
    if (isRecord(item) || Array.isArray(item)) return <div className="artifact-readonly-field" key={key}><span>{fieldLabel(key)}</span><StructuredContent value={item} /></div>;
    return <label key={key}><span>{fieldLabel(key)}</span><input value={formatValue(item)} onChange={(event) => onChange({ ...value, [key]: event.target.value })} /></label>;
  })}</div>;
}

type LibraryTab = 'overview' | 'protagonist' | 'characters' | 'organizations' | 'locations' | 'items' | 'events' | 'rules' | 'tags' | 'gaps' | 'evidence';

function LibraryWorkspace({ data, bookId }: { data: unknown; bookId: string | null }): React.JSX.Element {
  const [tab, setTab] = useState<LibraryTab>('overview');
  const library = isLibraryData(data) ? data : emptyLibraryData();
  const tabs: Array<[LibraryTab, string]> = [
    ['overview', '总览'], ['protagonist', '主角'], ['characters', '角色'], ['organizations', '势力'], ['locations', '地点与地图'], ['items', '道具资源'], ['events', '事件时间线'],
    ['rules', '规则'], ['tags', '标签'], ['gaps', '缺口'], ['evidence', '证据']
  ];
  const entityTypes: Partial<Record<LibraryTab, string[]>> = {
    characters: ['character'], organizations: ['organization'], locations: ['location'], items: ['item', 'resource', 'skill', 'stat_panel'],
    events: ['event'], rules: ['world_rule']
  };
  return (
    <section className="reference-view library-workspace" aria-labelledby="library-title">
      <header><h2 id="library-title">资料库</h2><p>正史修订 {library.canonRevision}。标签、图谱和地图是可重建视图，不会反向改写正史。</p></header>
      <nav className="secondary-tabs scrollable" aria-label="资料分类">{tabs.map(([key, label]) => <button type="button" className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>{label}</button>)}</nav>
      {tab === 'overview' && <LibraryOverview data={library} />}
      {tab === 'protagonist' && <ProtagonistWorkspace bookId={bookId} initialDashboard={library.protagonists} initialFormulas={library.attributeFormulas} />}
      {entityTypes[tab] !== undefined && tab !== 'locations' && <EntityGrid entities={library.entities.filter((entity) => entityTypes[tab]!.includes(String(entity.entity_type)))} />}
      {tab === 'locations' && <LocationLibrary entities={library.entities.filter((entity) => entity.entity_type === 'location')} facts={library.facts} />}
      {tab === 'tags' && <TagCenter records={library.tags} bookId={bookId} />}
      {tab === 'gaps' && <RecordCollection records={library.gaps} empty="当前没有已登记的资料缺口。" />}
      {tab === 'evidence' && <RecordCollection records={library.facts} empty="章节经老板确认并结算后，事实证据会出现在这里。" />}
    </section>
  );
}

function LibraryOverview({ data }: { data: LibraryData }): React.JSX.Element {
  const metrics = [
    ['实体', data.summary.entityCount], ['正史事实', data.summary.factCount], ['关系', data.summary.relationCount],
    ['标签', data.summary.tagCount], ['分析投影', data.summary.projectionCount], ['待补缺口', data.summary.openGapCount]
  ];
  return <div className="library-overview"><div className="library-metrics">{metrics.map(([label, value]) => <div key={String(label)}><strong>{value}</strong><span>{label}</span></div>)}</div><div className="library-explainer"><TreeStructureIcon /><div><h3>权威与投影分开</h3><p>正文、确认设定和事实是正史来源。关系、情绪、地图位置和向量只是可重建视图，冲突时必须回查来源。</p></div></div></div>;
}

const PROTAGONIST_CATEGORY_LABELS: Record<string, string> = {
  overview: '身份与状态', attribute: '属性面板', resource: '资源', equipment: '装备道具',
  skill: '技能能力', territory: '城池领地', general: '将领随从', army: '士兵军队',
  identity: '身份', governance: '治理与权力', debt: '债务与承诺', injury: '伤势',
  physical: '身体状态', physical_injury: '身体伤势', memory: '记忆与认知',
  unclassified: '待归类'
};

function ProtagonistWorkspace({ bookId, initialDashboard, initialFormulas }: {
  bookId: string | null; initialDashboard?: ProtagonistDashboardData | undefined; initialFormulas?: AttributeFormulaData[] | undefined;
}): React.JSX.Element {
  const [dashboard, setDashboard] = useState<ProtagonistDashboardData>(initialDashboard ?? { profiles: [] });
  const [formulas, setFormulas] = useState<AttributeFormulaData[]>(initialFormulas ?? []);
  const [selectedProfileId, setSelectedProfileId] = useState(initialDashboard?.profiles[0]?.profileId ?? '');
  const [profileName, setProfileName] = useState('');
  const [category, setCategory] = useState('');
  const [label, setLabel] = useState('');
  const [rawValue, setRawValue] = useState('');
  const [unit, setUnit] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [classificationDrafts, setClassificationDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (bookId === null) return;
    const [nextDashboard, nextFormulas] = await Promise.all([fetchProtagonists(bookId), fetchAttributeFormulas(bookId)]);
    setDashboard(nextDashboard); setFormulas(nextFormulas);
    setSelectedProfileId((current) => nextDashboard.profiles.some((profile) => profile.profileId === current) ? current : nextDashboard.profiles[0]?.profileId ?? '');
  }, [bookId]);
  useEffect(() => { void refresh().catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '主角面板加载失败')); }, [refresh]);
  const selected = dashboard.profiles.find((profile) => profile.profileId === selectedProfileId) ?? dashboard.profiles[0] ?? null;
  const selectedStates = selected === null ? [] : [...selected.current, ...selected.pending];
  const categories = [...new Set(selectedStates.map((item) => item.category))]
    .sort((left, right) => Number(isUnclassifiedCategory(right)) - Number(isUnclassifiedCategory(left)) || protagonistCategoryLabel(left).localeCompare(protagonistCategoryLabel(right), 'zh-CN'));
  const categorySuggestions = categories.filter((value) => !isUnclassifiedCategory(value));
  const addState = async (): Promise<void> => {
    if (bookId === null || selected === null || !category.trim() || !label.trim() || !rawValue.trim()) return;
    const categoryKey = resolveProtagonistCategoryKey(category);
    const numeric = Number(rawValue);
    const valueType: ProtagonistStateData['valueType'] = Number.isFinite(numeric) && rawValue.trim() !== '' ? 'number' : 'text';
    const value: unknown = valueType === 'number' ? numeric : rawValue.trim();
    const logicalKey = normalizeStateKey(`${categoryKey}_${label}`);
    setBusy(true); setNotice(null);
    try {
      await appendProtagonistState(bookId, selected.profileId, { category: categoryKey, logicalKey, label: label.trim(), valueType, value, unit: unit.trim() || null, confirmed });
      setLabel(''); setRawValue(''); setUnit(''); setConfirmed(false);
      await refresh();
      setNotice(confirmed ? '已按作者确认保存到当前主角面板；旧状态版本仍可追溯。' : '已保存为候选状态，尚未视为正史。');
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '主角状态保存失败'); }
    finally { setBusy(false); }
  };
  const classifyState = async (item: ProtagonistStateData): Promise<void> => {
    const nextCategory = classificationDrafts[item.entryId]?.trim() ?? '';
    if (bookId === null || nextCategory.length === 0) return;
    setBusy(true); setNotice(null);
    try {
      const categoryKey = resolveProtagonistCategoryKey(nextCategory);
      await classifyProtagonistState(bookId, item.entryId, categoryKey);
      setClassificationDrafts((current) => { const next = { ...current }; delete next[item.entryId]; return next; });
      await refresh();
      setNotice(`已将“${item.label}”归入“${protagonistCategoryLabel(categoryKey)}”；原值、正史来源和历史版本均已保留。`);
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : '资料归类失败'); }
    finally { setBusy(false); }
  };
  return <div className="protagonist-workspace">
    <section className="protagonist-toolbar"><div><h3>主角实时面板</h3><p>只展示当前状态；变化通过新版本记录，战死、消耗或移除不会抹掉历史证据。</p></div>
      {dashboard.profiles.length > 0 && <select aria-label="选择主角" value={selected?.profileId ?? ''} onChange={(event) => setSelectedProfileId(event.target.value)}>{dashboard.profiles.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.displayName}{profile.isPrimary ? '（主角）' : ''}</option>)}</select>}
    </section>
    {selected === null ? <form className="protagonist-create" onSubmit={(event) => {
      event.preventDefault(); if (bookId === null || !profileName.trim()) return; setBusy(true);
      void saveProtagonistProfile(bookId, { displayName: profileName.trim(), isPrimary: true }).then(async (profile) => { setSelectedProfileId(profile.profileId); setProfileName(''); await refresh(); }).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '主角档案创建失败')).finally(() => setBusy(false));
    }}><label>主角姓名<input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="例如：张三" /></label><button className="primary-button" disabled={busy || !profileName.trim()}>建立主角面板</button></form> : <>
      {categories.length === 0 ? <EmptyReference icon={<UserCircleIcon />} title="还没有主角资料" description="定稿章节产生明确主角事实后，小文秘书会自动整理到这里；也可以先手工补充作者已经确认的信息。" /> : <div className="protagonist-state-grid">{categories.map((key) => {
        const title = protagonistCategoryLabel(key);
        const records = selected.current.filter((item) => item.category === key);
        const pending = selected.pending.filter((item) => item.category === key);
        return <section key={key}><header><h4>{title}</h4><span>{records.length + pending.length}</span></header>{[...records, ...pending].map((item) => <article key={item.entryId}><div><strong>{item.label}</strong><small>{item.authorityLayer === 'candidate' ? '候选' : item.authorityLayer === 'canon' ? '正史' : '计算结果'} · 版本 {item.revision}</small></div><span>{authorFormatScalar(item.value)}{item.unit ?? ''}</span><button type="button" title="从当前面板移除，历史仍保留" disabled={busy} onClick={() => {
          if (bookId === null) return; setBusy(true); void archiveProtagonistState(bookId, item.entryId).then(refresh).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '状态移除失败')).finally(() => setBusy(false));
        }}>移除</button>{isUnclassifiedCategory(item.category) && <form className="protagonist-classifier" onSubmit={(event) => { event.preventDefault(); void classifyState(item); }}><p>系统已记录这项资料，但不能可靠判断应该放在哪一类。可以询问主编建议，最终由作者确认。</p><label>确认分类<input aria-label={`为${item.label}确认分类`} value={classificationDrafts[item.entryId] ?? ''} onChange={(event) => setClassificationDrafts((current) => ({ ...current, [item.entryId]: event.target.value }))} placeholder="例如：契约伙伴" /></label><button className="secondary-button" disabled={busy || !(classificationDrafts[item.entryId]?.trim())}>确认分类</button></form>}</article>)}</section>;
      })}</div>}
      <form className="protagonist-state-form" onSubmit={(event) => { event.preventDefault(); void addState(); }}><header><h4>补充或纠正一项资料</h4><p>分类由这本书自己的内容决定，不套固定模板；同名状态会追加新修订，旧值与来源仍可追溯。</p></header><div><label>分类<input list="protagonist-category-suggestions" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="例如：契约伙伴、城池等级" /><datalist id="protagonist-category-suggestions">{categorySuggestions.map((value) => <option key={value} value={protagonistCategoryLabel(value)} />)}</datalist></label><label>名称<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：步兵数量" /></label><label>当前值<input value={rawValue} onChange={(event) => setRawValue(event.target.value)} placeholder="例如：1200 或 城主" /></label><label>单位<input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="例如：人、级" /></label></div><label className="protagonist-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />这是作者已经确认的信息</label><button className="primary-button" disabled={busy || !category.trim() || !label.trim() || !rawValue.trim()}>保存状态</button></form>
    </>}
    {formulas.length > 0 && <FormulaCalculator bookId={bookId} formulas={formulas} />}
    {notice !== null && <p className="binding-status" role="status">{notice}</p>}
  </div>;
}

function AttributeFormulaManager({ bookId }: { bookId: string | null }): React.JSX.Element {
  const [formulas, setFormulas] = useState<AttributeFormulaData[]>([]);
  const [label, setLabel] = useState('');
  const [expression, setExpression] = useState('');
  const [variablesText, setVariablesText] = useState('');
  const [unit, setUnit] = useState('');
  const [category, setCategory] = useState(FORMULA_CATEGORIES[0]!);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback(() => bookId === null ? Promise.resolve() : fetchAttributeFormulas(bookId).then(setFormulas), [bookId]);
  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);
  const variables = parseFormulaVariables(variablesText);
  return <section className="formula-manager"><header><h3>属性计算公式</h3><p>公式属于基本设定。只允许数字、已声明变量、括号和四则运算，不执行任何脚本。</p></header><form onSubmit={(event) => {
    event.preventDefault(); if (bookId === null || !label.trim() || !expression.trim() || variables.length === 0) return;
    void createAttributeFormula(bookId, { formulaKey: normalizeStateKey(label), label: label.trim(), category, expression: expression.trim(), variables, unit: unit.trim() || null }).then(async () => { setLabel(''); setExpression(''); setVariablesText(''); setUnit(''); await refresh(); setNotice('公式新版本已保存。'); }).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '公式保存失败'));
  }}><div><label>用途分类<select value={category} onChange={(event) => setCategory(event.target.value)}>{FORMULA_CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></label><label>公式名称<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：主角综合战力" /></label><label>表达式<input value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="攻击 * 2 + 防御" /></label><label>单位<input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="可留空" /></label></div><label>变量（每行：变量名:显示名）<textarea rows={4} value={variablesText} onChange={(event) => setVariablesText(event.target.value)} placeholder={'攻击:攻击力\n防御:防御力'} /></label><button className="primary-button" disabled={bookId === null || !label.trim() || !expression.trim() || variables.length === 0}>保存公式</button></form>
    <RecordCollection records={formulas.map((formula) => ({ 分类: formula.category === 'uncategorized' ? '未分类' : formula.category, 名称: formula.label, 表达式: formula.expression, 变量: formula.variables.map((item) => item.label), 单位: formula.unit, 版本: formula.version }))} empty="还没有属性计算公式。非游戏题材可以不设置。" />{notice !== null && <p className="binding-status" role="status">{notice}</p>}</section>;
}

function FormulaCalculator({ bookId, formulas }: { bookId: string | null; formulas: AttributeFormulaData[] }): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, string>>({});
  return <section className="formula-calculator"><header><h3>属性试算</h3><p>这里只计算数值，不会自动把结果写成正史。</p></header>{formulas.map((formula) => <form key={formula.formulaId} onSubmit={(event) => {
    event.preventDefault(); if (bookId === null) return;
    const payload: Record<string, number> = {};
    for (const variable of formula.variables) payload[variable.key] = Number(values[`${formula.formulaId}:${variable.key}`] ?? variable.defaultValue ?? '');
    void evaluateAttributeFormula(bookId, formula.formulaId, payload).then((result) => setResults((current) => ({ ...current, [formula.formulaId]: `${result.result}${formula.unit ?? ''}` }))).catch((reason: unknown) => setResults((current) => ({ ...current, [formula.formulaId]: reason instanceof Error ? reason.message : '计算失败' })));
  }}><strong>{formula.label}</strong><code>{formula.expression}</code><div>{formula.variables.map((variable) => <label key={variable.key}>{variable.label}<input type="number" step="any" value={values[`${formula.formulaId}:${variable.key}`] ?? String(variable.defaultValue ?? '')} onChange={(event) => setValues((current) => ({ ...current, [`${formula.formulaId}:${variable.key}`]: event.target.value }))} /></label>)}</div><button className="secondary-button">计算</button>{results[formula.formulaId] !== undefined && <output>{results[formula.formulaId]}</output>}</form>)}</section>;
}

function EntityGrid({ entities }: { entities: Array<Record<string, unknown>> }): React.JSX.Element {
  if (entities.length === 0) return <EmptyReference icon={<DatabaseIcon />} title="此分类尚无资料" description="可直接告诉主编需要增加的人物、势力、地点、规则或道具标签。" />;
  return <div className="entity-grid">{entities.slice(0, 300).map((entity) => <article key={String(entity.entity_id)}><header><span>{entityTypeLabel(String(entity.entity_type))}</span><em>{authorityLabel(String(entity.status))}</em></header><h3>{String(entity.canonical_name)}</h3><p>{arrayText(entity.aliases, '暂无别名')}</p></article>)}</div>;
}

function TagCenter({ records, bookId }: { records: Array<Record<string, unknown>>; bookId: string | null }): React.JSX.Element {
  const [local, setLocal] = useState<Array<Record<string, unknown>>>([]);
  const [name, setName] = useState('');
  const [namespace, setNamespace] = useState('story');
  const [description, setDescription] = useState('');
  const [target, setTarget] = useState('character');
  const [notice, setNotice] = useState<string | null>(null);
  const all = [...records, ...local];
  return <div className="tag-center"><form onSubmit={(event) => {
    event.preventDefault();
    if (bookId === null || !name.trim()) return;
    void createLibraryTag(bookId, { namespace: namespace.trim(), name: name.trim(), description: description.trim(), appliesTo: [target] }).then((created) => {
      setLocal((current) => [...current, { tag_definition_id: created.tagId, namespace, name, description, created_source: 'boss', status: created.status, assignment_count: 0 }]);
      setNotice(`标签“${name.trim()}”已创建，只更新结构化元数据，不会重写正文或全量重嵌入。`); setName(''); setDescription('');
    }).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '标签创建失败'));
  }}><header><h3>新增资料标签</h3><p>普通标签不改变故事事实；涉及正史含义的修改仍需确认。</p></header><div><label>命名空间<input value={namespace} onChange={(event) => setNamespace(event.target.value)} /></label><label>标签名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>适用对象<select value={target} onChange={(event) => setTarget(event.target.value)}><option value="character">人物</option><option value="location">地点</option><option value="organization">势力</option><option value="item">道具</option><option value="event">事件</option><option value="world_rule">规则</option><option value="chapter">章节</option></select></label></div><label>说明<input value={description} onChange={(event) => setDescription(event.target.value)} /></label><button className="primary-button" type="submit" disabled={bookId === null || !name.trim()}>创建标签</button></form>{notice !== null && <p className="binding-status" role="status">{notice}</p>}<RecordCollection records={all} empty="还没有资料标签。可在这里创建，也可直接告诉主编需要增加的标签。" /></div>;
}

function KnowledgeGraph({ records }: { records: Array<Record<string, unknown>> }): React.JSX.Element {
  if (records.length === 0) return <EmptyReference icon={<TreeStructureIcon />} title="尚无关系图谱" description="确认人物、势力或地点关系并重建投影后显示；布局只是浏览辅助，不是故事事实。" />;
  const edges = records.slice(0, 500).map((record) => ({ from: String(record.from_name ?? '未知'), relation: authorRelationshipLabel(record.relation_key), to: graphTarget(record.toValue) }));
  const nodes = [...new Set(edges.flatMap((edge) => [edge.from, edge.to]))].slice(0, 200);
  return <div className="knowledge-graph"><div className="graph-canvas" role="img" aria-label={`${nodes.length}个节点、${edges.length}条关系的有界关系图`}><div className="graph-node-grid">{nodes.map((node) => <span tabIndex={0} key={node}>{node}</span>)}</div></div><div className="graph-edge-list">{edges.slice(0, 100).map((edge, index) => <div key={`${edge.from}-${edge.relation}-${edge.to}-${index}`}><strong>{edge.from}</strong><span>{edge.relation}</span><strong>{edge.to}</strong></div>)}</div><p className="projection-disclaimer">当前仅加载≤200节点、≤500边的有界子图；节点布局不代表地理坐标或权威关系强度。</p></div>;
}

function LocationLibrary({ entities, facts }: { entities: Array<Record<string, unknown>>; facts: Array<Record<string, unknown>> }): React.JSX.Element {
  const points = facts.flatMap((fact) => {
    const value = isRecord(fact.value) ? fact.value : null;
    const relation = String(fact.relation_key ?? '');
    if (value === null || !/(coordinate|position|map|坐标|位置)/iu.test(relation) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return [];
    return [{ name: String(fact.canonical_name ?? '地点'), x: clampPercent(Number(value.x)), y: clampPercent(Number(value.y)), source: String(fact.fact_id ?? '') }];
  });
  return <div className="location-library">{points.length > 0 ? <div className="author-map" role="img" aria-label={`使用作者坐标的故事地图，共${points.length}个地点`}>{points.map((point) => <button type="button" key={`${point.name}-${point.source}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} title={`作者坐标 ${point.x}, ${point.y}`}>{point.name}</button>)}</div> : <p className="record-empty">尚无作者确认的地图坐标。系统不会用力导向布局冒充地理事实。</p>}<EntityGrid entities={entities} /></div>;
}

type GraphTab = 'relations' | 'emotion' | 'mainline' | 'subplot' | 'hook' | 'information_gap';

function ProjectionWorkspace({ data }: { data: unknown }): React.JSX.Element {
  const [tab, setTab] = useState<GraphTab>('relations');
  const graph = isGraphWorkspaceData(data) ? data : { relations: [], projections: [] };
  const tabs: Array<[GraphTab, string]> = [['relations', '人物关系'], ['emotion', '情绪'], ['mainline', '主线'], ['subplot', '支线'], ['hook', '钩子与伏笔'], ['information_gap', '信息差']];
  const records = graph.projections.filter((record) => record.projection_type === tab);
  return <section className="reference-view projection-workspace"><header><h2>叙事图谱</h2><p>关系和五类叙事轨迹集中在这里浏览；它们是可重建投影，不会自动改变剧情或正史。</p></header>
    <nav className="secondary-tabs" aria-label="图谱分类">{tabs.map(([key, label]) => <button type="button" className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {tab === 'relations' ? <KnowledgeGraph records={graph.relations} /> : <ProjectionTracks records={records} />}
  </section>;
}

function ProjectionTracks({ records }: { records: Array<Record<string, unknown>> }): React.JSX.Element {
  if (records.length === 0) return <EmptyReference icon={<TreeStructureIcon />} title="尚无分析投影" description="确认规划或结算正文后，可重建情绪、主支线、钩子和信息差视图。" />;
  const planned = records.filter((item) => item.track === 'planned').map(projectionForAuthor);
  const actual = records.filter((item) => item.track === 'actual').map(projectionForAuthor);
  return <div className="projection-tracks"><section><h3>规划曲线</h3><RecordCollection records={planned} empty="暂无规划轨" /></section><section><h3>实际曲线</h3><RecordCollection records={actual} empty="暂无实际轨" /></section></div>;
}

function RightsWorkspace({ data }: { data: unknown }): React.JSX.Element {
  const records = Array.isArray(data) ? data.filter(isRecord) : [];
  return <section className="reference-view rights-workspace"><header><h2>版权与研究</h2><p>隔离原文不进入主笔上下文；联网和人工提供资料只形成带来源候选，不自动进入正史。</p></header><RecordCollection records={records} empty="当前没有版权隔离或研究记录，也不会伪造近期联网结论。" /></section>;
}

function RecordCollection({ records, empty }: { records: Array<Record<string, unknown>>; empty: string }): React.JSX.Element {
  if (records.length === 0) return <p className="record-empty">{empty}</p>;
  return <div className="record-collection">{records.slice(0, 300).map((record, index) => <article key={String(record.id ?? record.projection_id ?? record.fact_id ?? record.tag_definition_id ?? record.knowledge_gap_id ?? index)}><StructuredContent value={record} /></article>)}</div>;
}

function StructuredContent({ value, depth = 0 }: { value: unknown; depth?: number }): React.JSX.Element {
  const visibleValue = depth === 0 ? toAuthorDisplayValue(value) : value;
  if (Array.isArray(visibleValue)) {
    if (visibleValue.length === 0) return <span className="empty-value">暂无</span>;
    return <ul>{visibleValue.slice(0, 30).map((item, index) => <li key={index}>{isRecord(item) || Array.isArray(item) ? <StructuredContent value={item} depth={depth + 1} /> : authorFormatScalar(item)}</li>)}</ul>;
  }
  if (!isRecord(visibleValue)) return <span>{authorFormatScalar(visibleValue)}</span>;
  return <dl className={`structured-content depth-${Math.min(depth, 2)}`}>{Object.entries(visibleValue).slice(0, 40).map(([key, item]) => <div key={key}><dt>{authorFieldLabel(key)}</dt><dd>{isRecord(item) || Array.isArray(item) ? <StructuredContent value={item} depth={depth + 1} /> : authorFormatScalar(item)}</dd></div>)}</dl>;
}

function EmptyReference({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }): React.JSX.Element {
  return <div className="view-empty compact">{icon}<h3>{title}</h3><p>{description}</p></div>;
}

function ManuscriptChapterBrowser({ workspace, selectedChapterId, onSelect }: {
  workspace: WorkspaceData; selectedChapterId: string | null; onSelect: (chapter: ChapterData) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [pages, setPages] = useState<Record<string, ChapterPageData>>({});
  const [loadingPage, setLoadingPage] = useState<string | null>(null);
  const activeRequests = useRef(new Set<AbortController>());
  const derivedVolumes = workspace.volumes?.length ? workspace.volumes : Array.from(new Set(workspace.chapters.map((chapter) => chapter.volumeId ?? 'unassigned'))).map((volumeId, index) => ({
    volumeId, volumeNumber: index + 1, title: '未命名卷', status: 'active',
    chapterCount: workspace.chapters.filter((chapter) => (chapter.volumeId ?? 'unassigned') === volumeId).length,
    settledCount: workspace.chapters.filter((chapter) => (chapter.volumeId ?? 'unassigned') === volumeId && chapter.settlementStatus === 'settled').length
  }));
  const totalChapters = derivedVolumes.reduce((sum, volume) => sum + volume.chapterCount, 0);
  const searchMode = query.trim().length > 0 || status.length > 0;
  const loadPage = useCallback((volumeId: string, offset = 0, searchQuery = query, searchStatus = status) => {
    const key = volumeId === 'all' ? 'search' : volumeId;
    const controller = new AbortController();
    activeRequests.current.add(controller);
    setLoadingPage(key);
    void fetchVolumeChapters(workspace.book.bookId, volumeId, { offset, limit: 80, query: searchQuery, status: searchStatus, signal: controller.signal })
      .then((page) => setPages((current) => ({ ...current, [key]: page })))
      .catch(() => undefined)
      .finally(() => { activeRequests.current.delete(controller); setLoadingPage((current) => current === key ? null : current); });
  }, [query, status, workspace.book.bookId]);
  useEffect(() => {
    setPages({});
    setQuery('');
    setStatus('');
    const first = derivedVolumes[0];
    if (first !== undefined) loadPage(first.volumeId, 0, '', '');
    return () => { for (const controller of activeRequests.current) controller.abort(); activeRequests.current.clear(); };
  }, [workspace.book.bookId]);
  useEffect(() => {
    if (!searchMode) return;
    const timeout = window.setTimeout(() => loadPage('all', 0), 250);
    return () => window.clearTimeout(timeout);
  }, [query, status]);
  const chapterButton = (chapter: ChapterData): React.JSX.Element => <button className={selectedChapterId === chapter.chapterId ? 'chapter-button active' : 'chapter-button'} type="button" key={chapter.chapterId} onClick={() => onSelect(chapter)}>
    <span className={`chapter-state ${chapter.settlementStatus}`} aria-hidden="true" />
    <span><strong>{chapter.chapterNumber}. {chapter.title}</strong><small>{chapterStatus(chapter, workspace.tasks)}</small></span>
  </button>;
  const pager = (volumeId: string, page: ChapterPageData | undefined): React.JSX.Element | null => page === undefined || page.total <= page.limit ? null : <div className="chapter-pager" aria-label="章节分页">
    <button type="button" disabled={page.offset === 0 || loadingPage !== null} onClick={() => loadPage(volumeId, Math.max(0, page.offset - page.limit))}>上一页</button>
    <span>{page.offset + 1}-{Math.min(page.total, page.offset + page.items.length)} / {page.total}</span>
    <button type="button" disabled={page.offset + page.items.length >= page.total || loadingPage !== null} onClick={() => loadPage(volumeId, page.offset + page.limit)}>下一页</button>
  </div>;
  return <section className="manuscript-chapter-browser" aria-label="正文章节列表">
    <div className="manuscript-chapter-browser-heading"><span>章节列表</span><small>{totalChapters} 章</small></div>
    {totalChapters > 20 && <div className="chapter-filter"><label className="chapter-search"><MagnifyingGlassIcon /><span className="sr-only">搜索章节、人物或状态</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="章节、人物或标题" /></label><select aria-label="按章节状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="planned">已规划</option><option value="working">写作中</option><option value="review">待点评</option><option value="settled">已结算</option><option value="blocked">受阻</option></select></div>}
    {searchMode ? <div className="chapter-search-results">{loadingPage === 'search' && <p className="rail-empty">正在定位章节</p>}{pages.search?.items.map(chapterButton)}{pages.search !== undefined && pages.search.items.length === 0 && <p className="rail-empty">没有符合条件的章节。</p>}{pager('all', pages.search)}</div> : derivedVolumes.map((volume) => {
      const page = pages[volume.volumeId];
      return <details className="volume-group" key={volume.volumeId} open={selectedChapterId !== null && page?.items.some((chapter) => chapter.chapterId === selectedChapterId) || volume.volumeNumber === derivedVolumes[0]?.volumeNumber}>
        <summary onClick={() => { if (pages[volume.volumeId] === undefined) loadPage(volume.volumeId); }}><span><strong>第 {volume.volumeNumber} 卷</strong><small>{volume.title}</small></span><em>{volume.settledCount}/{volume.chapterCount}</em></summary>
        <div className="volume-chapters">{loadingPage === volume.volumeId && page === undefined ? <p className="rail-empty">正在加载本卷</p> : page?.items.map(chapterButton)}{pager(volume.volumeId, page)}</div>
      </details>;
    })}
    {totalChapters === 0 && <p className="record-empty">章节尚未规划。先在对话中自然讨论剧情与跨度。</p>}
  </section>;
}

function TaskButton({ task, workspace, onSelect }: { task: TaskData; workspace: WorkspaceData; onSelect: (task: TaskData) => void }): React.JSX.Element {
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

function TaskWorkspace({ workspace, busy, onSelect, onDecide }: {
  workspace: WorkspaceData | null;
  busy: boolean;
  onSelect: (task: TaskData) => void;
  onDecide: (confirmationId: string, expectedCanonRevision: number, accept: boolean) => Promise<void>;
}): React.JSX.Element {
  const activeTasks = workspace?.tasks.filter((task) => isActiveTask(task.status)) ?? [];
  const historyTasks = workspace?.tasks.filter((task) => !isActiveTask(task.status)).slice(-12).reverse() ?? [];
  const budgetRatio = workspace?.budget === null || workspace?.budget === undefined || workspace.budget.token_limit === 0
    ? 0
    : Math.round(((workspace.budget.spent_tokens + workspace.budget.reserved_tokens) / workspace.budget.token_limit) * 100);
  return (
    <section className="task-workspace" aria-labelledby="task-workspace-title">
      <header className="task-workspace-header">
        <div><h2 id="task-workspace-title">任务中心</h2><p>集中查看创作进度、预算和需要您决定的事项。</p></div>
        <div className="task-workspace-count"><strong>{activeTasks.length}</strong><span>项进行中</span></div>
      </header>
      <div className="task-workspace-layout">
        <div className="task-workspace-primary">
          <section className="task-workspace-section" aria-labelledby="active-task-list-title">
            <div className="task-workspace-heading"><h3 id="active-task-list-title">进行中的任务</h3><span>{activeTasks.length}</span></div>
            {activeTasks.length === 0 ? <p className="task-workspace-empty">当前没有进行中的创作任务。</p> : (
              <div className="task-list">{activeTasks.map((task) => <TaskButton key={task.taskId} task={task} workspace={workspace!} onSelect={onSelect} />)}</div>
            )}
          </section>
          <section className="task-workspace-section" aria-labelledby="recent-task-list-title">
            <div className="task-workspace-heading"><h3 id="recent-task-list-title">最近任务</h3><span>{historyTasks.length}</span></div>
            {historyTasks.length === 0 ? <p className="task-workspace-empty">还没有已结束的任务记录。</p> : (
              <div className="task-list">{historyTasks.map((task) => <TaskButton key={task.taskId} task={task} workspace={workspace!} onSelect={onSelect} />)}</div>
            )}
          </section>
        </div>
        <div className="task-workspace-secondary">
          <section className="task-workspace-section budget-section" aria-labelledby="task-budget-title">
            <div className="task-workspace-heading"><h3 id="task-budget-title">预算</h3><span>{budgetRatio}%</span></div>
            <div className="budget-numbers"><strong>{formatNumber(workspace?.budget?.spent_tokens ?? 0)}</strong><span> / {formatNumber(workspace?.budget?.token_limit ?? 0)} Token</span></div>
            <dl className="budget-details">
              <div><dt>已预留</dt><dd>{formatNumber(workspace?.budget?.reserved_tokens ?? 0)} Token</dd></div>
              <div><dt>模式</dt><dd>{budgetModeLabel(workspace?.budget?.mode)}</dd></div>
            </dl>
            <p>现金保护线 {((workspace?.budget?.cash_limit_micros ?? 0) / 1_000_000).toFixed(2)} 元</p>
          </section>
          <ConfirmationsPanel workspace={workspace} busy={busy} onDecide={onDecide} />
        </div>
      </div>
    </section>
  );
}

function ConfirmationsPanel({ workspace, busy, onDecide }: {
  workspace: WorkspaceData | null;
  busy: boolean;
  onDecide: (confirmationId: string, expectedCanonRevision: number, accept: boolean) => Promise<void>;
}): React.JSX.Element {
  const confirmations = workspace?.confirmations.items ?? [];
  return (
    <section className="task-workspace-section" aria-labelledby="task-confirmations-title">
      <div className="task-workspace-heading"><h3 id="task-confirmations-title">待确认</h3><span>{workspace?.confirmations.count ?? 0}</span></div>
      {confirmations.length === 0 ? <p className="task-workspace-empty">当前没有需要老板确认的重大事项。</p> : (
        <div className="confirmation-list">{confirmations.map((confirmation) => (
          <article className="confirmation-card" key={confirmation.confirmationId}>
            <strong>{confirmationLabel(confirmation.targetType)}</strong>
            <span>对象 {shortId(confirmation.targetId)}，绑定正史 {confirmation.expectedCanonRevision}</span>
            <details><summary>查看范围与影响</summary><StructuredContent value={{ scope: confirmation.scope, impact: confirmation.impact, estimatedCashCny: '0 元' }} /></details>
            <p>接受会解除相关门禁；模糊回复不会生效。</p>
            <div><button type="button" disabled={busy} onClick={() => void onDecide(confirmation.confirmationId, confirmation.expectedCanonRevision, false)}>拒绝</button><button className="confirm-button" type="button" disabled={busy} onClick={() => void onDecide(confirmation.confirmationId, confirmation.expectedCanonRevision, true)}>明确接受</button></div>
          </article>
        ))}</div>
      )}
    </section>
  );
}

function TeamInspector({ workspace, worker, onSelectAgent }: { workspace: WorkspaceData | null; worker: WorkerData | null; onSelectAgent: (agent: AgentData) => void }): React.JSX.Element {
  const agents = workspace?.agents ?? [];
  return (
    <div className="inspector-content team-inspector">
      <section className="inspector-section">
        <div className="inspector-heading"><h2>团队</h2><span>{agents.length} 名成员</span></div>
        <div className="agent-list">{agents.map((agent) => <AgentRow key={agent.agentId} agent={agent} task={activeTaskForAgent(workspace, agent.agentId)} worker={worker} onSelect={() => onSelectAgent(agent)} />)}</div>
      </section>
    </div>
  );
}

function AgentRow({ agent, task, worker, onSelect }: { agent: AgentData; task: TaskData | null; worker: WorkerData | null; onSelect: () => void }): React.JSX.Element {
  const presence = agentPresence(agent, task, worker);
  const identity = memberIdentity(agent);
  return (
    <button type="button" className="agent-row" title={`${identity}，${agent.publicSummary ?? ''}`} aria-label={`${identity}，${presence.label}，打开岗位详情`} onClick={onSelect}>
      <AgentAvatar roleKey={agent.roleKey} roleName={identity} />
      <span className="agent-copy"><strong>{identity}</strong><small>{agent.publicSummary ?? roleSummary(agent.roleKey)}</small><em className={presence.className}><span className="agent-state" aria-hidden="true" />{presence.label}</em></span>
    </button>
  );
}

function AgentAvatar({ roleKey, roleName }: { roleKey: string; roleName: string }): React.JSX.Element {
  return <span className="agent-avatar" role="img" aria-label={`${roleName}头像`} style={{ backgroundPosition: avatarPosition(roleKey) }} />;
}

function memberIdentity(agent: Pick<AgentData, 'displayName' | 'roleName'>): string {
  return `${agent.displayName}（${agent.roleName}）`;
}

function isUnclassifiedCategory(category: string): boolean {
  const normalized = category.trim().toLocaleLowerCase('zh-CN');
  return normalized === 'unclassified' || normalized === '待归类';
}

function protagonistCategoryLabel(category: string): string {
  if (isUnclassifiedCategory(category)) return '待归类';
  return PROTAGONIST_CATEGORY_LABELS[category] ?? (/\p{Script=Han}/u.test(category) ? category : '其他资料');
}

function resolveProtagonistCategoryKey(category: string): string {
  const normalized = category.trim();
  const legacy = Object.entries(PROTAGONIST_CATEGORY_LABELS).find(([, label]) => label === normalized)?.[0];
  return legacy ?? normalized;
}

function activeTaskForAgent(workspace: WorkspaceData | null, agentId: string): TaskData | null {
  if (workspace === null) return null;
  const tasks = workspace.tasks.filter((task) => task.assignedAgentId === agentId && isActiveTask(task.status));
  return tasks.find((task) => task.status === 'working')
    ?? tasks.find((task) => task.status === 'queued' || task.status === 'pending')
    ?? tasks[0]
    ?? null;
}

function agentPresence(agent: AgentData, task: TaskData | null, worker: WorkerData | null): { label: string; className: string } {
  if (agent.activationState === 'disabled') return { label: '离线', className: 'offline' };
  if (agent.activationState === 'paused') return { label: '暂停', className: 'standby' };
  if (task === null) return { label: '空闲', className: 'standby' };
  // P0-2 / R02: blocked/interrupted 不表示成员正在工作，只显示在任务中心，
  // 不把成员伪装成持续工作或“需要处理”；waiting_confirmation 显示等待老板。
  if (task.status === 'waiting_confirmation') return { label: '待老板确认', className: 'standby' };
  if (task.status === 'blocked' || task.status === 'interrupted') return { label: '待命', className: 'standby' };
  if (task.status === 'queued' || task.status === 'pending') return { label: '排队中', className: 'queued' };
  if (task.status === 'working' && worker?.status === 'ready' && worker.worker?.currentTaskId === task.taskId) {
    return { label: '后台工作中', className: 'working' };
  }
  return { label: '需要处理', className: 'blocked' };
}

function EmptyLibrary({ onCreate }: { onCreate: () => void }): React.JSX.Element {
  return <section className="empty-library"><div className="empty-glyph"><BooksIcon /></div><h2>把第一本书放进工作台</h2><p>先填写书籍、主角、第一阶段剧情、主要标签和作品边界。确认后会原子创建11名创作成员、预算与规划资料，并由主编主动引导下一步讨论。</p><button className="primary-button" type="button" onClick={onCreate}><PlusIcon />创建新书</button></section>;
}

function WorkspaceSkeleton(): React.JSX.Element {
  return <div className="workspace-skeleton" aria-label="正在加载工作区"><span /><span /><span /><span /></div>;
}

function TaskDetailsDialog({ task, workspace, busy, onCancelTask, onClose }: {
  task: TaskData;
  workspace: WorkspaceData;
  busy: boolean;
  onCancelTask: (taskId: string) => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const agent = workspace.agents.find((item) => item.agentId === task.assignedAgentId) ?? null;
  const canCancel = isActiveTask(task.status) && !task.cancelRequested;
  const chapter = taskChapterLabel(task, workspace).replace(/^第(\d+)章$/u, '第 $1 章');
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="dialog task-dialog" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">
        <header>
          <div><h2 id="task-detail-title">任务详情</h2><p>{chapter} · {taskLabel(task.taskType)}</p></div>
          <button className="icon-button" type="button" aria-label="关闭任务详情" disabled={busy} onClick={onClose}><XIcon /></button>
        </header>
        <dl className="task-detail-grid">
          <div><dt>当前状态</dt><dd><span className={`task-status-dot ${task.status}`} aria-hidden="true" />{task.cancelRequested ? '取消处理中' : statusLabel(task.status)}</dd></div>
          <div><dt>创作阶段</dt><dd>{phaseLabel(task.currentPhase)}</dd></div>
          <div><dt>执行成员</dt><dd>{agent === null ? '等待分派' : memberIdentity(agent)}</dd></div>
          <div><dt>已尝试</dt><dd>{task.attemptCount} 次</dd></div>
          <div className="task-detail-wide"><dt>任务目标</dt><dd>{taskGoal(task, chapter)}</dd></div>
          <div className="task-detail-wide"><dt>最近检查点</dt><dd>{taskCheckpointLabel(task.checkpoint)}</dd></div>
          <div className="task-detail-wide"><dt>任务 ID</dt><dd><code>{task.taskId}</code></dd></div>
        </dl>
        <footer>
          <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>关闭</button>
          {canCancel && <button className="danger-button" type="button" disabled={busy} onClick={() => void onCancelTask(task.taskId)}>{busy ? '正在取消' : '取消任务'}</button>}
        </footer>
      </section>
    </div>
  );
}

function AgentDetailsDialog({ agent, task, messages, onClose }: { agent: AgentData; task: TaskData | null; messages: MessageData[]; onClose: () => void }): React.JSX.Element {
  const contribution = [...messages].reverse().find((message) => message.sender_agent_id === agent.agentId || message.role_key === agent.roleKey) ?? null;
  const groups = [
    ['负责', agent.responsibilities ?? []], ['不负责', agent.boundaries ?? []], ['检索重点', agent.retrievalFocus ?? []], ['交付物', agent.outputKinds ?? []]
  ] as const;
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="dialog agent-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-detail-title">
      <header><div className="agent-dialog-identity"><AgentAvatar roleKey={agent.roleKey} roleName={memberIdentity(agent)} /><span><h2 id="agent-detail-title">{memberIdentity(agent)}</h2><p>{agent.publicSummary ?? roleSummary(agent.roleKey)}</p></span></div><button className="icon-button" type="button" aria-label="关闭岗位详情" onClick={onClose}><XIcon /></button></header>
      <div className="agent-detail-model"><span>实际模型来源</span><strong>{agent.provider}/{agent.modelId}</strong><small>同模型岗位会如实显示共同来源，不计作独立意见。</small></div>
      <div className="agent-detail-groups">{groups.map(([title, items]) => <section key={title}><h3>{title}</h3>{items.length === 0 ? <p>暂无公开条目</p> : <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>}</section>)}</div>
      <section className="agent-evidence"><h3>当前任务与有效贡献</h3><p>{task === null ? '当前没有分配给该成员的活动任务。' : `${taskChapterFromBrief(task)}，${phaseLabel(task.currentPhase)}，${statusLabel(task.status)}`}</p>{contribution === null ? <small>尚无可展示的有效对话贡献，不伪造在线或工作状态。</small> : <blockquote>{contribution.content}<footer>{formatTime(contribution.created_at)}，来源消息 {shortId(contribution.message_id)}</footer></blockquote>}</section>
      <footer><button className="primary-button" type="button" onClick={onClose}>完成</button></footer>
    </section>
  </div>;
}

function SettingsDialog({ preferences, capabilities, bookId, bindings, operations, onBindingsChanged, onBooksChanged, onChange, onClose }: {
  preferences: WorkspacePreferences;
  capabilities: CapabilityData | null;
  bookId: string | null;
  bindings: ModelBindingsData | null;
  operations: OperationsStatusData | null;
  onBindingsChanged: () => void;
  onBooksChanged: () => void;
  onChange: (preferences: WorkspacePreferences) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [bindingProfiles, setBindingProfiles] = useState<Record<string, TeamModelProfileData>>({});
  const [bindingBusy, setBindingBusy] = useState(false);
  const [bindingStatus, setBindingStatus] = useState<string | null>(null);
  const [portableStatus, setPortableStatus] = useState<string | null>(null);
  const [importName, setImportName] = useState('');
  useEffect(() => {
    if (bindings === null) return;
    setBindingProfiles(Object.fromEntries(bindings.active.map((binding) => [binding.roleKey, {
      provider: binding.provider, modelId: binding.modelId, plan: binding.plan
    }])));
  }, [bindings]);
  const themes = [
    { value: 'sage', label: '浅绿', description: '接近智囊团的舒缓工作底色' },
    { value: 'paper', label: '米白', description: '适合长时间阅读正文' },
    { value: 'mist', label: '雾蓝', description: '冷静、低饱和的创作环境' },
    { value: 'night', label: '夜间', description: '低亮度深色工作台' }
  ] as const;
  const fonts = [
    { value: 'small', label: '小' },
    { value: 'standard', label: '标准' },
    { value: 'large', label: '大' },
    { value: 'xlarge', label: '特大' }
  ] as const;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header><div><h2 id="settings-title">界面设置</h2><p>调整会立即生效，并只保存在这台电脑上。</p></div><button className="icon-button" type="button" aria-label="关闭界面设置" onClick={onClose}><XIcon /></button></header>
        <fieldset>
          <legend>工作台底色</legend>
          <div className="theme-options">
            {themes.map((theme) => (
              <label className="theme-option" key={theme.value}>
                <input type="radio" name="workspace-theme" value={theme.value} aria-label={theme.label} checked={preferences.theme === theme.value} onChange={() => onChange({ ...preferences, theme: theme.value })} />
                <span className={`theme-preview ${theme.value}`} aria-hidden="true" />
                <span><strong>{theme.label}</strong><small>{theme.description}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>字体大小</legend>
          <div className="font-options">
            {fonts.map((font) => (
              <label key={font.value} className={preferences.fontSize === font.value ? 'font-option active' : 'font-option'}>
                <input type="radio" name="workspace-font" value={font.value} aria-label={font.label} checked={preferences.fontSize === font.value} onChange={() => onChange({ ...preferences, fontSize: font.value })} />
                <span>{font.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>成员模型</legend>
          <div className="model-runtime-summary">
            <div className={capabilities?.modelRuntime.activeMode === 'subscription-plan' ? 'runtime-state active' : 'runtime-state'}>
              <span aria-hidden="true" />
              <strong>{capabilities?.modelRuntime.activeMode === 'subscription-plan' ? '订阅与套餐模型已启用' : '确定性测试模型'}</strong>
              <small>{capabilities?.modelRuntime.cashFallbackAllowed === false ? '禁止按量付费回退' : '运行状态待连接'}</small>
            </div>
            <div className="model-profile-list">
              {(capabilities?.modelRuntime.profiles ?? []).map((profile) => (
                <div className="model-profile" key={`${profile.provider}/${profile.modelId}`}>
                  <span><strong>{profile.modelId}</strong><small>{profile.provider}</small></span>
                  <span><small>{profile.roles.map(roleLabel).join('、')}</small><em>{profile.credentialConfigured ? planLabel(profile.plan) : '缺少凭证'}</em></span>
                </div>
              ))}
              {capabilities === null && <p>连接本地服务后显示创作团队的真实模型来源。</p>}
            </div>
            {capabilities !== null && <p className="capability-note">Node {capabilities.runtime.nodeVersion} · SQLite {capabilities.sqlite.version} · FTS5 {capabilities.sqlite.fts5 ? '可用' : '缺失'} · 向量检索 {capabilities.degradation.vectorSearchAvailable ? '可用' : '待安装'}</p>}
          </div>
        </fieldset>
        <fieldset>
          <legend>书籍级模型绑定</legend>
          {bookId === null ? <p className="capability-note">选择一本书后可管理未来任务的模型绑定。</p> : bindings === null ? <div className="binding-skeleton" aria-label="正在加载模型绑定"><span /><span /><span /></div> : (
            <div className="binding-manager">
              <p>修改只对未来新任务生效，运行中的任务继续使用已冻结模型。两名编剧必须异模型，豆包不能进入剧情席；GLM担任副笔时事实席自动切换DeepSeek。</p>
              <div className="binding-role-list">{bindings.active.map((binding) => {
                const options = uniqueProfiles(capabilities, bindings);
                const selected = bindingProfiles[binding.roleKey] ?? { provider: binding.provider, modelId: binding.modelId, plan: binding.plan };
                return <label key={binding.roleKey}><span><strong>{binding.memberName}（{binding.shortTitle}）</strong><small>{roleSummary(binding.roleKey)}</small></span><select aria-label={`${binding.memberName}模型`} value={modelProfileValue(selected)} onChange={(event) => {
                  const next = options.find((option) => modelProfileValue(option) === event.target.value);
                  if (next !== undefined) setBindingProfiles((current) => ({ ...current, [binding.roleKey]: next }));
                }}>{options.map((option) => <option key={modelProfileValue(option)} value={modelProfileValue(option)}>{option.modelId}（{planLabel(option.plan)}）</option>)}</select></label>;
              })}</div>
              {bindingStatus !== null && <p className="binding-status" role="status">{bindingStatus}</p>}
              <div className="binding-actions"><button type="button" className="secondary-button" disabled={bindingBusy} onClick={() => {
                if (bookId === null) return;
                setBindingBusy(true); setBindingStatus(null);
                void previewModelBindings(bookId, bindingProfiles).then(() => setBindingStatus('预检通过：模型独立性、剧情席和零现金回退规则均满足。')).catch((reason: unknown) => setBindingStatus(reason instanceof Error ? reason.message : '预检失败')).finally(() => setBindingBusy(false));
              }}>预览校验</button><button type="button" className="primary-button" disabled={bindingBusy} onClick={() => {
                if (bookId === null) return;
                setBindingBusy(true); setBindingStatus(null);
                void previewModelBindings(bookId, bindingProfiles).then(() => activateModelBindings(bookId, bindingProfiles, '老板在设置页激活未来任务模型绑定')).then(() => {
                  setBindingStatus('已激活新修订，仅未来任务生效。'); onBindingsChanged();
                }).catch((reason: unknown) => setBindingStatus(reason instanceof Error ? reason.message : '激活失败')).finally(() => setBindingBusy(false));
              }}>激活未来任务</button></div>
              <details className="binding-history"><summary>绑定历史 {bindings.revisions.length}</summary>{bindings.revisions.map((revision) => <div key={revision.revisionId}><strong>修订 {revision.version}</strong><span>{revision.reason}</span><em>{revision.status === 'active' ? '当前活动' : '历史'}</em>{revision.status !== 'active' && <button type="button" className="text-button" disabled={bindingBusy} onClick={() => {
                if (bookId === null) return;
                setBindingBusy(true); setBindingStatus(null);
                void restoreModelBindingRevision(bookId, revision.revisionId).then(() => {
                  setBindingStatus(`已从修订 ${revision.version} 创建新的活动修订，仅未来任务生效。`); onBindingsChanged();
                }).catch((reason: unknown) => setBindingStatus(reason instanceof Error ? reason.message : '恢复失败')).finally(() => setBindingBusy(false));
              }}>恢复为新修订</button>}</div>)}</details>
            </div>
          )}
        </fieldset>
        <fieldset>
          <legend>本机运维与可移植</legend>
          {operations === null ? <div className="binding-skeleton" aria-label="正在加载本机诊断"><span /><span /></div> : <div className="operations-summary">
            <div><span>Schema</span><strong>{operations.schemaVersion}</strong></div><div><span>剩余磁盘</span><strong>{formatBytes(operations.disk.freeBytes)}</strong></div><div><span>排队/工作</span><strong>{operations.queue.queued}/{operations.queue.working}</strong></div><div><span>受阻</span><strong>{operations.queue.blocked}</strong></div>
          </div>}
          <p className="capability-note">只监听 127.0.0.1，不发送遥测。导出包不含API Key、缓存、向量和FTS；复制导入会生成新书ID，不覆盖已有书籍。</p>
          {portableStatus !== null && <p className="binding-status" role="status">{portableStatus}</p>}
          <div className="portable-actions"><button type="button" className="secondary-button" disabled={bindingBusy || bookId === null} onClick={() => {
            if (bookId === null) return;
            setBindingBusy(true); setPortableStatus(null);
            void exportBookPackage(bookId).then((result) => setPortableStatus(`已导出 ${result.packageName}，保存于 ${result.packagePath}。清单哈希 ${result.manifestHash.slice(0, 12)}。`)).catch((reason: unknown) => setPortableStatus(reason instanceof Error ? reason.message : '导出失败')).finally(() => setBindingBusy(false));
          }}>导出当前书</button><label><span>从 data/imports 复制导入</span><input value={importName} onChange={(event) => setImportName(event.target.value)} placeholder="文件名.wenmi-book" /></label><button type="button" className="primary-button" disabled={bindingBusy || !importName.endsWith('.wenmi-book')} onClick={() => {
            setBindingBusy(true); setPortableStatus(null);
            void importBookCopy(importName).then((result) => { setPortableStatus(`已复制导入《${result.title}》，新书ID ${shortId(result.bookId)}。`); setImportName(''); onBooksChanged(); }).catch((reason: unknown) => setPortableStatus(reason instanceof Error ? reason.message : '导入失败')).finally(() => setBindingBusy(false));
          }}>安全导入副本</button></div>
        </fieldset>
        <footer><button className="secondary-button" type="button" onClick={() => onChange(DEFAULT_WORKSPACE_PREFERENCES)}>恢复默认</button><button className="primary-button" type="button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  );
}

function planLabel(plan: 'deterministic' | 'codex' | 'coding' | 'agent'): string {
  if (plan === 'codex') return 'Codex 登录态';
  if (plan === 'coding') return 'Coding Plan';
  if (plan === 'agent') return 'Agent Plan';
  return '本地测试';
}

function roleLabel(role: string): string {
  return ({
    chief_editor: '主编', deputy_editor: '副主编', lead_screenwriter: '编剧', second_screenwriter: '编剧',
    plot_architect: '编剧', setting: '设定师', continuity: '设定师', lead_writer: '主笔', backup_writer: '副主笔', writer: '主笔',
    fact_reviewer: '事实审校', literary_reviewer: '文学审校', experience_reviewer: '体验审校', reviewer: '审校',
    reader_experience: '体验官', style_editor: '文编', researcher: '研究员', copyright: '版权顾问'
  } as Record<string, string>)[role] ?? role;
}

interface OpeningProtagonistDraft {
  role: ProtagonistRole;
  name: string;
  age: string;
  background: string;
  personalities: string[];
}

const OPENING_CHANNELS: Array<{ id: OpeningChannel; label: string; description: string }> = [
  { id: 'male', label: '男频', description: '按男频分类与标签组织作品' },
  { id: 'female', label: '女频', description: '按女频分类与标签组织作品' }
];

const PROTAGONIST_ROLES: Array<{ id: ProtagonistRole; label: string }> = [
  { id: 'male_lead', label: '男主' }, { id: 'female_lead', label: '女主' },
  { id: 'co_lead', label: '共同主角' }, { id: 'ensemble', label: '群像主角' }, { id: 'non_human', label: '非人主角' }
];

function CompleteCreateBookDialog({ busy, onCancel, onCreate }: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: Parameters<typeof createBook>[0]) => Promise<void>;
}): React.JSX.Element {
  const [taxonomy, setTaxonomy] = useState<OpeningTaxonomyData | null>(null);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [channel, setChannel] = useState<OpeningChannel | null>(null);
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [protagonists, setProtagonists] = useState<OpeningProtagonistDraft[]>([
    { role: 'co_lead', name: '', age: '', background: '', personalities: [] }
  ]);
  const [worldBackground, setWorldBackground] = useState('');
  const [openingBackground, setOpeningBackground] = useState('');
  const [stageStart, setStageStart] = useState('');
  const [stageDevelopment, setStageDevelopment] = useState('');
  const [stageEnd, setStageEnd] = useState('');
  const [fullBookOutline, setFullBookOutline] = useState('');
  const [initialMap, setInitialMap] = useState('');
  const [mainTags, setMainTags] = useState<string[]>([]);
  const [auxiliaryTags, setAuxiliaryTags] = useState<string[]>([]);
  const [storyTraits, setStoryTraits] = useState<string[]>([]);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');
  const [tagQuery, setTagQuery] = useState('');
  const [selectedMustFollow, setSelectedMustFollow] = useState<string[]>([]);
  const [mustFollowText, setMustFollowText] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [synopsisBusy, setSynopsisBusy] = useState(false);
  const [synopsisFeedback, setSynopsisFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchOpeningTaxonomy(controller.signal).then((value) => {
      setTaxonomy(value); setTaxonomyError(null);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setTaxonomyError(reason instanceof Error ? reason.message : '分类目录加载失败');
    });
    return () => controller.abort();
  }, []);

  const categories = taxonomy?.categories.filter((item) => item.channel === channel) ?? [];
  const category = taxonomy?.categories.find((item) => item.key === categoryKey) ?? null;
  const mainTagOptions = taxonomy === null ? [] : [...new Set([...(category?.recommendedMainTags ?? []), ...taxonomy.mainTags])];
  const normalizedTagQuery = tagQuery.trim().toLocaleLowerCase('zh-CN');
  const matchingTags = (options: string[]): string[] => normalizedTagQuery.length === 0
    ? options
    : options.filter((item) => item.toLocaleLowerCase('zh-CN').includes(normalizedTagQuery));
  const customMustFollow = mustFollowText.split(/[；;\n\r]+/u).map((item) => item.trim()).filter(Boolean);
  const mustFollow = [...new Set([...selectedMustFollow, ...customMustFollow])];
  const protagonistsValid = protagonists.length > 0 && protagonists.every((item) =>
    item.name.trim().length > 0 && item.age.trim().length > 0 && item.background.trim().length > 0 && item.personalities.length > 0
  );
  const valid = taxonomy !== null && title.trim().length > 0 && channel !== null && category !== null
    && protagonistsValid && worldBackground.trim().length > 0 && openingBackground.trim().length > 0
    && stageStart.trim().length > 0 && stageDevelopment.trim().length > 0 && stageEnd.trim().length > 0
    && fullBookOutline.trim().length > 0 && initialMap.trim().length > 0 && mustFollow.length > 0 && mustFollow.length <= 12
    && mainTags.length >= 2 && mainTags.length <= 5;

  const updateProtagonist = (index: number, patch: Partial<OpeningProtagonistDraft>): void => {
    setProtagonists((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };
  const toggleProtagonistPersonality = (index: number, personality: string): void => {
    const current = protagonists[index];
    if (current === undefined) return;
    const next = current.personalities.includes(personality)
      ? current.personalities.filter((item) => item !== personality)
      : current.personalities.length >= 6 ? current.personalities : [...current.personalities, personality];
    updateProtagonist(index, { personalities: next });
  };
  const toggleTag = (tag: string, current: string[], setter: (value: string[]) => void, max: number): void => {
    if (current.includes(tag)) setter(current.filter((item) => item !== tag));
    else if (current.length < max) setter([...current, tag]);
  };
  const addCustomTag = (): void => {
    const value = customTag.trim().replace(/^#+/u, '');
    if (value.length === 0 || customTags.includes(value) || customTags.length >= 10) return;
    setCustomTags([...customTags, value]); setCustomTag('');
  };
  const toggleMustFollow = (item: string): void => {
    if (selectedMustFollow.includes(item)) {
      setSelectedMustFollow(selectedMustFollow.filter((value) => value !== item));
      return;
    }
    if (item === '无额外限制') {
      setSelectedMustFollow(['无额外限制']);
      setMustFollowText('');
      return;
    }
    if (mustFollow.length >= 12) return;
    setSelectedMustFollow([...selectedMustFollow.filter((value) => value !== '无额外限制'), item]);
  };
  const applySynopsisSuggestions = (analysis: OpeningSynopsisAnalysisData): void => {
    if (taxonomy === null || analysis.taxonomyVersion !== taxonomy.version) {
      throw new Error('分类目录已经变化，请刷新开书页面后重新识别');
    }
    const suggestion = analysis.suggestions;
    let applied = 0;
    let kept = 0;
    const fillText = (current: string, next: string | null, setter: (value: string) => void): void => {
      if (next === null || next.trim().length === 0) return;
      if (current.trim().length > 0) { kept += 1; return; }
      setter(next); applied += 1;
    };
    fillText(title, suggestion.title, setTitle);
    const resolvedChannel = channel ?? suggestion.channel;
    if (suggestion.channel !== null) {
      if (channel === null) { setChannel(suggestion.channel); applied += 1; }
      else if (channel !== suggestion.channel) kept += 1;
    }
    if (suggestion.categoryKey !== null) {
      const suggestedCategory = taxonomy.categories.find((item) => item.key === suggestion.categoryKey);
      if (categoryKey !== null) kept += 1;
      else if (suggestedCategory?.channel === resolvedChannel) { setCategoryKey(suggestion.categoryKey); applied += 1; }
    }
    if (suggestion.protagonist !== null) {
      const first = protagonists[0];
      if (first !== undefined) {
        const next = { ...first };
        let protagonistApplied = false;
        if (first.name.trim().length === 0) { next.name = suggestion.protagonist.name; protagonistApplied = true; }
        else kept += 1;
        if (suggestion.protagonist.age !== null) {
          if (first.age.trim().length === 0) { next.age = suggestion.protagonist.age; protagonistApplied = true; }
          else kept += 1;
        }
        if (suggestion.protagonist.background !== null) {
          if (first.background.trim().length === 0) { next.background = suggestion.protagonist.background; protagonistApplied = true; }
          else kept += 1;
        }
        const mergedPersonalities = [...new Set([...first.personalities, ...suggestion.protagonist.personalities])].slice(0, 6);
        if (mergedPersonalities.length > first.personalities.length) {
          next.personalities = mergedPersonalities; protagonistApplied = true;
        }
        if (first.name.trim().length === 0 && first.age.trim().length === 0 && first.background.trim().length === 0) {
          next.role = suggestion.protagonist.role;
        }
        if (protagonistApplied) { updateProtagonist(0, next); applied += 1; }
      }
    }
    fillText(worldBackground, suggestion.worldBackground, setWorldBackground);
    fillText(openingBackground, suggestion.openingBackground, setOpeningBackground);
    fillText(stageStart, suggestion.stageOne.start, setStageStart);
    fillText(stageDevelopment, suggestion.stageOne.development, setStageDevelopment);
    fillText(stageEnd, suggestion.stageOne.end, setStageEnd);
    fillText(fullBookOutline, suggestion.fullBookOutline, setFullBookOutline);
    fillText(initialMap, suggestion.initialMap, setInitialMap);
    const mergeTags = (current: string[], next: string[], max: number, setter: (value: string[]) => void): void => {
      const merged = [...new Set([...current, ...next])].slice(0, max);
      if (merged.length > current.length) { setter(merged); applied += 1; }
    };
    mergeTags(mainTags, suggestion.mainTags, 5, setMainTags);
    mergeTags(auxiliaryTags, suggestion.auxiliaryTags, 8, setAuxiliaryTags);
    mergeTags(storyTraits, suggestion.storyTraits, 8, setStoryTraits);
    if (suggestion.mustFollow.length > 0) {
      if (selectedMustFollow.includes('无额外限制')) kept += 1;
      else mergeTags(selectedMustFollow, suggestion.mustFollow, Math.max(0, 12 - customMustFollow.length), setSelectedMustFollow);
    }
    const unresolved = analysis.unresolvedFields.length;
    setSynopsisFeedback({
      kind: 'success',
      message: `已填入 ${applied} 项建议，保留 ${kept} 项已有内容。${unresolved > 0 ? `还有 ${unresolved} 项需要您确认。` : '所有识别结果仍可修改。'}`
    });
  };
  const runSynopsisAnalysis = (): void => {
    const value = synopsis.trim();
    if (value.length === 0 || value.length > 5_000 || taxonomy === null || synopsisBusy) return;
    setSynopsisBusy(true);
    setSynopsisFeedback(null);
    void analyzeOpeningSynopsis(value)
      .then(applySynopsisSuggestions)
      .catch((reason: unknown) => setSynopsisFeedback({
        kind: 'error',
        message: reason instanceof Error ? reason.message : '剧情梗概识别暂时没有完成，请重试或继续手工填写'
      }))
      .finally(() => setSynopsisBusy(false));
  };
  const submit = (): void => {
    if (!valid || taxonomy === null || channel === null || category === null) return;
    const openingBlueprint: OpeningBlueprintData = {
      taxonomyVersion: taxonomy.version,
      channel,
      categoryKey: category.key,
      protagonists: protagonists.map((item) => ({
        ...item, name: item.name.trim(), age: item.age.trim(), background: item.background.trim()
      })),
      worldBackground: worldBackground.trim(), openingBackground: openingBackground.trim(),
      stageOne: { start: stageStart.trim(), development: stageDevelopment.trim(), end: stageEnd.trim() },
      fullBookOutline: fullBookOutline.trim(), mainTags, auxiliaryTags, storyTraits, customTags,
      initialMap: initialMap.trim(), mustFollow
    };
    void onCreate({
      title: title.trim(), text: openingBlueprint.fullBookOutline, category: category.name,
      classification: channel === 'male' ? '男频' : '女频',
      tags: [category.name, ...mainTags, ...auxiliaryTags, ...storyTraits, ...customTags, ...mustFollow.map((item) => `必须遵守：${item}`)],
      openingBlueprint
    });
  };

  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="dialog create-book-dialog complete-create-book-dialog" role="dialog" aria-modal="true" aria-labelledby="complete-create-book-title">
      <div className="dialog-heading create-book-header"><div><span className="dialog-eyebrow">完整开书</span><h2 id="complete-create-book-title">创建一本新书</h2><p>先把确定的信息交给团队；填写“待讨论”也比系统擅自猜测更可靠。</p></div><button className="icon-button" type="button" aria-label="关闭创建新书" onClick={onCancel}><XIcon /></button></div>
      <div className="complete-create-book-body">
        <div className="opening-primary-stack">
          <section className="opening-form-section">
          <div className="section-heading"><div><span>01</span><h3>书籍与分类</h3></div><small>全部必填</small></div>
          <label htmlFor="complete-book-title">书名</label>
          <input id="complete-book-title" aria-label="书名" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：长安簪影" autoFocus />
          <fieldset className="channel-fieldset"><legend>创作频道</legend><div className="channel-options">{OPENING_CHANNELS.map((item) => <label className={channel === item.id ? 'channel-option selected' : 'channel-option'} key={item.id}><input type="radio" name="complete-book-channel" aria-label={item.label} checked={channel === item.id} onChange={() => {
            setChannel(item.id); setCategoryKey(null); setMainTags([]);
            if (protagonists.length === 1 && protagonists[0]?.name.trim().length === 0) updateProtagonist(0, { role: item.id === 'male' ? 'male_lead' : 'female_lead' });
          }} /><span><strong>{item.label}</strong><small>{item.description}</small></span></label>)}</div></fieldset>
          <div className="taxonomy-heading"><strong>作品分类</strong><small>{taxonomy?.sourceLabel ?? '正在加载分类目录'}</small></div>
          {taxonomyError !== null && <p className="inline-error" role="alert">{taxonomyError}</p>}
          <div className="category-options">{categories.map((item) => <button className={categoryKey === item.key ? 'category-choice selected' : 'category-choice'} type="button" aria-label={`${categoryKey === item.key ? '取消' : '选择'}作品分类：${item.name}`} key={item.key} onClick={() => { setCategoryKey(item.key); setMainTags([]); }}><strong>{item.name}</strong><small>{item.description}</small></button>)}</div>
          {taxonomy !== null && <p className="taxonomy-notice">目录版本 {taxonomy.version} · {taxonomy.notice}</p>}
          </section>

          <section className="opening-form-section synopsis-analysis-section">
            <div className="section-heading"><div><span>AI</span><h3>剧情梗概快速识别</h3></div><small>可选</small></div>
            <p className="synopsis-analysis-intro">粘贴您已经写好的剧情梗概，小文秘书会本地扫描分类、标签和基础信息，减少重复填写。</p>
            <label htmlFor="opening-synopsis">剧情梗概
              <textarea
                id="opening-synopsis"
                aria-label="剧情梗概"
                maxLength={5_000}
                rows={9}
                value={synopsis}
                onChange={(event) => { setSynopsis(event.target.value); setSynopsisFeedback(null); }}
                placeholder="可以直接粘贴一整段，也可以写“书名：”“主角：”“世界观背景：”等标题，带标题时识别更准确。"
              />
            </label>
            <div className="synopsis-analysis-actions">
              <span aria-live="polite">{synopsis.length} / 5000</span>
              <button
                type="button"
                className="secondary-button"
                disabled={synopsis.trim().length === 0 || synopsis.length > 5_000 || taxonomy === null || synopsisBusy}
                onClick={runSynopsisAnalysis}
              >
                {synopsisBusy ? '正在识别' : synopsisFeedback?.kind === 'error' ? '重新识别' : '识别并填写'}
              </button>
            </div>
            {synopsisFeedback !== null && <p
              className={`synopsis-analysis-feedback ${synopsisFeedback.kind}`}
              role={synopsisFeedback.kind === 'error' ? 'alert' : 'status'}
            >{synopsisFeedback.message}</p>}
            <p className="synopsis-analysis-note">结果只是可修改建议；不会覆盖已填内容，也不会单独保存原始梗概或写入正史。</p>
          </section>
        </div>

        <section className="opening-form-section protagonist-section">
          <div className="section-heading"><div><span>02</span><h3>初始主角</h3></div><button className="text-button" type="button" disabled={protagonists.length >= 8} onClick={() => setProtagonists([...protagonists, { role: 'co_lead', name: '', age: '', background: '', personalities: [] }])}>+ 增加主角（{protagonists.length}/8）</button></div>
          {protagonists.map((protagonist, index) => <article className="protagonist-form-card" key={index}>
            <header><strong>主角 {index + 1}</strong>{protagonists.length > 1 && <button type="button" aria-label={`删除主角${index + 1}`} onClick={() => setProtagonists(protagonists.filter((_, itemIndex) => itemIndex !== index))}>删除</button>}</header>
            <div className="form-row two"><label htmlFor={`protagonist-role-${index}`}>主角身份<select id={`protagonist-role-${index}`} aria-label="主角身份" value={protagonist.role} onChange={(event) => updateProtagonist(index, { role: event.target.value as ProtagonistRole })}>{PROTAGONIST_ROLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label htmlFor={`protagonist-name-${index}`}>姓名<input id={`protagonist-name-${index}`} aria-label="主角姓名" maxLength={80} value={protagonist.name} onChange={(event) => updateProtagonist(index, { name: event.target.value })} /></label></div>
            <label htmlFor={`protagonist-age-${index}`}>年龄或生命阶段<input id={`protagonist-age-${index}`} aria-label="主角年龄" maxLength={80} value={protagonist.age} onChange={(event) => updateProtagonist(index, { age: event.target.value })} placeholder="例如：十八岁；不知道可填待讨论" /></label>
            <label htmlFor={`protagonist-background-${index}`}>人物背景<textarea id={`protagonist-background-${index}`} aria-label="主角人物背景" maxLength={2000} rows={3} value={protagonist.background} onChange={(event) => updateProtagonist(index, { background: event.target.value })} /></label>
            <div className="compact-tag-heading"><strong>性格选项</strong><small>至少1个，最多6个</small></div>
            <div className="tag-options">{(taxonomy?.personalityOptions ?? []).map((item) => <button className={protagonist.personalities.includes(item) ? 'tag-choice selected' : 'tag-choice'} type="button" aria-pressed={protagonist.personalities.includes(item)} aria-label={`${protagonist.personalities.includes(item) ? '取消' : '选择'}性格：${item}`} key={item} onClick={() => toggleProtagonistPersonality(index, item)}>{item}</button>)}</div>
          </article>)}
        </section>

        <section className="opening-form-section story-opening-section">
          <div className="section-heading"><div><span>03</span><h3>故事基础与第一阶段</h3></div><small>参考资料，不直接成为正史</small></div>
          <OpeningTextarea id="world-background" label="世界观背景" value={worldBackground} onChange={setWorldBackground} placeholder="时代、社会、世界运行方式；不知道的部分可以写待讨论。" />
          <OpeningTextarea id="opening-background" label="故事起始背景" value={openingBackground} onChange={setOpeningBackground} placeholder="故事开始时，主角身处什么处境？" />
          <div className="stage-one-grid"><OpeningTextarea id="stage-start" label="第一阶段起始剧情" value={stageStart} onChange={setStageStart} /><OpeningTextarea id="stage-development" label="第一阶段发展剧情" value={stageDevelopment} onChange={setStageDevelopment} /><OpeningTextarea id="stage-end" label="第一阶段结束剧情" value={stageEnd} onChange={setStageEnd} /></div>
          <OpeningTextarea id="full-book-outline" label="全书简介（故事主线和结果）" value={fullBookOutline} onChange={setFullBookOutline} rows={4} placeholder="这是团队内部规划资料，不会直接当作对外简介发布。" />
          <OpeningTextarea id="initial-map" label="初始地图" value={initialMap} onChange={setInitialMap} placeholder="开篇主角所在的地点与周边关键位置。" />
        </section>

        <section className="opening-form-section tag-direction-section">
          <div className="section-heading"><div><span>04</span><h3>主要方向与边界</h3></div><small>主要标签2—5个</small></div>
          <div className="creative-freedom-note"><TagIcon /><div><strong>主要选择 + 其他自由发挥</strong><p>标签只确定主要方向，不是每章清单；未选择的元素也可以随剧情自然加入。</p></div></div>
          <label htmlFor="opening-tag-search">搜索标签<input id="opening-tag-search" aria-label="搜索标签" value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} placeholder="高武、群像、探案……" /></label>
          <StringTagPicker title="主要标签" hint={`已选 ${mainTags.length} 个主要标签`} kind="主要标签" options={matchingTags(mainTagOptions)} selected={mainTags} onToggle={(item) => toggleTag(item, mainTags, setMainTags, 5)} />
          <StringTagPicker title="辅助题材" hint="可选，最多8个" kind="辅助题材" options={matchingTags(taxonomy?.auxiliaryTags ?? [])} selected={auxiliaryTags} onToggle={(item) => toggleTag(item, auxiliaryTags, setAuxiliaryTags, 8)} />
          <StringTagPicker title="全书特点" hint="可选，最多8个" kind="全书特点" options={matchingTags(taxonomy?.storyTraits ?? [])} selected={storyTraits} onToggle={(item) => toggleTag(item, storyTraits, setStoryTraits, 8)} />
          <div className="custom-tag-row"><label htmlFor="complete-custom-tag">自定义标签</label><div><input id="complete-custom-tag" aria-label="自定义标签" maxLength={40} value={customTag} onChange={(event) => setCustomTag(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomTag(); } }} /><button type="button" aria-label="添加自定义标签" onClick={addCustomTag}><PlusIcon />添加</button></div></div>
          {customTags.length > 0 && <div className="selected-tag-strip">{customTags.map((item) => <button type="button" aria-label={`移除自定义标签：${item}`} key={item} onClick={() => setCustomTags(customTags.filter((tag) => tag !== item))}>{item}<XIcon /></button>)}</div>}
          <details className="boundary-panel" open>
            <summary><span><ShieldCheckIcon /><strong>必须遵守</strong></span><small>{mustFollow.length}/12 条</small></summary>
            <p>这里只选择您明确不能接受的内容；它们是作品硬边界。没有额外边界可直接选择“无额外限制”。</p>
            <section><header><strong>快速选择</strong><small>与下方自定义内容合计最多12条</small></header><div className="tag-options"><button className={selectedMustFollow.includes('无额外限制') ? 'tag-choice selected hard' : 'tag-choice hard'} type="button" aria-pressed={selectedMustFollow.includes('无额外限制')} aria-label={`${selectedMustFollow.includes('无额外限制') ? '取消' : '选择'}必须遵守：无额外限制`} onClick={() => toggleMustFollow('无额外限制')}>无额外限制</button></div></section>
            {(taxonomy?.boundaryGroups ?? []).map((group) => <section key={group.name}><header><strong>{group.name}</strong><small>{group.description}</small></header><div className="tag-options">{group.options.map((item) => {
              const selected = selectedMustFollow.includes(item);
              return <button className={selected ? 'tag-choice selected hard' : 'tag-choice hard'} type="button" aria-pressed={selected} aria-label={`${selected ? '取消' : '选择'}必须遵守：${item}`} key={item} onClick={() => toggleMustFollow(item)}>{selected && <CheckCircleIcon />}{item}</button>;
            })}</div></section>)}
            <section className="boundary-custom-field"><label htmlFor="must-follow">自定义必须遵守<textarea id="must-follow" aria-label="自定义必须遵守" maxLength={6000} rows={3} value={mustFollowText} onChange={(event) => { setMustFollowText(event.target.value); if (event.target.value.trim().length > 0) setSelectedMustFollow((items) => items.filter((item) => item !== '无额外限制')); }} placeholder="每行一条；例如：不靠巧合解决核心冲突" /></label>{mustFollow.length > 12 && <small className="inline-error" role="alert">必须遵守最多12条，请减少{mustFollow.length - 12}条。</small>}</section>
          </details>
        </section>
      </div>
      <footer className="create-book-footer"><div><strong>{title.trim() || '未命名新书'}</strong><span>{channel === null ? '请选择频道' : channel === 'male' ? '男频' : '女频'} · {category?.name ?? '未选分类'} · {mainTags.length}/2—5 个主要标签</span></div><div><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="primary-button" type="button" disabled={!valid || busy} onClick={submit}>{busy ? '正在创建' : '确认建书'}</button></div></footer>
    </section>
  </div>;
}

function OpeningTextarea({ id, label, value, onChange, rows = 3, placeholder }: {
  id: string; label: string; value: string; onChange: (value: string) => void; rows?: number; placeholder?: string;
}): React.JSX.Element {
  return <label htmlFor={id}>{label}<textarea id={id} aria-label={label} rows={rows} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

function StringTagPicker({ title, hint, kind, options, selected, onToggle }: {
  title: string; hint: string; kind: string; options: string[]; selected: string[]; onToggle: (name: string) => void;
}): React.JSX.Element {
  return <section className="tag-picker"><header><strong>{title}</strong><small>{hint}</small></header><div className="tag-options">{options.map((name) => {
    const active = selected.includes(name);
    return <button className={active ? 'tag-choice selected' : 'tag-choice'} type="button" aria-pressed={active} aria-label={`${active ? '取消' : '选择'}${kind}：${name}`} key={name} onClick={() => onToggle(name)}>{active && <CheckCircleIcon />}{name}</button>;
  })}</div></section>;
}

function ArchiveBookDialog({ book, busy, onCancel, onConfirm }: { book: BookData; busy: boolean; onCancel: () => void; onConfirm: () => Promise<void> }): React.JSX.Element {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><section className="dialog archive-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-book-title"><div className="dialog-heading"><div><span className="dialog-eyebrow">整理书架</span><h2 id="archive-book-title">归档《{book.title}》</h2><p>归档后会从主书架收起，不会删除正文、正史或资料，可以随时恢复。</p></div><button className="icon-button" type="button" aria-label="关闭归档确认" onClick={onCancel}><XIcon /></button></div><div className="archive-impact"><ArchiveBoxIcon /><span><strong>本次操作可逆</strong><small>书籍停止作为当前创作对象，数据原样保留。</small></span></div><footer><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="primary-button" type="button" disabled={busy} onClick={() => void onConfirm()}>{busy ? '正在归档' : '确认归档'}</button></footer></section></div>;
}

function PurgeBookDialog({ book, busy, onCancel, onConfirm }: {
  book: BookData;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (confirmationText: string) => Promise<void>;
}): React.JSX.Element {
  const required = 'YES';
  const [confirmation, setConfirmation] = useState('');
  const valid = confirmation.trim().toUpperCase() === required;
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="dialog purge-dialog" role="dialog" aria-modal="true" aria-labelledby="purge-book-title">
      <div className="dialog-heading"><div><span className="dialog-eyebrow danger">不可恢复</span><h2 id="purge-book-title">彻底删除《{book.title}》</h2><p>这会永久删除本书的正文、正史、资料、任务、对话与附件，并写入删除墓碑。删除后无法恢复。</p></div><button className="icon-button" type="button" aria-label="关闭永久删除确认" onClick={onCancel}><XIcon /></button></div>
      <div className="purge-impact"><TrashIcon /><span><strong>只删除这一本已归档书</strong><small>其他书籍不会受到影响；本操作不提供撤销。</small></span></div>
      <label className="purge-confirmation"><span>请输入 YES 确认</span><code>{required}</code><input autoComplete="off" spellCheck={false} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-label="永久删除确认词" />{confirmation.length > 0 && !valid && <small className="purge-confirmation-error" role="alert">确认词不匹配，请输入 YES。</small>}</label>
      <footer><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="danger-button" type="button" disabled={busy || !valid} onClick={() => void onConfirm(required)}>{busy ? '正在彻底删除' : '彻底删除'}</button></footer>
    </section>
  </div>;
}

function chapterStatus(chapter: ChapterData, tasks: TaskData[] = []): string {
  const task = tasks.find((item) => item.chapterId === chapter.chapterId && isActiveTask(item.status));
  if (task?.status === 'waiting_confirmation') return '待老板确认';
  if (task?.status === 'blocked' || task?.status === 'failed') return '受阻';
  if (task?.currentPhase === 'review' || task?.currentPhase === 'hard_check' || task?.currentPhase === 'rewrite') return '待点评或修订';
  if (chapter.settlementStatus === 'settled') return '正史已结算';
  if (chapter.generationStatus === 'working') return '创作中';
  if (chapter.generationStatus === 'paused') return '已暂停';
  if (chapter.generationStatus === 'failed') return '需要处理';
  if (chapter.generationStatus === 'completed') return '待老板确认';
  if (chapter.planStatus === 'candidate') return '章纲候选';
  return '已规划';
}

function taskLabel(type: string): string {
  if (type === 'chapter_creation') return '章节创作';
  if (type === 'chapter_write') return '正文写作';
  if (type === 'discussion') return '团队讨论';
  if (type === 'conversation_reply') return '主编回复';
  return type;
}

function taskGoal(task: TaskData, chapter: string): string {
  if (task.taskType === 'conversation_reply') return '由活动主编读取当前书籍的有界上下文并真实回复老板；不自动修改长期记忆或正史。';
  if (task.taskType === 'discussion') {
    const scopeText = typeof task.brief.scopeText === 'string' ? task.brief.scopeText : '当前创作问题';
    return `围绕“${scopeText}”收集相关岗位真实意见，由主编汇总后等待老板明确确认。`;
  }
  return `完成${chapter}的${taskLabel(task.taskType)}，通过三异模型点评后等待老板确认，接受后才进入正史结算。`;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = { pending: '待执行', queued: '排队中', working: '工作中', waiting_confirmation: '待老板确认', paused: '已暂停', failed: '失败', succeeded: '已完成', cancelled: '已取消', blocked: '已阻断', interrupted: '已中断' };
  return labels[status] ?? status;
}

function bookStatusLabel(status: string): string {
  return ({ active: '创作中', archived: '已归档' } as Record<string, string>)[status] ?? status;
}

function phaseLabel(phase: string): string {
  const labels: Record<string, string> = { reply: '组织回复', collecting: '收集岗位意见', preflight: '预检', context: '组装上下文', draft: '生成完整初稿', hard_check: '硬规则检查', review: '三异模型点评', rewrite: '定点重写', owner_confirmation: '等待老板确认', facts: '确认后事实提取', settlement: '正史结算', completed: '已完成' };
  return labels[phase] ?? phase;
}

function isActiveTask(status: string): boolean {
  return ['pending', 'queued', 'working', 'waiting_confirmation', 'paused', 'blocked', 'interrupted'].includes(status);
}

function taskChapterLabel(task: TaskData, workspace: WorkspaceData): string {
  const chapter = workspace.chapters.find((item) => item.chapterId === task.chapterId);
  const briefNumber = task.brief !== undefined && typeof task.brief.chapterNumber === 'number' ? task.brief.chapterNumber : null;
  const chapterNumber = chapter?.chapterNumber ?? briefNumber;
  return chapterNumber === null || chapterNumber === undefined ? '全书' : `第${chapterNumber}章`;
}

function taskChapterFromBrief(task: TaskData): string {
  const number = typeof task.brief.chapterNumber === 'number' ? task.brief.chapterNumber : null;
  return number === null ? '全书任务' : `第 ${number} 章`;
}

function taskCheckpointLabel(checkpoint: Record<string, unknown>): string {
  if (Object.keys(checkpoint).length === 0) return '尚未写入检查点';
  const completedPhase = typeof checkpoint.completedPhase === 'string' ? phaseLabel(checkpoint.completedPhase) : null;
  return completedPhase === null ? '已保存可恢复检查点' : `已完成：${completedPhase}`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function formatPercent(value: number): string {
  return Number.isFinite(value) ? `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` : '未知';
}

function parseRecordJson(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return null;
  try { const parsed = JSON.parse(value) as unknown; return isRecord(parsed) ? parsed : null; } catch { return null; }
}

function reviewerRoleLabel(value: string): string {
  return ({ fact: '事实与连续性席', literary: '文学与AI腔席', experience: '体验与内容风险席' } as Record<string, string>)[value] ?? value;
}

function reviewVerdictLabel(value: string): string {
  return ({ pass: '通过', rewrite: '需要定点修订', blocked: '阻断并等待处理' } as Record<string, string>)[value] ?? value;
}

function riskLevelLabel(value: string): string {
  return ({ none: '未发现', low: '低', medium: '中', high: '高', blocked: '阻断' } as Record<string, string>)[value] ?? value;
}

function graphTarget(value: unknown): string {
  if (isRecord(value)) return String(value.name ?? value.canonicalName ?? value.entityId ?? Object.values(value)[0] ?? '未知');
  if (Array.isArray(value)) return value.map(formatValue).join('、') || '未知';
  return formatValue(value);
}

function clampPercent(value: number): number { return Math.max(3, Math.min(97, value)); }

function budgetModeLabel(mode: string | undefined): string {
  const labels: Record<string, string> = { saving: '省钱', standard: '标准', fine: '精细' };
  return mode === undefined ? '未建立' : labels[mode] ?? mode;
}

function confirmationLabel(targetType: string): string {
  if (targetType === 'fact') return '重大正史事实';
  if (targetType === 'manuscript') return '正式正文确认';
  return `重大确认：${targetType}`;
}

function roleSummary(roleKey: string): string {
  return ({
    chief_editor: '主持讨论、拆工单并综合验收', deputy_editor: '检查遗漏并在必要时接管主编',
    lead_screenwriter: '独立设计剧情、因果和章节跨度', second_screenwriter: '用异模型提出结构不同的剧情方案',
    setting: '维护世界规则、时间线和人物状态', lead_writer: '把确认工单写成完整章节', backup_writer: '接管主笔或生成受命候选稿',
    literary_reviewer: '点评文学表达、语言和AI腔风险', experience_reviewer: '评估追读体验与政治情色风险',
    researcher: '按需核验现实资料和来源', copyright: '执行原创、版权和干净室门禁',
    plot_architect: '设计剧情结构与因果', continuity: '维护设定与连续性', writer: '完成正式章节', reviewer: '检查逻辑与文风',
    reader_experience: '评估读者体验', style_editor: '精修对白与语言'
  } as Record<string, string>)[roleKey] ?? '按岗位合同完成本书任务';
}

function uniqueProfiles(capabilities: CapabilityData | null, bindings: ModelBindingsData): TeamModelProfileData[] {
  const candidates: TeamModelProfileData[] = [
    ...(capabilities?.modelRuntime.profiles ?? []).map((profile) => ({ provider: profile.provider, modelId: profile.modelId, plan: profile.plan })),
    ...bindings.active.map((binding) => ({ provider: binding.provider, modelId: binding.modelId, plan: binding.plan }))
  ];
  return candidates.filter((profile, index, all) => all.findIndex((item) => modelProfileValue(item) === modelProfileValue(profile)) === index);
}

function modelProfileValue(profile: TeamModelProfileData): string {
  return `${profile.provider}\n${profile.modelId}\n${profile.plan}`;
}

function artifactTypeLabel(type: string): string {
  return ({ creative_plan: '全书框架', story_bible: '故事圣经（按职责分区显示）', master_outline: '全书总纲', volume_outline: '当前卷纲', chapter_outline: '滚动章纲', writing_contract: '写作契约' } as Record<string, string>)[type] ?? type;
}

function authorityLabel(status: string): string {
  return ({ active: '活动正史', approved: '已确认', confirmed: '已确认', candidate: '候选', proposed: '待确认', derived: '分析投影', archived: '已归档', superseded: '历史版本' } as Record<string, string>)[status] ?? status;
}

function entityTypeLabel(type: string): string {
  return ({ character: '角色', location: '地点', organization: '势力', item: '道具', resource: '资源', skill: '技能', stat_panel: '数值面板', world_rule: '规则', event: '事件', foreshadowing: '伏笔', hook: '钩子' } as Record<string, string>)[type] ?? type;
}

function fieldLabel(key: string): string {
  return ({
    title: '书名', genre: '题材', sourceStatus: '来源状态', summary: '内容摘要', candidates: '候选',
    premise: '核心前提', audience: '目标读者', tone: '整体表达', constraints: '硬边界', confirmedRecommendation: '确认方案', alternatives: '保留备选',
    positioning: '作品定位', worldView: '世界观', worldRules: '世界规则', powerSystem: '力量体系', resourceSystem: '资源体系', equipmentTiers: '装备等级', economicRules: '经济规则', attributeFields: '属性字段',
    openingReference: '开书基本资料', worldBackground: '世界观参考', openingBackground: '故事起始背景', stageOne: '第一阶段剧情', fullBookOutline: '全书简介', initialMap: '初始地图', mustFollow: '必须遵守',
    characters: '初始人物', initialOrganizations: '初始势力', mainPlot: '主线', planningHistory: '规划沿革', openQuestions: '开放问题', tags: '主要标签', theme: '主题',
    acts: '推进阶段', endingDirection: '结局方向', volumeNumber: '卷号', goal: '目标', arcs: '故事弧', endingState: '卷末状态',
    chapterNumber: '章节', objective: '目标', beats: '场景节拍', hook: '章末钩子', status: '状态', track: '轨道',
    projection_type: '投影类型', chapter_number: '章节', canon_revision: '正史修订', content: '分析内容', sourceIds: '来源', rebuilt_at: '重建时间',
    canonical_name: '名称', entity_type: '类型', aliases: '别名', relation_key: '关系', value: '事实值', evidence: '证据', grade: '证据等级',
    namespace: '标签域', name: '名称', description: '说明', created_source: '创建者', assignment_count: '使用次数', diagnosis: '缺口说明', severity: '严重度',
    intentional_unknown: '刻意留白', narrative_goal: '叙事目标', from_name: '起点', toValue: '终点或值', section: '区域', data: '内容'
  } as Record<string, string>)[key] ?? key.replaceAll('_', ' ');
}

function isTechnicalField(key: string): boolean {
  return ['owner_id', 'book_id', 'content_hash', 'model_snapshot_id', 'parameters_json', 'scope_json', 'impact_json'].includes(key);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '暂无';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return new Intl.NumberFormat('zh-CN').format(value);
  return String(value);
}

function arrayText(value: unknown, fallback: string): string {
  return Array.isArray(value) && value.length > 0 ? value.map(formatValue).join('、') : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLibraryData(value: unknown): value is LibraryData {
  return isRecord(value) && typeof value.canonRevision === 'number' && Array.isArray(value.entities) && Array.isArray(value.facts)
    && Array.isArray(value.relations) && Array.isArray(value.tags) && Array.isArray(value.projections) && Array.isArray(value.gaps) && isRecord(value.summary);
}

function isGraphWorkspaceData(value: unknown): value is GraphWorkspaceData {
  return isRecord(value) && Array.isArray(value.relations) && Array.isArray(value.projections);
}

function normalizeStateKey(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, '_').replace(/[^\p{L}\p{N}_-]/gu, '_').replace(/^([\p{N}-])/u, '_$1');
  return normalized.slice(0, 80) || '未命名';
}

function parseFormulaVariables(value: string): Array<{ key: string; label: string }> {
  const seen = new Set<string>();
  return value.split(/\r?\n/u).flatMap((line) => {
    const [rawKey, rawLabel] = line.split(':', 2);
    if (rawKey === undefined || !rawKey.trim()) return [];
    const key = normalizeStateKey(rawKey);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, label: rawLabel?.trim() || rawKey.trim() }];
  });
}

function emptyLibraryData(): LibraryData {
  return { canonRevision: 0, entities: [], facts: [], relations: [], tags: [], projections: [], gaps: [], summary: { entityCount: 0, factCount: 0, relationCount: 0, tagCount: 0, projectionCount: 0, openGapCount: 0 } };
}

function shortId(value: string): string {
  return value.length <= 10 ? value : value.slice(0, 8);
}

function readSelectedBook(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem('wenmi:selected-book');
  } catch {
    return null;
  }
}

function persistSelectedBook(bookId: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (bookId === null) localStorage.removeItem('wenmi:selected-book');
    else localStorage.setItem('wenmi:selected-book', bookId);
  } catch {
    // 无痕模式或受限WebView可能禁用本地存储；工作区仍可在当前会话使用。
  }
}
