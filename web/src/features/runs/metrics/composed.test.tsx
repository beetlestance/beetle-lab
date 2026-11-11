// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ApiContext } from '../../../app/api.js';
import { createQueryClient } from '../../../app/queries.js';
import { RunDetail } from '../RunDetail.js';
import { emptyEvents, pendingArtifacts, resultSnapshot, run } from '../test-fixtures.js';
import { json, page, samples, testClient } from './fixtures.js';
afterEach(cleanup);
it('composes one selectable metric chart in actual RunDetail through the generated client', async () => {
  const current = run();
  const f = testClient(request => {
    const url = new URL(request.path, 'http://localhost');
    if (url.pathname.endsWith('/metrics/samples')) return json({...samples(100, 100), windows: 100, nextCursor: null});
    if (url.pathname.endsWith('/metrics')) return json({...page(), windows: 100});
    if (url.pathname.endsWith('/artifacts')) return json(pendingArtifacts());
    if (url.pathname.endsWith('/events')) return json(emptyEvents());
    if (url.pathname.endsWith('/result')) return json(resultSnapshot());
    if (url.pathname.endsWith(`/runs/${current.id}`)) return json(current);
    throw new Error('Unexpected composed metric fixture route');
  });
  render(<MemoryRouter><ApiContext.Provider value={f.client}><QueryClientProvider client={createQueryClient()}>
    <RunDetail organizationId={current.scope.organizationId} workspaceId={current.scope.workspaceId} runId={current.id} />
  </QueryClientProvider></ApiContext.Provider></MemoryRouter>);
  expect(await screen.findByRole('img')).toHaveAccessibleName(/http_reqs source window chart/);
  expect(screen.getByRole('combobox')).toHaveValue('0');
  expect(f.records.filter(r => r.path.includes('/metrics'))).toHaveLength(2);
  expect(screen.queryByText(/Metrics could not be loaded/)).not.toBeInTheDocument();
});
