import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { assertRunState, submittedRun, suiteRoute } from './run-state.mjs';
/**
 * @param {import('@playwright/test').Page} page
 */
export async function start(page) {
  const suite = suiteRoute(page.url());
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /^Start / });
  await dialog.getByRole('button', { name: 'Change for this run', exact: true }).click();
  await dialog.getByLabel(/^Output, up to /).fill('0.0078125');
  const revisionId = await dialog.getByLabel('Revision', { exact: true }).inputValue();
  const [reply] = await Promise.all([
    page.waitForResponse((reply) => {
      const url = new URL(reply.url());
      return (
        reply.request().method() === 'POST' &&
        url.origin === suite.origin &&
        url.pathname === `/api/v2/organizations/${suite.organizationId}/workspaces/${suite.workspaceId}/runs`
      );
    }),
    dialog.getByRole('button', { name: 'Start run', exact: true }).click(),
  ]);
  assert.equal(reply.status(), 202);
  const submitted = submittedRun(await reply.json(), suite, revisionId);
  assert.equal(submitted.outputBytes, 8388608);
  await expect(page).toHaveURL(submitted.origin + submitted.path);
  return submitted;
}
/**
 * @param {import('@playwright/test').Page} page
 * @param {boolean} checkLiveRate
 */
export async function execute(page, checkLiveRate = false) {
  const submitted = await start(page);
  if (checkLiveRate) {
    const checks = page.locator('.live-threshold').filter({ hasText: 'Checks passing' });
    await expect(checks).toContainText('Holding', { timeout: 30000 });
    await expect(checks).toContainText('100%');
  }
  const open = page.getByRole('button', { name: 'Open result', exact: true });
  // The loading page also offers Refresh run; only the result owner proves this handoff.
  const ready = page.locator('.result-head');
  await expect(open.or(ready)).toBeVisible({ timeout: 60000 });
  if (await open.isVisible()) await open.click();
  await expect(page.locator('.result-head').getByText('Passed', { exact: true })).toBeVisible({ timeout: 60000 });
  await assertRunState(page, { state: 'finished', outcome: 'passed' }, submitted);
  return page.url();
}
/**
 * @param {import('@playwright/test').Page} page
 * @param {string} root
 */
export async function results(page, root) {
  await expect(page.getByRole('region', { name: 'Verified performance report', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download report', exact: true }).click();
  const path = join(root, 'performance-report.txt');
  await (await download).saveAs(path);
  await page.getByText('Browse individual recorded metrics', { exact: true }).click();
  await page.getByRole('button', { name: 'Refresh metrics', exact: true }).click();
  await expect(page.getByLabel('Metric series', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click();
  const warnings = page.getByRole('region', { name: 'Native warnings', exact: true });
  await expect(warnings.getByText('Loading warning evidence…', { exact: true })).toHaveCount(0);
  const retry = warnings.getByRole('button', { name: 'Reload warnings', exact: true });
  if (await retry.isVisible()) await retry.click();
  await expect(warnings.getByText(/^Diagnostic coverage:/)).toBeVisible();
  await page.getByRole('tab', { name: /^Artifacts/ }).click();
  const link = page.getByRole('link', { name: 'Download artifact performance-report.txt', exact: true });
  const row = link.locator('xpath=ancestor::tr');
  const expected = (await row.locator('.artifact-sha').getAttribute('title'))?.match(/^SHA-256 ([a-f0-9]{64})$/);
  if (!expected) throw Error('Published digest is missing');
  const bytes = await readFile(path);
  expect(bytes.length).toBeGreaterThan(0);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected[1]);
}
