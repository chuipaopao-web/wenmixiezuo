import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';

let database: DatabaseSync | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe('SQLite本地并发配置', () => {
  it('为章节定稿与资料库投影的短暂写锁竞争保留足够等待时间', () => {
    database = openDatabase(':memory:');
    const row = database.prepare('PRAGMA busy_timeout').get() as Record<string, number>;
    expect(Object.values(row)[0]).toBe(30_000);
  });
});
