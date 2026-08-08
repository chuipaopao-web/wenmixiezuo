import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
  MagicWandIcon,
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
  fetchRightsWorkspace,
  fetchTaskCenter,
  fetchWorker,
  fetchWorkspace,
  fetchTeamConfig,
  fetchTeamTemplate,
  fetchProtectedRolePrompt,
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
  retryTask,
  uploadChatAttachment,
  discardChatAttachment,
  chatAttachmentContentUrl,
  enterConversation,
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
  type ChatAttachmentData,
  type ConversationReceptionData,
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
import { cacheSnapshot, loadDraft, loadSnapshot, saveDraft } from '../lib/offline/offline-store';
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
import { RightsWorkspace } from '../features/rights/LegacyRightsWorkspace';
import { budgetModeLabel, confirmationLabel, formatBytes, formatNumber, formatTime, isActiveTask, phaseLabel, statusLabel, taskChapterFromBrief, taskChapterLabel, taskCheckpointLabel, taskGoal, taskLabel } from '../features/shared/task-presentation';
import { memberIdentity } from '../features/shared/agent-presentation';
import { AgentAvatar } from '../features/shared/AgentAvatar';
import { WorkspaceSkeleton } from '../features/shared/WorkspaceSkeleton';
import { ChatWorkspace, syncReceptionWithTask, type PendingChatAttachment } from '../features/collaboration/LegacyChatWorkspace';
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

type WorkspaceView = 'chat' | 'outline' | 'projections' | 'knowledge' | 'rights' | 'naming' | 'team';
type HomeView = 'shelf' | 'tasks' | 'team';
type PlanningTab = 'framework' | 'basic' | 'master' | 'chapter' | 'manuscript';

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
  const [conversationReception, setConversationReception] = useState<ConversationReceptionData | null>(null);
  const [view, setView] = useState<WorkspaceView>('chat');
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
    const poll = window.setInterval(() => {
      void refreshWorkspace(selectedBookId).catch(() => undefined);
    }, 5_000);
    return () => {
      controller.abort();
      window.clearInterval(poll);
    };
  }, [refreshWorkspace, selectedBookId]);

  useEffect(() => {
    if (selectedBookId === null || view !== 'chat') {
      setConversationReception(null);
      return;
    }
    const bookId = selectedBookId;
    const controller = new AbortController();
    void enterConversation(bookId, controller.signal)
      .then((reception) => {
        if (controller.signal.aborted) return;
        setConversationReception(reception);
        if (reception.kind === 'guidance_scheduled') {
          void refreshWorkspace(bookId, controller.signal).catch(() => undefined);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : '小文秘书暂时无法核对当前创作进度');
        }
      });
    return () => controller.abort();
  }, [refreshWorkspace, selectedBookId, view]);

  useEffect(() => {
    if (conversationReception?.taskId === undefined || workspace === null) return;
    const task = workspace.tasks.find((item) => item.taskId === conversationReception.taskId);
    if (task === undefined || task.status === conversationReception.taskStatus) return;
    setConversationReception((current) => current === null ? null : syncReceptionWithTask(current, task));
  }, [conversationReception?.taskId, conversationReception?.taskStatus, workspace]);

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
    const poll = window.setInterval(() => {
      void refreshHomeTasks().catch(() => undefined);
    }, 5_000);
    return () => {
      controller.abort();
      window.clearInterval(poll);
    };
  }, [homeView, refreshHomeTasks, selectedBookId]);

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
    if (view !== 'outline' || creationTab !== 'manuscript' || workspace === null || workspace.chapters.length === 0) return;
    if (selectedChapterId !== null && selectedChapter?.chapterId === selectedChapterId) return;
    const firstChapter = [...workspace.chapters].sort((left, right) => left.chapterNumber - right.chapterNumber)[0];
    if (firstChapter === undefined) return;
    setSelectedChapterId(firstChapter.chapterId);
    setSelectedChapter(firstChapter);
  }, [creationTab, selectedChapterId, selectedChapter?.chapterId, view, workspace]);

  useEffect(() => {
    if (selectedBookId === null || workspace === null || !['outline', 'knowledge', 'projections', 'rights'].includes(view)) return;
    const cacheKey = `${view}:${selectedBookId}`;
    const controller = new AbortController();
    const refreshReferenceData = async (useCacheFallback: boolean): Promise<void> => {
      const request = view === 'outline'
        ? fetchArtifacts(selectedBookId, controller.signal)
        : view === 'knowledge'
          ? fetchLibrary(selectedBookId, controller.signal)
          : view === 'projections'
            ? fetchGraphWorkspace(selectedBookId, controller.signal)
            : fetchRightsWorkspace(selectedBookId, controller.signal);
      try {
        const data = await request;
        if (controller.signal.aborted) return;
        setReferenceData(data);
        await cacheSnapshot(cacheKey, selectedBookId, workspace.book.canonRevision, data);
      } catch {
        if (!useCacheFallback || controller.signal.aborted) return;
        setReferenceData(await loadSnapshot<unknown[]>(cacheKey, workspace.book.canonRevision) ?? []);
      }
    };
    void refreshReferenceData(true);
    const poll = window.setInterval(() => void refreshReferenceData(false), 5_000);
    return () => {
      controller.abort();
      window.clearInterval(poll);
    };
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
    setSelectedTask(null);
    setView('chat');
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
    if (pendingAttachments.length > 0) {
      setError('返回书架前请先发送或移除当前附件，避免留下未引用资料。');
      return;
    }
    openHomeView('shelf');
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
      const messageBookId = selectedBookId;
      const sent = await sendMessage(messageBookId, outgoingContent, readyAttachments.map((item) => item.data!.attachmentId));
      if (sent.action.kind === 'knowledge_workspace_opened') setView('knowledge');
      if (!isQuickAction) {
        setComposer('');
        setPendingAttachments([]);
        await saveDraft(messageBookId, '');
      }
      if (sent.action.kind === 'task_overview') {
        openHomeView('tasks');
      } else {
        await refreshWorkspace(messageBookId);
      }
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '消息发送失败');
    } finally {
      setBusy(false);
    }
  };

  const createNewBook = async (input: Parameters<typeof createBook>[0]): Promise<boolean> => {
    if (pendingAttachments.length > 0) {
      setError('创建并切换新书前请先发送或移除当前附件。');
      return false;
    }
    setBusy(true);
    try {
      const created = await createBook(input);
      await loadBooks();
      selectBook(created.bookId);
      if (input.openingBlueprint?.creationMode === 'continuation') {
        setCreationTab('manuscript');
        setView('outline');
      } else {
        setView('chat');
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
          <button className="icon-button mobile-only" type="button" aria-label="打开书籍与功能" onClick={() => setLeftOpen(true)}><ListIcon /></button>
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

      <aside className={`left-rail ${leftOpen ? 'drawer-open' : ''}`} aria-label={selectedBook === null ? '首页功能' : '书籍与功能'}>
        <DrawerHeader title="书籍与功能" onClose={() => setLeftOpen(false)} />
        {selectedBook === null ? (
          <nav className="home-navigation" aria-label="首页功能">
            <RailViewButton active={homeView === 'shelf'} onClick={() => { setHomeView('shelf'); setLeftOpen(false); }} icon={<BooksIcon />} label="书架" />
            <RailViewButton active={homeView === 'tasks'} onClick={() => { setHomeView('tasks'); setLeftOpen(false); }} icon={<FileTextIcon />} label="任务" />
            <RailViewButton active={homeView === 'team'} onClick={() => { setHomeView('team'); setLeftOpen(false); }} icon={<UsersThreeIcon />} label="团队" />
            <button type="button" onClick={() => { setSettingsOpen(true); setLeftOpen(false); }}><GearSixIcon /><span>设置</span></button>
          </nav>
        ) : (
          <nav className="rail-navigation" aria-label="创作功能">
            <button className="back-to-shelf" type="button" onClick={returnToShelf}><BooksIcon /><span>返回书架</span></button>
            <RailViewButton active={view === 'chat'} onClick={() => { setView('chat'); setLeftOpen(false); }} icon={<ChatsCircleIcon />} label="对话" />
            <RailViewButton active={view === 'outline'} onClick={() => { setView('outline'); setLeftOpen(false); }} icon={<BookOpenTextIcon />} label="创作台" />
            <RailViewButton active={view === 'projections'} onClick={() => { setView('projections'); setLeftOpen(false); }} icon={<DatabaseIcon />} label="图谱" />
            <RailViewButton active={view === 'knowledge'} onClick={() => { setView('knowledge'); setLeftOpen(false); }} icon={<BrainIcon />} label="资料库" />
            <RailViewButton active={view === 'rights'} onClick={() => { setView('rights'); setLeftOpen(false); }} icon={<ShieldCheckIcon />} label="版权" accessibleLabel="版权与研究" />
            <RailViewButton active={view === 'naming'} onClick={() => { setView('naming'); setLeftOpen(false); }} icon={<MagicWandIcon />} label="取名" />
          </nav>
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
            {view === 'chat' && (
              <ChatWorkspace
                bookId={selectedBook.bookId}
                reception={conversationReception}
                messages={messages}
                agents={workspace?.agents ?? []}
                totalMessageCount={workspace?.messageCount ?? messages.length}
                creativeSession={workspace?.creativeSession ?? null}
                onboardingTask={workspace?.tasks.find((task) =>
                  task.taskType === 'conversation_reply' && task.brief.proactiveOnboarding === true
                ) ?? null}
                activeFlowTask={workspace?.tasks.find((task) =>
                  ['discussion', 'conversation_reply'].includes(task.taskType)
                  && task.brief.proactiveOnboarding !== true
                  && ['pending', 'queued', 'working'].includes(task.status)
                ) ?? null}
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
            {view === 'outline' && <PlanningWorkspace
              tab={creationTab}
              onTabChange={setCreationTab}
              data={referenceData}
              workspace={workspace}
              onBookProfileChanged={() => refreshWorkspace(selectedBook.bookId)}
              manuscript={<ManuscriptWorkspace
                key={selectedBook.bookId}
                workspace={workspace}
                selectedChapterId={selectedChapterId}
                chapter={selectedWorkspaceChapter ?? selectedChapter}
                reader={reader}
                detail={chapterDetail}
                onSelectChapter={(chapter) => { setSelectedChapterId(chapter.chapterId); setSelectedChapter(chapter); }}
                onChanged={() => void refreshWorkspace(selectedBook.bookId)}
                onOpenConversation={() => setView('chat')}
              />}
              onDiscussMasterOutline={async (plotPatternPacket = '') => {
                if (selectedBookId === null) return;
                setError(null);
                try {
                  await sendMessage(
                    selectedBookId,
                    `讨论阶段剧情 【阶段剧情抽卡资料包】请依据当前开书资料、已确认设定、反向拆解章纲和现有正式总纲，只规划下一个不超过50章、具有完整起承转合的大剧情。活动主编、副编与一名不同模型的编剧先分别思考，每人提出1个能独立成立的方案，共3案；每案说明剧情类型、放进本书后具体怎样发生、怎样结束、预计从哪章到哪章、主要爽点或压力、关键转折、伏笔和推荐理由。现在只给待选方案，不直接写总纲、章纲或正文；作者选择一案或融合多案后，再由主编整理确认稿。保留旧版本，不直接修改正式正文。${plotPatternPacket}`
                  );
                  setView('chat');
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : '剧情总纲升级讨论启动失败');
                }
              }}
            />}
            {view === 'knowledge' && <LibraryWorkspace data={referenceData} bookId={selectedBookId} />}
            {view === 'projections' && <ProjectionWorkspace data={referenceData} />}
            {view === 'rights' && <RightsWorkspace data={referenceData} />}
            {view === 'naming' && <NamingWorkspace book={selectedBook} />}
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
