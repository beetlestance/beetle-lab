import { useMemo, useState } from 'react';
import type { LiveMetricHistory, RunMetricOverview } from '@beetle/contracts/api';
import { SegmentedFilter } from '../../../components/SegmentedFilter.js';
import { Button } from '../../../components/Button.js';
import { MetricWindows } from '../charts/MetricWindows.js';
import { Endpoints } from '../live/Tables.js';
import { liveFigures } from '../live/model.js';
import { chartDomain, TargetRuntime } from '../live/Charts.js';
import { mergeHistory, recordedCount } from '../live/backfill.js';
import { LiveChart } from '../live/LiveChart.js';
import type { ChartTick } from '../live/LiveChart.js';
import type { ChartHover } from '../charts/types.js';
import { clock, ms, whole } from '../live/format.js';
import type { LivePoint } from '../live/history.js';
import { emptyHistory } from '../live/history.js';
import type { RunPlan } from '../live/plan.js';
import type { ResultReads } from './useResultReads.js';
import { ResultEndpoints } from './Overview.js';

export function recoveredHistoryState(reads: ResultReads) {
  if (!reads.chartHistory.isSuccess || reads.chartHistory.data.reason !== 'not_recorded') return;
  const query = reads.stoppedHistory;
  if (query.isError || query.isFetching || query.data) return query;
}

export function stoppedResultUnavailable(reads: ResultReads): boolean {
  return (
    reads.result.status === 'unavailable' &&
    reads.result.matchesAttempt &&
    !reads.result.query.isFetching &&
    reads.overview.isSuccess &&
    reads.overview.data.availability === 'not_recorded' &&
    reads.chartHistory.isSuccess &&
    reads.chartHistory.data.reason === 'not_recorded' &&
    reads.stoppedHistory.isSuccess
  );
}

export function stoppedMeasurementsAbsent(reads: ResultReads): boolean {
  return stoppedResultUnavailable(reads) && reads.stoppedHistory.data === null;
}

export function resultSections(reads: ResultReads, showTarget: boolean, recordedTarget: boolean) {
  const recovered = recoveredHistoryState(reads);
  const target = !recordedTarget && Boolean(recovered?.data?.targetSamples?.length);
  return {
    recoveredCharts: Boolean(recovered),
    recoveredTarget: target,
    hideTarget: !showTarget && !target,
    sealedTarget: showTarget && !target,
  };
}

export function RecoveredHistory({
  query,
  plan,
  phone,
  showTarget,
}: {
  query: ResultReads['stoppedHistory'];
  plan: RunPlan;
  phone: boolean;
  showTarget: boolean;
}) {
  return (
    <section id="result-charts" className="result-section" aria-label="Recovered charts">
      {query.isError ? (
        <p role="status">
          Recovered history could not be read.{' '}
          <Button variant="text" size="sm" onClick={() => void query.refetch()}>
            Retry history
          </Button>
        </p>
      ) : query.data ? (
        <RecoveredCharts data={query.data} plan={plan} phone={phone} showTarget={showTarget} />
      ) : (
        <p role="status">Reading recovered history…</p>
      )}
    </section>
  );
}

function RecoveredCharts({
  data,
  plan,
  phone,
  showTarget,
}: {
  data: LiveMetricHistory;
  plan: RunPlan;
  phone: boolean;
  showTarget: boolean;
}) {
  const [hoverT, onHover] = useState<number | null>(null);
  const hover = { hoverT, onHover };
  const history = useMemo(() => mergeHistory(emptyHistory(null), data, plan, null), [data, plan]);
  const domain = chartDomain(history, plan);
  const ticks = domain.map((at) => ({ at, label: clock(at) }));
  return (
    <>
      <h2 className="result-section-title">Recovered before the stop</h2>
      <RecoveredCoverage shown={recordedCount(history)} data={data} />
      <RecoveredOverview points={history.points} domain={domain} ticks={ticks} hover={hover} phone={phone} />
      <MetricWindows points={history.points} domain={domain} hover={hover} ticks={ticks} strictHoverRange />
      {showTarget && history.target.length > 0 && (
        <div id="result-target">
          <TargetRuntime
            history={history}
            domain={domain}
            origin={null}
            hover={hover}
            units={plan.targetUnits}
            recovered
          />
        </div>
      )}
    </>
  );
}

const utcClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function RecoveredCoverage({ shown, data }: { shown: number; data: LiveMetricHistory }) {
  const end = new Date(data.prefix.endTimeMs);
  const through = end.toISOString();
  return (
    <div className="recovered-coverage">
      <p>
        Retained through{' '}
        <time dateTime={through} title={through}>
          {utcClock.format(end)} UTC
        </time>
        {' · '}
        {shown} of {data.prefix.windows} recorded windows shown
      </p>
      <p className="result-muted">Chart time starts at the first retained window.</p>
    </div>
  );
}

export function ResultEndpointEvidence({
  overview,
  plan,
  phone,
  archiveMissing,
  recovered,
}: {
  overview: RunMetricOverview | null;
  plan: RunPlan;
  phone: boolean;
  archiveMissing: boolean;
  recovered: ReturnType<typeof recoveredHistoryState>;
}) {
  const data = !overview && recovered?.isSuccess ? recovered.data : undefined;
  const figures = data ? liveFigures({ ...data.samples.at(-1)!, subset: data.subset }, plan) : null;
  if (figures?.endpoints.some((row) => row.p95 !== null || (row.requests ?? 0) > 0))
    return (
      <div id="result-endpoints" className="result-section">
        <Endpoints figures={figures} recovered />
      </div>
    );
  if (archiveMissing)
    return (
      <p className="result-muted">
        {recovered ? 'Endpoint detail requires' : 'Charts and endpoint detail require'} a verified metrics archive.
        Diagnostics and published artifacts remain available below.
      </p>
    );
  return <ResultEndpoints overview={overview} requests={plan.requests} phone={phone} />;
}

function RecoveredOverview({
  points,
  domain,
  ticks,
  hover,
  phone,
}: {
  points: readonly LivePoint[];
  domain: readonly [number, number];
  ticks: readonly ChartTick[];
  hover: ChartHover;
  phone: boolean;
}) {
  const [metric, selectMetric] = useState<'p95' | 'rps'>('p95');
  const latency = metric === 'p95';
  return (
    <div className="live-whole">
      <header className="live-section-head">
        <h3>{latency ? 'Latency before the stop' : 'Requests before the stop'}</h3>
        <SegmentedFilter
          label="Recovered overview chart"
          value={metric}
          onChange={selectMetric}
          options={[
            { value: 'p95', label: 'p95' },
            { value: 'rps', label: 'Requests' },
          ]}
        />
      </header>
      <LiveChart
        {...hover}
        title={latency ? 'Recovered p95 latency' : 'Recovered requests a second'}
        tall={!phone}
        domain={domain}
        ticks={ticks}
        strictHoverRange
        xs={points.map((point) => point.t)}
        breaks={points.map((point) => point.gapBefore)}
        format={latency ? ms : whole}
        series={[
          {
            key: metric,
            label: latency ? 'p95' : 'requests',
            tone: 'amber',
            area: true,
            values: points.map((point) => point[metric]),
          },
        ]}
      />
    </div>
  );
}
