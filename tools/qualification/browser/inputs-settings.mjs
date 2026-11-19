import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
/**
 * @param {import('@playwright/test').Page} page
 * @param {string} workspace
 * @param {string} root
 */
export async function inputs(page, workspace, root) {
  await page.goto(workspace);
  await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
  await page.getByRole('link', { name: 'Inputs', exact: true }).click();
  await page.getByRole('button', { name: 'Upload files', exact: true }).click();
  const payload = Buffer.from('name,value\nsynthetic,42\n');
  await page
    .getByLabel('Input file', { exact: true })
    .setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: payload });
  await page.getByLabel('Input name', { exact: true }).fill('Synthetic input');
  await page.getByRole('button', { name: 'Upload input', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clear completed draft', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Close upload', exact: true }).click();
  await page.getByRole('button', { name: 'Read current status for Synthetic input', exact: true }).click();
  await page.getByRole('button', { name: 'Download input', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Save file', exact: true }).click();
  const path = join(root, 'input.csv');
  await (await downloaded).saveAs(path);
  expect(await readFile(path)).toEqual(payload);
}
/**
 * @param {import('@playwright/test').Page} page
 */
export async function settings(page) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('link', { name: 'Installation', exact: true }).click();
  const field = page.getByLabel('Longest run allowed', { exact: true });
  const save = page.getByRole('button', { name: /^Save (?:this )?installation$/ });
  await field.fill('5.1');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(save).toBeDisabled();
  // 4.5 minutes is exactly 270000 ms; no rounding hides a persistence error.
  await field.fill('4.5');
  await save.click();
  await expect(page.getByText(/^Saved\. New runs in /)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Longest run allowed', { exact: true })).toHaveValue('4.5');
}
/**
 * @param {import('@playwright/test').Page} page
 * @param {string} workspace
 */
export async function emptyFolder(page, workspace) {
  await page.goto(workspace);
  await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
  await page.getByRole('link', { name: 'Suites', exact: true }).click();
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const create = page.getByRole('dialog', { name: /^New folder in / });
  await create.getByLabel('Name', { exact: true }).fill('Disposable folder');
  await create.getByRole('button', { name: 'Create folder', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Disposable folder', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Disposable folder', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete Disposable folder?', exact: true });
  await confirmation.getByLabel('Type Disposable folder to confirm', { exact: true }).fill('Disposable folder');
  await confirmation.getByRole('button', { name: 'Delete Disposable folder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Actions for Disposable folder', exact: true })).toHaveCount(0);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} workspace
 * @param {string} root
 */
export async function directoryImport(page, workspace, root) {
  const directory = join(root, 'directory-input');
  await mkdir(join(directory, 'nested'), { recursive: true, mode: 0o700 });
  await writeFile(join(directory, 'alpha.csv'), 'alpha,1\n', { mode: 0o600 });
  await writeFile(join(directory, 'nested', 'beta.csv'), 'beta,2\n', { mode: 0o600 });
  await page.goto(workspace);
  await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
  await page.getByRole('link', { name: 'Inputs', exact: true }).click();
  await page.getByRole('button', { name: 'Import a folder', exact: true }).click();
  await page.getByLabel('Input directory', { exact: true }).setInputFiles(directory);
  await page.getByRole('button', { name: 'Import directory', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clear completed directory draft', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Close import', exact: true }).click();
  await expect(page.getByRole('rowheader', { name: 'alpha.csv', exact: true })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'beta.csv', exact: true })).toBeVisible();
  await page.goto(workspace);
  await page.getByRole('link', { name: 'Workspaces', exact: true }).click();
  await page.getByRole('link', { name: 'Suites', exact: true }).click();
  await page.getByRole('link', { name: /^directory-input/ }).click();
  await expect(page.getByRole('link', { name: 'nested', exact: true })).toBeVisible();
}
