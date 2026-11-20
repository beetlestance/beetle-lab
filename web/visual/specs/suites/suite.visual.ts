// Suite page: overview, revisions, the three editor views, and the Start run dialog.
import { capture, expect, shoot, test } from '../../harness.js';
import type { Page } from '@playwright/test';
import { base, steady } from '../../world/suites/ids.js';
import { suitesWorld } from '../../world/suites/wire.js';

const suite = `${base}/suites/${steady.id}`;

/** The suite page has finished reading when the header, the tab count and every panel read are in. */
const ready = async (page: Page) => {
  await expect(page.getByRole('heading', { name: 'steady-1.2k', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Revisions (4)' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/^(Reading|Loading|Preparing)/)).toHaveCount(0);
};

test('suite: overview', async ({ page, api }) => {
  suitesWorld(api);
  await shoot(page, suite, 'suite-overview', { viewports: ['desktop', 'phone'], ready });
});

test('suite: revisions', async ({ page, api }) => {
  suitesWorld(api);
  await shoot(page, `${suite}?tab=revisions`, 'suite-revisions', {
    ready: async (p) => {
      await ready(p);
      await expect(p.getByRole('list', { name: 'Changes in revision 4' })).toBeVisible();
      await expect(p.getByRole('list', { name: 'Changes in revision 2' })).toBeVisible();
    },
  });
});

test('suite: edit, form view', async ({ page, api }) => {
  suitesWorld(api);
  await shoot(page, `${suite}?tab=edit`, 'suite-edit', {
    viewports: ['desktop', 'tablet'],
    ready: async (p) => {
      await expect(p.getByRole('textbox', { name: 'Name' })).toHaveValue('steady-1.2k');
      await expect(p.getByRole('combobox', { name: 'Request 1 Body from input' })).toContainText('cart-item.json');
      await p.waitForLoadState('networkidle');
    },
  });
});

test('suite: edit, one request open', async ({ page, api }) => {
  suitesWorld(api);
  await shoot(page, `${suite}?tab=edit&request=checkout`, 'suite-edit-request', {
    ready: async (p) => {
      await expect(p.getByRole('heading', { name: 'Request: POST /checkout' })).toBeVisible();
      await p.waitForLoadState('networkidle');
    },
  });
});

test('suite: edit, run setup', async ({ page, api }) => {
  suitesWorld(api);
  await shoot(page, `${suite}?tab=edit&view=run-setup`, 'suite-edit-run-setup', {
    ready: async (p) => {
      await expect(p.getByRole('textbox', { name: 'Probe path' })).toBeVisible();
      await p.waitForLoadState('networkidle');
    },
  });
});

test('suite: edit, JSON view', async ({ page, api }) => {
  suitesWorld(api);
  await shoot(page, `${suite}?tab=edit&view=json`, 'suite-edit-json', {
    ready: async (p) => {
      await expect(p.getByRole('textbox', { name: 'Complete configuration JSON' })).toBeVisible();
      await p.waitForLoadState('networkidle');
    },
  });
});

test('suite: start run', async ({ page, api }) => {
  suitesWorld(api);
  await shoot(page, `${suite}?start=1`, 'suite-start-run', {
    viewports: ['desktop', 'phone'],
    ready: async (p) => {
      const dialog = p.getByRole('dialog', { name: 'Start steady-1.2k' });
      await expect(dialog.getByText(/Within the 30-minute limit/)).toBeVisible();
      await p.waitForLoadState('networkidle');
    },
  });
});

test('suite: start run with the budget changed', async ({ page, api }) => {
  suitesWorld(api);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${suite}?start=1`);
  const dialog = page.getByRole('dialog', { name: 'Start steady-1.2k' });
  await dialog.getByRole('button', { name: 'Change for this run' }).click();
  await dialog.getByRole('textbox', { name: 'Memory, up to 8 GiB' }).fill('6');
  await expect(dialog.getByRole('textbox', { name: 'Memory, up to 8 GiB' })).toHaveValue('6');
  await page.waitForLoadState('networkidle');
  await capture(page, 'suite-start-run-budget-desktop');
});
