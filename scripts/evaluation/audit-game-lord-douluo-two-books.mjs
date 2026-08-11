import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ownerEmail = process.argv[2];
const gameLordBookId = process.argv[3];
const douluoBookId = process.argv[4];
assert.ok(ownerEmail && gameLordBookId && douluoBookId,
  '用法：node audit-game-lord-douluo-two-books.mjs <账号邮箱> <游戏领主书籍ID> <斗罗同人书籍ID> [输出文件] [数据库]');

const outputPath = resolve(process.argv[5] ?? 'data/verification/game-lord-douluo-two-books-200-chapters/final-audit.json');
const databasePath = resolve(process.argv[6] ?? 'data/database/wenmi.sqlite');
const database = new DatabaseSync(databasePath, { readOnly: true });
const account = database.prepare('SELECT owner_id, role, status FROM user_accounts WHERE email_normalized=?').get(ownerEmail.toLowerCase());
assert.ok(account, '测试账号不存在');
assert.equal(account.status, 'active', '测试账号不是正常状态');
const ownerId = account.owner_id;

const targets = [
  {
    kind: 'game_lord',
    bookId: gameLordBookId,
    title: '界域领主日志',
    required: ['苏砚', '晨星领', '领主面板', '领地等级', '资源结算', '资源产出', '英雄属性', '建筑面板', '升级消耗规划'],
    forbidden: ['顾星河', '银羽', '斗罗大陆', '武魂', '魂力等级', '魂环配置']
  },
  {
    kind: 'douluo_fanfic',
    bookId: douluoBookId,
    title: '斗罗星轮行',
    required: ['顾星河', '银羽', '斗罗大陆', '武魂', '魂力等级', '魂环配置', '魂技', '魂兽伙伴状态', '星斗大森林'],
    forbidden: ['苏砚', '晨星领', '领主面板', '资源结算', '建筑面板', '唐三', '小舞']
  }
];

try {
  const results = targets.map(auditBook);
  const crossBookViolations = auditRelationalIsolation();
  const contextIsolation = auditContextIsolation();
  assert.deepEqual(crossBookViolations, [], `发现跨书关系：${JSON.stringify(crossBookViolations)}`);
  const report = {
    generatedAt: new Date().toISOString(),
    evidenceLevel: 'E2-local-deterministic-current-workflow',
    limitation: '本报告证明当前工作流、数据、检索、审查和结算在本地确定性模型下可运行；不替代真实外部模型的文学质量验收。',
    databasePath,
    owner: { ownerId, role: account.role, status: account.status },
    passed: true,
    crossBookViolations,
    contextIsolation,
    results
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ passed: true, outputPath, results: results.map(compactResult), contextIsolation }, null, 2)}\n`);
} finally {
  database.close();
}

function auditBook(target) {
  const book = database.prepare('SELECT owner_id,title,canon_revision,status FROM books WHERE book_id=?').get(target.bookId);
  assert.ok(book, `${target.title}不存在`);
  assert.equal(book.owner_id, ownerId, `${target.title}不属于测试账号`);
  assert.equal(book.title, target.title);
  assert.notEqual(book.status, 'archived');
  const count = (table, clause = '', values = []) => Number(database.prepare(
    `SELECT COUNT(1) AS count FROM ${table} WHERE owner_id=? AND book_id=? ${clause}`
  ).get(ownerId, target.bookId, ...values).count);
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
    contextPacks: count('context_packs'),
    retrievals: count('retrieval_records'),
    activeTasks: count('tasks', "AND status IN ('queued','claimed','running','working','preparing','waiting_confirmation','retrying')")
  };
  assert.deepEqual({
    volumes: counts.volumes,
    volumePlans: counts.volumePlans,
    events: counts.events,
    eventSequences: counts.eventSequences,
    chapterOutlines: counts.chapterOutlines,
    chapters: counts.chapters,
    settledChapters: counts.settledChapters,
    canonManuscripts: counts.canonManuscripts,
    reviewPanels: counts.reviewPanels,
    reviewReports: counts.reviewReports,
    chapterSettlements: counts.chapterSettlements,
    eventSettlements: counts.eventSettlements,
    volumeSettlements: counts.volumeSettlements
  }, {
    volumes: 1,
    volumePlans: 1,
    events: 10,
    eventSequences: 10,
    chapterOutlines: 100,
    chapters: 100,
    settledChapters: 100,
    canonManuscripts: 100,
    reviewPanels: 100,
    reviewReports: 300,
    chapterSettlements: 100,
    eventSettlements: 10,
    volumeSettlements: 1
  }, `${target.title}的主工作流对象不完整`);
  assert.equal(book.canon_revision, 100, `${target.title}正史版本不是100`);
  assert.equal(counts.activeTasks, 0, `${target.title}仍有活动任务`);
  assert.ok(counts.contextPacks >= 400, `${target.title}上下文包数量不足`);
  assert.ok(counts.retrievals >= 100, `${target.title}检索记录数量不足`);

  const entityTypes = Object.fromEntries(database.prepare(
    "SELECT entity_type,COUNT(1) AS count FROM entities WHERE owner_id=? AND book_id=? AND status='active' GROUP BY entity_type"
  ).all(ownerId, target.bookId).map((row) => [row.entity_type, Number(row.count)]));
  for (const type of ['character', 'location', 'organization', 'item', 'stat_panel']) {
    assert.ok((entityTypes[type] ?? 0) > 0, `${target.title}资料库缺少${type}`);
  }
  assert.ok((entityTypes[target.kind === 'game_lord' ? 'resource' : 'skill'] ?? 0) > 0, `${target.title}资料库缺少题材专用类型`);
  assert.ok(counts.activeFacts >= 100, `${target.title}正式事实不足`);
  assert.ok(counts.relationships >= 2, `${target.title}缺少有正文证据的核心关系资料`);
  assert.ok(counts.timeline >= 100, `${target.title}事件时间线不足`);

  const rows = database.prepare(`
    SELECT c.chapter_number,c.title,m.word_count,f.relative_path
    FROM chapters c
    JOIN manuscript_versions m ON m.manuscript_version_id=c.canon_manuscript_version_id
    JOIN file_registry f ON f.file_id=m.file_id AND f.owner_id=m.owner_id AND f.book_id=m.book_id
    WHERE c.owner_id=? AND c.book_id=?
    ORDER BY c.chapter_number
  `).all(ownerId, target.bookId);
  assert.equal(rows.length, 100);
  const manuscripts = rows.map((row) => ({ ...row, content: readFileSync(resolve(process.cwd(), 'data', row.relative_path), 'utf8') }));
  for (const row of manuscripts) {
    assert.equal(row.chapter_number, manuscripts.indexOf(row) + 1, `${target.title}章节号不连续`);
    assert.ok(row.title.trim().length > 0 && row.title.length <= 24, `${target.title}第${row.chapter_number}章标题异常`);
    assert.ok(row.word_count >= 2350 && row.word_count <= 3650, `${target.title}第${row.chapter_number}章字数越界：${row.word_count}`);
    assert.doesNotMatch(row.content, /(?:workflowArtifact|```json|book_id|source_id|sourceId|contextPack|system prompt|作为AI|我是AI|temperature|token|schema|\uFFFD)/iu,
      `${target.title}第${row.chapter_number}章泄漏技术信息或乱码`);
    for (const term of target.forbidden) assert.ok(!row.content.includes(term), `${target.title}第${row.chapter_number}章混入禁用内容：${term}`);
  }
  const fullText = manuscripts.map((row) => row.content).join('\n');
  for (const term of target.required) assert.ok(fullText.includes(term), `${target.title}缺少题材内容：${term}`);
  const repeatedPairs = [];
  for (let index = 1; index < manuscripts.length; index += 1) {
    const similarity = tokenSetSimilarity(manuscripts[index - 1].content, manuscripts[index].content);
    if (similarity > 0.88) repeatedPairs.push({ previous: index, current: index + 1, similarity: Number(similarity.toFixed(4)) });
  }
  assert.deepEqual(repeatedPairs, [], `${target.title}相邻章节过度重复`);

  const evidenceRows = database.prepare(`
    SELECT f.fact_id,f.evidence_json,fr.relative_path
    FROM fact_assertions f
    JOIN file_registry fr ON fr.version_id=f.source_manuscript_version_id AND fr.owner_id=f.owner_id AND fr.book_id=f.book_id
    WHERE f.owner_id=? AND f.book_id=? AND f.status='active'
  `).all(ownerId, target.bookId);
  assert.equal(evidenceRows.length, counts.activeFacts, `${target.title}事实来源文件不完整`);
  for (const row of evidenceRows) {
    const source = readFileSync(resolve(process.cwd(), 'data', row.relative_path), 'utf8');
    const evidence = JSON.parse(row.evidence_json);
    assert.ok(Array.isArray(evidence) && evidence.length > 0, `${row.fact_id}没有证据`);
    for (const item of evidence) assert.ok(typeof item.quote === 'string' && source.includes(item.quote), `${row.fact_id}证据无法回查原文`);
  }

  const genreAudit = target.kind === 'game_lord' ? auditGameLord(manuscripts) : auditDouluo(manuscripts);
  return {
    kind: target.kind,
    bookId: target.bookId,
    title: target.title,
    canonRevision: book.canon_revision,
    counts,
    entityTypes,
    evidenceChecked: evidenceRows.length,
    adjacentSimilarityPassed: true,
    genreAudit
  };
}

function auditGameLord(manuscripts) {
  let panelChapters = 0;
  let ledgerChapters = 0;
  let buildingChapters = 0;
  let heroChapters = 0;
  let upgradeChapters = 0;
  for (const row of manuscripts) {
    if (row.content.includes('领主面板')) panelChapters += 1;
    if (row.content.includes('资源结算') && row.content.includes('本章获得') && row.content.includes('本章消耗') && row.content.includes('期末库存')) ledgerChapters += 1;
    if (row.content.includes('建筑面板')) buildingChapters += 1;
    if (row.content.includes('英雄属性')) heroChapters += 1;
    if (row.content.includes('升级消耗规划')) upgradeChapters += 1;
  }
  for (const [label, count] of Object.entries({ panelChapters, ledgerChapters, buildingChapters, heroChapters, upgradeChapters })) {
    assert.equal(count, 100, `游戏领主文${label}没有覆盖100章`);
  }
  return { panelChapters, ledgerChapters, buildingChapters, heroChapters, upgradeChapters };
}

function auditDouluo(manuscripts) {
  let soulMasterPanels = 0;
  let companionPanels = 0;
  let soulRingMentions = 0;
  let soulSkillMentions = 0;
  for (const row of manuscripts) {
    if (row.content.includes('魂师状态：顾星河') && row.content.includes('魂力等级')) soulMasterPanels += 1;
    if (row.content.includes('魂兽伙伴状态：银羽')) companionPanels += 1;
    if (row.content.includes('魂环配置')) soulRingMentions += 1;
    if (row.content.includes('魂技')) soulSkillMentions += 1;
    assert.ok(row.content.includes('原创支线') || row.chapter_number > 1, '第一章没有声明原创支线边界');
  }
  for (const [label, count] of Object.entries({ soulMasterPanels, companionPanels, soulRingMentions, soulSkillMentions })) {
    assert.equal(count, 100, `斗罗同人${label}没有覆盖100章`);
  }
  return { soulMasterPanels, companionPanels, soulRingMentions, soulSkillMentions, originalMainlineCharactersExcluded: true };
}

function auditContextIsolation() {
  const rows = database.prepare('SELECT context_pack_id,book_id,source_manifest_json FROM context_packs WHERE owner_id=? AND book_id IN (?,?)')
    .all(ownerId, gameLordBookId, douluoBookId);
  const violations = [];
  for (const row of rows) {
    const foreign = row.book_id === gameLordBookId ? targets[1] : targets[0];
    const text = row.source_manifest_json;
    if (text.includes(foreign.bookId) || foreign.required.slice(0, 5).some((term) => text.includes(term))) {
      violations.push({ contextPackId: row.context_pack_id, bookId: row.book_id });
    }
  }
  assert.deepEqual(violations, [], '上下文包混入另一本书资料');
  return { checked: rows.length, violations };
}

function auditRelationalIsolation() {
  const checks = [
    ['fact_entity', 'SELECT f.fact_id AS id FROM fact_assertions f JOIN entities e ON e.entity_id=f.subject_entity_id WHERE f.owner_id<>e.owner_id OR f.book_id<>e.book_id'],
    ['fact_chapter', 'SELECT f.fact_id AS id FROM fact_assertions f JOIN chapters c ON c.chapter_id=f.source_chapter_id WHERE f.owner_id<>c.owner_id OR f.book_id<>c.book_id'],
    ['fact_manuscript', 'SELECT f.fact_id AS id FROM fact_assertions f JOIN manuscript_versions m ON m.manuscript_version_id=f.source_manuscript_version_id WHERE f.owner_id<>m.owner_id OR f.book_id<>m.book_id'],
    ['relationship_entity', 'SELECT r.relationship_id AS id FROM relationship_projection r JOIN entities e ON e.entity_id=r.from_entity_id WHERE r.owner_id<>e.owner_id OR r.book_id<>e.book_id'],
    ['timeline_fact', 'SELECT t.timeline_id AS id FROM timeline_projection t JOIN fact_assertions f ON f.fact_id=t.source_fact_id WHERE t.owner_id<>f.owner_id OR t.book_id<>f.book_id'],
    ['context_task', 'SELECT p.context_pack_id AS id FROM context_packs p JOIN tasks t ON t.task_id=p.task_id WHERE p.owner_id<>t.owner_id OR p.book_id<>t.book_id'],
    ['context_chapter', 'SELECT p.context_pack_id AS id FROM context_packs p JOIN chapters c ON c.chapter_id=p.chapter_id WHERE p.owner_id<>c.owner_id OR p.book_id<>c.book_id']
  ];
  return checks.flatMap(([kind, sql]) => database.prepare(sql).all().map((row) => ({ kind, id: row.id })));
}

function tokenSetSimilarity(left, right) {
  const tokens = (text) => new Set(text.replace(/\s+/gu, '').match(/.{1,12}/gu) ?? []);
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / Math.max(1, new Set([...leftTokens, ...rightTokens]).size);
}

function compactResult(result) {
  return {
    kind: result.kind,
    bookId: result.bookId,
    title: result.title,
    canonRevision: result.canonRevision,
    counts: result.counts,
    entityTypes: result.entityTypes,
    evidenceChecked: result.evidenceChecked,
    genreAudit: result.genreAudit
  };
}
