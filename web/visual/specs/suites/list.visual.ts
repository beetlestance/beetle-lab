// Suites list, folder views, new-suite entry points, the engine picker and the sample-file dialog.
import { capture, expect, shoot, test } from '../../harness.js';
import { base, folderIds, scope } from '../../world/suites/ids.js';
import { suitesWorld } from '../../world/suites/wire.js';
import { fixture } from '../../world/index.js';

const suites = `${base}/suites`;
const folder = (id: string) => `${suites}?folder=${id}`;

test('suites: folders with counts and latest runs', async ({ page, api }) => {
  suitesWorld(api);
  await shoot(page, suites, 'suites', { viewports: ['desktop', 'phone'] });
});

test('suites: empty workspace', async ({ page, api }) => {
  suitesWorld(api, { empty: true });
  await shoot(page, suites, 'suites-empty');
});

test('suites: loading', async ({ page, api }) => {
  suitesWorld(api).on('listFolders', 'pending');
  await shoot(page, suites, 'suites-loading', {
    ready: async (p) => expect(p.getByText('Loading suites…')).toBeAttached(),
  });
});

test('suites: inside a folder', async ({ page, api }) => {
  suitesWorld(api);
  await shoot(page, folder(folderIds.capacity), 'suites-folder', {
    ready: async (p) => {
      await expect(p.getByRole('link', { name: 'guest-checkout-1k' })).toBeVisible();
      await expect(p.getByText('Reading…')).toHaveCount(0);
      await p.waitForLoadState('networkidle');
    },
  });
});

test('suites: empty folder', async ({ page, api }) => {
  suitesWorld(api, { withEmptyFolder: true });
  await shoot(page, folder(folderIds.datasets), 'suites-folder-empty');
});

test('suites: folder filter with no match', async ({ page, api }) => {
  suitesWorld(api);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(folder(folderIds.capacity));
  await expect(page.getByRole('link', { name: 'guest-checkout-1k' })).toBeVisible();
  await page.getByRole('searchbox').fill('spike-9');
  await expect(page.getByText(/No suites in capacity match/)).toBeVisible();
  await capture(page, 'suites-folder-no-match-desktop');
});

for (const view of ['form', 'json'] as const) {
  test(`suites: new suite dialog (${view})`, async ({ page, api }) => {
    suitesWorld(api);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${suites}?new=${view}`);
    await expect(page.getByRole('dialog', { name: 'What should this suite run?' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'capacity', exact: true })).toBeVisible();
    await capture(page, view === 'form' ? 'suites-new-suite-desktop' : 'suites-new-suite-json-desktop', {
      viewportOnly: true,
    });
  });
}

test('suites: engine picker', async ({ page, api }) => {
  suitesWorld(api);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(suites);
  await page.getByRole('button', { name: 'New suite' }).click();
  await expect(page.getByRole('dialog', { name: 'What should this suite run?' })).toBeVisible();
  await capture(page, 'engine-picker-desktop', { viewportOnly: true });
});

const listed = (...names: string[]) => ({
  scope,
  items: names.map((name, index) => ({
    ...fixture('input'),
    id: `00000000-0000-4000-8000-0000000041${index}0`,
    scope,
    name,
    folderId: folderIds.root,
    state: 'published',
    offset: 12,
  })),
  nextCursor: null,
});
async function openSampleDialog(page: Parameters<typeof shoot>[0]) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/inputs`);
  await expect(page.getByText('cart-item.json').first()).toBeVisible();
  await page.getByRole('button', { name: 'Add a sample file' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Add a sample file' })).toBeVisible();
}

test('suites: add a sample file', async ({ page, api }) => {
  suitesWorld(api).on('listInputs', listed('cart-item.json', 'checkout.json'));
  await openSampleDialog(page);
  await capture(page, 'add-sample-file-desktop', { viewportOnly: true });
});

test('suites: add a sample file, name taken', async ({ page, api }) => {
  suitesWorld(api).on('listInputs', listed('users.csv', 'cart-item.json'));
  await openSampleDialog(page);
  await expect(page.getByText('An input named users.csv already exists')).toBeVisible();
  await capture(page, 'add-sample-file-name-taken-desktop', { viewportOnly: true });
});
