import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const launcherRecordPath = resolve(projectRoot, 'data', 'control', 'desktop-launcher.pid');
const stopRequestPath = resolve(projectRoot, 'data', 'control', 'desktop-stop.request.json');
const userEnvironmentNames = [
  'WENMI_MODEL_MODE', 'WENMI_CODEX_MODEL', 'WENMI_CODEX_TIMEOUT_MS',
  'WENMI_ARK_CODING_PLAN_API_KEY', 'WENMI_ARK_CODING_PLAN_BASE_URL', 'WENMI_ARK_CODING_PLAN_DEEPSEEK_MODEL',
  'WENMI_ARK_AGENT_PLAN_API_KEY', 'WENMI_ARK_AGENT_PLAN_BASE_URL', 'WENMI_ARK_AGENT_PLAN_GLM_MODEL',
  'WENMI_ARK_AGENT_PLAN_DOUBAO_MODEL', 'WENMI_ARK_AGENT_PLAN_KIMI_MODEL'
];
const modelCredentialNames = [
  'WENMI_ARK_CODING_PLAN_API_KEY', 'WENMI_ARK_AGENT_PLAN_API_KEY',
  'ANTHROPIC_AUTH_TOKEN', 'ARK_AGENTPLAN_KEY'
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

const required = ['apps/api/dist/main.js', 'apps/worker/dist/main.js', 'apps/web/dist/index.html'];
for (const relativePath of required) {
  if (!existsSync(resolve(projectRoot, relativePath))) {
    throw new Error(`缺少构建产物 ${relativePath}，请先运行 npm run build`);
  }
}

const workerToken = randomBytes(32).toString('base64url');
const apiEnvironment = { ...process.env, WENMI_WORKER_TOKEN: workerToken };
const nonModelEnvironment = { ...process.env, WENMI_WORKER_TOKEN: workerToken };
for (const name of modelCredentialNames) delete nonModelEnvironment[name];

const children = [];
const spawnService = (name, command, args, environment = nonModelEnvironment) => {
  const child = spawn(command, args, { cwd: projectRoot, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.once('exit', (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`${name} 异常退出：code=${code ?? 'null'} signal=${signal ?? 'null'}`);
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
  const sessionResponse = await fetch('http://127.0.0.1:43111/api/v1/runtime/session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:43110',
      'sec-fetch-site': 'same-site'
    },
    body: '{}'
  });
  if (!sessionResponse.ok) throw new Error(`runtime session smoke failed: ${sessionResponse.status}`);
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';', 1)[0];
  if (!cookie) throw new Error('runtime session smoke did not receive a cookie');

  const deadline = Date.now() + 15_000;
  let readiness;
  while (Date.now() < deadline) {
    const response = await fetch('http://127.0.0.1:43111/api/v1/runtime/readiness', { headers: { cookie } });
    if (response.ok) {
      readiness = (await response.json()).data;
      if (readiness.worker === 'ready') break;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  if (readiness?.worker !== 'ready') throw new Error('runtime worker smoke did not become ready');

  const capabilityResponse = await fetch('http://127.0.0.1:43111/api/v1/capabilities', { headers: { cookie } });
  if (!capabilityResponse.ok) throw new Error(`runtime capability smoke failed: ${capabilityResponse.status}`);
  const capabilities = (await capabilityResponse.json()).data;

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
    session: 'http-only-cookie',
    worker: readiness.worker,
    nodeVersion: capabilities.runtime.nodeVersion,
    sqliteFts5: capabilities.sqlite.fts5,
    vectorSearchAvailable: capabilities.degradation.vectorSearchAvailable,
    web: 'ready'
  }));
}

process.once('SIGINT', () => stopAll(0));
process.once('SIGTERM', () => stopAll(0));

spawnService('API', process.execPath, ['apps/api/dist/main.js'], apiEnvironment);
await waitForApi();
spawnService('WORKER', process.execPath, ['apps/worker/dist/main.js']);
spawnService('WEB', process.execPath, [
  resolve(projectRoot, 'node_modules/vite/bin/vite.js'),
  'preview',
  resolve(projectRoot, 'apps/web'),
  '--config', resolve(projectRoot, 'apps/web/vite.config.ts')
]);
console.log('文秘写作已启动：http://127.0.0.1:43110');

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
