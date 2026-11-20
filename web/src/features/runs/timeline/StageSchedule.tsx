import { clock } from '../live/format.js';
import type { PlanStage } from '../live/plan.js';

function offsetLabel(milliseconds: number): string {
  const fraction = milliseconds % 1000;
  const seconds = clock(milliseconds);
  if (fraction === 0) return seconds;
  return seconds + '.' + String(fraction).padStart(3, '0').replace(/0+$/, '');
}

/** Relative to the saved scenario plan. The runtime does not attest these transitions. */
export function StageSchedule({ stages }: { stages: readonly PlanStage[] }) {
  if (stages.length === 0) return null;
  return (
    <>
      <h3 className="result-milestone-heading">Scheduled stages</h3>
      <p className="result-muted">Offsets from the saved load plan. Actual transitions can differ.</p>
      <ol className="result-milestones" aria-label="Scheduled stages">
        {stages.map((stage, index) => (
          <li key={index}>
            <span className="number">{offsetLabel(stage.startMs)}</span>
            <span>{stage.label}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

export function RecordedScenarioStart({ milliseconds }: { milliseconds: number | undefined }) {
  if (milliseconds === undefined) return null;
  const timestamp = new Date(milliseconds).toISOString();
  return (
    <p>
      k6 recorded the scenario start at <time dateTime={timestamp}>{timestamp}</time>.
    </p>
  );
}
