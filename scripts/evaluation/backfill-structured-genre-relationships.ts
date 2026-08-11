import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CanonService, stableJson } from '../../apps/api/src/application/knowledge/canon-service.js';
import { SystemClock, UuidGenerator } from '../../apps/api/src/domain/ids.js';
import { deterministicFactCandidates } from '../../apps/api/src/infrastructure/models/deterministic-novel-models.js';

const REASON = 'structured-genre-relationship-evidence-backfill-v1';
const TARGETS = [
  { bookId: '6ea9d46d-2d60-40fe-8e1a-261d1db1f17b', expectedTitle: '灵契天墟', expectedRelationships: 5 },
  { bookId: '1d3246b9-8e25-4829-b50f-b507d3681c5c', expectedTitle: '灰烬领主', expectedRelationships: 5 }
] as const;

interface Candidate {
  subjectName: string;
  entityType: string;
  relationKey: string;
  value: unknown;
  evidenceQuote: string;
  evidenceLocation: string;
  epistemicStatus: 'objective';
  negated: boolean;
  viewpointName: string | null;
  knowledgeSubjectName: string | null;
  knowledgeTimeStart: string | null;
  knowledgeTimeEnd: string | null;
  storyTimeStart: string | null;
  storyTimeEnd: string | null;
}

const database = new DatabaseSync(resolve(process.argv[2] ?? 'data/database/wenmi.sqlite'));
database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 30000;');
const ids = new UuidGenerator();
const clock = new SystemClock();
const canon = new CanonService(database, ids, clock);

try {
  const results = TARGETS.map(backfill);
  process.stdout.write(`${JSON.stringify({ reason: REASON, results }, null, 2)}\n`);
} finally {
  database.close();
}

function backfill(target: typeof TARGETS[number]) {
  const book = database.prepare(`SELECT owner_id, title, canon_revision FROM books WHERE book_id = ?`)
    .get(target.bookId) as { owner_id: string; title: string; canon_revision: number } | undefined;
  if (book === undefined || book.title !== target.expectedTitle) throw new Error(`测试书不存在或标题不匹配：${target.expectedTitle}`);
  const scope = { ownerId: book.owner_id, bookId: target.bookId };
  const completed = database.prepare(`SELECT to_revision FROM canon_revisions_log
    WHERE owner_id = ? AND book_id = ? AND change_type = 'correction' AND reason = ?`)
    .get(scope.ownerId, scope.bookId, REASON) as { to_revision: number } | undefined;
  if (completed !== undefined) return summary(target, completed.to_revision, true);

  const chapter = database.prepare(`SELECT c.chapter_id, m.manuscript_version_id, f.relative_path
    FROM chapters c
    JOIN manuscript_versions m ON m.manuscript_version_id = c.canon_manuscript_version_id
    JOIN file_registry f ON f.file_id = m.file_id
    WHERE c.owner_id = ? AND c.book_id = ? AND c.chapter_number = 1 AND c.settlement_status = 'settled'`)
    .get(scope.ownerId, scope.bookId) as { chapter_id: string; manuscript_version_id: string; relative_path: string } | undefined;
  if (chapter === undefined) throw new Error(`${book.title}缺少已结算第一章`);
  const content = readFileSync(resolve(process.cwd(), 'data', chapter.relative_path), 'utf8');
  const candidates = deterministicFactCandidates(content)
    .map((item) => item as unknown as Candidate)
    .filter((item) => item.relationKey.startsWith('relationship.'));
  if (candidates.length !== target.expectedRelationships) {
    throw new Error(`${book.title}只能从第一章提取${candidates.length}条关系，预期${target.expectedRelationships}条`);
  }
  for (const candidate of candidates) {
    if (typeof candidate.value !== 'string' || !content.includes(candidate.evidenceQuote)) {
      throw new Error(`${book.title}关系事实缺少可回查的正文证据`);
    }
  }

  const entityId = (name: string, type = 'character') => {
    const existing = database.prepare(`SELECT entity_id FROM entities
      WHERE owner_id = ? AND book_id = ? AND canonical_name = ? AND status = 'active' ORDER BY created_at LIMIT 1`)
      .get(scope.ownerId, scope.bookId, name) as { entity_id: string } | undefined;
    return existing?.entity_id ?? canon.createEntity(scope, { entityType: type, canonicalName: name });
  };
  const existingFacts = database.prepare(`SELECT f.fact_id, e.canonical_name, f.relation_key, f.value_json, f.status
    FROM fact_assertions f JOIN entities e ON e.entity_id = f.subject_entity_id
    WHERE f.owner_id = ? AND f.book_id = ? AND f.status IN ('active', 'approved', 'awaiting_editor')
      AND f.relation_key LIKE 'relationship.%'`)
    .all(scope.ownerId, scope.bookId) as unknown as Array<{
      fact_id: string;
      canonical_name: string;
      relation_key: string;
      value_json: string;
      status: string;
    }>;
  const existingByKey = new Map(existingFacts.map((row) => [
    `${row.canonical_name}\u0000${row.relation_key}\u0000${String(JSON.parse(row.value_json))}`,
    row
  ]));
  const addedFactIds: string[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.subjectName}\u0000${candidate.relationKey}\u0000${String(candidate.value)}`;
    const existing = existingByKey.get(key);
    if (existing?.status === 'active') continue;
    if (existing?.status === 'awaiting_editor') canon.reviewFact(scope, existing.fact_id, true, { reason: REASON });
    if (existing !== undefined) {
      addedFactIds.push(existing.fact_id);
      continue;
    }
    entityId(candidate.subjectName, candidate.entityType);
    entityId(String(candidate.value));
    const fact = canon.proposeFact(scope, {
      subjectEntityId: entityId(candidate.subjectName, candidate.entityType),
      relationKey: candidate.relationKey,
      value: candidate.value,
      evidence: [{ manuscriptVersionId: chapter.manuscript_version_id, quote: candidate.evidenceQuote, location: candidate.evidenceLocation }],
      grade: 'B',
      sourceChapterId: chapter.chapter_id,
      sourceManuscriptVersionId: chapter.manuscript_version_id,
      storyTimeStart: candidate.storyTimeStart ?? '第1章',
      storyTimeEnd: candidate.storyTimeEnd,
      epistemicStatus: candidate.epistemicStatus,
      negated: candidate.negated,
      viewpointEntityId: null,
      knowledgeSubjectId: null,
      knowledgeTimeStart: null,
      knowledgeTimeEnd: null,
      temporalCompleteness: 'complete'
    });
    if (fact.status === 'awaiting_editor') canon.reviewFact(scope, fact.factId, true, { reason: REASON });
    else if (fact.status !== 'approved') throw new Error(`${book.title}关系事实未进入可确认状态`);
    addedFactIds.push(fact.factId);
  }
  if (addedFactIds.length === 0) return summary(target, book.canon_revision, true);

  const now = clock.now().toISOString();
  const nextRevision = book.canon_revision + 1;
  const revisionId = ids.next();
  const changeId = ids.next();
  database.exec('BEGIN IMMEDIATE');
  try {
    const parent = database.prepare(`SELECT canon_revision_id FROM canon_revisions
      WHERE owner_id = ? AND book_id = ? AND revision = ?`).get(scope.ownerId, scope.bookId, book.canon_revision) as { canon_revision_id: string } | undefined;
    if (parent === undefined) throw new Error(`${book.title}当前正史修订记录缺失`);
    const priorFactIds = (database.prepare(`SELECT fact_id FROM canon_bindings
      WHERE owner_id = ? AND book_id = ? AND canon_revision_id = ? AND active = 1 ORDER BY fact_id`)
      .all(scope.ownerId, scope.bookId, parent.canon_revision_id) as unknown as Array<{ fact_id: string }>).map((row) => row.fact_id);
    const allFactIds = [...new Set([...priorFactIds, ...addedFactIds])].sort();
    const contentHash = createHash('sha256').update(stableJson(allFactIds)).digest('hex');
    database.prepare(`INSERT INTO canon_revisions (
      canon_revision_id, owner_id, book_id, revision, parent_revision_id, reason, content_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, 'knowledge_backfill', ?, ?)`)
      .run(revisionId, scope.ownerId, scope.bookId, nextRevision, parent.canon_revision_id, contentHash, now);
    database.prepare(`UPDATE fact_assertions SET status = 'active', reviewed_at = COALESCE(reviewed_at, ?)
      WHERE owner_id = ? AND book_id = ? AND status = 'approved' AND fact_id IN (${addedFactIds.map(() => '?').join(',')})`)
      .run(now, scope.ownerId, scope.bookId, ...addedFactIds);
    const bind = database.prepare(`INSERT INTO canon_bindings (
      canon_revision_id, fact_id, owner_id, book_id, active, bound_at
    ) VALUES (?, ?, ?, ?, 1, ?)`);
    for (const factId of allFactIds) bind.run(revisionId, factId, scope.ownerId, scope.bookId, now);
    const updated = database.prepare(`UPDATE books SET canon_revision = ?, updated_at = ?, version = version + 1
      WHERE owner_id = ? AND book_id = ? AND canon_revision = ?`)
      .run(nextRevision, now, scope.ownerId, scope.bookId, book.canon_revision);
    if (updated.changes !== 1) throw new Error(`${book.title}正史版本并发变化`);
    database.prepare(`INSERT INTO canon_revisions_log (
      canon_change_id, owner_id, book_id, from_revision, to_revision, change_type, affected_fact_ids_json, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, 'correction', ?, ?, ?)`)
      .run(changeId, scope.ownerId, scope.bookId, book.canon_revision, nextRevision, stableJson(addedFactIds), REASON, now);
    database.exec('COMMIT');
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  }
  canon.rebuildProjections(scope);
  return summary(target, nextRevision, false);
}

function summary(target: typeof TARGETS[number], revision: number, skipped: boolean) {
  const relationships = Number((database.prepare(`SELECT COUNT(*) AS count FROM relationship_projection
    WHERE book_id = ? AND canon_revision = ?`).get(target.bookId, revision) as { count: number }).count);
  return { bookId: target.bookId, title: target.expectedTitle, revision, skipped, relationships };
}
