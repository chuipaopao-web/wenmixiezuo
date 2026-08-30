import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // 这些历史合同测试是可直接执行的 node:assert 脚本，不包含 Vitest
    // suite；由验收命令单独运行，避免 Vitest 把“无 suite”误报为失败。
    exclude: [
      '**/node_modules/**',
      '**/.tmp/**',
      '**/dist/**',
      'agents/agent-foundation.test.ts',
      'narrative-methods/narrative-method-library.test.ts',
      'opening-agent/opening-agent-engine.test.ts',
      'plot-patterns/plot-pattern-library.test.ts'
    ]
  }
});
