import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const chapterId = process.argv[2];
if (!chapterId) throw new Error('usage: node scripts/evaluation/inspect-chapter-rewrite.mjs <chapter-id>');

const db = new DatabaseSync('data/database/wenmi.sqlite', { readOnly: true });
try {
  const schemas = {
    manuscriptVersions: db.prepare('PRAGMA table_info(manuscript_versions)').all().map((column) => column.name),
    revisionOrders: db.prepare('PRAGMA table_info(revision_orders)').all().map((column) => column.name)
  };
  if (process.argv.includes('--schema')) {
    process.stdout.write(`${JSON.stringify(schemas, null, 2)}\n`);
    process.exit(0);
  }
  const versions = db.prepare(`
    SELECT m.manuscript_version_id, m.parent_version_id, m.status, m.word_count,
      f.relative_path, m.created_at
    FROM manuscript_versions m
    JOIN file_registry f ON f.file_id = m.file_id
    WHERE m.chapter_id = ?
    ORDER BY m.created_at
  `).all(chapterId).map((row, index) => {
    const content = readFileSync(resolve('data', row.relative_path), 'utf8');
    return {
      versionNumber: index + 1,
      ...row,
      length: content.length,
      hasDate15Alteration: /(?:十五|15).{0,30}(?:涂改|擦|改过|刮|抹|痕)|(?:涂改|擦|改过|刮|抹|痕).{0,30}(?:十五|15)/u.test(content),
      matchingLines: content.split(/\r?\n/u).filter((line) => /十五|15|涂改|擦|改过|刮|抹|痕/u.test(line)).slice(0, 12)
    };
  });
  const orders = db.prepare(`
    SELECT revision_order_id, manuscript_version_id, revision_round, hard_actions_json, status, created_at
    FROM revision_orders
    WHERE manuscript_version_id IN (
      SELECT manuscript_version_id FROM manuscript_versions WHERE chapter_id = ?
    )
    ORDER BY created_at
  `).all(chapterId).map((row) => ({
    ...row,
    hardActions: JSON.parse(row.hard_actions_json)
  }));
  const panels = db.prepare(`
    SELECT review_panel_id, manuscript_version_id, review_round, status, created_at
    FROM review_panels
    WHERE chapter_id = ?
    ORDER BY created_at
  `).all(chapterId);
  process.stdout.write(`${JSON.stringify({ versions, orders, panels }, null, 2)}\n`);
} finally {
  db.close();
}
