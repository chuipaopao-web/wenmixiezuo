import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';

export interface RetrievalHit {
  sourceType: string;
  sourceId: string;
  content: string;
  rank: number;
}

interface SearchRow {
  source_type: string;
  source_id: string;
  content: string;
  score: number;
}

export class RetrievalService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public index(scope: BookScope, sourceType: string, sourceId: string, content: string): void {
    assertBookScope(scope);
    this.database.prepare(`DELETE FROM content_fts WHERE owner_id = ? AND book_id = ? AND source_type = ? AND source_id = ?`)
      .run(scope.ownerId, scope.bookId, sourceType, sourceId);
    this.database.prepare(`INSERT INTO content_fts (owner_id, book_id, source_type, source_id, content) VALUES (?, ?, ?, ?, ?)`)
      .run(scope.ownerId, scope.bookId, sourceType, sourceId, content);
  }

  public search(
    scope: BookScope,
    queryText: string,
    options: { taskId?: string | null; limit?: number; sourceTypes?: string[]; adoptedSourceIds?: string[]; canonRevision: number }
  ): RetrievalHit[] {
    assertBookScope(scope);
    const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
    const expression = buildFtsExpression(queryText);
    const sourceTypes = options.sourceTypes ?? [];
    const placeholders = sourceTypes.map(() => '?').join(', ');
    const typeClause = sourceTypes.length === 0 ? '' : ` AND source_type IN (${placeholders})`;
    const rows = this.database.prepare(`
      SELECT source_type, source_id, content, bm25(content_fts) AS score
      FROM content_fts
      WHERE content_fts MATCH ? AND owner_id = ? AND book_id = ?${typeClause}
      ORDER BY score, source_id LIMIT ?
    `).all(expression, scope.ownerId, scope.bookId, ...sourceTypes, limit) as unknown as SearchRow[];
    const hits = rows.map((row, index) => ({
      sourceType: row.source_type,
      sourceId: row.source_id,
      content: row.content,
      rank: index + 1
    }));
    this.database.prepare(`
      INSERT INTO retrieval_records (
        retrieval_id, owner_id, book_id, task_id, query_text, filters_json,
        results_json, adopted_source_ids_json, canon_revision, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.ids.next(), scope.ownerId, scope.bookId, options.taskId ?? null, queryText,
      JSON.stringify({ sourceTypes, limit }),
      JSON.stringify(hits.map((hit) => ({ sourceType: hit.sourceType, sourceId: hit.sourceId, rank: hit.rank }))),
      JSON.stringify(options.adoptedSourceIds ?? []), options.canonRevision, this.clock.now().toISOString()
    );
    return hits;
  }

  public rebuildBook(scope: BookScope): number {
    assertBookScope(scope);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`DELETE FROM content_fts WHERE owner_id = ? AND book_id = ?`).run(scope.ownerId, scope.bookId);
      const rows = this.database.prepare(`
        SELECT memory_id, content FROM memories
        WHERE owner_id = ? AND book_id = ? AND status = 'active'
        ORDER BY memory_id
      `).all(scope.ownerId, scope.bookId) as unknown as Array<{ memory_id: string; content: string }>;
      for (const row of rows) {
        this.database.prepare(`INSERT INTO content_fts (owner_id, book_id, source_type, source_id, content) VALUES (?, ?, 'memory', ?, ?)`)
          .run(scope.ownerId, scope.bookId, row.memory_id, row.content);
      }
      this.database.exec('COMMIT');
      return rows.length;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function buildFtsExpression(queryText: string): string {
  const terms = queryText.trim().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) throw new Error('检索词不能为空');
  const expanded = new Set<string>();
  for (const term of terms) {
    expanded.add(term);
    const group = semanticGroups.find((candidate) => candidate.some((synonym) => synonym === term));
    for (const synonym of group ?? []) expanded.add(synonym);
  }
  return [...expanded].map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ');
}

const semanticGroups = [
  ['导师', '师父', '授业者'], ['死亡', '去世', '身亡'], ['位置', '地点', '所在地'],
  ['武器', '兵刃', '装备'], ['秘密', '隐情', '机密'], ['愤怒', '恼怒', '暴怒'],
  ['害怕', '恐惧', '畏惧'], ['高兴', '喜悦', '欣喜'], ['敌人', '仇敌', '对手'],
  ['朋友', '友人', '伙伴'], ['逃跑', '撤离', '逃离'], ['战斗', '交锋', '厮杀'],
  ['承诺', '约定', '誓言'], ['伤势', '受伤', '创伤'], ['线索', '蛛丝马迹', '提示'],
  ['宝物', '珍宝', '秘宝'], ['城镇', '城市', '城池'], ['森林', '林地', '树林'],
  ['夜晚', '深夜', '夜间'], ['早晨', '清晨', '拂晓']
] as const;
