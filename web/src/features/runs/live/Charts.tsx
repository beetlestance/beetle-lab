import type { BootstrapState } from '../live-history/index.js';
import { recordedCount } from './backfill.js';
import { Button } from '../../../components/Button.js';
import { useState } from 'react';
import { SegmentedFilter } from '../../../components/SegmentedFilter.js';
import type { LiveHistory, TargetPoint } from './history.js';
import type { RunPlan } from './plan.js';
import { LiveChart } from './LiveChart.js';
import type { ChartSeries, ChartTick } from './LiveChart.js';
import { clock, ms, reading, span, whole } from './format.js';

type Domain = readonly [number, number];

const lastT = (history: LiveHistory) => Math.max(history.points.at(-1)?.t ?? 0, history.target.at(-1)?.t ?? 0);
const firstT = (history: LiveHistory) =>
  Math.min(history.points[0]?.t ?? 0, history.target[0]?.t ?? Number.POSITIVE_INFINITY);

/** The x domain: the planned run when known, otherwise the readings this page saw. */
export function chartDomain(history: LiveHistory, plan: RunPlan): Domain {
  const last = lastT(history);
  if (history.fromStart && plan.totalMs !== null) return [0, Math.max(plan.totalMs, last)];
  const first = firstT(history);
  return [first, Math.max(first + 1000, last)];
}

const warmStage = (plan: RunPlan) => (plan.stages.length > 2 ? plan.stages[0] : undefined);
const drainStage = (plan: RunPlan) => plan.stages.find((stage) => stage.drain);

function stageTicks(plan: RunPlan, domain: Domain, nowT: number | null) {
  const ticks: ChartTick[] = [{ at: domain[0], label: clock(domain[0]) }];
  const warm = warmStage(plan);
  if (warm) ticks.push({ at: warm.durationMs, label: `Warm up ends ${clock(warm.durationMs)}`, detail: true });
  if (nowT !== null) ticks.push({ at: nowT, label: `now ${clock(nowT)}` });
  const drain = drainStage(plan);
  if (drain) ticks.push({ at: drain.startMs, label: `Drain ${clock(drain.startMs)}`, detail: true });
  ticks.push({ at: domain[1], label: clock(domain[1]) });
  return ticks;
}

/** Warm-up and drain bands; only meaningful when the history starts at the run start. */
function stageBands(history: LiveHistory, plan: RunPlan) {
  if (!history.fromStart) return [];
  const warm = warmStage(plan);
  const drain = drainStage(plan);
  return [
    ...(warm ? [{ from: 0, to: warm.durationMs }] : []),
    ...(drain ? [{ from: drain.startMs, to: drain.startMs + drain.durationMs }] : []),
  ];
}

type WholeView = 'p95' | 'rps';

function wholeSeries(view: WholeView, history: LiveHistory, slowest: boolean): ChartSeries {
  if (view === 'rps')
    return {
      key: 'rps',
      label: 'requests a second',
      tone: 'amber',
      area: true,
      values: history.points.map((p) => p.rps),
    };
  const label = slowest ? 'p95, slowest endpoint' : 'p95';
  return { key: 'p95', label, tone: 'amber', area: true, values: history.points.map((p) => p.p95) };
}

const wholeLimit = (view: WholeView, p95Limit: number | null) =>
  view === 'p95' && p95Limit !== null ? { value: p95Limit, label: `Limit ${ms(p95Limit)}` } : undefined;

export function WholeRun({
  history,
  plan,
  domain,
  p95Limit,
  slowest,
  bootstrap,
  historyEnabled,
}: {
  history: LiveHistory;
  plan: RunPlan;
  domain: Domain;
  p95Limit: number | null;
  slowest: boolean;
  bootstrap?: BootstrapState;
  historyEnabled?: boolean;
}) {
  const [view, setView] = useState<WholeView>('p95');
  const xs = history.points.map((p) => p.t);
  const p95 = view === 'p95';
  return (
    <section className="live-whole" aria-labelledby="live-whole">
      <header className="live-section-head">
        <h2 id="live-whole">{p95 ? 'p95 latency' : 'Requests a second'}, whole run</h2>
        <SegmentedFilter
          label="Whole-run chart"
          value={view}
          onChange={setView}
          options={[
            { value: 'p95', label: 'p95' },
            { value: 'rps', label: 'Requests' },
          ]}
        />
      </header>
      <LiveChart
        title={historyCaption(history, bootstrap?.status)}
        tall
        xs={xs}
        breaks={history.points.map((point) => point.gapBefore)}
        domain={domain}
        series={[wholeSeries(view, history, slowest)]}
        format={p95 ? ms : whole}
        limit={wholeLimit(view, p95Limit)}
        bands={stageBands(history, plan)}
        ticks={history.fromStart ? stageTicks(plan, domain, xs.at(-1) ?? null) : undefined}
      />
      {bootstrap?.status === 'unavailable' && (
        <p className="live-note" role="status">
          Recorded history could not refresh. Existing readings are kept.{' '}
          <Button variant="text" size="sm" disabled={!historyEnabled} onClick={bootstrap.retry}>
            Retry history
          </Button>
        </p>
      )}
    </section>
  );
}

function historyCaption(history: LiveHistory, status: BootstrapState['status'] | undefined): string {
  const coverage = history.coverage;
  if (!coverage)
    return status === 'loading'
      ? 'Loading recorded history; showing windows received on this page'
      : `${history.liveSampled ? 'Sampled live' : 'Live'} windows received since this page opened`;
  const through = coverage.throughTimeMs - history.originMs;
  const at = Number.isFinite(through) && through >= 0 ? clock(through) : 'time unavailable';
  const shown = recordedCount(history);
  return `Recorded history through ${at} · ${shown} of ${coverage.windows} windows shown${shown < coverage.windows ? ' · sampled' : ''}`;
}

export function MetricsGrid({ history, domain }: { history: LiveHistory; domain: Domain }) {
  const [hoverT, setHoverT] = useState<number | null>(null);
  const xs = history.points.map((p) => p.t);
  const pick = (key: 'rps' | 'p50' | 'p95' | 'p99' | 'failedPerSecond' | 'vus' | 'vusMax') =>
    history.points.map((p) => p[key]);
  const shared = { xs, breaks: history.points.map((point) => point.gapBefore), domain, hoverT, onHover: setHoverT };
  return (
    <section className="live-grid-section" aria-labelledby="live-metrics-grid">
      <header className="live-section-head">
        <h2 id="live-metrics-grid">Requests and virtual users</h2>
        <p className="live-note">Point at any chart to read all of them at that second.</p>
      </header>
      <div className="live-charts">
        <LiveChart
          {...shared}
          title="Requests a second"
          format={whole}
          series={[{ key: 'rps', label: 'requests', tone: 'amber', area: true, values: pick('rps') }]}
        />
        <LiveChart
          {...shared}
          title="Latency"
          format={ms}
          series={[
            { key: 'p50', label: 'p50', tone: 'info', values: pick('p50') },
            { key: 'p95', label: 'p95', tone: 'amber', values: pick('p95') },
            { key: 'p99', label: 'p99', tone: 'violet', values: pick('p99') },
          ]}
        />
        <LiveChart
          {...shared}
          title="Failed requests a second"
          format={(v) => reading(v)}
          series={[{ key: 'failed', label: 'failed', tone: 'fail', area: true, values: pick('failedPerSecond') }]}
        />
        <LiveChart
          {...shared}
          title="Active virtual users"
          format={whole}
          series={[
            { key: 'vus', label: 'busy', tone: 'ink', area: true, values: pick('vus') },
            { key: 'vusMax', label: 'allocated', tone: 'mute', dashed: true, values: pick('vusMax') },
          ]}
        />
      </div>
    </section>
  );
}

type TargetKey = keyof TargetPoint['values'];
const value = (point: TargetPoint, key: TargetKey) => (point.status === 'ready' ? point.values[key] : null);
const has = (points: readonly TargetPoint[], keys: readonly TargetKey[]) =>
  points.some((p) => keys.some((key) => value(p, key) !== null));

interface TargetChart {
  title: string;
  keys: TargetKey[];
  series: ChartSeries[];
}

/** Heap and RSS, CPU, event-loop delay, handles (or goroutines); charts without any reading are left out. */
function targetCharts(points: readonly TargetPoint[]): TargetChart[] {
  const heap: TargetKey = has(points, ['usedHeapSize']) ? 'usedHeapSize' : 'heapAlloc';
  const go = !has(points, ['activeHandles']);
  const handles: TargetKey = go ? 'goroutines' : 'activeHandles';
  const line = (key: TargetKey, label: string, tone: ChartSeries['tone'], area = false): ChartSeries => ({
    key,
    label,
    tone,
    area,
    values: points.map((p) => value(p, key)),
  });
  const charts: TargetChart[] = [
    { title: 'Heap and RSS', keys: [heap, 'rss'], series: [line(heap, 'heap', 'amber'), line('rss', 'RSS', 'info')] },
    {
      title: 'CPU',
      keys: ['cpuPercent', 'systemCpuPercent'],
      series: [line('cpuPercent', 'process %', 'amber'), line('systemCpuPercent', 'system %', 'mute')],
    },
    {
      title: 'Event-loop delay',
      keys: ['eventLoopDelay.mean', 'eventLoopDelay.p99', 'eventLoopDelay.max'],
      series: [
        line('eventLoopDelay.mean', 'mean', 'info'),
        line('eventLoopDelay.p99', 'p99', 'amber'),
        line('eventLoopDelay.max', 'max', 'violet'),
      ],
    },
    {
      title: go ? 'Goroutines' : 'Active handles',
      keys: [handles],
      series: [line(handles, go ? 'goroutines' : 'handles', 'ink', true)],
    },
  ];
  return charts.filter((chart) => has(points, chart.keys));
}

function TargetNote({ history, origin }: { history: LiveHistory; origin: string | null }) {
  const points = history.target;
  const unavailable = points.filter((p) => p.status === 'unavailable').length;
  return (
    <p className="live-note">
      Sampled{origin ? ` from ${origin}` : ''}
      {history.intervalMs ? ` every ${span(history.intervalMs)}` : ''}. Values as the target reports them.
      {unavailable > 0 && ` ${unavailable} readings unavailable.`}
      {points.some((p) => p.gapBefore) && ' Breaks in a line are readings left out of the live feed.'}
    </p>
  );
}

/** Live target graphs from LiveMetricSnapshot.target; values are as the target reported them. */
export function TargetRuntime({
  history,
  domain,
  origin,
}: {
  history: LiveHistory;
  domain: Domain;
  origin: string | null;
}) {
  const [hoverT, setHoverT] = useState<number | null>(null);
  const points = history.target;
  if (!points.length) return null;
  const charts = targetCharts(points);
  const shared = {
    xs: points.map((p) => p.t),
    breaks: points.map((p) => p.gapBefore),
    domain,
    hoverT,
    onHover: setHoverT,
    format: reading,
  };
  return (
    <section className="live-grid-section" aria-labelledby="live-target">
      <header className="live-section-head">
        <h2 id="live-target">Target runtime</h2>
        <TargetNote history={history} origin={origin} />
      </header>
      {charts.length === 0 ? (
        <p className="live-note">The target has not reported a reading yet.</p>
      ) : (
        <div className="live-charts">
          {charts.map((chart) => (
            <LiveChart key={chart.title} {...shared} title={chart.title} series={chart.series} />
          ))}
        </div>
      )}
    </section>
  );
}
