#!/usr/bin/env node
/**
 * AUTH-TAKEOVER-01 R2-3：构建独立回退目标。
 * 来源=已知稳定基准 5edad171（本分支开工前的main HEAD）+ 最小双格式改造：
 * 1. git worktree detach 基准源码；
 * 2. 对基准AccountAuthService应用确定性文本替换（login按行内password_format/n/r/p参数派生：
 *    NULL=v1，scrypt-v2=按存储参数，参数有界防伪造；derivePasswordHash接受显式参数；
 *    register维持v1写入，新代码读NULL=v1并在下次登录透明升级）；
 * 3. 复制0125迁移到基准migrations目录（回退包迁移器必须接受已应用0125的库）；
 * 4. 链接构建工具链后构建apps/api；
 * 5. 打包dist+migrations+manifest（含来源commit、改造前后diff sha256、文件清单hash）到输出目录。
 * 回退目标与待发布新代码完全独立：不同源码树、不同commit、仅共享构建工具链。
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const GIT = 'D:/wenmixiezuo/data/cache/runtime/mingit/cmd/git.exe';
const NPM = 'D:/wenmixiezuo/data/cache/runtime/node-v24.16.0-win-x64/npm.cmd';
const NODE = 'D:/wenmixiezuo/data/cache/runtime/node-v24.16.0-win-x64/node.exe';
const BASE_COMMIT = '5edad171';
const AUTH_PATH = 'apps/api/src/infrastructure/security/account-auth-service.ts';
const OWNERSHIP_MARKER = '.wenmi-auth-takeover-build';
// 唯一目录：每次运行用进程PID隔离，不与用户目录冲突
const runId = `rb-${Date.now().toString(36)}-${process.pid}`;
const outDir = resolve(process.argv[2] ?? `.local/dispatch/outbox/task-auth-takeover-01/rollback-target-${runId}`);
const tmpSrc = resolve(root, `.tmp-${runId}`);

// 安全检查：不覆盖已有输出目录（除非有归属标记且明确传入--force）
if (existsSync(outDir)) {
  const marker = resolve(outDir, OWNERSHIP_MARKER);
  if (!existsSync(marker)) {
    console.error(`输出目录已存在且无归属标记，拒绝覆盖：${outDir}`);
    process.exitCode = 1;
    process.exit(1);
  }
  if (!process.argv.includes('--force')) {
    console.error(`输出目录已有归属标记但未传--force，拒绝覆盖：${outDir}`);
    process.exitCode = 1;
    process.exit(1);
  }
}

// 安全检查：临时工作树目录如果已存在则拒绝（不做无检查递归删除）
if (existsSync(tmpSrc)) {
  console.error(`临时工作树目录已存在（可能是上次异常退出残留），需手动清理后重试：${tmpSrc}`);
  console.error(`  git worktree remove --force "${tmpSrc}"`);
  process.exitCode = 1;
  process.exit(1);
}

console.log(`基准源码：git worktree detach ${BASE_COMMIT} → ${tmpSrc}`);
execSync(`"${GIT}" worktree add --detach "${tmpSrc}" ${BASE_COMMIT}`, { stdio: 'pipe' });

try {
  // 2. 确定性文本替换（等价于rollback最小补丁；diff写入manifest作为证据）
  const authFile = resolve(tmpSrc, AUTH_PATH);
  const original = readFileSync(authFile, 'utf8');
  const patched = applyRollbackPatch(original);
  writeFileSync(authFile + '.orig', original);
  writeFileSync(authFile, patched);
  let diff = '';
  try {
    diff = execSync(`"${GIT}" diff --no-index -- "${authFile}.orig" "${authFile}"`, { stdio: ['pipe','pipe','pipe'] }).toString();
  } catch (error) {
    diff = String(error.stdout ?? '');
  }
  diff = diff.replace(authFile + '.orig', 'a/' + AUTH_PATH).replace(authFile, 'b/' + AUTH_PATH);

  // 3. 复制0125迁移
  cpSync(resolve(root, 'apps/api/src/infrastructure/db/migrations/0125_password_scrypt_v2.sql'), resolve(tmpSrc, 'apps/api/src/infrastructure/db/migrations/0125_password_scrypt_v2.sql'));

  // 4. 构建工具链：链接主worktree的node_modules第三方包（不含@wenmi——基准树自带自己的workspace源）
  const nmDst = resolve(tmpSrc, 'node_modules');
  if (!existsSync(nmDst)) {
    execSync(`"${NODE}" -e "const fs=require('fs'),p=require('path'),{execSync}=require('child_process');const MAIN=p.resolve('${root.replace(/\\/g,'\\\\')}','node_modules');const DST='${tmpSrc.replace(/\\/g,'\\\\')}\\\\node_modules';fs.mkdirSync(DST,{recursive:true});fs.mkdirSync(p.join(DST,'@wenmi'),{recursive:true});for(const e of fs.readdirSync(MAIN,{withFileTypes:true})){if(e.name.startsWith('.')||e.name==='@wenmi')continue;const s=p.join(MAIN,e.name),d=p.join(DST,e.name);if(fs.existsSync(d))continue;execSync('mklink /J \"'+d+'\" \"'+s+'\"',{stdio:'ignore'})}for(const sub of fs.readdirSync(p.join(MAIN,'@wenmi'))){const s=p.join(MAIN,'@wenmi',sub);let t=p.join(DST,'@wenmi',sub);const pj=JSON.parse(fs.readFileSync(p.join(s,'package.json'),'utf8'));const ws=pj.name;if(ws==='@wenmi/api'||ws==='@wenmi/contracts'||ws==='@wenmi/worker'){t=p.join(DST,'@wenmi',sub)}else{t=p.join(DST,'@wenmi',sub)}if(fs.existsSync(t))continue;const real=ws==='@wenmi/api'?p.resolve('${tmpSrc.replace(/\\/g,'\\\\')}','apps','api'):ws==='@wenmi/contracts'?p.resolve('${tmpSrc.replace(/\\/g,'\\\\')}','apps','contracts'):ws==='@wenmi/worker'?p.resolve('${tmpSrc.replace(/\\/g,'\\\\')}','apps','worker'):p.resolve('${tmpSrc.replace(/\\/g,'\\\\')}','node_modules','@wenmi',sub);if(fs.existsSync(real))execSync('mklink /J \"'+t+'\" \"'+real+'\"',{stdio:'ignore'})}"`, { shell: 'cmd.exe', stdio: 'pipe' });
  }
  console.log('构建回退目标apps/api…');
  execSync(`set "PATH=D:/wenmixiezuo/data/cache/runtime/node-v24.16.0-win-x64;%PATH%"&&"${NPM}" run build -w @wenmi/api`, { cwd: tmpSrc, shell: 'cmd.exe', stdio: 'pipe' });
  if (!existsSync(resolve(tmpSrc, 'apps/api/dist/main.js'))) throw new Error('回退目标构建失败');

  // 5. 打包（写归属标记）
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, OWNERSHIP_MARKER), `${new Date().toISOString()} run=${runId} pid=${process.pid}\n`);
  cpSync(resolve(tmpSrc, 'apps/api/dist'), resolve(outDir, 'dist'), { recursive: true });
  mkdirSync(resolve(outDir, 'apps/api/src/infrastructure/db/migrations'), { recursive: true });
  cpSync(resolve(tmpSrc, 'apps/api/src/infrastructure/db/migrations'), resolve(outDir, 'apps/api/src/infrastructure/db/migrations'), { recursive: true });

  const manifest = {
    marker: 'auth-takeover-rollback-target',
    sourceCommit: BASE_COMMIT,
    sourceDescription: '本分支开工前main HEAD（已知稳定基准），与本分支新身份实现完全独立的不同源码树',
    patchSha256: createHash('sha256').update(diff).digest('hex'),
    patchDiff: diff.slice(0, 4000),
    patchSummary: 'AccountAuthService.login按行内password_format/n/r/p派生（NULL=v1, scrypt-v2=有界参数）；register维持v1写入',
    migrationIncluded: '0125_password_scrypt_v2.sql',
    createdAt: new Date().toISOString(),
    dist: hashTree(resolve(outDir, 'dist')),
    migrations: hashTree(resolve(outDir, 'apps/api/src/infrastructure/db/migrations')),
    rollbackBehavior: {
      newEndpoints: '/api/v1/auth/password/change与/api/v1/auth/sessions/revoke-others回退后404（基准无此路由）；改密/撤销会话须切回新包',
      passwordFormats: 'v1（NULL参数列）与v2（scrypt-v2参数列）均可登录；新注册写v1',
      credentialVersion: 'credential_version列存在但基准不使用（新代码CAS专用）',
      sessions: 'auth_sessions结构不变，回退前后会话均有效'
    }
  };
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`回退目标已构建：${outDir}`);
  console.log(`来源=${BASE_COMMIT} 补丁diff sha256=${manifest.patchSha256.slice(0,16)}… dist=${manifest.dist.files.length}文件 migrations=${manifest.migrations.files.length}文件`);
} finally {
  try { execSync(`"${GIT}" worktree remove --force "${tmpSrc}"`, { stdio: 'pipe' }); } catch { /* 尽力 */ }
}

function applyRollbackPatch(source) {
  let t = source;
  const anchor1 = '  password_salt: string;\n  password_hash: string;\n';
  if (!t.includes(anchor1)) throw new Error('anchor1 missing');
  t = t.replace(anchor1, anchor1 + '  password_format: string | null;\n  password_n: number | null;\n  password_r: number | null;\n  password_p: number | null;\n');
  const anchor2 = "    const salt = account?.password_salt ?? '00000000000000000000000000000000';\n    const supplied = await derivePasswordHash(password.slice(0, MAX_PASSWORD_LENGTH), salt);";
  if (!t.includes(anchor2)) throw new Error('anchor2 missing');
  t = t.replace(anchor2, "    // ROLLBACK-TARGET: dual-format credential read (NULL=v1, scrypt-v2=stored bounded params).\n    const fallbackSalt = account?.password_salt ?? '00000000000000000000000000000000';\n    const params = account !== undefined && account.password_format === 'scrypt-v2'\n      && account.password_n !== null && account.password_r !== null && account.password_p !== null\n      && account.password_n > 0 && account.password_n <= 1_048_576\n      && account.password_r > 0 && account.password_r <= 64\n      && account.password_p > 0 && account.password_p <= 64\n      ? { N: account.password_n, r: account.password_r, p: account.password_p }\n      : { N: 16_384, r: 8, p: 1 };\n    const supplied = await derivePasswordHash(password.slice(0, MAX_PASSWORD_LENGTH), fallbackSalt, params);");
  const anchor3 = 'function derivePasswordHash(password: string, salt: string): Promise<string> {\n  return new Promise((resolve, reject) => {\n    scrypt(password, salt, PASSWORD_BYTES, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }';
  if (!t.includes(anchor3)) throw new Error('anchor3 missing');
  t = t.replace(anchor3, 'function derivePasswordHash(password: string, salt: string, params: { N: number; r: number; p: number } = { N: 16_384, r: 8, p: 1 }): Promise<string> {\n  return new Promise((resolve, reject) => {\n    scrypt(password, salt, PASSWORD_BYTES, { N: params.N, r: params.r, p: params.p, maxmem: 128 * 1024 * 1024 }');
  return t;
}

function hashTree(directory) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push({ path: full.slice(directory.length + 1).replace(/\\/g, '/'), sha256: createHash('sha256').update(readFileSync(full)).digest('hex') });
    }
  };
  walk(directory);
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { files };
}
