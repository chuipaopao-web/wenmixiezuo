import { createHash } from 'node:crypto';
import type { Clock, IdGenerator } from '../../apps/api/src/domain/ids.js';
import { initializeRuntimeBook } from './runtime-fixture.js';
import type { TestContext } from './test-context.js';

export interface V7CanonFixture {
  scope: { ownerId: string; bookId: string };
  chapterId: string;
  volumeId: string;
  manuscriptVersionId: string;
  taskId: string;
  agentId: string;
  content: string;
}

export function createV7CanonFixture(
  context: TestContext,
  ids: IdGenerator,
  clock: Clock,
  options: { ownerId?: string; chapterNumber?: number; content?: string; title?: string } = {}
): V7CanonFixture {
  const ownerId = options.ownerId ?? context.config.ownerId;
  const bookId = ids.next();
  const scope = { ownerId, bookId };
  initializeRuntimeBook(context, scope, ids, clock, options.title ?? 'V7正史安全测试书');
  const volumeId = ids.next();
  const chapterId = ids.next();
  const now = clock.now().toISOString();
  context.database.prepare(`INSERT INTO volumes(
    volume_id,owner_id,book_id,volume_number,title,status,created_at,updated_at
  ) VALUES(?,?,?,1,'第一卷','active',?,?)`).run(volumeId, ownerId, bookId, now, now);
  context.database.prepare(`INSERT INTO chapters(
    chapter_id,owner_id,book_id,volume_id,chapter_number,title,plan_status,generation_status,
    settlement_status,version,created_at,updated_at
  ) VALUES(?,?,?,?,?,'第一章','ready','completed','unsettled',1,?,?)`)
    .run(chapterId, ownerId, bookId, volumeId, options.chapterNumber ?? 1, now, now);
  const agent = context.database.prepare(`SELECT agent_id FROM agent_instances
    WHERE owner_id=? AND book_id=? ORDER BY agent_id LIMIT 1`).get(ownerId, bookId) as { agent_id: string };
  const content = options.content ?? '夜雨落在旧城，林澈握紧唯一的铜钥匙，记住了北塔的约定。';
  const seeded = seedManuscript(context, ids, clock, scope, volumeId, chapterId, agent.agent_id, content);
  return { scope, chapterId, volumeId, agentId: agent.agent_id, content, ...seeded };
}

function seedManuscript(
  context: TestContext,
  ids: IdGenerator,
  clock: Clock,
  scope: { ownerId: string; bookId: string },
  _volumeId: string,
  chapterId: string,
  agentId: string,
  content: string
): { manuscriptVersionId: string; taskId: string } {
  const now = clock.now().toISOString();
  const taskId = ids.next();
  context.database.prepare(`INSERT INTO tasks(
    task_id,release_id,owner_id,book_id,chapter_id,task_type,assigned_agent_id,
    task_brief_json,status,current_phase,idempotency_key,budget_id,required_editor_epoch,
    checkpoint_json,created_at,updated_at
  ) VALUES(?,?,?,?,?,'chapter_write',?,?,'succeeded','completed',?,NULL,0,?,?,?)`).run(
    taskId, context.config.releaseId, scope.ownerId, scope.bookId, chapterId, agentId,
    JSON.stringify({ chapterId }), `write:${chapterId}`, JSON.stringify({ fixture: true }), now, now
  );
  const manuscriptVersionId = ids.next();
  const operationId = ids.next();
  const fileId = ids.next();
  const contentHash = createHash('sha256').update(content).digest('hex');
  context.database.prepare(`INSERT INTO operations(
    operation_id,owner_id,book_id,operation_type,status,payload_json,created_at,updated_at
  ) VALUES(?,?,?,'v7_test_manuscript','succeeded','{}',?,?)`)
    .run(operationId, scope.ownerId, scope.bookId, now, now);
  context.database.prepare(`INSERT INTO file_registry(
    file_id,owner_id,book_id,chapter_id,version_id,relative_path,content_hash,size_bytes,status,operation_id,created_at
  ) VALUES(?,?,?,?,?,?,?,?, 'active',?,?)`).run(
    fileId, scope.ownerId, scope.bookId, chapterId, manuscriptVersionId,
    `files/${scope.bookId}/${manuscriptVersionId}.txt`, contentHash, Buffer.byteLength(content), operationId, now
  );
  context.database.prepare(`INSERT INTO manuscript_versions(
    manuscript_version_id,owner_id,book_id,chapter_id,author_agent_id,model_provider,model_id,
    source_task_id,file_id,content_hash,word_count,status,created_at
  ) VALUES(?,?,?,?,?,'wenmi-deterministic','v7-safety-fixture',?,?,?,?, 'approved',?)`).run(
    manuscriptVersionId, scope.ownerId, scope.bookId, chapterId, agentId,
    taskId, fileId, contentHash, [...content].filter((character) => !/\s/u.test(character)).length, now
  );
  context.database.prepare(`UPDATE chapters SET current_manuscript_version_id=? WHERE chapter_id=?`)
    .run(manuscriptVersionId, chapterId);
  return { manuscriptVersionId, taskId };
}
