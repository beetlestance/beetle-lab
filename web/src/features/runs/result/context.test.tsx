// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ApiContext } from '../../../app/api.js';
import { createQueryClient } from '../../../app/queries.js';
import { org, workspace } from '../../../app/test-fixtures.js';
import { apiError, json, run, testClient } from '../test-fixtures.js';
import { ResultContext } from './ResultContext.js';

afterEach(cleanup);
function mount(handler: Parameters<typeof testClient>[0]) {
  const f = testClient(handler);
  const current = { ...run(), startedAt: '2026-11-10T01:00:00.000Z' };
  render(<MemoryRouter><ApiContext.Provider value={f.client}><QueryClientProvider client={createQueryClient()}>
    <ResultContext run={current} suiteName="Checkout" ordinal={0} />
  </QueryClientProvider></ApiContext.Provider></MemoryRouter>);
  return f;
}

it('shows scoped names, the saved revision and actual start time without current-work reads', async () => {
  const f = mount(r => json(r.path.endsWith(`/organizations/${run().scope.organizationId}`) ? org() : workspace()));
  expect(await screen.findByRole('link', { name: 'Same workspace' })).toHaveAttribute('href', expect.stringContaining(run().scope.workspaceId));
  expect(screen.getByText(/Checkout \(k6 load test\), run/)).toHaveTextContent('revision 0');
  expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-11-10T01:00:00.000Z');
  expect(f.records).toHaveLength(2);
  expect(f.records.some(r => /overview|snapshot|current-work|auth/.test(r.path))).toBe(false);
  expect(screen.queryByText(/by Meera/)).not.toBeInTheDocument();
});

it('keeps the result context visible when namespace reads fail and retries explicitly', async () => {
  let fail = true;
  const f = mount(r => fail ? json(apiError('storage_unavailable'), 503) : json(r.path.endsWith(`/organizations/${run().scope.organizationId}`) ? org() : workspace()));
  const retry = await screen.findByRole('button', { name: 'Retry workspace name' });
  expect(screen.getByText('Workspace unavailable')).toBeVisible();
  expect(screen.getByText(/Checkout \(k6 load test\), run/)).toBeVisible();
  fail = false; fireEvent.click(retry);
  expect(await screen.findByRole('link', { name: 'Same workspace' })).toBeVisible();
  expect(f.records).toHaveLength(3);
});
