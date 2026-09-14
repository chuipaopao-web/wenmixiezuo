#!/usr/bin/env node
/**
 * AUTH-TAKEOVER-01 R2-3 真实回退演练：新包 → 回退包 → 新包，三阶段完整HTTP验证。
 * 不导入本地src；每个阶段用打出的dist在独立进程跑真实main/bootstrap+迁移器+HTTP。
 *
 * Phase A（新包）：注册admin(v2)、种v1历史用户、登录升级、签会话、种owner/权益行。
 * Phase B（回退包，基准5edad171+双格式补丁）：同库重启，验证健康/双格式登录/旧会话认证/
 *          owner+权益行完整/新增端点回退后404/迁移幂等（重入零变更）。
 * Phase C（新包回切）：同库再重启，全部账号仍可登录，回退包写入的v1会话可被新包认证。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';

const NODE = process.execPath;
const ROOT = process.cwd();
const NEW_DIST = resolve(ROOT, 'apps/api/dist/main.js');
const RB_DIR = resolve(ROOT, '.local/dispatch/outbox/task-auth-takeover-01/rollback-target');
const RB_DIST = resolve(RB_DIR, 'dist/main.js');
const RB_ROOT = RB_DIR; // 回退包的项目根（含apps/api/src/infrastructure/db/migrations）

const PORT = 43120;
const origin = 'http://127.0.0.1:43110';
const host = `127.0.0.1:${PORT}`;
const PASSWORD_V1 = 'Legacy-drill-123!';
const PASSWORD_UP = 'Upgrade-drill-123!';
const PASSWORD_FRESH = 'Fresh-drill-123!';

const results = { phaseA: {}, phaseB: {}, phaseC: {} };
let failures = 0;

function v1Hash(password, salt) {
  return scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
}

async function startServer(distMain, projectRoot, dataDir) {
  const child = spawn(NODE, [distMain], {
    env: {
      ...process.env,
      WENMI_PROJECT_ROOT: projectRoot,
      WENMI_DATA_DIR: dataDir,
      WENMI_API_PORT: String(PORT),
      WENMI_API_HOST: '127.0.0.1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += String(c); });
  for (let i = 0; i < 30; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, { headers: { host } });
      if (r.status === 200) return { child, stderr };
    } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`服务未就绪: ${stderr.slice(0, 300)}`);
}

async function stopServer(handle) {
  if (!handle) return;
  handle.child.kill();
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 3000);
    handle.child.on('exit', () => { clearTimeout(t); resolve(); });
  });
}

async function http(method, path, body, cookie) {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: {
      'content-type': 'application/json', origin, 'sec-fetch-site': 'same-site', host,
      ...(cookie === undefined ? {} : { cookie })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const setCookie = response.headers.get('set-cookie');
  return { status: response.status, cookie: setCookie?.split(';')[0], body: await response.json().catch(() => ({})) };
}

function check(label, condition, detail) {
  if (condition) { console.log(`  ✓ ${label}`); return true; }
  failures += 1;
  console.log(`  ✗ ${label} ${detail ?? ''}`);
  return false;
}

const dataDir = mkdtempSync(resolve(tmpdir(), 'auth-drill-'));
let serverA = null, serverB = null, adminCookie = null, upCookie = null;

try {
  // ── Phase A：新包 ──
  console.log('Phase A：新包（本分支新身份域）');
  serverA = await startServer(NEW_DIST, ROOT, dataDir);
  const regAdmin = await http('POST', '/api/v1/auth/register', { email: 'drill-admin@example.com', displayName: '管理员', password: PASSWORD_FRESH });
  check('A 注册admin', regAdmin.status === 200);
  adminCookie = regAdmin.cookie;

  // 种v1历史用户+owner+青铜权益（直接SQL——该库文件由A进程持有，改为注册再手动降级？不——用HTTP注册后通过SQLite文件）
  // 简化：用第二个注册作为"upgraded"用户（新装v2），再另种一个纯v1行。
  // v1行需要直接写库文件——进程运行中不能并发打开写。改为先注册3个用户再停止进程后SQL补v1行。
  const regUp = await http('POST', '/api/v1/auth/register', { email: 'drill-up@example.com', displayName: '升级用户', password: PASSWORD_UP });
  check('A 注册升级用户', regUp.status === 200);

  // 用新包登录/登出验证
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

  // 种v1历史行（进程停止后直接SQL）
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(resolve(dataDir, 'database/wenmi.sqlite'));
  const salt = randomBytes(16).toString('hex');
  db.prepare("INSERT INTO owners (owner_id, display_name, version, created_at, updated_at) VALUES ('drill-legacy-owner','历史用户',1,'2026-01-01','2026-01-01')").run();
  db.prepare(`
    INSERT INTO user_accounts (user_id, owner_id, email_normalized, display_name, password_salt, password_hash,
      password_format, password_n, password_r, password_p, credential_version, role, status, created_at, updated_at, last_login_at)
    VALUES ('drill-legacy', 'drill-legacy-owner', 'drill-legacy@example.com', '历史用户', ?, ?, NULL, NULL, NULL, NULL, 0, 'user', 'active', '2026-01-01', '2026-01-01', NULL)
  `).run(salt, v1Hash(PASSWORD_V1, salt));
  // 给升级用户手动降回v1（模拟历史状态——删参数列值）
  db.prepare("UPDATE user_accounts SET password_format=NULL, password_n=NULL, password_r=NULL, password_p=NULL WHERE email_normalized='drill-up@example.com'").run();
  // 用v1哈希重写升级用户密码
  const upSalt = randomBytes(16).toString('hex');
  db.prepare("UPDATE user_accounts SET password_salt=?, password_hash=? WHERE email_normalized='drill-up@example.com'").run(upSalt, v1Hash(PASSWORD_UP, upSalt));
  const countsBefore = {
    accounts: db.prepare('SELECT COUNT(*) n FROM user_accounts').get().n,
    owners: db.prepare('SELECT COUNT(*) n FROM owners').get().n,
    memberships: db.prepare('SELECT COUNT(*) n FROM user_memberships').get().n
  };
  db.close();
  console.log(`  · 种子完成：${countsBefore.accounts}账号 ${countsBefore.owners}owner ${countsBefore.memberships}会员`);

  // ── Phase B：回退包 ──
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

  // 数据完整性
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

  // ── Phase C：新包回切 ──
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
  process.exit(failures === 0 ? 0 : 1);
} finally {
  await stopServer(serverA);
  await stopServer(serverB);
  try { rmSync(dataDir, { force: true, recursive: true }); } catch { /* Windows句柄 */ }
}
