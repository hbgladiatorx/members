import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/env.ts'],
    fileParallelism: false, // tests share one database
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
