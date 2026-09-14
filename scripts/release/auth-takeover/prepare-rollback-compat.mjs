#!/usr/bin/env node
/**
 * AUTH-TAKEOVER-01 回滚兼容包准备脚本。
 * 回滚策略：回滚目标=本分支兼容构建（读v1/v2双格式凭据+含0125迁移），绝不回退旧v1-only构建
 * （旧构建固定v1参数，会把已升级/新装v2账号锁死）。本脚本把dist+迁移+清单组装为带标记的回滚包。
 * 用法：node scripts/release/auth-takeover/prepare-rollback-compat.mjs [输出目录]
 * 输出目录默认 .local/dispatch/outbox/task-auth-takeover-01/rollback-compat/（证据目录，git外）。
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const outDir = resolve(process.argv[2] ?? '.local/dispatch/outbox/task-auth-takeover-01/rollback-compat');
const distDir = resolve(root, 'apps/api/dist');
const migrationsDir = resolve(root, 'apps/api/src/infrastructure/db/migrations');

const errors = [];
if (!existsSync(resolve(distDir, 'http/app-server.js'))) errors.push('apps/api/dist 未构建或缺少 app-server.js（先 npm run build -w @wenmi/api）');
if (!existsSync(resolve(migrationsDir, '0125_password_scrypt_v2.sql'))) errors.push('缺少 0125 迁移（回滚包必须包含它，否则迁移器拒绝已应用库）');
if (errors.length > 0) {
  console.error('回滚包准备失败：');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
cpSync(distDir, resolve(outDir, 'dist'), { recursive: true });
cpSync(migrationsDir, resolve(outDir, 'migrations'), { recursive: true });

const manifest = {
  marker: 'auth-takeover-rollback-compat',
  purpose: 'AUTH-TAKEOVER-01回滚目标：读v1/v2双格式凭据+含0125迁移的兼容构建；禁止回退旧v1-only构建',
  createdAt: new Date().toISOString(),
  dist: hashTree(resolve(outDir, 'dist')),
  migrations: hashTree(resolve(outDir, 'migrations')),
  rollbackSteps: [
    '1. 停止API（在途任务按DEPLOY门禁）',
    '2. 部署本包dist替换apps/api/dist；确认migrations/包含0125',
    '3. 重启API；/health冒烟 + 任一已知账号登录验证',
    '4. 混合凭据场景已由 tests/integration/security/auth-rollback-compat.test.ts 演练（v1历史/升级v2/新装v2/旧会话/新进程）'
  ]
};
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`回滚兼容包已准备：${outDir}`);
console.log(`dist文件数=${manifest.dist.files.length} migrations文件数=${manifest.migrations.files.length}`);

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
