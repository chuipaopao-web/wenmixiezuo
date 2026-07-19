import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const MODEL_ID = 'Xenova/bge-small-zh-v1.5';
const REVISION = '75c43b069aac4d136ba6bc1122f995fedcfd2781';
const ASSET_ID = `xenova-bge-small-zh-v1.5-${REVISION.slice(0, 12)}`;
const FILES = [
  'README.md',
  'config.json',
  'quantize_config.json',
  'special_tokens_map.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.txt',
  'onnx/model_quantized.onnx'
];

const projectRoot = findProjectRoot(process.cwd());
const modelRoot = resolve(process.env.WENMI_DATA_DIR ?? resolve(projectRoot, 'data'), 'cache', 'models');
const target = resolve(modelRoot, ASSET_ID);
const command = process.argv[2] ?? 'install';

if (command === 'metadata') {
  output({ assetId: ASSET_ID, modelId: MODEL_ID, revision: REVISION, target, files: FILES });
} else if (command === 'verify') {
  const verified = await verifyAsset(target);
  if (!verified.ok) throw new Error(`MODEL_ASSET_INVALID:${verified.reason}`);
  output(verified);
} else if (command === 'install') {
  mkdirSync(modelRoot, { recursive: true });
  cleanupAbandonedStaging();
  if (existsSync(target)) {
    const verified = await verifyAsset(target);
    if (verified.ok) output({ ...verified, reused: true });
    else {
      const quarantined = `${target}.invalid-${new Date().toISOString().replaceAll(/[:.]/gu, '-')}`;
      renameSync(target, quarantined);
      await install(target);
    }
  } else {
    await install(target);
  }
} else {
  throw new Error('用法：node scripts/models/install-local-semantic-model.mjs <install|verify|metadata>');
}

async function install(destination) {
  const staging = resolve(modelRoot, `.${ASSET_ID}.staging-${randomUUID()}`);
  mkdirSync(staging, { recursive: true });
  const files = [];
  for (const path of FILES) {
    const targetFile = resolve(staging, path);
    mkdirSync(dirname(targetFile), { recursive: true });
    const url = `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/${path}`;
    await download(url, targetFile);
    files.push({ path, sha256: await sha256File(targetFile), bytes: statSync(targetFile).size });
  }
  const assetHash = aggregateHash(files);
  writeFileSync(resolve(staging, 'asset.json'), `${JSON.stringify({
    assetId: ASSET_ID,
    kind: 'embedding',
    modelId: MODEL_ID,
    revision: REVISION,
    license: 'MIT',
    sourceUrl: `https://huggingface.co/${MODEL_ID}/tree/${REVISION}`,
    dimension: 512,
    normalized: true,
    quantization: 'quantized',
    queryInstruction: '为这个句子生成表示以用于检索相关文章：',
    capabilities: ['embedding', 'semantic-routing', 'entity-ranking', 'extractive-compression', 'local-utility'],
    assetHash,
    files
  }, null, 2)}\n`, 'utf8');
  const verified = await verifyAsset(staging);
  if (!verified.ok) throw new Error(`MODEL_ASSET_INSTALL_VERIFY_FAILED:${verified.reason}`);
  renameSync(staging, destination);
  output({ ...verified, path: destination, reused: false });
}

async function download(url, destination) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const temporary = `${destination}.download-${attempt}`;
    try {
      const arguments_ = ['--location', '--fail', '--silent', '--show-error', '--retry', '2', '--retry-all-errors',
        '--connect-timeout', '30', '--max-time', '180'];
      const proxy = detectProxy();
      if (proxy !== null) arguments_.push('--proxy', proxy);
      arguments_.push('--output', temporary, url);
      execFileSync('curl.exe', arguments_, { stdio: ['ignore', 'ignore', 'pipe'], timeout: 200_000 });
      renameSync(temporary, destination);
      return;
    } catch (error) {
      lastError = error;
      if (existsSync(temporary)) rmSync(temporary, { force: true });
    }
  }
  throw lastError;
}

function detectProxy() {
  const configured = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  if (configured?.trim()) return configured.trim();
  if (process.platform !== 'win32') return null;
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const enabled = execFileSync('reg.exe', ['query', key, '/v', 'ProxyEnable'], { encoding: 'utf8', windowsHide: true });
    if (!/0x1\s*$/mu.test(enabled)) return null;
    const output = execFileSync('reg.exe', ['query', key, '/v', 'ProxyServer'], { encoding: 'utf8', windowsHide: true });
    const raw = /REG_SZ\s+([^\r\n]+)/u.exec(output)?.[1]?.trim();
    if (!raw) return null;
    const selected = raw.includes('=')
      ? raw.split(';').map((entry) => entry.split('=', 2)).find(([scheme]) => scheme === 'https')?.[1]
        ?? raw.split(';')[0]?.split('=', 2)[1]
      : raw;
    if (!selected) return null;
    return /^[a-z]+:\/\//iu.test(selected) ? selected : `http://${selected}`;
  } catch {
    return null;
  }
}

function cleanupAbandonedStaging() {
  for (const entry of existsSync(modelRoot) ? readdirSync(modelRoot, { withFileTypes: true }) : []) {
    if (!entry.isDirectory() || !entry.name.startsWith(`.${ASSET_ID}.staging-`)) continue;
    const path = resolve(modelRoot, entry.name);
    if (relative(modelRoot, path).startsWith('..')) throw new Error('MODEL_STAGING_PATH_REJECTED');
    rmSync(path, { recursive: true, force: true });
  }
}

async function verifyAsset(directory) {
  if (!existsSync(resolve(directory, 'asset.json'))) return { ok: false, reason: 'manifest_missing' };
  let manifest;
  try { manifest = JSON.parse(readFileSync(resolve(directory, 'asset.json'), 'utf8')); }
  catch { return { ok: false, reason: 'manifest_invalid' }; }
  if (manifest.assetId !== ASSET_ID || manifest.modelId !== MODEL_ID || manifest.revision !== REVISION || manifest.license !== 'MIT') {
    return { ok: false, reason: 'identity_mismatch' };
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== FILES.length) return { ok: false, reason: 'file_list_mismatch' };
  const verifiedFiles = [];
  for (const file of manifest.files) {
    const path = resolve(directory, file.path);
    if (relative(directory, path).startsWith('..') || !existsSync(path) || !statSync(path).isFile()) return { ok: false, reason: `file_missing:${file.path}` };
    const sha256 = await sha256File(path);
    if (sha256 !== file.sha256) return { ok: false, reason: `hash_mismatch:${file.path}` };
    verifiedFiles.push({ path: file.path, sha256, bytes: statSync(path).size });
  }
  const assetHash = aggregateHash(verifiedFiles);
  if (assetHash !== manifest.assetHash) return { ok: false, reason: 'asset_hash_mismatch' };
  return { ok: true, assetId: ASSET_ID, modelId: MODEL_ID, revision: REVISION, assetHash, filesVerified: verifiedFiles.length,
    bytes: verifiedFiles.reduce((total, file) => total + file.bytes, 0), dimension: 512, capabilities: manifest.capabilities };
}

function aggregateHash(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(file.path.replaceAll('\\', '/'));
    hash.update(file.sha256);
  }
  return hash.digest('hex');
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function findProjectRoot(start) {
  let current = resolve(start);
  while (!existsSync(resolve(current, 'RELEASE_ID'))) {
    const parent = resolve(current, '..');
    if (parent === current) throw new Error('无法找到文秘写作项目根目录');
    current = parent;
  }
  return current;
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exit(0);
}
