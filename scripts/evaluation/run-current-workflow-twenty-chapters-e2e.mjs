import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API = 'http://127.0.0.1:43111';
const ORIGIN = 'http://127.0.0.1:43110';
const RELEASE_ID = 'wm-longform-r1-20260719-003435-e4d7b8b7';
const RUN_KEY = String(process.argv[2] ?? 'nightly-v2').trim().replace(/[^a-zA-Z0-9_-]/g, '-');
const TEST_ID = `E2E-CURRENT-WORKFLOW-20-${RUN_KEY.toUpperCase()}`;
const EVENT_COUNT = 2;
const CHAPTERS_PER_EVENT = 10;
const TOTAL_CHAPTERS = EVENT_COUNT * CHAPTERS_PER_EVENT;
const POLL_MS = 2_000;
const TASK_TIMEOUT_MS = 30 * 60 * 1_000;
const TEST_TOKEN_LIMIT = 5_000_000;
const ROOT = resolve(`data/verification/current-workflow-twenty-chapters-${RUN_KEY}`);
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

const xianxiaEventContent = (eventIndex) => eventIndex === 0 ? ({
  title: '试剑台反杀',
  volumeResponsibility: '让沈砚从被任意欺压的杂役变成有外门资格、也有明确敌人的主动调查者。',
  startingState: '沈砚灵根驳杂、妹妹药钱将断，被韩烈逼签做过手脚的生死状。',
  trigger: '韩烈当众扣走药钱并逼沈砚登上暗藏杀阵的试剑台。',
  participants: ['沈砚', '许小川', '苏青萝', '阿九', '韩烈', '魏长庚'],
  characterGoals: ['沈砚要保住妹妹药钱并赢得外门资格', '许小川要查清杂役灵石被克扣的证据', '苏青萝要确认试剑台规则是否被人篡改'],
  obstacles: ['韩烈境界更高且会根据沈砚的布置改变剑路', '魏长庚掌握账册、巡查与阵台维护权', '残缺阵盘只能看见破绽，不能提供额外灵力'],
  choicesAndCosts: ['沈砚必须在直接取胜与先救被毁台阵波及的杂役之间选择', '第一次布阵失败会烧掉仅剩灵石并加重旧伤'],
  informationMoves: ['生死状背面出现沈父暗记', '废阵与试剑台共同指向魏长庚私印', '韩烈并非幕后主使，但主动利用了被篡改的规则'],
  localProgression: ['生死状锁命', '药房断供', '废阵反噬', '苏青萝拦路', '第一次布阵失败', '阿九交易阵图', '封阵区取证', '公议坪反咬', '旧台决战', '救人后反杀'],
  requiredResult: '沈砚以可复盘的阵法借力击败韩烈、救下同门、取得外门资格，并拿到指向黑风猎场的灭口任务。',
  flexibleExecution: ['对白、动作、局部反转和阵法细节可由章纲与主笔根据即时人物反应调整'],
  endingConditions: ['韩烈公开败北但保留自己的判断', '沈砚得到外门资格', '试剑台篡改证据进入公开记录', '黑风猎场成为下一事件入口'],
  nextEventImpact: '外门令牌弹出的猎场任务既是晋级机会，也是魏长庚清除沈砚与证据的陷阱。',
  characterArcImpact: '沈砚从只想保住药钱，转为愿意与同伴共同承担揭开旧案的后果。',
  volumeClimaxImpact: '建立阵法智斗、群像配合和宗门黑账三条因果线。',
  estimatedChapterRange: { minimum: 10, likely: 10, maximum: 10 },
  uncertaintyNotes: []
}) : ({
  title: '黑风猎场夺旗',
  volumeResponsibility: '让第一事件的公开胜利变成真实追杀，并以群像合作完成本卷第一次大兑现。',
  startingState: '沈砚刚入外门便与许小川、苏青萝、阿九被送进规则遭篡改的黑风猎场。',
  trigger: '入场传送把四人送入废矿旧区，地图与出口阵同时失效。',
  participants: ['沈砚', '许小川', '苏青萝', '阿九', '韩烈', '魏长庚', '被困同门'],
  characterGoals: ['沈砚要带证据和同伴活着出场', '许小川要让黑账无法被单独销毁', '苏青萝要证明宗门规则确被执事利用', '阿九要救回失踪兄长'],
  obstacles: ['魏长庚能调动执法队和封山阵', '韩烈会为自保反复选择站队', '小队目标不同且阵盘会在中段损坏'],
  choicesAndCosts: ['救被困弟子会错过直接夺旗并耗尽阵盘', '阿九必须公开自己的私心才能继续合作', '沈砚强借残阵会造成经脉伤势'],
  informationMoves: ['诱灵粉证明路线被定向做手脚', '救援符编号连接魏长庚库房', '黑账与父亲旧阵图同藏废矿阵眼', '黑账背后仍有内门长老'],
  localProgression: ['猎场错传', '赤松谷夺旗', '裂石涧接应', '废矿分队', '救人耗尽阵盘', '无阵盘反制', '阵眼取黑账', '出口反追杀', '主峰破封山阵', '祭旗台公开黑账'],
  requiredResult: '四人救出同门、夺得首旗、公开灵矿黑账，并取得沈父旧阵图一角；魏长庚失去庇护但更大幕后人浮现。',
  flexibleExecution: ['每名同伴的局部解决办法、对白和合理惊喜可继续自由发挥'],
  endingConditions: ['四名主要角色都完成不可替代的主动行动', '首旗与黑账同时进入公开见证', '阵盘损坏和沈砚伤势作为胜利代价保留', '父亲旧案自然引向下一卷'],
  nextEventImpact: '旧阵图指向内门灵矿总阵，下一卷必须从现有伤势、关系与公开证据继续。',
  characterArcImpact: '沈砚学会把关键任务交给同伴，阿九也从利益合作转向有限信任。',
  volumeClimaxImpact: '完成本卷群像夺旗和黑账曝光的双重高潮。',
  estimatedChapterRange: { minimum: 10, likely: 10, maximum: 10 },
  uncertaintyNotes: []
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
    creationMode: 'new', taxonomyVersion, channel: 'male', categoryKey: 'male-eastern-xianxia',
    targetAudience: '喜欢快节奏、强冲突、智取反杀和群像成长的修仙爽文读者',
    protagonists: [{
      role: 'male_lead', name: '沈砚', age: '十八岁',
      background: '青霄宗杂役院少年，父亲曾是宗门阵师却背负叛宗污名而死；沈砚灵根驳杂，只能靠替外门修补废阵换取修炼资源。',
      personalities: ['冷静', '敏锐', '护短', '越挫越勇', '极端冒险']
    }],
    storyDirection: '沈砚在杂役试剑台上被外门天才韩烈逼签生死状，意外发现父亲留下的残缺阵盘能看见灵力破绽。他不靠突然暴涨的修为，而是以阵纹、判断和胆量连续反杀，从杂役院打进外门；第一卷分成“试剑台反杀”和“黑风猎场夺旗”两个完整事件，共二十章，逐步揭开父亲叛宗案与宗门灵矿黑账。',
    worldBackground: '九州修真世界，青霄宗控制北境灵矿与山门城镇；修炼分淬体、引气、筑基等境界，阵法必须依赖阵眼、灵石与环境，越级取胜必有可见代价。',
    openingBackground: '杂役月考当日，韩烈当众踩碎沈砚替妹妹换药的灵石，逼他登上试剑台。',
    stageOne: {
      start: '沈砚被迫登台，以残阵借力击败境界更高的韩烈，保住妹妹药钱并引起外门注意。',
      development: '他与机灵杂役许小川、冷面剑修苏青萝和神秘商贩阿九结盟，在外门考核与黑风猎场中遭到执事魏长庚的连续围杀。',
      end: '沈砚夺得猎场首旗、救下同门并拿到父亲旧阵图的一角，确认宗门有人借灵矿掩盖旧案。'
    },
    fullBookOutline: '沈砚从杂役、外门、内门一路成长为阵道宗师，每卷解决一个迫在眉睫的生存目标，同时沿父亲旧案、北境灵矿和九州阵脉三层秘密递进；盟友有独立目标，会合作、分歧和成长。',
    mainTags: ['修仙', '逆袭', '智斗', '热血', '群像'],
    auxiliaryTags: ['阵法禁制', '灵根', '剑修'], storyTraits: ['快节奏', '越级战斗', '宗门成长'],
    styleIntent: {
      languageTones: ['利落', '有画面感', '对白有辨识度'], emotionalTones: ['热血', '紧张', '友情有温度'],
      pacingAndPayoff: ['每章有推进', '三章内有小兑现', '章末有具体危机'], atmospheres: ['宗门压迫', '猎场凶险', '逆势翻盘'],
      custom: ['战斗讲清空间、阵眼和代价，不用空喊招式名堆砌']
    },
    customTags: ['残阵破局', '草根组队', '宗门黑账', '父辈旧案'],
    initialMap: '青霄宗杂役院、试剑台、外门七峰、黑风猎场、废弃灵矿与山门坊市。',
    mustFollow: [
      '沈砚只能看见和理解阵纹破绽，不能凭空获得无限力量',
      '越级取胜必须依赖提前观察、环境、同伴配合或明确代价',
      '韩烈、魏长庚等对手有自身目标和判断，不能排队降智送人头',
      '许小川、苏青萝、阿九都有独立动机与行动，不能只是主角工具人'
    ]
  };
}

function answerFor(item, attempt = 1) {
  const answers = {
    'creative-concept': '核心创意是“弱者看见规则的缝”：沈砚没有无敌系统，只能借父亲残阵盘看清灵力和阵势的破绽。每次爽点来自观察、布置、同伴配合与承担代价，长期主线是洗清父亲旧案并改变宗门把底层弟子当耗材的规则。',
    'reader-promise': '读者持续获得三种体验：主角被逼到墙角后用阵法智取反杀；多名伙伴各展所长、会分歧也会互救；每个事件当场兑现一个胜利，同时抛出父亲旧案和灵矿黑账的新证据。',
    era: '故事发生在九州北境的青霄宗。宗门垄断灵矿和修炼资源，弟子分杂役、外门、内门与真传；修炼境界分淬体九重、引气、筑基等，境界差距真实存在，阵法需要阵眼、灵石、地势和准备时间。',
    protagonist: '沈砚十八岁，青霄宗杂役，父亲沈铸曾是阵师却被定为叛徒。沈砚冷静敏锐、坚韧护短，擅长修补残阵和在压力下判断空间关系；开篇只有淬体三重、半块残阵盘、许小川的消息渠道和必须给妹妹沈禾换药的现实压力。',
    motivation: '沈砚眼前必须保住药钱、摆脱杂役身份并活过考核；深层目标是查明父亲旧案。他害怕身边人因自己被牵连，底线是不牺牲无辜同门换取胜利，也不把伙伴当阵眼耗材。',
    'must-follow': '力量、阵法和资源必须前后一致；越级反杀要能复盘准备、地形、对手判断和代价。对手不能降智，伙伴不能工具化；新能力先有来源和试错，再在高潮兑现。',
    'relationship-premise': '许小川负责情报与临场应变，苏青萝追查师兄失踪案并擅长正面剑战，阿九掌握坊市黑市与旧阵图线索。三人与沈砚利益相交但目标不同，通过共同承担风险逐步成为真正队伍。',
    'relationship-obstacle': '许小川怕死又想救被扣住的兄长，苏青萝怀疑沈砚父亲真是叛徒，阿九则隐藏自己与灵矿商会的关系。冲突来自秘密、利益和不同救人方式，不能靠一次坦白全部消失。',
    'case-rules': '父亲旧案与灵矿黑账按照可核验线索推进：旧阵图、矿石灵力残留、执事调令、猎场阵眼改动和当事人行动互相印证。任何关键结论至少有两类来源，反派不会靠长篇自白交代真相。',
    'evidence-chain': '第一卷证据从试剑台被改过的阵眼、父亲阵盘识别出的同源纹路、猎场废矿的异常灵流和魏长庚手中调令逐步形成。未经核实的传闻只作为线索，不能直接洗清父亲罪名。',
    'truth-layers': '第一层揭示韩烈受人指使压住沈砚；第二层揭示黑风猎场阵眼被改成偷运灵矿的通道；第三层只确认父亲旧阵图与矿脉封印有关，幕后主使和父亲生死仍留给后续卷。'
  };
  const base = answers[item.itemKey]
    ?? `关于“${item.label}”，本书采用可复盘、可持续升级的修仙设定：${item.prompt}。边界服从沈砚当前境界、阵法条件、伙伴动机和青霄宗资源规则；只确定运行规则，不提前锁死具体场景。`;
  return attempt === 1 ? base : `${base}\n补充确认：采用最符合力量规则、人物主动性和长线伏笔的明确方案；未知细节保留为后续创作空间。`;
}

async function createBook() {
  if (state.bookId) return state.bookId;
  activePhase = 'create-book';
  const taxonomy = await request('/api/v1/opening-taxonomy');
  const openingBlueprint = blueprint(taxonomy.version);
  const title = `烬骨问天·二十章全流程-${RUN_KEY}`;
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
  const readiness = await request(`/api/v1/books/${bookId}/setting-baseline/readiness`);
  for (const itemKey of readiness.required) {
    let items = await request(`/api/v1/books/${bookId}/setting-outline-workspace`);
    let item = items.find((candidate) => candidate.itemKey === itemKey);
    assert(item, `required setting item ${itemKey} is missing from workspace`);
    if (item.status === '已确认') continue;

    const authorInput = await createIdea(bookId, {
      surface: 'setting', subjectType: 'setting_module', subjectId: item.itemKey,
      originalText: answerFor(item), scopeNotes: `用于“${item.label}”三席方案与融合`,
      idempotencyLabel: `setting-${item.itemKey}-idea`
    });
    const panel = await request(`/api/v1/books/${bookId}/setting-outline-workspace/${item.itemKey}/collaboration/start`, {
      method: 'POST', body: {
        authorInputId: authorInput.authorInputId,
        idempotencyKey: key(`setting-${item.itemKey}-panel`)
      }
    });
    await waitForTask(bookId, panel.taskId, `setting-${item.itemKey}-three-proposals`);
    const collaboration = await request(`/api/v1/books/${bookId}/setting-outline-workspace/${item.itemKey}/collaboration`);
    const proposals = collaboration.panel?.proposals ?? [];
    assert(proposals.length === 3, `${item.itemKey} expected three independent proposals, got ${proposals.length}`);
    assert(new Set(proposals.map((proposal) => proposal.agentId)).size === 3,
      `${item.itemKey} proposals do not come from three distinct members`);
    log('setting_proposals_ready', {
      itemKey: item.itemKey,
      members: proposals.map((proposal) => ({ agentId: proposal.agentId, modelProvider: proposal.modelProvider, modelId: proposal.modelId }))
    });

    const synthesis = await request(`/api/v1/books/${bookId}/setting-outline-workspace/${item.itemKey}/collaboration/synthesize`, {
      method: 'POST', body: {
        proposalIds: proposals.map((proposal) => proposal.proposalId),
        authorInputId: authorInput.authorInputId,
        idempotencyKey: key(`setting-${item.itemKey}-synthesis`)
      }
    });
    const synthesisDetail = await request(`/api/v1/books/${bookId}/tasks/${synthesis.taskId}`);
    if (terminalFailures.has(synthesisDetail.task.status)) {
      await request(`/api/v1/books/${bookId}/tasks/${synthesis.taskId}/retry`, { method: 'POST', body: {} });
      log('setting_synthesis_retried', {
        itemKey: item.itemKey, taskId: synthesis.taskId, previousStatus: synthesisDetail.task.status
      });
    }
    await waitForTask(bookId, synthesis.taskId, `setting-${item.itemKey}-editor-synthesis`);
    items = await request(`/api/v1/books/${bookId}/setting-outline-workspace`);
    item = items.find((candidate) => candidate.itemKey === itemKey);
    assert(item?.status === '候选待确认' && typeof item.content === 'string' && item.content.trim().length > 0,
      `${itemKey} synthesis did not produce a confirmable setting candidate`);
    const confirmed = await request(`/api/v1/books/${bookId}/setting-outline-workspace/${item.itemKey}`, {
      method: 'PUT', body: {
        groupTitle: item.groupTitle, label: item.label, prompt: item.prompt,
        sourceLabel: item.sourceLabel, status: '已确认', custom: item.custom,
        sortOrder: item.sortOrder, content: item.content
      }
    });
    assert(confirmed.status === '已确认', `${itemKey} did not become confirmed`);
    log('setting_confirmed', { itemKey: confirmed.itemKey, sourceDiscussionId: confirmed.sourceDiscussionId });
  }

  const ready = await request(`/api/v1/books/${bookId}/setting-baseline/readiness`);
  assert(ready.ready, `setting baseline is not ready: ${JSON.stringify({ missing: ready.missing, unresolved: ready.unresolved })}`);
  const workflow = await request(`/api/v1/books/${bookId}/workflow`);
  const confirmedBaseline = await request(`/api/v1/books/${bookId}/setting-baseline/confirm`, {
    method: 'POST', body: { expectedPlanningVersion: workflow.planningVersion }
  });
  assert(confirmedBaseline.stage === 'setting_ready', `setting baseline ended as ${confirmedBaseline.stage}`);
  const completedWorkflow = await request(`/api/v1/books/${bookId}/workflow`);
  save({ settingsCompleted: true, workflowAfterSettings: completedWorkflow });
  log('settings_ready', { stage: completedWorkflow.stage, planningVersion: completedWorkflow.planningVersion });
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

function forceTwoTenChapterEvents(content) {
  const first = content.eventSequence[0];
  assert(first, 'generated volume plan has no event');
  return {
    ...content,
    title: '第一卷·杂役破局',
    coreGoal: '沈砚在二十章内从杂役院打进外门，保住同伴并取得父亲旧案的第一份可信线索。',
    eventSequence: [
      {
        ...first, eventId: 'volume-event-1', order: 1, title: '试剑台反杀',
        responsibility: '用十章完成被逼登台、识破阵眼、越级反杀、保住药钱、结识伙伴并拿到外门考核资格。',
        entryState: '沈砚是淬体三重杂役，药钱被夺，父亲仍背叛宗污名。',
        trigger: '韩烈受人指使逼沈砚签下生死状。',
        action: '沈砚联合许小川搜集试剑台阵纹变化，在公开对决中借残阵以弱胜强。',
        result: '韩烈败北，沈砚获得外门考核资格，却发现阵眼改动与父亲旧阵盘同源。',
        leadsToNext: '外门执事魏长庚将沈砚塞进死亡率最高的黑风猎场考核，企图灭口。',
        estimatedChapterRange: { minimum: 10, likely: 10, maximum: 10 }
      },
      {
        ...first, eventId: 'volume-event-2', order: 2, title: '黑风猎场夺旗',
        responsibility: '用十章完成组队入场、阵营追杀、伙伴分歧、废矿破阵、救人夺旗和灵矿黑账线索兑现。',
        entryState: '沈砚刚获考核资格，底牌已暴露一角，魏长庚准备在猎场灭口。',
        trigger: '猎场规则临时改变，沈砚小队被标为携带额外积分的猎物。',
        action: '沈砚、许小川、苏青萝和阿九各用所长，在追杀中反查废矿阵眼并争夺首旗。',
        result: '小队救下受困弟子、夺得首旗，沈砚晋入外门并拿到父亲旧阵图一角。',
        leadsToNext: null,
        estimatedChapterRange: { minimum: 10, likely: 10, maximum: 10 }
      }
    ]
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
      originalText: '第一卷精确分为两个连续事件、共20章。事件一“试剑台反杀”覆盖第1至10章，完成受辱、查阵、结盟、失手代价和公开反杀；事件二“黑风猎场夺旗”覆盖第11至20章，完成组队、追杀、分歧、废矿破阵、救人夺旗与旧阵图线索兑现。节奏要快，多角色必须主动行动，两个事件各自完整收束并形成因果衔接。',
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
  if (selected.content.eventSequence.length !== EVENT_COUNT
    || selected.content.eventSequence.some((event) => event.estimatedChapterRange?.likely !== CHAPTERS_PER_EVENT)) {
    plans = await request(`/api/v1/books/${bookId}/volume-plans`);
    plan = plans.find((item) => item.volumePlanId === plan.volumePlanId);
    selected = await request(`/api/v1/books/${bookId}/volume-plans/${plan.volumePlanId}/versions`, {
      method: 'POST', body: {
        expectedPlanRevision: plan.revision, candidateKind: 'author_edit',
        parentVersionId: selected.volumePlanVersionId, sourceTaskId: state.volumeGenerationTaskId,
        authorInputRefs: [ideaId], template: noneTemplate('volume'),
        content: forceTwoTenChapterEvents(selected.content), idempotencyKey: key('volume-author-final')
      }
    });
    log('volume_author_adjustment_saved', { volumePlanVersionId: selected.volumePlanVersionId, reason: 'two-event-twenty-chapter-test-scope' });
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
  assert(confirmed.activeVersion?.content.eventSequence.length === EVENT_COUNT, 'confirmed volume does not contain exactly two events');
  save({ volumePlanId: confirmed.volumePlanId, volumePlanVersionId: confirmed.activeVersionId });
  log('volume_plan_confirmed', { volumePlanId: confirmed.volumePlanId, versionId: confirmed.activeVersionId, title: confirmed.activeVersion.content.title });
  return confirmed;
}

async function planEvent(bookId, volumePlan, eventIndex) {
  activePhase = `story-event-${eventIndex + 1}`;
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  let sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`);
  if (sequence === null) {
    sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence/initialize`, {
      method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion, idempotencyKey: key('event-sequence') }
    });
    log('event_sequence_initialized', { revision: sequence.revision, eventCount: sequence.events.length });
  }
  assert(sequence.events.length === EVENT_COUNT, `expected ${EVENT_COUNT} events from confirmed volume, got ${sequence.events.length}`);
  let event = sequence.events[eventIndex];
  assert(event, `event ${eventIndex + 1} is missing`);
  save({ eventIds: { ...(state.eventIds ?? {}), [eventIndex]: event.eventId } });
  if (event.activeVersionId !== null) return event;
  let ideaId = state.eventIdeaIds?.[eventIndex];
  if (!ideaId) {
    const directions = [
      '事件一精确写10章，对应第1—10章。前3章完成受辱、发现阵纹异常和许小川入局；第4—6章让沈砚首次布阵失败、妹妹药钱面临断供并与苏青萝发生立场冲突；第7—10章查清试剑台阵眼、逼韩烈公开出手，以可复盘的阵法借力越级反杀，拿到外门资格并触发猎场灭口。',
      '事件二精确写10章，对应第11—20章。沈砚、许小川、苏青萝和阿九都必须主动解决问题；第13—16章遭遇规则突变、队伍分歧和一次真实损失；第17—20章在废矿阵眼完成反追杀、救下同门、夺得首旗并拿到父亲旧阵图一角。魏长庚不能降智，胜利必须有资源消耗与伤势代价。'
    ];
    const idea = await createIdea(bookId, {
      surface: 'event', subjectType: 'story_event', subjectId: event.eventId,
      originalText: directions[eventIndex],
      idempotencyLabel: `event-${eventIndex + 1}-idea`
    });
    ideaId = idea.authorInputId;
    save({ eventIdeaIds: { ...(state.eventIdeaIds ?? {}), [eventIndex]: ideaId } });
  }
  let eventTaskId = state.eventGenerationTaskIds?.[eventIndex];
  if (!eventTaskId) {
    workflow = await request(`/api/v1/books/${bookId}/workflow`);
    sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`);
    event = sequence.events[eventIndex];
    const generation = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/generate`, {
      method: 'POST', body: {
        expectedEventRevision: event.revision, expectedActiveVersionId: event.activeVersionId,
        expectedWorkflowVersion: workflow.planningVersion, template: noneTemplate('event'),
        authorInputRefs: [ideaId], idempotencyKey: key(`event-${eventIndex + 1}-generate`)
      }
    });
    eventTaskId = generation.taskId;
    save({ eventGenerationTaskIds: { ...(state.eventGenerationTaskIds ?? {}), [eventIndex]: eventTaskId } });
    log('event_generation_started', { eventIndex: eventIndex + 1, taskId: eventTaskId, members: generation.members });
  }
  const eventTaskDetail = await request(`/api/v1/books/${bookId}/tasks/${eventTaskId}`);
  if (terminalFailures.has(eventTaskDetail.task.status)) {
    await request(`/api/v1/books/${bookId}/tasks/${eventTaskId}/retry`, { method: 'POST', body: {} });
    log('event_generation_retried', {
      eventIndex: eventIndex + 1,
      taskId: eventTaskId,
      previousStatus: eventTaskDetail.task.status,
      previousErrorCode: eventTaskDetail.task.errorCode
    });
  }
  await waitForTask(bookId, eventTaskId, `event-${eventIndex + 1}-two-writers-and-editor`);
  let versions = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/versions`);
  assert(['candidate_a', 'candidate_b', 'fusion'].every((kind) => versions.some((item) => item.candidateKind === kind)),
    'event generation did not create A, B and fusion candidates');
  let selected = versions.filter((item) => item.candidateKind === 'author_edit').at(-1)
    ?? versions.filter((item) => item.candidateKind === 'fusion').at(-1);
  assert(selected, 'event fusion candidate missing');
  const finalEventContent = xianxiaEventContent(eventIndex);
  if (selected.candidateKind !== 'author_edit' || selected.content.title !== finalEventContent.title) {
    sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`);
    event = sequence.events[eventIndex];
    selected = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/versions`, {
      method: 'POST', body: {
        expectedEventRevision: event.revision, candidateKind: 'author_edit',
        parentVersionId: selected.storyEventVersionId, sourceTaskId: eventTaskId,
        authorInputRefs: [ideaId], template: noneTemplate('event'),
        content: finalEventContent,
        idempotencyKey: key(`event-${eventIndex + 1}-author-final`)
      }
    });
    log('event_author_adjustment_saved', { eventIndex: eventIndex + 1, storyEventVersionId: selected.storyEventVersionId, reason: 'confirmed-xianxia-event-contract' });
  }
  await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/impact-preview`, {
    method: 'POST', body: { versionId: selected.storyEventVersionId }
  });
  sequence = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`);
  event = sequence.events[eventIndex];
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  const confirmed = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/confirm`, {
    method: 'POST', body: {
      versionId: selected.storyEventVersionId, expectedEventRevision: event.revision,
      expectedWorkflowVersion: workflow.planningVersion
    }
  });
  save({ eventVersionIds: { ...(state.eventVersionIds ?? {}), [eventIndex]: confirmed.activeVersionId } });
  log('story_event_confirmed', { eventIndex: eventIndex + 1, eventId: confirmed.eventId, versionId: confirmed.activeVersionId, title: confirmed.activeVersion.content.title });
  return confirmed;
}

async function planChapterSequence(bookId, event, eventIndex) {
  activePhase = `event-${eventIndex + 1}-chapter-sequence`;
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  let sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
  if (sequence === null) {
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/initialize`, {
      method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion, idempotencyKey: key(`event-${eventIndex + 1}-chapter-sequence-init`) }
    });
    log('chapter_sequence_initialized', { sequenceId: sequence.sequenceId, revision: sequence.revision });
  }
  if (sequence.activeVersionId !== null) {
    assert(sequence.outlines.length === CHAPTERS_PER_EVENT, `active chapter sequence has ${sequence.outlines.length} chapters, expected ${CHAPTERS_PER_EVENT}`);
    return sequence;
  }
  let ideaId = state.chapterSequenceIdeaIds?.[eventIndex];
  if (!ideaId) {
    const chapterStart = eventIndex * CHAPTERS_PER_EVENT + 1;
    const chapterEnd = chapterStart + CHAPTERS_PER_EVENT - 1;
    const idea = await createIdea(bookId, {
      surface: 'chapter_outline', subjectType: 'event_chapter_sequence', subjectId: event.eventId,
      originalText: `请把当前事件拆成精确10章，章号连续为${chapterStart}—${chapterEnd}。每章只有一个清晰责任，相邻章状态必须衔接；至少四名主要角色各有主动行动，对手会根据前一章结果调整策略；最后一章覆盖当前事件全部结束条件并自然引出后续。不要提前写正文。`,
      idempotencyLabel: `event-${eventIndex + 1}-chapter-sequence-idea`
    });
    ideaId = idea.authorInputId;
    save({ chapterSequenceIdeaIds: { ...(state.chapterSequenceIdeaIds ?? {}), [eventIndex]: ideaId } });
  }
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
    workflow = await request(`/api/v1/books/${bookId}/workflow`);
    let taskId = state.chapterSequenceTaskIds?.[eventIndex]?.[attempt];
    if (!taskId) {
      const generation = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/generate`, {
        method: 'POST', body: {
          expectedSequenceRevision: sequence.revision, expectedWorkflowVersion: workflow.planningVersion,
          authorInputRefs: [ideaId], idempotencyKey: key(`event-${eventIndex + 1}-chapter-sequence-generate-${attempt}`)
        }
      });
      taskId = generation.taskId;
      save({ chapterSequenceTaskIds: { ...(state.chapterSequenceTaskIds ?? {}), [eventIndex]: { ...(state.chapterSequenceTaskIds?.[eventIndex] ?? {}), [attempt]: taskId } } });
      log('chapter_sequence_generation_started', { eventIndex: eventIndex + 1, attempt, taskId, member: generation.member });
    }
    await waitForTask(bookId, taskId, `event-${eventIndex + 1}-chapter-sequence-attempt-${attempt}`);
    sequence = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`);
    const candidate = sequence.versions.filter((item) => item.status === 'candidate')
      .sort((left, right) => right.version - left.version)[0];
    assert(candidate, `chapter sequence attempt ${attempt} produced no candidate`);
    log('chapter_sequence_candidate', { attempt, sequenceVersionId: candidate.sequenceVersionId, chapterCount: candidate.content.chapters.length });
    if (candidate.content.chapters.length !== CHAPTERS_PER_EVENT) continue;
    workflow = await request(`/api/v1/books/${bookId}/workflow`);
    const confirmed = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence/confirm`, {
      method: 'POST', body: {
        sequenceVersionId: candidate.sequenceVersionId, expectedSequenceRevision: sequence.revision,
        expectedWorkflowVersion: workflow.planningVersion
      }
    });
    assert(confirmed.outlines.length === CHAPTERS_PER_EVENT, 'confirmed chapter sequence does not contain ten outlines');
    save({ chapterSequenceVersionIds: { ...(state.chapterSequenceVersionIds ?? {}), [eventIndex]: confirmed.activeVersionId } });
    log('chapter_sequence_confirmed', { eventIndex: eventIndex + 1, sequenceVersionId: confirmed.activeVersionId, chapterCount: confirmed.outlines.length });
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
      languageTone: ['利落', '热血', '有画面感', '对白有辨识度'], textDensity: 'adaptive',
      targetAudience: '喜欢快节奏、智取反杀与多角色修仙成长的读者',
      contentBoundaries: { powerRulesMustBeTraceable: true, noCostFreeVictory: true, noDisposableCompanions: true },
      humorSeriousness: 'balanced', voiceEvidence: [],
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

async function prepareAndWriteEventChapters(bookId, event) {
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
  throw new Error('event chapter workflow exceeded 30 resumable passes');
}

async function settleEvent(bookId, event, eventIndex) {
  activePhase = `event-${eventIndex + 1}-settlement`;
  const existing = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/settlement`);
  if (existing !== null) {
    const expectedStart = eventIndex * CHAPTERS_PER_EVENT + 1;
    const expectedEnd = expectedStart + CHAPTERS_PER_EVENT - 1;
    assert(existing.chapterStart === expectedStart && existing.chapterEnd === expectedEnd,
      `existing event settlement range is not ${expectedStart}-${expectedEnd}`);
    return existing;
  }
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  assert(workflow.stage === 'event_settlement_in_progress', `expected event settlement stage, got ${workflow.stage}`);
  const eventSettlement = await request(`/api/v1/books/${bookId}/story-events/${event.eventId}/settle`, {
    method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion }
  });
  const expectedStart = eventIndex * CHAPTERS_PER_EVENT + 1;
  const expectedEnd = expectedStart + CHAPTERS_PER_EVENT - 1;
  assert(eventSettlement.chapterStart === expectedStart && eventSettlement.chapterEnd === expectedEnd,
    `event settlement range is not ${expectedStart}-${expectedEnd}`);
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  const expectedNextStage = eventIndex === EVENT_COUNT - 1 ? 'volume_settlement_in_progress' : 'event_sequence_in_progress';
  assert(workflow.stage === expectedNextStage, `expected ${expectedNextStage} after event settlement, got ${workflow.stage}`);
  save({ eventSettlementIds: { ...(state.eventSettlementIds ?? {}), [eventIndex]: eventSettlement.settlementId } });
  log('event_settled', { eventIndex: eventIndex + 1, settlementId: eventSettlement.settlementId, canonRevision: eventSettlement.canonRevision, nextStage: workflow.stage });
  return eventSettlement;
}

async function settleVolume(bookId, volumePlan) {
  activePhase = 'volume-settlement';
  let workflow = await request(`/api/v1/books/${bookId}/workflow`);
  assert(workflow.stage === 'volume_settlement_in_progress', `expected volume settlement stage, got ${workflow.stage}`);
  const volumeSettlement = await request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/settle`, {
    method: 'POST', body: { expectedWorkflowVersion: workflow.planningVersion }
  });
  assert(volumeSettlement.chapterStart === 1 && volumeSettlement.chapterEnd === TOTAL_CHAPTERS, `volume settlement range is not 1-${TOTAL_CHAPTERS}`);
  workflow = await request(`/api/v1/books/${bookId}/workflow`);
  assert(workflow.stage === 'ready_for_next_volume', `expected next-volume ready stage, got ${workflow.stage}`);
  save({ volumeSettlementId: volumeSettlement.settlementId });
  log('volume_settled', { settlementId: volumeSettlement.settlementId, nextStage: workflow.stage });
  return { volumeSettlement, workflow };
}

async function collectEvidence(bookId, volumePlan, events, settlements) {
  activePhase = 'final-evidence';
  const [book, profile, workflow, settings, chapters, workspace, volumePlans, eventSequence, ideas, ...chapterSequences] = await Promise.all([
    request(`/api/v1/books/${bookId}`), request(`/api/v1/books/${bookId}/book-profile`),
    request(`/api/v1/books/${bookId}/workflow`), request(`/api/v1/books/${bookId}/setting-outline-workspace`),
    chapterList(bookId), request(`/api/v1/books/${bookId}/workspace`),
    request(`/api/v1/books/${bookId}/volume-plans`),
    request(`/api/v1/books/${bookId}/volume-plans/${volumePlan.volumePlanId}/event-sequence`),
    request(`/api/v1/books/${bookId}/author-planning-inputs`),
    ...events.map((event) => request(`/api/v1/books/${bookId}/story-events/${event.eventId}/chapter-sequence`))
  ]);
  assert(workspace.agents.length === 11, `workspace has ${workspace.agents.length} agents instead of 11`);
  assert(new Set(workspace.agents.map((agent) => agent.roleKey)).size === 11, 'agent role keys are not unique');
  const settled = chapters.filter((chapter) => chapter.settlementStatus === 'settled').sort((a, b) => a.chapterNumber - b.chapterNumber);
  assert(settled.length === TOTAL_CHAPTERS, `expected exactly ${TOTAL_CHAPTERS} settled chapters, got ${settled.length}`);
  assert(settled.every((chapter, index) => chapter.chapterNumber === index + 1), `settled chapters are not contiguous 1-${TOTAL_CHAPTERS}`);
  const chapterEvidence = [];
  const manuscriptTexts = [];
  for (const chapter of settled) {
    const [content, detail] = await Promise.all([
      request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}/content`),
      request(`/api/v1/books/${bookId}/chapters/${chapter.chapterId}`)
    ]);
    manuscriptTexts.push(content.content);
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
  const wholeManuscript = manuscriptTexts.join('\n');
  for (const requiredName of ['沈砚', '许小川', '苏青萝', '阿九', '韩烈', '魏长庚']) {
    assert(wholeManuscript.includes(requiredName), `twenty-chapter manuscript is missing active character ${requiredName}`);
  }
  for (const requiredStoryTerm of ['阵纹', '试剑台', '黑风猎场', '阵盘', '外门']) {
    assert(wholeManuscript.includes(requiredStoryTerm), `twenty-chapter manuscript is missing xianxia story term ${requiredStoryTerm}`);
  }
  assert(!wholeManuscript.includes('林澈') && !wholeManuscript.includes('铜钥匙'),
    'twenty-chapter manuscript leaked the unrelated deterministic mystery fixture');
  assert(events.map((event) => event.activeVersion?.content.title).join('|') === '试剑台反杀|黑风猎场夺旗',
    'confirmed events are not the two required xianxia event contracts');
  const ideaEvidence = ideas.map((idea) => ({
    authorInputId: idea.authorInputId, surface: idea.surface, subjectType: idea.subjectType,
    intentStrength: idea.intentStrength, status: idea.status, handlingReason: idea.handlingReason,
    appliedToRefs: idea.appliedToRefs
  }));
  const modelParticipants = [...new Map((state.taskEvidence ?? []).flatMap((task) => task.modelCalls)
    .filter((call) => call.provider && call.modelId)
    .map((call) => [`${call.agentId}:${call.provider}:${call.modelId}`, call])).values()];
  const evidence = {
    testId: TEST_ID, releaseId: RELEASE_ID, completedAt: now(), evidenceLevel: 'E2-current-workflow-twenty-chapters',
    limitation: '二十章本地确定性流程证明当前对象链、任务、审查、正文与双事件结算可运行和可追溯；不代表真实套餐模型文学质量，也不等于1000章以上长期质量已经得到证明。',
    book: { bookId, title: book.title, status: book.status, canonRevision: book.canonRevision },
    profile, workflow, settings: settings.map((item) => ({ itemKey: item.itemKey, label: item.label, status: item.status })),
    team: workspace.agents.map((agent) => ({
      agentId: agent.agentId, roleKey: agent.roleKey, displayName: agent.displayName,
      provider: agent.provider, modelId: agent.modelId, activationState: agent.activationState
    })),
    modelParticipants, taskEvidence: state.taskEvidence,
    volumePlan: volumePlans.find((item) => item.volumePlanId === volumePlan.volumePlanId),
    eventSequence, chapterSequences, authorIdeas: ideaEvidence,
    chapters: chapterEvidence, settlements
  };
  writeFileSync(FINAL_FILE, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  save({ completedAt: evidence.completedAt, stoppedAtPhase: null, lastError: null });
  log('e2e_completed', {
    bookId, title: book.title, canonRevision: book.canonRevision,
    chapterCount: chapterEvidence.length, eventCount: events.length, agentCount: workspace.agents.length,
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
  const events = [];
  const eventSettlements = [];
  for (let eventIndex = 0; eventIndex < EVENT_COUNT; eventIndex += 1) {
    const event = await planEvent(bookId, volumePlan, eventIndex);
    events.push(event);
    await planChapterSequence(bookId, event, eventIndex);
    await prepareAndWriteEventChapters(bookId, event);
    eventSettlements.push(await settleEvent(bookId, event, eventIndex));
  }
  const volumeSettlement = await settleVolume(bookId, volumePlan);
  await collectEvidence(bookId, volumePlan, events, { eventSettlements, ...volumeSettlement });
} catch (error) {
  issue(error);
  console.error(error);
  process.exitCode = 1;
}
