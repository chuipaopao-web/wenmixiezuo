import { DatabaseSync } from 'node:sqlite';

const database = new DatabaseSync('data/database/wenmi.sqlite', { readOnly: true });
const books = database.prepare(`SELECT * FROM books ORDER BY created_at DESC LIMIT 10`).all();
const target = books.find((book) => String(book.title).includes('少女的实验笔记'));
const result = {
  books: books.map(({ book_id, owner_id, title, status, created_at }) => ({ book_id, owner_id, title, status, created_at }))
};
if (target) {
  result.target = { book_id: target.book_id, owner_id: target.owner_id, title: target.title, status: target.status };
  result.imports = database.prepare(`
    SELECT continuation_import_id, source_name, status, source_character_count,
           included_chapter_count, imported_chapter_count, last_completed_ordinal,
           confirmed_at, created_at
    FROM continuation_imports
    WHERE owner_id = ? AND book_id = ?
    ORDER BY created_at DESC
  `).all(target.owner_id, target.book_id);
  result.importChapters = database.prepare(`
    SELECT c.continuation_import_id, COUNT(*) AS total,
           SUM(CASE WHEN c.included = 1 THEN 1 ELSE 0 END) AS included,
           MIN(c.ordinal) AS first_ordinal, MAX(c.ordinal) AS last_ordinal
    FROM continuation_import_chapters c
    WHERE c.owner_id = ? AND c.book_id = ?
    GROUP BY c.continuation_import_id
  `).all(target.owner_id, target.book_id);
  result.analyses = database.prepare(`
    SELECT a.continuation_import_id, a.status, COUNT(*) AS count
    FROM continuation_chapter_analyses a
    WHERE a.owner_id = ? AND a.book_id = ?
    GROUP BY a.continuation_import_id, a.status
  `).all(target.owner_id, target.book_id);
  result.baselines = database.prepare(`
    SELECT continuation_import_id, status, active_task_id, analyzed_chapter_count,
           total_chapter_count, created_at, updated_at
    FROM continuation_baselines
    WHERE owner_id = ? AND book_id = ?
    ORDER BY created_at DESC
  `).all(target.owner_id, target.book_id);
  result.artifactCounts = database.prepare(`
    SELECT artifact_type, status, COUNT(*) AS count
    FROM artifacts
    WHERE owner_id = ? AND book_id = ?
    GROUP BY artifact_type, status
    ORDER BY artifact_type, status
  `).all(target.owner_id, target.book_id);
  result.artifacts = database.prepare(`
    SELECT a.artifact_id, a.artifact_type, a.title, a.status, a.active_version_id,
           substr(v.content_json, 1, 500) AS content_json
    FROM artifacts a
    LEFT JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
    WHERE a.owner_id = ? AND a.book_id = ?
      AND a.artifact_type IN ('chapter_outline', 'master_outline', 'story_bible')
    ORDER BY a.created_at DESC
    LIMIT 30
  `).all(target.owner_id, target.book_id);
}
console.log(JSON.stringify(result, null, 2));
