import { useEffect, useState } from 'react';
import { AuthorAccountBoundary } from './AuthorAccountBoundary';
import { AuthorApp } from './AuthorApp';
import { fetchCurrentAuthorAccount, type AuthorAccount } from './account-api';
import { PublicHomepage } from './PublicHomepage';

type PublicRoute =
  | { kind: 'home' }
  | { kind: 'login'; mode: 'login' | 'register'; returnTo: string | null }
  | { kind: 'workspace' };

type PublicSessionState =
  | { status: 'checking' }
  | { status: 'guest' }
  | { status: 'authenticated'; account: AuthorAccount };

const WORKSPACE_HOME_PATH = '/?view=home';
const START_WRITING_PATH = '/?view=new-novel&entry=ai';
const AUTHOR_RETURN_PARAMS = new Set([
  'view',
  'bookId',
  'taskId',
  'entry',
  'section',
  'focus',
  'volumeId',
  'chainId',
  'chapter',
  'returnOpeningTaskId',
  'returnOpeningEntry',
  'returnOpeningRecoveryAction',
  'membershipRetryTaskId',
  'membershipRetryRecoveryAction'
]);

export function PublicAuthorEntry(): React.JSX.Element {
  const [route, setRoute] = useState<PublicRoute>(() => routeFromLocation(window.location));
  const [sessionState, setSessionState] = useState<PublicSessionState>({ status: 'checking' });

  useEffect(() => {
    const onPopState = (): void => setRoute(routeFromLocation(window.location));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (route.kind !== 'home') return;
    const controller = new AbortController();
    setSessionState({ status: 'checking' });
    void fetchCurrentAuthorAccount(controller.signal)
      .then((account) => {
        if (controller.signal.aborted) return;
        setSessionState(account === null ? { status: 'guest' } : { status: 'authenticated', account });
      })
      .catch((reason) => {
        if (controller.signal.aborted || (reason instanceof DOMException && reason.name === 'AbortError')) return;
        setSessionState({ status: 'guest' });
      });
    return () => controller.abort();
  }, [route.kind]);

  if (route.kind === 'login') {
    return <AuthorAccountBoundary
      key={`${route.mode}:${route.returnTo ?? ''}`}
      initialMode={route.mode}
      onAuthenticationModeChange={(mode) => navigateToAuth(mode, route.returnTo, setRoute)}
    >
      <AuthenticatedRedirect returnTo={route.returnTo} onRedirected={() => setRoute(routeFromLocation(window.location))} />
    </AuthorAccountBoundary>;
  }

  if (route.kind === 'workspace') {
    return <AuthorAccountBoundary>
      <AuthorApp />
    </AuthorAccountBoundary>;
  }

  return <PublicHomepage
    accountState={sessionState}
    onLogin={() => navigateToAuth('login', null, setRoute)}
    onRegister={() => navigateToAuth('register', null, setRoute)}
    onStart={() => navigateToAuth('register', START_WRITING_PATH, setRoute)}
    onOpenWorkspace={() => navigateToWorkspace(setRoute)}
  />;
}

function AuthenticatedRedirect({ returnTo, onRedirected }: { returnTo: string | null; onRedirected: () => void }): React.JSX.Element {
  const [redirected, setRedirected] = useState(false);
  useEffect(() => {
    if (redirected) return;
    const target = safeReturnTarget(returnTo) ?? WORKSPACE_HOME_PATH;
    window.history.replaceState({}, '', target);
    onRedirected();
    setRedirected(true);
  }, [onRedirected, redirected, returnTo]);
  if (!redirected) return <main className="v7-account-shell" aria-busy="true" />;
  return <AuthorApp key={`${window.location.pathname}${window.location.search}`} />;
}

function navigateToAuth(
  mode: 'login' | 'register',
  returnTo: string | null,
  setRoute: (route: PublicRoute) => void
): void {
  const params = new URLSearchParams();
  if (returnTo !== null) params.set('return', returnTo);
  const target = `/${mode}${params.size === 0 ? '' : `?${params.toString()}`}`;
  window.history.pushState({}, '', target);
  setRoute({ kind: 'login', mode, returnTo });
}

function navigateToWorkspace(setRoute: (route: PublicRoute) => void): void {
  window.history.pushState({}, '', WORKSPACE_HOME_PATH);
  setRoute({ kind: 'workspace' });
}

function routeFromLocation(location: Location): PublicRoute {
  const pathname = normalizePathname(location.pathname);
  if (pathname === '/login' || pathname === '/register') {
    return {
      kind: 'login',
      mode: pathname === '/register' ? 'register' : 'login',
      returnTo: new URLSearchParams(location.search).get('return')
    };
  }
  const params = new URLSearchParams(location.search);
  if (pathname !== '/' || params.has('view') || params.has('bookId') || params.has('taskId') || params.has('entry')) {
    return { kind: 'workspace' };
  }
  return { kind: 'home' };
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

function safeReturnTarget(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes('\\')) return null;
  let url: URL;
  try {
    url = new URL(trimmed, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin || url.pathname !== '/') return null;
  if (url.search.length === 0) return null;
  const params = new URLSearchParams(url.search);
  if (!params.has('view')) return null;
  for (const key of params.keys()) {
    if (!AUTHOR_RETURN_PARAMS.has(key)) return null;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
