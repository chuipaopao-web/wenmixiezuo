import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const bookId = process.env.WENMI_VERIFY_BOOK_ID ?? '85ec2145-c0e6-480a-b80c-8e62bcc45428';
const databasePath = path.resolve(process.env.WENMI_DATABASE_PATH ?? 'data/database/wenmi.sqlite');
const evidenceDirectory = path.resolve('data', 'verification', 'full-flow-20260730');
mkdirSync(evidenceDirectory, { recursive: true });

const database = new DatabaseSync(databasePath, { readOnly: true });
const failures = [];

function requireCheck(condition, message) {
  if (!condition) failures.push(message);
}

try {
  const book = database.prepare(`
    SELECT owner_id, book_id, title, status, canon_revision
    FROM books
    WHERE book_id = ?
  `).get(bookId);
  if (book === undefined) throw new Error(`目标书籍不存在：${bookId}`);

  const planning = database.prepare(`
    SELECT version, stage, setting_baseline_version_id, master_outline_version_id,
      volume_outline_version_id
    FROM book_planning_states
    WHERE owner_id = ? AND book_id = ?
  `).get(book.owner_id, bookId);

  const settingSummary = database.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN item_status = '已确认' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN content_text IS NOT NULL AND length(trim(content_text)) >= 8 THEN 1 ELSE 0 END) AS with_content
    FROM setting_outline_workspace
    WHERE owner_id = ? AND book_id = ?
  `).get(book.owner_id, bookId);

  const artifactRows = database.prepare(`
    SELECT a.artifact_type, a.title, a.active_version_id, v.status, v.content_json
    FROM artifacts a
    JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
    WHERE a.owner_id = ? AND a.book_id = ? AND a.status = 'active'
    ORDER BY a.artifact_type, a.created_at
  `).all(book.owner_id, bookId);
  const artifacts = artifactRows.map((row) => ({
    artifactType: row.artifact_type,
    title: row.title,
    activeVersionId: row.active_version_id,
    status: row.status,
    content: JSON.parse(row.content_json)
  }));

  const chapterRows = database.prepare(`
    SELECT c.chapter_id, c.chapter_number, c.title, c.plan_status, c.generation_status,
      c.settlement_status, c.canon_manuscript_version_id,
      m.file_id, m.content_hash, m.word_count, m.status AS manuscript_status,
      m.model_provider, m.model_id, f.relative_path, f.status AS file_status
    FROM chapters c
    LEFT JOIN manuscript_versions m ON m.manuscript_version_id = c.canon_manuscript_version_id
    LEFT JOIN file_registry f ON f.file_id = m.file_id
    WHERE c.owner_id = ? AND c.book_id = ?
    ORDER BY c.chapter_number
  `).all(book.owner_id, bookId);

  const chapters = chapterRows.map((row) => {
    const absolutePath = row.relative_path === null ? null : path.resolve('data', row.relative_path);
    const content = absolutePath !== null && existsSync(absolutePath)
      ? readFileSync(absolutePath, 'utf8')
      : '';
    const actualHash = content.length === 0 ? null : createHash('sha256').update(content).digest('hex');
    const machineLeakPatterns = [
      /content_json/u,
      /source_ids_json/u,
      /projection_id/u,
      /selected_manuscript/u,
      /```(?:json|typescript|javascript|ts|js)/iu,
      /"(?:title|goal|beats|hook)"\s*:/u
    ];
    return {
      chapterNumber: row.chapter_number,
      title: row.title,
      planStatus: row.plan_status,
      generationStatus: row.generation_status,
      settlementStatus: row.settlement_status,
      canonManuscriptVersionId: row.canon_manuscript_version_id,
      manuscriptStatus: row.manuscript_status,
      provider: row.model_provider,
      modelId: row.model_id,
      declaredWordCount: row.word_count,
      characterCount: content.length,
      contentHashMatches: actualHash === row.content_hash,
      fileStatus: row.file_status,
      machineLeak: machineLeakPatterns.some((pattern) => pattern.test(content)),
      opening: content.slice(0, 80).replace(/\s+/gu, ' '),
      ending: content.slice(-120).replace(/\s+/gu, ' ')
    };
  });

  const modelCalls = database.prepare(`
    SELECT provider, model_id, state, COUNT(*) AS count,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens
    FROM model_calls
    WHERE owner_id = ? AND book_id = ?
    GROUP BY provider, model_id, state
    ORDER BY provider, model_id, state
  `).all(book.owner_id, bookId);

  const chapterOutlines = artifacts
    .filter((artifact) => artifact.artifactType === 'chapter_outline')
    .map((artifact) => Number(artifact.content.chapterNumber))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const masterOutlines = artifacts.filter((artifact) => artifact.artifactType === 'master_outline');
  const volumeOutlines = artifacts.filter((artifact) => artifact.artifactType === 'volume_outline');
  const storyBibles = artifacts.filter((artifact) => artifact.artifactType === 'story_bible');

  requireCheck(book.title === '这游戏上线就给钱', '书名不是当前测试目标');
  requireCheck(book.status === 'active', '书籍不是创作中状态');
  requireCheck(book.canon_revision === 10, `正史修订应为10，实际为${book.canon_revision}`);
  requireCheck(planning?.stage === 'chapter_outline_ready', `规划阶段应为chapter_outline_ready，实际为${planning?.stage}`);
  requireCheck(settingSummary.total === 60, `设定项应为60，实际为${settingSummary.total}`);
  requireCheck(settingSummary.confirmed === 60, `已确认设定应为60，实际为${settingSummary.confirmed}`);
  requireCheck(settingSummary.with_content === 60, `含有效内容设定应为60，实际为${settingSummary.with_content}`);
  requireCheck(storyBibles.length >= 1, '缺少活动设定基线');
  requireCheck(masterOutlines.length >= 1, '缺少活动剧情总纲');
  requireCheck(volumeOutlines.length === 0, `活动流程不应再存在卷纲，实际为${volumeOutlines.length}`);
  requireCheck(JSON.stringify(chapterOutlines) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), `活动章纲不完整：${chapterOutlines.join(',')}`);
  requireCheck(chapters.length === 10, `正文应为10章，实际为${chapters.length}`);
  for (const chapter of chapters) {
    requireCheck(chapter.settlementStatus === 'settled', `第${chapter.chapterNumber}章尚未结算`);
    requireCheck(chapter.manuscriptStatus === 'canon', `第${chapter.chapterNumber}章正文不是canon`);
    requireCheck(chapter.characterCount >= 1_500, `第${chapter.chapterNumber}章正文过短：${chapter.characterCount}`);
    requireCheck(chapter.contentHashMatches, `第${chapter.chapterNumber}章文件哈希不匹配`);
    requireCheck(chapter.fileStatus === 'active', `第${chapter.chapterNumber}章文件不可用`);
    requireCheck(!chapter.machineLeak, `第${chapter.chapterNumber}章正文含机器字段或代码围栏`);
  }
  requireCheck(new Set(chapters.map((chapter) => chapter.contentHashMatches && chapter.characterCount > 0
    ? chapter.canonManuscriptVersionId
    : null)).size === 10, '十章没有十个独立的正史正文版本');

  const report = {
    releaseId: 'wm-longform-r1-20260719-003435-e4d7b8b7',
    generatedAt: new Date().toISOString(),
    databasePath,
    book,
    planning,
    settingSummary,
    artifacts: {
      storyBibleCount: storyBibles.length,
      masterOutlineCount: masterOutlines.length,
      retiredVolumeOutlineCount: volumeOutlines.length,
      chapterOutlineNumbers: chapterOutlines
    },
    chapters,
    modelCalls,
    databaseIntegrity: database.prepare('PRAGMA integrity_check').get(),
    foreignKeyViolations: database.prepare('PRAGMA foreign_key_check').all(),
    failures,
    passed: failures.length === 0
  };

  writeFileSync(
    path.join(evidenceDirectory, 'data-flow-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  database.close();
}
