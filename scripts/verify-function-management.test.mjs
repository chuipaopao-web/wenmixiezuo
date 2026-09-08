import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { functionSourceDigest, verifyFunctionManagement } from './verify-function-management.mjs';

test('执行来源变更必须重新核对功能说明，换行差异不触发误报', () => {
  const root = mkdtempSync(join(tmpdir(), 'wenmi-function-'));
  try {
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'source.ts'), 'initial\n');
    const keys = ['功能介绍','名称','工位','岗位','任务类型','用户操作','流程','资料供给','注入与压缩','格式化输入','输出与校验','系统职责','思考与解释','调整边界'];
    const doc = '### RB-19 开书\n' + keys.map(k => `- **管理·${k}**：已核对\n`).join('')
      + '- **管理·代码来源**：source.ts\n- **管理·代码核对**：' + functionSourceDigest(root, ['source.ts']) + '\n';
    writeFileSync(join(root, 'docs/REBUILD_EXECUTION_PLAN.md'), doc);
    assert.equal(verifyFunctionManagement(root), 1);
    writeFileSync(join(root, 'source.ts'), 'initial\r\n');
    assert.equal(verifyFunctionManagement(root), 1);
    writeFileSync(join(root, 'source.ts'), 'changed\n');
    assert.throws(() => verifyFunctionManagement(root), /执行来源已变化/);
    assert.throws(() => functionSourceDigest(root, ['../outside']), /超出项目/);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'wenmi-function-'));
    rmSync(root, { recursive: true, force: true });
  }
});
