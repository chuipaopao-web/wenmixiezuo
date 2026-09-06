import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorApp } from './AuthorApp';
import { AuthorAccountSessionProvider, type AuthorAccountSession } from './AuthorAccountBoundary';
import { authorApiUrl } from './author-api-origin';
import { fetchCurrentAuthorAccount } from './account-api';

vi.mock('./InformationPage', () => ({
  InformationPage: ({ initialSection }: { initialSection: string }) => <section aria-label="信息页">信息页 {initialSection}</section>
}));

vi.mock('./TimeMachinePage', () => ({
  TimeMachinePage: () => <section aria-label="时光机页">时光机页</section>
}));

vi.mock('./CreationWorkspacePage', () => ({
  CreationWorkspacePage: ({ focus }: { focus: 'volume' | 'chain' | 'chapter' }) => <section aria-label={`${focus}规划页`}>{focus}规划页</section>
}));

vi.mock('./LibraryPage', () => ({
  LibraryPage: () => <section aria-label="库页">库页</section>
}));

vi.mock('./TaskLogPage', () => ({
  TaskLogPage: () => <section aria-label="任务页">任务页</section>
}));

vi.mock('./TeamPage', () => ({
  TeamPage: () => <section aria-label="团队页">团队页</section>
}));

vi.mock('./NewNovelPage', () => ({
  NewNovelPage: () => <section aria-label="手动新建页">手动新建页</section>
}));

function createSession(): AuthorAccountSession {
  return {
    account: {
      userId: 'author-shell-user',
      email: 'author@example.test',
      displayName: '测试作者',
      role: 'user',
      status: 'active'
    },
    membership: null,
    membershipState: 'ready',
    membershipError: null,
    signingOut: false,
    sessionNotice: null,
    refreshMembership: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    requireSignIn: vi.fn()
  };
}

function renderWithSession(ui: ReactElement): ReturnType<typeof render> {
  return render(<AuthorAccountSessionProvider session={createSession()}>{ui}</AuthorAccountSessionProvider>);
}

function installBookFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/v1/v7/books')) {
      return jsonResponse([
        { bookId: 'book-1', title: '边军起势', status: 'active', version: 1, updatedAt: '2026-09-06T00:00:00.000Z' }
      ]);
    }
    return jsonResponse(null, 503);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse<T>(data: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => status >= 400 ? { error: { message: '本地验证：暂时不可用' } } : { data, meta: { requestId: 'test', nextCursor: null } }
  } as Response;
}

describe('rebuild author shell navigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
    window.localStorage.clear();
  });

  it('keeps the top bar to the bookshelf plus one-row main navigation', async () => {
    installBookFetch();
    renderWithSession(<AuthorApp />);

    const topbar = screen.getByRole('banner');
    expect(within(topbar).getAllByRole('button')).toHaveLength(6);
    expect(within(topbar).queryByText('文秘写作')).not.toBeInTheDocument();

    const shelfButton = within(topbar).getByRole('button', { name: '打开书架' });
    const mainNavigation = within(topbar).getByRole('navigation', { name: '主导航' });
    expect(within(mainNavigation).getAllByRole('button').map((button) => button.textContent)).toEqual(['信息', '时光机', '创作', '状态', '福利']);
    expect(screen.getByLabelText('书架')).not.toBeVisible();
    expect(screen.queryByRole('complementary', { name: '书架' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('书架')).toHaveAttribute('inert');
    expect(mainNavigation).toBeVisible();
    fireEvent.click(shelfButton);
    expect(screen.getByLabelText('书架')).toBeVisible();
    expect(shelfButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('complementary', { name: '书架' })).not.toHaveAttribute('inert');
    expect(mainNavigation).toBeVisible();
    fireEvent.click(shelfButton);
    expect(shelfButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('书架')).not.toBeVisible();
    expect(screen.queryByRole('complementary', { name: '书架' })).not.toBeInTheDocument();
    fireEvent.click(shelfButton);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(shelfButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('书架')).not.toBeVisible();
    expect(document.activeElement).toBe(shelfButton);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/v7/books', expect.any(Object)));
  });

  it('keeps old task and team deep links while status tabs follow the URL', () => {
    installBookFetch();
    window.history.replaceState({}, '', '/?view=team');
    renderWithSession(<AuthorApp />);

    expect(screen.getByRole('tab', { name: '团队' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('团队页')).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: '任务' }));
    expect(new URLSearchParams(window.location.search).get('view')).toBe('tasks');
    expect(screen.getByRole('tab', { name: '任务' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('任务页')).toBeVisible();
  });

  it('shows visible second-level tabs for time machine and planning pages', () => {
    installBookFetch();
    window.history.replaceState({}, '', '/?view=time-machine&bookId=book-1');
    const view = renderWithSession(<AuthorApp />);

    const timeMachineTabs = screen.getByLabelText('时光机二级入口');
    expect(within(timeMachineTabs).getByRole('button', { name: '时光机' })).toHaveClass('active');
    fireEvent.click(within(timeMachineTabs).getByRole('button', { name: '库' }));
    expect(new URLSearchParams(window.location.search).get('view')).toBe('library');
    expect(screen.getByLabelText('库页')).toBeVisible();

    view.unmount();
    window.history.replaceState({}, '', '/?view=chain&bookId=book-1&volumeId=v1&chainId=c2&chapter=9');
    renderWithSession(<AuthorApp />);
    const planningTabs = screen.getByLabelText('创作二级入口');
    expect(within(planningTabs).getByRole('button', { name: '链' })).toHaveClass('active');
    fireEvent.click(within(planningTabs).getByRole('button', { name: '章' }));
    const params = new URLSearchParams(window.location.search);
    expect(params.get('view')).toBe('chapter');
    expect(params.get('volumeId')).toBe('v1');
    expect(params.get('chainId')).toBe('c2');
    expect(params.get('chapter')).toBe('9');
  });

  it('keeps the selected book and planning scope while moving through main menu entries', () => {
    installBookFetch();
    window.history.replaceState({}, '', '/?view=chain&bookId=book-1&volumeId=v1&chainId=c2&chapter=9');
    renderWithSession(<AuthorApp />);

    fireEvent.click(screen.getByRole('button', { name: '福利' }));
    let params = new URLSearchParams(window.location.search);
    expect(params.get('view')).toBe('benefits');
    expect(params.get('bookId')).toBe('book-1');
    expect(params.get('volumeId')).toBe('v1');
    expect(params.get('chainId')).toBe('c2');
    expect(params.get('chapter')).toBe('9');

    fireEvent.click(screen.getByRole('button', { name: '时光机' }));
    params = new URLSearchParams(window.location.search);
    expect(params.get('view')).toBe('time-machine');
    expect(params.get('bookId')).toBe('book-1');
    expect(params.get('volumeId')).toBe('v1');
    expect(params.get('chainId')).toBe('c2');
    expect(params.get('chapter')).toBe('9');

    fireEvent.click(screen.getByRole('button', { name: '状态' }));
    params = new URLSearchParams(window.location.search);
    expect(params.get('view')).toBe('status');
    expect(params.get('bookId')).toBe('book-1');
    expect(params.get('volumeId')).toBe('v1');
    expect(params.get('chainId')).toBe('c2');
    expect(params.get('chapter')).toBe('9');

    fireEvent.click(screen.getByRole('tab', { name: '团队' }));
    params = new URLSearchParams(window.location.search);
    expect(params.get('view')).toBe('team');
    expect(params.get('bookId')).toBe('book-1');
    expect(params.get('volumeId')).toBe('v1');
    expect(params.get('chainId')).toBe('c2');
    expect(params.get('chapter')).toBe('9');

    fireEvent.click(screen.getByRole('button', { name: '时光机' }));
    params = new URLSearchParams(window.location.search);
    expect(params.get('view')).toBe('time-machine');
    expect(params.get('bookId')).toBe('book-1');
    expect(params.get('volumeId')).toBe('v1');
    expect(params.get('chainId')).toBe('c2');
    expect(params.get('chapter')).toBe('9');

    fireEvent.click(screen.getByRole('button', { name: '创作' }));
    params = new URLSearchParams(window.location.search);
    expect(params.get('view')).toBe('volume');
    expect(params.get('bookId')).toBe('book-1');
    expect(params.get('volumeId')).toBe('v1');
    expect(params.get('chainId')).toBe('c2');
    expect(params.get('chapter')).toBe('9');
  });

  it('does not accept old arbitrary API origins in copied author API clients', async () => {
    expect(authorApiUrl('/api/v1/auth/me')).toBe('/api/v1/auth/me');
    expect(() => authorApiUrl('https://wenmixiezuo.com/api/v1/auth/me')).toThrow(/same-origin \/api/u);
    const fetchMock = vi.fn(async () => jsonResponse({
      userId: 'author-shell-user',
      email: 'author@example.test',
      displayName: '测试作者',
      role: 'user',
      status: 'active'
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchCurrentAuthorAccount()).resolves.toMatchObject({ userId: 'author-shell-user' });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/me', expect.objectContaining({ credentials: 'include' }));
  });
});
