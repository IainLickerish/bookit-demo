import { defineConfig } from '@playwright/test';

// Behaviour evals run against a demo copy of BookIt (see evals/README.md).
export default defineConfig({
  testDir: '.',
  testMatch: '*.eval.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: process.env.EVAL_REPORT ?? 'eval-results/report.json' }]],
  outputDir: process.env.EVAL_OUTPUT ?? 'eval-results/output',
  use: {
    baseURL: process.env.EVAL_BASE_URL ?? 'http://localhost:4101',
    screenshot: 'on',
    trace: 'off',
    timezoneId: 'Europe/London',
    locale: 'en-GB',
  },
});
