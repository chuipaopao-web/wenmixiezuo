import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const releaseId = readFileSync(resolve(root, 'RELEASE_ID'), 'utf8').trim();
const failures = [];
const checks = [];

function check(name, condition, details) {
  checks.push({ name, passed: Boolean(condition), details });
  if (!condition) failures.push(`${name}：${details}`);
}

const trackedFiles = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/u).filter(Boolean);
const runtimeFiles = trackedFiles.filter((file) => file.startsWith('apps/') || file.startsWith('scripts/'));
const trackedText = trackedFiles
  .filter((file) => !file.endsWith('.sqlite') && !file.endsWith('.png'))
  .map((file) => ({ file, content: readFileSync(resolve(root, file), 'utf8') }));

check('release_id格式', /^wm-(?:v[1-9]\d*|[a-z][a-z0-9-]*-r[1-9]\d*)-\d{8}-\d{6}-[a-f0-9]{8}$/u.test(releaseId), releaseId);
for (let stage = 0; stage <= 8; stage += 1) {
  const prefix = String(stage).padStart(2, '0');
  const found = trackedFiles.some((file) => file.startsWith(`docs/releases/${releaseId}/stages/${prefix}-`));
  check(`阶段${stage}验收包`, found, found ? '存在' : '缺失');
}

const contract = readFileSync(resolve(root, 'apps/api/src/contracts/api.ts'), 'utf8');
const migrations = trackedFiles.filter((file) => file.startsWith('apps/api/src/infrastructure/db/migrations/') && file.endsWith('.sql')).sort();
check('Schema与迁移锁定', contract.includes('SCHEMA_VERSION = 22') && migrations.at(-1)?.includes('0022_'), `${migrations.at(-1) ?? '无迁移'}`);

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
check('依赖锁文件', packageLock.lockfileVersion === 3 && packageJson.packageManager === 'npm@11.13.0', `lockfile=${packageLock.lockfileVersion}`);
check('Node稳定版锁定', packageJson.engines?.node === '>=24.16.0 <25', String(packageJson.engines?.node));

const forbiddenRuntimeRoot = ['D:', 'AI智囊团'].join('\\');
const runtimeReference = runtimeFiles.find((file) => readFileSync(resolve(root, file), 'utf8').includes(forbiddenRuntimeRoot));
check('无AI智囊团运行时依赖', runtimeReference === undefined, runtimeReference ?? '未发现');

const secretPattern = /(?:sk|ark|api)[-_][A-Za-z0-9]{20,}/u;
const secretHit = trackedText.find(({ content }) => secretPattern.test(content));
check('无疑似硬编码密钥', secretHit === undefined, secretHit?.file ?? '未发现');
const todoPattern = /(?:\/\/|#|<!--)\s*(?:TODO|FIXME|HACK)\b/iu;
const todoHit = trackedText.find(({ content }) => todoPattern.test(content));
check('无未说明代码占位', todoHit === undefined, todoHit?.file ?? '未发现');

const ignoreResult = execFileSync('git', ['check-ignore', 'data/database/wenmi.sqlite'], { cwd: root, encoding: 'utf8' }).trim();
check('运行数据不入Git', ignoreResult.length > 0, ignoreResult || '未忽略');
const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
check('工作树干净', status.length === 0, status || 'clean');
const remotes = execFileSync('git', ['remote'], { cwd: root, encoding: 'utf8' }).trim();
const releaseDoc = readFileSync(resolve(root, `docs/releases/${releaseId}/RELEASE.md`), 'utf8');
check('本地版本边界', remotes.length > 0 || releaseDoc.includes('未配置远程'), remotes || '未配置远程且文档已说明');
check('产品显示名称', packageJson.productName === '文秘写作', String(packageJson.productName));
const oldNameAllowed = new Set([
  'docs/DECISIONS.md',
  'docs/FINAL_SOLUTION.md',
  'docs/SOURCE_REQUIREMENTS.md',
  'docs/CONSENSUS_LEDGER.md',
  'docs/superpowers/plans/2026-07-17-product-rename.md'
]);
const retiredNames = [
  ['文', '脉写作'].join(''),
  ['文', '脉'].join(''),
  ['wen', 'mai'].join('')
];
const oldNameHit = trackedText.find(({ file, content }) =>
  !oldNameAllowed.has(file) && retiredNames.some((name) => content.toLocaleLowerCase('en-US').includes(name)));
check('旧产品名已清除', oldNameHit === undefined, oldNameHit?.file ?? '未发现');
check('桌面入口', existsSync(resolve(root, '文秘写作-启动.cmd')) && existsSync(resolve(root, '文秘写作-停止.cmd')), '启动与停止入口');
check('老板使用说明', existsSync(resolve(root, 'docs/USER_GUIDE.md')), 'docs/USER_GUIDE.md');

console.log(JSON.stringify({ releaseId, checks, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
