import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
/** @param {import('@playwright/test').Page} page @param {number} expectedSamples */
export async function targetRuntime(page, expectedSamples) {
  const section = page.locator('#result-target');
  const retry = section.getByRole('button', { name: 'Retry target observations', exact: true });
  await expect(retry.or(section.getByText('Recorded target values and checkpoints', { exact: true }))).toBeVisible();
  const initialReadRefused = await retry.isVisible();
  if (initialReadRefused) await retry.click();
  await expect(section.getByText(/^Target: http:\/\/target:8080/)).toBeVisible();
  await openDetails(section);
  await section.getByRole('button', { name: 'Reload target report', exact: true }).click();
  await openDetails(section);
  await expect(section.getByLabel('Target metric', { exact: true })).toBeVisible();
  await expect(section.getByText(/Recorded missed count: 2\./)).toBeVisible();
  await comparison(section, 'heapAlloc', '0');
  await section.getByText('Target observations', { exact: true }).click();
  const table = section.getByRole('region', { name: 'Target observation samples', exact: true });
  await expect(table.locator('tbody tr')).toHaveCount(expectedSamples);
  const phases = new Set();
  const reasons = [];
  let ready = 0;
  let previous = -1;
  for (const row of await table.locator('tbody tr').all()) {
    const cells = await row.locator('td').allTextContents();
    assert.equal(cells.length, 5);
    const phase = ['before', 'during', 'after'].indexOf(cells[1] ?? '');
    assert(phase >= 0 && phase >= previous);
    previous = phase;
    phases.add(cells[1]);
    if (cells[2] === 'ready') {
      assert.equal(cells[3], '0');
      ready++;
    } else {
      assert.equal(cells[2], 'unavailable');
      assert.equal(cells[3], 'Unavailable');
      reasons.push(cells[4]);
    }
  }
  assert.deepEqual([...phases], ['before', 'during', 'after']);
  assert.equal(ready, expectedSamples - 2);
  assert.deepEqual(reasons.sort(), ['http', 'invalid_json']);
  await comparison(section, 'rss', '123456');
  await expect(section.getByLabel('Target point comparison').getByText('0.000%', { exact: true })).toBeVisible();
  await comparison(section, 'external', 'Unavailable');
  await expect(
    section.getByText('No usable last after point was recorded; cooldown recovery is unknown.', { exact: true }),
  ).toBeVisible();
  await expect(section.getByLabel('Target metric').locator('option[value="temperature"]')).toHaveCount(0);
  await section.getByRole('button', { name: 'Reload target report', exact: true }).click();
  await openDetails(section);
  await comparison(section, 'heapAlloc', '0');
  await page.reload();
  await openDetails(section);
  await section.getByRole('button', { name: 'Reload target report', exact: true }).click();
  await openDetails(section);
  await comparison(section, 'heapAlloc', '0');
  return {
    observations: expectedSamples,
    known: ready,
    unavailable: 2,
    zeroPreserved: true,
    targetScopeVisible: true,
    nullUnknownVisible: true,
    reloadVerified: true,
    manualReloads: 3,
    initialReadRefused,
  };
}
/** @param {import('@playwright/test').Locator} section @param {string} metric @param {string} expected */
async function comparison(section, metric, expected) {
  await section.getByLabel('Target metric', { exact: true }).selectOption(metric);
  const facts = section.getByLabel('Target point comparison');
  for (const label of ['Before point', 'Observed during peak', 'Last after point'])
    await expect(facts.getByText(label, { exact: true }).locator('..').locator('dd')).toHaveText(expected);
}

/** @param {import('@playwright/test').Locator} section */
async function openDetails(section) {
  const details = section.locator('.result-target-details');
  await expect(details).toBeVisible();
  if (!(await details.evaluate((node) => node.hasAttribute('open'))))
    await details.getByText('Recorded target values and checkpoints', { exact: true }).click();
}
