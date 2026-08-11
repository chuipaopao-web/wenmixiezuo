import { describe, expect, it } from 'vitest';
import { isSqliteBusyError, runWithSqliteBusyRetry } from '../../apps/api/src/infrastructure/db/sqlite-busy-retry.js';

function busyError(): Error {
  return Object.assign(new Error('database is locked'), {
    code: 'ERR_SQLITE_ERROR',
    errcode: 5,
    errstr: 'database is locked'
  });
}

describe('SQLite busy retry', () => {
  it('retries a transient local write lock and returns the successful result', () => {
    let calls = 0;
    const result = runWithSqliteBusyRetry(() => {
      calls += 1;
      if (calls < 3) throw busyError();
      return 'ready';
    }, { attempts: 3, delayMs: 0 });

    expect(result).toBe('ready');
    expect(calls).toBe(3);
  });

  it('does not hide non-lock failures', () => {
    expect(() => runWithSqliteBusyRetry(() => {
      throw new Error('invalid context source');
    }, { attempts: 3, delayMs: 0 })).toThrow('invalid context source');
  });

  it('stops after the configured number of lock attempts', () => {
    let calls = 0;
    expect(() => runWithSqliteBusyRetry(() => {
      calls += 1;
      throw busyError();
    }, { attempts: 2, delayMs: 0 })).toThrow('database is locked');
    expect(calls).toBe(2);
    expect(isSqliteBusyError(busyError())).toBe(true);
  });
});