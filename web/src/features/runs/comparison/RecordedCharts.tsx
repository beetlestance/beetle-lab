import { useMemo, useState } from 'react';
import type { RunComparisonItem, RunChartHistory } from '@beetle/contracts/api';
import { LiveChart } from '../live/LiveChart.js';
import { ms, whole } from '../live/format.js';
import type { ComparisonHistories, Overviews } from './useComparison.js';
import { comparisonPlot } from './overlay-model.js';
import type { ComparisonPlot } from './overlay-model.js';
import { comparisonPeak } from './recorded-source.js';
import { ComparisonSourceNotes } from './SourceNotes.js';
import { comparisonRunLabels } from './run-labels.js';
import '../live/live.css';

const metrics = {
  requests: { title: 'Requests a second', unavailable: 'Request', format: whole },
  p95: { title: 'Latency (p95)', unavailable: 'Latency', format: ms },
  failures: { title: 'Failed requests a second', unavailable: 'Failed request', format: whole },
  vus: { title: 'Active virtual users (busy)', unavailable: 'Active virtual user', format: whole },
} as const;

export function RecordedComparisonCharts({
  items,
  histories,
  overviews,
}: {
  items: readonly RunComparisonItem[];
  histories: ComparisonHistories | undefined;
  overviews: Overviews | undefined;
}) {
  const plot = useMemo(() => comparisonPlot(items, histories), [items, histories]);
  const [hoverT, onHover] = useState<number | null>(null);
  if (histories === undefined) return <p role="status">Reading recorded comparison windows…</p>;
  return (
    <section className="compare-section compare-chart-section" aria-labelledby="recorded-comparison-title">
      <header className="compare-chart-heading">
        <h2 id="recorded-comparison-title">Requests and virtual users</h2>
        <p className="compare-muted">
          Time is relative to each run’s native measurement marker. Plans and phases are not stretched to align. Point
          at any chart for the nearest recorded windows; gaps and times outside coverage stay unknown.
        </p>
      </header>
      <RecordedNotes items={items} histories={histories} overviews={overviews} />
      <div className="live-charts">
        {(Object.keys(metrics) as (keyof typeof metrics)[]).map((metric) => (
          <OverlayChart key={metric} plot={plot} metric={metric} hoverT={hoverT} onHover={onHover} />
        ))}
      </div>
    </section>
  );
}
function OverlayChart({
  plot,
  metric,
  hoverT,
  onHover,
}: {
  plot: ComparisonPlot;
  metric: keyof typeof metrics;
  hoverT: number | null;
  onHover: (time: number | null) => void;
}) {
  const definition = metrics[metric];
  const series = plot.curves.map((curve) => ({
    key: curve.id,
    label: curve.label,
    tone: curve.tone,
    xs: curve.xs,
    breaks: curve.breaks,
    values: curve[metric],
  }));
  if (!series.some((line) => line.values.some((value) => value !== null)))
    return <p>{definition.unavailable} observations are unavailable for these recordings.</p>;
  return (
    <LiveChart
      title={definition.title}
      xs={plot.curves[0]?.xs ?? []}
      domain={plot.domain}
      ticks={plot.ticks}
      series={series}
      strictHoverRange
      hoverT={hoverT}
      onHover={onHover}
      format={definition.format}
    />
  );
}
function RecordedNotes({
  items,
  histories,
  overviews,
}: {
  items: readonly RunComparisonItem[];
  histories: ComparisonHistories;
  overviews: Overviews | undefined;
}) {
  const labels = comparisonRunLabels(items.map((item) => item.run.id));
  const notes = items.map((item) => {
    const id = item.run.id.toLowerCase(),
      label = labels.get(id),
      read = histories.get(id);
    if (!read || read.status === 'error')
      return {
        id,
        attention: true,
        content: <p role="alert">{label}: recorded charts could not be loaded. Refresh comparison to retry.</p>,
      };
    const value = read.value;
    if (value.reason !== null)
      return {
        id,
        attention: true,
        content: (
          <p>
            {label}: recorded charts {value.reason.replaceAll('_', ' ')}.
          </p>
        ),
      };
    return windowNote(id, label, value, comparisonPeak(overviews?.get(id), read) === null);
  });
  return <ComparisonSourceNotes notes={notes} />;
}

function windowNote(id: string, label: string | undefined, value: RunChartHistory, peakMissing: boolean) {
  return {
    id,
    attention: value.source?.coverage.complete === false || value.points.length < value.windows || peakMissing,
    content: (
      <p>
        {label}: {value.points.length} plotted of {value.windows} verified source windows.
        {value.source?.coverage.complete === false && ' Window coverage is partial.'}
        {peakMissing && ' Observed peak is unavailable for these whole-run measurements.'}
      </p>
    ),
  };
}
