import type { Page } from '@playwright/test';
import { capture, expect, settle, test, viewports } from '../../harness.js';
import { signedIn } from '../../world/index.js';
import { installResultPage, pinned, resultPagePath, unpinned } from '../../world/runs/delete.js';
import { runOf } from '../../world/runs/list.js';

const ready = async (page: Page) => {
  await expect(page.getByRole('button', { name: 'Delete run…' })).toBeVisible();
  await page.waitForLoadState('networkidle');
};

test.beforeEach(async ({ page, api }) => {
  signedIn(api);
  await page.setViewportSize(viewports.desktop);
});

test('delete-run', async ({ page, api }) => {
  installResultPage(api, unpinned);
  await page.goto(resultPagePath(unpinned.short));
  await settle(page, ready);
  await page.getByRole('button', { name: 'Delete run…' }).click();
  await page.getByRole('button', { name: 'Delete this run…' }).click();
  await page.getByRole('button', { name: 'Preview this run deletion' }).click();
  await expect(page.getByLabel('Selected retention batch')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await capture(page, 'delete-run-desktop', { viewportOnly: true });
});

test('delete-run-pinned', async ({ page, api }) => {
  installResultPage(api, pinned, runOf(pinned));
  await page.goto(resultPagePath(pinned.short));
  await settle(page, ready);
  await page.getByRole('button', { name: 'Delete run…' }).click();
  await expect(page.getByText(/is pinned, so retention keeps it/)).toBeVisible();
  await capture(page, 'delete-run-pinned-desktop', { viewportOnly: true });
});
