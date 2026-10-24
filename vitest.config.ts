import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    maxWorkers: 2,
    testTimeout: 30_000,
    env: {
      BOOKIT_BUILD_ALLOW_TEST_CLOCK: 'true',
      BOOKIT_TEST_CLOCK: path.resolve(import.meta.dirname, 'tests/fixtures/clock.json'),
    },
    reporters: ['default', 'json'],
    outputFile: { json: 'test-results/vitest/results.json' },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 240_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
