import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const RELEASE_SCHEMA_VERSION = 1;
export const MANIFEST_FILE_NAME = 'release-manifest.json';
export const CURRENT_POINTER_FILE_NAME = 'current.json';
export const DEFAULT_RELEASE_ROOT = join('artifacts', 'v7-static-releases');

const CONTENT_ID_PREFIX = 'wenmi-v7-static-release-v1\0';
const AUTHOR_ENTRY = 'index.html';
const ADMIN_ENTRY = 'v7/index.html';

function asPosixPath(path) {
  return path.split(sep).join('/');
}

function assertPortableRelativePath(path) {
  if (!path || isAbsolute(path) || path.includes('\\')) {
    throw new Error(`发布文件路径必须是正斜线相对路径：${path}`);
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`发布文件路径不能包含空段或目录穿越：${path}`);
  }
}

function assertInside(childPath, parentPath, label) {
  const relation = relative(parentPath, childPath);
  if (!relation || relation.startsWith(`..${sep}`) || relation === '..' || isAbsolute(relation)) {
    throw new Error(`${label}必须位于 ${parentPath} 内部，实际为 ${childPath}`);
  }
}

export function resolveReleaseRoot(projectRoot, requestedRoot = DEFAULT_RELEASE_ROOT) {
  const normalizedProjectRoot = resolve(projectRoot);
  const allowedRoot = resolve(normalizedProjectRoot, DEFAULT_RELEASE_ROOT);
  const candidate = resolve(normalizedProjectRoot, requestedRoot);
  if (candidate !== allowedRoot) assertInside(candidate, allowedRoot, '发布暂存目录');
  return candidate;
}

async function listFiles(rootDirectory) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile()) files.push(absolutePath);
      else throw new Error(`发布源目录不能包含符号链接或特殊文件：${absolutePath}`);
    }
  }
  await visit(rootDirectory);
  return files;
}

async function sha256File(filePath) {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function describeSurface(sourceRoot, targetPrefix, surface) {
  const sourceFiles = await listFiles(sourceRoot);
  return Promise.all(sourceFiles.map(async (sourcePath) => {
    const sourceRelativePath = asPosixPath(relative(sourceRoot, sourcePath));
    const targetPath = targetPrefix ? `${targetPrefix}/${sourceRelativePath}` : sourceRelativePath;
    assertPortableRelativePath(targetPath);
    const metadata = await stat(sourcePath);
    return {
      path: targetPath,
      bytes: metadata.size,
      sha256: await sha256File(sourcePath),
      surface,
      sourcePath
    };
  }));
}

function calculateReleaseId(files) {
  const hash = createHash('sha256').update(CONTENT_ID_PREFIX);
  for (const file of files) {
    hash.update(file.path).update('\0');
    hash.update(String(file.bytes)).update('\0');
    hash.update(file.sha256).update('\n');
  }
  return hash.digest('hex').slice(0, 20);
}

function manifestFromFiles(files) {
  const publicFiles = files.map(({ sourcePath: _sourcePath, ...file }) => file);
  return {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    releaseId: calculateReleaseId(publicFiles),
    surfaces: {
      author: { base: '/', entry: AUTHOR_ENTRY, fallback: AUTHOR_ENTRY },
      admin: { base: '/v7/', entry: ADMIN_ENTRY, fallback: ADMIN_ENTRY }
    },
    upstreamRoutes: ['/api', '/api/*', '/health'],
    entrySwapOrder: [ADMIN_ENTRY, AUTHOR_ENTRY],
    files: publicFiles
  };
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function copyReleaseFiles(files, targetDirectory) {
  for (const file of files) {
    const targetPath = join(targetDirectory, ...file.path.split('/'));
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(file.sourcePath, targetPath);
  }
}

function localReferencePaths(html) {
  const references = [];
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gu)) {
    const reference = match[1];
    if (!reference || reference.startsWith('#') || reference.startsWith('data:')
      || reference.startsWith('http:') || reference.startsWith('https:')
      || reference.startsWith('//') || reference.startsWith('mailto:')) continue;
    references.push(reference.split(/[?#]/u, 1)[0]);
  }
  return references;
}

function resolveHtmlReference(entryPath, reference) {
  if (reference.startsWith('/')) return reference.slice(1);
  const baseSegments = dirname(entryPath).split(sep).filter(Boolean);
  const referenceSegments = reference.split('/');
  for (const segment of referenceSegments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') baseSegments.pop();
    else baseSegments.push(segment);
  }
  return baseSegments.join('/');
}

async function verifyHtmlEntrypoint(releaseDirectory, entryPath, requiredBase, filePaths) {
  const html = await readFile(join(releaseDirectory, ...entryPath.split('/')), 'utf8');
  if (/\/src\//u.test(html)) throw new Error(`${entryPath} 仍引用开发源码，不能发布`);
  const references = localReferencePaths(html);
  if (references.length === 0) throw new Error(`${entryPath} 没有可验证的本地资源引用`);
  for (const reference of references) {
    if (requiredBase !== '/' && reference.startsWith('/') && !reference.startsWith(requiredBase)) {
      throw new Error(`${entryPath} 的资源 ${reference} 没有使用 ${requiredBase} 基址`);
    }
    const resolvedReference = resolveHtmlReference(entryPath, reference);
    assertPortableRelativePath(resolvedReference);
    if (!filePaths.has(resolvedReference)) {
      throw new Error(`${entryPath} 引用的发布资源不存在：${reference}`);
    }
  }
}

export function resolveStaticRequest(requestTarget, availableFiles) {
  const pathname = new URL(requestTarget, 'https://wenmixiezuo.com').pathname;
  if (pathname === '/health' || pathname === '/api' || pathname.startsWith('/api/')) {
    return { kind: 'upstream' };
  }
  if (pathname === '/v7') return { kind: 'redirect', location: '/v7/' };

  const candidate = decodeURIComponent(pathname).replace(/^\/+|\/+$/gu, '');
  if (candidate && availableFiles.has(candidate)) return { kind: 'file', path: candidate };
  if (pathname.startsWith('/v7/')) return { kind: 'file', path: ADMIN_ENTRY };
  return { kind: 'file', path: AUTHOR_ENTRY };
}

export async function verifyV7StaticRelease(releaseDirectory) {
  const normalizedReleaseDirectory = resolve(releaseDirectory);
  const manifestPath = join(normalizedReleaseDirectory, MANIFEST_FILE_NAME);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== RELEASE_SCHEMA_VERSION) {
    throw new Error(`不支持的发布清单版本：${manifest.schemaVersion}`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('发布清单没有文件');
  }

  const manifestPaths = new Set();
  for (const file of manifest.files) {
    assertPortableRelativePath(file.path);
    if (manifestPaths.has(file.path)) throw new Error(`发布清单存在重复路径：${file.path}`);
    manifestPaths.add(file.path);
    const absolutePath = join(normalizedReleaseDirectory, ...file.path.split('/'));
    assertInside(absolutePath, normalizedReleaseDirectory, '发布文件');
    const metadata = await stat(absolutePath);
    if (!metadata.isFile()) throw new Error(`发布路径不是文件：${file.path}`);
    if (metadata.size !== file.bytes) throw new Error(`发布文件大小不一致：${file.path}`);
    const digest = await sha256File(absolutePath);
    if (digest !== file.sha256) throw new Error(`发布文件哈希不一致：${file.path}`);
  }

  const actualFiles = (await listFiles(normalizedReleaseDirectory))
    .map((path) => asPosixPath(relative(normalizedReleaseDirectory, path)))
    .filter((path) => path !== MANIFEST_FILE_NAME);
  const extraFiles = actualFiles.filter((path) => !manifestPaths.has(path));
  if (extraFiles.length > 0) throw new Error(`发布包存在清单外文件：${extraFiles.join(', ')}`);
  const missingFiles = [...manifestPaths].filter((path) => !actualFiles.includes(path));
  if (missingFiles.length > 0) throw new Error(`发布包缺少文件：${missingFiles.join(', ')}`);

  const expectedReleaseId = calculateReleaseId(manifest.files);
  if (manifest.releaseId !== expectedReleaseId) {
    throw new Error(`releaseId 不匹配：期望 ${expectedReleaseId}，实际 ${manifest.releaseId}`);
  }
  if (manifest.surfaces?.author?.base !== '/' || manifest.surfaces?.author?.entry !== AUTHOR_ENTRY
    || manifest.surfaces?.admin?.base !== '/v7/' || manifest.surfaces?.admin?.entry !== ADMIN_ENTRY) {
    throw new Error('发布入口或基址不符合 V7 组合包合同');
  }
  if (!manifestPaths.has(AUTHOR_ENTRY) || !manifestPaths.has(ADMIN_ENTRY)) {
    throw new Error('发布包缺少作者端或后台入口');
  }

  await verifyHtmlEntrypoint(normalizedReleaseDirectory, AUTHOR_ENTRY, '/', manifestPaths);
  await verifyHtmlEntrypoint(normalizedReleaseDirectory, ADMIN_ENTRY, '/v7/', manifestPaths);

  const routeChecks = [
    ['/', { kind: 'file', path: AUTHOR_ENTRY }],
    ['/books/example/volume/1', { kind: 'file', path: AUTHOR_ENTRY }],
    ['/v7', { kind: 'redirect', location: '/v7/' }],
    ['/v7/', { kind: 'file', path: ADMIN_ENTRY }],
    ['/v7/agents/member/example', { kind: 'file', path: ADMIN_ENTRY }],
    ['/api/v1/auth/me', { kind: 'upstream' }],
    ['/health', { kind: 'upstream' }]
  ];
  for (const [requestTarget, expected] of routeChecks) {
    const actual = resolveStaticRequest(requestTarget, manifestPaths);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`静态路由校验失败：${requestTarget}`);
    }
  }

  return {
    releaseId: manifest.releaseId,
    releaseDirectory: normalizedReleaseDirectory,
    fileCount: manifest.files.length,
    manifestSha256: await sha256File(manifestPath)
  };
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, stableJson(value), 'utf8');
  await rm(filePath, { force: true });
  await rename(temporaryPath, filePath);
}

export async function assembleV7StaticRelease({
  projectRoot,
  authorDist = join('coauthoring-v7', 'author-app', 'dist'),
  adminDist = join('coauthoring-v7', 'admin-console', 'dist'),
  releaseRoot = DEFAULT_RELEASE_ROOT
}) {
  const normalizedProjectRoot = resolve(projectRoot);
  const normalizedReleaseRoot = resolveReleaseRoot(normalizedProjectRoot, releaseRoot);
  const normalizedAuthorDist = resolve(normalizedProjectRoot, authorDist);
  const normalizedAdminDist = resolve(normalizedProjectRoot, adminDist);
  const files = [
    ...await describeSurface(normalizedAuthorDist, '', 'author'),
    ...await describeSurface(normalizedAdminDist, 'v7', 'admin')
  ].sort((left, right) => left.path.localeCompare(right.path, 'en'));

  const duplicatePaths = files.filter((file, index) => index > 0 && files[index - 1].path === file.path);
  if (duplicatePaths.length > 0) throw new Error(`组合包路径冲突：${duplicatePaths[0].path}`);

  const manifest = manifestFromFiles(files);
  await mkdir(normalizedReleaseRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(normalizedReleaseRoot, '.assembling-'));
  try {
    await copyReleaseFiles(files, temporaryDirectory);
    await writeFile(join(temporaryDirectory, MANIFEST_FILE_NAME), stableJson(manifest), 'utf8');
    const stagedVerification = await verifyV7StaticRelease(temporaryDirectory);
    const releaseDirectory = join(normalizedReleaseRoot, manifest.releaseId);
    try {
      const existingMetadata = await stat(releaseDirectory);
      if (!existingMetadata.isDirectory()) throw new Error(`发布号路径不是目录：${releaseDirectory}`);
      await verifyV7StaticRelease(releaseDirectory);
      await rm(temporaryDirectory, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      try {
        await rename(temporaryDirectory, releaseDirectory);
      } catch (renameError) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(renameError?.code)) throw renameError;
        await verifyV7StaticRelease(releaseDirectory);
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    }

    const verified = await verifyV7StaticRelease(releaseDirectory);
    await writeJsonAtomic(join(normalizedReleaseRoot, CURRENT_POINTER_FILE_NAME), {
      schemaVersion: RELEASE_SCHEMA_VERSION,
      releaseId: verified.releaseId,
      directory: verified.releaseId,
      manifestSha256: verified.manifestSha256
    });
    return { ...verified, sourceFileCount: stagedVerification.fileCount };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function resolveCurrentV7StaticRelease(projectRoot, releaseRoot = DEFAULT_RELEASE_ROOT) {
  const normalizedReleaseRoot = resolveReleaseRoot(projectRoot, releaseRoot);
  const pointer = JSON.parse(await readFile(join(normalizedReleaseRoot, CURRENT_POINTER_FILE_NAME), 'utf8'));
  if (pointer.schemaVersion !== RELEASE_SCHEMA_VERSION || pointer.directory !== pointer.releaseId) {
    throw new Error('当前发布指针格式无效');
  }
  assertPortableRelativePath(pointer.directory);
  const releaseDirectory = join(normalizedReleaseRoot, pointer.directory);
  assertInside(releaseDirectory, normalizedReleaseRoot, '当前发布目录');
  const verified = await verifyV7StaticRelease(releaseDirectory);
  if (verified.releaseId !== pointer.releaseId || verified.manifestSha256 !== pointer.manifestSha256) {
    throw new Error('当前发布指针与组合包不一致');
  }
  return verified;
}
