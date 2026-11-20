// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import type { ApiClient, ApiClientFailure, UpgradeStatus } from '@beetle/contracts/api';
import { validateApi } from '@beetle/contracts/api';
import { ApiContext, errorMessage, unknownOutcome, useApi } from '../../app/api.js';
import { json, mount, testClient } from '../../app/test-fixtures.js';
import { routes } from '../../app/routes.js';
import { settings } from '../settings/test-fixtures.js';
import { backupText, unfinishedText } from './model.js';
import { UpgradeBanner } from './UpgradeBanner.js';
import { UpgradeWatch } from './watch.js';

afterEach(cleanup);

function status(overrides: Partial<UpgradeStatus> = {}): UpgradeStatus {
  return {
    scope: { kind: 'installation' },
    generatedAt: '2026-11-18T10:00:00.000Z',
    release: { name: '2.0.0', metadataSchema: 42 },
    path: 'next_release_only',
    phase: 'fenced',
    operationId: '00000000-0000-4000-8000-0000000000a1',
    unfinished: { runs: 1, exports: 0, uploads: 0, removals: 2 },
    backup: { atLeastBytes: 3_000_000_000, freeBytes: { status: 'measured', value: 50_000_000_000 } },
    ...overrides,
  };
}

const refusal: ApiClientFailure = {
  kind: 'protocol',
  status: 503,
  protocol: {
    code: 'upgrade_pending',
    message: 'Paused for upgrade',
    retryable: true,
    requestId: '12345678-1234-4234-8234-123456789012',
    fields: [],
  },
};

it('keeps the fixture inside the public schema', () => {
  expect(validateApi('UpgradeStatus', status()).ok).toBe(true);
});

it('shows release, the pause, unfinished work, backup size and the host commands', async () => {
  const api = testClient((request) => {
    if (request.path === '/api/v2/settings') return json(settings());
    if (request.path === '/api/v2/installation/upgrade') return json(status());
    return json({ scope: { kind: 'installation' }, items: [], nextCursor: null });
  });
  mount(api.client, routes.upgradeSettings);
  expect(await screen.findByText('Beetle 2.0.0')).toBeVisible();
  expect(screen.getByText('Paused for upgrade')).toBeVisible();
  expect(screen.getByText(/1 run and 2 removals still finishing\. Prepare waits/)).toBeVisible();
  expect(screen.getByText(/at least 3\.0 GB; 50\.0 GB is free/)).toBeVisible();
  const steps = screen.getByRole('list', { name: 'Upgrade commands' });
  expect(within(steps).getByText('docker compose run --rm setup upgrade activate')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Check for upgrade…' }));
  expect(await screen.findByRole('dialog', { name: 'Check for upgrade' })).toHaveTextContent(
    'does not contact the internet',
  );
});

it('names a development build and an open installation without inventing a release', async () => {
  const api = testClient((request) => {
    if (request.path === '/api/v2/settings') return json(settings());
    if (request.path === '/api/v2/installation/upgrade')
      return json(status({ phase: 'open', operationId: null, release: { name: null, metadataSchema: 42 } }));
    return json({ scope: { kind: 'installation' }, items: [], nextCursor: null });
  });
  mount(api.client, routes.upgradeSettings);
  expect(await screen.findByText('Beetle (development build)')).toBeVisible();
  expect(screen.getByText('No upgrade is in progress.')).toBeVisible();
  expect(screen.queryByText('Paused for upgrade')).not.toBeInTheDocument();
});

it('describes drained work and never claims the backup fits when free space is unknown', () => {
  expect(unfinishedText({ runs: 0, exports: 0, uploads: 0, removals: 0 })).toBeNull();
  expect(unfinishedText({ runs: 2, exports: 1, uploads: 0, removals: 0 })).toBe('2 runs and 1 export still finishing');
  expect(backupText({ atLeastBytes: 5_000_000, freeBytes: { status: 'unknown', value: null } })).toBe(
    'The backup copies the data folder: at least 5 MB. Free disk space has not been reported.',
  );
  expect(backupText({ atLeastBytes: 2_000_000_000, freeBytes: { status: 'measured', value: 1_000_000_000 } })).toMatch(
    /only 1\.0 GB is free\. Free space before you prepare\./,
  );
});

it('treats an upgrade refusal as a known refusal with its own message', () => {
  expect(unknownOutcome(refusal)).toBe(false);
  expect(errorMessage(refusal)).toMatch(/paused for an upgrade, so nothing was changed/);
});

function Caller() {
  const api = useApi();
  return (
    <button type="button" onClick={() => void api.listOrganizations({ query: { limit: 1 } })}>
      Act
    </button>
  );
}

it('raises the paused banner after the first refused request and passes the reply through', async () => {
  const replies: unknown[] = [];
  const fake = {
    listOrganizations: () =>
      Promise.resolve({ ok: false, error: refusal }).then((reply) => {
        replies.push(reply);
        return reply;
      }),
  } as unknown as ApiClient;
  render(
    <MemoryRouter>
      <ApiContext.Provider value={fake}>
        <UpgradeWatch>
          <Caller />
          <UpgradeBanner />
        </UpgradeWatch>
      </ApiContext.Provider>
    </MemoryRouter>,
  );
  expect(screen.queryByText('Beetle is paused for an upgrade')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Act' }));
  expect(await screen.findByText('Beetle is paused for an upgrade')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Upgrade status' })).toHaveAttribute('href', routes.upgradeSettings);
  expect(replies).toEqual([{ ok: false, error: refusal }]);
});
