import { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ApiContext } from '../../../app/api.js';
import { createQueryClient } from '../../../app/queries.js';
import { RunMetrics } from './index.js';
import type { RunMetricSeries, RunMetricSeriesPage, RunMetricSamplesPage } from '@beetle/contracts/api';
import { run } from '../test-fixtures.js';
import { encodeRunMetricSamplesCursor } from '@beetle/contracts/api';
export { run } from '../test-fixtures.js';
export { testClient, json, deferred, apiError } from '../../../app/test-fixtures.js';
export const series: RunMetricSeries = {ordinal: 0, metric: 'http_reqs', kind: 'counter', scope: 'execute', tags: {}, unit: 'count', total: {kind: 'counter', sum: 2000}};
export function page(): RunMetricSeriesPage {
  const r = run(); return {id: r.id, scope: r.scope, attemptId: r.activeAttemptId, generation: 1, manifestDigest: 'c'.repeat(64), availability: 'ready',
    reason: null, windows: 2000, totalSeries: 1, measurementSourceTimeMs: 0, coverage: {complete: true, latePoints: 0, markerDelayDroppedBuckets: 0}, items: [series], nextCursor: null};
}
export function samples(before = 2000, count = 100, selected = series): RunMetricSamplesPage {
  const p = page(); const first = before - count + 1;
  return {id: p.id, scope: p.scope, attemptId: p.attemptId, generation: 1, manifestDigest: p.manifestDigest!, series: selected, coverage: p.coverage!,
    measurementSourceTimeMs: 0, windows: 2000, fromTimeMs: 0, toTimeMs: 8640000000000000, examined: count, beforeWindow: before, firstWindow: first,
    span: {startTimeMs: first * 2000, endTimeMs: before * 2000 + 1000}, items: Array.from({length: count}, (_, i) => ({windowOrdinal: first + i,
      startTimeMs: (first + i) * 2000, endTimeMs: (first + i) * 2000 + 1000, value: {kind: 'counter' as const, sum: 1}})),
    nextCursor: first === 1 ? null : encodeRunMetricSamplesCursor({organizationId: p.scope.organizationId, workspaceId: p.scope.workspaceId,
      runId: p.id, attemptId: p.attemptId, manifestDigest: p.manifestDigest!, seriesOrdinal: selected.ordinal,
      fromTimeMs: 0, toTimeMs: 8640000000000000, beforeWindow: first - 1})};
}
export function mountMetrics(api: React.ContextType<typeof ApiContext>, terminal = false, strict = false) {
  const client = createQueryClient();
  function surface(current = run(), done = terminal) {return <ApiContext.Provider value={api}><QueryClientProvider client={client}><RunMetrics run={current} terminal={done} /></QueryClientProvider></ApiContext.Provider>;}
  const element = (current = run(), done = terminal) => strict ? <StrictMode>{surface(current, done)}</StrictMode> : surface(current, done);
  const view = render(element());
  return {client, ...view, select: (current: ReturnType<typeof run>, done = false) => view.rerender(element(current, done))};
}
