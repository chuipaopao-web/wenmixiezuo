import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { loginEvaluationAccount } from './lib/evaluation-account.mjs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_BREAKER_LIMITS,
  batchStartupGate,
  evaluateBreaker,
  shouldAutoRecover
} from './lib/batch-circuit-breaker.mjs';
import { assertReleaseReviewIsAcceptable } from './lib/release-review-gate.mjs';

const API = process.env.WENMI_VALIDATION_API ?? 'http://127.0.0.1:43111';
const ORIGIN = process.env.WENMI_VALIDATION_ORIGIN ?? 'http://127.0.0.1:43110';
const BOOK_ID = process.env.WENMI_VALIDATION_BOOK_ID?.trim() ?? '';
const OWNER_ID = process.env.WENMI_VALIDATION_OWNER_ID?.trim() || 'owner-local-boss';
let BOOK_OWNERSHIP_VERIFIED = false;
const TARGET_CHAPTERS = Number(process.env.WENMI_VALIDATION_TARGET_CHAPTERS ?? '20');
const DATABASE_PATH = resolve(process.env.WENMI_VALIDATION_DATABASE ?? 'data/database/wenmi.sqlite');
const EVIDENCE_DIR = resolve(process.env.WENMI_VALIDATION_EVIDENCE_DIR ?? ['data/verification/real-model-longform', BOOK_ID || 'missing-book', String(TARGET_CHAPTERS)].join('/'));
const EVENT_LOG = resolve(EVIDENCE_DIR, 'run-events.ndjson');
const STATE_FILE = resolve(EVIDENCE_DIR, 'state.json');
const POLL_MS = Number(process.env.WENMI_VALIDATION_POLL_MS ?? '5000');

// P0-1 / R07: 真实批量验证总熔断。
// 默认 offline（只读巡检，不连真实 API、不发起真实调用、不生成正文）；
// 默认 blocked-recovery=manual_only（QUALITY_BLOCKED 立即结束批次，脚本不冒充老板）。
// 真实模型模式必须显式 --mode=real；自动重写恢复必须显式 --blocked-recovery=auto。
const ARGV = new Set(process.argv.slice(2));
const MODE = ARGV.has('--mode=real') ? 'real' : 'offline';
const BLOCKED_RECOVERY = ARGV.has('--blocked-recovery=auto') ? 'auto' : 'manual_only';
const AUTO_CONFIRM_E2 = ARGV.has('--auto-confirm-e2');
const RELEASE_MANAGER_CONFIRM = ARGV.has('--release-manager-confirm');
const CAN_CONFIRM_MANUSCRIPT = AUTO_CONFIRM_E2 || RELEASE_MANAGER_CONFIRM;
const RELEASE_MANAGER_BOOK_IDS = new Set([
  'ebc3b29e-c0d4-45e9-b839-bb0ee2999501',
  '9486c1fc-a03f-4fe9-b47a-da1a551e1809'
]);
const RELEASE_MANAGER_OWNER_ID = '46d42266-a583-4055-94aa-217319c634d2';
const RELEASE_MANAGER_BATCH_CAP = 3;
const MAX_OWNER_BLOCKED_RECOVERIES = 3;
const BREAKER_LIMITS = { ...DEFAULT_BREAKER_LIMITS, ...parseBreakerOverrides() };
const RUNTIME_COUNTERS = { consecutiveStructFixes: 0, consecutiveRewrites: 0 };

function parseBreakerOverrides() {
  const overrides = {};
  for (const key of Object.keys(DEFAULT_BREAKER_LIMITS)) {
    const flag = `--limit-${key}=`;
    for (const arg of process.argv.slice(2)) {
      if (arg.startsWith(flag)) {
        const value = Number(arg.slice(flag.length));
        if (Number.isFinite(value)) overrides[key] = value;
      }
    }
  }
  return overrides;
}

const terminalFailure = new Set(['failed', 'blocked', 'cancelled', 'interrupted']);
const activeStatus = new Set(['pending', 'queued', 'working', 'paused', 'waiting_confirmation']);

function now() {
  return new Date().toISOString();
}

function record(event, details = {}) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const entry = { at: now(), event, ...details };
  appendFileSync(EVENT_LOG, `${JSON.stringify(entry)}\n`, 'utf8');
  console.log(JSON.stringify(entry));
}

function saveState(state) {
  writeFileSync(STATE_FILE, `${JSON.stringify({ updatedAt: now(), bookId: BOOK_ID, targetChapters: TARGET_CHAPTERS, ...state }, null, 2)}\n`, 'utf8');
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

let cookie = '';

async function issueSession() {
  cookie = await loginEvaluationAccount({ api: API, origin: ORIGIN });
}

async function request(path, options = {}) {
  if (cookie.length === 0) await issueSession();
  const method = options.method ?? 'GET';
  const headers = { cookie, ...(options.headers ?? {}) };
  if (method !== 'GET') {
    headers.origin = ORIGIN;
    headers['sec-fetch-site'] = 'same-site';
    headers['content-type'] = 'application/json';
  }
  let response = await fetch(`${API}${path}`, { ...options, method, headers });
  if (response.status === 401) {
    await issueSession();
    headers.cookie = cookie;
    response = await fetch(`${API}${path}`, { ...options, method, headers });
  }
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path} returned non-JSON ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!response.ok || body.error !== undefined) {
    const detail = body.error === undefined ? JSON.stringify(body) : `${body.error.code}: ${body.error.message} ${JSON.stringify(body.error.details ?? {})}`;
    throw new Error(`${method} ${path} failed ${response.status}: ${detail}`);
  }
  return body.data;
}

function database() {
  return new DatabaseSync(DATABASE_PATH, { readOnly: true });
}

function blockedPipeline(chapterId) {
  const db = database();
  try {
    return db.prepare(`SELECT status, error_code, rewrite_count FROM chapter_pipeline_runs
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ?`).get(OWNER_ID, BOOK_ID, chapterId) ?? null;
  } finally {
    db.close();
  }
}

function blockedRecoveryCount(chapterId) {
  const db = database();
  try {
    return Number(db.prepare(`SELECT COUNT(*) AS count FROM chapter_pipeline_runs
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ?
        AND status = 'failed' AND error_code = 'QUALITY_BLOCKED'`).get(OWNER_ID, BOOK_ID, chapterId)?.count ?? 0);
  } finally {
    db.close();
  }
}

// P0-1: 发起下一章任务前读取数据库真实已用量（调用数 + Token）。只读，不修改活动数据。
function readUsage(chapterId) {
  const db = database();
  try {
    const batch = db.prepare(`SELECT
      COUNT(*) AS calls,
      COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS tokens
      FROM model_calls
      WHERE owner_id = ? AND book_id = ?
        AND state IN ('succeeded', 'interrupted', 'failed')`).get(OWNER_ID, BOOK_ID);
    let chapterCalls = 0;
    let chapterTokens = 0;
    if (chapterId) {
      const chapter = db.prepare(`SELECT
        COUNT(*) AS calls,
        COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS tokens
        FROM model_calls
        WHERE owner_id = ? AND book_id = ?
          AND state IN ('succeeded', 'interrupted', 'failed')
          AND task_id IN (SELECT task_id FROM tasks WHERE owner_id = ? AND book_id = ? AND chapter_id = ?)`)
        .get(OWNER_ID, BOOK_ID, OWNER_ID, BOOK_ID, chapterId);
      chapterCalls = Number(chapter?.calls ?? 0);
      chapterTokens = Number(chapter?.tokens ?? 0);
    }
    return {
      chapterCalls,
      chapterTokens,
      batchCalls: Number(batch?.calls ?? 0),
      batchTokens: Number(batch?.tokens ?? 0),
      consecutiveStructFixes: RUNTIME_COUNTERS.consecutiveStructFixes,
      consecutiveRewrites: RUNTIME_COUNTERS.consecutiveRewrites
    };
  } finally {
    db.close();
  }
}

// offline 默认模式：只读巡检，不连真实 API、不发起任何真实调用、不生成正文。
async function inspectAndReport() {
  const db = database();
  let settledCount = 0;
  const unsettled = [];
  let pipeline13 = null;
  try {
    const rows = db.prepare(`SELECT chapter_number, settlement_status FROM chapters
      WHERE owner_id = ? AND book_id = ? ORDER BY chapter_number`).all(OWNER_ID, BOOK_ID);
    for (const r of rows) {
      if (r.settlement_status === 'settled') settledCount += 1;
      else unsettled.push(r.chapter_number);
    }
    pipeline13 = db.prepare(`SELECT status, error_code, rewrite_count FROM chapter_pipeline_runs
      WHERE owner_id = ? AND book_id = ? AND chapter_id IN
        (SELECT chapter_id FROM chapters WHERE owner_id = ? AND book_id = ? AND chapter_number = 13)`)
      .get(OWNER_ID, BOOK_ID, OWNER_ID, BOOK_ID) ?? null;
  } finally {
    db.close();
  }
  const usage = readUsage(null);
  const breaker = evaluateBreaker(usage, BREAKER_LIMITS);
  record('offline_inspect', {
    mode: MODE,
    blockedRecovery: BLOCKED_RECOVERY,
    settledChapters: settledCount,
    unsettled,
    pipeline13,
    usage,
    breaker
  });
  saveState({ offlineInspect: true, settledChapters: settledCount, breaker });
  if (breaker.stop) record('breaker_would_stop', breaker);
}

function reportBasedRecoveryInstruction(chapterId) {
  const db = database();
  try {
    const run = db.prepare(`SELECT review_panel_id FROM chapter_pipeline_runs
      WHERE owner_id = ? AND book_id = ? AND chapter_id = ?
        AND status = 'failed' AND error_code = 'QUALITY_BLOCKED'
      ORDER BY updated_at DESC LIMIT 1`).get(OWNER_ID, BOOK_ID, chapterId);
    if (typeof run?.review_panel_id !== 'string') return null;
    const reports = db.prepare(`SELECT reviewer_role, report_json FROM review_reports
      WHERE owner_id = ? AND book_id = ? AND review_panel_id = ?
        AND status = 'submitted' ORDER BY reviewer_role`).all(OWNER_ID, BOOK_ID, run.review_panel_id);
    const issues = [];
    for (const row of reports) {
      const report = JSON.parse(row.report_json);
      for (const issue of Array.isArray(report.issues) ? report.issues : []) {
        if (!['blocking', 'major'].includes(String(issue.severity).toLowerCase())) continue;
        issues.push([
          `[${row.reviewer_role}] ${issue.issueType ?? '硬问题'} @ ${issue.location ?? '未定位'}`,
          `证据：${issue.evidence ?? '报告未提供证据'}`,
          `要求：${issue.requiredAction ?? '按冻结来源定点修复'}`
        ].join('\n'));
      }
    }
    if (issues.length === 0) return null;
    return [
      '这是老板授权的质量阻断恢复。请依据冻结章纲、上一章已结算正文与当前稿，完整重写本章；不要复审原稿，也不要放宽质量标准。',
      '以下是最终三席报告中的 major/blocking 候选。先核对证据：只修有硬来源支持的问题；若报告内部自相矛盾，不得把错误建议写进正文。',
      ...issues.slice(0, 12),
      '保持已成立的剧情推进、人物声音和章末钩子；不得用解释性对白堆砌补丁，不得引入新的未确认事实。'
    ].join('\n\n');
  } finally {
    db.close();
  }
}

async function taskDetail(taskId) {
  return request(`/api/v1/books/${BOOK_ID}/tasks/${taskId}`);
}

async function waitForTask(taskId, purpose) {
  let lastSignature = '';
  while (true) {
    const detail = await taskDetail(taskId);
    const task = detail.task;
    const signature = `${task.status}:${task.currentPhase}:${detail.modelCalls.filter((call) => call.state === 'working').map((call) => `${call.provider}/${call.model_id}`).join(',')}`;
    if (signature !== lastSignature) {
      record('task_progress', { purpose, taskId, status: task.status, phase: task.currentPhase, workingModels: detail.modelCalls.filter((call) => call.state === 'working').map((call) => `${call.provider}/${call.model_id}`) });
      lastSignature = signature;
    }
    if (task.status === 'waiting_confirmation' || task.status === 'succeeded') return detail;
    if (terminalFailure.has(task.status)) {
      saveState({ stopped: true, purpose, taskId, taskStatus: task.status, errorCode: task.errorCode ?? null });
      throw new Error(`${purpose} task ${taskId} ended as ${task.status} (${task.errorCode ?? 'no error code'})`);
    }
    await sleep(POLL_MS);
  }
}

async function pendingManuscriptConfirmation(taskId) {
  const detail = await taskDetail(taskId);
  const expectedVersionId = detail.task?.checkpoint?.manuscriptVersionId
    ?? detail.task?.brief?.manuscriptVersionId
    ?? null;
  if (typeof expectedVersionId !== 'string' || expectedVersionId.length === 0) {
    throw new Error(`task ${taskId} does not expose its exact manuscript version`);
  }
  const confirmations = await request(`/api/v1/books/${BOOK_ID}/confirmations`);
  const confirmation = confirmations.find((item) => item.status === 'pending'
    && item.target_type === 'manuscript'
    && item.target_id === expectedVersionId);
  if (confirmation === undefined) throw new Error(`task ${taskId} is waiting but no pending manuscript confirmation exists`);
  return confirmation;
}

async function pauseForManualReading(taskId, chapterNumber = null) {
  const confirmation = await pendingManuscriptConfirmation(taskId);
  const list = await chapters();
  const chapter = list.find((item) => item.currentManuscriptVersionId === confirmation.target_id) ?? null;
  const content = chapter ? await request(`/api/v1/books/${BOOK_ID}/chapters/${chapter.chapterId}/content`) : null;
  const reviewFile = resolve(EVIDENCE_DIR, 'pending-manuscript-review.json');
  writeFileSync(reviewFile, `${JSON.stringify({
    generatedAt: now(),
    bookId: BOOK_ID,
    targetChapters: TARGET_CHAPTERS,
    taskId,
    chapterNumber: chapter?.chapterNumber ?? chapterNumber,
    chapterId: chapter?.chapterId ?? null,
    title: chapter?.title ?? null,
    manuscriptVersionId: confirmation.target_id,
    confirmationId: confirmation.confirmation_id,
    content
  }, null, 2)}\n`, 'utf8');
  record('chapter_waiting_manual_reading', {
    taskId,
    chapterNumber: chapter?.chapterNumber ?? chapterNumber,
    manuscriptVersionId: confirmation.target_id,
    reviewFile
  });
  saveState({ waitingManualReading: true, taskId, chapterNumber: chapter?.chapterNumber ?? chapterNumber, manuscriptVersionId: confirmation.target_id });
  return { waitingManualReading: true };
}

async function acceptPendingManuscript(taskId, chapterNumber = null) {
  const confirmation = await pendingManuscriptConfirmation(taskId);
  const detail = await taskDetail(taskId);
  assertReleaseReviewIsAcceptable(detail, confirmation.target_id, chapterNumber ?? 'unknown');
  const accepted = await request(`/api/v1/books/${BOOK_ID}/confirmations/${confirmation.confirmation_id}/accept`, {
    method: 'POST', body: JSON.stringify({ expectedCanonRevision: confirmation.expected_canon_revision })
  });
  record('manuscript_confirmed', {
    taskId,
    confirmationId: confirmation.confirmation_id,
    expectedCanonRevision: confirmation.expected_canon_revision,
    manuscriptVersionId: confirmation.target_id,
    result: accepted
  });
  return confirmation;
}

async function settleActiveChapterTasks() {
  const tasks = await request(`/api/v1/books/${BOOK_ID}/tasks`);
  const active = tasks
    .filter((task) => task.taskType === 'chapter_creation' && activeStatus.has(task.status))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  for (const task of active) {
    const detail = await waitForTask(task.taskId, 'resume-existing-chapter');
    if (detail.task.status === 'waiting_confirmation') {
      if (!CAN_CONFIRM_MANUSCRIPT) {
        await pauseForManualReading(task.taskId);
        return false;
      }
      const list = await chapters();
      const confirmation = await pendingManuscriptConfirmation(task.taskId);
      const chapter = list.find((item) => item.currentManuscriptVersionId === confirmation.target_id) ?? null;
      await acceptPendingManuscript(task.taskId, chapter?.chapterNumber ?? null);
      await waitForTask(task.taskId, 'settle-existing-chapter');
    }
  }
  return true;
}

async function chapters() {
  return request(`/api/v1/books/${BOOK_ID}/chapters`);
}

async function artifacts() {
  return request(`/api/v1/books/${BOOK_ID}/artifacts`);
}

async function outlineFor(chapterNumber) {
  const all = await artifacts();
  return all.find((item) => item.artifact_type === 'chapter_outline' && item.active_version_status === 'selected'
    && Number(item.active_content?.chapterNumber) === chapterNumber) ?? null;
}

async function ensureOutline(chapterNumber) {
  const outline = await outlineFor(chapterNumber);
  if (outline) return;
  throw new Error(`第${chapterNumber}章缺少已确认章纲。真实长篇验证不会用聊天或脚本替作者补规划；请先在当前书的分卷、规划与章纲流程中确认正式对象。`);
}

async function generateChapter(chapterNumber) {
  await ensureOutline(chapterNumber);
  // P0-1: 发起下一章任务前读 DB 真实已用量并评估熔断，达阈值先写证据再退出。
  const usage = readUsage(null);
  const breaker = evaluateBreaker(usage, BREAKER_LIMITS);
  if (breaker.stop) {
    record('breaker_stopped_before_chapter', { chapterNumber, ...breaker });
    saveState({ stopped: true, reason: breaker.reason, atChapter: chapterNumber, usage });
    throw new Error(`熔断停止：${breaker.reason}（${JSON.stringify(breaker.evidence)}）`);
  }
  const outline = await outlineFor(chapterNumber);
  const title = String(outline.active_content?.title ?? `第${chapterNumber}章`);
  record('chapter_scheduled', { chapterNumber, title });
  const existing = (await chapters()).find((chapter) => chapter.chapterNumber === chapterNumber
    && chapter.settlementStatus !== 'settled' && typeof chapter.currentManuscriptVersionId === 'string');
  let taskId;
  if (existing) {
    const pipeline = blockedPipeline(existing.chapterId);
    const recoveryInstruction = reportBasedRecoveryInstruction(existing.chapterId);
    const recoveryCount = blockedRecoveryCount(existing.chapterId);
    const recover = shouldAutoRecover({
      blockedRecovery: BLOCKED_RECOVERY,
      errorCode: pipeline?.status === 'failed' ? pipeline?.error_code ?? null : null,
      rewriteCount: Number(pipeline?.rewrite_count ?? 0),
      recoveryCount,
      maxRecoveries: MAX_OWNER_BLOCKED_RECOVERIES
    });
    const shouldRewriteBlocked = recover.recover && recoveryInstruction !== null && recoveryInstruction !== undefined;
    const resumed = await request(`/api/v1/books/${BOOK_ID}/chapters/${existing.chapterId}/${shouldRewriteBlocked ? 'rewrite' : 'finalize'}`, {
      method: 'POST', body: JSON.stringify({
        manuscriptVersionId: existing.currentManuscriptVersionId,
        ...(shouldRewriteBlocked ? { instruction: recoveryInstruction } : {})
      })
    });
    if (typeof resumed.taskId !== 'string') throw new Error(`existing manuscript finalize did not return a task: ${JSON.stringify(resumed)}`);
    taskId = resumed.taskId;
    record(shouldRewriteBlocked ? 'chapter_blocked_manuscript_rewrite_started' : 'chapter_existing_manuscript_resumed', {
      chapterNumber, chapterId: existing.chapterId, manuscriptVersionId: existing.currentManuscriptVersionId, taskId,
      previousRewriteCount: pipeline?.rewrite_count ?? null, blockedRecoveryCount: recoveryCount
    });
  } else {
    const batch = await request(`/api/v1/books/${BOOK_ID}/writing-runs`, {
      method: 'POST', body: JSON.stringify({ chapterTitle: title })
    });
    if (!Array.isArray(batch.taskIds) || batch.taskIds.length !== 1) throw new Error(`writing run did not return one task: ${JSON.stringify(batch)}`);
    taskId = batch.taskIds[0];
  }
  let detail;
  while (true) {
    try {
      detail = await waitForTask(taskId, `chapter-${chapterNumber}`);
      break;
    } catch (error) {
      const current = (await chapters()).find((chapter) => chapter.chapterNumber === chapterNumber
        && chapter.settlementStatus !== 'settled' && typeof chapter.currentManuscriptVersionId === 'string');
      const pipeline = current ? blockedPipeline(current.chapterId) : null;
      const recoveryCount = current ? blockedRecoveryCount(current.chapterId) : 0;
      const recoveryInstruction = current
        ? reportBasedRecoveryInstruction(current.chapterId)
        : null;
      const recover = shouldAutoRecover({
        blockedRecovery: BLOCKED_RECOVERY,
        errorCode: current && pipeline?.status === 'failed' ? pipeline?.error_code ?? null : null,
        rewriteCount: Number(pipeline?.rewrite_count ?? 0),
        recoveryCount,
        maxRecoveries: MAX_OWNER_BLOCKED_RECOVERIES
      });
      const canRecover = current && recover.recover && typeof recoveryInstruction === 'string';
      if (!canRecover) {
        record('chapter_blocked_no_auto_recovery', {
          chapterNumber,
          reason: recover.recover ? 'no_instruction' : recover.reason,
          blockedRecovery: BLOCKED_RECOVERY
        });
        throw error;
      }
      const recovered = await request(`/api/v1/books/${BOOK_ID}/chapters/${current.chapterId}/rewrite`, {
        method: 'POST',
        body: JSON.stringify({ manuscriptVersionId: current.currentManuscriptVersionId, instruction: recoveryInstruction })
      });
      if (typeof recovered.taskId !== 'string') throw new Error(`blocked recovery did not return a task: ${JSON.stringify(recovered)}`);
      taskId = recovered.taskId;
      RUNTIME_COUNTERS.consecutiveRewrites += 1;
      record('chapter_blocked_manuscript_rewrite_started', {
        chapterNumber,
        chapterId: current.chapterId,
        manuscriptVersionId: current.currentManuscriptVersionId,
        taskId,
        previousRewriteCount: pipeline.rewrite_count,
        blockedRecoveryCount: recoveryCount
      });
    }
  }
  if (detail.task.status !== 'waiting_confirmation') throw new Error(`chapter ${chapterNumber} task reached ${detail.task.status} without owner gate`);
  if (!CAN_CONFIRM_MANUSCRIPT) return pauseForManualReading(taskId, chapterNumber);
  const confirmation = await acceptPendingManuscript(taskId, chapterNumber);
  detail = await waitForTask(taskId, `settle-chapter-${chapterNumber}`);
  if (detail.task.status !== 'succeeded') throw new Error(`chapter ${chapterNumber} did not settle after confirmation`);
  const list = await chapters();
  const chapter = list.find((item) => item.chapterNumber === chapterNumber);
  if (chapter?.settlementStatus !== 'settled' || typeof chapter.canonManuscriptVersionId !== 'string') {
    throw new Error(`chapter ${chapterNumber} lacks a settled canon manuscript`);
  }
  const content = await request(`/api/v1/books/${BOOK_ID}/chapters/${chapter.chapterId}/content`);
  if (content.manuscriptVersionId !== chapter.canonManuscriptVersionId || content.totalLength < 2500) {
    throw new Error(`chapter ${chapterNumber} saved content verification failed`);
  }
  record('chapter_settled', {
    chapterNumber,
    chapterId: chapter.chapterId,
    title: chapter.title,
    taskId,
    confirmationId: confirmation.confirmation_id,
    manuscriptVersionId: chapter.canonManuscriptVersionId,
    contentHash: content.contentHash,
    characterCount: content.totalLength
  });
  // 正常结算归零跨任务连续重写/结构修复计数器（异常放大器复位）。
  RUNTIME_COUNTERS.consecutiveRewrites = 0;
  RUNTIME_COUNTERS.consecutiveStructFixes = 0;
  saveState({ completedChapters: chapterNumber, lastChapterId: chapter.chapterId, lastTaskId: taskId, lastContentHash: content.contentHash });
  return { settled: true };
}

async function main() {
  if (!BOOK_ID) throw new Error('必须显式设置 WENMI_VALIDATION_BOOK_ID；验证脚本不再默认绑定任何旧书。');
  if (![20, 50, 100, 200].includes(TARGET_CHAPTERS)) throw new Error('WENMI_VALIDATION_TARGET_CHAPTERS 只允许20、50、100或200。');
  if (RELEASE_MANAGER_CONFIRM && (OWNER_ID !== RELEASE_MANAGER_OWNER_ID || !RELEASE_MANAGER_BOOK_IDS.has(BOOK_ID))) {
    throw new Error('项目经理代确认只允许本轮两本已登记测试书，且必须属于当前管理员owner。');
  }
  const db = database();
  let ownedBook;
  let startingMaxSettled = 0;
  try {
    ownedBook = db.prepare('SELECT 1 AS found FROM books WHERE owner_id = ? AND book_id = ? AND archived_at IS NULL').get(OWNER_ID, BOOK_ID);
    startingMaxSettled = Number(db.prepare(`SELECT COALESCE(MAX(chapter_number), 0) AS max_settled
      FROM chapters WHERE owner_id = ? AND book_id = ? AND settlement_status = 'settled'`).get(OWNER_ID, BOOK_ID)?.max_settled ?? 0);
  } finally {
    db.close();
  }
  if (!ownedBook) throw new Error('当前owner下不存在这本未归档书籍；验证已停止，避免跨账号或跨书读取。');
  BOOK_OWNERSHIP_VERIFIED = true;
  record('run_started', { ownerId: OWNER_ID, bookId: BOOK_ID, targetChapters: TARGET_CHAPTERS, databasePath: DATABASE_PATH, mode: MODE, blockedRecovery: BLOCKED_RECOVERY, autoConfirmE2: AUTO_CONFIRM_E2, releaseManagerConfirm: RELEASE_MANAGER_CONFIRM });
  if (MODE !== 'real') {
    // 默认 offline：只读巡检，不连真实 API、不发起真实调用、不生成正文。
    await inspectAndReport();
    record('run_stopped_offline', { reason: '默认离线模式；需 --mode=real 且老板明确授权才连真实 API' });
    return;
  }
  // real 模式：套餐余额未知时，正式批次默认最多 1-3 章并等待老板确认。
  const remainingChapters = Math.max(0, TARGET_CHAPTERS - startingMaxSettled);
  const plannedChapters = RELEASE_MANAGER_CONFIRM
    ? Math.min(RELEASE_MANAGER_BATCH_CAP, remainingChapters)
    : AUTO_CONFIRM_E2 ? TARGET_CHAPTERS : Math.min(1, remainingChapters);
  const startup = batchStartupGate({ packageBalanceUnknown: true, plannedChapters });
  if (!startup.allow) {
    record('batch_blocked_at_startup', startup);
    saveState({ stopped: true, reason: startup.reason });
    throw new Error(`批次启动被门禁拒绝：${startup.reason}（计划 ${startup.evidence.plannedChapters} 章，套餐未知上限 ${startup.evidence.cap} 章）`);
  }
  await issueSession();
  const health = await request('/health').catch(() => null);
  const readiness = await request('/api/v1/runtime/readiness');
  if (readiness.api !== 'ready' || readiness.worker !== 'ready' || readiness.canStartModelTasks !== true) {
    throw new Error(`runtime not ready: ${JSON.stringify({ health, readiness })}`);
  }
  const resumed = await settleActiveChapterTasks();
  if (!resumed) return;
  const segmentTarget = RELEASE_MANAGER_CONFIRM
    ? Math.min(TARGET_CHAPTERS, startingMaxSettled + RELEASE_MANAGER_BATCH_CAP)
    : TARGET_CHAPTERS;
  while (true) {
    const list = await chapters();
    const settled = list.filter((chapter) => chapter.settlementStatus === 'settled').sort((a, b) => a.chapterNumber - b.chapterNumber);
    const maxSettled = settled.at(-1)?.chapterNumber ?? 0;
    if (maxSettled >= segmentTarget) break;
    if (settled.some((chapter, index) => chapter.chapterNumber !== index + 1)) {
      throw new Error(`settled chapter sequence is not contiguous through ${maxSettled}`);
    }
    const result = await generateChapter(maxSettled + 1);
    if (result?.waitingManualReading) return;
  }
  if (segmentTarget < TARGET_CHAPTERS) {
    saveState({ segmentCompleted: true, completedChapters: segmentTarget, targetChapters: TARGET_CHAPTERS });
    record('run_segment_completed', { completedChapters: segmentTarget, targetChapters: TARGET_CHAPTERS, batchCap: RELEASE_MANAGER_BATCH_CAP });
    return;
  }
  const finalChapters = await chapters();
  const finalRows = [];
  for (const chapter of finalChapters.filter((item) => item.chapterNumber <= TARGET_CHAPTERS).sort((a, b) => a.chapterNumber - b.chapterNumber)) {
    const content = await request(`/api/v1/books/${BOOK_ID}/chapters/${chapter.chapterId}/content`);
    finalRows.push({
      chapterNumber: chapter.chapterNumber,
      chapterId: chapter.chapterId,
      title: chapter.title,
      settlementStatus: chapter.settlementStatus,
      manuscriptVersionId: content.manuscriptVersionId,
      contentHash: content.contentHash,
      characterCount: content.totalLength
    });
  }
  if (finalRows.length !== TARGET_CHAPTERS || finalRows.some((row) => row.settlementStatus !== 'settled' || row.characterCount < 2500)) {
    throw new Error(`最终保存核验失败：目标${TARGET_CHAPTERS}章必须连续结算、正文完整且每章不少于2500字。`);
  }
  writeFileSync(resolve(EVIDENCE_DIR, 'chapters.json'), `${JSON.stringify(finalRows, null, 2)}\n`, 'utf8');
  saveState({ completed: true, completedChapters: finalRows.length, totalCharacters: finalRows.reduce((sum, row) => sum + row.characterCount, 0) });
  record('run_completed', { chapters: finalRows.length, totalCharacters: finalRows.reduce((sum, row) => sum + row.characterCount, 0) });
}

main().catch((error) => {
  const details = { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : null };
  if (BOOK_OWNERSHIP_VERIFIED) record('run_failed', details);
  else process.stderr.write(`${JSON.stringify({ at: now(), event: 'run_failed', ...details })}\n`);
  process.exitCode = 1;
});
