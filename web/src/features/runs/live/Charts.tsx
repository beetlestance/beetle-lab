import { useState } from 'react';
import { SegmentedFilter } from '../../../components/SegmentedFilter.js';
import type { LiveHistory, TargetPoint } from './history.js';
import type { RunPlan } from './plan.js';
import { LiveChart } from './LiveChart.js';
import type { ChartSeries } from './LiveChart.js';
import { clock, ms, reading, span, whole } from './format.js';

type Domain = readonly [number, number];

/** The x domain: the planned run when known, otherwise the readings this page saw. */
export function chartDomain(history: LiveHistory, plan: RunPlan): Domain {
  const last = Math.max(history.points.at(-1)?.t ?? 0, history.target.at(-1)?.t ?? 0);
  if (history.fromStart && plan.totalMs !== null) return [0, Math.max(plan.totalMs, last)];
  const first = Math.min(history.points[0]?.t ?? 0, history.target[0]?.t ?? Number.POSITIVE_INFINITY);
  return [first, Math.max(first + 1000, last)];
}

function stageTicks(plan: RunPlan, domain: Domain, nowT: number | null) {
  const ticks = [{ at: domain[0], label: clock(domain[0]) }];
  const warm = plan.stages.length > 2 ? plan.stages[0] : undefined;
  if (warm) ticks.push({ at: warm.durationMs, label: `Warm up ends ${clock(warm.durationMs)}` });
  if (nowT !== null) ticks.push({ at: nowT, label: `now ${clock(nowT)}` });
  const drain = plan.stages.find((stage) => stage.drain);
  if (drain) ticks.push({ at: drain.startMs, label: `Drain ${clock(drain.startMs)}` });
  ticks.push({ at: domain[1], label: clock(domain[1]) });
  return ticks;
}

export function WholeRun({
  history,
  plan,
  domain,
  p95Limit,
  slowest,
}: {
  history: LiveHistory;
  plan: RunPlan;
  domain: Domain;
  p95Limit: number | null;
  slowest: boolean;
}) {
  const [view, setView] = useState<'p95' | 'rps'>('p95');
  const xs = history.points.map((p) => p.t);
  const nowT = xs.at(-1) ?? null;
  const warm = plan.stages.length > 2 ? plan.stages[0] : undefined;
  const drain = plan.stages.find((stage) => stage.drain);
  const bands = history.fromStart
    ? [
        ...(warm ? [{ from: 0, to: warm.durationMs }] : []),
        ...(drain ? [{ from: drain.startMs, to: drain.startMs + drain.durationMs }] : []),
      ]
    : [];
  const series: ChartSeries =
    view === 'p95'
      ? {
          key: 'p95',
          label: slowest ? 'p95, slowest endpoint' : 'p95',
          tone: 'amber',
          area: true,
          values: history.points.map((p) => p.p95),
        }
      : { key: 'rps', label: 'requests a second', tone: 'amber', area: true, values: history.points.map((p) => p.rps) };
  return (
    <section className="live-whole" aria-labelledby="live-whole">
      <header className="live-section-head">
        <h2 id="live-whole">{view === 'p95' ? 'p95 latency' : 'Requests a second'}, whole run</h2>
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
        title={history.fromStart ? 'Since the run started' : 'Since this page opened'}
        tall
        xs={xs}
        domain={domain}
        series={[series]}
        format={view === 'p95' ? ms : whole}
        limit={view === 'p95' && p95Limit !== null ? { value: p95Limit, label: `Limit ${ms(p95Limit)}` } : undefined}
        bands={bands}
        ticks={history.fromStart ? stageTicks(plan, domain, nowT) : undefined}
      />
    </section>
  );
}

export function MetricsGrid({ history, domain }: { history: LiveHistory; domain: Domain }) {
  const [hoverT, setHoverT] = useState<number | null>(null);
  const xs = history.points.map((p) => p.t);
  const pick = (key: 'rps' | 'p50' | 'p95' | 'p99' | 'failedPerSecond' | 'vus' | 'vusMax') =>
    history.points.map((p) => p[key]);
  const shared = { xs, domain, hoverT, onHover: setHoverT };
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
  const heap: TargetKey = has(points, ['usedHeapSize']) ? 'usedHeapSize' : 'heapAlloc';
  const handles: TargetKey = has(points, ['activeHandles']) ? 'activeHandles' : 'goroutines';
  const line = (key: TargetKey, label: string, tone: ChartSeries['tone'], area = false): ChartSeries => ({
    key,
    label,
    tone,
    area,
    values: points.map((p) => value(p, key)),
  });
  const shared = {
    xs: points.map((p) => p.t),
    breaks: points.map((p) => p.gapBefore),
    domain,
    hoverT,
    onHover: setHoverT,
    format: reading,
  };
  const charts = [
    {
      title: 'Heap and RSS',
      keys: [heap, 'rss'] as TargetKey[],
      series: [line(heap, 'heap', 'amber'), line('rss', 'RSS', 'info')],
    },
    {
      title: 'CPU',
      keys: ['cpuPercent', 'systemCpuPercent'] as TargetKey[],
      series: [line('cpuPercent', 'process %', 'amber'), line('systemCpuPercent', 'system %', 'mute')],
    },
    {
      title: 'Event-loop delay',
      keys: ['eventLoopDelay.mean', 'eventLoopDelay.p99', 'eventLoopDelay.max'] as TargetKey[],
      series: [
        line('eventLoopDelay.mean', 'mean', 'info'),
        line('eventLoopDelay.p99', 'p99', 'amber'),
        line('eventLoopDelay.max', 'max', 'violet'),
      ],
    },
    {
      title: handles === 'goroutines' ? 'Goroutines' : 'Active handles',
      keys: [handles],
      series: [line(handles, handles === 'goroutines' ? 'goroutines' : 'handles', 'ink', true)],
    },
  ].filter((chart) => has(points, chart.keys));
  const unavailable = points.filter((p) => p.status === 'unavailable').length;
  return (
    <section className="live-grid-section" aria-labelledby="live-target">
      <header className="live-section-head">
        <h2 id="live-target">Target runtime</h2>
        <p className="live-note">
          Sampled{origin ? ` from ${origin}` : ''}
          {history.intervalMs ? ` every ${span(history.intervalMs)}` : ''}. Values as the target reports them.
          {unavailable > 0 && ` ${unavailable} readings unavailable.`}
          {points.some((p) => p.gapBefore) && ' Breaks in a line are readings left out of the live feed.'}
        </p>
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
