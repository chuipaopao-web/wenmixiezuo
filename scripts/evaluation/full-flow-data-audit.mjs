import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const databasePath = path.resolve(process.env.WENMI_DATABASE_PATH ?? 'data/database/wenmi.sqlite');
const evidenceDirectory = path.resolve('data', 'verification', 'full-flow-data-audit');
mkdirSync(evidenceDirectory, { recursive: true });
const database = new DatabaseSync(databasePath, { readOnly: true });
const failures = [];

function requireCheck(condition, message) {
  if (!condition) failures.push(message);
}
function json(value, fallback = []) {
  try { return JSON.parse(value); } catch { return fallback; }
}

try {
  const requestedBookId = process.env.WENMI_VERIFY_BOOK_ID?.trim();
  const book = requestedBookId
    ? database.prepare(`SELECT owner_id, book_id, title, status, canon_revision, created_at, updated_at FROM books WHERE book_id = ?`).get(requestedBookId)
    : database.prepare(`
        SELECT b.owner_id, b.book_id, b.title, b.status, b.canon_revision, b.created_at, b.updated_at
        FROM books b
        WHERE EXISTS (SELECT 1 FROM chapters c WHERE c.owner_id = b.owner_id AND c.book_id = b.book_id)
        ORDER BY b.updated_at DESC LIMIT 1
      `).get();
  if (book === undefined) throw new Error(requestedBookId ? `目标书籍不存在：${requestedBookId}` : '数据库中没有可审计的正文书籍。');
  const scope = [book.owner_id, book.book_id];

  const workflow = database.prepare(`
    SELECT planning_version, stage, active_volume_plan_id, active_volume_plan_version_id,
      active_event_id, active_event_version_id, frozen_chapter_outline_refs_json,
      waiting_task_id, blocking_reason, updated_at
    FROM creation_workflow_states WHERE owner_id = ? AND book_id = ?
  `).get(...scope);
  const opening = database.prepare(`
    SELECT opening_blueprint_id, version, content_hash, status
    FROM book_opening_blueprints WHERE owner_id = ? AND book_id = ? AND status = 'active'
    ORDER BY version DESC LIMIT 1
  `).get(...scope);
  const setting = database.prepare(`
    SELECT s.setting_baseline_version_id, v.version, v.content_hash, v.status
    FROM book_planning_states s
    LEFT JOIN artifact_versions v ON v.owner_id = s.owner_id AND v.book_id = s.book_id
      AND v.artifact_version_id = s.setting_baseline_version_id
    WHERE s.owner_id = ? AND s.book_id = ?
  `).get(...scope);
  const volumePlans = database.prepare(`
    SELECT p.volume_plan_id, p.plan_number, p.status, p.revision, p.active_version_id,
      v.version AS active_version, v.status AS version_status, v.content_hash, v.confirmed_at
    FROM volume_plans p
    LEFT JOIN volume_plan_versions v ON v.owner_id = p.owner_id AND v.book_id = p.book_id
      AND v.volume_plan_id = p.volume_plan_id AND v.volume_plan_version_id = p.active_version_id
    WHERE p.owner_id = ? AND p.book_id = ? ORDER BY p.plan_number
  `).all(...scope);
  const events = database.prepare(`
    SELECT e.event_id, e.volume_plan_id, e.sequence_order, e.status, e.revision, e.active_version_id,
      v.version AS active_version, v.status AS version_status, v.volume_plan_version_id,
      v.content_hash, v.confirmed_at, json_extract(v.content_json, '$.title') AS title
    FROM story_events e
    LEFT JOIN story_event_versions v ON v.owner_id = e.owner_id AND v.book_id = e.book_id
      AND v.event_id = e.event_id AND v.story_event_version_id = e.active_version_id
    WHERE e.owner_id = ? AND e.book_id = ? ORDER BY e.volume_plan_id, e.sequence_order
  `).all(...scope);
  const chapterSequences = database.prepare(`
    SELECT s.event_chapter_sequence_id, s.event_id, s.event_version_id, s.volume_plan_version_id,
      s.revision, s.status, s.active_version_id, v.version AS active_version,
      v.status AS version_status, v.content_hash, v.confirmed_at
    FROM event_chapter_sequences s
    LEFT JOIN event_chapter_sequence_versions v ON v.owner_id = s.owner_id AND v.book_id = s.book_id
      AND v.event_chapter_sequence_id = s.event_chapter_sequence_id
      AND v.event_chapter_sequence_version_id = s.active_version_id
    WHERE s.owner_id = ? AND s.book_id = ? ORDER BY s.created_at
  `).all(...scope);
  const eventOutlines = database.prepare(`
    SELECT o.event_chapter_outline_id, o.event_chapter_sequence_id, o.event_id,
      o.chapter_number, o.sequence_order, o.status, o.revision, o.active_version_id,
      v.version AS active_version, v.status AS version_status, v.event_version_id,
      v.volume_plan_version_id, v.artifact_version_id, v.content_hash, v.frozen_at,
      json_extract(v.content_json, '$.title') AS title
    FROM event_chapter_outlines o
    LEFT JOIN event_chapter_outline_versions v ON v.owner_id = o.owner_id AND v.book_id = o.book_id
      AND v.event_chapter_outline_id = o.event_chapter_outline_id
      AND v.event_chapter_outline_version_id = o.active_version_id
    WHERE o.owner_id = ? AND o.book_id = ? ORDER BY o.chapter_number
  `).all(...scope);
  const chapterRows = database.prepare(`
    SELECT c.chapter_id, c.chapter_number, c.title, c.plan_status, c.generation_status,
      c.settlement_status, c.canon_manuscript_version_id,
      p.pipeline_run_id, p.outline_version_id, p.status AS pipeline_status,
      eo.event_chapter_outline_id, eo.event_id, eov.event_chapter_outline_version_id,
      m.file_id, m.content_hash, m.word_count, m.status AS manuscript_status,
      m.model_provider, m.model_id, f.relative_path, f.status AS file_status
    FROM chapters c
    LEFT JOIN chapter_pipeline_runs p ON p.owner_id = c.owner_id AND p.book_id = c.book_id
      AND p.chapter_id = c.chapter_id AND p.status = 'completed'
    LEFT JOIN event_chapter_outline_versions eov ON eov.owner_id = c.owner_id AND eov.book_id = c.book_id
      AND eov.artifact_version_id = p.outline_version_id
    LEFT JOIN event_chapter_outlines eo ON eo.owner_id = c.owner_id AND eo.book_id = c.book_id
      AND eo.event_chapter_outline_id = eov.event_chapter_outline_id
    LEFT JOIN manuscript_versions m ON m.manuscript_version_id = c.canon_manuscript_version_id
    LEFT JOIN file_registry f ON f.file_id = m.file_id
    WHERE c.owner_id = ? AND c.book_id = ?
    ORDER BY c.chapter_number
  `).all(...scope);

  const chapters = chapterRows.map((row) => {
    const absolutePath = row.relative_path === null ? null : path.resolve('data', row.relative_path);
    const content = absolutePath !== null && existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
    const actualHash = content.length === 0 ? null : createHash('sha256').update(content).digest('hex');
    return {
      chapterNumber: row.chapter_number,
      title: row.title,
      planStatus: row.plan_status,
      generationStatus: row.generation_status,
      settlementStatus: row.settlement_status,
      manuscriptVersionId: row.canon_manuscript_version_id,
      manuscriptStatus: row.manuscript_status,
      provider: row.model_provider,
      modelId: row.model_id,
      declaredWordCount: row.word_count,
      characterCount: content.length,
      contentHashMatches: actualHash === row.content_hash,
      fileStatus: row.file_status,
      pipelineRunId: row.pipeline_run_id,
      pipelineStatus: row.pipeline_status,
      boundArtifactOutlineVersionId: row.outline_version_id,
      eventChapterOutlineId: row.event_chapter_outline_id,
      eventChapterOutlineVersionId: row.event_chapter_outline_version_id,
      eventId: row.event_id
    };
  });
  const modelCalls = database.prepare(`
    SELECT provider, model_id, state, COUNT(*) AS count,
      COALESCE(SUM(input_tokens), 0) AS input_tokens,
      COALESCE(SUM(output_tokens), 0) AS output_tokens
    FROM model_calls WHERE owner_id = ? AND book_id = ?
    GROUP BY provider, model_id, state ORDER BY provider, model_id, state
  `).all(...scope);
  const artifactOutlineCount = database.prepare(`
    SELECT COUNT(*) AS count FROM artifacts a
    JOIN artifact_versions v ON v.owner_id = a.owner_id AND v.book_id = a.book_id
      AND v.artifact_id = a.artifact_id AND v.artifact_version_id = a.active_version_id
    WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'chapter_outline'
      AND a.status = 'active' AND v.status = 'selected'
  `).get(...scope).count;

  requireCheck(opening?.status === 'active', '缺少活动开书信息。');
  requireCheck(setting?.setting_baseline_version_id && setting.status === 'selected', '缺少已确认设定大纲。');
  requireCheck(workflow !== undefined, '缺少新创作工作流状态。');
  requireCheck(volumePlans.length > 0, '缺少卷纲。');
  requireCheck(volumePlans.every((item) => item.active_version_id && item.version_status === 'active'), '存在没有已确认版本的卷纲。');
  requireCheck(events.length > 0, '缺少事件链或事件大纲。');
  requireCheck(events.every((item) => item.active_version_id && item.version_status === 'active'), '存在没有已确认大纲的事件。');
  requireCheck(chapterSequences.length > 0, '缺少事件章链。');
  requireCheck(chapterSequences.every((item) => item.active_version_id && item.version_status === 'active'), '存在没有已确认版本的事件章链。');
  requireCheck(eventOutlines.length >= chapters.length, `事件章纲不足：${eventOutlines.length}份章纲，${chapters.length}章正文。`);
  requireCheck(eventOutlines.every((item) => item.active_version_id && ['frozen', 'settled'].includes(item.status) && item.version_status === 'frozen'), '存在未冻结或未绑定活动版本的事件章纲。');
  requireCheck(artifactOutlineCount >= chapters.length, `正式章纲投影不足：${artifactOutlineCount}份，正文${chapters.length}章。`);
  requireCheck(chapters.length > 0, '没有正文章节。');
  requireCheck(chapters.every((item) => item.pipelineStatus === 'completed'), '存在没有完成正文管线的章节。');
  requireCheck(chapters.every((item) => item.eventChapterOutlineId && item.eventChapterOutlineVersionId), '存在没有绑定事件章纲就生成的正文。');
  requireCheck(chapters.every((item) => item.manuscriptStatus === 'canon' && item.contentHashMatches && item.fileStatus === 'active'), '存在非正史、文件缺失或哈希不一致的正文。');
  requireCheck(chapters.every((item, index) => item.chapterNumber === index + 1), '章节号不是从1开始连续排列。');
  if (workflow?.stage === 'ready_for_next_volume') {
    requireCheck(volumePlans.at(-1)?.status === 'completed', '工作流已进入下一卷，但当前卷未标记完成。');
    requireCheck(events.every((item) => item.status === 'settled'), '工作流已进入下一卷，但仍有事件未结算。');
    requireCheck(chapterSequences.every((item) => item.status === 'completed'), '工作流已进入下一卷，但事件章链未完成。');
    requireCheck(json(workflow.frozen_chapter_outline_refs_json).length === 0, '卷结算后仍残留待写冻结章纲。');
  }

  const report = {
    auditContract: 'current-workflow-data-audit-v2',
    generatedAt: new Date().toISOString(),
    databasePath,
    book,
    workflow: workflow === undefined ? null : {
      planningVersion: workflow.planning_version,
      stage: workflow.stage,
      activeVolumePlanId: workflow.active_volume_plan_id,
      activeEventId: workflow.active_event_id,
      frozenChapterOutlineRefs: json(workflow.frozen_chapter_outline_refs_json),
      waitingTaskId: workflow.waiting_task_id,
      blockingReason: workflow.blocking_reason
    },
    opening,
    setting,
    planningChain: {
      volumePlans,
      events,
      chapterSequences,
      eventOutlines,
      selectedChapterOutlineArtifacts: artifactOutlineCount
    },
    chapters,
    modelCalls,
    databaseIntegrity: database.prepare('PRAGMA integrity_check').get(),
    foreignKeyViolations: database.prepare('PRAGMA foreign_key_check').all(),
    failures,
    passed: failures.length === 0
  };
  writeFileSync(path.join(evidenceDirectory, 'current-workflow-data-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  database.close();
}