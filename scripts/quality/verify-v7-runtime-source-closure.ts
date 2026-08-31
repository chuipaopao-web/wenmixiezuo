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

const OPERATIONAL_ENTRY_DEFINITIONS = [
  { path: 'scripts/start.mjs', invokedBy: 'package.json#scripts.start' },
  { path: 'scripts/clean.mjs', invokedBy: 'package.json#scripts.clean' },
  { path: 'scripts/evaluation/production-backup-verify.ts', invokedBy: 'package.json#scripts.verify:backup' },
  { path: 'scripts/evaluation/subscription-model-connectivity.ts', invokedBy: 'package.json#scripts.runtime:model-connectivity' },
  { path: 'scripts/quality/verify-v7-capability-cutover.ts', invokedBy: 'package.json#scripts.verify:capabilities' },
  { path: 'scripts/quality/verify-v7-runtime-source-closure.ts', invokedBy: 'package.json#scripts.verify:runtime-closure' },
  { path: 'scripts/release/assemble-v7-static.mjs', invokedBy: 'package.json#scripts.build:v7:static-release' },
  { path: 'scripts/release/serve-v7-static.mjs', invokedBy: 'scripts/start.mjs' },
  { path: 'scripts/release/verify-v7-static.mjs', invokedBy: 'package.json#scripts.verify:v7:static-release' },
  { path: 'scripts/release/verify-v7-release-module-resolution.ts', invokedBy: 'production preflight/postdeploy' }
] as const;

const PRODUCT_ROLE_ENTRIES = {
  'v7-authoring': [
    'coauthoring-v7/author-app/src/main.tsx',
    'apps/api/src/http/v7-opening-agent-routes.ts',
    'apps/api/src/http/v7-setting-editorial-routes.ts',
    'apps/api/src/http/v7-planning-tree-routes.ts',
    'apps/api/src/http/v7-character-memory-routes.ts',
    'apps/api/src/http/v7-creation-routes.ts'
  ],
  'v7-admin': [
    'coauthoring-v7/admin-console/src/main.tsx',
    'apps/api/src/http/v7-admin-console-routes.ts',
    'apps/api/src/http/v7-admin-platform-routes.ts',
    'apps/api/src/http/v7-prompt-governance-routes.ts'
  ]
} as const;

const BUILD_RESOURCES: ReadonlyArray<{
  path: string;
  productRole: V7ProductRole;
  evidence: V7ClosureEvidence;
}> = [
  { path: '.gitattributes', productRole: 'shared-platform', evidence: { kind: 'deploy-allowlist', from: 'source archive normalization' } },
  { path: '.npmrc', productRole: 'shared-platform', evidence: { kind: 'package-entry', from: 'package.json' } },
  { path: 'RELEASE_ID', productRole: 'deployment-operations', evidence: { kind: 'deploy-allowlist', from: 'release identity' } },
  { path: 'package.json', productRole: 'shared-platform', evidence: { kind: 'package-entry', from: 'workspace root' } },
  { path: 'package-lock.json', productRole: 'shared-platform', evidence: { kind: 'package-entry', from: 'package.json' } },
  { path: 'tsconfig.base.json', productRole: 'shared-platform', evidence: { kind: 'tsconfig-build', from: 'workspace tsconfig chain' } },
  ...workspaceBuildResources('apps/api', 'shared-platform', true),
  ...workspaceBuildResources('apps/contracts', 'shared-platform', true),
  ...workspaceBuildResources('apps/worker', 'shared-platform', true),
  ...workspaceBuildResources('coauthoring-v7/backend', 'shared-platform', true),
  ...workspaceBuildResources('coauthoring-v7/author-app', 'v7-authoring', false),
  ...workspaceBuildResources('coauthoring-v7/admin-console', 'v7-admin', false)
];
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

const RETIRED_EXECUTABLE_SYMBOLS: ReadonlyArray<{ symbol: string; paths: readonly string[] }> = [
  {
    symbol: 'LEGACY_OPENING_TASK_MEMBERS',
    paths: ['apps/api/src/application/books/v7-opening-agent-service.ts']
  },
  {
    symbol: 'v7_opening_work_order_v1',
    paths: [
      'coauthoring-v7/backend/opening-agent/opening-agent-engine.ts',
      'coauthoring-v7/backend/opening-agent/opening-prompt-compiler.ts',
      'coauthoring-v7/backend/agents/agent-tools.ts',
      'coauthoring-v7/backend/agents/agent-skills.ts'
    ]
  },
  {
    symbol: 'executeLegacyRouteWorkflow',
    paths: ['apps/api/src/application/planning/v7-planning-route-service.ts']
  },
  {
    symbol: 'runMethodSeat',
    paths: ['apps/api/src/application/planning/v7-planning-route-service.ts']
  },
  {
    symbol: 'runWriter',
    paths: ['apps/api/src/application/planning/v7-planning-route-service.ts']
  },
  {
    symbol: 'routeMemberReservations',
    paths: ['apps/api/src/application/planning/v7-planning-route-service.ts']
  },
  {
    symbol: 'legacyOutlineMemberKey',
    paths: ['coauthoring-v7/backend/creation-runtime/creation-runtime.ts']
  },
  {
    symbol: 'compatibleCreationMemberKey',
    paths: ['apps/api/src/application/creation/v7-creation-workflow-service.ts']
  },
  {
    symbol: 'legacyRoleKey',
    paths: ['apps/api/src/infrastructure/db/repositories/v7-creation-runtime-repository.ts']
  }
] as const;

export type V7ProductRole =
  | 'v7-authoring'
  | 'v7-admin'
  | 'shared-platform'
  | 'migration-compat'
  | 'deployment-operations';

export type V7ClosureEvidenceKind =
  | 'runtime-entry'
  | 'import'
  | 'package-entry'
  | 'tsconfig-build'
  | 'route-registration'
  | 'task-registry'
  | 'migration-loader'
  | 'static-reference'
  | 'deploy-allowlist'
  | 'manual-command';

export interface V7ClosureEvidence {
  kind: V7ClosureEvidenceKind;
  from: string;
}

type ClosureCategory =
  | 'runtime'
  | 'operations'
  | 'operational-resource'
  | 'migration'
  | 'static-resource'
  | 'build-input';

export interface V7RuntimeClosureFile {
  path: string;
  category: ClosureCategory;
  productRole: V7ProductRole;
  evidence: V7ClosureEvidence[];
  sha256: string;
}

export interface V7RuntimeClosureManifest {
  schema: 'v7-runtime-source-closure-v2';
  releaseId: string;
  entries: string[];
  operationalEntries: string[];
  summary: {
    runtimeSourceFiles: number;
    operationalSourceFiles: number;
    operationalResources: number;
    migrations: number;
    staticResources: number;
    buildInputs: number;
    totalFiles: number;
  };
  files: V7RuntimeClosureFile[];
  closureSha256: string;
}

export interface V7RuntimeClosureResult {
  manifest: V7RuntimeClosureManifest;
  errors: string[];
  orphanSourceFiles: string[];
  unassignedProductionFiles: string[];
}

export function buildV7RuntimeClosure(projectRoot = DEFAULT_ROOT): V7RuntimeClosureResult {
  const root = resolve(projectRoot);
  const errors: string[] = [];
  const runtimeEntries = RUNTIME_ENTRIES.map((path) => ({
    path: absoluteExisting(root, path, errors),
    evidence: { kind: 'runtime-entry' as const, from: path }
  })).filter(hasPath);
  const operationalEntries = OPERATIONAL_ENTRY_DEFINITIONS.map((definition) => ({
    path: absoluteExisting(root, definition.path, errors),
    evidence: { kind: 'manual-command' as const, from: definition.invokedBy }
  })).filter(hasPath);

  const runtime = traceImports(root, runtimeEntries, errors);
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
  for (const retired of RETIRED_EXECUTABLE_SYMBOLS) {
    for (const path of retired.paths) {
      const absolute = resolve(root, path);
      if (existsSync(absolute) && readFileSync(absolute, 'utf8').includes(retired.symbol)) {
        errors.push(`已退役执行符号重新出现：${path} -> ${retired.symbol}`);
      }
    }
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

  const authorRole = traceRoleImports(root, PRODUCT_ROLE_ENTRIES['v7-authoring'], errors);
  const adminRole = traceRoleImports(root, PRODUCT_ROLE_ENTRIES['v7-admin'], errors);
  const runtimeSource = [...runtime.sourceFiles].toSorted();
  const operationalSource = [...operations.sourceFiles]
    .filter((path) => !runtime.sourceFiles.has(path))
    .toSorted();
  const assignedOperationalFiles = new Set([
    ...operations.sourceFiles,
    ...operations.resources,
    ...operationalResources
  ]);
  const rootLaunchers = listFilesShallow(root)
    .filter((path) => ['.cmd', '.ps1'].includes(extname(path).toLowerCase()));
  const allOperationalFiles = [
    ...listFiles(resolve(root, 'scripts')),
    ...listFiles(resolve(root, 'deploy')),
    ...rootLaunchers
  ].filter((path, index, all) => all.indexOf(path) === index);
  const unassignedOperationalSource = allOperationalFiles
    .filter((path) => !assignedOperationalFiles.has(path))
    .map((path) => portable(root, path))
    .toSorted();
  for (const path of unassignedOperationalSource) errors.push(`运维文件没有显式调用或部署入口：${path}`);

  const authorIndex = resolve(root, 'coauthoring-v7/author-app/index.html');
  const adminIndex = resolve(root, 'coauthoring-v7/admin-console/index.html');
  const publicFiles = [
    ...listFiles(resolve(root, 'coauthoring-v7/author-app/public')),
    ...listFiles(resolve(root, 'coauthoring-v7/admin-console/public'))
  ];
  const staticReferenceCorpus = [
    ...runtimeSource,
    ...runtime.resources,
    authorIndex,
    adminIndex
  ].filter((path) => existsSync(path) && isTextReferenceFile(path));
  const publicEvidence = new Map<string, V7ClosureEvidence[]>();
  const unassignedStaticResources: string[] = [];
  for (const path of publicFiles) {
    const evidence = staticReferenceEvidence(root, path, staticReferenceCorpus);
    if (evidence.length === 0) unassignedStaticResources.push(portable(root, path));
    else publicEvidence.set(path, evidence);
  }
  unassignedStaticResources.sort();
  for (const path of unassignedStaticResources) errors.push(`静态资源没有作者端或后台引用：${path}`);
  const referencedPublic = publicFiles.filter((path) => publicEvidence.has(path));
  const staticResources = [authorIndex, adminIndex, ...referencedPublic, ...runtime.resources]
    .filter((path, index, all) => existsSync(path) && all.indexOf(path) === index);

  validateWorkspaceBuildGraph(root, errors);
  const buildResources = BUILD_RESOURCES.map((definition) => ({
    definition,
    path: absoluteExisting(root, definition.path, errors)
  })).filter((item): item is { definition: typeof BUILD_RESOURCES[number]; path: string } => item.path !== null);

  const files = [
    ...runtimeSource.map((path) => manifestFile(
      root,
      path,
      'runtime',
      runtimeProductRole(path, authorRole, adminRole),
      evidenceFor(path, runtime.evidence)
    )),
    ...operationalSource.map((path) => manifestFile(
      root,
      path,
      'operations',
      'deployment-operations',
      evidenceFor(path, operations.evidence)
    )),
    ...operationalResources.map((path) => manifestFile(
      root,
      path,
      'operational-resource',
      'deployment-operations',
      evidenceForOperationalResource(root, path, operations.evidence)
    )),
    ...migrationFiles.map((path) => manifestFile(
      root,
      path,
      'migration',
      'migration-compat',
      [{ kind: 'migration-loader', from: 'apps/api/src/infrastructure/db/migrations.ts' }]
    )),
    ...staticResources.map((path) => manifestFile(
      root,
      path,
      'static-resource',
      staticProductRole(root, path, authorRole, adminRole, runtime.evidence),
      staticEvidence(root, path, authorIndex, adminIndex, publicEvidence, runtime.evidence)
    )),
    ...buildResources.map(({ definition, path }) => manifestFile(
      root,
      path,
      'build-input',
      definition.productRole,
      [definition.evidence]
    ))
  ].sort((left, right) => left.path.localeCompare(right.path));
  const duplicateFiles = duplicateValues(files.map((file) => file.path));
  for (const path of duplicateFiles) errors.push(`闭包清单文件重复：${path}`);
  for (const file of files) {
    if (file.evidence.length === 0) errors.push(`生产文件缺少归属证据：${file.path}`);
  }
  const unassignedProductionFiles = [...new Set([
    ...orphanSourceFiles,
    ...unassignedOperationalSource,
    ...unassignedStaticResources
  ])].toSorted();
  const releaseIdPath = resolve(root, 'RELEASE_ID');
  const releaseId = existsSync(releaseIdPath) ? readFileSync(releaseIdPath, 'utf8').trim() : '';
  if (releaseId === '') errors.push('RELEASE_ID 为空或不存在。');
  const manifestCore = {
    schema: 'v7-runtime-source-closure-v2' as const,
    releaseId,
    entries: RUNTIME_ENTRIES.slice(),
    operationalEntries: operationalEntries.map((entry) => portable(root, entry.path)).toSorted(),
    summary: {
      runtimeSourceFiles: runtimeSource.length,
      operationalSourceFiles: operationalSource.length,
      operationalResources: operationalResources.length,
      migrations: migrationFiles.length,
      staticResources: staticResources.length,
      buildInputs: buildResources.length,
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
  return {
    errors: [...new Set(errors)].toSorted(),
    orphanSourceFiles,
    unassignedProductionFiles,
    manifest
  };
}

interface TraceEntry {
  path: string;
  evidence: V7ClosureEvidence;
}

interface TraceResult {
  sourceFiles: Set<string>;
  resources: string[];
  evidence: Map<string, V7ClosureEvidence[]>;
}

function traceImports(root: string, entries: readonly TraceEntry[], errors: string[]): TraceResult {
  const sourceFiles = new Set<string>();
  const resources = new Set<string>();
  const evidence = new Map<string, V7ClosureEvidence[]>();
  const queue = entries.map((entry) => entry.path);
  for (const entry of entries) addEvidence(evidence, entry.path, entry.evidence);
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
      if (resolved === null) {
        if (specifier.startsWith('@wenmi/')) {
          errors.push(`源码引用未知工作区包：${portable(root, file)} -> ${specifier}`);
        }
        continue;
      }
      if (!existsSync(resolved)) {
        errors.push(`源码引用无法解析：${portable(root, file)} -> ${specifier}`);
        continue;
      }
      addEvidence(evidence, resolved, {
        kind: isSourceFile(resolved) ? 'import' : 'static-reference',
        from: portable(root, file)
      });
      if (isSourceFile(resolved)) queue.push(resolved);
      else resources.add(resolved);
    }
  }
  return { sourceFiles, resources: [...resources], evidence };
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

function listFilesShallow(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(root, entry.name));
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

function manifestFile(
  root: string,
  path: string,
  category: ClosureCategory,
  productRole: V7ProductRole,
  evidence: readonly V7ClosureEvidence[]
): V7RuntimeClosureFile {
  return {
    path: portable(root, path),
    category,
    productRole,
    evidence: dedupeEvidence(evidence),
    sha256: sha256(path)
  };
}

function workspaceBuildResources(
  workspace: string,
  productRole: V7ProductRole,
  typescriptBuild: boolean
): Array<{ path: string; productRole: V7ProductRole; evidence: V7ClosureEvidence }> {
  return [
    {
      path: `${workspace}/package.json`,
      productRole,
      evidence: { kind: 'package-entry', from: 'package.json#workspaces' }
    },
    {
      path: `${workspace}/tsconfig.json`,
      productRole,
      evidence: { kind: 'tsconfig-build', from: `${workspace}/package.json#scripts.typecheck` }
    },
    {
      path: `${workspace}/${typescriptBuild ? 'tsconfig.build.json' : 'vite.config.mjs'}`,
      productRole,
      evidence: { kind: 'tsconfig-build', from: `${workspace}/package.json#scripts.build` }
    }
  ];
}

function traceRoleImports(root: string, paths: readonly string[], errors: string[]): Set<string> {
  const entries = paths.map((path) => ({
    path: absoluteExisting(root, path, errors),
    evidence: {
      kind: path.includes('/http/') ? 'route-registration' as const : 'runtime-entry' as const,
      from: path
    }
  })).filter(hasPath);
  return traceImports(root, entries, errors).sourceFiles;
}

function runtimeProductRole(path: string, authorRole: Set<string>, adminRole: Set<string>): V7ProductRole {
  const author = authorRole.has(path);
  const admin = adminRole.has(path);
  if (author && !admin) return 'v7-authoring';
  if (admin && !author) return 'v7-admin';
  return 'shared-platform';
}

function staticProductRole(
  root: string,
  path: string,
  authorRole: Set<string>,
  adminRole: Set<string>,
  runtimeEvidence: Map<string, V7ClosureEvidence[]>
): V7ProductRole {
  if (isWithin(resolve(root, 'coauthoring-v7/author-app'), path)) return 'v7-authoring';
  if (isWithin(resolve(root, 'coauthoring-v7/admin-console'), path)) return 'v7-admin';
  const importers = evidenceFor(path, runtimeEvidence)
    .map((item) => resolve(root, item.from));
  const author = importers.some((importer) => authorRole.has(importer));
  const admin = importers.some((importer) => adminRole.has(importer));
  if (author && !admin) return 'v7-authoring';
  if (admin && !author) return 'v7-admin';
  return 'shared-platform';
}

function staticEvidence(
  root: string,
  path: string,
  authorIndex: string,
  adminIndex: string,
  publicEvidence: Map<string, V7ClosureEvidence[]>,
  runtimeEvidence: Map<string, V7ClosureEvidence[]>
): V7ClosureEvidence[] {
  if (path === authorIndex) {
    return [{ kind: 'package-entry', from: 'coauthoring-v7/author-app/vite.config.mjs' }];
  }
  if (path === adminIndex) {
    return [{ kind: 'package-entry', from: 'coauthoring-v7/admin-console/vite.config.mjs' }];
  }
  return dedupeEvidence([
    ...evidenceFor(path, publicEvidence),
    ...evidenceFor(path, runtimeEvidence)
  ]);
}

function staticReferenceEvidence(
  root: string,
  publicPath: string,
  corpus: readonly string[]
): V7ClosureEvidence[] {
  const authorPublic = resolve(root, 'coauthoring-v7/author-app/public');
  const adminPublic = resolve(root, 'coauthoring-v7/admin-console/public');
  const publicRoot = isWithin(authorPublic, publicPath)
    ? authorPublic
    : isWithin(adminPublic, publicPath)
      ? adminPublic
      : null;
  if (publicRoot === null) return [];
  const publicRelative = portable(publicRoot, publicPath);
  const candidates = [`/${publicRelative}`];
  if (publicRoot === adminPublic) candidates.push(`/v7/${publicRelative}`);
  const evidence: V7ClosureEvidence[] = [];
  for (const referencePath of corpus) {
    if (referencePath === publicPath) continue;
    const text = readFileSync(referencePath, 'utf8');
    if (candidates.some((candidate) => text.includes(candidate))) {
      evidence.push({ kind: 'static-reference', from: portable(root, referencePath) });
    }
  }
  return dedupeEvidence(evidence);
}

function evidenceForOperationalResource(
  root: string,
  path: string,
  evidence: Map<string, V7ClosureEvidence[]>
): V7ClosureEvidence[] {
  const traced = evidenceFor(path, evidence);
  if (traced.length > 0) return traced;
  return [{ kind: 'deploy-allowlist', from: portable(root, path) }];
}

function addEvidence(
  map: Map<string, V7ClosureEvidence[]>,
  path: string,
  evidence: V7ClosureEvidence
): void {
  const current = map.get(path) ?? [];
  map.set(path, dedupeEvidence([...current, evidence]));
}

function evidenceFor(path: string, map: Map<string, V7ClosureEvidence[]>): V7ClosureEvidence[] {
  return dedupeEvidence(map.get(path) ?? []);
}

function dedupeEvidence(evidence: readonly V7ClosureEvidence[]): V7ClosureEvidence[] {
  const values = new Map<string, V7ClosureEvidence>();
  for (const item of evidence) {
    if (item.from.trim() === '') continue;
    values.set(`${item.kind}\u0000${item.from}`, item);
  }
  return [...values.values()].sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.from.localeCompare(right.from));
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  }
  return [...duplicates].toSorted();
}

function isTextReferenceFile(path: string): boolean {
  return ['.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.mts', '.svg', '.ts', '.tsx', '.txt']
    .includes(extname(path).toLowerCase());
}

function isWithin(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === '' || (!child.startsWith('..') && !child.startsWith('/') && !child.startsWith('\\'));
}

function hasPath<T extends { path: string | null }>(value: T): value is T & { path: string } {
  return value.path !== null;
}

function validateWorkspaceBuildGraph(root: string, errors: string[]): void {
  const expectedWorkspaces = [
    'apps/api',
    'apps/contracts',
    'apps/worker',
    'coauthoring-v7/backend',
    'coauthoring-v7/author-app',
    'coauthoring-v7/admin-console'
  ];
  const expectedPackages: ReadonlyArray<{
    workspace: string;
    name: string;
    build: string;
    start?: string;
    exportEntry?: string;
    viteBase?: string;
  }> = [
    { workspace: 'apps/api', name: '@wenmi/api', build: 'tsc -p tsconfig.build.json', start: 'node dist/main.js' },
    { workspace: 'apps/contracts', name: '@wenmi/contracts', build: 'tsc -p tsconfig.build.json', exportEntry: './dist/index.js' },
    { workspace: 'apps/worker', name: '@wenmi/worker', build: 'tsc -p tsconfig.build.json', start: 'node dist/main.js' },
    { workspace: 'coauthoring-v7/backend', name: '@wenmi/v7-backend', build: 'tsc -p tsconfig.build.json', exportEntry: './dist/index.js' },
    { workspace: 'coauthoring-v7/author-app', name: '@wenmi/v7-author-app', build: 'vite build --config vite.config.mjs --configLoader native', viteBase: '/' },
    { workspace: 'coauthoring-v7/admin-console', name: '@wenmi/v7-admin-console', build: 'vite build --config vite.config.mjs --configLoader native', viteBase: '/v7/' }
  ];
  const rootPackage = readJsonObject(resolve(root, 'package.json'), errors);
  const workspaces = Array.isArray(rootPackage?.workspaces)
    ? rootPackage.workspaces.filter((item): item is string => typeof item === 'string')
    : [];
  if (JSON.stringify(workspaces) !== JSON.stringify(expectedWorkspaces)) {
    errors.push(`工作区构建图不是 V7 六工作区：${workspaces.join(', ')}`);
  }
  for (const expected of expectedPackages) {
    const packagePath = resolve(root, expected.workspace, 'package.json');
    const packageJson = readJsonObject(packagePath, errors);
    if (packageJson === null) continue;
    if (packageJson.name !== expected.name) {
      errors.push(`工作区包名不匹配：${expected.workspace} -> ${String(packageJson.name ?? '')}`);
    }
    const scripts = objectRecord(packageJson.scripts);
    if (scripts?.build !== expected.build) {
      errors.push(`工作区构建入口不匹配：${expected.workspace}/package.json#scripts.build`);
    }
    if (expected.start !== undefined && scripts?.start !== expected.start) {
      errors.push(`工作区运行入口不匹配：${expected.workspace}/package.json#scripts.start`);
    }
    if (expected.exportEntry !== undefined) {
      const exportsField = objectRecord(packageJson.exports);
      const dotExport = objectRecord(exportsField?.['.']);
      const resolvedExport = typeof dotExport?.import === 'string'
        ? dotExport.import
        : typeof dotExport?.default === 'string'
          ? dotExport.default
          : typeof packageJson.main === 'string'
            ? packageJson.main
            : '';
      if (resolvedExport !== expected.exportEntry && resolvedExport !== expected.exportEntry.slice(2)) {
        errors.push(`工作区发布导出不匹配：${expected.workspace}/package.json#exports`);
      }
    }
    if (expected.viteBase !== undefined) {
      const vitePath = resolve(root, expected.workspace, 'vite.config.mjs');
      if (!existsSync(vitePath)) continue;
      const vite = readFileSync(vitePath, 'utf8');
      if (!vite.includes(`base: '${expected.viteBase}'`) || !vite.includes("outDir: 'dist'")) {
        errors.push(`Vite发布目录或base不匹配：${expected.workspace}/vite.config.mjs`);
      }
    } else {
      const buildConfigPath = resolve(root, expected.workspace, 'tsconfig.build.json');
      const buildConfig = readJsonObject(buildConfigPath, errors);
      const compilerOptions = objectRecord(buildConfig?.compilerOptions);
      if (buildConfig?.extends !== './tsconfig.json' || compilerOptions?.outDir !== 'dist') {
        errors.push(`TypeScript构建图不匹配：${expected.workspace}/tsconfig.build.json`);
      }
    }
  }
}

function readJsonObject(path: string, errors: string[]): Record<string, unknown> | null {
  if (!existsSync(path)) {
    errors.push(`构建配置不存在：${path.replaceAll('\\', '/')}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    errors.push(`构建配置不是有效JSON：${path.replaceAll('\\', '/')}`);
    return null;
  }
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
  console.log(`V7 运行源码闭包v2通过：运行源码 ${summary.runtimeSourceFiles}，运维源码 ${summary.operationalSourceFiles}，运维资源 ${summary.operationalResources}，迁移 ${summary.migrations}，静态资源 ${summary.staticResources}，构建输入 ${summary.buildInputs}。`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
