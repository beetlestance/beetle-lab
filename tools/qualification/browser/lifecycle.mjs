import { expect } from '@playwright/test';
import { execute, start } from './results.mjs';
import { revision } from './authoring.mjs';
/**
 * @param {import('@playwright/test').Page} page
 * @param {Awaited<ReturnType<import('./authoring.mjs').author>>} authored
 * @param {string} first
 */
export async function historyComparison(page, authored, first) {
  await page.goto(authored.suite);
  await page.getByRole('button', { name: 'View revision 1', exact: true }).click();
  const second = await execute(page);
  const ids = [first, second].map((url) => new URL(url).pathname.split('/').at(-1));
  await page.goto(authored.workspace);
  await page.getByRole('link', { name: 'Runs', exact: true }).click();
  await page.getByRole('combobox', { name: /^Outcome\b/ }).selectOption('passed');
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  for (const id of ids) await page.getByRole('checkbox', { name: `Compare ${id}`, exact: true }).check();
  await page.getByRole('link', { name: 'Compare selected runs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compare runs', exact: true })).toBeVisible();
  await expect(page.getByText('Loading comparison…', { exact: true })).toHaveCount(0);
  if (
    await page
      .getByText('Comparison could not be loaded. Use Refresh comparison to retry.', { exact: true })
      .isVisible()
  )
    await page.getByRole('button', { name: 'Refresh comparison', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Baseline: ${ids[0]}`, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: `Run 2: ${ids[1]}`, exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: /^Baseline metric\b/ }).selectOption({ index: 1 });
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
  await start(page);
  await expect(page.getByRole('region', { name: 'Live metric values', exact: true })).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Live metric values', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  await expect(
    page
      .locator('.run-facts')
      .getByText('State', { exact: true })
      .locator('..')
      .getByText('cancelled', { exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await expect(
    page
      .locator('.run-facts')
      .getByText('Outcome', { exact: true })
      .locator('..')
      .getByText('inconclusive', { exact: true }),
  ).toBeVisible();
}
/**
 * @param {import('@playwright/test').Page} page
 * @param {string} run
 */
export async function deleteRun(page, run) {
  await page.goto(run);
  await page.getByRole('button', { name: 'Delete this run…', exact: true }).click();
  await page.getByRole('button', { name: 'Preview this run deletion', exact: true }).click();
  await page.getByRole('button', { name: 'Apply deletion of 1 runs', exact: true }).click();
  // Native cleanup and transport backoff can outlast one 60-second browser wait.
  await expect(page.getByRole('heading', { name: 'completed', exact: true })).toBeVisible({ timeout: 180000 });
  await page.getByRole('button', { name: 'Acknowledge completed batch', exact: true }).click();
  await page.reload();
  await expect(page.getByText('Resource not found', { exact: true })).toBeVisible();
}
