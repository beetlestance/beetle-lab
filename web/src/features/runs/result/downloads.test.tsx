// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ApiContext } from '../../../app/api.js';
import { createQueryClient } from '../../../app/queries.js';
import { artifact, cursor, page, apiError, json, run, testClient } from '../artifacts/fixtures.js';
import { ResultDownloads } from './ResultDownloads.js';

afterEach(cleanup);
function mount(handler: Parameters<typeof testClient>[0]) {
  const f = testClient(handler);
  const client = createQueryClient();
  const view = render(<MemoryRouter><ApiContext.Provider value={f.client}><QueryClientProvider client={client}>
    <ResultDownloads run={run()} ordinal={2} />
  </QueryClientProvider></ApiContext.Provider></MemoryRouter>);
  return { ...f, ...view, client };
}
function open() { fireEvent.click(screen.getByRole('button', { name: 'Download' })); }

it('reads only on opening and grants native UUID links from publication metadata', async () => {
  const value = { ...page(), items: ['performance-report', 'numeric-final', 'metrics-csv'].map((kind, i) => ({ ...artifact(i), kind })) };
  const f = mount(() => json(value));
  expect(f.records).toHaveLength(0); open();
  const link = await screen.findByRole('link', { name: /Report/ });
  expect(link).toHaveAttribute('download', `artifact-${artifact().artifactId}.txt`);
  expect(link).toHaveAttribute('href', expect.stringContaining(`/artifacts/${artifact().artifactId}/content`));
  expect(screen.getByRole('link', { name: /Summary/ })).toHaveAttribute('download', expect.stringMatching(/\.json$/));
  expect(screen.getByRole('link', { name: /Script for revision 2/ })).toHaveAttribute('href', expect.stringContaining(run().revisionId));
  expect(f.records).toHaveLength(1);
  expect(f.records.some(r => r.method !== 'GET' || r.path.endsWith('/content'))).toBe(false);
  fireEvent.keyDown(link, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Run downloads' })).not.toBeInTheDocument());
  await waitFor(() => expect(f.client.getQueryCache().findAll()).toHaveLength(0));
  expect(screen.getByRole('button', { name: 'Download' })).toHaveFocus();
});

it('reads the bounded second page and refuses to select an ambiguous file kind', async () => {
  const first = { ...page(), items: Array.from({ length: 100 }, (_, i) => artifact(i)), nextCursor: cursor() };
  const second = { ...page(), items: [{ ...artifact(100), kind: 'metrics-csv' }, { ...artifact(101), kind: 'metrics-csv' }] };
  const f = mount(r => json(r.path.includes('cursor=') ? second : first)); open();
  expect(await screen.findByText('Multiple files; choose one in Artifacts')).toBeVisible();
  expect(screen.queryByRole('link', { name: /^Metrics/ })).not.toBeInTheDocument();
  expect(f.records).toHaveLength(2);
});

it('retires all links on a changed manifest and retries explicitly', async () => {
  let fail = true;
  const first = { ...page(), items: Array.from({ length: 100 }, (_, i) => artifact(i)), nextCursor: cursor() };
  const f = mount(r => json(!fail ? { ...page(), items: [{ ...artifact(), kind: 'performance-report' }] }
    : r.path.includes('cursor=') ? { ...page(), manifestDigest: 'f'.repeat(64) } : first)); open();
  const retry = await screen.findByRole('button', { name: 'Retry downloads' });
  expect(screen.queryByRole('link', { name: /^Report/ })).not.toBeInTheDocument();
  fail = false; fireEvent.click(retry);
  expect(await screen.findByRole('link', { name: /^Report/ })).toBeVisible();
  expect(f.records).toHaveLength(3);
});

it('keeps a script read available when file metadata fails', async () => {
  const f = mount(() => json(apiError('storage_unavailable'), 503)); open();
  expect(await screen.findByRole('alert')).toHaveTextContent('Published files could not be read');
  expect(screen.getByRole('link', { name: /Script for revision 2/ })).toBeVisible();
  expect(f.records).toHaveLength(1);
});
