import { BookRepository } from '../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import type { Clock, IdGenerator } from '../../apps/api/src/domain/ids.js';
import type { TestContext } from './test-context.js';

export function initializeV7Book(
  context: TestContext,
  ownerId: string,
  ids: IdGenerator,
  clock: Clock,
  input: { title?: string; bookId?: string } = {}
) {
  const now = clock.now().toISOString();
  context.database.prepare(`
    INSERT OR IGNORE INTO owners (owner_id, display_name, version, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
  `).run(ownerId, 'V7 测试作者', now, now);
  const bookId = input.bookId ?? ids.next();
  const book = new BookRepository(context.database).create(
    { ownerId, bookId },
    input.title ?? 'V7测试书',
    now
  );
  context.database.prepare(`
    INSERT INTO positioning_drafts (
      draft_id, owner_id, proposed_book_id, title, input_text, fields_json, tags_json,
      status, version, confirmed_book_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '', '{}', '[]', 'confirmed', 1, ?, ?, ?)
  `).run(`v7-opening-draft-${bookId}`, ownerId, bookId, book.title, bookId, now, now);
  context.database.prepare(`UPDATE books SET status = 'active' WHERE owner_id = ? AND book_id = ?`)
    .run(ownerId, bookId);
  return new BookRepository(context.database).require({ ownerId, bookId });
}
