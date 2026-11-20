// CASES.md section 2: the organization page, the first-run screen, `/` and the workspace directory.
import type { Page } from '@playwright/test';
import { expect, shoot, test } from '../../harness.js';
import { ids, signedIn } from '../../world/index.js';
import { organizationList, organizationWorld, organizationsHandler, workspaces } from '../../world/overview/index.js';

const orgUrl = `/organizations/${ids.organization}`;

test('organization: three workspaces, one running', async ({ page, api }) => {
  organizationWorld(api);
  await shoot(page, orgUrl, 'organization', {
    viewports: ['desktop', 'phone', 'ultrawide'],
    ready: async (p) => {
      await expect(p.getByText('Running', { exact: true }).first()).toBeVisible();
      await expect(p.getByRole('link', { name: 'Payments' })).toBeVisible();
      await expect(p.getByText('Not among the 8 latest')).toHaveCount(0);
      await expect(p.getByText(/in the last 24 hours/)).toBeVisible();
    },
  });
});

test('organization-empty: workspaces exist but no runs', async ({ page, api }) => {
  organizationWorld(api, { empty: true, items: [workspaces[2]!] });
  await shoot(page, orgUrl, 'organization-empty', {
    ready: async (p) => {
      await expect(p.getByRole('link', { name: 'Payments' })).toBeVisible();
      await expect(p.getByText('No runs yet')).toBeVisible();
    },
  });
});

test('organization-empty-no-workspaces: organization with no workspaces', async ({ page, api }) => {
  organizationWorld(api, { empty: true, items: [] });
  await shoot(page, orgUrl, 'organization-empty-no-workspaces', {
    ready: async (p) => {
      await expect(p.getByText('No workspaces in Platform team yet')).toBeVisible();
    },
  });
});

test('organization-loading: overview and workspace list pending', async ({ page, api }) => {
  organizationWorld(api);
  api.on('getOrganizationOverview', 'pending').on('listWorkspaces', 'pending');
  await shoot(page, orgUrl, 'organization-loading', {
    ready: async (p) => {
      await expect(p.getByText('Loading organization overview…')).toBeVisible();
      await expect(p.getByText('Loading workspaces…').first()).toBeVisible();
    },
  });
});

test('organization-first-run: the installation has no organization yet', async ({ page, api }) => {
  signedIn(api).on('listOrganizations', { scope: { kind: 'installation' }, items: [], nextCursor: null });
  await shoot(page, '/', 'organization-first-run', {
    ready: async (p) => {
      await expect(p.getByRole('heading', { name: 'Create your first organization' })).toBeVisible();
    },
  });
});

test('organizations-home: / with several organizations opens the first', async ({ page, api }) => {
  organizationWorld(api);
  api.on('listOrganizations', organizationsHandler(organizationList(4)));
  await shoot(page, '/', 'organizations-home', {
    viewports: ['desktop', 'phone'],
    ready: async (p) => {
      await expect(p).toHaveURL(new RegExp(`${orgUrl}$`));
      await expect(p.getByRole('link', { name: 'Payments' })).toBeVisible();
      await expect(p.getByText(/in the last 24 hours/)).toBeVisible();
    },
  });
});

test('workspaces: the organization workspace directory', async ({ page, api }) => {
  organizationWorld(api);
  api.on('listOrganizations', organizationsHandler(organizationList(4)));
  const ready = async (p: Page) => {
    await expect(p.getByRole('heading', { name: 'Workspaces', level: 1 })).toBeVisible();
    await expect(p.getByRole('link', { name: 'Payments' })).toBeVisible();
    await expect(p.getByText('Nothing running').first()).toBeVisible();
  };
  await shoot(page, `${orgUrl}/workspaces`, 'workspaces', { viewports: ['desktop', 'phone'], ready });
  await shoot(page, '/workspaces', 'workspaces-redirect', { viewports: ['desktop', 'phone'], ready });
});
