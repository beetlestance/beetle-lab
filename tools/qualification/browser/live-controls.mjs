import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { validateApi } from '@beetle/contracts/api';
import { configuration } from '../native-application/target-runtime/config.ts';
import { targetCounts } from '../native-application/target-runtime/target.ts';
import { revision } from './authoring.mjs';
import { start } from './results.mjs';
import { assertRunState } from './run-state.mjs';

export const liveTargetReadings = { cpuPercent: 0.64, systemCpuPercent: 38, activeHandles: 7 };

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('./run-state.mjs').SubmittedRun} SubmittedRun */

/**
 * @param {Page} page
 * @param {Awaited<ReturnType<import('./authoring.mjs').author>>} authored
 * @param {import('../native-application/compose/fixture.ts').Fixture} fixture
 * @param {string} evidence
 */
export async function liveControls(page, authored, fixture, evidence) {
  await page.goto(authored.suite);
  await revision(page, liveSamplerConfiguration(), 2);
  const submitted = await start(page);
  const target = page.getByRole('region', { name: 'Target runtime', exact: true });
  await expect(target.getByRole('img', { name: /^CPU:.*process 64%.*system 38%/ })).toBeVisible({ timeout: 16000 });
  await expect(target.getByRole('img', { name: /^Active handles:.*handles 7/ })).toBeVisible();
  const reply = await page.request.get(submitted.origin + '/api/v2' + submitted.path);
  const run = validateApi('Run', await reply.json());
  assert(reply.ok() && run.ok && run.value.state === 'active' && run.value.id === submitted.id);

  const menu = await openDownloads(page);
  await expect(menu.getByRole('button', { name: /^Metrics so far/ })).toBeEnabled({ timeout: 8000 });
  await capture(page, evidence, 'live-download-darkroom-desktop');
  const downloaded = await verifyProvisional(page, menu, evidence, submitted, run.value.activeAttemptId);
  await choosePinnedScript(page, menu, submitted, authored.suite, evidence);
  await capturePhone(page, evidence);

  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible({ timeout: 60000 });
  await assertRunState(page, { state: 'cancelled', outcome: 'inconclusive' }, submitted);
  const observed = targetCounts(fixture);
  assert(observed.ready === 1 && observed.work > 0 && observed.work < 40 && observed.runtime >= 4);
  assert.equal(observed.unexpected, 0);
  await writeFile(join(evidence, 'live-controls-coverage.json'), JSON.stringify({ observed, downloaded }), {
    mode: 0o600,
    flag: 'wx',
  });
}

export function liveSamplerConfiguration() {
  const config = configuration();
  const scenario = config.loadPlan.scenarios[0];
  assert(scenario?.executor === 'per-vu-iterations' && config.targetSampling);
  scenario.maxDuration = '40s';
  const entry = config.selections[0]?.entries[0];
  assert(entry);
  entry.wait = { durationMs: 900, jitterMs: 0 };
  config.targetSampling.intervalMs = 1500;
  config.targetSampling.cooldownMs = 0;
  config.targetSampling.units = {
    heapAlloc: 'bytes',
    rss: 'bytes',
    cpuPercent: 'ratio',
    systemCpuPercent: 'percent',
    activeHandles: 'count',
    'eventLoopDelay.mean': 'milliseconds',
    'eventLoopDelay.p99': 'milliseconds',
    'eventLoopDelay.max': 'milliseconds',
  };
  return config;
}

/** @param {Page} page */
async function openDownloads(page) {
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const menu = page.getByRole('group', { name: 'Run downloads', exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

/**
 * @param {Page} page
 * @param {import('@playwright/test').Locator} menu
 * @param {string} evidence
 * @param {SubmittedRun} submitted
 * @param {string} attemptId
 */
async function verifyProvisional(page, menu, evidence, submitted, attemptId) {
  const report = await downloadText(
    page,
    menu,
    /^Report so far/,
    evidence,
    `run-${submitted.id}-provisional-report.txt`,
  );
  assert(report.startsWith('Beetle Lab — provisional report'));
  assert(report.includes('not totals or a final outcome'));
  for (const [key, id] of [
    ['run_id', submitted.id],
    ['attempt_id', attemptId],
    ['workspace_id', submitted.workspaceId],
  ]) {
    assert(report.includes(`\n${key}: ${id}\n`));
  }
  assert(/\nretained_windows: [1-9][0-9]*\n/.test(report));
  const csv = await downloadText(
    page,
    menu,
    /^Metrics so far/,
    evidence,
    `run-${submitted.id}-provisional-metrics.csv`,
  );
  const [header, ...rows] = csv
    .trimEnd()
    .split('\r\n')
    .map((row) => row.split(','));
  assert(header && rows.length > 0 && rows.length <= 900);
  for (const row of rows) {
    assert.equal(row.length, header.length);
    assert.equal(row[0], 'provisional_chart_projection');
    assert.equal(row[header.indexOf('organization_id')], submitted.organizationId);
    assert.equal(row[header.indexOf('workspace_id')], submitted.workspaceId);
    assert.equal(row[header.indexOf('run_id')], submitted.id);
    assert.equal(row[header.indexOf('attempt_id')], attemptId);
    assert(Number.isSafeInteger(Number(row[header.indexOf('window_end_utc_ms')])));
  }
  assert(rows.some((row) => Number(row[header.indexOf('requests_per_second')]) > 0));
  return { reportBytes: Buffer.byteLength(report), csvBytes: Buffer.byteLength(csv), csvWindows: rows.length };
}

/**
 * @param {Page} page @param {import('@playwright/test').Locator} menu
 * @param {RegExp} name @param {string} evidence @param {string} filename
 */
async function downloadText(page, menu, name, evidence, filename) {
  const control = menu.getByRole('button', { name });
  await expect(control).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), control.click()]);
  assert.equal(download.suggestedFilename(), filename);
  const path = join(evidence, filename);
  await download.saveAs(path);
  const { size } = await stat(path);
  assert(size > 0 && size <= 524288);
  return readFile(path, 'utf8');
}

/**
 * @param {Page} page @param {import('@playwright/test').Locator} menu
 * @param {SubmittedRun} submitted @param {string} suite @param {string} evidence
 */
async function choosePinnedScript(page, menu, submitted, suite, evidence) {
  await menu.getByRole('button', { name: 'Script for revision 2', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Scripts for Synthetic k6 suite', exact: true });
  const pinned = picker.getByRole('link', { name: /^Revision 2.*This run/ });
  await expect(pinned).toHaveAttribute('aria-current', 'true');
  await expect(picker.getByRole('link', { name: /^Revision 1/ })).toBeVisible();
  await expect(page.getByText('Running', { exact: true })).toBeVisible({ timeout: 8000 });
  await capture(page, evidence, 'live-script-picker-darkroom-desktop');
  await pinned.click();
  await expect(page).toHaveURL(`${suite}/revisions/${submitted.revisionId}/script?run=${submitted.id}`);
  await expect(page.getByRole('heading', { name: 'Script for revision 2', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByRole('link', { name: /Run / }).click();
  await expect(page).toHaveURL(submitted.origin + submitted.path);
}

/** @param {Page} page @param {string} evidence */
async function capturePhone(page, evidence) {
  await page.getByRole('radio', { name: 'Scarab', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'scarab');
  await capture(page, evidence, 'live-scarab-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = await openDownloads(page);
  await expect(menu.getByRole('button', { name: /^Report so far/ })).toBeEnabled();
  await capture(page, evidence, 'live-download-scarab-phone');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await capture(page, evidence, 'live-scarab-phone');
}

/** @param {Page} page @param {string} evidence @param {string} name */
async function capture(page, evidence, name) {
  const size = await page.evaluate(() => ({
    contentWidth: globalThis.document.documentElement.scrollWidth,
    viewport: globalThis.innerWidth,
  }));
  assert(size.contentWidth <= size.viewport + 1, `Layout overflows: ${JSON.stringify(size)}`);
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true });
}
