// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { FolderPage } from '@beetle/contracts/api';
import { apiError, deferred, ids, json, mount, readNamespace, testClient, workspace } from '../../app/test-fixtures.js';
import { routes } from '../../app/routes.js';

afterEach(cleanup);
function empty(): FolderPage {
  const w = workspace(); const scope = { kind: 'workspace' as const, organizationId: ids.a, workspaceId: ids.workspace };
  return { scope, items: [{ id: ids.root, scope, name: w.name, version: 1, parentFolderId: null, displayPath: [w.name] }],
    summaries: [{ folderId: ids.root, suiteCount: 0, subfolderCount: 0,
      groups: { passed: 0, failed: 0, in_progress: 0, stopped: 0, inconclusive: 0, no_runs: 0 }, latestRun: null }], nextCursor: null };
}
it('uses the complete empty inventory and opens the real authoring flow', async () => {
  const f = testClient(request => request.path.includes('/folders?') ? json(empty()) : readNamespace(request));
  mount(f.client, routes.suites(ids.a, ids.workspace));
  expect(await screen.findByRole('heading', { name: 'No suites here yet' })).toBeVisible();
  expect(screen.getByText('You can also paste a complete configuration as JSON once the suite exists.')).toBeVisible();
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Write a suite' }));
  expect(await screen.findByRole('dialog', { name: 'What should this suite run?' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Choose k6 load tests' }));
  expect(screen.getByLabelText('Suite name')).toBeVisible();
  expect(f.records.every(request => request.method === 'GET')).toBe(true);
});
it('announces one loading state before scope metadata arrives without invented values', async () => {
  const pending = deferred<Response>();
  const f = testClient(() => pending.promise);
  mount(f.client, routes.suites(ids.a, ids.workspace));
  expect(await screen.findByText('Loading suites…')).toBeInTheDocument();
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.queryByRole('heading', { name: 'No suites here yet' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Write a suite' })).not.toBeInTheDocument();
});
it('keeps failed inventory distinct from empty and allows an explicit recovery read', async () => {
  let failed = true;
  const f = testClient(request => request.path.includes('/folders?')
    ? failed ? json(apiError('storage_unavailable'), 503) : json(empty()) : readNamespace(request));
  mount(f.client, routes.suites(ids.a, ids.workspace));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
  expect(screen.queryByRole('heading', { name: 'No suites here yet' })).not.toBeInTheDocument();
  failed = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  expect(await screen.findByRole('heading', { name: 'No suites here yet' })).toBeVisible();
});
it('does not infer emptiness from absent summaries or a partial folder page', async () => {
  const value = empty(); value.nextCursor = 'next';
  const f = testClient(request => request.path.includes('/folders?') ? json(value) : readNamespace(request));
  mount(f.client, routes.suites(ids.a, ids.workspace));
  expect(await screen.findByText(/No top-level folders on this page/)).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'No suites here yet' })).not.toBeInTheDocument();
});
it('keeps authoring disabled in restored history', async () => {
  const f = testClient(request => request.path.includes('/folders?') ? json(empty()) : readNamespace(request));
  mount(f.client, routes.suites(ids.a, ids.workspace), { readOnly: true, restoredBackup: null });
  expect(await screen.findByRole('button', { name: 'Write a suite' })).toBeDisabled();
  expect(f.records.every(request => request.method === 'GET')).toBe(true);
});
