import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loginEvaluationAccount } from './lib/evaluation-account.mjs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_BREAKER_LIMITS,
  batchStartupGate,
  evaluateBreaker,
  shouldAutoRecover
} from './lib/batch-circuit-breaker.mjs';

const API = process.env.WENMI_VALIDATION_API ?? 'http://127.0.0.1:43111';
const ORIGIN = process.env.WENMI_VALIDATION_ORIGIN ?? 'http://127.0.0.1:43110';
const BOOK_ID = process.env.WENMI_VALIDATION_BOOK_ID ?? 'da2a9158-28ab-4c4a-ab2a-e3c4aae0fd77';
const TARGET_CHAPTERS = Number(process.env.WENMI_VALIDATION_TARGET_CHAPTERS ?? '50');
const DATABASE_PATH = resolve(process.env.WENMI_VALIDATION_DATABASE ?? 'data/database/wenmi.sqlite');
const EVIDENCE_DIR = resolve(process.env.WENMI_VALIDATION_EVIDENCE_DIR ?? 'data/verification/real-model-50-chapter');
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

const blockedRecoveryNotes = new Map([
  [9, [
    '这是老板授权的完整重写恢复，不是再次复审原稿。保留本章可用的灰雾点名、贺铸旧债和章末灾潮钩子，按冻结章纲重写整章。',
    '冻结事实：第8章横移战后能继续作战的是十四名守军；本章不得为了配合旧点评临时新增三名死亡，章末必须是十四名现役守军与十四盏灰灯一一对应。',
    '冻结事实：第6章已经揭示两年前尸体是按陈渡旧伤伪造的，军牌被故意留下，陈渡本人已被救回并连续参与第6至8章；不得把早期误认死亡重新当作未裁决矛盾。',
    '冻结状态：贺铸右臂箭伤未愈，持刀、劈砍和发力必须明确使用左手；岑鸢持有制动钥匙不等于她能操作已经卡死的制动杆，不要写成成功转动制动杆。',
    '修正封板受横移影响的物理因果和撤离到灰灯出现之间的时间过渡；只做有证据的连续性修复，不用解释性对白填满留白。'
  ].join('\n')],
  [13, [
    '这是老板授权的完整重写恢复。以冻结章纲、已结算第12章正文和当前稿中仍成立的情节为硬来源，重写整章；不要只在旧句上打补丁。',
    '钥匙线：第12章只确认两把钥匙齿形视觉上互补，并未实际插合。开篇必须明确岑鸢拒绝试插；“能嵌合”与“用途未确认”可以同时成立，不要写成已经严丝合缝试过。',
    '知识状态：岑鸢上一章已经解释过活账召回印，本章只能以回顾、补充或验证口吻说明新发现，林砚不得像第一次听到。',
    '人物状态：贺铸右臂旧伤未愈，所有画印、持刀和发力动作明确使用左手。陈渡此前没有右臂箭伤；删去这项无来源伤势，不要把贺铸的伤移植给陈渡。',
    '空间线：陌生足迹必须明确位于石墙外侧、且已进入距墙三百步以内；最深处可不足百步。不要把“不到三百步”误写成安全线外，也不要让足迹穿进石墙本体。',
    '谈判线：在林砚从水配额转为人身保护条件前，增加他识别陈渡真正恐惧是被追索而非价码不足的观察与推理。',
    '信号线：陈渡约定的是三堆斜列小火、中间先灭；章末出现单道青灰烟柱时，人物必须明确认出它不符合约定，从而形成“对方改了规则或另有人发信号”的新悬念。',
    '避免重复精确数字和定义句堆叠；保留沉盐沼、神秘行走者与烟柱钩子。不得引入新的未解释伤势、时间点或正史事实。'
  ].join('\n')]
]);

const terminalFailure = new Set(['failed', 'blocked', 'cancelled', 'interrupted']);
const activeStatus = new Set(['pending', 'queued', 'working', 'paused', 'waiting_confirmation']);

const arcPrompts = new Map([
  [11, [
    '规划第11至20章，共且仅共10章，作为“地下账库与迁城试验”故事弧。',
    '承接第10章发现的地下封存总账：林砚要查清灰塔为何被王都从账面抹除，同时把十七人的据点改造成能够移动的领地。',
    '必须包含：总账并非普通纸账、岑鸢发现审计印记的第二层用途、贺铸训练第一支守备队、第一次灰塔升级需在救人和保资源之间选择、出现一个立场可信但利益冲突的邻地领主。',
    '结尾状态：灰塔完成第一次短距迁移，却在新坐标收到一份提前三天写好的阵亡名单。',
    '每章必须有不同标题、唯一目标、3至5个具体推进节点和可兑现钩子；不要把十章写成同一个目标的重复模板。'
  ].join('\n')],
  [21, [
    '规划第21至30章，共且仅共10章，作为“灾潮会数数”故事弧。',
    '承接提前写好的阵亡名单。林砚追查灰雾计数规则，发现灾潮像一套失控的领地审计协议，会按照名字、债务与领主印记选择目标。',
    '必须包含：名单出现一个不该存在的人、幸存者内部对公开真相产生分裂、邻地求援可能是诱饵、主角用一次不完美的计算救下多数人但付出明确代价、揭示零号灰塔只是被拆散的系统节点之一。',
    '结尾状态：众人守住第一轮大灾潮，并从潮心带回一个会修改属性面板的灰色核心。',
    '每章必须有不同标题、唯一目标、3至5个具体推进节点和可兑现钩子；冲突要递进且人物选择要留下后果。'
  ].join('\n')],
  [31, [
    '规划第31至40章，共且仅共10章，作为“王都假账”故事弧。',
    '承接灰色核心。主角团队确认王都长期把边地伤亡写成资源损耗，并以假账维持灾潮和领主体系。团队必须在潜入、结盟与公开证据之间选择。',
    '必须包含：岑鸢的旧身份带来机会和信任危机、贺铸面对旧军同袍、灰塔需要暂时失去一项能力以伪装、双线行动互相制造信息差、证据公开后不是立刻胜利而是引发王都先发战争。',
    '结尾状态：假账被公开，边地多座领地响应零号灰塔，但王都宣布林砚为制造灾潮的叛领。',
    '每章必须有不同标题、唯一目标、3至5个具体推进节点和可兑现钩子；政治冲突必须由已发生事实推动，不能靠突然降智。'
  ].join('\n')],
  [41, [
    '规划第41至50章，共且仅共10章，作为第一卷终局“零号自由意志”。',
    '承接王都宣战。林砚要证明灾潮不是必须以人命维持的秩序，并让灰塔从执行审计的工具变成由居民共同约束的领地。',
    '必须包含：早期守塔人承诺得到兑现、第一章救下的看守者作出关键但非工具人的选择、阵亡名单机制被反向利用、主角不能靠单纯数值碾压取胜、岑鸢和贺铸各完成一次与自身核心矛盾有关的决定。',
    '第50章完成第一卷闭环：王都控制链被切断，零号灰塔保住自由但付出不可逆代价；同时留下更大世界中其他灰塔正在苏醒的新钩子。',
    '每章必须有不同标题、唯一目标、3至5个具体推进节点和可兑现钩子；终局要兑现前文线索，不要用旁白总结代替戏剧行动。'
  ].join('\n')]
]);

mkdirSync(EVIDENCE_DIR, { recursive: true });

function now() {
  return new Date().toISOString();
}

function record(event, details = {}) {
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
      WHERE owner_id = 'owner-local-boss' AND book_id = ? AND chapter_id = ?`).get(BOOK_ID, chapterId) ?? null;
  } finally {
    db.close();
  }
}

function blockedRecoveryCount(chapterId) {
  const db = database();
  try {
    return Number(db.prepare(`SELECT COUNT(*) AS count FROM chapter_pipeline_runs
      WHERE owner_id = 'owner-local-boss' AND book_id = ? AND chapter_id = ?
        AND status = 'failed' AND error_code = 'QUALITY_BLOCKED'`).get(BOOK_ID, chapterId)?.count ?? 0);
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
      WHERE owner_id = 'owner-local-boss' AND book_id = ?
        AND state IN ('succeeded', 'interrupted', 'failed')`).get(BOOK_ID);
    let chapterCalls = 0;
    let chapterTokens = 0;
    if (chapterId) {
      const chapter = db.prepare(`SELECT
        COUNT(*) AS calls,
        COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS tokens
        FROM model_calls
        WHERE owner_id = 'owner-local-boss' AND book_id = ?
          AND state IN ('succeeded', 'interrupted', 'failed')
          AND task_id IN (SELECT task_id FROM tasks WHERE owner_id = 'owner-local-boss' AND book_id = ? AND chapter_id = ?)`)
        .get(BOOK_ID, BOOK_ID, chapterId);
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
      WHERE owner_id = 'owner-local-boss' AND book_id = ? ORDER BY chapter_number`).all(BOOK_ID);
    for (const r of rows) {
      if (r.settlement_status === 'settled') settledCount += 1;
      else unsettled.push(r.chapter_number);
    }
    pipeline13 = db.prepare(`SELECT status, error_code, rewrite_count FROM chapter_pipeline_runs
      WHERE owner_id = 'owner-local-boss' AND book_id = ? AND chapter_id IN
        (SELECT chapter_id FROM chapters WHERE owner_id = 'owner-local-boss' AND book_id = ? AND chapter_number = 13)`)
      .get(BOOK_ID, BOOK_ID) ?? null;
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
      WHERE owner_id = 'owner-local-boss' AND book_id = ? AND chapter_id = ?
        AND status = 'failed' AND error_code = 'QUALITY_BLOCKED'
      ORDER BY updated_at DESC LIMIT 1`).get(BOOK_ID, chapterId);
    if (typeof run?.review_panel_id !== 'string') return null;
    const reports = db.prepare(`SELECT reviewer_role, report_json FROM review_reports
      WHERE owner_id = 'owner-local-boss' AND book_id = ? AND review_panel_id = ?
        AND status = 'submitted' ORDER BY reviewer_role`).all(BOOK_ID, run.review_panel_id);
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

function resumablePlanningDiscussion(scopeText) {
  const db = database();
  try {
    return db.prepare(`SELECT d.discussion_id AS discussionId, t.task_id AS taskId
      FROM discussions d JOIN tasks t
        ON json_extract(t.task_brief_json, '$.discussionId') = d.discussion_id
        AND t.owner_id = d.owner_id AND t.book_id = d.book_id
      WHERE d.owner_id = 'owner-local-boss' AND d.book_id = ? AND d.scope_text = ?
        AND d.status = 'awaiting_boss' AND t.status = 'succeeded'
      ORDER BY d.created_at DESC LIMIT 1`).get(BOOK_ID, scopeText) ?? null;
  } finally {
    db.close();
  }
}

function planningDecision(discussionId) {
  const db = database();
  try {
    return db.prepare(`SELECT decision_id FROM discussion_decisions
      WHERE discussion_id = ? AND book_id = ? ORDER BY created_at DESC LIMIT 1`).get(discussionId, BOOK_ID)?.decision_id ?? null;
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

async function acceptPendingManuscript(taskId) {
  const confirmations = await request(`/api/v1/books/${BOOK_ID}/confirmations`);
  const confirmation = confirmations.find((item) => item.status === 'pending' && item.target_type === 'manuscript' && item.task_id === taskId)
    ?? confirmations.find((item) => item.status === 'pending' && item.target_type === 'manuscript');
  if (confirmation === undefined) throw new Error(`task ${taskId} is waiting but no pending manuscript confirmation exists`);
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
      await acceptPendingManuscript(task.taskId);
      await waitForTask(task.taskId, 'settle-existing-chapter');
    }
  }
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

async function planBlock(firstChapterNumber) {
  const prompt = arcPrompts.get(firstChapterNumber);
  if (prompt === undefined) throw new Error(`no planned story arc prompt for chapter ${firstChapterNumber}`);
  const scopeText = `讨论 ${prompt}`;
  const resumable = resumablePlanningDiscussion(scopeText);
  let action;
  if (resumable !== null) {
    action = { taskId: resumable.taskId, discussionId: resumable.discussionId };
    record('planning_resumed_after_runner_restart', {
      firstChapterNumber, lastChapterNumber: firstChapterNumber + 9, ...action
    });
  } else {
    record('planning_started', { firstChapterNumber, lastChapterNumber: firstChapterNumber + 9 });
    const sent = await request(`/api/v1/books/${BOOK_ID}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: scopeText, attachmentIds: [] })
    });
    action = sent.action ?? {};
  }
  if (typeof action.taskId !== 'string' || typeof action.discussionId !== 'string') {
    throw new Error(`planning message did not schedule a discussion: ${JSON.stringify(action)}`);
  }
  await waitForTask(action.taskId, `plan-${firstChapterNumber}-${firstChapterNumber + 9}`);
  const decisionId = planningDecision(action.discussionId);
  if (decisionId === null) throw new Error(`discussion ${action.discussionId} completed without a decision`);
  const confirmed = await request(`/api/v1/books/${BOOK_ID}/discussions/${action.discussionId}/confirm`, {
    method: 'POST', body: JSON.stringify({ decisionId })
  });
  const prepared = confirmed.planning;
  if (!prepared || !Array.isArray(prepared.chapterOutlineVersionIds) || prepared.chapterOutlineVersionIds.length !== 10) {
    throw new Error(`planning confirmation did not create exactly ten chapter outlines: ${JSON.stringify(confirmed)}`);
  }
  record('planning_confirmed', { firstChapterNumber, discussionId: action.discussionId, decisionId, outlineCount: prepared.chapterOutlineVersionIds.length });
}

async function ensureOutline(chapterNumber) {
  if (await outlineFor(chapterNumber)) return;
  const blockStart = Math.floor((chapterNumber - 1) / 10) * 10 + 1;
  if (blockStart === 1) throw new Error(`confirmed outline for chapter ${chapterNumber} is missing from the initial block`);
  await planBlock(blockStart);
  if (!(await outlineFor(chapterNumber))) throw new Error(`chapter ${chapterNumber} outline still missing after confirmed planning`);
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
    const recoveryInstruction = blockedRecoveryNotes.get(chapterNumber) ?? reportBasedRecoveryInstruction(existing.chapterId);
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
        ? (blockedRecoveryNotes.get(chapterNumber) ?? reportBasedRecoveryInstruction(current.chapterId))
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
  const confirmation = await acceptPendingManuscript(taskId);
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
}

async function main() {
  record('run_started', { bookId: BOOK_ID, targetChapters: TARGET_CHAPTERS, databasePath: DATABASE_PATH, mode: MODE, blockedRecovery: BLOCKED_RECOVERY });
  if (MODE !== 'real') {
    // 默认 offline：只读巡检，不连真实 API、不发起真实调用、不生成正文。
    await inspectAndReport();
    record('run_stopped_offline', { reason: '默认离线模式；需 --mode=real 且老板明确授权才连真实 API' });
    return;
  }
  // real 模式：套餐余额未知时，正式批次默认最多 1-3 章并等待老板确认。
  const startup = batchStartupGate({ packageBalanceUnknown: true, plannedChapters: TARGET_CHAPTERS });
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
  await settleActiveChapterTasks();
  while (true) {
    const list = await chapters();
    const settled = list.filter((chapter) => chapter.settlementStatus === 'settled').sort((a, b) => a.chapterNumber - b.chapterNumber);
    const maxSettled = settled.at(-1)?.chapterNumber ?? 0;
    if (maxSettled >= TARGET_CHAPTERS) break;
    if (settled.some((chapter, index) => chapter.chapterNumber !== index + 1)) {
      throw new Error(`settled chapter sequence is not contiguous through ${maxSettled}`);
    }
    await generateChapter(maxSettled + 1);
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
    throw new Error('final fifty-chapter save verification failed');
  }
  writeFileSync(resolve(EVIDENCE_DIR, 'chapters.json'), `${JSON.stringify(finalRows, null, 2)}\n`, 'utf8');
  saveState({ completed: true, completedChapters: finalRows.length, totalCharacters: finalRows.reduce((sum, row) => sum + row.characterCount, 0) });
  record('run_completed', { chapters: finalRows.length, totalCharacters: finalRows.reduce((sum, row) => sum + row.characterCount, 0) });
}

main().catch((error) => {
  record('run_failed', { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : null });
  process.exitCode = 1;
});
