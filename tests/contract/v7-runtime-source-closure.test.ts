import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildV7RuntimeClosure,
  inspectSourceSpecifiers
} from '../../scripts/quality/verify-v7-runtime-source-closure.js';

describe('V7运行源码闭包', () => {
  it('所有生产源码都从真实入口可达，旧闭包不能重新出现', () => {
    const result = buildV7RuntimeClosure();
    expect(result.errors).toEqual([]);
    expect(result.orphanSourceFiles).toEqual([]);
    expect(result.manifest.summary.runtimeSourceFiles).toBeGreaterThan(150);
    expect(result.manifest.summary.operationalResources).toBeGreaterThanOrEqual(10);
    expect(result.manifest.summary.migrations).toBe(105);
    expect(result.manifest.files.some((file) => file.path.includes('/dist/'))).toBe(false);
    expect(result.manifest.files.some((file) => file.path.endsWith('/.env.production'))).toBe(false);
    expect(new Set(result.manifest.files.map((file) => file.path)).size).toBe(result.manifest.files.length);
    expect(result.manifest.summary.totalFiles).toBe(
      result.manifest.summary.runtimeSourceFiles
      + result.manifest.summary.operationalSourceFiles
      + result.manifest.summary.operationalResources
      + result.manifest.summary.migrations
      + result.manifest.summary.staticResources
    );
    expect(result.manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
    for (const file of result.manifest.files) {
      expect(createHash('sha256').update(readFileSync(resolve(file.path))).digest('hex')).toBe(file.sha256);
    }
    const { closureSha256, ...manifestCore } = result.manifest;
    expect(closureSha256).toBe(createHash('sha256').update(JSON.stringify(manifestCore)).digest('hex'));
  });

  it('解析真实模块语法而不把注释或普通字符串当引用，并拒绝不可冻结的动态加载', () => {
    const accepted = inspectSourceSpecifiers(`
      // import './comment-only.js';
      const example = "from './string-only.js'";
      import type { Alpha } from './types.js';
      import {
        beta
      } from './multiline.js';
      export * from './exported.js';
      await import('./dynamic-literal.js');
    `);
    expect(accepted.specifiers.toSorted()).toEqual([
      './dynamic-literal.js', './exported.js', './multiline.js', './types.js'
    ]);
    expect(accepted.unsupported).toEqual([]);

    const rejected = inspectSourceSpecifiers(`
      const target = './runtime.js';
      await import(target);
      const modules = import.meta.glob('./pages/*.tsx');
    `);
    expect(rejected.unsupported).toHaveLength(2);
  });
});
