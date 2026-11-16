import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expect} from '@playwright/test';
import {saveEditor} from './authoring.mjs';
/**
 * @param {import('@playwright/test').Page} page
 * @param {string} workspace
 * @param {string} root
 */
export async function inputs(page, workspace, root) {
  await page.goto(workspace);
  await page.getByRole('link', {name: 'Inputs', exact: true}).click();
  const payload = Buffer.from('name,value\nsynthetic,42\n');
  await page.getByLabel('Input file', {exact: true}).setInputFiles({name: 'synthetic.csv', mimeType: 'text/csv', buffer: payload});
  await page.getByLabel('Input name', {exact: true}).fill('Synthetic input');
  await page.getByRole('button', {name: 'Upload input', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Clear completed draft', exact: true})).toBeVisible({timeout: 30000});
  await page.getByRole('button', {name: 'Read current status for Synthetic input', exact: true}).click();
  await page.getByRole('button', {name: 'Download input', exact: true}).click();
  const downloaded = page.waitForEvent('download'); await page.getByRole('link', {name: 'Save file', exact: true}).click();
  const path = join(root, 'input.csv'); await (await downloaded).saveAs(path);
  expect(await readFile(path)).toEqual(payload);
}
/**
 * @param {import('@playwright/test').Page} page
 */
export async function settings(page) {
  await page.getByRole('link', {name: 'Installation settings', exact: true}).click();
  await page.getByRole('button', {name: 'Edit Timeout (milliseconds)', exact: true}).click();
  await page.getByLabel('Timeout (milliseconds)', {exact: true}).fill('310000');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.getByRole('alert').getByText('Check the entered values and try again.', {exact: true})).toBeVisible();
  await page.getByLabel('Timeout (milliseconds)', {exact: true}).fill('290000');
  await saveEditor(page); await page.reload();
  await expect(page.getByText('290000 / installation', {exact: true})).toBeVisible();
}
/**
 * @param {import('@playwright/test').Page} page
 * @param {string} workspace
 */
export async function emptyFolder(page, workspace) {
  await page.goto(workspace);
  await page.getByRole('button', {name: 'Create folder', exact: true}).click();
  await page.getByLabel('Folder name', {exact: true}).fill('Disposable folder'); await saveEditor(page);
  await page.getByRole('button', {name: 'Delete Disposable folder', exact: true}).click();
  await page.getByLabel('Confirm deletion of Disposable folder', {exact: true}).fill('DELETE'); await saveEditor(page);
  await expect(page.getByRole('button', {name: 'Delete Disposable folder', exact: true})).toHaveCount(0);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} workspace
 * @param {string} root
 */
export async function directoryImport(page, workspace, root) {
  const directory = join(root, 'directory-input'); await mkdir(join(directory, 'nested'), {recursive: true, mode: 0o700});
  await writeFile(join(directory, 'alpha.csv'), 'alpha,1\n', {mode: 0o600});
  await writeFile(join(directory, 'nested', 'beta.csv'), 'beta,2\n', {mode: 0o600});
  await page.goto(workspace); await page.getByRole('link', {name: 'Inputs', exact: true}).click();
  await page.getByLabel('Input directory', {exact: true}).setInputFiles(directory);
  await page.getByRole('button', {name: 'Import directory', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Clear completed directory draft', exact: true})).toBeVisible({timeout: 30000});
  await expect(page.getByRole('rowheader', {name: 'alpha.csv', exact: true})).toBeVisible();
  await expect(page.getByRole('rowheader', {name: 'beta.csv', exact: true})).toBeVisible();
  await page.goto(workspace);
  await expect(page.getByText('/Synthetic workspace/directory-input/nested', {exact: true})).toBeVisible();
}
