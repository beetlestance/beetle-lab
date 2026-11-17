import { clock } from './load.js';
import type { Shape } from './load.js';

/** Planned load over time (from the draft, not a measurement), with a phase tape and total. */
export function LoadChart({ shape, unit }: { shape: Shape; unit: string }) {
  const width = 800;
  const height = 72;
  const peak = Math.max(...shape.points.map((point) => point.v), 1);
  const total = Math.max(shape.total, 1);
  const x = (t: number) => (t / total) * width;
  const y = (v: number) => height - 1 - (v / peak) * (height - 2);
  const line = shape.points.map((point) => `${x(point.t).toFixed(1)},${y(point.v).toFixed(1)}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  const stages = shape.phases.length;
  return (
    <figure className="load-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Planned ${unit}`}>
        <polygon points={area} className="load-chart-area" />
        <polyline points={line} className="load-chart-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <ol className="load-phases">
        {shape.phases.map((phase, index) => (
          <li key={index} style={{ flexGrow: Math.max(phase.seconds, total / 50) }}>
            <span className="load-phase-tape" aria-hidden="true" />
            <span>
              {phase.label} <span className="number">{clock(phase.seconds)}</span>
            </span>
          </li>
        ))}
      </ol>
      <figcaption>
        <span className="number">{clock(shape.total)}</span> in total, {stages} {stages === 1 ? 'stage' : 'stages'}
      </figcaption>
    </figure>
  );
}
