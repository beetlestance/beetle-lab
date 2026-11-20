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

/**
 * @param {import('@playwright/test').Page} page
 * @param {import('@beetle/contracts/api').Run} run
 * @param {string} root
 */
export async function runScriptZip(page, run, root) {
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const group = page.getByRole('group', { name: 'Run downloads' });
  await group.getByRole('link', { name: /^Script for revision/ }).click();
  await verifyScriptZip(page, run, root);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ id: string, revisionId: string }} run
 * @param {string} root
 */
export async function verifyScriptZip(page, run, root) {
  const url = new URL(page.url());
  expect(url.pathname).toContain(`/revisions/${run.revisionId}/script`);
  expect(url.searchParams.get('run')).toBe(run.id);
  expect(url.searchParams.get('export')).toBe('zip');
  const prepare = page.getByRole('dialog').getByRole('button', { name: 'Prepare script', exact: true });
  await expect(prepare).toBeVisible();
  await prepare.click();

  const dialog = page.getByRole('dialog', { name: /is ready as a k6 script$/ });
  const download = dialog.getByRole('button', { name: 'Download ZIP', exact: true });
  await expect(download).toBeVisible({ timeout: 60000 });
  const expected = await dialog.locator('code[title]').getAttribute('title');
  expect(expected).toMatch(/^[a-f0-9]{64}$/);
  await download.click();
  const fallback = dialog.getByRole('link', { name: 'Save checked ZIP', exact: true });
  const [saved] = await Promise.all([page.waitForEvent('download'), fallback.click()]);
  expect(saved.suggestedFilename()).toBe('script.zip');
  const path = join(root, 'script.zip');
  await saved.saveAs(path);
  const archive = await readFile(path);
  const end = archive.length - 22;
  expect(archive.readUInt32LE(end)).toBe(0x06054b50);
  expect(archive.readUInt16LE(end + 10)).toBe(1);
  expect(archive.subarray(30, 39).toString()).toBe('script.js');
  const directory = archive.readUInt32LE(end + 16);
  expect(archive.readUInt32LE(18)).toBe(directory - 39);
  expect(createHash('sha256').update(archive.subarray(39, directory)).digest('hex')).toBe(expected);
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(dialog).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('run')).toBe(run.id);
}
