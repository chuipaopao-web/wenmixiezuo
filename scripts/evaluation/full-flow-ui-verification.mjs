// 真实书籍全流程作者可见性验收：连接本地工作台，逐页核对设定、规划和十章正文。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const bookId = '85ec2145-c0e6-480a-b80c-8e62bcc45428';
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const evidenceDirectory = path.resolve('data', 'verification', 'full-flow-20260730');
const profileDirectory = path.resolve('data', 'ui-verification-cdp');
mkdirSync(evidenceDirectory, { recursive: true });

const edge = spawn(edgePath, [
  '--headless=new',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-gpu-compositing',
  '--no-sandbox',
  '--no-first-run',
  '--remote-debugging-pipe',
  `--user-data-dir=${profileDirectory}`,
  `http://127.0.0.1:43110/?book=${bookId}`
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let nextId = 0;
const pending = new Map();
let responseBuffer = Buffer.alloc(0);
let pageSessionId;

edge.stdio[4].on('data', (chunk) => {
  responseBuffer = Buffer.concat([responseBuffer, chunk]);
  while (true) {
    const delimiter = responseBuffer.indexOf(0);
    if (delimiter < 0) break;
    const payload = responseBuffer.subarray(0, delimiter).toString('utf8');
    responseBuffer = responseBuffer.subarray(delimiter + 1);
    if (payload.length === 0) continue;
    const message = JSON.parse(payload);
    if (!message.id || !pending.has(message.id)) continue;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message);
  }
});

function command(method, params = {}, sessionId) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP command timed out: ${method}`));
    }, 10_000);
    pending.set(id, { resolve, reject, timer });
    edge.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
}

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  }, pageSessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text ?? `Evaluation failed: ${expression}`);
  }
  return response.result?.result?.value;
}

async function clickButton(label) {
  const clicked = await evaluate(`(() => {
    const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
    const target = Array.from(document.querySelectorAll('button')).find(
      (button) => normalize(button.textContent) === ${JSON.stringify(label)}
    );
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Visible button not found: ${label}`);
  await sleep(1200);
}

async function bodyText() {
  return evaluate(`document.body.innerText.replace(/\\s+/g, ' ').trim()`);
}

async function screenshot(name) {
  const response = await command('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  }, pageSessionId);
  const target = path.join(evidenceDirectory, name);
  writeFileSync(target, Buffer.from(response.result.data, 'base64'));
  return target;
}

function assertIncludes(text, expected, scope) {
  if (!text.includes(expected)) {
    throw new Error(`${scope} does not visibly contain ${JSON.stringify(expected)}.`);
  }
}

function assertNoInternalLeak(text, scope) {
  const forbidden = [
    'content_json',
    'source_ids_json',
    'projection_id',
    'selected_manuscript',
    'artifact_type',
    '\\"title\\"',
    'dynamic'
  ];
  const leaked = forbidden.filter((value) => text.includes(value));
  if (leaked.length > 0) {
    throw new Error(`${scope} leaks internal fields: ${leaked.join(', ')}`);
  }
}

function assertNotIncludes(text, forbidden, scope) {
  if (text.includes(forbidden)) {
    throw new Error(`${scope} unexpectedly contains ${JSON.stringify(forbidden)}.`);
  }
}

const report = {
  bookId,
  startedAt: new Date().toISOString(),
  checks: [],
  screenshots: []
};

function record(name, text, required) {
  report.checks.push({
    name,
    required,
    visibleTextLength: text.length,
    excerpt: text.slice(0, 1600)
  });
}

try {
  let page;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const targets = await command('Target.getTargets');
    page = targets.result.targetInfos.find(
      (target) => target.type === 'page' && target.url.includes('127.0.0.1:43110')
    );
    if (page) break;
    await sleep(200);
  }
  if (!page) throw new Error('Edge page target did not become ready.');
  const attached = await command('Target.attachToTarget', {
    targetId: page.targetId,
    flatten: true
  });
  pageSessionId = attached.result.sessionId;

  await command('Runtime.enable', {}, pageSessionId);
  await command('Page.enable', {}, pageSessionId);
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false
  }, pageSessionId);
  await sleep(5000);

  let text = await bodyText();
  assertIncludes(text, '这游戏上线就给钱', '工作台');
  assertIncludes(text, '本地服务已就绪', '工作台');
  record('工作台已连接并选中目标书籍', text, ['书名', '服务就绪']);
  report.screenshots.push(await screenshot('01-chat.png'));

  await clickButton('规划');
  text = await bodyText();
  assertIncludes(text, '本书资料', '规划-本书资料');
  assertIncludes(text, '游戏体育', '规划-本书资料');
  assertIncludes(text, '游戏异界', '规划-本书资料');
  assertIncludes(text, '历史脑洞', '规划-本书资料');
  assertNoInternalLeak(text, '规划-本书资料');
  record('本书资料与开书分类题材一致', text, ['本书资料', '游戏体育', '游戏异界', '历史脑洞']);

  await clickButton('设定大纲');
  text = await bodyText();
  assertIncludes(text, '60 / 60', '规划-设定大纲');
  assertIncludes(text, '世界与环境', '规划-设定大纲');
  assertIncludes(text, '能力、特性与技能', '规划-设定大纲');
  assertNoInternalLeak(text, '规划-设定大纲');
  record('设定大纲60项全部在前端确认', text, ['60 / 60', '世界与环境', '能力、特性与技能']);
  report.screenshots.push(await screenshot('02-setting-outline.png'));

  await clickButton('剧情总纲');
  text = await bodyText();
  assertIncludes(text, '剧情总纲', '规划-剧情总纲');
  assertIncludes(text, '夏炎', '规划-剧情总纲');
  assertNoInternalLeak(text, '规划-剧情总纲');
  record('剧情总纲可见且属于当前书', text, ['剧情总纲', '夏炎']);
  report.screenshots.push(await screenshot('03-master-outline.png'));

  await clickButton('章纲');
  text = await bodyText();
  assertIncludes(text, '零元开局', '规划-章纲');
  assertIncludes(text, '模糊的脚印', '规划-章纲');
  assertNotIncludes(text, '卷纲', '规划-章纲');
  assertNoInternalLeak(text, '规划-章纲');
  record('第1—10章章纲可见', text, ['零元开局', '模糊的脚印']);
  record('规划页不再提供独立卷纲入口', text, ['章纲']);
  report.screenshots.push(await screenshot('04-chapter-outlines.png'));

  await clickButton('正文');
  text = await bodyText();
  assertIncludes(text, '章节列表', '正文工作台');
  assertIncludes(text, '10 章', '正文工作台');
  assertIncludes(text, '零元开局', '正文工作台');
  assertIncludes(text, '模糊的脚印', '正文工作台');
  assertIncludes(text, '已定稿', '正文工作台');
  assertNotIncludes(text, '受阻', '正文工作台的已结算章节状态');
  assertNoInternalLeak(text, '正文工作台');
  record('正文工作台列出10章定稿', text, ['章节列表', '10 章', '零元开局', '模糊的脚印', '已定稿']);

  const clickedChapter = await evaluate(`(() => {
    const target = Array.from(document.querySelectorAll('button')).find(
      (button) => String(button.textContent ?? '').includes('模糊的脚印')
    );
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!clickedChapter) throw new Error('The tenth chapter is not clickable in the manuscript list.');
  await sleep(1800);
  text = await bodyText();
  assertIncludes(text, '天没亮透', '第10章正文');
  assertIncludes(text, '赵脱生', '第10章正文');
  assertIncludes(text, '潮腥', '第10章正文');
  assertNoInternalLeak(text, '第10章正文');
  record('第10章全文可读', text, ['天没亮透', '赵脱生', '潮腥']);
  report.screenshots.push(await screenshot('06-manuscript-chapter10.png'));

  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(
    path.join(evidenceDirectory, 'ui-flow-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );
  try {
    await command('Browser.close');
  } catch {
    // The report is already persisted; best-effort browser shutdown only.
  }
  if (!edge.killed) edge.kill();
}

console.log(JSON.stringify(report, null, 2));
