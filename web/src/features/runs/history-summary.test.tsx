// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { pendingRunHistorySummary } from '@beetle/contracts/api';
import type { RunHistorySummary } from '@beetle/contracts/api';
import { routes } from '../../app/routes.js';
import { historyPage, run, mount, testClient, ids, json } from './test-fixtures.js';
import { suiteNames } from './history-fixtures.js';
afterEach(cleanup);
function measured(): RunHistorySummary {
  return { ...pendingRunHistorySummary(run()), availability: 'ready', source: { generation: 1,
    manifestDigest: 'a'.repeat(64), numericArtifactId: ids.request, numericSha256: 'b'.repeat(64), numericVersion: 4,
    measurementSourceTimeMs: 1000, coverage: { complete: false, latePoints: 1, markerDelayDroppedBuckets: 0 } },
    testDurationMs: 2000, requestCount: 8, requestsPerSecond: 4, httpFailures: 2, httpSamples: 8, httpFailureRatio: 0.25,
    httpP95: { source: 'histogram-estimate', scale: 4, estimate: 10, lower: 9, upper: 11 },
    publishedArtifactBytes: 1536, retainedLogicalBytes: 67584, metadataAllowanceBytes: 65536 };
}
const runReads = <T extends { path: string }>(records: T[]) => records.filter(record => record.path.includes('/runs?'));
it('renders only verified stored scalars with honest rate, estimate and coverage in one run read', async () => {
  const page = historyPage([run()]); page.summaries = [measured()];
  const f = testClient(request => suiteNames(request.path) ?? json(page)); mount(f.client, routes.runs(ids.a, ids.workspace));
  const table = await screen.findByRole('table'); expect(within(table).getByText('00:02')).toBeVisible();
  expect(within(table).getByText('4')).toBeVisible(); expect(within(table).getByText('≈ 10 ms')).toBeVisible();
  expect(within(table).getByText('25%')).toBeVisible(); expect(within(table).getByText('Partial window coverage')).toBeVisible();
  expect(screen.getByTitle(/2 of 8 HTTP samples failed/)).toBeVisible(); expect(screen.getByTitle('k6-reported test duration')).toBeVisible();
  expect(screen.getByTitle(/Histogram estimate between 9 and 11 ms/)).toBeVisible();
  expect(runReads(f.records)).toHaveLength(1); expect(runReads(f.records)[0]!.path).toContain('/runs?limit=100&order=newest');
});
it('keeps missing measurements unknown rather than zero', async () => {
  const value = measured(); value.source = { ...value.source!, numericVersion: 3, coverage: { complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 } };
  Object.assign(value, { testDurationMs: null, requestsPerSecond: null, requestCount: 0, httpP95: null, httpFailures: null, httpSamples: null, httpFailureRatio: null });
  const page = historyPage([run()]); page.summaries = [value]; const f = testClient(request => suiteNames(request.path) ?? json(page));
  mount(f.client, routes.runs(ids.a, ids.workspace)); const table = await screen.findByRole('table');
  for (const label of ['Length unknown', 'Request rate unknown', 'p95 unknown', 'Failed share unknown']) expect(within(table).getByLabelText(label)).toBeVisible();
  expect(within(table).queryByText('0%')).not.toBeInTheDocument();
  expect(screen.queryByText('Partial window coverage')).not.toBeInTheDocument();
});
it('rejects a mismatched summary instead of attaching another attempt’s numbers to a row', async () => {
  const page = historyPage([run()]); page.summaries = [{ ...measured(), attemptId: ids.folder }];
  const f = testClient(request => suiteNames(request.path) ?? json(page)); mount(f.client, routes.runs(ids.a, ids.workspace));
  await screen.findByRole('alert'); expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(runReads(f.records)).toHaveLength(1);
});
