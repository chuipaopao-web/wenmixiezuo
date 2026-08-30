import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveCurrentV7StaticRelease } from './release/v7-static-release.mjs';

const projectRoot = process.cwd();
const launcherRecordPath = resolve(projectRoot, 'data', 'control', 'desktop-launcher.pid');
const stopRequestPath = resolve(projectRoot, 'data', 'control', 'desktop-stop.request.json');
const userEnvironmentNames = [
  'WENMI_MODEL_MODE', 'WENMI_CODEX_MODEL', 'WENMI_CODEX_TIMEOUT_MS',
  'WENMI_ARK_CODING_PLAN_API_KEY', 'WENMI_ARK_CODING_PLAN_BASE_URL', 'WENMI_ARK_CODING_PLAN_DEEPSEEK_MODEL',
  'WENMI_ARK_AGENT_PLAN_API_KEY', 'WENMI_ARK_AGENT_PLAN_BASE_URL', 'WENMI_ARK_AGENT_PLAN_GLM_MODEL',
  'WENMI_ARK_AGENT_PLAN_DOUBAO_MODEL', 'WENMI_ARK_AGENT_PLAN_KIMI_MODEL', 'WENMI_ARK_AGENT_PLAN_KIMI_K27_MODEL',
  'WENMI_ARK_AGENT_PLAN_DEEPSEEK_MODEL', 'WENMI_ARK_AGENT_PLAN_DEEPSEEK_FLASH_MODEL', 'WENMI_ARK_AGENT_PLAN_MINIMAX_MODEL',
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL',
  'WENMI_PROMPT_VIEW_PASSWORD'
];
const modelCredentialNames = [
  'WENMI_ARK_CODING_PLAN_API_KEY', 'WENMI_ARK_AGENT_PLAN_API_KEY',
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'ARK_AGENTPLAN_KEY'
];

if (existsSync(launcherRecordPath)) {
  try {
    const existingLauncher = readControlJson(launcherRecordPath);
    if (existingLauncher.schemaVersion === 1
      && existingLauncher.projectRoot?.toLocaleLowerCase('en-US') === projectRoot.toLocaleLowerCase('en-US')
      && existingLauncher.entryPoint === 'scripts/start.mjs'
      && Number.isInteger(existingLauncher.processId)
      && existingLauncher.processId !== process.pid) {
      process.kill(existingLauncher.processId, 0);
      throw new Error(`文秘写作已经在运行（进程 ${existingLauncher.processId}），请先使用桌面停止入口`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('文秘写作已经在运行')) throw error;
    // 旧记录对应的进程已经退出，可以由本次启动安全接管。
  }
}

writeFileSync(launcherRecordPath, JSON.stringify({
  schemaVersion: 1,
  processId: process.pid,
  executablePath: process.execPath,
  projectRoot,
  entryPoint: 'scripts/start.mjs',
  startedAtUtc: new Date().toISOString()
}), 'utf8');

// Desktop launchers can inherit an Explorer environment block that predates the
// user-level configuration. Import only the allowlisted names into process.env;
// values remain in process memory and are never printed or written to a file.
if (process.platform === 'win32') {
  for (const name of userEnvironmentNames) {
    if (process.env[name]?.trim()) continue;
    try {
      const output = execFileSync('reg.exe', ['query', 'HKCU\\Environment', '/v', name], {
        encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
      });
      const line = output.split(/\r?\n/u).find((candidate) => candidate.includes(name) && /REG_(?:SZ|EXPAND_SZ)/u.test(candidate));
      const value = line?.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)$/u)?.[1]?.trim();
      if (value) process.env[name] = value;
    } catch {
      // A missing optional user variable is handled by the model runtime gate.
    }
  }
}

const required = ['apps/contracts/dist/index.js', 'apps/api/dist/main.js', 'apps/worker/dist/main.js'];
for (const relativePath of required) {
  if (!existsSync(resolve(projectRoot, relativePath))) {
    throw new Error(`缺少构建产物 ${relativePath}，请先运行 npm run build`);
  }
}
const staticRelease = await resolveCurrentV7StaticRelease(projectRoot);

const workerToken = randomBytes(32).toString('base64url');
const apiEnvironment = { ...process.env, WENMI_WORKER_TOKEN: workerToken };
const nonModelEnvironment = { ...process.env, WENMI_WORKER_TOKEN: workerToken };
for (const name of modelCredentialNames) delete nonModelEnvironment[name];
delete nonModelEnvironment.WENMI_PROMPT_VIEW_PASSWORD;

const children = [];
const spawnService = (name, command, args, environment = nonModelEnvironment) => {
  const child = spawn(command, args, { cwd: projectRoot, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.once('exit', (code, signal) => {
    // API、Worker 和 Web 都是常驻服务。即使某个子进程以 code=0
    // 意外退出，桌面启动器也不能继续留下一个“进程还在、服务已死”的空壳。
    if (!stopping) {
      console.error(`${name} 意外退出：code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      stopAll(1);
    }
  });
  children.push(child);
  return child;
};

let stopping = false;
let stopRequestTimer;
function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (stopRequestTimer !== undefined) clearInterval(stopRequestTimer);
  rmSync(stopRequestPath, { force: true });
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 800).unref();
}

function consumeVerifiedStopRequest() {
  if (stopping || !existsSync(stopRequestPath) || !existsSync(launcherRecordPath)) return;
  try {
    const request = readControlJson(stopRequestPath);
    const launcher = readControlJson(launcherRecordPath);
    if (request.schemaVersion !== 1 || launcher.schemaVersion !== 1
      || request.processId !== process.pid || launcher.processId !== process.pid
      || request.startedAtUtc !== launcher.startedAtUtc
      || request.projectRoot.toLocaleLowerCase('en-US') !== projectRoot.toLocaleLowerCase('en-US')
      || launcher.entryPoint !== 'scripts/start.mjs') return;
    stopAll(0);
  } catch {
    // 不完整或被篡改的控制文件不能触发任何进程操作。
  }
}

function readControlJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, ''));
}

stopRequestTimer = setInterval(consumeVerifiedStopRequest, 200);
stopRequestTimer.unref();

async function waitForApi() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:43111/health');
      if (response.ok) return;
    } catch {
      // API仍在启动，下一轮继续。
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error('API在20秒内未通过健康检查');
}

async function verifyRuntimeSmoke() {
  const deadline = Date.now() + 15_000;
  let health;
  while (Date.now() < deadline) {
    const response = await fetch('http://127.0.0.1:43111/health');
    if (response.ok) {
      health = (await response.json()).data;
      if (health.worker === 'ready') break;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  if (health?.worker !== 'ready') throw new Error('runtime worker smoke did not become ready');

  const protectedResponse = await fetch('http://127.0.0.1:43111/api/v1/auth/me');
  if (protectedResponse.status !== 401) throw new Error(`runtime login gate smoke failed: ${protectedResponse.status}`);

  let webReady = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:43110');
      webReady = response.ok;
      if (webReady) break;
    } catch {
      // Vite preview is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  if (!webReady) throw new Error('runtime web smoke did not become ready');
  console.log(JSON.stringify({
    smoke: 'passed',
    account: 'login-required',
    worker: health.worker,
    database: health.status,
    web: 'ready'
  }));
}
process.once('SIGINT', () => stopAll(0));
process.once('SIGTERM', () => stopAll(0));

spawnService('API', process.execPath, ['apps/api/dist/main.js'], apiEnvironment);
await waitForApi();
spawnService('WORKER', process.execPath, ['apps/worker/dist/main.js']);
spawnService('WEB', process.execPath, [
  resolve(projectRoot, 'scripts/release/serve-v7-static.mjs'),
  staticRelease.releaseDirectory
]);
console.log(`文秘写作 V7 已启动：http://127.0.0.1:43110（${staticRelease.releaseId}）`);

if (process.env.WENMI_RUNTIME_SMOKE === '1') {
  try {
    await verifyRuntimeSmoke();
    stopAll(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    stopAll(1);
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
}
