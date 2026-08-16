// 本地截图编排：起 API+Web+Edge headless，登录后逐页截图，结束全部清理
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const OUT = resolve(ROOT, process.env.WENMI_SHOT_OUT ?? 'shots');
mkdirSync(OUT, { recursive: true });

const EMAIL = '595341366@qq.com';
const PASSWORD = process.env.WENMI_SHOT_PASSWORD;
if (!PASSWORD) { console.error('missing WENMI_SHOT_PASSWORD'); process.exit(1); }

const kids = [];
function run(command, name) {
  const p = spawn(command, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  p.stdout.on('data', () => {});
  p.stderr.on('data', () => {});
  kids.push({ p, name });
  return p;
}
async function cleanup() {
  for (const { p } of kids) {
    try { spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  }
  await new Promise((r) => setTimeout(r, 1500));
}
process.on('SIGINT', async () => { await cleanup(); process.exit(1); });

async function waitOk(url, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); if (r.status < 500) return true; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timeout waiting ${label}: ${url}`);
}

let msgId = 0;
const pending = new Map();
let ws;
function cdp(method, params = {}) {
  return new Promise((resolveC, reject) => {
    const id = ++msgId;
    pending.set(id, { resolveC, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  return r.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name) {
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(OUT, name), Buffer.from(r.data, 'base64'));
  console.log('shot:', name);
}

async function clickByText(texts, tag = 'button') {
  const expr = `(() => {
    const els = [...document.querySelectorAll('${tag}')];
    for (const t of ${JSON.stringify(texts)}) {
      const el = els.find((e) => e.textContent.trim().includes(t) && e.offsetParent !== null);
      if (el) { el.click(); return 'clicked:' + t; }
    }
    return 'not-found';
  })()`;
  return evaluate(expr);
}

async function main() {
  run('npm.cmd run dev -w @wenmi/api', 'api');
  run('npm.cmd run dev -w @wenmi/web', 'web');
  await waitOk('http://127.0.0.1:43111/health', 90000, 'api');
  console.log('api up');
  await waitOk('http://127.0.0.1:43110', 90000, 'web');
  console.log('web up');

  const edgePath = '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"';
  run(edgePath + ' --headless=new --remote-debugging-port=9222 --user-data-dir=' + process.env.TEMP + '\\wenmi-shot-profile --no-first-run --window-size=1440,900 about:blank', 'edge');
  await waitOk('http://127.0.0.1:9222/json/version', 30000, 'edge-cdp');
  await sleep(1500);
  const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');

  await new Promise((resolveWs, reject) => {
    ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = resolveWs;
    ws.onerror = reject;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id).resolveC(msg.result ?? {}); pending.delete(msg.id); }
    };
  });
  console.log('cdp connected');

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: 'http://127.0.0.1:43110' });
  await sleep(4000);

  // 登录：页面上下文跨站 fetch（same-site，cookie 可带）
  const loginResult = await evaluate(`fetch('http://127.0.0.1:43111/api/v1/auth/login', {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(PASSWORD)} })
  }).then((r) => r.status)`);
  console.log('login status:', loginResult);
  if (loginResult !== 200) throw new Error('login failed');
  await evaluate('location.reload(); "reloading"');
  await sleep(5000);

  console.log('bookshelf dump:', await evaluate(`[...document.querySelectorAll('button,a')].filter((e)=>e.offsetParent!==null).map((e)=>e.textContent.trim().replace(/\\s+/g,' ').slice(0,24)).slice(0,60)`));
  await shot('01-bookshelf.png');

  // 打开第一本书：点击书架上的书卡（找含有"章"或状态文字的卡片按钮）
  const openResult = await evaluate(`(() => {
    const els = [...document.querySelectorAll('button, [role="button"], a')].filter((e) => e.offsetParent !== null);
    const card = els.find((e) => /继续|打开|进入/.test(e.textContent) && e.textContent.length < 40) ?? els.find((e) => e.textContent.length > 6 && e.textContent.length < 60 && e.querySelector('strong,h3,b'));
    if (card) { card.click(); return 'opened:' + card.textContent.trim().slice(0, 30); }
    return 'no-book-card';
  })()`);
  console.log('open book:', openResult);
  await sleep(4000);
  console.log('in-book dump:', await evaluate(`[...document.querySelectorAll('button')].filter((e)=>e.offsetParent!==null).map((e)=>e.textContent.trim().replace(/\\s+/g,' ').slice(0,20)).slice(0,80)`));
  await shot('02-book-default.png');

  const tabs = [['信息', '03-tab-info'], ['设定', '04-tab-setting'], ['分卷', '05-tab-volume'], ['规划', '06-tab-event'], ['章纲', '07-tab-chapter'], ['正文', '08-tab-manuscript'], ['资料库', '09-tab-library'], ['取名', '10-tab-naming'], ['团队', '11-tab-team'], ['任务', '12-tab-tasks'], ['灵感', '13-tab-ideas']];
  for (const [label, name] of tabs) {
    const r = await clickByText([label]);
    console.log('tab', label, '->', r);
    await sleep(2500);
    await shot(`${name}.png`);
  }

  // 手机端视口
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  for (const [label, name] of tabs.slice(0, 8)) {
    await clickByText([label]);
    await sleep(2500);
    await shot(`m-${name}.png`);
  }
  console.log('done');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; }).finally(cleanup);
