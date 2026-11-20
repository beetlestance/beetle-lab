import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Locator} Locator */

/** @param {Page} page @param {string} evidence @param {string} downloaded */
export async function jsonArtifactViewer(page, evidence, downloaded) {
  const expected = JSON.parse(downloaded);
  const outcomes = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    if (width === 390) {
      await page.locator('#result-artifacts > summary').click();
    } else {
      await page.getByRole('tab', { name: /^Artifacts\b/ }).click();
    }
    for (const skin of ['Darkroom', 'Scarab']) {
      if (width === 390) await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('radio', { name: skin, exact: true }).click();
      if (width === 390) await page.keyboard.press('Escape');
      await expect(page.locator('html')).toHaveAttribute('data-theme', skin.toLowerCase());
      outcomes.push(await openPreview(page, expected, evidence, width, skin));
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('radio', { name: 'Darkroom', exact: true }).click();
  await writeFile(join(evidence, 'json-viewer-outcome.json'), JSON.stringify(outcomes, null, 2), { mode: 0o600 });
}

/** @param {Page} page @param {unknown} expected @param {string} evidence @param {number} width @param {string} skin */
async function openPreview(page, expected, evidence, width, skin) {
  const name = 'numeric-final.json';
  const trigger = page.getByRole('button', { name: 'Verify and open ' + name, exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name, exact: true });
  await expect(dialog.getByRole('status')).toContainText('Size and SHA-256 match the sealed manifest');
  const contents = dialog.getByLabel('Contents of ' + name, { exact: true });
  const preview = await contents.textContent();
  assert(preview);
  assert.deepEqual(JSON.parse(preview), expected);
  await expect(dialog.getByRole('link', { name: 'Download', exact: true })).toBeVisible();
  await page.screenshot({
    path: join(evidence, `json-viewer-${width}-${skin.toLowerCase()}.png`),
    animations: 'disabled',
  });
  const scroll = await verifyScroll(contents);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  return { width, skin, name, scroll };
}

/** @param {Locator} contents */
async function verifyScroll(contents) {
  await contents.focus();
  const before = await contents.evaluate(({ ownerDocument }) => ({
    y: ownerDocument.defaultView?.scrollY,
    width: ownerDocument.documentElement.clientWidth,
    scrollWidth: ownerDocument.documentElement.scrollWidth,
  }));
  assert.equal(before.width, before.scrollWidth);
  await contents.press('End');
  await expect.poll(() => contents.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  assert.equal(await contents.evaluate(({ ownerDocument }) => ownerDocument.defaultView?.scrollY), before.y);
  return await contents.evaluate((element) => element.scrollTop);
}
