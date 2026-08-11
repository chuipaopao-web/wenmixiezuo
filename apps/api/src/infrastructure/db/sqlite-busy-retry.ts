export interface SqliteBusyRetryOptions {
  attempts?: number;
  delayMs?: number;
}

export function isSqliteBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const sqlite = error as Error & { code?: unknown; errcode?: unknown; errstr?: unknown };
  return sqlite.code === 'ERR_SQLITE_ERROR'
    && (sqlite.errcode === 5 || sqlite.errstr === 'database is locked' || /database is locked/i.test(sqlite.message));
}

export function runWithSqliteBusyRetry<T>(
  operation: () => T,
  options: SqliteBusyRetryOptions = {}
): T {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = Math.max(0, options.delayMs ?? 250);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt === attempts) throw error;
      if (delayMs > 0) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs * attempt);
      }
    }
  }
  throw new Error('SQLITE_BUSY_RETRY_EXHAUSTED');
}