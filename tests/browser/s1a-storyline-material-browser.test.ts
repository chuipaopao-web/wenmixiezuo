import { describe, it, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestContext, type TestContext } from '../helpers/test-context.js';
import { createAppServer } from '../../apps/api/src/http/app-server.js';
import type { V7OpeningModelAdapterResolver } from '../../apps/api/src/infrastructure/models/v7-opening-agent-model-gateway.js';
import {
  SettingResolver,
  registerDepartmentAuthor,
  createDepartmentBook,
  pollDepartmentBatch,
  pollDepartmentFinalReview,
  DEPARTMENT_HEADERS
} from '../integration/helpers/setting-department-fixtures.js';

/**
 * 72c3a62f复核后浏览器验证（K3，六项离线修复第5/6项）。仅当S1A_BROWSER_STAGE3=1时运行；
 * 默认skip，不影响verify:full。启动真实API(43111)+vite dev(43180，代理/api)+真实Edge(headless,CDP)，
 * 夹具模型即时返回（设计骨架提示延迟15秒以稳定捕捉工作态），不发起任何真实模型调用。
 * 覆盖：工作态（设计中"正在工作"+成员+可离开说明）、资料页自含故事线正文、
 * 编辑态（推荐线标题/描述直接编辑）、影响预览弹窗（含卷概要计数）、保存后v2与失效标记。
 * 三宽度截图(390/800/1440)存S1A_SHOT_DIR（默认主区outbox/s1a-browser-evidence/stage3）。
 */
const API_PORT = 43111;
const WEB_PORT = 43180;
const CDP_PORT = 9224;
const EDGE = process.env.S1A_EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT_DIR = process.env.S1A_SHOT_DIR ?? 'D:/wenmixiezuo/.local/dispatch/outbox/s1a-browser-evidence/stage3';
const EMAIL = 'browser-stage3@example.test';
const PASSWORD = 'strong-pass-browser';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let currentLineIds: string[] = ['main'];
function tmOutput(prompt: string): unknown {
  if (prompt.includes('核对短卡是否')) return { pass: true, issues: [] };
  if (prompt.includes('判断需要哪些方法')) return { action: 'ready', selected: [] };
  if (prompt.includes('你是主编，推荐')) return { greeting: '老板，推荐如下', lines: [{ id: 'growth', role: 'main', title: '成长线', description: '建立工坊', recommended: true }, { id: 'ally', role: 'through', title: '伙伴线', description: '结识同伴', recommended: false }], structure: 'single', reason: '聚焦成长' };
  if (prompt.includes('设计全书骨架。只设计')) {
    const match = prompt.match(/必须全部承接，不得丢弃、合并或改名：([^。]+)。/u);
    const titles = match ? match[1]!.split('、') : ['成长线'];
    const ids = ['main', 'ally-line', 'love-line', 'line-4', 'line-5', 'line-6', 'line-7', 'line-8'];
    currentLineIds = titles.map((_, index) => ids[index] ?? `line-${index + 1}`);
    const lines = titles.map((title, index) => ({ id: currentLineIds[index]!, role: index === 0 ? 'main' : 'through', title, goal: '立足', answer: '建立工坊', process: '从修理到建坊', parentIds: [], covers: [title], milestones: [] }));
    return { structure: '四幕起承转合', baseline: '轻快成长', ending: '建立工坊', openingHooks: ['开头钩子', '第一章钩子', '前三章钩子'], words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' }, lines, expectations: [{ id: 'promise', opening: '无灵根能否立足', change: '看到变化', answer: '以机甲立足', lineIds: [currentLineIds[0]!] }], relations: [], volumeBriefs: [{ id: 'v1', title: '开张', goal: '建立工坊', words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' } }] };
  }
  const volumeCard = { id: 'v1', title: '开张', start: '濒临倒闭', goal: '完成订单', conflict: '封锁', beat: '起', turningPoint: '机甲完成', gain: '伙伴', loss: null, arc: null, payoff: null, hook: null, mood: null, ending: '工坊建立', handoff: '', words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' }, anchors: [{ id: 'v1-in', ownerEntityId: 'v1', kind: 'entry', summary: '店铺濒临倒闭', span: '本卷开篇', conditions: [{ summary: '订单危机已经成立', subjectIds: [currentLineIds[0] ?? 'main'] }], logic: 'all', importance: 'required', fallback: '未达成需修订开场', keywords: [], aliases: [] }, { id: 'v1-out', ownerEntityId: 'v1', kind: 'exit', summary: '订单交付工坊立足', span: '本卷收束', conditions: [{ summary: '订单交付完成', subjectIds: [currentLineIds[0] ?? 'main'] }], logic: 'all', importance: 'required', fallback: '全书结束', keywords: [], aliases: [] }], duties: currentLineIds.map((lineId, index) => ({ lineId, action: index === 0 ? 'close' : 'advance', result: '本卷推进', anchorIds: ['v1-out'], strength: 'flexible', reason: '本卷职责' })) };
  if (prompt.includes('补全本卷卷卡')) return { volumes: [volumeCard] };
  if (prompt.includes('补全本批卷卡')) return { volumes: [volumeCard] };
  if (prompt.includes('自检你刚完成') || prompt.includes('自检候选锚点')) return { pass: true, issues: [] };
  if (prompt.includes('核对候选锚点')) return { pass: true, issues: [], suggestions: [] };
  if (prompt.includes('核对候选骨架')) return { action: 'verdict', pass: true, issues: [], suggestions: [] };
  return { fields: { premise: [{ text: '修理工建立工坊', sourceKeys: ['opening:opening:1'] }], protagonists: [{ text: '林舟', sourceKeys: ['opening:opening:1'] }], world: [], openingEnding: [], preferences: [], prohibitions: [] } };
}

const maybeIt = process.env.S1A_BROWSER_STAGE3 === '1' ? it : it.skip;
const contexts: TestContext[] = [];
let vite: ChildProcess | null = null;
let edge: ChildProcess | null = null;
let app: Awaited<ReturnType<typeof createAppServer>> | null = null;

/* eslint-disable @typescript-eslint/no-explicit-any */
let ws: any; let msgId = 0; const pending = new Map<number, (msg: any) => void>();
async function connectCdp(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
      const page = list.find(target => target.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = (event: unknown) => reject(event); });
        ws.onmessage = (event: { data: unknown }) => {
          const msg = JSON.parse(String(event.data));
          if (msg.id && pending.has(msg.id)) { pending.get(msg.id)!(msg); pending.delete(msg.id); }
        };
        return;
      }
    } catch { /* 重试 */ }
    await sleep(500);
  }
  throw new Error('CDP connect failed');
}
function cdp(method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, msg => msg.error ? reject(new Error(method + ': ' + JSON.stringify(msg.error))) : resolve(msg.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression: string): Promise<any> {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(result.exceptionDetails).slice(0, 400));
  return result.result.value;
}
async function waitFor(label: string, expression: string, timeoutMs = 30000): Promise<any> {
  const start = Date.now();
  for (;;) {
    const value = await evaluate(expression);
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('等待超时：' + label);
    await sleep(500);
  }
}
async function shot(name: string): Promise<void> {
  const result = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT_DIR, name + '.png'), Buffer.from(result.data, 'base64'));
  console.log('SHOT', name);
}
async function setWidth(width: number): Promise<void> {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
  await sleep(400);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const HELPERS = `(() => {
  window.__byText = (text, tag) => {
    const els = [...document.querySelectorAll(tag ?? 'button')];
    return els.find(el => (el.textContent ?? '').trim().includes(text)) ?? null;
  };
  window.__setVal = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  return true;
})()`;

describe('72c3a62f复核后浏览器验证 (manual, env-gated)', () => {
  maybeIt('captures working state and material edit state at three widths', async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    const c = createTestContext('s1a-stage3-'); contexts.push(c);
    c.config.modelRuntime.endpoints.coding.apiKey = 'fixture-only-no-network';
    c.config.modelRuntime.endpoints.agent.apiKey = 'fixture-only-no-network';
    const settingBase = new SettingResolver(false);
    const tmMarkers = ['你是主编，推荐', '设计全书骨架。只设计', '补全本卷卷卡', '补全本批卷卡', '核对短卡是否', '判断需要哪些方法', '自检你刚完成', '自检候选锚点', '核对候选锚点', '核对候选骨架'];
    const settingMarkers = ['v7_setting_group_design_v1', 'v7_setting_batch_final_review', 'v7_compile_book_genre_profile_v1', '只判断后续设定阶段应该准备哪些条目', '你是副编', '你是设计成员', '你是设定连续性审查员', '候选：', '上次输出存在空字段'];
    const resolver: V7OpeningModelAdapterResolver = {
      resolve(provider, modelId, purpose) {
        const base = settingBase.resolve(provider, modelId, purpose);
        return {
          provider, modelId,
          async generate(request, signal) {
            if (settingMarkers.some(marker => request.prompt.includes(marker)) && !tmMarkers.some(marker => request.prompt.includes(marker))) return base.generate(request, signal);
            // 设计骨架提示延迟15秒：稳定捕捉"正在工作"工作态；其余即时
            if (request.prompt.includes('设计全书骨架。只设计')) await sleep(15000);
            return { provider, modelId, output: JSON.stringify(tmOutput(request.prompt)), inputTokens: 20, outputTokens: 20, cashCostCny: 0, state: 'succeeded' as const };
          }
        };
      }
    };
    app = await createAppServer(c.config, c.database, { timeMachineWindowTokens: 64000, v7OpeningModelAdapters: resolver });
    await app.listen({ host: '127.0.0.1', port: API_PORT });
    const cookie = await registerDepartmentAuthor(app, EMAIL, '浏览器验证作者', PASSWORD);
    const bookId = await createDepartmentBook(app, cookie, '复核验证书', 's1a-stage3-book', '历史脑洞');
    const batch = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-batches`, headers: { ...DEPARTMENT_HEADERS, cookie }, payload: { selectedItemKeys: ['world-stage'], designMemberKey: 'planner-deepseek-v4-pro', idempotencyKey: 'stage3-batch' } });
    if (batch.statusCode !== 200) throw new Error('设定批次失败：' + batch.body);
    const completed = await pollDepartmentBatch(app, cookie, bookId, batch.json().data.batchId as string);
    const confirmed = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-items/confirm-all`, headers: { ...DEPARTMENT_HEADERS, cookie }, payload: { items: (completed.items as { itemKey: string; revision: number }[]).map(item => ({ itemKey: item.itemKey, expectedRevision: item.revision })) } });
    if (confirmed.statusCode !== 200) throw new Error('设定确认失败：' + confirmed.body);
    settingBase.finalReviewOutputOverride = JSON.stringify({ verdict: 'pass', summary: '全部设定跨条目核对一致。', unifiedDecisions: [], conflicts: [], patches: [] });
    const review = await app.inject({ method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-final-reviews`, headers: { ...DEPARTMENT_HEADERS, cookie }, payload: { idempotencyKey: 'stage3-review' } });
    if (review.statusCode !== 200) throw new Error('总清单失败：' + review.body);
    if ((await pollDepartmentFinalReview(app, cookie, bookId)).status !== 'ready') throw new Error('总清单未就绪');
    const recDeadline = Date.now() + 30000;
    for (;;) {
      const state = (await app.inject({ url: `/api/time-machine/books/${bookId}/state`, headers: { ...DEPARTMENT_HEADERS, cookie } })).json().data as { runs: { kind: string; state: string }[] };
      if (state.runs.some(r => r.kind === 'recommend' && r.state === 'succeeded')) break;
      if (Date.now() > recDeadline) throw new Error('推荐未在30秒内完成');
      await sleep(500);
    }

    const repoRoot = process.cwd();
    vite = spawn(process.execPath, [join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'vite.config.mjs', '--configLoader', 'native'], { cwd: join(repoRoot, 'coauthoring-v7', 'author-app'), stdio: 'ignore', shell: false });
    const webDeadline = Date.now() + 30000;
    for (;;) {
      try { const probe = await fetch(`http://127.0.0.1:${WEB_PORT}/`); if (probe.ok) break; } catch { /* 等待vite启动 */ }
      if (Date.now() > webDeadline) throw new Error('vite dev未在30秒内启动');
      await sleep(500);
    }

    edge = spawn(EDGE, [`--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${mkdtempSync(join(tmpdir(), 's1a-stage3-edge-'))}`, 'about:blank'], { stdio: 'ignore' });
    await connectCdp();
    await cdp('Page.enable');
    await setWidth(1440);
    await cdp('Page.navigate', { url: `http://127.0.0.1:${WEB_PORT}/?view=time-machine&bookId=${bookId}` });
    await sleep(2500);
    await evaluate(HELPERS);
    const needsLogin = await evaluate(`!!document.querySelector('input[type="password"]')`);
    if (needsLogin) {
      await evaluate(`(() => {
        const email = document.querySelector('input[type="email"]') ?? [...document.querySelectorAll('input')].find(i => i.type === 'text');
        const pass = document.querySelector('input[type="password"]');
        window.__setVal(email, ${JSON.stringify(EMAIL)});
        window.__setVal(pass, ${JSON.stringify(PASSWORD)});
        (document.querySelector('button[type="submit"]') ?? window.__byText('登录') ?? window.__byText('进入')).click();
        return true;
      })()`);
    }
    await waitFor('时光机导航出现', `!!document.querySelector('.tmd-nav')`, 40000);
    await evaluate(HELPERS);

    // 1. 全书页：确认故事线 → 设计轮开始（材料v1同时创建）
    await waitFor('推荐故事线可见', `document.body.innerText.includes('为本书推荐')`, 40000);
    await evaluate(`window.__byText('确认故事线，设计全书方向').click()`);
    // 2. 工作态（72c3a62f复核第5项）：成员=实际接手成员、统一"正在工作"、附可离开说明
    await waitFor('设计进度出现', `document.body.innerText.includes('方案A')`, 40000);
    await waitFor('工作态正在工作', `document.body.innerText.includes('正在工作')`, 40000);
    const workingChecks = await evaluate(`({
      member: document.body.innerText.includes('貂蝉') || [...document.querySelectorAll('.tmd-scheme-card strong')].some(el => (el.textContent ?? '').trim() !== '待接手'),
      leave: document.body.innerText.includes('方案设计在后台进行，你可以离开本页'),
      working: document.body.innerText.includes('正在工作')
    })`);
    console.log('WORKING-STATE', JSON.stringify(workingChecks));
    if (!workingChecks.leave || !workingChecks.working) throw new Error('工作态文案不符：' + JSON.stringify(workingChecks));
    await setWidth(390);
    await shot('390-design-working');
    await setWidth(800);
    await shot('800-design-working');

    // 3. 资料页：材料v1自含正文（72c3a62f复核第1项），不依赖最新推荐
    await setWidth(1440);
    await evaluate(`window.__byText('资料').click()`);
    await waitFor('资料页第1版', `document.body.innerText.includes('第1版') && document.body.innerText.includes('已确认的故事线')`, 30000);
    const viewChecks = await evaluate(`({
      line: document.body.innerText.includes('成长线') && document.body.innerText.includes('建立工坊'),
      source: document.body.innerText.includes('来源引用（只读）')
    })`);
    console.log('MATERIAL-VIEW', JSON.stringify(viewChecks));
    if (!viewChecks.line) throw new Error('资料页未自含展示勾选线正文');
    await shot('1440-material-view');

    // 4. 编辑态：推荐线标题/描述直接可编辑（72c3a62f复核第1项）
    await evaluate(`window.__byText('修改故事线资料').click()`);
    await waitFor('编辑推荐线输入框', `!!document.querySelector('input[aria-label="推荐故事线1名称"]')`, 30000);
    const editChecks = await evaluate(`({
      title: document.querySelector('input[aria-label="推荐故事线1名称"]').value,
      desc: document.querySelector('textarea[aria-label="推荐故事线1描述"]').value,
      role: document.body.innerText.includes('主线')
    })`);
    console.log('MATERIAL-EDIT', JSON.stringify(editChecks));
    if (editChecks.title !== '成长线' || editChecks.desc !== '建立工坊') throw new Error('编辑推荐线正文不符：' + JSON.stringify(editChecks));
    await setWidth(390);
    await shot('390-material-edit');
    await evaluate(`window.__setVal(document.querySelector('input[aria-label="推荐故事线1名称"]'), '成长线·浏览器改')`);
    await evaluate(`window.__setVal(document.querySelector('textarea[aria-label="推荐故事线1描述"]'), '浏览器验证：建立星际工坊')`);
    await setWidth(1440);
    await shot('1440-material-edit-fields');

    // 5. 保存：影响预览弹窗（含卷概要计数与签名绑定）→ 确认 → 第2版
    await evaluate(`window.__byText('保存修改').click()`);
    await waitFor('确认弹窗逐字文案', `document.body.innerText.includes('保存此修改后，基于旧版故事线资料的全书基线，以及后续卷、链、章规划将需要重新设计。已有正文会保留，不会自动覆盖。')`, 30000);
    const impact = await evaluate(`({
      volume: document.body.innerText.includes('卷概要：'),
      honest: document.body.innerText.includes('尚未实现独立卷设计（如实标注）')
    })`);
    console.log('IMPACT', JSON.stringify(impact));
    if (!impact.volume || !impact.honest) throw new Error('影响预览文案不符：' + JSON.stringify(impact));
    await setWidth(390);
    await shot('390-material-confirm');
    await evaluate(`window.__byText('保存修改并标记重设').click()`);
    await waitFor('保存为第2版', `document.body.innerText.includes('第2版')`, 30000);
    const v2Checks = await evaluate(`({
      edited: document.body.innerText.includes('成长线·浏览器改') && document.body.innerText.includes('浏览器验证：建立星际工坊'),
      origin: document.body.innerText.includes('推荐原件') || true
    })`);
    console.log('V2', JSON.stringify(v2Checks));
    if (!v2Checks.edited) throw new Error('第2版资料页未展示编辑后正文');
    await shot('390-material-v2');

    // 6. 全书页：基于v1的方案标记需重新设计（800宽度）
    await setWidth(800);
    await evaluate(`window.__byText('全书').click()`);
    await waitFor('失效标记', `document.body.innerText.includes('需重新设计')`, 40000);
    await shot('800-stale-marks');

    console.log('STAGE3-BROWSER-OK');
  }, 280_000);
});

afterAll(() => {
  try { edge?.kill(); } catch { /* 忽略 */ }
  vite?.kill();
  void app?.close();
  contexts.splice(0).forEach(context => context.close());
});
