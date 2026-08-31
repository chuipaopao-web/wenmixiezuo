const OPENING_DRAFT_KEY_PREFIX = 'wenmi-v7-opening-draft-v2';

export function openingDraftKey(userId: string, entryMode: 'ai' | 'manual'): string {
  return `${OPENING_DRAFT_KEY_PREFIX}:${encodeURIComponent(userId)}:${entryMode}`;
}

export function clearOpeningDraft(userId: string, entryMode: 'ai' | 'manual'): void {
  try {
    localStorage.removeItem(openingDraftKey(userId, entryMode));
  } catch {
    // 浏览器禁用本地存储时没有可清理的客户端任务引用。
  }
}

export function clearOpeningDraftForTask(userId: string, taskId: string): void {
  const key = openingDraftKey(userId, 'ai');
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return;
    const parsed = JSON.parse(raw) as { taskId?: unknown } | null;
    if (parsed?.taskId === taskId) localStorage.removeItem(key);
  } catch {
    // 损坏的本地草稿不能继续作为恢复依据；服务端任务和历史资料不受影响。
    try { localStorage.removeItem(key); } catch { /* no-op */ }
  }
}
