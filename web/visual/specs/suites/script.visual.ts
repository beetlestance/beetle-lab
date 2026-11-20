// Script page (and its Changes views), the Export script overlays, and the not-found states.
import type { Page } from '@playwright/test';
import { capture, expect, shoot, test } from '../../harness.js';
import type { Api } from '../../harness.js';
import { base, runIds, steady, uuid } from '../../world/suites/ids.js';
import { scriptWorld } from '../../world/suites/script.js';
import type { ExportStates } from '../../world/suites/script.js';
import { suitesWorld } from '../../world/suites/wire.js';

const script = (ordinal: number) => `${base}/suites/${steady.id}/revisions/${steady.revisions[ordinal - 1]}/script`;
const withRun = (ordinal: number) => `${script(ordinal)}?run=${runIds.origin}`;

function world(api: Api, states?: ExportStates, secrets = false) {
  suitesWorld(api, secrets ? { revision4: { secrets: ['api_token'] } } : {});
  return scriptWorld(api, states);
}
const ready = async (page: Page) => {
  await expect(page.getByRole('heading', { name: /^Script for revision/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
};

test('script: revision 1', async ({ page, api }) => {
  world(api);
  await shoot(page, withRun(1), 'script', {
    ready: async (p) => {
      await ready(p);
      await expect(p.getByText('Exported from Beetle Lab').first()).toBeVisible();
    },
  });
});

test('script: changes, side by side and one column', async ({ page, api }) => {
  world(api);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(withRun(1));
  await ready(page);
  await page.getByRole('tab', { name: /^Changes/ }).click();
  await expect(page.getByText(/lines? added/)).toBeVisible();
  await capture(page, 'script-changes-desktop');
  await page.getByRole('radio', { name: 'One column' }).click();
  await expect(page.getByRole('radio', { name: 'One column' })).toBeChecked();
  await capture(page, 'script-changes-one-column-desktop');
});

const overlays: [string, ExportStates, boolean, string][] = [
  ['preparing', { 4: 'generating' }, false, 'Preparing a k6 script from revision 4'],
  ['ready', { 4: 'ready' }, false, 'is ready as a k6 script'],
  ['unknown', { 4: 'unknown' }, false, 'We can’t tell whether this export finished'],
  ['uses-secrets', { 4: 'none' }, true, 'This revision can’t be exported'],
];
for (const [name, states, secrets, title] of overlays) {
  test(`script: export overlay ${name}`, async ({ page, api }) => {
    world(api, states, secrets);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(script(4));
    await expect(page.getByRole('heading', { name: 'Script for revision 4' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Export script' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: new RegExp(title) })).toBeVisible();
    await capture(page, `export-script-${name}-desktop`, { viewportOnly: true });
  });
}

test('script: suite not found', async ({ page, api }) => {
  world(api);
  await shoot(page, `${base}/suites/${uuid(2, 999)}`, 'not-found-suite', {
    ready: async (p) => expect(p.getByText("That suite isn't here")).toBeVisible(),
  });
});

test('script: script not found', async ({ page, api }) => {
  world(api);
  await shoot(page, `${base}/suites/${steady.id}/revisions/${uuid(3, 999)}/script`, 'not-found-script', {
    ready: async (p) => expect(p.getByText("That script isn't here")).toBeVisible(),
  });
});
