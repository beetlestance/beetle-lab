// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ids, json, mount, readNamespace, testClient } from './test-fixtures.js';
import { routes } from './routes.js';

afterEach(cleanup);

it('mounts the workspace Exports section with Exports current and reads only the exports page', async () => {
  const f = testClient((request) =>
    request.path.includes('/exports?')
      ? json({
          scope: { kind: 'workspace', organizationId: ids.a, workspaceId: ids.workspace },
          items: [],
          nextCursor: null,
        })
      : readNamespace(request),
  );
  mount(f.client, routes.exports(ids.a, ids.workspace));
  const tabs = await screen.findByRole('navigation', { name: 'Workspace sections' });
  expect(within(tabs).getByRole('link', { name: 'Exports' })).toHaveAttribute('aria-current', 'page');
  expect(within(tabs).getByRole('link', { name: 'Inputs' })).not.toHaveAttribute('aria-current');
  expect(await screen.findByText('No exports yet')).toBeVisible();
  expect(f.records.some((row) => row.path.includes('/exports?'))).toBe(true);
  expect(f.records.every((row) => row.method === 'GET')).toBe(true);
});

it('rejects an invalid workspace id on the exports route', async () => {
  const f = testClient(readNamespace);
  mount(f.client, `/organizations/${ids.a}/workspaces/not-a-uuid/exports`);
  expect(await screen.findByText('This address is not valid.')).toBeVisible();
  expect(f.records).toHaveLength(0);
});
