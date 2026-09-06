import { useEffect, useRef, useState } from 'react';
import {
  ArchiveBoxIcon,
  BookOpenTextIcon,
  BooksIcon,
  FileTextIcon,
  GearSixIcon,
  GiftIcon,
  InfoIcon,
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
  authorViewFromSearch,
  bookIdFromSearch,
  informationSectionFromSearch,
  openingTaskIdFromSearch,
  preserveCreationScopeInSearch,
  searchForAuthorView,
  searchForInformationSection,
  settingRecoveryFocusFromSearch,
  type AuthorView,
  type CreationScopeOverride,
  type InformationSection,
  type SettingRecoveryFocus
} from './navigation';
import { archiveBook, fetchBooks, restoreBook, type BookRecord } from './opening-api';
import { bookCoverTitle, bookCoverTone, bookStatusLabel } from './book-shelf-presentation';
import { AuthorAccountCenter, useAuthorAccount } from './AuthorAccountBoundary';
import { clearOpeningDraft } from './opening-draft-storage';
import type { AuthorMembershipStatus } from './account-api';

type OpeningEntry = 'ai' | 'manual';
type BookShelfStatus = 'loading' | 'ready' | 'error';
type OpeningMembershipRecoveryAction =
  | 'open_membership_required'
  | 'open_membership_quota'
  | 'open_membership_expired';
type OpeningAccountReturn = {
  entry: OpeningEntry;
  taskId: string;
  recoveryAction: OpeningMembershipRecoveryAction | null;
};
type OpeningMembershipRetryGrant = {
  taskId: string;
  recoveryAction: OpeningMembershipRecoveryAction;
};
type MembershipReturnRefresh = 'idle' | 'running' | 'completed' | 'failed';

const OPENING_RETRY_MINIMUM_COMPUTE = 64_000;

function openingMembershipRecoveryAction(value: string | null): OpeningMembershipRecoveryAction | null {
  return value === 'open_membership_required'
    || value === 'open_membership_quota'
    || value === 'open_membership_expired'
    ? value
    : null;
}

function membershipAllowsOpeningRetry(
  role: 'admin' | 'user',
  membership: AuthorMembershipStatus | null,
  action: OpeningMembershipRecoveryAction | null
): boolean {
  if (action === null) return false;
  if (role === 'admin' || membership?.isAdmin === true) return true;
  const record = membership?.membership ?? null;
  return record !== null
    && record.status === 'active'
    && !record.expired
    && record.computeRemaining >= OPENING_RETRY_MINIMUM_COMPUTE;
}

function openingEntryFromSearch(search: string): OpeningEntry {
  return new URLSearchParams(search).get('entry') === 'manual' ? 'manual' : 'ai';
}

function openingAccountReturnFromSearch(search: string): OpeningAccountReturn | null {
  const params = new URLSearchParams(search);
  const taskId = params.get('returnOpeningTaskId')?.trim() || null;
  if (taskId === null) return null;
  return {
    taskId,
    entry: params.get('returnOpeningEntry') === 'manual' ? 'manual' : 'ai',
    recoveryAction: openingMembershipRecoveryAction(params.get('returnOpeningRecoveryAction'))
  };
}

function openingMembershipRetryGrantFromSearch(search: string): OpeningMembershipRetryGrant | null {
  const params = new URLSearchParams(search);
  const taskId = params.get('membershipRetryTaskId')?.trim() || null;
  const recoveryAction = openingMembershipRecoveryAction(params.get('membershipRetryRecoveryAction'));
  return taskId === null || recoveryAction === null ? null : { taskId, recoveryAction };
}

type OpeningRecoveryNavigation = {
  accountReturn?: OpeningAccountReturn;
  membershipRetry?: OpeningMembershipRetryGrant;
};

type MainNavKey = 'information' | 'time-machine' | 'planning' | 'status' | 'benefits';

const MAIN_NAV_ITEMS: Array<{
  key: MainNavKey;
  label: string;
  icon: React.ElementType;
  requiresBook: boolean;
}> = [
  { key: 'information', label: '信息', icon: InfoIcon, requiresBook: true },
  { key: 'time-machine', label: '时光机', icon: BookOpenTextIcon, requiresBook: true },
  { key: 'planning', label: '规划', icon: MapTrifoldIcon, requiresBook: true },
  { key: 'status', label: '状态', icon: FileTextIcon, requiresBook: false },
  { key: 'benefits', label: '福利', icon: GiftIcon, requiresBook: false }
];

function mainNavKeyForView(view: AuthorView): MainNavKey | null {
  if (view === 'information') return 'information';
  if (view === 'time-machine' || view === 'library') return 'time-machine';
  if (view === 'volume' || view === 'chain' || view === 'chapter') return 'planning';
  if (view === 'status' || view === 'tasks' || view === 'team') return 'status';
  if (view === 'benefits') return 'benefits';
  return null;
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

function StatusPage(props: {
  section: 'tasks' | 'team';
  onSectionChange: (section: 'tasks' | 'team') => void;
  onOpenTask: (taskId: string) => void;
  onOpenBook: (bookId: string) => void;
  onOpenSetting: (bookId: string, focus?: SettingRecoveryFocus | null) => void;
  onOpenPlanning: (bookId: string) => void;
  onOpenCreation: (bookId: string, focus: 'volume' | 'chain' | 'chapter') => void;
}): React.JSX.Element {
  const { section, onSectionChange, ...taskLogProps } = props;
  return (
    <section className="author-status-page" aria-labelledby="author-status-title">
      <header className="status-page-heading">
        <span>
          <p className="eyebrow">状态</p>
          <h2 id="author-status-title">创作状态</h2>
        </span>
        <div className="status-section-tabs" role="tablist" aria-label="状态分区">
          <button type="button" role="tab" aria-selected={section === 'tasks'} className={section === 'tasks' ? 'active' : ''} onClick={() => onSectionChange('tasks')}>任务</button>
          <button type="button" role="tab" aria-selected={section === 'team'} className={section === 'team' ? 'active' : ''} onClick={() => onSectionChange('team')}>团队</button>
        </div>
      </header>
      {section === 'tasks'
        ? <TaskLogPage {...taskLogProps} />
        : <TeamPage />}
    </section>
  );
}

function BenefitsPage(): React.JSX.Element {
  return (
    <section className="benefits-page" aria-labelledby="benefits-title">
      <p className="eyebrow">福利</p>
      <h2 id="benefits-title">福利中心</h2>
      <p>活动与创作福利将在这里公布。敬请期待。</p>
      <div className="benefits-placeholder" role="status">
        <GiftIcon aria-hidden="true" />
        <span>当前没有可领取活动。</span>
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
  const [informationSection, setInformationSection] = useState<InformationSection>(() => informationSectionFromSearch(window.location.search));
  const [settingRecoveryFocus, setSettingRecoveryFocus] = useState<SettingRecoveryFocus | null>(() => settingRecoveryFocusFromSearch(window.location.search));
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [bookShelfStatus, setBookShelfStatus] = useState<BookShelfStatus>('loading');
  const [bookShelfRequest, setBookShelfRequest] = useState(0);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const leftToggleRef = useRef<HTMLButtonElement>(null);
  const rightToggleRef = useRef<HTMLButtonElement>(null);
  const [archiveConfirmation, setArchiveConfirmation] = useState<string | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [openingAccountReturn, setOpeningAccountReturn] = useState<OpeningAccountReturn | null>(() => openingAccountReturnFromSearch(window.location.search));
  const [membershipRetryGrant, setMembershipRetryGrant] = useState<OpeningMembershipRetryGrant | null>(() => openingMembershipRetryGrantFromSearch(window.location.search));
  const [pendingMembershipReturn, setPendingMembershipReturn] = useState<OpeningAccountReturn | null>(null);
  const [membershipReturnRefresh, setMembershipReturnRefresh] = useState<MembershipReturnRefresh>('idle');

  useEffect(() => {
    const onPopState = () => {
      setView(authorViewFromSearch(window.location.search));
      setBookId(bookIdFromSearch(window.location.search));
      setOpeningEntry(openingEntryFromSearch(window.location.search));
      setOpeningTaskId(openingTaskIdFromSearch(window.location.search));
      setOpeningAccountReturn(openingAccountReturnFromSearch(window.location.search));
      setMembershipRetryGrant(openingMembershipRetryGrantFromSearch(window.location.search));
      setInformationSection(informationSectionFromSearch(window.location.search));
      setSettingRecoveryFocus(settingRecoveryFocusFromSearch(window.location.search));
      setLeftOpen(false);
      setRightOpen(false);
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
        setSettingRecoveryFocus(null);
        setLeftOpen(false);
        setRightOpen(false);
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
    creationScope: CreationScopeOverride = {},
    openingRecovery: OpeningRecoveryNavigation = {}
  ) => {
    let search = nextView === 'new-novel'
      ? `${searchForAuthorView(nextView, nextBookId, nextTaskId)}&entry=${nextEntry}`
      : searchForAuthorView(nextView, nextBookId);
    const preservesBookScope = [
      'information',
      'time-machine',
      'library',
      'volume',
      'chain',
      'chapter',
      'status',
      'tasks',
      'team',
      'benefits',
      'account'
    ].includes(nextView);
    if (preservesBookScope && nextBookId !== null && nextBookId === bookId) {
      search = preserveCreationScopeInSearch(window.location.search, search, creationScope);
    }
    if (openingRecovery.accountReturn !== undefined || openingRecovery.membershipRetry !== undefined) {
      const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
      if (openingRecovery.accountReturn !== undefined) {
        params.set('returnOpeningTaskId', openingRecovery.accountReturn.taskId);
        params.set('returnOpeningEntry', openingRecovery.accountReturn.entry);
        if (openingRecovery.accountReturn.recoveryAction !== null) {
          params.set('returnOpeningRecoveryAction', openingRecovery.accountReturn.recoveryAction);
        }
      }
      if (openingRecovery.membershipRetry !== undefined) {
        params.set('membershipRetryTaskId', openingRecovery.membershipRetry.taskId);
        params.set('membershipRetryRecoveryAction', openingRecovery.membershipRetry.recoveryAction);
      }
      search = `?${params.toString()}`;
    }
    window.history.pushState({}, '', search);
    setView(nextView);
    setBookId(nextBookId);
    setOpeningEntry(nextEntry);
    setOpeningTaskId(nextTaskId);
    setOpeningAccountReturn(openingRecovery.accountReturn ?? null);
    setMembershipRetryGrant(openingRecovery.membershipRetry ?? null);
    setPendingMembershipReturn(null);
    setMembershipReturnRefresh('idle');
    if (nextView === 'information') setInformationSection('profile');
    setSettingRecoveryFocus(null);
    setLeftOpen(false);
    setRightOpen(false);
  };

  const openSettings = (nextBookId: string, focus: SettingRecoveryFocus | null = null): void => {
    const targetSearch = searchForInformationSection(nextBookId, 'setting', focus);
    const search = nextBookId === bookId
      ? preserveCreationScopeInSearch(window.location.search, targetSearch)
      : targetSearch;
    window.history.pushState({}, '', search);
    setView('information');
    setBookId(nextBookId);
    setOpeningTaskId(null);
    setInformationSection('setting');
    setSettingRecoveryFocus(focus);
    setLeftOpen(false);
    setRightOpen(false);
  };

  useEffect(() => {
    if (!leftOpen && !rightOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (leftOpen) {
        setLeftOpen(false);
        leftToggleRef.current?.focus();
      }
      if (rightOpen) {
        setRightOpen(false);
        rightToggleRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [leftOpen, rightOpen]);

  const openLeftMenu = (): void => {
    setLeftOpen(true);
    setRightOpen(false);
  };

  const openRightMenu = (): void => {
    setRightOpen((current) => !current);
    setLeftOpen(false);
  };

  const closeLeftMenu = (): void => {
    setLeftOpen(false);
    leftToggleRef.current?.focus();
  };

  const closeRightMenu = (): void => {
    setRightOpen(false);
    rightToggleRef.current?.focus();
  };

  const navigateMain = (target: MainNavKey): void => {
    if (target === 'planning') {
      navigate('volume', bookId);
      return;
    }
    navigate(target, bookId);
  };

  const beginNewNovel = (entry: OpeningEntry) => {
    setOpeningAccountReturn(null);
    setMembershipRetryGrant(null);
    clearOpeningDraft(accountSession.account.userId, entry);
    navigate('new-novel', null, entry);
  };

  const openAccountFromOpening = (recoveryAction: OpeningMembershipRecoveryAction): void => {
    const currentTaskId = openingTaskIdFromSearch(window.location.search);
    const target = currentTaskId === null ? null : { entry: openingEntry, taskId: currentTaskId, recoveryAction };
    setPendingMembershipReturn(null);
    setMembershipReturnRefresh('idle');
    navigate('account', bookId, openingEntry, null, {}, target === null ? {} : { accountReturn: target });
  };

  const returnToOpeningFromAccount = (): void => {
    if (openingAccountReturn === null || membershipReturnRefresh === 'running') return;
    setPendingMembershipReturn(openingAccountReturn);
    setMembershipReturnRefresh('running');
    void accountSession.refreshMembership()
      .then(() => setMembershipReturnRefresh('completed'))
      .catch(() => setMembershipReturnRefresh('failed'));
  };

  useEffect(() => {
    if (pendingMembershipReturn === null || membershipReturnRefresh === 'idle' || membershipReturnRefresh === 'running') return;
    if (membershipReturnRefresh === 'completed' && accountSession.membershipState === 'loading') return;
    const target = pendingMembershipReturn;
    const retryReady = membershipReturnRefresh === 'completed'
      && accountSession.membershipState === 'ready'
      && membershipAllowsOpeningRetry(
        accountSession.account.role,
        accountSession.membership,
        target.recoveryAction
      );
    setPendingMembershipReturn(null);
    setMembershipReturnRefresh('idle');
    navigate(
      'new-novel',
      null,
      target.entry,
      target.taskId,
      {},
      retryReady && target.recoveryAction !== null
        ? { membershipRetry: { taskId: target.taskId, recoveryAction: target.recoveryAction } }
        : {}
    );
  }, [
    accountSession.account.role,
    accountSession.membership,
    accountSession.membershipState,
    membershipReturnRefresh,
    pendingMembershipReturn
  ]);

  const consumeMembershipRecovery = (): void => {
    const params = new URLSearchParams(window.location.search);
    params.delete('membershipRetryTaskId');
    params.delete('membershipRetryRecoveryAction');
    window.history.replaceState({}, '', `?${params.toString()}`);
    setMembershipRetryGrant(null);
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
      <header className="author-topbar">
        <button ref={leftToggleRef} className="topbar-menu-button" type="button" aria-label="打开书架" aria-expanded={leftOpen} onClick={openLeftMenu}>
          <BooksIcon aria-hidden="true" />
          <span>书架</span>
        </button>
        <div className="topbar-brand" aria-label="文秘写作作者端">
          <span className="brand-mark" aria-hidden="true">文</span>
          <span>文秘写作</span>
        </div>
        <button ref={rightToggleRef} className="topbar-menu-button" type="button" aria-label="打开功能导航" aria-expanded={rightOpen} onClick={openRightMenu}>
          <ListIcon aria-hidden="true" />
          <span>功能</span>
        </button>
      </header>

      <aside
        className={`left-rail ios-book-sidebar ${leftOpen ? 'drawer-open' : ''}`}
        aria-label="书架"
        aria-hidden={!leftOpen}
        inert={leftOpen ? undefined : true}
        style={{ visibility: leftOpen ? 'visible' : 'hidden' }}
      >
        <div className="sidebar-brand">
          <button className="brand-lockup" type="button" onClick={() => navigate('home')} aria-label="返回文秘写作首页">
            <span className="brand-mark" aria-hidden="true">文</span>
            <span><strong>文秘写作</strong><small>长篇创作台</small></span>
          </button>
          <button className="icon-button" type="button" aria-label="关闭书架" onClick={closeLeftMenu}><XIcon /></button>
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
          <button className={`sidebar-account-profile ${view === 'account' ? 'active' : ''}`} type="button" aria-current={view === 'account' ? 'page' : undefined} onClick={() => { setOpeningAccountReturn(null); navigate('account', bookId); }}>
            <span className="sidebar-account-avatar" aria-hidden="true">{Array.from(accountSession.account.displayName.trim())[0]?.toUpperCase() ?? '文'}</span>
            <span className="sidebar-account-copy"><strong>{accountSession.account.displayName}</strong><small>个人中心 · {accountSession.account.role === 'admin' ? '管理员' : '作者'}</small></span>
            <GearSixIcon />
          </button>
        </div>
      </aside>

      {leftOpen && <button className="drawer-scrim" type="button" aria-label="关闭书架" onClick={closeLeftMenu} />}

      {rightOpen && <button className="function-scrim" type="button" aria-label="关闭功能导航" onClick={closeRightMenu} />}

      <nav
        className={`ios-function-bar ${rightOpen ? 'drawer-open' : ''}`}
        aria-label="功能导航"
        aria-hidden={!rightOpen}
        inert={rightOpen ? undefined : true}
        style={{ visibility: rightOpen ? 'visible' : 'hidden' }}
      >
        <div className="function-panel-heading">
          <strong>功能导航</strong>
          <button className="icon-button" type="button" aria-label="关闭功能导航" onClick={closeRightMenu}><XIcon /></button>
        </div>
        <div className="function-nav-primary">
          {MAIN_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const enabled = !item.requiresBook || bookId !== null;
            const active = mainNavKeyForView(view) === item.key;
            return <button className={active ? 'active' : ''} type="button" disabled={!enabled} aria-disabled={!enabled} key={item.key} title={enabled ? item.label : '请先创建并选择一本书'} onClick={() => { if (enabled) navigateMain(item.key); }}><Icon aria-hidden="true" /><span>{item.label}</span></button>;
          })}
        </div>
      </nav>

      <main className="workspace-main">
        {(view === 'time-machine' || view === 'library') && bookId !== null && (
          <div className="workspace-secondary-tabs" aria-label="时光机二级入口">
            <button type="button" className={view === 'time-machine' ? 'active' : ''} onClick={() => navigate('time-machine', bookId)}>时光机</button>
            <button type="button" className={view === 'library' ? 'active' : ''} onClick={() => navigate('library', bookId)}>库</button>
          </div>
        )}
        {(view === 'volume' || view === 'chain' || view === 'chapter') && bookId !== null && (
          <div className="workspace-secondary-tabs planning-tabs" aria-label="规划二级入口">
            <button type="button" className={view === 'volume' ? 'active' : ''} onClick={() => navigate('volume', bookId)}>卷</button>
            <button type="button" className={view === 'chain' ? 'active' : ''} onClick={() => navigate('chain', bookId)}>链</button>
            <button type="button" className={view === 'chapter' ? 'active' : ''} onClick={() => navigate('chapter', bookId)}>章</button>
          </div>
        )}
        {view === 'home' && <HomePage onCreateNovel={beginNewNovel} />}
        {view === 'new-novel' && <NewNovelPage key={`${accountSession.account.userId}-${openingEntry}-${openingTaskId ?? 'new'}`} entryMode={openingEntry} onBack={() => navigate('home')} onCreated={(createdBookId) => navigate('information', createdBookId)} onAuthenticationRequired={accountSession.requireSignIn} onOpenAccount={openAccountFromOpening} membershipRetryReady={openingTaskId !== null && membershipRetryGrant?.taskId === openingTaskId && accountSession.membershipState === 'ready' && membershipAllowsOpeningRetry(accountSession.account.role, accountSession.membership, membershipRetryGrant.recoveryAction)} onMembershipRetryConsumed={consumeMembershipRecovery} />}
        {view === 'information' && bookId !== null && <InformationPage key={`${bookId}-${informationSection}-${settingRecoveryFocus ?? 'default'}`} bookId={bookId} initialSection={informationSection} settingRecoveryFocus={settingRecoveryFocus} onOpenTimeMachine={() => navigate('time-machine', bookId)} />}
        {view === 'information' && bookId === null && <HomePage onCreateNovel={beginNewNovel} />}
        {view === 'time-machine' && bookId !== null && <TimeMachinePage key={bookId} bookId={bookId} onOpenSettings={() => {
          openSettings(bookId);
        }} />}
        {view === 'time-machine' && bookId === null && <HomePage onCreateNovel={beginNewNovel} />}
        {view === 'volume' && bookId !== null && <CreationWorkspacePage bookId={bookId} focus="volume" onNavigate={(next, scope) => navigate(next, bookId, openingEntry, null, scope)} />}
        {view === 'chain' && bookId !== null && <CreationWorkspacePage bookId={bookId} focus="chain" onNavigate={(next, scope) => navigate(next, bookId, openingEntry, null, scope)} />}
        {view === 'chapter' && bookId !== null && <CreationWorkspacePage bookId={bookId} focus="chapter" onNavigate={(next, scope) => navigate(next, bookId, openingEntry, null, scope)} />}
        {['volume', 'chain', 'chapter'].includes(view) && bookId === null && <HomePage onCreateNovel={beginNewNovel} />}
        {view === 'library' && bookId !== null && <LibraryPage bookId={bookId} />}
        {view === 'library' && bookId === null && <HomePage onCreateNovel={beginNewNovel} />}
        {(view === 'status' || view === 'tasks' || view === 'team') && <StatusPage section={view === 'team' ? 'team' : 'tasks'} onSectionChange={(section) => navigate(section === 'team' ? 'team' : 'tasks', bookId)} onOpenTask={(taskId) => navigate('new-novel', null, 'ai', taskId)} onOpenBook={(nextBookId) => navigate('information', nextBookId)} onOpenSetting={openSettings} onOpenPlanning={(nextBookId) => navigate('time-machine', nextBookId)} onOpenCreation={(nextBookId, focus) => navigate(focus, nextBookId)} />}
        {view === 'benefits' && <BenefitsPage />}
        {view === 'account' && <section className="v7-account-page"><AuthorAccountCenter {...(openingAccountReturn === null ? {} : { onClose: returnToOpeningFromAccount, closeLabel: membershipReturnRefresh === 'running' ? '正在确认会员状态…' : '返回这次开书' })} /></section>}
      </main>
    </div>
  );
}
