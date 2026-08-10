import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CanonService, stableJson } from '../../apps/api/src/application/knowledge/canon-service.js';
import { SystemClock, UuidGenerator } from '../../apps/api/src/domain/ids.js';
import { deterministicFactCandidates } from '../../apps/api/src/infrastructure/models/deterministic-novel-models.js';

const REASON = 'two-book-library-category-backfill-v2';
const TARGETS = [
  { bookId: '927f86d4-b118-43f8-a6c1-72d57f080bb0', hero: '沈砚', expectedTitle: '阵骨问天' },
  { bookId: '5d2acbf7-8e98-4f97-b0a0-674571043ff9', hero: '顾野', expectedTitle: '零帧登顶' }
] as const;

interface ChapterSource {
  chapter_id: string;
  chapter_number: number;
  manuscript_version_id: string;
  relative_path: string;
}

interface Candidate {
  subjectName: string;
  entityType: string;
  relationKey: string;
  value: unknown;
  evidenceQuote: string;
  evidenceLocation: string;
  epistemicStatus: 'objective' | 'claim' | 'belief' | 'lie' | 'dream' | 'plan' | 'counterfactual' | 'ambiguous' | 'conflicted';
  negated: boolean;
  viewpointName: string | null;
  knowledgeSubjectName: string | null;
  knowledgeTimeStart: string | null;
  knowledgeTimeEnd: string | null;
  storyTimeStart: string | null;
  storyTimeEnd: string | null;
}

const requestedDatabase = process.argv[2]?.trim();
const database = new DatabaseSync(requestedDatabase ? resolve(requestedDatabase) : resolve(process.cwd(), 'data/database/wenmi.sqlite'));
database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 30000;');
const ids = new UuidGenerator();
const clock = new SystemClock();
const canon = new CanonService(database, ids, clock);

try {
  const results = [];
  for (const target of TARGETS) results.push(backfill(target));
  process.stdout.write(`${JSON.stringify({ reason: REASON, results }, null, 2)}\n`);
} finally {
  database.close();
}

function backfill(target: typeof TARGETS[number]): Record<string, unknown> {
  const book = database.prepare(`SELECT owner_id, title, canon_revision, positioning_version
    FROM books WHERE book_id = ?`).get(target.bookId) as {
      owner_id: string; title: string; canon_revision: number; positioning_version: number;
    } | undefined;
  if (book === undefined || book.title !== target.expectedTitle) throw new Error(`测试书不存在或标题不匹配：${target.expectedTitle}`);
  const scope = { ownerId: book.owner_id, bookId: target.bookId };
  const already = database.prepare(`SELECT to_revision FROM canon_revisions_log
    WHERE owner_id=? AND book_id=? AND change_type='correction' AND reason=?`)
    .get(scope.ownerId, scope.bookId, REASON) as { to_revision: number } | undefined;
  if (already !== undefined) return summary(target, already.to_revision, true);

  const chapters = database.prepare(`
    SELECT c.chapter_id, c.chapter_number, m.manuscript_version_id, f.relative_path
    FROM chapters c
    JOIN manuscript_versions m ON m.manuscript_version_id=c.canon_manuscript_version_id
      AND m.owner_id=c.owner_id AND m.book_id=c.book_id AND m.status='canon'
    JOIN file_registry f ON f.file_id=m.file_id AND f.owner_id=m.owner_id AND f.book_id=m.book_id
    WHERE c.owner_id=? AND c.book_id=? AND c.settlement_status='settled'
    ORDER BY c.chapter_number
  `).all(scope.ownerId, scope.bookId) as unknown as ChapterSource[];
  if (chapters.length !== 100 || chapters.at(-1)?.chapter_number !== 100) throw new Error(`${book.title}不是完整100章测试书`);

  const selected: Array<{ chapter: ChapterSource; candidate: Candidate }> = [];
  const categoryKeys = new Set<string>();
  for (const chapter of chapters) {
    const content = readFileSync(resolve(process.cwd(), 'data', chapter.relative_path), 'utf8');
    for (const raw of deterministicFactCandidates(content)) {
      const candidate = raw as unknown as Candidate;
      if (candidate.entityType === 'character') continue;
      if (!content.includes(candidate.evidenceQuote) || candidate.evidenceQuote.length > 600) {
        throw new Error(`${book.title}第${chapter.chapter_number}章存在不可回查的事实证据`);
      }
      const key = `${candidate.entityType}\u0000${candidate.subjectName}`;
      if (categoryKeys.has(key)) continue;
      categoryKeys.add(key);
      selected.push({ chapter, candidate });
    }
  }
  const selectedTypes = new Set(selected.map((item) => item.candidate.entityType));
  for (const requiredType of ['organization', 'location']) {
    if (!selectedTypes.has(requiredType)) throw new Error(`${book.title}正文没有沉淀出${requiredType}分类资料`);
  }
  if (!selectedTypes.has('item') || !selectedTypes.has('resource')) {
    throw new Error(`${book.title}正文没有同时沉淀道具与资源资料`);
  }

  const entityIds = new Map<string, string>();
  const entityId = (name: string, type = 'character'): string => {
    const existing = database.prepare(`SELECT entity_id FROM entities
      WHERE owner_id=? AND book_id=? AND canonical_name=? AND status='active' ORDER BY created_at LIMIT 1`)
      .get(scope.ownerId, scope.bookId, name) as { entity_id: string } | undefined;
    if (existing !== undefined) return existing.entity_id;
    const created = canon.createEntity(scope, { entityType: type, canonicalName: name });
    entityIds.set(name, created);
    return created;
  };
  for (const item of selected) {
    entityId(item.candidate.subjectName, item.candidate.entityType);
    if (typeof item.candidate.value === 'string' && item.candidate.relationKey.startsWith('relationship.')) entityId(item.candidate.value);
  }

  const factIds: string[] = [];
  for (const { chapter, candidate } of selected) {
    const proposed = canon.proposeFact(scope, {
      subjectEntityId: entityId(candidate.subjectName, candidate.entityType),
      relationKey: candidate.relationKey,
      value: candidate.value,
      evidence: [{
        manuscriptVersionId: chapter.manuscript_version_id,
        quote: candidate.evidenceQuote,
        location: candidate.evidenceLocation
      }],
      grade: 'B',
      sourceChapterId: chapter.chapter_id,
      sourceManuscriptVersionId: chapter.manuscript_version_id,
      storyTimeStart: candidate.storyTimeStart ?? `第${chapter.chapter_number}章`,
      storyTimeEnd: candidate.storyTimeEnd,
      epistemicStatus: candidate.epistemicStatus,
      negated: candidate.negated,
      viewpointEntityId: candidate.viewpointName === null ? null : entityId(candidate.viewpointName),
      knowledgeSubjectId: candidate.knowledgeSubjectName === null ? null : entityId(candidate.knowledgeSubjectName),
      knowledgeTimeStart: candidate.knowledgeTimeStart,
      knowledgeTimeEnd: candidate.knowledgeTimeEnd,
      temporalCompleteness: candidate.epistemicStatus === 'objective' ? 'complete' : 'partial'
    });
    if (proposed.status !== 'approved') throw new Error(`${book.title}补建事实进入了非预期状态：${proposed.status}`);
    factIds.push(proposed.factId);
  }

  const now = clock.now().toISOString();
  const nextRevision = book.canon_revision + 1;
  const revisionId = ids.next();
  const changeId = ids.next();
  database.exec('BEGIN IMMEDIATE');
  try {
    const parent = database.prepare(`SELECT canon_revision_id FROM canon_revisions
      WHERE owner_id=? AND book_id=? AND revision=?`).get(scope.ownerId, scope.bookId, book.canon_revision) as { canon_revision_id: string } | undefined;
    if (parent === undefined) throw new Error(`${book.title}当前正史修订记录缺失`);
    const priorFactIds = (database.prepare(`SELECT fact_id FROM canon_bindings
      WHERE owner_id=? AND book_id=? AND canon_revision_id=? AND active=1 ORDER BY fact_id`)
      .all(scope.ownerId, scope.bookId, parent.canon_revision_id) as unknown as Array<{ fact_id: string }>).map((row) => row.fact_id);
    const allFactIds = [...new Set([...priorFactIds, ...factIds])].sort();
    const contentHash = createHash('sha256').update(stableJson(allFactIds)).digest('hex');
    database.prepare(`INSERT INTO canon_revisions (
      canon_revision_id, owner_id, book_id, revision, parent_revision_id, reason, content_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, 'knowledge_backfill', ?, ?)`)
      .run(revisionId, scope.ownerId, scope.bookId, nextRevision, parent.canon_revision_id, contentHash, now);
    database.prepare(`UPDATE fact_assertions SET status='active', reviewed_at=COALESCE(reviewed_at, ?)
      WHERE owner_id=? AND book_id=? AND status='approved' AND fact_id IN (${factIds.map(() => '?').join(',')})`)
      .run(now, scope.ownerId, scope.bookId, ...factIds);
    const bind = database.prepare(`INSERT INTO canon_bindings (
      canon_revision_id, fact_id, owner_id, book_id, active, bound_at
    ) VALUES (?, ?, ?, ?, 1, ?)`);
    for (const factId of allFactIds) bind.run(revisionId, factId, scope.ownerId, scope.bookId, now);
    const updated = database.prepare(`UPDATE books SET canon_revision=?, updated_at=?, version=version+1
      WHERE owner_id=? AND book_id=? AND canon_revision=?`)
      .run(nextRevision, now, scope.ownerId, scope.bookId, book.canon_revision);
    if (updated.changes !== 1) throw new Error(`${book.title}正史版本并发变化`);
    database.prepare(`INSERT INTO canon_revisions_log (
      canon_change_id, owner_id, book_id, from_revision, to_revision, change_type, affected_fact_ids_json, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, 'correction', ?, ?, ?)`)
      .run(changeId, scope.ownerId, scope.bookId, book.canon_revision, nextRevision, stableJson(factIds), REASON, now);
    database.prepare(`UPDATE context_packs SET status='invalidated', invalidated_at=?
      WHERE owner_id=? AND book_id=? AND status='active' AND canon_revision<?`)
      .run(now, scope.ownerId, scope.bookId, nextRevision);
    database.exec('COMMIT');
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  }
  canon.rebuildProjections(scope);
  return summary(target, nextRevision, false);
}

function summary(target: typeof TARGETS[number], revision: number, skipped: boolean): Record<string, unknown> {
  const count = (table: string): number => Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE book_id=?`)
    .get(target.bookId) as { count: number }).count);
  return {
    bookId: target.bookId,
    title: target.expectedTitle,
    revision,
    skipped,
    entities: count('entities'),
    facts: count('fact_assertions'),
    relationships: count('relationship_projection'),
    timeline: count('timeline_projection'),
    knowledgeItems: count('knowledge_items')
  };
}
