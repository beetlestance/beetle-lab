import type { EngineResult } from '@beetle/contracts';
import type { RunMetricOverview } from '@beetle/contracts/api';
import { k6RequestsPerSecond } from '@beetle/contracts/k6-history';
import type { useRecordedCharts } from './RecordedCharts.js';
import type { ResultReads } from './useResultReads.js';
import { MetricSummary, OverviewStatus } from './Overview.js';
import { recoveredHistoryState, stoppedMeasurementsAbsent } from './RecoveredHistory.js';
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
  return (
    <section id="result-summary" className="result-section" aria-labelledby="result-summary-title">
      <h2 id="result-summary-title" className="sr-only">
        Summary
      </h2>
      <SummaryContent reads={reads} charts={charts} ready={ready} phone={phone} archiveMissing={archiveMissing} />
    </section>
  );
}

function SummaryContent({ reads, charts, ready, phone, archiveMissing }: Parameters<typeof ResultSummary>[0]) {
  const view = reads.result.view;
  const native = archiveMissing && view.status === 'ready' ? view.result.nativeOverview : undefined;
  if (native) return <NativeSummary evidence={native} />;
  if (stoppedMeasurementsAbsent(reads) && reads.summary?.availability === 'not_recorded')
    return <p className="result-muted">No whole-run figures were recorded.</p>;
  if (onlyRecoveredMeasurements(reads))
    return <p className="result-muted">Only sampled charts were recovered. Whole-run figures are unavailable.</p>;
  return (
    <>
      <OverviewStatus query={reads.overview} />
      {ready ? (
        <MetricSummary overview={ready} history={charts.data} phone={phone} />
      ) : (
        <SummaryTiles summary={reads.summary} status={reads.summaryStatus} phone={phone} />
      )}
    </>
  );
}

function onlyRecoveredMeasurements(reads: ResultReads): boolean {
  const history = recoveredHistoryState(reads);
  return (
    reads.overview.isSuccess &&
    reads.overview.data.availability === 'not_recorded' &&
    reads.summaryStatus === 'ready' &&
    reads.summary?.availability === 'not_recorded' &&
    Boolean(history?.isSuccess && history.data)
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
  const requests = formatNumber(evidence.requests, 'integer');
  const requestLabel = evidence.requests === 1 ? 'HTTP request' : 'HTTP requests';
  const rate = formatNumber(k6RequestsPerSecond(evidence.requests, evidence.durationMs), 'integer');
  const tiles = [
    {
      value: rate ?? requests,
      label:
        rate === null
          ? `${requestLabel} in all`
          : requests
            ? `a second on average · ${requests} ${requestLabel}`
            : 'a second on average',
    },
    ...(evidence.p95Ms === null
      ? latency.map(([value, percentile]) => ({ value: ms(value), label: `${percentile} latency` }))
      : [{ value: ms(evidence.p95Ms), label: ['p95', ...recordedTail].join(' · ') }]),
    { value: formatPercent(evidence.failureRatio), label: 'of HTTP samples failed' },
    { value: formatPercent(evidence.checkPassRatio), label: 'of k6 checks passed' },
    { value: formatNumber(evidence.droppedIterations, 'integer'), label: 'iterations dropped' },
  ].filter((tile) => tile.value !== null);
  return (
    <>
      <p className="result-muted">Figures from the verified k6 summary.</p>
      <dl className="result-tiles result-native-tiles" aria-label="Verified k6 summary">
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
