import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';

const cleanup: string[] = [];
afterEach(() => { for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('0042作者附件语义迁移', () => {
  it('原地保留附件并把旧目标类型升级为当前作者附件', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'wenmi-migration-0042-'));
    cleanup.push(root);
    const before = resolve(root, 'before');
    mkdirSync(before);
    const source = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    for (const name of readdirSync(source).filter((item) => /^\d{4}_.+\.sql$/u.test(item) && item < '0042_')) {
      copyFileSync(resolve(source, name), resolve(before, name));
    }
    const database = new DatabaseSync(resolve(root, 'upgrade.sqlite'));
    database.exec('PRAGMA foreign_keys = ON');
    try {
      runMigrations(database, before);
      const hash = 'a'.repeat(64);
      database.prepare(`INSERT INTO owners (owner_id, display_name, version, created_at, updated_at)
        VALUES ('owner-1', '作者', 1, '2026-08-10', '2026-08-10')`).run();
      database.prepare(`INSERT INTO books (
        book_id, owner_id, title, status, version, positioning_version, canon_revision, editor_epoch, created_at, updated_at
      ) VALUES ('book-1', 'owner-1', '迁移书', 'active', 1, 0, 0, 0, '2026-08-10', '2026-08-10')`).run();
      database.prepare(`INSERT INTO chat_attachments (
        attachment_id, owner_id, book_id, original_name, media_kind, mime_type, size_bytes,
        content_hash, source_relative_path, parse_status, context_excerpt, created_at
      ) VALUES ('attachment-1', 'owner-1', 'book-1', 'idea.txt', 'text', 'text/plain', 4,
        ?, 'books/book-1/attachments/attachment-1/source.txt', 'parsed', '保留这份作者资料', '2026-08-10')`).run(hash);
      database.prepare(`INSERT INTO author_planning_inputs (
        author_input_id, owner_id, book_id, surface, subject_type, subject_id, intent_strength,
        original_text, original_text_hash, status, idempotency_key, request_hash, created_at, updated_at
      ) VALUES ('input-1', 'owner-1', 'book-1', 'volume_plan', 'volume_plan', 'volume-1', 'preference',
        '参考附件', ?, 'new', 'input-key', ?, '2026-08-10', '2026-08-10')`).run(hash, hash);
      database.prepare(`INSERT INTO author_planning_input_links (
        link_id, owner_id, book_id, author_input_id, link_type, target_type, target_id,
        relation, sort_order, created_at
      ) VALUES ('link-1', 'owner-1', 'book-1', 'input-1', 'attachment', 'chat_attachment',
        'attachment-1', 'attached', 0, '2026-08-10')`).run();

      copyFileSync(resolve(source, '0042_author_attachments.sql'), resolve(before, '0042_author_attachments.sql'));
      expect(runMigrations(database, before).applied).toEqual(['0042_author_attachments.sql']);
      expect(database.prepare(`SELECT original_name, context_excerpt FROM author_attachments
        WHERE attachment_id = 'attachment-1'`).get()).toEqual({
        original_name: 'idea.txt', context_excerpt: '保留这份作者资料'
      });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat_attachments'").get()).toBeUndefined();
      expect(database.prepare("SELECT target_type FROM author_planning_input_links WHERE link_id = 'link-1'").get())
        .toEqual({ target_type: 'author_attachment' });
      expect(runMigrations(database, before).applied).toEqual([]);
    } finally {
      database.close();
    }
  });
});