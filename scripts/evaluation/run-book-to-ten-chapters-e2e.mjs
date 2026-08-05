import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API = 'http://127.0.0.1:43111';
const ORIGIN = 'http://127.0.0.1:43110';
const RELEASE_ID = 'wm-longform-r1-20260719-003435-e4d7b8b7';
const RUN_KEY = (process.env.WENMI_E2E_RUN_KEY ?? 'v1').trim().replace(/[^a-zA-Z0-9_-]/g, '-');
const TEST_ID = `E2E-20260801-BOOK-TO-10-${RUN_KEY.toUpperCase()}`;
const POLL_MS = 2_000;
const TASK_TIMEOUT_MS = 30 * 60 * 1_000;
const TEST_TOKEN_LIMIT = 5_000_000;
const ROOT = resolve(`data/verification/book-to-ten-chapters-e2e-${RUN_KEY}`);
const STATE_FILE = join(ROOT, 'state.json');
const EVENT_FILE = join(ROOT, 'run-events.ndjson');
const ISSUE_FILE = join(ROOT, 'issues.md');
const FINAL_FILE = join(ROOT, 'final-evidence.json');

mkdirSync(ROOT, { recursive: true });

const state = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  : { testId: TEST_ID, releaseId: RELEASE_ID, createdAt: new Date().toISOString(), settledChapters: [] };

let cookie = '';
let activePhase = 'startup';
const terminalFailures = new Set(['failed', 'blocked', 'cancelled', 'interrupted']);

function now() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }
function log(event, details = {}) {
  const entry = { at: now(), event, ...details };
  appendFileSync(EVENT_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  console.log(JSON.stringify(entry));
}
function save(patch = {}) {
  Object.assign(state, patch, { updatedAt: now() });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
function issue(error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  appendFileSync(ISSUE_FILE, `\n## ${now()} — ${activePhase}\n\n\`\`\`text\n${message}\n\`\`\`\n`, 'utf8');
  save({ stoppedAtPhase: activePhase, lastError: message.slice(0, 4_000) });
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizedText(value) {
  return String(value ?? '').replace(/\s+/gu, '').trim();
}

function sameTextSet(left, right) {
  const normalized = (items) => [...new Set((items ?? []).map(normalizedText))].sort();
  const a = normalized(left);
  const b = normalized(right);
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function assertStageFinalOutline(masterStage, outline) {
  assert(outline?.chapterNumber === masterStage.chapterRange.end,
    'stage-final outline is missing or has the wrong chapter number');
  assert(outline.sourceStage?.stageNumber === masterStage.stageNumber
    && normalizedText(outline.sourceStage?.title) === normalizedText(masterStage.title)
    && outline.sourceStage?.chapterRange?.start === masterStage.chapterRange.start
    && outline.sourceStage?.chapterRange?.end === masterStage.chapterRange.end,
  'stage-final outline does not cite the selected master stage exactly');
  assert(outline.stageBoundary?.mustCloseStage === true,
    'stage-final outline does not require stage closure');
  assert(normalizedText(outline.stageBoundary?.resolution) === normalizedText(masterStage.mainline.resolution)
    && normalizedText(outline.stageBoundary?.result) === normalizedText(masterStage.mainline.result),
  'stage-final outline changed the selected stage resolution or result');
  assert(sameTextSet(outline.stageBoundary?.pendingThreads, masterStage.pendingThreads),
    'stage-final outline changed the selected pending-thread set');
}

async function issueSession() {
  const response = await fetch(`${API}/api/v1/runtime/session`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'sec-fetch-site': 'same-site', 'content-type': 'application/json' },
    body: '{}'
  });
  assert(response.ok, `runtime session failed: ${response.status} ${await response.text()}`);
  cookie = response.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  assert(cookie.length > 0, 'runtime session did not return cookie');
}

async function request(path, { method = 'GET', body } = {}) {
  if (cookie.length === 0) await issueSession();
  const headers = { cookie };
  if (method !== 'GET') {
    headers.origin = ORIGIN;
    headers['sec-fetch-site'] = 'same-site';
    headers['content-type'] = 'application/json';
  }
  let response = await fetch(`${API}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (response.status === 401) {
    await issueSession();
    headers.cookie = cookie;
    response = await fetch(`${API}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error(`${method} ${path} returned non-JSON ${response.status}: ${raw.slice(0, 500)}`); }
  if (!response.ok || payload.error !== undefined) {
    const detail = payload.error === undefined
      ? JSON.stringify(payload)
      : `${payload.error.code}: ${payload.error.message} ${JSON.stringify(payload.error.details ?? {})}`;
    throw new Error(`${method} ${path} failed ${response.status}: ${detail}`);
  }
  return payload.data;
}

async function waitForTask(bookId, taskId, purpose) {
  const startedAt = Date.now();
  let signature = '';
  while (Date.now() - startedAt < TASK_TIMEOUT_MS) {
    const detail = await request(`/api/v1/books/${bookId}/tasks/${taskId}`);
    const task = detail.task;
    const working = detail.modelCalls
      .filter((call) => call.state === 'working')
      .map((call) => `${call.provider}/${call.model_id}`);
    const nextSignature = `${task.status}:${task.currentPhase}:${working.join(',')}`;
    if (nextSignature !== signature) {
      log('task_progress', { purpose, taskId, status: task.status, phase: task.currentPhase, workingModels: working });
      signature = nextSignature;
    }
    if (task.status === 'waiting_confirmation' || task.status === 'succeeded') return detail;
    if (terminalFailures.has(task.status)) {
      throw new Error(`${purpose} task ${taskId} ended as ${task.status} (${task.errorCode ?? 'no error code'})`);
    }
    await sleep(POLL_MS);
  }
  throw new Error(`${purpose} task ${taskId} exceeded ${TASK_TIMEOUT_MS / 60_000} minutes`);
}

function blueprint(taxonomyVersion) {
  return {
    taxonomyVersion,
    channel: 'female',
    categoryKey: 'female-suspense',
    targetAudience: '',
    protagonists: [{
      role: 'female_lead',
      name: '林澄',
      age: '二十八岁',
      background: '雾江市失物招领中心档案员，曾是调查记者；三年前因一篇证据不足的报道伤害无辜，主动离开新闻行业。',
      personalities: ['冷静', '敏锐', '克制', '责任感强']
    }],
    storyDirection: '雨夜里，林澄收到一件系统中不存在的失物，归还单的时间却写着明天。她从一张被篡改的流转记录入手，追查邻居陈月失踪与旧城拆迁档案造假的关系；第一阶段必须完整解决“明日归还单”事件，同时留下更大利益网络的可靠线索。',
    worldBackground: '',
    openingBackground: '',
    stageOne: { start: '', development: '', end: '' },
    fullBookOutline: '',
    mainTags: ['悬疑', '推理', '女性成长', '群像', '现实'],
    auxiliaryTags: ['职场成长', '探案'],
    storyTraits: ['成长', '慢热', '正剧'],
    customTags: ['失物叙事', '档案谜案', '公平线索', '现实质感'],
    initialMap: '雾江市旧城区、失物招领中心、旧城改造办公室与临江公交总站。',
    mustFollow: [
      '现实题材，不出现超自然能力或万能黑客技术',
      '关键真相必须提前给出可复核线索，不能靠巧合或反派自白解决',
      '警务、档案和取证过程尊重现实程序',
      '感情线慢热且服务人物成长，不挤占案件主线'
    ]
  };
}

function answerFor(item, attempt = 1) {
  const answers = {
    'creative-concept': '策划理念确定为“失物会说话，但只靠现实证据说话”：每个阶段围绕一件普通失物展开，物件磨损、流转记录和持有人选择共同构成线索。作品用林澄修复一次错误报道造成的职业创伤为长期人物线，悬疑依靠公平证据，不靠超自然或巧合。',
    'reader-promise': '读者持续获得三种稳定体验：可以参与推理的公平线索；普通城市生活中被忽略之人的真实处境；林澄凭耐心和专业能力纠错后带来的克制爽感。每个阶段解决一件完整事件，同时推进她重建职业信任与核心关系。',
    era: '故事发生在当代架空沿海城市雾江，技术和制度与现实中国城市相近。失物招领中心接入公交、商场和社区的统一登记系统，但数据可被有权限的人修改，任何查询、调阅和取证都留下日志并受现实程序限制。',
    protagonist: '林澄，二十八岁，雾江市失物招领中心档案员，前调查记者。她擅长核对时间线、识别叙述矛盾和从物件使用痕迹还原行为，却因三年前证据不足的报道伤害过无辜者，失去记者身份和对直觉的信任。开篇资源有限，只有合法档案权限、旧同事关系和扎实调查能力。',
    motivation: '林澄表层目标是找到失物主人并解释异常归还单，深层愿望是证明严谨求证仍能保护人。她害怕再次因急于揭露而伤害无辜；底线是不伪造证据、不非法侵入系统、不把弱者当诱饵，也不会为了个人翻身抢先公布未经核实的结论。',
    'must-follow': '必须遵守：现实逻辑；公平线索；程序取证；人物因选择承担后果；感情线慢热。是的，感情线同样遵守“选择承担后果”：因情感判断影响调查时必须产生可感知的人际或职业代价，但代价应符合行为程度，不能为虐而虐。禁止超自然解释、万能黑客、巧合破案、反派长篇自白、主角无代价越权。剧情简介只是方向参考，后续具体情节以作者逐阶段确认的总纲和章纲为准。',
    'relationship-premise': '林澄与市政系统维护工程师罗知因同一份异常流转日志被迫合作。林澄擅长人和叙事，罗知擅长系统边界与证据保全；两人都重视事实但对“公开真相的时机”看法不同。吸引力来自能力互补、共同守住无辜者以及逐步建立的可靠感。',
    'relationship-obstacle': '关系阻力不是误会，而是价值与责任冲突：林澄曾因过早公开伤人，因此过度克制；罗知受保密与职业责任约束，不能把内部数据随意交给她。双方只有在一次次合法协作、承担风险和兑现承诺中才能建立信任，不能靠一次坦白速解。',
    'case-rules': '案件必须满足现实可执行性：异常归还单源于权限滥用和离线补录，不预知未来；作案者只能修改其权限范围内的记录，无法抹除纸质交接单、设备时钟差、门禁、物件磨损和第三方见证。每个结论至少由两类相互独立的证据支持。',
    'evidence-chain': '证据分为原物痕迹、纸质交接、系统日志、门禁影像和证人陈述。数字记录先做哈希与只读副本，纸质材料记录取得来源，证词必须与客观时间线互证。污染、转手和权限修改都要标注；未经验证的信息只能作为线索，不能直接定罪。',
    'truth-layers': '第一层让读者与林澄同时发现归还时间异常；第二层通过公交卡磨损、补录账号和设备时钟差揭示有人伪造流转；第三层说明伪造是为掩盖陈月掌握的拆迁补偿档案。关键物证在真相揭示前出现，误导来自合理解释差异，不隐瞒视角人物已经知道的事实。'
  };
  const base = answers[item.itemKey] ?? `关于“${item.label}”，本书采用现实、可验证且可持续扩展的设定：${item.prompt} 具体边界服从林澄的调查能力、雾江市现实制度和公平线索原则；只确定运行规则，不提前锁死具体剧情结果。`;
  if (attempt === 1) return base;
  return `${base}\n补充确认：你上一轮提出的边界问题，统一采用最符合现实程序、公平线索和人物主动性的明确方案；未知细节保留为后续剧情空间。请据此整理当前设定项候选，不再把同一问题留作待确认。`;
}

async function createBook() {
  if (state.bookId) return state.bookId;
  activePhase = 'create-book';
  const taxonomy = await request('/api/v1/opening-taxonomy');
  const openingBlueprint = blueprint(taxonomy.version);
  const title = `雨夜失物招领处·全流程测试-${RUN_KEY}-${new Date().toISOString().slice(0, 10)}`;
  const draft = await request('/api/v1/books/drafts', {
    method: 'POST', body: { title, text: openingBlueprint.storyDirection, openingBlueprint }
  });
  const created = await request(`/api/v1/book-drafts/${draft.draftId}/confirm`, {
    method: 'POST', body: { expectedVersion: draft.version }
  });
  assert(created.agentCount === 11, `expected 11 agents, got ${created.agentCount}`);
  save({ bookId: created.bookId, title, kickoffTaskId: created.kickoffTaskId });
  log('book_created', { bookId: created.bookId, title, kickoffTaskId: created.kickoffTaskId });
  if (created.kickoffTaskId) await waitForTask(created.bookId, created.kickoffTaskId, 'opening-reception');
  return created.bookId;
}

async function completeSettings(bookId) {
  activePhase = 'setting-outline';
  const attempts = new Map();
  for (let guard = 0; guard < 40; guard += 1) {
    const planning = await request(`/api/v1/books/${bookId}/planning-state`);
    if (['setting_ready', 'master_outline_in_progress', 'master_outline_ready', 'chapter_outline_ready', 'writing_enabled'].includes(planning.stage)) {
      log('settings_ready', { stage: planning.stage, settingBaselineVersionId: planning.setting_baseline_version_id ?? planning.settingBaselineVersionId ?? null });
      return;
    }
    const items = await request(`/api/v1/books/${bookId}/setting-outline-workspace`);
    const candidate = items.find((item) => item.status === '候选待确认');
    if (candidate) {
      const confirmed = await request(`/api/v1/books/${bookId}/messages`, {
        method: 'POST', body: { content: '确认', attachmentIds: [] }
      });
      log('setting_confirmed', { itemKey: candidate.itemKey, action: confirmed.action });
      if (typeof confirmed.action?.taskId === 'string') {
        await waitForTask(bookId, confirmed.action.taskId, `ask-setting-${confirmed.action.settingItemKey ?? 'next'}`);
      }
      continue;
    }
    const current = items.find((item) => ['讨论中', '待讨论'].includes(item.status));
    assert(current, `planning stage ${planning.stage} has no current setting item`);
    const attempt = (attempts.get(current.itemKey) ?? 0) + 1;
    attempts.set(current.itemKey, attempt);
    assert(attempt <= 3, `${current.itemKey} requested more than three author follow-ups`);
    const answer = answerFor(current, attempt);
    const sent = await request(`/api/v1/books/${bookId}/messages`, {
      method: 'POST', body: { content: answer, attachmentIds: [] }
    });
    assert(typeof sent.action?.taskId === 'string', `setting answer did not schedule task: ${JSON.stringify(sent)}`);
    log('setting_answered', { itemKey: current.itemKey, label: current.label, attempt, taskId: sent.action.taskId });
    await waitForTask(bookId, sent.action.taskId, `answer-setting-${current.itemKey}`);
    const refreshed = await request(`/api/v1/books/${bookId}/setting-outline-workspace`);
    const after = refreshed.find((item) => item.itemKey === current.itemKey);
    if (after?.status === '讨论中') {
      log('setting_followup_requested', { itemKey: current.itemKey, attempt });
      continue;
    }
    assert(after?.status === '候选待确认', `${current.itemKey} did not reach candidate status; got ${after?.status}`);
  }
  throw new Error('setting outline loop exceeded 40 iterations');
}

async function ensureTestBudget(bookId) {
  activePhase = 'test-budget';
  const budgets = await request(`/api/v1/books/${bookId}/budgets`);
  const active = budgets.find((budget) => budget.status === 'active') ?? budgets[0];
  assert(active, 'new book did not create a budget');
  if (active.token_limit >= TEST_TOKEN_LIMIT) return;
  const revised = await request(`/api/v1/books/${bookId}/budgets/${active.budget_id}`, {
    method: 'PATCH',
    body: { expectedTokenLimit: active.token_limit, tokenLimit: TEST_TOKEN_LIMIT }
  });
  log('test_budget_revised', {
    budgetId: active.budget_id,
    previousTokenLimit: active.token_limit,
    tokenLimit: revised.tokenLimit,
    cashLimitMicros: revised.cashLimitMicros
  });
}

async function sendAndWait(bookId, content, purpose) {
  const sent = await request(`/api/v1/books/${bookId}/messages`, {
    method: 'POST', body: { content, attachmentIds: [] }
  });
  assert(typeof sent.action?.taskId === 'string', `${purpose} did not schedule task: ${JSON.stringify(sent)}`);
  log(`${purpose}_scheduled`, { taskId: sent.action.taskId, discussionId: sent.action.discussionId ?? null, action: sent.action });
  await waitForTask(bookId, sent.action.taskId, purpose);
  return sent;
}

async function startPlanningOrRecoverPending(bookId, content, purpose) {
  const sent = await request(`/api/v1/books/${bookId}/messages`, {
    method: 'POST', body: { content, attachmentIds: [] }
  });
  if (sent.action?.kind === 'planning_confirmation_required') {
    const confirmed = await request(`/api/v1/books/${bookId}/messages`, {
      method: 'POST', body: { content: '确认当前规划', attachmentIds: [] }
    });
    assert(confirmed.action?.planningPrepared === true, `${purpose} pending plan could not be recovered: ${JSON.stringify(confirmed.action)}`);
    log(`${purpose}_pending_plan_recovered`, {
      discussionId: sent.action.discussionId,
      decisionId: sent.action.decisionId,
      chapterOutlineCount: confirmed.action.chapterOutlineCount
    });
    return { recovered: true, sent, confirmed };
  }
  assert(typeof sent.action?.taskId === 'string', `${purpose} did not schedule task: ${JSON.stringify(sent)}`);
  log(`${purpose}_scheduled`, { taskId: sent.action.taskId, discussionId: sent.action.discussionId ?? null, action: sent.action });
  await waitForTask(bookId, sent.action.taskId, purpose);
  return { recovered: false, sent };
}

async function completeStageMaster(bookId) {
  activePhase = 'first-stage-master-outline';
  let planning = await request(`/api/v1/books/${bookId}/planning-state`);
  if (['master_outline_ready', 'chapter_outline_ready', 'writing_enabled'].includes(planning.stage)) return;
  await sendAndWait(bookId, [
    '讨论剧情总纲。只规划第一阶段第1—10章，不规划下一阶段。',
    '本阶段围绕“明日归还单”事件：林澄发现异常失物与陈月失踪有关；从物件痕迹、纸质交接与系统权限三路取证；中段因一次错误推断失去证人信任；最终合法保全证据、找到陈月并揭露旧城拆迁补偿档案造假。',
    '请按阶段格式给出主线遭遇—解决—结果、起承转合、阶段总结、待回收线索和后续方向；必须服从已确认设定，不生成章纲或正文。'
  ].join('\n'), 'stage-master-discussion');
  const confirmed = await request(`/api/v1/books/${bookId}/messages`, {
    method: 'POST', body: { content: '确认当前规划', attachmentIds: [] }
  });
  log('stage_master_confirmed', { action: confirmed.action });
  planning = await request(`/api/v1/books/${bookId}/planning-state`);
  assert(['master_outline_ready', 'chapter_outline_ready', 'writing_enabled'].includes(planning.stage), `master outline did not advance state: ${JSON.stringify(planning)}`);
}

async function artifacts(bookId) { return request(`/api/v1/books/${bookId}/artifacts`); }
async function selectedOutline(bookId, chapterNumber) {
  const all = await artifacts(bookId);
  return all.find((item) => item.artifact_type === 'chapter_outline'
    && item.active_version_status === 'selected'
    && Number(item.active_content?.chapterNumber) === chapterNumber) ?? null;
}

async function planRange(bookId, start, end) {
  const missing = [];
  for (let number = start; number <= end; number += 1) if (!(await selectedOutline(bookId, number))) missing.push(number);
  if (missing.length === 0) return;
  activePhase = `chapter-outlines-${start}-${end}`;
  const exploration = await startPlanningOrRecoverPending(bookId, [
    `讨论并规划第${start}—${end}章：细化“明日归还单”第一阶段中这一小段。`,
    `必须承接已确认的第一阶段总纲与上一章结尾；第${end}章形成清晰的局部进展，但只有第10章才能解决本阶段核心事件。`,
    '请明确每章唯一功能、开章与章末状态、出场人物目标与知识边界、冲突代价、3—5个剧情节点、情绪变化、信息控制、伏笔动作、章末钩子及主笔自由区。'
  ].join('\n'), `explore-chapters-${start}-${end}`);
  if (exploration.recovered) {
    const stillMissing = [];
    for (let number = start; number <= end; number += 1) if (!(await selectedOutline(bookId, number))) stillMissing.push(number);
    if (stillMissing.length === 0) return;
  }
  const locked = await sendAndWait(
    bookId,
    `锁定当前方向：按已确认设定和第一阶段总纲细化第${start}—${end}章，保留现实取证、公平线索和逐章连续性。`,
    `lock-chapters-${start}-${end}`
  );
  assert(locked.action?.kind === 'creative_direction_locked', `unexpected lock action: ${JSON.stringify(locked.action)}`);
  const confirmed = await request(`/api/v1/books/${bookId}/messages`, {
    method: 'POST', body: { content: '确认当前规划', attachmentIds: [] }
  });
  assert(confirmed.action?.planningPrepared === true, `range ${start}-${end} was not prepared: ${JSON.stringify(confirmed.action)}`);
  assert(confirmed.action?.chapterOutlineCount === end - start + 1, `range ${start}-${end} outline count mismatch: ${JSON.stringify(confirmed.action)}`);
  for (let number = start; number <= end; number += 1) {
    assert(await selectedOutline(bookId, number), `chapter ${number} outline missing after confirmation`);
  }
  log('chapter_outlines_confirmed', { start, end, count: confirmed.action.chapterOutlineCount });
}

async function acceptPendingManuscript(bookId, taskId) {
  const confirmations = await request(`/api/v1/books/${bookId}/confirmations`);
  const confirmation = confirmations.find((item) => item.status === 'pending' && item.target_type === 'manuscript' && item.task_id === taskId)
    ?? confirmations.find((item) => item.status === 'pending' && item.target_type === 'manuscript');
  assert(confirmation, `task ${taskId} waiting without pending manuscript confirmation`);
  await request(`/api/v1/books/${bookId}/confirmations/${confirmation.confirmation_id}/accept`, {
    method: 'POST', body: { expectedCanonRevision: confirmation.expected_canon_revision }
  });
  log('manuscript_confirmed', { taskId, confirmationId: confirmation.confirmation_id });
}

async function chapterList(bookId) { return request(`/api/v1/books/${bookId}/chapters`); }

const chapterPhaseRank = new Map([
  ['pending', 0], ['preflight', 1], ['context', 2], ['draft', 3], ['hard_check', 4],
  ['review', 5], ['revise', 6], ['waiting_confirmation', 7], ['settlement', 8], ['completed', 9]
]);

async function resumableChapterTask(bookId, chapterId) {
  const candidates = (await request(`/api/v1/books/${bookId}/tasks`))
    .filter((task) => task.chapterId === chapterId && task.taskType === 'chapter_creation')
    .filter((task) => ['queued', 'working', 'waiting_confirmation', 'failed', 'blocked', 'interrupted'].includes(task.status));
  return candidates.sort((left, right) => {
    const phaseDifference = (chapterPhaseRank.get(right.currentPhase) ?? -1) - (chapterPhaseRank.get(left.currentPhase) ?? -1);
    if (phaseDifference !== 0) return phaseDifference;
    return right.attemptCount - left.attemptCount;
  })[0] ?? null;
}

function formalCharacterCount(content) {
  return [...String(content ?? '')].filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}

function assertReadableChapter(number, content) {
  const text = String(content.content ?? '');
  const effectiveCharacterCount = formalCharacterCount(text);
  assert(effectiveCharacterCount >= 2_350 && effectiveCharacterCount <= 3_650,
    `chapter ${number} effective length ${effectiveCharacterCount} outside formal range 2350-3650 (raw ${content.totalLength})`);
  assert(!/(?:workflowArtifact|sourceId|source_id|confirmed_decisions|```json|"chapterNumber"|\bundefined\b)/u.test(text),
    `chapter ${number} exposes internal code or workflow fields`);
  assert(!/(?:待补充|TODO|这里填写|示例正文|(?:^|\n)\s*[【\[]?系统提示[】\]]?\s*[：:])/u.test(text),
    `chapter ${number} contains placeholder text`);
  return effectiveCharacterCount;
}

async function generateChapter(bookId, chapterNumber) {
  const existing = (await chapterList(bookId)).find((chapter) => chapter.chapterNumber === chapterNumber);
  if (existing?.settlementStatus === 'settled') {
    const content = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/content`);
    const effectiveCharacterCount = assertReadableChapter(chapterNumber, content);
    if (!state.settledChapters.includes(chapterNumber)) save({ settledChapters: [...state.settledChapters, chapterNumber].sort((a, b) => a - b) });
    log('settled_chapter_reverified', {
      chapterNumber,
      chapterId: existing.chapterId,
      manuscriptVersionId: content.manuscriptVersionId,
      contentHash: content.contentHash,
      characterCount: effectiveCharacterCount,
      rawCharacterCount: content.totalLength
    });
    return;
  }
  activePhase = `chapter-${chapterNumber}`;
  const outline = await selectedOutline(bookId, chapterNumber);
  assert(outline, `chapter ${chapterNumber} has no selected outline`);
  const title = String(outline.active_content?.title ?? `第${chapterNumber}章`);
  let task = existing?.chapterId === undefined ? null : await resumableChapterTask(bookId, existing.chapterId);
  if (task !== null && task.status === 'blocked' && task.errorCode === 'QUALITY_BLOCKED'
    && task.currentPhase === 'hard_check' && existing?.chapterId !== undefined) {
    const current = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/content`);
    assert(current.manuscriptVersionId, `chapter ${chapterNumber} hard-check block has no current manuscript`);
    task = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/rewrite`, {
      method: 'POST',
      body: {
        manuscriptVersionId: current.manuscriptVersionId,
        instruction: '保留已经修正的人物选择、证据闭环和章末状态，完整重写本章；删去重复解释和同义复述，正文严格控制在2700至3200有效字符。'
      }
    });
    log('chapter_hard_check_rewrite_scheduled', {
      chapterNumber, title, previousTaskId: state.chapterTaskIds?.[chapterNumber] ?? null,
      taskId: task.taskId, manuscriptVersionId: current.manuscriptVersionId
    });
  } else if (task !== null && task.status === 'blocked' && task.errorCode === 'QUALITY_BLOCKED'
    && task.currentPhase === 'review' && existing?.chapterId !== undefined) {
    const current = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/content`);
    assert(current.manuscriptVersionId, `chapter ${chapterNumber} review block has no current manuscript`);
    const previousTaskId = task.taskId;
    task = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/finalize`, {
      method: 'POST', body: { manuscriptVersionId: current.manuscriptVersionId }
    });
    log('chapter_review_reopened', {
      chapterNumber, title, previousTaskId, taskId: task.taskId,
      manuscriptVersionId: current.manuscriptVersionId
    });
  } else if (task !== null && ['failed', 'interrupted'].includes(task.status)) {
    task = await request(`/api/v1/books/${bookId}/tasks/${task.taskId}/retry`, { method: 'POST', body: {} });
    log('chapter_task_retried', { chapterNumber, title, taskId: task.taskId, resumedPhase: task.currentPhase });
  }
  if (task === null) {
    const run = await request(`/api/v1/books/${bookId}/writing-runs`, {
      method: 'POST', body: { chapterTitle: title }
    });
    assert(Array.isArray(run.taskIds) && run.taskIds.length === 1, `chapter ${chapterNumber} did not create exactly one task`);
    task = { taskId: run.taskIds[0] };
    log('chapter_scheduled', { chapterNumber, title, taskId: task.taskId });
  } else if (!['failed', 'interrupted'].includes(task.status)) {
    log('chapter_task_resumed', { chapterNumber, title, taskId: task.taskId, status: task.status, phase: task.currentPhase });
  }
  const taskId = task.taskId;
  save({ chapterTaskIds: { ...(state.chapterTaskIds ?? {}), [chapterNumber]: taskId } });
  const review = await waitForTask(bookId, taskId, `chapter-${chapterNumber}-production`);
  if (review.task.status === 'waiting_confirmation') {
    await acceptPendingManuscript(bookId, taskId);
    const settled = await waitForTask(bookId, taskId, `chapter-${chapterNumber}-settlement`);
    assert(settled.task.status === 'succeeded', `chapter ${chapterNumber} did not settle`);
  } else {
    // A recovered worker can recreate the owner gate and an already-running
    // verification client can accept it between two polling intervals. Never
    // infer approval from task success alone: the settled chapter below is the
    // durable evidence that the owner gate was accepted and canon settlement
    // completed.
    assert(review.task.status === 'succeeded',
      `chapter ${chapterNumber} reached ${review.task.status} without owner confirmation`);
    log('chapter_confirmation_transition_recovered', { chapterNumber, taskId });
  }
  const chapter = (await chapterList(bookId)).find((item) => item.chapterNumber === chapterNumber);
  assert(chapter?.settlementStatus === 'settled', `chapter ${chapterNumber} is not settled in catalog`);
  const content = await request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}/content`);
  const effectiveCharacterCount = assertReadableChapter(chapterNumber, content);
  save({ settledChapters: [...new Set([...state.settledChapters, chapterNumber])].sort((a, b) => a - b) });
  log('chapter_settled', {
    chapterNumber, chapterId: chapter.chapterId, title: chapter.title,
    manuscriptVersionId: content.manuscriptVersionId, contentHash: content.contentHash,
    characterCount: effectiveCharacterCount, rawCharacterCount: content.totalLength
  });
}

async function collectEvidence(bookId) {
  activePhase = 'final-evidence';
  const [book, profile, planning, settings, allArtifacts, chapters, messages] = await Promise.all([
    request(`/api/v1/books/${bookId}`),
    request(`/api/v1/books/${bookId}/book-profile`),
    request(`/api/v1/books/${bookId}/planning-state`),
    request(`/api/v1/books/${bookId}/setting-outline-workspace`),
    artifacts(bookId),
    chapterList(bookId),
    request(`/api/v1/books/${bookId}/messages`)
  ]);
  const settled = chapters.filter((chapter) => chapter.settlementStatus === 'settled').sort((a, b) => a.chapterNumber - b.chapterNumber);
  assert(settled.length >= 10, `only ${settled.length} chapters settled`);
  assert(settled.slice(0, 10).every((chapter, index) => chapter.chapterNumber === index + 1), 'settled chapter numbers are not contiguous 1-10');
  const chapterEvidence = [];
  for (const chapter of settled.slice(0, 10)) {
    const content = await request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}/content`);
    const effectiveCharacterCount = assertReadableChapter(chapter.chapterNumber, content);
    chapterEvidence.push({
      chapterNumber: chapter.chapterNumber, title: chapter.title, chapterId: chapter.chapterId,
      manuscriptVersionId: content.manuscriptVersionId, contentHash: content.contentHash,
      characterCount: effectiveCharacterCount, rawCharacterCount: content.totalLength, preview: content.content.slice(0, 240)
    });
  }
  const selectedSettings = settings.filter((item) => item.status === '已确认');
  const selectedOutlines = allArtifacts.filter((item) => item.artifact_type === 'chapter_outline' && item.active_version_status === 'selected');
  const master = allArtifacts.find((item) => item.artifact_type === 'master_outline' && item.active_version_status === 'selected');
  assert(master?.active_content?.outlineSchema === 'stage_master_v2', 'selected first-stage master is missing stage_master_v2');
  assert(master.active_content.majorStages?.length === 1, 'first-stage master must contain exactly one stage');
  const masterStage = master.active_content.majorStages[0];
  assert(masterStage?.chapterRange?.start === 1 && masterStage?.chapterRange?.end === 10,
    'first-stage master must cover chapters 1-10');
  assert(selectedOutlines.filter((item) => Number(item.active_content?.chapterNumber) <= 10).length === 10,
    'selected detailed chapter outlines 1-10 are incomplete');
  const stageFinalOutline = selectedOutlines.find((item) => Number(item.active_content?.chapterNumber) === masterStage.chapterRange.end)?.active_content;
  assertStageFinalOutline(masterStage, stageFinalOutline);
  assert(selectedSettings.length >= 11, `only ${selectedSettings.length} settings confirmed`);
  const evidence = {
    testId: TEST_ID, releaseId: RELEASE_ID, completedAt: now(),
    book: { bookId, title: book.title, status: book.status, canonRevision: book.canonRevision },
    profile,
    planning,
    settings: selectedSettings.map((item) => ({ itemKey: item.itemKey, label: item.label, content: item.content })),
    masterOutline: master.active_content,
    chapterOutlines: selectedOutlines
      .filter((item) => Number(item.active_content?.chapterNumber) <= 10)
      .sort((a, b) => Number(a.active_content.chapterNumber) - Number(b.active_content.chapterNumber))
      .map((item) => item.active_content),
    chapters: chapterEvidence,
    visibleMessageCount: messages.length
  };
  writeFileSync(FINAL_FILE, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  save({ completedAt: evidence.completedAt, stoppedAtPhase: null, lastError: null });
  log('e2e_completed', { bookId, title: book.title, canonRevision: book.canonRevision, chapterCount: chapterEvidence.length, settingCount: selectedSettings.length });
}

try {
  await issueSession();
  const healthEnvelope = await fetch(`${API}/health`).then((response) => response.json());
  const health = healthEnvelope.data ?? healthEnvelope;
  assert(health.status === 'ok' || health.ok === true, `API health is not ready: ${JSON.stringify(healthEnvelope)}`);
  const bookId = await createBook();
  await ensureTestBudget(bookId);
  await completeSettings(bookId);
  await completeStageMaster(bookId);
  // Rolling production plans one chapter at a time. This keeps the structured
  // planning contract small enough for reliable validation and gives every
  // chapter its full conflict, beat, continuity and hook detail.
  for (let chapterNumber = 1; chapterNumber <= 10; chapterNumber += 1) {
    await planRange(bookId, chapterNumber, chapterNumber);
  }
  for (let chapterNumber = 1; chapterNumber <= 10; chapterNumber += 1) await generateChapter(bookId, chapterNumber);
  await collectEvidence(bookId);
} catch (error) {
  issue(error);
  console.error(error);
  process.exitCode = 1;
}
