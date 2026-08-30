import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assembleV7StaticRelease,
  resolveCurrentV7StaticRelease,
  resolveReleaseRoot,
  resolveStaticRequest,
  verifyV7StaticRelease
} from '../../../scripts/release/v7-static-release.mjs';
import { createV7StaticServer } from '../../../scripts/release/serve-v7-static.mjs';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createFixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'wenmi-v7-release-'));
  temporaryRoots.push(projectRoot);
  const authorDist = join(projectRoot, 'coauthoring-v7', 'author-app', 'dist');
  const adminDist = join(projectRoot, 'coauthoring-v7', 'admin-console', 'dist');
  await mkdir(join(authorDist, 'assets'), { recursive: true });
  await mkdir(join(adminDist, 'assets'), { recursive: true });
  await writeFile(join(authorDist, 'index.html'), '<div id="root"></div><script type="module" src="/assets/author.js"></script>', 'utf8');
  await writeFile(join(authorDist, 'assets', 'author.js'), 'console.log("author")', 'utf8');
  await writeFile(join(adminDist, 'index.html'), '<div id="root"></div><script type="module" src="/v7/assets/admin.js"></script>', 'utf8');
  await writeFile(join(adminDist, 'assets', 'admin.js'), 'console.log("admin")', 'utf8');
  return { projectRoot };
}

describe('V7 组合静态发布包', () => {
  it('根工作区构建两个 V7 Web 包并组装原子发布产物', async () => {
    const projectRoot = resolve(import.meta.dirname, '..', '..', '..');
    const rootPackage = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
    const lock = JSON.parse(await readFile(join(projectRoot, 'package-lock.json'), 'utf8'));
    const caddy = await readFile(join(projectRoot, 'deploy', 'Caddyfile'), 'utf8');
    const launcher = await readFile(join(projectRoot, 'scripts', 'start.mjs'), 'utf8');
    const activation = await readFile(join(projectRoot, 'deploy', 'activate-v7-static.sh'), 'utf8');

    expect(rootPackage.workspaces).toEqual(expect.arrayContaining([
      'coauthoring-v7/author-app',
      'coauthoring-v7/admin-console'
    ]));
    expect(rootPackage.scripts.build).toBe(
      'npm run build -w @wenmi/contracts && npm run build -w @wenmi/v7-backend && npm run build -w @wenmi/api && npm run build -w @wenmi/worker && npm run build:v7:static-release'
    );
    expect(rootPackage.scripts['build:v7:web']).toContain('@wenmi/v7-author-app');
    expect(rootPackage.scripts['build:v7:web']).toContain('@wenmi/v7-admin-console');
    expect(launcher).toContain('resolveCurrentV7StaticRelease(projectRoot)');
    expect(launcher).toContain('scripts/release/serve-v7-static.mjs');
    expect(launcher).not.toContain("resolve(projectRoot, 'apps/web')");
    expect(activation).toContain('verify-v7-static.mjs');
    expect(activation).toContain('mv -Tf "$temporary_link" "$current_link"');
    expect(activation).toContain('previous_link="$release_root/previous"');
    expect(lock.packages['coauthoring-v7/author-app'].name).toBe('@wenmi/v7-author-app');
    expect(lock.packages['coauthoring-v7/admin-console'].name).toBe('@wenmi/v7-admin-console');
    expect(lock.packages['node_modules/@wenmi/v7-author-app'].link).toBe(true);
    expect(lock.packages['node_modules/@wenmi/v7-admin-console'].link).toBe(true);
    expect(caddy).toMatch(/try_files \{path\} \/index\.html/u);
    expect(caddy).toMatch(/root \* \/opt\/wenmi\/releases\/current/u);
    expect(caddy).not.toContain('/opt/wenmi/apps/web/dist');
    expect(caddy).toMatch(/handle \/v7\/\*/u);
    expect(caddy).toMatch(/try_files \{path\} \/v7\/index\.html/u);
    expect(caddy).toMatch(/admin\.wenmixiezuo\.com[\s\S]*handle \{\s+redir \* \/v7\/ 308/u);
  });

  it('把作者端放在根、后台放在 /v7，并生成可重复校验的内容发布号', async () => {
    const fixture = await createFixture();
    const first = await assembleV7StaticRelease(fixture);
    const second = await assembleV7StaticRelease(fixture);

    expect(second.releaseId).toBe(first.releaseId);
    expect(second.releaseDirectory).toBe(first.releaseDirectory);
    expect(await readFile(join(first.releaseDirectory, 'index.html'), 'utf8')).toContain('/assets/author.js');
    expect(await readFile(join(first.releaseDirectory, 'v7', 'index.html'), 'utf8')).toContain('/v7/assets/admin.js');
    await expect(resolveCurrentV7StaticRelease(fixture.projectRoot)).resolves.toMatchObject({ releaseId: first.releaseId });
  });

  it('拒绝被篡改、缺失或夹带清单外文件的发布包', async () => {
    const tampered = await createFixture();
    const tamperedRelease = await assembleV7StaticRelease(tampered);
    await writeFile(join(tamperedRelease.releaseDirectory, 'assets', 'author.js'), 'console.log("tamper")', 'utf8');
    await expect(verifyV7StaticRelease(tamperedRelease.releaseDirectory)).rejects.toThrow('哈希不一致');

    const missing = await createFixture();
    const missingRelease = await assembleV7StaticRelease(missing);
    await unlink(join(missingRelease.releaseDirectory, 'v7', 'assets', 'admin.js'));
    await expect(verifyV7StaticRelease(missingRelease.releaseDirectory)).rejects.toThrow();

    const extra = await createFixture();
    const extraRelease = await assembleV7StaticRelease(extra);
    await writeFile(join(extraRelease.releaseDirectory, 'unexpected.txt'), 'unexpected', 'utf8');
    await expect(verifyV7StaticRelease(extraRelease.releaseDirectory)).rejects.toThrow('清单外文件');
  });

  it('拒绝后台构建使用错误基址', async () => {
    const fixture = await createFixture();
    await writeFile(
      join(fixture.projectRoot, 'coauthoring-v7', 'admin-console', 'dist', 'index.html'),
      '<script type="module" src="/assets/admin.js"></script>',
      'utf8'
    );
    await expect(assembleV7StaticRelease(fixture)).rejects.toThrow('没有使用 /v7/ 基址');
  });

  it('按作者端、后台和上游路径分别解析深链接', () => {
    const files = new Set(['index.html', 'assets/author.js', 'v7/index.html', 'v7/assets/admin.js']);
    expect(resolveStaticRequest('/some/book/chapter/12', files)).toEqual({ kind: 'file', path: 'index.html' });
    expect(resolveStaticRequest('/v7/agents/active', files)).toEqual({ kind: 'file', path: 'v7/index.html' });
    expect(resolveStaticRequest('/v7', files)).toEqual({ kind: 'redirect', location: '/v7/' });
    expect(resolveStaticRequest('/api/v1/auth/me', files)).toEqual({ kind: 'upstream' });
    expect(resolveStaticRequest('/health', files)).toEqual({ kind: 'upstream' });
  });

  it('拒绝把暂存目录指向在线或源码构建目录', async () => {
    const fixture = await createFixture();
    expect(() => resolveReleaseRoot(fixture.projectRoot, 'apps/web/dist')).toThrow('发布暂存目录必须位于');
    expect(() => resolveReleaseRoot(fixture.projectRoot, 'coauthoring-v7/author-app/dist')).toThrow('发布暂存目录必须位于');
  });

  it('经校验后同时服务作者端、后台深链接并把API交给上游', async () => {
    const fixture = await createFixture();
    const release = await assembleV7StaticRelease(fixture);
    const server = await createV7StaticServer({ releaseDirectory: release.releaseDirectory, apiPort: 1 });
    await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('测试服务器没有TCP地址');
    try {
      await expect(fetch(`http://127.0.0.1:${address.port}/books/example/chapter/2`).then((response) => response.text()))
        .resolves.toContain('/assets/author.js');
      await expect(fetch(`http://127.0.0.1:${address.port}/v7/agents/example`).then((response) => response.text()))
        .resolves.toContain('/v7/assets/admin.js');
      await expect(fetch(`http://127.0.0.1:${address.port}/api/v1/auth/me`).then((response) => response.status))
        .resolves.toBe(502);
    } finally {
      await new Promise<void>((resolvePromise, rejectPromise) => server.close((error) => error === undefined ? resolvePromise() : rejectPromise(error)));
    }
  });
});
