// 一次性运维脚本：清理所有用户的老书（归档→永久删除），复用正式 BookLifecycleService。
// 用法：node /opt/wenmi/purge-all-books.mjs
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { BookLifecycleService } from '/opt/wenmi/apps/api/dist/application/books/book-lifecycle-service.js';

const database = new DatabaseSync('/opt/wenmi/data/database/wenmi.sqlite');
const ids = { next: () => randomUUID() };
const clock = { now: () => new Date() };
const service = new BookLifecycleService(database, '/opt/wenmi/data', ids, clock);

const books = database.prepare(`
  SELECT owner_id, book_id, title, status, version FROM books WHERE status <> 'purged' ORDER BY created_at
`).all();

console.log(`待清理书籍：${books.length} 本`);
let done = 0;
for (const book of books) {
  const scope = { ownerId: book.owner_id, bookId: book.book_id };
  if (book.status !== 'archived') {
    service.archive(scope, book.version);
  }
  service.permanentlyDelete(scope, 'YES');
  done += 1;
  console.log(`已永久删除：${book.title}（${book.book_id}）`);
}
const remaining = database.prepare(`SELECT COUNT(*) AS count FROM books WHERE status <> 'purged'`).get();
const tombstones = database.prepare(`SELECT COUNT(*) AS count FROM deletion_tombstones`).get();
console.log(`完成 ${done}/${books.length}；剩余书籍 ${remaining.count}；墓碑累计 ${tombstones.count}`);
database.close();
