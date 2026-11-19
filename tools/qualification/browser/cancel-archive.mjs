import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { validateApi } from '@beetle/contracts/api';
import { configuration } from '../native-application/target-runtime/config.ts';
import { targetCounts } from '../native-application/target-runtime/target.ts';
import { revision } from './authoring.mjs';
import { start } from './results.mjs';
import { assertRunState } from './run-state.mjs';

function cancelConfiguration() {
  const config = configuration();
  const scenario = config.loadPlan.scenarios[0];
  const request = config.selections[0]?.entries[0];
  assert(scenario?.executor === 'per-vu-iterations' && request && config.targetSampling);
  scenario.maxDuration = '25s';
  request.wait = { durationMs: 500, jitterMs: 0 };
  config.targetSampling.cooldownMs = 0;
  return config;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {Awaited<ReturnType<import('./authoring.mjs').author>>} authored
 * @param {import('../native-application/compose/fixture.ts').Fixture} fixture
 * @param {string} evidence
 */
export async function cancelArchive(page, authored, fixture, evidence) {
  const config = cancelConfiguration();
  await page.goto(authored.suite);
  await revision(page, config, 2);
  const submitted = await start(page);
  await expect.poll(() => targetCounts(fixture).work, { timeout: 18000, intervals: [500] }).toBeGreaterThanOrEqual(10);
  const cancel = page.getByRole('button', { name: 'Cancel run', exact: true });
  await expect(cancel).toBeEnabled();
  await cancel.click();
  const open = page.getByRole('button', { name: 'Open result', exact: true });
  await expect(open).toBeVisible({ timeout: 60000 });
  const chartResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.origin === submitted.origin &&
      url.pathname.startsWith('/api/v2' + submitted.path + '/attempts/') &&
      url.pathname.endsWith('/metrics/chart-history')
    );
  });
  void chartResponse.catch(() => undefined);
  await open.click();
  await assertRunState(page, { state: 'cancelled', outcome: 'inconclusive' }, submitted);
  const measured = await sealedResult(page, submitted, evidence, await chartResponse);
  const observed = targetCounts(fixture);
  assert(observed.work >= 10 && observed.work < 40 && observed.runtime >= 4 && observed.unexpected === 0);
  await writeFile(join(evidence, 'cancel-archive-coverage.json'), JSON.stringify({ measured, observed }), {
    mode: 0o600,
    flag: 'wx',
  });
  await page.screenshot({ path: join(evidence, 'cancel-archive-desktop.png'), fullPage: true });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {Awaited<ReturnType<import('./results.mjs').start>>} submitted
 * @param {string} evidence
 * @param {import('@playwright/test').Response} archive
 */
async function sealedResult(page, submitted, evidence, archive) {
  const base = submitted.origin + '/api/v2' + submitted.path;
  const reply = await page.request.get(base + '/result');
  const snapshot = validateApi('RunResultSnapshot', await reply.json());
  assert(reply.ok() && snapshot.ok && snapshot.value.id === submitted.id);
  const result = snapshot.value.result;
  assert(result, 'No sealed result survived cancellation');
  assert.equal(result.execution.status, 'cancelled');
  assert.equal(result.completeness, 'partial');
  assert.equal(archive.status(), 200, 'Expected the browser chart history read to succeed');
  const chart = validateApi('RunChartHistory', await archive.json());
  assert(
    chart.ok && chart.value.attemptId === snapshot.value.activeAttemptId,
    'Expected chart history for this attempt',
  );
  assert.equal(chart.value.reason, null);
  assert(chart.value.points.length > 0);
  assert(result.artifacts.some((entry) => entry.kind === 'target-runtime'));
  await expect(page.getByRole('img', { name: /Heap and RSS:/ }).first()).toBeVisible();
  const report = result.artifacts.find((entry) => entry.kind === 'performance-report');
  assert(report && report.bytes > 0 && report.bytes <= 1_048_576);
  await expect(page.getByRole('region', { name: 'Verified performance report', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download report', exact: true }).click();
  const path = join(evidence, 'cancelled-performance-report.txt');
  await (await download).saveAs(path);
  const bytes = await readFile(path);
  assert.equal(bytes.length, report.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), report.sha256);
  return { windows: chart.value.points.length, reportSha256: report.sha256, source: result.completeness };
}
