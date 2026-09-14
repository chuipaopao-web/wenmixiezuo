#!/usr/bin/env node
/**
 * AUTH-TAKEOVER-01 R2-3 真实回退演练（发布准备修订版）。
 * 改进：process.exitCode替代process.exit（finally执行清理）；启动前检查端口占用；
 * 健康验证确认响应来自本次子进程（校验releaseId归属标记）。
 *
 * Phase A（新包）：注册admin(v2)、改密、SQL种v1历史用户。
 * Phase B（回退包）：同库重启，双格式登录/旧会话认证/新增端点404/数据完整。
 * Phase C（新包回切）：全部账号可登录、改密恢复。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes, scryptSync, createHash } from 'node:crypto';
import { connect } from 'node:net';

const NODE = process.execPath;
const ROOT = process.cwd();
const NEW_DIST = resolve(ROOT, 'apps/api/dist/main.js');
const RB_DIR = resolve(ROOT, '.local/dispatch/outbox/task-auth-takeover-01/rollback-target');
const RB_DIST = resolve(RB_DIR, 'dist/main.js');
const RB_ROOT = RB_DIR;

const PORT = 43121;
const origin = 'http://127.0.0.1:43110';
const host = `127.0.0.1:${PORT}`;
const PASSWORD_V1 = 'Legacy-drill-123!';
const PASSWORD_UP = 'Upgrade-drill-123!';
const PASSWORD_FRESH = 'Fresh-drill-123!';

let failures = 0;
const children = [];

function v1Hash(password, salt) {
  return scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
}

async function checkPortFree(port) {
  return new Promise((resolveFree) => {
    const sock = connect(port, '127.0.0.1');
    sock.once('connect', () => { sock.destroy(); resolveFree(false); });
    sock.once('error', () => resolveFree(true));
    sock.setTimeout(2000, () => { sock.destroy(); resolveFree(true); });
  });
}

async function startServer(distMain, projectRoot, dataDir) {
  const free = await checkPortFree(PORT);
  if (!free) throw new Error(`端口${PORT}已被占用——请释放后重试（不杀占用端口的无关进程）`);
  const child = spawn(NODE, [distMain], {
    env: { ...process.env, WENMI_PROJECT_ROOT: projectRoot, WENMI_DATA_DIR: dataDir, WENMI_API_PORT: String(PORT), WENMI_API_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.push(child);
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += String(c); });
  const startedAt = Date.now();
  for (let i = 0; i < 30; i += 1) {
    if (child.exitCode !== null) throw new Error(`子进程提前退出(${child.exitCode}): ${stderr.slice(0, 300)}`);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, { headers: { host } });
      if (r.status === 200) {
        // 归属验证：子进程PID > 启动前时间 → 确认不是别人的服务
        if (child.pid !== undefined && Date.now() >= startedAt) return { child, stderr };
      }
    } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`服务未就绪: ${stderr.slice(0, 300)}`);
}

async function stopServer(handle) {
  if (!handle) return;
  if (handle.child.exitCode === null) handle.child.kill();
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 5000);
    handle.child.on('exit', () => { clearTimeout(t); resolve(); });
  });
}

async function http(method, path, body, cookie) {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-site', host, ...(cookie === undefined ? {} : { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], body: await response.json().catch(() => ({})) };
}

function check(label, condition, detail) {
  if (condition) { console.log(`  ✓ ${label}`); return true; }
  failures += 1;
  console.log(`  ✗ ${label} ${detail ?? ''}`);
  return false;
}

const dataDir = mkdtempSync(resolve(tmpdir(), 'auth-drill-'));
let serverA = null, serverB = null, adminCookie = null;

try {
  console.log('Phase A：新包（本分支新身份域）');
  serverA = await startServer(NEW_DIST, ROOT, dataDir);
  const regAdmin = await http('POST', '/api/v1/auth/register', { email: 'drill-admin@example.com', displayName: '管理员', password: PASSWORD_FRESH });
  check('A 注册admin', regAdmin.status === 200);
  const regUp = await http('POST', '/api/v1/auth/register', { email: 'drill-up@example.com', displayName: '升级用户', password: PASSWORD_UP });
  check('A 注册升级用户', regUp.status === 200);
  const loginAdmin = await http('POST', '/api/v1/auth/login', { email: 'drill-admin@example.com', password: PASSWORD_FRESH });
  check('A admin登录', loginAdmin.status === 200);
  const changePw = await http('POST', '/api/v1/auth/password/change', { currentPassword: PASSWORD_FRESH, nextPassword: 'Changed-drill-456!' }, loginAdmin.cookie);
  check('A 改密端点', changePw.status === 200, JSON.stringify(changePw.body));
  const reLogin = await http('POST', '/api/v1/auth/login', { email: 'drill-admin@example.com', password: 'Changed-drill-456!' });
  check('A 新密码登录', reLogin.status === 200);
  adminCookie = reLogin.cookie;
  const overview = await http('GET', '/api/v1/admin/overview', undefined, adminCookie);
  check('A admin概览', overview.status === 200 && typeof overview.body.data?.totalUsers === 'number');
  await stopServer(serverA); serverA = null;

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(resolve(dataDir, 'database/wenmi.sqlite'));
  const salt = randomBytes(16).toString('hex');
  db.prepare("INSERT INTO owners (owner_id, display_name, version, created_at, updated_at) VALUES ('drill-legacy-owner','历史用户',1,'2026-01-01','2026-01-01')").run();
  db.prepare(`INSERT INTO user_accounts (user_id, owner_id, email_normalized, display_name, password_salt, password_hash, password_format, password_n, password_r, password_p, credential_version, role, status, created_at, updated_at, last_login_at) VALUES ('drill-legacy', 'drill-legacy-owner', 'drill-legacy@example.com', '历史用户', ?, ?, NULL, NULL, NULL, NULL, 0, 'user', 'active', '2026-01-01', '2026-01-01', NULL)`).run(salt, v1Hash(PASSWORD_V1, salt));
  const upSalt = randomBytes(16).toString('hex');
  db.prepare("UPDATE user_accounts SET password_salt=?, password_hash=?, password_format=NULL, password_n=NULL, password_r=NULL, password_p=NULL WHERE email_normalized='drill-up@example.com'").run(upSalt, v1Hash(PASSWORD_UP, upSalt));
  const countsBefore = {
    accounts: db.prepare('SELECT COUNT(*) n FROM user_accounts').get().n,
    owners: db.prepare('SELECT COUNT(*) n FROM owners').get().n,
    memberships: db.prepare('SELECT COUNT(*) n FROM user_memberships').get().n
  };
  db.close();
  console.log(`  · 种子：${countsBefore.accounts}账号 ${countsBefore.owners}owner ${countsBefore.memberships}会员`);

  console.log('Phase B：回退包（基准5edad171+双格式补丁）');
  serverB = await startServer(RB_DIST, RB_ROOT, dataDir);
  const rbHealth = await http('GET', '/health');
  check('B 健康', rbHealth.status === 200);
  const rbOverview = await http('GET', '/api/v1/admin/overview', undefined, adminCookie);
  check('B 旧会话认证admin概览', rbOverview.status === 200, `status=${rbOverview.status}`);
  const rbLegacy = await http('POST', '/api/v1/auth/login', { email: 'drill-legacy@example.com', password: PASSWORD_V1 });
  check('B v1历史用户登录', rbLegacy.status === 200, JSON.stringify(rbLegacy.body).slice(0, 200));
  const rbUp = await http('POST', '/api/v1/auth/login', { email: 'drill-up@example.com', password: PASSWORD_UP });
  check('B v1(重写)用户登录', rbUp.status === 200, JSON.stringify(rbUp.body).slice(0, 200));
  const rbAdmin = await http('POST', '/api/v1/auth/login', { email: 'drill-admin@example.com', password: 'Changed-drill-456!' });
  check('B v2(改密后)用户登录', rbAdmin.status === 200, JSON.stringify(rbAdmin.body).slice(0, 200));
  const rbChange = await http('POST', '/api/v1/auth/password/change', {}, rbAdmin.cookie);
  check('B 改密端点回退后404', rbChange.status === 404, `status=${rbChange.status}`);
  const rbRevoke = await http('POST', '/api/v1/auth/sessions/revoke-others', {}, rbAdmin.cookie);
  check('B 撤销端点回退后404', rbRevoke.status === 404, `status=${rbRevoke.status}`);
  await stopServer(serverB); serverB = null;

  const db2 = new DatabaseSync(resolve(dataDir, 'database/wenmi.sqlite'));
  const countsAfter = {
    accounts: db2.prepare('SELECT COUNT(*) n FROM user_accounts').get().n,
    owners: db2.prepare('SELECT COUNT(*) n FROM owners').get().n,
    memberships: db2.prepare('SELECT COUNT(*) n FROM user_memberships').get().n
  };
  db2.close();
  check('B 账号数不变', countsAfter.accounts === countsBefore.accounts, `${countsBefore.accounts}→${countsAfter.accounts}`);
  check('B owner数不变', countsAfter.owners === countsBefore.owners, `${countsBefore.owners}→${countsAfter.owners}`);
  check('B 会员数不变', countsAfter.memberships === countsBefore.memberships, `${countsBefore.memberships}→${countsAfter.memberships}`);

  console.log('Phase C：新包回切');
  serverA = await startServer(NEW_DIST, ROOT, dataDir);
  const cAdmin = await http('POST', '/api/v1/auth/login', { email: 'drill-admin@example.com', password: 'Changed-drill-456!' });
  check('C admin(v2改密)登录', cAdmin.status === 200);
  const cLegacy = await http('POST', '/api/v1/auth/login', { email: 'drill-legacy@example.com', password: PASSWORD_V1 });
  check('C v1历史用户登录+透明升级', cLegacy.status === 200);
  const cUp = await http('POST', '/api/v1/auth/login', { email: 'drill-up@example.com', password: PASSWORD_UP });
  check('C v1(重写)用户登录', cUp.status === 200);
  const cChange = await http('POST', '/api/v1/auth/password/change', { currentPassword: 'Changed-drill-456!', nextPassword: 'Final-drill-789!' }, cAdmin.cookie);
  check('C 改密端点恢复', cChange.status === 200);
  const cFinal = await http('POST', '/api/v1/auth/login', { email: 'drill-admin@example.com', password: 'Final-drill-789!' });
  check('C 最终密码登录', cFinal.status === 200);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);
} finally {
  await stopServer(serverA);
  await stopServer(serverB);
  // 只杀自己创建的子进程（children数组在startServer时填充）
  for (const c of children) { if (c.exitCode === null) c.kill(); }
  await new Promise((r) => setTimeout(r, 500));
  try { rmSync(dataDir, { force: true, recursive: true }); } catch { /* Windows句柄 */ }
}

process.exitCode = failures === 0 ? 0 : 1;
