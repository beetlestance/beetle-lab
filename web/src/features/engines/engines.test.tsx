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

it('lists installed profiles with image facts and the default profile', async () => {
  const api = client(json(installationStatus()));
  mount(api.client, routes.engines);
  const k6 = (await screen.findByRole('heading', { name: 'k6' })).closest('li')!;
  expect(within(k6).getByText('Default for new runs')).toBeVisible();
  expect(within(k6).getByText('Installed')).toBeVisible();
  expect(await within(k6).findByText('Verified when the agent started')).toBeVisible();
  const small = screen.getByRole('heading', { name: 'k6-small' }).closest('li')!;
  expect(within(small).queryByText('Image')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it.each(['unreachable', 'unavailable', 'stale'] as const)('shows the unavailable banner for %s', async (state) => {
  const api = client(json(installationStatus(state)));
  mount(api.client, routes.engines);
  const banner = await screen.findByText(/Engine agent:/);
  expect(banner.closest('.banner')).toHaveTextContent('Last seen');
  expect(screen.getByRole('link', { name: 'Open installation status' })).toHaveAttribute('href', routes.settings);
  expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
});

it('still lists profiles when status cannot be read', async () => {
  const api = client(json(apiError('storage_unavailable'), 503));
  mount(api.client, routes.engines);
  expect(await screen.findByText(/Image and agent status could not be read/)).toBeVisible();
  expect(screen.getByRole('heading', { name: 'k6' })).toBeVisible();
});
