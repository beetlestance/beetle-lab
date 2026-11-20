// Run result: passed run, one case per stopped or unusual end, and pending and restored states.
import { capture, expect, settle, shoot, test, viewports } from '../../harness.js';
import { fixture } from '../../world/index.js';
import { buildCase, installResult, resultPath } from '../../world/results/install.js';
import type { Variant } from '../../world/results/data.js';

test('run-result', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed' });
  installResult(api, c);
  await shoot(page, resultPath(c.ids.run), 'run-result', { viewports: ['desktop', 'phone'] });
});

const variants: [string, Variant][] = [
  ['run-result-failed', 'failed'],
  ['run-result-cancelled', 'cancelled'],
  ['run-result-out-of-memory', 'oom'],
  ['run-result-output-full', 'output-full'],
  ['run-result-incomplete', 'incomplete'],
];
for (const [name, variant] of variants) {
  test(name, async ({ page, api }) => {
    const c = buildCase({ variant });
    installResult(api, c);
    await shoot(page, resultPath(c.ids.run), name);
  });
}

test('run-result-pending', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed' });
  installResult(api, c, { pending: true });
  await shoot(page, resultPath(c.ids.run), 'run-result-pending');
});

test('run-result-restored-history', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed' });
  installResult(api, c);
  api.on('getBrowserSession', {
    ...fixture('browser-session'),
    expiresAt: '2026-11-08T23:40:00.000Z',
    readOnly: true,
    restoredBackup: { backupId: '00000000-0000-4000-8000-0000000000b0', createdAt: '2026-11-07T02:00:00.000Z' },
    liveOrigin: 'https://beetle.example.test',
  });
  await shoot(page, resultPath(c.ids.run), 'run-result-restored-history');
});

test('run-result-target-by-phase', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed' });
  installResult(api, c);
  const loaded = async () => {
    await page.getByText(/recorded observations · \d+ missed/).waitFor();
    await expect(page.getByText('Reading verified target observations…')).toHaveCount(0);
  };
  await page.setViewportSize(viewports.desktop);
  await page.goto(`${resultPath(c.ids.run)}?target=phases`);
  await settle(page);
  await loaded();
  // A resize re-reads the target report (the page flashes "Reading…"), and a full-page screenshot
  // resizes. Grow the viewport to the page height first, let the re-read finish, then capture.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: viewports.desktop.width, height });
  await loaded();
  await capture(page, 'run-result-target-by-phase-desktop', { viewportOnly: true });
});

test('keeps verified target observations through a responsive breakpoint', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed' });
  installResult(api, c);
  const target = c.artifacts.find((artifact) => artifact.kind === 'target-runtime');
  expect(target).toBeDefined();
  const targetReads: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith(`/artifacts/${target!.artifactId}/content`)) targetReads.push(request.url());
  });
  await page.setViewportSize(viewports.desktop);
  await page.goto(`${resultPath(c.ids.run)}?target=phases`);
  const recorded = page.getByText(/recorded observations · \d+ missed/);
  await expect(recorded).toBeVisible();
  expect(targetReads).toHaveLength(1);
  await page.setViewportSize(viewports.phone);
  await expect(page.locator('#result-target-details')).toBeVisible();
  await expect(recorded).toBeVisible();
  await expect(page.getByText('Reading verified target observations…')).toHaveCount(0);
  expect(targetReads).toHaveLength(1);
});
