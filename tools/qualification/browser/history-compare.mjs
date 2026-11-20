import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { validateApi } from '@beetle/contracts/api';
import { writeFile } from 'node:fs/promises';
import { execute } from './results.mjs';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {Awaited<ReturnType<import('./authoring.mjs').author>>} Authored */

/** @param {Page} page @param {Authored} authored @param {string} evidence */
export async function historyCompare(page, authored, evidence) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await emptyHistory(page, authored.workspace, evidence);
  await page.goto(authored.suite);
  const first = await execute(page);
  await page.goto(authored.suite);
  const second = await execute(page);
  await populatedHistory(page, authored.workspace, [first, second], evidence);
  await page.goto(second);
  await compareFromResult(page, authored.workspace, first, second, evidence);
}

/** Hold the existing real response so the loading screenshot never depends on machine speed.
 * @param {Page} page @param {string} workspace @param {string} evidence */
async function emptyHistory(page, workspace, evidence) {
  const history = workspace + '/runs';
  const api = new URL(workspace);
  const matches = /** @param {URL} url */ (url) =>
    url.origin === api.origin &&
    url.pathname === '/api/v2' + api.pathname + '/runs' &&
    url.searchParams.get('includeCounts') === 'true';
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  let pending = Promise.resolve();
  let holdError;
  /** @param {import('@playwright/test').Route} route */
  const hold = (route) => {
    pending = gate
      .then(() => route.continue())
      .catch((error) => {
        holdError = error;
      });
    return pending;
  };
  await page.route(matches, hold, { times: 1 });
  try {
    await page.goto(history + '/compare');
    await expect(page.getByRole('heading', { name: 'Pick runs to compare', exact: true })).toBeVisible();
    await expect(page.getByText('Active runs become available for comparison after they end.')).toBeVisible();
    await screenshot(page, evidence, 'compare-empty');
    await page.getByRole('link', { name: 'Go to runs', exact: true }).click();
    await expect(page.getByText('Loading runs…', { exact: true })).toBeVisible();
    await expect(page.locator('.history-loading .skeleton-row')).toHaveCount(9);
    await screenshot(page, evidence, 'runs-loading');
  } finally {
    release();
    await pending;
    await page.unroute(matches, hold);
  }
  if (holdError) throw holdError;
  await expect(page.getByRole('heading', { name: 'No runs yet', exact: true })).toBeVisible();
  await expect(
    page.getByText('You can also paste a complete configuration as JSON once the suite exists.'),
  ).toBeVisible();
  await screenshot(page, evidence, 'runs-empty');
}

/** @param {Page} page @param {string} workspace @param {string[]} urls @param {string} evidence */
async function populatedHistory(page, workspace, urls, evidence) {
  await page.goto(workspace + '/runs');
  const rows = urls.map((url) =>
    page.getByRole('row').filter({ has: page.locator(`a[href="${new URL(url).pathname}"]`) }),
  );
  for (const row of rows) await expect(row).toBeVisible();
  await screenshot(page, evidence, 'runs-populated');
  for (const row of rows) await row.getByRole('checkbox', { name: /^Compare run / }).check();
  const compare = page.getByRole('link', { name: 'Compare 2', exact: true });
  const href = await compare.getAttribute('href');
  assert(href);
  assert.deepEqual(new URL(href, workspace).searchParams.get('runs')?.split(','), urls.map(runId));
}

/** @param {Page} page @param {string} workspace @param {string} first @param {string} second @param {string} evidence */
async function compareFromResult(page, workspace, first, second, evidence) {
  const trigger = page.getByRole('button', { name: 'Compare', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: /^Compare run .* with$/ });
  await expect(dialog.getByText('Previous', { exact: true })).toBeVisible();
  const candidate = dialog.getByRole('link', { name: new RegExp(runId(first).slice(0, 4), 'i') });
  await expect(candidate).toBeVisible();
  await screenshot(page, evidence, 'result-compare-picker');
  const endpoint = new URL(workspace);
  const matches = /** @param {URL} url */ (url) =>
    url.origin === endpoint.origin && url.pathname === '/api/v2' + endpoint.pathname + '/comparisons';
  /** @type {import('@playwright/test').Request[]} */
  const interrupted = [];
  let routeError;
  /** @param {import('@playwright/test').Route} route */
  const fail = async (route) => {
    interrupted.push(route.request());
    try {
      await route.abort('connectionreset');
    } catch (error) {
      routeError = error;
    }
  };
  await page.route(matches, fail, { times: 1 });
  try {
    await candidate.click();
    await expect(page.getByText('Comparison could not be loaded. Use Refresh comparison to retry.')).toBeVisible();
    if (routeError) throw routeError;
    assert.equal(interrupted.length, 1);
    assert.equal(interrupted[0]?.method(), 'POST');
    assert.deepEqual(interrupted[0]?.postDataJSON().runIds, [runId(first), runId(second)]);
    await screenshot(page, evidence, 'compare-read-refused');
  } finally {
    await page.unroute(matches, fail);
  }
  await page.getByRole('button', { name: 'Refresh comparison', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^2 runs, baseline Synthetic k6 suite / })).toBeVisible({
    timeout: 35000,
  });
  await expect(page.getByRole('heading', { name: 'What was different', exact: true })).toBeVisible();
  await compareRecordedLatency(page, [first, second], evidence);
  await screenshot(page, evidence, 'compare-recovered');
  await page.getByRole('radio', { name: 'Scarab', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: /baseline Synthetic k6 suite/ })).toBeVisible();
  const width = await page.evaluate(() => globalThis.document.documentElement.scrollWidth);
  await screenshot(page, evidence, 'compare-scarab-phone');
  expect(width).toBeLessThanOrEqual(391);
  const figures = page.getByRole('region', { name: 'Whole-run figures', exact: true });
  await figures.focus();
  await expect(figures).toBeFocused();
  expect(await figures.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => figures.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
}

/** @param {Page} page @param {string[]} urls @param {string} evidence */
async function compareRecordedLatency(page, urls, evidence) {
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'p95, histogram estimate' }) });
  const readings = [];
  for (const [index, address] of urls.entries()) {
    const url = new URL(address);
    const endpoint = `${url.origin}/api/v2${url.pathname}`;
    const run = validateApi('Run', await (await page.request.get(endpoint)).json());
    assert(run.ok && run.value.id === runId(address));
    const result = await page.request.get(`${endpoint}/attempts/${run.value.activeAttemptId}/metrics/overview`);
    const overview = validateApi('RunMetricOverview', await result.json());
    assert(overview.ok && overview.value.id === run.value.id);
    const p95 = overview.value.latency?.percentiles.p95.estimate;
    assert(p95 !== undefined && p95 > 0);
    const cell = row.getByRole('cell').nth(index);
    await expect(cell).toContainText(' ms');
    await expect(cell).not.toHaveText(/^0 ms/);
    readings.push({ p95, label: await cell.innerText() });
  }
  await writeFile(join(evidence, 'comparison-latency.json'), JSON.stringify(readings), { mode: 0o600 });
}

/** @param {string} url */
function runId(url) {
  return new URL(url).pathname.split('/').at(-1) ?? '';
}

/** @param {Page} page @param {string} evidence @param {string} name */
async function screenshot(page, evidence, name) {
  await page.screenshot({ path: join(evidence, name + '.png'), fullPage: true, animations: 'disabled' });
}
