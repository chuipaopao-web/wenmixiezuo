/**
 * 第86批前置作业（老板决策）：生产书籍数据全量清空。
 *
 * 清空范围：所有书籍及其全部派生数据（规划树、创作流水线、正文、章节、
 * 索引、文件、向量投影、移植操作记录）。删除走 BookPurgeRepository 的
 * 既有单书永久删除逻辑（含删除墓碑，防止旧书籍ID复活）。
 *
 * 保留范围：用户账号（user_accounts）、会员（user_memberships）、
 * owner 账户、平台配置、备份记录、删除墓碑。
 *
 * 用法（在生产服务器 /opt/wenmi 下运行）：
 *   node node_modules/tsx/dist/cli.mjs scripts/ops/wipe-production-books.ts
 *     —— dry-run：只统计计数并打印验证SQL，不删任何数据。
 *   node node_modules/tsx/dist/cli.mjs scripts/ops/wipe-production-books.ts --execute
 *     —— 真正清空。前置条件：最新一次备份状态必须是 verified，
 *        否则拒绝执行（可用 --skip-backup-gate 强行跳过，仅限抢救场景）。
 *
 * 执行前必须已完成：备份 + 拉取异地副本（见部署手册）。
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { loadRuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';
import { BookPurgeRepository } from '../../apps/api/src/infrastructure/db/repositories/book-purge-repository.js';
import { SystemClock, UuidGenerator } from '../../apps/api/src/domain/ids.js';
import { resolveInside } from '../../apps/api/src/infrastructure/files/file-utils.js';
import { createHash } from 'node:crypto';

interface TableNameRow { readonly name: string }
interface TableColumnRow { readonly name: string }
interface BookRow { readonly owner_id: string; readonly book_id: string; readonly title: string }
interface BackupRow { readonly backup_id: string; readonly status: string; readonly created_at: string }

const execute = process.argv.includes('--execute');
const skipBackupGate = process.argv.includes('--skip-backup-gate');
const config = loadRuntimeConfig(process.env);
const database = openDatabase(config.databasePath);
const purge = new BookPurgeRepository(database);
const ids = new UuidGenerator();
const clock = new SystemClock();

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function tableNames(): string[] {
  return (database.prepare(`
    SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name
  `).all() as unknown as TableNameRow[]).map((row) => row.name);
}

function columnsOf(table: string): Set<string> {
  const columns = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .all() as unknown as TableColumnRow[];
  return new Set(columns.map((column) => column.name));
}

function scalar(sql: string, ...params: Array<string | number>): number {
  const row = database.prepare(sql).get(...params) as { count: number } | undefined;
  return row?.count ?? 0;
}

function fileSize(path: string): number {
  try {
    return statSync(path).isFile() ? statSync(path).size : directorySize(path);
  } catch {
    return 0;
  }
}

function directorySize(path: string): number {
  let total = 0;
  try {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      total += entry.isDirectory() ? directorySize(resolve(path, entry.name)) : statSync(resolve(path, entry.name)).size;
    }
  } catch {
    return 0;
  }
  return total;
}

try {
  const tables = tableNames();
  const scopedTables = tables.filter((table) => {
    const names = columnsOf(table);
    return names.has('owner_id') && names.has('book_id');
  });
  const bookIdOnlyTables = tables.filter((table) => {
    const names = columnsOf(table);
    return names.has('book_id') && !names.has('owner_id');
  });

  const books = database.prepare('SELECT owner_id, book_id, title FROM books ORDER BY owner_id, book_id')
    .all() as unknown as BookRow[];
  const bookIds = books.map((book) => book.book_id);
  const perOwner = new Map<string, number>();
  for (const book of books) perOwner.set(book.owner_id, (perOwner.get(book.owner_id) ?? 0) + 1);

  const protectedCounts = {
    userAccounts: scalar('SELECT COUNT(*) AS count FROM user_accounts'),
    userMemberships: scalar('SELECT COUNT(*) AS count FROM user_memberships'),
    owners: scalar('SELECT COUNT(*) AS count FROM owners'),
    backups: scalar('SELECT COUNT(*) AS count FROM backups')
  };

  const scopedCounts: Record<string, number> = {};
  for (const table of scopedTables) scopedTables.length === 0 || (scopedCounts[table] = scalar(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`));
  const bookIdOnlyCounts: Record<string, number> = {};
  for (const table of bookIdOnlyTables) {
    bookIdOnlyCounts[table] = scalar(
      `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE book_id IN (SELECT book_id FROM books)`
    );
  }

  const registeredFiles = scalar('SELECT COUNT(*) AS count FROM file_registry');
  const booksDir = resolveInside(config.dataDir, 'books');
  let bookDirCount = 0;
  try {
    bookDirCount = readdirSync(booksDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).length;
  } catch {
    bookDirCount = 0;
  }

  const latestBackup = database.prepare(
    'SELECT backup_id, status, created_at FROM backups ORDER BY created_at DESC LIMIT 1'
  ).get() as unknown as BackupRow | undefined;

  const dryRunReport = {
    mode: execute ? 'execute' : 'dry-run',
    generatedAt: clock.now().toISOString(),
    books: { total: books.length, perOwner: Object.fromEntries(perOwner) },
    scopedTableRowCounts: scopedCounts,
    bookIdOnlyTableRowCounts: bookIdOnlyCounts,
    registeredFiles,
    bookDirectoriesOnDisk: bookDirCount,
    protectedCounts,
    latestBackup: latestBackup ?? null
  };
  process.stdout.write(`${JSON.stringify(dryRunReport, null, 2)}\n`);

  if (!execute) {
    process.stdout.write([
      '',
      '【dry-run】以上为清空前计数，未删除任何数据。验证SQL：',
      "  SELECT COUNT(*) FROM books;                        -- 期望 0",
      "  SELECT COUNT(*) FROM chapters;                      -- 期望 0（含owner_id+book_id的表同理）",
      '  SELECT COUNT(*) FROM user_accounts;                 -- 期望与清空前一致',
      '  PRAGMA foreign_key_check;                           -- 期望无输出',
      '  PRAGMA integrity_check;                             -- 期望 ok',
      '确认无误后加 --execute 执行真实清空。',
      ''
    ].join('\n'));
    process.exit(0);
  }

  if (books.length === 0) {
    process.stdout.write('当前库中没有书籍，无需清空。\n');
    process.exit(0);
  }

  if (!skipBackupGate) {
    if (latestBackup === undefined) {
      throw new Error('库中没有任何备份记录：必须先完成备份并拉取异地副本后再执行清空');
    }
    if (latestBackup.status !== 'verified') {
      throw new Error(`最新备份 ${latestBackup.backup_id} 状态为 ${latestBackup.status}，不是 verified：必须先验证备份后再执行清空`);
    }
  }

  process.stdout.write(`开始清空 ${books.length} 本书...\n`);
  let wiped = 0;
  for (const book of books) {
    const scope = { ownerId: book.owner_id, bookId: book.book_id };
    const paths = purge.listRegisteredPaths(scope);
    const confirmationHash = createHash('sha256').update('YES').digest('hex');
    purge.permanentlyDelete(scope, {
      bookTitle: book.title,
      operationId: ids.next(),
      tombstoneId: ids.next(),
      confirmationHash,
      deletedAt: clock.now().toISOString()
    });
    for (const path of paths) {
      rmSync(resolveInside(config.dataDir, path), { force: true });
    }
    rmSync(resolveInside(config.dataDir, `books/${book.book_id}`), { force: true, recursive: true });
    wiped += 1;
    if (wiped % 10 === 0 || wiped === books.length) {
      process.stdout.write(`已清空 ${wiped}/${books.length} 本。\n`);
    }
  }

  // 验证：书籍为零、所有书范围表为零、孤本ID引用为零、账号无损、库完整。
  const remainingBooks = scalar('SELECT COUNT(*) AS count FROM books');
  const remainingScoped: Record<string, number> = {};
  for (const table of scopedTables) {
    const count = scalar(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`);
    if (count > 0) remainingScoped[table] = count;
  }
  const remainingBookIdRefs: Record<string, number> = {};
  if (bookIds.length > 0) {
    database.exec('CREATE TEMP TABLE wipe_verification_book_ids (book_id TEXT PRIMARY KEY)');
    const insert = database.prepare('INSERT INTO wipe_verification_book_ids (book_id) VALUES (?)');
    for (const bookId of bookIds) insert.run(bookId);
    for (const table of bookIdOnlyTables) {
      const count = scalar(
        `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE book_id IN (SELECT book_id FROM wipe_verification_book_ids)`
      );
      if (count > 0) remainingBookIdRefs[table] = count;
    }
    database.exec('DROP TABLE wipe_verification_book_ids');
  }
  const afterProtected = {
    userAccounts: scalar('SELECT COUNT(*) AS count FROM user_accounts'),
    userMemberships: scalar('SELECT COUNT(*) AS count FROM user_memberships'),
    owners: scalar('SELECT COUNT(*) AS count FROM owners')
  };
  const integrity = (database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  const foreignKeyViolations = database.prepare('PRAGMA foreign_key_check').all().length;
  const tombstones = scalar('SELECT COUNT(*) AS count FROM deletion_tombstones');

  const finalReport = {
    mode: 'execute',
    generatedAt: clock.now().toISOString(),
    wipedBooks: wiped,
    verification: {
      remainingBooks,
      remainingScopedTableRows: remainingScoped,
      remainingBookIdOnlyRefs: remainingBookIdRefs,
      protectedCountsBefore: protectedCounts,
      protectedCountsAfter: afterProtected,
      integrity,
      foreignKeyViolations,
      deletionTombstones: tombstones
    },
    passed: remainingBooks === 0
      && Object.keys(remainingScoped).length === 0
      && Object.keys(remainingBookIdRefs).length === 0
      && afterProtected.userAccounts === protectedCounts.userAccounts
      && afterProtected.userMemberships === protectedCounts.userMemberships
      && afterProtected.owners === protectedCounts.owners
      && integrity === 'ok'
      && foreignKeyViolations === 0
  };
  const evidenceDir = resolve(config.dataDir, 'verification');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    resolve(evidenceDir, 'production-book-wipe.json'),
    `${JSON.stringify(finalReport, null, 2)}\n`,
    'utf8'
  );
  process.stdout.write(`${JSON.stringify(finalReport, null, 2)}\n`);
  process.exit(finalReport.passed ? 0 : 1);
} finally {
  database.close();
}
