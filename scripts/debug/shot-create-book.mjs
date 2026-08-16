// 本地截图：建书向导 4 步。起 API+Web+Edge headless，登录后打开新建书籍逐步截图，结束清理
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const OUT = resolve(ROOT, process.env.WENMI_SHOT_OUT ?? 'shots-create');
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
  await waitOk('http://127.0.0.1:43110', 90000, 'web');

  const edgePath = '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"';
  run(edgePath + ' --headless=new --remote-debugging-port=9223 --user-data-dir=' + process.env.TEMP + '\\wenmi-shot-profile-cb --no-first-run --window-size=1440,900 about:blank', 'edge');
  await waitOk('http://127.0.0.1:9223/json/version', 30000, 'edge-cdp');
  await sleep(1500);
  const targets = await (await fetch('http://127.0.0.1:9223/json/list')).json();
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

  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: 'http://127.0.0.1:43110' });
  await sleep(4000);

  const loginResult = await evaluate(`fetch('http://127.0.0.1:43111/api/v1/auth/login', {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(PASSWORD)} })
  }).then((r) => r.status)`);
  if (loginResult !== 200) throw new Error('login failed');
  await evaluate('location.reload(); "reloading"');
  await sleep(5000);

  console.log('open dialog:', await clickByText(['新建书籍']));
  await sleep(2000);
  await shot('step1-start.png');

  console.log('next:', await clickByText(['下一步']));
  await sleep(2000);

  // 第2步：填必填项（书名、频道、分类、故事方向）
  await evaluate(`(() => {
    const dlg = document.querySelector('.complete-create-book-dialog');
    const setVal = (el, v) => { const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    setVal(dlg.querySelector('#complete-book-title'), '测试新书');
    return 'filled-title';
  })()`);
  await sleep(500);
  await evaluate(`(() => {
    const dlg = document.querySelector('.complete-create-book-dialog');
    const btns = [...dlg.querySelectorAll('.channel-options button')];
    if (btns[0]) btns[0].click();
    return 'channel';
  })()`);
  await sleep(1500);
  await evaluate(`(() => {
    const dlg = document.querySelector('.complete-create-book-dialog');
    const cats = [...dlg.querySelectorAll('.category-choice')];
    if (cats[0]) cats[0].click();
    return 'category:' + (cats[0]?.textContent ?? 'none');
  })()`);
  await sleep(800);
  await evaluate(`(() => {
    const dlg = document.querySelector('.complete-create-book-dialog');
    const ta = dlg.querySelector('#opening-story-direction');
    const setVal = (el, v) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    setVal(ta, '主角开篇就被卷入一桩旧案，不得不离开家乡追查真相，一路上结识伙伴，也一步步揭开自己的身世之谜。');
    return 'filled-direction';
  })()`);
  await sleep(500);
  await shot('step2-direction.png');

  console.log('next:', await clickByText(['下一步']));
  await sleep(2000);

  // 第3步：填主角必填 + 选一个性格
  await evaluate(`(() => {
    const dlg = document.querySelector('.complete-create-book-dialog');
    const setVal = (el, v) => { const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    setVal(dlg.querySelector('#opening-protagonist-name'), '林舟');
    setVal(dlg.querySelector('#opening-protagonist-age'), '十八岁');
    setVal(dlg.querySelector('#opening-protagonist-background'), '旧城区送报少年，父亲失踪，靠打零工养活妹妹。');
    const tag = dlg.querySelector('.personality-picker .tag-choice');
    if (tag) tag.click();
    return 'filled-protagonist';
  })()`);
  await sleep(800);
  await shot('step3-protagonist.png');

  console.log('next:', await clickByText(['下一步']));
  await sleep(2500);
  await shot('step4-tags.png');

  // 展开“必须遵守”和选填区已在第4步默认展开，截完
  await cleanup();
  console.log('done');
  process.exit(0);
}

main().catch(async (err) => { console.error(err); await cleanup(); process.exit(1); });
