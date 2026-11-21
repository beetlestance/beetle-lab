// Settings at every level (CASES.md section 8): installation, organization, workspace, field
// states, save conflicts and the retention preview and progress of a workspace.
import type { Page } from '@playwright/test';
import { capture, expect, settle, shoot, test, viewports } from '../harness.js';
import type { ViewportName } from '../harness.js';
import { paths, settingsApi } from '../world/settings.js';
import { retentionApi, snapshotId } from '../world/settings-retention.js';

const both = ['desktop', 'phone'] as const;
const retentionField = (page: Page) => page.getByLabel('Remove finished runs older than');

async function still(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
}

async function open(page: Page, path: string, viewport: ViewportName = 'desktop') {
  await page.setViewportSize(viewports[viewport]);
  await page.goto(path);
  await settle(page);
}

test('settings', async ({ page, api }) => {
  settingsApi(api);
  for (const viewport of both) {
    await open(page, paths.installation, viewport);
    await retentionField(page).fill('90');
    await expect(page.getByText('1 unsaved change in installation.')).toBeVisible();
    await still(page);
    await capture(page, `settings-${viewport}`);
  }
});

test('settings-loading', async ({ page, api }) => {
  settingsApi(api).on('getInstallationSettings', 'pending');
  await shoot(page, paths.installation, 'settings-loading', {
    ready: async (p) => {
      await expect(p.getByText('Loading settings…').first()).toBeVisible();
    },
  });
});

test('settings-installation', async ({ page, api }) => {
  settingsApi(api);
  await shoot(page, paths.installation, 'settings-installation');
});

test('settings-installation-capacity', async ({ page, api }) => {
  settingsApi(api);
  await open(page, paths.installation);
  await page.getByRole('radio', { name: 'Shared capacity' }).click();
  await expect(page.getByText(/^Host reports 10 CPUs/)).toBeVisible();
  await capture(page, 'settings-installation-capacity-desktop');
});

test('settings-organization', async ({ page, api }) => {
  settingsApi(api);
  await shoot(page, paths.organization, 'settings-organization', { ready: async (p) => settle(p) });
});

test('settings-organization-manage', async ({ page, api }) => {
  settingsApi(api);
  await open(page, paths.organization);
  await expect(page.getByRole('heading', { name: 'Name and address' })).toBeVisible();
  await expect(page.getByText('Platform team · /platform-team')).toBeVisible();
  await capture(page, 'settings-organization-manage-desktop');
});

test('settings-workspace', async ({ page, api }) => {
  settingsApi(api);
  await open(page, paths.workspace);
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Output per run' })
    .getByRole('button', { name: 'Inherit instead' })
    .click();
  await expect(page.getByText('Will inherit, not saved yet')).toBeVisible();
  await still(page);
  await capture(page, 'settings-workspace-desktop');
});

test('settings-workspace-retention-preview', async ({ page, api }) => {
  retentionApi(settingsApi(api), 'preview');
  await shoot(page, `${paths.workspace}?retentionBatch=${snapshotId}`, 'settings-workspace-retention-preview', {
    ready: async (p) => {
      await expect(p.getByRole('heading', { name: 'Preview: 38 runs would be removed' })).toBeVisible();
      await expect(p.getByRole('list', { name: /^Settings for/ })).toHaveCount(0);
      await expect(p.getByRole('button', { name: 'Back to workspace settings' })).toBeVisible();
      await expect(p.getByRole('heading', { name: 'Never removed by this preview' })).toBeVisible();
    },
  });
});

test('settings-workspace-retention-progress', async ({ page, api }) => {
  retentionApi(settingsApi(api), 'applied');
  await shoot(page, `${paths.workspace}?retentionBatch=${snapshotId}`, 'settings-workspace-retention-progress', {
    ready: async (p) => {
      await expect(p.getByRole('heading', { name: 'Removing 38 runs' })).toBeVisible();
      await expect(p.getByRole('list', { name: /^Settings for/ })).toHaveCount(0);
      await expect(p.getByText('Run 44e7 is blocked')).toBeVisible();
    },
  });
});

test('workspace retention preview opens as a dedicated screen from Settings', async ({ page, api }) => {
  retentionApi(settingsApi(api), 'preview');
  await open(page, paths.workspace);
  await page.getByRole('button', { name: 'Manage run retention' }).click();
  await page.getByRole('button', { name: 'Preview retention' }).click();
  await expect(page).toHaveURL(new RegExp(`retentionBatch=${snapshotId}`));
  await expect(page.getByRole('heading', { name: 'Preview: 38 runs would be removed' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to workspace settings' }).click();
  await expect(page).toHaveURL(paths.workspace);
  await expect(page.getByRole('list', { name: /^Settings for/ })).toBeVisible();
});
