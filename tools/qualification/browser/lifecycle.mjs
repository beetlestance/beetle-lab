import { expect } from '@playwright/test';
import { execute, start } from './results.mjs';
import { revision } from './authoring.mjs';
import { assertRunState } from './run-state.mjs';
/**
 * @param {import('@playwright/test').Page} page
 * @param {Awaited<ReturnType<import('./authoring.mjs').author>>} authored
 * @param {string} first
 */
export async function historyComparison(page, authored, first) {
  await page.goto(authored.suite);
  const second = await execute(page);
  const ids = [first, second].map((url) => new URL(url).pathname.split('/').at(-1));
  await page.goto(authored.workspace);
  await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
  await page.getByRole('link', { name: 'Runs', exact: true }).click();
  await page.getByRole('radio', { name: /^Passed\b/ }).click();
  for (const url of [first, second]) {
    const path = new URL(url).pathname;
    const row = page.getByRole('row').filter({ has: page.locator(`a[href="${path}"]`) });
    await row.getByRole('checkbox', { name: /^Compare run / }).check();
  }
  await page.getByRole('link', { name: 'Compare 2', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^2 runs, baseline Synthetic k6 suite / })).toBeVisible();
  await expect(page.getByText('Loading comparison…', { exact: true })).toHaveCount(0);
  if (
    await page
      .getByText('Comparison could not be loaded. Use Refresh comparison to retry.', { exact: true })
      .isVisible()
  )
    await page.getByRole('button', { name: 'Refresh comparison', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Baseline: ${ids[0]}`, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: `Run 2: ${ids[1]}`, exact: true })).toBeVisible();
  const catalogue = page.getByRole('combobox', { name: /^Baseline metric\b/ });
  const retryCatalogue = page.getByRole('button', { name: 'Retry metric catalogue', exact: true });
  await catalogue.or(retryCatalogue).waitFor();
  if (await retryCatalogue.isVisible()) {
    console.log(
      JSON.stringify({ format: 'beetle-browser-read-recovery', read: 'comparison-catalogue', explicitRetry: true }),
    );
    await retryCatalogue.click();
  }
  await catalogue.selectOption({ index: 1 });
  await expect(page.getByText(/^Whole-run total:/)).toHaveCount(2);
}
/**
 * @param {import('@playwright/test').Page} page
 * @param {Awaited<ReturnType<import('./authoring.mjs').author>>} authored
 */
export async function cancelReconnect(page, authored) {
  const config = structuredClone(authored.config);
  config.loadPlan.scenarios[0].iterations = 100;
  config.loadPlan.scenarios[0].maxDuration = '45s';
  config.selections[0].entries[0].wait = { durationMs: 500, jitterMs: 0 };
  await page.goto(authored.suite);
  await revision(page, config, 2);
  const submitted = await start(page);
  await currentWindow(page);
  await page.reload();
  await currentWindow(page);
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible({ timeout: 60000 });
  await assertRunState(page, { state: 'cancelled', outcome: 'inconclusive' }, submitted);
}
/**
 * @param {import('@playwright/test').Page} page
 * @param {string} run
 */
export async function deleteRun(page, run) {
  await page.goto(run);
  await page.getByRole('button', { name: 'Delete run…', exact: true }).click();
  await page.getByRole('button', { name: 'Preview this run deletion', exact: true }).click();
  await page.getByRole('button', { name: 'Apply deletion of 1 runs', exact: true }).click();
  // Native cleanup and transport backoff can outlast one 60-second browser wait.
  await expect(page.getByRole('heading', { name: 'completed', exact: true })).toBeVisible({ timeout: 180000 });
  await page.getByRole('button', { name: 'Acknowledge completed batch', exact: true }).click();
  await page.reload();
  await expect(page.getByText('Resource not found', { exact: true })).toBeVisible();
}

/** Require an actual recorded figure, not merely the mounted loading view.
 * @param {import('@playwright/test').Page} page */
async function currentWindow(page) {
  const progress = page.getByRole('region', { name: 'Progress', exact: true });
  await expect(progress).toBeVisible({ timeout: 15000 });
  const first = progress.locator('dd').first();
  await expect(first).toBeVisible();
  await expect(first).not.toHaveText(/^[–—-]$/, { timeout: 15000 });
}
