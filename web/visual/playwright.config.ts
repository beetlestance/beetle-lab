import { defineConfig } from '@playwright/test';

const port = Number(process.env.VISUAL_PORT ?? 4780);

/**
 * Screenshot tests. Baselines are rendered only inside the pinned Playwright container
 * (see run.sh) so fonts and antialiasing match on every machine and in CI.
 */
export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.visual.ts',
  snapshotPathTemplate: '{testDir}/../baselines/{projectName}/{testFilePath}/{arg}{ext}',
  // Output goes under dist/, which Git and the lint walk already ignore.
  outputDir: './dist/results',
  fullyParallel: true,
  workers: process.env.VISUAL_WORKERS ? Number(process.env.VISUAL_WORKERS) : 4,
  retries: 0,
  forbidOnly: true,
  reporter: [['list'], ['html', { outputFolder: './dist/report', open: 'never' }]],
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 0 } },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: 'UTC',
    locale: 'en-GB',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'darkroom', use: { skin: 'darkroom' } },
    { name: 'scarab', use: { skin: 'scarab' } },
  ],
  webServer: {
    command: `node serve.mjs`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    env: { VISUAL_PORT: String(port) },
  },
});
