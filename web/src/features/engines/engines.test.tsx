// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { validateApi } from '@beetle/contracts/api';
import { apiError, json, mount, testClient } from '../../app/test-fixtures.js';
import { routes } from '../../app/routes.js';
import { settings } from '../settings/test-fixtures.js';
import { installationStatus } from './test-fixtures.js';

afterEach(cleanup);

function client(status: Response | (() => Response)) {
  return testClient((request) => {
    if (request.path === '/api/v2/settings') return json(settings());
    if (request.path === '/api/v2/installation/status') return typeof status === 'function' ? status() : status;
    return json({ scope: { kind: 'installation' }, items: [], nextCursor: null });
  });
}

it('keeps the status fixture inside the public schema', () => {
  expect(validateApi('InstallationStatus', installationStatus()).ok).toBe(true);
});

it('groups k6 profiles in one installed card with image facts and the default profile', async () => {
  const api = client(json(installationStatus()));
  mount(api.client, routes.engines);
  const k6 = (await screen.findByRole('heading', { name: 'k6 load tests' })).closest('li')!;
  expect(within(k6).getByText('Installed')).toBeVisible();
  await within(k6).findByText(/image verified/);
  expect(within(k6).getByText('Default')).toBeVisible();
  expect(await within(k6).findByText(/image verified when the agent started/)).toBeVisible();
  const profiles = within(k6).getByRole('list', { name: 'Profiles' });
  expect(within(profiles).getByText('k6-small')).toBeVisible();
  expect(within(profiles).getAllByText(/image/)).toHaveLength(1);
  expect(screen.queryByText(/runner agent/)).not.toBeInTheDocument();
});

it('labels planned engines and their sample bars as samples', async () => {
  const api = client(json(installationStatus()));
  mount(api.client, routes.engines);
  const planned = (await screen.findByRole('heading', { name: 'Planned' })).closest('section')!;
  expect(within(planned).getAllByText('Planned')).toHaveLength(6);
  expect(within(planned).getByRole('heading', { name: 'Mutation testing' })).toBeVisible();
  expect(within(planned).getByText('The bar on each card is a sample of what its runs would report.')).toBeVisible();
});

it('reports minutes since the agent was last heard from when it is stale', async () => {
  const api = client(json(installationStatus('stale')));
  mount(api.client, routes.engines);
  const notice = await screen.findByText(/hasn't heard from the runner agent for 2 min\./);
  expect(notice.closest('[role="status"]')).toHaveTextContent("New runs and exports can't start until it reports again.");
});

it.each(['unreachable', 'unavailable', 'stale'] as const)('shows the unavailable notice for %s', async (state) => {
  const api = client(json(installationStatus(state)));
  mount(api.client, routes.engines);
  const notice = await screen.findByText(/New runs and exports can't start/);
  expect(notice.closest('[role="status"]')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Installation status' })).toHaveAttribute('href', routes.settings);
  expect(screen.getByText('Unavailable')).toBeVisible();
});

it('still lists profiles when status cannot be read', async () => {
  const api = client(json(apiError('storage_unavailable'), 503));
  mount(api.client, routes.engines);
  expect(await screen.findByText('Agent and image status could not be read.')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'k6 load tests' })).toBeVisible();
  expect(screen.queryByText(/image verified/)).not.toBeInTheDocument();
});
