import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Locator} Locator */

const panels = /** @type {const} */ ([
  'result-activity',
  'result-target-details',
  'result-artifacts',
  'result-notes',
  'result-diagnostics',
]);

/** @param {Page} page @param {string} runPath */
export function observeMeasurements(page, runPath) {
  const prefix = '/api/v2' + runPath + '/attempts/';
  /** @type {string[]} */
  const events = [];
  /** @param {string} url @param {string | number} stage */
  function capture(url, stage) {
    const path = new URL(url).pathname;
    if (!path.startsWith(prefix) || events.length >= 12) return;
    const name = /^[a-f0-9-]+\/metrics\/(overview|chart-history)$/.exec(path.slice(prefix.length))?.[1];
    if (name) events.push(`${name}:${stage}`);
  }
  /** @param {import('@playwright/test').Request} request */
  const start = (request) => capture(request.url(), 'start');
  /** @param {import('@playwright/test').Response} response */
  const settle = (response) => capture(response.url(), response.status());
  page.on('request', start);
  page.on('response', settle);
  return async (/** @type {string} */ evidence) => {
    page.off('request', start);
    page.off('response', settle);
    await writeFile(join(evidence, 'result-measurement-requests.json'), JSON.stringify(events), {
      mode: 0o600,
      flag: 'wx',
    });
    assert.equal(events[0], 'overview:start');
    assert.match(events[1] ?? '', /^overview:\d{3}$/);
    assert.equal(events[2], 'chart-history:start');
  };
}

/** @param {Page} page @param {string} evidence */
export async function phoneResult(page, evidence) {
  await page.setViewportSize({ width: 390, height: 844 });
  const whole = page.getByRole('region', { name: 'The whole run', exact: true });
  await expect(whole.getByRole('heading', { name: 'p95 latency, whole run' })).toBeVisible({ timeout: 18000 });
  await whole.getByRole('radio', { name: 'Requests', exact: true }).click();
  await expect(whole.getByRole('img', { name: /^Recorded requests per one-second window/ })).toBeVisible();
  await whole.getByRole('radio', { name: 'p95', exact: true }).click();

  const endpointTable = page.getByRole('region', { name: 'Endpoint measurements, scroll for more columns' });
  const overviewRetry = page.getByRole('button', { name: /^(Retry|Check) measurements$/ });
  await expect(endpointTable.or(overviewRetry)).toBeVisible();
  const overviewNeededRetry = await overviewRetry.isVisible();
  if (overviewNeededRetry) {
    const reply = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/metrics/overview'));
    await overviewRetry.click();
    assert.equal((await reply).status(), 200);
  }
  await expect(endpointTable.locator('tbody tr')).toHaveCount(5);
  await expect(page.locator('.result-threshold-card')).toHaveCount(3);
  await verifyStickyMeasurements(endpointTable);
  const initial = await verifyPanels(page);
  await capture(page, evidence, 'phone-result-darkroom');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('radio', { name: 'Scarab', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'scarab');
  await capture(page, evidence, 'phone-result-scarab');

  await phoneEvidence(page, evidence);
  await writeFile(
    join(evidence, 'phone-result-coverage.json'),
    JSON.stringify({
      endpoints: 5,
      overviewNeededRetry,
      thresholds: 3,
      chartSwitch: true,
      pinnedColumns: ['p95', 'Failed'],
      panels: initial,
      noteSaved: true,
      noteDraftSurvivedResize: true,
      recordedTargets: true,
      artifactAndDiagnosticsVisible: true,
    }),
    { mode: 0o600, flag: 'wx' },
  );
}

/** @param {Locator} table */
async function verifyStickyMeasurements(table) {
  const pinned = await table.evaluate((region) => {
    const heads = [...region.querySelectorAll('thead th')].slice(1, 3);
    const labels = heads.map((head) => head.textContent?.trim());
    if (heads.length !== 2) return null;
    region.scrollLeft = region.scrollWidth;
    const viewport = region.getBoundingClientRect();
    const boxes = heads.map((head) => head.getBoundingClientRect());
    const visible = boxes.every((box) => box.x >= viewport.x - 1 && box.right <= viewport.right + 1);
    const scrolled = region.scrollLeft;
    region.scrollLeft = 0;
    return { labels, scrolled, visible };
  });
  assert(pinned && pinned.scrolled > 0 && pinned.visible);
  assert.match(pinned.labels[0] ?? '', /^p95/);
  assert.equal(pinned.labels[1], 'Failed');
}

/** @param {Page} page */
async function verifyPanels(page) {
  const primary = page.locator('.result-sections > details');
  await expect(primary).toHaveCount(6);
  const order = await primary.evaluateAll((nodes) => nodes.slice(0, 5).map((node) => node.id));
  assert.deepEqual(order, panels);
  for (const id of panels) await expect(page.locator('#' + id)).not.toHaveAttribute('open');
  return order;
}

/** @param {Page} page @param {string} id */
async function open(page, id) {
  const section = page.locator('#' + id);
  const summary = section.locator('> summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(section).toHaveAttribute('open');
  return section;
}

/** @param {Page} page @param {string} evidence */
async function phoneEvidence(page, evidence) {
  const activity = await open(page, panels[0]);
  await expect(activity.getByText('Inspect recorded activity and resource observations')).toBeVisible();
  const target = await open(page, panels[1]);
  const retry = target.getByRole('button', { name: 'Retry target observations', exact: true });
  await expect(retry.or(target.getByText('Recorded target values and checkpoints', { exact: true }))).toBeVisible();
  if (await retry.isVisible()) await retry.click();
  await expect(target.locator('.result-target-grid figure')).toHaveCount(4);
  await capture(page, evidence, 'phone-result-target');

  const artifacts = await open(page, panels[2]);
  await expect(artifacts.getByRole('link', { name: 'Download artifact performance-report.txt' })).toBeVisible();
  const note = await open(page, panels[3]);
  await note.getByRole('button', { name: /Add a note/ }).click();
  const text = 'Verified in the phone Results layout';
  await note.getByLabel('Run note').fill(text);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByLabel('Run note')).toHaveValue(text);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.result-sections > #result-notes')).toBeVisible();
  if (!(await note.evaluate((node) => node.hasAttribute('open')))) await open(page, panels[3]);
  await expect(note.getByLabel('Run note')).toHaveValue(text);
  await note.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(note.getByText(text, { exact: true })).toBeVisible();
  const diagnostics = await open(page, panels[4]);
  await expect(diagnostics.getByText(/^Diagnostic coverage:/)).toBeVisible();
}

/** @param {Page} page @param {string} evidence @param {string} name */
async function capture(page, evidence, name) {
  assert(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
  await page.screenshot({ path: join(evidence, name + '.png'), fullPage: true, animations: 'disabled' });
}
