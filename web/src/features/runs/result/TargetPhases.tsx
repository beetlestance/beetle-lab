import { useMemo, useState } from 'react';
import type { TargetRuntimeReport } from '@beetle/contracts/target-runtime';
import { LiveChart } from '../live/LiveChart.js';
import { recordedTargetPlot, targetCardReading } from './target-model.js';
import { targetPhaseSummary, phaseNumber } from './phase-model.js';
import './phase.css';

export function TargetPhases({ report, nativeOrigin }: { report: TargetRuntimeReport; nativeOrigin: number | null }) {
  const plot = useMemo(() => recordedTargetPlot(report, nativeOrigin), [report, nativeOrigin]);
  const summary = useMemo(() => targetPhaseSummary(report), [report]);
  const [hoverT, onHover] = useState<number | null>(null);
  const memory = plot.cards[0]!;
  const bands = ['before', 'after'].flatMap((phase) => {
    const points = plot.points.filter((point) => point.sample.phase === phase);
    return summary.ordered && points.length > 1 ? [{ from: points[0]!.t, to: points.at(-1)!.t }] : [];
  });
  return (
    <div className="target-phases">
      <p className="result-muted target-phase-count">
        {report.samples.length} recorded observations · {report.missed} missed.
        {report.limited && ' Collection reached its limit; later activity may be absent.'}
      </p>
      <div className="target-phase-memory">
        <LiveChart
          title="Memory over the run"
          xs={plot.points.map((p) => p.t)}
          breaks={plot.points.map((p) => p.gap)}
          domain={plot.domain}
          ticks={plot.ticks}
          series={memory.series}
          bands={bands}
          tall
          strictHoverRange
          hoverT={hoverT}
          onHover={onHover}
          format={(value) => targetCardReading(memory, value)}
        />
        {!memory.normalized && <p className="result-muted">Raw source units. Compare each series only with itself.</p>}
        <PhaseCoverage summary={summary} />
        <RequestLandmarks span={report.requestSpan} />
      </div>
      {!summary.ordered && (
        <p role="status">
          Chronology, phase order or target uptime changed. Differences and counter-derived figures are unavailable.
        </p>
      )}
      {plot.omittedTimestamps > 0 && (
        <p role="status">{plot.omittedTimestamps} observations could not be plotted; original values remain below.</p>
      )}
      <PhaseTable summary={summary} />
      <p className="result-muted">
        The table uses recorded sampler phases. HTTP landmarks are shown separately when recorded.
      </p>
      <details className="target-phase-methods">
        <summary>How these values are calculated</summary>
        <p>
          Shading covers the observed before and after spans. A single point has no measured span. The during phase can
          include engine startup. Before and after are the first and last recorded points of their respective phases.
          During gauge values are means of known readings, without time weighting.
        </p>
        <p>
          GC rates and averages use counter differences within each phase. Missing counters, units, phase endpoints or
          observed resets leave a dash. The longest pause requires a complete sequence of pause records within the
          phase.
        </p>
        <dl>
          {summary.rows.map((row) => (
            <div key={row.name}>
              <dt>{row.name}</dt>
              <dd>{row.note}</dd>
            </div>
          ))}
        </dl>
        <p>Compare repeated runs with a stable baseline and an appropriate cooldown to investigate retained memory.</p>
      </details>
    </div>
  );
}

function RequestLandmarks({ span }: { span: TargetRuntimeReport['requestSpan'] }) {
  if (!span) return null;
  return (
    <dl aria-label="Recorded HTTP landmarks" className="target-phase-landmarks">
      <Landmark label="First request dispatched" ms={span.firstDispatchMs} />
      <Landmark label="Last HTTP request completed" ms={span.lastCompletionMs} />
    </dl>
  );
}

function Landmark({ label, ms }: { label: string; ms: number }) {
  const iso = new Date(ms).toISOString();
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <time dateTime={iso}>{iso.replace('T', ' ').replace('Z', ' UTC')}</time>
      </dd>
    </div>
  );
}

function PhaseTable({ summary }: { summary: ReturnType<typeof targetPhaseSummary> }) {
  return (
    <div className="target-phase-table" tabIndex={0} role="region" aria-label="Target by recorded phase">
      <table>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Before point</th>
            <th scope="col">During phase</th>
            <th scope="col">Last after point</th>
            <th scope="col">During vs before</th>
          </tr>
        </thead>
        <tbody>
          {summary.rows.map((row) => (
            <tr key={row.name}>
              <th scope="row">
                <span>{row.name}</span>
              </th>
              {row.values.map((value, index) => (
                <td key={index}>{phaseNumber(value, row.unit)}</td>
              ))}
              <td>{phaseNumber(row.delta, row.deltaUnit, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PhaseCoverage({ summary }: { summary: ReturnType<typeof targetPhaseSummary> }) {
  return (
    <div className="target-phase-spans">
      {['Before', 'During', 'After'].map((phase, index) => {
        const count = summary.counts[index] ?? 0;
        const span = summary.spans[index] ?? null;
        const observed = span === null ? 'span unavailable' : `${phaseNumber(span / 1000, 's')} observed`;
        return (
          <span key={phase}>
            {phase} · {count} {count === 1 ? 'sample' : 'samples'} · {observed}
          </span>
        );
      })}
    </div>
  );
}
