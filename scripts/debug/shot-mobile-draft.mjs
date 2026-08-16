// 手机端建书草稿恢复验证：手机视口登录→填书名→关弹窗→重开→确认恢复
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const OUT = resolve(ROOT, 'shots-mobile-draft');
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

async function main() {
  run('npm.cmd run dev -w @wenmi/api', 'api');
  run('npm.cmd run dev -w @wenmi/web', 'web');
  await waitOk('http://127.0.0.1:43111/health', 90000, 'api');
  await waitOk('http://127.0.0.1:43110', 90000, 'web');

  const edgePath = '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"';
  run(edgePath + ' --headless=new --remote-debugging-port=9224 --user-data-dir=' + process.env.TEMP + '\\wenmi-shot-profile-md --no-first-run about:blank', 'edge');
  await waitOk('http://127.0.0.1:9224/json/version', 30000, 'edge-cdp');
  await sleep(1500);
  const targets = await (await fetch('http://127.0.0.1:9224/json/list')).json();
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
  // 手机视口（iPhone 14 Pro 尺寸）
  await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 2, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
  await cdp('Page.navigate', { url: 'http://127.0.0.1:43110' });
  await sleep(4000);

  const loginResult = await evaluate(`fetch('http://127.0.0.1:43111/api/v1/auth/login', {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(PASSWORD)} })
  }).then((r) => r.status)`);
  if (loginResult !== 200) throw new Error('login failed');
  await evaluate('location.reload(); "reloading"');
  await sleep(5000);

  // 清掉可能存在的旧草稿，保证从干净状态开始
  await evaluate(`Object.keys(localStorage).filter((k) => k.includes('opening')).forEach((k) => localStorage.removeItem(k)); 'cleared'`);

  // 手机端先展开书籍栏（如果折叠），再点新建书籍
  const openR = await evaluate(`(() => {
    const els = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null);
    const el = els.find((e) => e.textContent.trim().includes('新建书籍'));
    if (el) { el.click(); return 'clicked'; }
    return 'not-found';
  })()`);
  console.log('open dialog:', openR);
  await sleep(2500);

  // 第1步点下一步到第2步，填书名
  await evaluate(`(() => {
    const btns = [...document.querySelectorAll('.complete-create-book-dialog button')].filter((e) => e.offsetParent !== null);
    const next = btns.find((e) => e.textContent.trim() === '下一步');
    if (next) next.click();
    return 'next';
  })()`);
  await sleep(1500);
  await evaluate(`(() => {
    const input = document.querySelector('#complete-book-title');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '手机草稿测试书');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'filled';
  })()`);
  await sleep(2500); // 等防抖自动保存
  await shot('m1-filled.png');

  // 关闭弹窗（点取消）
  await evaluate(`(() => {
    const btns = [...document.querySelectorAll('.complete-create-book-dialog button')].filter((e) => e.offsetParent !== null);
    const cancel = btns.find((e) => e.textContent.trim() === '取消');
    if (cancel) cancel.click();
    return 'cancelled';
  })()`);
  await sleep(1500);

  // 重新打开
  await evaluate(`(() => {
    const els = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null);
    const el = els.find((e) => e.textContent.trim().includes('新建书籍'));
    if (el) { el.click(); return 'clicked'; }
    return 'not-found';
  })()`);
  await sleep(2500);
  await shot('m2-reopened.png');

  // 验证：提示条 + 书名值 + 所在步骤
  const result = await evaluate(`(() => {
    const dlg = document.querySelector('.complete-create-book-dialog');
    if (!dlg) return { dialog: false };
    const notice = dlg.querySelector('.opening-draft-notice');
    const input = dlg.querySelector('#complete-book-title');
    const eyebrow = dlg.querySelector('.dialog-eyebrow');
    return {
      dialog: true,
      noticeText: notice ? notice.textContent.trim() : null,
      titleValue: input ? input.value : '(无书名框，可能停在第1步)',
      step: eyebrow ? eyebrow.textContent.trim() : null
    };
  })()`);
  console.log('VERIFY RESULT:', JSON.stringify(result, null, 2));

  // 清理：清空草稿，避免污染老板下次手动测试
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.opening-draft-notice button')][0];
    if (btn) btn.click();
    return 'draft-cleared';
  })()`);
  await sleep(1000);

  await cleanup();
  console.log('done');
  process.exit(0);
}

main().catch(async (err) => { console.error(err); await cleanup(); process.exit(1); });
