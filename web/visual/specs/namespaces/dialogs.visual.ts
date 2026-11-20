// Section 3: dialogs for organizations and workspaces. Each is captured with the page it was opened from behind it.
import type { Page } from '@playwright/test';
import { capture, expect, settle, test, viewports } from '../../harness.js';
import type { Api } from '../../harness.js';
import { acmeWorld, checkout, nsIds, refusal, settingsWorld } from '../../world/namespaces.js';

const org = nsIds.organization;
const list = `/organizations/${org}/workspaces`;
const workspaceSettings = `/organizations/${org}/workspaces/${nsIds.checkout}/settings`;
const organizationSettings = `/organizations/${org}/settings`;
const conflict = (path: string) => refusal('conflict', { fields: [{ path, code: 'conflict' }] });

async function open(page: Page, path: string, size: keyof typeof viewports = 'desktop') {
  await page.setViewportSize(viewports[size]);
  await page.goto(path);
  await settle(page);
}
async function shot(page: Page, name: string, size: keyof typeof viewports = 'desktop') {
  await expect(page.getByRole('dialog').or(page.getByRole('alertdialog')).first()).toBeVisible();
  await capture(page, `${name}-${size}`, { viewportOnly: true });
}
async function openCreateOrganization(page: Page) {
  await page.getByRole('button', { name: 'acme, switch organization' }).click();
  await page.getByRole('button', { name: 'Create organization' }).click();
  await page.getByLabel('Organization name').fill('Platform team');
  await page.getByLabel('Organization slug').fill('platform-team');
}

test.describe('organization dialogs', () => {
  test.beforeEach(({ api }) => {
    acmeWorld(api);
  });
  for (const size of ['desktop', 'phone'] as const) {
    test(`new-organization ${size}`, async ({ page }) => {
      await open(page, `/organizations/${org}`, size);
      await openCreateOrganization(page);
      await shot(page, 'new-organization', size);
    });
  }
  test('new-organization-address-taken', async ({ page, api }) => {
    api.on('createOrganization', conflict('/slug'));
    await open(page, `/organizations/${org}`);
    await openCreateOrganization(page);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await shot(page, 'new-organization-address-taken');
  });
});

async function confirmRetire(page: Page, button: string, name: string) {
  await page.getByRole('button', { name: button }).click();
  await page.getByLabel(`Type ${name} to confirm`).fill(name);
}
function settingsApi(api: Api) {
  settingsWorld(acmeWorld(api));
}

test.describe('retire dialogs', () => {
  test('retire-workspace', async ({ page, api }) => {
    settingsApi(api);
    await open(page, workspaceSettings);
    await confirmRetire(page, 'Retire workspace…', 'checkout-team');
    await shot(page, 'retire-workspace');
  });
  test('retire-workspace-refused', async ({ page, api }) => {
    settingsApi(api);
    api.on('deleteWorkspace', refusal('conflict', { reason: 'active' }));
    await open(page, workspaceSettings);
    await confirmRetire(page, 'Retire workspace…', 'checkout-team');
    await page.getByRole('button', { name: 'Retire workspace', exact: true }).click();
    await expect(page.getByRole('alertdialog', { name: /can’t be retired yet/ })).toBeVisible();
    await shot(page, 'retire-workspace-refused');
  });
  test('phone-retire-workspace', async ({ page, api }) => {
    settingsApi(api);
    await open(page, workspaceSettings, 'phone');
    await confirmRetire(page, 'Retire workspace…', 'checkout-team');
    await shot(page, 'phone-retire-workspace', 'phone');
  });
  test('retire-organization', async ({ page, api }) => {
    settingsApi(api);
    await open(page, organizationSettings);
    await confirmRetire(page, 'Retire organization…', 'acme');
    await shot(page, 'retire-organization');
  });
  test('retire-organization-refused', async ({ page, api }) => {
    settingsApi(api);
    api.on('deleteOrganization', refusal('conflict', { reason: 'active' }));
    await open(page, organizationSettings);
    await confirmRetire(page, 'Retire organization…', 'acme');
    await page.getByRole('button', { name: 'Retire organization', exact: true }).click();
    await expect(page.getByRole('alertdialog', { name: /still has active workspaces/ })).toBeVisible();
    await shot(page, 'retire-organization-refused');
  });
});

test.describe('workspace list dialogs', () => {
  test.beforeEach(({ api }) => {
    acmeWorld(api);
  });
  test('new-workspace', async ({ page }) => {
    await open(page, list);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await page.getByLabel('Workspace name').fill('payments-team');
    await shot(page, 'new-workspace');
  });
  test('new-workspace-name-taken', async ({ page, api }) => {
    api.on('createWorkspace', conflict('/name'));
    await open(page, list);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await page.getByLabel('Workspace name').fill('search');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await shot(page, 'new-workspace-name-taken');
  });
  for (const size of ['desktop', 'phone'] as const) {
    test(`${size === 'phone' ? 'phone-rename' : 'rename'}`, async ({ page }) => {
      await open(page, list, size);
      await page.getByRole('button', { name: `Rename ${checkout.name}` }).click();
      await page.getByLabel('Workspace name').fill('checkout-spike');
      await shot(page, size === 'phone' ? 'phone-rename' : 'rename', size);
    });
  }
  test('rename-changed-elsewhere', async ({ page, api }) => {
    api.on('patchWorkspace', refusal('conflict'));
    await open(page, list);
    await page.getByRole('button', { name: `Rename ${checkout.name}` }).click();
    await page.getByLabel('Workspace name').fill('checkout-spike');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
    await shot(page, 'rename-changed-elsewhere');
  });
  test('delete-workspace', async ({ page }) => {
    await open(page, list);
    await page.getByRole('button', { name: `Delete ${checkout.name}` }).click();
    await page.getByLabel(`Type ${checkout.name} to confirm`).fill(checkout.name);
    await shot(page, 'delete-workspace');
  });
  test('delete-workspace-blocked', async ({ page, api }) => {
    api.on('deleteWorkspace', refusal('conflict', { reason: 'active' }));
    await open(page, list);
    await page.getByRole('button', { name: `Delete ${checkout.name}` }).click();
    await page.getByLabel(`Type ${checkout.name} to confirm`).fill(checkout.name);
    await page
      .getByRole('button', { name: `Delete ${checkout.name}`, exact: true })
      .last()
      .click();
    await expect(page.getByRole('alertdialog', { name: /can't be deleted yet/ })).toBeVisible();
    await shot(page, 'delete-workspace-blocked');
  });
});
