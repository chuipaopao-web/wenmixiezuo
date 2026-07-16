import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';

export type MemoryLayer = 'system_rules' | 'story_bible' | 'canon_fact' | 'chapter_end' | 'manuscript_index' | 'book_working' | 'agent_private' | 'task_temporary';

export interface MemoryInput {
  layer: MemoryLayer;
  content: string;
  sourceType: string;
  sourceId: string;
  agentId?: string | null;
  factStatus?: string | null;
  storyTimeStart?: string | null;
  storyTimeEnd?: string | null;
  chapterStart?: number | null;
  chapterEnd?: number | null;
  canonRevision: number;
  positioningVersion: number;
  importance?: number;
}

export interface MemoryRecord {
  memoryId: string;
  layer: MemoryLayer;
  content: string;
  sourceType: string;
  sourceId: string;
  canonRevision: number;
  positioningVersion: number;
  status: string;
}

interface MemoryRow {
  memory_id: string;
  memory_layer: MemoryLayer;
  content: string;
  source_type: string;
  source_id: string;
  canon_revision: number;
  positioning_version: number;
  status: string;
}

export class MemoryService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public remember(scope: BookScope, input: MemoryInput): MemoryRecord {
    assertBookScope(scope);
    const memoryId = this.ids.next();
    const now = this.clock.now().toISOString();
    const previous = this.database.prepare(`
      SELECT MAX(version) AS version FROM memories
      WHERE owner_id = ? AND book_id = ? AND memory_layer = ? AND source_type = ? AND source_id = ?
    `).get(scope.ownerId, scope.bookId, input.layer, input.sourceType, input.sourceId) as { version: number | null };
    const version = (previous.version ?? 0) + 1;
    this.database.prepare(`
      INSERT INTO memories (
        memory_id, owner_id, book_id, agent_id, memory_layer, content,
        source_type, source_id, fact_status, story_time_start, story_time_end,
        chapter_start, chapter_end, canon_revision, positioning_version,
        importance, version, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      memoryId, scope.ownerId, scope.bookId, input.agentId ?? null, input.layer,
      input.content, input.sourceType, input.sourceId, input.factStatus ?? null,
      input.storyTimeStart ?? null, input.storyTimeEnd ?? null,
      input.chapterStart ?? null, input.chapterEnd ?? null, input.canonRevision,
      input.positioningVersion, input.importance ?? 50, version, now
    );
    this.database.prepare(`
      INSERT INTO content_fts (owner_id, book_id, source_type, source_id, content)
      VALUES (?, ?, 'memory', ?, ?)
    `).run(scope.ownerId, scope.bookId, memoryId, input.content);
    return this.require(scope, memoryId);
  }

  public invalidateSource(scope: BookScope, sourceType: string, sourceId: string, reason: string): number {
    assertBookScope(scope);
    const now = this.clock.now().toISOString();
    const ids = this.database.prepare(`
      SELECT memory_id FROM memories WHERE owner_id = ? AND book_id = ?
        AND source_type = ? AND source_id = ? AND status = 'active'
    `).all(scope.ownerId, scope.bookId, sourceType, sourceId) as unknown as Array<{ memory_id: string }>;
    const result = this.database.prepare(`
      UPDATE memories SET status = 'invalidated', invalidation_reason = ?, invalidated_at = ?
      WHERE owner_id = ? AND book_id = ? AND source_type = ? AND source_id = ? AND status = 'active'
    `).run(reason, now, scope.ownerId, scope.bookId, sourceType, sourceId);
    for (const row of ids) {
      this.database.prepare(`DELETE FROM content_fts WHERE owner_id = ? AND book_id = ? AND source_type = 'memory' AND source_id = ?`)
        .run(scope.ownerId, scope.bookId, row.memory_id);
    }
    return Number(result.changes);
  }

  public listActive(scope: BookScope, options: { layer?: MemoryLayer; agentId?: string; chapter?: number; canonRevision?: number } = {}): MemoryRecord[] {
    assertBookScope(scope);
    const rows = this.database.prepare(`
      SELECT * FROM memories
      WHERE owner_id = ? AND book_id = ? AND status = 'active'
        AND (? IS NULL OR memory_layer = ?)
        AND (? IS NULL OR agent_id IS NULL OR agent_id = ?)
        AND (? IS NULL OR chapter_start IS NULL OR chapter_start <= ?)
        AND (? IS NULL OR chapter_end IS NULL OR chapter_end >= ?)
        AND (? IS NULL OR canon_revision = 0 OR canon_revision = ?)
      ORDER BY importance DESC, created_at, memory_id
    `).all(
      scope.ownerId, scope.bookId,
      options.layer ?? null, options.layer ?? null,
      options.agentId ?? null, options.agentId ?? null,
      options.chapter ?? null, options.chapter ?? null,
      options.chapter ?? null, options.chapter ?? null,
      options.canonRevision ?? null, options.canonRevision ?? null
    ) as unknown as MemoryRow[];
    return rows.map(mapMemory);
  }

  public require(scope: BookScope, memoryId: string): MemoryRecord {
    const row = this.database.prepare(`SELECT * FROM memories WHERE memory_id = ? AND owner_id = ? AND book_id = ?`)
      .get(memoryId, scope.ownerId, scope.bookId) as MemoryRow | undefined;
    if (row === undefined) throw new Error('记忆不存在或越权');
    return mapMemory(row);
  }
}

function mapMemory(row: MemoryRow): MemoryRecord {
  return {
    memoryId: row.memory_id,
    layer: row.memory_layer,
    content: row.content,
    sourceType: row.source_type,
    sourceId: row.source_id,
    canonRevision: row.canon_revision,
    positioningVersion: row.positioning_version,
    status: row.status
  };
}
