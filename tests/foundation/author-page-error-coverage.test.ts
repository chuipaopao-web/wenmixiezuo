import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('全部页面的作者错误门', () => {
  it('不直接渲染 Error.message、内部错误码或原始调用证据', () => {
    const roots = [resolve('apps/web/src/app'), resolve('apps/web/src/features')];
    for (const file of roots.flatMap(sourceFiles)) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/\b\w+\s+instanceof\s+Error\s*\?\s*\w+\.message/gu);
      expect(source, file).not.toMatch(/\{[^\n{}]*(?:\.errorCode|\.error_code)[^\n{}]*\}/gu);
      expect(source, file).not.toMatch(/modelCalls|error_detail|stackTrace|stack_trace/gu);
      for (const line of source.split(/\r?\n/u).filter((item) => item.includes('.errorMessage'))) {
        expect(line, `${file}: ${line}`).toContain('authorErrorFromUnknown');
      }
    }
  });
});