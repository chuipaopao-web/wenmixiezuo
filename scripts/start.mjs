import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
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

const apiEnvironment = { ...process.env };
const nonModelEnvironment = { ...process.env };
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
function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 800).unref();
}

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
