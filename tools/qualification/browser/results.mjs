import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expect} from '@playwright/test';
/**
 * @param {import('@playwright/test').Page} page
 */
export async function start(page) {
  await page.getByRole('button', {name: 'Run saved revision', exact: true}).click();
  await page.getByLabel('Output (bytes)', {exact: true}).fill('8388608');
  await page.getByRole('button', {name: 'Submit run', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Refresh run', exact: true})).toBeVisible({timeout: 30000});
}
/**
 * @param {import('@playwright/test').Page} page
 */
export async function execute(page) {
  await start(page);
  await expect(page.locator('.run-facts').getByText('Outcome', {exact: true}).locator('..')
    .getByText('passed', {exact: true})).toBeVisible({timeout: 60000});
  await expect(page.locator('.run-facts').getByText('State', {exact: true}).locator('..')
    .getByText('finished', {exact: true})).toBeVisible();
  return page.url();
}
/**
 * @param {import('@playwright/test').Page} page
 * @param {string} root
 */
export async function results(page, root) {
  await page.getByRole('button', {name: 'Reload performance report', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Verified performance report', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Refresh metrics', exact: true}).click();
  await expect(page.getByLabel('Metric series', {exact: true})).toBeVisible();
  const warnings = page.getByRole('region', {name: 'Native warnings', exact: true});
  await expect(warnings.getByText('Loading warning evidence…', {exact: true})).toHaveCount(0);
  const retry = warnings.getByRole('button', {name: 'Reload warnings', exact: true});
  if (await retry.isVisible()) await retry.click();
  await expect(warnings.getByText(/^Diagnostic coverage:/)).toBeVisible();
  const link = page.getByRole('link', {name: 'Download artifact performance-report.txt', exact: true});
  const row = link.locator('xpath=ancestor::tr');
  const expected = (await row.innerText()).match(/\b[a-f0-9]{64}\b/);
  if (!expected) throw Error('Published digest is missing');
  const download = page.waitForEvent('download'); await link.click();
  const path = join(root, 'performance-report.txt'); await (await download).saveAs(path);
  const bytes = await readFile(path); expect(bytes.length).toBeGreaterThan(0);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected[0]);
}
