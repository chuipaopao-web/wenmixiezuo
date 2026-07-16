import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cacheSnapshot, loadDraft, loadSnapshot, saveDraft } from '../../../apps/web/src/lib/offline/offline-store';

describe('PWA与离线数据', () => {
  it('草稿按书隔离，正史修订变化后旧快照立即失效', async () => {
    await saveDraft('book-offline-a', '甲书草稿');
    await saveDraft('book-offline-b', '乙书草稿');
    expect(await loadDraft('book-offline-a')).toBe('甲书草稿');
    expect(await loadDraft('book-offline-b')).toBe('乙书草稿');

    await cacheSnapshot('chapter:book-offline-a:1', 'book-offline-a', 4, '第四版正文');
    expect(await loadSnapshot('chapter:book-offline-a:1', 4)).toBe('第四版正文');
    expect(await loadSnapshot('chapter:book-offline-a:1', 5)).toBeNull();
    expect(await loadSnapshot('chapter:book-offline-a:1', 4)).toBeNull();
  });

  it('安装清单和离线外壳完整且API响应不会被Service Worker缓存', () => {
    const publicDir = resolve(process.cwd(), 'apps/web/public');
    const manifest = JSON.parse(readFileSync(resolve(publicDir, 'manifest.webmanifest'), 'utf8')) as {
      name: string; display: string; icons: unknown[]
    };
    const worker = readFileSync(resolve(publicDir, 'sw.js'), 'utf8');
    expect(manifest).toMatchObject({ name: '文脉写作', display: 'standalone' });
    expect(manifest.icons).not.toHaveLength(0);
    expect(readFileSync(resolve(publicDir, 'icon.svg'), 'utf8')).toContain('<svg');
    expect(worker).toContain("requestUrl.pathname.startsWith('/api/')");
    expect(worker).toContain("caches.match('/index.html')");
  });
});
