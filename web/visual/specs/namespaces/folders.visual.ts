// Section 3: folder dialogs on the Suites screens, each with the folder list or folder view behind it.
import type { Page } from '@playwright/test';
import { capture, expect, settle, test, viewports } from '../../harness.js';
import { chain, nsIds, refusal, suitesWorld } from '../../world/namespaces.js';

const org = nsIds.organization;
const suites = `/organizations/${org}/workspaces/${nsIds.checkout}/suites`;
const capacityView = `${suites}?folder=${nsIds.capacity}`;

async function open(page: Page, path: string) {
  await page.setViewportSize(viewports.desktop);
  await page.goto(path);
  await settle(page);
}
async function shot(page: Page, name: string) {
  await expect(page.getByRole('dialog').or(page.getByRole('alertdialog')).first()).toBeVisible();
  await capture(page, `${name}-desktop`, { viewportOnly: true });
}
async function fillFolder(page: Page, name: string) {
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
}
async function openDelete(page: Page, folder: string) {
  // The row actions appear on hover.
  await page.getByRole('row', { name: new RegExp(`^${folder} `) }).hover();
  await page.getByRole('button', { name: `Actions for ${folder}` }).click();
  // A mouse click on the menu's Delete does nothing in the browser; the keyboard opens the dialog.
  await page.getByRole('button', { name: `Delete ${folder}` }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel(`Type ${folder} to confirm`).fill(folder);
}

test.describe('folder dialogs', () => {
  test.beforeEach(({ api }) => {
    suitesWorld(api);
  });
  test('new-folder', async ({ page }) => {
    await open(page, capacityView);
    await fillFolder(page, 'payments');
    await shot(page, 'new-folder');
  });
  test('new-folder-name-taken', async ({ page, api }) => {
    api.on('createFolder', refusal('conflict', { fields: [{ path: '/name', code: 'conflict' }] }));
    await open(page, capacityView);
    await fillFolder(page, 'Smoke');
    await page.getByRole('button', { name: 'Create folder' }).click();
    await expect(page.getByText(/already has a folder called/)).toBeVisible();
    await shot(page, 'new-folder-name-taken');
  });
  test('new-folder-too-deep', async ({ page, api }) => {
    suitesWorld(api, { extra: chain });
    api.on('createFolder', refusal('invalid_value', { fields: [{ path: '/parentFolderId', code: 'range' }] }));
    await open(page, suites);
    await fillFolder(page, 'overflow');
    await page.getByLabel('Inside').selectOption(nsIds.deepest);
    await page.getByRole('button', { name: 'Create folder' }).click();
    await expect(page.getByRole('dialog', { name: 'Folders can’t go deeper here' })).toBeVisible();
    await shot(page, 'new-folder-too-deep');
  });
  test('delete-folder-not-empty', async ({ page, api }) => {
    api.on('deleteFolder', refusal('conflict', { reason: 'active' }));
    await open(page, suites);
    await openDelete(page, 'load-tests');
    await page.getByRole('button', { name: 'Delete load-tests', exact: true }).last().click();
    await expect(page.getByRole('alertdialog', { name: /isn't empty/ })).toBeVisible();
    await shot(page, 'delete-folder-not-empty');
  });
  test('delete-folder', async ({ page }) => {
    await open(page, suites);
    await openDelete(page, 'drafts');
    await shot(page, 'delete-folder');
  });
});
