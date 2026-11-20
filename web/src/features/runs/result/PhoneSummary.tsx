import type { ReactNode } from 'react';
import type { RunMetricOverview, RunHistorySummary } from '@beetle/contracts/api';
import { formatLatency, formatNumber, formatPercent, formatDuration } from '../../run-results/format.js';

const number = (value: number | null | undefined) => formatNumber(value, 'integer');
/** Fixed four-figure phone layout; missing and measured-zero values stay distinct. */
export function PhoneMeasurementTiles({
  rate,
  p95,
  failed,
  requests,
}: {
  rate: number | null;
  p95: number | null;
  failed: number | null;
  requests: number | null;
}) {
  const tiles = [
    { label: 'requests/s on average', value: number(rate) },
    { label: 'p95 latency estimate', value: formatLatency(p95) },
    { label: 'of requests failed', value: formatPercent(failed) },
    { label: 'requests in all', value: number(requests) },
  ];
  return (
    <dl className="result-overview-tiles result-phone-tiles" aria-label="Whole-run measurements">
      {tiles.map((tile) => (
        <div key={tile.label}>
          <dt>{tile.label}</dt>
          <dd>{tile.value ?? <span title="Not recorded">–</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
export function PhoneMetricSummary({ overview, children }: { overview: RunMetricOverview; children: ReactNode }) {
  return (
    <>
      <PhoneMeasurementTiles
        rate={overview.requestsPerSecond}
        p95={overview.latency?.percentiles.p95.estimate ?? null}
        failed={overview.failure?.ratio ?? null}
        requests={overview.requestCount}
      />
      {overview.source && !overview.source.coverage.complete && (
        <p className="result-muted">Source-window coverage is partial.</p>
      )}
      <details className="result-summary-details">
        <summary>More whole-run measurements</summary>
        <PhoneExtraMeasurements overview={overview} />
        {children}
      </details>
    </>
  );
}
export function PhoneHistorySummary({ summary, note }: { summary: RunHistorySummary; note: string | null }) {
  return (
    <>
      <PhoneMeasurementTiles
        rate={summary.requestsPerSecond}
        p95={summary.httpP95?.estimate ?? null}
        failed={summary.httpFailureRatio}
        requests={summary.requestCount}
      />
      <p className="result-muted">Saved history figures{note ? `: ${note.toLowerCase()}` : ''}.</p>
      <details className="result-summary-details">
        <summary>More saved history measurements</summary>
        <dl>
          <div>
            <dt>Measured duration</dt>
            <dd>{formatDuration(summary.testDurationMs) ?? '–'}</dd>
          </div>
          <div>
            <dt>Failure samples</dt>
            <dd>{number(summary.httpSamples) ?? '–'}</dd>
          </div>
        </dl>
      </details>
    </>
  );
}

function PhoneExtraMeasurements({ overview }: { overview: RunMetricOverview }) {
  return (
    <dl>
      <div>
        <dt>p50 latency, estimate</dt>
        <dd>{recorded(formatLatency(overview.latency?.percentiles.p50.estimate))}</dd>
      </div>
      <div>
        <dt>p99 latency, estimate</dt>
        <dd>{recorded(formatLatency(overview.latency?.percentiles.p99.estimate))}</dd>
      </div>
      <div>
        <dt>Checks passed</dt>
        <dd>{recorded(formatPercent(overview.checks?.ratio))}</dd>
      </div>
      <div>
        <dt>Iterations dropped</dt>
        <dd>{number(overview.droppedIterations) ?? '–'}</dd>
      </div>
      <div>
        <dt>Failure samples</dt>
        <dd>{number(overview.failure?.sampleCount) ?? '–'}</dd>
      </div>
      <div>
        <dt>Measured duration</dt>
        <dd>{formatDuration(overview.testDurationMs) ?? '–'}</dd>
      </div>
    </dl>
  );
}

const recorded = (value: string | null) => value ?? '–';
