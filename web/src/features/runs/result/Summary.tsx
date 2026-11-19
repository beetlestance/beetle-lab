import type { EngineResult } from '@beetle/contracts';
import type { RunMetricOverview } from '@beetle/contracts/api';
import { k6RequestsPerSecond } from '@beetle/contracts/k6-history';
import type { useRecordedCharts } from './RecordedCharts.js';
import type { ResultReads } from './useResultReads.js';
import { MetricSummary, OverviewStatus } from './Overview.js';
import { SummaryTiles } from './Sections.js';
import { formatNumber, formatPercent } from '../../run-results/format.js';

export function ResultSummary({
  reads,
  charts,
  ready,
  phone,
  archiveMissing,
}: {
  reads: ResultReads;
  charts: ReturnType<typeof useRecordedCharts>;
  ready: RunMetricOverview | null;
  phone: boolean;
  archiveMissing: boolean;
}) {
  const view = reads.result.view;
  const native = archiveMissing && view.status === 'ready' ? view.result.nativeOverview : undefined;
  return (
    <section id="result-summary" className="result-section" aria-labelledby="result-summary-title">
      <h2 id="result-summary-title" className="sr-only">
        Summary
      </h2>
      {!native && <OverviewStatus query={reads.overview} />}
      {native && <NativeSummary evidence={native} />}
      {!native &&
        (ready ? (
          <MetricSummary overview={ready} history={charts.data} phone={phone} />
        ) : (
          <SummaryTiles summary={reads.summary} status={reads.summaryStatus} phone={phone} />
        ))}
    </section>
  );
}

function ms(value: number | null): string | null {
  const measured = formatNumber(value);
  return measured === null ? null : `${measured} ms`;
}
function NativeSummary({ evidence }: { evidence: NonNullable<EngineResult['nativeOverview']> }) {
  const latency = [
    [evidence.p50Ms, 'p50'],
    [evidence.p99Ms, 'p99'],
  ] as const;
  const recordedTail = latency.flatMap(([value, percentile]) => (value === null ? [] : [`${percentile} ${ms(value)}`]));
  const tiles = [
    {
      value: formatNumber(k6RequestsPerSecond(evidence.requests, evidence.durationMs), 'integer'),
      label: 'requests a second on average',
    },
    ...(evidence.p95Ms === null
      ? latency.map(([value, percentile]) => ({ value: ms(value), label: `${percentile} latency` }))
      : [{ value: ms(evidence.p95Ms), label: ['p95', ...recordedTail].join(' · ') }]),
    { value: formatPercent(evidence.failureRatio), label: 'of HTTP samples failed' },
    { value: formatPercent(evidence.checkPassRatio), label: 'of k6 checks passed' },
    { value: formatNumber(evidence.droppedIterations, 'integer'), label: 'iterations dropped' },
    { value: formatNumber(evidence.requests, 'integer'), label: 'HTTP requests in all' },
  ].filter((tile) => tile.value !== null);
  return (
    <>
      <p className="result-muted">Figures from the verified k6 summary.</p>
      <dl className="result-tiles" aria-label="Verified k6 summary">
        {tiles.map((tile) => (
          <div key={tile.label}>
            <dt>{tile.label}</dt>
            <dd>{tile.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
