// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { pendingRunHistorySummary } from '@beetle/contracts/api';
import type { Run, RunHistorySummary } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import { delta } from './Deltas.js';
import { catalogue, json, mountComparison, runIds, scope, snapshot, testClient } from './fixtures.js';

afterEach(cleanup);
function measured(run: Run, rps: number, p95: number, ratio: number): RunHistorySummary {
  return { ...pendingRunHistorySummary(run), availability: 'ready', source: { generation: 1,
    manifestDigest: 'a'.repeat(64), numericArtifactId: '44444444-4444-4444-8444-444444444444', numericSha256: 'b'.repeat(64),
    numericVersion: 4, measurementSourceTimeMs: 1000, coverage: { complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 } },
    testDurationMs: 2000, requestCount: rps * 2, requestsPerSecond: rps, httpFailures: Math.round(rps * 2 * ratio),
    httpSamples: rps * 2, httpFailureRatio: ratio,
    httpP95: { source: 'histogram-estimate', scale: 4, estimate: p95, lower: p95 - 1, upper: p95 + 1 },
    publishedArtifactBytes: 1536, retainedLogicalBytes: 67584, metadataAllowanceBytes: 65536 };
}

it('shows Compare / Empty without any read when no runs are picked', async () => {
  const f = testClient(() => {
    throw new Error('Unexpected read');
  });
  mountComparison(f.client, false, '/');
  expect(await screen.findByRole('heading', { name: 'Pick runs to compare' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Go to runs' })).toHaveAttribute('href', routes.runs(scope.organizationId, scope.workspaceId));
  expect(f.records).toHaveLength(0);
});

it('labels client deltas from the baseline, offers Make baseline and lists what was different', async () => {
  const items = snapshot().items;
  const summaries = new Map([
    [runIds[0]!, measured(items[0]!.run, 100, 200, 0.01)],
    [runIds[1]!, measured(items[1]!.run, 110, 190, 0.05)],
  ]);
  const f = testClient((request) => {
    if (request.path.endsWith('/comparisons')) return json(snapshot());
    if (request.path.includes('/runs?')) {
      const id = runIds.find((value) => request.path.includes(value))!;
      const run = items.find((item) => item.run.id === id)!.run;
      return json({ scope: run.scope, items: [run], summaries: [summaries.get(id)], nextCursor: null });
    }
    return json(catalogue());
  });
  mountComparison(f.client);
  const table = await screen.findByRole('table', { name: /difference from the baseline/ });
  const rate = within(table).getByRole('rowheader', { name: 'Requests a second' }).closest('tr')!;
  expect(rate).toHaveTextContent('100');
  expect(rate).toHaveTextContent('110+10%');
  const p95 = within(table).getByRole('rowheader', { name: 'p95, histogram estimate' }).closest('tr')!;
  expect(p95).toHaveTextContent('190 ms−5%');
  const failed = within(table).getByRole('rowheader', { name: 'Failed requests' }).closest('tr')!;
  expect(failed).toHaveTextContent('+4 pp');
  expect(screen.getByText('Baseline', { selector: '.badge' })).toBeVisible();
  const make = screen.getByRole('link', { name: `Make ${runIds[1]!.slice(0, 4)} the baseline` });
  expect(make).toHaveAttribute('href', routes.comparison(scope.organizationId, scope.workspaceId, [runIds[1]!, runIds[0]!]));
  expect(screen.getByRole('table', { name: 'What was different between the runs' })).toBeVisible();
  expect(f.records.filter((record) => record.method !== 'GET' && !record.path.endsWith('/comparisons'))).toHaveLength(0);
});

it('never invents a delta when either side is unknown', () => {
  expect(delta('relative', null, 5)).toBeNull();
  expect(delta('relative', 0, 5)).toBeNull();
  expect(delta('relative', 4, 4)).toBe('same');
  expect(delta('points', 0.0004, 0.0006)).toBe('+0.02 pp');
  expect(delta('duration', 60000, 30000)).toBe('−00:30');
});
