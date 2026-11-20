// Inputs inventory, inline detail, delete refusal, and the Exports tab.
import { capture, expect, shoot, test } from '../../harness.js';
import { base, detail, exportsPage, inventory, protectedDependency, usersCsv } from '../../world/inputs.js';

test('inputs: inventory with a stopped upload', async ({ page, api }) => {
  inventory(api);
  await shoot(page, `${base}/inputs`, 'inputs', {
    viewports: ['desktop', 'phone'],
    ready: async (p) => {
      await expect(p.getByRole('table', { name: 'Workspace inputs' })).toBeVisible();
      await expect(p.getByText('users.csv')).toBeVisible();
      await expect(p.getByRole('alert')).toHaveCount(0);
    },
  });
});

test('inputs: empty', async ({ page, api }) => {
  inventory(api, []);
  await shoot(page, `${base}/inputs`, 'inputs-empty');
});

async function openDetail(page: Parameters<typeof shoot>[0]) {
  await page.goto(`${base}/inputs`);
  await expect(page.getByText('users.csv')).toBeVisible();
  await page.getByRole('button', { name: 'Read current status for users.csv' }).click();
  await expect(page).toHaveURL(new RegExp(`/inputs/${String(usersCsv.id)}$`));
  await expect(page.getByRole('heading', { name: 'users.csv', level: 1 })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Workspace inputs' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Used by' }).getByText('soak-27m')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test('inputs: detail with usage', async ({ page, api }) => {
  detail(inventory(api), usersCsv);
  await openDetail(page);
  await capture(page, 'inputs-detail-desktop');
  await page.goBack();
  await expect(page.getByRole('table', { name: 'Workspace inputs' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'users.csv', level: 1 })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('inputs: delete refused while in use', async ({ page, api }) => {
  detail(inventory(api), usersCsv).on('deleteInput', protectedDependency());
  await openDetail(page);
  await page.getByRole('button', { name: 'Delete input' }).click();
  await page.getByRole('button', { name: 'Confirm deletion' }).click();
  const refusal = page.getByRole('alertdialog');
  await expect(refusal).toContainText('is used by saved revisions');
  await expect(refusal.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(refusal.getByRole('button', { name: 'Replay identical deletion' })).toHaveCount(0);
  await capture(page, 'delete-input-in-use-desktop', { viewportOnly: true });
});

test('exports: mixed states', async ({ page, api }) => {
  exportsPage(api);
  await shoot(page, `${base}/exports`, 'exports', {
    viewports: ['desktop', 'phone'],
    ready: async (p) => {
      await expect(p.getByRole('table', { name: 'Script exports' })).toBeVisible();
      await expect(p.getByText('Ready', { exact: true }).first()).toBeVisible();
      await expect(p.getByRole('alert')).toHaveCount(0);
    },
  });
});

test('exports: empty', async ({ page, api }) => {
  exportsPage(api, []);
  await shoot(page, `${base}/exports`, 'exports-empty');
});
