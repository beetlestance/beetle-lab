import { useMemo, useState } from 'react';
import type { RunComparisonItem } from '@beetle/contracts/api';
import { LiveChart } from '../live/LiveChart.js';
import { ms, whole } from '../live/format.js';
import type { ComparisonHistories, Overviews } from './useComparison.js';
import { comparisonPlot } from './overlay-model.js';
import type { ComparisonPlot } from './overlay-model.js';
import { comparisonPeak } from './recorded-source.js';
import { comparisonRunLabels } from './run-labels.js';
import '../live/live.css';

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
    <section className="compare-section" aria-labelledby="recorded-comparison-title">
      <h2 id="recorded-comparison-title">Recorded runs over time</h2>
      <p className="compare-muted">
        Time is relative to each run’s native measurement marker. Plans and phases are not stretched to align. Point at
        either chart for the nearest recorded windows; gaps and times outside coverage stay unknown.
      </p>
      <RecordedNotes items={items} histories={histories} overviews={overviews} />
      <OverlayChart plot={plot} metric="p95" hoverT={hoverT} onHover={onHover} />
      <OverlayChart plot={plot} metric="requests" hoverT={hoverT} onHover={onHover} />
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
  metric: 'p95' | 'requests';
  hoverT: number | null;
  onHover: (time: number | null) => void;
}) {
  const latency = metric === 'p95';
  const series = plot.curves.map((curve) => ({
    key: curve.id,
    label: curve.label,
    tone: curve.tone,
    xs: curve.xs,
    breaks: curve.breaks,
    values: curve[metric],
  }));
  const title = latency ? 'Recorded p95 latency, histogram estimates' : 'Recorded requests per one-second window';
  if (!series.some((line) => line.values.some((value) => value !== null)))
    return <p>{latency ? 'Latency' : 'Request'} observations are unavailable for these recordings.</p>;
  return (
    <LiveChart
      title={title}
      xs={plot.curves[0]?.xs ?? []}
      domain={plot.domain}
      ticks={plot.ticks}
      series={series}
      strictHoverRange
      tall
      hoverT={hoverT}
      onHover={onHover}
      format={latency ? ms : whole}
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
  return (
    <div className="compare-muted">
      {items.map((item) => {
        const id = item.run.id.toLowerCase(),
          label = labels.get(id);
        const read = histories.get(id);
        if (!read || read.status === 'error')
          return (
            <p role="alert" key={id}>
              {label}: recorded charts could not be loaded. Refresh comparison to retry.
            </p>
          );
        const value = read.value;
        if (value.reason !== null)
          return (
            <p key={id}>
              {label}: recorded charts {value.reason.replaceAll('_', ' ')}.
            </p>
          );
        return (
          <p key={id}>
            {label}: {value.points.length} plotted of {value.windows} verified source windows.
            {value.source?.coverage.complete === false && ' Window coverage is partial.'}
            {comparisonPeak(overviews?.get(id), read) === null &&
              ' Observed peak is unavailable for these whole-run measurements.'}
          </p>
        );
      })}
    </div>
  );
}
