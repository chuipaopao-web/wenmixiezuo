import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ClosureFileRecord {
  path: string;
  sha256: string;
}

export interface ReleaseClosureManifest {
  schema: 'v7-runtime-source-closure-v2';
  releaseId: string;
  files: ClosureFileRecord[];
}

export interface ResolvedReleaseModule {
  specifier: '@wenmi/contracts' | '@wenmi/v7-backend';
  resolvedPath: string;
}

const RELEASE_MODULES = [
  {
    specifier: '@wenmi/contracts' as const,
    sourceEntry: 'apps/contracts/src/index.ts',
    compiledEntry: 'apps/contracts/dist/index.js'
  },
  {
    specifier: '@wenmi/v7-backend' as const,
    sourceEntry: 'coauthoring-v7/backend/index.ts',
    compiledEntry: 'coauthoring-v7/backend/dist/index.js'
  }
] as const;

export function validateResolvedReleaseModules(input: {
  releaseSource: string;
  manifest: ReleaseClosureManifest;
  resolutions: readonly ResolvedReleaseModule[];
}): string[] {
  const errors: string[] = [];
  const sourceRoot = canonicalExisting(input.releaseSource, '目标release/source', errors);
  if (sourceRoot === null) return errors;
  const releaseIdPath = resolve(sourceRoot, 'RELEASE_ID');
  if (!existsSync(releaseIdPath)) {
    errors.push('目标release/source缺少RELEASE_ID');
  } else {
    const actualReleaseId = readFileSync(releaseIdPath, 'utf8').trim();
    if (actualReleaseId !== input.manifest.releaseId) {
      errors.push(`闭包清单releaseId与目标发布不一致：${input.manifest.releaseId} != ${actualReleaseId}`);
    }
  }
  if (input.manifest.schema !== 'v7-runtime-source-closure-v2') {
    errors.push(`部署只接受闭包schema v2：${String(input.manifest.schema)}`);
  }
  const records = new Map(input.manifest.files.map((file) => [file.path, file]));
  const resolutions = new Map(input.resolutions.map((item) => [item.specifier, item.resolvedPath]));
  for (const module of RELEASE_MODULES) {
    const sourcePath = resolve(sourceRoot, module.sourceEntry);
    const sourceRecord = records.get(module.sourceEntry);
    if (sourceRecord === undefined) {
      errors.push(`闭包清单缺少工作区源码入口：${module.sourceEntry}`);
    } else if (!existsSync(sourcePath)) {
      errors.push(`目标发布缺少工作区源码入口：${module.sourceEntry}`);
    } else if (sha256(sourcePath) !== sourceRecord.sha256) {
      errors.push(`目标发布源码与闭包哈希不一致：${module.sourceEntry}`);
    }

    const expectedCompiled = canonicalExisting(
      resolve(sourceRoot, module.compiledEntry),
      `${module.specifier}目标构建文件`,
      errors
    );
    const reportedResolution = resolutions.get(module.specifier);
    if (reportedResolution === undefined) {
      errors.push(`模块解析结果缺失：${module.specifier}`);
      continue;
    }
    const actualCompiled = canonicalExisting(reportedResolution, `${module.specifier}实际解析文件`, errors);
    if (expectedCompiled === null || actualCompiled === null) continue;
    if (!isWithin(sourceRoot, actualCompiled)) {
      errors.push(`模块解析越出目标release/source：${module.specifier} -> ${actualCompiled}`);
      continue;
    }
    if (actualCompiled !== expectedCompiled) {
      errors.push(`模块没有解析到目标发布构建文件：${module.specifier} -> ${actualCompiled}`);
      continue;
    }
    if (sha256(actualCompiled) !== sha256(expectedCompiled)) {
      errors.push(`模块运行文件与目标发布哈希不一致：${module.specifier}`);
    }
  }
  return [...new Set(errors)].toSorted();
}

export function verifyV7ReleaseModuleResolution(
  releaseSource: string,
  manifestPath: string
): { releaseId: string; modules: ResolvedReleaseModule[] } {
  const sourceRoot = realpathSync(resolve(releaseSource));
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8')) as ReleaseClosureManifest;
  const apiDist = resolve(sourceRoot, 'apps/api/dist');
  if (!existsSync(apiDist)) throw new Error(`目标发布缺少API构建目录：${apiDist}`);
  const specifiers = RELEASE_MODULES.map((module) => module.specifier);
  const expression = `const names=${JSON.stringify(specifiers)};console.log(JSON.stringify(Object.fromEntries(names.map((name)=>[name,import.meta.resolve(name)]))))`;
  const output = execFileSync(process.execPath, ['--input-type=module', '--eval', expression], {
    cwd: apiDist,
    encoding: 'utf8'
  });
  const resolvedUrls = JSON.parse(output.trim()) as Record<string, string>;
  const modules = RELEASE_MODULES.map((module) => ({
    specifier: module.specifier,
    resolvedPath: fileURLToPath(resolvedUrls[module.specifier] ?? '')
  }));
  const errors = validateResolvedReleaseModules({ releaseSource: sourceRoot, manifest, resolutions: modules });
  if (errors.length > 0) throw new Error(`V7发布模块解析门禁失败：\n- ${errors.join('\n- ')}`);
  return { releaseId: manifest.releaseId, modules };
}

function canonicalExisting(path: string, label: string, errors: string[]): string | null {
  if (!existsSync(path)) {
    errors.push(`${label}不存在：${path}`);
    return null;
  }
  return realpathSync(path);
}

function isWithin(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === '' || (!child.startsWith('..') && !child.startsWith('/') && !child.startsWith('\\'));
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function parseFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function main(): void {
  const releaseSource = parseFlag('--release-source');
  const manifestPath = parseFlag('--manifest');
  if (releaseSource === null || manifestPath === null) {
    throw new Error('用法：tsx scripts/release/verify-v7-release-module-resolution.ts --release-source <release/source> --manifest <closure.json>');
  }
  const result = verifyV7ReleaseModuleResolution(releaseSource, manifestPath);
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
