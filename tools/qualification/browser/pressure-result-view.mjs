import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect } from '@playwright/test';

/** @typedef {import('@playwright/test').Page} Page */

/** @param {Page} page @param {import('@beetle/contracts/api').LiveMetricHistory} history */
export async function verifyCheckpointView(page, history) {
  const recovered = page.getByRole('region', { name: 'Recovered charts', exact: true });
  await expect(recovered.getByRole('heading', { name: 'Recovered before the stop' })).toBeVisible();
  await expect(recovered.getByText(/^Retained through/).locator('time')).toHaveAttribute(
    'datetime',
    new Date(history.prefix.endTimeMs).toISOString(),
  );
  const last = history.samples.at(-1);
  if (last?.series.some((item) => item.metric === 'http_req_duration' && item.scope === 'execute')) {
    const endpoints = page.getByRole('table', { name: 'Endpoints in the last retained window', exact: true });
    await expect(endpoints.locator('tbody tr').first()).toBeVisible();
    await expect(page.locator('#result-endpoints')).toHaveCount(1);
  }
}

/** @param {Page} page @param {string} evidence @param {string} name */
export async function capturePressureView(page, evidence, name) {
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  await page.screenshot({ path: join(evidence, `${name}-result.png`), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('radio', { name: 'Scarab', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'scarab');
  await expect(page.locator('.result-head').getByRole('heading', { level: 1 })).toBeVisible();
  assert(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
  await page.screenshot({ path: join(evidence, `${name}-result-phone.png`), fullPage: true, animations: 'disabled' });
}
