import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildV7RuntimeClosure,
  inspectSourceSpecifiers
} from '../../scripts/quality/verify-v7-runtime-source-closure.js';
import {
  type ReleaseClosureManifest,
  validateResolvedReleaseModules
} from '../../scripts/release/verify-v7-release-module-resolution.js';

describe('V7运行源码闭包', () => {
  it('所有生产源码都从真实入口可达，旧闭包不能重新出现', () => {
    const result = buildV7RuntimeClosure();
    expect(result.errors).toEqual([]);
    expect(result.orphanSourceFiles).toEqual([]);
    expect(result.unassignedProductionFiles).toEqual([]);
    expect(result.manifest.schema).toBe('v7-runtime-source-closure-v2');
    expect(result.manifest.summary.runtimeSourceFiles).toBeGreaterThan(150);
    expect(result.manifest.summary.operationalResources).toBeGreaterThanOrEqual(10);
    const migrationRoot = 'apps/api/src/infrastructure/db/migrations';
    const migrations = readdirSync(migrationRoot).filter(name => name.endsWith('.sql'))
      .map(name => `${migrationRoot}/${name}`).sort();
    expect(result.manifest.files.filter(file => file.path.startsWith(`${migrationRoot}/`)).map(file => file.path).sort()).toEqual(migrations);
    expect(result.manifest.summary.migrations).toBe(migrations.length);
    expect(migrations).toEqual(expect.arrayContaining([
      `${migrationRoot}/0109_v7_rhythm_policy.sql`,
      `${migrationRoot}/0110_account_usage_purge_archive.sql`,
      `${migrationRoot}/0111_opening_creative_profile.sql`
    ]));
    expect(result.manifest.summary.buildInputs).toBe(30);
    expect(result.manifest.files.some((file) => file.path.includes('/dist/'))).toBe(false);
    expect(result.manifest.files.some((file) => file.path.endsWith('/.env.production'))).toBe(false);
    expect(new Set(result.manifest.files.map((file) => file.path)).size).toBe(result.manifest.files.length);
    expect(result.manifest.summary.totalFiles).toBe(
      result.manifest.summary.runtimeSourceFiles
      + result.manifest.summary.operationalSourceFiles
      + result.manifest.summary.operationalResources
      + result.manifest.summary.migrations
      + result.manifest.summary.staticResources
      + result.manifest.summary.buildInputs
    );
    expect(result.manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
    expect(result.manifest.files.every((file) => [
      'v7-authoring',
      'v7-admin',
      'shared-platform',
      'migration-compat',
      'deployment-operations'
    ].includes(file.productRole))).toBe(true);
    expect(result.manifest.files.every((file) => file.evidence.length > 0
      && file.evidence.every((evidence) => evidence.from.trim() !== ''))).toBe(true);
    for (const file of result.manifest.files) {
      expect(createHash('sha256').update(readFileSync(resolve(file.path))).digest('hex')).toBe(file.sha256);
    }
    const { closureSha256, ...manifestCore } = result.manifest;
    expect(closureSha256).toBe(createHash('sha256').update(JSON.stringify(manifestCore)).digest('hex'));
  });

  it('解析真实模块语法而不把注释或普通字符串当引用，并拒绝不可冻结的动态加载', () => {
    const accepted = inspectSourceSpecifiers(`
      // import './comment-only.js';
      const example = "from './string-only.js'";
      import type { Alpha } from './types.js';
      import {
        beta
      } from './multiline.js';
      export * from './exported.js';
      await import('./dynamic-literal.js');
    `);
    expect(accepted.specifiers.toSorted()).toEqual([
      './dynamic-literal.js', './exported.js', './multiline.js', './types.js'
    ]);
    expect(accepted.unsupported).toEqual([]);

    const rejected = inspectSourceSpecifiers(`
      const target = './runtime.js';
      await import(target);
      const modules = import.meta.glob('./pages/*.tsx');
    `);
    expect(rejected.unsupported).toHaveLength(2);
  });

  it('拒绝没有显式入口的运维脚本和没有页面引用的静态资源', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'wenmi-v7-closure-'));
    try {
      mkdirSync(resolve(fixture, 'scripts/evaluation'), { recursive: true });
      mkdirSync(resolve(fixture, 'coauthoring-v7/author-app/public'), { recursive: true });
      writeFileSync(resolve(fixture, 'RELEASE_ID'), 'V7-fixture\n', 'utf8');
      writeFileSync(resolve(fixture, 'scripts/evaluation/orphan-probe.mjs'), 'export const orphan = true;\n', 'utf8');
      writeFileSync(resolve(fixture, 'scripts/orphan-launcher.ps1'), 'Write-Output orphan\n', 'utf8');
      writeFileSync(resolve(fixture, 'coauthoring-v7/author-app/public/orphan.png'), 'orphan', 'utf8');
      const result = buildV7RuntimeClosure(fixture);
      expect(result.unassignedProductionFiles).toContain('scripts/evaluation/orphan-probe.mjs');
      expect(result.unassignedProductionFiles).toContain('scripts/orphan-launcher.ps1');
      expect(result.unassignedProductionFiles).toContain('coauthoring-v7/author-app/public/orphan.png');
      expect(result.errors).toContain('运维文件没有显式调用或部署入口：scripts/evaluation/orphan-probe.mjs');
      expect(result.errors).toContain('运维文件没有显式调用或部署入口：scripts/orphan-launcher.ps1');
      expect(result.errors).toContain('静态资源没有作者端或后台引用：coauthoring-v7/author-app/public/orphan.png');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('部署模块必须解析到同一个release/source，并绑定闭包源码哈希', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'wenmi-v7-release-'));
    try {
      const source = resolve(fixture, 'release/source');
      const contractsSource = resolve(source, 'apps/contracts/src/index.ts');
      const contractsDist = resolve(source, 'apps/contracts/dist/index.js');
      const backendSource = resolve(source, 'coauthoring-v7/backend/index.ts');
      const backendDist = resolve(source, 'coauthoring-v7/backend/dist/index.js');
      const openingSource = resolve(source, 'rebuild/packages/backend/src/legacy-opening/runtime.ts');
      const openingDist = resolve(source, 'rebuild/packages/backend/src/legacy-opening/dist/runtime.js');
      const catalogSource = resolve(source, 'rebuild/packages/agent-catalog/index.js');
      for (const path of [contractsSource, contractsDist, backendSource, backendDist, openingSource, openingDist, catalogSource]) {
        mkdirSync(resolve(path, '..'), { recursive: true });
      }
      writeFileSync(resolve(source, 'RELEASE_ID'), 'wm-v7-20260909-180500-499ff1ac\n', 'utf8');
      writeFileSync(contractsSource, 'export const contract = true;\n', 'utf8');
      writeFileSync(contractsDist, 'export const contract = true;\n', 'utf8');
      writeFileSync(backendSource, 'export const backend = true;\n', 'utf8');
      writeFileSync(backendDist, 'export const backend = true;\n', 'utf8');
      writeFileSync(openingSource, 'export const opening = true;\n', 'utf8');
      writeFileSync(openingDist, 'export const opening = true;\n', 'utf8');
      writeFileSync(catalogSource, 'export const members = [];\n', 'utf8');
      const manifest: ReleaseClosureManifest = {
        schema: 'v7-runtime-source-closure-v2',
        releaseId: 'wm-v7-20260909-180500-499ff1ac',
        files: [
          { path: 'rebuild/packages/agent-catalog/index.js', sha256: fileSha256(catalogSource) },
          { path: 'apps/contracts/src/index.ts', sha256: fileSha256(contractsSource) },
          { path: 'coauthoring-v7/backend/index.ts', sha256: fileSha256(backendSource) },
          { path: 'rebuild/packages/backend/src/legacy-opening/runtime.ts', sha256: fileSha256(openingSource) }
        ]
      };
      expect(validateResolvedReleaseModules({
        releaseSource: source,
        manifest,
        resolutions: [
          { specifier: '@wenmi/agent-catalog', resolvedPath: catalogSource },
          { specifier: '@wenmi/contracts', resolvedPath: contractsDist },
          { specifier: '@wenmi/v7-backend', resolvedPath: backendDist },
          { specifier: '@wenmi/opening-runtime', resolvedPath: openingDist }
        ]
      })).toEqual([]);

      writeFileSync(resolve(source, 'RELEASE_ID'), 'wm-v7-r183-499ff1ac');
      expect(validateResolvedReleaseModules({ releaseSource: source,
        manifest: { ...manifest, releaseId: 'wm-v7-r183-499ff1ac' }, resolutions: []
      })).toContain('目标发布RELEASE_ID格式无效，API无法启动');
      writeFileSync(resolve(source, 'RELEASE_ID'), manifest.releaseId);

      const foreignModule = resolve(fixture, 'foreign-contracts.js');
      writeFileSync(foreignModule, readFileSync(contractsDist));
      expect(validateResolvedReleaseModules({
        releaseSource: source,
        manifest,
        resolutions: [
          { specifier: '@wenmi/contracts', resolvedPath: foreignModule },
          { specifier: '@wenmi/v7-backend', resolvedPath: backendDist }
        ]
      }).some((error) => error.includes('模块解析越出目标release/source'))).toBe(true);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
