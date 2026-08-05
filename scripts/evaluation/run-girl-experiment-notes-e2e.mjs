import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API = 'http://127.0.0.1:43111';
const ORIGIN = 'http://127.0.0.1:43110';
const RELEASE_ID = 'wm-longform-r1-20260719-003435-e4d7b8b7';
const TEST_ID = 'E2E-20260805-GIRL-EXPERIMENT-NOTES';
const TITLE = '少女的实验笔记';
const ROOT = resolve('data/verification/girl-experiment-notes-e2e');
const STATE_FILE = join(ROOT, 'state.json');
const EVENT_FILE = join(ROOT, 'run-events.ndjson');
const ISSUE_FILE = join(ROOT, 'issues.md');
const FINAL_FILE = join(ROOT, 'final-evidence.json');
const MANUSCRIPT_FILE = resolve('tests/fixtures/girl-experiment-notes-20000.txt');
const MANUSCRIPT_SOURCE_NAME = '少女的实验笔记-作者已有正文-20000字.txt';
const POLL_MS = 2_000;
// Real Plan model calls are intentionally serialized and a nine-chapter reverse
// analysis can legitimately run for more than thirty minutes.  Keep the monitor
// above the worker lease/retry window so the harness does not report a false
// failure while the persisted task is still making checkpointed progress.
const TASK_TIMEOUT_MS = 90 * 60 * 1_000;

mkdirSync(ROOT, { recursive: true });
const state = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  : { testId: TEST_ID, releaseId: RELEASE_ID, createdAt: new Date().toISOString() };

let cookie = '';
let activePhase = 'startup';
const terminalFailures = new Set(['failed', 'blocked', 'cancelled', 'interrupted']);

function now() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }
function assert(condition, message) { if (!condition) throw new Error(message); }
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
  if (!cookie) await issueSession();
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
  try { payload = JSON.parse(raw); } catch {
    throw new Error(`${method} ${path} returned non-JSON ${response.status}: ${raw.slice(0, 500)}`);
  }
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
    const signatureNext = `${task.status}:${task.currentPhase}`;
    if (signature !== signatureNext) {
      log('task_progress', { purpose, taskId, status: task.status, phase: task.currentPhase });
      signature = signatureNext;
    }
    if (task.status === 'waiting_confirmation' || task.status === 'succeeded') return detail;
    if (terminalFailures.has(task.status)) {
      throw new Error(`${purpose} task ${taskId} ended as ${task.status} (${task.errorCode ?? 'no error code'}): ${JSON.stringify(detail)}`);
    }
    await sleep(POLL_MS);
  }
  throw new Error(`${purpose} task ${taskId} exceeded ${TASK_TIMEOUT_MS / 60_000} minutes`);
}

function openingBlueprint(taxonomyVersion) {
  return {
    creationMode: 'new',
    taxonomyVersion,
    channel: 'female',
    categoryKey: 'female-reality',
    targetAudience: '',
    protagonists: [
      {
        role: 'female_lead',
        name: '王怡',
        age: '17岁',
        background: '孤儿，高三学生，与奶奶住在一个小院，靠捡破烂为生',
        personalities: ['果断', '乐观', '善良有底线', '责任感强', '外冷内热', '重情重义']
      },
      {
        role: 'ensemble',
        name: '夏炎',
        age: '33岁',
        background: '破产负债，儿子自闭症，父亲早亡，女儿和前妻生活，跳河轻生。',
        personalities: ['敏锐', '温柔', '善良有底线', '嘴硬心软', '叛逆', '重情重义']
      }
    ],
    storyDirection: '王怡回家，见到家门口的越野车，得知夏炎送了车给奶奶，表明不能收，转身去找夏炎，夏炎跳河被救，王怡让夏炎去开车，而后得知自己的电动车被偷，让夏炎赔偿，两人因此结缘，王怡劝夏炎好好活下去，并且让夏炎住在自己家里，将自己的积蓄借给夏炎创业，王怡的老师得知王怡救了夏炎，要求王怡记录数据，研究边缘人格社会重建的课题，王怡慢慢爱上了夏炎。两人双向救赎，最终走在一起。',
    worldBackground: '',
    openingBackground: '',
    stageOne: { start: '', development: '', end: '' },
    fullBookOutline: '',
    mainTags: ['女性成长', '脑洞', '成长', '群像', '生存', '爽文', '爽感', '感情细腻', '暗黑', '互联网', '美食', '创业', '都市逆袭', '身份反差', '校园', '双向救赎', '年龄差', '甜虐交织'],
    auxiliaryTags: ['青春校园', '商业经营', '现实题材', '成功励志', '现言脑洞', '悬疑恋爱'],
    storyTraits: [],
    customTags: [],
    initialMap: '',
    mustFollow: ['不降智', '不圣母', '不使用系统金手指', '不写未成年人恋爱', '不写现实政治映射', '不写宗教神秘化', '不写真实人物影射', '不写烂尾式跳时', '不写梦境式翻盘', '不写主角团灭']
  };
}

async function ensureUniqueBook() {
  activePhase = 'create-book';
  const books = await request('/api/v1/books');
  const exact = books.filter((book) => book.title === TITLE);
  assert(exact.length <= 1, `检测到 ${exact.length} 本同名书，停止测试，禁止继续制造重复数据`);
  if (exact.length === 1) {
    save({ bookId: exact[0].bookId, title: TITLE, reusedExistingBook: true });
    log('book_reused', { bookId: exact[0].bookId, title: TITLE });
    return exact[0].bookId;
  }
  const taxonomy = await request('/api/v1/opening-taxonomy');
  const blueprint = openingBlueprint(taxonomy.version);
  const draft = await request('/api/v1/books/drafts', {
    method: 'POST',
    body: { title: TITLE, text: blueprint.storyDirection, openingBlueprint: blueprint }
  });
  const created = await request(`/api/v1/book-drafts/${draft.draftId}/confirm`, {
    method: 'POST',
    body: { expectedVersion: draft.version }
  });
  assert(created.agentCount === 11, `expected 11 agents, got ${created.agentCount}`);
  save({ bookId: created.bookId, title: TITLE, kickoffTaskId: created.kickoffTaskId, reusedExistingBook: false });
  log('book_created', { bookId: created.bookId, title: TITLE, kickoffTaskId: created.kickoffTaskId });
  if (created.kickoffTaskId) await waitForTask(created.bookId, created.kickoffTaskId, 'opening-reception');
  return created.bookId;
}

async function importAndAnalyzeExistingManuscript(bookId) {
  activePhase = 'existing-manuscript-import';
  const manuscript = readFileSync(MANUSCRIPT_FILE, 'utf8').replace(/\r\n/g, '\n').trim();
  const chapterHeadings = manuscript.match(/^第[一二三四五六七八九十百零〇0-9]+章(?:\s+.+)?$/gm) ?? [];
  assert(manuscript.length >= 18_000 && manuscript.length <= 22_000,
    `fixture must stay near 20k characters; got ${manuscript.length}`);
  assert(chapterHeadings.length === 9, `fixture must contain exactly 9 chapters; got ${chapterHeadings.length}`);

  let continuation = await request(`/api/v1/books/${bookId}/continuation-imports/latest`);
  if (continuation === null) {
    const chaptersBefore = await request(`/api/v1/books/${bookId}/chapters`);
    assert(chaptersBefore.length === 0,
      `refusing whole-manuscript import because target book already has ${chaptersBefore.length} chapters`);
    continuation = await request(`/api/v1/books/${bookId}/continuation-imports/preview`, {
      method: 'POST',
      body: { sourceName: MANUSCRIPT_SOURCE_NAME, text: manuscript }
    });
    log('continuation_previewed', {
      importId: continuation.importId,
      sourceCharacterCount: continuation.sourceCharacterCount,
      detectedChapterCount: continuation.chapters.length,
      warnings: continuation.warnings
    });
  } else {
    assert(continuation.sourceName === MANUSCRIPT_SOURCE_NAME,
      `a different continuation import already exists: ${continuation.sourceName}`);
    log('continuation_reused', { importId: continuation.importId, status: continuation.status });
  }

  assert(continuation.chapters.length === 9,
    `parser must detect 9 chapters; got ${continuation.chapters.length}`);
  save({ continuationImportId: continuation.importId, manuscriptCharacterCount: manuscript.length });

  if (continuation.status !== 'ready') {
    continuation = await request(
      `/api/v1/books/${bookId}/continuation-imports/${continuation.importId}/confirm`,
      {
        method: 'POST',
        body: {
          chapters: continuation.chapters.map((chapter) => ({
            importChapterId: chapter.importChapterId,
            title: chapter.title,
            included: true
          }))
        }
      }
    );
    log('continuation_confirmed', {
      importId: continuation.importId,
      status: continuation.status,
      importedChapterCount: continuation.importedChapterCount,
      analysisTaskId: continuation.analysis.activeTaskId
    });
  }
  assert(continuation.status === 'ready', `continuation import is ${continuation.status}, expected ready`);
  assert(continuation.importedChapterCount === 9,
    `expected 9 imported chapters, got ${continuation.importedChapterCount}`);

  if (continuation.analysis.status !== 'ready' && continuation.analysis.activeTaskId === null) {
    continuation = await request(
      `/api/v1/books/${bookId}/continuation-imports/${continuation.importId}/analyze`,
      { method: 'POST', body: {} }
    );
  }
  if (continuation.analysis.activeTaskId !== null) {
    save({ continuationAnalysisTaskId: continuation.analysis.activeTaskId });
    await waitForTask(bookId, continuation.analysis.activeTaskId, 'continuation-analysis');
  }

  const deadline = Date.now() + TASK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    continuation = await request(
      `/api/v1/books/${bookId}/continuation-imports/${continuation.importId}`
    );
    if (continuation.analysis.status === 'ready') break;
    if (continuation.analysis.status === 'failed') {
      throw new Error(`continuation analysis failed: ${continuation.analysis.errorMessage ?? 'unknown error'}`);
    }
    await sleep(POLL_MS);
  }
  assert(continuation.analysis.status === 'ready',
    `continuation analysis did not become ready; got ${continuation.analysis.status}`);
  assert(continuation.analysis.analyzedChapterCount === 9,
    `expected 9 analyzed chapters, got ${continuation.analysis.analyzedChapterCount}`);
  const structured = continuation.analysis.structuredData ?? {};
  const summaries = Array.isArray(structured.chapterSummaries) ? structured.chapterSummaries : [];
  const outlines = Array.isArray(structured.chapterOutlines) ? structured.chapterOutlines : [];
  assert(summaries.length === 9, `expected 9 chapter summaries, got ${summaries.length}`);
  assert(outlines.length === 9, `expected 9 reverse chapter outlines, got ${outlines.length}`);
  for (const outline of outlines) {
    assert(typeof outline.chapterGoal === 'string' && outline.chapterGoal.trim().length > 0,
      `chapter ${outline.chapterNumber ?? '?'} has no reverse-outline goal`);
    assert(Array.isArray(outline.plotBeats) && outline.plotBeats.length > 0,
      `chapter ${outline.chapterNumber ?? '?'} has no plot beats`);
    assert(Array.isArray(outline.cast), `chapter ${outline.chapterNumber ?? '?'} has no cast list`);
  }

  const chaptersAfter = await request(`/api/v1/books/${bookId}/chapters`);
  assert(chaptersAfter.length === 9, `front-end chapter source must expose 9 chapters; got ${chaptersAfter.length}`);
  save({
    continuationReadyAt: now(),
    importedChapterCount: 9,
    analyzedChapterCount: 9,
    reverseOutlineCount: outlines.length,
    chapterSummaryCount: summaries.length
  });
  log('continuation_analysis_verified', {
    importId: continuation.importId,
    sourceCharacterCount: continuation.sourceCharacterCount,
    analyzedChapterCount: continuation.analysis.analyzedChapterCount,
    reverseOutlineCount: outlines.length
  });
  return continuation;
}

async function verifySettingProposalAndConfirmation(bookId) {
  activePhase = 'setting-proposal-confirmation';
  const targetKey = 'creative-concept';
  let workspace = await request(`/api/v1/books/${bookId}/setting-outline-workspace`);
  let target = workspace.find((item) => item.itemKey === targetKey);
  assert(target, `setting workspace has no ${targetKey} item`);

  if (target.status === '待讨论') {
    const entry = await request(`/api/v1/books/${bookId}/conversation-entry`, {
      method: 'POST',
      body: {}
    });
    assert(entry.settingItemKey === targetKey,
      `conversation entry routed to ${entry.settingItemKey ?? 'unknown'}, expected ${targetKey}`);
    if (typeof entry.taskId === 'string') {
      await waitForTask(bookId, entry.taskId, 'setting-independent-proposals');
    }
    workspace = await request(`/api/v1/books/${bookId}/setting-outline-workspace`);
    target = workspace.find((item) => item.itemKey === targetKey);
  }

  const messages = await request(`/api/v1/books/${bookId}/messages?limit=500`);
  const proposals = messages.filter((message) => message.message_type === 'setting_proposal');
  log('setting_proposal_records_observed', {
    count: proposals.length,
    records: proposals.slice(-6).map((proposal) => ({
      senderRole: proposal.sender_role,
      senderAgentId: proposal.sender_agent_id,
      modelId: proposal.model_id,
      keys: Object.keys(proposal).sort()
    }))
  });
  const latestByRole = new Map();
  for (const proposal of proposals) latestByRole.set(proposal.role_key, proposal);
  const expectedRoles = ['chief_editor', 'lead_screenwriter', 'second_screenwriter'];
  for (const role of expectedRoles) {
    assert(latestByRole.has(role), `missing independent setting proposal from ${role}`);
  }
  const latestProposals = expectedRoles.map((role) => latestByRole.get(role));
  assert(new Set(latestProposals.map((proposal) => proposal.sender_agent_id)).size === 3,
    'setting proposals did not come from three different agents');
  assert(new Set(latestProposals.map((proposal) => proposal.model_id)).size === 3,
    'setting proposals did not use three different models');
  for (const proposal of latestProposals) {
    assert(typeof proposal.content === 'string' && proposal.content.trim().length >= 40,
      `proposal from ${proposal.role_key} is empty or too short`);
  }
  log('setting_three_proposals_verified', {
    itemKey: targetKey,
    proposals: latestProposals.map((proposal) => ({
      role: proposal.role_key,
      agentId: proposal.sender_agent_id,
      modelId: proposal.model_id,
      characterCount: proposal.content.length
    }))
  });

  if (target?.status === '讨论中') {
    const selection = await request(`/api/v1/books/${bookId}/messages`, {
      method: 'POST',
      body: {
        content: '选择主编方案为主，融合第二位编剧关于“废墟上重建生存意志”的表达。保留现实约束、人物自主性和可验证因果，不把未成年人写成成年人的情感附属。请主编整理成一份简洁候选，等待我确认。',
        attachmentIds: []
      }
    });
    assert(typeof selection.action?.taskId === 'string',
      `setting selection did not schedule editor synthesis: ${JSON.stringify(selection)}`);
    await waitForTask(bookId, selection.action.taskId, 'setting-editor-synthesis');
    workspace = await request(`/api/v1/books/${bookId}/setting-outline-workspace`);
    target = workspace.find((item) => item.itemKey === targetKey);
  }

  if (target?.status === '候选待确认') {
    assert(typeof target.content === 'string' && target.content.trim().length >= 30,
      'setting candidate has no usable content');
    const confirmation = await request(`/api/v1/books/${bookId}/messages`, {
      method: 'POST',
      body: { content: '确认', attachmentIds: [] }
    });
    if (typeof confirmation.action?.taskId === 'string') {
      await waitForTask(bookId, confirmation.action.taskId, 'next-setting-proposals');
    }
    workspace = await request(`/api/v1/books/${bookId}/setting-outline-workspace`);
    target = workspace.find((item) => item.itemKey === targetKey);
  }

  assert(target?.status === '已确认',
    `${targetKey} must be confirmed after author confirmation; got ${target?.status ?? 'missing'}`);
  assert(typeof target.content === 'string' && target.content.trim().length >= 30,
    'confirmed setting item has no displayable content');
  const nextItem = workspace.find((item) => item.status === '讨论中');
  assert(nextItem && nextItem.itemKey !== targetKey,
    'workflow did not advance from the confirmed setting item');
  save({
    settingPanelVerifiedAt: now(),
    confirmedSettingItemKey: targetKey,
    nextSettingItemKey: nextItem.itemKey,
    settingProposalModels: latestProposals.map((proposal) => proposal.model_id)
  });
  log('setting_confirmation_and_advance_verified', {
    itemKey: targetKey,
    nextItemKey: nextItem.itemKey,
    nextItemStatus: nextItem.status
  });
  return { target, nextItem, latestProposals };
}

async function main() {
  const bookId = await ensureUniqueBook();
  const book = await request(`/api/v1/books/${bookId}`);
  const agents = await request(`/api/v1/books/${bookId}/agents`);
  assert(book.title === TITLE, 'created book title mismatch');
  assert(agents.length === 11, `expected 11 persisted agents, got ${agents.length}`);
  save({ createVerifiedAt: now(), stoppedAtPhase: null, lastError: null });
  log('create_verified', { bookId, agentCount: agents.length });
  const continuation = await importAndAnalyzeExistingManuscript(bookId);
  const settingEvidence = await verifySettingProposalAndConfirmation(bookId);
  writeFileSync(FINAL_FILE, `${JSON.stringify({
    status: 'continuation-and-setting-flow-verified',
    at: now(),
    bookId,
    title: TITLE,
    importId: continuation.importId,
    importedChapterCount: continuation.importedChapterCount,
    analyzedChapterCount: continuation.analysis.analyzedChapterCount,
    confirmedSettingItemKey: settingEvidence.target.itemKey,
    nextSettingItemKey: settingEvidence.nextItem.itemKey,
    settingProposalModels: settingEvidence.latestProposals.map((proposal) => proposal.model_id)
  }, null, 2)}\n`, 'utf8');
}

main().catch((error) => {
  issue(error);
  console.error(error);
  process.exitCode = 1;
});
