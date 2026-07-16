import { useCallback, useEffect, useState } from 'react';
import {
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
  FileTextIcon,
  ListIcon,
  PaperPlaneTiltIcon,
  PlusIcon,
  ShieldCheckIcon,
  SidebarSimpleIcon,
  UsersThreeIcon,
  WifiHighIcon,
  WifiSlashIcon,
  XIcon
} from '@phosphor-icons/react';
import {
  createBook,
  fetchArtifacts,
  fetchBooks,
  fetchChapterContent,
  fetchHealth,
  fetchMemory,
  fetchMessages,
  fetchProjections,
  fetchRightsWorkspace,
  fetchWorker,
  fetchWorkspace,
  scheduleChapters,
  sendMessage,
  resolveConfirmation,
  type AgentData,
  type BookData,
  type ChapterData,
  type HealthData,
  type MessageData,
  type WorkerData,
  type WorkspaceData
} from '../lib/api/client';
import { cacheSnapshot, loadDraft, loadSnapshot, saveDraft } from '../lib/offline/offline-store';
import './app.css';

type WorkspaceView = 'chat' | 'outline' | 'manuscript' | 'projections' | 'knowledge' | 'rights';

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [worker, setWorker] = useState<WorkerData | null>(null);
  const [books, setBooks] = useState<BookData[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(() => readSelectedBook());
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [view, setView] = useState<WorkspaceView>('chat');
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [reader, setReader] = useState<{ content: string; offline: boolean } | null>(null);
  const [referenceData, setReferenceData] = useState<unknown[]>([]);
  const [composer, setComposer] = useState('');
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [readerMode, setReaderMode] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedBook = books.find((book) => book.bookId === selectedBookId) ?? null;

  const loadBooks = useCallback(async (signal?: AbortSignal) => {
    const nextBooks = await fetchBooks(signal);
    setBooks(nextBooks);
    setSelectedBookId((current) => {
      const next = current !== null && nextBooks.some((book) => book.bookId === current) ? current : nextBooks[0]?.bookId ?? null;
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
    Promise.all([fetchHealth(controller.signal), loadBooks(controller.signal), fetchWorker(controller.signal)])
      .then(([nextHealth, , nextWorker]) => {
        setHealth(nextHealth);
        setWorker(nextWorker);
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
    setReader(null);
    if (selectedBookId === null || selectedChapterId === null || workspace === null) return;
    const cacheKey = `chapter:${selectedBookId}:${selectedChapterId}`;
    const controller = new AbortController();
    void fetchChapterContent(selectedBookId, selectedChapterId, controller.signal)
      .then(async (content) => {
        setReader({ content: content.content, offline: false });
        await cacheSnapshot(cacheKey, selectedBookId, workspace.book.canonRevision, content.content);
      })
      .catch(async () => {
        const cached = await loadSnapshot<string>(cacheKey, workspace.book.canonRevision);
        if (cached !== null) setReader({ content: cached, offline: true });
      });
    return () => controller.abort();
  }, [selectedBookId, selectedChapterId, workspace?.book.canonRevision]);

  useEffect(() => {
    if (selectedBookId === null || workspace === null || !['outline', 'knowledge', 'projections', 'rights'].includes(view)) return;
    const cacheKey = `${view}:${selectedBookId}`;
    const controller = new AbortController();
    const request = view === 'outline'
      ? fetchArtifacts(selectedBookId, controller.signal)
      : view === 'knowledge'
        ? fetchMemory(selectedBookId, workspace.book.canonRevision, controller.signal)
        : view === 'projections'
          ? fetchProjections(selectedBookId, controller.signal)
          : fetchRightsWorkspace(selectedBookId, controller.signal);
    void request.then(async (data) => {
      setReferenceData(data);
      await cacheSnapshot(cacheKey, selectedBookId, workspace.book.canonRevision, data);
    }).catch(async () => {
      setReferenceData(await loadSnapshot<unknown[]>(cacheKey, workspace.book.canonRevision) ?? []);
    });
    return () => controller.abort();
  }, [selectedBookId, view, workspace?.book.canonRevision]);

  const selectBook = (bookId: string): void => {
    setSelectedBookId(bookId);
    persistSelectedBook(bookId);
    setSelectedChapterId(null);
    setView('chat');
    setLeftOpen(false);
  };

  const submitMessage = async (): Promise<void> => {
    if (selectedBookId === null || composer.trim().length === 0 || busy) return;
    const switchMatch = /^(?:切书|切换到)\s*[《「]?(.+?)[》」]?$/u.exec(composer.trim());
    if (switchMatch !== null) {
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
      await sendMessage(selectedBookId, composer);
      setComposer('');
      await saveDraft(selectedBookId, '');
      await refreshWorkspace(selectedBookId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '消息发送失败');
    } finally {
      setBusy(false);
    }
  };

  const createNewBook = async (title: string, text: string): Promise<void> => {
    setBusy(true);
    try {
      const created = await createBook({ title, text });
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

  const startWriting = async (count: 1 | 3 | 5): Promise<void> => {
    if (selectedBookId === null || busy) return;
    setBusy(true);
    try {
      await scheduleChapters(selectedBookId, count);
      await refreshWorkspace(selectedBookId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '章节安排失败');
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

  return (
    <div className={`app-shell ${readerMode ? 'reader-mode' : ''}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <button className="icon-button mobile-only" type="button" aria-label="打开书籍与目录" onClick={() => setLeftOpen(true)}><ListIcon /></button>
          <div className="brand-mark" aria-hidden="true">文</div>
          <div><h1>文秘写作</h1><span>本地小说工作台</span></div>
        </div>
        <div className="topbar-center">
          {selectedBook === null ? '尚未选择书籍' : <><strong>{selectedBook.title}</strong><span>正史 {selectedBook.canonRevision}</span></>}
        </div>
        <div className="topbar-actions">
          <ServiceState health={health} worker={worker} error={error} />
          {selectedBook !== null && (
            <button className="icon-button" type="button" aria-label={readerMode ? '退出沉浸阅读' : '进入沉浸阅读'} onClick={() => setReaderMode((value) => !value)}>
              {readerMode ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}
            </button>
          )}
          <button className="icon-button mobile-only" type="button" aria-label="打开团队与任务" onClick={() => setRightOpen(true)}><UsersThreeIcon /></button>
        </div>
      </header>

      <aside className={`left-rail ${leftOpen ? 'drawer-open' : ''}`} aria-label="书籍与章节">
        <DrawerHeader title="书籍与目录" onClose={() => setLeftOpen(false)} />
        <div className="rail-heading"><span>我的书</span><button className="small-icon-button" type="button" aria-label="创建新书" onClick={() => setCreateOpen(true)}><PlusIcon /></button></div>
        <nav className="book-switcher" aria-label="书籍列表">
          {books.map((book) => (
            <button className={book.bookId === selectedBookId ? 'book-button active' : 'book-button'} type="button" key={book.bookId} onClick={() => selectBook(book.bookId)}>
              <BooksIcon /><span><strong>{book.title}</strong><small>{book.status === 'active' ? '创作中' : book.status}</small></span><CaretRightIcon />
            </button>
          ))}
          {!loading && books.length === 0 && <p className="rail-empty">还没有书。创建后会在这里形成独立工作区。</p>}
        </nav>
        {workspace !== null && (
          <div className="chapter-tree">
            <div className="rail-heading"><span>第一卷</span><small>{workspace.chapters.length} 章</small></div>
            {workspace.chapters.map((chapter) => (
              <button className={selectedChapterId === chapter.chapterId ? 'chapter-button active' : 'chapter-button'} type="button" key={chapter.chapterId} onClick={() => { setSelectedChapterId(chapter.chapterId); setView('manuscript'); setLeftOpen(false); }}>
                <span className={`chapter-state ${chapter.settlementStatus}`} aria-hidden="true" />
                <span><strong>{chapter.chapterNumber}. {chapter.title}</strong><small>{chapterStatus(chapter)}</small></span>
              </button>
            ))}
            {workspace.chapters.length === 0 && <p className="rail-empty">章节尚未安排。可在对话区选择写1章或连续3至5章。</p>}
          </div>
        )}
        <div className="rail-links">
          <button type="button" onClick={() => { setView('outline'); setLeftOpen(false); }}><FileTextIcon />规划成果</button>
          <button type="button" onClick={() => { setView('knowledge'); setLeftOpen(false); }}><BrainIcon />知识与正史</button>
          <button type="button" onClick={() => { setView('rights'); setLeftOpen(false); }}><ShieldCheckIcon />版权与研究</button>
        </div>
      </aside>

      <main className="workspace-main">
        {error !== null && <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="关闭错误"><XIcon /></button></div>}
        {loading ? <WorkspaceSkeleton /> : selectedBook === null ? <EmptyLibrary onCreate={() => setCreateOpen(true)} /> : (
          <>
            <nav className="workspace-tabs" aria-label="工作区视图">
              <TabButton active={view === 'chat'} onClick={() => setView('chat')} icon={<ChatsCircleIcon />} label="对话" />
              <TabButton active={view === 'outline'} onClick={() => setView('outline')} icon={<FileTextIcon />} label="大纲" />
              <TabButton active={view === 'manuscript'} onClick={() => setView('manuscript')} icon={<BookOpenTextIcon />} label="正文" />
              <TabButton active={view === 'projections'} onClick={() => setView('projections')} icon={<DatabaseIcon />} label="图谱" />
              <TabButton active={view === 'knowledge'} onClick={() => setView('knowledge')} icon={<BrainIcon />} label="知识" />
              <TabButton active={view === 'rights'} onClick={() => setView('rights')} icon={<ShieldCheckIcon />} label="版权" />
            </nav>
            {view === 'chat' && (
              <ChatWorkspace messages={messages} totalMessageCount={workspace?.messageCount ?? messages.length} onWrite={startWriting} busy={busy} composer={composer} setComposer={setComposer} onSubmit={submitMessage} />
            )}
            {view === 'manuscript' && <ManuscriptView chapter={workspace?.chapters.find((item) => item.chapterId === selectedChapterId) ?? null} reader={reader} />}
            {view === 'outline' && <ReferenceView kind="outline" data={referenceData} />}
            {view === 'knowledge' && <ReferenceView kind="knowledge" data={referenceData} />}
            {view === 'projections' && <ReferenceView kind="projections" data={referenceData} />}
            {view === 'rights' && <ReferenceView kind="rights" data={referenceData} />}
          </>
        )}
      </main>

      <aside className={`right-rail ${rightOpen ? 'drawer-open' : ''}`} aria-label="团队与任务">
        <DrawerHeader title="团队与任务" onClose={() => setRightOpen(false)} />
        <Inspector workspace={workspace} worker={worker} busy={busy} onDecide={decideConfirmation} />
      </aside>

      {(leftOpen || rightOpen) && <button className="drawer-scrim mobile-only" type="button" aria-label="关闭抽屉" onClick={() => { setLeftOpen(false); setRightOpen(false); }} />}
      {createOpen && <CreateBookDialog busy={busy} onCancel={() => setCreateOpen(false)} onCreate={createNewBook} />}
    </div>
  );
}

function ServiceState({ health, worker, error }: { health: HealthData | null; worker: WorkerData | null; error: string | null }): React.JSX.Element {
  const ready = health?.status === 'ok' && worker?.status === 'ready' && error === null;
  return <div className={ready ? 'service-state ready' : 'service-state'} role="status" aria-live="polite">{ready ? <WifiHighIcon /> : <WifiSlashIcon />}<span>{ready ? '本地服务已就绪' : error === null ? '正在连接' : '服务不可用'}</span></div>;
}

function DrawerHeader({ title, onClose }: { title: string; onClose: () => void }): React.JSX.Element {
  return <div className="drawer-header mobile-only"><strong>{title}</strong><button className="icon-button" type="button" aria-label={`关闭${title}`} onClick={onClose}><XIcon /></button></div>;
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }): React.JSX.Element {
  return <button className={active ? 'tab-button active' : 'tab-button'} type="button" onClick={onClick}>{icon}<span>{label}</span></button>;
}

function ChatWorkspace(props: {
  messages: MessageData[];
  totalMessageCount: number;
  onWrite: (count: 1 | 3 | 5) => Promise<void>;
  busy: boolean;
  composer: string;
  setComposer: (value: string) => void;
  onSubmit: () => Promise<void>;
}): React.JSX.Element {
  const visibleMessages = props.messages.slice(-200);
  const hiddenMessageCount = Math.max(0, props.totalMessageCount - visibleMessages.length);
  return (
    <section className="chat-workspace" aria-label="主创作对话">
      <div className="conversation-stream" aria-live="polite">
        {props.messages.length === 0 ? (
          <div className="conversation-empty">
            <ChatsCircleIcon />
            <h2>从一句明确的指令开始</h2>
            <p>当前没有伪造的Agent发言。明确命令会零Token执行，开放式消息会保存并显示能力边界。</p>
            <div className="quick-actions">
              <button type="button" disabled={props.busy} onClick={() => void props.onWrite(1)}>写1章</button>
              <button type="button" disabled={props.busy} onClick={() => void props.onWrite(3)}>连续写3章</button>
              <button type="button" disabled={props.busy} onClick={() => void props.onWrite(5)}>连续写5章</button>
            </div>
          </div>
        ) : (
          <>
            {hiddenMessageCount > 0 && <p className="history-window-note">为保持工作区流畅，当前显示最近 200 条消息；更早的 {hiddenMessageCount} 条仍保存在本地记录中。</p>}
            {visibleMessages.map((message) => <MessageBubble key={message.message_id} message={message} />)}
          </>
        )}
      </div>
      <div className="composer-wrap">
        <label htmlFor="boss-message">给主编的消息</label>
        <div className="composer-box">
          <textarea id="boss-message" value={props.composer} onChange={(event) => props.setComposer(event.target.value)} placeholder="例如：写3章，或记录一个新的创作要求" rows={3} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void props.onSubmit(); }} />
          <button className="send-button" type="button" disabled={props.busy || props.composer.trim().length === 0} onClick={() => void props.onSubmit()}><PaperPlaneTiltIcon />发送</button>
        </div>
        <small>草稿保存在本机。Ctrl + Enter 发送。</small>
      </div>
    </section>
  );
}

function MessageBubble({ message }: { message: MessageData }): React.JSX.Element {
  const source = message.sender_type === 'boss' ? '老板' : message.sender_type === 'agent' ? message.role_key ?? 'Agent' : '系统';
  return (
    <article className={`message ${message.sender_type}`}>
      <header><strong>{source}</strong><time dateTime={message.created_at}>{formatTime(message.created_at)}</time></header>
      <p>{message.content}</p>
      {message.sender_type === 'agent' && <footer>{message.model_provider}/{message.model_id}</footer>}
    </article>
  );
}

function ManuscriptView({ chapter, reader }: { chapter: ChapterData | null; reader: { content: string; offline: boolean } | null }): React.JSX.Element {
  if (chapter === null) return <div className="view-empty"><BookOpenTextIcon /><h2>选择一章开始阅读</h2><p>左侧目录只显示当前书籍的不可变正文版本。</p></div>;
  return (
    <article className="manuscript-view">
      <header><span>第 {chapter.chapterNumber} 章</span><h2>{chapter.title}</h2><div>{chapter.settlementStatus === 'settled' ? <><CheckCircleIcon />正史已结算</> : <><ClockCountdownIcon />{chapterStatus(chapter)}</>}</div></header>
      {reader === null ? <div className="text-skeleton" aria-label="正在加载正文" /> : <><p className="offline-note">{reader.offline ? <><WifiSlashIcon />离线缓存，正史版本已校验</> : <><WifiHighIcon />当前正史正文</>}</p><div className="novel-text">{reader.content}</div></>}
    </article>
  );
}

function ReferenceView({ kind, data }: { kind: 'outline' | 'knowledge' | 'projections' | 'rights'; data: unknown[] }): React.JSX.Element {
  const copy = {
    outline: ['规划成果', '故事圣经、章纲与写作契约都保留版本和来源。'],
    knowledge: ['知识与正史', '这里只展示当前正史版本可用的活动记忆。'],
    projections: ['叙事图谱', '情绪、主支线、钩子和信息差均分计划轨与实际轨，可从正式成果重建。'],
    rights: ['版权与研究', '隔离原文不进入主笔上下文；研究结果只保存为带来源的候选。']
  } as const;
  const [title, description] = copy[kind];
  return (
    <section className="reference-view">
      <header><h2>{title}</h2><p>{description}</p></header>
      {data.length === 0 ? <div className="view-empty compact"><DatabaseIcon /><h3>尚无可展示内容</h3><p>{kind === 'rights' ? '当前没有版权隔离或研究记录。联网研究未执行时不会声称存在近期结论。' : '生成规划或完成章节结算后，这里会出现真实记录。'}</p></div> : (
        <div className="reference-grid">{data.slice(0, 20).map((item, index) => <pre key={index}>{JSON.stringify(item, null, 2)}</pre>)}</div>
      )}
    </section>
  );
}

function Inspector({ workspace, worker, busy, onDecide }: {
  workspace: WorkspaceData | null;
  worker: WorkerData | null;
  busy: boolean;
  onDecide: (confirmationId: string, expectedCanonRevision: number, accept: boolean) => Promise<void>;
}): React.JSX.Element {
  const coreAgents = workspace?.agents.filter((agent) => agent.category === 'core') ?? [];
  const specialists = workspace?.agents.filter((agent) => agent.category === 'specialist') ?? [];
  const currentTask = workspace?.tasks.find((task) => task.status === 'working') ?? workspace?.tasks.find((task) => task.status === 'queued') ?? null;
  const budgetRatio = workspace?.budget === null || workspace?.budget === undefined || workspace.budget.token_limit === 0
    ? 0
    : Math.round(((workspace.budget.spent_tokens + workspace.budget.reserved_tokens) / workspace.budget.token_limit) * 100);
  return (
    <div className="inspector-content">
      <section className="inspector-section">
        <div className="inspector-heading"><h2>团队</h2><span>{workspace?.agents.length ?? 0} 个岗位</span></div>
        <div className="agent-list">{coreAgents.map((agent) => <AgentRow key={agent.agentId} agent={agent} working={isAgentWorking(agent, currentTask, worker)} />)}</div>
        {specialists.length > 0 && <details><summary>按需专家 {specialists.length}</summary><div className="agent-list">{specialists.map((agent) => <AgentRow key={agent.agentId} agent={agent} working={isAgentWorking(agent, currentTask, worker)} />)}</div></details>}
      </section>
      <section className="inspector-section">
        <div className="inspector-heading"><h2>当前任务</h2><span>{workspace?.tasks.length ?? 0} 条记录</span></div>
        {currentTask === null ? <p className="inspector-empty">当前没有运行中的任务。</p> : <div className="task-summary"><strong>{taskLabel(currentTask.taskType)}</strong><span>{phaseLabel(currentTask.currentPhase)}</span><small>{statusLabel(currentTask.status)}，尝试 {currentTask.attemptCount} 次</small></div>}
      </section>
      <section className="inspector-section budget-section">
        <div className="inspector-heading"><h2>预算</h2><span>{budgetRatio}%</span></div>
        <div className="budget-numbers"><strong>{formatNumber(workspace?.budget?.spent_tokens ?? 0)}</strong><span> / {formatNumber(workspace?.budget?.token_limit ?? 0)} Token</span></div>
        <p>现金保护线 {((workspace?.budget?.cash_limit_micros ?? 0) / 1_000_000).toFixed(2)} 元</p>
      </section>
      <section className="inspector-section">
        <div className="inspector-heading"><h2>待确认</h2><span>{workspace?.confirmations.count ?? 0}</span></div>
        {(workspace?.confirmations.count ?? 0) === 0 ? <p className="inspector-empty">当前没有需要老板确认的重大事项。</p> : (
          <div className="confirmation-list">{workspace!.confirmations.items.map((confirmation) => (
            <article className="confirmation-card" key={confirmation.confirmationId}>
              <strong>{confirmationLabel(confirmation.targetType)}</strong>
              <span>对象 {shortId(confirmation.targetId)}，绑定正史 {confirmation.expectedCanonRevision}</span>
              <details><summary>查看范围与影响</summary><pre>{JSON.stringify({ scope: confirmation.scope, impact: confirmation.impact, estimatedCashCny: 0 }, null, 2)}</pre></details>
              <p>接受会解除相关门禁；模糊回复不会生效。</p>
              <div><button type="button" disabled={busy} onClick={() => void onDecide(confirmation.confirmationId, confirmation.expectedCanonRevision, false)}>拒绝</button><button className="confirm-button" type="button" disabled={busy} onClick={() => void onDecide(confirmation.confirmationId, confirmation.expectedCanonRevision, true)}>明确接受</button></div>
            </article>
          ))}</div>
        )}
      </section>
    </div>
  );
}

function AgentRow({ agent, working }: { agent: AgentData; working: boolean }): React.JSX.Element {
  const state = working ? '工作中' : agent.activationState === 'standby' ? '待命' : agent.activationState === 'paused' ? '已暂停' : '空闲';
  return <div className="agent-row"><span className={`agent-state ${working ? 'working' : agent.activationState}`} aria-hidden="true" /><div><strong>{agent.roleName}</strong><small>{agent.provider}/{agent.modelId}</small></div><em>{state}</em></div>;
}

function isAgentWorking(agent: AgentData, task: WorkspaceData['tasks'][number] | null, worker: WorkerData | null): boolean {
  return task?.status === 'working' && task.assignedAgentId === agent.agentId && worker?.worker?.currentTaskId === task.taskId;
}

function EmptyLibrary({ onCreate }: { onCreate: () => void }): React.JSX.Element {
  return <section className="empty-library"><div className="empty-glyph"><BooksIcon /></div><h2>把第一本书放进工作台</h2><p>用一句话描述题材与核心冲突。确认后会原子创建9个岗位、故事圣经、预算和主对话。</p><button className="primary-button" type="button" onClick={onCreate}><PlusIcon />创建新书</button></section>;
}

function WorkspaceSkeleton(): React.JSX.Element {
  return <div className="workspace-skeleton" aria-label="正在加载工作区"><span /><span /><span /><span /></div>;
}

function CreateBookDialog({ busy, onCancel, onCreate }: { busy: boolean; onCancel: () => void; onCreate: (title: string, text: string) => Promise<void> }): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const valid = text.trim().length >= 2;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-book-title">
        <header><div><h2 id="create-book-title">创建一本新书</h2><p>自然语言会先整理成定位卡，再由确认流程原子建书。</p></div><button className="icon-button" type="button" aria-label="关闭创建新书" onClick={onCancel}><XIcon /></button></header>
        <label htmlFor="book-title">书名</label>
        <input id="book-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="可以留空，由系统建议" />
        <label htmlFor="book-idea">核心创意</label>
        <textarea id="book-idea" value={text} onChange={(event) => setText(event.target.value)} placeholder="例如：一名失忆的守城人在每次钟响后都会看见未来一天的罪案" rows={6} />
        <footer><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="primary-button" type="button" disabled={!valid || busy} onClick={() => void onCreate(title, text)}>{busy ? '正在创建' : '确认建书'}</button></footer>
      </section>
    </div>
  );
}

function chapterStatus(chapter: ChapterData): string {
  if (chapter.settlementStatus === 'settled') return '正史已结算';
  if (chapter.generationStatus === 'working') return '创作中';
  if (chapter.generationStatus === 'paused') return '已暂停';
  if (chapter.generationStatus === 'failed') return '需要处理';
  if (chapter.generationStatus === 'completed') return '等待结算';
  return '已规划';
}

function taskLabel(type: string): string {
  return type === 'chapter_creation' ? '章节创作' : type === 'chapter_write' ? '正文写作' : type;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = { pending: '待执行', queued: '排队中', working: '工作中', paused: '已暂停', failed: '失败', succeeded: '已完成', cancelled: '已取消', blocked: '已阻断' };
  return labels[status] ?? status;
}

function phaseLabel(phase: string): string {
  const labels: Record<string, string> = { preflight: '预检', context: '组装上下文', draft: '生成完整初稿', hard_check: '硬规则检查', review: '异模型审校', rewrite: '定点重写', facts: '事实提取', settlement: '正史结算', completed: '已完成' };
  return labels[phase] ?? phase;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function confirmationLabel(targetType: string): string {
  return targetType === 'fact' ? '重大正史事实' : `重大确认：${targetType}`;
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
