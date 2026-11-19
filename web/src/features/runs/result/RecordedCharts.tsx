import { useMemo, useState } from 'react';
import type { Run, RunChartHistory } from '@beetle/contracts/api';
import { Button } from '../../../components/Button.js';
import { SegmentedFilter } from '../../../components/SegmentedFilter.js';
import { MetricWindows } from '../charts/MetricWindows.js';
import { LiveChart } from '../live/LiveChart.js';
import { ms, whole } from '../live/format.js';
import { RunMetrics } from '../metrics/index.js';
import type { RunPlan } from '../live/plan.js';
import { recordedPlot, recordedBands, sourceClock } from './chart-model.js';
import type { ResultReads } from './useResultReads.js';
import '../live/live.css';
import './charts.css';
export function readyChartHistory(query: ResultReads['chartHistory']): RunChartHistory | null {
  return query.isSuccess && query.data.reason === null ? query.data : null;
}
export function useRecordedCharts(query: ResultReads['chartHistory'], totalMs: number | null, state: Run['state']) {
  const data = readyChartHistory(query);
  const plannedDurationMs = state === 'cancelled' || state === 'errored' ? totalMs : null;
  const plot = useMemo(() => (data ? recordedPlot(data, plannedDurationMs) : null), [data, plannedDurationMs]);
  const [hoverT, onHover] = useState<number | null>(null);
  return { data, plot, hover: { hoverT, onHover }, query };
}
type View = ReturnType<typeof useRecordedCharts>;
export function RecordedWhole({
  view,
  p95Limit,
  plan,
  phone = false,
}: {
  view: View;
  p95Limit: number | null;
  plan: RunPlan;
  phone?: boolean;
}) {
  const [selected, setSelected] = useState<'p95' | 'rps'>('p95');
  const { data, plot, query } = view;
  return (
    <section id="result-whole" className="result-section" aria-label="The whole run">
      {query.isPending ? (
        <p role="status">Reading recorded chart history…</p>
      ) : !data || !plot ? (
        <ChartUnavailable query={query} />
      ) : plot.points.length === 0 ? (
        <p role="status">No recorded source windows.</p>
      ) : (
        <>
          <div className="live-whole">
            <header className="live-section-head">
              <h2>
                {phone ? (selected === 'p95' ? 'p95 latency, whole run' : 'Requests, whole run') : 'The whole run'}
              </h2>
              <SegmentedFilter
                label="Recorded whole-run chart"
                value={selected}
                onChange={setSelected}
                options={[
                  { value: 'p95', label: 'p95' },
                  { value: 'rps', label: 'Requests' },
                ]}
              />
            </header>
            <WholeChart view={view} selected={selected} p95Limit={p95Limit} plan={plan} phone={phone} />
          </div>
          {plot.lastWindowBeforePlanEnd !== null && (
            <p className="result-muted">
              Last recorded window at {sourceClock(plot.lastWindowBeforePlanEnd)} · Planned end at{' '}
              {sourceClock(plot.domain[1])}.
            </p>
          )}
          <Coverage data={data} phone={phone} />
        </>
      )}
    </section>
  );
}
function WholeChart({
  view,
  selected,
  p95Limit,
  plan,
  phone,
}: {
  view: View;
  selected: 'p95' | 'rps';
  p95Limit: number | null;
  plan: RunPlan;
  phone: boolean;
}) {
  const plot = view.plot!;
  const p95 = selected === 'p95';
  return (
    <LiveChart
      {...view.hover}
      title={p95 ? 'Recorded p95 latency, histogram estimates' : 'Recorded requests per one-second window'}
      tall={!phone}
      className={phone ? 'result-whole-compact' : undefined}
      xs={plot.points.map((point) => point.t)}
      breaks={plot.points.map((point) => point.gapBefore)}
      domain={plot.domain}
      strictHoverRange={plot.lastWindowBeforePlanEnd !== null}
      ticks={phone ? plot.ticks.filter((_, index) => index % 2 === 0) : plot.ticks}
      bands={phone ? undefined : recordedBands(plan, plot.domain)}
      series={[
        {
          key: selected,
          label: p95 ? 'p95' : 'requests',
          tone: 'amber',
          area: true,
          values: plot.points.map((point) => (p95 ? point.p95 : point.rps)),
        },
      ]}
      format={p95 ? ms : whole}
      limit={p95 && p95Limit !== null ? { value: p95Limit, label: `Limit ${ms(p95Limit)}` } : undefined}
      tightLimitScale={phone && p95}
    />
  );
}
export function RecordedMetrics({ view, p95Limit }: { view: View; p95Limit: number | null }) {
  const plot = view.plot;
  if (!plot || plot.points.length === 0) return null;
  return (
    <section id="result-charts" aria-label="Requests and virtual users">
      <MetricWindows
        points={plot.points}
        domain={plot.domain}
        ticks={plot.ticks}
        hover={view.hover}
        p95Limit={p95Limit}
        strictHoverRange={plot.lastWindowBeforePlanEnd !== null}
      />
    </section>
  );
}
export function AdvancedMetrics({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="result-advanced-metrics" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Browse individual recorded metrics</summary>
      {open && <RunMetrics run={run} terminal />}
    </details>
  );
}
function Coverage({ data, phone }: { data: RunChartHistory; phone: boolean }) {
  const text = (
    <p className="result-muted">
      {data.points.length} of {data.windows} recorded windows shown
      {data.sampled ? ' · sampled with first and last retained' : ''}. Latencies are histogram estimates; breaks mark
      missing source time. The axis follows the native measurement marker.
      {data.source && !data.source.coverage.complete && ' Source-window coverage is partial.'}
    </p>
  );
  return phone ? (
    <details className="result-chart-coverage">
      <summary>
        {data.points.length} of {data.windows} windows{data.sampled ? ' · sampled' : ''}
        {data.source && !data.source.coverage.complete && ' · partial source'}
      </summary>
      {text}
    </details>
  ) : (
    text
  );
}
function ChartUnavailable({ query }: { query: ResultReads['chartHistory'] }) {
  const reason = query.isError ? 'unavailable' : query.data?.reason;
  const text =
    reason === 'too_large'
      ? 'This recorded history is larger than the chart view supports. Browse individual metrics below.'
      : reason === 'pending'
        ? 'Chart publication is pending.'
        : reason === 'not_recorded'
          ? 'No chart history was recorded.'
          : reason === 'unsupported_format'
            ? 'This recorded history format is not supported.'
            : 'Recorded chart history could not be loaded.';
  return (
    <div>
      <p role={query.isError ? 'alert' : 'status'}>{text}</p>
      {(reason === 'unavailable' || reason === 'pending') && (
        <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch({ cancelRefetch: false })}>
          Retry recorded charts
        </Button>
      )}
    </div>
  );
}
