import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(databasePath: string): DatabaseSync {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA synchronous = FULL');
  // 章节定稿会与本地资料库投影短暂竞争写锁。百章级书籍的投影可能超过五秒，
  // 这里等待同一台机器上的可信写事务完成，避免把可恢复的锁竞争显示成500错误。
  database.exec('PRAGMA busy_timeout = 30000');
  database.exec('PRAGMA trusted_schema = OFF');
  return database;
}

