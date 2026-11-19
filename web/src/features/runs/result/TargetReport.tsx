import { useMemo, useState } from 'react';
import type { Artifact } from '@beetle/contracts';
import type { RunArtifactParams } from '@beetle/contracts/api';
import type { TargetRuntimeReport, TargetRuntimeSample } from '@beetle/contracts/target-runtime';
import { Button } from '../../../components/Button.js';
import type { ChartHover } from '../charts/types.js';
import { LiveChart, recordedHoverIndex } from '../live/LiveChart.js';
import { useTargetReport } from '../target-observations/useReport.js';
import { TargetReportDetails } from '../target-observations/index.js';
import type { TargetReportReads } from '../target-observations/read.js';
import { recordedTargetPlot, targetCardReading } from './target-model.js';
import type { TargetCard, RecordedTargetPlot } from './target-model.js';
import './target.css';

/** One verified byte read; chart grid and advanced details share its frozen report. */
export function ResultTargetReport({
  params,
  artifact,
  nativeOrigin,
  hover,
  reads,
}: {
  params: RunArtifactParams;
  artifact: Artifact;
  nativeOrigin: number | null;
  hover: ChartHover;
  reads?: Pick<TargetReportReads, 'read'>;
}) {
  const { state, retry } = useTargetReport({ params, artifact }, reads);
  const [details, setDetails] = useState(false);
  if (state.status === 'error')
    return (
      <div role="alert">
        <p>Target observations could not be verified or loaded.</p>
        <Button size="sm" onClick={retry}>
          Retry target observations
        </Button>
      </div>
    );
  if (state.status !== 'ready') return <p role="status">Reading verified target observations…</p>;
  return (
    <>
      <TargetReportPlots
        key={`${artifact.sha256}/${nativeOrigin}`}
        report={state.report}
        nativeOrigin={nativeOrigin}
        hover={hover}
      />
      <details className="result-target-details" onToggle={(event) => setDetails(event.currentTarget.open)}>
        <summary>Recorded target values and checkpoints</summary>
        {details && <TargetReportDetails report={state.report} />}
      </details>
    </>
  );
}

function TargetReportPlots({
  report,
  nativeOrigin,
  hover,
}: {
  report: TargetRuntimeReport;
  nativeOrigin: number | null;
  hover: ChartHover;
}) {
  const plot = useMemo(() => recordedTargetPlot(report, nativeOrigin), [report, nativeOrigin]);
  const [hoverT, onHover] = useState<number | null>(null);
  const cursor = plot.nativeTime && plot.chronologySafe ? hover : { hoverT, onHover };
  const selected =
    cursor.hoverT === null
      ? plot.points.length - 1
      : recordedHoverIndex(
          plot.points.map((p) => p.t),
          plot.points.map((p) => p.gap),
          cursor.hoverT,
        );
  return (
    <>
      <TargetWarnings report={report} plot={plot} />
      <div className="live-charts result-target-grid">
        {plot.cards.map((card) => (
          <TargetCardFigure key={card.id} card={card} plot={plot} cursor={cursor} />
        ))}
      </div>
      <TargetReadout
        report={report}
        plot={plot}
        sample={plot.points[selected]?.sample}
        hovered={cursor.hoverT !== null}
      />
    </>
  );
}

function TargetCardFigure({ card, plot, cursor }: { card: TargetCard; plot: RecordedTargetPlot; cursor: ChartHover }) {
  return (
    <div className="result-target-card">
      <LiveChart
        {...cursor}
        strictHoverRange
        title={card.title}
        xs={plot.points.map((p) => p.t)}
        breaks={plot.points.map((p) => p.gap)}
        domain={plot.domain}
        ticks={plot.ticks}
        series={card.series}
        format={(value) => targetCardReading(card, value)}
      />
      {!card.anyReading ? (
        <p className="result-muted">No usable observations were recorded for this chart.</p>
      ) : (
        !card.normalized && <p className="result-muted">Raw source units. Compare each series only with itself.</p>
      )}
    </div>
  );
}

function TargetWarnings({ report, plot }: { report: TargetRuntimeReport; plot: RecordedTargetPlot }) {
  return (
    <>
      {report.limited && (
        <p className="result-muted">Collection reached its bound; later target activity may be absent.</p>
      )}
      {plot.omittedTimestamps > 0 && (
        <p role="status">
          {plot.omittedTimestamps} observations have unplottable timestamps; their original values remain below.
        </p>
      )}
      {!plot.chronologySafe && (
        <p role="status">
          Target chronology or uptime changed; baseline comparisons are unavailable. Charts retain the recorded
          observations.
        </p>
      )}
    </>
  );
}

function TargetReadout({
  report,
  plot,
  sample,
  hovered,
}: {
  report: TargetRuntimeReport;
  plot: RecordedTargetPlot;
  sample: TargetRuntimeSample | undefined;
  hovered: boolean;
}) {
  return (
    <>
      <p className="result-muted">
        {report.samples.length} recorded target observations; {report.missed} missed. All retained phases are shown.{' '}
        {plot.nativeTime
          ? 'Time follows the recorded native measurement marker.'
          : 'Time is relative to the first usable target observation; workload time is unavailable.'}
      </p>
      {hovered && !sample && <p className="result-muted">No target observation covers this time.</p>}
      {sample && (
        <p className="result-muted">
          {hovered ? 'Nearest recorded target observation' : 'Last recorded target observation'}:{' '}
          <time dateTime={sample.observedAt}>{sample.observedAt}</time> ({sample.phase})
          {sample.reason && ` · ${sample.reason}`}.
        </p>
      )}
    </>
  );
}
