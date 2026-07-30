import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const databasePath = resolve(process.cwd(), 'data/database/wenmi.sqlite');
const database = new DatabaseSync(databasePath, { readOnly: true });
const requestedBookId = process.argv[2]?.trim();

const book = requestedBookId
  ? database.prepare(`
      SELECT owner_id, book_id, title, status, canon_revision, updated_at
      FROM books
      WHERE book_id = ?
    `).get(requestedBookId)
  : database.prepare(`
      SELECT owner_id, book_id, title, status, canon_revision, updated_at
      FROM books
      ORDER BY updated_at DESC
      LIMIT 1
    `).get();

if (book === undefined) {
  throw new Error(requestedBookId === undefined ? '数据库中没有书籍' : `找不到书籍 ${requestedBookId}`);
}

const scope = [book.owner_id, book.book_id];
const scopedCount = (table, extra = '') => Number(database.prepare(`
  SELECT COUNT(*) AS count
  FROM ${table}
  WHERE owner_id = ? AND book_id = ? ${extra}
`).get(...scope).count);

const report = {
  databasePath,
  book,
  counts: {
    chapters: scopedCount('chapters'),
    settledChapters: scopedCount('chapters', `AND settlement_status = 'settled'`),
    entities: scopedCount('entities'),
    activeEntities: scopedCount('entities', `AND status = 'active'`),
    facts: scopedCount('fact_assertions'),
    visibleFacts: scopedCount('fact_assertions', `AND status NOT IN ('withdrawn', 'rejected')`),
    relationshipProjections: scopedCount('relationship_projection'),
    currentRelationshipProjections: scopedCount('relationship_projection', 'AND canon_revision = ' + Number(book.canon_revision)),
    narrativeProjections: scopedCount('narrative_projections'),
    currentNarrativeProjections: scopedCount('narrative_projections', 'AND canon_revision = ' + Number(book.canon_revision)),
    protagonistProfiles: scopedCount('protagonist_profiles'),
    protagonistStates: scopedCount('protagonist_state_entries'),
    knowledgeItems: scopedCount('knowledge_items'),
    knowledgeRevisions: scopedCount('knowledge_revisions'),
    confirmedSettings: scopedCount('setting_outline_workspace', `AND item_status = '已确认' AND content_text IS NOT NULL`),
    emptyNarrativeProjections: scopedCount('narrative_projections', `AND json_extract(content_json, '$.status') = 'not_extracted'`)
  },
  entitiesWithoutVisibleFacts: Number(database.prepare(`
    SELECT COUNT(*) AS count FROM entities e
    WHERE e.owner_id = ? AND e.book_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM fact_assertions f
        WHERE f.owner_id = e.owner_id AND f.book_id = e.book_id
          AND f.subject_entity_id = e.entity_id
          AND f.status NOT IN ('withdrawn', 'rejected')
      )
  `).get(...scope).count),
  entitiesByType: database.prepare(`
    SELECT entity_type AS type, status, COUNT(*) AS count
    FROM entities
    WHERE owner_id = ? AND book_id = ?
    GROUP BY entity_type, status
    ORDER BY entity_type, status
  `).all(...scope),
  factsByRelation: database.prepare(`
    SELECT e.canonical_name AS subject, e.entity_type AS entityType,
      f.relation_key AS relation, f.status, COUNT(*) AS count
    FROM fact_assertions f
    JOIN entities e
      ON e.owner_id = f.owner_id AND e.book_id = f.book_id
      AND e.entity_id = f.subject_entity_id
    WHERE f.owner_id = ? AND f.book_id = ?
    GROUP BY e.canonical_name, e.entity_type, f.relation_key, f.status
    ORDER BY e.canonical_name, f.relation_key
  `).all(...scope),
  narrativeByType: database.prepare(`
    SELECT projection_type AS type, track, canon_revision AS canonRevision, COUNT(*) AS count
    FROM narrative_projections
    WHERE owner_id = ? AND book_id = ?
    GROUP BY projection_type, track, canon_revision
    ORDER BY projection_type, track, canon_revision
  `).all(...scope),
  narrativeSamples: database.prepare(`
    SELECT projection_type AS type, track, chapter_number AS chapterNumber,
      content_json AS content, source_ids_json AS sourceIds
    FROM narrative_projections
    WHERE owner_id = ? AND book_id = ?
    ORDER BY chapter_number, projection_type, track
    LIMIT 30
  `).all(...scope),
  selectedArtifacts: database.prepare(`
    SELECT a.artifact_type AS type, COUNT(*) AS count
    FROM artifacts a
    JOIN artifact_versions v
      ON v.owner_id = a.owner_id AND v.book_id = a.book_id
      AND v.artifact_id = a.artifact_id
    WHERE a.owner_id = ? AND a.book_id = ? AND v.status = 'selected'
    GROUP BY a.artifact_type
    ORDER BY a.artifact_type
  `).all(...scope),
  selectedArtifactSamples: database.prepare(`
    SELECT a.artifact_type AS type, v.content_json AS content
    FROM artifacts a
    JOIN artifact_versions v
      ON v.owner_id = a.owner_id AND v.book_id = a.book_id
      AND v.artifact_id = a.artifact_id
    WHERE a.owner_id = ? AND a.book_id = ? AND v.status = 'selected'
    ORDER BY a.artifact_type, v.created_at
    LIMIT 15
  `).all(...scope),
  chapterEndStateSamples: database.prepare(`
    SELECT c.chapter_number AS chapterNumber, c.title, e.state_json AS state
    FROM chapters c
    LEFT JOIN chapter_end_states e
      ON e.owner_id = c.owner_id AND e.book_id = c.book_id
      AND e.chapter_end_state_id = c.chapter_end_state_id
    WHERE c.owner_id = ? AND c.book_id = ?
    ORDER BY c.chapter_number
    LIMIT 3
  `).all(...scope),
  entitySamples: database.prepare(`
    SELECT e.entity_id AS entityId, e.entity_type AS entityType,
      e.canonical_name AS name, e.aliases_json AS aliases, e.status,
      COUNT(f.fact_id) AS factCount,
      GROUP_CONCAT(DISTINCT f.relation_key) AS relations
    FROM entities e
    LEFT JOIN fact_assertions f
      ON f.owner_id = e.owner_id AND f.book_id = e.book_id
      AND f.subject_entity_id = e.entity_id
      AND f.status NOT IN ('withdrawn', 'rejected')
    WHERE e.owner_id = ? AND e.book_id = ?
    GROUP BY e.entity_id
    ORDER BY e.entity_type, e.canonical_name
    LIMIT 100
  `).all(...scope),
  factSamples: database.prepare(`
    SELECT f.fact_id AS factId, e.canonical_name AS subject,
      e.entity_type AS entityType, f.relation_key AS relation,
      f.value_json AS value, f.evidence_json AS evidence,
      f.grade, f.status, f.source_chapter_id AS sourceChapterId
    FROM fact_assertions f
    JOIN entities e
      ON e.owner_id = f.owner_id AND e.book_id = f.book_id
      AND e.entity_id = f.subject_entity_id
    WHERE f.owner_id = ? AND f.book_id = ?
      AND f.status NOT IN ('withdrawn', 'rejected')
    ORDER BY e.canonical_name, f.relation_key
    LIMIT 200
  `).all(...scope)
};

console.log(JSON.stringify(report, null, 2));
