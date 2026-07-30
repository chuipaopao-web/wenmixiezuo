import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { CanonService } from '../../apps/api/src/application/knowledge/canon-service.js';
import { NarrativeProjectionService } from '../../apps/api/src/application/projections/narrative-projection-service.js';
import { SystemClock, UuidGenerator } from '../../apps/api/src/domain/ids.js';

const bookId = process.argv[2]?.trim();
if (!bookId) throw new Error('用法：tsx scripts/evaluation/rebuild-book-projections.ts <book_id>');

const databasePath = resolve(process.cwd(), 'data/database/wenmi.sqlite');
const database = new DatabaseSync(databasePath);
try {
  const book = database.prepare(`
    SELECT owner_id, title, canon_revision
    FROM books
    WHERE book_id = ?
  `).get(bookId) as { owner_id: string; title: string; canon_revision: number } | undefined;
  if (book === undefined) throw new Error(`找不到书籍：${bookId}`);

  const scope = { ownerId: book.owner_id, bookId };
  const ids = new UuidGenerator();
  const clock = new SystemClock();
  new CanonService(database, ids, clock).rebuildProjections(scope);
  const narrative = new NarrativeProjectionService(database, ids, clock).rebuild(scope);
  const relationship = Number((database.prepare(`
    SELECT COUNT(*) AS count
    FROM relationship_projection
    WHERE owner_id = ? AND book_id = ? AND canon_revision = ?
  `).get(scope.ownerId, scope.bookId, book.canon_revision) as { count: number }).count);
  const emptyNarrative = Number((database.prepare(`
    SELECT COUNT(*) AS count
    FROM narrative_projections
    WHERE owner_id = ? AND book_id = ?
      AND json_extract(content_json, '$.status') = 'not_extracted'
  `).get(scope.ownerId, scope.bookId) as { count: number }).count);

  console.log(JSON.stringify({
    bookId,
    title: book.title,
    canonRevision: book.canon_revision,
    narrative,
    relationship,
    emptyNarrative
  }, null, 2));
} finally {
  database.close();
}
