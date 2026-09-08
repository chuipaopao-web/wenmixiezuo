// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AiWorkNodes } from './AiWorkNodes';
import type { RebuildUnit } from '../../backend/admin/rebuild-control-types.js';
afterEach(cleanup);
const unit = { id: 'RB-21', name: '设定', details: [
  { label: '实际AI节点·AI-001', text: '设计条目｜编剧｜设计｜提交设计时。｜service.ts:10' },
  { label: '实际AI节点·AI-002', text: '设计换员｜后备编剧｜换员｜明确失败时。｜service.ts:20' }
] } as RebuildUnit;
it('展开所有步骤，类型和搜索组合筛选，清空及跳转可用', () => {
  const select = vi.fn();
  render(<AiWorkNodes units={[unit]} onSelect={select} />);
  expect(screen.getByText('设计条目')).toBeVisible();
  expect(screen.getByText('设计换员')).toBeVisible();
  fireEvent.change(screen.getByLabelText('工作类型'), { target: { value: '换员' } });
  expect(screen.queryByText('设计条目')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('搜索工作节点'), { target: { value: '不存在' } });
  expect(screen.getByRole('status')).toHaveTextContent('没有匹配');
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
  fireEvent.click(screen.getByRole('button', { name: '功能详情 →' }));
  expect(select).toHaveBeenCalledWith('RB-21');
  expect(screen.getByText('这些操作不启动 AI')).toBeVisible();
});
it('文档未登记时明确未知，不宣称没有模型调用', () => {
  render(<AiWorkNodes units={[]} onSelect={vi.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent('不能据此判断软件没有AI调用');
});
it('正式清单ID唯一、字段完整、代码来源存在，并覆盖当前直接调用文件', () => {
  const root = resolve(process.cwd(), '../..');
  const plan = readFileSync(resolve(root, 'docs/REBUILD_EXECUTION_PLAN.md'), 'utf8');
  const rows = [...plan.matchAll(/^- \*\*实际AI节点·([^*]+)\*\*：(.+)$/gm)];
  expect(rows.length).toBeGreaterThan(100);
  expect(new Set(rows.map(r => r[1])).size).toBe(rows.length);
  const covered = new Set<string>();
  for (const row of rows) {
    const fields = row[2]!.trim().split('｜');
    expect(fields).toHaveLength(5);
    expect(fields.every(Boolean)).toBe(true);
    const [path, line] = fields[4]!.split(':');
    covered.add(path!);
    const source = readFileSync(resolve(root, path!), 'utf8');
    expect(Number(line)).toBeGreaterThan(0);
    expect(Number(line)).toBeLessThanOrEqual(source.split('\n').length);
  }
  // Shared transport wrappers delegate to semantic work registered under their caller.
  const wrappers = new Set([
    'apps/api/src/infrastructure/models/v7-opening-agent-model-gateway.ts',
    'apps/api/src/infrastructure/models/v7-character-memory-model-gateway.ts',
    'rebuild/packages/backend/src/application/opening-tasks/existing-model-executor.ts'
  ]);
  function scan(dir: string) {
    for (const file of readdirSync(resolve(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${file.name}`;
      if (file.isDirectory()) { scan(path); continue; }
      if (!path.endsWith('.ts') || /\.(test|spec)\.ts$/.test(path)) continue;
      const source = readFileSync(resolve(root, path), 'utf8');
      if (/await\s+[^;\n]*\.generate\(/.test(source)) expect(covered.has(path) || wrappers.has(path), path).toBe(true);
    }
  }
  scan('apps/api/src'); scan('apps/worker/src'); scan('rebuild/packages/backend/src');
});
