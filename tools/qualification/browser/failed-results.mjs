import { expect } from '@playwright/test';
import { join } from 'node:path';
import { revision } from './authoring.mjs';
import { execute, results, start } from './results.mjs';
import { assertRunState } from './run-state.mjs';

/**
 * Two bounded executions exercise clean diagnostics and a real failed latency threshold.
 * @param {import('@playwright/test').Page} page
 * @param {{suite: string, config: {loadPlan: object}}} authored
 * @param {string} evidence
 */
export async function failedResults(page, authored, evidence) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await cleanDiagnostics(page, evidence);
  await page.goto(authored.suite);
  await revision(
    page,
    {
      ...authored.config,
      loadPlan: {
        ...authored.config.loadPlan,
        slos: [{ id: 'impossible', metric: 'http_req_duration', stat: 'p99', operator: '<', value: 0 }],
      },
    },
    2,
  );
  const submitted = await start(page);
  const open = page.getByRole('button', { name: 'Open result', exact: true });
  const title = page.getByRole('heading', { name: 'Synthetic k6 suite failed', exact: true });
  await expect(open.or(title)).toBeVisible({ timeout: 60000 });
  if (await open.isVisible()) await open.click();
  await expect(title).toBeVisible({ timeout: 60000 });
  await assertRunState(page, { state: 'finished', outcome: 'failed' }, submitted);
  await expect(page.locator('.result-sentence')).toContainText(/p99.*limit/i);
  const length = page.locator('.result-tiles > div').filter({ hasText: 'test length' }).locator('dd');
  await expect(length).toHaveText(/^[1-9]\d{0,2} ms$/);
  await expect(page.getByRole('region', { name: 'Verified performance report' })).toBeVisible();
  await expect(page.getByText('Reading recorded chart history…', { exact: true })).toHaveCount(0);
  await capture(page, evidence, 'failed-result');
  await results(page, evidence);
  await capture(page, evidence, 'failed-artifacts');
  await verifyPreview(page, evidence);
  await recordedActivity(page, evidence);
  await phoneDiagnostics(page, evidence);
}

/** @param {import('@playwright/test').Page} page @param {string} evidence */
async function cleanDiagnostics(page, evidence) {
  await execute(page);
  await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click();
  await expect(page.getByText('No warnings recorded. k6 exited cleanly.', { exact: true })).toBeVisible();
  await capture(page, evidence, 'clean-diagnostics');
  const trigger = page.getByRole('button', { name: 'Open the sanitized log', exact: true });
  await trigger.click();
  const log = page.getByRole('dialog', { name: 'Sanitized k6 log', exact: true });
  await expect(log.getByText(/^Capture coverage:/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(log).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

/** @param {import('@playwright/test').Page} page @param {string} evidence */
async function verifyPreview(page, evidence) {
  const trigger = page.getByRole('button', { name: 'Verify and open performance-report.txt', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'performance-report.txt', exact: true });
  await expect(dialog.getByRole('status')).toContainText('Size and SHA-256 match the sealed manifest');
  await expect(dialog.locator('pre')).not.toBeEmpty();
  await capture(page, evidence, 'failed-artifact-preview');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

/** @param {import('@playwright/test').Page} page @param {string} evidence */
async function recordedActivity(page, evidence) {
  await page.getByRole('tab', { name: 'What happened', exact: true }).click();
  const activity = page.getByRole('list', { name: 'Recorded run milestones', exact: true });
  await expect(activity).toContainText('Admission accepted');
  await expect(activity).toContainText('Native runtime exited');
  await capture(page, evidence, 'failed-timeline');
  await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Native warnings', exact: true })).toContainText(
    'Diagnostic coverage:',
  );
  await expect(page.getByText('No warnings recorded. k6 exited cleanly.', { exact: true })).toHaveCount(0);
  await capture(page, evidence, 'failed-diagnostics');
}

/** @param {import('@playwright/test').Page} page @param {string} evidence */
async function phoneDiagnostics(page, evidence) {
  await page.getByRole('radio', { name: 'Scarab', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#result-diagnostics > summary').click();
  await expect(page.getByRole('region', { name: 'Native warnings', exact: true })).toContainText(
    'Diagnostic coverage:',
  );
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await capture(page, evidence, 'failed-diagnostics-scarab-phone');
}

/** @param {import('@playwright/test').Page} page @param {string} evidence @param {string} name */
async function capture(page, evidence, name) {
  await page.screenshot({ path: join(evidence, name + '.png'), fullPage: true, animations: 'disabled' });
}
