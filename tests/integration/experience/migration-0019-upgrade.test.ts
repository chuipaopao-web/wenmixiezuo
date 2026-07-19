import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../../apps/api/src/infrastructure/db/database.js';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';

describe('Schema 18升级到19', () => {
  it('保留旧书、消息与正史修订并只新增临时聊天附件表', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'wenmi-attachment-upgrade-'));
    const migrations = resolve(root, 'migrations');
    const source = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    mkdirSync(migrations);
    const previous = [
      '0001_foundation.sql', '0002_data_safety.sql', '0003_runtime.sql', '0004_novel_domain.sql',
      '0005_memory_canon.sql', '0006_creation_pipeline.sql', '0007_experience_copyright.sql',
      '0008_agent_personas.sql', '0009_role_titles.sql', '0010_expression_taxonomy.sql',
      '0011_knowledge_lifecycle_time.sql', '0012_chunk_projection_snapshots.sql',
      '0013_retrieval_orchestration.sql', '0014_longform_continuity.sql',
      '0015_agent_compression_prompts.sql', '0016_production_workflow.sql',
      '0017_experience_freeze.sql', '0018_portability_operations.sql'
    ];
    for (const file of previous) writeFileSync(resolve(migrations, file), readFileSync(resolve(source, file)));
    const database = openDatabase(resolve(root, 'database.sqlite'));
    try {
      runMigrations(database, migrations);
      database.prepare(`INSERT INTO owners (owner_id, display_name, created_at, updated_at) VALUES ('owner-old', '老板', '2026-01-01', '2026-01-01')`).run();
      database.prepare(`INSERT INTO books (
        book_id, owner_id, title, status, version, positioning_version, canon_revision,
        editor_epoch, created_at, updated_at
      ) VALUES ('book-old', 'owner-old', '旧长篇', 'active', 4, 2, 7, 1, '2026-01-01', '2026-01-01')`).run();
      database.prepare(`INSERT INTO conversations (conversation_id, owner_id, book_id, title, created_at, updated_at)
        VALUES ('conversation-old', 'owner-old', 'book-old', '主对话', '2026-01-01', '2026-01-01')`).run();
      database.prepare(`INSERT INTO messages (
        message_id, conversation_id, owner_id, book_id, sender_type, message_type, content, references_json, created_at
      ) VALUES ('message-old', 'conversation-old', 'owner-old', 'book-old', 'boss', 'text', '旧消息', '[]', '2026-01-01')`).run();

      writeFileSync(resolve(migrations, '0019_chat_attachments.sql'), readFileSync(resolve(source, '0019_chat_attachments.sql')));
      expect(runMigrations(database, migrations).applied).toEqual(['0019_chat_attachments.sql']);
      expect(database.prepare('SELECT title, canon_revision FROM books WHERE book_id = ?').get('book-old'))
        .toEqual({ title: '旧长篇', canon_revision: 7 });
      expect(database.prepare('SELECT content, references_json FROM messages WHERE message_id = ?').get('message-old'))
        .toEqual({ content: '旧消息', references_json: '[]' });
      expect(database.prepare('SELECT COUNT(*) AS count FROM chat_attachments').get()).toEqual({ count: 0 });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      database.close();
      rmSync(root, { force: true, recursive: true });
    }
  });
});
