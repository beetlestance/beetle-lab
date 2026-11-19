import { PhoneMetricSummary } from './PhoneSummary.js';
import { useState } from 'react';
import type { RunMetricOverview, RunMetricEndpoint, RunChartHistory } from '@beetle/contracts/api';
import { Button } from '../../../components/Button.js';
import { EndpointTable, endpointName } from './EndpointTable.js';
import { formatNumber, formatPercent } from '../../run-results/format.js';
import type { PlanRequest } from '../live/plan.js';
import type { ResultReads } from './useResultReads.js';
import { sameChartSource } from './chart-model.js';
import './overview.css';
const number = (value: number | null | undefined) => formatNumber(value, 'integer');
const ms = (value: number | null | undefined) => (value == null ? null : `${number(value)} ms`);
const missing = (value: string | null) => value ?? '–';
/** A failed refresh retires cached numeric figures immediately. */
export function readyOverview(query: ResultReads['overview']): RunMetricOverview | null {
  return query.isSuccess && query.data.availability === 'ready' ? query.data : null;
}
export function OverviewStatus({ query }: { query: ResultReads['overview'] }) {
  if (query.isPending)
    return (
      <p role="status" className="result-muted">
        Reading whole-run measurements…
      </p>
    );
  if (query.isError)
    return (
      <p role="alert" className="result-muted">
        Detailed measurements could not be loaded. Saved history figures, where available, remain below.{' '}
        <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch({ cancelRefetch: false })}>
          Retry measurements
        </Button>
      </p>
    );
  if (query.data.availability !== 'ready')
    return (
      <p className="result-muted">
        Detailed measurements: {query.data.availability.replaceAll('_', ' ')}. Missing values stay unknown.{' '}
        <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch({ cancelRefetch: false })}>
          Check measurements
        </Button>
      </p>
    );
  return null;
}
export function MetricSummary({
  overview,
  history,
  phone = false,
}: {
  overview: RunMetricOverview;
  history?: RunChartHistory | null;
  phone?: boolean;
}) {
  const peak = observedPeak(overview, history);
  if (phone)
    return (
      <PhoneMetricSummary overview={overview}>
        <MeasurementNotes overview={overview} peak={peak} />
      </PhoneMetricSummary>
    );
  return <DesktopMetricSummary overview={overview} peak={peak} />;
}
function DesktopMetricSummary({
  overview,
  peak,
}: {
  overview: RunMetricOverview;
  peak: ReturnType<typeof observedPeak>;
}) {
  const p = overview.latency?.percentiles;
  const tiles = [
    {
      value: number(overview.requestsPerSecond),
      label: peak === null ? 'a second on average' : `a second on average, observed peak ${number(peak.value)}`,
    },
    {
      value: ms(p?.p95.estimate),
      label: `p95, p50 ${missing(ms(p?.p50.estimate))}, p99 ${missing(ms(p?.p99.estimate))}`,
    },
    {
      value: formatPercent(overview.failure?.ratio),
      label: `failed of ${missing(number(overview.failure?.sampleCount))} requests`,
    },
    { value: formatPercent(overview.checks?.ratio), label: 'of checks passed' },
    { value: number(overview.droppedIterations), label: 'iterations dropped' },
  ];
  return (
    <>
      <dl className="result-overview-tiles" aria-label="Whole-run measurements">
        {tiles.map((tile) => (
          <div key={tile.label}>
            <dt>{tile.label}</dt>
            <dd>{tile.value ?? <span title="Not recorded">–</span>}</dd>
          </div>
        ))}
      </dl>
      <MeasurementNotes overview={overview} peak={peak} />
    </>
  );
}
const latency = (row: RunMetricEndpoint) => row.latency?.percentiles.p95.estimate ?? -1;
export function ResultEndpoints({
  overview,
  requests,
  phone = false,
}: {
  overview: RunMetricOverview | null;
  requests: readonly PlanRequest[];
  phone?: boolean;
}) {
  const [filter, setFilter] = useState('');
  const rows = [...(overview?.endpoints ?? [])].sort(
    (a, b) => latency(b) - latency(a) || Number(a.request.slice(1)) - Number(b.request.slice(1)),
  );
  const selected = rows.filter((row) =>
    endpointName(row, requests).toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()),
  );
  return (
    <section id="result-endpoints" className="result-section" aria-labelledby="result-endpoints-title">
      <div className="result-endpoint-head">
        <h2 id="result-endpoints-title">
          Where the requests go <span className="result-muted">{rows.length} endpoints</span>
        </h2>
        <label>
          <span className="sr-only">Filter endpoints</span>
          <input
            type="search"
            value={filter}
            maxLength={128}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${rows.length} endpoints`}
          />
        </label>
      </div>
      {!overview ? (
        <p className="result-muted">Endpoint measurements are unavailable until whole-run measurements are read.</p>
      ) : (
        <>
          <div className="result-endpoint-table">
            <EndpointTable rows={selected} requests={requests} total={overview.requestCount} phone={phone} />
          </div>
          {phone && (
            <p className="result-muted">p95 and failed stay in view. Swipe sideways for share, rate and p50.</p>
          )}
          {selected.length === 0 && (
            <p role="status">{rows.length ? 'No endpoints match this filter.' : 'No endpoint series were recorded.'}</p>
          )}
          <p className="result-muted">
            Sorted by p95, highest first. Latencies are histogram estimates. Unknown values are shown as –.
            {overview.omittedEndpoints > 0 &&
              ` ${overview.omittedEndpoints} additional endpoint rows are omitted by this bounded read; pooled totals include them.`}
          </p>
        </>
      )}
    </section>
  );
}

function observedPeak(overview: RunMetricOverview, history: RunChartHistory | null | undefined) {
  if (!history || history.reason !== null || !sameChartSource(overview, history)) return null;
  const value = history.observedPeakRequestsPerSecond;
  return value === null ? null : { value, knownWindows: history.knownRequestWindows };
}
function MeasurementNotes({ overview, peak }: { overview: RunMetricOverview; peak: ReturnType<typeof observedPeak> }) {
  return (
    <p className="result-muted">
      Latency percentiles are histogram estimates.{' '}
      {peak === null
        ? 'Observed peak is unavailable.'
        : `Peak is the highest recorded one-second request count across ${peak.knownWindows} known windows.`}
      {overview.source &&
        !overview.source.coverage.complete &&
        ' Source-window coverage is partial; these totals remain whole-run measurements.'}
    </p>
  );
}
