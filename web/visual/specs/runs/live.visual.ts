import type { Page } from '@playwright/test';
import { NOW, capture, expect, settle, test, viewports } from '../../harness.js';
import { signedIn } from '../../world/index.js';
import {
  agent,
  collectingEvents,
  elapsedAtNow,
  failure,
  installLive,
  liveRun,
  pendingEvents,
} from '../../world/runs/live.js';
import { earlyReady, figuresReady, livePath } from './live-shared.js';

async function open(page: Page, ready: (page: Page) => Promise<void>) {
  await page.setViewportSize(viewports.desktop);
  await page.goto(livePath);
  await settle(page, ready);
}

test.beforeEach(({ api }) => {
  agent.elapsed = elapsedAtNow;
  signedIn(api);
});

test('live-run', async ({ page, api }) => {
  installLive(api);
  for (const viewport of ['desktop', 'phone', 'ultrawide'] as const) {
    await page.setViewportSize(viewports[viewport]);
    await page.goto(livePath);
    await settle(page, figuresReady);
    await capture(page, `live-run-${viewport}`);
  }
});

test('live-run-starting', async ({ page, api }) => {
  installLive(api, { run: liveRun({ state: 'dispatching' }) });
  await open(page, earlyReady);
  await expect(page.getByText('First metrics arrive')).toBeVisible();
  await capture(page, 'live-run-starting-desktop');
});

test('live-run-waiting-for-capacity', async ({ page, api }) => {
  installLive(api, { run: liveRun({ state: 'queued', startedAt: null }) });
  await open(page, earlyReady);
  await expect(page.getByText(/catalog-crawl/).first()).toBeVisible();
  await capture(page, 'live-run-waiting-for-capacity-desktop');
});

test('live-run-paused', async ({ page, api }) => {
  installLive(api);
  await open(page, figuresReady);
  await page.getByRole('button', { name: 'Pause stream' }).click();
  await expect(page.getByRole('button', { name: 'Resume stream' })).toBeVisible();
  await expect(page.getByText(/stream paused at/)).toBeVisible();
  await capture(page, 'live-run-paused-desktop');
});

test('live-run-reconnecting', async ({ page, api }) => {
  installLive(api);
  await open(page, figuresReady);
  // The agent goes quiet; 24 s later the page reports it.
  api.on('getRunLiveMetrics', failure(503, 'storage_unavailable', 'Storage unavailable'));
  await page.clock.setFixedTime(new Date(Date.parse(NOW) + 24_000));
  await expect(page.getByRole('heading', { name: /No word from the agent/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Retry now' })).toBeVisible();
  await capture(page, 'live-run-reconnecting-desktop');
});

test('live-run-cancelling', async ({ page, api }) => {
  let cancelled = false;
  installLive(api, { run: () => liveRun(cancelled ? { cancellationRequested: true, version: 2 } : {}) });
  api.on('cancelRun', () => {
    cancelled = true;
    return { status: 202, body: liveRun({ cancellationRequested: true, version: 2 }) };
  });
  await open(page, figuresReady);
  await page.getByRole('button', { name: 'Cancel run' }).click();
  await expect(page.getByRole('heading', { name: /^Cancelling/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Cancelling…' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await capture(page, 'live-run-cancelling-desktop');
});

test('live-run-finalizing', async ({ page, api }) => {
  let finalizing = false;
  installLive(api, { run: () => liveRun(finalizing ? { state: 'finalizing', version: 2 } : {}) });
  api.on('listRunEvents', () => (finalizing ? collectingEvents() : pendingEvents()));
  await open(page, figuresReady);
  finalizing = true;
  await expect(page.getByRole('heading', { name: /is finalizing/ })).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle');
  await capture(page, 'live-run-finalizing-desktop');
});
