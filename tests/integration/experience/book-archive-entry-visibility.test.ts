import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync(new URL('../../../apps/web/src/app/app.css', import.meta.url), 'utf8');
const workflowCss = readFileSync(new URL('../../../apps/web/src/features/core-workflow/core-workflow-v6.css', import.meta.url), 'utf8');

describe('书籍归档入口可见性回归门禁', () => {
  it('浅色书架在旧深色规则之后恢复可读文字，并保留手机触控高度', () => {
    const oldDarkSidebarRule = workflowCss.indexOf(
      '.app-shell.unified-desk .rail-archived-books summary { color: rgb(245 240 226 / 58%); }'
    );
    const lightSidebarRule = workflowCss.lastIndexOf(
      '.app-shell.unified-desk .rail-archived-books summary { color: var(--ink-soft); }'
    );

    expect(oldDarkSidebarRule).toBeGreaterThanOrEqual(0);
    expect(lightSidebarRule).toBeGreaterThan(oldDarkSidebarRule);
    expect(appCss).toMatch(/\.sidebar-book-actions \.archive-current-book \{[^}]*min-height:\s*44px;[^}]*color:\s*var\(--ink-soft\);/su);
  });

  it('手机书架层级高于遮罩，同时保留打开后的可点击状态', () => {
    expect(appCss).toMatch(/\.drawer-scrim \{[^}]*z-index:\s*60;/su);
    expect(appCss).toContain('.app-shell.unified-desk .ios-book-sidebar { z-index: 70; }');
    expect(appCss).toContain('.ios-book-sidebar.drawer-open { transform: translateX(0); visibility: visible; pointer-events: auto; }');
  });
});
