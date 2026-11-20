import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { stagedConfiguration } from './live-staged.mjs';
import { revision } from './authoring.mjs';
import { start } from './results.mjs';
import { assertRunState } from './run-state.mjs';
import { targetCounts } from '../native-application/target-runtime/target.ts';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {Awaited<ReturnType<import('./authoring.mjs').author>>} Authored */
/** @typedef {import('./run-state.mjs').SubmittedRun} SubmittedRun */

/** @param {Page} page @param {Authored} authored @param {import('../native-application/compose/fixture.ts').Fixture} fixture @param {string} evidence */
export async function desktopResultsFamily(page, authored, fixture, evidence) {
  const passed = await measuredRun(page, authored.suite, false);
  await settledResult(page);
  await expect(page.locator('.result-actions').getByRole('button').first()).toHaveAccessibleName('Run again');
  const [thresholdWidth, scriptWidth] = await page
    .locator('.result-split')
    .evaluate((split) => [...split.children].map((section) => section.getBoundingClientRect().width));
  assert(thresholdWidth && scriptWidth && thresholdWidth < scriptWidth);
  await captureThemes(page, evidence, 'desktop-result', 4115);
  await capturedActivity(page, evidence);

  const failed = await measuredRun(page, authored.suite, true);
  await page.setViewportSize({ width: 1440, height: 1018 });
  await page.goto(authored.workspace + '/runs');
  for (const run of [passed, failed]) {
    const row = page.getByRole('row').filter({ has: page.locator(`a[href="${run.path}"]`) });
    await row.getByRole('checkbox', { name: /^Compare run / }).check();
  }
  await expect(page.getByRole('columnheader', { name: 'p95 over the run' })).toBeVisible();
  const compare = page.getByRole('link', { name: 'Compare 2', exact: true });
  const href = await compare.getAttribute('href');
  assert(href);
  assert.deepEqual(new URL(href, authored.workspace).searchParams.get('runs')?.split(','), [passed.id, failed.id]);
  await captureThemes(page, evidence, 'desktop-runs', 1018);
  await compare.click();

  await page.setViewportSize({ width: 1440, height: 2575 });
  await expect(page.getByRole('heading', { name: /^2 runs, baseline Synthetic k6 suite / })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What was different', exact: true })).toBeVisible();
  const measurements = page.getByRole('region', { name: 'Whole-run figures', exact: true });
  await expect(measurements.getByRole('rowheader', { name: 'p95, histogram estimate' })).toBeVisible();
  const target = page.getByRole('region', { name: 'Target runtime comparison', exact: true });
  await expect(target.locator('figure').first()).toBeVisible();
  await captureThemes(page, evidence, 'desktop-compare', 2575);
  const observed = targetCounts(fixture);
  assert(observed.ready === 2 && observed.work >= 90 && observed.work <= 360 && observed.runtime >= 18);
  assert.equal(observed.unexpected, 0);
  await writeFile(
    join(evidence, 'desktop-results-family.json'),
    JSON.stringify({ runs: [passed.id, failed.id], baseline: passed.id, target: observed }),
    { mode: 0o600, flag: 'wx' },
  );
}

/** @param {Page} page @param {string} evidence */
async function capturedActivity(page, evidence) {
  await page.getByRole('tab', { name: 'What happened', exact: true }).click();
  const schedule = page.getByRole('list', { name: 'Scheduled stages', exact: true }).getByRole('listitem');
  await expect(schedule).toHaveText([
    /00:00.*Ramp to 4 a second/,
    /00:05.*Steady at 4 a second/,
    /00:20.*Ramp down to 1 a second/,
    /00:24.*Drain/,
  ]);
  const recorded = page.getByRole('list', { name: 'Recorded run milestones', exact: true });
  await expect(recorded).toContainText('Admission accepted');
  await expect(recorded).toContainText('Native runtime exited');
  await expect(recorded).not.toContainText('Steady at 4 a second');
  await captureThemes(page, evidence, 'desktop-result-activity', 3662);
}

/** @param {Page} page @param {string} suite @param {boolean} fail @returns {Promise<SubmittedRun>} */
async function measuredRun(page, suite, fail) {
  await page.setViewportSize({ width: 1440, height: 1018 });
  await page.goto(suite);
  const config = stagedConfiguration();
  const scenario = config.loadPlan.scenarios[0];
  assert(scenario?.executor === 'ramping-arrival-rate' && scenario.stages[1]);
  scenario.stages[1].duration = '15s';
  if (fail) config.loadPlan.slos.push({ id: 'p99', metric: 'http_req_duration', stat: 'p99', operator: '<', value: 0 });
  await revision(page, config, fail ? 3 : 2);
  const run = await start(page);
  const result = page.locator('.result-head').getByText(fail ? 'Failed' : 'Passed', { exact: true });
  const open = page.getByRole('button', { name: 'Open result', exact: true });
  await expect(open.or(result)).toBeVisible({ timeout: 60000 });
  if (await open.isVisible()) await open.click();
  await expect(result).toBeVisible();
  await assertRunState(page, { state: 'finished', outcome: fail ? 'failed' : 'passed' }, run);
  return run;
}

/** @param {Page} page */
async function settledResult(page) {
  await expect(page.getByRole('region', { name: 'The whole run', exact: true }).getByRole('img').first()).toBeVisible();
  const rows = page.getByRole('table', { name: 'Whole-run endpoint measurements' });
  const retry = page.getByRole('button', { name: /^(Retry|Check) measurements$/ });
  await expect(rows.or(retry)).toBeVisible();
  if (await retry.isVisible()) await retry.click();
  await expect(rows.locator('tbody tr')).toHaveCount(5);
  await expect(page.getByRole('region', { name: 'Verified performance report', exact: true })).toBeVisible();
  const target = page.getByRole('region', { name: 'Target runtime', exact: true });
  await expect(target.locator('figure')).toHaveCount(4);
}

/** @param {Page} page @param {string} evidence @param {string} view @param {number} height */
async function captureThemes(page, evidence, view, height) {
  await page.setViewportSize({ width: 1440, height });
  for (const theme of ['Darkroom', 'Scarab']) {
    await page.getByRole('radio', { name: theme, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    assert(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
    await page.screenshot({
      path: join(evidence, `${view}-${theme.toLowerCase()}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.getByRole('radio', { name: 'Darkroom', exact: true }).click();
}
