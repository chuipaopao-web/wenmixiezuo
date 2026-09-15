// S1-A真实模型HTTP探针（d5e4b0d1复核项3）：单个合成书样本，服务器隔离目录+独立数据库。
// 确定性准备阶段（注册/建书/设定批次/确认/总清单，模型为内联夹具，零真实调用）与真实模型阶段
// （推荐→结构化确认→A/B/C基线→审查→HTTP采用，全部走当前实现的真实HTTP路由）明确分离。
// 预算硬停止：真实调用>100次或累计>600000 tokens即抛错终止；外层用timeout限制墙钟。
// 凭据只来自进程环境（部署env文件source后注入），不写入任何文件/日志/输出。
// 用法：node s1a-http-real-probe.mjs <workspaceRoot>
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { resolve, basename } from 'node:path';
import { writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createProbeBudgetGuard, decideProbeOutcome } from './s1a-probe-budget.mjs';

const root = resolve(process.argv[2] ?? '');
if (!root.startsWith('/tmp/wenmi-s1a-probe')) throw Error('Probe requires isolated /tmp/wenmi-s1a-probe workspace');
// 隔离端口固定43199：不得继承部署env的WENMI_API_PORT（那会撞生产监听）
const PORT = 43199;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADERS = { host: `127.0.0.1:${PORT}`, origin: BASE, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const BUDGET = { maxCalls: 100, maxTokens: 600000 };

process.env.WENMI_PROJECT_ROOT = root;
process.env.WENMI_DATA_DIR = resolve(root, 'data');
process.env.WENMI_API_HOST = '127.0.0.1';
process.env.WENMI_API_PORT = String(PORT);
process.env.WENMI_WEB_ORIGIN = BASE;
delete process.env.WENMI_PUBLIC_ORIGIN;
delete process.env.WENMI_ADMIN_ORIGIN;

const moduleAt = p => import(pathToFileURL(resolve(root, p)).href);
const { loadRuntimeConfig } = await moduleAt('apps/api/dist/infrastructure/runtime-config.js');
const { bootstrapDatabase } = await moduleAt('apps/api/dist/infrastructure/db/bootstrap.js');
const { createAppServer } = await moduleAt('apps/api/dist/http/app-server.js');
const { ModelAdapterFactory } = await moduleAt('apps/api/dist/infrastructure/models/model-adapter-factory.js');
const { thinkingTokenAllowance } = await moduleAt('apps/api/dist/infrastructure/models/model-runtime-config.js');
const probeThinkingAllowance = (modelId, maxOutputTokens, promptBytes) => thinkingTokenAllowance(modelId, 'structured_planning', maxOutputTokens, Math.ceil(promptBytes / 3));

// ---------- 确定性夹具（准备阶段专用；与浏览器harness同构，真实阶段不经过这里） ----------
const settingStagePrompt = compiled => {
  try {
    const value = JSON.parse(compiled);
    const payload = value?.contextPack?.content?.stageTaskPayload;
    if (typeof payload === 'string') return payload;
    if (payload !== undefined) return JSON.stringify(payload);
  } catch { /* 未编译提示 */ }
  return compiled;
};
const groupedSettingOutput = prompt => {
  const match = prompt.match(/【本组要完成的设定】(\[[^\n]+\])/u);
  const items = JSON.parse(match?.[1] ?? '[]');
  return JSON.stringify({ items: items.map(item => ({
    itemKey: item.itemKey, content: `${item.label}以东汉末年的真实社会条件为边界，人物行动服从交通、粮食、身份与制度限制。`,
    designRationale: `先立稳${item.label}的硬边界。`, contextSummary: `${item.label}遵守时代边界。`,
    factEntries: [`${item.label}必须服从东汉末年限制。`], storyConsequences: ['设计必须检查现实条件'], dependencies: ['开书资料'], risks: [],
    selfReview: { verdict: 'pass', summary: '一致。', issues: [], suggestions: [] }
  })) });
};
const FIXTURE_SETTING = { markers: ['v7_setting_group_design_v1', 'v7_setting_batch_final_review', 'v7_compile_book_genre_profile_v1', '只判断后续设定阶段应该准备哪些条目', '你是副编', '你是设计成员', '你是设定连续性审查员', '候选：', '上次输出存在空字段'] };
const fixtureGenerate = (provider, modelId, prompt) => {
  const stage = settingStagePrompt(prompt);
  const output = stage.includes('v7_setting_group_design_v1') ? groupedSettingOutput(stage)
    : prompt.includes('v7_setting_batch_final_review_v1') ? JSON.stringify({ verdict: 'pass', summary: '全部设定跨条目核对一致。', unifiedDecisions: [], conflicts: [], patches: [] })
    : prompt.includes('v7_compile_book_genre_profile_v1') ? JSON.stringify({ primaryGenreKey: 'history', supportingGenreKeys: [], publicLabel: '历史穿越', workingIdentity: '以历史时代约束为主体。', primaryPromise: '主角在可信边界内立足。', supportingFunctions: [], writingPriorities: ['人物行动符合时代条件'], authenticityChecks: ['年代与物资一致'], avoidPatterns: ['现代知识无成本碾压'], conflictResolutions: [] })
    : prompt.includes('只判断后续设定阶段应该准备哪些条目') ? JSON.stringify({ requiredKeys: ['world-stage'], suggestedKeys: [], excludedKeys: [], summary: '先准备世界舞台。' })
    : prompt.includes('你是副编') ? JSON.stringify({ verifiedFacts: ['东汉末年制度存在地域差异'], uncertainPoints: [], usableBoundaries: ['不伪造史实'], translationForWriter: '把史实作为边界。' })
    : prompt.includes('你是设计成员') ? JSON.stringify({ content: '东汉末年秩序松动，交通、粮食和户籍受战乱限制。', designRationale: '保持代入感。', storyConsequences: ['分卷考虑粮道'], dependencies: ['开书时代'], risks: [] })
    : JSON.stringify({ verdict: 'pass', finalContent: '东汉末年秩序松动，历史事实作为边界。', summary: '一致。', issues: [], suggestions: [] });
  return { provider, modelId, output, inputTokens: 80, outputTokens: 160, cashCostCny: 0, state: 'succeeded' };
};

// ---------- 真实模型阶段（预算硬停止，30a6f053计量口径：成功与knownUsage失败都累计，未知单列不记0，发起前预留） ----------
const config = loadRuntimeConfig();
const factory = new ModelAdapterFactory(config.modelRuntime);
let live = false;
const log = event => console.log(JSON.stringify(event));
const guard = createProbeBudgetGuard(BUDGET);
const resolver = { resolve(provider, modelId, purpose) {
  const adapter = factory.resolve(provider, modelId, purpose);
  return { provider, modelId, async generate(request, signal) {
    if (!live) return fixtureGenerate(provider, modelId, request.prompt);
    const promptBytes = Buffer.byteLength(request.prompt, 'utf8');
    guard.beforeDispatch(String(request.requestId), { promptBytes, maxOutputTokens: request.maxOutputTokens, reasoningAllowance: probeThinkingAllowance(modelId, request.maxOutputTokens, promptBytes) });
    try {
      const result = await adapter.generate(request, signal);
      guard.onSuccess(String(request.requestId), result);
      log({ event: 'model_complete', model: result.modelId, input: result.inputTokens, output: result.outputTokens, cash: result.cashCostCny ?? 0 });
      return result;
    } catch (error) {
      if (error && typeof error === 'object' && error.knownUsage && Number.isSafeInteger(error.knownUsage.inputTokens)) {
        guard.onKnownFailure(String(request.requestId), error.knownUsage);
        log({ event: 'model_failed_known', model: modelId, input: error.knownUsage.inputTokens, output: error.knownUsage.outputTokens, cause: error.causeCode ?? error.failureClass ?? 'none' });
      } else {
        guard.onUnknownFailure(String(request.requestId));
        log({ event: 'model_failed_unknown', model: modelId });
      }
      throw error;
    }
  } };
} };

const config2 = config; // loadRuntimeConfig已在env覆盖后调用；DB与应用按该配置组装
const databaseFile = `probe-${randomUUID()}.sqlite`;
const db = new DatabaseSync(resolve(root, databaseFile)); chmodSync(resolve(root, databaseFile), 0o600);
db.exec('PRAGMA foreign_keys=ON');
bootstrapDatabase(db, config2);
const app = await createAppServer(config2, db, { timeMachineWindowTokens: 64000, v7OpeningModelAdapters: resolver });
await app.listen({ host: '127.0.0.1', port: PORT });
const startedAt = Date.now();

const call = async (method, path, payload, cookie) => {
  const response = await fetch(BASE + path, { method, headers: { ...HEADERS, ...(cookie ? { cookie } : {}) }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const text = await response.text();
  let body = null; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  return { status: response.status, body, cookie: String(response.headers.get('set-cookie') ?? '').split(';')[0] || cookie };
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (what, timeoutMs, check) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`等待超时：${what}`);
    await wait(2000);
  }
};
let bookId = '';
const getState = async cookie => (await call('GET', '/api/time-machine/books/' + bookId + '/state', undefined, cookie)).body.data;

try {
  // ===== 确定性准备阶段（零真实模型调用） =====
  const email = 's1a-probe@example.test';
  const register = await call('POST', '/api/v1/auth/register', { email, password: 'strong-pass-probe-1', displayName: '探针作者' });
  if (register.status !== 200) throw Error('注册失败：' + JSON.stringify(register.body).slice(0, 200));
  const cookie = register.cookie;
  const openingPackage = {
    title: '机甲修仙·探针样本', positioning: {
      publishingPlatform: 'fanqie', channel: 'male', category: '历史脑洞', genres: ['历史脑洞'], tags: ['成长'],
      coreAppeal: '小人物在复杂世界中稳步成长。', targetReaders: '喜欢长篇成长的男频读者',
      expectedTotalWords: 600000, volumePlan: { minimum: 3, recommended: 4, maximum: 6 },
      retentionPositioning: '开篇快速建立处境，逐卷兑现成长。'
    },
    backgrounds: { eraAndWorld: '东汉末年', openingSituation: '主角处于社会底层。' },
    protagonists: [{ name: '林舟', age: '23岁', identity: '男主', background: '修理工', familyBackground: '普通家庭', careerBackground: '', goldenFinger: '会修仙的机甲', goal: '活下去并改变处境', dilemma: '资源和身份不足', personality: ['谨慎'], boundary: '不能无代价解决问题' }],
    opening: { startingSituation: '工坊危机', incitingIncident: '危险订单', immediateConflict: '必须选择', readerPromise: '靠行动成长' },
    longTermDirection: { centralConflict: '个人与旧秩序', progression: '从底层到影响局势', relationshipDirection: '建立可信伙伴', storyPotential: '持续升级' },
    possibleEnding: { direction: '新秩序', price: '真实损失', openness: '保留空间' }, authorNotes: [], mustFollow: ['机甲不能无代价升级', '主角不能突然获得灵根']
  };
  const book = await call('POST', '/api/v1/v7/opening-books', { openingPackage, idempotencyKey: 'probe-book' }, cookie);
  if (book.status !== 200) throw Error('建书失败：' + JSON.stringify(book.body).slice(0, 200));
  bookId = String(book.body.data.bookId);
  const batch = await call('POST', '/api/v1/v7/books/' + bookId + '/setting-batches', { selectedItemKeys: ['world-stage'], designMemberKey: 'planner-deepseek-v4-pro', idempotencyKey: 'probe-batch' }, cookie);
  if (batch.status !== 200) throw Error('设定批次失败：' + JSON.stringify(batch.body).slice(0, 200));
  const batchView = await waitFor('设定批次完成', 300000, async () => {
    const view = (await call('GET', '/api/v1/v7/books/' + bookId + '/setting-batches/' + batch.body.data.batchId, undefined, cookie)).body.data;
    return ['queued', 'working'].includes(view.status) ? null : view;
  });
  if (batchView.status !== 'awaiting_author') throw Error('设定批次未达awaiting_author：' + batchView.status);
  const confirmed = await call('POST', '/api/v1/v7/books/' + bookId + '/setting-items/confirm-all', { items: batchView.items.map(item => ({ itemKey: item.itemKey, expectedRevision: item.revision })) }, cookie);
  if (confirmed.status !== 200) throw Error('确认失败：' + JSON.stringify(confirmed.body).slice(0, 200));
  const review = await call('POST', '/api/v1/v7/books/' + bookId + '/setting-final-reviews', { idempotencyKey: 'probe-review' }, cookie);
  if (review.status !== 200) throw Error('总清单启动失败：' + JSON.stringify(review.body).slice(0, 200));
  const reviewView = await waitFor('总清单完成', 300000, async () => {
    const view = (await call('GET', '/api/v1/v7/books/' + bookId + '/setting-final-reviews/current', undefined, cookie)).body.data;
    return ['queued', 'working'].includes(view.status) ? null : view;
  });
  if (reviewView.status !== 'ready') throw Error('总清单未ready：' + reviewView.status);
  log({ event: 'prep_complete', fixtureOnly: true, elapsedMs: Date.now() - startedAt });

  // ===== 真实模型阶段：推荐（交接自动派工）→结构化确认→基线→审查→HTTP采用 =====
  live = true;
  log({ event: 'live_phase_begin', budget: BUDGET });
  const recRun = await waitFor('推荐完成', 25 * 60000, async () => {
    const state = await getState(cookie);
    const rec = (state.runs ?? []).find(r => r.kind === 'recommend');
    return rec && rec.state === 'succeeded' ? rec : null;
  });
  const lines = recRun.result?.lines ?? [];
  if (!Array.isArray(lines) || lines.length === 0 || !recRun.recommendationHash || !recRun.preparationVersion) throw Error('推荐缺少可用故事线/哈希/版本');
  const selection = {
    recommendationRunId: String(recRun.id), recommendationHash: String(recRun.recommendationHash),
    preparationVersion: String(recRun.preparationVersion),
    selectedLineIds: [String(lines[0].id)],
    addedLines: [{ title: '感情线', description: '与拥有独立追求的伴侣，在合作与分歧中发展感情。' }],
    shape: 'auto', ensemble: true, authorNote: '希望更热血一点，伙伴各有追求。'
  };
  log({ event: 'recommendation_ready', lines: lines.map(l => l.id), hash: selection.recommendationHash, version: selection.preparationVersion });
  const design = await call('POST', '/api/time-machine/books/' + bookId + '/design-runs', { idempotencyKey: 'probe-design', selection }, cookie);
  if (design.status !== 202 && design.status !== 200) throw Error('结构化确认失败：' + JSON.stringify(design.body).slice(0, 300));
  const created = design.body.data.runs;
  log({ event: 'design_round_created', runs: created.map(r => ({ id: r.id, scheme: r.scheme, state: r.state })) });
  // 终态判定（30a6f053）：三方案全终态失败→立即结束并写明各轮phase/error；全终态且有可采用→采用；否则继续等（有界）。
  const roundsDetail = state => (state?.runs ?? []).filter(r => r.kind === 'design').map(r => ({ scheme: r.scheme, state: r.state, phase: r.phase ?? null, message: r.message ?? null }));
  let outcome = null;
  const outcomeDeadline = Date.now() + 45 * 60000;
  for (;;) {
    const state = await getState(cookie);
    const decision = decideProbeOutcome((state?.runs ?? []).filter(r => r.kind === 'design'));
    if (decision.status === 'all-failed') {
      outcome = { ...decision, finalState: state };
      log({ event: 'all_schemes_failed_terminal', rounds: roundsDetail(state) });
      break;
    }
    if (decision.status === 'adoptable') { outcome = { ...decision, finalState: state }; break; }
    if (Date.now() > outcomeDeadline) throw Error('等待超时：方案未全部到达终态（' + JSON.stringify(roundsDetail(state)) + '）');
    await wait(20000);
  }
  const finalState = outcome.finalState;
  const usageSummary = guard.summary();
  const baseResult = {
    databaseFile, elapsedMs: Date.now() - startedAt,
    usage: usageSummary,
    rounds: roundsDetail(finalState),
    intent: (finalState.runs ?? []).find(r => r.kind === 'design')?.intent ?? null,
    recommend: { id: recRun.id, hash: selection.recommendationHash, version: selection.preparationVersion, lines: lines.map(l => l.id) }
  };
  if (outcome.status === 'all-failed') {
    writeFileSync(resolve(root, 'result.json'), JSON.stringify({ ...baseResult, success: false, error: '三套方案全部终态失败，未执行HTTP采用' }, null, 2), { mode: 0o600 });
    log({ event: 'probe_complete', success: false, usage: usageSummary, elapsedMs: baseResult.elapsedMs });
    process.exitCode = 2;
  } else {
    const adoptable = outcome.run;
    const adopt = await call('POST', '/api/time-machine/books/' + bookId + '/adoptions', { candidateId: adoptable.id, revision: adoptable.result.revision, expectedRevision: 0, idempotencyKey: 'probe-adopt' }, cookie);
    if (adopt.status !== 200) throw Error('HTTP采用失败：' + JSON.stringify(adopt.body).slice(0, 300));
    const afterAdopt = await getState(cookie);
    const success = afterAdopt.adopted !== null && afterAdopt.adopted !== undefined;
    const result = {
      ...baseResult, success,
      adopted: afterAdopt.adopted ? { revision: afterAdopt.adopted.revision, member: afterAdopt.adopted.member, scheme: adoptable.scheme } : null
    };
    writeFileSync(resolve(root, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    log({ event: 'probe_complete', success, adoptedScheme: adoptable.scheme, usage: guard.summary(), elapsedMs: result.elapsedMs });
    if (!success) process.exitCode = 2;
  }
} catch (error) {
  const state = cookie ? await getState(cookie).catch(() => null) : null;
  writeFileSync(resolve(root, 'result.json'), JSON.stringify({ databaseFile, success: false, error: String(error?.message ?? error).slice(0, 500), usage: guard.summary(), rounds: (state?.runs ?? []).filter(r => r.kind === 'design').map(r => ({ scheme: r.scheme, state: r.state, phase: r.phase ?? null, message: r.message ?? null })) }, null, 2), { mode: 0o600 });
  log({ event: 'probe_failed', error: String(error?.message ?? error).slice(0, 500), usage: guard.summary() });
  process.exitCode = 2;
} finally {
  await app.close(); db.close();
}
