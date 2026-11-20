// Run result: the note editor, download menu, compare picker and the pin toast.
import { capture, expect, settle, test, viewports } from '../../harness.js';
import type { Page } from '@playwright/test';
import { buildCase, installResult, resultPath } from '../../world/results/install.js';
import type { Json } from '../../harness.js';
import { exportJob } from '../../world/suites/script.js';

async function open(page: Page, c: ReturnType<typeof buildCase>) {
  await page.setViewportSize(viewports.desktop);
  await page.goto(resultPath(c.ids.run));
  await settle(page);
}
const note = 'CDN cache was cold for the first two minutes; the p95 spike at 01:40 is that.';

test('run-result-notes', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed', note });
  installResult(api, c);
  await open(page, c);
  await page.getByRole('button', { name: 'Edit note' }).click();
  await page.getByLabel('Run note').fill(`${note} Re-run after the cache is warm.`);
  await page.getByLabel('Run note').blur();
  await capture(page, 'run-result-notes-desktop');
});

test('run-result-notes-saving', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed', note });
  installResult(api, c).on('setRunNote', 'pending');
  await open(page, c);
  await page.getByRole('button', { name: 'Edit note' }).click();
  await page.getByLabel('Run note').fill(`${note} Re-run after the cache is warm.`);
  await page.getByRole('button', { name: /^Save/ }).click();
  await page.getByText('Saving note…').waitFor();
  await capture(page, 'run-result-notes-saving-desktop');
});

test('run-result-notes-conflict', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed', note });
  const conflict = {
    code: 'conflict',
    message: 'Version or intent conflict',
    retryable: false,
    requestId: '00000000-0000-4000-8000-000000000010',
    fields: [],
  };
  let changed = false;
  installResult(api, c)
    .on('getRun', () => {
      const theirs = {
        note: 'Warm-up was 3 minutes, not 2.',
        noteVersion: 2,
        noteUpdatedAt: '2026-11-07T23:35:00.000Z',
      };
      return { ...c.run, ...(changed ? theirs : {}) } as Json;
    })
    .on('setRunNote', () => {
      changed = true;
      return { status: 409, body: conflict as Json };
    });
  await open(page, c);
  await page.getByRole('button', { name: 'Edit note' }).click();
  await page.getByLabel('Run note').fill(`${note} Re-run after the cache is warm.`);
  await page.getByRole('button', { name: /^Save/ }).click();
  await page
    .getByText(/edited in another tab|Changed elsewhere/i)
    .first()
    .waitFor();
  await capture(page, 'run-result-notes-conflict-desktop');
});

test('run-result-download-open', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed' });
  installResult(api, c);
  await open(page, c);
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page.getByRole('group', { name: 'Run downloads' }).getByText('Report', { exact: true }).waitFor();
  await capture(page, 'run-result-download-open-desktop', { viewportOnly: true });
});

test('run-result-compare-picker', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed' });
  installResult(api, c);
  await open(page, c);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await page.getByText('Previous').first().waitFor();
  await capture(page, 'run-result-compare-picker-desktop', { viewportOnly: true });
});

test('run-result-toast', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed' });
  let pinned = false;
  installResult(api, c)
    .on(
      'getRun',
      () => ({ ...c.run, ...(pinned ? { pinned: true, pinnedAt: '2026-11-07T23:39:00.000Z' } : {}) }) as Json,
    )
    .on('pinRun', (call) => {
      pinned = true;
      return {
        id: c.ids.run,
        scope: c.run.scope as Json,
        requestId: (call.body as { requestId: string }).requestId,
        pinned: true,
        pinnedAt: '2026-11-07T23:39:00.000Z',
      };
    });
  await open(page, c);
  await page.getByRole('button', { name: 'Pin this run' }).click();
  await page.getByText(/is pinned. Retention will not remove it/).waitFor();
  await capture(page, 'run-result-toast-desktop');
});

test('run-result-failed-run-again', async ({ page, api }) => {
  const c = buildCase({ variant: 'failed' });
  installResult(api, c).on('createRun', 'pending');
  await open(page, c);
  await page.getByRole('button', { name: 'Run again' }).click();
  await page.getByText('Starting…').first().waitFor();
  await capture(page, 'run-result-failed-run-again-desktop', { viewportOnly: true });
});

test('export-run-preparing', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed' });
  const job = {
    ...exportJob(4, 'generating'),
    scope: c.run.scope as Json,
    suiteId: c.ids.suite,
    revisionId: (c.run as { revisionId: string }).revisionId,
  };
  installResult(api, c)
    .on('createRunExport', { status: 202, body: { ...job, state: 'queued' } })
    .on('getExport', job);
  await open(page, c);
  await page.getByRole('button', { name: 'Export script…' }).click();
  await page.getByRole('dialog').waitFor();
  await page
    .getByRole('dialog')
    .locator('li', { hasText: 'Writing the script' })
    .filter({ hasText: 'in progress' })
    .waitFor();
  await expect(page.getByRole('dialog').getByText(/unreadable|failed/i)).toHaveCount(0);
  await capture(page, 'export-run-preparing-desktop', { viewportOnly: true });
});
