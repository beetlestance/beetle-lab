import { capture, expect, settle, test, viewports } from '../../harness.js';
import { ids, signedIn } from '../../world/index.js';
import { agent, elapsedAtNow, failure, installLive, liveIds } from '../../world/runs/live.js';
import { figuresReady, livePath } from './live-shared.js';

test.beforeEach(async ({ page, api }) => {
  agent.elapsed = elapsedAtNow;
  signedIn(api);
  await page.setViewportSize(viewports.desktop);
});

test('live-run-compare-tooltip', async ({ page, api }) => {
  installLive(api);
  await page.goto(livePath);
  await settle(page, figuresReady);
  await page.getByRole('button', { name: 'Compare' }).hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await capture(page, 'live-run-compare-tooltip-desktop');
});

test('live-run-download-open', async ({ page, api }) => {
  installLive(api);
  await page.goto(livePath);
  await settle(page, figuresReady);
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Run downloads' })).toBeVisible();
  await capture(page, 'live-run-download-open-desktop');
});

test('live-run-script-picker', async ({ page, api }) => {
  installLive(api);
  await page.goto(livePath);
  await settle(page, figuresReady);
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page
    .getByRole('group', { name: 'Run downloads' })
    .getByRole('button', { name: /script/i })
    .click();
  await expect(page.getByText('This run').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await capture(page, 'live-run-script-picker-desktop', { viewportOnly: true });
});

test('not-found-run', async ({ page, api }) => {
  installLive(api);
  api.on('getRun', failure(404, 'not_found', 'Resource not found'));
  await page.goto(`/organizations/${ids.organization}/workspaces/${ids.workspace}/runs/${liveIds.run}`);
  await settle(page, async (p) => {
    await expect(p.getByText("That run isn't here")).toBeVisible();
  });
  await capture(page, 'not-found-run-desktop');
});
