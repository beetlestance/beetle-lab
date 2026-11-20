// Save revision panel (ready and errors) and the save conflict overlay.
import type { Page } from '@playwright/test';
import { capture, expect, test } from '../../harness.js';
import type { Api, Json } from '../../harness.js';
import { steadyRevisions } from '../../world/suites/data.js';
import { base, steady, uuid } from '../../world/suites/ids.js';
import type { SuitesOptions } from '../../world/suites/wire.js';
import { safeError, suitesWorld } from '../../world/suites/wire.js';
import { steadySuite } from '../../world/suites/data.js';

const edit = `${base}/suites/${steady.id}?tab=edit`;

async function openEditor(page: Page, api: Api, options: SuitesOptions = {}) {
  suitesWorld(api, options);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(edit);
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('steady-1.2k');
  await expect(page.getByRole('combobox', { name: 'Request 1 Body from input' })).toContainText('cart-item.json');
  await page.waitForLoadState('networkidle');
}

test('edit: save revision panel with a message', async ({ page, api }) => {
  await openEditor(page, api);
  await page.getByRole('textbox', { name: 'Peak requests a second' }).fill('1400');
  await page.getByRole('textbox', { name: 'What changed' }).fill('Raise rate to 1,400/s for the sale');
  await expect(page.getByRole('button', { name: 'Save revision' })).toBeEnabled();
  await capture(page, 'save-revision-desktop');
});

test('edit: save revision panel with errors', async ({ page, api }) => {
  await openEditor(page, api, { deletedInputs: ['users.csv'] });
  await page.getByRole('textbox', { name: 'Request 4 Path' }).fill('checkout');
  await page.getByRole('textbox', { name: /Threshold 4 value/ }).fill('');
  await expect(page.getByRole('heading', { name: /^Fix \d things? to save/ })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await capture(page, 'save-revision-errors-desktop');
});

test('edit: save conflict overlay', async ({ page, api }) => {
  const rev4 = steadyRevisions()[3]!;
  const newest = {
    ...rev4,
    id: uuid(3, 5),
    ordinal: 5,
    savedAt: '2026-11-07T23:31:00.000Z',
    message: 'Raised the rate',
    runCount: 0,
  };
  let conflicted = false;
  await openEditor(page, api);
  api
    .on('createSuiteRevision', () => {
      conflicted = true;
      return safeError('conflict', 'The suite changed.', 409);
    })
    .on(
      'getSuite',
      () => (conflicted ? { ...steadySuite, version: 5, currentRevisionId: newest.id } : steadySuite) as Json,
    )
    .on('getSuiteRevision', (call) => {
      if (call.params.revisionId === newest.id) return newest as Json;
      return (
        (steadyRevisions().find((item) => item.id === call.params.revisionId) as Json) ??
        safeError('not_found', 'Not found', 404)
      );
    });
  await page.getByRole('textbox', { name: 'Peak requests a second' }).fill('1400');
  await page.getByRole('button', { name: 'Save revision' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Revision 5 was saved while you were editing')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save as revision 6' })).toBeEnabled();
  await capture(page, 'save-conflict-desktop', { viewportOnly: true });
});
