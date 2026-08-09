import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API = 'http://127.0.0.1:43111';
const ORIGIN = 'http://127.0.0.1:43110';
const RELEASE_ID = 'wm-longform-r1-20260719-003435-e4d7b8b7';
const RUN_KEY = String(process.argv[2] ?? 'nightly-v2').trim().replace(/[^a-zA-Z0-9_-]/g, '-');
const TEST_ID = `E2E-CURRENT-WORKFLOW-10-${RUN_KEY.toUpperCase()}`;
const POLL_MS = 2_000;
const TASK_TIMEOUT_MS = 30 * 60 * 1_000;
const TEST_TOKEN_LIMIT = 5_000_000;
const ROOT = resolve(`data/verification/current-workflow-ten-chapters-${RUN_KEY}`);
const STATE_FILE = join(ROOT, 'state.json');
const EVENT_FILE = join(ROOT, 'run-events.ndjson');
const ISSUE_FILE = join(ROOT, 'issues.md');
const FINAL_FILE = join(ROOT, 'final-evidence.json');

mkdirSync(ROOT, { recursive: true });

const state = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  : {
      testId: TEST_ID,
      releaseId: RELEASE_ID,
      createdAt: new Date().toISOString(),
      settledChapters: [],
      taskEvidence: []
    };

let cookie = '';
let activePhase = 'startup';
const terminalFailures = new Set(['failed', 'blocked', 'cancelled', 'interrupted']);
const noneTemplate = (scope) => ({
  selectionMode: 'none', templateKey: null, templateVersion: null, templateHash: null,
  scope, beats: [], customDirection: null
});

function now() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }
function key(label) { return `${TEST_ID}:${label}`; }
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
function assert(condition, message) { if (!condition) throw new Error(message); }

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
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (response.status === 401) {
    await issueSession();
    headers.cookie = cookie;
    response = await fetch(`${API}${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
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

function modelCallSummary(call) {
  return {
    modelCallId: call.model_call_id ?? call.modelCallId ?? null,
    agentId: call.agent_id ?? call.agentId ?? null,
    roleKey: call.role_key ?? call.roleKey ?? null,
    provider: call.provider ?? null,
    modelId: call.model_id ?? call.modelId ?? null,
    state: call.state ?? null,
    purpose: call.purpose ?? null,
    inputTokens: call.input_tokens ?? call.inputTokens ?? null,
    outputTokens: call.output_tokens ?? call.outputTokens ?? null
  };
}

function recordTask(purpose, detail) {
  const record = {
    purpose,
    taskId: detail.task.taskId,
    taskType: detail.task.taskType,
    status: detail.task.status,
    currentPhase: detail.task.currentPhase,
    modelCalls: (detail.modelCalls ?? []).map(modelCallSummary),
    contextPackCount: Array.isArray(detail.contextPacks) ? detail.contextPacks.length : null,
    completedAt: now()
  };
  const taskEvidence = [...(state.taskEvidence ?? []).filter((item) => item.taskId !== record.taskId), record];
  save({ taskEvidence });
  return record;
}

async function waitForTask(bookId, taskId, purpose) {
  const startedAt = Date.now();
  let signature = '';
  while (Date.now() - startedAt < TASK_TIMEOUT_MS) {
    const detail = await request(`/api/v1/books/${bookId}/tasks/${taskId}`);
    const task = detail.task;
    const working = (detail.modelCalls ?? [])
      .filter((call) => call.state === 'working')
      .map((call) => `${call.provider}/${call.model_id ?? call.modelId}`);
    const nextSignature = `${task.status}:${task.currentPhase}:${working.join(',')}`;
    if (nextSignature !== signature) {
      log('task_progress', { purpose, taskId, status: task.status, phase: task.currentPhase, workingModels: working });
      signature = nextSignature;
    }
    if (task.status === 'waiting_confirmation' || task.status === 'succeeded') {
      recordTask(purpose, detail);
      return detail;
    }
    if (terminalFailures.has(task.status)) {
      recordTask(purpose, detail);
      throw new Error(`${purpose} task ${taskId} ended as ${task.status} (${task.errorCode ?? 'no error code'})`);
    }
    await sleep(POLL_MS);
  }
  throw new Error(`${purpose} task ${taskId} exceeded ${TASK_TIMEOUT_MS / 60_000} minutes`);
}

function blueprint(taxonomyVersion) {
  return {
    creationMode: 'new', taxonomyVersion, channel: 'female', categoryKey: 'female-suspense',
    targetAudience: '喜欢公平推理、现实质感与女性成长的成年读者',
    protagonists: [{
      role: 'female_lead', name: '林澄', age: '二十八岁',
      background: '雾江市失物招领中心档案员，曾是调查记者；三年前因一篇证据不足的报道伤害无辜，主动离开新闻行业。',
      personalities: ['冷静', '敏锐', '克制', '责任感强']
    }],
    storyDirection: '雨夜里，林澄收到一件系统中不存在的失物，归还单的时间却写着明天。她从一张被篡改的流转记录入手，追查邻居陈月失踪与旧城拆迁档案造假的关系；第一卷用一个连续十章事件完整解决“明日归还单”，同时留下更大利益网络的可靠线索。',
    worldBackground: '当代架空沿海城市雾江，制度与技术遵循现实边界。',
    openingBackground: '梅雨夜，失物招领中心即将闭馆，一只无人登记的旧帆布包被送到林澄面前。',
    stageOne: {
      start: '林澄发现归还单日期来自明天，且包主人陈月已经失联。',
      development: '她与系统维护工程师罗知沿纸质交接、设备时钟和权限日志三线核查，并为错误推断付出证人失信的代价。',
      end: '林澄合法保全证据、找到陈月并揭露补偿档案造假，发现幕后还有更大网络。'
    },
    fullBookOutline: '每卷围绕一件 ordinary 失物形成完整现实谜案，逐步推进林澄修复职业创伤、重建公众信任并追查旧城利益网络。',
    mainTags: ['悬疑', '推理', '女性成长', '群像', '现实'],
    auxiliaryTags: ['职场成长', '探案'], storyTraits: ['成长', '慢热', '正剧'],
    styleIntent: {
      languageTones: ['克制', '准确', '有生活质感'], emotionalTones: ['悬疑', '温暖底色'],
      pacingAndPayoff: ['线索递进', '章末有有效问题'], atmospheres: ['潮湿旧城', '现实压迫感'],
      custom: ['不用故作高深的短句堆砌']
    },
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
    'creative-concept': '策划理念确定为“失物会说话，但只靠现实证据说话”：每卷围绕一件普通失物展开，物件磨损、流转记录和持有人选择共同构成线索。作品用林澄修复一次错误报道造成的职业创伤为长期人物线，悬疑依靠公平证据，不靠超自然或巧合。',
    'reader-promise': '读者持续获得三种稳定体验：可以参与推理的公平线索；普通城市生活中被忽略之人的真实处境；林澄凭耐心和专业能力纠错后带来的克制爽感。每卷解决一件完整事件，同时推进她重建职业信任与核心关系。',
    era: '故事发生在当代架空沿海城市雾江，技术和制度与现实中国城市相近。失物招领中心接入公交、商场和社区的统一登记系统，但数据可被有权限的人修改，任何查询、调阅和取证都留下日志并受现实程序限制。',
    protagonist: '林澄，二十八岁，雾江市失物招领中心档案员，前调查记者。她擅长核对时间线、识别叙述矛盾和从物件使用痕迹还原行为，却因三年前证据不足的报道伤害过无辜者，失去记者身份和对直觉的信任。开篇资源有限，只有合法档案权限、旧同事关系和扎实调查能力。',
    motivation: '林澄表层目标是找到失物主人并解释异常归还单，深层愿望是证明严谨求证仍能保护人。她害怕再次因急于揭露而伤害无辜；底线是不伪造证据、不非法侵入系统、不把弱者当诱饵，也不会为了个人翻身抢先公布未经核实的结论。',
    'must-follow': '必须遵守现实逻辑、公平线索、程序取证和人物因选择承担后果。禁止超自然解释、万能黑客、巧合破案、反派长篇自白、主角无代价越权。未知的局部场景保留为后续创作空间，不把软偏好升级为硬事实。',
    'relationship-premise': '林澄与市政系统维护工程师罗知因同一份异常流转日志被迫合作。林澄擅长人和叙事，罗知擅长系统边界与证据保全；两人都重视事实但对公开真相的时机看法不同。吸引力来自能力互补、共同守住无辜者以及逐步建立的可靠感。',
    'relationship-obstacle': '关系阻力不是误会，而是价值与责任冲突：林澄曾因过早公开伤人，因此过度克制；罗知受保密与职业责任约束，不能把内部数据随意交给她。双方只有在合法协作、承担风险和兑现承诺中建立信任，不能靠一次坦白速解。',
    'case-rules': '案件必须满足现实可执行性：异常归还单源于权限滥用和离线补录，不预知未来；作案者只能修改其权限范围内的记录，无法抹除纸质交接单、设备时钟差、门禁、物件磨损和第三方见证。每个结论至少由两类相互独立的证据支持。',
    'evidence-chain': '证据分为原物痕迹、纸质交接、系统日志、门禁影像和证人陈述。数字记录先做哈希与只读副本，纸质材料记录取得来源，证词必须与客观时间线互证。污染、转手和权限修改都要标注；未经验证的信息只能作为线索，不能直接定罪。',
    'truth-layers': '第一层让读者与林澄同时发现归还时间异常；第二层通过公交卡磨损、补录账号和设备时钟差揭示有人伪造流转；第三层说明伪造是为掩盖陈月掌握的拆迁补偿档案。关键物证在真相揭示前出现，误导来自合理解释差异，不隐瞒视角人物已经知道的事实。'
  };
  const base = answers[item.itemKey]
    ?? `关于“${item.label}”，本书采用现实、可验证且可持续扩展的设定：${item.prompt}。边界服从林澄的调查能力、雾江市现实制度和公平线索原则；只确定运行规则，不提前锁死具体剧情结果。`;
  return attempt === 1 ? base : `${base}\n补充确认：采用最符合现实程序、公平线索和人物主动性的明确方案；未知细节保留为后续创作空间，不再把同一问题留作待确认。`;
}

async function createBook() {
  if (state.bookId) return state.bookId;
  activePhase = 'create-book';
  const taxonomy = await request('/api/v1/opening-taxonomy');
  const openingBlueprint = blueprint(taxonomy.version);
  const title = `雨夜失物招领处·新版全流程-${RUN_KEY}`;
  const draft = await request('/api/v1/books/drafts', {
    method: 'POST', body: { title, text: openingBlueprint.storyDirection, openingBlueprint }
  });
  const created = await request(`/api/v1/book-drafts/${draft.draftId}/confirm`, {
    method: 'POST', body: { expectedVersion: draft.version }
  });
  assert(created.agentCount === 11, `expected 11 creative agents, got ${created.agentCount}`);
  save({ bookId: created.bookId, title, kickoffTaskId: created.kickoffTaskId, agentCount: created.agentCount });
  log('book_created', { bookId: created.bookId, title, kickoffTaskId: created.kickoffTaskId, agentCount: created.agentCount });
  if (created.kickoffTaskId) await waitForTask(created.bookId, created.kickoffTaskId, 'opening-reception');
  return created.bookId;
}

async function ensureTestBudget(bookId) {
  activePhase = 'test-budget';
  const budgets = await request(`/api/v1/books/${bookId}/budgets`);
  const active = budgets.find((budget) => budget.status === 'active') ?? budgets[0];
  assert(active, 'new book did not create a budget');
  if (active.token_limit >= TEST_TOKEN_LIMIT) return;
  const revised = await request(`/api/v1/books/${bookId}/budgets/${active.budget_id}`, {
    method: 'PATCH', body: { expectedTokenLimit: active.token_limit, tokenLimit: TEST_TOKEN_LIMIT }
  });
  assert(revised.cashLimitMicros === 0, 'test must not enable cash fallback');
  log('test_budget_revised', { budgetId: active.budget_id, tokenLimit: revised.tokenLimit, cashLimitMicros: revised.cashLimitMicros });
}

async function completeSettings(bookId) {
  if (state.settingsCompleted) return;
  activePhase = 'setting-outline';
  const attempts = new Map();
  for (let guard = 0; guard < 50; guard += 1) {
    const workflow = await request(`/api/v1/books/${bookId}/workflow`);
    if (!['book_profile_draft', 'book_profile_confirmed', 'setting_in_progress'].includes(workflow.stage)) {
      save({ settingsCompleted: true, workflowAfterSettings: workflow });
      log('settings_ready', { stage: workflow.stage, planningVersion: workflow.planningVersion });
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
        await waitForTask(bookId, confirmed.action.taskId, `setting-next-${confirmed.action.settingItemKey ?? 'item'}`);
      }
      continue;
    }
    const current = items.find((item) => ['讨论中', '待讨论'].includes(item.status));
    assert(current, `workflow stage ${workflow.stage} has no current setting item`);
    const attempt = (attempts.get(current.itemKey) ?? 0) + 1;
    attempts.set(current.itemKey, attempt);
    assert(attempt <= 3, `${current.itemKey} requested more than three author follow-ups`);
    const sent = await request(`/api/v1/books/${bookId}/messages`, {
      method: 'POST', body: { content: answerFor(current, attempt), attachmentIds: [] }
    });
    assert(typeof sent.action?.taskId === 'string', `setting answer did not schedule task: ${JSON.stringify(sent)}`);
    log('setting_answered', { itemKey: current.itemKey, label: current.label, attempt, taskId: sent.action.taskId });
    await waitForTask(bookId, sent.action.taskId, `setting-${current.itemKey}`);
  }
  throw new Error('setting outline loop exceeded 50 iterations');
}

async function createIdea(bookId, input) {
  const created = await request(`/api/v1/books/${bookId}/author-planning-inputs`, {
    method: 'POST', body: {
      intentStrength: 'must', attachmentRefs: [], mentionedAgentIds: [], scopeNotes: null,
      idempotencyKey: key(input.idempotencyLabel), ...input
    }
  });
  log('author_idea_saved', {
    authorInputId: created.authorInputId, surface: created.surface, subjectType: created.subjectType,
    subjectId: created.subjectId, intentStrength: created.intentStrength
  });
  return created;
}

function forceSingleTenChapterEvent(content) {
  const first = content.eventSequence[0];
  assert(first, 'generated volume plan has no event');
  return {
    ...content,
    eventSequence: [{
      ...first, order: 1, title: '明日归还单',
      responsibility: '用十章完成异常归还单、陈月失踪和补偿档案造假的发现、调查、受挫、反击与闭环。',
      leadsToNext: null, estimatedChapterRange: { minimum: 10, likely: 10, maximum: 10 }
    }]
  };
}

async function planVolume(bookId) {
  activePhase = 'volume-plan';
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  let plans = await request(`/api/v1/books/${bookId}/volume-plans`);
  let plan = plans.find((item) => item.volumePlanId === state.volumePlanId) ?? plans.at(-1) ?? null;
  if (plan === null) {
    plan = await request(`/api/v1/books/${bookId}/volume-plans`, {
      method: 'POST', body: {
        expectedWorkflowVersion: workflow.planningVersion, planNumber: 1,
        idempotencyKey: key('volume-plan-1')
      }
    });
    save({ volumePlanId: plan.volumePlanId });
    log('volume_plan_created', { volumePlanId: plan.volumePlanId, revision: plan.revision });
  }
  if (plan.activeVersionId !== null) return plan;
  let ideaId = state.volumeIdeaId;
  if (!ideaId) {
    const idea = await createIdea(bookId, {
      surface: 'volume_plan', subjectType: 'volume_plan', subjectId: plan.volumePlanId,
      originalText: '第一卷是短卷验收：只设置一个名为“明日归还单”的完整事件，精确覆盖第1至第10章。十章内要有发现、取证、错误推断的代价、修正、合法证据闭环、找到陈月并揭露补偿档案造假；卷末留出更大利益网络，但本事件本卷必须完整收束。具体场景和人物临场反应保留给后续编剧与主笔。',
      idempotencyLabel: 'volume-idea'
    });
    ideaId = idea.authorInputId;
    save({ volumeIdeaId: ideaId });
  }
  if (!state.volumeGenerationTaskId) {
    workflow = await request(`/api/v1/books/${bookId}/workflow`);
    plans = await request(`/api/v1/books/${bookId}/volume-plans`);
    plan = plans.find((item) => item.volumePlanId === plan.volumePlanId);
    const generation = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/generate`, {
      method: 'POST', body: {
        expectedPlanRevision: plan.revision, expectedActiveVersionId: plan.activeVersionId,
        expectedWorkflowVersion: workflow.planningVersion, template: noneTemplate('volume'),
        authorInputRefs: [ideaId], idempotencyKey: key('volume-generate')
      }
    });
    save({ volumeGenerationTaskId: generation.taskId });
    log('volume_generation_started', { taskId: generation.taskId, members: generation.members });
  }
  await waitForTask(bookId, state.volumeGenerationTaskId, 'volume-two-writers-and-editor');
  let versions = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/versions`);
  const candidates = ['candidate_a', 'candidate_b', 'fusion'].map((kind) => versions.find((item) => item.candidateKind === kind));
  assert(candidates.every(Boolean), 'volume generation did not create A, B and fusion candidates');
  const sources = candidates.slice(0, 2).map((item) => `${item.sourceTaskId}:${item.contentHash}`);
  assert(new Set(sources).size === 2, 'volume A and B candidates are not independently traceable');
  let selected = versions.filter((item) => item.candidateKind === 'author_edit').at(-1)
    ?? versions.filter((item) => item.candidateKind === 'fusion').at(-1);
  assert(selected, 'volume fusion candidate missing');
  if (selected.content.eventSequence.length !== 1
    || selected.content.eventSequence[0]?.estimatedChapterRange?.likely !== 10) {
    plans = await request(`/api/v1/books/${bookId}/volume-plans`);
    plan = plans.find((item) => item.volumePlanId === plan.volumePlanId);
    selected = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/versions`, {
      method: 'POST', body: {
        expectedPlanRevision: plan.revision, candidateKind: 'author_edit',
        parentVersionId: selected.volumePlanVersionId, sourceTaskId: state.volumeGenerationTaskId,
        authorInputRefs: [ideaId], template: noneTemplate('volume'),
        content: forceSingleTenChapterEvent(selected.content), idempotencyKey: key('volume-author-final')
      }
    });
    log('volume_author_adjustment_saved', { volumePlanVersionId: selected.volumePlanVersionId, reason: 'single-event-ten-chapter-test-scope' });
  }
  await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/impact-preview`, {
    method: 'POST', body: { volumePlanVersionId: selected.volumePlanVersionId }
  });
  plans = await request(`/api/v1/books/${bookId}/volume-plans`);
  plan = plans.find((item) => item.volumePlanId === plan.volumePlanId);
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  const confirmed = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/confirm`, {
    method: 'POST', body: {
      volumePlanVersionId: selected.volumePlanVersionId, expectedPlanRevision: plan.revision,
      expectedActiveVersionId: plan.activeVersionId, expectedWorkflowVersion: workflow.planningVersion
    }
  });
  assert(confirmed.activeVersion?.content.eventSequence.length === 1, 'confirmed volume does not contain exactly one event');
  save({ volumePlanId: confirmed.volumePlanId, volumePlanVersionId: confirmed.activeVersionId });
  log('volume_plan_confirmed', { volumePlanId: confirmed.volumePlanId, versionId: confirmed.activeVersionId, title: confirmed.activeVersion.content.title });
  return confirmed;
}

async function planEvent(bookId, volumePlan) {
  activePhase = 'story-event';
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  let sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`);
  if (sequence === null) {
    sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence/initialize`, {
      method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion, idempotencyKey: key('event-sequence') }
    });
    log('event_sequence_initialized', { revision: sequence.revision, eventCount: sequence.events.length });
  }
  assert(sequence.events.length === 1, `expected one event from confirmed volume, got ${sequence.events.length}`);
  let event = sequence.events[0];
  save({ eventId: event.eventId });
  if (event.activeVersionId !== null) return event;
  let ideaId = state.eventIdeaId;
  if (!ideaId) {
    const idea = await createIdea(bookId, {
      surface: 'event', subjectType: 'story_event', subjectId: event.eventId,
      originalText: '这个事件精确写十章。不要靠万能技术或巧合：异常日期源于离线补录与权限滥用；第4至6章让林澄因错误推断失去证人信任并主动修正；第10章必须合法保全两类以上独立证据、找到陈月、解决明日归还单并揭露补偿档案造假。人物关系只推进信任，不喧宾夺主。',
      idempotencyLabel: 'event-idea'
    });
    ideaId = idea.authorInputId;
    save({ eventIdeaId: ideaId });
  }
  if (!state.eventGenerationTaskId) {
    workflow = await request(`/api/v1/books/${bookId}/workflow`);
    sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`);
    event = sequence.events[0];
    const generation = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/generate`, {
      method: 'POST', body: {
        expectedEventRevision: event.revision, expectedActiveVersionId: event.activeVersionId,
        expectedWorkflowVersion: workflow.planningVersion, template: noneTemplate('event'),
        authorInputRefs: [ideaId], idempotencyKey: key('event-generate')
      }
    });
    save({ eventGenerationTaskId: generation.taskId });
    log('event_generation_started', { taskId: generation.taskId, members: generation.members });
  }
  await waitForTask(bookId, state.eventGenerationTaskId, 'event-two-writers-and-editor');
  let versions = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/versions`);
  assert(['candidate_a', 'candidate_b', 'fusion'].every((kind) => versions.some((item) => item.candidateKind === kind)),
    'event generation did not create A, B and fusion candidates');
  let selected = versions.filter((item) => item.candidateKind === 'author_edit').at(-1)
    ?? versions.filter((item) => item.candidateKind === 'fusion').at(-1);
  assert(selected, 'event fusion candidate missing');
  if (selected.content.estimatedChapterRange?.likely !== 10) {
    sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`);
    event = sequence.events[0];
    selected = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/versions`, {
      method: 'POST', body: {
        expectedEventRevision: event.revision, candidateKind: 'author_edit',
        parentVersionId: selected.storyEventVersionId, sourceTaskId: state.eventGenerationTaskId,
        authorInputRefs: [ideaId], template: noneTemplate('event'),
        content: { ...selected.content, estimatedChapterRange: { minimum: 10, likely: 10, maximum: 10 } },
        idempotencyKey: key('event-author-final')
      }
    });
    log('event_author_adjustment_saved', { storyEventVersionId: selected.storyEventVersionId, reason: 'ten-chapter-test-scope' });
  }
  await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/impact-preview`, {
    method: 'POST', body: { versionId: selected.storyEventVersionId }
  });
  sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`);
  event = sequence.events[0];
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  const confirmed = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/confirm`, {
    method: 'POST', body: {
      versionId: selected.storyEventVersionId, expectedEventRevision: event.revision,
      expectedWorkflowVersion: workflow.planningVersion
    }
  });
  save({ eventVersionId: confirmed.activeVersionId });
  log('story_event_confirmed', { eventId: confirmed.eventId, versionId: confirmed.activeVersionId, title: confirmed.activeVersion.content.title });
  return confirmed;
}

async function planChapterSequence(bookId, event) {
  activePhase = 'event-chapter-sequence';
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  let sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
  if (sequence === null) {
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/initialize`, {
      method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion, idempotencyKey: key('chapter-sequence-init') }
    });
    log('chapter_sequence_initialized', { sequenceId: sequence.sequenceId, revision: sequence.revision });
  }
  if (sequence.activeVersionId !== null) {
    assert(sequence.outlines.length === 10, `active chapter sequence has ${sequence.outlines.length} chapters, expected 10`);
    return sequence;
  }
  let ideaId = state.chapterSequenceIdeaId;
  if (!ideaId) {
    const idea = await createIdea(bookId, {
      surface: 'chapter_outline', subjectType: 'event_chapter_sequence', subjectId: event.eventId,
      originalText: '请把这个单一事件拆成精确10章，章号连续为1—10。每章只有一个清晰责任；相邻章开头、结尾状态必须衔接；第4—6章承担错误推断、证人失信和主动修正；第10章覆盖事件全部结束条件并留下下一卷入口。不要提前写正文。',
      idempotencyLabel: 'chapter-sequence-idea'
    });
    ideaId = idea.authorInputId;
    save({ chapterSequenceIdeaId: ideaId });
  }
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
    workflow = await request(`/api/v1/books/${bookId}/workflow`);
    let taskId = state.chapterSequenceTaskIds?.[attempt];
    if (!taskId) {
      const generation = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/generate`, {
        method: 'POST', body: {
          expectedSequenceRevision: sequence.revision, expectedWorkflowVersion: workflow.planningVersion,
          authorInputRefs: [ideaId], idempotencyKey: key(`chapter-sequence-generate-${attempt}`)
        }
      });
      taskId = generation.taskId;
      save({ chapterSequenceTaskIds: { ...(state.chapterSequenceTaskIds ?? {}), [attempt]: taskId } });
      log('chapter_sequence_generation_started', { attempt, taskId, member: generation.member });
    }
    await waitForTask(bookId, taskId, `chapter-sequence-attempt-${attempt}`);
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
    const candidate = sequence.versions.filter((item) => item.status === 'candidate')
      .sort((left, right) => right.version - left.version)[0];
    assert(candidate, `chapter sequence attempt ${attempt} produced no candidate`);
    log('chapter_sequence_candidate', { attempt, sequenceVersionId: candidate.sequenceVersionId, chapterCount: candidate.content.chapters.length });
    if (candidate.content.chapters.length !== 10) continue;
    workflow = await request(`/api/v1/books/${bookId}/workflow`);
    const confirmed = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/confirm`, {
      method: 'POST', body: {
        sequenceVersionId: candidate.sequenceVersionId, expectedSequenceRevision: sequence.revision,
        expectedWorkflowVersion: workflow.planningVersion
      }
    });
    assert(confirmed.outlines.length === 10, 'confirmed chapter sequence does not contain ten outlines');
    save({ chapterSequenceVersionId: confirmed.activeVersionId });
    log('chapter_sequence_confirmed', { sequenceVersionId: confirmed.activeVersionId, chapterCount: confirmed.outlines.length });
    return confirmed;
  }
  throw new Error('AI did not produce an exact ten-chapter sequence after five author-directed attempts');
}

async function saveExpressionProfile(bookId) {
  const existing = await request(`/api/v1/books/${bookId}/expression-profile`);
  if (existing?.status === 'confirmed') return existing;
  const confirmed = await request(`/api/v1/books/${bookId}/expression-profile`, {
    method: 'POST', body: {
      narrativePerson: 'third', viewpointDistance: 'close',
      languageTone: ['克制', '准确', '有生活质感'], textDensity: 'adaptive',
      targetAudience: '喜欢公平推理与现实质感的成年读者',
      contentBoundaries: { noSupernatural: true, proceduralEvidence: true },
      humorSeriousness: 'serious', voiceEvidence: [],
      impactScope: { appliesFrom: 'next_formal_work_order' }, confirm: true
    }
  });
  log('expression_profile_confirmed', { expressionProfileId: confirmed.expressionProfileId, version: confirmed.version });
  return confirmed;
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
    return phaseDifference !== 0 ? phaseDifference : right.attemptCount - left.attemptCount;
  })[0] ?? null;
}

function formalCharacterCount(content) {
  return [...String(content ?? '')].filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}

function assertReadableChapter(number, content) {
  const text = String(content.content ?? '');
  const effectiveCharacterCount = formalCharacterCount(text);
  assert(effectiveCharacterCount >= 2_350 && effectiveCharacterCount <= 3_650,
    `chapter ${number} effective length ${effectiveCharacterCount} outside 2350-3650 (raw ${content.totalLength})`);
  const internalMatch = /(?:workflowArtifact|sourceId|source_id|confirmed_decisions|```json|"chapterNumber"|\bundefined\b)/u.exec(text);
  assert(internalMatch === null,
    `chapter ${number} exposes internal code or workflow fields: ${internalMatch?.[0]} near ${text.slice(Math.max(0, (internalMatch?.index ?? 0) - 80), (internalMatch?.index ?? 0) + 160)}`);
  assert(!/(?:待补充|TODO|这里填写|示例正文|(?:^|\n)\s*[【\[]?系统提示[】\]]?\s*[：:])/u.test(text),
    `chapter ${number} contains placeholder text`);
  return effectiveCharacterCount;
}

async function generateChapter(bookId, chapterNumber, outline) {
  const existing = (await chapterList(bookId)).find((chapter) => chapter.chapterNumber === chapterNumber);
  if (existing?.settlementStatus === 'settled') {
    const content = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/content`);
    const internalMatch = /(?:workflowArtifact|sourceId|source_id|confirmed_decisions|```json|"chapterNumber"|\bundefined\b)/u.exec(content.content);
    if (internalMatch !== null) {
      const revision = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/rewrite`, {
        method: 'POST', body: {
          manuscriptVersionId: content.manuscriptVersionId,
          instruction: '完整重写并清除正文中泄露的JSON、字段名、版本号、来源编号和工作流载荷；保持原有情节、人物选择、章末状态和2700至3200有效字符。'
        }
      });
      log('settled_chapter_repair_started', { chapterNumber, taskId: revision.taskId, matched: internalMatch[0] });
      const review = await waitForTask(bookId, revision.taskId, `chapter-${chapterNumber}-repair`);
      if (review.task.status === 'waiting_confirmation') {
        await acceptPendingManuscript(bookId, revision.taskId);
        await waitForTask(bookId, revision.taskId, `chapter-${chapterNumber}-repair-settlement`);
      }
      const repaired = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/content`);
      assertReadableChapter(chapterNumber, repaired);
      log('settled_chapter_repaired', { chapterNumber, manuscriptVersionId: repaired.manuscriptVersionId, contentHash: repaired.contentHash });
    } else {
      assertReadableChapter(chapterNumber, content);
    }
    if (!state.settledChapters.includes(chapterNumber)) {
      save({ settledChapters: [...state.settledChapters, chapterNumber].sort((a, b) => a - b) });
    }
    return;
  }
  activePhase = `chapter-${chapterNumber}`;
  const title = String(outline.activeVersion?.content?.title ?? outline.planned?.title ?? `第${chapterNumber}章`);
  let task = existing?.chapterId === undefined ? null : await resumableChapterTask(bookId, existing.chapterId);
  if (task !== null && task.status === 'blocked' && task.errorCode === 'QUALITY_BLOCKED' && existing?.chapterId) {
    const current = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/content`);
    assert(current.manuscriptVersionId, `chapter ${chapterNumber} quality block has no manuscript`);
    if (task.currentPhase === 'review') {
      task = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/finalize`, {
        method: 'POST', body: { manuscriptVersionId: current.manuscriptVersionId }
      });
      log('chapter_review_reopened', { chapterNumber, taskId: task.taskId });
    } else {
      task = await request(`/api/v1/books/${bookId}/chapters/${existing.chapterId}/rewrite`, {
        method: 'POST', body: {
          manuscriptVersionId: current.manuscriptVersionId,
          instruction: '保留人物选择、证据闭环和章末状态，完整重写；删去重复解释，正文严格控制在2700至3200有效字符。'
        }
      });
      log('chapter_quality_rewrite_started', { chapterNumber, taskId: task.taskId, phase: task.currentPhase });
    }
  } else if (task !== null && ['failed', 'interrupted'].includes(task.status)) {
    task = await request(`/api/v1/books/${bookId}/tasks/${task.taskId}/retry`, { method: 'POST', body: {} });
    log('chapter_task_retried', { chapterNumber, taskId: task.taskId });
  }
  if (task === null) {
    const run = await request(`/api/v1/books/${bookId}/writing-runs`, {
      method: 'POST', body: { chapterTitle: title }
    });
    assert(Array.isArray(run.taskIds) && run.taskIds.length === 1, `chapter ${chapterNumber} did not create one task`);
    task = { taskId: run.taskIds[0] };
    log('chapter_scheduled', { chapterNumber, title, taskId: task.taskId });
  }
  save({ chapterTaskIds: { ...(state.chapterTaskIds ?? {}), [chapterNumber]: task.taskId } });
  const review = await waitForTask(bookId, task.taskId, `chapter-${chapterNumber}-production`);
  if (review.task.status === 'waiting_confirmation') {
    await acceptPendingManuscript(bookId, task.taskId);
    const settled = await waitForTask(bookId, task.taskId, `chapter-${chapterNumber}-settlement`);
    assert(settled.task.status === 'succeeded', `chapter ${chapterNumber} did not settle`);
  } else {
    assert(review.task.status === 'succeeded', `chapter ${chapterNumber} ended as ${review.task.status}`);
  }
  const chapter = (await chapterList(bookId)).find((item) => item.chapterNumber === chapterNumber);
  assert(chapter?.settlementStatus === 'settled', `chapter ${chapterNumber} is not settled`);
  const content = await request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}/content`);
  const characterCount = assertReadableChapter(chapterNumber, content);
  const detail = await request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}`);
  assert((detail.production?.reviewReports?.length ?? 0) >= 3, `chapter ${chapterNumber} has fewer than three review reports`);
  assert((detail.production?.reviewPanels?.length ?? 0) >= 1, `chapter ${chapterNumber} has no review panel`);
  save({ settledChapters: [...new Set([...state.settledChapters, chapterNumber])].sort((a, b) => a - b) });
  log('chapter_settled', {
    chapterNumber, chapterId: chapter.chapterId, title: chapter.title,
    manuscriptVersionId: content.manuscriptVersionId, contentHash: content.contentHash,
    characterCount, reviewReportCount: detail.production.reviewReports.length
  });
}

async function prepareAndWriteTenChapters(bookId, event) {
  await saveExpressionProfile(bookId);
  const existingSettled = (await chapterList(bookId)).filter((chapter) => chapter.settlementStatus === 'settled')
    .sort((left, right) => left.chapterNumber - right.chapterNumber);
  for (const chapter of existingSettled) await generateChapter(bookId, chapter.chapterNumber, null);
  for (let pass = 1; pass <= 30; pass += 1) {
    let sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
    const unsettled = sequence.outlines.filter((item) => item.status !== 'settled')
      .sort((left, right) => left.chapterNumber - right.chapterNumber);
    if (unsettled.length === 0) return;
    const alreadyFrozen = unsettled.filter((item) => item.status === 'frozen').slice(0, 3);
    if (alreadyFrozen.length > 0) {
      for (const outline of alreadyFrozen) await generateChapter(bookId, outline.chapterNumber, outline);
      continue;
    }
    const targets = unsettled.slice(0, 3);
    const start = targets[0].chapterNumber;
    const end = targets.at(-1).chapterNumber;
    const lackingDetails = targets.some((item) => item.versions.length === 0);
    if (lackingDetails) {
      activePhase = `chapter-details-${start}-${end}`;
      const workflow = await request(`/api/v1/books/${bookId}/workflow`);
      const generation = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-outlines/generate`, {
        method: 'POST', body: {
          count: targets.length, expectedSequenceRevision: sequence.revision,
          expectedWorkflowVersion: workflow.planningVersion, authorInputRefs: [],
          idempotencyKey: key(`chapter-details-${start}-${end}`)
        }
      });
      log('chapter_details_generation_started', { start, count: targets.length, taskId: generation.taskId, member: generation.member });
      const purpose = `chapter-details-${start}-${end}`;
      try {
        await waitForTask(bookId, generation.taskId, purpose);
      } catch (error) {
        const detail = await request(`/api/v1/books/${bookId}/tasks/${generation.taskId}`);
        if (!['failed', 'interrupted'].includes(detail.task.status)) throw error;
        await request(`/api/v1/books/${bookId}/tasks/${generation.taskId}/retry`, { method: 'POST', body: {} });
        log('chapter_details_task_retried', { start, taskId: generation.taskId, previousErrorCode: detail.task.errorCode });
        await waitForTask(bookId, generation.taskId, `${purpose}-retry`);
      }
    }
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
    const targetIds = new Set(targets.map((item) => item.outlineId));
    const freshTargets = sequence.outlines.filter((item) => targetIds.has(item.outlineId));
    assert(freshTargets.every((item) => item.versions.length > 0), `detailed outlines ${start}-${end} are incomplete`);
    const workflow = await request(`/api/v1/books/${bookId}/workflow`);
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
    const frozen = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-outlines/freeze`, {
      method: 'POST', body: {
        items: freshTargets.map((item) => ({
          outlineId: item.outlineId, outlineVersionId: item.versions[0].outlineVersionId,
          expectedOutlineRevision: item.revision
        })),
        expectedWorkflowVersion: workflow.planningVersion
      }
    });
    log('chapter_outlines_frozen', { start, count: freshTargets.length, workflowStage: (await request(`/api/v1/books/${bookId}/workflow`)).stage });
    for (const target of freshTargets) {
      const outline = frozen.outlines.find((item) => item.outlineId === target.outlineId);
      assert(outline?.status === 'frozen', `chapter ${target.chapterNumber} outline was not frozen`);
      await generateChapter(bookId, target.chapterNumber, outline);
    }
  }
  throw new Error('ten-chapter workflow exceeded 30 resumable passes');
}

async function settlePlanning(bookId, volumePlan, event) {
  activePhase = 'event-settlement';
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  assert(workflow.stage === 'event_settlement_in_progress', `expected event settlement stage, got ${workflow.stage}`);
  const eventSettlement = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/settle`, {
    method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion }
  });
  assert(eventSettlement.chapterStart === 1 && eventSettlement.chapterEnd === 10, 'event settlement range is not 1-10');
  log('event_settled', { settlementId: eventSettlement.settlementId, canonRevision: eventSettlement.canonRevision });
  activePhase = 'volume-settlement';
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  assert(workflow.stage === 'volume_settlement_in_progress', `expected volume settlement stage, got ${workflow.stage}`);
  const volumeSettlement = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/settle`, {
    method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion }
  });
  assert(volumeSettlement.chapterStart === 1 && volumeSettlement.chapterEnd === 10, 'volume settlement range is not 1-10');
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  assert(workflow.stage === 'ready_for_next_volume', `expected next-volume ready stage, got ${workflow.stage}`);
  save({ eventSettlementId: eventSettlement.settlementId, volumeSettlementId: volumeSettlement.settlementId });
  log('volume_settled', { settlementId: volumeSettlement.settlementId, nextStage: workflow.stage });
  return { eventSettlement, volumeSettlement, workflow };
}

async function collectEvidence(bookId, volumePlan, event, settlements) {
  activePhase = 'final-evidence';
  const [book, profile, workflow, settings, chapters, workspace, volumePlans, eventSequence, chapterSequence, ideas] = await Promise.all([
    request(`/api/v1/books/${bookId}`), request(`/api/v1/books/${bookId}/book-profile`),
    request(`/api/v1/books/${bookId}/workflow`), request(`/api/v1/books/${bookId}/setting-outline-workspace`),
    chapterList(bookId), request(`/api/v1/books/${bookId}/workspace`),
    request(`/api/v1/books/${bookId}/volume-plans`),
    request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`),
    request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`),
    request(`/api/v1/books/${bookId}/author-planning-inputs`)
  ]);
  assert(workspace.agents.length === 11, `workspace has ${workspace.agents.length} agents instead of 11`);
  assert(new Set(workspace.agents.map((agent) => agent.roleKey)).size === 11, 'agent role keys are not unique');
  const settled = chapters.filter((chapter) => chapter.settlementStatus === 'settled').sort((a, b) => a.chapterNumber - b.chapterNumber);
  assert(settled.length === 10, `expected exactly 10 settled chapters, got ${settled.length}`);
  assert(settled.every((chapter, index) => chapter.chapterNumber === index + 1), 'settled chapters are not contiguous 1-10');
  const chapterEvidence = [];
  for (const chapter of settled) {
    const [content, detail] = await Promise.all([
      request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}/content`),
      request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}`)
    ]);
    chapterEvidence.push({
      chapterNumber: chapter.chapterNumber, chapterId: chapter.chapterId, title: chapter.title,
      manuscriptVersionId: content.manuscriptVersionId, contentHash: content.contentHash,
      characterCount: assertReadableChapter(chapter.chapterNumber, content),
      reviewPanelCount: detail.production.reviewPanels.length,
      reviewReportCount: detail.production.reviewReports.length,
      approvalGateCount: detail.production.approvalGates.length,
      preview: content.content.slice(0, 240)
    });
  }
  const ideaEvidence = ideas.map((idea) => ({
    authorInputId: idea.authorInputId, surface: idea.surface, subjectType: idea.subjectType,
    intentStrength: idea.intentStrength, status: idea.status, handlingReason: idea.handlingReason,
    appliedToRefs: idea.appliedToRefs
  }));
  const modelParticipants = [...new Map((state.taskEvidence ?? []).flatMap((task) => task.modelCalls)
    .filter((call) => call.provider && call.modelId)
    .map((call) => [`${call.agentId}:${call.provider}:${call.modelId}`, call])).values()];
  const evidence = {
    testId: TEST_ID, releaseId: RELEASE_ID, completedAt: now(), evidenceLevel: 'E2-short-real-flow',
    limitation: '十章真实流程可证明短流程运行与可追溯性，不代表1500章长期质量已经达到E3/E4。',
    book: { bookId, title: book.title, status: book.status, canonRevision: book.canonRevision },
    profile, workflow, settings: settings.map((item) => ({ itemKey: item.itemKey, label: item.label, status: item.status })),
    team: workspace.agents.map((agent) => ({
      agentId: agent.agentId, roleKey: agent.roleKey, displayName: agent.displayName,
      provider: agent.provider, modelId: agent.modelId, activationState: agent.activationState
    })),
    modelParticipants, taskEvidence: state.taskEvidence,
    volumePlan: volumePlans.find((item) => item.volumePlanId === volumePlan.volumePlanId),
    eventSequence, chapterSequence, authorIdeas: ideaEvidence,
    chapters: chapterEvidence, settlements
  };
  writeFileSync(FINAL_FILE, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  save({ completedAt: evidence.completedAt, stoppedAtPhase: null, lastError: null });
  log('e2e_completed', {
    bookId, title: book.title, canonRevision: book.canonRevision,
    chapterCount: chapterEvidence.length, agentCount: workspace.agents.length,
    modelParticipantCount: modelParticipants.length, finalStage: workflow.stage, evidenceFile: FINAL_FILE
  });
}

try {
  await issueSession();
  const healthEnvelope = await fetch(`${API}/health`).then((response) => response.json());
  const health = healthEnvelope.data ?? healthEnvelope;
  assert(health.status === 'ok' && health.releaseId === RELEASE_ID, `API health mismatch: ${JSON.stringify(health)}`);
  const bookId = await createBook();
  await ensureTestBudget(bookId);
  await completeSettings(bookId);
  const volumePlan = await planVolume(bookId);
  const event = await planEvent(bookId, volumePlan);
  await planChapterSequence(bookId, event);
  await prepareAndWriteTenChapters(bookId, event);
  const settlements = await settlePlanning(bookId, volumePlan, event);
  await collectEvidence(bookId, volumePlan, event, settlements);
} catch (error) {
  issue(error);
  console.error(error);
  process.exitCode = 1;
}
