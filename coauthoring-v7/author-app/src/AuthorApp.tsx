import { useEffect, useState } from 'react';
import {
  ArchiveBoxIcon,
  BookOpenTextIcon,
  BooksIcon,
  CaretRightIcon,
  FileTextIcon,
  GearSixIcon,
  ListIcon,
  MapTrifoldIcon,
  PlusIcon,
  TreeStructureIcon,
  UsersThreeIcon,
  XIcon
} from '@phosphor-icons/react';
import { InformationPage } from './InformationPage';
import { NewNovelPage } from './NewNovelPage';
import { TaskLogPage } from './TaskLogPage';
import { TeamPage } from './TeamPage';
import { TimeMachinePage } from './TimeMachinePage';
import { CreationWorkspacePage } from './CreationWorkspacePage';
import { LibraryPage } from './LibraryPage';
import {
  AUTHOR_NAV_ITEMS,
  authorViewFromSearch,
  bookIdFromSearch,
  openingTaskIdFromSearch,
  preserveCreationScopeInSearch,
  searchForAuthorView,
  type AuthorView,
  type CreationScopeOverride
} from './navigation';
import { archiveBook, fetchBooks, restoreBook, type BookRecord } from './opening-api';
import { bookCoverTitle, bookCoverTone, bookStatusLabel } from './book-shelf-presentation';
import { AuthorAccountCenter, useAuthorAccount } from './AuthorAccountBoundary';

const NAV_ICONS = [
  TreeStructureIcon,
  BookOpenTextIcon,
  MapTrifoldIcon,
  CaretRightIcon,
  FileTextIcon,
  BooksIcon,
  FileTextIcon,
  UsersThreeIcon
] as const;

type OpeningEntry = 'ai' | 'manual';
type BookShelfStatus = 'loading' | 'ready' | 'error';

function openingEntryFromSearch(search: string): OpeningEntry {
  return new URLSearchParams(search).get('entry') === 'manual' ? 'manual' : 'ai';
}

function HomePage({ onCreateNovel }: { onCreateNovel: (entry: OpeningEntry) => void }): React.JSX.Element {
  return (
    <section className="home-surface" aria-labelledby="home-title">
      <div className="home-intro">
        <span className="brand-mark home-brand" aria-hidden="true">文</span>
        <p className="eyebrow">开始一部新作品</p>
        <h2 id="home-title">今天，想创作什么？</h2>
        <p className="product-copy">专业网文剧本设计平台：创作团队帮您设计骨架、大纲、剧情，书写正文，订制化设计原创作品。</p>
      </div>

      <div className="creation-entry-grid" aria-label="选择创作类型">
        <article className="creation-entry novel-entry">
          <span className="entry-icon" aria-hidden="true"><BookOpenTextIcon /></span>
          <span className="entry-copy">
            <small>长篇网文创作</small>
            <strong>创作小说</strong>
            <span>从一个想法开始，由创作团队逐步帮您完成整本书。</span>
          </span>
          <span className="entry-actions">
            <button className="entry-primary-action" type="button" onClick={() => onCreateNovel('ai')}><UsersThreeIcon />团队设计</button>
            <button className="entry-secondary-action" type="button" onClick={() => onCreateNovel('manual')}><FileTextIcon />自己设计</button>
          </span>
        </article>

        <button className="creation-entry script-entry" type="button" disabled aria-disabled="true">
          <span className="entry-badge">即将开放</span>
          <span className="entry-icon" aria-hidden="true"><FileTextIcon /></span>
          <span className="entry-copy">
            <small>影视与短剧创作</small>
            <strong>创作剧本</strong>
            <span>剧本工作流暂不开放，后续会作为独立创作方式接入。</span>
          </span>
          <span className="entry-action">敬请期待</span>
        </button>
      </div>
    </section>
  );
}

export function AuthorApp(): React.JSX.Element {
  const accountSession = useAuthorAccount();
  const [view, setView] = useState<AuthorView>(() => authorViewFromSearch(window.location.search));
  const [bookId, setBookId] = useState<string | null>(() => bookIdFromSearch(window.location.search));
  const [openingEntry, setOpeningEntry] = useState<OpeningEntry>(() => openingEntryFromSearch(window.location.search));
  const [openingTaskId, setOpeningTaskId] = useState<string | null>(() => openingTaskIdFromSearch(window.location.search));
  const [informationSection, setInformationSection] = useState<'profile' | 'setting'>('profile');
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [bookShelfStatus, setBookShelfStatus] = useState<BookShelfStatus>('loading');
  const [bookShelfRequest, setBookShelfRequest] = useState(0);
  const [leftOpen, setLeftOpen] = useState(false);
  const [archiveConfirmation, setArchiveConfirmation] = useState<string | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);

  useEffect(() => {
    const onPopState = () => {
      setView(authorViewFromSearch(window.location.search));
      setBookId(bookIdFromSearch(window.location.search));
      setOpeningEntry(openingEntryFromSearch(window.location.search));
      setOpeningTaskId(openingTaskIdFromSearch(window.location.search));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setBookShelfStatus('loading');
    void fetchBooks(controller.signal).then((nextBooks) => {
      if (controller.signal.aborted) return;
      setBooks(nextBooks);
      setBookShelfStatus('ready');
      const selectedBookId = bookIdFromSearch(window.location.search);
      if (selectedBookId !== null && !nextBooks.some((book) => book.bookId === selectedBookId)) {
        window.history.replaceState({}, '', searchForAuthorView('home'));
        setView('home');
        setBookId(null);
        setOpeningTaskId(null);
        setInformationSection('profile');
        setLeftOpen(false);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setBookShelfStatus('error');
    });
    return () => controller.abort();
  }, [bookId, bookShelfRequest]);

  const navigate = (
    nextView: AuthorView,
    nextBookId: string | null = null,
    nextEntry: OpeningEntry = openingEntry,
    nextTaskId: string | null = null,
    creationScope: CreationScopeOverride = {}
  ) => {
    let search = nextView === 'new-novel'
      ? `${searchForAuthorView(nextView, nextBookId, nextTaskId)}&entry=${nextEntry}`
      : searchForAuthorView(nextView, nextBookId);
    if (['volume', 'chain', 'chapter', 'account'].includes(nextView) && nextBookId !== null && nextBookId === bookId) {
      search = preserveCreationScopeInSearch(window.location.search, search, creationScope);
    }
    window.history.pushState({}, '', search);
    setView(nextView);
    setBookId(nextBookId);
    setOpeningEntry(nextEntry);
    setOpeningTaskId(nextTaskId);
    if (nextView === 'information') setInformationSection('profile');
    setLeftOpen(false);
  };

  const activeBooks = books.filter((book) => book.status === 'active');
  const archivedBooks = books.filter((book) => book.status === 'archived');
  const selectedBook = activeBooks.find((book) => book.bookId === bookId) ?? null;
  const archiveSelectedBook = async (): Promise<void> => {
    if (selectedBook === null || lifecycleBusy !== null) return;
    setLifecycleBusy(selectedBook.bookId);
    setLifecycleError(null);
    try {
      await archiveBook(selectedBook.bookId, selectedBook.version);
      setArchiveConfirmation(null);
      navigate('home');
      setBookShelfRequest((current) => current + 1);
    } catch (reason) {
      setLifecycleError(reason instanceof Error ? reason.message : '抱歉，这本书暂时没有归档成功。');
    } finally {
      setLifecycleBusy(null);
    }
  };
  const restoreArchivedBook = async (book: BookRecord): Promise<void> => {
    if (lifecycleBusy !== null) return;
    setLifecycleBusy(book.bookId);
    setLifecycleError(null);
    try {
      await restoreBook(book.bookId, book.version);
      setBookShelfRequest((current) => current + 1);
    } catch (reason) {
      setLifecycleError(reason instanceof Error ? reason.message : '抱歉，这本书暂时没有恢复成功。');
    } finally {
      setLifecycleBusy(null);
    }
  };

  return (
    <div className="app-shell unified-desk">
      <aside className={`left-rail ios-book-sidebar ${leftOpen ? 'drawer-open' : ''}`} aria-label="书籍栏">
        <div className="sidebar-brand">
          <button className="brand-lockup" type="button" onClick={() => navigate('home')} aria-label="返回文秘写作首页">
            <span className="brand-mark" aria-hidden="true">文</span>
            <span><strong>文秘写作</strong><small>长篇创作台</small></span>
          </button>
          <button className="icon-button mobile-only" type="button" aria-label="关闭书籍栏" onClick={() => setLeftOpen(false)}><XIcon /></button>
        </div>

        <div className="rail-book-switcher unified-book-switcher" aria-label="书籍切换">
          <button className="rail-new-book" type="button" onClick={() => navigate('home')}><PlusIcon /><span>新建书籍</span></button>
          <div className="book-list-heading"><span>我的书籍</span><strong aria-label={bookShelfStatus === 'ready' ? `${activeBooks.length}本创作中书籍` : '书架尚未加载完成'}>{bookShelfStatus === 'ready' || books.length > 0 ? activeBooks.length : '—'}</strong></div>
          {bookShelfStatus === 'loading' && books.length === 0 && <div className="book-list-loading" role="status"><span className="book-list-loading-dot" aria-hidden="true" />正在加载书架…</div>}
          {bookShelfStatus === 'ready' && activeBooks.length === 0 && <div className="empty-book-list"><BookOpenTextIcon /><span>创建后会显示在这里</span></div>}
          {activeBooks.length > 0 && <div className="book-list" aria-label="选择书籍">{activeBooks.map((book) => {
              const coverTitle = bookCoverTitle(book.title);
              const statusText = bookId === book.bookId ? '当前书籍' : bookStatusLabel(book.status);
              return <button className={bookId === book.bookId ? 'active' : ''} type="button" key={book.bookId} aria-label={`${coverTitle.fullTitle} · ${statusText}`} onClick={() => navigate('information', book.bookId)}>
                <span className={`book-rail-cover cover-tone-${bookCoverTone(book.bookId)}`} aria-hidden="true"><small>文秘</small><b className={`book-cover-title title-${coverTitle.size}`}>{coverTitle.text}</b><i>小说</i></span>
                <span className="book-cover-status"><strong>{coverTitle.fullTitle}</strong><small>{statusText}</small></span>
              </button>;
            })}</div>}
          {selectedBook !== null && <div className="book-archive-action">{archiveConfirmation === selectedBook.bookId ? <div className="book-inline-confirm"><span>归档后可以随时恢复，正文和资料都会保留。</span><div><button type="button" disabled={lifecycleBusy !== null} onClick={() => void archiveSelectedBook()}>{lifecycleBusy === selectedBook.bookId ? '正在归档…' : '确认归档'}</button><button type="button" disabled={lifecycleBusy !== null} onClick={() => setArchiveConfirmation(null)}>取消</button></div></div> : <button type="button" onClick={() => setArchiveConfirmation(selectedBook.bookId)}><ArchiveBoxIcon />归档当前书籍</button>}</div>}
          {archivedBooks.length > 0 && <details className="archived-book-list"><summary>已归档 · {archivedBooks.length}</summary><div>{archivedBooks.map((book) => <article key={book.bookId}><span><strong>{book.title}</strong><small>内容完整保留</small></span><button type="button" disabled={lifecycleBusy !== null} onClick={() => void restoreArchivedBook(book)}>{lifecycleBusy === book.bookId ? '正在恢复…' : '恢复'}</button></article>)}</div></details>}
          {bookShelfStatus === 'loading' && books.length > 0 && <p className="book-list-refreshing" role="status">正在更新书架…</p>}
          {bookShelfStatus === 'error' && <div className="book-list-error" role="alert"><span>抱歉，书架暂时没有加载出来。</span><button type="button" onClick={() => setBookShelfRequest((current) => current + 1)}>重新加载</button></div>}
          {lifecycleError !== null && <div className="book-list-error" role="alert"><span>{lifecycleError}</span><button type="button" onClick={() => setLifecycleError(null)}>知道了</button></div>}
        </div>

        <div className="sidebar-account">
          <button className={`sidebar-account-profile ${view === 'account' ? 'active' : ''}`} type="button" aria-current={view === 'account' ? 'page' : undefined} onClick={() => navigate('account', bookId)}>
            <span className="sidebar-account-avatar" aria-hidden="true">{Array.from(accountSession.account.displayName.trim())[0]?.toUpperCase() ?? '文'}</span>
            <span className="sidebar-account-copy"><strong>{accountSession.account.displayName}</strong><small>个人中心 · {accountSession.account.role === 'admin' ? '管理员' : '作者'}</small></span>
            <GearSixIcon />
          </button>
        </div>
      </aside>

      {leftOpen && <button className="drawer-scrim" type="button" aria-label="关闭书籍栏" onClick={() => setLeftOpen(false)} />}

      <nav className="ios-function-bar" aria-label="功能栏">
        <button className="icon-button mobile-only function-book-toggle" type="button" aria-label="打开书籍栏" onClick={() => setLeftOpen(true)}><ListIcon /></button>
        <div className="function-nav-primary">
          {AUTHOR_NAV_ITEMS.map((label, index) => {
            const Icon = NAV_ICONS[index]!;
            const information = index === 0;
            const timeMachine = index === 1;
            const volume = index === 2;
            const chain = index === 3;
            const chapter = index === 4;
            const library = index === 5;
            const tasks = index === 6;
            const team = index === 7;
            const enabled = tasks || team || ((information || timeMachine || volume || chain || chapter || library) && bookId !== null);
            const targetView: AuthorView = tasks ? 'tasks' : team ? 'team' : library ? 'library' : chapter ? 'chapter' : chain ? 'chain' : volume ? 'volume' : timeMachine ? 'time-machine' : 'information';
            const active = enabled && view === targetView;
            return <button className={active ? 'active' : ''} type="button" disabled={!enabled} aria-disabled={!enabled} key={label} title={enabled ? label : '请先创建并选择一本书'} onClick={() => { if (enabled) navigate(targetView, information || timeMachine || volume || chain || chapter || library ? bookId : null); }}><Icon /><span>{label}</span></button>;
          })}
        </div>
      </nav>

      <main className="workspace-main">
        {view === 'home' && <HomePage onCreateNovel={(entry) => navigate('new-novel', null, entry)} />}
        {view === 'new-novel' && <NewNovelPage key={`${accountSession.account.userId}-${openingEntry}-${openingTaskId ?? 'new'}`} entryMode={openingEntry} onBack={() => navigate('home')} onCreated={(createdBookId) => navigate('information', createdBookId)} onAuthenticationRequired={accountSession.requireSignIn} />}
        {view === 'information' && bookId !== null && <InformationPage key={`${bookId}-${informationSection}`} bookId={bookId} initialSection={informationSection} onOpenTimeMachine={() => navigate('time-machine', bookId)} />}
        {view === 'information' && bookId === null && <HomePage onCreateNovel={(entry) => navigate('new-novel', null, entry)} />}
        {view === 'time-machine' && bookId !== null && <TimeMachinePage bookId={bookId} onOpenSettings={() => {
          navigate('information', bookId);
          setInformationSection('setting');
        }} />}
        {view === 'time-machine' && bookId === null && <HomePage onCreateNovel={(entry) => navigate('new-novel', null, entry)} />}
        {view === 'volume' && bookId !== null && <CreationWorkspacePage bookId={bookId} focus="volume" onNavigate={(next, scope) => navigate(next, bookId, openingEntry, null, scope)} />}
        {view === 'chain' && bookId !== null && <CreationWorkspacePage bookId={bookId} focus="chain" onNavigate={(next, scope) => navigate(next, bookId, openingEntry, null, scope)} />}
        {view === 'chapter' && bookId !== null && <CreationWorkspacePage bookId={bookId} focus="chapter" onNavigate={(next, scope) => navigate(next, bookId, openingEntry, null, scope)} />}
        {['volume', 'chain', 'chapter'].includes(view) && bookId === null && <HomePage onCreateNovel={(entry) => navigate('new-novel', null, entry)} />}
        {view === 'library' && bookId !== null && <LibraryPage bookId={bookId} />}
        {view === 'tasks' && <TaskLogPage onOpenTask={(taskId) => navigate('new-novel', null, 'ai', taskId)} onOpenBook={(nextBookId) => navigate('information', nextBookId)} onOpenPlanning={(nextBookId) => navigate('time-machine', nextBookId)} onOpenCreation={(nextBookId, focus) => navigate(focus, nextBookId)} />}
        {view === 'team' && <TeamPage />}
        {view === 'account' && <section className="v7-account-page"><AuthorAccountCenter /></section>}
      </main>
    </div>
  );
}
