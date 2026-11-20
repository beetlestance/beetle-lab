// Session gate screens (CASES.md section 1): shown before the app shell opens.
import type { Page } from '@playwright/test';
import { capture, expect, settle, shoot, test } from '../harness.js';
import type { Api } from '../harness.js';
import { pairingToken, openSession, refusal, switchableConnection } from '../world/session.js';

const both = ['desktop', 'phone'] as const;
const heading = (text: string) => async (page: Page) => {
  await expect(page.getByRole('heading', { level: 1, name: text })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
};

test('session-connecting', async ({ page, api }) => {
  api.on('getBrowserSession', 'pending');
  await shoot(page, '/', 'session-connecting', { viewports: both, ready: heading('Connecting to Beetle') });
});

/** Loopback address, no session cookie: the local exchange is refused too, so the pairing form shows. */
function unpaired(api: Api) {
  return api.on('getBrowserSession', refusal(401, 'unpaired')).on('openLocalBrowserSession', refusal(401, 'unpaired'));
}

test('session-signed-out', async ({ page, api }) => {
  // The "You are signed out" screen follows Sign out, so reach it from an open session.
  openSession(api);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await settle(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await heading('You are signed out')(page);
  await capture(page, 'session-signed-out-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'session-signed-out-phone');
});

test('session-pair-this-browser', async ({ page, api }) => {
  unpaired(api);
  await shoot(page, '/', 'session-pair-this-browser', { viewports: both, ready: heading('Pair this browser') });
});

test('session-pairing-failed', async ({ page, api }) => {
  unpaired(api).on('pairBrowserSession', refusal(401, 'unpaired'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await heading('Pair this browser')(page);
  await page.getByLabel('Pairing token').fill(pairingToken);
  await page.getByRole('button', { name: 'Pair', exact: true }).click();
  await heading('That token did not work')(page);
  await capture(page, 'session-pairing-failed-desktop');
});

test('session-expired', async ({ page, api }) => {
  // A signed-in read answered 401: the session ended while the app was open.
  openSession(api).on('listOrganizations', refusal(401, 'unpaired'));
  await shoot(page, '/', 'session-expired', { ready: heading('Your session ended') });
});

test('session-address-not-allowed', async ({ page, api }) => {
  api.on('getBrowserSession', refusal(403, 'forbidden'));
  await shoot(page, '/', 'session-address-not-allowed', { ready: heading('Open Beetle from its own address') });
});

test('session-cant-reach', async ({ page, api }) => {
  api.on('getBrowserSession', 'pending');
  await page.route('**/api/v2/auth/session', (route) => route.abort('connectionrefused'));
  await shoot(page, '/', 'session-cant-reach', { viewports: both, ready: heading('Beetle is not answering') });
});

test('connection-lost', async ({ page, api }) => {
  openSession(api);
  const connection = await switchableConnection(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await settle(page);
  // Leave and return with the connection cut: the cached page stays, its refresh fails.
  await page.getByRole('link', { name: 'Workspaces' }).click();
  await settle(page);
  connection.down = true;
  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByText(/^Lost connection to Beetle/)).toBeVisible();
  await capture(page, 'connection-lost-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'connection-lost-phone');
});

test('connection-lost-never-loaded', async ({ page, api }) => {
  openSession(api);
  await switchableConnection(page, true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByText(/^Lost connection to Beetle/)).toBeVisible();
  await capture(page, 'connection-lost-never-loaded-desktop');
});
