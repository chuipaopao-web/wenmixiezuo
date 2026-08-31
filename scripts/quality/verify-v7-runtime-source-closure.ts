import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { FEATURE_CAPABILITIES } from '../../apps/api/src/application/admin/v7-feature-capability-registry.js';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const RUNTIME_ENTRIES = [
  'apps/contracts/src/index.ts',
  'coauthoring-v7/backend/index.ts',
  'apps/api/src/main.ts',
  'apps/api/src/infrastructure/db/migrate-cli.ts',
  'apps/worker/src/main.ts',
  'coauthoring-v7/author-app/src/main.tsx',
  'coauthoring-v7/admin-console/src/main.tsx'
] as const;

const SOURCE_ROOTS = [
  'apps/contracts/src',
  'apps/api/src',
  'apps/worker/src',
  'coauthoring-v7/backend',
  'coauthoring-v7/author-app/src',
  'coauthoring-v7/admin-console/src'
] as const;

const OPERATIONAL_ROOTS = [
  'scripts/evaluation',
  'scripts/ops',
  'scripts/quality',
  'scripts/release'
] as const;

const STANDALONE_OPERATIONAL_ENTRIES = ['scripts/start.mjs', 'scripts/clean.mjs'] as const;
const STANDALONE_OPERATIONAL_RESOURCES = [
  'scripts/create-desktop-shortcut.ps1',
  'scripts/start-desktop.ps1',
  'scripts/stop-desktop.ps1',
  'scripts/release/serve-v7-static.d.mts',
  'scripts/release/v7-static-release.d.mts',
  '文秘写作-启动.cmd',
  '文秘写作-停止.cmd',
  'deploy/README.md',
  'deploy/Caddyfile',
  'deploy/wenmi-api.service',
  'deploy/wenmi-worker.service',
  'deploy/backup.sh',
  'deploy/activate-v7-static.sh',
  'deploy/.env.production.example'
] as const;

const WORKSPACE_PACKAGES: Readonly<Record<string, string>> = {
  '@wenmi/contracts': 'apps/contracts/src/index.ts',
  '@wenmi/v7-backend': 'coauthoring-v7/backend/index.ts'
};

const RETIRED_RUNTIME_PATHS = [
  'apps/contracts/src/core-workflow.ts',
  'apps/contracts/src/ai-editorial.ts',
  'apps/contracts/src/layered-planning.ts',
  'apps/contracts/src/narrative-templates.ts',
  'apps/api/src/application/artifacts/artifact-service.ts',
  'apps/api/src/application/budget/budget-service.ts',
  'apps/api/src/application/creation/writer-setting-context.ts',
  'apps/api/src/application/events/event-store.ts',
  'apps/api/src/application/knowledge/setting-baseline-service.ts',
  'apps/api/src/application/knowledge/setting-guidance-service.ts',
  'apps/api/src/application/knowledge/setting-outline-catalog.ts',
  'apps/api/src/application/knowledge/setting-outline-profile.ts',
  'apps/api/src/application/knowledge/setting-outline-workspace-service.ts',
  'apps/api/src/application/knowledge/setting-quality-shared.ts',
  'apps/api/src/application/memory/context-pack-service.ts',
  'apps/api/src/application/tasks/task-service.ts',
  'apps/api/src/infrastructure/db/repositories/continuation-import-repository.ts',
  'apps/api/src/infrastructure/db/repositories/owner-manuscript-repository.ts',
  'apps/api/src/infrastructure/db/repositories/setting-outline-workspace-repository.ts',
  'apps/api/src/infrastructure/db/repositories/setting-quality-report-repository.ts',
  'apps/api/src/infrastructure/db/sqlite-busy-retry.ts',
  'scripts/ops/tag-library-check.mts',
  'coauthoring-v7/author-app/start-local.ps1',
  'coauthoring-v7/author-app/launch-local.cmd',
  'coauthoring-v7/author-app/create-desktop-shortcut.ps1'
] as const;

type ClosureCategory = 'runtime' | 'operations' | 'operational-resource' | 'migration' | 'static-resource';

export interface V7RuntimeClosureManifest {
  schema: 'v7-runtime-source-closure-v1';
  releaseId: string;
  entries: string[];
  operationalEntries: string[];
  summary: {
    runtimeSourceFiles: number;
    operationalSourceFiles: number;
    operationalResources: number;
    migrations: number;
    staticResources: number;
    totalFiles: number;
  };
  files: Array<{ path: string; category: ClosureCategory; sha256: string }>;
  closureSha256: string;
}

export interface V7RuntimeClosureResult {
  manifest: V7RuntimeClosureManifest;
  errors: string[];
  orphanSourceFiles: string[];
}

export function buildV7RuntimeClosure(projectRoot = DEFAULT_ROOT): V7RuntimeClosureResult {
  const root = resolve(projectRoot);
  const errors: string[] = [];
  const runtimeEntries = RUNTIME_ENTRIES.map((path) => absoluteExisting(root, path, errors));
  const operationalEntries = [
    ...STANDALONE_OPERATIONAL_ENTRIES.map((path) => absoluteExisting(root, path, errors)),
    ...OPERATIONAL_ROOTS.flatMap((path) => listSourceFiles(resolve(root, path)))
  ].filter(isString);

  const runtime = traceImports(root, runtimeEntries.filter(isString), errors);
  const operations = traceImports(root, operationalEntries, errors);
  const allProductionSource = SOURCE_ROOTS.flatMap((path) => listSourceFiles(resolve(root, path)));
  const reachable = new Set([...runtime.sourceFiles, ...operations.sourceFiles]);
  const orphanSourceFiles = allProductionSource
    .filter((path) => !reachable.has(path))
    .map((path) => portable(root, path))
    .toSorted();
  for (const path of orphanSourceFiles) errors.push(`生产源码不在 V7 运行或运维闭包中：${path}`);

  for (const path of RETIRED_RUNTIME_PATHS) {
    if (existsSync(resolve(root, path))) errors.push(`已退役运行源码重新出现：${path}`);
  }

  for (const capability of FEATURE_CAPABILITIES) {
    for (const evidence of capability.evidence) {
      const absolute = resolve(root, evidence);
      if (!existsSync(absolute)) continue;
      if (isProductionSource(root, absolute) && !reachable.has(absolute)) {
        errors.push(`能力证据不在 V7 源码闭包中：${capability.id} -> ${evidence}`);
      }
    }
  }

  const migrationFiles = listFiles(resolve(root, 'apps/api/src/infrastructure/db/migrations'))
    .filter((path) => extname(path) === '.sql');
  const operationalResources = [
    ...STANDALONE_OPERATIONAL_RESOURCES.map((path) => absoluteExisting(root, path, errors)),
    ...operations.resources
  ].filter(isString).filter((path, index, all) => all.indexOf(path) === index).toSorted();
  const staticResources = [
    resolve(root, 'coauthoring-v7/author-app/index.html'),
    resolve(root, 'coauthoring-v7/admin-console/index.html'),
    ...listFiles(resolve(root, 'coauthoring-v7/author-app/public')),
    ...listFiles(resolve(root, 'coauthoring-v7/admin-console/public')),
    ...runtime.resources
  ].filter((path, index, all) => existsSync(path) && all.indexOf(path) === index);

  const runtimeSource = [...runtime.sourceFiles].toSorted();
  const operationalSource = [...operations.sourceFiles]
    .filter((path) => !runtime.sourceFiles.has(path))
    .toSorted();
  const files = [
    ...manifestFiles(root, runtimeSource, 'runtime'),
    ...manifestFiles(root, operationalSource, 'operations'),
    ...manifestFiles(root, operationalResources, 'operational-resource'),
    ...manifestFiles(root, migrationFiles, 'migration'),
    ...manifestFiles(root, staticResources, 'static-resource')
  ].sort((left, right) => left.path.localeCompare(right.path));
  const releaseIdPath = resolve(root, 'RELEASE_ID');
  const releaseId = existsSync(releaseIdPath) ? readFileSync(releaseIdPath, 'utf8').trim() : '';
  if (releaseId === '') errors.push('RELEASE_ID 为空或不存在。');
  const manifestCore = {
    schema: 'v7-runtime-source-closure-v1' as const,
    releaseId,
    entries: RUNTIME_ENTRIES.slice(),
    operationalEntries: operationalEntries.map((path) => portable(root, path)).toSorted(),
    summary: {
      runtimeSourceFiles: runtimeSource.length,
      operationalSourceFiles: operationalSource.length,
      operationalResources: operationalResources.length,
      migrations: migrationFiles.length,
      staticResources: staticResources.length,
      totalFiles: files.length
    },
    files
  };
  const manifest: V7RuntimeClosureManifest = {
    ...manifestCore,
    closureSha256: sha256Text(JSON.stringify(manifestCore))
  };
  if (files.some((file) => file.path.includes('/dist/'))) {
    errors.push('闭包清单不能依赖 dist 构建残留。');
  }
  return { errors: [...new Set(errors)].toSorted(), orphanSourceFiles, manifest };
}

function traceImports(root: string, entries: string[], errors: string[]): {
  sourceFiles: Set<string>;
  resources: string[];
} {
  const sourceFiles = new Set<string>();
  const resources = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (sourceFiles.has(file)) continue;
    sourceFiles.add(file);
    const text = readFileSync(file, 'utf8');
    const inspection = inspectSourceSpecifiers(text);
    for (const unsupported of inspection.unsupported) {
      errors.push(`源码包含无法静态冻结的加载：${portable(root, file)} -> ${unsupported}`);
    }
    for (const specifier of inspection.specifiers) {
      const resolved = resolveImport(root, file, specifier);
      if (resolved === null) continue;
      if (!existsSync(resolved)) {
        errors.push(`源码引用无法解析：${portable(root, file)} -> ${specifier}`);
        continue;
      }
      if (isSourceFile(resolved)) queue.push(resolved);
      else resources.add(resolved);
    }
  }
  return { sourceFiles, resources: [...resources] };
}

export function inspectSourceSpecifiers(source: string): { specifiers: string[]; unsupported: string[] } {
  const specifiers = new Set<string>();
  const unsupported = new Set<string>();
  const ast = parse(source, {
    sourceType: 'unambiguous',
    plugins: ['typescript', 'jsx', 'importAttributes', 'explicitResourceManagement']
  });
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    const type = typeof node.type === 'string' ? node.type : '';
    if (type === 'ImportDeclaration' || type === 'ExportNamedDeclaration' || type === 'ExportAllDeclaration') {
      addLiteralSpecifier(node.source, specifiers);
    } else if (type === 'ImportExpression') {
      if (!addLiteralSpecifier(node.source, specifiers)) unsupported.add('import(<运行时表达式>)');
    } else if (type === 'TSImportType') {
      addLiteralSpecifier(node.argument, specifiers);
    } else if (type === 'CallExpression') {
      const callee = objectRecord(node.callee);
      const args = Array.isArray(node.arguments) ? node.arguments : [];
      if (callee?.type === 'Import') {
        if (!addLiteralSpecifier(args[0], specifiers)) unsupported.add('import(<运行时表达式>)');
      } else if (callee?.type === 'Identifier' && callee.name === 'require') {
        if (!addLiteralSpecifier(args[0], specifiers)) unsupported.add('require(<运行时表达式>)');
      } else if (isImportMetaGlob(callee)) {
        unsupported.add('import.meta.glob(...)');
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'loc' && key !== 'start' && key !== 'end') visit(child);
    }
  };
  visit(ast);
  return { specifiers: [...specifiers], unsupported: [...unsupported] };
}

function addLiteralSpecifier(value: unknown, target: Set<string>): boolean {
  const node = objectRecord(value);
  if (node?.type !== 'StringLiteral' || typeof node.value !== 'string') return false;
  target.add(node.value);
  return true;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isImportMetaGlob(callee: Record<string, unknown> | null): boolean {
  if (callee?.type !== 'MemberExpression') return false;
  const property = objectRecord(callee.property);
  const object = objectRecord(callee.object);
  const meta = objectRecord(object?.meta);
  const propertyName = property?.type === 'Identifier' && typeof property.name === 'string' ? property.name : '';
  return (propertyName === 'glob' || propertyName === 'globEager')
    && object?.type === 'MetaProperty'
    && meta?.type === 'Identifier'
    && meta.name === 'import';
}

function resolveImport(root: string, importer: string, specifier: string): string | null {
  const workspace = WORKSPACE_PACKAGES[specifier];
  if (workspace !== undefined) return resolve(root, workspace);
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(importer), specifier);
  const extension = extname(base);
  const sourceBase = compiledSourceBase(root, base);
  const compiledMapping = sourceBase !== base;
  const candidates = extension === '.js'
    ? compiledMapping
      ? [replaceExtension(sourceBase, '.ts'), replaceExtension(sourceBase, '.tsx'), replaceExtension(sourceBase, '.mts')]
      : [replaceExtension(base, '.ts'), replaceExtension(base, '.tsx'), replaceExtension(base, '.mts'), base]
    : extension === ''
      ? [`${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.mjs`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]
      : [base];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile()) ?? candidates[0] ?? null;
}

function compiledSourceBase(root: string, compiledPath: string): string {
  const mappings = [
    ['apps/api/dist', 'apps/api/src'],
    ['apps/worker/dist', 'apps/worker/src'],
    ['coauthoring-v7/backend/dist', 'coauthoring-v7/backend']
  ] as const;
  for (const [compiledRoot, sourceRoot] of mappings) {
    const compiled = resolve(root, compiledRoot);
    if (compiledPath === compiled
      || compiledPath.startsWith(`${compiled}\\`)
      || compiledPath.startsWith(`${compiled}/`)) {
      return resolve(root, sourceRoot, relative(compiled, compiledPath));
    }
  }
  return compiledPath.replace(/([\\/])dist([\\/])/, '$1src$2');
}

function listSourceFiles(root: string): string[] {
  return listFiles(root).filter((path) => isSourceFile(path) && !isExcludedSource(path));
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'dist' && entry.name !== 'node_modules') files.push(...listFiles(path));
    } else if (entry.isFile()) files.push(path);
  }
  return files;
}

function isSourceFile(path: string): boolean {
  return ['.ts', '.tsx', '.mts', '.mjs'].includes(extname(path)) && !path.endsWith('.d.ts') && !path.endsWith('.d.mts');
}

function isExcludedSource(path: string): boolean {
  const name = path.replaceAll('\\', '/');
  return /\.(test|spec)\.[^.]+$/.test(name)
    || name.endsWith('/test-setup.ts')
    || name.endsWith('/vitest.config.mjs');
}

function isProductionSource(root: string, path: string): boolean {
  return SOURCE_ROOTS.some((sourceRoot) => {
    const base = resolve(root, sourceRoot);
    return path === base || path.startsWith(`${base}\\`) || path.startsWith(`${base}/`);
  }) && isSourceFile(path) && !isExcludedSource(path);
}

function manifestFiles(root: string, paths: string[], category: ClosureCategory) {
  return paths.map((path) => ({ path: portable(root, path), category, sha256: sha256(path) }));
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function portable(root: string, path: string): string {
  return relative(root, path).replaceAll('\\', '/');
}

function replaceExtension(path: string, extension: string): string {
  return `${path.slice(0, -extname(path).length)}${extension}`;
}

function absoluteExisting(root: string, path: string, errors: string[]): string | null {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) {
    errors.push(`V7入口不存在：${path}`);
    return null;
  }
  return absolute;
}

function isString(value: string | null): value is string {
  return value !== null;
}

function main(): void {
  const result = buildV7RuntimeClosure();
  if (result.errors.length > 0) {
    console.error('V7 运行源码闭包门禁失败：');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  const outputIndex = process.argv.indexOf('--output');
  if (outputIndex >= 0) {
    const requested = process.argv[outputIndex + 1];
    if (requested === undefined) throw new Error('--output 缺少文件路径');
    const output = resolve(DEFAULT_ROOT, requested);
    const artifactsRoot = resolve(DEFAULT_ROOT, 'artifacts');
    if (extname(output).toLowerCase() !== '.json'
      || !(output.startsWith(`${artifactsRoot}\\`) || output.startsWith(`${artifactsRoot}/`))) {
      throw new Error('运行闭包清单只能写入 artifacts 目录下的 JSON 文件');
    }
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');
  }
  const summary = result.manifest.summary;
  console.log(`V7 运行源码闭包通过：运行源码 ${summary.runtimeSourceFiles}，运维源码 ${summary.operationalSourceFiles}，运维资源 ${summary.operationalResources}，迁移 ${summary.migrations}，静态资源 ${summary.staticResources}。`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
