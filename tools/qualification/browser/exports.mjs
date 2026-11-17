import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
/**
 * @param {import('@playwright/test').Page} page
 * @param {string} suite
 * @param {string} root
 */
export async function offlineExport(page, suite, root) {
  await page.goto(suite);
  await page.getByRole('button', { name: 'View revision 1', exact: true }).click();
  await page.getByRole('button', { name: 'Standalone script exports', exact: true }).click();
  await page.getByRole('button', { name: 'Generate standalone script', exact: true }).click();
  await page.getByRole('button', { name: 'View submitted export', exact: true }).click();
  const link = page.getByRole('link', { name: 'Download standalone script', exact: true });
  await expect(link).toBeVisible({ timeout: 60000 });
  const text = await link.locator('..').innerText();
  const expected = text.match(/SHA-256 ([a-f0-9]{64})/);
  if (!expected) throw Error('Published digest is missing');
  const downloaded = page.waitForEvent('download');
  await link.click();
  const path = join(root, 'suite.js');
  await (await downloaded).saveAs(path);
  const bytes = await readFile(path);
  expect(bytes.length).toBeGreaterThan(0);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected[1]);
}
