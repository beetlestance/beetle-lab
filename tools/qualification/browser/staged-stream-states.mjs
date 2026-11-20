import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { stagedConfiguration } from './live-staged.mjs';
import { interruptLiveFeed, verifyPaused } from './lifecycle.mjs';
import { revision } from './authoring.mjs';
import { start } from './results.mjs';
import { assertRunState } from './run-state.mjs';
import { targetCounts } from '../native-application/target-runtime/target.ts';

/**
 * @param {import('@playwright/test').Page} page
 * @param {Awaited<ReturnType<import('./authoring.mjs').author>>} authored
 * @param {import('../native-application/compose/fixture.ts').Fixture} fixture
 * @param {string} evidence
 */
export async function stagedStreamStates(page, authored, fixture, evidence) {
  await page.setViewportSize({ width: 1440, height: 2584 });
  await page.goto(authored.suite);
  await revision(page, stagedConfiguration(), 2);
  const run = await start(page);
  const stage = page.locator('.live-stage.is-now');
  await expect(stage).toContainText('Steady', { timeout: 26000 });
  await expect(page.locator('.live-endpoints tbody tr')).toHaveCount(5);
  await expect(page.locator('.live-threshold.is-holding')).toHaveCount(3);
  const target = page.getByRole('region', { name: 'Target runtime', exact: true });
  await expect(target.locator('figure')).toHaveCount(4);
  await expect(page.locator('.live-percent')).toHaveText(/^[3-5]\d%$/, { timeout: 17000 });
  assert(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
  const beforePause = targetCounts(fixture).work;
  await verifyPaused(page, evidence, () =>
    expect.poll(() => targetCounts(fixture).work, { timeout: 5000, intervals: [750] }).toBeGreaterThan(beforePause + 3),
  );
  await interruptLiveFeed(page, evidence);
  await assertRunState(page, { state: 'active', outcome: 'pending' }, run);
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible({ timeout: 60000 });
  await assertRunState(page, { state: 'cancelled', outcome: 'inconclusive' }, run);
  const observed = targetCounts(fixture);
  assert(observed.ready === 1 && observed.work > 10 && observed.work < 180 && observed.runtime >= 4);
  assert.equal(observed.unexpected, 0);
  await writeFile(
    join(evidence, 'staged-stream-states.json'),
    JSON.stringify({
      endpoints: 5,
      thresholds: 3,
      targetCharts: 4,
      pauseFiguresHeld: true,
      reconnectKeptFigures: true,
      recoveredAndCancelled: true,
      observed,
    }),
    { mode: 0o600, flag: 'wx' },
  );
}
