import type { Page } from '@playwright/test';
import { capture, expect, settle, shoot, test, viewports } from '../../harness.js';
import { fixture, ids, signedIn } from '../../world/index.js';
import { runPage, specs, suitePage } from '../../world/runs/list.js';

const path = `/organizations/${ids.organization}/workspaces/${ids.workspace}/runs`;
const rowsReady = async (page: Page) => {
  await expect(page.getByRole('table')).toBeVisible();
  await page.waitForLoadState('networkidle');
};

test.beforeEach(({ api }) => {
  signedIn(api);
  api.on('listSuites', suitePage);
});

test('runs', async ({ page, api }) => {
  api.on('listRuns', runPage());
  for (const viewport of ['desktop', 'phone'] as const) {
    await page.setViewportSize(viewports[viewport]);
    await page.goto(path);
    await settle(page, rowsReady);
    // The board shows two finished runs ticked for comparison.
    if (viewport === 'desktop') {
      await page.getByRole('checkbox', { name: /Compare run b089/ }).check();
      await page.getByRole('checkbox', { name: /Compare run 405b/ }).check();
      await expect(page.getByRole('link', { name: 'Compare 2' })).toBeVisible();
    }
    await capture(page, `runs-${viewport}`);
  }
});

test('runs-pinned', async ({ page, api }) => {
  const pinned = specs.filter((spec) => spec.pinned);
  api.on('listRuns', runPage({ rows: pinned, counts: { matched: 3 } }));
  await shoot(page, `${path}?pinned=true`, 'runs-pinned', { ready: rowsReady });
});

test('runs-empty', async ({ page, api }) => {
  api.on(
    'listRuns',
    runPage({ rows: [], counts: { all: 0, running: 0, passed: 0, failed: 0, cancelled: 0, pinned: 0, matched: 0 } }),
  );
  await shoot(page, path, 'runs-empty', {
    ready: async (p) => {
      await expect(p.getByText('No runs yet').first()).toBeVisible();
      await p.waitForLoadState('networkidle');
    },
  });
});

test('runs-loading', async ({ page, api }) => {
  api.on('listRuns', 'pending');
  await page.setViewportSize(viewports.desktop);
  await page.goto(path);
  await settle(page, async (p) => {
    await expect(p.getByText('Loading runs…').first()).toBeVisible();
  });
  await capture(page, 'runs-loading-desktop');
});

async function openRuns(page: Page): Promise<void> {
  await page.setViewportSize(viewports.desktop);
  await page.goto(path);
  await settle(page, rowsReady);
}

test('pinning-states', async ({ page, api }) => {
  // The 256-pin ceiling is refused by the service; the row shows the refusal under itself.
  api.on('listRuns', runPage());
  api.on('pinRun', { status: 409, body: fixture('pin-limit-error') });
  await openRuns(page);
  await page.getByRole('button', { name: /^Pin run 405b/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: '256 runs are pinned' })).toBeVisible();
  await capture(page, 'pinning-states-desktop');
});

test('pinning-states-pending', async ({ page, api }) => {
  api.on('listRuns', runPage());
  api.on('pinRun', 'pending');
  await openRuns(page);
  await page.getByRole('button', { name: /^Pin run 405b/ }).click();
  await expect(page.getByRole('button', { name: /^Pin run 405b/ })).toBeDisabled();
  await capture(page, 'pinning-states-pending-desktop');
});

test('pinning-states-unreachable', async ({ page, api }) => {
  api.on('listRuns', runPage());
  api.on('pinRun', { status: 500, body: fixture('safe-error') });
  await openRuns(page);
  await page.getByRole('button', { name: /^Pin run 405b/ }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await capture(page, 'pinning-states-unreachable-desktop');
});
