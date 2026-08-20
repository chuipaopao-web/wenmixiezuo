import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const runKey = String(process.argv[2] ?? Date.now()).replace(/[^a-zA-Z0-9_-]/g, '-');
const dataDir = mkdtempSync(join(tmpdir(), 'wenmi-layered-full-chain-'));
const apiPort = 44200 + Math.floor(Math.random() * 500);
const webPort = apiPort - 1;
const api = `http://127.0.0.1:${apiPort}`;
const origin = `http://127.0.0.1:${webPort}`;
const workerToken = randomBytes(32).toString('base64url');
const evidencePath = resolve('data', 'verification', `layered-admin-full-chain-${runKey}.json`);
const email = `isolated-admin-${runKey}@wenmi.invalid`;
const password = 'Wenmi-Isolated-Admin-2026!';
const children = [];

function start(name, entry, environment) {
  const child = spawn(process.execPath, [entry], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  children.push(child);
  return child;
}

let passed = false;
try {
  start('API', 'apps/api/dist/main.js', {
    WENMI_PROJECT_ROOT: process.cwd(),
    WENMI_DATA_DIR: dataDir,
    WENMI_API_PORT: String(apiPort),
    WENMI_WEB_ORIGIN: origin,
    WENMI_PUBLIC_ORIGIN: '',
    WENMI_MODEL_MODE: 'deterministic',
    WENMI_ALLOW_DETERMINISTIC_CREATIVE_FIXTURE: '1',
    WENMI_WORKER_TOKEN: workerToken,
    WENMI_LOG_LEVEL: 'warn'
  });
  await waitForHealth(api, false);
  start('WORKER', 'apps/worker/dist/main.js', {
    WENMI_PROJECT_ROOT: process.cwd(),
    WENMI_DATA_DIR: dataDir,
    WENMI_API_BASE_URL: api,
    WENMI_WORKER_ID: `isolated-full-chain-${runKey}`,
    WENMI_WORKER_TOKEN: workerToken,
    WENMI_WORKER_MAX_CONCURRENCY: '4'
  });
  await waitForHealth(api, true);

  const runner = spawn(process.execPath, ['scripts/evaluation/run-layered-admin-planning-smoke.mjs', runKey], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WENMI_VALIDATION_API: api,
      WENMI_VALIDATION_ORIGIN: origin,
      WENMI_VALIDATION_OUTPUT: evidencePath,
      WENMI_VALIDATION_TIMEOUT_MS: '180000',
      WENMI_E2E_EMAIL: email,
      WENMI_E2E_PASSWORD: password,
      WENMI_E2E_NICKNAME: '隔离全链管理员',
      WENMI_E2E_REGISTER: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  runner.stdout.on('data', (chunk) => process.stdout.write(`[JOURNEY] ${chunk}`));
  runner.stderr.on('data', (chunk) => process.stderr.write(`[JOURNEY] ${chunk}`));
  const [code, signal] = await once(runner, 'exit');
  if (code !== 0) throw new Error(`full-chain journey failed: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  passed = true;
  console.log(JSON.stringify({ result: 'passed', runKey, evidence: evidencePath }));
} finally {
  for (const child of children.reverse()) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit').catch(() => undefined);
    }
  }
  const target = resolve(dataDir);
  const temporaryRoot = resolve(tmpdir());
  if (!target.startsWith(temporaryRoot + '\\')) throw new Error('refusing unsafe isolated validation cleanup');
  rmSync(target, { recursive: true, force: true });
  if (!passed) process.exitCode = 1;
}

async function waitForHealth(baseUrl, requireWorker) {
  const deadline = Date.now() + 30000;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl + '/health');
      if (response.ok) {
        const payload = await response.json();
        last = JSON.stringify(payload.data);
        if (!requireWorker || payload.data.worker === 'ready') return payload.data;
      } else last = String(response.status);
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error('isolated runtime did not become ready: ' + last);
}
