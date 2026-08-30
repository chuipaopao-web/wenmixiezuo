export type AuthorView = 'home' | 'new-novel' | 'information' | 'time-machine' | 'volume' | 'chain' | 'chapter' | 'library' | 'tasks' | 'team' | 'account';

export const AUTHOR_NAV_ITEMS = [
  '信息',
  '时光机',
  '卷',
  '链',
  '章',
  '库',
  '任务',
  '团队'
] as const;

export interface CreationScopeOverride {
  volumeId?: string | null;
  chainId?: string | null;
  chapter?: number | null;
}

export function authorViewFromSearch(search: string): AuthorView {
  const view = new URLSearchParams(search).get('view');
  if (view === 'new-novel') return 'new-novel';
  if (view === 'information') return 'information';
  if (view === 'time-machine') return 'time-machine';
  if (view === 'volume') return 'volume';
  if (view === 'chain') return 'chain';
  if (view === 'chapter') return 'chapter';
  if (view === 'library') return 'library';
  if (view === 'tasks') return 'tasks';
  if (view === 'team') return 'team';
  if (view === 'account') return 'account';
  return 'home';
}

export function openingTaskIdFromSearch(search: string): string | null {
  const taskId = new URLSearchParams(search).get('taskId');
  return taskId?.trim() || null;
}

export function bookIdFromSearch(search: string): string | null {
  const bookId = new URLSearchParams(search).get('bookId');
  return bookId?.trim() || null;
}

export function searchForAuthorView(view: AuthorView, bookId?: string | null, taskId?: string | null): string {
  if (view === 'home') return '/';
  const params = new URLSearchParams({ view });
  if (bookId !== undefined && bookId !== null) params.set('bookId', bookId);
  if (taskId !== undefined && taskId !== null) params.set('taskId', taskId);
  return `?${params.toString()}`;
}

export function preserveCreationScopeInSearch(
  currentSearch: string,
  targetSearch: string,
  override: CreationScopeOverride = {}
): string {
  const current = new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch);
  const target = new URLSearchParams(targetSearch.startsWith('?') ? targetSearch.slice(1) : targetSearch);
  for (const key of ['volumeId', 'chainId', 'chapter'] as const) {
    const value = current.get(key);
    if (value !== null && value.trim().length > 0) target.set(key, value);
  }
  for (const key of ['volumeId', 'chainId', 'chapter'] as const) {
    const value = override[key];
    if (value === undefined) continue;
    if (value === null) target.delete(key);
    else target.set(key, String(value));
  }
  return `?${target.toString()}`;
}
