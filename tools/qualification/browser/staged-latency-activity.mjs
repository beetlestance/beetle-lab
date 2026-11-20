import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { stagedConfiguration } from './live-staged.mjs';
import { revision } from './authoring.mjs';
import { execute } from './results.mjs';
import { targetCounts } from '../native-application/target-runtime/target.ts';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {Awaited<ReturnType<import('./authoring.mjs').author>>} Authored */

function configuration() {
  const config = stagedConfiguration();
  const scenario = config.loadPlan.scenarios[0];
  assert(scenario?.executor === 'ramping-arrival-rate');
  scenario.startRate = 24;
  scenario.preAllocatedVUs = 12;
  scenario.maxVUs = 16;
  scenario.stages = [
    { duration: '6s', target: 30 },
    { duration: '32s', target: 30 },
    { duration: '6s', target: 1 },
  ];
  config.requests = config.requests.slice(0, 1);
  const entries = config.selections[0]?.entries;
  assert(entries?.[0]);
  entries[0].maxIterationsPerVu = 1600;
  entries.splice(1);
  return config;
}

/** @param {Page} page @param {Authored} authored @param {import('../native-application/compose/fixture.ts').Fixture} fixture @param {string} evidence */
export async function stagedLatencyActivity(page, authored, fixture, evidence) {
  await page.setViewportSize({ width: 1440, height: 3662 });
  await page.goto(authored.suite);
  await revision(page, configuration(), 2);
  const result = await execute(page);
  await expect(page.getByRole('region', { name: 'The whole run' }).getByRole('img').first()).toBeVisible();
  await page.getByRole('tab', { name: 'What happened', exact: true }).click();
  const desktop = await inspectActivity(page);
  await page.screenshot({
    path: join(evidence, 'native-activity-desktop.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('radio', { name: 'Scarab', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'scarab');
  await page.locator('#result-activity > summary').click();
  const phone = await inspectActivity(page);
  assert.deepEqual(phone, desktop);
  await page
    .getByRole('region', { name: 'What happened', exact: true })
    .screenshot({ path: join(evidence, 'native-activity-phone.png'), animations: 'disabled' });
  const counts = targetCounts(fixture);
  assert(counts.ready === 1 && counts.work >= 1000 && counts.work <= 1600 && counts.unexpected === 0);
  await writeFile(join(evidence, 'staged-latency.json'), JSON.stringify({ result, desktop, phone, counts }), {
    mode: 0o600,
    flag: 'wx',
  });
}

/** @param {Page} page */
async function inspectActivity(page) {
  const panel = page.getByRole('region', { name: 'What happened', exact: true });
  const rows = panel.getByRole('list', { name: 'Scenario timeline', exact: true }).getByRole('listitem');
  await expect(rows).toHaveText([
    /00:00.*Ramp to 30 a second.*HTTP samples in scenario window/,
    /00:06.*Steady at 30 a second.*HTTP samples in scenario window/,
    /00:[0-5][0-9].*p95 rose for about.*mostly GET \/checkout/,
    /00:38.*Ramp down to 1 a second.*HTTP samples in scenario window/,
    /00:44.*Drain/,
  ]);
  await expect(rows.last()).not.toContainText('HTTP samples');

  const details = panel.getByText('Inspect recorded activity and resource observations', { exact: true });
  const recorded = panel.getByRole('list', { name: 'Recorded run milestones', exact: true });
  await expect(recorded).toHaveCount(0);
  await details.click();
  await expect(recorded).toContainText('Native runtime exited');
  await details.click();
  await expect(recorded).toHaveCount(0);
  return { rows: await rows.allTextContents(), rise: await rows.nth(2).textContent() };
}
