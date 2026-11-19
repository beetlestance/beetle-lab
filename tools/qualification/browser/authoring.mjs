import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
/** Exercise writes through visible controls; never seed application state directly. */
/**
 * @param {import('@playwright/test').Page} page
 * @param {string} origin
 */
export async function author(page, origin) {
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Organizations', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await page.getByLabel('Organization name', { exact: true }).fill('Browser acceptance');
  await page.getByLabel('Organization slug', { exact: true }).fill('browser-acceptance');
  await saveEditor(page);
  await page.getByRole('link', { name: 'Browser acceptance', exact: true }).click();
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await page.getByLabel('Workspace name', { exact: true }).fill('Synthetic workspace');
  await saveEditor(page);
  await page.getByRole('link', { name: 'Synthetic workspace', exact: true }).click();
  const workspace = page.url();
  await page.getByRole('link', { name: 'Suites', exact: true }).click();
  await page.getByRole('button', { name: 'New suite', exact: true }).click();
  await page.getByRole('button', { name: 'Choose k6 load tests', exact: true }).click();
  await page.getByLabel('Suite name', { exact: true }).fill('Synthetic k6 suite');
  await page.getByRole('button', { name: 'Create suite', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic k6 suite', exact: true })).toBeVisible();
  const suite = new URL(page.url()).origin + new URL(page.url()).pathname;
  const source = JSON.parse(await readFile('contracts/fixtures/api/valid/suite-revision.json', 'utf8'));
  const config = source.config;
  config.target = 'http://target:8080';
  config.secrets = [];
  config.requests = [
    {
      id: 'get',
      name: 'Owned request',
      method: 'GET',
      path: '/work',
      query: {},
      headers: {},
      assertions: [{ id: 'required', required: true, kind: 'statusEq', value: 200 }],
    },
  ];
  config.readiness = {
    path: '/ready',
    attempts: 1,
    intervalMs: 0,
    timeoutMs: 1000,
    wallBudgetMs: 1000,
    expectedStatus: 200,
    assertions: [],
  };
  await revision(page, config, 1);
  return { workspace, suite, config };
}
/**
 * @param {import('@playwright/test').Page} page
 */
export async function saveEditor(page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
}
/**
 * @param {import('@playwright/test').Page} page
 * @param {object} config
 * @param {number} ordinal
 */
export async function revision(page, config, ordinal) {
  await page.getByRole('tab', { name: 'Edit', exact: true }).click();
  await page.getByRole('radio', { name: 'Complete configuration JSON', exact: true }).click();
  await page.getByLabel('Complete configuration JSON', { exact: true }).fill(JSON.stringify(config));
  await page.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(page.getByText(`Saved as revision ${ordinal}.`, { exact: true })).toBeVisible();
  await revisionItem(page, ordinal);
}

/** @param {import('@playwright/test').Page} page @param {number} ordinal */
export async function revisionItem(page, ordinal) {
  await page.getByRole('tab', { name: /^Revisions\b/ }).click();
  const item = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: new RegExp(`^Revision ${ordinal}(?: Latest)?$`) }) });
  await expect(item).toBeVisible();
  return item;
}
