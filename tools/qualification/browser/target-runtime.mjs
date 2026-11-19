import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { runRoute } from './run-state.mjs';
/** @param {import('@playwright/test').Page} page @param {number} expectedSamples */
export async function targetRuntime(page, expectedSamples) {
  const section = page.locator('#result-target');
  const retry = section.getByRole('button', { name: 'Retry target observations', exact: true });
  await expect(retry.or(section.getByText('Recorded target values and checkpoints', { exact: true }))).toBeVisible();
  const initialReadRefused = await retry.isVisible();
  if (initialReadRefused) await retry.click();
  await expect(section.getByText(/^Target: target:8080\b/)).toBeVisible();
  await openDetails(section);
  await section.getByRole('button', { name: 'Reload target report', exact: true }).click();
  await openDetails(section);
  await expect(section.getByLabel('Target metric', { exact: true })).toBeVisible();
  await expect(section.getByText(/Recorded missed count: 2\./)).toBeVisible();
  await comparison(section, 'heapAlloc', '0');
  await section.getByRole('button', { name: 'Compare recorded phases', exact: true }).click();
  const longest = section.getByRole('row').filter({ hasText: 'Longest GC pause' });
  await expect(longest).toContainText('11 ms');
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
    phaseMaximumMs: 11,
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

/** @param {import('@playwright/test').Page} page @param {string} run */
export async function indexedLatencyPreview(page, run) {
  const key = runRoute(run);
  await page.goto(new URL(key.path.slice(0, key.path.lastIndexOf('/')), key.origin).href);
  const table = page.getByRole('region', { name: 'Run history table', exact: true });
  const row = table.getByRole('row').filter({ has: page.locator(`a[href="${key.path}"]`) });
  await expect(row).toBeVisible();
  const graph = row.getByRole('img', { name: 'Sampled p95 latency over time', exact: true });
  await expect(async () => {
    if (!(await graph.isVisible())) await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    expect(await graph.isVisible()).toBe(true);
  }).toPass({ timeout: 15000, intervals: [1000, 2000] });
}
