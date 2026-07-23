import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'wenmi-opening-runtime-'));
const apiPort = 43211;
const webOrigin = 'http://127.0.0.1:43210';
const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    WENMI_DATA_DIR: dataDir,
    WENMI_API_PORT: String(apiPort),
    WENMI_WEB_ORIGIN: webOrigin,
    WENMI_MODEL_MODE: 'deterministic'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

try {
  const health = await waitForHealth(`http://127.0.0.1:${apiPort}/health`);
  if (!health.ok) throw new Error(`health failed: ${health.status}`);
  const session = await fetch(`http://127.0.0.1:${apiPort}/api/v1/runtime/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: webOrigin, 'sec-fetch-site': 'same-site' },
    body: '{}'
  });
  if (!session.ok) throw new Error(`session failed: ${session.status}`);
  const cookie = session.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  const taxonomyResponse = await fetch(`http://127.0.0.1:${apiPort}/api/v1/opening-taxonomy`, { headers: { cookie } });
  if (!taxonomyResponse.ok) throw new Error(`taxonomy failed: ${taxonomyResponse.status}`);
  const taxonomy = (await taxonomyResponse.json()).data;
  const boundaryOptionCount = taxonomy.boundaryGroups.reduce((total, group) => total + group.options.length, 0);
  if (taxonomy.boundaryGroups.length !== 4 || boundaryOptionCount !== 24) {
    throw new Error(`boundary catalog incomplete: ${taxonomy.boundaryGroups.length} groups/${boundaryOptionCount} options`);
  }
  console.log(JSON.stringify({
    smoke: 'passed',
    schemaVersion: 25,
    taxonomyVersion: taxonomy.version,
    categories: taxonomy.categories.length,
    channels: [...new Set(taxonomy.categories.map((category) => category.channel))],
    boundaryGroups: taxonomy.boundaryGroups.length,
    boundaryOptions: boundaryOptionCount
  }));
} finally {
  child.kill('SIGTERM');
  await once(child, 'exit').catch(() => undefined);
  const target = resolve(dataDir);
  const temporaryRoot = resolve(tmpdir());
  if (!target.startsWith(`${temporaryRoot}\\`)) throw new Error('refusing unsafe runtime-smoke cleanup');
  rmSync(target, { recursive: true, force: true });
}

async function waitForHealth(url) {
  let response;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // API is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  return response ?? { ok: false, status: 0 };
}
