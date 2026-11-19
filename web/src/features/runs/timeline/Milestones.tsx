import type { Row } from './projection.js';
import './milestones.css';
const included = new Set<Row['kind']>([
  'admitted',
  'runtime.started',
  'phase.started',
  'phase.finished',
  'artifact.sealed',
  'engine.result',
  'runtime.exited',
  'cancellation.requested',
  'execution.lost',
]);
/** Event sequence order, with exact source timestamps; never inferred elapsed time. */
export function Milestones({ rows }: { rows: readonly Row[] }) {
  const milestones = rows.filter((row) => included.has(row.kind));
  if (milestones.length === 0) return <p>No milestones are present in the retained activity.</p>;
  return (
    <ol className="result-milestones" aria-label="Recorded run milestones">
      {milestones.map((row) => (
        <li key={row.seq}>
          <time className="number" dateTime={row.at} title={row.at}>
            {row.at.slice(11, 19)}
          </time>
          <span>{row.kind.startsWith('phase.') ? `${row.phase}: ${row.text}` : row.text}</span>
        </li>
      ))}
    </ol>
  );
}
