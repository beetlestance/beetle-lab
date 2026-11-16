// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { comparisonWarnings, encodeRunMetricSeriesCursor } from '@beetle/contracts/api';
import type { RunMetricKey } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import { catalogue, json, mountComparison, runIds, sampleReply, scope, snapshot, testClient, apiError } from './fixtures.js';
afterEach(cleanup);
it('compares outcomes/provenance then sequences selected per-run charts by actual ordinal', async () => {
  let active = 0; let maximum = 0;
  const fixture = testClient(async request => {
    active++; maximum = Math.max(active, maximum); await Promise.resolve(); active--;
    if (request.path.endsWith('/comparisons')) return json(snapshot(request.body?.metric as RunMetricKey | null));
    if (request.path.includes('/samples?')) {
      const url = new URL(request.path, 'http://localhost'); const id = runIds.find(value => request.path.includes(value))!;
      return json(sampleReply(id, Number(url.searchParams.get('seriesOrdinal'))));
    }
    return json(catalogue());
  });
  mountComparison(fixture.client, true);
  await screen.findByLabelText('Baseline metric');
  expect(screen.getAllByText('Actual contention is unknown.')).toHaveLength(2);
  expect(screen.getAllByText('Application state / outcome')).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Baseline metric'), {target: {value: '0'}});
  await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
  expect(maximum).toBe(1);
  const paths = fixture.records.map(record => record.path);
  expect(paths).toHaveLength(5); expect(paths[0]).toMatch(/comparisons$/); expect(paths[1]).toMatch(/metrics\?limit=100$/);
  expect(paths.slice(3).join(' ')).toContain('seriesOrdinal=2'); expect(paths.slice(3).join(' ')).toContain('seriesOrdinal=3');
  expect(screen.getByText(/independent vertical scale/)).toBeVisible();
});
it('stops on failure and only refreshes manually', async () => {
  let failed = true;
  const fixture = testClient(request => failed ? json(apiError('storage_unavailable'), 503) : json(request.path.endsWith('/comparisons') ? snapshot() : catalogue()));
  mountComparison(fixture.client); await screen.findByRole('alert'); expect(fixture.records).toHaveLength(1);
  failed = false; fireEvent.click(screen.getByRole('button', {name: 'Refresh comparison'}));
  await screen.findByLabelText('Baseline metric'); expect(fixture.records).toHaveLength(3);
});
it('rejects invalid URL before issuing any client read', async () => {
  const fixture = testClient(() => {throw new Error('Unexpected read');});
  mountComparison(fixture.client, false, '/?runs=bad,bad');
  await screen.findByRole('heading', {name: 'Invalid comparison'}); expect(fixture.records).toHaveLength(0);
});
it('replaces a bounded catalogue page without retaining old options', async () => {
  let calls = 0; const p = catalogue();
  const cursor = encodeRunMetricSeriesCursor({...p.scope, runId: p.id, attemptId: p.attemptId, manifestDigest: p.manifestDigest!, nextOrdinal: 1});
  const fixture = testClient(request => request.path.endsWith('/comparisons') ? json(snapshot()) : json(++calls === 1
    ? {...catalogue(), totalSeries: 2, nextCursor: cursor}
    : {...catalogue(), totalSeries: 2, items: [{...catalogue().items[0]!, ordinal: 1, metric: 'iterations'}]}));
  mountComparison(fixture.client); await screen.findByLabelText('Baseline metric');
  fireEvent.click(screen.getByRole('button', {name: 'Next metric page'}));
  await screen.findByRole('option', {name: /iterations/}); expect(screen.queryByRole('option', {name: /http_reqs/})).not.toBeInTheDocument();
  expect(fixture.records.at(-1)?.path).toContain(`limit=100&cursor=${cursor}`);
});

it('renders four bounded independent charts and never fans out beyond selected runs', async () => {
  const ids = [...runIds, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const fixture = testClient(request => {
    if (request.path.endsWith('/comparisons')) return json(snapshot(request.body?.metric as RunMetricKey | null, ids));
    if (!request.path.includes('/samples?')) return json(catalogue());
    const ordinal = Number(new URL(request.path, 'http://localhost').searchParams.get('seriesOrdinal'));
    return json(sampleReply(ids.find(id => request.path.includes(id))!, ordinal, ids));
  });
  mountComparison(fixture.client, false, routes.comparison(scope.organizationId, scope.workspaceId, ids));
  await screen.findByLabelText('Baseline metric'); fireEvent.change(screen.getByLabelText('Baseline metric'), {target: {value: '0'}});
  await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(4));
  expect(fixture.records).toHaveLength(7); expect(fixture.records.filter(record => record.path.includes('/samples?'))).toHaveLength(4);
});
it('keeps missing peer measurements explicit without substituting zero or requesting samples', async () => {
  const fixture = testClient(request => {
    if (request.path.endsWith('/comparisons')) {
      const value = snapshot(request.body?.metric as RunMetricKey | null);
      if (value.metric) {
        const peer = value.items[1]!; peer.metric = {...peer.metric, series: null, availability: 'missing', reason: 'not_observed'};
        peer.warnings = comparisonWarnings(peer);
      }
      return json(value);
    }
    return request.path.includes('/samples?') ? json(sampleReply(runIds[0]!, 2)) : json(catalogue());
  });
  mountComparison(fixture.client); await screen.findByLabelText('Baseline metric');
  fireEvent.change(screen.getByLabelText('Baseline metric'), {target: {value: '0'}});
  await screen.findByRole('img'); expect(screen.getByText('Metric: missing (not_observed).')).toBeVisible();
  expect(screen.getAllByText(/Whole-run total:/)).toHaveLength(1);
  expect(fixture.records.filter(record => record.path.includes('/samples?'))).toHaveLength(1);
});
