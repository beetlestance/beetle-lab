// Settings states reached by editing and saving (CASES.md sections 1 and 8): field states,
// save refusals, the save conflict, and the upgrade views and pause.
import type { Page } from '@playwright/test';
import { capture, expect, settle, shoot, test, viewports } from '../harness.js';
import { refusal } from '../world/session.js';
import { paths, settingsApi, upgradeStatus, workspaceSettings } from '../world/settings.js';

async function openWorkspace(page: Page) {
  await page.setViewportSize(viewports.desktop);
  await page.goto(paths.workspace);
  await settle(page);
}
/** Drops focus (a focused skip link would show) and returns to the top before a screenshot. */
async function still(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
}
const field = (page: Page, label: string) => page.getByRole('textbox', { name: label });
const save = (page: Page) => page.getByRole('button', { name: 'Save Checkout' });

/** Edits the rows into the four states of the "Field states" board. */
async function editFields(page: Page, timeout: string) {
  await field(page, 'Longest run allowed').fill(timeout);
  await field(page, 'Memory per run').fill('6');
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Output per run' })
    .getByRole('button', { name: 'Inherit instead' })
    .click();
}

test('settings-field-states', async ({ page, api }) => {
  settingsApi(api);
  await openWorkspace(page);
  await editFields(page, '300');
  await expect(page.getByText('Not saved: fix this value first')).toBeVisible();
  await still(page);
  await capture(page, 'settings-field-states-desktop');
});

test('settings-field-states-couldnt-save', async ({ page, api }) => {
  settingsApi(api).on(
    'patchWorkspaceSettings',
    refusal(422, 'invalid_value', { fields: [{ path: '/patch/runDefaults/budget/timeoutMs', code: 'range' }] }),
  );
  await openWorkspace(page);
  await editFields(page, '100');
  await save(page).click();
  await expect(page.getByText('Couldn’t save. Nothing was changed.')).toBeVisible();
  await still(page);
  await capture(page, 'settings-field-states-couldnt-save-desktop');
});

test('settings-field-states-saved', async ({ page, api }) => {
  settingsApi(api)
    .on('getWorkspaceSettings', (call) => workspaceSettings({ version: call.index === 0 ? 1 : 2 }))
    .on('patchWorkspaceSettings', workspaceSettings({ version: 2 }));
  await openWorkspace(page);
  await editFields(page, '100');
  await save(page).click();
  await expect(page.getByText(/^Saved\. New runs in Checkout/)).toBeVisible();
  await still(page);
  await capture(page, 'settings-field-states-saved-desktop');
});

test('settings-changed-elsewhere', async ({ page, api }) => {
  settingsApi(api).on('patchWorkspaceSettings', refusal(409, 'conflict'));
  await openWorkspace(page);
  await field(page, 'Longest run allowed').fill('45');
  await save(page).click();
  await expect(page.getByRole('alertdialog', { name: 'Settings changed since you opened them' })).toBeVisible();
  await still(page);
  await capture(page, 'settings-changed-elsewhere-desktop', { viewportOnly: true });
});

test('upgrade-settings-open', async ({ page, api }) => {
  settingsApi(api).on('getUpgradeStatus', upgradeStatus('open'));
  await shoot(page, paths.upgrade, 'upgrade-settings-open');
});

test('upgrade-settings-fenced', async ({ page, api }) => {
  settingsApi(api).on('getUpgradeStatus', upgradeStatus('fenced'));
  await shoot(page, paths.upgrade, 'upgrade-settings-fenced');
});

// The contract has only open and fenced; "draining" is shown as open with unfinished work.
test('upgrade-settings-draining', async ({ page, api }) => {
  settingsApi(api).on('getUpgradeStatus', upgradeStatus('draining'));
  await shoot(page, paths.upgrade, 'upgrade-settings-draining');
});

test('upgrade-paused', async ({ page, api }) => {
  settingsApi(api).on('patchInstallationSettings', refusal(503, 'upgrade_pending'));
  await page.setViewportSize(viewports.desktop);
  await page.goto(paths.installation);
  await settle(page);
  await field(page, 'Administrator name').fill('Meera K');
  await page.getByRole('button', { name: 'Save installation' }).click();
  await expect(page.getByText('Beetle is paused for an upgrade').first()).toBeVisible();
  await still(page);
  await capture(page, 'upgrade-paused-desktop');
});
