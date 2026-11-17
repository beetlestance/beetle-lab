import { expect } from '@playwright/test';
import { saveEditor } from './authoring.mjs';
/** Switch through visible controls, then ask the real server for mismatched scoped IDs. */
/** @param {import('@playwright/test').Page} page @param {{workspace: string, suite: string}} authored */
export async function crossScope(page, authored) {
  const first = new URL(authored.suite);
  const originalOrganization = first.pathname.split('/')[2];
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Organizations' }).click();
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await page.getByLabel('Organization name', { exact: true }).fill('Other browser scope');
  await page.getByLabel('Organization slug', { exact: true }).fill('other-browser-scope');
  await saveEditor(page);
  await page.getByRole('link', { name: 'Other browser scope', exact: true }).click();
  const secondOrganization = new URL(page.url()).pathname.split('/')[2];
  expect(secondOrganization).not.toBe(originalOrganization);
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill('Other workspace');
  await saveEditor(page);
  await page.getByRole('link', { name: 'Other workspace', exact: true }).click();
  const secondWorkspace = page.url();
  await page.getByRole('link', { name: 'Suites', exact: true }).click();
  await expect(page.getByText('No suites yet.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Synthetic k6 suite', exact: true })).toHaveCount(0);
  const foreign = new URL(authored.suite);
  foreign.pathname = foreign.pathname.replace(
    '/organizations/' + originalOrganization + '/',
    '/organizations/' + secondOrganization + '/',
  );
  const refusal = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v2/organizations/' + secondOrganization + '/workspaces/') &&
      response.status() === 404,
  );
  await page.goto(foreign.href);
  await refusal;
  await expect(page.getByRole('alert')).toContainText('Resource not found');
  await expect(page.getByRole('heading', { name: 'Synthetic k6 suite', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save new revision', exact: true })).toHaveCount(0);
  await page.goto(authored.suite);
  await expect(page.getByRole('heading', { name: 'Synthetic k6 suite', exact: true })).toBeVisible();
  await page.goto(secondWorkspace);
  await page.getByRole('link', { name: 'Suites', exact: true }).click();
  await expect(page.getByText('No suites yet.', { exact: true })).toBeVisible();
}
