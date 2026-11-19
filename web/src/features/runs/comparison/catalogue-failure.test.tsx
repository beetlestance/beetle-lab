// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { apiError, catalogue, json, mountComparison, runIds, snapshot, testClient } from './fixtures.js';

afterEach(cleanup);
it('preserves accepted run facts when catalogue capacity is unavailable and recovers only on explicit retry', async () => {
  let catalogues = 0;
  const fixture = testClient(request => {
    if (request.path.endsWith('/comparisons')) return json(snapshot());
    if (/\/metrics\?/.test(request.path)) {
      catalogues++;
      return catalogues === 1 ? json({ ...apiError('capacity_unavailable'), message: 'Capacity unavailable', retryable: true }, 503) : json(catalogue());
    }
    return json(catalogue());
  });
  mountComparison(fixture.client);
  expect(await screen.findByRole('heading', { name: `Baseline: ${runIds[0]}` })).toBeVisible();
  expect(screen.getByRole('heading', { name: `Run 2: ${runIds[1]}` })).toBeVisible();
  expect(screen.getByText('Metric catalogue could not be loaded. The comparison remains available.')).toBeVisible();
  expect(screen.queryByText('Comparison could not be loaded. Use Refresh comparison to retry.')).not.toBeInTheDocument();
  expect(catalogues).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry metric catalogue' }));
  expect(await screen.findByLabelText('Baseline metric')).toBeVisible();
  expect(screen.queryByText('Metric catalogue could not be loaded. The comparison remains available.')).not.toBeInTheDocument();
  expect(catalogues).toBe(2);
  expect(fixture.records.filter(request => request.method !== 'GET' && !request.path.endsWith('/comparisons'))).toHaveLength(0);
});
