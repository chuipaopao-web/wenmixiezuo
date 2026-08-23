import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../../../apps/web/src/app/App.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../../../apps/web/src/features/core-workflow/core-workflow-v6.css', import.meta.url), 'utf8');
const shellCss = readFileSync(new URL('../../../apps/web/src/app/app.css', import.meta.url), 'utf8');

function navKeys(start: string, end: string): string[] {
  const block = appSource.slice(appSource.indexOf(start), appSource.indexOf(end));
  return [...block.matchAll(/\['([^']+)',\s*'[^']+',\s*\w+\]/gu)].map((match) => match[1]);
}

describe('顶部导航排版范围守恒', () => {
  it('保留 11 个入口、原顺序，并按当前入口数量均匀分配桌面宽度', () => {
    const primary = navKeys('const V6_PRIMARY_NAV', 'const V6_UTILITY_NAV');
    const utilities = navKeys('const V6_UTILITY_NAV', 'export function App');
    expect(primary).toEqual(['setting', 'storyline', 'volume', 'event', 'chapter']);
    expect(utilities).toEqual(['library', 'naming', 'team', 'tasks', 'ideas', 'settings']);

    const primaryRule = cssSource.match(/\.app-shell\.unified-desk \.function-nav-primary \{ flex: (\d+) 1 0; grid-template-columns: repeat\((\d+),/u);
    const utilityRule = cssSource.match(/\.app-shell\.unified-desk \.function-nav-utilities \{ flex: (\d+) 1 0; grid-template-columns: repeat\((\d+),/u);
    expect(primaryRule?.slice(1)).toEqual([String(primary.length), String(primary.length)]);
    expect(utilityRule?.slice(1)).toEqual([String(utilities.length), String(utilities.length)]);
  });

  it('手机继续使用原有两排六列结构', () => {
    expect(shellCss).toContain('.ios-function-bar { display: grid; grid-template-columns: 44px repeat(6, minmax(0, 1fr));');
    expect(shellCss).toContain('.function-nav-primary, .function-nav-utilities { display: contents; }');
    expect(shellCss).toContain('.ios-function-bar button span { display: inline; font-size: 10px; line-height: 1.2; }');
  });
});
