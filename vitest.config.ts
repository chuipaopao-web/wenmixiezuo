import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: ['**/dist/**', '**/*.d.ts', 'tests/**'],
      provider: 'v8',
      reporter: ['text', 'json-summary']
    },
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // LanceDB/native-worker suites can exhaust Windows fork resources when Vitest
    // scales to every logical CPU. Keep full-suite execution deterministic.
    maxWorkers: 4,
    pool: 'forks',
    testTimeout: 30_000
  }
});
