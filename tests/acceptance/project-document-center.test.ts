import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error jsdom is an existing runtime-only test dependency without bundled declarations.
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

describe('桌面项目文档中心', () => {
  it('只展示当前白名单并能在同一页面阅读全文', () => {
    const html = readFileSync(resolve(process.cwd(), 'docs/PROJECT_DOCUMENT_CENTER.html'), 'utf8');
    const bundle = readFileSync(resolve(process.cwd(), 'docs/PROJECT_REFERENCE_BUNDLE.md'), 'utf8');
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      // JSDOM treats file: pages as opaque origins and may throw while Vitest inspects
      // browser storage. The launcher contract below separately verifies the real file URI.
      url: 'https://wenmi.local/PROJECT_DOCUMENT_CENTER.html?v=test'
    });
    const { document, MouseEvent, Event } = dom.window;
    const cards = [...document.querySelectorAll<HTMLButtonElement>('.card')];
    const templates = [...document.querySelectorAll<HTMLTemplateElement>('template[data-path]')];
    const reader = document.querySelector<HTMLDialogElement>('#reader');
    const close = document.querySelector<HTMLButtonElement>('#close-reader');
    const search = document.querySelector<HTMLInputElement>('#search');
    const bundleButton = document.querySelector<HTMLButtonElement>("[data-open-document='project-reference-bundle']");
    const copyButton = document.querySelector<HTMLButtonElement>('#copy-reader');

    expect(cards).toHaveLength(39);
    expect(templates).toHaveLength(cards.length + 1);
    expect(html).not.toContain('openai.yaml');
    expect(cards.every((card) => card.textContent?.includes('阅读全文'))).toBe(true);
    expect(reader).not.toBeNull();
    expect(close).not.toBeNull();
    expect(search).not.toBeNull();
    expect(bundleButton).not.toBeNull();
    expect(copyButton).not.toBeNull();
    expect(Buffer.byteLength(bundle, 'utf8')).toBeGreaterThan(150_000);
    expect(bundle).toContain('# 文秘写作当前项目完整合订版');
    expect(bundle).not.toContain('\r');
    expect(bundle).toContain('## 一、产品定位与完整工作流');
    expect(bundle).toContain('## 六、项目 Skills');
    expect(bundle).toContain('.agents/skills/wenmi-longform-quality/SKILL.md');
    expect(bundle).toContain('.agents/skills/wenmi-ui-ux/SKILL.md');
    expect(bundle).not.toContain('> 当前源文件：docs/history/');
    expect((bundle.match(/^> 当前源文件：/gmu) ?? [])).toHaveLength(39);

    Object.defineProperty(reader!, 'showModal', {
      configurable: true,
      value() { reader!.open = true; }
    });
    Object.defineProperty(reader!, 'close', {
      configurable: true,
      value() { reader!.open = false; }
    });

    cards[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(reader!.open).toBe(true);
    expect(document.querySelector('#reader-title')?.textContent?.trim().length).toBeGreaterThan(0);
    expect(document.querySelector('#reader-content')?.textContent?.trim().length).toBeGreaterThan(300);

    close!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(reader!.open).toBe(false);

    bundleButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(reader!.open).toBe(true);
    expect(document.querySelector('#reader-title')?.textContent).toContain('完整合订版');
    const bundledReaderText = document.querySelector('#reader-content')?.textContent?.trim() ?? '';
    expect(Buffer.byteLength(bundledReaderText, 'utf8')).toBeGreaterThan(150_000);
    close!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    search!.value = '当前API';
    search!.dispatchEvent(new Event('input', { bubbles: true }));
    const visible = cards.filter((card) => !card.classList.contains('hidden'));
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.some((card) => card.textContent?.includes('当前API与事件契约'))).toBe(true);

    dom.window.close();
  });

  it('桌面启动脚本每次同步并使用版本化地址打开', () => {
    const launcher = readFileSync(resolve(process.cwd(), 'scripts/open-project-docs.ps1'), 'utf8');
    expect(launcher).toContain("& $nodeExecutable $syncScript");
    expect(launcher).toContain("GetLastWriteTimeUtc($documentCenter).Ticks");
    expect(launcher).toContain("$documentUri + '?v=' + $version");
  });
});