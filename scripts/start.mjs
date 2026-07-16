import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const required = ['apps/api/dist/main.js', 'apps/worker/dist/main.js', 'apps/web/dist/index.html'];
for (const relativePath of required) {
  if (!existsSync(resolve(projectRoot, relativePath))) {
    throw new Error(`缺少构建产物 ${relativePath}，请先运行 npm run build`);
  }
}

const children = [];
const spawnService = (name, command, args) => {
  const child = spawn(command, args, { cwd: projectRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
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

spawnService('API', process.execPath, ['apps/api/dist/main.js']);
await waitForApi();
spawnService('WORKER', process.execPath, ['apps/worker/dist/main.js']);
spawnService('WEB', process.execPath, [
  resolve(projectRoot, 'node_modules/vite/bin/vite.js'),
  'preview',
  resolve(projectRoot, 'apps/web'),
  '--config', resolve(projectRoot, 'apps/web/vite.config.ts')
]);
console.log('文脉写作已启动：http://127.0.0.1:43110');
