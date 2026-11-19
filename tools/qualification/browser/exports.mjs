import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { revisionItem } from './authoring.mjs';
/**
 * @param {import('@playwright/test').Page} page
 * @param {string} suite
 * @param {string} root
 */
export async function offlineExport(page, suite, root) {
  await page.goto(suite);
  const item = await revisionItem(page, 1);
  await item.getByRole('link', { name: 'View script', exact: true }).click();
  await page.getByRole('button', { name: 'Export script', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare script', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /is ready as a k6 script$/ });
  const link = dialog.getByRole('button', { name: 'Download script', exact: true });
  await expect(link).toBeVisible({ timeout: 60000 });
  const expected = (await dialog.locator('code[title]').getAttribute('title'))?.match(/^[a-f0-9]{64}$/);
  if (!expected) throw Error('Published digest is missing');
  await link.click();
  const checked = dialog.getByRole('link', { name: 'Save checked script', exact: true });
  await expect(checked).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await checked.click();
  const path = join(root, 'suite.js');
  await (await downloaded).saveAs(path);
  const bytes = await readFile(path);
  expect(bytes.length).toBeGreaterThan(0);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected[0]);
}
