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
    pool: 'forks',
    testTimeout: 30_000
  }
});

