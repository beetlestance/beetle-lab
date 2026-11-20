// CASES.md section 2: shell navigation, scope menu, search overlay, engines, not-found, reference.
import type { Page } from '@playwright/test';
import { capture, expect, settle, shoot, test, viewports } from '../../harness.js';
import type { Api } from '../../harness.js';
import { fixture, ids, signedIn } from '../../world/index.js';
import {
  enginesStatus,
  engineCatalogue,
  notFound,
  organizationList,
  organizationWorld,
  organizationsHandler,
  workspaceUrl,
  workspaceWorld,
} from '../../world/overview/index.js';

const orgUrl = `/organizations/${ids.organization}`;
const orgReady = async (p: Page) => {
  await expect(p.getByRole('link', { name: 'Payments' })).toBeVisible();
  await expect(p.getByText(/in the last 24 hours/)).toBeVisible();
};
const dashboardReady = async (p: Page) => {
  await expect(p.getByText('requests a second')).toBeVisible();
  await expect(p.getByText('241 ms')).toBeVisible();
  await expect(p.getByText(/of 8 CPUs/)).toBeVisible();
};

async function openMenu(page: Page, api: Api, count: number): Promise<void> {
  organizationWorld(api);
  api.on('listOrganizations', organizationsHandler(organizationList(count)));
  await page.setViewportSize(viewports.desktop);
  await page.goto(orgUrl);
  await settle(page, orgReady);
  await page.getByRole('button', { name: /switch organization/ }).click();
  await expect(page.getByRole('navigation', { name: 'Switch organization' }).getByRole('link').first()).toBeVisible();
}

test('scope-menu: two organizations', async ({ page, api }) => {
  await openMenu(page, api, 2);
  await capture(page, 'scope-menu-desktop', { viewportOnly: true });
});

test('scope-menu-many: more than 20 organizations', async ({ page, api }) => {
  await openMenu(page, api, 26);
  await expect(page.getByRole('button', { name: 'Show more' })).toBeVisible();
  await capture(page, 'scope-menu-many-desktop', { viewportOnly: true });
  await page.getByRole('button', { name: 'Show more' }).click();
  await expect(page.getByRole('link', { name: 'Team 26' })).toBeVisible();
  await capture(page, 'scope-menu-many-more-desktop', { viewportOnly: true });
});

test('phone-menu-open: phone navigation menu', async ({ page, api }) => {
  workspaceWorld(api);
  await page.setViewportSize(viewports.phone);
  await page.goto(workspaceUrl);
  await settle(page, dashboardReady);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await capture(page, 'phone-menu-open-phone', { viewportOnly: true });
});

async function openSearch(page: Page, api: Api, viewport: 'desktop' | 'phone', query: string): Promise<void> {
  workspaceWorld(api);
  await page.setViewportSize(viewports[viewport]);
  await page.goto(workspaceUrl);
  await settle(page, dashboardReady);
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('searchbox', { name: 'Search commands and recent items' });
  await expect(input).toBeVisible();
  if (query) await input.fill(query);
}

test('search-overlay: results for a query', async ({ page, api }) => {
  for (const viewport of ['desktop', 'phone'] as const) {
    await openSearch(page, api, viewport, 'steady');
    await expect(page.getByText('Start steady-1.2k')).toBeVisible();
    await expect(page.getByText('Run a7f2, steady-1.2k')).toBeVisible();
    await capture(page, `search-overlay-${viewport}`, { viewportOnly: true });
  }
});

test('search-overlay-empty: no query', async ({ page, api }) => {
  await openSearch(page, api, 'desktop', '');
  await expect(page.getByText('Run a7f2, steady-1.2k')).toBeVisible();
  await capture(page, 'search-overlay-empty-desktop', { viewportOnly: true });
});

test('search-overlay-no-match: query with no result', async ({ page, api }) => {
  await openSearch(page, api, 'desktop', 'zzzz');
  await expect(page.getByText('No matching commands or loaded items.')).toBeVisible();
  await capture(page, 'search-overlay-no-match-desktop', { viewportOnly: true });
});

function enginesWorld(api: Api, stale: boolean): void {
  signedIn(api)
    .on('getInstallationSettings', fixture('installation-settings'))
    .on('getInstallationStatus', enginesStatus(stale))
    .on('listEngines', engineCatalogue());
}

test('engines: engine catalogue', async ({ page, api }) => {
  enginesWorld(api, false);
  await shoot(page, '/engines', 'engines', {
    viewports: ['desktop', 'phone'],
    ready: async (p) => {
      await expect(p.getByText('Mutation testing')).toBeVisible();
      await expect(p.getByText(/image verified when the agent started/)).toBeVisible();
    },
  });
});

test('engines-unavailable: runner agent not reporting', async ({ page, api }) => {
  enginesWorld(api, true);
  await shoot(page, '/engines', 'engines-unavailable', {
    ready: async (p) => {
      await expect(p.getByText(/hasn't heard from the runner agent for 4 min/)).toBeVisible();
      await expect(p.getByText('Mutation testing')).toBeVisible();
    },
  });
});

test('not-found-organization: unknown organization id', async ({ page, api }) => {
  signedIn(api).on('getOrganization', notFound());
  await shoot(page, '/organizations/00000000-0000-4000-8000-0000000000ff', 'not-found-organization', {
    ready: async (p) => {
      await expect(p.getByRole('heading', { name: "That organization isn't here" })).toBeVisible();
    },
  });
});

test('not-found-workspace: unknown workspace id', async ({ page, api }) => {
  signedIn(api).on('getWorkspace', notFound());
  await shoot(page, `${orgUrl}/workspaces/00000000-0000-4000-8000-0000000000fe`, 'not-found-workspace', {
    ready: async (p) => {
      await expect(p.getByRole('heading', { name: "That workspace isn't here" })).toBeVisible();
    },
  });
});

test('invalid-route: unknown path', async ({ page, api }) => {
  signedIn(api);
  await shoot(page, '/no/such/page', 'invalid-route', {
    ready: async (p) => {
      await expect(p.getByText('This address is not valid.')).toBeVisible();
    },
  });
});

test('reference: public API reference page', async ({ page, api }) => {
  signedIn(api);
  await shoot(page, '/reference', 'reference', {
    ready: async (p) => {
      await expect(p.getByRole('heading', { name: 'Public API reference' })).toBeVisible();
    },
  });
});
