import type { ChartTick } from '../live/LiveChart.js';
import { LiveChart } from '../live/LiveChart.js';
import type { MetricChartPoint, ChartHover } from './types.js';
import { ms, reading, whole } from '../live/format.js';

export function MetricWindows({
  points,
  domain,
  hover,
  ticks,
  p95Limit,
  strictHoverRange,
}: {
  points: readonly MetricChartPoint[];
  domain: readonly [number, number];
  hover: ChartHover;
  ticks?: readonly ChartTick[];
  p95Limit?: number | null;
  strictHoverRange?: boolean;
}) {
  const xs = points.map((p) => p.t);
  const pick = (key: 'rps' | 'p50' | 'p95' | 'p99' | 'failedPerSecond' | 'vus' | 'vusMax') => points.map((p) => p[key]);
  const shared = { ticks, xs, breaks: points.map((point) => point.gapBefore), domain, strictHoverRange, ...hover };
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
          limit={p95Limit == null ? undefined : { value: p95Limit, label: `Limit ${ms(p95Limit)}` }}
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
