import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const OWNER_ID = 'owner-local-boss';
const targets = [
  {
    kind: 'xianxia', bookId: '927f86d4-b118-43f8-a6c1-72d57f080bb0', title: '阵骨问天',
    required: ['沈砚', '许小川', '苏青萝', '阿九', '韩烈', '魏长庚', '阵法', '宗门'],
    forbidden: ['顾野', '唐梨', '陆沉舟', '乔麦', '邵锋', '罗放', '零帧', '帧率', '经济曲线']
  },
  {
    kind: 'esports', bookId: '5d2acbf7-8e98-4f97-b0a0-674571043ff9', title: '零帧登顶',
    required: ['顾野', '唐梨', '陆沉舟', '乔麦', '邵锋', '罗放', '零帧', '帧率', '经济曲线', '总决赛'],
    forbidden: ['沈砚', '许小川', '苏青萝', '阿九', '韩烈', '魏长庚', '阵骨', '灵根', '宗门']
  }
];
const databasePath = resolve(process.argv[2] ?? 'data/database/wenmi.sqlite');
const outputPath = resolve(process.argv[3] ?? 'data/verification/current-workflow-two-books-library-audit-20260811/final-audit.json');
const database = new DatabaseSync(databasePath, { readOnly: true });

try {
  const results = targets.map(auditBook);
  const crossBookViolations = crossBookChecks();
  assert.deepEqual(crossBookViolations, [], `发现跨书关联：${JSON.stringify(crossBookViolations)}`);
  const report = {
    generatedAt: new Date().toISOString(),
    databasePath,
    passed: true,
    crossBookViolations,
    results
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  database.close();
}

function auditBook(target) {
  const book = database.prepare(`SELECT title, canon_revision, status FROM books WHERE owner_id=? AND book_id=?`)
    .get(OWNER_ID, target.bookId);
  assert.ok(book, `${target.title}不存在`);
  assert.equal(book.title, target.title);
  assert.equal(book.canon_revision, 102, `${target.title}应包含100章结算和2次可追溯资料纠错修订`);

  const count = (table, where = '', values = []) => Number(database.prepare(
    `SELECT COUNT(*) AS count FROM ${table} WHERE owner_id=? AND book_id=? ${where}`
  ).get(OWNER_ID, target.bookId, ...values).count);
  const counts = {
    volumes: count('volumes'),
    volumePlans: count('volume_plans'),
    events: count('story_events'),
    eventSequences: count('event_chapter_sequences'),
    chapterOutlines: count('event_chapter_outlines'),
    chapters: count('chapters'),
    settledChapters: count('chapters', "AND settlement_status='settled' AND generation_status='completed'"),
    canonManuscripts: count('manuscript_versions', "AND status='canon'"),
    reviewPanels: count('review_panels', "AND status='complete'"),
    reviewReports: count('review_reports', "AND status='submitted'"),
    chapterSettlements: count('stage_settlements', "AND stage_type='chapter' AND status='active'"),
    eventSettlements: count('stage_settlements', "AND stage_type='story_arc' AND status='active'"),
    volumeSettlements: count('stage_settlements', "AND stage_type='volume' AND status='active'"),
    entities: count('entities', "AND status='active'"),
    activeFacts: count('fact_assertions', "AND status='active'"),
    relationships: count('relationship_projection', 'AND canon_revision=?', [book.canon_revision]),
    timeline: count('timeline_projection', 'AND canon_revision=?', [book.canon_revision]),
    narrativeProjections: count('narrative_projections'),
    chunks: count('content_chunks'),
    currentBindings: Number(database.prepare(`SELECT COUNT(*) AS count FROM canon_bindings b
      JOIN canon_revisions r ON r.canon_revision_id=b.canon_revision_id AND r.owner_id=b.owner_id AND r.book_id=b.book_id
      WHERE b.owner_id=? AND b.book_id=? AND r.revision=? AND b.active=1`)
      .get(OWNER_ID, target.bookId, book.canon_revision).count),
    openTasks: count('tasks', "AND status NOT IN ('succeeded','cancelled','failed')"),
    failedTasks: count('tasks', "AND status='failed'")
  };
  const entityTypes = Object.fromEntries(database.prepare(`SELECT entity_type, COUNT(*) AS count FROM entities
    WHERE owner_id=? AND book_id=? AND status='active' GROUP BY entity_type ORDER BY entity_type`)
    .all(OWNER_ID, target.bookId).map((row) => [row.entity_type, Number(row.count)]));
  const eventTimeline = Number(database.prepare(`SELECT COUNT(*) AS count FROM timeline_projection t
    JOIN fact_assertions f ON f.fact_id=t.source_fact_id AND f.owner_id=t.owner_id AND f.book_id=t.book_id
    WHERE t.owner_id=? AND t.book_id=? AND t.canon_revision=? AND f.relation_key LIKE 'event.%'`)
    .get(OWNER_ID, target.bookId, book.canon_revision).count);
  for (const requiredType of ['organization', 'location', 'item', 'resource']) {
    assert.ok((entityTypes[requiredType] ?? 0) > 0, `${target.title}资料库缺少${requiredType}分类`);
  }
  assert.ok(eventTimeline >= 100, `${target.title}正文事件时间线不足`);
  assert.deepEqual({
    volumes: counts.volumes, volumePlans: counts.volumePlans, events: counts.events,
    eventSequences: counts.eventSequences, chapterOutlines: counts.chapterOutlines,
    chapters: counts.chapters, settledChapters: counts.settledChapters,
    canonManuscripts: counts.canonManuscripts, reviewPanels: counts.reviewPanels,
    reviewReports: counts.reviewReports, chapterSettlements: counts.chapterSettlements,
    eventSettlements: counts.eventSettlements, volumeSettlements: counts.volumeSettlements
  }, {
    volumes: 1, volumePlans: 1, events: 10, eventSequences: 10, chapterOutlines: 100,
    chapters: 100, settledChapters: 100, canonManuscripts: 100, reviewPanels: 100,
    reviewReports: 300, chapterSettlements: 100, eventSettlements: 10, volumeSettlements: 1
  }, `${target.title}主流程计数不完整`);
  assert.ok(counts.entities >= 6, `${target.title}人物实体不足`);
  assert.ok(counts.activeFacts >= 100, `${target.title}正式事实不足`);
  assert.ok(counts.relationships >= 3, `${target.title}人物关系不足`);
  assert.ok(counts.timeline >= 100, `${target.title}时间线不足`);
  assert.equal(counts.currentBindings, counts.activeFacts, `${target.title}当前正史事实绑定不完整`);
  assert.equal(counts.openTasks, 0, `${target.title}仍有未结束任务`);

  const manuscripts = database.prepare(`SELECT c.chapter_number, c.title, m.word_count, f.relative_path
    FROM chapters c JOIN manuscript_versions m ON m.manuscript_version_id=c.canon_manuscript_version_id
    JOIN file_registry f ON f.file_id=m.file_id AND f.owner_id=m.owner_id AND f.book_id=m.book_id
    WHERE c.owner_id=? AND c.book_id=? ORDER BY c.chapter_number`).all(OWNER_ID, target.bookId);
  assert.equal(manuscripts.length, 100);
  const fullText = manuscripts.map((row) => {
    const content = readFileSync(resolve(process.cwd(), 'data', row.relative_path), 'utf8');
    assert.ok(row.title.trim().length > 0 && row.title.length <= 20, `${target.title}第${row.chapter_number}章标题异常`);
    assert.ok(row.word_count >= 2350 && row.word_count <= 3650, `${target.title}第${row.chapter_number}章字数越界：${row.word_count}`);
    assert.doesNotMatch(content, /(?:workflowArtifact|```json|book_id|source_id|sourceId|contextPack|system prompt|作为AI|我是AI|\uFFFD)/iu,
      `${target.title}第${row.chapter_number}章泄漏技术信息或乱码`);
    assert.doesNotMatch(content, /(?:鏂|鍐欎|锛|绉樺|浣滃)/u, `${target.title}第${row.chapter_number}章疑似乱码`);
    return content;
  }).join('\n');
  for (const term of target.required) assert.ok(fullText.includes(term), `${target.title}缺少题材关键内容：${term}`);
  for (const term of [...target.forbidden, '林澈', '铜钥匙']) assert.ok(!fullText.includes(term), `${target.title}混入其他书内容：${term}`);

  const evidenceRows = database.prepare(`SELECT f.fact_id, f.evidence_json, fr.relative_path
    FROM fact_assertions f JOIN file_registry fr ON fr.version_id=f.source_manuscript_version_id
      AND fr.owner_id=f.owner_id AND fr.book_id=f.book_id
    WHERE f.owner_id=? AND f.book_id=? AND f.status='active'`).all(OWNER_ID, target.bookId);
  assert.equal(evidenceRows.length, counts.activeFacts, `${target.title}事实来源文件不完整`);
  for (const row of evidenceRows) {
    const source = readFileSync(resolve(process.cwd(), 'data', row.relative_path), 'utf8');
    const evidence = JSON.parse(row.evidence_json);
    assert.ok(Array.isArray(evidence) && evidence.length > 0, `${row.fact_id}没有证据`);
    for (const item of evidence) assert.ok(typeof item.quote === 'string' && source.includes(item.quote), `${row.fact_id}证据无法回查原文`);
  }

  const entityNames = database.prepare(`SELECT canonical_name FROM entities
    WHERE owner_id=? AND book_id=? AND status='active' ORDER BY canonical_name`).all(OWNER_ID, target.bookId).map((row) => row.canonical_name);
  for (const name of target.required.slice(0, 6)) assert.ok(entityNames.includes(name), `${target.title}资料库缺少人物：${name}`);
  return { kind: target.kind, bookId: target.bookId, title: target.title, canonRevision: book.canon_revision, counts, entityTypes, eventTimeline, entityNames, evidenceChecked: evidenceRows.length };
}

function crossBookChecks() {
  const checks = [
    ['fact_entity', `SELECT f.fact_id AS id FROM fact_assertions f JOIN entities e ON e.entity_id=f.subject_entity_id
      WHERE f.owner_id<>e.owner_id OR f.book_id<>e.book_id`],
    ['fact_chapter', `SELECT f.fact_id AS id FROM fact_assertions f JOIN chapters c ON c.chapter_id=f.source_chapter_id
      WHERE f.owner_id<>c.owner_id OR f.book_id<>c.book_id`],
    ['fact_manuscript', `SELECT f.fact_id AS id FROM fact_assertions f JOIN manuscript_versions m ON m.manuscript_version_id=f.source_manuscript_version_id
      WHERE f.owner_id<>m.owner_id OR f.book_id<>m.book_id`],
    ['relationship_entity', `SELECT r.relationship_id AS id FROM relationship_projection r JOIN entities e ON e.entity_id=r.from_entity_id
      WHERE r.owner_id<>e.owner_id OR r.book_id<>e.book_id`],
    ['relationship_fact', `SELECT r.relationship_id AS id FROM relationship_projection r JOIN fact_assertions f ON f.fact_id=r.source_fact_id
      WHERE r.owner_id<>f.owner_id OR r.book_id<>f.book_id`],
    ['timeline_entity', `SELECT t.timeline_id AS id FROM timeline_projection t JOIN entities e ON e.entity_id=t.entity_id
      WHERE t.owner_id<>e.owner_id OR t.book_id<>e.book_id`],
    ['timeline_fact', `SELECT t.timeline_id AS id FROM timeline_projection t JOIN fact_assertions f ON f.fact_id=t.source_fact_id
      WHERE t.owner_id<>f.owner_id OR t.book_id<>f.book_id`]
  ];
  return checks.flatMap(([kind, sql]) => database.prepare(sql).all().map((row) => ({ kind, id: row.id })));
}
