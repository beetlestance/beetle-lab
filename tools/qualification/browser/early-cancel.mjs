import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { validateApi } from '@beetle/contracts/api';
import { counts } from '../resources/lifecycle/observations.ts';
import { revision } from './authoring.mjs';
import { start } from './results.mjs';
import { assertRunState } from './run-state.mjs';

/**
 * Cancel an engine that has reached readiness and has not begun measurements.
 * @param {import('@playwright/test').Page} page
 * @param {Awaited<ReturnType<import('./authoring.mjs').author>>} authored
 * @param {import('../native-application/compose/fixture.ts').Fixture} fixture
 * @param {string} evidence
 */
export async function earlyCancel(page, authored, fixture, evidence) {
  const config = structuredClone(authored.config);
  assert(config.readiness);
  Object.assign(config.readiness, { attempts: 12, intervalMs: 1000, wallBudgetMs: 23000 });
  await page.goto(authored.suite);
  await revision(page, config, 2);
  const submitted = await start(page);
  await expect.poll(() => counts(fixture).ready, { timeout: 12000, intervals: [500] }).toBeGreaterThan(0);
  assert.equal(counts(fixture).work, 0);
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  const open = page.getByRole('button', { name: 'Open result', exact: true });
  await expect(open).toBeVisible({ timeout: 60000 });
  await open.click();
  await assertRunState(page, { state: 'cancelled', outcome: 'inconclusive' }, submitted);
  await expect(page.getByText('No chart history was recorded.', { exact: true })).toBeVisible();
  await verifyNoCheckpoint(page, submitted);
  const observed = counts(fixture);
  assert(observed.ready > 0 && observed.work === 0 && observed.unexpected === 0);
  await writeFile(join(evidence, 'early-cancel-coverage.json'), JSON.stringify(observed), { mode: 0o600, flag: 'wx' });
  await page.screenshot({ path: join(evidence, 'early-cancelled-result.png'), fullPage: true });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {Awaited<ReturnType<import('./results.mjs').start>>} run
 */
async function verifyNoCheckpoint(page, run) {
  const base = run.origin + '/api/v2' + run.path;
  const reply = await page.request.get(base);
  assert.equal(reply.status(), 200);
  const checked = validateApi('Run', await reply.json());
  assert(checked.ok && checked.value.id === run.id);
  assert.equal(checked.value.reason, 'cancelled');
  const history = await page.request.get(
    base + '/attempts/' + checked.value.activeAttemptId + '/metrics/stopped-history',
  );
  assert.equal(history.status(), 404);
  const body = validateApi('ApiError', await history.json());
  assert(body.ok);
  assert.equal(body.value.code, 'not_found');
  await expect(page.getByRole('heading', { name: 'Recovered before the stop' })).toHaveCount(0);
}
